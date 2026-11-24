/**
 * ALARA — Механика пожаротушения, физики струи CO₂ и очагов возгорания (ОУ-5)
 * (src/mechanics/extinguisherSystem.ts)
 *
 * Реализует:
 * - Стойки основного и запасного огнетушителя ОУ-5
 * - Состояния баллона: ON_POST -> HELD_LOCKED (чека) -> ARMED -> EMPTY
 * - Расчёт конуса/луча распыления, пул частиц CO₂ (Zero-Allocation), расход заряда
 * - Снижение интенсивности очагов, трансформацию дыма в пар, статус 'ACTIVE' | 'SUPPRESSING' | 'EXTINGUISHED'
 */

import * as THREE from 'three';
import {
  SCENARIO_4_CONFIG,
  getFireSmokeQualityPreset,
  type FireSmokeQualityPreset,
  type FireZoneSpec
} from '../npp/nppNodeConfig';
import type { BuildingBeaconAnchor, NamedWorldMarker } from '../npp/nppSceneInspector';
import { TargetMarkerSprite } from './targetMarkerSprite';

export type ExtinguisherStatus = 'ON_POST' | 'HELD_LOCKED' | 'ARMED' | 'EMPTY';
export type ExtinguisherLifecycleState = 'IDLE_HOLSTERED' | 'EQUIPPED' | 'SPRAYING' | 'STOWED';
export type FireZoneStatus = 'ACTIVE' | 'SUPPRESSING' | 'EXTINGUISHED';

export interface FireZoneRuntime {
  readonly index: number;
  readonly config: FireZoneSpec;
  readonly worldPos: THREE.Vector3;
  readonly buildingLabelRu: string;
  readonly rootGroup: THREE.Group;
  intensity: number; // 1.0 -> 0.0
  status: FireZoneStatus;
  steamTimer: number;
  extinguishedLabelTimer: number;
  readonly flameCones: THREE.Mesh[];
  readonly smokePuffs: THREE.Mesh[];
  readonly smokeMat: THREE.MeshBasicMaterial;
  readonly floorRing: THREE.Mesh;
  readonly beaconGroup: THREE.Group;
  readonly beaconPoleOffsetX: number;
  readonly beaconDomeMat: THREE.MeshBasicMaterial;
  readonly portalSmokePoints: THREE.Points;
  readonly portalSmokeGeo: THREE.BufferGeometry;
  readonly portalSmokeMat: THREE.PointsMaterial;
  readonly portalSmokePositions: Float32Array;
  readonly portalSmokePosAttr: THREE.BufferAttribute;
  readonly portalSmokeSeeds: Float32Array;
  readonly markerSprite: TargetMarkerSprite;
  activeFlameLimit: number;
  activeSmokeLimit: number;
  activePortalSmokeLimit: number;
  wasSteamPhase: boolean;
  wasExtinguishedVisual: boolean;
  lastBeaconHot: boolean | null;
}

export interface FirePortalDoorwaySpec {
  readonly fireId: string;
  readonly doorwayPos: THREE.Vector3;
  readonly labelRu?: string;
}

export interface SprayHitResult {
  readonly hitAnyFire: boolean;
  readonly extinguishedFireId: string | null;
  readonly targetFireNameRu: string | null;
  readonly remainingIntensity01: number;
}

interface FireUnitCaps {
  readonly flames: number;
  readonly smoke: number;
  readonly portalParticles: number;
}

export class ExtinguisherSystem {
  public readonly rootGroup = new THREE.Group();
  public readonly fires: FireZoneRuntime[] = [];

  private readonly primaryPostPos = new THREE.Vector3();
  private readonly sparePostPos = new THREE.Vector3();

  private primaryStandMesh!: THREE.Group;
  private spareStandMesh!: THREE.Group;
  private standBottleMesh!: THREE.Group;
  private spareBottleMesh!: THREE.Group;

  // Переносимая 3D-модель ОУ-5 (крепится к руке HTC Vive или к якорю камеры Desktop)
  public readonly handheldGroup = new THREE.Group();
  private handheldPinRing!: THREE.Mesh;
  private handheldGaugeFill!: THREE.Mesh;
  private handheldNozzleTip = new THREE.Object3D();

  // Пул частиц распыла CO₂ (Zero-Allocation)
  private sprayPoints!: THREE.Points;
  private sprayPositions!: Float32Array;
  private sprayVelocities: Float32Array;
  private sprayLifetimes: Float32Array;
  private sprayPosAttr!: THREE.BufferAttribute;

  // Состояние огнетушителя (явная стейт-машина жизненного цикла + статус заряда/чеки)
  public status: ExtinguisherStatus = 'ON_POST';
  public lifecycleState: ExtinguisherLifecycleState = 'IDLE_HOLSTERED';
  public charge01 = 1.0; // 1.0 -> 0.0 (~18 с непрерывного распыла)
  public cylindersUsed = 1;
  public isSpraying = false;
  public isHoseEquipped = false;
  private spareAvailable = true;
  private hasSprayedOnce = false;
  private idleReleaseTimerSec = 0;

  // WebAudio процедура (шипение CO₂ + потрескивание пожара)
  private audioCtx: AudioContext | null = null;
  private hissGain: GainNode | null = null;
  private crackleGain: GainNode | null = null;
  private noiseSource: AudioBufferSourceNode | null = null;

  // Буферы без аллокаций в игровом цикле
  private readonly scratchVecA = new THREE.Vector3();
  private readonly scratchVecB = new THREE.Vector3();
  private readonly scratchDir = new THREE.Vector3();
  private readonly scratchNozzlePos = new THREE.Vector3();
  private readonly scratchVrOffset = new THREE.Vector3();
  private readonly scratchQuat = new THREE.Quaternion();

  private readonly effectScale: number;
  private elapsedAnimSec = 0;
  private reachBonusM = 0;
  private suppressionMultiplier = 1.0;
  private targetMarkersVisible = true;
  private portalSmokeTexture: THREE.CanvasTexture | null = null;

  // Бюджет и качество дыма/пламени (Desktop / VR Lite)
  private isVrLiteMode = false;
  private activeQualityPreset: FireSmokeQualityPreset;
  private readonly maxSprayParticleCount: number;
  private activeSprayParticleCount: number;
  private readonly maxPortalParticlesPerFire: number;
  private spraySpawnAccum = 0;
  private smokeUpdateTimerSec = 0;

  public setTargetMarkersVisible(visible: boolean): void {
    this.targetMarkersVisible = visible;
    for (let i = 0; i < this.fires.length; i++) {
      this.fires[i].markerSprite.sprite.visible =
        visible && (this.fires[i].status !== 'EXTINGUISHED' || this.fires[i].extinguishedLabelTimer > 0);
    }
  }

  public setRoleModifiers(reachBonusM: number, suppressionMultiplier: number): void {
    this.reachBonusM = Math.max(0, reachBonusM);
    this.suppressionMultiplier = Math.max(0.5, suppressionMultiplier);
  }

  public setVrLiteMode(enabled: boolean): void {
    const effective = SCENARIO_4_CONFIG.FIRE_SMOKE_QUALITY.vrLiteMode || enabled;
    if (effective === this.isVrLiteMode && this.fires.length > 0) return;
    this.isVrLiteMode = effective;
    this.activeQualityPreset = getFireSmokeQualityPreset(effective);
    this.applyQualityPreset();
  }

  private computePerFireCaps(preset: FireSmokeQualityPreset, fireCount: number): FireUnitCaps {
    const safeCount = Math.max(1, fireCount);
    let flames = Math.max(1, preset.flameConesPerFire);
    let smoke = Math.max(1, preset.smokePuffsPerFire);
    let portalParticles = Math.max(2, preset.portalSmokeParticlesPerFire);

    const perFireBudget = Math.max(
      4,
      Math.floor(preset.maxTotalSceneFireSmokeUnits / safeCount)
    );
    let total = flames + smoke + portalParticles;
    while (total > perFireBudget) {
      if (portalParticles > 2) portalParticles -= 1;
      else if (smoke > 1) smoke -= 1;
      else if (flames > 1) flames -= 1;
      else break;
      total = flames + smoke + portalParticles;
    }

    return { flames, smoke, portalParticles };
  }

  private applyQualityPreset(): void {
    const preset = this.activeQualityPreset;
    this.activeSprayParticleCount = Math.min(this.maxSprayParticleCount, preset.sprayParticleCount);
    for (let i = this.activeSprayParticleCount; i < this.maxSprayParticleCount; i++) {
      this.sprayLifetimes[i] = 0;
      this.sprayPositions[i * 3 + 1] = -999;
    }
    const caps = this.computePerFireCaps(preset, this.fires.length);
    for (let i = 0; i < this.fires.length; i++) {
      const fire = this.fires[i];
      fire.activeFlameLimit = Math.min(fire.flameCones.length, caps.flames);
      fire.activeSmokeLimit = Math.min(fire.smokePuffs.length, caps.smoke);
      fire.activePortalSmokeLimit = Math.min(
        this.maxPortalParticlesPerFire,
        caps.portalParticles
      );
      fire.portalSmokeGeo.setDrawRange(0, fire.activePortalSmokeLimit);
      fire.portalSmokeMat.size = preset.portalSmokeSizeM;
      for (let f = fire.activeFlameLimit; f < fire.flameCones.length; f++) {
        fire.flameCones[f].visible = false;
      }
      for (let s = fire.activeSmokeLimit; s < fire.smokePuffs.length; s++) {
        fire.smokePuffs[s].visible = false;
      }
    }
  }

  constructor(
    fireSpecs: ReadonlyArray<FireZoneSpec>,
    discoveredFires: ReadonlyArray<NamedWorldMarker>,
    primaryPostPos: THREE.Vector3,
    sparePostPos: THREE.Vector3,
    effectScale = 0.62,
    buildingAnchors: ReadonlyArray<BuildingBeaconAnchor> = [],
    fireZoneBuildingIndices: ReadonlyArray<number> = [],
    vrLiteMode = false
  ) {
    this.rootGroup.name = 'npp_extinguisher_fire_system';
    this.effectScale = Math.max(0.25, Math.min(2.0, effectScale));
    this.primaryPostPos.copy(primaryPostPos);
    this.sparePostPos.copy(sparePostPos);

    const desktopPreset = SCENARIO_4_CONFIG.FIRE_SMOKE_QUALITY.desktop;
    const vrPreset = SCENARIO_4_CONFIG.FIRE_SMOKE_QUALITY.vrLite;
    this.isVrLiteMode = SCENARIO_4_CONFIG.FIRE_SMOKE_QUALITY.vrLiteMode || vrLiteMode;
    this.activeQualityPreset = getFireSmokeQualityPreset(this.isVrLiteMode);

    this.maxSprayParticleCount = Math.max(
      desktopPreset.sprayParticleCount,
      vrPreset.sprayParticleCount
    );
    this.activeSprayParticleCount = Math.min(
      this.maxSprayParticleCount,
      this.activeQualityPreset.sprayParticleCount
    );
    this.maxPortalParticlesPerFire = Math.max(
      desktopPreset.portalSmokeParticlesPerFire,
      vrPreset.portalSmokeParticlesPerFire
    );

    this.sprayVelocities = new Float32Array(this.maxSprayParticleCount * 3);
    this.sprayLifetimes = new Float32Array(this.maxSprayParticleCount);
    this.portalSmokeTexture = this.createPortalSmokeTexture();

    this.buildExtinguisherPosts();
    this.buildHandheldExtinguisher();
    this.buildSprayParticlePool();
    this.buildFireZones(fireSpecs, discoveredFires, buildingAnchors, fireZoneBuildingIndices);
    this.applyQualityPreset();
  }

  private createPortalSmokeTexture(): THREE.CanvasTexture {
    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 64;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      const grad = ctx.createRadialGradient(32, 32, 4, 32, 32, 31);
      grad.addColorStop(0, 'rgba(255, 255, 255, 0.92)');
      grad.addColorStop(0.42, 'rgba(226, 232, 240, 0.62)');
      grad.addColorStop(0.78, 'rgba(148, 163, 184, 0.22)');
      grad.addColorStop(1, 'rgba(15, 23, 42, 0)');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, 64, 64);
    }
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.needsUpdate = true;
    return tex;
  }

  private buildBottleMesh(withPin: boolean): {
    group: THREE.Group;
    pinRing: THREE.Mesh;
    gaugeFill: THREE.Mesh;
    nozzleTip: THREE.Object3D;
  } {
    const g = new THREE.Group();

    const bodyMat = new THREE.MeshStandardMaterial({
      color: 0xdc2626,
      roughness: 0.35,
      metalness: 0.35
    });
    const darkMetalMat = new THREE.MeshStandardMaterial({
      color: 0x1e293b,
      roughness: 0.45,
      metalness: 0.7
    });
    const brassMat = new THREE.MeshStandardMaterial({
      color: 0xd97706,
      roughness: 0.3,
      metalness: 0.8
    });

    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.082, 0.082, 0.46, 14), bodyMat);
    body.position.y = 0.25;
    g.add(body);

    const dome = new THREE.Mesh(
      new THREE.SphereGeometry(0.082, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.5),
      bodyMat
    );
    dome.position.y = 0.48;
    g.add(dome);

    const valve = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.03, 0.07, 10), brassMat);
    valve.position.y = 0.57;
    g.add(valve);

    const lever = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.015, 0.11), darkMetalMat);
    lever.position.set(0, 0.61, 0.03);
    lever.rotation.x = -0.18;
    g.add(lever);

    const pinMat = new THREE.MeshBasicMaterial({ color: 0xfacc15 });
    const pinRing = new THREE.Mesh(new THREE.TorusGeometry(0.022, 0.0045, 8, 16), pinMat);
    pinRing.position.set(0.032, 0.585, 0.02);
    pinRing.rotation.y = Math.PI / 2;
    pinRing.visible = withPin;
    g.add(pinRing);

    const horn = new THREE.Mesh(
      new THREE.CylinderGeometry(0.042, 0.014, 0.22, 12, 1, true),
      darkMetalMat
    );
    horn.material.side = THREE.DoubleSide;
    horn.rotation.x = Math.PI / 2 - 0.12;
    horn.position.set(0, 0.54, -0.15);
    g.add(horn);

    const nozzleTip = new THREE.Object3D();
    nozzleTip.position.set(0, 0.53, -0.27);
    g.add(nozzleTip);

    const gaugeBack = new THREE.Mesh(
      new THREE.BoxGeometry(0.028, 0.18, 0.012),
      new THREE.MeshBasicMaterial({ color: 0x0f172a })
    );
    gaugeBack.position.set(0, 0.36, 0.084);
    g.add(gaugeBack);

    const gaugeFill = new THREE.Mesh(
      new THREE.BoxGeometry(0.02, 0.16, 0.014),
      new THREE.MeshBasicMaterial({ color: 0x22c55e })
    );
    gaugeFill.position.set(0, 0.36, 0.086);
    g.add(gaugeFill);

    return { group: g, pinRing, gaugeFill, nozzleTip };
  }

  private buildExtinguisherPosts(): void {
    const createStand = (labelHex: number): THREE.Group => {
      const stand = new THREE.Group();
      const baseMat = new THREE.MeshStandardMaterial({
        color: 0x334155,
        roughness: 0.6,
        metalness: 0.4
      });
      const base = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.36, 0.08, 14), baseMat);
      base.position.y = 0.04;
      stand.add(base);

      const post = new THREE.Mesh(new THREE.BoxGeometry(0.08, 1.15, 0.08), baseMat);
      post.position.set(0, 0.58, -0.18);
      stand.add(post);

      const sign = new THREE.Mesh(
        new THREE.BoxGeometry(0.42, 0.22, 0.04),
        new THREE.MeshBasicMaterial({ color: labelHex })
      );
      sign.position.set(0, 1.18, -0.15);
      stand.add(sign);

      const ring = new THREE.Mesh(
        new THREE.RingGeometry(0.42, 0.52, 28),
        new THREE.MeshBasicMaterial({
          color: labelHex,
          side: THREE.DoubleSide,
          transparent: true,
          opacity: 0.6
        })
      );
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = 0.018;
      stand.add(ring);

      return stand;
    };

    this.primaryStandMesh = createStand(0xef4444);
    this.primaryStandMesh.position.copy(this.primaryPostPos);
    const primaryBottle = this.buildBottleMesh(true);
    this.standBottleMesh = primaryBottle.group;
    this.standBottleMesh.position.set(0, 0.08, 0.04);
    this.primaryStandMesh.add(this.standBottleMesh);
    this.rootGroup.add(this.primaryStandMesh);

    this.spareStandMesh = createStand(0xf59e0b);
    this.spareStandMesh.position.copy(this.sparePostPos);
    const spareBottle = this.buildBottleMesh(true);
    this.spareBottleMesh = spareBottle.group;
    this.spareBottleMesh.position.set(0, 0.08, 0.04);
    this.spareStandMesh.add(this.spareBottleMesh);
    this.rootGroup.add(this.spareStandMesh);
  }

  private buildHandheldExtinguisher(): void {
    const built = this.buildBottleMesh(true);
    // Смещаем пивот внутрь рукоятки/ЗПУ, чтобы баллон свисал вниз под кистью, а не торчал вверх перед глазами
    built.group.position.set(0, -0.44, 0.02);
    this.handheldGroup.add(built.group);
    this.handheldPinRing = built.pinRing;
    this.handheldGaugeFill = built.gaugeFill;
    this.handheldNozzleTip = built.nozzleTip;
    this.handheldGroup.scale.setScalar(0.72);
    this.handheldGroup.visible = false;
    this.rootGroup.add(this.handheldGroup);
  }

  private buildSprayParticlePool(): void {
    this.sprayPositions = new Float32Array(this.maxSprayParticleCount * 3);
    for (let i = 0; i < this.maxSprayParticleCount; i++) {
      this.sprayPositions[i * 3 + 1] = -999;
      this.sprayLifetimes[i] = 0;
    }
    const geo = new THREE.BufferGeometry();
    this.sprayPosAttr = new THREE.BufferAttribute(this.sprayPositions, 3);
    this.sprayPosAttr.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', this.sprayPosAttr);

    const mat = new THREE.PointsMaterial({
      color: 0xe0f2fe,
      size: 0.24,
      transparent: true,
      opacity: 0.78,
      depthWrite: false
    });
    this.sprayPoints = new THREE.Points(geo, mat);
    this.sprayPoints.frustumCulled = false;
    this.rootGroup.add(this.sprayPoints);
  }

  private buildFireZones(
    fireSpecs: ReadonlyArray<FireZoneSpec>,
    discoveredFires: ReadonlyArray<NamedWorldMarker>,
    buildingAnchors: ReadonlyArray<BuildingBeaconAnchor>,
    fireZoneBuildingIndices: ReadonlyArray<number>
  ): void {
    const es = this.effectScale;
    const desktopCfg = SCENARIO_4_CONFIG.FIRE_SMOKE_QUALITY.desktop;
    const maxFlames = Math.max(desktopCfg.flameConesPerFire, this.activeQualityPreset.flameConesPerFire);
    const maxSmoke = Math.max(desktopCfg.smokePuffsPerFire, this.activeQualityPreset.smokePuffsPerFire);
    const maxPortalCount = this.maxPortalParticlesPerFire;

    // Общая геометрия и общие материалы для минимального числа draw-calls
    const flameGeo = new THREE.ConeGeometry(0.32 * es, 1.15 * es, 6);
    const smokeGeo = new THREE.DodecahedronGeometry(0.34 * es, 0);
    const beaconPoleGeo = new THREE.CylinderGeometry(0.055, 0.075, 2.8, 8);
    const beaconDomeGeo = new THREE.SphereGeometry(0.22, 8, 8);

    const sharedBeaconPoleMat = new THREE.MeshStandardMaterial({
      color: 0x334155,
      roughness: 0.55,
      metalness: 0.6
    });
    const sharedBaseMat = new THREE.MeshBasicMaterial({ color: 0x1c1917 });
    const sharedFlameMatOrange = new THREE.MeshBasicMaterial({
      color: 0xf97316,
      transparent: true,
      opacity: 0.88,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });
    const sharedFlameMatYellow = new THREE.MeshBasicMaterial({
      color: 0xfacc15,
      transparent: true,
      opacity: 0.86,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });

    for (let idx = 0; idx < fireSpecs.length; idx++) {
      const cfg = fireSpecs[idx];
      const matched =
        discoveredFires.find(d => d.name.toUpperCase().startsWith(cfg.markerName.toUpperCase())) ??
        discoveredFires[idx];
      const worldPos = matched
        ? matched.pos.clone()
        : new THREE.Vector3(cfg.defaultPos[0], cfg.defaultPos[1], cfg.defaultPos[2]);

      const bldIdx = fireZoneBuildingIndices[idx] ?? idx;
      const bldAnchor = buildingAnchors[bldIdx] ?? buildingAnchors[0];
      const buildingLabelRu = bldAnchor?.labelRu ?? `Корпус №${(bldIdx % 3) + 1}`;

      const group = new THREE.Group();
      group.position.copy(worldPos);
      group.name = `fire_zone_${cfg.id}`;

      const padRadius = cfg.radiusM * 0.62 * es;
      const baseMesh = new THREE.Mesh(
        new THREE.CylinderGeometry(padRadius * 0.85, padRadius, 0.05, 10),
        sharedBaseMat
      );
      baseMesh.position.y = 0.025;
      group.add(baseMesh);

      const ringInner = Math.max(padRadius + 0.12, cfg.radiusM * 1.12 * es);
      const ringOuter = ringInner + 0.16 * es;
      const floorRing = new THREE.Mesh(
        new THREE.RingGeometry(ringInner, ringOuter, 20),
        new THREE.MeshBasicMaterial({
          color: 0xf97316,
          side: THREE.DoubleSide,
          transparent: true,
          opacity: 0.55,
          depthWrite: false
        })
      );
      floorRing.rotation.x = -Math.PI / 2;
      floorRing.position.y = 0.025;
      group.add(floorRing);

      const flameCones: THREE.Mesh[] = [];
      for (let f = 0; f < maxFlames; f++) {
        const cone = new THREE.Mesh(
          flameGeo,
          f % 2 === 0 ? sharedFlameMatOrange : sharedFlameMatYellow
        );
        const angle = (f / Math.max(1, maxFlames)) * Math.PI * 2;
        const r = f === 0 ? 0 : padRadius * 0.52;
        cone.position.set(Math.cos(angle) * r, 0.55 * es, Math.sin(angle) * r);
        cone.userData.baseX = cone.position.x;
        cone.userData.baseZ = cone.position.z;
        cone.userData.phase = idx * 1.3 + f * 1.1;
        group.add(cone);
        flameCones.push(cone);
      }

      const smokeMat = new THREE.MeshBasicMaterial({
        color: 0x1e293b,
        transparent: true,
        opacity: 0.45 * cfg.smokeDensity,
        depthWrite: false
      });
      const smokePuffs: THREE.Mesh[] = [];
      for (let s = 0; s < maxSmoke; s++) {
        const puff = new THREE.Mesh(smokeGeo, smokeMat);
        puff.position.set(
          ((s % 3) - 1) * 0.32 * es,
          (0.95 + s * 0.32) * es,
          ((s % 2) - 0.5) * 0.32 * es
        );
        puff.userData.phase = s * 0.9 + idx * 0.7;
        group.add(puff);
        smokePuffs.push(puff);
      }

      // Компактный наружный маяк тревоги у входа корпуса (без тяжёлых PointLight и световых столбов)
      const beaconGroup = new THREE.Group();
      const beaconPos = bldAnchor ? bldAnchor.facadePos.clone() : worldPos.clone();
      const beaconPoleOffsetX = idx % 2 === 0 ? -1.45 : 1.45;
      beaconGroup.position.set(beaconPos.x + beaconPoleOffsetX, beaconPos.y, beaconPos.z);

      const pole = new THREE.Mesh(beaconPoleGeo, sharedBeaconPoleMat);
      pole.position.y = 1.4;
      beaconGroup.add(pole);

      const beaconDomeMat = new THREE.MeshBasicMaterial({ color: 0xef4444 });
      const beaconDome = new THREE.Mesh(beaconDomeGeo, beaconDomeMat);
      beaconDome.position.y = 2.88;
      beaconGroup.add(beaconDome);

      // Лёгкий поток дымовых частиц из проёма активного пожарного портала
      const portalSmokePositions = new Float32Array(maxPortalCount * 3);
      const portalSmokeSeeds = new Float32Array(maxPortalCount * 3);
      for (let ps = 0; ps < maxPortalCount; ps++) {
        const phase = ps / Math.max(1, maxPortalCount);
        const angle = (ps * 2.39996) % (Math.PI * 2);
        const radial = 0.28 + ((ps * 17) % 10) * 0.1;
        portalSmokeSeeds[ps * 3] = phase;
        portalSmokeSeeds[ps * 3 + 1] = angle;
        portalSmokeSeeds[ps * 3 + 2] = radial;
        portalSmokePositions[ps * 3] = Math.cos(angle) * radial * 0.4;
        portalSmokePositions[ps * 3 + 1] = 1.4 + phase * 6.5;
        portalSmokePositions[ps * 3 + 2] = Math.sin(angle) * radial * 0.4;
      }
      const portalSmokeGeo = new THREE.BufferGeometry();
      const portalSmokePosAttr = new THREE.BufferAttribute(portalSmokePositions, 3);
      portalSmokePosAttr.setUsage(THREE.DynamicDrawUsage);
      portalSmokeGeo.setAttribute('position', portalSmokePosAttr);
      const portalSmokeMat = new THREE.PointsMaterial({
        color: 0x475569,
        map: this.portalSmokeTexture,
        size: this.activeQualityPreset.portalSmokeSizeM,
        transparent: true,
        opacity: 0.62,
        depthWrite: false,
        sizeAttenuation: true
      });
      const portalSmokePoints = new THREE.Points(portalSmokeGeo, portalSmokeMat);
      portalSmokePoints.position.set(-beaconPoleOffsetX, 0, 0.25);
      portalSmokePoints.frustumCulled = false;
      beaconGroup.add(portalSmokePoints);

      this.rootGroup.add(beaconGroup);

      // Парящий 3D-маркер с расстоянием и статусом очага
      const markerSprite = new TargetMarkerSprite(2.7, 0.8);
      markerSprite.sprite.position.set(0, Math.max(3.2, 3.6 * es), 0);
      group.add(markerSprite.sprite);

      this.rootGroup.add(group);
      this.fires.push({
        index: idx,
        config: cfg,
        worldPos,
        buildingLabelRu,
        rootGroup: group,
        intensity: cfg.initialIntensity,
        status: cfg.initialIntensity > 0 ? 'ACTIVE' : 'EXTINGUISHED',
        steamTimer: 0,
        extinguishedLabelTimer: 0,
        flameCones,
        smokePuffs,
        smokeMat,
        floorRing,
        beaconGroup,
        beaconPoleOffsetX,
        beaconDomeMat,
        portalSmokePoints,
        portalSmokeGeo,
        portalSmokeMat,
        portalSmokePositions,
        portalSmokePosAttr,
        portalSmokeSeeds,
        markerSprite,
        activeFlameLimit: flameCones.length,
        activeSmokeLimit: smokePuffs.length,
        activePortalSmokeLimit: maxPortalCount,
        wasSteamPhase: false,
        wasExtinguishedVisual: false,
        lastBeaconHot: null
      });
    }
  }

  /**
   * Привязывает маяк и компактный дым портала к каждому активному входу пожарного корпуса.
   */
  public configureFirePortalDoorways(entries: ReadonlyArray<FirePortalDoorwaySpec>): void {
    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];
      const fire = this.getFireById(entry.fireId) ?? this.fires[i];
      if (!fire) continue;

      fire.beaconGroup.position.set(
        entry.doorwayPos.x + fire.beaconPoleOffsetX,
        entry.doorwayPos.y,
        entry.doorwayPos.z
      );
      fire.portalSmokePoints.position.set(-fire.beaconPoleOffsetX, 0, 0.25);

      const isActive = fire.status !== 'EXTINGUISHED' && fire.intensity > 0;
      fire.portalSmokePoints.visible = isActive;
    }
  }

  public getPrimaryPostPos(): THREE.Vector3 {
    return this.primaryPostPos;
  }

  public getSparePostPos(): THREE.Vector3 {
    return this.sparePostPos;
  }

  public isSpareAvailable(): boolean {
    return this.spareAvailable;
  }

  public grabPrimaryExtinguisher(): boolean {
    if (this.status !== 'ON_POST') return false;
    this.status = 'HELD_LOCKED';
    this.lifecycleState = 'EQUIPPED';
    this.idleReleaseTimerSec = 0;
    this.hasSprayedOnce = false;
    this.standBottleMesh.visible = false;
    this.handheldGroup.visible = true;
    this.handheldPinRing.visible = true;
    this.handheldGroup.updateMatrixWorld(true);
    this.syncGaugeVisual();
    return true;
  }

  public pullSafetyPin(): boolean {
    if (this.status !== 'HELD_LOCKED') return false;
    this.status = 'ARMED';
    if (this.lifecycleState === 'IDLE_HOLSTERED' || this.lifecycleState === 'STOWED') {
      this.lifecycleState = 'EQUIPPED';
      this.handheldGroup.visible = true;
    }
    this.idleReleaseTimerSec = 0;
    this.handheldPinRing.visible = false;
    this.handheldGroup.updateMatrixWorld(true);
    this.syncGaugeVisual();
    return true;
  }

  public swapSpareExtinguisher(): boolean {
    if (!this.spareAvailable || this.status === 'ON_POST') return false;
    this.spareAvailable = false;
    this.spareBottleMesh.visible = false;
    this.charge01 = 1.0;
    this.cylindersUsed += 1;
    this.status = 'ARMED';
    this.lifecycleState = 'EQUIPPED';
    this.idleReleaseTimerSec = 0;
    this.hasSprayedOnce = false;
    this.handheldPinRing.visible = false;
    this.handheldGroup.visible = true;
    this.handheldGroup.updateMatrixWorld(true);
    this.syncGaugeVisual();
    return true;
  }

  /**
   * Возвращает огнетушитель в походное положение / убирает за пояс (STOWED),
   * сбрасывает локальные сдвиги и матрицу трансформации, останавливает распыл и шипение.
   */
  public stowExtinguisher(): boolean {
    if (this.status === 'ON_POST') {
      this.lifecycleState = 'IDLE_HOLSTERED';
      this.resetHandheldTransformToParked();
      return false;
    }
    this.stopSpray();
    this.lifecycleState = 'STOWED';
    this.idleReleaseTimerSec = 0;
    this.resetHandheldTransformToParked();
    return true;
  }

  /**
   * Извлекает огнетушитель из походного положения (STOWED -> EQUIPPED) при готовности к тушению.
   */
  public equipExtinguisher(): boolean {
    if (this.status === 'ON_POST' || this.status === 'EMPTY' || this.charge01 <= 0) {
      return false;
    }
    this.lifecycleState = 'EQUIPPED';
    this.idleReleaseTimerSec = 0;
    this.handheldGroup.visible = true;
    this.handheldGroup.updateMatrixWorld(true);
    this.syncGaugeVisual();
    return true;
  }

  public toggleStow(): 'STOWED' | 'EQUIPPED' | 'UNAVAILABLE' {
    if (this.isHoseEquipped) return 'UNAVAILABLE';
    if (this.status === 'ON_POST' || this.status === 'EMPTY' || this.charge01 <= 0) {
      return 'UNAVAILABLE';
    }
    if (this.lifecycleState === 'STOWED' || this.lifecycleState === 'IDLE_HOLSTERED') {
      this.equipExtinguisher();
      return 'EQUIPPED';
    }
    this.stowExtinguisher();
    return 'STOWED';
  }

  public setHoseEquipped(equipped: boolean): void {
    this.isHoseEquipped = equipped;
    const mat = this.sprayPoints.material as THREE.PointsMaterial;
    mat.color.setHex(equipped ? 0xbae6fd : 0xe0f2fe);
    mat.size = equipped ? 0.28 : 0.24;
    if (equipped) {
      this.stopSpray();
      this.resetHandheldTransformToParked();
    }
  }

  private resetHandheldTransformToParked(): void {
    this.isSpraying = false;
    if (this.hissGain) {
      this.hissGain.gain.value = 0;
    }
    this.handheldGroup.visible = false;
    this.handheldGroup.position.set(0, -10, 0);
    this.handheldGroup.rotation.set(0, 0, 0);
    this.handheldGroup.quaternion.identity();
    this.handheldGroup.updateMatrix();
    this.handheldGroup.updateMatrixWorld(true);
  }

  private syncGaugeVisual(): void {
    const scaleY = Math.max(0.05, this.charge01);
    this.handheldGaugeFill.scale.y = scaleY;
    this.handheldGaugeFill.position.y = 0.28 + 0.08 * scaleY;
    const mat = this.handheldGaugeFill.material as THREE.MeshBasicMaterial;
    if (this.charge01 > 0.45) mat.color.setHex(0x22c55e);
    else if (this.charge01 > 0.18) mat.color.setHex(0xf59e0b);
    else mat.color.setHex(0xef4444);
  }

  private ensureAudioInitialized(isMuted: boolean): void {
    if (isMuted) return;
    if (!this.audioCtx) {
      const AudioCtor =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtor) return;
      this.audioCtx = new AudioCtor();

      const sampleRate = this.audioCtx.sampleRate;
      const len = sampleRate * 2;
      const buf = this.audioCtx.createBuffer(1, len, sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < len; i++) {
        data[i] = Math.random() * 2 - 1;
      }

      const src = this.audioCtx.createBufferSource();
      src.buffer = buf;
      src.loop = true;

      const hissFilter = this.audioCtx.createBiquadFilter();
      hissFilter.type = 'bandpass';
      hissFilter.frequency.value = 1850;
      hissFilter.Q.value = 0.85;
      this.hissGain = this.audioCtx.createGain();
      this.hissGain.gain.value = 0;
      src.connect(hissFilter);
      hissFilter.connect(this.hissGain);
      this.hissGain.connect(this.audioCtx.destination);

      const crackleFilter = this.audioCtx.createBiquadFilter();
      crackleFilter.type = 'lowpass';
      crackleFilter.frequency.value = 420;
      this.crackleGain = this.audioCtx.createGain();
      this.crackleGain.gain.value = 0;
      src.connect(crackleFilter);
      crackleFilter.connect(this.crackleGain);
      this.crackleGain.connect(this.audioCtx.destination);

      src.start();
      this.noiseSource = src;
    } else if (this.audioCtx.state === 'suspended') {
      void this.audioCtx.resume();
    }
  }

  /**
   * Распыление CO₂ по лучу/конусу прицеливания с контролем дальности (0.35..6.5 м)
   * и снижением интенсивности задетых очагов возгорания.
   */
  public applySpray(
    aimOrigin: THREE.Vector3,
    aimDir: THREE.Vector3,
    dt: number,
    isMuted: boolean
  ): SprayHitResult {
    if (this.status !== 'ARMED' || this.charge01 <= 0) {
      this.isSpraying = false;
      if (this.status === 'EMPTY' || this.charge01 <= 0) {
        this.stowExtinguisher();
      }
      return {
        hitAnyFire: false,
        extinguishedFireId: null,
        targetFireNameRu: null,
        remainingIntensity01: 0
      };
    }

    // При повторном нажатии триггера/ЛКМ/[E] автоматически достаём ОУ-5 из поясного держателя
    if (this.lifecycleState === 'STOWED' || this.lifecycleState === 'IDLE_HOLSTERED') {
      this.equipExtinguisher();
    }

    this.ensureAudioInitialized(isMuted);
    this.lifecycleState = 'SPRAYING';
    this.isSpraying = true;
    this.hasSprayedOnce = true;
    this.idleReleaseTimerSec = 0;

    this.charge01 = Math.max(0, this.charge01 - dt * 0.056);
    this.syncGaugeVisual();

    if (this.charge01 <= 0) {
      this.status = 'EMPTY';
      this.stowExtinguisher();
      return {
        hitAnyFire: false,
        extinguishedFireId: null,
        targetFireNameRu: null,
        remainingIntensity01: 0
      };
    }

    this.handheldNozzleTip.getWorldPosition(this.scratchNozzlePos);

    return this.executeSuppressionRay(
      this.scratchNozzlePos,
      aimOrigin,
      aimDir,
      dt,
      6.5 + this.reachBonusM,
      0.42 * this.suppressionMultiplier
    );
  }

  /**
   * Подача огнетушащей водяной/пенной струи от пожарного рукава МЧС (дальность ~9.8 м + бонус инструмента, повышенная мощность).
   */
  public applyHoseSpray(
    nozzleTipPos: THREE.Vector3,
    aimOrigin: THREE.Vector3,
    aimDir: THREE.Vector3,
    dt: number,
    isMuted: boolean
  ): SprayHitResult {
    this.ensureAudioInitialized(isMuted);
    this.isSpraying = true;
    return this.executeSuppressionRay(
      nozzleTipPos,
      aimOrigin,
      aimDir,
      dt,
      SCENARIO_4_CONFIG.HOSE.sprayRangeM + this.reachBonusM,
      0.42 * SCENARIO_4_CONFIG.HOSE.suppressionRateMultiplier * this.suppressionMultiplier
    );
  }

  private executeSuppressionRay(
    emitPos: THREE.Vector3,
    aimOrigin: THREE.Vector3,
    aimDir: THREE.Vector3,
    dt: number,
    maxRangeM: number,
    suppressRate: number
  ): SprayHitResult {
    const speed = this.isHoseEquipped ? 11.2 : 7.8;
    const preset = this.activeQualityPreset;
    this.spraySpawnAccum += dt * preset.spraySpawnRateHz;
    const spawnCount = Math.min(4, Math.floor(this.spraySpawnAccum));
    if (spawnCount > 0) {
      this.spraySpawnAccum -= spawnCount;
      const poolLen = Math.max(1, this.activeSprayParticleCount);
      for (let s = 0; s < spawnCount; s++) {
        const slot = Math.floor(Math.random() * poolLen);
        this.sprayPositions[slot * 3] = emitPos.x;
        this.sprayPositions[slot * 3 + 1] = emitPos.y;
        this.sprayPositions[slot * 3 + 2] = emitPos.z;
        this.sprayVelocities[slot * 3] = aimDir.x * speed + (Math.random() - 0.5) * 1.3;
        this.sprayVelocities[slot * 3 + 1] = aimDir.y * speed + (Math.random() - 0.5) * 1.0;
        this.sprayVelocities[slot * 3 + 2] = aimDir.z * speed + (Math.random() - 0.5) * 1.3;
        this.sprayLifetimes[slot] = this.isHoseEquipped ? 0.62 : 0.52;
      }
    }

    let hitAnyFire = false;
    let extinguishedFireId: string | null = null;
    let targetFireNameRu: string | null = null;
    let remainingIntensity01 = 0;

    for (let i = 0; i < this.fires.length; i++) {
      const fire = this.fires[i];
      if (fire.status === 'EXTINGUISHED' || fire.intensity <= 0) continue;

      this.scratchVecA.copy(fire.worldPos);
      this.scratchVecA.y += 0.65;
      this.scratchDir.subVectors(this.scratchVecA, aimOrigin);
      const dist = this.scratchDir.length();
      if (dist > maxRangeM || dist < 0.35) continue;
      this.scratchDir.divideScalar(dist);

      const dot = this.scratchDir.dot(aimDir);
      if (dot > 0.85) {
        hitAnyFire = true;
        fire.status = 'SUPPRESSING';
        fire.intensity = Math.max(0, fire.intensity - dt * suppressRate);
        targetFireNameRu = fire.config.nameRu;
        remainingIntensity01 = fire.intensity;
        if (fire.intensity <= 0.001) {
          fire.intensity = 0;
          fire.status = 'EXTINGUISHED';
          fire.steamTimer = 3.2;
          fire.extinguishedLabelTimer = 4.0;
          extinguishedFireId = fire.config.id;
        }
      } else if (fire.status === 'SUPPRESSING') {
        fire.status = 'ACTIVE';
      }
    }

    return {
      hitAnyFire,
      extinguishedFireId,
      targetFireNameRu,
      remainingIntensity01
    };
  }

  public stopSpray(): void {
    this.isSpraying = false;
    if (this.lifecycleState === 'SPRAYING') {
      this.lifecycleState =
        this.status === 'EMPTY' || this.charge01 <= 0 ? 'STOWED' : 'EQUIPPED';
    }
    if (this.hissGain) {
      this.hissGain.gain.value = 0;
    }
    for (let i = 0; i < this.fires.length; i++) {
      if (this.fires[i].status === 'SUPPRESSING' && this.fires[i].intensity > 0) {
        this.fires[i].status = 'ACTIVE';
      }
    }
  }

  public update(
    dt: number,
    playerPos: THREE.Vector3,
    handAnchorPos: THREE.Vector3,
    aimDir: THREE.Vector3,
    isMuted: boolean,
    handAnchorQuat?: THREE.Quaternion,
    hasVrHandQuat = false
  ): { thermalHeatLoad01: number; smokeExposure01: number; extinguishedCount: number } {
    this.elapsedAnimSec += dt;

    // Автоматически убираем ОУ-5 с обзора после отпускания курка/кнопки распыла (через 0.45 с простоя),
    // при полном разряде или если все очаги ликвидированы
    if (this.lifecycleState === 'EQUIPPED' && !this.isSpraying) {
      if (this.status === 'EMPTY' || this.charge01 <= 0) {
        this.stowExtinguisher();
      } else if (this.hasSprayedOnce && this.status === 'ARMED') {
        this.idleReleaseTimerSec += dt;
        if (this.idleReleaseTimerSec >= 0.45) {
          this.stowExtinguisher();
        }
      }
    } else if (this.lifecycleState === 'SPRAYING') {
      this.idleReleaseTimerSec = 0;
    }

    // Жёсткий гард рендера: при STOWED / IDLE_HOLSTERED / EMPTY / активном рукаве баллон НИКОГДА не притягивается к камере
    const isActivelyHeldInHand =
      !this.isHoseEquipped &&
      (this.lifecycleState === 'EQUIPPED' || this.lifecycleState === 'SPRAYING') &&
      (this.status === 'HELD_LOCKED' || this.status === 'ARMED');

    if (isActivelyHeldInHand) {
      this.handheldGroup.visible = true;
      if (hasVrHandQuat && handAnchorQuat) {
        // В VR (HTC Vive): привязываем к правому контроллеру со смещением рукоятки вправо-вниз
        this.scratchVrOffset.set(0.035, -0.02, -0.05).applyQuaternion(handAnchorQuat);
        this.handheldGroup.position.copy(handAnchorPos).add(this.scratchVrOffset);
        this.handheldGroup.quaternion.copy(handAnchorQuat);
        if (!this.isSpraying) {
          this.handheldGroup.rotateX(-0.22);
        }
      } else {
        // В Desktop: боковая нижне-правая позиция, при простое баллон мягко отклонён вниз от прицела
        this.handheldGroup.position.copy(handAnchorPos);
        this.scratchVecB.copy(handAnchorPos).addScaledVector(aimDir, 2.0);
        this.handheldGroup.lookAt(this.scratchVecB);
        this.handheldGroup.rotateY(Math.PI);
        if (!this.isSpraying) {
          this.handheldGroup.rotateX(-0.24);
        }
      }
      this.handheldGroup.updateMatrixWorld(true);
    } else if (this.handheldGroup.visible) {
      this.resetHandheldTransformToParked();
    }

    let anySprayAlive = false;
    const sprayLimit = this.activeSprayParticleCount;
    for (let i = 0; i < sprayLimit; i++) {
      if (this.sprayLifetimes[i] > 0) {
        anySprayAlive = true;
        this.sprayLifetimes[i] -= dt;
        const idx = i * 3;
        this.sprayPositions[idx] += this.sprayVelocities[idx] * dt;
        this.sprayPositions[idx + 1] += this.sprayVelocities[idx + 1] * dt;
        this.sprayPositions[idx + 2] += this.sprayVelocities[idx + 2] * dt;
        this.sprayVelocities[idx + 1] -= 1.8 * dt;
        if (this.sprayLifetimes[i] <= 0) {
          this.sprayPositions[idx + 1] = -999;
        }
      }
    }
    this.sprayPoints.visible = anySprayAlive || this.isSpraying;
    if (anySprayAlive) {
      this.sprayPosAttr.needsUpdate = true;
    }

    const preset = this.activeQualityPreset;
    this.smokeUpdateTimerSec += dt;
    const runPortalParticleUpdate = this.smokeUpdateTimerSec >= preset.particleUpdateIntervalSec;
    if (runPortalParticleUpdate) {
      this.smokeUpdateTimerSec = 0;
    }

    let thermalHeatLoad01 = 0;
    let smokeExposure01 = 0;
    let extinguishedCount = 0;
    let nearestActiveFireDist = 999;

    for (let i = 0; i < this.fires.length; i++) {
      const fire = this.fires[i];
      const dist = playerPos.distanceTo(fire.worldPos);
      const distInt = Math.round(dist);

      if (fire.intensity <= 0 || fire.status === 'EXTINGUISHED') {
        extinguishedCount += 1;

        if (!fire.wasExtinguishedVisual) {
          fire.wasExtinguishedVisual = true;
          fire.lastBeaconHot = null;
          fire.floorRing.visible = false;
          for (let f = 0; f < fire.flameCones.length; f++) {
            fire.flameCones[f].visible = false;
          }
          fire.beaconDomeMat.color.setHex(0x22c55e);
          fire.portalSmokePoints.visible = false;
          fire.smokeMat.color.setHex(0xe2e8f0);
        }

        if (fire.extinguishedLabelTimer > 0) {
          fire.extinguishedLabelTimer = Math.max(0, fire.extinguishedLabelTimer - dt);
        }
        fire.markerSprite.sync(
          {
            title: `✓ Очаг №${fire.index + 1} потушен`,
            subtitle: `${fire.buildingLabelRu} · Ликвидирован`,
            accentHex: '#22C55E',
            bgHex: 'rgba(5, 46, 22, 0.9)'
          },
          dist,
          this.targetMarkersVisible && fire.extinguishedLabelTimer > 0,
          Math.min(0.95, fire.extinguishedLabelTimer * 0.6)
        );

        if (fire.steamTimer > 0) {
          fire.steamTimer = Math.max(0, fire.steamTimer - dt);
          const steamRatio = fire.steamTimer / 3.2;
          fire.smokeMat.opacity = 0.28 * steamRatio;
          for (let s = 0; s < fire.activeSmokeLimit; s++) {
            const puff = fire.smokePuffs[s];
            puff.visible = true;
            puff.position.y = 0.9 + ((this.elapsedAnimSec * 1.1 + s * 0.5) % 2.4);
          }
        } else if (fire.smokePuffs[0]?.visible) {
          for (let s = 0; s < fire.smokePuffs.length; s++) {
            fire.smokePuffs[s].visible = false;
          }
        }
        continue;
      }

      fire.wasExtinguishedVisual = false;
      if (dist < nearestActiveFireDist) nearestActiveFireDist = dist;

      if (dist < fire.config.heatRadiusM) {
        const ratio = (1 - dist / fire.config.heatRadiusM) * fire.intensity;
        if (ratio > thermalHeatLoad01) thermalHeatLoad01 = ratio;
      }
      if (dist < fire.config.heatRadiusM * 1.45) {
        const sRatio =
          (1 - dist / (fire.config.heatRadiusM * 1.45)) *
          fire.config.smokeDensity *
          fire.intensity;
        if (sRatio > smokeExposure01) smokeExposure01 = sRatio;
      }

      const isSteamTransition = fire.intensity < 0.28;
      if (isSteamTransition !== fire.wasSteamPhase) {
        fire.wasSteamPhase = isSteamTransition;
        fire.smokeMat.color.setHex(isSteamTransition ? 0xcbd5e1 : 0x1e293b);
        fire.portalSmokeMat.color.setHex(isSteamTransition ? 0xcbd5e1 : 0x475569);
      }

      const withinDetailCull = dist <= preset.effectCullDistanceM;
      if (withinDetailCull) {
        fire.floorRing.visible = true;
        for (let f = 0; f < fire.activeFlameLimit; f++) {
          const cone = fire.flameCones[f];
          cone.visible = true;
          const ph = (cone.userData.phase as number) || 0;
          const scaleY = Math.max(
            0.22,
            fire.intensity * (0.85 + Math.sin(this.elapsedAnimSec * 14 + ph) * 0.26)
          );
          const scaleXZ = 0.6 + fire.intensity * 0.4;
          cone.scale.set(scaleXZ, scaleY, scaleXZ);
          cone.position.y = 0.54 * this.effectScale * scaleY;
        }

        fire.smokeMat.opacity = Math.min(0.55, fire.config.smokeDensity * (0.3 + fire.intensity * 0.45));
        for (let s = 0; s < fire.activeSmokeLimit; s++) {
          const puff = fire.smokePuffs[s];
          puff.visible = true;
          const ph = (puff.userData.phase as number) || 0;
          const cycle = (this.elapsedAnimSec * preset.smokeCycleSpeed + ph) % 2.2;
          puff.position.y = (0.8 + cycle) * this.effectScale;
          const puffScale = Math.min(preset.smokeMaxScale, 0.55 + cycle * 0.28);
          puff.scale.setScalar(puffScale);
        }
      } else {
        fire.floorRing.visible = false;
        for (let f = 0; f < fire.activeFlameLimit; f++) {
          fire.flameCones[f].visible = false;
        }
        for (let s = 0; s < fire.activeSmokeLimit; s++) {
          fire.smokePuffs[s].visible = false;
        }
      }

      // Наружный аварийный маяк на фасаде
      const strobePhase = Math.sin(this.elapsedAnimSec * 7.5 + i * 1.7);
      const isHotFlash = strobePhase > 0;
      if (isHotFlash !== fire.lastBeaconHot) {
        fire.lastBeaconHot = isHotFlash;
        fire.beaconDomeMat.color.setHex(isHotFlash ? 0xef4444 : 0xf97316);
      }

      // Компактный поток дыма из проёма портала с регулируемой частотой
      fire.portalSmokePoints.visible = dist <= preset.effectCullDistanceM * 1.2;
      fire.portalSmokeMat.opacity = 0.38 + fire.intensity * 0.26;
      if (runPortalParticleUpdate && fire.portalSmokePoints.visible) {
        const pPos = fire.portalSmokePositions;
        const pSeeds = fire.portalSmokeSeeds;
        const pCount = fire.activePortalSmokeLimit;
        for (let ps = 0; ps < pCount; ps++) {
          const life = (pSeeds[ps * 3] + this.elapsedAnimSec * 0.24) % 1.0;
          const baseAng = pSeeds[ps * 3 + 1] + this.elapsedAnimSec * 0.42;
          const radial = pSeeds[ps * 3 + 2] * (0.35 + life * 1.05);
          const idx3 = ps * 3;
          pPos[idx3] = Math.cos(baseAng) * radial;
          pPos[idx3 + 1] = 1.35 + life * 6.5;
          pPos[idx3 + 2] = Math.sin(baseAng) * radial + life * 0.6;
        }
        fire.portalSmokePosAttr.needsUpdate = true;
      }

      const pct = Math.max(1, Math.round(fire.intensity * 100));
      fire.markerSprite.sync(
        {
          title:
            fire.status === 'SUPPRESSING'
              ? `ТУШЕНИЕ №${fire.index + 1} · ${distInt} м`
              : `ПОЖАР №${fire.index + 1} · ${distInt} м`,
          subtitle: `${fire.buildingLabelRu} · Интенсивность ${pct}%`,
          accentHex: fire.status === 'SUPPRESSING' ? '#38BDF8' : '#FB923C',
          bgHex: fire.status === 'SUPPRESSING' ? 'rgba(8, 47, 73, 0.9)' : 'rgba(67, 20, 7, 0.9)'
        },
        dist,
        this.targetMarkersVisible
      );
    }

    if (this.hissGain) {
      this.hissGain.gain.value = !isMuted && this.isSpraying ? 0.16 : 0;
    }
    if (this.crackleGain) {
      const fireVol =
        !isMuted && nearestActiveFireDist < 11
          ? Math.max(0, (1 - nearestActiveFireDist / 11) * 0.11)
          : 0;
      this.crackleGain.gain.value = fireVol;
    }

    return {
      thermalHeatLoad01: Math.min(1, thermalHeatLoad01),
      smokeExposure01: Math.min(1, smokeExposure01),
      extinguishedCount
    };
  }

  public getFireById(id: string): FireZoneRuntime | undefined {
    return this.fires.find(f => f.config.id === id);
  }

  public isFireExtinguished(id: string): boolean {
    const f = this.getFireById(id);
    return f ? f.status === 'EXTINGUISHED' || f.intensity <= 0 : true;
  }

  public getTotalFires(): number {
    return this.fires.length;
  }

  public getExtinguishedCount(): number {
    return this.fires.filter(f => f.status === 'EXTINGUISHED' || f.intensity <= 0).length;
  }

  public getNearestActiveFire(pos: THREE.Vector3): FireZoneRuntime | null {
    let best: FireZoneRuntime | null = null;
    let bestD = Infinity;
    for (const f of this.fires) {
      if (f.status === 'EXTINGUISHED' || f.intensity <= 0) continue;
      const d = pos.distanceTo(f.worldPos);
      if (d < bestD) {
        bestD = d;
        best = f;
      }
    }
    return best;
  }

  public dispose(): void {
    this.isSpraying = false;
    if (this.noiseSource) {
      try {
        this.noiseSource.stop();
        this.noiseSource.disconnect();
      } catch {
        // ignore
      }
      this.noiseSource = null;
    }
    if (this.audioCtx) {
      void this.audioCtx.close().catch(() => {});
      this.audioCtx = null;
    }
    this.hissGain = null;
    this.crackleGain = null;

    for (let i = 0; i < this.fires.length; i++) {
      this.fires[i].markerSprite.dispose();
    }
    const geos = new Set<THREE.BufferGeometry>();
    const mats = new Set<THREE.Material>();
    this.rootGroup.traverse(obj => {
      if ((obj as THREE.Mesh).isMesh || (obj as THREE.Points).isPoints) {
        const mesh = obj as THREE.Mesh;
        if (mesh.geometry) geos.add(mesh.geometry);
        const mList = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        mList.forEach(m => {
          if (m) mats.add(m);
        });
      }
    });
    geos.forEach(g => g.dispose());
    mats.forEach(m => m.dispose());
    if (this.portalSmokeTexture) {
      this.portalSmokeTexture.dispose();
      this.portalSmokeTexture = null;
    }
    this.rootGroup.parent?.remove(this.rootGroup);
  }
}
