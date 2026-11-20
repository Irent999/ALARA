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
  // 1. МЧС АЭС: Радиационная авария / Выброс ГЦК ВВЭР-1200
  // ============================================================================
  1: {
    scenarioId: 1,
    codeName: 'MCHS_NPP_RAD_RELEASE',
    titleRu: '1. МЧС АЭС: Радиационная авария / Выброс (ВВЭР-1200)',
    facilityRu: 'Гермообъем реакторного отделения АЭС (Зона строгого режима)',
    hLimitMsv: 0.25,
    tMaxSec: 300,
    warningThresholdRatio: 0.80,
    isotopes: ['Co-60', 'Cs-137', 'Cf-252'],
    backgroundThresholdMicroSvPerHour: 2.5,
    initialSpawnPos: new THREE.Vector3(-1.5, 1.65, 5.0),
    defaultPpeId: 'hazmat_suit',
    defaultRemoteToolId: 'hand',
    safetyRules: {
      allowedPpeIds: ['basic_ppe', 'bop_firefighter', 'hazmat_suit', 'pneumosuit_lead'],
      ppeEnforcementRadiusM: 4.8,
      requireRemoteToolOnSourceGrab: false,
      allowedRemoteToolsOnGrab: ['extended_arm', 'manipulator_15m', 'telescopic_rod_3m'],
      requireShieldOrLeadPpeNearSource: true,
      criticalProximityRadiusM: 1.45,
      recommendedInstrumentId: 'dp5'
    },
    failMessagesRu: {
      doseLimitExceeded:
        'Превышен предел индивидуальной дозы по наряду-допуску при разгерметизации ВВЭР-1200 (H_accum > 0.25 мЗв).',
      timeoutExceeded:
        'Истекло контрольное время эвакуации и локализации выброса на ВВЭР-1200 (T_max = 300 с).',
      ppeViolation:
        'Вход в зону радиоактивного выброса АЭС без комплекта химзащиты (Л-1 / КИХ-4) и СИЗОД (ГП-7ВМ / АСВ-2)!',
      shieldOrToolViolation:
        'Сближение с поврежденным патрубком ГЦК без установки передвижной свинцовой ширмы или перекрытия клапана.',
      protocolError:
        'Отклонение от безопасного маршрута эвакуации — нарушение принципа ALARA.',
      normativeReference: 'НРБ-99/2009 (СанПиН 2.6.1.2523-09) • Устав МЧС РХБЗ на АЭС'
    }
  },

  // ============================================================================
  // 2. МЧС АЭС: Пожар на энергоблоке (Кабельные трассы 6 кВ)
  // ============================================================================
  2: {
    scenarioId: 2,
    codeName: 'MCHS_NPP_CABLE_FIRE_6KV',
    titleRu: '2. МЧС АЭС: Пожар в кабельном отсеке под напряжением (6 кВ)',
    facilityRu: 'Кабельная полуэтажка и турбинный цех энергоблока АЭС',
    hLimitMsv: 0.18,
    tMaxSec: 240,
    warningThresholdRatio: 0.80,
    isotopes: ['Cs-137', 'Co-60'],
    backgroundThresholdMicroSvPerHour: 1.5,
    initialSpawnPos: new THREE.Vector3(0, 1.65, 4.6),
    defaultPpeId: 'bop_firefighter',
    defaultRemoteToolId: 'extended_arm',
    safetyRules: {
      allowedPpeIds: ['bop_firefighter', 'hazmat_suit', 'pneumosuit_lead'],
      ppeEnforcementRadiusM: 5.5,
      requireRemoteToolOnSourceGrab: false,
      allowedRemoteToolsOnGrab: ['hand', 'extended_arm', 'manipulator_15m', 'telescopic_rod_3m'],
      requireShieldOrLeadPpeNearSource: false,
      criticalProximityRadiusM: 1.1,
      recommendedInstrumentId: 'dp5'
    },
    failMessagesRu: {
      doseLimitExceeded:
        'Превышен предел дозы пожарного расчёта МЧС (H_limit = 0.18 мЗв) при тушении кабельной эстакады АЭС.',
      timeoutExceeded:
        'Превышено нормативное время локализации пожара в кабельном отсеке 6 кВ (T_max = 240 с) — угроза распространения огня на БПУ!',
      ppeViolation:
        'Вход в горящий кабельный отсек АЭС без термостойкой БОП-1 МЧС (350°C, диэлектрик) и полнолицевой маски ППМ-88 / АСВ-2!',
      shieldOrToolViolation:
        'Подача токопроводящей воды из ствола ПК-50 на кабельные лотки 6 кВ до отключения силового рубильника — поражение электротоком!',
      protocolError:
        'Нарушение правил пожаротушения электроустановок на АЭС: запрещено тушить водой кабели под напряжением 6 кВ!',
      normativeReference: 'ВППБ 01-02-95* (Правила пожарной безопасности АЭС) • Боевой устав ПО МЧС'
    }
  },

  // ============================================================================
  // 3. МЧС АЭС: Отказ систем питания SBO (Station Blackout — Обесточивание БПУ)
  // ============================================================================
  3: {
    scenarioId: 3,
    codeName: 'MCHS_NPP_STATION_BLACKOUT_SBO',
    titleRu: '3. МЧС АЭС: Отказ систем питания SBO (Обесточивание БПУ)',
    facilityRu: 'Блочный пункт управления (БПУ) и площадка МДНУ-150 АЭС',
    hLimitMsv: 0.22,
    tMaxSec: 180,
    warningThresholdRatio: 0.80,
    isotopes: ['Co-60', 'Cf-252'],
    backgroundThresholdMicroSvPerHour: 3.0,
    initialSpawnPos: new THREE.Vector3(0, 1.65, 4.4),
    defaultPpeId: 'hazmat_suit',
    defaultRemoteToolId: 'hand',
    safetyRules: {
      allowedPpeIds: ['basic_ppe', 'bop_firefighter', 'hazmat_suit', 'pneumosuit_lead'],
      ppeEnforcementRadiusM: 5.5,
      requireRemoteToolOnSourceGrab: false,
      allowedRemoteToolsOnGrab: ['hand', 'extended_arm', 'manipulator_15m', 'telescopic_rod_3m'],
      requireShieldOrLeadPpeNearSource: false,
      criticalProximityRadiusM: 1.0,
      recommendedInstrumentId: 'dp5'
    },
    failMessagesRu: {
      doseLimitExceeded:
        'Превышен предел дозы оперативно-спасательной группы (H_limit = 0.22 мЗв) при ликвидации SBO на БПУ.',
      timeoutExceeded:
        'КРИТИЧЕСКИЙ ТАЙМАУТ SBO (T_max = 180 с): Не запущена МДНУ-150 и не восстановлено расхолаживание активной зоны!',
      ppeViolation:
        'Работа на аварийном участке БПУ в условиях повышенного гамма-нейтронного фона без СИЗ и СИЗОД.',
      shieldOrToolViolation:
        'Попытка открытия задвижки подпитки без подключения резервного кабеля 0.4 кВ и пуска МДНУ-150.',
      protocolError:
        'Нарушена последовательность восстановления питания при SBO: сначала кабель 0.4 кВ -> пуск МДНУ-150 -> открытие задвижки ПГ.',
      normativeReference: 'ОПБ-88/97 (НП-001-15) • Регламент ликвидации тяжелых аварий SBO МЧС/Росэнергоатом'
    }
  },
  // ============================================================================
  // 4. Комплексный VR-тренажёр МЧС на базе .glb-модели АЭС
  // ============================================================================
  4: {
    scenarioId: 4,
    codeName: "MCHS_NPP_COMPLEX_GLB_RESCUE",
    titleRu: "4. МЧС АЭС: Пожар и эвакуация персонала в комплексе АЭС (.glb)",
    facilityRu: "Комплекс энергоблоков и градирен АЭС (1:1 м)",
    hLimitMsv: 0.50,
    tMaxSec: 450,
    warningThresholdRatio: 0.80,
    isotopes: ["Cs-137", "Co-60"],
    backgroundThresholdMicroSvPerHour: 0.25,
    initialSpawnPos: new THREE.Vector3(0, 1.65, 21.5),
    defaultPpeId: "bop_firefighter",
    defaultRemoteToolId: "hand",
    safetyRules: {
      allowedPpeIds: ["bop_firefighter", "hazmat_suit", "pneumosuit_lead"],
      ppeEnforcementRadiusM: 4.5,
      requireRemoteToolOnSourceGrab: false,
      allowedRemoteToolsOnGrab: ["hand", "extended_arm", "manipulator_15m", "telescopic_rod_3m"],
      requireShieldOrLeadPpeNearSource: false,
      criticalProximityRadiusM: 0.7,
      recommendedInstrumentId: "dp5"
    },
    failMessagesRu: {
      doseLimitExceeded:
        "Превышен аварийный предел эквивалентной дозы (H_limit = 0.50 мЗв) при ликвидации ЧС на комплексе АЭС!",
      timeoutExceeded:
        "Превышено контрольное время спасательной операции и тушения очагов (T_max = 450 с).",
      ppeViolation:
        "Вход в аварийный энергоблок без регламентированного комплекта СИЗ МЧС (БОП-1 / Л-1 / КИХ-4)!",
      shieldOrToolViolation:
        "Нарушение техники безопасности при работе в очаге возгорания.",
      protocolError:
        "Нарушен регламент тушения и эвакуации персонала в комплексе АЭС.",
      normativeReference: "НРБ-99/2009 • Боевой устав пожарной охраны и регламент АСР МЧС на АЭС"
    }
  }
};

/**
 * Вспомогательная функция получения строго типизированного IScenarioConfig по ID сценария (1..4)
 */
export function getScenarioConfigById(scenarioId: number): IScenarioConfig {
  return SCENARIO_CONFIG_REGISTRY[scenarioId] ?? SCENARIO_CONFIG_REGISTRY[1];
}

/**
 * Класс-реестр ScenarioConfigRegistry для доступа к конфигурациям всех 4 сценариев
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

