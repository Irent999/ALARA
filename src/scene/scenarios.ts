/**
 * ALARA-Planner Pro VR — Полная библиотека из 11 узкоспециализированных интерактивных 3D-сценариев
 * радиационного контроля и дозиметрического обследования по ГОСТ Р 8.804-2012, НРБ-99/2009 и ОСПОРБ-99/2010:
 *
 * 1. АЭС и предприятия ЯТЦ (помещения ГЦК ВВЭР, Co-60 + нейтронный фон)
 * 2. Медицинские учреждения (рентген-кабинеты, ПЭТ/КТ, лучевая терапия Co-60 / F-18)
 * 3. Пункты приема металлолома (входной контроль лома, утерянный гамма-дефектоскоп Ir-192 / Cs-137)
 * 4. Таможенные посты и границы (стойки «Янтарь», досмотр контейнеров и багажа, Am-241 / Cs-137)
 * 5. Места добычи полезных ископаемых (урановые рудники и гранитные карьеры ЕРН: Ra-226, Th-232, K-40)
 * 6. Зоны ликвидации аварий и хранилища ЯО (ХОЯТ, контейнеры ТУК, ПЗРО, Cf-252 нейтроны + парафин/бор)
 * 7. Строительные площадки и участки под застройку (измерение ППС радона-222 из почвы, накопительные камеры)
 * 8. Метрополитен и вокзалы (гранитная облицовка колонн и досмотровые рентгеновские интроскопы X-Ray)
 * 9. Строительные и отделочные материалы (гранитный щебень, керамическая плитка с урановой глазурью U-238)
 * 10. Продукты питания (спектрометрия лесных грибов, ягод и рыбы на удельную активность Cs-137)
 * 11. Предметы старины и антиквариат (авиационные часы, компасы, тумблеры и игрушки с СПД Радий-226)
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
import { ShieldMaterialType } from '../physics/gostPhysics';

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

export interface InteractiveObjectInstance {
  id: string;
  nameRu: string;
  type: 'shield' | 'valve' | 'container' | 'source' | 'sample' | 'cover' | 'flashlight';
  placementType: ObjectPlacementType;
  isLargeEquipment: boolean;
  mesh: THREE.Object3D;
  interacted: boolean;
  highlighted?: boolean;
  shieldMaterial?: ShieldMaterialType;
  shieldThicknessCm?: number;
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

export const SCENARIOS: ScenarioDefinition[] = [
  // =========================================================================================
  // 1. ЛАБОРАТОРНАЯ РАБОТА №1: Закон обратных квадратов и защита расстоянием
  // =========================================================================================
  {
    id: 1,
    categoryRu: 'Лабораторный практикум (ГОСТ)',
    titleRu: '1. Лабораторная работа: Закон обратных квадратов и защита расстоянием (1/r²)',
    shortDescriptionRu:
      'Экспериментальное исследование закона обратных квадратов Ḋ(r) = (Г_γ · A) / r². Оценка снижения мощности дозы при удалении на 1.0, 2.0 и 4.0 метра и применение телескопической штанги по принципу ALARA.',
    facilityRu: 'Учебно-исследовательская лаборатория дозиметрии и радиационной безопасности',
    dominantIsotopes: ['Cs-137', 'Co-60'],
    recommendedPermitLimitMsv: 0.20,
    initialPlayerPos: new THREE.Vector3(0, 1.65, 4.2),
    ambientColor: 0xe2e8f0,
    fogColor: 0xe2e8f0,
    fogDensity: 0.002,
    stages: [
      {
        stepNumber: 1,
        titleRu: 'Шаг 1: «Разведка издалека» — Измерение радиационного фона на безопасном расстоянии',
        taskRu: 'Произведите замер радиационного фона на безопасном удалении (граница зоны, r > 3.0 м) без входа в очаг поражения.',
        hintRu: 'Зафиксируйте естественный радиационный фон (0.08–0.14 мкЗв/ч). Не входите в радиационную зону без предварительной разведки.',
        alaraRuleRu: 'Методика РХБЗ: первичная разведка обстановки проводится с безопасного рубежа (граница радиационной зоны).'
      },
      {
        stepNumber: 2,
        titleRu: 'Шаг 2: «Выбор средств защиты» — Анализ типа излучения и подбор костюма/СИЗ',
        taskRu: 'Проанализируйте характер треков частиц (пробег в воздухе) и подберите правильный костюм/СИЗ (свинцовый фартук или Л-1/ОЗК) в Главном меню или селекторе СИЗ.',
        hintRu: 'Откройте Главное меню (кнопка ☰) -> «Экипировка (СИЗ)» или выберите СИЗ в панели. Фартук/костюм снижают дозу в разы.',
        alaraRuleRu: 'Комплексная защита (ALARA): подбор СИЗ (k_PPE) под преобладающий спектр ионизирующего излучения.'
      },
      {
        stepNumber: 3,
        titleRu: 'Шаг 3: «Дозированный подход» — Вход в опасную зону с таймером пребывания',
        taskRu: 'Выполните дозированное сближение с источником под контролем таймера миссии (защита временем: пребывание t < T_max).',
        hintRu: 'Контролируйте обратный отсчет на VR-планшете или в HUD. Скорость набора дозы зависит от времени экспозиции.',
        alaraRuleRu: 'Защита временем (ALARA): доза пропорциональна времени в поле излучения. Минимизируйте время нахождения в очаге.'
      },
      {
        stepNumber: 4,
        titleRu: 'Шаг 4: «Установка временного экрана» — Размещение защитного блока между оператором и источником',
        taskRu: 'Разместите передвижной защитный блок (свинцовую ширму 25–50 мм Pb или бетон) между собой и источником для снижения мощности дозы перед началом работ.',
        hintRu: 'Подойдите к ширме/экрану и установите ее в створ пучка (клавиша E / курок VR). Теневая защита снижает поток по закону Бугера.',
        alaraRuleRu: 'Защита экранированием: установка временного барьера перед прецизионными работами снижает мощность дозы в десятки раз.'
      },
      {
        stepNumber: 5,
        titleRu: 'Шаг 5: «Точные замеры и расчет» — Фиксация показаний и занесение в лабораторный журнал',
        taskRu: 'Произведите прецизионные замеры мощности эквивалентной дозы за экраном и занесите вычисленные данные в виртуальный «Лабораторный журнал» (📓).',
        hintRu: 'Откройте «Лабораторный журнал» вверху экрана, рассчитайте кратность ослабления K = I₀/I и относительную погрешность δ.',
        alaraRuleRu: 'ГОСТ Р 8.804-2012: документальное оформление результатов дозиметрических замеров и расчет погрешности.'
      },
      {
        stepNumber: 6,
        titleRu: 'Шаг 6: «Итоговый контроль и сдача» — Сверка дозового предела и защита работы (ALARA Отчет)',
        taskRu: 'Сверьте накопленную дозу с контрольным лимитом наряда-допуска, отойдите в зелёную зону и сдайте протокол через «ALARA Отчет».',
        hintRu: 'Убедитесь, что накопленная доза не превысила 80% порога безопасности, и защитите работу на оценку «Отлично».',
        alaraRuleRu: 'Аттестация персонала: подтверждение навыков применения формулы комплексной защиты k = k_PPE · k_Shield · (r/r₀)².'
      }
    ],
    buildScene: (scene: THREE.Scene) => {
      const envGroup = new THREE.Group();
      buildIndustrialRoom(envGroup, 14, 14, 4.8);

      const pipeMat = new THREE.MeshStandardMaterial({
        color: 0x94a3b8,
        metalness: 0.85,
        roughness: 0.2,
        map: createBrushedMetalTexture()
      });

      const mainPipe = new THREE.Mesh(new THREE.CylinderGeometry(0.38, 0.38, 12, 24), pipeMat);
      mainPipe.rotation.z = Math.PI / 2;
      mainPipe.position.set(0, 1.8, -4.2);
      mainPipe.castShadow = true;
      envGroup.add(mainPipe);

      const pipeStripe = new THREE.Mesh(
        new THREE.CylinderGeometry(0.385, 0.385, 1.5, 24),
        new THREE.MeshBasicMaterial({ map: createHazardStripesTexture(256, 64) })
      );
      pipeStripe.rotation.z = Math.PI / 2;
      pipeStripe.position.set(1.8, 1.8, -4.2);
      envGroup.add(pipeStripe);

      const valveMesh = createHighDetailValve();
      valveMesh.position.set(0, 1.8, -4.2);
      valveMesh.rotation.x = Math.PI / 2;
      envGroup.add(valveMesh);

      const beacon = createRadiationBeacon('danger');
      beacon.position.set(2.8, 3.2, -4.2);
      envGroup.add(beacon);

      // Визуальное свечение Вавилова — Черенкова и ионизация воздуха вблизи поврежденного узла ГЦК / ТВС
      const cherenkovGlow = createCherenkovRadiationGlowMesh(0.75);
      cherenkovGlow.position.set(0, 1.8, -4.1);
      envGroup.add(cherenkovGlow);

      // Обломки реакторного графита с PBR-материалом на полу у контура
      const graphiteMat = createGraphiteDebrisMaterial();
      for (let i = 0; i < 6; i++) {
        const block = new THREE.Mesh(
          new THREE.DodecahedronGeometry(0.09 + (i % 3) * 0.03, 1),
          graphiteMat
        );
        block.position.set(-1.1 + i * 0.42, 0.06, -3.3 + (i % 2) * 0.35);
        block.rotation.set(i * 0.5, i * 0.8, 0.2);
        block.castShadow = true;
        envGroup.add(block);
      }

      const shieldMesh = createMovableLeadShieldScreen();
      shieldMesh.position.set(-2.8, 0, -1.2);
      shieldMesh.userData = {
        ...shieldMesh.userData,
        interactiveId: 'screen_shield',
        placementType: 'floor',
        isLargeEquipment: true
      };
      envGroup.add(shieldMesh);

      scene.add(envGroup);

      return {
        envGroup,
        sources: [
          {
            id: 'src_vver_co60',
            position: new THREE.Vector3(0, 1.8, -4.1),
            isotopeId: 'Co-60',
            activityMBq: 48000,
            isLineSource: true,
            lineLengthM: 4.5
          },
          {
            id: 'src_vver_neutron',
            position: new THREE.Vector3(-2.5, 1.8, -4.3),
            isotopeId: 'Cf-252',
            activityMBq: 1800
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
            nameRu: 'Запорный клапан контура ГЦК',
            type: 'valve',
            placementType: 'floor',
            isLargeEquipment: true,
            mesh: valveMesh,
            interacted: false
          }
        ]
      };
    }
  },

  // =========================================================================================
  // 2. ЛАБОРАТОРНАЯ РАБОТА №2: Ослабление ИИ материалами и СИЗ
  // =========================================================================================
  {
    id: 2,
    categoryRu: 'Лабораторный практикум (ГОСТ)',
    titleRu: '2. Лабораторная работа: Ослабление ИИ материалами и СИЗ (Закон Бугера-Ламберта-Бера)',
    shortDescriptionRu:
      'Экспериментальная проверка экспоненциального закона ослабления фотонного излучения I = I₀·B(μd)·exp(-μd). Оценка слоев половинного ослабления (СПО) для свинца, стали, бетона и рентгенозащитного фартука (0.5 мм Pb).',
    facilityRu: 'Лаборатория радиационной физики и защиты от ионизирующего излучения',
    dominantIsotopes: ['Co-60', 'Cs-137'],
    recommendedPermitLimitMsv: 0.15,
    initialPlayerPos: new THREE.Vector3(0, 1.65, 4.0),
    ambientColor: 0xf8fafc,
    fogColor: 0xf1f5f9,
    fogDensity: 0.001,
    stages: [
      {
        stepNumber: 1,
        titleRu: 'Шаг 1: «Разведка издалека» — Замер базового фона при закрытом коллиматоре',
        taskRu: 'Произведите замер радиационного фона на безопасном рубеже оператора (r > 3.0 м) при закрытом коллиматоре бокса.',
        hintRu: 'Зафиксируйте нулевую опорную точку фона (0.08–0.12 мкЗв/ч). Не входите в створ пучка без СИЗ.',
        alaraRuleRu: 'Методика РХБЗ: проверка герметичности биозащиты и фоновой обстановки перед началом экспозиции.'
      },
      {
        stepNumber: 2,
        titleRu: 'Шаг 2: «Выбор средств защиты» — Подбор свинцового фартука/костюма под гамма-излучение',
        taskRu: 'Проанализируйте характер фотонного пучка и экипируйте свинцовый фартук (0.5 мм Pb) или спецодежду в меню «Экипировка».',
        hintRu: 'Свинцовый эквивалент 0.5 мм Pb ослабляет низко- и среднеэнергетические фотоны и рассеянное излучение.',
        alaraRuleRu: 'Комплексная защита (ALARA): применение индивидуальных СИЗ свинцового эквивалента (k_PPE).'
      },
      {
        stepNumber: 3,
        titleRu: 'Шаг 3: «Дозированный подход» — Приближение к коллиматору с контролем времени',
        taskRu: 'Выполните дозированный вход в зону облучения под контролем таймера миссии (защита временем: пребывание t < T_max).',
        hintRu: 'Следите за таймером в HUD. Ограничение времени экспозиции снижает интегральную дозовую нагрузку.',
        alaraRuleRu: 'Защита временем: нахождение в створе открытого коллиматора должно быть строго регламентировано.'
      },
      {
        stepNumber: 4,
        titleRu: 'Шаг 4: «Установка временного экрана» — Монтаж свинцовых блоков перед пучком',
        taskRu: 'Установите блок свинцовых кирпичей (d = 50 мм Pb) в створ выходного окна коллиматора для снижения интенсивности пучка.',
        hintRu: 'Возьмите свинцовый блок (клавиша E) и поставьте перед коллиматором. Мощность дозы упадет по закону Бугера.',
        alaraRuleRu: 'Защита экранированием: слой половинного ослабления (СПО) свинца для Co-60 составляет d₁/₂ = 1.25 см.'
      },
      {
        stepNumber: 5,
        titleRu: 'Шаг 5: «Точные замеры и расчет» — Определение коэффициента ослабления K_shield',
        taskRu: 'Зафиксируйте мощность дозы за свинцовым экраном и внесите данные в виртуальный «Лабораторный журнал» (📓).',
        hintRu: 'Рассчитайте кратность ослабления K = I₀/I и экспериментальный слой половинного ослабления d₁/₂ = ln(2)/μ.',
        alaraRuleRu: 'Инженерная физика: расчет необходимой толщины биозащиты по нормативам НРБ-99/2009.'
      },
      {
        stepNumber: 6,
        titleRu: 'Шаг 6: «Итоговый контроль и сдача» — Закрытие затвора и защита лабораторной работы',
        taskRu: 'Переведите затвор коллиматора в положение «ЗАКРЫТО», отойдите в зелёную зону и сдайте работу через «ALARA Отчет».',
        hintRu: 'Убедитесь в нормализации радиационного фона и получите итоговую оценку за соблюдение принципов ALARA.',
        alaraRuleRu: 'Аттестация персонала группы А: подтверждение допуска к работе с источниками фотонного излучения.'
      }
    ],
    buildScene: (scene: THREE.Scene) => {
      const envGroup = new THREE.Group();
      buildCleanRoom(envGroup, 12, 12, 4.0);

      // Ламинарный горячий бокс ПЭТ-лаборатории
      const hotCell = createHotCellGlovebox();
      hotCell.position.set(-2.2, 0, -3.2);
      envGroup.add(hotCell);

      // Аппарат дистанционной гамма-терапии (гиis-гентри)
      const gantryMat = new THREE.MeshStandardMaterial({ color: 0xe2e8f0, roughness: 0.25, metalness: 0.3 });
      const gantryBase = new THREE.Mesh(new THREE.BoxGeometry(1.4, 2.2, 1.2), gantryMat);
      gantryBase.position.set(2.2, 1.1, -3.5);
      gantryBase.castShadow = true;
      envGroup.add(gantryBase);

      const gantryArm = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.6, 1.6), gantryMat);
      gantryArm.position.set(2.2, 2.0, -2.7);
      envGroup.add(gantryArm);

      // Затвор коллиматора
      const shutterValve = createHighDetailValve();
      shutterValve.scale.setScalar(0.65);
      shutterValve.position.set(2.2, 1.5, -2.85);
      envGroup.add(shutterValve);

      // Светящийся флакон с РФП 18F-ФДГ
      const spillGroup = new THREE.Group();
      spillGroup.position.set(-2.2, 0.96, -3.0);
      const puddle = new THREE.Mesh(
        new THREE.CylinderGeometry(0.22, 0.25, 0.02, 24),
        new THREE.MeshBasicMaterial({ color: 0x38bdf8, transparent: true, opacity: 0.85 })
      );
      spillGroup.add(puddle);
      envGroup.add(spillGroup);

      // Свинцовые кирпичи ГОСТ
      const bricks = createLeadBrickStack(3, 4);
      bricks.position.set(-0.4, 0, -1.2);
      bricks.userData = {
        ...bricks.userData,
        interactiveId: 'lead_bricks',
        placementType: 'floor',
        isLargeEquipment: true
      };
      envGroup.add(bricks);

      scene.add(envGroup);

      return {
        envGroup,
        sources: [
          {
            id: 'src_med_f18',
            position: new THREE.Vector3(-2.2, 0.98, -3.0),
            isotopeId: 'F-18',
            activityMBq: 26000,
            mesh: spillGroup
          },
          {
            id: 'src_med_co60_head',
            position: new THREE.Vector3(2.2, 1.65, -2.7),
            isotopeId: 'Co-60',
            activityMBq: 18000
          }
        ],
        shields: [
          {
            id: 'lead_bricks',
            mesh: bricks,
            material: 'lead',
            thicknessCm: 5.0,
            boundingBox: new THREE.Box3().setFromObject(bricks)
          }
        ],
        interactive: [
          {
            id: 'lead_bricks',
            nameRu: 'Блок свинцовых кирпичей защиты (50 мм Pb)',
            type: 'shield',
            placementType: 'floor',
            isLargeEquipment: true,
            shieldMaterial: 'lead',
            shieldThicknessCm: 5.0,
            mesh: bricks,
            interacted: false
          },
          {
            id: 'reactor_valve',
            nameRu: 'Привод затвора гамма-аппарата Co-60',
            type: 'valve',
            placementType: 'floor',
            isLargeEquipment: true,
            mesh: shutterValve,
            interacted: false
          }
        ]
      };
    }
  },

  // =========================================================================================
  // 3. ЛАБОРАТОРНАЯ РАБОТА №3: Спектрометрия и слепая идентификация неизвестного источника
  // =========================================================================================
  {
    id: 3,
    categoryRu: 'Лабораторный практикум (ГОСТ)',
    titleRu: '3. Лабораторная работа: Спектрометрия и слепая идентификация неизвестного источника',
    shortDescriptionRu:
      'Слепая идентификация: перед студентом находится скрытый источник излучения в ампуле. Проведите серию измерений с фильтрами, наберите амплитудный спектр на МКА, определите энергию фотопиков и идентифицируйте изотоп.',
    facilityRu: 'Лаборатория спектрометрии и радиоизотопной идентификации',
    dominantIsotopes: ['Cs-137', 'Co-60', 'Am-241', 'Sr-90', 'Pu-239', 'Cf-252'],
    recommendedPermitLimitMsv: 0.15,
    initialPlayerPos: new THREE.Vector3(0, 1.65, 4.2),
    ambientColor: 0xe2e8f0,
    fogColor: 0xcbd5e1,
    fogDensity: 0.0025,
    stages: [
      {
        stepNumber: 1,
        titleRu: 'Этап 1 из 3: Качественная оценка вида ИИ поглотителями (α / β / γ / n)',
        taskRu: 'Оцените изменение счета при установке преград: бумага (задержка альфа), алюминий (бета), свинец (гамма).',
        hintRu: 'Если счет падает до нуля от листа бумаги — это чистый альфа-эмиттер (Pu-239). Если пробивает свинец — жесткое гамма (Co-60).',
        alaraRuleRu: 'Дифференциальная радиометрия: разделение видов ИИ методом фильтров поглощения.'
      },
      {
        stepNumber: 2,
        titleRu: 'Этап 2 из 3: Активация спектрометра МКА и накопление спектра',
        taskRu: 'Откройте анализатор спектра (кнопка 📊 вверху), проведите экспозицию 10–30 секунд и найдите фотопики полного поглощения.',
        hintRu: 'Используйте сцинтиллятор NaI(Tl) или полупроводниковый CdZnTe для обнаружения характеристических линий.',
        alaraRuleRu: 'ГОСТ Р МЭК 61274: спектрометрическая идентификация закрытых радионуклидных источников.'
      },
      {
        stepNumber: 3,
        titleRu: 'Этап 3 из 3: Оформление паспорта неизвестного источника и зачет',
        taskRu: 'В окне спектрометра выберите идентифицированный нуклид, подтвердите вердикт и переместите ампулу в контейнер ТК-6 (E).',
        hintRu: 'Сверьте положение обнаруженных пиков с библиотекой радионуклидов ГОСТ.',
        alaraRuleRu: 'ОСПОРБ-99/2010: изоляция идентифицированного источника в транспортный контейнер ТК-6.'
      }
    ],
    buildScene: (scene: THREE.Scene) => {
      const envGroup = new THREE.Group();
      buildIndustrialRoom(envGroup, 16, 14, 5.2);

      // Навалы металлолома (трубы, балки, шестерни)
      const rustMat = new THREE.MeshStandardMaterial({
        color: 0x78350f,
        roughness: 0.75,
        metalness: 0.65,
        map: createBrushedMetalTexture()
      });

      for (let i = 0; i < 8; i++) {
        const scrapPipe = new THREE.Mesh(
          new THREE.CylinderGeometry(0.14, 0.14, 2.2, 16),
          rustMat
        );
        scrapPipe.position.set(-1.5 + (i % 4) * 0.9, 0.22 + Math.floor(i / 4) * 0.25, -3.2 + (i % 2) * 0.4);
        scrapPipe.rotation.z = Math.PI / 2 + (i - 3) * 0.12;
        scrapPipe.rotation.y = (i * 0.4) % 1.2;
        scrapPipe.castShadow = true;
        envGroup.add(scrapPipe);
      }

      // Выпавший держатель капсулы гамма-дефектоскопа Ir-192
      const capsuleGroup = new THREE.Group();
      capsuleGroup.position.set(1.2, 0.12, -2.5);
      const bodyMesh = new THREE.Mesh(
        new THREE.CylinderGeometry(0.03, 0.03, 0.18, 16),
        new THREE.MeshStandardMaterial({ color: 0xe2e8f0, metalness: 0.95, roughness: 0.1 })
      );
      bodyMesh.rotation.z = Math.PI / 2;
      capsuleGroup.add(bodyMesh);

      const glow = new THREE.Mesh(
        new THREE.SphereGeometry(0.055, 16, 16),
        new THREE.MeshBasicMaterial({ color: 0xef4444, transparent: true, opacity: 0.85 })
      );
      capsuleGroup.add(glow);
      capsuleGroup.userData = {
        ...capsuleGroup.userData,
        interactiveId: 'ir_capsule',
        placementType: 'prop',
        isLargeEquipment: false
      };
      envGroup.add(capsuleGroup);

      // Защитный контейнер ТК-6
      const tk6 = createTK6Container();
      tk6.position.set(-1.8, 0, -1.2);
      tk6.userData = {
        ...tk6.userData,
        interactiveId: 'tk6_box',
        placementType: 'floor',
        isLargeEquipment: true
      };
      envGroup.add(tk6);

      scene.add(envGroup);

      return {
        envGroup,
        sources: [
          {
            id: 'src_scrap_ir192',
            position: capsuleGroup.position.clone(),
            isotopeId: 'Ir-192',
            activityMBq: 95000,
            mesh: capsuleGroup
          },
          {
            id: 'src_scrap_cs137',
            position: new THREE.Vector3(-1.2, 0.35, -3.3),
            isotopeId: 'Cs-137',
            activityMBq: 8500
          }
        ],
        shields: [],
        interactive: [
          {
            id: 'ir_capsule',
            nameRu: 'Ампула гамма-дефектоскопа Ir-192 (95 ГБк)',
            type: 'source',
            placementType: 'prop',
            isLargeEquipment: false,
            mesh: capsuleGroup,
            interacted: false
          },
          {
            id: 'tk6_box',
            nameRu: 'Транспортный свинцовый контейнер ТК-6',
            type: 'container',
            placementType: 'floor',
            isLargeEquipment: true,
            mesh: tk6,
            interacted: false
          }
        ]
      };
    }
  },

  // =========================================================================================
  // 4. Таможенные посты и границы
  // =========================================================================================
  {
    id: 4,
    categoryRu: 'Таможенные посты и границы',
    titleRu: '4. Таможня: Стойки «Янтарь» и досмотр контейнера (²⁴¹Am, ¹³⁷Cs)',
    shortDescriptionRu:
      'Сканирование морских контейнеров, автотранспорта и багажа стационарными мониторами и поисковыми радиометрами на предмет незадекларированных РМ.',
    facilityRu: 'Пограничный терминал радиационного контроля ТКДРМ',
    dominantIsotopes: ['Cs-137', 'Am-241'],
    recommendedPermitLimitMsv: 0.08,
    initialPlayerPos: new THREE.Vector3(0, 1.65, 4.4),
    ambientColor: 0xe2e8f0,
    fogColor: 0xdbeafe,
    fogDensity: 0.002,
    stages: [
      {
        stepNumber: 1,
        titleRu: 'Этап 1 из 3: Локализация сработки портала «Янтарь»',
        taskRu: 'Обследуйте задержанный грузовой контейнер и найдите ящик с незадекларированным источником.',
        hintRu: 'Америций-241 испускает интенсивное альфа- и низкоэнергетическое гамма-излучение (59.5 кэВ).',
        alaraRuleRu: 'СИЗ: экипируйте респиратор для 100% защиты от возможной альфа-аэрозольной разгерметизации.'
      },
      {
        stepNumber: 2,
        titleRu: 'Этап 2 из 3: Ограждение задержанного груза экраном',
        taskRu: 'Переместите передвижную свинцовую ширму (E) вплотную к стенке фонящего таможенного ящика.',
        hintRu: 'Низкоэнергетическое излучение Am-241 и Cs-137 эффективно блокируется свинцовым экраном.',
        alaraRuleRu: 'Защита экранированием: изолируйте опасный груз на досмотровой площадке.'
      },
      {
        stepNumber: 3,
        titleRu: 'Этап 3 из 3: Повторный замер на границе барьера',
        taskRu: 'Отойдите за установленный экран и зафиксируйте снижение мощности дозы до безопасного уровня.',
        hintRu: 'Сохраните CSV-отчет измерений в плавающем окне аналитики для таможенного протокола.',
        alaraRuleRu: 'Контроль дозовых нагрузок инспекторов ТКДРМ.'
      }
    ],
    buildScene: (scene: THREE.Scene) => {
      const envGroup = new THREE.Group();
      buildIndustrialRoom(envGroup, 16, 14, 5.0);

      // Морской 20-футовый контейнер (синий гофрированный)
      const containerMat = new THREE.MeshStandardMaterial({
        color: 0x1d4ed8,
        roughness: 0.5,
        metalness: 0.6
      });
      const cargoBox = new THREE.Mesh(new THREE.BoxGeometry(2.6, 2.5, 4.5), containerMat);
      cargoBox.position.set(0, 1.25, -3.5);
      cargoBox.castShadow = true;
      envGroup.add(cargoBox);

      // Стационарные стойки радиационного контроля «Янтарь-1С» по бокам
      const pillarMat = new THREE.MeshStandardMaterial({ color: 0xfacc15, roughness: 0.3, metalness: 0.4 });
      const leftPillar = new THREE.Mesh(new THREE.BoxGeometry(0.28, 2.4, 0.28), pillarMat);
      leftPillar.position.set(-2.4, 1.2, -2.0);
      const rightPillar = leftPillar.clone();
      rightPillar.position.set(2.4, 1.2, -2.0);
      envGroup.add(leftPillar, rightPillar);

      const alarmBeacon = createRadiationBeacon('danger');
      alarmBeacon.position.set(-2.4, 2.55, -2.0);
      envGroup.add(alarmBeacon);

      // Подозрительный багажный кейс возле открытых ворот контейнера
      const smuggledCase = new THREE.Mesh(
        new THREE.BoxGeometry(0.55, 0.38, 0.42),
        new THREE.MeshStandardMaterial({ color: 0x334155, roughness: 0.35, metalness: 0.7 })
      );
      smuggledCase.position.set(0.3, 0.19, -1.0);
      smuggledCase.castShadow = true;
      envGroup.add(smuggledCase);

      // Свинцовый экран таможенного поста
      const shieldMesh = createMovableLeadShieldScreen();
      shieldMesh.position.set(-2.6, 0, 0.2);
      shieldMesh.userData = {
        ...shieldMesh.userData,
        interactiveId: 'screen_shield',
        placementType: 'floor',
        isLargeEquipment: true
      };
      envGroup.add(shieldMesh);

      scene.add(envGroup);

      return {
        envGroup,
        sources: [
          {
            id: 'src_customs_cs137',
            position: new THREE.Vector3(0.3, 0.25, -1.0),
            isotopeId: 'Cs-137',
            activityMBq: 42000,
            mesh: smuggledCase
          },
          {
            id: 'src_customs_am241',
            position: new THREE.Vector3(0.1, 0.9, -2.2),
            isotopeId: 'Am-241',
            activityMBq: 35000
          }
        ],
        shields: [
          {
            id: 'lead_screen',
            mesh: shieldMesh,
            material: 'lead',
            thicknessCm: 2.0,
            boundingBox: new THREE.Box3().setFromObject(shieldMesh)
          }
        ],
        interactive: [
          {
            id: 'screen_shield',
            nameRu: 'Мобильный защитный экран ТКДРМ (20 мм Pb)',
            type: 'shield',
            placementType: 'floor',
            isLargeEquipment: true,
            shieldMaterial: 'lead',
            shieldThicknessCm: 2.0,
            mesh: shieldMesh,
            interacted: false
          }
        ]
      };
    }
  },

  // =========================================================================================
  // 5. Места добычи полезных ископаемых
  // =========================================================================================
  {
    id: 5,
    categoryRu: 'Места добычи полезных ископаемых',
    titleRu: '5. Горнодобыча: Урановый и гранитный карьер ЕРН (²²⁶Ra, ²³²Th, ⁴⁰K)',
    shortDescriptionRu:
      'Мониторинг урановых рудников, гранитных и угольных карьеров с повышенным содержанием естественных радионуклидов (NORM/ЕРН).',
    facilityRu: 'Подземный урановый рудник (штрек) и участок сортировки руды',
    dominantIsotopes: ['Ra-226', 'Th-232', 'K-40'],
    recommendedPermitLimitMsv: 0.10,
    initialPlayerPos: new THREE.Vector3(0, 1.65, 4.5),
    ambientColor: 0x1e293b,
    fogColor: 0x090d16,
    fogDensity: 0.032,
    isLowLight: true,
    stages: [
      {
        stepNumber: 1,
        titleRu: 'Этап 1 из 3: Гамма-поиск аномального керна руды',
        taskRu: 'Включите защиту СИЗ (респиратор от рудной альфа-пыли) и найдите обогащенный фрагмент породы Ra-226.',
        hintRu: 'Минералы уранинита и торита дают смешанный альфа-, бета- и гамма-вклад в дозовую нагрузку.',
        alaraRuleRu: 'Защита СИЗ: респиратор полностью (на 100%) блокирует ингаляционное поступление альфа-частиц.'
      },
      {
        stepNumber: 2,
        titleRu: 'Этап 2 из 3: Отбор пробы породы дистанционным захватом',
        taskRu: 'Возьмите активный образец руды Ra-226 (клавиша E) для помещения в геологический свинцовый пенал.',
        hintRu: 'Используйте манипулятор в панели защиты расстоянием для снижения облучения кистей рук.',
        alaraRuleRu: 'Защита расстоянием: используйте щипцы-манипуляторы при отборе высокоактивных кернов.'
      },
      {
        stepNumber: 3,
        titleRu: 'Этап 3 из 3: Герметизация пробы в контейнере',
        taskRu: 'Опустите образец породы в желтый защитный контейнер-пенал (E) для отправки в лабораторию.',
        hintRu: 'После помещения пробы в пенал гамма-фон на участке снижается до природного уровня.',
        alaraRuleRu: 'Защита экранированием: транспортировка проб ЕРН в экранированных контейнерах.'
      }
    ],
    buildScene: (scene: THREE.Scene) => {
      const envGroup = new THREE.Group();

      const ground = new THREE.Mesh(
        new THREE.PlaneGeometry(36, 36),
        new THREE.MeshStandardMaterial({
          color: 0xa8a29e,
          map: createQuarryGroundTexture(),
          roughness: 0.9,
          metalness: 0.05
        })
      );
      ground.name = 'scene_floor';
      ground.userData = { ...ground.userData, isFloor: true };
      ground.rotation.x = -Math.PI / 2;
      ground.receiveShadow = true;
      envGroup.add(ground);

      const rockMat = new THREE.MeshStandardMaterial({
        color: 0x78716c,
        roughness: 0.85,
        metalness: 0.12
      });

      const rocks: THREE.Mesh[] = [];
      const rockCoords = [
        [-2.8, 0.5, -2.5],
        [-1.1, 0.4, -3.8],
        [1.8, 0.6, -2.8],
        [0.5, 0.35, -3.1],
        [2.9, 0.5, -3.9]
      ];

      rockCoords.forEach(([x, r, z]) => {
        const mesh = new THREE.Mesh(new THREE.DodecahedronGeometry(r, 1), rockMat);
        mesh.position.set(x, r * 0.7, z);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        envGroup.add(mesh);
        rocks.push(mesh);
      });

      const hotRock = rocks[3];
      hotRock.userData = {
        ...hotRock.userData,
        interactiveId: 'norm_rock',
        placementType: 'prop',
        isLargeEquipment: false
      };

      const pig = createTK6Container();
      pig.scale.setScalar(0.85);
      pig.position.set(-2.2, 0, -1.0);
      pig.userData = {
        ...pig.userData,
        interactiveId: 'sample_carrier',
        placementType: 'floor',
        isLargeEquipment: true
      };
      envGroup.add(pig);

      scene.add(envGroup);

      return {
        envGroup,
        sources: [
          {
            id: 'src_mine_ra226',
            position: hotRock.position.clone(),
            isotopeId: 'Ra-226',
            activityMBq: 16500,
            mesh: hotRock
          },
          {
            id: 'src_mine_th232',
            position: new THREE.Vector3(-1.1, 0.4, -3.8),
            isotopeId: 'Th-232',
            activityMBq: 6200
          },
          {
            id: 'src_mine_k40',
            position: new THREE.Vector3(1.8, 0.5, -2.8),
            isotopeId: 'K-40',
            activityMBq: 14000
          }
        ],
        shields: [],
        interactive: [
          {
            id: 'norm_rock',
            nameRu: 'Керн урановой руды Ra-226 (16.5 ГБк)',
            type: 'sample',
            placementType: 'prop',
            isLargeEquipment: false,
            mesh: hotRock,
            interacted: false
          },
          {
            id: 'sample_carrier',
            nameRu: 'Геологический свинцовый пенал проб',
            type: 'container',
            placementType: 'floor',
            isLargeEquipment: true,
            mesh: pig,
            interacted: false
          }
        ]
      };
    }
  },

  // =========================================================================================
  // 6. Зоны ликвидации аварий и хранилища ЯО (ХОЯТ / ПЗРО)
  // =========================================================================================
  {
    id: 6,
    categoryRu: 'Зоны ликвидации аварий и хранилища ЯО',
    titleRu: '6. ХОЯТ и ПЗРО: Локализация нейтронно-гамма поля (²⁵²Cf, ¹³⁷Cs)',
    shortDescriptionRu:
      'Поиск и локализация горячих точек, радиационный контроль хранилищ отработавшего ядерного топлива (ХОЯТ) и пунктов захоронения РАО.',
    facilityRu: 'Подземный бункер-хранилище контейнеров ТУК-13 (ХОЯТ / ПЗРО, аварийное освещение)',
    dominantIsotopes: ['Cf-252', 'Cs-137', 'Co-60'],
    recommendedPermitLimitMsv: 0.25,
    initialPlayerPos: new THREE.Vector3(0, 1.65, 4.4),
    ambientColor: 0x1e293b,
    fogColor: 0x090d16,
    fogDensity: 0.028,
    isLowLight: true,
    stages: [
      {
        stepNumber: 1,
        titleRu: 'Этап 1 из 3: Нейтронная дозиметрия у контейнера ТУК',
        taskRu: 'Переключите прибор на нейтронный радиометр «Нейтрон» и оцените вклад нейтронов в окне аналитики.',
        hintRu: 'Отработавшее ядерное топливо создает интенсивный поток быстрых и тепловых нейтронов (w_R = 10).',
        alaraRuleRu: 'Нейтронная защита: свинец слабо задерживает нейтроны — необходим водородсодержащий парафин с бором.'
      },
      {
        stepNumber: 2,
        titleRu: 'Этап 2 из 3: Установка борированного полиэтиленового экрана',
        taskRu: 'Захватите синий водородно-борный экран (клавиша E) и установите его напротив дефектного шва ТУК.',
        hintRu: 'Парафин и борированный полиэтилен замедляют быстрые нейтроны на ядрах водорода и поглощают их бором-10.',
        alaraRuleRu: 'Защита экранированием: комбинированная защита (полиэтилен + свинец/бетон) против n + γ излучения.'
      },
      {
        stepNumber: 3,
        titleRu: 'Этап 3 из 3: Экранирование гамма-компоненты свинцом',
        taskRu: 'Дополнительно установите передвижную свинцовую ширму (E) для подавления вторичного гамма-фона.',
        hintRu: 'Оцените итоговый коэффициент ослабления K_prot в таблице факторов ослабления.',
        alaraRuleRu: 'Комплексное применение многослойных защитных преград в ХОЯТ.'
      }
    ],
    buildScene: (scene: THREE.Scene) => {
      const envGroup = new THREE.Group();
      buildIndustrialRoom(envGroup, 16, 16, 5.4);

      // Массивный транспортный упаковочный комплект ТУК-13 (вертикальный цилиндр)
      const caskMat = new THREE.MeshStandardMaterial({
        color: 0x475569,
        roughness: 0.35,
        metalness: 0.8,
        map: createBrushedMetalTexture()
      });
      const cask = new THREE.Mesh(new THREE.CylinderGeometry(0.95, 0.95, 3.6, 32), caskMat);
      cask.position.set(0, 1.8, -3.8);
      cask.castShadow = true;
      envGroup.add(cask);

      // Желтые бочки РАО (ПЗРО)
      const drumMat = new THREE.MeshStandardMaterial({ color: 0xeab308, roughness: 0.4, metalness: 0.4 });
      for (let i = 0; i < 3; i++) {
        const drum = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.32, 0.92, 24), drumMat);
        drum.position.set(2.4 + i * 0.75, 0.46, -3.4);
        drum.castShadow = true;
        envGroup.add(drum);
      }

      // Экран из парафина / борированного полиэтилена (для нейтронов)
      const paraffinWall = createBoratedParaffinWall();
      paraffinWall.position.set(-2.6, 0, -1.4);
      paraffinWall.userData = {
        ...paraffinWall.userData,
        interactiveId: 'paraffin_shield',
        placementType: 'floor',
        isLargeEquipment: true
      };
      envGroup.add(paraffinWall);

      // Свинцовая ширма
      const leadShield = createMovableLeadShieldScreen();
      leadShield.position.set(2.6, 0, -1.0);
      leadShield.userData = {
        ...leadShield.userData,
        interactiveId: 'screen_shield',
        placementType: 'floor',
        isLargeEquipment: true
      };
      envGroup.add(leadShield);

      scene.add(envGroup);

      return {
        envGroup,
        sources: [
          {
            id: 'src_hoyat_cf252',
            position: new THREE.Vector3(0, 1.5, -2.9),
            isotopeId: 'Cf-252',
            activityMBq: 14500
          },
          {
            id: 'src_hoyat_cs137',
            position: new THREE.Vector3(2.8, 0.5, -3.4),
            isotopeId: 'Cs-137',
            activityMBq: 38000
          }
        ],
        shields: [
          {
            id: 'paraffin_shield',
            mesh: paraffinWall,
            material: 'paraffin_borated',
            thicknessCm: 14.0,
            boundingBox: new THREE.Box3().setFromObject(paraffinWall)
          },
          {
            id: 'lead_screen',
            mesh: leadShield,
            material: 'lead',
            thicknessCm: 2.0,
            boundingBox: new THREE.Box3().setFromObject(leadShield)
          }
        ],
        interactive: [
          {
            id: 'paraffin_shield',
            nameRu: 'Нейтронный экран (Парафин / Борированный полиэтилен 140 мм)',
            type: 'shield',
            placementType: 'floor',
            isLargeEquipment: true,
            shieldMaterial: 'paraffin_borated',
            shieldThicknessCm: 14.0,
            mesh: paraffinWall,
            interacted: false
          },
          {
            id: 'screen_shield',
            nameRu: 'Свинцовая гамма-ширма (20 мм Pb)',
            type: 'shield',
            placementType: 'floor',
            isLargeEquipment: true,
            shieldMaterial: 'lead',
            shieldThicknessCm: 2.0,
            mesh: leadShield,
            interacted: false
          }
        ]
      };
    }
  },

  // =========================================================================================
  // 7. Строительные площадки и участки под застройку
  // =========================================================================================
  {
    id: 7,
    categoryRu: 'Строительные площадки и участки под застройку',
    titleRu: '7. Стройплощадка: Поток радона-222 из грунта (²²²Rn, ²²⁶Ra)',
    shortDescriptionRu:
      'Измерение ППС (плотности потока радона-222 с поверхности грунта) накопительными камерами и замер гамма-фона котлована перед застройкой.',
    facilityRu: 'Темный подземный подвал и фундаментный коллектор здания (контроль радона)',
    dominantIsotopes: ['Rn-222', 'Ra-226'],
    recommendedPermitLimitMsv: 0.05,
    initialPlayerPos: new THREE.Vector3(0, 1.65, 4.2),
    ambientColor: 0x1e293b,
    fogColor: 0x090d16,
    fogDensity: 0.032,
    isLowLight: true,
    stages: [
      {
        stepNumber: 1,
        titleRu: 'Этап 1 из 3: Защита органов дыхания от радона и торона',
        taskRu: 'Включите комплект СИЗ в окне аналитики и обследуйте разлом грунта в котловане на эксхаляцию радона-222.',
        hintRu: 'Радон-222 и его дочерние продукты распада формируют свыше 60% альфа-нагрузки на легкие.',
        alaraRuleRu: 'СИЗ: применение противоаэрозольных респираторов на радоноопасных участках.'
      },
      {
        stepNumber: 2,
        titleRu: 'Этап 2 из 3: Установка защитного газонепроницаемого купола',
        taskRu: 'Возьмите защитный экран-перекрытие (E) и установите его над тектонической трещиной выхода радона.',
        hintRu: 'Бетонная стяжка и противорадоновая мембрана снижают ППС радона ниже норматива 80 мБк/(м²·с).',
        alaraRuleRu: 'Защита экранированием: инженерная радонозащита фундамента здания.'
      },
      {
        stepNumber: 3,
        titleRu: 'Этап 3 из 3: Съемка накопительной угольной кассеты НК-32',
        taskRu: 'Извлеките контрольную сорбционную кассету (E) и поместите её в герметичный контейнер для лаборатории.',
        hintRu: 'Сравните спектральный вклад альфа- и гамма-излучения до и после укрытия трещины.',
        alaraRuleRu: 'Радиационно-экологический контроль территорий по СП 2.6.1.2612-10.'
      }
    ],
    buildScene: (scene: THREE.Scene) => {
      const envGroup = new THREE.Group();

      const ground = new THREE.Mesh(
        new THREE.PlaneGeometry(32, 32),
        new THREE.MeshStandardMaterial({
          color: 0x9ca3af,
          map: createQuarryGroundTexture(),
          roughness: 0.92
        })
      );
      ground.name = 'scene_floor';
      ground.userData = { ...ground.userData, isFloor: true };
      ground.rotation.x = -Math.PI / 2;
      ground.receiveShadow = true;
      envGroup.add(ground);

      // Фундаментные блоки ФБС по периметру котлована
      const concreteMat = new THREE.MeshStandardMaterial({ color: 0x64748b, roughness: 0.85 });
      for (let i = 0; i < 4; i++) {
        const fbs = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.6, 0.6), concreteMat);
        fbs.position.set(-3.6 + i * 2.4, 0.3, -4.5);
        fbs.castShadow = true;
        envGroup.add(fbs);
      }

      // Накопительная сорбционная камера НК-32 на грунте
      const radonChamber = new THREE.Group();
      radonChamber.position.set(0.4, 0.12, -2.4);
      const dome = new THREE.Mesh(
        new THREE.CylinderGeometry(0.18, 0.24, 0.22, 24),
        new THREE.MeshStandardMaterial({ color: 0x0ea5e9, roughness: 0.3, metalness: 0.4 })
      );
      radonChamber.add(dome);
      radonChamber.userData = {
        ...radonChamber.userData,
        interactiveId: 'norm_rock',
        placementType: 'prop',
        isLargeEquipment: false
      };
      envGroup.add(radonChamber);

      // Защитный экран и контейнер проб
      const bricks = createLeadBrickStack(3, 4);
      bricks.position.set(-2.0, 0, -1.4);
      bricks.userData = {
        ...bricks.userData,
        interactiveId: 'lead_bricks',
        placementType: 'floor',
        isLargeEquipment: true
      };
      envGroup.add(bricks);

      const carrier = createTK6Container();
      carrier.scale.setScalar(0.8);
      carrier.position.set(2.2, 0, -1.2);
      carrier.userData = {
        ...carrier.userData,
        interactiveId: 'sample_carrier',
        placementType: 'floor',
        isLargeEquipment: true
      };
      envGroup.add(carrier);

      scene.add(envGroup);

      return {
        envGroup,
        sources: [
          {
            id: 'src_site_radon222',
            position: new THREE.Vector3(0.4, 0.15, -2.4),
            isotopeId: 'Rn-222',
            activityMBq: 5200,
            mesh: radonChamber
          },
          {
            id: 'src_site_ra226',
            position: new THREE.Vector3(-0.8, 0.1, -3.1),
            isotopeId: 'Ra-226',
            activityMBq: 9500
          }
        ],
        shields: [
          {
            id: 'lead_bricks',
            mesh: bricks,
            material: 'concrete',
            thicknessCm: 12.0,
            boundingBox: new THREE.Box3().setFromObject(bricks)
          }
        ],
        interactive: [
          {
            id: 'lead_bricks',
            nameRu: 'Защитная баритобетонная плита (120 мм)',
            type: 'shield',
            placementType: 'floor',
            isLargeEquipment: true,
            shieldMaterial: 'concrete',
            shieldThicknessCm: 12.0,
            mesh: bricks,
            interacted: false
          },
          {
            id: 'norm_rock',
            nameRu: 'Накопительная угольная камера НК-32 (Радон-222)',
            type: 'sample',
            placementType: 'prop',
            isLargeEquipment: false,
            mesh: radonChamber,
            interacted: false
          },
          {
            id: 'sample_carrier',
            nameRu: 'Герметичный транспортировочный кофр',
            type: 'container',
            placementType: 'floor',
            isLargeEquipment: true,
            mesh: carrier,
            interacted: false
          }
        ]
      };
    }
  },

  // =========================================================================================
  // 8. Метрополитен и вокзалы
  // =========================================================================================
  {
    id: 8,
    categoryRu: 'Метрополитен и вокзалы',
    titleRu: '8. Метро и вокзалы: Гранит и рентген-интроскоп (X-Ray, ²³²Th)',
    shortDescriptionRu:
      'Радиационный контроль облицовочного гранита и туффитов станций, а также проверка досмотровых рентгеновских интроскопов на утечку пучка.',
    facilityRu: 'Подземный свод станции метрополитена и технический туннель интроскопии',
    dominantIsotopes: ['X-Ray-100kV', 'Th-232', 'Ra-226'],
    recommendedPermitLimitMsv: 0.05,
    initialPlayerPos: new THREE.Vector3(0, 1.65, 4.2),
    ambientColor: 0x1e293b,
    fogColor: 0x0b1120,
    fogDensity: 0.025,
    isLowLight: true,
    stages: [
      {
        stepNumber: 1,
        titleRu: 'Этап 1 из 3: Замер дефекта шторки багажного интроскопа',
        taskRu: 'Проверьте выходное окно рентгеновского интроскопа, где повреждена свинцовая ламель.',
        hintRu: 'Тормозное рентгеновское излучение 100 кВ эффективно ослабляется тонким слоем свинца или просвинцованной резины.',
        alaraRuleRu: 'Контроль лучевых досмотровых установок (СанПиН 2.6.1.3488-17).'
      },
      {
        stepNumber: 2,
        titleRu: 'Этап 2 из 3: Экранирование зоны выхода туннеля интроскопа',
        taskRu: 'Установите защитную свинцовую ширму (E) перед дефектным окном рентгеновского интроскопа.',
        hintRu: 'Свинец при энергии 100 кэВ имеет высокий коэффициент ослабления μ = 58 см⁻¹.',
        alaraRuleRu: 'Защита экранированием: устранение утечки рассеянного рентгеновского излучения.'
      },
      {
        stepNumber: 3,
        titleRu: 'Этап 3 из 3: Отключение анодного напряжения интроскопа',
        taskRu: 'Поверните сервисный выключатель генератора рентгеновской трубки (E) и проверьте гранитные колонны.',
        hintRu: 'Гранитная облицовка 1 класса имеет повышенный природный фон Th-232 и Ra-226 до 0.35–0.50 мкЗв/ч.',
        alaraRuleRu: 'Защита временем: немедленное отключение неисправных генерирующих ИИИ.'
      }
    ],
    buildScene: (scene: THREE.Scene) => {
      const envGroup = new THREE.Group();
      buildCleanRoom(envGroup, 16, 14, 4.6);

      // Гранитные колонны станции метрополитена (красно-коричневый полированный гранит)
      const graniteMat = new THREE.MeshStandardMaterial({
        color: 0x7f1d1d,
        roughness: 0.18,
        metalness: 0.2
      });
      for (const x of [-3.5, 3.5]) {
        const col = new THREE.Mesh(new THREE.BoxGeometry(0.9, 4.5, 0.9), graniteMat);
        col.position.set(x, 2.25, -2.5);
        col.castShadow = true;
        envGroup.add(col);
      }

      // Досмотровый рентгеновский интроскоп с конвейерной лентой
      const scannerMat = new THREE.MeshStandardMaterial({ color: 0xe2e8f0, roughness: 0.3, metalness: 0.5 });
      const tunnel = new THREE.Mesh(new THREE.BoxGeometry(1.4, 1.5, 1.8), scannerMat);
      tunnel.position.set(0, 1.15, -3.2);
      tunnel.castShadow = true;
      envGroup.add(tunnel);

      const belt = new THREE.Mesh(
        new THREE.BoxGeometry(1.2, 0.4, 3.4),
        new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.8 })
      );
      belt.position.set(0, 0.2, -3.2);
      envGroup.add(belt);

      // Выключатель рентгеновского генератора на корпусе интроскопа
      const xraySwitch = createHighDetailValve();
      xraySwitch.scale.setScalar(0.55);
      xraySwitch.position.set(0.75, 1.3, -2.5);
      envGroup.add(xraySwitch);

      const shieldMesh = createMovableLeadShieldScreen();
      shieldMesh.position.set(-2.2, 0, -0.8);
      shieldMesh.userData = {
        ...shieldMesh.userData,
        interactiveId: 'screen_shield',
        placementType: 'floor',
        isLargeEquipment: true
      };
      envGroup.add(shieldMesh);

      scene.add(envGroup);

      return {
        envGroup,
        sources: [
          {
            id: 'src_metro_xray',
            position: new THREE.Vector3(0, 1.0, -2.3),
            isotopeId: 'X-Ray-100kV',
            activityMBq: 32000
          },
          {
            id: 'src_metro_granite_th232',
            position: new THREE.Vector3(-3.5, 1.4, -2.5),
            isotopeId: 'Th-232',
            activityMBq: 4200
          }
        ],
        shields: [
          {
            id: 'lead_screen',
            mesh: shieldMesh,
            material: 'lead',
            thicknessCm: 1.5,
            boundingBox: new THREE.Box3().setFromObject(shieldMesh)
          }
        ],
        interactive: [
          {
            id: 'screen_shield',
            nameRu: 'Защитная рентгенозащитная ширма (15 мм Pb)',
            type: 'shield',
            placementType: 'floor',
            isLargeEquipment: true,
            shieldMaterial: 'lead',
            shieldThicknessCm: 1.5,
            mesh: shieldMesh,
            interacted: false
          },
          {
            id: 'reactor_valve',
            nameRu: 'Аварийный разъединитель анода интроскопа',
            type: 'valve',
            placementType: 'floor',
            isLargeEquipment: true,
            mesh: xraySwitch,
            interacted: false
          }
        ]
      };
    }
  },

  // =========================================================================================
  // 9. Строительные и отделочные материалы
  // =========================================================================================
  {
    id: 9,
    categoryRu: 'Строительные и отделочные материалы',
    titleRu: '9. Стройматериалы: Щебень и кафель с урановой глазурью (²³⁸U, ²²⁶Ra)',
    shortDescriptionRu:
      'Проверка гранитного щебня, бетона, старой керамической плитки и винтажного кафеля с оранжево-желтой урановой глазурью.',
    facilityRu: 'Склад-лаборатория входного контроля строительных и отделочных материалов',
    dominantIsotopes: ['U-238', 'Ra-226', 'K-40'],
    recommendedPermitLimitMsv: 0.05,
    initialPlayerPos: new THREE.Vector3(0, 1.65, 4.0),
    ambientColor: 0xf8fafc,
    fogColor: 0xe2e8f0,
    fogDensity: 0.0015,
    stages: [
      {
        stepNumber: 1,
        titleRu: 'Этап 1 из 3: Бета-гамма контроль керамической плитки',
        taskRu: 'Найдите паллету со старой керамической плиткой, покрытой урановой глазурью U-238.',
        hintRu: 'Урановая глазурь дает интенсивный поток бета-частиц и альфа-излучения вблизи поверхности.',
        alaraRuleRu: 'СИЗ: плотные резиновые перчатки и костюм КЗМ задерживают 95–99% бета-излучения.'
      },
      {
        stepNumber: 2,
        titleRu: 'Этап 2 из 3: Изъятие образца фонящего кафеля в контейнер',
        taskRu: 'Возьмите дефектную плитку с урановой глазурью (E) и поместите её в свинцовый контейнер ТК-6.',
        hintRu: 'Удельная эффективная активность A_эфф стройматериалов I класса не должна превышать 370 Бк/кг.',
        alaraRuleRu: 'Защита расстоянием и экранированием при работе с открытыми бета-источниками.'
      },
      {
        stepNumber: 3,
        titleRu: 'Этап 3 из 3: Ограждение партии гранитного щебня III класса',
        taskRu: 'Установите блок свинцовых кирпичей (E) перед насыпью высокоактивного гранитного щебня.',
        hintRu: 'Проконтролируйте снижение вклада бета- и гамма-компонент на диаграмме спектрального состава.',
        alaraRuleRu: 'НРБ-99/2009: классификация строительных материалов по удельной активности ЕРН.'
      }
    ],
    buildScene: (scene: THREE.Scene) => {
      const envGroup = new THREE.Group();
      buildIndustrialRoom(envGroup, 14, 12, 4.5);

      // Стол лабораторного контроля с образцами кафеля и щебня
      const table = new THREE.Mesh(
        new THREE.BoxGeometry(2.6, 0.85, 1.1),
        new THREE.MeshStandardMaterial({ color: 0x475569, roughness: 0.5 })
      );
      table.position.set(0, 0.425, -2.8);
      table.castShadow = true;
      envGroup.add(table);

      // Оранжево-красная керамическая плитка с урановой глазурью (UO3)
      const uraniumTile = new THREE.Mesh(
        new THREE.BoxGeometry(0.32, 0.04, 0.32),
        new THREE.MeshStandardMaterial({ color: 0xea580c, roughness: 0.15, metalness: 0.1 })
      );
      uraniumTile.position.set(0.35, 0.88, -2.6);
      uraniumTile.userData = {
        ...uraniumTile.userData,
        interactiveId: 'ir_capsule',
        placementType: 'prop',
        isLargeEquipment: false
      };
      envGroup.add(uraniumTile);

      // Контейнер ТК-6 и свинцовые кирпичи
      const tk6 = createTK6Container();
      tk6.position.set(-1.9, 0, -1.3);
      tk6.userData = {
        ...tk6.userData,
        interactiveId: 'tk6_box',
        placementType: 'floor',
        isLargeEquipment: true
      };
      envGroup.add(tk6);

      const bricks = createLeadBrickStack(3, 4);
      bricks.position.set(1.8, 0, -1.3);
      bricks.userData = {
        ...bricks.userData,
        interactiveId: 'lead_bricks',
        placementType: 'floor',
        isLargeEquipment: true
      };
      envGroup.add(bricks);

      scene.add(envGroup);

      return {
        envGroup,
        sources: [
          {
            id: 'src_tile_u238',
            position: uraniumTile.position.clone(),
            isotopeId: 'U-238',
            activityMBq: 48000,
            mesh: uraniumTile
          },
          {
            id: 'src_gravel_ra226',
            position: new THREE.Vector3(-0.7, 0.9, -2.8),
            isotopeId: 'Ra-226',
            activityMBq: 11500
          }
        ],
        shields: [
          {
            id: 'lead_bricks',
            mesh: bricks,
            material: 'lead',
            thicknessCm: 5.0,
            boundingBox: new THREE.Box3().setFromObject(bricks)
          }
        ],
        interactive: [
          {
            id: 'ir_capsule',
            nameRu: 'Плитка с урановой глазурью U-238',
            type: 'source',
            placementType: 'prop',
            isLargeEquipment: false,
            mesh: uraniumTile,
            interacted: false
          },
          {
            id: 'tk6_box',
            nameRu: 'Защитный контейнер-изолятор ТК-6',
            type: 'container',
            placementType: 'floor',
            isLargeEquipment: true,
            mesh: tk6,
            interacted: false
          },
          {
            id: 'lead_bricks',
            nameRu: 'Свинцовый экран лабораторного стола',
            type: 'shield',
            placementType: 'floor',
            isLargeEquipment: true,
            shieldMaterial: 'lead',
            shieldThicknessCm: 5.0,
            mesh: bricks,
            interacted: false
          }
        ]
      };
    }
  },

  // =========================================================================================
  // 10. Продукты питания
  // =========================================================================================
  {
    id: 10,
    categoryRu: 'Продукты питания',
    titleRu: '10. Санэпидконтроль: Дикорастущие грибы, ягоды и рыба (¹³⁷Cs)',
    shortDescriptionRu:
      'Дозиметрический и гамма-спектрометрический контроль дикорастущих грибов, лесных ягод (цезий-137 в экосистемах) и привозной морской рыбы.',
    facilityRu: 'Лаборатория ветеринарно-санитарной экспертизы рынка',
    dominantIsotopes: ['Cs-137', 'K-40'],
    recommendedPermitLimitMsv: 0.05,
    initialPlayerPos: new THREE.Vector3(0, 1.65, 3.8),
    ambientColor: 0xf8fafc,
    fogColor: 0xf1f5f9,
    fogDensity: 0.001,
    stages: [
      {
        stepNumber: 1,
        titleRu: 'Этап 1 из 3: Спектрометрический скрининг проб NaI(Tl)',
        taskRu: 'Выберите сцинтилляционный спектрометр NaI(Tl) и найдите загрязненную партию сушеных грибов (Cs-137).',
        hintRu: 'Грибы (польский гриб, маслята) и черника являются сильными аккумуляторами техногенного Цезия-137 (662 кэВ).',
        alaraRuleRu: 'Радиационный контроль продовольственного сырья по СанПиН 2.3.2.1078-01.'
      },
      {
        stepNumber: 2,
        titleRu: 'Этап 2 из 3: Помещение сосуда Маринелли в свинцовый домик',
        taskRu: 'Захватите сосуд Маринелли с пробой лесных грибов (E) и перенесите его в желтый свинцовый домик ТК-6.',
        hintRu: 'Свинцовая защита спектрометра снижает внешний фон и изолирует высокоактивную пробу.',
        alaraRuleRu: 'Защита экранированием и расстоянием при работе с концентрированными пробами.'
      },
      {
        stepNumber: 3,
        titleRu: 'Этап 3 из 3: Выбраковка партии и экспорт протокола CSV',
        taskRu: 'Убедитесь в снижении гамма-фона в лаборатории и экспортируйте данные дозиметрии в CSV.',
        hintRu: 'Допустимый уровень Cs-137 в свежих дикорастущих грибах — 500 Бк/кг, в сушеных — 2500 Бк/кг.',
        alaraRuleRu: 'Предотвращение внутреннего облучения населения с пищевыми продуктами.'
      }
    ],
    buildScene: (scene: THREE.Scene) => {
      const envGroup = new THREE.Group();
      buildCleanRoom(envGroup, 12, 12, 4.0);

      // Лабораторный стол ветеринарно-санитарной экспертизы
      const bench = new THREE.Mesh(
        new THREE.BoxGeometry(2.8, 0.88, 1.0),
        new THREE.MeshStandardMaterial({ color: 0xe2e8f0, roughness: 0.25, metalness: 0.2 })
      );
      bench.position.set(0, 0.44, -2.6);
      bench.castShadow = true;
      envGroup.add(bench);

      // Сосуд Маринелли 1 л с пробой дикорастущих грибов и ягод
      const marinelliBeaker = new THREE.Group();
      marinelliBeaker.position.set(0.45, 0.98, -2.45);
      const jar = new THREE.Mesh(
        new THREE.CylinderGeometry(0.11, 0.11, 0.18, 24),
        new THREE.MeshStandardMaterial({ color: 0xb45309, roughness: 0.3, transparent: true, opacity: 0.9 })
      );
      const lid = new THREE.Mesh(
        new THREE.CylinderGeometry(0.115, 0.115, 0.03, 24),
        new THREE.MeshStandardMaterial({ color: 0xef4444, roughness: 0.4 })
      );
      lid.position.y = 0.1;
      marinelliBeaker.add(jar, lid);
      marinelliBeaker.userData = {
        ...marinelliBeaker.userData,
        interactiveId: 'ir_capsule',
        placementType: 'prop',
        isLargeEquipment: false
      };
      envGroup.add(marinelliBeaker);

      // Низкофоновый свинцовый домик гамма-спектрометра
      const leadHouse = createTK6Container();
      leadHouse.position.set(-1.8, 0, -1.2);
      leadHouse.userData = {
        ...leadHouse.userData,
        interactiveId: 'tk6_box',
        placementType: 'floor',
        isLargeEquipment: true
      };
      envGroup.add(leadHouse);

      scene.add(envGroup);

      return {
        envGroup,
        sources: [
          {
            id: 'src_food_cs137',
            position: marinelliBeaker.position.clone(),
            isotopeId: 'Cs-137',
            activityMBq: 24000,
            mesh: marinelliBeaker
          },
          {
            id: 'src_food_k40_fish',
            position: new THREE.Vector3(-0.6, 0.95, -2.5),
            isotopeId: 'K-40',
            activityMBq: 8500
          }
        ],
        shields: [],
        interactive: [
          {
            id: 'ir_capsule',
            nameRu: 'Сосуд Маринелли: Грибы и ягоды (¹³⁷Cs)',
            type: 'source',
            placementType: 'prop',
            isLargeEquipment: false,
            mesh: marinelliBeaker,
            interacted: false
          },
          {
            id: 'tk6_box',
            nameRu: 'Свинцовый домик гамма-спектрометра',
            type: 'container',
            placementType: 'floor',
            isLargeEquipment: true,
            mesh: leadHouse,
            interacted: false
          }
        ]
      };
    }
  },

  // =========================================================================================
  // 11. Предметы старины и антиквариат (СПД Радий-226)
  // =========================================================================================
  {
    id: 11,
    categoryRu: 'Предметы старины и антиквариат',
    titleRu: '11. Антиквариат: Авиационные часы, компасы и СПД (²²⁶Ra)',
    shortDescriptionRu:
      'Поиск и дезактивация советских авиационных и водолазных часов, компасов, тумблеров и елочных игрушек со светосоставом постоянного действия (СПД Радий-226).',
    facilityRu: 'Экспертиза антикварного салона и коллекции исторических приборов',
    dominantIsotopes: ['Ra-226'],
    recommendedPermitLimitMsv: 0.08,
    initialPlayerPos: new THREE.Vector3(0, 1.65, 3.8),
    ambientColor: 0xf8fafc,
    fogColor: 0xe2e8f0,
    fogDensity: 0.0015,
    stages: [
      {
        stepNumber: 1,
        titleRu: 'Этап 1 из 3: Защита СИЗ от осыпающейся радиевой краски СПД',
        taskRu: 'Экипируйте СИЗ (перчатки + респиратор) в окне аналитики и найдите фонящие авиационные часы АЧС-1 с СПД.',
        hintRu: 'Старый светосостав постоянного действия (ZnS + Ra-226) со временем осыпается, создавая опасную альфа-пыль.',
        alaraRuleRu: 'СИЗ: 100% блокировка альфа-частиц и 95–99% ослабление бета-излучения Радия-226.'
      },
      {
        stepNumber: 2,
        titleRu: 'Этап 2 из 3: Дистанционный захват прибора с СПД',
        taskRu: 'Используя дистанционный захват, возьмите авиационные часы с Радием-226 (клавиша E).',
        hintRu: 'Вблизи циферблата с СПД мощность дозы может превышать 500–1500 мкЗв/ч.',
        alaraRuleRu: 'Защита расстоянием: закон обратных квадратов D(r) = A·Γ / r².'
      },
      {
        stepNumber: 3,
        titleRu: 'Этап 3 из 3: Изоляция прибора СПД в контейнер ТК-6',
        taskRu: 'Поместите часы с СПД Радий-226 в защитный свинцовый контейнер ТК-6 (E) для сдачи в «Радон».',
        hintRu: 'Проверьте снижение всех трех компонент (α, β, γ) на графиках дозиметрического анализа.',
        alaraRuleRu: 'Дезактивация и утилизация исторических изделий с СПД через спецкомбинат.'
      }
    ],
    buildScene: (scene: THREE.Scene) => {
      const envGroup = new THREE.Group();
      buildCleanRoom(envGroup, 12, 12, 4.0);

      // Антикварная витрина / стол
      const antiqueTable = new THREE.Mesh(
        new THREE.BoxGeometry(2.6, 0.84, 1.1),
        new THREE.MeshStandardMaterial({ color: 0x451a03, roughness: 0.45, metalness: 0.1 })
      );
      antiqueTable.position.set(0, 0.42, -2.5);
      antiqueTable.castShadow = true;
      envGroup.add(antiqueTable);

      // Авиационные часы-хронометр АЧС-1 / водолазные часы с зеленым свечением СПД Ra-226
      const radiumClock = new THREE.Group();
      radiumClock.position.set(0.25, 0.90, -2.35);
      const clockCase = new THREE.Mesh(
        new THREE.CylinderGeometry(0.085, 0.085, 0.07, 24),
        new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.3, metalness: 0.85 })
      );
      clockCase.rotation.x = Math.PI / 3;
      const dialGlow = new THREE.Mesh(
        new THREE.CylinderGeometry(0.072, 0.072, 0.074, 24),
        new THREE.MeshBasicMaterial({ color: 0x4ade80 })
      );
      dialGlow.rotation.x = Math.PI / 3;
      radiumClock.add(clockCase, dialGlow);
      radiumClock.userData = {
        ...radiumClock.userData,
        interactiveId: 'ir_capsule',
        placementType: 'prop',
        isLargeEquipment: false
      };
      envGroup.add(radiumClock);

      // Защитный контейнер ТК-6 спецкомбината «Радон»
      const tk6 = createTK6Container();
      tk6.position.set(-1.8, 0, -1.2);
      tk6.userData = {
        ...tk6.userData,
        interactiveId: 'tk6_box',
        placementType: 'floor',
        isLargeEquipment: true
      };
      envGroup.add(tk6);

      // Передвижная свинцовая ширма
      const shieldMesh = createMovableLeadShieldScreen();
      shieldMesh.position.set(2.1, 0, -1.2);
      shieldMesh.userData = {
        ...shieldMesh.userData,
        interactiveId: 'screen_shield',
        placementType: 'floor',
        isLargeEquipment: true
      };
      envGroup.add(shieldMesh);

      scene.add(envGroup);

      return {
        envGroup,
        sources: [
          {
            id: 'src_antique_ra226_clock',
            position: radiumClock.position.clone(),
            isotopeId: 'Ra-226',
            activityMBq: 58000,
            mesh: radiumClock
          },
          {
            id: 'src_antique_compass',
            position: new THREE.Vector3(-0.65, 0.88, -2.5),
            isotopeId: 'Ra-226',
            activityMBq: 9200
          }
        ],
        shields: [
          {
            id: 'lead_screen',
            mesh: shieldMesh,
            material: 'lead',
            thicknessCm: 2.0,
            boundingBox: new THREE.Box3().setFromObject(shieldMesh)
          }
        ],
        interactive: [
          {
            id: 'ir_capsule',
            nameRu: 'Авиационные часы АЧС-1 с СПД (Радий-226)',
            type: 'source',
            placementType: 'prop',
            isLargeEquipment: false,
            mesh: radiumClock,
            interacted: false
          },
          {
            id: 'tk6_box',
            nameRu: 'Защитный контейнер ТК-6 («Радон»)',
            type: 'container',
            placementType: 'floor',
            isLargeEquipment: true,
            mesh: tk6,
            interacted: false
          },
          {
            id: 'screen_shield',
            nameRu: 'Передвижная защитная ширма (20 мм Pb)',
            type: 'shield',
            placementType: 'floor',
            isLargeEquipment: true,
            shieldMaterial: 'lead',
            shieldThicknessCm: 2.0,
            mesh: shieldMesh,
            interacted: false
          }
        ]
      };
    }
  },

  // =========================================================================================
  // 12. Диверсия на заводе регенерации топлива (Разлив Pu-239 и предотвращение СЦР)
  // =========================================================================================
  {
    id: 12,
    categoryRu: 'Ядерно-оружейный комплекс и радиохимия',
    titleRu: '12. Завод регенерации ОЯТ: Разлив плутония и угроза СЦР (²³⁹Pu / ²⁵²Cf)',
    shortDescriptionRu:
      'Ликвидация последствий взрыва в цехе плутониевой экстракции, локализация радиоактивно-химических луж с SSS-свечением и подавление нейтронного потока борированным экраном.',
    facilityRu: 'Радиохимический цех регенерации топлива (Аварийный бокс экстракции)',
    dominantIsotopes: ['Pu-239', 'Cf-252', 'Cs-137'],
    recommendedPermitLimitMsv: 0.25,
    initialPlayerPos: new THREE.Vector3(0, 1.65, 4.4),
    ambientColor: 0x94a3b8,
    fogColor: 0x0f172a,
    fogDensity: 0.018,
    isLowLight: true,
    stages: [
      {
        stepNumber: 1,
        titleRu: 'Этап 1 из 3: Подавление нейтронного потока СЦР',
        taskRu: 'Переместите плиту из борированного полиэтилена (E / курок VR) к аварийному аппарату-экстрактору.',
        hintRu: 'Борированный полиэтилен замедляет быстрые нейтроны и поглощает тепловые нейтроны за счет ядер B-10.',
        alaraRuleRu: 'Защита от СЦР: немедленно введите нейтронопоглощающий барьер для срыва цепной реакции.'
      },
      {
        stepNumber: 2,
        titleRu: 'Этап 2 из 3: Перекрытие подачи плутониевого раствора',
        taskRu: 'Под защитой борированного и свинцового экранов перекройте запорный вентиль коллектора экстракции (E).',
        hintRu: 'Включите тактический фонарь на левой руке (кнопка Y / клавиша F) для осмотра темного аварийного бокса.',
        alaraRuleRu: 'Контроль СИЗ: работа в зоне аэрозолей Pu-239 допускается строго в изолирующем костюме КИХ-4 / пневмокостюме.'
      },
      {
        stepNumber: 3,
        titleRu: 'Этап 3 из 3: Эвакуация ампулы-пробы в ТУК',
        taskRu: 'Дистанционным манипулятором захватите аварийную пробу (E) и поместите её в защитный контейнер ТК-6.',
        hintRu: 'После завершения операции пройдите обязательный контроль кожи радиометром РЗБ-04 в санпропускнике.',
        alaraRuleRu: 'Защита расстоянием и временем: исключите прямой контакт перчаток с плутониевым раствором.'
      }
    ],
    buildScene: (scene: THREE.Scene) => {
      const envGroup = new THREE.Group();
      buildIndustrialRoom(envGroup, 15, 15, 5.0);

      // Поврежденный радиохимический аппарат-экстрактор из обожженного корродированного металла
      const scorchedMat = createScorchedCorrodedMetalMaterial(0x334155);
      const extractorVessel = new THREE.Mesh(
        new THREE.CylinderGeometry(0.65, 0.65, 3.2, 28),
        scorchedMat
      );
      extractorVessel.position.set(0, 1.6, -3.6);
      extractorVessel.castShadow = true;
      envGroup.add(extractorVessel);

      // Свечение Вавилова — Черенкова в зоне предкритичности раствора
      const cherenkov = createCherenkovRadiationGlowMesh(0.95);
      cherenkov.position.set(0, 1.35, -3.1);
      envGroup.add(cherenkov);

      // Опасная химическая плутониевая лужа с эффектом Subsurface Scattering (SSS) на полу
      const puddleMat = createChemicalPuddleSSSMaterial(0x10b981, 0x047857);
      const puddleMesh = new THREE.Mesh(new THREE.CylinderGeometry(1.65, 1.75, 0.018, 36), puddleMat);
      puddleMesh.position.set(0.2, 0.012, -3.1);
      envGroup.add(puddleMesh);

      // Неоднородное гауссово облако радиоактивного аэрозоля с эффектом Тиндаля
      const plumeCloud = createGaussianPlumeAerosolCloud(0x94a3b8, 3.6, 1.9, 3.2);
      plumeCloud.position.set(0, 0.5, -2.8);
      envGroup.add(plumeCloud);

      // Запорный вентиль коллектора экстракции
      const valveMesh = createHighDetailValve();
      valveMesh.position.set(0.72, 1.45, -3.1);
      valveMesh.userData = {
        ...valveMesh.userData,
        interactiveId: 'emergency_valve',
        placementType: 'prop',
        isLargeEquipment: false
      };
      envGroup.add(valveMesh);

      // Аварийная ампула-проба плутониевого концентрата
      const puSample = new THREE.Mesh(
        new THREE.CylinderGeometry(0.045, 0.045, 0.16, 20),
        new THREE.MeshStandardMaterial({
          color: 0x38bdf8,
          emissive: 0x0284c7,
          emissiveIntensity: 1.4,
          metalness: 0.7,
          roughness: 0.2
        })
      );
      puSample.position.set(-0.55, 0.09, -2.5);
      puSample.userData = {
        ...puSample.userData,
        interactiveId: 'ir_capsule',
        placementType: 'prop',
        isLargeEquipment: false
      };
      envGroup.add(puSample);

      // Защитный контейнер ТК-6
      const tk6 = createTK6Container();
      tk6.position.set(2.3, 0, -1.5);
      tk6.userData = {
        ...tk6.userData,
        interactiveId: 'tk6_box',
        placementType: 'floor',
        isLargeEquipment: true
      };
      envGroup.add(tk6);

      // Борированный полиэтиленовый щит и свинцовая ширма
      const boratedWall = createBoratedParaffinWall();
      boratedWall.position.set(-2.4, 0, -1.2);
      boratedWall.userData = {
        ...boratedWall.userData,
        interactiveId: 'borated_shield',
        placementType: 'floor',
        isLargeEquipment: true
      };
      envGroup.add(boratedWall);

      const leadScreen = createMovableLeadShieldScreen();
      leadScreen.position.set(-3.5, 0, 0.4);
      leadScreen.userData = {
        ...leadScreen.userData,
        interactiveId: 'screen_shield',
        placementType: 'floor',
        isLargeEquipment: true
      };
      envGroup.add(leadScreen);

      const beacon = createRadiationBeacon('danger');
      beacon.position.set(0, 3.6, -3.6);
      envGroup.add(beacon);

      scene.add(envGroup);

      return {
        envGroup,
        sources: [
          {
            id: 'src_reprocessing_cf252_scr',
            position: new THREE.Vector3(0, 1.3, -3.4),
            isotopeId: 'Cf-252',
            activityMBq: 95000
          },
          {
            id: 'src_reprocessing_pu239_spill',
            position: puSample.position.clone(),
            isotopeId: 'Pu-239',
            activityMBq: 140000,
            mesh: puSample
          },
          {
            id: 'src_reprocessing_cs137',
            position: new THREE.Vector3(0.4, 1.1, -3.2),
            isotopeId: 'Cs-137',
            activityMBq: 64000
          }
        ],
        shields: [
          {
            id: 'borated_paraffin_shield',
            mesh: boratedWall,
            material: 'paraffin_borated',
            thicknessCm: 12.0,
            boundingBox: new THREE.Box3().setFromObject(boratedWall)
          },
          {
            id: 'lead_screen',
            mesh: leadScreen,
            material: 'lead',
            thicknessCm: 2.0,
            boundingBox: new THREE.Box3().setFromObject(leadScreen)
          }
        ],
        interactive: [
          {
            id: 'borated_shield',
            nameRu: 'Нейтронопоглощающий экран (Борированный полиэтилен 120 мм)',
            type: 'shield',
            placementType: 'floor',
            isLargeEquipment: true,
            shieldMaterial: 'paraffin_borated',
            shieldThicknessCm: 12.0,
            mesh: boratedWall,
            interacted: false
          },
          {
            id: 'screen_shield',
            nameRu: 'Передвижная свинцовая ширма (20 мм Pb)',
            type: 'shield',
            placementType: 'floor',
            isLargeEquipment: true,
            shieldMaterial: 'lead',
            shieldThicknessCm: 2.0,
            mesh: leadScreen,
            interacted: false
          },
          {
            id: 'emergency_valve',
            nameRu: 'Запорный вентиль коллектора экстракции Pu-239',
            type: 'valve',
            placementType: 'prop',
            isLargeEquipment: false,
            mesh: valveMesh,
            interacted: false
          },
          {
            id: 'ir_capsule',
            nameRu: 'Аварийная ампула плутониевого концентрата (²³⁹Pu)',
            type: 'source',
            placementType: 'prop',
            isLargeEquipment: false,
            mesh: puSample,
            interacted: false
          },
          {
            id: 'tk6_box',
            nameRu: 'Защитный контейнер ТК-6 («Радон»)',
            type: 'container',
            placementType: 'floor',
            isLargeEquipment: true,
            mesh: tk6,
            interacted: false
          }
        ]
      };
    }
  }
];

/**
 * Построение промышленного зала со светлыми бетонными панелями, эпоксидным полом,
 * потолочными фермами, светильниками и колоннами
 */
function buildIndustrialRoom(group: THREE.Group, width: number, depth: number, height: number): void {
  const wallTex = createIndustrialConcreteWallTexture();
  wallTex.repeat.set(width / 4, height / 4);

  const wallMat = new THREE.MeshStandardMaterial({
    color: 0xe2e8f0,
    map: wallTex,
    roughness: 0.7,
    metalness: 0.08
  });

  const backWall = new THREE.Mesh(new THREE.BoxGeometry(width, height, 0.25), wallMat);
  backWall.position.set(0, height / 2, -depth / 2);
  backWall.receiveShadow = true;
  group.add(backWall);

  const frontWall = new THREE.Mesh(new THREE.BoxGeometry(width, height, 0.25), wallMat);
  frontWall.position.set(0, height / 2, depth / 2);
  frontWall.receiveShadow = true;
  group.add(frontWall);

  const leftWall = new THREE.Mesh(new THREE.BoxGeometry(0.25, height, depth), wallMat);
  leftWall.position.set(-width / 2, height / 2, 0);
  leftWall.receiveShadow = true;
  group.add(leftWall);

  const rightWall = new THREE.Mesh(new THREE.BoxGeometry(0.25, height, depth), wallMat);
  rightWall.position.set(width / 2, height / 2, 0);
  rightWall.receiveShadow = true;
  group.add(rightWall);

  const ceilingMat = new THREE.MeshStandardMaterial({
    color: 0xf1f5f9,
    roughness: 0.85,
    metalness: 0.1
  });
  const ceiling = new THREE.Mesh(new THREE.PlaneGeometry(width, depth), ceilingMat);
  ceiling.rotation.x = Math.PI / 2;
  ceiling.position.y = height;
  group.add(ceiling);

  const trussPositions = [-depth / 4, 0, depth / 4];
  trussPositions.forEach(zPos => {
    const truss = createIndustrialCeilingTruss(width - 0.5);
    truss.position.set(0, height - 0.25, zPos);
    group.add(truss);

    const lampLeft = createIndustrialCeilingLamp();
    lampLeft.position.set(-width / 4, height - 0.05, zPos);
    group.add(lampLeft);

    const lampRight = createIndustrialCeilingLamp();
    lampRight.position.set(width / 4, height - 0.05, zPos);
    group.add(lampRight);
  });

  const floorTex = createEpoxyFloorTexture();
  floorTex.repeat.set(width / 3, depth / 3);
  const floorPlaneMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    map: floorTex,
    roughness: 0.4,
    metalness: 0.1
  });
  const floorPlane = new THREE.Mesh(new THREE.PlaneGeometry(width, depth), floorPlaneMat);
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
  positions.forEach(([x, z]) => {
    const col = new THREE.Mesh(colGeo, colMat);
    col.position.set(x, height / 2, z);
    col.castShadow = true;
    col.receiveShadow = true;
    group.add(col);
  });
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
