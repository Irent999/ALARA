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
  canvas.width = 128;
  canvas.height = 64;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#0f172a';
  ctx.fillRect(0, 0, 128, 64);
  ctx.strokeStyle = '#f59e0b';
  ctx.lineWidth = 3;
  ctx.strokeRect(2, 2, 124, 60);
  ctx.fillStyle = '#facc15';
  ctx.font = 'bold 13px monospace';
  ctx.textAlign = 'center';
  ctx.fillText('КРУ-6 кВ · РТЗО', 64, 28);
  ctx.fillStyle = '#38bdf8';
  ctx.font = '9px monospace';
  ctx.fillText('ОПАСНОЕ НАПРЯЖЕНИЕ', 64, 46);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

interface EquipmentGeometryPalette {
  readonly turbBed: THREE.BoxGeometry;
  readonly turbRotor: THREE.CylinderGeometry;
  readonly turbGen: THREE.BoxGeometry;
  readonly turbPipe: THREE.CylinderGeometry;
  readonly turbHeader: THREE.CylinderGeometry;
  readonly turbFlange: THREE.CylinderGeometry;
  readonly turbRail: THREE.BoxGeometry;
  readonly turbPost: THREE.CylinderGeometry;
  readonly pumpSkid: THREE.BoxGeometry;
  readonly pumpMotor: THREE.CylinderGeometry;
  readonly pumpVolute: THREE.CylinderGeometry;
  readonly pumpRiser: THREE.CylinderGeometry;
  readonly pumpFlange: THREE.CylinderGeometry;
  readonly sgPlinth: THREE.BoxGeometry;
  readonly sgBay: THREE.BoxGeometry;
  readonly sgLed: THREE.BoxGeometry;
  readonly sgBusDuct: THREE.BoxGeometry;
  readonly sgPlate: THREE.PlaneGeometry;
  readonly platDeck: THREE.BoxGeometry;
  readonly platLeg: THREE.BoxGeometry;
  readonly platRail: THREE.BoxGeometry;
  readonly platPost: THREE.CylinderGeometry;
}

export class NppEquipmentBuilder {
  public readonly rootGroup = new THREE.Group();
  public readonly colliders: WallColliderBox[] = [];
  public readonly equipmentCount: number;

  private readonly sharedMaterials: THREE.Material[] = [];
  private readonly sharedGeometries: THREE.BufferGeometry[] = [];
  private readonly sharedTextures: THREE.Texture[] = [];
  private readonly geoPalette: EquipmentGeometryPalette;

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

    // Палитра общих геометрий создаётся один раз и переиспользуется во всех корпусах
    const turbRotor = this.trackGeo(new THREE.CylinderGeometry(0.68, 0.74, 2.7, 14));
    turbRotor.rotateZ(Math.PI / 2);
    const turbHeader = this.trackGeo(new THREE.CylinderGeometry(0.18, 0.18, 2.6, 10));
    turbHeader.rotateZ(Math.PI / 2);
    const pumpMotor = this.trackGeo(new THREE.CylinderGeometry(0.36, 0.36, 1.05, 12));
    pumpMotor.rotateZ(Math.PI / 2);

    this.geoPalette = {
      turbBed: this.trackGeo(new THREE.BoxGeometry(4.2, 0.36, 2.1)),
      turbRotor,
      turbGen: this.trackGeo(new THREE.BoxGeometry(1.3, 1.25, 1.35)),
      turbPipe: this.trackGeo(new THREE.CylinderGeometry(0.16, 0.16, 2.1, 10)),
      turbHeader,
      turbFlange: this.trackGeo(new THREE.CylinderGeometry(0.28, 0.28, 0.1, 10)),
      turbRail: this.trackGeo(new THREE.BoxGeometry(4.1, 0.06, 0.06)),
      turbPost: this.trackGeo(new THREE.CylinderGeometry(0.03, 0.03, 1.05, 6)),
      pumpSkid: this.trackGeo(new THREE.BoxGeometry(2.4, 0.22, 1.5)),
      pumpMotor,
      pumpVolute: this.trackGeo(new THREE.CylinderGeometry(0.46, 0.46, 0.34, 12)),
      pumpRiser: this.trackGeo(new THREE.CylinderGeometry(0.13, 0.13, 1.35, 10)),
      pumpFlange: this.trackGeo(new THREE.CylinderGeometry(0.22, 0.22, 0.08, 10)),
      sgPlinth: this.trackGeo(new THREE.BoxGeometry(2.9, 0.16, 0.96)),
      sgBay: this.trackGeo(new THREE.BoxGeometry(0.9, 2.05, 0.88)),
      sgLed: this.trackGeo(new THREE.BoxGeometry(0.14, 0.05, 0.04)),
      sgBusDuct: this.trackGeo(new THREE.BoxGeometry(2.86, 0.24, 0.55)),
      sgPlate: this.trackGeo(new THREE.PlaneGeometry(0.84, 0.42)),
      platDeck: this.trackGeo(new THREE.BoxGeometry(2.6, 0.14, 1.6)),
      platLeg: this.trackGeo(new THREE.BoxGeometry(0.1, 0.42, 0.1)),
      platRail: this.trackGeo(new THREE.BoxGeometry(2.6, 0.06, 0.06)),
      platPost: this.trackGeo(new THREE.CylinderGeometry(0.03, 0.03, 0.9, 6))
    };

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
    const gp = this.geoPalette;

    const bed = new THREE.Mesh(gp.turbBed, darkMat);
    bed.position.y = 0.18;
    bed.receiveShadow = true;
    g.add(bed);

    const rotor = new THREE.Mesh(gp.turbRotor, turbineMat);
    rotor.position.set(-0.4, 1.05, 0);
    g.add(rotor);

    const gen = new THREE.Mesh(gp.turbGen, steelMat);
    gen.position.set(1.25, 0.98, 0);
    g.add(gen);

    const pipe = new THREE.Mesh(gp.turbPipe, pipeMat);
    pipe.position.set(-0.9, 1.9, -0.35);
    g.add(pipe);

    const header = new THREE.Mesh(gp.turbHeader, pipeMat);
    header.position.set(-0.1, 2.45, -0.35);
    g.add(header);

    const flange = new THREE.Mesh(gp.turbFlange, railMat);
    flange.position.set(-0.9, 1.72, -0.35);
    g.add(flange);

    const rail = new THREE.Mesh(gp.turbRail, railMat);
    rail.position.set(0, 1.08, 1.02);
    g.add(rail);

    for (let px = -1.9; px <= 1.95; px += 1.25) {
      const post = new THREE.Mesh(gp.turbPost, railMat);
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
    const gp = this.geoPalette;

    const skid = new THREE.Mesh(gp.pumpSkid, darkMat);
    skid.position.y = 0.11;
    skid.receiveShadow = true;
    g.add(skid);

    const motor = new THREE.Mesh(gp.pumpMotor, steelMat);
    motor.position.set(-0.45, 0.65, 0);
    g.add(motor);

    const volute = new THREE.Mesh(gp.pumpVolute, steelMat);
    volute.rotation.x = Math.PI / 2;
    volute.position.set(0.42, 0.68, 0);
    g.add(volute);

    const riser = new THREE.Mesh(gp.pumpRiser, pipeMat);
    riser.position.set(0.42, 1.35, 0);
    g.add(riser);

    const flange = new THREE.Mesh(gp.pumpFlange, accentMat);
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
    const gp = this.geoPalette;

    const plinth = new THREE.Mesh(gp.sgPlinth, darkMat);
    plinth.position.y = 0.08;
    g.add(plinth);

    for (let i = -1; i <= 1; i++) {
      const bay = new THREE.Mesh(gp.sgBay, cabinetMat);
      bay.position.set(i * 0.94, 1.18, 0);
      g.add(bay);

      const led = new THREE.Mesh(gp.sgLed, ledMat);
      led.position.set(i * 0.94 + 0.25, 1.92, 0.44);
      g.add(led);
    }

    const busDuct = new THREE.Mesh(gp.sgBusDuct, yellowMat);
    busDuct.position.set(0, 2.32, 0);
    g.add(busDuct);

    const plate = new THREE.Mesh(gp.sgPlate, plateMat);
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
    const gp = this.geoPalette;

    const deck = new THREE.Mesh(gp.platDeck, steelMat);
    deck.position.y = 0.42;
    deck.receiveShadow = true;
    g.add(deck);

    for (const lx of [-1.18, 1.18]) {
      for (const lz of [-0.68, 0.68]) {
        const leg = new THREE.Mesh(gp.platLeg, darkMat);
        leg.position.set(lx, 0.21, lz);
        g.add(leg);
      }
    }

    const railBack = new THREE.Mesh(gp.platRail, yellowMat);
    railBack.position.set(0, 1.32, -0.75);
    g.add(railBack);

    for (const px of [-1.22, 0, 1.22]) {
      const p = new THREE.Mesh(gp.platPost, yellowMat);
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
