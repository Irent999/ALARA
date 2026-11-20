/**
 * ALARA-Planner Pro — Модуль проверки и регламента средств индивидуальной защиты (PPECheckModule.ts)
 *
 * Разработано в соответствии с:
 * - ОСПОРБ-99/2010 (СП 2.6.1.2612-10) — регламент допуска персонала группы А в зоны контролируемого доступа
 * - НРБ-99/2009 (СанПиН 2.6.1.2523-09) — защита органов дыхания и кожных покровов от радиоактивных аэрозолей
 * - Боевой устав войск РХБ защиты и Руководство по эксплуатации изолирующих костюмов (КИХ-4, ИЗК, Л-1)
 */

export type SuitType = 'IZK' | 'KIH_4' | 'L_1' | 'RHBZ_HEAVY';
export type RespiratorType = 'SHMP' | 'DP_5_RESP' | 'ASV_2';
export type DosimeterDeviceType = 'DKG_07B' | 'SRP_68_01';

/**
 * Спецификация защитного костюма
 */
export interface SuitSpecification {
  id: SuitType;
  codeRu: string;
  fullNameRu: string;
  massKg: number;
  thermalInsulationFactor: number; // Коэффициент тепловой нагрузки (1.0 - базовый, 2.5 - герметичный скафандр)
  baseProtectionFactors: {
    alpha: number;    // Коэффициент ослабления альфа-излучения
    beta: number;     // Коэффициент ослабления бета-излучения
    gamma: number;    // Коэффициент ослабления гамма-излучения (освинцованный фартук/резина)
    aerosol: number;  // Коэффициент защиты от аэрозолей и пыли
  };
}

/**
 * Спецификация средств индивидуальной защиты органов дыхания (СИЗОД)
 */
export interface RespiratorSpecification {
  id: RespiratorType;
  codeRu: string;
  fullNameRu: string;
  isAutonomousClosedCircuit: boolean;
  nominalDurationMinutes: number;
  inhalationProtectionFactor: number; // Коэффициент защиты органов дыхания (КЗ)
}

/**
 * Спецификация табельного дозиметрического прибора
 */
export interface DosimeterDeviceSpecification {
  id: DosimeterDeviceType;
  codeRu: string;
  fullNameRu: string;
  measurementRangeRu: string;
  energyRangeMeV: [number, number];
}

/**
 * Состояние комплекта СИЗ спасателя перед и во время входа в «грязную зону»
 */
export interface PPELoadoutState {
  suitType: SuitType;
  respiratorType: RespiratorType;
  dosimeterType: DosimeterDeviceType;
  /** Целостность оболочки костюма (0.0 — полный разрыв, 1.0 — 100% герметичность) */
  suitIntegrity: number;
  /** Проведена ли опрессовка и проверка герметичности клапанов костюма */
  suitSealVerified: boolean;
  /** Включен ли дозиметр, проверена ли батарея и целостность пломбы Госповерки */
  dosimeterCalibratedAndSealed: boolean;
  /** Остаток кислорода в баллонах АСВ-2 или ресурс фильтра ФПК (0.0 - 100.0 %) */
  oxygenOrFilterReservePercent: number;
  /** Давление в баллонах дыхательного аппарата (МПа, норма 20.0 - 30.0 МПа) */
  cylinderPressureMpa: number;
}

/**
 * Результат выполнения протокола предстартовой проверки СИЗ (Checklist Protocol)
 */
export interface PPEChecklistResult {
  isReadyForDirtyZone: boolean;
  suitIntegrityPassed: boolean;
  dosimeterVerificationPassed: boolean;
  oxygenReservePassed: boolean;
  blockingViolations: string[];
  warnings: string[];
  normativeReference: string;
  timestampIso: string;
}

/**
 * Интегральные коэффициенты защиты K_prot с учетом фактической герметичности
 */
export interface ProtectionCoefficientsResult {
  kProtAlpha: number;
  kProtBeta: number;
  kProtGamma: number;
  kProtAerosol: number;
  /** Множитель скорости ингаляционного поступления радионуклидов (0 — полная защита, 1 — открытое дыхание) */
  inhalationPenetrationMultiplier: number;
  /** Множитель скорости поверхностного загрязнения кожных покровов (0 — нет, 1 — открытая кожа) */
  dermalContaminationMultiplier: number;
  effectiveIntegrityRatio: number;
  breachAlertActive: boolean;
}

/**
 * Нормативная база защитных костюмов
 */
export const SUIT_SPECIFICATIONS: Readonly<Record<SuitType, SuitSpecification>> = {
  IZK: {
    id: 'IZK',
    codeRu: 'ИЗК',
    fullNameRu: 'Изолирующий защитный комплект (ИЗК) с герметичным шлем-маской',
    massKg: 4.2,
    thermalInsulationFactor: 1.75,
    baseProtectionFactors: {
      alpha: 1000.0,
      beta: 12.5,
      gamma: 1.04,
      aerosol: 250.0
    }
  },
  KIH_4: {
    id: 'KIH_4',
    codeRu: 'КИХ-4',
    fullNameRu: 'Костюм изолирующий химический скафандрового типа КИХ-4М',
    massKg: 7.8,
    thermalInsulationFactor: 2.35,
    baseProtectionFactors: {
      alpha: 5000.0,
      beta: 28.0,
      gamma: 1.08,
      aerosol: 2000.0
    }
  },
  L_1: {
    id: 'L_1',
    codeRu: 'Л-1',
    fullNameRu: 'Легкий защитный костюм Л-1 из прорезиненной ткани Т-15',
    massKg: 3.2,
    thermalInsulationFactor: 1.55,
    baseProtectionFactors: {
      alpha: 800.0,
      beta: 6.5,
      gamma: 1.02,
      aerosol: 85.0
    }
  },
  RHBZ_HEAVY: {
    id: 'RHBZ_HEAVY',
    codeRu: 'РХБЗ-Комплект РЗК',
    fullNameRu: 'Тяжелый радиационно-защитный комплект с освинцованным жилетом и фартуком (0.5 мм Pb экв.)',
    massKg: 16.5,
    thermalInsulationFactor: 2.6,
    baseProtectionFactors: {
      alpha: 10000.0,
      beta: 120.0,
      gamma: 1.48,
      aerosol: 1500.0
    }
  }
};

/**
 * Нормативная база средств защиты органов дыхания (СИЗОД)
 */
export const RESPIRATOR_SPECIFICATIONS: Readonly<Record<RespiratorType, RespiratorSpecification>> = {
  SHMP: {
    id: 'SHMP',
    codeRu: 'ШМП (Противогаз ГП-7/ПМК)',
    fullNameRu: 'Фильтрующий противогаз со шлем-маской ШМП и коробкой ФПК ЕО-16',
    isAutonomousClosedCircuit: false,
    nominalDurationMinutes: 120,
    inhalationProtectionFactor: 100.0
  },
  DP_5_RESP: {
    id: 'DP_5_RESP',
    codeRu: 'РПГ-67 / ФПК-ДП',
    fullNameRu: 'Панорамный респираторно-фильтрующий блок противоаэрозольной защиты',
    isAutonomousClosedCircuit: false,
    nominalDurationMinutes: 90,
    inhalationProtectionFactor: 50.0
  },
  ASV_2: {
    id: 'ASV_2',
    codeRu: 'АСВ-2 (Изолирующий)',
    fullNameRu: 'Аппарат сжатого воздуха изолирующий АСВ-2 с избыточным подмасочным давлением',
    isAutonomousClosedCircuit: true,
    nominalDurationMinutes: 45,
    inhalationProtectionFactor: 5000.0
  }
};

/**
 * Нормативная база дозиметрических приборов индивидуального и оперативного контроля
 */
export const DOSIMETER_SPECIFICATIONS: Readonly<Record<DosimeterDeviceType, DosimeterDeviceSpecification>> = {
  DKG_07B: {
    id: 'DKG_07B',
    codeRu: 'ДКГ-07Б «Дрозд»',
    fullNameRu: 'Дозиметр гамма-излучения прямопоказывающий индивидуальный ДКГ-07Б',
    measurementRangeRu: '0.1 мкЗв/ч — 10 Зв/ч',
    energyRangeMeV: [0.05, 3.0]
  },
  SRP_68_01: {
    id: 'SRP_68_01',
    codeRu: 'СРП-68-01',
    fullNameRu: 'Сцинтилляционный геологоразведочный и поисковый радиометр СРП-68-01 (кристалл NaI(Tl))',
    measurementRangeRu: '0 — 3000 мкР/ч (0 — 10000 имп/с)',
    energyRangeMeV: [0.03, 3.0]
  }
};

/**
 * Выполняет регламентную проверку готовности спасателя перед входом в «грязную зону» (Checklist Protocol):
 * а) Проверка цельности и герметичности костюма.
 * б) Проверка подключения, питания и пломбировки дозиметра/сигнализатора.
 * в) Проверка остатка кислорода (АСВ-2) / ресурса противоаэрозольного фильтра.
 */
export function verifyPPEReadinessChecklist(state: PPELoadoutState): PPEChecklistResult {
  const blockingViolations: string[] = [];
  const warnings: string[] = [];

  // а) Проверка целостности и герметичности костюма
  const suitIntegrityPassed = state.suitIntegrity >= 0.95 && state.suitSealVerified;
  if (!state.suitSealVerified) {
    blockingViolations.push(
      'Не выполнена контрольная опрессовка и проверка герметичности швов/клапанов защитного костюма.'
    );
  }
  if (state.suitIntegrity < 0.95) {
    blockingViolations.push(
      `Обнаружено нарушение целостности оболочки костюма (${(state.suitIntegrity * 100).toFixed(0)}% < 95% по регламенту).`
    );
  } else if (state.suitIntegrity < 0.99) {
    warnings.push(
      `Микроизнос защитной ткани костюма (${(state.suitIntegrity * 100).toFixed(1)}%). Рекомендуется сократить время пребывания в зоне.`
    );
  }

  // б) Проверка подключения и пломбировки дозиметра/сигнализатора
  const dosimeterVerificationPassed = state.dosimeterCalibratedAndSealed;
  if (!dosimeterVerificationPassed) {
    blockingViolations.push(
      `Дозиметр ${DOSIMETER_SPECIFICATIONS[state.dosimeterType].codeRu} не прошел самотестирование или отсутствует пломба Госповерки.`
    );
  }

  // в) Проверка остатка кислорода / ресурса фильтра
  const minRequiredReservePercent = 80.0;
  const minRequiredPressureMpa = state.respiratorType === 'ASV_2' ? 18.0 : 0.0;

  const oxygenReservePassed =
    state.oxygenOrFilterReservePercent >= minRequiredReservePercent &&
    state.cylinderPressureMpa >= minRequiredPressureMpa;

  if (state.oxygenOrFilterReservePercent < minRequiredReservePercent) {
    blockingViolations.push(
      `Недостаточный запас дыхательной смеси / ресурса ФПК: ${state.oxygenOrFilterReservePercent.toFixed(0)}% (минимум 80% для входа в зону ЧС).`
    );
  }
  if (state.respiratorType === 'ASV_2' && state.cylinderPressureMpa < minRequiredPressureMpa) {
    blockingViolations.push(
      `Давление в баллонах аппарата АСВ-2 (${state.cylinderPressureMpa.toFixed(1)} МПа) ниже допустимого предела 18.0 МПа.`
    );
  }

  const isReadyForDirtyZone =
    suitIntegrityPassed && dosimeterVerificationPassed && oxygenReservePassed;

  return {
    isReadyForDirtyZone,
    suitIntegrityPassed,
    dosimeterVerificationPassed,
    oxygenReservePassed,
    blockingViolations,
    warnings,
    normativeReference: 'ОСПОРБ-99/2010 п. 3.14 / Устав аварийно-спасательных формирований РХБЗ',
    timestampIso: new Date().toISOString()
  };
}

/**
 * Расчет коэффициента защиты K_prot для разного типа излучений (альфа, бета, гамма, аэрозоли).
 * При повреждении герметичности K_prot нелинейно падает, резко увеличивая ингаляционное и кожное заражение.
 */
export function calculatePPEProtectionFactors(state: PPELoadoutState): ProtectionCoefficientsResult {
  const suitSpec = SUIT_SPECIFICATIONS[state.suitType];
  const respSpec = RESPIRATOR_SPECIFICATIONS[state.respiratorType];

  const rawIntegrity = Math.max(0.0, Math.min(1.0, state.suitIntegrity));
  const sealFactor = state.suitSealVerified ? 1.0 : 0.45;
  const oxygenFactor = state.oxygenOrFilterReservePercent > 3.0 ? 1.0 : 0.05;

  // При разгерметизации (integrity < 1.0) защита от аэрозолей и альфа/бета падает по экспоненциальному закону утечки через разрыв
  const effectiveIntegrityRatio = rawIntegrity * sealFactor;
  const leakFraction = 1.0 - Math.pow(effectiveIntegrityRatio, 2.5);

  const kProtAlpha = Math.max(
    1.0,
    suitSpec.baseProtectionFactors.alpha * Math.pow(effectiveIntegrityRatio, 3.0)
  );
  const kProtBeta = Math.max(
    1.0,
    1.0 + (suitSpec.baseProtectionFactors.beta - 1.0) * Math.pow(effectiveIntegrityRatio, 1.8)
  );
  // Гамма-ослабление определяется массовой толщиной свинцового фартука и слабо зависит от микротрещин ткани
  const kProtGamma = Math.max(
    1.0,
    1.0 + (suitSpec.baseProtectionFactors.gamma - 1.0) * (0.3 + 0.7 * rawIntegrity)
  );

  // Аэрозольная и ингаляционная защита критически зависит от герметичности подмасочного пространства и запаса воздуха
  const combinedAerosolBase = Math.sqrt(
    suitSpec.baseProtectionFactors.aerosol * respSpec.inhalationProtectionFactor
  );
  const kProtAerosol = Math.max(
    1.0,
    combinedAerosolBase * Math.pow(effectiveIntegrityRatio, 4.0) * oxygenFactor
  );

  const inhalationPenetrationMultiplier = Math.min(
    1.0,
    1.0 / kProtAerosol + leakFraction * (1.0 - oxygenFactor * 0.65)
  );
  const dermalContaminationMultiplier = Math.min(
    1.0,
    1.0 / kProtBeta + leakFraction * 0.85
  );

  return {
    kProtAlpha: Number(kProtAlpha.toFixed(2)),
    kProtBeta: Number(kProtBeta.toFixed(2)),
    kProtGamma: Number(kProtGamma.toFixed(3)),
    kProtAerosol: Number(kProtAerosol.toFixed(2)),
    inhalationPenetrationMultiplier: Number(inhalationPenetrationMultiplier.toFixed(4)),
    dermalContaminationMultiplier: Number(dermalContaminationMultiplier.toFixed(4)),
    effectiveIntegrityRatio: Number(effectiveIntegrityRatio.toFixed(3)),
    breachAlertActive: rawIntegrity < 0.85 || !state.suitSealVerified || state.oxygenOrFilterReservePercent < 15.0
  };
}
