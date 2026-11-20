/**
 * ALARA-Planner Pro VR — Система сменных инструментов МЧС (ToolManager.ts)
 *
 * Реализует 5 слотов оперативного оснащения спасателя МЧС для ликвидации ЧС на АЭС:
 *   1. Дозиметр-радиометр ДП-5В (штатный дозиметрический блок на правой руке)
 *   2. Инженерная / штыковая лопата БСЛ-110 (дезактивация и засыпка просыпей сорбентом)
 *   3. Дистанционные щипцы / цанговый захват ЦМ-1.5 (безопасное извлечение ИИИ на расстоянии 1/r²)
 *   4. Углекислотный / порошковый огнетушитель ОУ-5 (тушение кабельных трасс и очагов пожара)
 *   5. Аварийный вентильный ключ / диэлектрические кусачки 1000В (арматура и силовые рубильники)
 *
 * Все модели — процедурные составные PBR-сборки (3–12 деталей) без внешних ассетов.
 * Частицы (CO₂-струя и выброс сорбента) работают на переиспользуемых буферах без аллокаций в кадре.
 */

import * as THREE from 'three';
import type { RemoteToolId } from '../physics/gostPhysics';

export type MchsToolId = 'dp5' | 'flashlight' | 'extinguisher' | 'hands' | 'shovel' | 'tongs' | 'wrench';
export type NozzleSprayMode = 'SOLID' | 'SPRAY';

export interface ToolSlotDefinition {
  slot: 1 | 2 | 3 | 4 | 5 | 6;
  id: Exclude<MchsToolId, 'wrench'>;
  nameRu: string;
  shortNameRu: string;
  hotkey: string;
  purposeRu: string;
  mapsToRemoteToolId?: RemoteToolId;
  accentHex: string;
  isPrimary?: boolean;
}

export const TOOL_SLOTS: ReadonlyArray<ToolSlotDefinition> = [
  {
    slot: 1,
    id: 'dp5',
    nameRu: 'Дозиметр-радиометр ДП-5В',
    shortNameRu: 'ДП-5В',
    hotkey: '1',
    purposeRu: 'Радиационная разведка и поиск горячих точек по ГОСТ 27451-87',
    accentHex: '#eab308',
    isPrimary: true
  },
  {
    slot: 2,
    id: 'flashlight',
    nameRu: 'Тактический фонарь ФПС [F]',
    shortNameRu: 'Фонарь',
    hotkey: '2',
    purposeRu: 'Подсветка тёмных помещений, узлов арматуры и задымлённых зон ([F] — луч)',
    accentHex: '#fde047',
    isPrimary: true
  },
  {
    slot: 3,
    id: 'extinguisher',
    nameRu: 'Пожарный ствол ГМ-70 / ОУ-5',
    shortNameRu: 'Ствол / ОУ-5',
    hotkey: '3',
    purposeRu: 'Подавление очагов возгорания и дезактивация ([Q] — сплошная / распылённая струя)',
    accentHex: '#ef4444',
    isPrimary: true
  },
  {
    slot: 4,
    id: 'hands',
    nameRu: 'Свободные руки / Арматурный ключ',
    shortNameRu: 'Руки / Ключ',
    hotkey: '4',
    purposeRu: 'Открытие дверей, вращение вентилей, стыковка рукава ГМ-70 и силовые рубильники',
    accentHex: '#22c55e',
    isPrimary: true
  },
  {
    slot: 5,
    id: 'shovel',
    nameRu: 'Инженерная лопата БСЛ-110',
    shortNameRu: 'Лопата',
    hotkey: '5',
    purposeRu: 'Дезактивация, сбор радиоактивных просыпей и засыпка сорбентом',
    accentHex: '#f97316',
    isPrimary: false
  },
  {
    slot: 6,
    id: 'tongs',
    nameRu: 'Дистанционные щипцы ЦМ-1.5',
    shortNameRu: 'Щипцы 1.5м',
    hotkey: '6',
    purposeRu: 'Безопасный захват и эвакуация высокоактивных ИИИ по закону 1/r²',
    mapsToRemoteToolId: 'manipulator_15m',
    accentHex: '#38bdf8',
    isPrimary: false
  }
];

interface RigToolMount {
  palmGroup: THREE.Object3D;
  radiometerGroup: THREE.Object3D;
  mountGroup: THREE.Group;
  toolMeshes: {
    shovel: THREE.Group;
    tongs: THREE.Group;
    extinguisher: THREE.Group;
    wrench: THREE.Group;
  };
  tongsLeftJaw: THREE.Group;
  tongsRightJaw: THREE.Group;
  tongsTipAnchor: THREE.Object3D;
  extinguisherLever: THREE.Group;
  extinguisherNozzleAnchor: THREE.Object3D;
  wrenchPivot: THREE.Group;
  shovelPivot: THREE.Group;
}

function createExtinguisherGaugeTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = '#0f172a';
  ctx.beginPath();
  ctx.arc(64, 64, 60, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = '#f8fafc';
  ctx.beginPath();
  ctx.arc(64, 64, 52, 0, Math.PI * 2);
  ctx.fill();

  // Зелёная и красная зоны манометра
  ctx.lineWidth = 10;
  ctx.strokeStyle = '#ef4444';
  ctx.beginPath();
  ctx.arc(64, 64, 40, Math.PI * 0.78, Math.PI * 1.25);
  ctx.stroke();

  ctx.strokeStyle = '#22c55e';
  ctx.beginPath();
  ctx.arc(64, 64, 40, Math.PI * 1.25, Math.PI * 1.82);
  ctx.stroke();

  ctx.strokeStyle = '#ef4444';
  ctx.beginPath();
  ctx.arc(64, 64, 40, Math.PI * 1.82, Math.PI * 2.22);
  ctx.stroke();

  // Стрелка в рабочей зоне
  ctx.strokeStyle = '#0f172a';
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(64, 64);
  ctx.lineTo(74, 28);
  ctx.stroke();

  ctx.fillStyle = '#dc2626';
  ctx.beginPath();
  ctx.arc(64, 64, 6, 0, Math.PI * 2);
  ctx.fill();

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function createSoftParticleTexture(innerRgba: string, outerRgba: string): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext('2d')!;
  const grad = ctx.createRadialGradient(32, 32, 2, 32, 32, 30);
  grad.addColorStop(0, innerRgba);
  grad.addColorStop(0.5, innerRgba);
  grad.addColorStop(1, outerRgba);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function buildShovelMesh(): { group: THREE.Group; pivot: THREE.Group } {
  const group = new THREE.Group();
  group.name = 'mchs_tool_shovel';

  const pivot = new THREE.Group();
  group.add(pivot);

  const woodMat = new THREE.MeshStandardMaterial({ color: 0x854d0e, roughness: 0.72, metalness: 0.05 });
  const orangeMat = new THREE.MeshStandardMaterial({ color: 0xf97316, roughness: 0.42, metalness: 0.12 });
  const steelMat = new THREE.MeshStandardMaterial({ color: 0x64748b, roughness: 0.34, metalness: 0.78 });
  const edgeMat = new THREE.MeshStandardMaterial({ color: 0xcbd5e1, roughness: 0.22, metalness: 0.9 });

  // D-образная рукоять в ладони
  const gripCross = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.09, 16), orangeMat);
  gripCross.rotation.z = Math.PI / 2;
  gripCross.position.set(0, 0.01, 0.02);
  pivot.add(gripCross);

  const gripBar = new THREE.Mesh(new THREE.TorusGeometry(0.036, 0.008, 10, 20, Math.PI), steelMat);
  gripBar.rotation.y = Math.PI / 2;
  gripBar.rotation.z = Math.PI / 2;
  gripBar.position.set(0, 0.01, 0.02);
  pivot.add(gripBar);

  // Черенок вдоль оси -Z
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.018, 0.72, 18), woodMat);
  shaft.rotation.x = Math.PI / 2;
  shaft.position.set(0, 0.0, -0.36);
  shaft.castShadow = true;
  pivot.add(shaft);

  // Маркировочное оранжевое кольцо МЧС на черенке
  const band = new THREE.Mesh(new THREE.CylinderGeometry(0.019, 0.019, 0.075, 18), orangeMat);
  band.rotation.x = Math.PI / 2;
  band.position.set(0, 0.0, -0.22);
  pivot.add(band);

  // Стальная тулейка с заклепкой
  const ferrule = new THREE.Mesh(new THREE.CylinderGeometry(0.021, 0.024, 0.13, 18), steelMat);
  ferrule.rotation.x = Math.PI / 2;
  ferrule.position.set(0, 0.0, -0.74);
  pivot.add(ferrule);

  // Штыковой/совковый лоток лопаты
  const blade = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.010, 0.24), steelMat);
  blade.position.set(0, -0.006, -0.90);
  blade.rotation.x = 0.14;
  blade.castShadow = true;
  pivot.add(blade);

  // Боковые бортики и заточенная кромка
  const sideL = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.032, 0.21), steelMat);
  sideL.position.set(-0.086, 0.006, -0.89);
  sideL.rotation.x = 0.14;
  const sideR = sideL.clone();
  sideR.position.x = 0.086;
  pivot.add(sideL, sideR);

  const cuttingTip = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.006, 0.045), edgeMat);
  cuttingTip.position.set(0, -0.023, -1.03);
  cuttingTip.rotation.x = 0.2;
  pivot.add(cuttingTip);

  group.position.set(0.01, -0.02, -0.04);
  return { group, pivot };
}

function buildTongsMesh(): {
  group: THREE.Group;
  leftJaw: THREE.Group;
  rightJaw: THREE.Group;
  tipAnchor: THREE.Object3D;
} {
  const group = new THREE.Group();
  group.name = 'mchs_tool_tongs';

  const darkPolymer = new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.45, metalness: 0.25 });
  const yellowSafety = new THREE.MeshStandardMaterial({ color: 0xfacc15, roughness: 0.35, metalness: 0.15 });
  const alloyTube = new THREE.MeshStandardMaterial({ color: 0xcbd5e1, roughness: 0.25, metalness: 0.85 });
  const jawSteel = new THREE.MeshStandardMaterial({ color: 0x64748b, roughness: 0.3, metalness: 0.88 });
  const rubberPad = new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.78, metalness: 0.05 });

  // Пистолетная рукоять в ладони
  const handle = new THREE.Mesh(new THREE.BoxGeometry(0.032, 0.11, 0.044), darkPolymer);
  handle.position.set(0, -0.035, 0.015);
  handle.rotation.x = 0.24;
  group.add(handle);

  // Спусковой рычаг сжатия цанги
  const trigger = new THREE.Mesh(new THREE.BoxGeometry(0.016, 0.065, 0.022), yellowSafety);
  trigger.position.set(0, -0.03, -0.024);
  trigger.rotation.x = -0.25;
  group.add(trigger);

  // Длинная алюминиевая штанга (визуальный вылет 1.05 м)
  const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.013, 0.96, 20), alloyTube);
  tube.rotation.x = Math.PI / 2;
  tube.position.set(0, 0.008, -0.49);
  tube.castShadow = true;
  group.add(tube);

  // Предупредительная манжета МЧС «1.5 м ALARA»
  const sleeve = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, 0.14, 20), yellowSafety);
  sleeve.rotation.x = Math.PI / 2;
  sleeve.position.set(0, 0.008, -0.18);
  group.add(sleeve);

  // Корпус шарнирного узла губок
  const headHub = new THREE.Mesh(new THREE.CylinderGeometry(0.020, 0.016, 0.048, 20), darkPolymer);
  headHub.rotation.x = Math.PI / 2;
  headHub.position.set(0, 0.008, -0.98);
  group.add(headHub);

  // Подвижные левые и правые губки захвата
  const leftJaw = new THREE.Group();
  leftJaw.position.set(-0.014, 0.008, -0.995);
  const leftArm = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.018, 0.12), jawSteel);
  leftArm.position.set(-0.016, 0, -0.055);
  leftArm.rotation.y = -0.22;
  const leftPad = new THREE.Mesh(new THREE.BoxGeometry(0.014, 0.024, 0.042), rubberPad);
  leftPad.position.set(-0.004, 0, -0.115);
  leftJaw.add(leftArm, leftPad);
  group.add(leftJaw);

  const rightJaw = new THREE.Group();
  rightJaw.position.set(0.014, 0.008, -0.995);
  const rightArm = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.018, 0.12), jawSteel);
  rightArm.position.set(0.016, 0, -0.055);
  rightArm.rotation.y = 0.22;
  const rightPad = new THREE.Mesh(new THREE.BoxGeometry(0.014, 0.024, 0.042), rubberPad);
  rightPad.position.set(0.004, 0, -0.115);
  rightJaw.add(rightArm, rightPad);
  group.add(rightJaw);

  // Точка крепления переносимых ИИИ на кончике щипцов (r_extra ≈ 1.12 м от кисти)
  const tipAnchor = new THREE.Object3D();
  tipAnchor.name = 'tongs_tip_anchor';
  tipAnchor.position.set(0, 0.008, -1.12);
  group.add(tipAnchor);

  group.position.set(0.01, -0.01, -0.03);
  return { group, leftJaw, rightJaw, tipAnchor };
}

function buildExtinguisherMesh(): {
  group: THREE.Group;
  lever: THREE.Group;
  nozzleAnchor: THREE.Object3D;
} {
  const group = new THREE.Group();
  group.name = 'mchs_tool_extinguisher';

  const redBodyMat = new THREE.MeshPhysicalMaterial({
    color: 0xdc2626,
    roughness: 0.26,
    metalness: 0.35,
    clearcoat: 0.5
  });
  const brassMat = new THREE.MeshStandardMaterial({ color: 0xd97706, roughness: 0.28, metalness: 0.85 });
  const darkMetal = new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.5, metalness: 0.45 });
  const blackRubber = new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.78, metalness: 0.05 });

  // Баллон ОУ-5 (компактно у бедра/под кистью, раструб направлен вперёд вдоль -Z)
  const cylinder = new THREE.Mesh(new THREE.CylinderGeometry(0.068, 0.068, 0.34, 24), redBodyMat);
  cylinder.position.set(0.02, -0.16, -0.04);
  cylinder.castShadow = true;
  group.add(cylinder);

  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(0.068, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2),
    redBodyMat
  );
  dome.position.set(0.02, 0.01, -0.04);
  group.add(dome);

  // Латунное ЗПУ (запорно-пусковое устройство)
  const valveBlock = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.026, 0.055, 18), brassMat);
  valveBlock.position.set(0.02, 0.09, -0.04);
  group.add(valveBlock);

  // Манометр с текстурой
  const gauge = new THREE.Mesh(
    new THREE.CylinderGeometry(0.016, 0.016, 0.010, 20),
    new THREE.MeshBasicMaterial({ map: createExtinguisherGaugeTexture() })
  );
  gauge.rotation.x = Math.PI / 2;
  gauge.position.set(0.02, 0.095, -0.012);
  group.add(gauge);

  // Верхняя ручка переноса + подвижный рычаг пуска
  const carryHandle = new THREE.Mesh(new THREE.BoxGeometry(0.018, 0.014, 0.09), darkMetal);
  carryHandle.position.set(0.02, 0.118, -0.01);
  group.add(carryHandle);

  const lever = new THREE.Group();
  lever.position.set(0.02, 0.125, -0.055);
  const leverBar = new THREE.Mesh(new THREE.BoxGeometry(0.016, 0.010, 0.095), darkMetal);
  leverBar.position.set(0, 0.012, 0.04);
  leverBar.rotation.x = -0.18;
  lever.add(leverBar);
  group.add(lever);

  // Шланг + направленный вперёд раструб ОУ-5 (вдоль -Z)
  const hose = new THREE.Mesh(new THREE.CylinderGeometry(0.011, 0.011, 0.16, 14), blackRubber);
  hose.rotation.x = Math.PI / 2;
  hose.position.set(0.0, 0.05, -0.12);
  group.add(hose);

  const horn = new THREE.Mesh(new THREE.CylinderGeometry(0.046, 0.014, 0.18, 22, 1, true), blackRubber);
  horn.rotation.x = -Math.PI / 2;
  horn.position.set(0.0, 0.03, -0.28);
  horn.material.side = THREE.DoubleSide;
  group.add(horn);

  // Кольцо-чека безопасности
  const pinRing = new THREE.Mesh(new THREE.TorusGeometry(0.014, 0.0025, 8, 16), brassMat);
  pinRing.position.set(0.042, 0.102, -0.04);
  group.add(pinRing);

  const nozzleAnchor = new THREE.Object3D();
  nozzleAnchor.name = 'extinguisher_nozzle_anchor';
  nozzleAnchor.position.set(0.0, 0.03, -0.37);
  group.add(nozzleAnchor);

  group.position.set(0.0, -0.03, -0.03);
  return { group, lever, nozzleAnchor };
}

function buildWrenchMesh(): { group: THREE.Group; pivot: THREE.Group } {
  const group = new THREE.Group();
  group.name = 'mchs_tool_wrench';

  const pivot = new THREE.Group();
  group.add(pivot);

  const vdeOrange = new THREE.MeshStandardMaterial({ color: 0xf97316, roughness: 0.48, metalness: 0.06 });
  const vdeYellow = new THREE.MeshStandardMaterial({ color: 0xfacc15, roughness: 0.42, metalness: 0.08 });
  const forgedSteel = new THREE.MeshStandardMaterial({ color: 0x94a3b8, roughness: 0.24, metalness: 0.9 });
  const darkJaw = new THREE.MeshStandardMaterial({ color: 0x334155, roughness: 0.34, metalness: 0.85 });

  // Две диэлектрические рукоятки 1000В с защитными упорами
  for (const side of [-1, 1]) {
    const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.014, 0.16, 16), vdeOrange);
    handle.rotation.x = Math.PI / 2;
    handle.rotation.z = side * 0.14;
    handle.position.set(side * 0.022, 0, -0.01);
    pivot.add(handle);

    const guard = new THREE.Mesh(new THREE.BoxGeometry(0.026, 0.024, 0.014), vdeYellow);
    guard.position.set(side * 0.016, 0, -0.09);
    pivot.add(guard);
  }

  // Шарнир + массивная головка вентильного ключа / кусачек
  const joint = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.020, 20), forgedSteel);
  joint.position.set(0, 0, -0.115);
  pivot.add(joint);

  const head = new THREE.Mesh(new THREE.BoxGeometry(0.044, 0.018, 0.075), darkJaw);
  head.position.set(0, 0, -0.16);
  head.castShadow = true;
  pivot.add(head);

  // Захватный крюк для штурвала задвижки
  const hookLug = new THREE.Mesh(new THREE.BoxGeometry(0.056, 0.014, 0.022), forgedSteel);
  hookLug.position.set(0.012, 0, -0.20);
  pivot.add(hookLug);

  group.position.set(0.01, -0.01, -0.04);
  return { group, pivot };
}

export class ToolManager {
  private readonly scene: THREE.Scene;
  private activeToolId: Exclude<MchsToolId, 'wrench'> = 'dp5';
  private nozzleSprayMode: NozzleSprayMode = 'SOLID';
  private mounts = new Map<string, RigToolMount>();

  // Состояние удержания / зажима для процедурных анимаций
  private tongsClosure = 0;

  // Система частиц струи / CO₂ огнетушителя (64 частицы, zero-allocation)
  private readonly co2Count = 64;
  private readonly co2Positions: Float32Array;
  private readonly co2Velocities: Float32Array;
  private readonly co2Ages: Float32Array;
  private readonly co2Lifetimes: Float32Array;
  private readonly co2Geo: THREE.BufferGeometry;
  private readonly co2Points: THREE.Points;

  // Система частиц сорбента / песка для лопаты БСЛ-110 (48 частиц, zero-allocation)
  private readonly sandCount = 48;
  private readonly sandPositions: Float32Array;
  private readonly sandVelocities: Float32Array;
  private readonly sandAges: Float32Array;
  private readonly sandLifetimes: Float32Array;
  private readonly sandGeo: THREE.BufferGeometry;
  private readonly sandPoints: THREE.Points;
  private lastShovelBurstPhase = -1;

  // Временные буферы для zero-allocation обновлений
  private readonly tempOrigin = new THREE.Vector3();
  private readonly tempDir = new THREE.Vector3();
  private readonly tempRight = new THREE.Vector3();
  private readonly tempUp = new THREE.Vector3(0, 1, 0);

  public onToolChanged?: (tool: ToolSlotDefinition) => void;

  constructor(scene: THREE.Scene) {
    this.scene = scene;

    // 1. Буфер частиц струи CO₂ (ОУ-5)
    this.co2Positions = new Float32Array(this.co2Count * 3);
    this.co2Velocities = new Float32Array(this.co2Count * 3);
    this.co2Ages = new Float32Array(this.co2Count);
    this.co2Lifetimes = new Float32Array(this.co2Count);
    for (let i = 0; i < this.co2Count; i++) {
      this.co2Ages[i] = 99;
      this.co2Lifetimes[i] = 0.55;
      this.co2Positions[i * 3 + 1] = -999;
    }
    this.co2Geo = new THREE.BufferGeometry();
    this.co2Geo.setAttribute('position', new THREE.BufferAttribute(this.co2Positions, 3));
    this.co2Points = new THREE.Points(
      this.co2Geo,
      new THREE.PointsMaterial({
        size: 0.24,
        map: createSoftParticleTexture('rgba(241, 245, 249, 0.85)', 'rgba(241, 245, 249, 0)'),
        transparent: true,
        opacity: 0.82,
        depthWrite: false
      })
    );
    this.co2Points.frustumCulled = false;
    this.co2Points.visible = false;
    this.scene.add(this.co2Points);

    // 2. Буфер частиц песка/сорбента (Лопата)
    this.sandPositions = new Float32Array(this.sandCount * 3);
    this.sandVelocities = new Float32Array(this.sandCount * 3);
    this.sandAges = new Float32Array(this.sandCount);
    this.sandLifetimes = new Float32Array(this.sandCount);
    for (let i = 0; i < this.sandCount; i++) {
      this.sandAges[i] = 99;
      this.sandLifetimes[i] = 0.75;
      this.sandPositions[i * 3 + 1] = -999;
    }
    this.sandGeo = new THREE.BufferGeometry();
    this.sandGeo.setAttribute('position', new THREE.BufferAttribute(this.sandPositions, 3));
    this.sandPoints = new THREE.Points(
      this.sandGeo,
      new THREE.PointsMaterial({
        size: 0.11,
        map: createSoftParticleTexture('rgba(234, 179, 8, 0.92)', 'rgba(180, 83, 9, 0)'),
        transparent: true,
        opacity: 0.9,
        depthWrite: false
      })
    );
    this.sandPoints.frustumCulled = false;
    this.sandPoints.visible = false;
    this.scene.add(this.sandPoints);
  }

  public attachToHandRig(
    key: 'desktop' | 'vr',
    palmGroup: THREE.Object3D,
    radiometerGroup: THREE.Object3D
  ): void {
    const existing = this.mounts.get(key);
    if (existing && existing.palmGroup === palmGroup) return;

    const mountGroup = new THREE.Group();
    mountGroup.name = `mchs_tools_mount_${key}`;
    palmGroup.add(mountGroup);

    const shovelBuilt = buildShovelMesh();
    const tongsBuilt = buildTongsMesh();
    const extBuilt = buildExtinguisherMesh();
    const wrenchBuilt = buildWrenchMesh();

    mountGroup.add(shovelBuilt.group, tongsBuilt.group, extBuilt.group, wrenchBuilt.group);

    const mount: RigToolMount = {
      palmGroup,
      radiometerGroup,
      mountGroup,
      toolMeshes: {
        shovel: shovelBuilt.group,
        tongs: tongsBuilt.group,
        extinguisher: extBuilt.group,
        wrench: wrenchBuilt.group
      },
      tongsLeftJaw: tongsBuilt.leftJaw,
      tongsRightJaw: tongsBuilt.rightJaw,
      tongsTipAnchor: tongsBuilt.tipAnchor,
      extinguisherLever: extBuilt.lever,
      extinguisherNozzleAnchor: extBuilt.nozzleAnchor,
      wrenchPivot: wrenchBuilt.pivot,
      shovelPivot: shovelBuilt.pivot
    };

    this.mounts.set(key, mount);
    this.applyActiveToolVisibility();
  }

  public getActiveToolId(): Exclude<MchsToolId, 'wrench'> {
    return this.activeToolId;
  }

  public getActiveToolSlot(): ToolSlotDefinition {
    return TOOL_SLOTS.find(s => s.id === this.activeToolId) || TOOL_SLOTS[0];
  }

  public getNozzleSprayMode(): NozzleSprayMode {
    return this.nozzleSprayMode;
  }

  public toggleNozzleSprayMode(): NozzleSprayMode {
    this.nozzleSprayMode = this.nozzleSprayMode === 'SOLID' ? 'SPRAY' : 'SOLID';
    return this.nozzleSprayMode;
  }

  public selectTool(toolId: MchsToolId): ToolSlotDefinition {
    const normalizedId = toolId === 'wrench' ? 'hands' : toolId;
    const slot = TOOL_SLOTS.find(s => s.id === normalizedId) || TOOL_SLOTS[0];
    if (this.activeToolId !== slot.id) {
      this.activeToolId = slot.id;
      this.applyActiveToolVisibility();
      this.onToolChanged?.(slot);
    } else {
      this.applyActiveToolVisibility();
    }
    return slot;
  }

  public selectSlot(slotNumber: 1 | 2 | 3 | 4 | 5 | 6): ToolSlotDefinition {
    const slot = TOOL_SLOTS.find(s => s.slot === slotNumber) || TOOL_SLOTS[0];
    return this.selectTool(slot.id);
  }

  public cycleTool(delta: 1 | -1, primaryOnly = true): ToolSlotDefinition {
    const pool = primaryOnly ? TOOL_SLOTS.filter(s => s.isPrimary) : TOOL_SLOTS;
    const idx = pool.findIndex(s => s.id === this.activeToolId);
    const safeIdx = idx >= 0 ? idx : 0;
    const nextIdx = (safeIdx + delta + pool.length) % pool.length;
    return this.selectTool(pool[nextIdx].id);
  }

  public setTongsClosure(closure: number): void {
    this.tongsClosure = THREE.MathUtils.clamp(closure, 0, 1);
    const angle = THREE.MathUtils.lerp(0.28, -0.02, this.tongsClosure);
    this.mounts.forEach(m => {
      m.tongsLeftJaw.rotation.y = angle;
      m.tongsRightJaw.rotation.y = -angle;
    });
  }

  public getTongsTipHolder(preferVR: boolean): THREE.Object3D | null {
    const preferred = this.mounts.get(preferVR ? 'vr' : 'desktop') || this.mounts.get('desktop') || this.mounts.get('vr');
    return preferred?.tongsTipAnchor ?? null;
  }

  private applyActiveToolVisibility(): void {
    const isDp5 = this.activeToolId === 'dp5';
    this.mounts.forEach(mount => {
      mount.radiometerGroup.visible = isDp5;
      mount.toolMeshes.shovel.visible = this.activeToolId === 'shovel';
      mount.toolMeshes.tongs.visible = this.activeToolId === 'tongs';
      mount.toolMeshes.extinguisher.visible = this.activeToolId === 'extinguisher';
      mount.toolMeshes.wrench.visible = false;
    });
  }

  public triggerSorbentBurst(worldOrigin: THREE.Vector3): void {
    this.sandPoints.visible = true;
    for (let i = 0; i < this.sandCount; i++) {
      const idx = i * 3;
      this.sandPositions[idx] = worldOrigin.x + (Math.random() - 0.5) * 0.25;
      this.sandPositions[idx + 1] = worldOrigin.y + 0.15 + Math.random() * 0.15;
      this.sandPositions[idx + 2] = worldOrigin.z + (Math.random() - 0.5) * 0.25;

      const angle = Math.random() * Math.PI * 2;
      const spd = 0.6 + Math.random() * 1.4;
      this.sandVelocities[idx] = Math.cos(angle) * spd;
      this.sandVelocities[idx + 1] = 1.1 + Math.random() * 1.2;
      this.sandVelocities[idx + 2] = Math.sin(angle) * spd;
      this.sandAges[i] = 0;
      this.sandLifetimes[i] = 0.45 + Math.random() * 0.4;
    }
    this.sandGeo.attributes.position.needsUpdate = true;
  }

  public update(
    dt: number,
    elapsedSec: number,
    isVR: boolean,
    isHoldingAction: boolean,
    holdKind: string | null,
    targetWorldPos?: THREE.Vector3 | null
  ): void {
    const activeMount =
      this.mounts.get(isVR ? 'vr' : 'desktop') ||
      this.mounts.get('desktop') ||
      this.mounts.get('vr');

    // 1. Процедурные анимации инструментов при зажатом действии
    this.mounts.forEach(m => {
      // Лопата: цикличное копание и сброс сорбента
      if (this.activeToolId === 'shovel' && isHoldingAction && holdKind === 'decontaminate') {
        const cycle = (elapsedSec * 2.4) % 1;
        m.shovelPivot.rotation.x = Math.sin(cycle * Math.PI * 2) * 0.36;
        m.shovelPivot.position.z = Math.sin(cycle * Math.PI * 2) * 0.09;
      } else {
        m.shovelPivot.rotation.x *= Math.max(0, 1 - dt * 10);
        m.shovelPivot.position.z *= Math.max(0, 1 - dt * 10);
      }

      // Огнетушитель: сжатие пускового рычага
      const isSpraying =
        this.activeToolId === 'extinguisher' && isHoldingAction && holdKind === 'extinguish';
      const targetLeverRot = isSpraying ? 0.22 : 0;
      m.extinguisherLever.rotation.x += (targetLeverRot - m.extinguisherLever.rotation.x) * Math.min(1, dt * 16);

      // Ключ / руки: показываем компактный арматурный ключ при удержании вентиля/рубильника
      const wrenchActive =
        this.activeToolId === 'hands' &&
        isHoldingAction &&
        (holdKind === 'valve' || holdKind === 'breaker' || holdKind === 'generator');
      m.toolMeshes.wrench.visible = wrenchActive;
      if (wrenchActive) {
        m.wrenchPivot.rotation.z = Math.sin(elapsedSec * 5.2) * 0.42;
      } else {
        m.wrenchPivot.rotation.z *= Math.max(0, 1 - dt * 10);
      }
    });

    // Периодический выброс сорбента в точке просыпи при удержании лопаты
    if (this.activeToolId === 'shovel' && isHoldingAction && holdKind === 'decontaminate' && targetWorldPos) {
      const phase = Math.floor(elapsedSec * 1.9);
      if (phase !== this.lastShovelBurstPhase) {
        this.lastShovelBurstPhase = phase;
        this.triggerSorbentBurst(targetWorldPos);
      }
    } else {
      this.lastShovelBurstPhase = -1;
    }

    // 2. Обновление струи частиц огнетушителя / ствола (сплошная или распылённая струя)
    const sprayingNow =
      Boolean(activeMount) &&
      this.activeToolId === 'extinguisher' &&
      isHoldingAction &&
      holdKind === 'extinguish';

    if (sprayingNow && activeMount) {
      activeMount.extinguisherNozzleAnchor.updateWorldMatrix(true, false);
      activeMount.extinguisherNozzleAnchor.getWorldPosition(this.tempOrigin);
      activeMount.extinguisherNozzleAnchor.getWorldDirection(this.tempDir).negate().normalize();
      this.tempRight.crossVectors(this.tempDir, this.tempUp).normalize();
      this.co2Points.visible = true;
    }

    const isSprayCone = this.nozzleSprayMode === 'SPRAY';
    let anyCo2Alive = false;
    for (let i = 0; i < this.co2Count; i++) {
      this.co2Ages[i] += dt;
      const idx = i * 3;
      if (this.co2Ages[i] >= this.co2Lifetimes[i]) {
        if (sprayingNow && Math.random() < 0.48) {
          this.co2Ages[i] = 0;
          this.co2Lifetimes[i] = isSprayCone ? 0.30 + Math.random() * 0.22 : 0.38 + Math.random() * 0.25;
          this.co2Positions[idx] = this.tempOrigin.x;
          this.co2Positions[idx + 1] = this.tempOrigin.y;
          this.co2Positions[idx + 2] = this.tempOrigin.z;

          const spd = isSprayCone ? 3.8 + Math.random() * 1.6 : 5.8 + Math.random() * 2.2;
          const spreadMul = isSprayCone ? 1.85 : 0.52;
          const sx = (Math.random() - 0.5) * spreadMul;
          const sy = (Math.random() - 0.5) * spreadMul * 0.8;
          this.co2Velocities[idx] = this.tempDir.x * spd + this.tempRight.x * sx;
          this.co2Velocities[idx + 1] = this.tempDir.y * spd + sy;
          this.co2Velocities[idx + 2] = this.tempDir.z * spd + this.tempRight.z * sx;
          anyCo2Alive = true;
        } else {
          this.co2Positions[idx + 1] = -999;
        }
      } else {
        anyCo2Alive = true;
        this.co2Positions[idx] += this.co2Velocities[idx] * dt;
        this.co2Positions[idx + 1] += this.co2Velocities[idx + 1] * dt;
        this.co2Positions[idx + 2] += this.co2Velocities[idx + 2] * dt;
        this.co2Velocities[idx] *= 1 - dt * 1.6;
        this.co2Velocities[idx + 1] += dt * 0.5;
        this.co2Velocities[idx + 2] *= 1 - dt * 1.6;
      }
    }
    this.co2Points.visible = anyCo2Alive;
    if (anyCo2Alive) {
      this.co2Geo.attributes.position.needsUpdate = true;
    }

    // 3. Обновление частиц песка / сорбента лопаты
    let anySandAlive = false;
    for (let i = 0; i < this.sandCount; i++) {
      if (this.sandAges[i] < this.sandLifetimes[i]) {
        anySandAlive = true;
        this.sandAges[i] += dt;
        const idx = i * 3;
        this.sandPositions[idx] += this.sandVelocities[idx] * dt;
        this.sandPositions[idx + 1] += this.sandVelocities[idx + 1] * dt;
        this.sandPositions[idx + 2] += this.sandVelocities[idx + 2] * dt;
        this.sandVelocities[idx + 1] -= 5.4 * dt;
        if (this.sandPositions[idx + 1] < 0.02) {
          this.sandPositions[idx + 1] = 0.02;
          this.sandVelocities[idx] = 0;
          this.sandVelocities[idx + 1] = 0;
          this.sandVelocities[idx + 2] = 0;
        }
      } else {
        this.sandPositions[i * 3 + 1] = -999;
      }
    }
    this.sandPoints.visible = anySandAlive;
    if (anySandAlive) {
      this.sandGeo.attributes.position.needsUpdate = true;
    }
  }

  public dispose(): void {
    this.co2Geo.dispose();
    (this.co2Points.material as THREE.Material).dispose();
    this.sandGeo.dispose();
    (this.sandPoints.material as THREE.Material).dispose();
    this.scene.remove(this.co2Points);
    this.scene.remove(this.sandPoints);
  }
}
