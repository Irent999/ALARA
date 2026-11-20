/**
 * Подсистема пожаротушения и 3D-огнетушителей ОУ-5 / ОП-5 для Сценария №4 (1:1 м)
 * - 3D-модели огнетушителей на штатных постах (основной у входа + запасной баллон)
 * - Механика: взятие -> срыв пломбы/чеки -> удержание триггера/ЛКМ/E -> распыл CO₂ + расход заряда
 * - Повторное использование / замена пустого баллона на запасном посту
 * - Очаги возгорания с параметрами intensity, smokeDensity, heatRadius, переходом дыма в пар и WebAudio
 */

import * as THREE from 'three';
import type { ExtinguisherStatus, FireZoneConfig } from './config';

export interface FireZoneRuntime {
  readonly config: FireZoneConfig;
  readonly worldPos: THREE.Vector3;
  readonly rootGroup: THREE.Group;
  intensity: number; // 1.0 -> 0.0
  steamTimer: number;
  readonly flameCones: THREE.Mesh[];
  readonly smokePuffs: THREE.Mesh[];
  readonly light: THREE.PointLight;
  readonly floorRing: THREE.Mesh;
}

export interface SprayHitResult {
  hitAnyFire: boolean;
  extinguishedFireId: string | null;
  targetFireNameRu: string | null;
  remainingIntensity01: number;
}

const SPRAY_PARTICLE_COUNT = 110;

export class FireAndExtinguisherManager {
  public readonly rootGroup = new THREE.Group();
  public readonly fires: FireZoneRuntime[] = [];

  private readonly extinguisherStandPos = new THREE.Vector3();
  private readonly spareStandPos = new THREE.Vector3();

  private primaryStandMesh!: THREE.Group;
  private spareStandMesh!: THREE.Group;
  private standBottleMesh!: THREE.Group;
  private spareBottleMesh!: THREE.Group;

  // Переносимая модель ОУ-5 (привязывается к руке/якорю оператора)
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

  // Состояние огнетушителя
  public status: ExtinguisherStatus = 'ON_POST';
  public charge01 = 1.0; // 1.0 -> 0.0 (~17 сек непрерывного распыла)
  public cylindersUsed = 1;
  public isSpraying = false;
  private spareAvailable = true;

  // WebAudio процедура (шипение CO₂ + треск огня)
  private audioCtx: AudioContext | null = null;
  private hissGain: GainNode | null = null;
  private crackleGain: GainNode | null = null;
  private noiseSource: AudioBufferSourceNode | null = null;

  // Scratch векторы (Zero-Allocation)
  private readonly scratchVecA = new THREE.Vector3();
  private readonly scratchVecB = new THREE.Vector3();
  private readonly scratchDir = new THREE.Vector3();
  private readonly scratchNozzlePos = new THREE.Vector3();

  private elapsedAnimSec = 0;

  constructor(
    fireConfigs: ReadonlyArray<FireZoneConfig>,
    discoveredFires: ReadonlyArray<{ name: string; pos: THREE.Vector3 }>,
    primaryPostPos: THREE.Vector3,
    sparePostPos: THREE.Vector3
  ) {
    this.rootGroup.name = 'scenario4_fire_extinguisher_system';
    this.extinguisherStandPos.copy(primaryPostPos);
    this.spareStandPos.copy(sparePostPos);

    this.sprayVelocities = new Float32Array(SPRAY_PARTICLE_COUNT * 3);
    this.sprayLifetimes = new Float32Array(SPRAY_PARTICLE_COUNT);

    this.buildExtinguisherPosts();
    this.buildHandheldExtinguisher();
    this.buildSprayParticlePool();
    this.buildFireZones(fireConfigs, discoveredFires);
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

    // Баллон ОУ-5 (высота ~0.58 м, диаметр 0.16 м)
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.082, 0.082, 0.46, 16), bodyMat);
    body.position.y = 0.25;
    body.castShadow = true;
    g.add(body);

    const dome = new THREE.Mesh(
      new THREE.SphereGeometry(0.082, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.5),
      bodyMat
    );
    dome.position.y = 0.48;
    g.add(dome);

    // Вентильно-рычажный узел
    const valve = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.03, 0.07, 10), brassMat);
    valve.position.y = 0.57;
    g.add(valve);

    const lever = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.015, 0.11), darkMetalMat);
    lever.position.set(0, 0.61, 0.03);
    lever.rotation.x = -0.18;
    g.add(lever);

    // Чека с кольцом
    const pinMat = new THREE.MeshBasicMaterial({ color: 0xfacc15 });
    const pinRing = new THREE.Mesh(new THREE.TorusGeometry(0.022, 0.0045, 8, 16), pinMat);
    pinRing.position.set(0.032, 0.585, 0.02);
    pinRing.rotation.y = Math.PI / 2;
    pinRing.visible = withPin;
    g.add(pinRing);

    // Раструб CO₂ (направлен по -Z от оператора)
    const horn = new THREE.Mesh(new THREE.CylinderGeometry(0.042, 0.014, 0.22, 12, 1, true), darkMetalMat);
    horn.material.side = THREE.DoubleSide;
    horn.rotation.x = Math.PI / 2 - 0.12;
    horn.position.set(0, 0.54, -0.15);
    g.add(horn);

    const nozzleTip = new THREE.Object3D();
    nozzleTip.position.set(0, 0.53, -0.27);
    g.add(nozzleTip);

    // 3D шкала-индикатор остатка на корпусе (видна оператору)
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
      const base = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.36, 0.08, 18), baseMat);
      base.position.y = 0.04;
      base.receiveShadow = true;
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
        new THREE.MeshBasicMaterial({ color: labelHex, side: THREE.DoubleSide, transparent: true, opacity: 0.6 })
      );
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = 0.018;
      stand.add(ring);

      return stand;
    };

    // Основной пост ОУ-5 у входа
    this.primaryStandMesh = createStand(0xef4444);
    this.primaryStandMesh.position.copy(this.extinguisherStandPos);
    const primaryBottle = this.buildBottleMesh(true);
    this.standBottleMesh = primaryBottle.group;
    this.standBottleMesh.position.set(0, 0.08, 0.04);
    this.primaryStandMesh.add(this.standBottleMesh);
    this.rootGroup.add(this.primaryStandMesh);

    // Запасной пост перезарядки ОУ-5 внутри корпуса
    this.spareStandMesh = createStand(0xf59e0b);
    this.spareStandMesh.position.copy(this.spareStandPos);
    const spareBottle = this.buildBottleMesh(true);
    this.spareBottleMesh = spareBottle.group;
    this.spareBottleMesh.position.set(0, 0.08, 0.04);
    this.spareStandMesh.add(this.spareBottleMesh);
    this.rootGroup.add(this.spareStandMesh);
  }

  private buildHandheldExtinguisher(): void {
    const built = this.buildBottleMesh(true);
    this.handheldGroup.add(built.group);
    this.handheldPinRing = built.pinRing;
    this.handheldGaugeFill = built.gaugeFill;
    this.handheldNozzleTip = built.nozzleTip;
    this.handheldGroup.scale.setScalar(0.76);
    this.handheldGroup.visible = false;
    this.rootGroup.add(this.handheldGroup);
  }

  private buildSprayParticlePool(): void {
    this.sprayPositions = new Float32Array(SPRAY_PARTICLE_COUNT * 3);
    for (let i = 0; i < SPRAY_PARTICLE_COUNT; i++) {
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
    fireConfigs: ReadonlyArray<FireZoneConfig>,
    discoveredFires: ReadonlyArray<{ name: string; pos: THREE.Vector3 }>
  ): void {
    const flameGeo = new THREE.ConeGeometry(0.42, 1.35, 8);
    const smokeGeo = new THREE.DodecahedronGeometry(0.48, 0);

    fireConfigs.forEach((cfg, idx) => {
      const matched = discoveredFires.find(d => d.name.toUpperCase().startsWith(cfg.markerName));
      const worldPos = matched
        ? matched.pos.clone()
        : new THREE.Vector3(cfg.defaultPos[0], cfg.defaultPos[1], cfg.defaultPos[2]);

      const group = new THREE.Group();
      group.position.copy(worldPos);
      group.name = `fire_zone_${cfg.id}`;

      // Тлеющая кабельная / масляная подложка
      const baseMesh = new THREE.Mesh(
        new THREE.CylinderGeometry(cfg.radiusM * 0.9, cfg.radiusM, 0.14, 16),
        new THREE.MeshStandardMaterial({ color: 0x1c1917, roughness: 0.9 })
      );
      baseMesh.position.y = 0.07;
      group.add(baseMesh);

      const floorRing = new THREE.Mesh(
        new THREE.RingGeometry(cfg.heatRadiusM * 0.65, cfg.heatRadiusM * 0.7, 28),
        new THREE.MeshBasicMaterial({
          color: 0xf97316,
          side: THREE.DoubleSide,
          transparent: true,
          opacity: 0.24
        })
      );
      floorRing.rotation.x = -Math.PI / 2;
      floorRing.position.y = 0.025;
      group.add(floorRing);

      const flameCones: THREE.Mesh[] = [];
      for (let f = 0; f < 5; f++) {
        const flameMat = new THREE.MeshBasicMaterial({
          color: f % 2 === 0 ? 0xf97316 : 0xfacc15,
          transparent: true,
          opacity: 0.85,
          blending: THREE.AdditiveBlending,
          depthWrite: false
        });
        const cone = new THREE.Mesh(flameGeo, flameMat);
        const angle = (f / 5) * Math.PI * 2;
        const r = f === 0 ? 0 : cfg.radiusM * 0.42;
        cone.position.set(Math.cos(angle) * r, 0.68, Math.sin(angle) * r);
        cone.userData.baseX = cone.position.x;
        cone.userData.baseZ = cone.position.z;
        cone.userData.phase = idx * 1.3 + f * 1.1;
        group.add(cone);
        flameCones.push(cone);
      }

      const smokePuffs: THREE.Mesh[] = [];
      for (let s = 0; s < 6; s++) {
        const smokeMat = new THREE.MeshStandardMaterial({
          color: 0x1e293b,
          roughness: 1.0,
          transparent: true,
          opacity: 0.55 * cfg.smokeDensity,
          depthWrite: false
        });
        const puff = new THREE.Mesh(smokeGeo, smokeMat);
        puff.position.set(((s % 3) - 1) * 0.45, 1.3 + s * 0.38, ((s % 2) - 0.5) * 0.45);
        puff.userData.phase = s * 0.9 + idx * 0.7;
        group.add(puff);
        smokePuffs.push(puff);
      }

      const light = new THREE.PointLight(0xf97316, 4.2, 11.5, 1.6);
      light.position.set(0, 1.35, 0);
      group.add(light);

      this.rootGroup.add(group);
      this.fires.push({
        config: cfg,
        worldPos,
        rootGroup: group,
        intensity: cfg.initialIntensity,
        steamTimer: 0,
        flameCones,
        smokePuffs,
        light,
        floorRing
      });
    });
  }

  public getPrimaryPostPos(): THREE.Vector3 {
    return this.extinguisherStandPos;
  }

  public getSparePostPos(): THREE.Vector3 {
    return this.spareStandPos;
  }

  public isSpareAvailable(): boolean {
    return this.spareAvailable;
  }

  public grabPrimaryExtinguisher(): boolean {
    if (this.status !== 'ON_POST') return false;
    this.status = 'HELD_LOCKED';
    this.standBottleMesh.visible = false;
    this.handheldGroup.visible = true;
    this.handheldPinRing.visible = true;
    this.syncGaugeVisual();
    return true;
  }

  public pullSafetyPin(): boolean {
    if (this.status !== 'HELD_LOCKED') return false;
    this.status = 'ARMED';
    this.handheldPinRing.visible = false;
    this.syncGaugeVisual();
    return true;
  }

  public swapSpareExtinguisher(): boolean {
    if (!this.spareAvailable) return false;
    if (this.status === 'ON_POST') return false;
    this.spareAvailable = false;
    this.spareBottleMesh.visible = false;
    this.charge01 = 1.0;
    this.cylindersUsed += 1;
    this.status = 'ARMED';
    this.handheldPinRing.visible = false;
    this.syncGaugeVisual();
    return true;
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
      const AudioCtor = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
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

      // Фильтр шипения CO₂
      const hissFilter = this.audioCtx.createBiquadFilter();
      hissFilter.type = 'bandpass';
      hissFilter.frequency.value = 1850;
      hissFilter.Q.value = 0.85;
      this.hissGain = this.audioCtx.createGain();
      this.hissGain.gain.value = 0;
      src.connect(hissFilter);
      hissFilter.connect(this.hissGain);
      this.hissGain.connect(this.audioCtx.destination);

      // Фильтр потрескивания пожара
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

  public applySpray(
    aimOrigin: THREE.Vector3,
    aimDir: THREE.Vector3,
    dt: number,
    isMuted: boolean
  ): SprayHitResult {
    const emptyRes: SprayHitResult = {
      hitAnyFire: false,
      extinguishedFireId: null,
      targetFireNameRu: null,
      remainingIntensity01: 0
    };

    if (this.status !== 'ARMED' || this.charge01 <= 0) {
      this.isSpraying = false;
      return emptyRes;
    }

    this.ensureAudioInitialized(isMuted);
    this.isSpraying = true;
    this.charge01 = Math.max(0, this.charge01 - dt * 0.058);
    this.syncGaugeVisual();

    if (this.charge01 <= 0) {
      this.status = 'EMPTY';
      this.isSpraying = false;
    }

    this.handheldNozzleTip.getWorldPosition(this.scratchNozzlePos);

    // Спавним частицы CO₂ из раструба
    for (let s = 0; s < 4; s++) {
      const slot = Math.floor(Math.random() * SPRAY_PARTICLE_COUNT);
      this.sprayPositions[slot * 3] = this.scratchNozzlePos.x;
      this.sprayPositions[slot * 3 + 1] = this.scratchNozzlePos.y;
      this.sprayPositions[slot * 3 + 2] = this.scratchNozzlePos.z;
      this.sprayVelocities[slot * 3] = aimDir.x * 7.8 + (Math.random() - 0.5) * 1.4;
      this.sprayVelocities[slot * 3 + 1] = aimDir.y * 7.8 + (Math.random() - 0.5) * 1.1;
      this.sprayVelocities[slot * 3 + 2] = aimDir.z * 7.8 + (Math.random() - 0.5) * 1.4;
      this.sprayLifetimes[slot] = 0.52;
    }

    // Проверка попадания струи по очагам (дальность 1.0..5.2 м, угол конуса ~26 deg)
    let hitAnyFire = false;
    let extinguishedFireId: string | null = null;
    let targetFireNameRu: string | null = null;
    let remainingIntensity01 = 0;

    for (let i = 0; i < this.fires.length; i++) {
      const fire = this.fires[i];
      if (fire.intensity <= 0) continue;

      this.scratchVecA.copy(fire.worldPos);
      this.scratchVecA.y += 0.65;
      this.scratchDir.subVectors(this.scratchVecA, aimOrigin);
      const dist = this.scratchDir.length();
      if (dist > 5.4 || dist < 0.4) continue;
      this.scratchDir.divideScalar(dist);

      const dot = this.scratchDir.dot(aimDir);
      if (dot > 0.87) {
        hitAnyFire = true;
        fire.intensity = Math.max(0, fire.intensity - dt * 0.42);
        targetFireNameRu = fire.config.nameRu;
        remainingIntensity01 = fire.intensity;
        if (fire.intensity <= 0.001) {
          fire.intensity = 0;
          fire.steamTimer = 3.2;
          extinguishedFireId = fire.config.id;
        }
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
  }

  public update(
    dt: number,
    playerPos: THREE.Vector3,
    handAnchorPos: THREE.Vector3,
    aimDir: THREE.Vector3,
    isMuted: boolean
  ): { thermalHeatLoad01: number; smokeExposure01: number; extinguishedCount: number } {
    this.elapsedAnimSec += dt;

    // Позиционируем ручной ОУ-5 перед рукой / правым углом кадра
    if (this.handheldGroup.visible) {
      this.handheldGroup.position.copy(handAnchorPos);
      this.scratchVecB.copy(handAnchorPos).addScaledVector(aimDir, 2.0);
      this.handheldGroup.lookAt(this.scratchVecB);
      this.handheldGroup.rotateY(Math.PI); // т.к. раструб смотрит по -Z
    }

    // Обновление пула частиц CO₂
    let anySprayAlive = false;
    for (let i = 0; i < SPRAY_PARTICLE_COUNT; i++) {
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

    // Обновление очагов возгорания, дыма->пара, теплового поля и звука
    let thermalHeatLoad01 = 0;
    let smokeExposure01 = 0;
    let extinguishedCount = 0;
    let nearestActiveFireDist = 999;

    for (let i = 0; i < this.fires.length; i++) {
      const fire = this.fires[i];
      const dist = playerPos.distanceTo(fire.worldPos);

      if (fire.intensity <= 0) {
        extinguishedCount += 1;
        fire.light.intensity = 0;
        fire.floorRing.visible = false;
        fire.flameCones.forEach(c => {
          c.visible = false;
        });

        // Остаточный белый пар после тушения
        if (fire.steamTimer > 0) {
          fire.steamTimer = Math.max(0, fire.steamTimer - dt);
          const steamRatio = fire.steamTimer / 3.2;
          fire.smokePuffs.forEach((p, idx) => {
            p.visible = true;
            const mat = p.material as THREE.MeshStandardMaterial;
            mat.color.setHex(0xe2e8f0);
            mat.opacity = 0.28 * steamRatio;
            p.position.y = 0.9 + ((this.elapsedAnimSec * 1.1 + idx * 0.5) % 2.4);
          });
        } else {
          fire.smokePuffs.forEach(p => {
            p.visible = false;
          });
        }
        continue;
      }

      if (dist < nearestActiveFireDist) nearestActiveFireDist = dist;

      // Тепловая нагрузка внутри heatRadiusM
      if (dist < fire.config.heatRadiusM) {
        const ratio = (1 - dist / fire.config.heatRadiusM) * fire.intensity;
        if (ratio > thermalHeatLoad01) thermalHeatLoad01 = ratio;
      }
      // Задымление
      if (dist < fire.config.heatRadiusM * 1.45) {
        const sRatio = (1 - dist / (fire.config.heatRadiusM * 1.45)) * fire.config.smokeDensity * fire.intensity;
        if (sRatio > smokeExposure01) smokeExposure01 = sRatio;
      }

      // Анимация пламени и мерцания света
      const flicker = 0.85 + Math.sin(this.elapsedAnimSec * 17 + i * 2.1) * 0.15;
      fire.light.intensity = 4.5 * fire.intensity * flicker;
      fire.floorRing.visible = true;
      fire.flameCones.forEach(c => {
        c.visible = true;
        const ph = (c.userData.phase as number) || 0;
        const scaleY = Math.max(0.2, fire.intensity * (0.85 + Math.sin(this.elapsedAnimSec * 14 + ph) * 0.28));
        c.scale.set(0.6 + fire.intensity * 0.45, scaleY, 0.6 + fire.intensity * 0.45);
        c.position.y = 0.62 * scaleY;
      });

      // Анимация чёрного дыма (при низком огне светлеет в пар)
      const isSteamTransition = fire.intensity < 0.28;
      fire.smokePuffs.forEach(p => {
        p.visible = true;
        const ph = (p.userData.phase as number) || 0;
        const cycle = (this.elapsedAnimSec * 0.9 + ph) % 2.8;
        p.position.y = 1.0 + cycle;
        p.scale.setScalar(0.6 + cycle * 0.35);
        const mat = p.material as THREE.MeshStandardMaterial;
        mat.color.setHex(isSteamTransition ? 0xcbd5e1 : 0x1e293b);
        mat.opacity = Math.min(0.65, fire.config.smokeDensity * (0.35 + fire.intensity * 0.5) * (1 - cycle / 3.0));
      });
    }

    // Обновление WebAudio громкости
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
    return f ? f.intensity <= 0 : true;
  }

  public getTotalFires(): number {
    return this.fires.length;
  }

  public getExtinguishedCount(): number {
    return this.fires.filter(f => f.intensity <= 0).length;
  }

  public getNearestActiveFire(pos: THREE.Vector3): FireZoneRuntime | null {
    let best: FireZoneRuntime | null = null;
    let bestD = Infinity;
    for (const f of this.fires) {
      if (f.intensity <= 0) continue;
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

    this.rootGroup.traverse(obj => {
      if ((obj as THREE.Mesh).isMesh || (obj as THREE.Points).isPoints) {
        const mesh = obj as THREE.Mesh;
        mesh.geometry?.dispose();
        const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        mats.forEach(m => m?.dispose());
      }
    });
    this.rootGroup.parent?.remove(this.rootGroup);
  }
}
