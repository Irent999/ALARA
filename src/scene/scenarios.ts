/**
 * ALARA-Planner Pro VR — Библиотека из 4 оперативных 3D/VR-сценариев
 * радиационной безопасности и аварийно-спасательных работ МЧС на объектах АЭС:
 *
 * 1. Реакторный зал АЭС (разгерметизация, разведка ДП-5В, СИЗ, экранирование и эвакуация)
 * 2. Машинный зал / кабельный тоннель 6 кВ (обесточивание и тушение ОУ-5)
 * 3. Блочный пункт управления БПУ (авария SBO, резервный ввод 0.4 кВ и МДНУ-150)
 * 4. Комплекс АЭС (.glb) — тушение очагов пожара и поэтапная эвакуация персонала
 */

import * as THREE from 'three';
import {
  createHighDetailValve,
  createTK6Container,
  createLeadBrickStack,
  createMovableLeadShieldScreen,
  createRadiationBeacon,
  createBrushedMetalTexture,
  createIndustrialConcreteWallTexture,
  createEpoxyFloorTexture,
  createCleanroomWallTexture,
  createCleanroomFloorTexture,
  createQuarryGroundTexture,
  createHazardStripesTexture,
  createIndustrialCeilingLamp,
  createIndustrialCeilingTruss,
  createHotCellGlovebox
} from './proceduralModels';
import {
  createChemicalPuddleSSSMaterial,
  createCherenkovRadiationGlowMesh,
  createGaussianPlumeAerosolCloud,
  createGraphiteDebrisMaterial,
  createScorchedCorrodedMetalMaterial
} from './pbrMaterialEngine';
import {
  createEquipmentLabelTexture,
  createEvacCorridorSignTexture
} from './mchsTextures';
import { ShieldMaterialType } from '../physics/gostPhysics';
import { createLeadSarContainerDropZone } from './EvacuationManager';
import type { MchsToolId } from './ToolManager';
import type { HoldActionKind } from '../vr/InteractionHoldSystem';

export interface RadiationSourceInstance {
  id: string;
  position: THREE.Vector3;
  isotopeId: string;
  activityMBq: number;
  mesh?: THREE.Object3D;
  isLineSource?: boolean;
  lineLengthM?: number;
  lineDirection?: THREE.Vector3;
  enclosedInShield?: {
    material: ShieldMaterialType;
    thicknessCm: number;
  };
}

export interface ShieldingInstance {
  id: string;
  mesh: THREE.Object3D;
  material: ShieldMaterialType;
  thicknessCm: number;
  boundingBox: THREE.Box3;
}

export type ObjectPlacementType = 'floor' | 'prop';

export interface InteractiveHoldAction {
  kind: HoldActionKind;
  durationSec: number;
  labelRu: string;
  preferredToolId?: MchsToolId;
  requiredToolIds?: MchsToolId[];
}

export interface InteractiveObjectInstance {
  id: string;
  nameRu: string;
  type:
    | 'shield'
    | 'valve'
    | 'container'
    | 'source'
    | 'sample'
    | 'cover'
    | 'flashlight'
    | 'breaker'
    | 'extinguisher'
    | 'hydrant'
    | 'generator'
    | 'evac_point'
    | 'spill'
    | 'extractable'
    | 'casualty'
    | 'control_unit'
    | 'drop_zone';
  placementType: ObjectPlacementType;
  isLargeEquipment: boolean;
  mesh: THREE.Object3D;
  interacted: boolean;
  highlighted?: boolean;
  shieldMaterial?: ShieldMaterialType;
  shieldThicknessCm?: number;
  holdAction?: InteractiveHoldAction;
  requiresTongs?: boolean;
  linkedSourceId?: string;
}

export interface MissionStage {
  stepNumber: number;
  titleRu: string;
  taskRu: string;
  hintRu: string;
  alaraRuleRu: string;
}

export interface ScenarioDefinition {
  id: number;
  categoryRu: string;
  titleRu: string;
  shortDescriptionRu: string;
  facilityRu: string;
  dominantIsotopes: string[];
  recommendedPermitLimitMsv: number;
  initialPlayerPos: THREE.Vector3;
  ambientColor: number;
  fogColor: number;
  fogDensity: number;
  isLowLight?: boolean;
  hasAirborneContamination?: boolean;
  stages: MissionStage[];
  buildScene: (scene: THREE.Scene) => {
    sources: RadiationSourceInstance[];
    shields: ShieldingInstance[];
    interactive: InteractiveObjectInstance[];
    envGroup: THREE.Group;
  };
}

/**
 * Создает блок борированного полиэтилена / парафина (для замедления и поглощения нейтронов)
 */
function createBoratedParaffinWall(): THREE.Group {
  const group = new THREE.Group();
  const baseMat = new THREE.MeshStandardMaterial({
    color: 0x0284c7,
    roughness: 0.35,
    metalness: 0.1
  });
  const frameMat = new THREE.MeshStandardMaterial({
    color: 0x334155,
    roughness: 0.4,
    metalness: 0.8
  });

  // Плита из борированного полиэтилена (CH2 + 5% B4C) толщиной 12 см
  const slab = new THREE.Mesh(new THREE.BoxGeometry(1.3, 1.55, 0.14), baseMat);
  slab.position.y = 0.85;
  slab.castShadow = true;
  slab.receiveShadow = true;
  group.add(slab);

  // Стальная рама на роликах
  const standL = new THREE.Mesh(new THREE.BoxGeometry(0.08, 1.65, 0.5), frameMat);
  standL.position.set(-0.65, 0.825, 0);
  const standR = standL.clone();
  standR.position.x = 0.65;
  group.add(standL, standR);

  // Предупреждающая полоса
  const stripe = new THREE.Mesh(
    new THREE.BoxGeometry(1.32, 0.16, 0.15),
    new THREE.MeshBasicMaterial({ map: createHazardStripesTexture(256, 64) })
  );
  stripe.position.set(0, 1.5, 0);
  group.add(stripe);

  return group;
}

/**
 * Создаёт радиоактивную просыпь / пятно пролива для дезактивации лопатой БСЛ-110 и сорбентом
 */
function createContaminationSpillMesh(colorHex = 0x84cc16): THREE.Group {
  const group = new THREE.Group();
  const puddleMat = new THREE.MeshStandardMaterial({
    color: colorHex,
    emissive: colorHex,
    emissiveIntensity: 0.45,
    roughness: 0.25,
    metalness: 0.1,
    transparent: true,
    opacity: 0.86
  });

  const mainDisc = new THREE.Mesh(new THREE.CylinderGeometry(0.68, 0.74, 0.025, 28), puddleMat);
  mainDisc.position.y = 0.015;
  group.add(mainDisc);

  const lobe1 = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.36, 0.022, 18), puddleMat);
  lobe1.position.set(0.45, 0.013, 0.22);
  const lobe2 = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.30, 0.022, 18), puddleMat);
  lobe2.position.set(-0.38, 0.013, -0.28);
  group.add(lobe1, lobe2);

  // Горка сорбента / песка (постепенно проявляется при засыпке лопатой БСЛ-110)
  const sorbentMat = new THREE.MeshStandardMaterial({
    color: 0xd6b370,
    roughness: 0.95,
    metalness: 0.0,
    transparent: true,
    opacity: 0.0
  });
  const sorbentMound = new THREE.Mesh(new THREE.ConeGeometry(0.72, 0.22, 24), sorbentMat);
  sorbentMound.position.y = 0.02;
  sorbentMound.scale.set(1, 0.05, 1);
  sorbentMound.visible = false;
  group.add(sorbentMound);

  group.userData = {
    ...group.userData,
    puddleMeshes: [mainDisc, lobe1, lobe2],
    puddleMat,
    sorbentMound,
    sorbentMat,
    isDecontaminated: false
  };
  return group;
}

/**
 * Создаёт выпавший фрагмент ТВЭЛ / открытый ИИИ (требует захвата щипцами ЦМ-1.5!)
 */
function createExposedFuelPinMesh(): THREE.Group {
  const group = new THREE.Group();
  const metalMat = new THREE.MeshStandardMaterial({ color: 0x94a3b8, metalness: 0.88, roughness: 0.25 });
  const glowMat = new THREE.MeshStandardMaterial({
    color: 0x38bdf8,
    emissive: 0x0ea5e9,
    emissiveIntensity: 1.4,
    roughness: 0.2
  });
  const collarMat = new THREE.MeshStandardMaterial({ color: 0xfacc15, roughness: 0.35 });

  const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.028, 0.34, 18), metalMat);
  rod.rotation.z = Math.PI / 2;
  rod.castShadow = true;
  group.add(rod);

  const coreSlot = new THREE.Mesh(new THREE.CylinderGeometry(0.031, 0.031, 0.14, 18), glowMat);
  coreSlot.rotation.z = Math.PI / 2;
  group.add(coreSlot);

  const collar = new THREE.Mesh(new THREE.CylinderGeometry(0.036, 0.036, 0.04, 16), collarMat);
  collar.rotation.z = Math.PI / 2;
  collar.position.x = 0.11;
  group.add(collar);

  return group;
}

/**
 * Создаёт повреждённую бочку РАО с утечкой
 */
function createDamagedRaoDrumMesh(): THREE.Group {
  const group = new THREE.Group();
  const drumMat = new THREE.MeshStandardMaterial({ color: 0xeab308, roughness: 0.42, metalness: 0.45 });
  const dentMat = new THREE.MeshStandardMaterial({ color: 0x78350f, roughness: 0.7, metalness: 0.35 });

  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.24, 0.56, 22), drumMat);
  body.position.y = 0.28;
  body.castShadow = true;
  group.add(body);

  const lid = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.25, 0.05, 22), dentMat);
  lid.position.set(0.03, 0.56, 0);
  lid.rotation.z = 0.12;
  group.add(lid);

  const badge = new THREE.Mesh(
    new THREE.PlaneGeometry(0.28, 0.14),
    new THREE.MeshBasicMaterial({
      map: createEquipmentLabelTexture('РАО 200л', 'ПОВРЕЖДЕНИЕ', '#451a03', '#facc15')
    })
  );
  badge.position.set(0, 0.30, 0.245);
  group.add(badge);

  return group;
}

/**
 * Создаёт манекен пострадавшего оператора в СИЗ для эвакуации в безопасную зону
 */
function createInjuredOperatorMesh(): THREE.Group {
  const group = new THREE.Group();
  const suitMat = new THREE.MeshStandardMaterial({ color: 0xf97316, roughness: 0.55, metalness: 0.1 });
  const visorMat = new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.2, metalness: 0.6 });
  const bootMat = new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.8 });

  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.22, 0.62), suitMat);
  torso.position.set(0, 0.14, 0);
  torso.castShadow = true;
  group.add(torso);

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.13, 16, 16), suitMat);
  head.position.set(0, 0.16, -0.42);
  group.add(head);

  const visor = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.08, 0.06), visorMat);
  visor.position.set(0, 0.24, -0.45);
  group.add(visor);

  const legL = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.07, 0.58, 12), suitMat);
  legL.rotation.x = Math.PI / 2;
  legL.position.set(-0.11, 0.10, 0.58);
  const legR = legL.clone();
  legR.position.x = 0.11;
  group.add(legL, legR);

  const bootL = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.11, 0.18), bootMat);
  bootL.position.set(-0.11, 0.08, 0.88);
  const bootR = bootL.clone();
  bootR.position.x = 0.11;
  group.add(bootL, bootR);

  return group;
}

/**
 * Создаёт переносной критический блок управления АСУ ТП (для эвакуации в Сценарии 3)
 */
function createCriticalControlUnitMesh(): THREE.Group {
  const group = new THREE.Group();
  const caseMat = new THREE.MeshStandardMaterial({ color: 0x334155, roughness: 0.35, metalness: 0.72 });
  const accentMat = new THREE.MeshBasicMaterial({ color: 0x38bdf8 });

  const box = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.22, 0.28), caseMat);
  box.position.y = 0.11;
  box.castShadow = true;
  group.add(box);

  const led = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.04, 0.02), accentMat);
  led.position.set(0, 0.16, 0.145);
  group.add(led);

  const plate = new THREE.Mesh(
    new THREE.PlaneGeometry(0.32, 0.12),
    new THREE.MeshBasicMaterial({
      map: createEquipmentLabelTexture('БЛОК АСУ ТП', 'ЭВАКУИРОВАТЬ В САР', '#0f172a', '#38bdf8')
    })
  );
  plate.position.set(0, 0.08, 0.145);
  group.add(plate);

  return group;
}

export const SCENARIOS: ScenarioDefinition[] = [
  // =========================================================================================
  // 1. МЧС АЭС — СЦЕНАРИЙ №1: Радиационная авария / Выброс ГЦК ВВЭР-1200 и эвакуация
  // =========================================================================================
  {
    id: 1,
    categoryRu: 'МЧС России • Ликвидация ЧС на АЭС',
    titleRu: '1. МЧС АЭС: Радиационная авария / Выброс (ВВЭР-1200)',
    shortDescriptionRu:
      'Разгерметизация первого контура ВВЭР: разведка прибором ДП-5В, визуализация границ зон заражения (красная/желтая/зеленая), расчет дозы ALARA, установка экрана и выход по безопасному маршруту эвакуации.',
    facilityRu: 'Гермообъем реакторного отделения АЭС (Зона строгого режима)',
    dominantIsotopes: ['Co-60', 'Cs-137', 'Cf-252'],
    recommendedPermitLimitMsv: 0.25,
    initialPlayerPos: new THREE.Vector3(-1.5, 1.65, 5.0),
    ambientColor: 0xe2e8f0,
    fogColor: 0xdbeafe,
    fogDensity: 0.004,
    hasAirborneContamination: true,
    stages: [
      {
        stepNumber: 1,
        titleRu: 'Этап 1 из 5: Разведка прибором ДП-5В на границе зон',
        taskRu: 'Оцените мощность дозы на границе заражения (r > 3.0 м) прибором ДП-5В и определите контуры красной и желтой зон.',
        hintRu: 'Красные и желтые контурные кольца на полу показывают границы опасного выброса. Не входите в красную зону без СИЗ.',
        alaraRuleRu: 'Тактика МЧС: первичная радиационная разведка проводится на рубеже с контролем ДП-5В.'
      },
      {
        stepNumber: 2,
        titleRu: 'Этап 2 из 5: Экипировка хим- и радиозащиты (Л-1 / КИХ-4 + ГП-7ВМ)',
        taskRu: 'Убедитесь, что выбраны костюм Л-1 или КИХ-4 и противогаз ГП-7ВМ / АСВ-2 для защиты от радиоактивного аэрозольного выброса.',
        hintRu: 'Откройте меню экипировки (Esc / HUD -> СИЗ) и активируйте комплект химзащиты МЧС.',
        alaraRuleRu: 'Защита органов дыхания (СИЗОД) полностью исключает ингаляционное поступление аэрозолей Cs-137 и Co-60.'
      },
      {
        stepNumber: 3,
        titleRu: 'Этап 3 из 5: Локализация просыпи, ширма и клапан ГЦК',
        taskRu: 'Засыпьте радиоактивную просыпь лопатой [2] (удержание), перекройте клапан ГЦК [5] и извлеките выпавший ТВЭЛ щипцами [3] в контейнер САР.',
        hintRu: 'Выберите лопату БСЛ-110 [2] для просыпи, щипцы ЦМ-1.5 [3] для фрагмента ТВЭЛ (голыми руками — нарушение!) и ключ [5] для вентиля.',
        alaraRuleRu: 'Принцип ALARA: дистанционные щипцы (1/r²) и экранирование в САР снижают дозу на 95%.'
      },
      {
        stepNumber: 4,
        titleRu: 'Этап 4 из 5: Движение по безопасному маршруту эвакуации',
        taskRu: 'Следуйте по зеленому маркированному коридору вдоль правой стены в обход красной зоны выброса.',
        hintRu: 'Ориентируйтесь на зеленые напольные указатели «ВЫХОД / ЭВАКУАЦИЯ МЧС» справа от зоны выброса.',
        alaraRuleRu: 'Выбор оптимального маршрута с минимальной интегральной дозой H_accum.'
      },
      {
        stepNumber: 5,
        titleRu: 'Этап 5 из 5: Выход в санпропускник и сдача протокола ALARA',
        taskRu: 'Подойдите к эвакуационному шлюзу МЧС справа и активируйте его ([E] / курок VR) для завершения эвакуации.',
        hintRu: 'После выхода в чистую зону оформите итоговый протокол ALARA с расчетом накопленной дозы.',
        alaraRuleRu: 'Завершение операции РХБЗ с дозовой нагрузкой ниже предела наряда-допуска.'
      }
    ],
    buildScene: (scene: THREE.Scene) => {
      const envGroup = new THREE.Group();
      buildIndustrialRoom(envGroup, 16, 16, 5.2);

      const pipeMat = new THREE.MeshStandardMaterial({
        color: 0x94a3b8,
        metalness: 0.85,
        roughness: 0.2,
        map: createBrushedMetalTexture()
      });

      const mainPipe = new THREE.Mesh(new THREE.CylinderGeometry(0.38, 0.38, 13, 24), pipeMat);
      mainPipe.rotation.z = Math.PI / 2;
      mainPipe.position.set(-1.0, 1.8, -4.4);
      mainPipe.castShadow = true;
      envGroup.add(mainPipe);

      const pipeStripe = new THREE.Mesh(
        new THREE.CylinderGeometry(0.385, 0.385, 1.5, 24),
        new THREE.MeshBasicMaterial({ map: createHazardStripesTexture(256, 64) })
      );
      pipeStripe.rotation.z = Math.PI / 2;
      pipeStripe.position.set(-1.0, 1.8, -4.4);
      envGroup.add(pipeStripe);

      const valveMesh = createHighDetailValve();
      valveMesh.position.set(-1.0, 1.8, -4.4);
      valveMesh.rotation.x = Math.PI / 2;
      envGroup.add(valveMesh);

      const beacon = createRadiationBeacon('danger');
      beacon.position.set(1.6, 3.3, -4.4);
      envGroup.add(beacon);

      // Визуальное свечение Черенкова + облако радиоактивного выброса
      const cherenkovGlow = createCherenkovRadiationGlowMesh(0.85);
      cherenkovGlow.position.set(-1.0, 1.8, -4.2);
      envGroup.add(cherenkovGlow);

      const aerosolPlume = createGaussianPlumeAerosolCloud(0xfbbf24, 3.8);
      aerosolPlume.position.set(-1.0, 1.5, -3.4);
      envGroup.add(aerosolPlume);

      // Обломки реакторного графита
      const graphiteMat = createGraphiteDebrisMaterial();
      for (let i = 0; i < 6; i++) {
        const block = new THREE.Mesh(
          new THREE.DodecahedronGeometry(0.09 + (i % 3) * 0.03, 1),
          graphiteMat
        );
        block.position.set(-2.1 + i * 0.42, 0.06, -3.5 + (i % 2) * 0.35);
        block.rotation.set(i * 0.5, i * 0.8, 0.2);
        block.castShadow = true;
        envGroup.add(block);
      }

      // 3D-ВИЗУАЛИЗАЦИЯ ГРАНИЦ ЗОН ЗАРАЖЕНИЯ (Красная, Желтая, Зеленая границы)
      const zoneBoundariesGroup = new THREE.Group();
      zoneBoundariesGroup.position.set(-1.0, 0.018, -3.8);
      const zoneSpecs = [
        { inner: 2.85, outer: 3.0, color: 0xef4444, opacity: 0.72 },
        { inner: 4.85, outer: 5.0, color: 0xfacc15, opacity: 0.58 },
        { inner: 6.75, outer: 6.9, color: 0x22c55e, opacity: 0.50 }
      ];
      zoneSpecs.forEach(zSpec => {
        const ringGeo = new THREE.RingGeometry(zSpec.inner, zSpec.outer, 64);
        const ringMat = new THREE.MeshBasicMaterial({
          color: zSpec.color,
          transparent: true,
          opacity: zSpec.opacity,
          side: THREE.DoubleSide
        });
        const ring = new THREE.Mesh(ringGeo, ringMat);
        ring.rotation.x = -Math.PI / 2;
        zoneBoundariesGroup.add(ring);
      });
      zoneBoundariesGroup.userData.isContaminationZoneGroup = true;
      envGroup.add(zoneBoundariesGroup);

      // БЕЗОПАСНЫЙ МАРШРУТ ЭВАКУАЦИИ (Зеленый коридор + указатели МЧС)
      const evacArrows: THREE.Mesh[] = [];
      const arrowMat = new THREE.MeshBasicMaterial({
        color: 0x10b981,
        transparent: true,
        opacity: 0.85,
        side: THREE.DoubleSide
      });
      for (let idx = 0; idx < 5; idx++) {
        const arrow = new THREE.Mesh(new THREE.PlaneGeometry(0.55, 0.9), arrowMat);
        arrow.rotation.x = -Math.PI / 2;
        arrow.position.set(4.5, 0.022, 4.0 - idx * 1.85);
        envGroup.add(arrow);
        evacArrows.push(arrow);
      }
      envGroup.userData.evacArrows = evacArrows;

      // Эвакуационный шлюз / пост выхода в чистую зону
      const evacGroup = new THREE.Group();
      evacGroup.position.set(4.8, 0, -4.6);
      const portalFrameMat = new THREE.MeshStandardMaterial({
        color: 0x065f46,
        roughness: 0.3,
        metalness: 0.55
      });
      const postL = new THREE.Mesh(new THREE.BoxGeometry(0.22, 2.4, 0.22), portalFrameMat);
      postL.position.set(-0.85, 1.2, 0);
      const postR = postL.clone();
      postR.position.x = 0.85;
      const lintel = new THREE.Mesh(new THREE.BoxGeometry(1.92, 0.42, 0.26), portalFrameMat);
      lintel.position.set(0, 2.35, 0);
      evacGroup.add(postL, postR, lintel);

      const evacSign = new THREE.Mesh(
        new THREE.PlaneGeometry(1.75, 0.58),
        new THREE.MeshBasicMaterial({ map: createEvacCorridorSignTexture('ВЫХОД • ЭВАКУАЦИЯ') })
      );
      evacSign.position.set(0, 2.35, 0.14);
      evacGroup.add(evacSign);

      const evacGateGlow = new THREE.Mesh(
        new THREE.PlaneGeometry(1.48, 2.1),
        new THREE.MeshBasicMaterial({
          color: 0x34d399,
          transparent: true,
          opacity: 0.24,
          side: THREE.DoubleSide
        })
      );
      evacGateGlow.position.set(0, 1.05, 0);
      evacGroup.add(evacGateGlow);
      evacGroup.userData = {
        ...evacGroup.userData,
        interactiveId: 'evac_beacon',
        placementType: 'floor',
        isLargeEquipment: true
      };
      envGroup.add(evacGroup);

      // Передвижная свинцовая ширма
      const shieldMesh = createMovableLeadShieldScreen();
      shieldMesh.position.set(-3.4, 0, -1.0);
      shieldMesh.userData = {
        ...shieldMesh.userData,
        interactiveId: 'screen_shield',
        placementType: 'floor',
        isLargeEquipment: true
      };
      envGroup.add(shieldMesh);

      // Радиоактивная просыпь для дезактивации лопатой БСЛ-110 [2]
      const spillMesh = createContaminationSpillMesh(0x84cc16);
      spillMesh.position.set(-1.3, 0, -2.2);
      envGroup.add(spillMesh);

      // Выпавший фрагмент ТВЭЛ / ИИИ (требует дистанционных щипцов ЦМ-1.5 [3])
      const fuelPinMesh = createExposedFuelPinMesh();
      fuelPinMesh.position.set(-0.35, 0.04, -2.95);
      envGroup.add(fuelPinMesh);

      // Безопасная зона эвакуации: свинцовый контейнер САР-1
      const sarDropZoneS1 = createLeadSarContainerDropZone('КОНТЕЙНЕР САР-1', 'ИЗОЛЯЦИЯ ТВЭЛ / ИИИ');
      sarDropZoneS1.position.set(2.8, 0, -1.5);
      envGroup.add(sarDropZoneS1);

      scene.add(envGroup);

      return {
        envGroup,
        sources: [
          {
            id: 'src_vver_co60',
            position: new THREE.Vector3(-1.0, 1.8, -4.2),
            isotopeId: 'Co-60',
            activityMBq: 48000,
            isLineSource: true,
            lineLengthM: 4.5
          },
          {
            id: 'src_vver_neutron',
            position: new THREE.Vector3(-3.0, 1.8, -4.3),
            isotopeId: 'Cf-252',
            activityMBq: 1800
          },
          {
            id: 'src_vver_spill_cs137',
            position: new THREE.Vector3(-1.3, 0.05, -2.2),
            isotopeId: 'Cs-137',
            activityMBq: 4500,
            mesh: spillMesh
          },
          {
            id: 'src_vver_fuel_pin',
            position: new THREE.Vector3(-0.35, 0.05, -2.95),
            isotopeId: 'Co-60',
            activityMBq: 9500,
            mesh: fuelPinMesh
          }
        ],
        shields: [
          {
            id: 'lead_screen',
            mesh: shieldMesh,
            material: 'lead',
            thicknessCm: 2.5,
            boundingBox: new THREE.Box3().setFromObject(shieldMesh)
          }
        ],
        interactive: [
          {
            id: 'screen_shield',
            nameRu: 'Передвижная свинцовая ширма 25 мм Pb',
            type: 'shield',
            placementType: 'floor',
            isLargeEquipment: true,
            shieldMaterial: 'lead',
            shieldThicknessCm: 2.5,
            mesh: shieldMesh,
            interacted: false
          },
          {
            id: 'reactor_valve',
            nameRu: 'Запорный клапан аварийного контура ГЦК',
            type: 'valve',
            placementType: 'floor',
            isLargeEquipment: true,
            mesh: valveMesh,
            interacted: false,
            holdAction: {
              kind: 'valve',
              durationSec: 3.0,
              labelRu: 'Перекрытие запорного клапана ГЦК',
              preferredToolId: 'wrench'
            }
          },
          {
            id: 'spill_vver_sorbent',
            nameRu: 'Очаг просыпи Cs-137 (дезактивация сорбентом)',
            type: 'spill',
            placementType: 'floor',
            isLargeEquipment: true,
            mesh: spillMesh,
            interacted: false,
            linkedSourceId: 'src_vver_spill_cs137',
            holdAction: {
              kind: 'decontaminate',
              durationSec: 3.0,
              labelRu: 'Засыпка просыпи сорбентом (БСЛ-110)',
              preferredToolId: 'shovel'
            }
          },
          {
            id: 'fuel_pin_source',
            nameRu: 'Выпавший ТВЭЛ / ИИИ Co-60 (Щипцы ЦМ-1.5 [3])',
            type: 'extractable',
            placementType: 'prop',
            isLargeEquipment: false,
            mesh: fuelPinMesh,
            interacted: false,
            requiresTongs: true,
            linkedSourceId: 'src_vver_fuel_pin'
          },
          {
            id: 'sar_drop_zone_s1',
            nameRu: 'Свинцовый контейнер САР-1 (Безопасная зона)',
            type: 'drop_zone',
            placementType: 'floor',
            isLargeEquipment: true,
            shieldMaterial: 'lead',
            shieldThicknessCm: 10.0,
            mesh: sarDropZoneS1,
            interacted: false
          },
          {
            id: 'evac_beacon',
            nameRu: 'Шлюз эвакуации МЧС (Чистая зона)',
            type: 'evac_point',
            placementType: 'floor',
            isLargeEquipment: true,
            mesh: evacGroup,
            interacted: false
          }
        ]
      };
    }
  },

  // =========================================================================================
  // 2. МЧС АЭС — СЦЕНАРИЙ №2: Пожар на энергоблоке (Кабельные трассы 6 кВ под напряжением)
  // =========================================================================================
  {
    id: 2,
    categoryRu: 'МЧС России • Ликвидация ЧС на АЭС',
    titleRu: '2. МЧС АЭС: Пожар в кабельном отсеке под напряжением (6 кВ)',
    shortDescriptionRu:
      'Возгорание высоковольтных кабельных трасс 6 кВ в турбинном/кабельном отсеке. Экипировка БОП-1, обесточивание силовым рубильником, диэлектрическое тушение ОУ-5 (запрет воды под напряжением!) и контроль фона.',
    facilityRu: 'Кабельная полуэтажка и турбинный цех энергоблока АЭС',
    dominantIsotopes: ['Cs-137', 'Co-60'],
    recommendedPermitLimitMsv: 0.18,
    initialPlayerPos: new THREE.Vector3(0, 1.65, 4.6),
    ambientColor: 0xf1f5f9,
    fogColor: 0x332b26,
    fogDensity: 0.012,
    hasAirborneContamination: true,
    stages: [
      {
        stepNumber: 1,
        titleRu: 'Этап 1 из 4: Экипировка БОП-1 МЧС и разведка ДП-5В',
        taskRu: 'Экипируйте Боевую одежду пожарного (БОП-1) и панорамную маску ППМ-88 / АСВ-2, оцените фон у горящих лотков 6 кВ.',
        hintRu: 'Откройте меню (Esc) -> пресет «Пожарный расчёт БОП-1». БОП защищает от теплового потока до 350°C и пробоя до 10 кВ.',
        alaraRuleRu: 'Совмещенный пожарно-радиационный допуск МЧС: БОП-1 + СИЗОД при горении кабельной изоляции.'
      },
      {
        stepNumber: 2,
        titleRu: 'Этап 2 из 4: Обесточивание кабельной трассы 6 кВ',
        taskRu: 'Подойдите к силовому шкафу рубильника 6 кВ слева и снимите напряжение ([E] / курок VR).',
        hintRu: 'Пока горит синяя электродуга — кабели под напряжением 6 кВ! Подача воды строго запрещена и смертельно опасна.',
        alaraRuleRu: 'Боевой устав пожарной охраны на АЭС: первоочередное обесточивание кабельных отсеков перед тушением.'
      },
      {
        stepNumber: 3,
        titleRu: 'Этап 3 из 4: Тушение очага ОУ-5 [4] и эвакуация из зоны',
        taskRu: 'Выберите огнетушитель ОУ-5 [4] и удерживайте [E] / ЛКМ на очаге пламени, затем эвакуируйте пострадавшего и бочку РАО в зону САР.',
        hintRu: 'Удерживайте ОУ-5 [4] на огне 3.5 сек до полного сбития пламени. Для бочки РАО используйте щипцы [3].',
        alaraRuleRu: 'Локализация пожара исключает вынос радиоактивных продуктов горения (Cs-137) в вентиляцию блока.'
      },
      {
        stepNumber: 4,
        titleRu: 'Этап 4 из 4: Эвакуация пострадавшего и сдача протокола ALARA',
        taskRu: 'Убедитесь, что пламя и дуга ликвидированы, пострадавший и бочка РАО в безопасной зоне САР, и оформите отчет ALARA.',
        hintRu: 'Нажмите «ALARA Отчет» в меню «Практикум» после ликвидации горения и эвакуации.',
        alaraRuleRu: 'Документирование дозовых нагрузок пожарно-спасательного звена МЧС.'
      }
    ],
    buildScene: (scene: THREE.Scene) => {
      const envGroup = new THREE.Group();
      buildIndustrialRoom(envGroup, 16, 14, 4.8);

      const rackSteelMat = new THREE.MeshStandardMaterial({
        color: 0x475569,
        metalness: 0.8,
        roughness: 0.35
      });
      const scorchedCableMat = createScorchedCorrodedMetalMaterial();

      // Многоярусная кабельная эстакада 6 кВ в глубине отсека
      const trayGroup = new THREE.Group();
      trayGroup.position.set(0, 0, -3.2);
      for (const xPost of [-2.4, 0, 2.4]) {
        const pillar = new THREE.Mesh(new THREE.BoxGeometry(0.14, 3.2, 0.14), rackSteelMat);
        pillar.position.set(xPost, 1.6, 0);
        pillar.castShadow = true;
        trayGroup.add(pillar);
      }
      for (const tierY of [1.15, 1.85, 2.55]) {
        const trayShelf = new THREE.Mesh(new THREE.BoxGeometry(5.6, 0.08, 0.72), rackSteelMat);
        trayShelf.position.set(0, tierY, 0);
        trayGroup.add(trayShelf);

        for (let c = -2; c <= 2; c++) {
          const cable = new THREE.Mesh(
            new THREE.CylinderGeometry(0.042, 0.042, 5.5, 12),
            c === 0 ? scorchedCableMat : new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.7 })
          );
          cable.rotation.z = Math.PI / 2;
          cable.position.set(0, tierY + 0.07, c * 0.12);
          trayGroup.add(cable);
        }
      }

      const traySign = new THREE.Mesh(
        new THREE.PlaneGeometry(1.9, 0.65),
        new THREE.MeshBasicMaterial({
          map: createEquipmentLabelTexture('ЭСТАКАДА 6 кВ', 'ОПАСНО! ВЫСОКОЕ НАПРЯЖЕНИЕ', '#1e1b4b', '#facc15')
        })
      );
      traySign.position.set(0, 3.05, 0.38);
      trayGroup.add(traySign);
      envGroup.add(trayGroup);

      // Процедурное 3D-пламя и дым на горящей кабельной полке
      const fireGroup = new THREE.Group();
      fireGroup.position.set(0.3, 1.25, -3.0);
      const flameFlames: THREE.Mesh[] = [];
      const flameColors = [0xf97316, 0xfacc15, 0xef4444, 0xfb923c, 0xfde047];
      for (let i = 0; i < 8; i++) {
        const cone = new THREE.Mesh(
          new THREE.ConeGeometry(0.18 + (i % 3) * 0.07, 0.75 + (i % 4) * 0.24, 12),
          new THREE.MeshBasicMaterial({
            color: flameColors[i % flameColors.length],
            transparent: true,
            opacity: 0.85
          })
        );
        cone.position.set((i - 3.5) * 0.28, 0.35 + (i % 2) * 0.18, (i % 2 === 0 ? 0.1 : -0.1));
        fireGroup.add(cone);
        flameFlames.push(cone);
      }

      const smokePuffs: THREE.Mesh[] = [];
      const smokeMat = new THREE.MeshStandardMaterial({
        color: 0x1f2937,
        transparent: true,
        opacity: 0.45,
        roughness: 1.0
      });
      for (let i = 0; i < 6; i++) {
        const puff = new THREE.Mesh(new THREE.SphereGeometry(0.32 + i * 0.05, 12, 12), smokeMat);
        puff.position.set((i - 2.5) * 0.35, 1.1 + i * 0.32, 0);
        fireGroup.add(puff);
        smokePuffs.push(puff);
      }

      const fireLight = new THREE.PointLight(0xf97316, 4.5, 10, 1.5);
      fireLight.position.set(0, 0.8, 0.4);
      fireGroup.add(fireLight);

      // Искры электрической дуги 6 кВ
      const sparkGroup = new THREE.Group();
      const sparkMat = new THREE.MeshBasicMaterial({ color: 0x38bdf8 });
      for (let i = 0; i < 5; i++) {
        const arc = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.28, 0.03), sparkMat);
        arc.position.set((i - 2) * 0.35, 0.68, 0.18);
        arc.rotation.z = (i - 2) * 0.4;
        sparkGroup.add(arc);
      }
      fireGroup.add(sparkGroup);
      envGroup.add(fireGroup);

      // Состояние пожара для интерактивной логики и анимации
      envGroup.userData.fireSimulation = {
        fireGroup,
        flameFlames,
        smokePuffs,
        fireLight,
        sparkGroup,
        isPowerEnergized: true,
        isFireExtinguished: false
      };

      // 1. Силовой шкаф-рубильник 6 кВ (слева)
      const breakerGroup = new THREE.Group();
      breakerGroup.position.set(-3.8, 0, -1.4);
      const cabinet = new THREE.Mesh(
        new THREE.BoxGeometry(0.85, 1.95, 0.62),
        new THREE.MeshStandardMaterial({ color: 0x334155, roughness: 0.45, metalness: 0.65 })
      );
      cabinet.position.y = 0.975;
      cabinet.castShadow = true;
      breakerGroup.add(cabinet);

      const breakerSign = new THREE.Mesh(
        new THREE.PlaneGeometry(0.72, 0.28),
        new THREE.MeshBasicMaterial({
          map: createEquipmentLabelTexture('РУБИЛЬНИК 6 кВ', 'ОТКЛЮЧИТЬ ПИТАНИЕ', '#0f172a', '#ef4444')
        })
      );
      breakerSign.position.set(0, 1.62, 0.32);
      breakerGroup.add(breakerSign);

      const breakerHandle = new THREE.Mesh(
        new THREE.BoxGeometry(0.10, 0.42, 0.14),
        new THREE.MeshStandardMaterial({ color: 0xef4444, roughness: 0.3, metalness: 0.4 })
      );
      breakerHandle.position.set(0.24, 1.18, 0.34);
      breakerGroup.add(breakerHandle);

      const breakerLed = new THREE.Mesh(
        new THREE.SphereGeometry(0.06, 16, 16),
        new THREE.MeshBasicMaterial({ color: 0xef4444 })
      );
      breakerLed.position.set(-0.22, 1.32, 0.32);
      breakerGroup.add(breakerLed);
      breakerGroup.userData = {
        ...breakerGroup.userData,
        interactiveId: 'power_breaker',
        breakerHandle,
        breakerLed,
        placementType: 'floor',
        isLargeEquipment: true
      };
      envGroup.add(breakerGroup);

      // 2. Углекислотный огнетушитель ОУ-5 (Диэлектрический)
      const co2Group = new THREE.Group();
      co2Group.position.set(-1.5, 0, 1.4);
      const cylMat = new THREE.MeshStandardMaterial({ color: 0xdc2626, roughness: 0.28, metalness: 0.45 });
      const cylBody = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, 0.72, 24), cylMat);
      cylBody.position.y = 0.38;
      cylBody.castShadow = true;
      co2Group.add(cylBody);

      const cylNeck = new THREE.Mesh(new THREE.SphereGeometry(0.11, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2), cylMat);
      cylNeck.position.y = 0.74;
      co2Group.add(cylNeck);

      const horn = new THREE.Mesh(
        new THREE.ConeGeometry(0.09, 0.24, 18),
        new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.6 })
      );
      horn.rotation.x = Math.PI / 3;
      horn.position.set(0.12, 0.80, -0.18);
      co2Group.add(horn);

      const co2Tag = new THREE.Mesh(
        new THREE.PlaneGeometry(0.46, 0.18),
        new THREE.MeshBasicMaterial({
          map: createEquipmentLabelTexture('ОУ-5 (CO₂)', 'ДИЭЛЕКТРИК ДО 10 кВ', '#450a0a', '#4ade80')
        })
      );
      co2Tag.position.set(0, 1.05, 0);
      co2Group.add(co2Tag);
      co2Group.userData = {
        ...co2Group.userData,
        interactiveId: 'co2_extinguisher',
        placementType: 'floor',
        isLargeEquipment: false
      };
      envGroup.add(co2Group);

      // 3. Водяной пожарный кран-ствол ПК-50 (ОПАСНО при 6 кВ!)
      const hydrantGroup = new THREE.Group();
      hydrantGroup.position.set(3.8, 0, 0.8);
      const hydBox = new THREE.Mesh(
        new THREE.BoxGeometry(0.75, 1.15, 0.36),
        new THREE.MeshStandardMaterial({ color: 0x991b1b, roughness: 0.38, metalness: 0.3 })
      );
      hydBox.position.y = 0.72;
      hydBox.castShadow = true;
      hydrantGroup.add(hydBox);

      const hydSign = new THREE.Mesh(
        new THREE.PlaneGeometry(0.66, 0.26),
        new THREE.MeshBasicMaterial({
          map: createEquipmentLabelTexture('ПОЖАРНЫЙ КРАН (ВОДА)', 'ЗАПРЕЩЕНО ПОД 6 кВ!', '#7f1d1d', '#fde047')
        })
      );
      hydSign.position.set(0, 1.02, 0.19);
      hydrantGroup.add(hydSign);
      hydrantGroup.userData = {
        ...hydrantGroup.userData,
        interactiveId: 'water_hydrant',
        placementType: 'floor',
        isLargeEquipment: true
      };
      envGroup.add(hydrantGroup);

      // 4. Невидимая коллайдер-зона самого очага пожара на эстакаде (для тушения струёй ОУ-5 [4] прямо по пламени)
      const fireTargetHitbox = new THREE.Mesh(
        new THREE.BoxGeometry(2.4, 1.4, 1.1),
        new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.0, depthWrite: false })
      );
      fireTargetHitbox.position.set(0.3, 1.55, -3.0);
      envGroup.add(fireTargetHitbox);

      // 5. Повреждённая бочка РАО (для эвакуации щипцами ЦМ-1.5 [3] в контейнер САР)
      const raoDrumMesh = createDamagedRaoDrumMesh();
      raoDrumMesh.position.set(1.85, 0, -1.9);
      envGroup.add(raoDrumMesh);

      // 6. Пострадавший оператор (манекен для эвакуации в безопасную зону)
      const injuredMesh = createInjuredOperatorMesh();
      injuredMesh.position.set(-1.9, 0, -2.4);
      envGroup.add(injuredMesh);

      // 7. Безопасная зона эвакуации и контейнер САР-2
      const sarDropZoneS2 = createLeadSarContainerDropZone('ЗОНА САР-2 • ЭВАК.', 'БОЧКА РАО / ПОСТРАДАВШИЙ');
      sarDropZoneS2.position.set(3.4, 0, 2.7);
      envGroup.add(sarDropZoneS2);

      scene.add(envGroup);

      return {
        envGroup,
        sources: [
          {
            id: 'src_fire_cs137',
            position: new THREE.Vector3(0.3, 1.4, -3.0),
            isotopeId: 'Cs-137',
            activityMBq: 16500
          },
          {
            id: 'src_fire_rao_drum',
            position: new THREE.Vector3(1.85, 0.3, -1.9),
            isotopeId: 'Co-60',
            activityMBq: 6200,
            mesh: raoDrumMesh
          }
        ],
        shields: [],
        interactive: [
          {
            id: 'power_breaker',
            nameRu: 'Силовой рубильник отключения кабельной трассы 6 кВ',
            type: 'breaker',
            placementType: 'floor',
            isLargeEquipment: true,
            mesh: breakerGroup,
            interacted: false,
            holdAction: {
              kind: 'breaker',
              durationSec: 2.0,
              labelRu: 'Отключение рубильника 6 кВ',
              preferredToolId: 'wrench'
            }
          },
          {
            id: 'co2_extinguisher',
            nameRu: 'Диэлектрический углекислотный огнетушитель ОУ-5',
            type: 'extinguisher',
            placementType: 'floor',
            isLargeEquipment: false,
            mesh: co2Group,
            interacted: false,
            holdAction: {
              kind: 'extinguish',
              durationSec: 3.5,
              labelRu: 'Тушение очага ОУ-5 (CO₂)',
              preferredToolId: 'extinguisher'
            }
          },
          {
            id: 'fire_tray_target',
            nameRu: 'Очаг возгорания кабельной эстакады 6 кВ',
            type: 'extinguisher',
            placementType: 'floor',
            isLargeEquipment: true,
            mesh: fireTargetHitbox,
            interacted: false,
            holdAction: {
              kind: 'extinguish',
              durationSec: 3.5,
              labelRu: 'Ликвидация пламени струёй ОУ-5 [4]',
              preferredToolId: 'extinguisher'
            }
          },
          {
            id: 'water_hydrant',
            nameRu: 'Водяной пожарный ствол ПК-50 (Вода — опасна под 6 кВ!)',
            type: 'hydrant',
            placementType: 'floor',
            isLargeEquipment: true,
            mesh: hydrantGroup,
            interacted: false
          },
          {
            id: 'damaged_rao_drum',
            nameRu: 'Повреждённая бочка РАО (Щипцы ЦМ-1.5 [3])',
            type: 'extractable',
            placementType: 'floor',
            isLargeEquipment: true,
            mesh: raoDrumMesh,
            interacted: false,
            requiresTongs: true,
            linkedSourceId: 'src_fire_rao_drum'
          },
          {
            id: 'injured_operator',
            nameRu: 'Пострадавший оператор в СИЗ (Эвакуация в САР)',
            type: 'casualty',
            placementType: 'floor',
            isLargeEquipment: true,
            mesh: injuredMesh,
            interacted: false
          },
          {
            id: 'sar_drop_zone_s2',
            nameRu: 'Безопасная зона эвакуации САР-2',
            type: 'drop_zone',
            placementType: 'floor',
            isLargeEquipment: true,
            shieldMaterial: 'lead',
            shieldThicknessCm: 10.0,
            mesh: sarDropZoneS2,
            interacted: false
          }
        ]
      };
    }
  },

  // =========================================================================================
  // 3. МЧС АЭС — СЦЕНАРИЙ №3: Отказ систем питания SBO (Обесточивание БПУ АЭС)
  // =========================================================================================
  {
    id: 3,
    categoryRu: 'МЧС России • Ликвидация ЧС на АЭС',
    titleRu: '3. МЧС АЭС: Отказ систем питания SBO (Обесточивание БПУ)',
    shortDescriptionRu:
      'Полное обесточивание Блочного пункта управления (Station Blackout): ориентирование в темноте с фонарем, высокий фон, подключение аварийного кабеля и запуск мобильной дизель-насосной установки МДНУ-150 в жестком дефиците времени.',
    facilityRu: 'Блочный пункт управления (БПУ) и площадка резервного питания АЭС',
    dominantIsotopes: ['Co-60', 'Cf-252'],
    recommendedPermitLimitMsv: 0.22,
    initialPlayerPos: new THREE.Vector3(0, 1.65, 4.4),
    ambientColor: 0x0f172a,
    fogColor: 0x020617,
    fogDensity: 0.028,
    isLowLight: true,
    stages: [
      {
        stepNumber: 1,
        titleRu: 'Этап 1 из 4: Ориентирование в обесточенном БПУ с фонарем',
        taskRu: 'Используйте тактический фонарь ([F] / кнопка Y) в затемненном БПУ и оцените радиационный фон прибором ДП-5В.',
        hintRu: 'При полном обесточивании (SBO) работает только аварийная красная сигнализация. Контролируйте время T_max!',
        alaraRuleRu: 'Работа в условиях ограниченной видимости при жестком лимите времени на расхолаживание активной зоны.'
      },
      {
        stepNumber: 2,
        titleRu: 'Этап 2 из 4: Подключение силового кабеля аварийного ввода',
        taskRu: 'Подойдите к распределительному щиту резервного ввода слева и подключите силовой кабель МДНУ ([E] / курок VR).',
        hintRu: 'Шкаф «ВВОД РЕЗЕРВА 0.4 кВ» расположен слева от пультов БПУ.',
        alaraRuleRu: 'Сборка временной схемы электроснабжения собственных нужд первой категории.'
      },
      {
        stepNumber: 3,
        titleRu: 'Этап 3 из 4: Запуск мобильной дизель-насосной установки МДНУ-150',
        taskRu: 'Активируйте передвижную дизель-насосную установку МДНУ-150 справа ([E] / курок VR) для подачи питания на БПУ.',
        hintRu: 'После запуска МДНУ пульты БПУ перейдут с аварийного красного режима на резервное питание.',
        alaraRuleRu: 'Обеспечение питания КИПиА и насосов подпитки при отказе стационарных ДГ.'
      },
      {
        stepNumber: 4,
        titleRu: 'Этап 4 из 4: Задвижка ПГ, дезактивация [2] и эвакуация блока АСУ ТП',
        taskRu: 'Откройте задвижку ПГ (удерживайте [E] с ключом [5]), засыпьте пролив лопатой [2] и перенесите блок АСУ ТП в зону САР.',
        hintRu: 'Когда индикаторы пультов БПУ станут зелеными — режим SBO ликвидирован, сдайте отчет ALARA.',
        alaraRuleRu: 'Восстановление отвода остаточного тепловыделения с соблюдением нормативов дозы НРБ-99/2009.'
      }
    ],
    buildScene: (scene: THREE.Scene) => {
      const envGroup = new THREE.Group();
      buildIndustrialRoom(envGroup, 16, 14, 4.6);

      // Главный пульт БПУ АЭС (П-образный операторский стол + вертикальное мнемотабло)
      const consoleBodyMat = new THREE.MeshStandardMaterial({
        color: 0x1e293b,
        roughness: 0.5,
        metalness: 0.45
      });
      const mainDesk = new THREE.Mesh(new THREE.BoxGeometry(5.8, 0.92, 1.15), consoleBodyMat);
      mainDesk.position.set(0, 0.46, -2.5);
      mainDesk.castShadow = true;
      envGroup.add(mainDesk);

      const mimicPanel = new THREE.Mesh(new THREE.BoxGeometry(6.2, 2.2, 0.35), consoleBodyMat);
      mimicPanel.position.set(0, 1.5, -4.1);
      mimicPanel.castShadow = true;
      envGroup.add(mimicPanel);

      // Дисплеи БПУ (темные в режиме SBO, переключаются при восстановлении питания)
      const sboScreenMat = new THREE.MeshBasicMaterial({
        map: createEquipmentLabelTexture('БПУ • БЛОК №1', 'SBO: ПОТЕРЯ ПИТАНИЯ!', '#1f0808', '#ef4444')
      });
      const sboScreenMesh = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 1.25), sboScreenMat);
      sboScreenMesh.position.set(0, 1.65, -3.91);
      envGroup.add(sboScreenMesh);

      const deskIndicatorMat = new THREE.MeshBasicMaterial({ color: 0x991b1b });
      const deskStrip = new THREE.Mesh(new THREE.BoxGeometry(5.4, 0.06, 0.25), deskIndicatorMat);
      deskStrip.position.set(0, 0.94, -2.35);
      envGroup.add(deskStrip);

      // Аварийный мигающий маячок БПУ
      const emergencyLight = new THREE.PointLight(0xef4444, 2.2, 9, 1.6);
      emergencyLight.position.set(0, 3.6, -2.2);
      envGroup.add(emergencyLight);

      // 1. Шкаф ввода резервного кабеля 0.4 кВ (слева)
      const cableBoxGroup = new THREE.Group();
      cableBoxGroup.position.set(-4.0, 0, -1.2);
      const boxMesh = new THREE.Mesh(
        new THREE.BoxGeometry(0.9, 1.7, 0.6),
        new THREE.MeshStandardMaterial({ color: 0x334155, roughness: 0.4, metalness: 0.7 })
      );
      boxMesh.position.y = 0.85;
      cableBoxGroup.add(boxMesh);

      const cableLabel = new THREE.Mesh(
        new THREE.PlaneGeometry(0.76, 0.30),
        new THREE.MeshBasicMaterial({
          map: createEquipmentLabelTexture('ВВОД 0.4 кВ', 'ПОДКЛЮЧИТЬ КАБЕЛЬ МДНУ', '#0f172a', '#f59e0b')
        })
      );
      cableLabel.position.set(0, 1.42, 0.31);
      cableBoxGroup.add(cableLabel);

      const cablePlugLed = new THREE.Mesh(
        new THREE.SphereGeometry(0.065, 16, 16),
        new THREE.MeshBasicMaterial({ color: 0xf59e0b })
      );
      cablePlugLed.position.set(0.28, 1.12, 0.31);
      cableBoxGroup.add(cablePlugLed);
      cableBoxGroup.userData = {
        ...cableBoxGroup.userData,
        interactiveId: 'sbo_power_cable',
        cablePlugLed,
        placementType: 'floor',
        isLargeEquipment: true
      };
      envGroup.add(cableBoxGroup);

      // 2. Мобильная дизель-насосная установка МДНУ-150 (справа)
      const mdnuGroup = new THREE.Group();
      mdnuGroup.position.set(3.8, 0, -1.4);
      const mdnuChassis = new THREE.Mesh(
        new THREE.BoxGeometry(1.45, 1.25, 2.2),
        new THREE.MeshStandardMaterial({ color: 0xea580c, roughness: 0.38, metalness: 0.42 })
      );
      mdnuChassis.position.y = 0.72;
      mdnuChassis.castShadow = true;
      mdnuGroup.add(mdnuChassis);

      const exhaustPipe = new THREE.Mesh(
        new THREE.CylinderGeometry(0.08, 0.08, 0.85, 16),
        new THREE.MeshStandardMaterial({ color: 0x334155, metalness: 0.85, roughness: 0.25 })
      );
      exhaustPipe.position.set(0.45, 1.65, -0.6);
      mdnuGroup.add(exhaustPipe);

      const mdnuLabel = new THREE.Mesh(
        new THREE.PlaneGeometry(1.2, 0.45),
        new THREE.MeshBasicMaterial({
          map: createEquipmentLabelTexture('МДНУ-150 МЧС', 'ПУСК ДИЗЕЛЬ-ГЕНЕРАТОРА', '#1e293b', '#f97316')
        })
      );
      mdnuLabel.position.set(0, 0.92, 1.11);
      mdnuGroup.add(mdnuLabel);

      const mdnuStatusLed = new THREE.Mesh(
        new THREE.SphereGeometry(0.08, 16, 16),
        new THREE.MeshBasicMaterial({ color: 0xef4444 })
      );
      mdnuStatusLed.position.set(-0.48, 1.4, 0.8);
      mdnuGroup.add(mdnuStatusLed);
      mdnuGroup.userData = {
        ...mdnuGroup.userData,
        interactiveId: 'mdnu_diesel_pump',
        mdnuStatusLed,
        placementType: 'floor',
        isLargeEquipment: true
      };
      envGroup.add(mdnuGroup);

      // 3. Арматура аварийной подпитки ПГ
      const coolingValve = createHighDetailValve();
      coolingValve.position.set(0, 1.0, -1.45);
      coolingValve.scale.setScalar(0.85);
      coolingValve.userData = {
        ...coolingValve.userData,
        interactiveId: 'sbo_cooling_valve',
        placementType: 'floor',
        isLargeEquipment: true
      };
      envGroup.add(coolingValve);

      // 4. Пролив теплоносителя в БПУ для дезактивации лопатой БСЛ-110 [2]
      const sboSpillMesh = createContaminationSpillMesh(0x38bdf8);
      sboSpillMesh.position.set(1.45, 0, -1.35);
      envGroup.add(sboSpillMesh);

      // 5. Критический блок АСУ ТП на пульте (эвакуация в САР-3)
      const controlUnitMesh = createCriticalControlUnitMesh();
      controlUnitMesh.position.set(-1.9, 0.92, -2.35);
      envGroup.add(controlUnitMesh);

      // 6. Безопасная зона эвакуации САР-3
      const sarDropZoneS3 = createLeadSarContainerDropZone('КОНТЕЙНЕР САР-3', 'ЭВАКУАЦИЯ БЛОКА АСУ ТП');
      sarDropZoneS3.position.set(3.2, 0, 2.5);
      envGroup.add(sarDropZoneS3);

      envGroup.userData.sboSimulation = {
        sboScreenMesh,
        deskIndicatorMat,
        emergencyLight,
        isCableConnected: false,
        isGeneratorRunning: false,
        isCoolingRestored: false
      };

      scene.add(envGroup);

      return {
        envGroup,
        sources: [
          {
            id: 'src_sbo_core_gamma',
            position: new THREE.Vector3(-1.2, 1.5, -4.6),
            isotopeId: 'Co-60',
            activityMBq: 32000
          },
          {
            id: 'src_sbo_neutron',
            position: new THREE.Vector3(1.6, 1.4, -4.7),
            isotopeId: 'Cf-252',
            activityMBq: 1500
          },
          {
            id: 'src_sbo_spill',
            position: new THREE.Vector3(1.45, 0.05, -1.35),
            isotopeId: 'Cs-137',
            activityMBq: 3800,
            mesh: sboSpillMesh
          },
          {
            id: 'src_sbo_unit',
            position: new THREE.Vector3(-1.9, 1.0, -2.35),
            isotopeId: 'Co-60',
            activityMBq: 2600,
            mesh: controlUnitMesh
          }
        ],
        shields: [],
        interactive: [
          {
            id: 'sbo_power_cable',
            nameRu: 'Силовой кабель аварийного ввода 0.4 кВ',
            type: 'breaker',
            placementType: 'floor',
            isLargeEquipment: true,
            mesh: cableBoxGroup,
            interacted: false,
            holdAction: {
              kind: 'breaker',
              durationSec: 2.2,
              labelRu: 'Подключение силового кабеля 0.4 кВ',
              preferredToolId: 'wrench'
            }
          },
          {
            id: 'mdnu_diesel_pump',
            nameRu: 'Мобильная дизель-насосная установка МДНУ-150',
            type: 'generator',
            placementType: 'floor',
            isLargeEquipment: true,
            mesh: mdnuGroup,
            interacted: false,
            holdAction: {
              kind: 'generator',
              durationSec: 2.8,
              labelRu: 'Запуск дизель-насоса МДНУ-150',
              preferredToolId: 'wrench'
            }
          },
          {
            id: 'sbo_cooling_valve',
            nameRu: 'Задвижка аварийной подпитки парогенераторов',
            type: 'valve',
            placementType: 'floor',
            isLargeEquipment: true,
            mesh: coolingValve,
            interacted: false,
            holdAction: {
              kind: 'valve',
              durationSec: 3.0,
              labelRu: 'Открытие задвижки аварийной подпитки ПГ',
              preferredToolId: 'wrench'
            }
          },
          {
            id: 'spill_sbo_coolant',
            nameRu: 'Пролив теплоносителя в БПУ (БСЛ-110 [2])',
            type: 'spill',
            placementType: 'floor',
            isLargeEquipment: true,
            mesh: sboSpillMesh,
            interacted: false,
            linkedSourceId: 'src_sbo_spill',
            holdAction: {
              kind: 'decontaminate',
              durationSec: 3.0,
              labelRu: 'Дезактивация пролива сорбентом',
              preferredToolId: 'shovel'
            }
          },
          {
            id: 'critical_control_unit',
            nameRu: 'Критический блок управления АСУ ТП',
            type: 'control_unit',
            placementType: 'prop',
            isLargeEquipment: false,
            mesh: controlUnitMesh,
            interacted: false,
            linkedSourceId: 'src_sbo_unit'
          },
          {
            id: 'sar_drop_zone_s3',
            nameRu: 'Контейнер эвакуации САР-3 (Безопасная зона)',
            type: 'drop_zone',
            placementType: 'floor',
            isLargeEquipment: true,
            shieldMaterial: 'lead',
            shieldThicknessCm: 10.0,
            mesh: sarDropZoneS3,
            interacted: false
          }
        ]
      };
    }
  },
  // =========================================================================================
  // 4. Комплексный VR-тренажёр МЧС на 3D-модели комплекса АЭС (.glb)
  // =========================================================================================
  {
    id: 4,
    categoryRu: "МЧС АЭС • 3D-комплекс (.glb)",
    titleRu: "4. МЧС АЭС: Пожар и эвакуация персонала в комплексе АЭС (.glb)",
    shortDescriptionRu:
      "Практическая операция МЧС на 3D-модели комплекса АЭС (.glb): экипировка ОУ-5, вход в корпус, тушение очагов пожара и вывод персонала на безопасный пункт сбора.",
    facilityRu: "Комплекс энергоблоков, градирен и вспомогательных корпусов АЭС (1:1 м)",
    dominantIsotopes: ["Cs-137", "Co-60"],
    recommendedPermitLimitMsv: 0.50,
    initialPlayerPos: new THREE.Vector3(0, 1.65, 21.5),
    ambientColor: 0x334155,
    isLowLight: false,
    hasAirborneContamination: true,
    fogColor: 0x0b1322,
    fogDensity: 0.0045,
    stages: [
      {
        stepNumber: 1,
        titleRu: "Подготовка ОУ-5 и вход в комплекс АЭС",
        taskRu: "Возьмите ОУ-5 на красной стойке у входа [E], сорвите чеку [E]/[R] и войдите в корпус через синий маркер.",
        hintRu: "Наружный пост расположен справа от входа. После срыва чеки следуйте по напольным стрелкам.",
        alaraRuleRu: "Проверка боеготовности средств пожаротушения и СИЗ до входа в зону поражения."
      },
      {
        stepNumber: 2,
        titleRu: "Локализация очага №1 (Щитовая)",
        taskRu: "Пройдите к западному отсеку и подайте струю CO₂ на первый очаг пожара (ЛКМ / [E] / курок VR).",
        hintRu: "Не подходите ближе 1.5 м к открытому пламени во избежание тепловой перегрузки.",
        alaraRuleRu: "Поддерживайте оптимальную дистанцию при тушении (Защита расстоянием)."
      },
      {
        stepNumber: 3,
        titleRu: "Эвакуация группы персонала №1",
        taskRu: "Подойдите к заблокированному персоналу у западного отсека и подайте команду выхода [E].",
        hintRu: "Персонал автоматически выйдет к внешнему пункту сбора при свободном пути.",
        alaraRuleRu: "Приоритет — немедленный вывод персонала с маршрутом в обход активных очагов."
      },
      {
        stepNumber: 4,
        titleRu: "Тушение остальных очагов и вывод группы №2",
        taskRu: "Потушите очаги в коридоре и машзале, при необходимости замените баллон ОУ-5 и эвакуируйте группу №2.",
        hintRu: "Жёлтая стойка с запасным ОУ-5 находится в центральном холле.",
        alaraRuleRu: "Контроль остатка ОТВ и ограничение времени экспозиции в горячих зонах."
      },
      {
        stepNumber: 5,
        titleRu: "Финальная проверка и выход на пункт сбора",
        taskRu: "Убедитесь, что все очаги потушены и персонал эвакуирован, затем выйдите на зелёный Пункт сбора МЧС.",
        hintRu: "Следуйте по зелёной линии навигации к внешнему выходу.",
        alaraRuleRu: "Сокращение времени пребывания в корпусе после выполнения боевой задачи."
      },
      {
        stepNumber: 6,
        titleRu: "Итоговый разбор операции МЧС",
        taskRu: "Ознакомьтесь с протоколом разбора: временем операции, дозой ALARA, расходом ОУ-5 и замечаниями.",
        hintRu: "Вы можете перезапустить сценарий или загрузить собственный .glb-макет АЭС.",
        alaraRuleRu: "Анализ дозовой нагрузки и соблюдения регламента безопасности МЧС."
      }
    ],
    buildScene: (scene) => {
      const envGroup = new THREE.Group();
      envGroup.name = "scenario_4_npp_complex_env";
      scene.add(envGroup);

      // Лёгкий радиационный фон у очагов возгорания (управляется и масштабируется контроллером Сценария 4)
      const fireMarker1 = new THREE.Object3D();
      fireMarker1.position.set(-7.5, 0.8, 1.5);
      envGroup.add(fireMarker1);

      const fireMarker2 = new THREE.Object3D();
      fireMarker2.position.set(1.5, 0.8, -5.5);
      envGroup.add(fireMarker2);

      return {
        envGroup,
        sources: [
          {
            id: "src_s4_zone1",
            position: new THREE.Vector3(-7.5, 0.8, 1.5),
            isotopeId: "Cs-137",
            activityMBq: 450,
            mesh: fireMarker1
          },
          {
            id: "src_s4_zone2",
            position: new THREE.Vector3(1.5, 0.8, -5.5),
            isotopeId: "Co-60",
            activityMBq: 320,
            mesh: fireMarker2
          }
        ],
        shields: [],
        interactive: []
      };
    }
  }
];

/**
 * Построение промышленного зала со светлыми бетонными панелями, эпоксидным полом,
 * потолочными фермами, светильниками и колоннами
 */
export function buildIndustrialRoom(group: THREE.Group, width: number, depth: number, height: number): void {
  const safeW = Number.isFinite(width) && width > 1 ? width : 14;
  const safeD = Number.isFinite(depth) && depth > 1 ? depth : 14;
  const safeH = Number.isFinite(height) && height > 1 ? height : 5.2;

  const wallTex = createIndustrialConcreteWallTexture();
  wallTex.repeat.set(safeW / 4, safeH / 4);

  const wallMat = new THREE.MeshStandardMaterial({
    color: 0xe2e8f0,
    map: wallTex,
    roughness: 0.7,
    metalness: 0.08
  });

  const backWall = new THREE.Mesh(new THREE.BoxGeometry(safeW, safeH, 0.25), wallMat);
  backWall.position.set(0, safeH / 2, -safeD / 2);
  backWall.receiveShadow = true;
  group.add(backWall);

  const frontWall = new THREE.Mesh(new THREE.BoxGeometry(safeW, safeH, 0.25), wallMat);
  frontWall.position.set(0, safeH / 2, safeD / 2);
  frontWall.receiveShadow = true;
  group.add(frontWall);

  const leftWall = new THREE.Mesh(new THREE.BoxGeometry(0.25, safeH, safeD), wallMat);
  leftWall.position.set(-safeW / 2, safeH / 2, 0);
  leftWall.receiveShadow = true;
  group.add(leftWall);

  const rightWall = new THREE.Mesh(new THREE.BoxGeometry(0.25, safeH, safeD), wallMat);
  rightWall.position.set(safeW / 2, safeH / 2, 0);
  rightWall.receiveShadow = true;
  group.add(rightWall);

  const ceilingMat = new THREE.MeshStandardMaterial({
    color: 0xf1f5f9,
    roughness: 0.85,
    metalness: 0.1,
    side: THREE.DoubleSide
  });
  const ceiling = new THREE.Mesh(new THREE.PlaneGeometry(safeW, safeD), ceilingMat);
  ceiling.rotation.x = Math.PI / 2;
  ceiling.position.y = safeH;
  group.add(ceiling);

  const trussPositions = [-safeD / 4, 0, safeD / 4];
  const instMatrix = new THREE.Matrix4();

  // Инстанцированные потолочные фермы (3 балки вместо десятков отдельных мешей)
  const trussSpan = safeW - 0.5;
  const trussGeo = new THREE.BoxGeometry(trussSpan, 0.22, 0.16);
  const trussMat = new THREE.MeshStandardMaterial({
    color: 0x475569,
    roughness: 0.48,
    metalness: 0.65
  });
  const trussInstanced = new THREE.InstancedMesh(trussGeo, trussMat, trussPositions.length);
  trussInstanced.name = 'industrial_ceiling_trusses_instanced';
  trussPositions.forEach((zPos, i) => {
    instMatrix.makeTranslation(0, safeH - 0.25, zPos);
    trussInstanced.setMatrixAt(i, instMatrix);
  });
  trussInstanced.instanceMatrix.needsUpdate = true;
  group.add(trussInstanced);

  // Инстанцированные потолочные светильники (корпуса и плафоны: 6 шт.)
  const lampCount = trussPositions.length * 2;
  const lampHousingGeo = new THREE.BoxGeometry(1.15, 0.08, 0.28);
  const lampHousingMat = new THREE.MeshStandardMaterial({
    color: 0x334155,
    roughness: 0.4,
    metalness: 0.6
  });
  const lampHousingInst = new THREE.InstancedMesh(lampHousingGeo, lampHousingMat, lampCount);
  const lampLensGeo = new THREE.BoxGeometry(1.06, 0.03, 0.22);
  const lampLensMat = new THREE.MeshBasicMaterial({ color: 0xf8fafc });
  const lampLensInst = new THREE.InstancedMesh(lampLensGeo, lampLensMat, lampCount);

  let lampIdx = 0;
  trussPositions.forEach(zPos => {
    for (const xPos of [-safeW / 4, safeW / 4]) {
      instMatrix.makeTranslation(xPos, safeH - 0.05, zPos);
      lampHousingInst.setMatrixAt(lampIdx, instMatrix);
      instMatrix.makeTranslation(xPos, safeH - 0.095, zPos);
      lampLensInst.setMatrixAt(lampIdx, instMatrix);
      lampIdx += 1;
    }
  });
  lampHousingInst.instanceMatrix.needsUpdate = true;
  lampLensInst.instanceMatrix.needsUpdate = true;
  group.add(lampHousingInst, lampLensInst);

  const floorTex = createEpoxyFloorTexture();
  floorTex.repeat.set(safeW / 3, safeD / 3);
  const floorPlaneMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    map: floorTex,
    roughness: 0.4,
    metalness: 0.1,
    side: THREE.DoubleSide
  });
  const floorPlane = new THREE.Mesh(new THREE.PlaneGeometry(safeW, safeD), floorPlaneMat);
  floorPlane.name = 'scene_floor';
  floorPlane.userData = { ...floorPlane.userData, isFloor: true };
  floorPlane.rotation.x = -Math.PI / 2;
  floorPlane.position.y = 0.002;
  floorPlane.receiveShadow = true;
  group.add(floorPlane);

  const stripeMat = new THREE.MeshBasicMaterial({ map: createHazardStripesTexture(512, 64) });
  const stripeGeo = new THREE.BoxGeometry(width - 0.3, 0.18, 0.02);
  const backStripe = new THREE.Mesh(stripeGeo, stripeMat);
  backStripe.position.set(0, 0.2, -depth / 2 + 0.14);
  group.add(backStripe);

  const colMat = new THREE.MeshStandardMaterial({
    color: 0x94a3b8,
    roughness: 0.5,
    metalness: 0.3
  });
  const colGeo = new THREE.BoxGeometry(0.45, height, 0.45);
  const positions = [
    [-width / 2 + 0.3, -depth / 2 + 0.3],
    [width / 2 - 0.3, -depth / 2 + 0.3],
    [-width / 2 + 0.3, depth / 2 - 0.3],
    [width / 2 - 0.3, depth / 2 - 0.3],
    [-width / 2 + 0.3, 0],
    [width / 2 - 0.3, 0]
  ];
  const colInstanced = new THREE.InstancedMesh(colGeo, colMat, positions.length);
  colInstanced.name = 'industrial_columns_instanced';
  colInstanced.castShadow = true;
  colInstanced.receiveShadow = true;
  positions.forEach(([x, z], i) => {
    instMatrix.makeTranslation(x, height / 2, z);
    colInstanced.setMatrixAt(i, instMatrix);
  });
  colInstanced.instanceMatrix.needsUpdate = true;
  group.add(colInstanced);
}

/**
 * Построение светлой чистой лаборатории / медицинского помещения
 */
function buildCleanRoom(group: THREE.Group, width: number, depth: number, height: number): void {
  const wallTex = createCleanroomWallTexture();
  wallTex.repeat.set(width / 3, height / 3);

  const wallMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    map: wallTex,
    roughness: 0.25,
    metalness: 0.08
  });

  const backWall = new THREE.Mesh(new THREE.BoxGeometry(width, height, 0.2), wallMat);
  backWall.position.set(0, height / 2, -depth / 2);
  backWall.receiveShadow = true;
  group.add(backWall);

  const frontWall = new THREE.Mesh(new THREE.BoxGeometry(width, height, 0.2), wallMat);
  frontWall.position.set(0, height / 2, depth / 2);
  group.add(frontWall);

  const leftWall = new THREE.Mesh(new THREE.BoxGeometry(0.2, height, depth), wallMat);
  leftWall.position.set(-width / 2, height / 2, 0);
  group.add(leftWall);

  const rightWall = new THREE.Mesh(new THREE.BoxGeometry(0.2, height, depth), wallMat);
  rightWall.position.set(width / 2, height / 2, 0);
  group.add(rightWall);

  const ceiling = new THREE.Mesh(
    new THREE.PlaneGeometry(width, depth),
    new THREE.MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.4 })
  );
  ceiling.rotation.x = Math.PI / 2;
  ceiling.position.y = height;
  group.add(ceiling);

  for (const x of [-2.5, 2.5]) {
    for (const z of [-2.0, 2.0]) {
      const lamp = createIndustrialCeilingLamp();
      lamp.position.set(x, height - 0.02, z);
      group.add(lamp);
    }
  }

  const floorTex = createCleanroomFloorTexture();
  floorTex.repeat.set(width / 3, depth / 3);
  const floorPlaneMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    map: floorTex,
    roughness: 0.2,
    metalness: 0.1
  });
  const floorPlane = new THREE.Mesh(new THREE.PlaneGeometry(width, depth), floorPlaneMat);
  floorPlane.name = 'scene_floor';
  floorPlane.userData = { ...floorPlane.userData, isFloor: true };
  floorPlane.rotation.x = -Math.PI / 2;
  floorPlane.position.y = 0.002;
  floorPlane.receiveShadow = true;
  group.add(floorPlane);
}
