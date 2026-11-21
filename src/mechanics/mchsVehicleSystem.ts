/**
 * ALARA — Пожарно-спасательный автомобиль МЧС (АЦ-40) и система пожарного рукава (Сценарий №4)
 * (src/mechanics/mchsVehicleSystem.ts)
 *
 * Реализует:
 * - Составную 3D-модель пожарного автомобиля МЧС на подъездной площадке АЭС
 * - Посадку/выход из кабины ([Enter] / кнопка HUD / нажатие левого стика HTC Vive)
 * - Ручное управление (WASD / левый стик VR) + автопилот к корпусам АЭС с обходом габаритов зданий
 * - Вытягиваемый пожарный рукав (InstancedMesh без покадровых аллокаций) от насосного отсека к стволу
 * - Контроль максимальной длины рукава (58 м), предупреждение при натяжении >= 85%
 */

import * as THREE from 'three';
import { SCENARIO_4_CONFIG, type WallColliderBox } from '../npp/nppNodeConfig';
import type { BuildingVolumeInfo, NamedWorldMarker } from '../npp/nppSceneInspector';

export interface VehicleAutopilotTarget {
  readonly index: number;
  readonly name: string;
  readonly position: THREE.Vector3;
  readonly distanceM: number;
}

export interface MchsVehicleSnapshot {
  readonly isSeated: boolean;
  readonly nearDoor: boolean;
  readonly nearHoseReel: boolean;
  readonly isHoseAttached: boolean;
  readonly speedKmh: number;
  readonly autopilotTargetName: string | null;
  readonly hoseLengthM: number;
  readonly maxHoseLengthM: number;
  readonly hoseOverstretched: boolean;
  readonly targets: VehicleAutopilotTarget[];
}

function createMchsDoorTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 192;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#b91c1c';
  ctx.fillRect(0, 0, 512, 192);
  ctx.fillStyle = '#f8fafc';
  ctx.fillRect(0, 64, 512, 56);
  ctx.fillStyle = '#1e3a8a';
  ctx.fillRect(0, 114, 512, 12);

  ctx.fillStyle = '#0f172a';
  ctx.font = 'bold 34px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('МЧС РОССИИ · АЦ-40', 256, 102);

  ctx.fillStyle = '#fef08a';
  ctx.font = 'bold 20px monospace';
  ctx.fillText('ПОЖАРНО-СПАСАТЕЛЬНАЯ СЛУЖБА АЭС', 256, 44);
  ctx.fillStyle = '#f8fafc';
  ctx.font = 'bold 20px monospace';
  ctx.fillText('БОРТ 04 · НАСОС / РУКАВ 58 М', 256, 162);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export class MchsVehicleSystem {
  public readonly rootGroup = new THREE.Group();
  public readonly vehicleGroup = new THREE.Group();
  public readonly vehiclePos = new THREE.Vector3();
  public vehicleYaw = 0;

  private readonly wheels: THREE.Group[] = [];
  private readonly frontSteerPivots: THREE.Group[] = [];
  private readonly doorHaloMesh: THREE.Mesh;
  private readonly pumpHaloMesh: THREE.Mesh;
  private readonly pumpNozzleMount = new THREE.Object3D();
  private readonly seatMount = new THREE.Object3D();
  private readonly exitMount = new THREE.Object3D();

  // Пожарный рукав (InstancedMesh сегментов + ствол ГМ-70 на руке)
  private readonly hoseSegmentsInstanced: THREE.InstancedMesh;
  private readonly hoseSegmentCount: number;
  public readonly nozzleGroup = new THREE.Group();
  public readonly nozzleTip = new THREE.Object3D();
  private readonly hoseAnchors: THREE.Vector3[] = [];
  private readonly hosePolyline: THREE.Vector3[] = [];

  private readonly driveTargets: NamedWorldMarker[];
  private readonly buildingBoxes: ReadonlyArray<BuildingVolumeInfo>;
  private readonly siteBounds: THREE.Box3;

  public isSeated = false;
  public nearDoor = false;
  public nearHoseReel = false;
  public isHoseAttached = false;
  public currentSpeedMps = 0;
  private currentSteerAngle = 0;
  public autopilotTargetIndex: number | null = null;
  public hoseLengthM = 0;
  public hoseOverstretched = false;

  private readonly disposables: Array<{ dispose: () => void }> = [];

  // Zero-Allocation scratch-буферы
  private readonly scratchA = new THREE.Vector3();
  private readonly scratchB = new THREE.Vector3();
  private readonly scratchDir = new THREE.Vector3();
  private readonly scratchMid = new THREE.Vector3();
  private readonly scratchScale = new THREE.Vector3(1, 1, 1);
  private readonly scratchQuat = new THREE.Quaternion();
  private readonly scratchMat = new THREE.Matrix4();
  private readonly upAxis = new THREE.Vector3(0, 1, 0);

  constructor(params: {
    spawnPos: THREE.Vector3;
    lookTarget: THREE.Vector3;
    driveTargets: NamedWorldMarker[];
    buildingVolumes: ReadonlyArray<BuildingVolumeInfo>;
    siteBounds: THREE.Box3;
  }) {
    this.rootGroup.name = 'mchs_vehicle_and_hose_root';
    this.vehiclePos.copy(params.spawnPos);
    this.driveTargets = params.driveTargets;
    this.buildingBoxes = params.buildingVolumes;
    this.siteBounds = params.siteBounds.clone();

    const dx = params.lookTarget.x - params.spawnPos.x;
    const dz = params.lookTarget.z - params.spawnPos.z;
    this.vehicleYaw = Math.atan2(dx, dz);

    const { doorHalo, pumpHalo } = this.buildTruckMesh();
    this.doorHaloMesh = doorHalo;
    this.pumpHaloMesh = pumpHalo;

    this.vehicleGroup.position.copy(this.vehiclePos);
    this.vehicleGroup.rotation.y = this.vehicleYaw;
    this.rootGroup.add(this.vehicleGroup);

    // Инициализация инстансированного пожарного рукава
    this.hoseSegmentCount = SCENARIO_4_CONFIG.HOSE.segmentCount;
    const segGeo = new THREE.CylinderGeometry(
      SCENARIO_4_CONFIG.HOSE.hoseRadiusM,
      SCENARIO_4_CONFIG.HOSE.hoseRadiusM,
      1.0,
      10
    );
    const hoseMat = new THREE.MeshStandardMaterial({
      color: 0xd97706,
      roughness: 0.62,
      metalness: 0.15
    });
    this.disposables.push(segGeo, hoseMat);

    this.hoseSegmentsInstanced = new THREE.InstancedMesh(segGeo, hoseMat, this.hoseSegmentCount);
    this.hoseSegmentsInstanced.frustumCulled = false;
    this.hoseSegmentsInstanced.visible = false;
    this.rootGroup.add(this.hoseSegmentsInstanced);

    this.buildNozzleGroup();
    this.rootGroup.add(this.nozzleGroup);
  }

  private track<T extends { dispose: () => void }>(item: T): T {
    this.disposables.push(item);
    return item;
  }

  private buildTruckMesh(): { doorHalo: THREE.Mesh; pumpHalo: THREE.Mesh } {
    const redPaint = this.track(
      new THREE.MeshStandardMaterial({ color: 0xdc2626, roughness: 0.34, metalness: 0.25 })
    );
    const whitePaint = this.track(
      new THREE.MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.4, metalness: 0.1 })
    );
    const chassisMat = this.track(
      new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.72, metalness: 0.55 })
    );
    const metalMat = this.track(
      new THREE.MeshStandardMaterial({ color: 0x64748b, roughness: 0.38, metalness: 0.8 })
    );
    const glassMat = this.track(
      new THREE.MeshStandardMaterial({
        color: 0x0ea5e9,
        roughness: 0.12,
        metalness: 0.4,
        transparent: true,
        opacity: 0.52
      })
    );
    const tireMat = this.track(
      new THREE.MeshStandardMaterial({ color: 0x171717, roughness: 0.88, metalness: 0.08 })
    );
    const brassMat = this.track(
      new THREE.MeshStandardMaterial({ color: 0xf59e0b, roughness: 0.28, metalness: 0.85 })
    );
    const beaconBlueMat = this.track(
      new THREE.MeshStandardMaterial({
        color: 0x38bdf8,
        emissive: 0x0284c7,
        emissiveIntensity: 0.85,
        roughness: 0.2
      })
    );
    const beaconAmberMat = this.track(
      new THREE.MeshStandardMaterial({
        color: 0xfacc15,
        emissive: 0xeab308,
        emissiveIntensity: 0.75,
        roughness: 0.2
      })
    );
    const doorTex = this.track(createMchsDoorTexture());
    const doorMat = this.track(new THREE.MeshBasicMaterial({ map: doorTex }));

    // 1. Шасси и бампер
    const chassis = new THREE.Mesh(
      this.track(new THREE.BoxGeometry(2.26, 0.32, 6.2)),
      chassisMat
    );
    chassis.position.set(0, 0.56, 0);
    chassis.castShadow = true;
    this.vehicleGroup.add(chassis);

    const bumper = new THREE.Mesh(
      this.track(new THREE.BoxGeometry(2.38, 0.34, 0.36)),
      whitePaint
    );
    bumper.position.set(0, 0.58, 3.18);
    this.vehicleGroup.add(bumper);

    // 2. Кабина боевого расчёта (впереди по +Z)
    const cab = new THREE.Mesh(
      this.track(new THREE.BoxGeometry(2.28, 1.56, 2.05)),
      redPaint
    );
    cab.position.set(0, 1.48, 1.95);
    cab.castShadow = true;
    this.vehicleGroup.add(cab);

    const windshield = new THREE.Mesh(
      this.track(new THREE.BoxGeometry(2.04, 0.68, 0.08)),
      glassMat
    );
    windshield.position.set(0, 1.72, 2.98);
    this.vehicleGroup.add(windshield);

    const sideWinGeo = this.track(new THREE.BoxGeometry(0.08, 0.56, 1.3));
    const winL = new THREE.Mesh(sideWinGeo, glassMat);
    winL.position.set(-1.14, 1.72, 2.0);
    const winR = new THREE.Mesh(sideWinGeo, glassMat);
    winR.position.set(1.14, 1.72, 2.0);
    this.vehicleGroup.add(winL, winR);

    // 3. Цистерна и насосный отсек (сзади по -Z)
    const body = new THREE.Mesh(
      this.track(new THREE.BoxGeometry(2.34, 1.72, 3.65)),
      redPaint
    );
    body.position.set(0, 1.58, -1.05);
    body.castShadow = true;
    this.vehicleGroup.add(body);

    const stripeGeo = this.track(new THREE.BoxGeometry(2.38, 0.24, 5.6));
    const stripe = new THREE.Mesh(stripeGeo, whitePaint);
    stripe.position.set(0, 1.24, 0.05);
    this.vehicleGroup.add(stripe);

    // Таблички МЧС по бортам
    const plateGeo = this.track(new THREE.PlaneGeometry(2.6, 0.96));
    const plateL = new THREE.Mesh(plateGeo, doorMat);
    plateL.position.set(-1.19, 1.66, -1.05);
    plateL.rotation.y = -Math.PI / 2;
    const plateR = new THREE.Mesh(plateGeo, doorMat);
    plateR.position.set(1.19, 1.66, -1.05);
    plateR.rotation.y = Math.PI / 2;
    this.vehicleGroup.add(plateL, plateR);

    // Роллета отсека и узел катушки рукава сзади
    const shutter = new THREE.Mesh(
      this.track(new THREE.BoxGeometry(1.45, 1.15, 0.08)),
      metalMat
    );
    shutter.position.set(0, 1.32, -2.88);
    this.vehicleGroup.add(shutter);

    const reelDrum = new THREE.Mesh(
      this.track(new THREE.CylinderGeometry(0.28, 0.28, 0.62, 14)),
      brassMat
    );
    reelDrum.rotation.z = Math.PI / 2;
    reelDrum.position.set(0, 1.02, -2.96);
    this.vehicleGroup.add(reelDrum);

    // 4. Светосигнальная балка на крыше кабины
    const barBase = new THREE.Mesh(
      this.track(new THREE.BoxGeometry(1.7, 0.1, 0.28)),
      chassisMat
    );
    barBase.position.set(0, 2.31, 2.25);
    const beaconL = new THREE.Mesh(
      this.track(new THREE.BoxGeometry(0.42, 0.16, 0.24)),
      beaconBlueMat
    );
    beaconL.position.set(-0.56, 2.42, 2.25);
    const beaconR = new THREE.Mesh(
      this.track(new THREE.BoxGeometry(0.42, 0.16, 0.24)),
      beaconAmberMat
    );
    beaconR.position.set(0.56, 2.42, 2.25);
    this.vehicleGroup.add(barBase, beaconL, beaconR);

    // 5. 4 колеса с передней поворотной осью
    const wheelGeo = this.track(new THREE.CylinderGeometry(0.46, 0.46, 0.34, 18));
    wheelGeo.rotateZ(Math.PI / 2);
    const hubGeo = this.track(new THREE.CylinderGeometry(0.22, 0.22, 0.36, 12));
    hubGeo.rotateZ(Math.PI / 2);

    const wheelCoords: ReadonlyArray<{ x: number; z: number; isFront: boolean }> = [
      { x: -1.16, z: 1.98, isFront: true },
      { x: 1.16, z: 1.98, isFront: true },
      { x: -1.16, z: -1.78, isFront: false },
      { x: 1.16, z: -1.78, isFront: false }
    ];

    wheelCoords.forEach(wc => {
      const steerPivot = new THREE.Group();
      steerPivot.position.set(wc.x, 0.46, wc.z);
      const wheelRoll = new THREE.Group();
      const tire = new THREE.Mesh(wheelGeo, tireMat);
      const hub = new THREE.Mesh(hubGeo, metalMat);
      wheelRoll.add(tire, hub);
      steerPivot.add(wheelRoll);
      this.vehicleGroup.add(steerPivot);
      this.wheels.push(wheelRoll);
      if (wc.isFront) {
        this.frontSteerPivots.push(steerPivot);
      }
    });

    // 6. Якоря места водителя, выхода, насоса и подсвеченные наземные кольца
    const seatOff = SCENARIO_4_CONFIG.VEHICLE.seatLocalOffset;
    this.seatMount.position.set(seatOff[0], seatOff[1], seatOff[2]);
    this.vehicleGroup.add(this.seatMount);

    const exitOff = SCENARIO_4_CONFIG.VEHICLE.exitSideOffset;
    this.exitMount.position.set(exitOff[0], exitOff[1], exitOff[2]);
    this.vehicleGroup.add(this.exitMount);

    const pumpOff = SCENARIO_4_CONFIG.VEHICLE.pumpLocalOffset;
    this.pumpNozzleMount.position.set(pumpOff[0], pumpOff[1], pumpOff[2]);
    this.vehicleGroup.add(this.pumpNozzleMount);

    const doorHaloMat = this.track(
      new THREE.MeshBasicMaterial({
        color: 0x38bdf8,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.62
      })
    );
    const doorHalo = new THREE.Mesh(
      this.track(new THREE.RingGeometry(0.65, 0.82, 24)),
      doorHaloMat
    );
    doorHalo.rotation.x = -Math.PI / 2;
    doorHalo.position.set(-1.95, 0.03, 1.95);
    this.vehicleGroup.add(doorHalo);

    const pumpHaloMat = this.track(
      new THREE.MeshBasicMaterial({
        color: 0xf59e0b,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.68
      })
    );
    const pumpHalo = new THREE.Mesh(
      this.track(new THREE.RingGeometry(0.65, 0.84, 24)),
      pumpHaloMat
    );
    pumpHalo.rotation.x = -Math.PI / 2;
    pumpHalo.position.set(0, 0.03, -3.55);
    this.vehicleGroup.add(pumpHalo);

    return { doorHalo, pumpHalo };
  }

  private buildNozzleGroup(): void {
    const barrelMat = this.track(
      new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.4, metalness: 0.8 })
    );
    const brassMat = this.track(
      new THREE.MeshStandardMaterial({ color: 0xf59e0b, roughness: 0.25, metalness: 0.85 })
    );
    const gripMat = this.track(
      new THREE.MeshStandardMaterial({ color: 0xdc2626, roughness: 0.45, metalness: 0.2 })
    );

    const barrel = new THREE.Mesh(
      this.track(new THREE.CylinderGeometry(0.032, 0.045, 0.46, 12)),
      barrelMat
    );
    barrel.rotation.x = Math.PI / 2;
    barrel.position.set(0, 0, -0.18);
    this.nozzleGroup.add(barrel);

    const coupling = new THREE.Mesh(
      this.track(new THREE.CylinderGeometry(0.052, 0.052, 0.09, 12)),
      brassMat
    );
    coupling.rotation.x = Math.PI / 2;
    coupling.position.set(0, 0, 0.06);
    this.nozzleGroup.add(coupling);

    const handle = new THREE.Mesh(
      this.track(new THREE.BoxGeometry(0.04, 0.14, 0.05)),
      gripMat
    );
    handle.position.set(0, -0.07, -0.05);
    handle.rotation.x = 0.22;
    this.nozzleGroup.add(handle);

    this.nozzleTip.position.set(0, 0, -0.43);
    this.nozzleGroup.add(this.nozzleTip);
    this.nozzleGroup.visible = false;
  }

  public boardVehicle(): boolean {
    if (this.isSeated) return false;
    this.isSeated = true;
    this.autopilotTargetIndex = null;
    this.doorHaloMesh.visible = false;
    return true;
  }

  public exitVehicle(outSafePos: THREE.Vector3): boolean {
    if (!this.isSeated) return false;
    this.isSeated = false;
    this.autopilotTargetIndex = null;
    this.currentSpeedMps = 0;
    this.vehicleGroup.updateMatrixWorld(true);
    this.exitMount.getWorldPosition(outSafePos);
    outSafePos.y = this.vehiclePos.y;
    this.doorHaloMesh.visible = true;
    return true;
  }

  public toggleBoardOrExit(playerPos: THREE.Vector3, outSafeExitPos: THREE.Vector3): 'BOARDED' | 'EXITED' | 'TOO_FAR' {
    if (this.isSeated) {
      this.exitVehicle(outSafeExitPos);
      return 'EXITED';
    }
    this.vehicleGroup.updateMatrixWorld(true);
    this.doorHaloMesh.getWorldPosition(this.scratchA);
    const dDoor = Math.hypot(playerPos.x - this.scratchA.x, playerPos.z - this.scratchA.z);
    const dTruck = Math.hypot(playerPos.x - this.vehiclePos.x, playerPos.z - this.vehiclePos.z);
    if (Math.min(dDoor, dTruck) <= SCENARIO_4_CONFIG.VEHICLE.boardRadiusM) {
      this.boardVehicle();
      return 'BOARDED';
    }
    return 'TOO_FAR';
  }

  public startAutopilotToBuilding(index: number): string | null {
    if (index < 0 || index >= this.driveTargets.length) return null;
    if (!this.isSeated) {
      this.boardVehicle();
    }
    this.autopilotTargetIndex = index;
    return this.driveTargets[index].name;
  }

  public cancelAutopilot(): void {
    this.autopilotTargetIndex = null;
  }

  public pickupHose(playerPos: THREE.Vector3): boolean {
    if (this.isHoseAttached) return false;
    this.vehicleGroup.updateMatrixWorld(true);
    this.pumpNozzleMount.getWorldPosition(this.scratchA);
    const dist = Math.hypot(playerPos.x - this.scratchA.x, playerPos.z - this.scratchA.z);
    if (dist > SCENARIO_4_CONFIG.HOSE.pickupRadiusM) return false;

    this.isHoseAttached = true;
    this.autopilotTargetIndex = null;
    this.hoseAnchors.length = 0;
    this.hoseAnchors.push(this.scratchA.clone());
    this.nozzleGroup.visible = true;
    this.hoseSegmentsInstanced.visible = true;
    return true;
  }

  public returnHose(): void {
    this.isHoseAttached = false;
    this.hoseAnchors.length = 0;
    this.hoseLengthM = 0;
    this.hoseOverstretched = false;
    this.nozzleGroup.visible = false;
    this.hoseSegmentsInstanced.visible = false;
  }

  public toggleHoseAtReel(playerPos: THREE.Vector3): 'ATTACHED' | 'RETURNED' | 'TOO_FAR' {
    this.vehicleGroup.updateMatrixWorld(true);
    this.pumpNozzleMount.getWorldPosition(this.scratchA);
    const dist = Math.hypot(playerPos.x - this.scratchA.x, playerPos.z - this.scratchA.z);
    if (dist > SCENARIO_4_CONFIG.HOSE.pickupRadiusM) return 'TOO_FAR';

    if (this.isHoseAttached) {
      this.returnHose();
      return 'RETURNED';
    }
    this.pickupHose(playerPos);
    return 'ATTACHED';
  }

  public getSeatWorldTransform(outPos: THREE.Vector3): number {
    this.vehicleGroup.updateMatrixWorld(true);
    this.seatMount.getWorldPosition(outPos);
    return this.vehicleYaw;
  }

  public getNozzleTipWorldPos(outPos: THREE.Vector3): THREE.Vector3 {
    this.nozzleGroup.updateMatrixWorld(true);
    return this.nozzleTip.getWorldPosition(outPos);
  }

  /**
   * Удерживает игрока в радиусе максимальной длины пожарного рукава (58 м).
   */
  public enforceHoseTether(playerPos: THREE.Vector3): boolean {
    if (!this.isHoseAttached || this.hoseAnchors.length === 0) return false;
    const maxLen = SCENARIO_4_CONFIG.HOSE.maxLengthM;

    let prefixLen = 0;
    for (let i = 1; i < this.hoseAnchors.length; i++) {
      prefixLen += this.hoseAnchors[i - 1].distanceTo(this.hoseAnchors[i]);
    }
    const lastAnchor = this.hoseAnchors[this.hoseAnchors.length - 1];
    const remain = Math.max(0.5, maxLen - prefixLen);
    const dx = playerPos.x - lastAnchor.x;
    const dz = playerPos.z - lastAnchor.z;
    const tailDist = Math.hypot(dx, dz);

    if (tailDist > remain && tailDist > 1e-4) {
      const k = remain / tailDist;
      playerPos.x = lastAnchor.x + dx * k;
      playerPos.z = lastAnchor.z + dz * k;
      return true;
    }
    return false;
  }

  public update(params: {
    dt: number;
    playerPos: THREE.Vector3;
    handAnchorPos: THREE.Vector3;
    aimDir: THREE.Vector3;
    handAnchorQuat?: THREE.Quaternion;
    hasVrHandQuat?: boolean;
    manualThrottle: number;
    manualSteer: number;
    extraColliders: ReadonlyArray<WallColliderBox>;
  }): { arrivedBuildingName: string | null } {
    const { dt } = params;
    let arrivedBuildingName: string | null = null;

    this.vehicleGroup.updateMatrixWorld(true);
    this.doorHaloMesh.getWorldPosition(this.scratchA);
    this.nearDoor =
      !this.isSeated &&
      Math.hypot(params.playerPos.x - this.scratchA.x, params.playerPos.z - this.scratchA.z) <=
        SCENARIO_4_CONFIG.VEHICLE.boardRadiusM;

    this.pumpNozzleMount.getWorldPosition(this.scratchB);
    this.nearHoseReel =
      !this.isSeated &&
      Math.hypot(params.playerPos.x - this.scratchB.x, params.playerPos.z - this.scratchB.z) <=
        SCENARIO_4_CONFIG.HOSE.pickupRadiusM;

    let throttle = THREE.MathUtils.clamp(params.manualThrottle, -1, 1);
    let steer = THREE.MathUtils.clamp(params.manualSteer, -1, 1);

    // Ручной ввод отменяет автопилот
    if (this.isSeated && (Math.abs(throttle) > 0.15 || Math.abs(steer) > 0.15)) {
      this.autopilotTargetIndex = null;
    }

    // Расчёт руления и газа при активном автопилоте к выбранному корпусу
    if (this.isSeated && this.autopilotTargetIndex !== null) {
      const target = this.driveTargets[this.autopilotTargetIndex];
      if (target) {
        const dx = target.pos.x - this.vehiclePos.x;
        const dz = target.pos.z - this.vehiclePos.z;
        const dist = Math.hypot(dx, dz);
        if (dist <= SCENARIO_4_CONFIG.VEHICLE.autopilotArrivalDistM) {
          this.autopilotTargetIndex = null;
          this.currentSpeedMps = 0;
          arrivedBuildingName = target.name;
        } else {
          const desiredYaw = Math.atan2(dx, dz);
          let deltaYaw = desiredYaw - this.vehicleYaw;
          while (deltaYaw > Math.PI) deltaYaw -= Math.PI * 2;
          while (deltaYaw < -Math.PI) deltaYaw += Math.PI * 2;
          steer = THREE.MathUtils.clamp(deltaYaw * 1.4, -1, 1);
          throttle = dist < 9.0 ? 0.45 : 0.8;
        }
      } else {
        this.autopilotTargetIndex = null;
      }
    }

    const vCfg = SCENARIO_4_CONFIG.VEHICLE;
    if (this.isSeated && !this.isHoseAttached) {
      const targetMax = throttle >= 0 ? vCfg.maxSpeedMps * throttle : vCfg.reverseSpeedMps * throttle;
      if (Math.abs(throttle) > 0.04) {
        const accel = vCfg.accelerationMps2;
        if (this.currentSpeedMps < targetMax) {
          this.currentSpeedMps = Math.min(targetMax, this.currentSpeedMps + accel * dt);
        } else {
          this.currentSpeedMps = Math.max(targetMax, this.currentSpeedMps - accel * dt);
        }
      } else {
        const decel = vCfg.dragPerSec * dt;
        if (Math.abs(this.currentSpeedMps) <= decel) {
          this.currentSpeedMps = 0;
        } else {
          this.currentSpeedMps -= Math.sign(this.currentSpeedMps) * decel;
        }
      }

      const speedFactor = THREE.MathUtils.clamp(Math.abs(this.currentSpeedMps) / 4.2, 0.25, 1.0);
      const dirSign = this.currentSpeedMps >= -0.1 ? 1 : -1;
      if (Math.abs(this.currentSpeedMps) > 0.08) {
        this.vehicleYaw += steer * vCfg.turnRateRadPerSec * speedFactor * dirSign * dt;
      }

      this.currentSteerAngle = THREE.MathUtils.lerp(
        this.currentSteerAngle,
        steer * 0.42,
        Math.min(1, dt * 8)
      );

      this.vehiclePos.x += Math.sin(this.vehicleYaw) * this.currentSpeedMps * dt;
      this.vehiclePos.z += Math.cos(this.vehicleYaw) * this.currentSpeedMps * dt;
      this.clampVehicleBounds(params.extraColliders);
    } else {
      this.currentSpeedMps = 0;
      this.currentSteerAngle = THREE.MathUtils.lerp(this.currentSteerAngle, 0, Math.min(1, dt * 6));
    }

    this.vehicleGroup.position.copy(this.vehiclePos);
    this.vehicleGroup.rotation.y = this.vehicleYaw;

    // Вращение и поворот колёс
    const wheelDeltaRot = (this.currentSpeedMps * dt) / 0.46;
    for (let i = 0; i < this.wheels.length; i++) {
      this.wheels[i].rotation.x += wheelDeltaRot;
    }
    for (let i = 0; i < this.frontSteerPivots.length; i++) {
      this.frontSteerPivots[i].rotation.y = this.currentSteerAngle;
    }

    // Обновление позиции ствола и геометрии вытянутого пожарного рукава
    this.updateHoseGeometry(params);

    return { arrivedBuildingName };
  }

  private clampVehicleBounds(extraColliders: ReadonlyArray<WallColliderBox>): void {
    const pad = 22;
    const r = SCENARIO_4_CONFIG.VEHICLE.collisionRadiusM;
    const minX = Math.min(-30, this.siteBounds.min.x - pad);
    const maxX = Math.max(30, this.siteBounds.max.x + pad);
    const minZ = Math.min(-30, this.siteBounds.min.z - pad);
    const maxZ = Math.max(30, this.siteBounds.max.z + pad);

    this.vehiclePos.x = THREE.MathUtils.clamp(this.vehiclePos.x, minX, maxX);
    this.vehiclePos.z = THREE.MathUtils.clamp(this.vehiclePos.z, minZ, maxZ);

    // Не въезжаем внутрь коробок корпусов АЭС (машина курсирует по проездам между зданиями)
    const resolveBox = (bMinX: number, bMaxX: number, bMinZ: number, bMaxZ: number) => {
      const exMinX = bMinX - r;
      const exMaxX = bMaxX + r;
      const exMinZ = bMinZ - r;
      const exMaxZ = bMaxZ + r;
      if (
        this.vehiclePos.x > exMinX &&
        this.vehiclePos.x < exMaxX &&
        this.vehiclePos.z > exMinZ &&
        this.vehiclePos.z < exMaxZ
      ) {
        const dL = this.vehiclePos.x - exMinX;
        const dR = exMaxX - this.vehiclePos.x;
        const dF = this.vehiclePos.z - exMinZ;
        const dB = exMaxZ - this.vehiclePos.z;
        const m = Math.min(dL, dR, dF, dB);
        if (m === dL) this.vehiclePos.x = exMinX;
        else if (m === dR) this.vehiclePos.x = exMaxX;
        else if (m === dF) this.vehiclePos.z = exMinZ;
        else this.vehiclePos.z = exMaxZ;
        this.currentSpeedMps *= 0.25;
      }
    };

    for (let i = 0; i < this.buildingBoxes.length; i++) {
      const b = this.buildingBoxes[i];
      if (Math.min(b.size[0], b.size[2]) < 5.0) continue;
      resolveBox(b.min[0], b.max[0], b.min[2], b.max[2]);
    }
    for (let i = 0; i < extraColliders.length; i++) {
      const c = extraColliders[i];
      resolveBox(c.minX, c.maxX, c.minZ, c.maxZ);
    }
  }

  private updateHoseGeometry(params: {
    handAnchorPos: THREE.Vector3;
    aimDir: THREE.Vector3;
    handAnchorQuat?: THREE.Quaternion;
    hasVrHandQuat?: boolean;
  }): void {
    if (!this.isHoseAttached) {
      this.nozzleGroup.visible = false;
      this.hoseSegmentsInstanced.visible = false;
      return;
    }

    this.nozzleGroup.visible = true;
    this.hoseSegmentsInstanced.visible = true;

    if (params.hasVrHandQuat && params.handAnchorQuat) {
      this.nozzleGroup.position.copy(params.handAnchorPos);
      this.nozzleGroup.quaternion.copy(params.handAnchorQuat);
    } else {
      this.nozzleGroup.position.copy(params.handAnchorPos);
      this.scratchA.copy(params.handAnchorPos).addScaledVector(params.aimDir, 2.0);
      this.nozzleGroup.lookAt(this.scratchA);
    }
    this.nozzleGroup.updateMatrixWorld(true);

    // Обновляем точки перегиба рукава по полу при движении игрока
    const lastAnchor = this.hoseAnchors[this.hoseAnchors.length - 1];
    const groundY = this.vehiclePos.y + 0.05;
    if (lastAnchor) {
      const dLast = Math.hypot(
        params.handAnchorPos.x - lastAnchor.x,
        params.handAnchorPos.z - lastAnchor.z
      );
      if (
        dLast >= SCENARIO_4_CONFIG.HOSE.anchorStepM &&
        this.hoseAnchors.length < this.hoseSegmentCount - 2
      ) {
        this.hoseAnchors.push(
          new THREE.Vector3(params.handAnchorPos.x, groundY, params.handAnchorPos.z)
        );
      }
    }

    this.hosePolyline.length = 0;
    this.vehicleGroup.updateMatrixWorld(true);
    this.pumpNozzleMount.getWorldPosition(this.scratchA);
    this.hosePolyline.push(this.scratchA.clone());

    for (let i = 1; i < this.hoseAnchors.length; i++) {
      this.hosePolyline.push(this.hoseAnchors[i]);
    }
    this.hosePolyline.push(params.handAnchorPos.clone());

    let totalLen = 0;
    for (let i = 1; i < this.hosePolyline.length; i++) {
      totalLen += this.hosePolyline[i - 1].distanceTo(this.hosePolyline[i]);
    }
    this.hoseLengthM = totalLen;
    this.hoseOverstretched =
      totalLen >= SCENARIO_4_CONFIG.HOSE.maxLengthM * SCENARIO_4_CONFIG.HOSE.warningLengthRatio;

    const segsNeeded = Math.min(this.hoseSegmentCount, Math.max(1, this.hosePolyline.length - 1));
    for (let i = 0; i < this.hoseSegmentCount; i++) {
      if (i < segsNeeded) {
        const p0 = this.hosePolyline[i];
        const p1 = this.hosePolyline[i + 1];
        const len = Math.max(0.05, p0.distanceTo(p1));
        this.scratchMid.addVectors(p0, p1).multiplyScalar(0.5);
        this.scratchDir.subVectors(p1, p0).divideScalar(len);
        this.scratchQuat.setFromUnitVectors(this.upAxis, this.scratchDir);
        this.scratchScale.set(1, len, 1);
        this.scratchMat.compose(this.scratchMid, this.scratchQuat, this.scratchScale);
        this.hoseSegmentsInstanced.setMatrixAt(i, this.scratchMat);
      } else {
        this.scratchScale.set(0, 0, 0);
        this.scratchMat.compose(this.vehiclePos, this.scratchQuat.identity(), this.scratchScale);
        this.hoseSegmentsInstanced.setMatrixAt(i, this.scratchMat);
      }
    }
    this.hoseSegmentsInstanced.instanceMatrix.needsUpdate = true;
  }

  public getSnapshot(playerPos: THREE.Vector3): MchsVehicleSnapshot {
    const targets: VehicleAutopilotTarget[] = this.driveTargets.map((t, index) => ({
      index,
      name: t.name,
      position: t.pos,
      distanceM: Math.round(
        Math.hypot(playerPos.x - t.pos.x, playerPos.z - t.pos.z)
      )
    }));

    return {
      isSeated: this.isSeated,
      nearDoor: this.nearDoor,
      nearHoseReel: this.nearHoseReel,
      isHoseAttached: this.isHoseAttached,
      speedKmh: Math.round(Math.abs(this.currentSpeedMps) * 3.6),
      autopilotTargetName:
        this.autopilotTargetIndex !== null
          ? this.driveTargets[this.autopilotTargetIndex]?.name ?? null
          : null,
      hoseLengthM: Number(this.hoseLengthM.toFixed(1)),
      maxHoseLengthM: SCENARIO_4_CONFIG.HOSE.maxLengthM,
      hoseOverstretched: this.hoseOverstretched,
      targets
    };
  }

  public dispose(): void {
    this.disposables.forEach(d => d.dispose());
    this.rootGroup.parent?.remove(this.rootGroup);
  }
}
