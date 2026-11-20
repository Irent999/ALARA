/**
 * ALARA-Planner Pro VR — Конфигурационный реестр 11 сценариев (ScenarioConfigRegistry)
 *
 * Содержит строго типизированные параметры радиационной безопасности, нормативные лимиты дозы H_limit,
 * максимальное время выполнения задачи T_max, доминирующие радионуклиды, требования к СИЗ / дистанционному
 * инструменту / экранированию и контекстные правила проигрыша для всех 11 объектов обследования.
 */

import * as THREE from 'three';
import { PPELoadoutId, RemoteToolId, ShieldMaterialType } from '../physics/gostPhysics';
import { InstrumentId } from '../instruments/gostInstruments';

export type ScenarioFailCode =
  | 'DOSE_LIMIT_EXCEEDED'
  | 'TIMEOUT_EXCEEDED'
  | 'PPE_VIOLATION'
  | 'SHIELD_OR_TOOL_VIOLATION'
  | 'PROTOCOL_CERTIFICATION_ERROR';

export interface ScenarioSafetyRequirement {
  /** Минимально допустимые комплекты СИЗ при входе в рабочую/опасную зону */
  allowedPpeIds: ReadonlyArray<PPELoadoutId>;
  /** Дистанция до источника (м), ближе которой вход без разрешенных СИЗ вызывает провал */
  ppeEnforcementRadiusM: number;
  /** Требуется ли дистанционный захват/штанга при удержании активного источника в руке */
  requireRemoteToolOnSourceGrab: boolean;
  /** Разрешенные дистанционные инструменты при захвате источника */
  allowedRemoteToolsOnGrab: ReadonlyArray<RemoteToolId>;
  /** Требуется ли установленный защитный экран или спец. СИЗ при сближении с источником вплотную */
  requireShieldOrLeadPpeNearSource: boolean;
  /** Критический радиус сближения с неэкранированным источником (м) */
  criticalProximityRadiusM: number;
  /** Требуемый материал экрана (например, борированный полиэтилен для нейтронов в сценарии 6) */
  requiredShieldMaterial?: ShieldMaterialType;
  /** Рекомендуемый тип прибора по ГОСТ 27451-87 для достоверного контроля */
  recommendedInstrumentId?: InstrumentId;
}

export interface IScenarioConfig {
  readonly scenarioId: number;
  readonly codeName: string;
  readonly titleRu: string;
  readonly facilityRu: string;
  /** Предел накопленной эквивалентной дозы H_limit по наряду-допуску (мЗв) */
  readonly hLimitMsv: number;
  /** Максимальное допустимое время пребывания в зоне / выполнения задачи T_max (с) */
  readonly tMaxSec: number;
  /** Порог предупреждения (по умолчанию 0.80 = 80% от H_limit или T_max) */
  readonly warningThresholdRatio: number;
  /** Доминирующие изотопы и типы излучения сценария */
  readonly isotopes: ReadonlyArray<string>;
  /** Естественный или контрольный фоновый порог локации (мкЗв/ч) */
  readonly backgroundThresholdMicroSvPerHour: number;
  /** Точка начального спавна оператора (playerGroup) */
  readonly initialSpawnPos: THREE.Vector3;
  /** Начальный рекомендуемый комплект СИЗ при старте сценария */
  readonly defaultPpeId: PPELoadoutId;
  /** Начальный рекомендуемый дистанционный инструмент */
  readonly defaultRemoteToolId: RemoteToolId;
  /** Правила техники безопасности и триггеры нарушений */
  readonly safetyRules: ScenarioSafetyRequirement;
  /** Точные контекстные описания причин провала (Game Over) для данного сценария */
  readonly failMessagesRu: {
    readonly doseLimitExceeded: string;
    readonly timeoutExceeded: string;
    readonly ppeViolation: string;
    readonly shieldOrToolViolation: string;
    readonly protocolError: string;
    readonly normativeReference: string;
  };
}

/**
 * Полный реестр конфигураций для всех 11 сценариев симулятора ALARA-Planner Pro
 */
export const SCENARIO_CONFIG_REGISTRY: Readonly<Record<number, IScenarioConfig>> = {
  // ============================================================================
  // 1. АЭС и ЯТЦ
  // ============================================================================
  1: {
    scenarioId: 1,
    codeName: 'NPP_VVER_1200',
    titleRu: '1. АЭС и ЯТЦ: Помещение ГЦК ВВЭР-1200',
    facilityRu: 'Гермообъем реакторного отделения АЭС (Зона строгого режима)',
    hLimitMsv: 0.20,
    tMaxSec: 300,
    warningThresholdRatio: 0.80,
    isotopes: ['Co-60', 'Cs-137', 'Cf-252'],
    backgroundThresholdMicroSvPerHour: 2.5,
    initialSpawnPos: new THREE.Vector3(0, 1.65, 4.2),
    defaultPpeId: 'basic_ppe',
    defaultRemoteToolId: 'hand',
    safetyRules: {
      allowedPpeIds: ['basic_ppe', 'hazmat_suit', 'pneumosuit_lead'],
      ppeEnforcementRadiusM: 4.8,
      requireRemoteToolOnSourceGrab: false,
      allowedRemoteToolsOnGrab: ['extended_arm', 'manipulator_15m', 'telescopic_rod_3m'],
      requireShieldOrLeadPpeNearSource: true,
      criticalProximityRadiusM: 1.45,
      recommendedInstrumentId: 'dp5'
    },
    failMessagesRu: {
      doseLimitExceeded:
        'Превышен предел индивидуальной дозы по наряду-допуску в гермообъеме АЭС (H_accum > 0.20 мЗв от излучения Co-60 / Cs-137).',
      timeoutExceeded:
        'Истекло максимально допустимое время пребывания в помещении ГЦК ВВЭР-1200 (T_max = 300 с) по регламенту наряда-допуска.',
      ppeViolation:
        'Вход в гермозону строгого режима АЭС без защитных бахил, спецодежды и респиратора «Лепесток-200» (грубое нарушение ОСПОРБ-99/2010).',
      shieldOrToolViolation:
        'Сближение с неэкранированным патрубком главного циркуляционного контура (Co-60) без предварительной установки передвижной свинцовой ширмы.',
      protocolError:
        'Нарушение технологического регламента локализации протечки теплоносителя первого контура АЭС.',
      normativeReference: 'НРБ-99/2009 (СанПиН 2.6.1.2523-09), п. 3.1.2 • СП АЭС-2003'
    }
  },

  // ============================================================================
  // 2. Медицина (КТ / Радиология)
  // ============================================================================
  2: {
    scenarioId: 2,
    codeName: 'MEDICAL_RADIOLOGY_CT',
    titleRu: '2. Медицина: Кабинет дистанционной лучевой терапии и ПЭТ/КТ',
    facilityRu: 'Радиологический блок онкоцентра (Аппарат гамма-терапии Co-60 / Рентген)',
    hLimitMsv: 0.05,
    tMaxSec: 210,
    warningThresholdRatio: 0.80,
    isotopes: ['Co-60', 'F-18', 'Tc-99m'],
    backgroundThresholdMicroSvPerHour: 0.5,
    initialSpawnPos: new THREE.Vector3(0, 1.65, 4.2),
    defaultPpeId: 'pneumosuit_lead',
    defaultRemoteToolId: 'extended_arm',
    safetyRules: {
      allowedPpeIds: ['pneumosuit_lead', 'hazmat_suit'],
      ppeEnforcementRadiusM: 4.2,
      requireRemoteToolOnSourceGrab: true,
      allowedRemoteToolsOnGrab: ['extended_arm', 'manipulator_15m', 'telescopic_rod_3m'],
      requireShieldOrLeadPpeNearSource: true,
      criticalProximityRadiusM: 1.65,
      recommendedInstrumentId: 'ion'
    },
    failMessagesRu: {
      doseLimitExceeded:
        'Превышен оперативный предел дозы медицинского физика (H_limit = 0.05 мЗв) в процедурной лучевой терапии.',
      timeoutExceeded:
        'Превышено контрольное время аварийного закрытия затвора гамма-терапевтического аппарата (T_max = 210 с).',
      ppeViolation:
        'Нахождение в процедурной комнате во время работы пучка Co-60 / рентгеновского излучателя без просвинцованного фартука (0.5 мм Pb).',
      shieldOrToolViolation:
        'Прямое попадание под неэкранированный рабочий пучок облучателя без использования рентгенозащитной ширмы.',
      protocolError:
        'Нарушение радиационной безопасности при обращении с радиофармпрепаратом в ПЭТ/КТ блоке.',
      normativeReference: 'СанПиН 2.6.1.1192-03 (Рентгеновские кабинеты) • НРБ-99/2009'
    }
  },

  // ============================================================================
  // 3. Прием металлолома
  // ============================================================================
  3: {
    scenarioId: 3,
    codeName: 'SCRAP_METAL_YARD',
    titleRu: '3. Прием металлолома: Бесхозный дефектоскоп Ir-192 / Cs-137',
    facilityRu: 'Площадка входного радиационного контроля металлолома',
    hLimitMsv: 0.02,
    tMaxSec: 200,
    warningThresholdRatio: 0.80,
    isotopes: ['Cs-137', 'Ir-192'],
    backgroundThresholdMicroSvPerHour: 0.25,
    initialSpawnPos: new THREE.Vector3(0, 1.65, 4.5),
    defaultPpeId: 'basic_ppe',
    defaultRemoteToolId: 'manipulator_15m',
    safetyRules: {
      allowedPpeIds: ['basic_ppe', 'hazmat_suit', 'pneumosuit_lead'],
      ppeEnforcementRadiusM: 4.0,
      requireRemoteToolOnSourceGrab: true,
      allowedRemoteToolsOnGrab: ['manipulator_15m', 'telescopic_rod_3m'],
      requireShieldOrLeadPpeNearSource: false,
      criticalProximityRadiusM: 1.1,
      recommendedInstrumentId: 'nai'
    },
    failMessagesRu: {
      doseLimitExceeded:
        'Превышен контрольный предел дозы дозиметриста на площадке металлолома (H_limit = 0.02 мЗв от источника Ir-192 / Cs-137).',
      timeoutExceeded:
        'Превышено время локализации бесхозного источника в партии металлолома (пропуск несканированного контейнера, T_max = 200 с).',
      ppeViolation:
        'Работа в зоне локализации вскрытого гамма-дефектоскопа без базового комплекта спецодежды и перчаток.',
      shieldOrToolViolation:
        'Захват высокоактивного «горячего» источника Ir-192 / Cs-137 руками без дистанционного захвата-манипулятора ЦМ-1.5 (риск лучевого ожога кисти)!',
      protocolError:
        'Пропуск несканированного контейнера с радиоактивным ломом через входной ворота-монитор.',
      normativeReference: 'СП 2.6.1.2612-10 (ОСПОРБ-99/2010) • МУК 2.6.1.1087-02 (Контроль металлолома)'
    }
  },

  // ============================================================================
  // 4. Таможенный пост
  // ============================================================================
  4: {
    scenarioId: 4,
    codeName: 'CUSTOMS_YANTAR_PORTAL',
    titleRu: '4. Таможенный пост: Стойка «Янтарь» и досмотр багажа',
    facilityRu: 'Пограничный терминал ТКДРМ (Порог фона +0.2 мкЗв/ч)',
    hLimitMsv: 0.01,
    tMaxSec: 180,
    warningThresholdRatio: 0.80,
    isotopes: ['Am-241', 'Cs-137'],
    backgroundThresholdMicroSvPerHour: 0.20,
    initialSpawnPos: new THREE.Vector3(0, 1.65, 4.2),
    defaultPpeId: 'basic_ppe',
    defaultRemoteToolId: 'extended_arm',
    safetyRules: {
      allowedPpeIds: ['basic_ppe', 'hazmat_suit', 'pneumosuit_lead'],
      ppeEnforcementRadiusM: 3.8,
      requireRemoteToolOnSourceGrab: true,
      allowedRemoteToolsOnGrab: ['extended_arm', 'manipulator_15m', 'telescopic_rod_3m'],
      requireShieldOrLeadPpeNearSource: false,
      criticalProximityRadiusM: 1.0,
      recommendedInstrumentId: 'nai'
    },
    failMessagesRu: {
      doseLimitExceeded:
        'Превышен строгий предел дозы инспектора таможенного контроля (H_limit = 0.01 мЗв = 10 мкЗв) при досмотре задержанного груза.',
      timeoutExceeded:
        'Невыявление превышения радиационного фона багажа (+0.2 мкЗв/ч) на портале «Янтарь» за отведенное регламентом время (T_max = 180 с).',
      ppeViolation:
        'Досмотр подозрительного багажа с источником Am-241 / Cs-137 без защитных перчаток и СИЗ.',
      shieldOrToolViolation:
        'Контактное извлечение немаркированного радиоактивного контейнера из багажа вплотную без дистанционного удлинителя.',
      protocolError:
        'Невыявление превышения фонового порога (+0.2 мкЗв/ч) при прохождении багажной ленты.',
      normativeReference: 'Инструкция ТКДРМ ФТС России • ГОСТ Р 51635-2000 (Мониторы «Янтарь»)'
    }
  },

  // ============================================================================
  // 5. Урановые карьеры / Рудники
  // ============================================================================
  5: {
    scenarioId: 5,
    codeName: 'URANIUM_QUARRY_MINING',
    titleRu: '5. Урановые карьеры и рудники: Породы с ЕРН (Ra-226, Th-232)',
    facilityRu: 'Горнодобывающий разрез (Естественный фон 5–15 мкЗв/ч, α/γ-пыль)',
    hLimitMsv: 0.15,
    tMaxSec: 260,
    warningThresholdRatio: 0.80,
    isotopes: ['Ra-226', 'Th-232', 'K-40'],
    backgroundThresholdMicroSvPerHour: 12.0,
    initialSpawnPos: new THREE.Vector3(0, 1.65, 4.5),
    defaultPpeId: 'basic_ppe',
    defaultRemoteToolId: 'extended_arm',
    safetyRules: {
      allowedPpeIds: ['basic_ppe', 'hazmat_suit', 'pneumosuit_lead'],
      ppeEnforcementRadiusM: 6.5, // Во всей рабочей зоне карьера обязателен респиратор от альфа-пыли!
      requireRemoteToolOnSourceGrab: false,
      allowedRemoteToolsOnGrab: ['hand', 'extended_arm', 'manipulator_15m', 'telescopic_rod_3m'],
      requireShieldOrLeadPpeNearSource: false,
      criticalProximityRadiusM: 1.1,
      recommendedInstrumentId: 'dp5'
    },
    failMessagesRu: {
      doseLimitExceeded:
        'Превышен предел дозы при геологоразведке рудного тела (H_limit = 0.15 мЗв от гамма- и альфа-излучения Ra-226 / Th-232).',
      timeoutExceeded:
        'Превышено предельное время смены в запыленном забое уранового карьера (T_max = 260 с).',
      ppeViolation:
        'Работа в урановом карьере без респиратора «Лепесток-200» / СИЗОД! Вдыхание радиоактивной альфа-пыли (Ra-226, Th-232, w_R = 20) вызывает критическое внутреннее облучение легких.',
      shieldOrToolViolation:
        'Длительный контакт вплотную с высокоактивным штуфом урановой смолки без дистанционного инструмента.',
      protocolError:
        'Нарушение регламента сортировки рудной массы по удельной активности ЕРН.',
      normativeReference: 'СП 2.6.1.798-99 (Обращение с минеральным сырьем с повышенным содержанием ЕРН)'
    }
  },

  // ============================================================================
  // 6. Хранилища ЯО / Аварийные зоны
  // ============================================================================
  6: {
    scenarioId: 6,
    codeName: 'NUCLEAR_STORAGE_EMERGENCY',
    titleRu: '6. Хранилища ЯО и аварийные зоны: Нейтронный и гамма-фон (Cf-252)',
    facilityRu: 'Зал контейнеров ТУК и сборки Cf-252 (Быстрые нейтроны w_R = 10 + γ)',
    hLimitMsv: 5.00,
    tMaxSec: 300,
    warningThresholdRatio: 0.80,
    isotopes: ['Cf-252', 'Co-60'],
    backgroundThresholdMicroSvPerHour: 25.0,
    initialSpawnPos: new THREE.Vector3(0, 1.65, 4.5),
    defaultPpeId: 'pneumosuit_lead',
    defaultRemoteToolId: 'manipulator_15m',
    safetyRules: {
      allowedPpeIds: ['hazmat_suit', 'pneumosuit_lead'],
      ppeEnforcementRadiusM: 4.8,
      requireRemoteToolOnSourceGrab: true,
      allowedRemoteToolsOnGrab: ['manipulator_15m', 'telescopic_rod_3m'],
      requireShieldOrLeadPpeNearSource: true,
      criticalProximityRadiusM: 2.1,
      requiredShieldMaterial: 'paraffin_borated',
      recommendedInstrumentId: 'neutron'
    },
    failMessagesRu: {
      doseLimitExceeded:
        'Превышен аварийный предел эквивалентной дозы (H_limit = 5.0 мЗв) в смешанном гамма-нейтронном поле Cf-252.',
      timeoutExceeded:
        'Превышено максимальное время ликвидации нештатной ситуации в хранилище ТУК (T_max = 300 с).',
      ppeViolation:
        'Вход в аварийную зону хранилища ЯО без изолирующего пневмокостюма ЛГ-4 / комплекта тяжелой защиты.',
      shieldOrToolViolation:
        'Приближение к нейтронному источнику Cf-252 без установленного переносного экрана из борированного полиэтилена (CH₂ + B₄C) и дистанционного манипулятора!',
      protocolError:
        'Использование неподходящего экрана (чистый свинец не замедляет быстрые нейтроны Cf-252 без водородсодержащего замедлителя).',
      normativeReference: 'НРБ-99/2009 (Раздел 6: Планируемое повышенное облучение) • НП-061-05'
    }
  },

  // ============================================================================
  // 7. Застройка / Радон-222
  // ============================================================================
  7: {
    scenarioId: 7,
    codeName: 'RADON_222_CONSTRUCTION',
    titleRu: '7. Участки под застройку: Измерение ППС радона-222 из почвы',
    facilityRu: 'Котлован и техподполье строящегося здания (Эманация ²²²Rn)',
    hLimitMsv: 0.05,
    tMaxSec: 240,
    warningThresholdRatio: 0.80,
    isotopes: ['Rn-222', 'Ra-226'],
    backgroundThresholdMicroSvPerHour: 0.35,
    initialSpawnPos: new THREE.Vector3(0, 1.65, 4.2),
    defaultPpeId: 'basic_ppe',
    defaultRemoteToolId: 'extended_arm',
    safetyRules: {
      allowedPpeIds: ['basic_ppe', 'hazmat_suit', 'pneumosuit_lead'],
      ppeEnforcementRadiusM: 4.5,
      requireRemoteToolOnSourceGrab: false,
      allowedRemoteToolsOnGrab: ['hand', 'extended_arm', 'manipulator_15m', 'telescopic_rod_3m'],
      requireShieldOrLeadPpeNearSource: false,
      criticalProximityRadiusM: 1.2,
      recommendedInstrumentId: 'dp5'
    },
    failMessagesRu: {
      doseLimitExceeded:
        'Превышен предел дозы от короткоживущих дочерних продуктов распада радона-222 (Po-218, Pb-214, Bi-214) в непроветриваемом приямке (H_limit = 0.05 мЗв).',
      timeoutExceeded:
        'Превышено время экспозиции при установке накопительных камер ППС радона в техподполье (T_max = 240 с).',
      ppeViolation:
        'Спуск в непроветриваемый приямок с высокой объемной активностью радона-222 без противоаэрозольного респиратора (опасность облучения эпителия бронхов ДПР радона)!',
      shieldOrToolViolation:
        'Игнорирование замеров плотности потока радона (ППС) в приямках и разломах грунта без радиометра.',
      protocolError:
        'Пропуск радоноопасной аномалии (> 80 мБк/(м²·с)) при выдаче заключения по инженерно-экологическим изысканиям.',
      normativeReference: 'МУ 2.6.1.2398-08 (Радиационный контроль участков под строительство)'
    }
  },

  // ============================================================================
  // 8. Метрополитен / Гранит
  // ============================================================================
  8: {
    scenarioId: 8,
    codeName: 'METRO_GRANITE_INTROSCOPES',
    titleRu: '8. Метрополитен и вокзалы: Гранитная облицовка и интроскопы',
    facilityRu: 'Вестибюль станции метро (Фон гранита 0.3–0.6 мкЗв/ч vs утечка X-Ray)',
    hLimitMsv: 0.02,
    tMaxSec: 210,
    warningThresholdRatio: 0.80,
    isotopes: ['Th-232', 'K-40', 'Co-60'],
    backgroundThresholdMicroSvPerHour: 0.45,
    initialSpawnPos: new THREE.Vector3(0, 1.65, 4.2),
    defaultPpeId: 'basic_ppe',
    defaultRemoteToolId: 'extended_arm',
    safetyRules: {
      allowedPpeIds: ['basic_ppe', 'hazmat_suit', 'pneumosuit_lead'],
      ppeEnforcementRadiusM: 3.5,
      requireRemoteToolOnSourceGrab: false,
      allowedRemoteToolsOnGrab: ['hand', 'extended_arm', 'manipulator_15m', 'telescopic_rod_3m'],
      requireShieldOrLeadPpeNearSource: true,
      criticalProximityRadiusM: 1.3,
      recommendedInstrumentId: 'ion'
    },
    failMessagesRu: {
      doseLimitExceeded:
        'Превышен предел дозы (H_limit = 0.02 мЗв) вследствие облучения через поврежденные просвинцованные шторки досмотрового рентгеновского интроскопа.',
      timeoutExceeded:
        'Превышено время поиска источника утечки тормозного излучения в зоне досмотра пассажиров (T_max = 210 с).',
      ppeViolation:
        'Проверка внутренней камеры работающего рентгеновского интроскопа без средств индивидуальной защиты.',
      shieldOrToolViolation:
        'Ложное аварийное срабатывание на естественный гамма-фон гранитной облицовки колонны (0.3–0.6 мкЗв/ч) или приближение вплотную к открытой апертуре интроскопа без защитного экрана!',
      protocolError:
        'Ошибочная классификация природного фона гранита (Th-232 / K-40) как техногенной аварии вместо локализации неисправного интроскопа.',
      normativeReference: 'СанПиН 2.6.1.3488-17 (Лучевые досмотровые установки) • НРБ-99/2009'
    }
  },

  // ============================================================================
  // 9. Строительные материалы
  // ============================================================================
  9: {
    scenarioId: 9,
    codeName: 'BUILDING_MATERIALS_NORM',
    titleRu: '9. Стройматериалы: Щебень и плитка с урановой глазурью (Ra-226 > 370 Бк/кг)',
    facilityRu: 'Склад-лаборатория входного контроля стройматериалов (ГОСТ 30108-94)',
    hLimitMsv: 0.03,
    tMaxSec: 220,
    warningThresholdRatio: 0.80,
    isotopes: ['Ra-226', 'Th-232', 'U-238'],
    backgroundThresholdMicroSvPerHour: 0.30,
    initialSpawnPos: new THREE.Vector3(0, 1.65, 4.2),
    defaultPpeId: 'basic_ppe',
    defaultRemoteToolId: 'extended_arm',
    safetyRules: {
      allowedPpeIds: ['basic_ppe', 'hazmat_suit', 'pneumosuit_lead'],
      ppeEnforcementRadiusM: 4.0,
      requireRemoteToolOnSourceGrab: true,
      allowedRemoteToolsOnGrab: ['extended_arm', 'manipulator_15m', 'telescopic_rod_3m'],
      requireShieldOrLeadPpeNearSource: false,
      criticalProximityRadiusM: 1.1,
      recommendedInstrumentId: 'nai'
    },
    failMessagesRu: {
      doseLimitExceeded:
        'Превышен предел дозы лаборанта (H_limit = 0.03 мЗв) при контактной работе с партией высокоактивного гранитного щебня и урановой керамики.',
      timeoutExceeded:
        'Истекло время паспортизации партии строительных материалов по ГОСТ 30108-94 (T_max = 220 с).',
      ppeViolation:
        'Отбор пылящих проб гранитного отсева и керамики с урановой глазурью (Ra-226 > 370 Бк/кг) без респиратора и перчаток.',
      shieldOrToolViolation:
        'Выдача ошибочного сертификата безопасности I класса (A_эфф <= 370 Бк/кг) или перенос фонящего образца голыми руками без захвата.',
      protocolError:
        'Выдача ошибочного санитарно-эпидемиологического сертификата безопасности на материал с A_эфф > 370 Бк/кг (запрещен для жилого строительства).',
      normativeReference: 'ГОСТ 30108-94 (Материалы и изделия строительные. Определение A_эфф ЕРН)'
    }
  },

  // ============================================================================
  // 10. Продукты питания (Грибы/Рыба)
  // ============================================================================
  10: {
    scenarioId: 10,
    codeName: 'FOOD_SPECTROMETRY_CS137',
    titleRu: '10. Продукты питания: Определение Cs-137 в грибах и рыбе',
    facilityRu: 'Лаборатория ветеринарно-санитарной экспертизы (Спектрометрия Cs-137 / K-40)',
    hLimitMsv: 0.02,
    tMaxSec: 210,
    warningThresholdRatio: 0.80,
    isotopes: ['Cs-137', 'K-40'],
    backgroundThresholdMicroSvPerHour: 0.15,
    initialSpawnPos: new THREE.Vector3(0, 1.65, 4.2),
    defaultPpeId: 'basic_ppe',
    defaultRemoteToolId: 'extended_arm',
    safetyRules: {
      allowedPpeIds: ['basic_ppe', 'hazmat_suit', 'pneumosuit_lead'],
      ppeEnforcementRadiusM: 4.0,
      requireRemoteToolOnSourceGrab: true,
      allowedRemoteToolsOnGrab: ['extended_arm', 'manipulator_15m', 'telescopic_rod_3m'],
      requireShieldOrLeadPpeNearSource: false,
      criticalProximityRadiusM: 1.0,
      recommendedInstrumentId: 'nai'
    },
    failMessagesRu: {
      doseLimitExceeded:
        'Превышен предел дозы оператора спектрометрической лаборатории (H_limit = 0.02 мЗв) при работе с концентрированными пробами Cs-137.',
      timeoutExceeded:
        'Превышено время радиометрической экспертизы партии дикоросов и рыбы в сосуде Маринелли (T_max = 210 с).',
      ppeViolation:
        'Фасовка радиоактивных проб лесных грибов (Cs-137 > 500 Бк/кг) в сосуд Маринелли без защитных перчаток и халата (риск загрязнения кожи).',
      shieldOrToolViolation:
        'Неверный расчет чистой удельной активности Cs-137 (не учтен вклад природного бета-излучателя K-40 или проба не помещена в свинцовую защиту спектрометра).',
      protocolError:
        'Ошибка вычитания бета-фона калия-40 при определении удельной активности техногенного цезия-137 в пищевой пробе.',
      normativeReference: 'СанПиН 2.3.2.1078-01 • МУК 2.6.1.1194-03 (Спектрометрия пищевых продуктов)'
    }
  },

  // ============================================================================
  // 11. Антиквариат с СПД (Ra-226)
  // ============================================================================
  11: {
    scenarioId: 11,
    codeName: 'ANTIQUE_RADIUM_226_LUMINOUS',
    titleRu: '11. Антиквариат с СПД (Ra-226): Авиаприборы и часы с радиевой краской',
    facilityRu: 'Специализированная лаборатория экспертизы приборов с СПД (²²⁶Ra α/γ)',
    hLimitMsv: 0.05,
    tMaxSec: 240,
    warningThresholdRatio: 0.80,
    isotopes: ['Ra-226', 'Rn-222'],
    backgroundThresholdMicroSvPerHour: 0.25,
    initialSpawnPos: new THREE.Vector3(0, 1.65, 4.2),
    defaultPpeId: 'hazmat_suit',
    defaultRemoteToolId: 'manipulator_15m',
    safetyRules: {
      allowedPpeIds: ['hazmat_suit', 'pneumosuit_lead'],
      ppeEnforcementRadiusM: 4.2,
      requireRemoteToolOnSourceGrab: true,
      allowedRemoteToolsOnGrab: ['extended_arm', 'manipulator_15m', 'telescopic_rod_3m'],
      requireShieldOrLeadPpeNearSource: true,
      criticalProximityRadiusM: 1.35,
      recommendedInstrumentId: 'dp5'
    },
    failMessagesRu: {
      doseLimitExceeded:
        'Превышен предел дозы (H_limit = 0.05 мЗв) от жесткого гамма- и альфа-излучения радия-226 (СПД) при экспертизе авиационных приборов.',
      timeoutExceeded:
        'Превышено время герметизации фонящих антикварных часов с осыпающейся СПД (Ra-226) в защитный пенал (T_max = 240 с).',
      ppeViolation:
        'Попытка работы с прибором со светомассой постоянного действия (СПД Ra-226) без защитных перчаток и костюма КЗМ! Высочайшая опасность необратимого альфа-загрязнения кожи и ингаляции радона-222.',
      shieldOrToolViolation:
        'Попытка вскрытия / захвата тумблера или часов с осыпающейся СПД (Ra-226) голыми руками вне вытяжного перчаточного бокса и без манипулятора!',
      protocolError:
        'Нарушение регламента утилизации приборов со светосоставом постоянного действия (СПД Ra-226).',
      normativeReference: 'ОСПОРБ-99/2010 (п. 3.11: Приборы со светосоставом постоянного действия)'
    }
  },

  // ============================================================================
  // 12. Завод регенерации ОЯТ: Разлив плутония и угроза СЦР (Pu-239 / Cf-252)
  // ============================================================================
  12: {
    scenarioId: 12,
    codeName: 'REPROCESSING_PLANT_PLUTONIUM_SCR',
    titleRu: '12. Завод регенерации ОЯТ: Разлив плутония и угроза СЦР (²³⁹Pu / ²⁵²Cf)',
    facilityRu: 'Радиохимический цех регенерации топлива (Аварийный бокс экстракции)',
    hLimitMsv: 0.25,
    tMaxSec: 165,
    warningThresholdRatio: 0.80,
    isotopes: ['Pu-239', 'Cf-252', 'Cs-137'],
    backgroundThresholdMicroSvPerHour: 0.30,
    initialSpawnPos: new THREE.Vector3(0, 1.65, 4.4),
    defaultPpeId: 'pneumosuit_lead',
    defaultRemoteToolId: 'manipulator_15m',
    safetyRules: {
      allowedPpeIds: ['pneumosuit_lead', 'hazmat_suit'],
      ppeEnforcementRadiusM: 4.5,
      requireRemoteToolOnSourceGrab: true,
      allowedRemoteToolsOnGrab: ['manipulator_15m', 'telescopic_rod_3m'],
      requireShieldOrLeadPpeNearSource: true,
      criticalProximityRadiusM: 1.8,
      recommendedInstrumentId: 'neutron'
    },
    failMessagesRu: {
      doseLimitExceeded:
        'Превышен аварийный предел эквивалентной дозы (H_limit = 0.25 мЗв) в смешанном гамма-нейтронном поле Pu-239 / Cf-252!',
      timeoutExceeded:
        'Превышено допустимое время локализации разлива плутониевого раствора и предотвращения СЦР (T_max = 165 с).',
      ppeViolation:
        'Вход в зону аэрозолей плутония-239 (²³⁹Pu) и азотной кислоты без изолирующего пневмокостюма ЛГ-4 / КИХ-5! Критический риск внутреннего альфа-облучения легких.',
      shieldOrToolViolation:
        'Работа у аварийного аппарата-экстрактора без нейтронопоглощающего экрана из борированного полиэтилена или попытка захвата пробы Pu-239 без манипулятора!',
      protocolError:
        'Нарушение ядерной безопасности (НП-016-05): не введен нейтронопоглощающий барьер перед локализацией раствора делящихся материалов.',
      normativeReference: 'НРБ-99/2009 • НП-016-05 (Правила ядерной безопасности для объектов ЯТЦ)'
    }
  }
};

/**
 * Вспомогательная функция получения строго типизированного IScenarioConfig по ID сценария (1..12)
 */
export function getScenarioConfigById(scenarioId: number): IScenarioConfig {
  return SCENARIO_CONFIG_REGISTRY[scenarioId] ?? SCENARIO_CONFIG_REGISTRY[1];
}

/**
 * Класс-реестр ScenarioConfigRegistry для доступа к конфигурациям всех 12 сценариев
 */
export class ScenarioConfigRegistry {
  public static readonly configs: Readonly<Record<number, IScenarioConfig>> = SCENARIO_CONFIG_REGISTRY;

  public static getConfig(scenarioId: number): IScenarioConfig {
    return getScenarioConfigById(scenarioId);
  }

  public static getAllConfigs(): IScenarioConfig[] {
    return Object.values(SCENARIO_CONFIG_REGISTRY);
  }
}

