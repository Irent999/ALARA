/**
 * ALARA — Механика триггерных зон и эвакуации персонала АЭС (NPC)
 * (src/mechanics/npcEvacuationSystem.ts)
 *
 * Реализует явный конечный автомат поведения NPC:
 *   IDLE -> PANIC -> WAITING_FOR_GUIDE -> EVACUATING -> SAFE
 *
 * Триггерные реакции:
 * - Приближение активного пожара/дыма переводит группу из IDLE в PANIC.
 * - Вход спасателя в радиус контакта переводит доступную группу в WAITING_FOR_GUIDE
 *   (или предупреждает, если путь перекрыт огнём).
 * - Подача команды [E] / ЛКМ / Курок переводит группу в EVACUATING по waypoint-узлам из .glb.
 * - Повторная проверка пути не даёт группе войти в активный огонь.
 * - Прибытие на выход/пункт сбора переводит NPC в SAFE со счётчиком спасённых.
 */

import * as THREE from 'three';
import type { NpcGroupSpec, TriggerZoneSpec } from '../npp/nppNodeConfig';
import type { NamedWorldMarker } from '../npp/nppSceneInspector';
import type { ExtinguisherSystem } from './extinguisherSystem';

export type NpcEvacState =
  | 'IDLE'
  | 'PANIC'
  | 'WAITING_FOR_GUIDE'
  | 'EVACUATING'
  | 'SAFE';

export interface NpcGroupRuntime {
  readonly config: NpcGroupSpec;
  readonly rootGroup: THREE.Group;
  readonly startPos: THREE.Vector3;
  readonly currentPos: THREE.Vector3;
  readonly waypoints: THREE.Vector3[];
  readonly exitPos: THREE.Vector3;
  waypointIndex: number;
  state: NpcEvacState;
  readonly statusBeaconMesh: THREE.Mesh;
  readonly statusBeaconMat: THREE.MeshBasicMaterial;
  readonly personMeshes: THREE.Group[];
}

export interface TriggerZoneRuntime {
  readonly id: string;
  readonly kind: TriggerZoneSpec['kind'];
  readonly nameRu: string;
  readonly worldPos: THREE.Vector3;
  readonly radiusM: number;
  isPlayerInside: boolean;
}

const STATE_BEACON_COLORS: Readonly<Record<NpcEvacState, number>> = {
  IDLE: 0x94a3b8,
  PANIC: 0xef4444,
  WAITING_FOR_GUIDE: 0xfacc15,
  EVACUATING: 0x38bdf8,
  SAFE: 0x22c55e
};

export class NpcEvacuationSystem {
  public readonly rootGroup = new THREE.Group();
  public readonly npcGroups: NpcGroupRuntime[] = [];
  public readonly triggerZones: TriggerZoneRuntime[] = [];

  private readonly entrancePos = new THREE.Vector3();
  private readonly assemblyPos = new THREE.Vector3();
  private readonly exitPositions: THREE.Vector3[] = [];

  // Переиспользуемый 3D-маяк текущей цели миссии
  private readonly activeTargetHalo: THREE.Group;
  private readonly activeTargetRingMat: THREE.MeshBasicMaterial;

  // Инстанцированные направляющие стрелки маршрута эвакуации (Zero-Allocation)
  private readonly arrowInstanced: THREE.InstancedMesh;
  private readonly arrowCount = 14;
  private readonly guidePathPoints: THREE.Vector3[] = [];
  private readonly scratchMatrix = new THREE.Matrix4();
  private readonly scratchVecA = new THREE.Vector3();
  private readonly scratchVecB = new THREE.Vector3();
  private readonly scratchQuat = new THREE.Quaternion();
  private readonly scratchScale = new THREE.Vector3(1, 1, 1);
  private readonly upAxis = new THREE.Vector3(0, 1, 0);

  private readonly markerScale: number;
  private animClockSec = 0;

  constructor(params: {
    npcSpecs: ReadonlyArray<NpcGroupSpec>;
    discoveredNpcs: ReadonlyArray<NamedWorldMarker>;
    discoveredWaypoints: ReadonlyArray<NamedWorldMarker>;
    triggerSpecs: ReadonlyArray<TriggerZoneSpec>;
    discoveredTriggers: ReadonlyArray<NamedWorldMarker>;
    entrancePos: THREE.Vector3;
    exits: ReadonlyArray<NamedWorldMarker>;
    assemblyPos: THREE.Vector3;
    markerScale?: number;
  }) {
    this.rootGroup.name = 'npp_npc_evacuation_system';
    this.markerScale = Math.max(0.35, Math.min(2.0, params.markerScale ?? 0.78));
    this.entrancePos.copy(params.entrancePos);
    this.assemblyPos.copy(params.assemblyPos);
    params.exits.forEach(e => this.exitPositions.push(e.pos.clone()));

    this.buildEntranceAndExitSigns(params.exits);
    this.buildTriggerZones(params.triggerSpecs, params.discoveredTriggers);
    this.buildNpcGroups(params.npcSpecs, params.discoveredNpcs, params.discoveredWaypoints);

    const ms = this.markerScale;
    this.activeTargetHalo = new THREE.Group();
    this.activeTargetRingMat = new THREE.MeshBasicMaterial({
      color: 0x38bdf8,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.78
    });
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.65 * ms, 0.82 * ms, 32),
      this.activeTargetRingMat
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.035;
    const pillar = new THREE.Mesh(
      new THREE.CylinderGeometry(0.04 * ms, 0.04 * ms, 1.8 * ms, 10),
      new THREE.MeshBasicMaterial({ color: 0x38bdf8, transparent: true, opacity: 0.35 })
    );
    pillar.position.y = 0.9 * ms;
    this.activeTargetHalo.add(ring, pillar);
    this.activeTargetHalo.visible = false;
    this.rootGroup.add(this.activeTargetHalo);

    const arrowGeo = new THREE.ConeGeometry(0.2 * ms, 0.48 * ms, 3);
    arrowGeo.rotateX(Math.PI / 2);
    const arrowMat = new THREE.MeshBasicMaterial({
      color: 0x22c55e,
      transparent: true,
      opacity: 0.72
    });
    this.arrowInstanced = new THREE.InstancedMesh(arrowGeo, arrowMat, this.arrowCount);
    this.arrowInstanced.frustumCulled = false;
    this.arrowInstanced.visible = false;
    this.rootGroup.add(this.arrowInstanced);
  }

  private createSignTexture(
    title: string,
    subtitle: string,
    bgHex: string,
    borderHex: string
  ): THREE.CanvasTexture {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 192;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = bgHex;
    ctx.fillRect(0, 0, 512, 192);
    ctx.strokeStyle = borderHex;
    ctx.lineWidth = 8;
    ctx.strokeRect(6, 6, 500, 180);
    ctx.fillStyle = borderHex;
    ctx.font = 'bold 42px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(title, 256, 84);
    ctx.fillStyle = '#f8fafc';
    ctx.font = 'bold 26px monospace';
    ctx.fillText(subtitle, 256, 138);

    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  private createDoubleSidedSignBoard(
    width: number,
    height: number,
    tex: THREE.CanvasTexture
  ): THREE.Group {
    const board = new THREE.Group();
    const frame = new THREE.Mesh(
      new THREE.BoxGeometry(width + 0.05, height + 0.05, 0.03),
      new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.7 })
    );
    board.add(frame);

    const faceMat = new THREE.MeshBasicMaterial({ map: tex, side: THREE.FrontSide });
    const front = new THREE.Mesh(new THREE.PlaneGeometry(width, height), faceMat);
    front.position.z = 0.018;
    const back = new THREE.Mesh(new THREE.PlaneGeometry(width, height), faceMat);
    back.position.z = -0.018;
    back.rotation.y = Math.PI;
    board.add(front, back);
    return board;
  }

  private buildEntranceAndExitSigns(exits: ReadonlyArray<NamedWorldMarker>): void {
    const ms = this.markerScale;
    const entGroup = new THREE.Group();
    entGroup.position.copy(this.entrancePos);

    const entRing = new THREE.Mesh(
      new THREE.RingGeometry(0.95 * ms, 1.15 * ms, 32),
      new THREE.MeshBasicMaterial({
        color: 0x0ea5e9,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.72
      })
    );
    entRing.rotation.x = -Math.PI / 2;
    entRing.position.y = 0.025;
    entGroup.add(entRing);

    const entTex = this.createSignTexture('ВХОД МЧС', 'ОПАСНАЯ ЗОНА АЭС', '#082f49', '#38bdf8');
    const entSign = this.createDoubleSidedSignBoard(2.1 * ms, 0.78 * ms, entTex);
    entSign.position.set(0, 2.75 * ms, 0);
    const entPole = new THREE.Mesh(
      new THREE.CylinderGeometry(0.04 * ms, 0.045 * ms, 2.35 * ms, 8),
      new THREE.MeshStandardMaterial({ color: 0x334155 })
    );
    entPole.position.set(0, 1.18 * ms, 0);
    entGroup.add(entPole, entSign);
    this.rootGroup.add(entGroup);

    const exitTex = this.createSignTexture(
      'ВЫХОД / ЭВАКУАЦИЯ',
      'БЕЗОПАСНАЯ ЗОНА →',
      '#052e16',
      '#22c55e'
    );

    exits.forEach(ex => {
      const g = new THREE.Group();
      g.position.copy(ex.pos);

      const sign = this.createDoubleSidedSignBoard(1.95 * ms, 0.72 * ms, exitTex);
      sign.position.set(0, 2.55 * ms, 0);
      const pole = new THREE.Mesh(
        new THREE.CylinderGeometry(0.04 * ms, 0.045 * ms, 2.2 * ms, 8),
        new THREE.MeshStandardMaterial({ color: 0x334155 })
      );
      pole.position.set(0, 1.1 * ms, 0);
      g.add(pole, sign);

      const portalGlow = new THREE.Mesh(
        new THREE.RingGeometry(0.85 * ms, 1.05 * ms, 28),
        new THREE.MeshBasicMaterial({
          color: 0x22c55e,
          side: THREE.DoubleSide,
          transparent: true,
          opacity: 0.75
        })
      );
      portalGlow.rotation.x = -Math.PI / 2;
      portalGlow.position.y = 0.025;
      g.add(portalGlow);

      const exitLight = new THREE.PointLight(0x22c55e, 1.4, 6.5 * ms);
      exitLight.position.set(0, 2.2 * ms, 0);
      g.add(exitLight);

      this.rootGroup.add(g);
    });

    const asmGroup = new THREE.Group();
    asmGroup.position.copy(this.assemblyPos);

    const asmRing = new THREE.Mesh(
      new THREE.RingGeometry(1.7 * ms, 1.98 * ms, 36),
      new THREE.MeshBasicMaterial({
        color: 0x10b981,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.65
      })
    );
    asmRing.rotation.x = -Math.PI / 2;
    asmRing.position.y = 0.025;
    asmGroup.add(asmRing);

    const asmTex = this.createSignTexture(
      'ПУНКТ СБОРА МЧС',
      'ЧИСТАЯ ЗОНА ЭВАКУАЦИИ',
      '#022c22',
      '#34d399'
    );
    const asmSign = this.createDoubleSidedSignBoard(2.3 * ms, 0.82 * ms, asmTex);
    asmSign.position.set(0, 2.55 * ms, 0);
    const pole = new THREE.Mesh(
      new THREE.CylinderGeometry(0.045 * ms, 0.05 * ms, 2.15 * ms, 8),
      new THREE.MeshStandardMaterial({ color: 0x475569 })
    );
    pole.position.set(0, 1.08 * ms, 0);
    asmGroup.add(pole, asmSign);
    this.rootGroup.add(asmGroup);
  }

  private buildTriggerZones(
    triggerSpecs: ReadonlyArray<TriggerZoneSpec>,
    discoveredTriggers: ReadonlyArray<NamedWorldMarker>
  ): void {
    triggerSpecs.forEach(spec => {
      const matched = discoveredTriggers.find(d =>
        d.name.toUpperCase().startsWith(spec.markerName.toUpperCase())
      );
      this.triggerZones.push({
        id: spec.id,
        kind: spec.kind,
        nameRu: spec.nameRu,
        worldPos: matched
          ? matched.pos.clone()
          : new THREE.Vector3(spec.defaultPos[0], spec.defaultPos[1], spec.defaultPos[2]),
        radiusM: spec.radiusM,
        isPlayerInside: false
      });
    });
  }

  private createStylizedWorkerMesh(suitColorHex: number, helmetColorHex: number): THREE.Group {
    const person = new THREE.Group();
    const suitMat = new THREE.MeshStandardMaterial({ color: suitColorHex, roughness: 0.7 });
    const helmetMat = new THREE.MeshStandardMaterial({ color: helmetColorHex, roughness: 0.35 });
    const darkMat = new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.8 });

    const legGeo = new THREE.CylinderGeometry(0.08, 0.07, 0.78, 8);
    const legL = new THREE.Mesh(legGeo, darkMat);
    legL.position.set(-0.11, 0.39, 0);
    const legR = new THREE.Mesh(legGeo, darkMat);
    legR.position.set(0.11, 0.39, 0);
    person.add(legL, legR);

    const torso = new THREE.Mesh(new THREE.CylinderGeometry(0.19, 0.16, 0.62, 10), suitMat);
    torso.position.y = 1.08;
    torso.castShadow = true;
    person.add(torso);

    const vestStripe = new THREE.Mesh(
      new THREE.CylinderGeometry(0.198, 0.192, 0.1, 10),
      new THREE.MeshBasicMaterial({ color: 0xfacc15 })
    );
    vestStripe.position.y = 1.1;
    person.add(vestStripe);

    const armGeo = new THREE.CylinderGeometry(0.055, 0.05, 0.54, 8);
    const armL = new THREE.Mesh(armGeo, suitMat);
    armL.position.set(-0.25, 1.08, 0);
    armL.rotation.z = 0.14;
    const armR = new THREE.Mesh(armGeo, suitMat);
    armR.position.set(0.25, 1.08, 0);
    armR.rotation.z = -0.14;
    person.add(armL, armR);

    const head = new THREE.Mesh(
      new THREE.SphereGeometry(0.125, 10, 10),
      new THREE.MeshStandardMaterial({ color: 0xe2c7b3, roughness: 0.65 })
    );
    head.position.y = 1.52;
    person.add(head);

    const helmet = new THREE.Mesh(
      new THREE.SphereGeometry(0.145, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.58),
      helmetMat
    );
    helmet.position.y = 1.55;
    person.add(helmet);

    return person;
  }

  private buildNpcGroups(
    npcSpecs: ReadonlyArray<NpcGroupSpec>,
    discoveredNpcs: ReadonlyArray<NamedWorldMarker>,
    discoveredWaypoints: ReadonlyArray<NamedWorldMarker>
  ): void {
    npcSpecs.forEach((cfg, idx) => {
      const matched =
        discoveredNpcs.find(d => d.name.toUpperCase().startsWith(cfg.markerName.toUpperCase())) ??
        discoveredNpcs[idx];
      const startPos = matched
        ? matched.pos.clone()
        : new THREE.Vector3(cfg.defaultPos[0], cfg.defaultPos[1], cfg.defaultPos[2]);

      const groupRoot = new THREE.Group();
      groupRoot.position.copy(startPos);
      groupRoot.name = `npc_group_${cfg.id}`;

      const personMeshes: THREE.Group[] = [];
      for (let p = 0; p < cfg.count; p++) {
        const person = this.createStylizedWorkerMesh(
          idx === 0 ? 0x2563eb : 0x0d9488,
          p === 0 ? 0xf8fafc : 0xf59e0b
        );
        person.position.set((p - (cfg.count - 1) * 0.5) * 0.72, 0, (p % 2) * 0.25);
        groupRoot.add(person);
        personMeshes.push(person);
      }

      const statusBeaconMat = new THREE.MeshBasicMaterial({ color: STATE_BEACON_COLORS.IDLE });
      const statusBeaconMesh = new THREE.Mesh(
        new THREE.OctahedronGeometry(0.17, 0),
        statusBeaconMat
      );
      statusBeaconMesh.position.set(0, 2.1, 0);
      groupRoot.add(statusBeaconMesh);

      // Если в .glb или инспекторе есть WAYPOINT_G1_* / WAYPOINT_G2_* — используем их, иначе fallback
      const matchedWaypoints = discoveredWaypoints.filter(w =>
        w.name.toUpperCase().startsWith(cfg.waypointPrefix.toUpperCase())
      );
      const waypoints =
        matchedWaypoints.length > 0
          ? matchedWaypoints.map(w => w.pos.clone())
          : cfg.evacWaypoints.map(w => new THREE.Vector3(w[0], startPos.y, w[2]));

      const exitPos = (this.exitPositions[0] ?? this.assemblyPos).clone();

      this.rootGroup.add(groupRoot);
      this.npcGroups.push({
        config: cfg,
        rootGroup: groupRoot,
        startPos,
        currentPos: startPos.clone(),
        waypoints,
        exitPos,
        waypointIndex: 0,
        state: 'IDLE',
        statusBeaconMesh,
        statusBeaconMat,
        personMeshes
      });
    });
  }

  private setGroupState(grp: NpcGroupRuntime, next: NpcEvacState): void {
    grp.state = next;
    grp.statusBeaconMat.color.setHex(STATE_BEACON_COLORS[next]);
  }

  /**
   * Команда начала эвакуации ближайшей группе персонала ([E] / ЛКМ / курок HTC Vive).
   */
  public tryCommandNearestGroup(
    playerPos: THREE.Vector3,
    fireMgr: ExtinguisherSystem
  ): {
    found: boolean;
    groupNameRu?: string;
    startedEvac?: boolean;
    blockedByFireNameRu?: string;
  } {
    let best: NpcGroupRuntime | null = null;
    let bestD = 5.6;
    for (const grp of this.npcGroups) {
      if (grp.state === 'SAFE' || grp.state === 'EVACUATING') continue;
      const d = playerPos.distanceTo(grp.currentPos);
      if (d < bestD) {
        bestD = d;
        best = grp;
      }
    }
    if (!best) return { found: false };

    const blockingFire = fireMgr.getFireById(best.config.blockedByFireId);
    if (blockingFire && blockingFire.intensity > 0) {
      this.setGroupState(best, 'PANIC');
      return {
        found: true,
        groupNameRu: best.config.nameRu,
        startedEvac: false,
        blockedByFireNameRu: blockingFire.config.nameRu
      };
    }

    this.setGroupState(best, 'EVACUATING');
    return {
      found: true,
      groupNameRu: best.config.nameRu,
      startedEvac: true
    };
  }

  public setTargetHighlight(pos: THREE.Vector3 | null, colorHex = 0x38bdf8): void {
    if (!pos) {
      this.activeTargetHalo.visible = false;
      return;
    }
    this.activeTargetHalo.visible = true;
    this.activeTargetHalo.position.set(pos.x, pos.y, pos.z);
    this.activeTargetRingMat.color.setHex(colorHex);
  }

  public updateGuidePath(fromPos: THREE.Vector3 | null, viaPoints: THREE.Vector3[] = []): void {
    this.guidePathPoints.length = 0;
    if (!fromPos) {
      this.arrowInstanced.visible = false;
      return;
    }
    this.guidePathPoints.push(fromPos);
    viaPoints.forEach(p => this.guidePathPoints.push(p));

    if (this.guidePathPoints.length < 2) {
      this.arrowInstanced.visible = false;
      return;
    }
    this.arrowInstanced.visible = true;

    let arrowIdx = 0;
    const shift = (this.animClockSec * 0.85) % 1;
    for (let seg = 0; seg < this.guidePathPoints.length - 1 && arrowIdx < this.arrowCount; seg++) {
      const p0 = this.guidePathPoints[seg];
      const p1 = this.guidePathPoints[seg + 1];
      const segLen = p0.distanceTo(p1);
      const steps = Math.max(1, Math.min(4, Math.floor(segLen / 2.2)));
      this.scratchVecB.subVectors(p1, p0).normalize();
      const yaw = Math.atan2(this.scratchVecB.x, this.scratchVecB.z);
      this.scratchQuat.setFromAxisAngle(this.upAxis, yaw);

      for (let k = 0; k < steps && arrowIdx < this.arrowCount; k++) {
        const t = Math.min(0.95, (k + shift) / steps);
        this.scratchVecA.lerpVectors(p0, p1, t);
        this.scratchVecA.y = Math.max(this.assemblyPos.y, this.scratchVecA.y) + 0.06;
        this.scratchMatrix.compose(this.scratchVecA, this.scratchQuat, this.scratchScale);
        this.arrowInstanced.setMatrixAt(arrowIdx, this.scratchMatrix);
        arrowIdx += 1;
      }
    }
    for (let rest = arrowIdx; rest < this.arrowCount; rest++) {
      this.scratchVecA.set(0, -50, 0);
      this.scratchMatrix.compose(this.scratchVecA, this.scratchQuat, this.scratchScale);
      this.arrowInstanced.setMatrixAt(rest, this.scratchMatrix);
    }
    this.arrowInstanced.instanceMatrix.needsUpdate = true;
  }

  /**
   * Обновление триггерных зон, состояний NPC (IDLE -> PANIC -> WAITING_FOR_GUIDE -> EVACUATING -> SAFE)
   * и движения по waypoint-маршруту к безопасному выходу.
   */
  public update(
    dt: number,
    playerPos: THREE.Vector3,
    fireMgr: ExtinguisherSystem
  ): {
    rescuedCount: number;
    totalNpcCount: number;
    justEvacuatedGroupNameRu: string | null;
    blockedGroupWarningRu: string | null;
    activeTriggerNameRu: string | null;
  } {
    this.animClockSec += dt;

    if (this.activeTargetHalo.visible) {
      this.activeTargetHalo.rotation.y += dt * 1.4;
    }

    // 1. Обновляем триггерные зоны по позиции спасателя
    let activeTriggerNameRu: string | null = null;
    for (let t = 0; t < this.triggerZones.length; t++) {
      const tz = this.triggerZones[t];
      const distSq =
        (playerPos.x - tz.worldPos.x) * (playerPos.x - tz.worldPos.x) +
        (playerPos.z - tz.worldPos.z) * (playerPos.z - tz.worldPos.z);
      tz.isPlayerInside = distSq <= tz.radiusM * tz.radiusM;
      if (tz.isPlayerInside) {
        activeTriggerNameRu = tz.nameRu;
      }
    }

    let rescuedCount = 0;
    let totalNpcCount = 0;
    let justEvacuatedGroupNameRu: string | null = null;
    let blockedGroupWarningRu: string | null = null;

    for (let i = 0; i < this.npcGroups.length; i++) {
      const grp = this.npcGroups[i];
      totalNpcCount += grp.config.count;
      grp.statusBeaconMesh.rotation.y += dt * 2.2;

      if (grp.state === 'SAFE') {
        rescuedCount += grp.config.count;
        continue;
      }

      const nearestFire = fireMgr.getNearestActiveFire(grp.currentPos);
      const fireNearby = Boolean(
        nearestFire && nearestFire.worldPos.distanceTo(grp.currentPos) <= grp.config.firePanicRadiusM
      );
      const blockingFire = fireMgr.getFireById(grp.config.blockedByFireId);
      const isRouteBlocked = Boolean(blockingFire && blockingFire.intensity > 0);
      const playerClose = playerPos.distanceTo(grp.currentPos) <= grp.config.detectionRadiusM;

      if (grp.state === 'IDLE') {
        if (fireNearby) {
          this.setGroupState(grp, 'PANIC');
        } else if (playerClose && !isRouteBlocked) {
          this.setGroupState(grp, 'WAITING_FOR_GUIDE');
        }
      } else if (grp.state === 'PANIC') {
        // Как только очаг у маршрута потушен, группа готова к сопровождению (WAITING_FOR_GUIDE)
        if (!isRouteBlocked) {
          this.setGroupState(grp, 'WAITING_FOR_GUIDE');
        }
        grp.personMeshes.forEach((p, idx) => {
          p.position.y = Math.abs(Math.sin(this.animClockSec * 5.2 + idx * 1.1)) * 0.06;
        });
        continue;
      } else if (grp.state === 'WAITING_FOR_GUIDE') {
        if (isRouteBlocked) {
          this.setGroupState(grp, 'PANIC');
        } else {
          grp.personMeshes.forEach((p, idx) => {
            p.position.y = Math.abs(Math.sin(this.animClockSec * 2.5 + idx)) * 0.035;
          });
        }
        continue;
      }

      if (grp.state === 'EVACUATING') {
        const target =
          grp.waypointIndex < grp.waypoints.length
            ? grp.waypoints[grp.waypointIndex]
            : grp.waypointIndex === grp.waypoints.length
            ? grp.exitPos
            : this.assemblyPos;

        // Проверка безопасности коридора от активного пожара
        if (nearestFire && nearestFire.worldPos.distanceTo(grp.currentPos) < 3.4) {
          this.setGroupState(grp, 'PANIC');
          blockedGroupWarningRu = `${grp.config.nameRu} остановилась перед активным огнём (${nearestFire.config.nameRu})!`;
          continue;
        }

        this.scratchVecA.subVectors(target, grp.currentPos);
        this.scratchVecA.y = 0;
        const dist = this.scratchVecA.length();

        if (dist < 0.55) {
          if (grp.waypointIndex <= grp.waypoints.length) {
            grp.waypointIndex += 1;
          } else {
            this.setGroupState(grp, 'SAFE');
            const offset = i === 0 ? -1.4 : 1.4;
            grp.currentPos.set(
              this.assemblyPos.x + offset,
              this.assemblyPos.y,
              this.assemblyPos.z + 0.6
            );
            grp.rootGroup.position.copy(grp.currentPos);
            rescuedCount += grp.config.count;
            justEvacuatedGroupNameRu = grp.config.nameRu;
          }
        } else {
          this.scratchVecA.divideScalar(dist);
          const step = Math.min(dist, 2.4 * dt);
          grp.currentPos.addScaledVector(this.scratchVecA, step);
          grp.currentPos.y = THREE.MathUtils.lerp(grp.currentPos.y, target.y, Math.min(1, dt * 6));
          grp.rootGroup.position.copy(grp.currentPos);
          grp.rootGroup.lookAt(target.x, grp.currentPos.y, target.z);
          grp.personMeshes.forEach((p, idx) => {
            p.position.y = Math.abs(Math.sin(this.animClockSec * 8 + idx * 1.4)) * 0.055;
          });
        }
      }
    }

    return {
      rescuedCount,
      totalNpcCount,
      justEvacuatedGroupNameRu,
      blockedGroupWarningRu,
      activeTriggerNameRu
    };
  }

  public getNearestPendingNpcGroup(pos: THREE.Vector3): NpcGroupRuntime | null {
    let best: NpcGroupRuntime | null = null;
    let bestD = Infinity;
    for (const grp of this.npcGroups) {
      if (grp.state === 'SAFE' || grp.state === 'EVACUATING') continue;
      const d = pos.distanceTo(grp.currentPos);
      if (d < bestD) {
        bestD = d;
        best = grp;
      }
    }
    return best;
  }

  public dispose(): void {
    this.rootGroup.traverse(obj => {
      if ((obj as THREE.Mesh).isMesh || (obj as THREE.InstancedMesh).isInstancedMesh) {
        const mesh = obj as THREE.Mesh;
        mesh.geometry?.dispose();
        const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        mats.forEach(m => {
          if (m) {
            const std = m as THREE.MeshStandardMaterial;
            std.map?.dispose();
            m.dispose();
          }
        });
      }
    });
    this.rootGroup.parent?.remove(this.rootGroup);
  }
}
