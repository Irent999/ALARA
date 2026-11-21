/**
 * ALARA — Генератор внутреннего технического оборудования АЭС (Сценарий №4)
 * (src/mechanics/nppEquipmentBuilder.ts)
 *
 * Размещает внутри объёмов обнаруженных зданий (BuildingVolumeInfo) составные 3D-узлы:
 * - Турбоагрегат (корпус ротора, конденсатор, паропровод с фланцами, манометр)
 * - Насосный агрегат и обвязка трубопроводов (центробежный насос, электропривод, арматура)
 * - Шкафы электрораспределительные КРУ / РТЗО с шинопроводом
 * - Сервисная площадка с жёлтым трубчатым ограждением
 *
 * Соблюдает безопасные проходы: не перекрывает очаги пожара, группы NPC и входные коридоры.
 */

import * as THREE from 'three';
import type { WallColliderBox } from '../npp/nppNodeConfig';
import type { BuildingVolumeInfo } from '../npp/nppSceneInspector';

export interface EquipmentBuildResult {
  readonly rootGroup: THREE.Group;
  readonly colliders: WallColliderBox[];
  readonly equipmentCount: number;
}

function createSwitchgearPlateTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 128;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#0f172a';
  ctx.fillRect(0, 0, 256, 128);
  ctx.strokeStyle = '#f59e0b';
  ctx.lineWidth = 6;
  ctx.strokeRect(4, 4, 248, 120);
  ctx.fillStyle = '#facc15';
  ctx.font = 'bold 26px monospace';
  ctx.textAlign = 'center';
  ctx.fillText('КРУ-6 кВ · РТЗО', 128, 56);
  ctx.fillStyle = '#38bdf8';
  ctx.font = '18px monospace';
  ctx.fillText('ОПАСНОЕ НАПРЯЖЕНИЕ', 128, 92);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export class NppEquipmentBuilder {
  public readonly rootGroup = new THREE.Group();
  public readonly colliders: WallColliderBox[] = [];
  public readonly equipmentCount: number;

  private readonly sharedMaterials: THREE.Material[] = [];
  private readonly sharedGeometries: THREE.BufferGeometry[] = [];
  private readonly sharedTextures: THREE.Texture[] = [];

  constructor(params: {
    buildings: ReadonlyArray<BuildingVolumeInfo>;
    avoidPoints: ReadonlyArray<THREE.Vector3>;
    minClearanceM: number;
    maxBuildings?: number;
    scale?: number;
  }) {
    this.rootGroup.name = 'npp_interior_equipment_root';

    const scale = THREE.MathUtils.clamp(params.scale ?? 1.0, 0.7, 1.4);
    const maxBld = Math.min(params.maxBuildings ?? 4, params.buildings.length);

    const steelMat = new THREE.MeshStandardMaterial({
      color: 0x475569,
      roughness: 0.42,
      metalness: 0.78
    });
    const turbineMat = new THREE.MeshStandardMaterial({
      color: 0x1d4ed8,
      roughness: 0.38,
      metalness: 0.55
    });
    const darkMetalMat = new THREE.MeshStandardMaterial({
      color: 0x1e293b,
      roughness: 0.5,
      metalness: 0.72
    });
    const pipeMat = new THREE.MeshStandardMaterial({
      color: 0x94a3b8,
      roughness: 0.3,
      metalness: 0.85
    });
    const cabinetMat = new THREE.MeshStandardMaterial({
      color: 0x334155,
      roughness: 0.48,
      metalness: 0.5
    });
    const safetyYellowMat = new THREE.MeshStandardMaterial({
      color: 0xeab308,
      roughness: 0.45,
      metalness: 0.25
    });
    const indicatorMat = new THREE.MeshStandardMaterial({
      color: 0x22c55e,
      emissive: 0x16a34a,
      emissiveIntensity: 0.65,
      roughness: 0.3
    });
    const plateTex = createSwitchgearPlateTexture();
    const plateMat = new THREE.MeshBasicMaterial({ map: plateTex });

    this.sharedMaterials.push(
      steelMat,
      turbineMat,
      darkMetalMat,
      pipeMat,
      cabinetMat,
      safetyYellowMat,
      indicatorMat,
      plateMat
    );
    this.sharedTextures.push(plateTex);

    let placedCount = 0;

    for (let bi = 0; bi < maxBld; bi++) {
      const bld = params.buildings[bi];
      if (!bld || Math.min(bld.size[0], bld.size[2]) < 5.5) continue;

      const floorY = bld.interiorFloorY;
      const halfX = Math.max(1.5, bld.size[0] * 0.32);
      const halfZ = Math.max(1.5, bld.size[2] * 0.32);

      const candidateSlots: ReadonlyArray<{
        kind: 'turbine' | 'pump' | 'switchgear' | 'platform';
        dx: number;
        dz: number;
        rotY: number;
        halfW: number;
        halfD: number;
      }> = [
        { kind: 'turbine', dx: -halfX * 0.55, dz: -halfZ * 0.45, rotY: 0, halfW: 2.3, halfD: 1.3 },
        { kind: 'pump', dx: halfX * 0.58, dz: -halfZ * 0.35, rotY: Math.PI * 0.5, halfW: 1.4, halfD: 1.1 },
        { kind: 'switchgear', dx: -halfX * 0.55, dz: halfZ * 0.48, rotY: 0, halfW: 1.6, halfD: 0.65 },
        { kind: 'platform', dx: halfX * 0.45, dz: halfZ * 0.42, rotY: Math.PI, halfW: 1.5, halfD: 1.0 }
      ];

      for (let si = 0; si < candidateSlots.length; si++) {
        const slot = candidateSlots[si];
        const wx = bld.center[0] + slot.dx;
        const wz = bld.center[2] + slot.dz;

        // Проверяем, что оборудование не накладывается на очаги пожара, группы NPC и точки операций
        let blocked = false;
        const reqDist = params.minClearanceM + Math.max(slot.halfW, slot.halfD) * 0.45;
        for (let ai = 0; ai < params.avoidPoints.length; ai++) {
          const ap = params.avoidPoints[ai];
          if (Math.hypot(wx - ap.x, wz - ap.z) < reqDist) {
            blocked = true;
            break;
          }
        }
        if (blocked) continue;

        let group: THREE.Group;
        if (slot.kind === 'turbine') {
          group = this.createTurbogeneratorUnit(
            turbineMat,
            steelMat,
            pipeMat,
            darkMetalMat,
            safetyYellowMat
          );
        } else if (slot.kind === 'pump') {
          group = this.createPumpSkidUnit(steelMat, pipeMat, darkMetalMat, safetyYellowMat);
        } else if (slot.kind === 'switchgear') {
          group = this.createSwitchgearBank(cabinetMat, darkMetalMat, safetyYellowMat, indicatorMat, plateMat);
        } else {
          group = this.createServicePlatform(steelMat, darkMetalMat, safetyYellowMat);
        }

        group.position.set(wx, floorY, wz);
        group.rotation.y = slot.rotY;
        group.scale.setScalar(scale);
        this.rootGroup.add(group);

        const cw = (slot.rotY === Math.PI * 0.5 ? slot.halfD : slot.halfW) * scale;
        const cd = (slot.rotY === Math.PI * 0.5 ? slot.halfW : slot.halfD) * scale;
        this.colliders.push({
          minX: wx - cw,
          maxX: wx + cw,
          minY: floorY,
          maxY: floorY + 2.8,
          minZ: wz - cd,
          maxZ: wz + cd
        });

        placedCount += 1;
      }
    }

    this.equipmentCount = placedCount;
  }

  private trackGeo<T extends THREE.BufferGeometry>(geo: T): T {
    this.sharedGeometries.push(geo);
    return geo;
  }

  private createTurbogeneratorUnit(
    turbineMat: THREE.Material,
    steelMat: THREE.Material,
    pipeMat: THREE.Material,
    darkMat: THREE.Material,
    railMat: THREE.Material
  ): THREE.Group {
    const g = new THREE.Group();
    g.name = 'equip_turbogenerator';

    // 1. Стальная опорная рама
    const bed = new THREE.Mesh(this.trackGeo(new THREE.BoxGeometry(4.2, 0.36, 2.1)), darkMat);
    bed.position.y = 0.18;
    bed.castShadow = true;
    bed.receiveShadow = true;
    g.add(bed);

    // 2. Цилиндр высокого/низкого давления турбины
    const rotorGeo = this.trackGeo(new THREE.CylinderGeometry(0.68, 0.74, 2.7, 18));
    rotorGeo.rotateZ(Math.PI / 2);
    const rotor = new THREE.Mesh(rotorGeo, turbineMat);
    rotor.position.set(-0.4, 1.05, 0);
    rotor.castShadow = true;
    g.add(rotor);

    // 3. Генераторный блок справа
    const gen = new THREE.Mesh(this.trackGeo(new THREE.BoxGeometry(1.3, 1.25, 1.35)), steelMat);
    gen.position.set(1.25, 0.98, 0);
    gen.castShadow = true;
    g.add(gen);

    // 4. Паропровод верхний с фланцами
    const pipeGeo = this.trackGeo(new THREE.CylinderGeometry(0.16, 0.16, 2.1, 12));
    const pipe = new THREE.Mesh(pipeGeo, pipeMat);
    pipe.position.set(-0.9, 1.9, -0.35);
    g.add(pipe);

    const headerGeo = this.trackGeo(new THREE.CylinderGeometry(0.18, 0.18, 2.6, 12));
    headerGeo.rotateZ(Math.PI / 2);
    const header = new THREE.Mesh(headerGeo, pipeMat);
    header.position.set(-0.1, 2.45, -0.35);
    g.add(header);

    // 5. Фланец и запорная стойка
    const flange = new THREE.Mesh(this.trackGeo(new THREE.CylinderGeometry(0.28, 0.28, 0.1, 14)), railMat);
    flange.position.set(-0.9, 1.72, -0.35);
    g.add(flange);

    // 6. Боковой поручень безопасности
    const rail = new THREE.Mesh(this.trackGeo(new THREE.BoxGeometry(4.1, 0.06, 0.06)), railMat);
    rail.position.set(0, 1.08, 1.02);
    g.add(rail);

    const postGeo = this.trackGeo(new THREE.CylinderGeometry(0.03, 0.03, 1.05, 8));
    for (let px = -1.9; px <= 1.95; px += 1.25) {
      const post = new THREE.Mesh(postGeo, railMat);
      post.position.set(px, 0.54, 1.02);
      g.add(post);
    }

    return g;
  }

  private createPumpSkidUnit(
    steelMat: THREE.Material,
    pipeMat: THREE.Material,
    darkMat: THREE.Material,
    accentMat: THREE.Material
  ): THREE.Group {
    const g = new THREE.Group();
    g.name = 'equip_pump_skid';

    const skid = new THREE.Mesh(this.trackGeo(new THREE.BoxGeometry(2.4, 0.22, 1.5)), darkMat);
    skid.position.y = 0.11;
    skid.receiveShadow = true;
    g.add(skid);

    const motorGeo = this.trackGeo(new THREE.CylinderGeometry(0.36, 0.36, 1.05, 16));
    motorGeo.rotateZ(Math.PI / 2);
    const motor = new THREE.Mesh(motorGeo, steelMat);
    motor.position.set(-0.45, 0.65, 0);
    motor.castShadow = true;
    g.add(motor);

    const volute = new THREE.Mesh(this.trackGeo(new THREE.CylinderGeometry(0.46, 0.46, 0.34, 16)), steelMat);
    volute.rotation.x = Math.PI / 2;
    volute.position.set(0.42, 0.68, 0);
    g.add(volute);

    const riser = new THREE.Mesh(this.trackGeo(new THREE.CylinderGeometry(0.13, 0.13, 1.35, 12)), pipeMat);
    riser.position.set(0.42, 1.35, 0);
    g.add(riser);

    const flange = new THREE.Mesh(this.trackGeo(new THREE.CylinderGeometry(0.22, 0.22, 0.08, 12)), accentMat);
    flange.position.set(0.42, 1.12, 0);
    g.add(flange);

    return g;
  }

  private createSwitchgearBank(
    cabinetMat: THREE.Material,
    darkMat: THREE.Material,
    yellowMat: THREE.Material,
    ledMat: THREE.Material,
    plateMat: THREE.Material
  ): THREE.Group {
    const g = new THREE.Group();
    g.name = 'equip_switchgear';

    const plinth = new THREE.Mesh(this.trackGeo(new THREE.BoxGeometry(2.9, 0.16, 0.96)), darkMat);
    plinth.position.y = 0.08;
    g.add(plinth);

    const bayGeo = this.trackGeo(new THREE.BoxGeometry(0.9, 2.05, 0.88));
    for (let i = -1; i <= 1; i++) {
      const bay = new THREE.Mesh(bayGeo, cabinetMat);
      bay.position.set(i * 0.94, 1.18, 0);
      bay.castShadow = true;
      g.add(bay);

      const led = new THREE.Mesh(this.trackGeo(new THREE.BoxGeometry(0.14, 0.05, 0.04)), ledMat);
      led.position.set(i * 0.94 + 0.25, 1.92, 0.44);
      g.add(led);
    }

    const busDuct = new THREE.Mesh(this.trackGeo(new THREE.BoxGeometry(2.86, 0.24, 0.55)), yellowMat);
    busDuct.position.set(0, 2.32, 0);
    g.add(busDuct);

    const plate = new THREE.Mesh(this.trackGeo(new THREE.PlaneGeometry(0.84, 0.42)), plateMat);
    plate.position.set(0, 1.48, 0.45);
    g.add(plate);

    return g;
  }

  private createServicePlatform(
    steelMat: THREE.Material,
    darkMat: THREE.Material,
    yellowMat: THREE.Material
  ): THREE.Group {
    const g = new THREE.Group();
    g.name = 'equip_service_platform';

    const deck = new THREE.Mesh(this.trackGeo(new THREE.BoxGeometry(2.6, 0.14, 1.6)), steelMat);
    deck.position.y = 0.42;
    deck.receiveShadow = true;
    g.add(deck);

    const legGeo = this.trackGeo(new THREE.BoxGeometry(0.1, 0.42, 0.1));
    for (const lx of [-1.18, 1.18]) {
      for (const lz of [-0.68, 0.68]) {
        const leg = new THREE.Mesh(legGeo, darkMat);
        leg.position.set(lx, 0.21, lz);
        g.add(leg);
      }
    }

    const railBack = new THREE.Mesh(this.trackGeo(new THREE.BoxGeometry(2.6, 0.06, 0.06)), yellowMat);
    railBack.position.set(0, 1.32, -0.75);
    g.add(railBack);

    const postGeo = this.trackGeo(new THREE.CylinderGeometry(0.03, 0.03, 0.9, 8));
    for (const px of [-1.22, 0, 1.22]) {
      const p = new THREE.Mesh(postGeo, yellowMat);
      p.position.set(px, 0.88, -0.75);
      g.add(p);
    }

    return g;
  }

  public dispose(): void {
    this.sharedGeometries.forEach(g => g.dispose());
    this.sharedMaterials.forEach(m => m.dispose());
    this.sharedTextures.forEach(t => t.dispose());
    this.rootGroup.parent?.remove(this.rootGroup);
  }
}
