/**
 * Менеджер навигации и эвакуации персонала АЭС для Сценария №4
 * - Синие/голубые маркеры входа МЧС (ENTRANCE_*)
 * - Зелёные световые порталы и табло «ВЫХОД / ЭВАКУАЦИЯ» (EXIT_*) + точка сбора (ASSEMBLY)
 * - Динамический анимированный 3D-маршрут по полу к выходу
 * - Подсветка активного целевого объекта строго для текущего шага FSM
 * - Стилизованные 3D-группы персонала (TRAPPED / BLOCKED_BY_FIRE / FOLLOWING / EVACUATED)
 */

import * as THREE from 'three';
import type { NpcGroupConfig, NpcGroupStatus } from './config';
import type { FireAndExtinguisherManager } from './fireAndExtinguisher';

export interface NpcGroupRuntime {
  readonly config: NpcGroupConfig;
  readonly rootGroup: THREE.Group;
  readonly startPos: THREE.Vector3;
  readonly currentPos: THREE.Vector3;
  readonly waypoints: THREE.Vector3[];
  readonly exitPos: THREE.Vector3;
  waypointIndex: number;
  status: NpcGroupStatus;
  readonly statusBeaconMat: THREE.MeshBasicMaterial;
  readonly personMeshes: THREE.Group[];
}

export class Scenario4EvacuationManager {
  public readonly rootGroup = new THREE.Group();
  public readonly npcGroups: NpcGroupRuntime[] = [];

  private readonly entrancePos = new THREE.Vector3();
  private readonly assemblyPos = new THREE.Vector3();
  private readonly exitPositions: THREE.Vector3[] = [];

  // Подсветка цели текущего шага (один переиспользуемый маяк)
  private readonly activeTargetHalo: THREE.Group;
  private readonly activeTargetRingMat: THREE.MeshBasicMaterial;

  // Динамическая направляющая линия / стрелки по полу
  private readonly arrowInstanced: THREE.InstancedMesh;
  private readonly arrowCount = 14;
  private readonly guidePathPoints: THREE.Vector3[] = [];
  private readonly scratchMatrix = new THREE.Matrix4();
  private readonly scratchVecA = new THREE.Vector3();
  private readonly scratchVecB = new THREE.Vector3();
  private readonly scratchQuat = new THREE.Quaternion();
  private readonly scratchScale = new THREE.Vector3(1, 1, 1);
  private readonly upAxis = new THREE.Vector3(0, 1, 0);

  private animClockSec = 0;

  constructor(
    npcConfigs: ReadonlyArray<NpcGroupConfig>,
    discoveredNpcs: ReadonlyArray<{ name: string; pos: THREE.Vector3 }>,
    entrancePos: THREE.Vector3,
    exits: ReadonlyArray<{ name: string; pos: THREE.Vector3 }>,
    assemblyPos: THREE.Vector3
  ) {
    this.rootGroup.name = 'scenario4_evacuation_system';
    this.entrancePos.copy(entrancePos);
    this.assemblyPos.copy(assemblyPos);
    exits.forEach(e => this.exitPositions.push(e.pos.clone()));

    this.buildEntranceAndExitSigns(exits);
    this.buildNpcGroups(npcConfigs, discoveredNpcs);

    // Маяк текущей цели шага
    this.activeTargetHalo = new THREE.Group();
    this.activeTargetRingMat = new THREE.MeshBasicMaterial({
      color: 0x38bdf8,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.78
    });
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.75, 0.92, 32), this.activeTargetRingMat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.04;
    const pillar = new THREE.Mesh(
      new THREE.CylinderGeometry(0.05, 0.05, 2.2, 10),
      new THREE.MeshBasicMaterial({ color: 0x38bdf8, transparent: true, opacity: 0.35 })
    );
    pillar.position.y = 1.1;
    this.activeTargetHalo.add(ring, pillar);
    this.activeTargetHalo.visible = false;
    this.rootGroup.add(this.activeTargetHalo);

    // Инстанцированные стрелки-шевроны на полу для динамического пути эвакуации
    const arrowGeo = new THREE.ConeGeometry(0.24, 0.55, 3);
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

  private createSignTexture(title: string, subtitle: string, bgHex: string, borderHex: string): THREE.CanvasTexture {
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

  private buildEntranceAndExitSigns(exits: ReadonlyArray<{ name: string; pos: THREE.Vector3 }>): void {
    // 1. Вход в здание (синий/голубой маркер МЧС)
    const entGroup = new THREE.Group();
    entGroup.position.copy(this.entrancePos);

    const entRing = new THREE.Mesh(
      new THREE.RingGeometry(1.1, 1.32, 32),
      new THREE.MeshBasicMaterial({ color: 0x0ea5e9, side: THREE.DoubleSide, transparent: true, opacity: 0.72 })
    );
    entRing.rotation.x = -Math.PI / 2;
    entRing.position.y = 0.03;
    entGroup.add(entRing);

    const entTex = this.createSignTexture('ВХОД МЧС', 'ОПАСНАЯ ЗОНА АЭС', '#082f49', '#38bdf8');
    const entSign = new THREE.Mesh(
      new THREE.PlaneGeometry(2.6, 0.95),
      new THREE.MeshBasicMaterial({ map: entTex, side: THREE.DoubleSide })
    );
    entSign.position.set(0, 3.85, 0.25);
    entGroup.add(entSign);
    this.rootGroup.add(entGroup);

    // 2. Безопасные выходы («ВЫХОД / ЭВАКУАЦИЯ»)
    const exitTex = this.createSignTexture('ВЫХОД / ЭВАКУАЦИЯ', 'БЕЗОПАСНАЯ ЗОНА →', '#052e16', '#22c55e');
    const exitSignMat = new THREE.MeshBasicMaterial({ map: exitTex, side: THREE.DoubleSide });

    exits.forEach(ex => {
      const g = new THREE.Group();
      g.position.copy(ex.pos);

      const sign = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 0.8), exitSignMat);
      sign.position.set(0, 3.2, 0);
      g.add(sign);

      const portalGlow = new THREE.Mesh(
        new THREE.RingGeometry(0.95, 1.15, 28),
        new THREE.MeshBasicMaterial({ color: 0x22c55e, side: THREE.DoubleSide, transparent: true, opacity: 0.75 })
      );
      portalGlow.rotation.x = -Math.PI / 2;
      portalGlow.position.y = 0.03;
      g.add(portalGlow);

      const exitLight = new THREE.PointLight(0x22c55e, 1.6, 7.5);
      exitLight.position.set(0, 2.6, 0);
      g.add(exitLight);

      this.rootGroup.add(g);
    });

    // 3. Внешняя точка сбора эвакуированных
    const asmGroup = new THREE.Group();
    asmGroup.position.copy(this.assemblyPos);

    const asmRing = new THREE.Mesh(
      new THREE.RingGeometry(2.1, 2.4, 36),
      new THREE.MeshBasicMaterial({ color: 0x10b981, side: THREE.DoubleSide, transparent: true, opacity: 0.65 })
    );
    asmRing.rotation.x = -Math.PI / 2;
    asmRing.position.y = 0.025;
    asmGroup.add(asmRing);

    const asmTex = this.createSignTexture('ПУНКТ СБОРА МЧС', 'ЧИСТАЯ ЗОНА ЭВАКУАЦИИ', '#022c22', '#34d399');
    const asmSign = new THREE.Mesh(
      new THREE.PlaneGeometry(2.9, 1.0),
      new THREE.MeshBasicMaterial({ map: asmTex, side: THREE.DoubleSide })
    );
    asmSign.position.set(0, 2.7, 0);
    const pole = new THREE.Mesh(
      new THREE.CylinderGeometry(0.06, 0.06, 2.4, 8),
      new THREE.MeshStandardMaterial({ color: 0x475569 })
    );
    pole.position.set(0, 1.2, 0);
    asmGroup.add(pole, asmSign);
    this.rootGroup.add(asmGroup);
  }

  private createStylizedWorkerMesh(suitColorHex: number, helmetColorHex: number): THREE.Group {
    const person = new THREE.Group();
    const suitMat = new THREE.MeshStandardMaterial({ color: suitColorHex, roughness: 0.7 });
    const helmetMat = new THREE.MeshStandardMaterial({ color: helmetColorHex, roughness: 0.35 });
    const darkMat = new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.8 });

    // Ноги
    const legGeo = new THREE.CylinderGeometry(0.08, 0.07, 0.78, 8);
    const legL = new THREE.Mesh(legGeo, darkMat);
    legL.position.set(-0.11, 0.39, 0);
    const legR = new THREE.Mesh(legGeo, darkMat);
    legR.position.set(0.11, 0.39, 0);
    person.add(legL, legR);

    // Торс в защитном комбинезоне АЭС со светоотражающей полосой
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

    // Руки
    const armGeo = new THREE.CylinderGeometry(0.055, 0.05, 0.54, 8);
    const armL = new THREE.Mesh(armGeo, suitMat);
    armL.position.set(-0.25, 1.08, 0);
    armL.rotation.z = 0.14;
    const armR = new THREE.Mesh(armGeo, suitMat);
    armR.position.set(0.25, 1.08, 0);
    armR.rotation.z = -0.14;
    person.add(armL, armR);

    // Голова и строительная каска
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
    npcConfigs: ReadonlyArray<NpcGroupConfig>,
    discoveredNpcs: ReadonlyArray<{ name: string; pos: THREE.Vector3 }>
  ): void {
    npcConfigs.forEach((cfg, idx) => {
      const matched = discoveredNpcs.find(d => d.name.toUpperCase().startsWith(cfg.markerName));
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

      const statusBeaconMat = new THREE.MeshBasicMaterial({ color: 0xf59e0b });
      const beacon = new THREE.Mesh(new THREE.OctahedronGeometry(0.16, 0), statusBeaconMat);
      beacon.position.set(0, 2.08, 0);
      groupRoot.add(beacon);

      const waypoints = cfg.evacWaypoints.map(w => new THREE.Vector3(w[0], w[1], w[2]));
      const exitPos = new THREE.Vector3(cfg.exitPoint[0], cfg.exitPoint[1], cfg.exitPoint[2]);

      this.rootGroup.add(groupRoot);
      this.npcGroups.push({
        config: cfg,
        rootGroup: groupRoot,
        startPos,
        currentPos: startPos.clone(),
        waypoints,
        exitPos,
        waypointIndex: 0,
        status: 'TRAPPED',
        statusBeaconMat,
        personMeshes
      });
    });
  }

  /**
   * Попытка подать команду эвакуации ближайшей группе персонала
   */
  public tryCommandNearestGroup(
    playerPos: THREE.Vector3,
    fireMgr: FireAndExtinguisherManager
  ): {
    found: boolean;
    groupNameRu?: string;
    startedEvac?: boolean;
    blockedByFireNameRu?: string;
  } {
    let best: NpcGroupRuntime | null = null;
    let bestD = 5.2;
    for (const grp of this.npcGroups) {
      if (grp.status === 'EVACUATED' || grp.status === 'FOLLOWING') continue;
      const d = playerPos.distanceTo(grp.currentPos);
      if (d < bestD) {
        bestD = d;
        best = grp;
      }
    }
    if (!best) return { found: false };

    const blockingFire = fireMgr.getFireById(best.config.blockedByFireId);
    if (blockingFire && blockingFire.intensity > 0) {
      best.status = 'BLOCKED_BY_FIRE';
      best.statusBeaconMat.color.setHex(0xef4444);
      return {
        found: true,
        groupNameRu: best.config.nameRu,
        startedEvac: false,
        blockedByFireNameRu: blockingFire.config.nameRu
      };
    }

    best.status = 'FOLLOWING';
    best.statusBeaconMat.color.setHex(0x38bdf8);
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
        this.scratchVecA.y = 0.06;
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

  public update(dt: number, fireMgr: FireAndExtinguisherManager): {
    rescuedCount: number;
    totalNpcCount: number;
    justEvacuatedGroupNameRu: string | null;
    blockedGroupWarningRu: string | null;
  } {
    this.animClockSec += dt;

    if (this.activeTargetHalo.visible) {
      this.activeTargetHalo.rotation.y += dt * 1.4;
    }

    let rescuedCount = 0;
    let totalNpcCount = 0;
    let justEvacuatedGroupNameRu: string | null = null;
    let blockedGroupWarningRu: string | null = null;

    for (let i = 0; i < this.npcGroups.length; i++) {
      const grp = this.npcGroups[i];
      totalNpcCount += grp.config.count;

      if (grp.status === 'EVACUATED') {
        rescuedCount += grp.config.count;
        continue;
      }

      if (grp.status === 'TRAPPED' || grp.status === 'BLOCKED_BY_FIRE') {
        // Если пожар потушен — переводим из BLOCKED_BY_FIRE в TRAPPED/READY или сразу FOLLOWING
        if (grp.status === 'BLOCKED_BY_FIRE' && fireMgr.isFireExtinguished(grp.config.blockedByFireId)) {
          grp.status = 'FOLLOWING';
          grp.statusBeaconMat.color.setHex(0x38bdf8);
        } else {
          // Лёгкое покачивание руками/силуэтом ожидающих
          grp.personMeshes.forEach((p, idx) => {
            p.position.y = Math.abs(Math.sin(this.animClockSec * 2.5 + idx)) * 0.04;
          });
          continue;
        }
      }

      if (grp.status === 'FOLLOWING') {
        const target =
          grp.waypointIndex < grp.waypoints.length
            ? grp.waypoints[grp.waypointIndex]
            : grp.waypointIndex === grp.waypoints.length
            ? grp.exitPos
            : this.assemblyPos;

        // Проверка: не перекрыт ли путь к целевой точке активным очагом
        const nearbyFire = fireMgr.getNearestActiveFire(grp.currentPos);
        if (nearbyFire && nearbyFire.worldPos.distanceTo(grp.currentPos) < 3.4) {
          grp.status = 'BLOCKED_BY_FIRE';
          grp.statusBeaconMat.color.setHex(0xef4444);
          blockedGroupWarningRu = `${grp.config.nameRu} остановилась перед активным огнём (${nearbyFire.config.nameRu})!`;
          continue;
        }

        this.scratchVecA.subVectors(target, grp.currentPos);
        this.scratchVecA.y = 0;
        const dist = this.scratchVecA.length();

        if (dist < 0.55) {
          if (grp.waypointIndex <= grp.waypoints.length) {
            grp.waypointIndex += 1;
          } else {
            // Прибыли на внешний пункт сбора!
            grp.status = 'EVACUATED';
            grp.statusBeaconMat.color.setHex(0x22c55e);
            const offset = i === 0 ? -1.4 : 1.4;
            grp.currentPos.set(this.assemblyPos.x + offset, 0, this.assemblyPos.z + 0.6);
            grp.rootGroup.position.copy(grp.currentPos);
            rescuedCount += grp.config.count;
            justEvacuatedGroupNameRu = grp.config.nameRu;
          }
        } else {
          this.scratchVecA.divideScalar(dist);
          const step = Math.min(dist, 2.35 * dt);
          grp.currentPos.addScaledVector(this.scratchVecA, step);
          grp.rootGroup.position.copy(grp.currentPos);
          grp.rootGroup.lookAt(target.x, 0, target.z);
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
      blockedGroupWarningRu
    };
  }

  public getNearestPendingNpcGroup(pos: THREE.Vector3): NpcGroupRuntime | null {
    let best: NpcGroupRuntime | null = null;
    let bestD = Infinity;
    for (const grp of this.npcGroups) {
      if (grp.status === 'EVACUATED' || grp.status === 'FOLLOWING') continue;
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
