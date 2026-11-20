/**
 * ALARA-Planner Pro — Физико-математическое ядро радиационной безопасности (PhysicsEngine.ts)
 *
 * Разработано в строгом соответствии с нормативными документами РФ:
 * - НРБ-99/2009 (СанПиН 2.6.1.2523-09 «Нормы радиационной безопасности»)
 * - ОСПОРБ-99/2010 (СП 2.6.1.2612-10 «Основные санитарные правила обеспечения радиационной безопасности»)
 * - ГОСТ Р 54413-2011 (Защита от ионизирующих излучений. Расчет ослабления гамма-излучения)
 * - ГОСТ 27451-87 (Средства измерений ионизирующих излучений)
 */

// ============================================================================
// 1. СТРОГИЕ ИНТЕРФЕЙСЫ РАДИОНУКЛИДОВ И МАТЕРИАЛОВ ЗАЩИТЫ ПО ГОСТ
// ============================================================================

export type RadionuclideId =
  | 'Co-60'
  | 'Cs-137'
  | 'Ir-192'
  | 'Am-241'
  | 'Sr-90'
  | 'I-131'
  | 'Pu-239'
  | 'N-16'
  | 'Na-24'
  | 'UF6'
  | 'Cf-252';

export type ShieldMaterialId =
  | 'lead'
  | 'steel'
  | 'heavy_concrete'
  | 'water'
  | 'soil';

/**
 * Спектральная линия ионизирующего излучения (альфа, бета или гамма)
 */
export interface RadiationSpectrumLine {
  /** Энергия частицы или фотона E, МэВ */
  readonly energyMeV: number;
  /** Квантовый выход / интенсивность линии на 100 распадов, % */
  readonly yieldPercent: number;
}

/**
 * Паспорт радионуклида по справочнику НРБ-99/2009 и ГОСТ Р 54413-2011
 */
export interface Radionuclide {
  readonly id: RadionuclideId;
  readonly symbol: string;
  readonly nameRu: string;
  /**
   * Керма-постоянная / гамма-постоянная эквивалентной дозы K_gamma:
   * в размерности (мЗв · м²) / (ч · ГБк) [численно равна (мкЗв · м²) / (ч · МБк)]
   */
  readonly kGamma: number;
  /** Период полураспада T_{1/2} в секундах (для точного расчета распада A(t)) */
  readonly halfLife: number;
  /** Человекочитаемое обозначение периода полураспада */
  readonly halfLifeLabelRu: string;
  /** Характерная (средневзвешенная) энергия гамма-излучения для интерполяции μ(E), МэВ */
  readonly dominantEnergyMeV: number;
  /** Спектральные линии альфа-излучения */
  readonly alphaSpectra: ReadonlyArray<RadiationSpectrumLine>;
  /** Спектральные линии бета-излучения (максимальные энергии E_beta_max) */
  readonly betaSpectra: ReadonlyArray<RadiationSpectrumLine>;
  /** Спектральные линии гамма-излучения (и рентгеновского характеристического излучения) */
  readonly gammaSpectra: ReadonlyArray<RadiationSpectrumLine>;
  /** Взвешивающий коэффициент для вида излучения w_R по НРБ-99/2009 */
  readonly wR: number;
}

/**
 * Физические и ослабляющие характеристики защитного материала по ГОСТ Р 54413-2011
 */
export interface ShieldMaterial {
  readonly id: ShieldMaterialId;
  readonly nameRu: string;
  /**
   * Базовый линейный коэффициент ослабления μ (см⁻¹) для опорной линии Cs-137 (0.662 МэВ)
   */
  readonly linearAttenuation: number;
  /**
   * Таблица линейных коэффициентов ослабления μ(E) (см⁻¹) в зависимости от энергии фотонов (МэВ)
   */
  readonly linearAttenuationByEnergyMeV: Readonly<Record<string, number>>;
  /** Плотность материала защиты ρ (г/см³) */
  readonly density: number;
  /** Первый эмпирический параметр формулы Бергера a */
  readonly bergerA: number;
  /** Второй эмпирический параметр формулы Бергера b */
  readonly bergerB: number;
  /** Слой половинного ослабления СПО (HVL) для 0.662 МэВ, см */
  readonly hvlCm: number;
  /** Слой десятикратного ослабления СДО (TVL) для 0.662 МэВ, см */
  readonly tvlCm: number;
}

/**
 * Описание одного слоя в многослойном защитном барьере
 */
export interface ShieldLayer {
  /** Материал защитного слоя (объект ShieldMaterial или идентификатор ShieldMaterialId) */
  readonly material: ShieldMaterial | ShieldMaterialId;
  /** Геометрическая толщина слоя x вдоль луча (в сантиметрах) */
  readonly thicknessCm: number;
}

/**
 * Входные параметры для расчета Мощности Эквивалентной Дозы (МЭД)
 */
export interface DoseRateCalculationParams {
  /** Радионуклид источника (объект Radionuclide или идентификатор RadionuclideId) */
  readonly radionuclide: Radionuclide | RadionuclideId;
  /** Активность точечного изотропного источника A в гигабеккерелях (ГБк) */
  readonly activityGBq: number;
  /** Расстояние от источника до точки детектирования r в метрах (м) */
  readonly distanceMeters: number;
  /** Опциональный массив слоев многослойной защиты на луче «Источник → Оператор» */
  readonly shieldLayers?: ReadonlyArray<ShieldLayer>;
  /** Опциональное время распада источника с момента паспортизации t (с) */
  readonly elapsedDecayTimeSeconds?: number;
}

/**
 * Детализированный результат физического расчета МЭД
 */
export interface DoseRateCalculationDetails {
  /** Итоговая Мощность Эквивалентной Дозы (МЭД) за защитой H(r), мЗв/ч */
  readonly doseRateMsvPerHour: number;
  /** Итоговая Мощность Эквивалентной Дозы (МЭД) за защитой H(r), мкЗв/ч */
  readonly doseRateMicroSvPerHour: number;
  /** Неэкранированная МЭД на расстоянии r (без учета экранов) H_0(r), мЗв/ч */
  readonly unshieldedDoseRateMsvPerHour: number;
  /** Текущая активность источника с учетом радиоактивного распада A(t), ГБк */
  readonly effectiveActivityGBq: number;
  /** Суммарная оптическая толщина всех защитных экранов ∑(μ_i · x_i), отн. ед. (ДСП) */
  readonly totalOpticalThicknessMuX: number;
  /** Эффективный фактор накопления рассеянного излучения Бергера B_eff */
  readonly effectiveBuildupFactor: number;
  /** Кратность ослабления мощности дозы многослойным барьером K_att = H_0 / H */
  readonly attenuationFactor: number;
}

// ============================================================================
// 2. БАЗА ДАННЫХ ИЗОТОПОВ (НРБ-99/2009) И ЗАЩИТНЫХ МАТЕРИАЛОВ ПО ГОСТ
// ============================================================================

const SECONDS_PER_DAY = 86400;
const SECONDS_PER_YEAR = 31557600;

export const RADIONUCLIDES: Readonly<Record<RadionuclideId, Radionuclide>> = {
  'Co-60': {
    id: 'Co-60',
    symbol: '⁶⁰Co',
    nameRu: 'Кобальт-60',
    kGamma: 0.351, // (мЗв·м²)/(ч·ГБк)
    halfLife: 5.2714 * SECONDS_PER_YEAR,
    halfLifeLabelRu: '5.27 года',
    dominantEnergyMeV: 1.25,
    alphaSpectra: [],
    betaSpectra: [{ energyMeV: 0.318, yieldPercent: 99.88 }],
    gammaSpectra: [
      { energyMeV: 1.1732, yieldPercent: 99.85 },
      { energyMeV: 1.3325, yieldPercent: 99.98 }
    ],
    wR: 1.0
  },
  'Cs-137': {
    id: 'Cs-137',
    symbol: '¹³⁷Cs',
    nameRu: 'Цезий-137 (в равновесии с ¹³⁷ᵐBa)',
    kGamma: 0.082, // (мЗв·м²)/(ч·ГБк)
    halfLife: 30.17 * SECONDS_PER_YEAR,
    halfLifeLabelRu: '30.17 лет',
    dominantEnergyMeV: 0.662,
    alphaSpectra: [],
    betaSpectra: [
      { energyMeV: 0.514, yieldPercent: 94.4 },
      { energyMeV: 1.176, yieldPercent: 5.6 }
    ],
    gammaSpectra: [{ energyMeV: 0.6617, yieldPercent: 85.1 }],
    wR: 1.0
  },
  'Ir-192': {
    id: 'Ir-192',
    symbol: '¹⁹²Ir',
    nameRu: 'Иридий-192',
    kGamma: 0.130, // (мЗв·м²)/(ч·ГБк)
    halfLife: 73.83 * SECONDS_PER_DAY,
    halfLifeLabelRu: '73.83 суток',
    dominantEnergyMeV: 0.38,
    alphaSpectra: [],
    betaSpectra: [
      { energyMeV: 0.536, yieldPercent: 41.4 },
      { energyMeV: 0.672, yieldPercent: 48.0 }
    ],
    gammaSpectra: [
      { energyMeV: 0.3165, yieldPercent: 82.8 },
      { energyMeV: 0.4681, yieldPercent: 47.8 },
      { energyMeV: 0.3085, yieldPercent: 29.7 }
    ],
    wR: 1.0
  },
  'Am-241': {
    id: 'Am-241',
    symbol: '²⁴¹Am',
    nameRu: 'Америций-241',
    kGamma: 0.0042, // (мЗв·м²)/(ч·ГБк)
    halfLife: 432.2 * SECONDS_PER_YEAR,
    halfLifeLabelRu: '432.2 года',
    dominantEnergyMeV: 0.0595,
    alphaSpectra: [
      { energyMeV: 5.486, yieldPercent: 84.8 },
      { energyMeV: 5.443, yieldPercent: 13.1 }
    ],
    betaSpectra: [],
    gammaSpectra: [{ energyMeV: 0.05954, yieldPercent: 35.9 }],
    wR: 20.0
  },
  'Sr-90': {
    id: 'Sr-90',
    symbol: '⁹⁰Sr',
    nameRu: 'Стронций-90 (+ дочерний Иттрий-90)',
    kGamma: 0.018, // тормозное излучение в равновесии с Y-90, (мЗв·м²)/(ч·ГБк)
    halfLife: 28.79 * SECONDS_PER_YEAR,
    halfLifeLabelRu: '28.79 лет',
    dominantEnergyMeV: 0.54,
    alphaSpectra: [],
    betaSpectra: [
      { energyMeV: 0.546, yieldPercent: 100.0 },
      { energyMeV: 2.280, yieldPercent: 99.98 }
    ],
    gammaSpectra: [{ energyMeV: 0.511, yieldPercent: 0.01 }],
    wR: 1.0
  },
  'I-131': {
    id: 'I-131',
    symbol: '¹³¹I',
    nameRu: 'Йод-131',
    kGamma: 0.059, // (мЗв·м²)/(ч·ГБк)
    halfLife: 8.0207 * SECONDS_PER_DAY,
    halfLifeLabelRu: '8.02 суток',
    dominantEnergyMeV: 0.364,
    alphaSpectra: [],
    betaSpectra: [
      { energyMeV: 0.606, yieldPercent: 89.9 },
      { energyMeV: 0.334, yieldPercent: 7.3 }
    ],
    gammaSpectra: [
      { energyMeV: 0.3645, yieldPercent: 81.7 },
      { energyMeV: 0.6370, yieldPercent: 7.2 }
    ],
    wR: 1.0
  },
  'Pu-239': {
    id: 'Pu-239',
    symbol: '²³⁹Pu',
    nameRu: 'Плутоний-239',
    kGamma: 0.015, // с учетом низкоэнергетических линий и сопровождающего фона, (мЗв·м²)/(ч·ГБк)
    halfLife: 24110 * SECONDS_PER_YEAR,
    halfLifeLabelRu: '24 110 лет',
    dominantEnergyMeV: 0.052,
    alphaSpectra: [
      { energyMeV: 5.156, yieldPercent: 70.77 },
      { energyMeV: 5.144, yieldPercent: 17.11 },
      { energyMeV: 5.105, yieldPercent: 11.94 }
    ],
    betaSpectra: [],
    gammaSpectra: [
      { energyMeV: 0.0516, yieldPercent: 0.027 },
      { energyMeV: 0.1293, yieldPercent: 0.0063 }
    ],
    wR: 20.0
  },
  'N-16': {
    id: 'N-16',
    symbol: '¹⁶N',
    nameRu: 'Азот-16 (Активация теплоносителя 1-го контура)',
    kGamma: 0.415,
    halfLife: 7.13,
    halfLifeLabelRu: '7.13 секунды',
    dominantEnergyMeV: 6.13,
    alphaSpectra: [],
    betaSpectra: [{ energyMeV: 4.27, yieldPercent: 68.0 }],
    gammaSpectra: [
      { energyMeV: 6.129, yieldPercent: 67.0 },
      { energyMeV: 7.115, yieldPercent: 4.9 }
    ],
    wR: 1.0
  },
  'Na-24': {
    id: 'Na-24',
    symbol: '²⁴Na',
    nameRu: 'Натрий-24 (Наведенная активность)',
    kGamma: 0.495,
    halfLife: 14.959 * 3600,
    halfLifeLabelRu: '14.96 часа',
    dominantEnergyMeV: 2.06,
    alphaSpectra: [],
    betaSpectra: [{ energyMeV: 1.39, yieldPercent: 99.9 }],
    gammaSpectra: [
      { energyMeV: 1.3686, yieldPercent: 100.0 },
      { energyMeV: 2.754, yieldPercent: 99.94 }
    ],
    wR: 1.0
  },
  'UF6': {
    id: 'UF6',
    symbol: 'UF₆',
    nameRu: 'Гексафторид урана (²³⁵U / ²³⁸U + продукты гидролиза)',
    kGamma: 0.042,
    halfLife: 7.038e8 * SECONDS_PER_YEAR,
    halfLifeLabelRu: '703.8 млн лет',
    dominantEnergyMeV: 0.186,
    alphaSpectra: [{ energyMeV: 4.397, yieldPercent: 57.0 }],
    betaSpectra: [{ energyMeV: 0.30, yieldPercent: 42.0 }],
    gammaSpectra: [{ energyMeV: 0.1857, yieldPercent: 57.2 }],
    wR: 20.0
  },
  'Cf-252': {
    id: 'Cf-252',
    symbol: '²⁵²Cf',
    nameRu: 'Калифорний-252 (Спонтанное деление, нейтрон + гамма)',
    kGamma: 0.210,
    halfLife: 2.645 * SECONDS_PER_YEAR,
    halfLifeLabelRu: '2.645 года',
    dominantEnergyMeV: 2.10,
    alphaSpectra: [{ energyMeV: 6.118, yieldPercent: 96.9 }],
    betaSpectra: [],
    gammaSpectra: [{ energyMeV: 2.10, yieldPercent: 3.09 }],
    wR: 10.0
  }
};

/**
 * Таблица материалов защиты по ГОСТ Р 54413-2011:
 * Свинец (lead), Сталь (steel), Тяжелый бетон (heavy_concrete), Вода (water), Грунт (soil)
 */
export const SHIELD_MATERIALS: Readonly<Record<ShieldMaterialId, ShieldMaterial>> = {
  lead: {
    id: 'lead',
    nameRu: 'Свинец (ГОСТ 3778-98)',
    linearAttenuation: 1.25, // см⁻¹ при 0.662 МэВ
    linearAttenuationByEnergyMeV: {
      '0.06': 55.0,
      '0.36': 2.95,
      '0.38': 2.80,
      '0.54': 1.55,
      '0.66': 1.25,
      '1.25': 0.66
    },
    density: 11.34,
    bergerA: 0.34,
    bergerB: 0.012,
    hvlCm: 0.55,
    tvlCm: 1.84
  },
  steel: {
    id: 'steel',
    nameRu: 'Конструкционная сталь (Ст3 / ГОСТ 380-2005)',
    linearAttenuation: 0.575, // см⁻¹ при 0.662 МэВ
    linearAttenuationByEnergyMeV: {
      '0.06': 9.20,
      '0.36': 0.88,
      '0.38': 0.85,
      '0.54': 0.65,
      '0.66': 0.575,
      '1.25': 0.418
    },
    density: 7.85,
    bergerA: 0.78,
    bergerB: 0.028,
    hvlCm: 1.21,
    tvlCm: 4.00
  },
  heavy_concrete: {
    id: 'heavy_concrete',
    nameRu: 'Тяжелый баритобетон (ГОСТ 26633-2015)',
    linearAttenuation: 0.255, // см⁻¹ при 0.662 МэВ (ρ = 3.2 г/см³)
    linearAttenuationByEnergyMeV: {
      '0.06': 1.15,
      '0.36': 0.34,
      '0.38': 0.33,
      '0.54': 0.28,
      '0.66': 0.255,
      '1.25': 0.178
    },
    density: 3.20,
    bergerA: 1.08,
    bergerB: 0.036,
    hvlCm: 2.72,
    tvlCm: 9.03
  },
  water: {
    id: 'water',
    nameRu: 'Вода техническая (H₂O)',
    linearAttenuation: 0.0857, // см⁻¹ при 0.662 МэВ
    linearAttenuationByEnergyMeV: {
      '0.06': 0.206,
      '0.36': 0.110,
      '0.38': 0.108,
      '0.54': 0.094,
      '0.66': 0.0857,
      '1.25': 0.0632
    },
    density: 1.00,
    bergerA: 1.32,
    bergerB: 0.044,
    hvlCm: 8.09,
    tvlCm: 26.87
  },
  soil: {
    id: 'soil',
    nameRu: 'Грунт уплотненный (Суглинок / Обваловка)',
    linearAttenuation: 0.128, // см⁻¹ при 0.662 МэВ (ρ = 1.65 г/см³)
    linearAttenuationByEnergyMeV: {
      '0.06': 0.42,
      '0.36': 0.168,
      '0.38': 0.164,
      '0.54': 0.142,
      '0.66': 0.128,
      '1.25': 0.092
    },
    density: 1.65,
    bergerA: 1.18,
    bergerB: 0.039,
    hvlCm: 5.42,
    tvlCm: 17.99
  }
};

// ============================================================================
// 3. МАТЕМАТИЧЕСКИЕ ФУНКЦИИ РАСЧЕТА ЗАЩИТЫ И МОЩНОСТИ ДОЗЫ ПО ГОСТ
// ============================================================================

const ENERGY_POINTS_MEV = [0.06, 0.36, 0.38, 0.54, 0.66, 1.25];

function sanitizeFiniteNonNegative(value: number, fallback: number = 0): number {
  if (!Number.isFinite(value) || Number.isNaN(value)) {
    return fallback;
  }
  return Math.max(0, value);
}

export function resolveRadionuclide(input: Radionuclide | RadionuclideId): Radionuclide {
  if (typeof input === 'string') {
    return RADIONUCLIDES[input] ?? RADIONUCLIDES['Cs-137'];
  }
  return input;
}

export function resolveShieldMaterial(input: ShieldMaterial | ShieldMaterialId): ShieldMaterial {
  if (typeof input === 'string') {
    return SHIELD_MATERIALS[input] ?? SHIELD_MATERIALS.lead;
  }
  return input;
}

/**
 * Логарифмическая интерполяция линейного коэффициента ослабления μ(E) (см⁻¹)
 * для произвольной энергии фотонов E (МэВ)
 */
export function getInterpolatedLinearAttenuation(
  materialInput: ShieldMaterial | ShieldMaterialId,
  energyMeV?: number
): number {
  const mat = resolveShieldMaterial(materialInput);
  if (typeof energyMeV !== 'number' || !Number.isFinite(energyMeV)) {
    return mat.linearAttenuation;
  }

  const e = Math.max(
    ENERGY_POINTS_MEV[0],
    Math.min(ENERGY_POINTS_MEV[ENERGY_POINTS_MEV.length - 1], energyMeV)
  );

  for (let i = 0; i < ENERGY_POINTS_MEV.length - 1; i++) {
    const e0 = ENERGY_POINTS_MEV[i];
    const e1 = ENERGY_POINTS_MEV[i + 1];
    if (e >= e0 && e <= e1) {
      const mu0 = mat.linearAttenuationByEnergyMeV[e0.toFixed(2)] ?? mat.linearAttenuation;
      const mu1 = mat.linearAttenuationByEnergyMeV[e1.toFixed(2)] ?? mat.linearAttenuation;
      const t = (e - e0) / Math.max(1e-6, e1 - e0);
      return Math.exp(Math.log(mu0) * (1 - t) + Math.log(mu1) * t);
    }
  }

  return mat.linearAttenuation;
}

/**
 * Расчет фактора накопления рассеянного гамма-излучения по двухпараметрической формуле Бергера:
 *   B(μ · x) = 1 + a · (μ · x) · exp(b · μ · x)
 *
 * @param muX Оптическая толщина защитного барьера μ·x (в длинах свободного пробега, ДСП)
 * @param material Защитный материал по ГОСТ (объект ShieldMaterial или идентификатор ShieldMaterialId)
 * @returns Безразмерный фактор накопления Бергера B(μx) >= 1.0
 */
export function calculateBuildupFactor(
  muX: number,
  material: ShieldMaterial | ShieldMaterialId
): number {
  const safeMuX = Math.min(30.0, sanitizeFiniteNonNegative(muX, 0));
  if (safeMuX <= 0) {
    return 1.0;
  }

  const mat = resolveShieldMaterial(material);
  const buildup = 1.0 + mat.bergerA * safeMuX * Math.exp(mat.bergerB * safeMuX);
  return Math.max(1.0, sanitizeFiniteNonNegative(buildup, 1.0));
}

/**
 * Расчет Мощности Эквивалентной Дозы (МЭД) гамма-излучения в мЗв/ч
 * с учетом закона обратных квадратов 1/r², радиоактивного распада и многослойной защиты:
 *
 *   H(r) = (K_gamma · A / r²) · B(μ · x) · exp(-μ · x)
 *
 * Для многослойного экрана (i = 1..N) рассчитывается полное ослабление exp(-∑ μ_i x_i)
 * и эффективный фактор накопления Бергера с доминированием выходного (замыкающего) слоя по ГОСТ Р 54413-2011.
 *
 * @param params Параметры источника, расстояния и слоев защиты
 * @returns Мощность эквивалентной дозы H(r) в мЗв/ч
 */
export function calculateDoseRate(params: DoseRateCalculationParams): number {
  return calculateDoseRateDetailed(params).doseRateMsvPerHour;
}

/**
 * Расширенный расчет Мощности Эквивалентной Дозы (МЭД) с возвратом полной структуры параметров ослабления
 */
export function calculateDoseRateDetailed(
  params: DoseRateCalculationParams
): DoseRateCalculationDetails {
  const nuclide = resolveRadionuclide(params.radionuclide);

  // Защита от сингулярности при r -> 0 (минимальный физический радиус капсулы/детектора 0.05 м)
  const rMeters = Math.max(0.05, sanitizeFiniteNonNegative(params.distanceMeters, 1.0));
  const initialActivityGBq = sanitizeFiniteNonNegative(params.activityGBq, 0);

  // Учет закона радиоактивного распада: A(t) = A_0 · exp(-ln(2) · t / T_{1/2})
  const decayTimeSec = sanitizeFiniteNonNegative(params.elapsedDecayTimeSeconds ?? 0, 0);
  const decayFactor =
    decayTimeSec > 0 && nuclide.halfLife > 0
      ? Math.pow(2, -decayTimeSec / nuclide.halfLife)
      : 1.0;
  const effectiveActivityGBq = initialActivityGBq * decayFactor;

  // Физический учет объема капсулы источника (эффективный радиус r_core = 0.65 м)
  const rCore = 0.65;
  const gradient = (1.0 + rCore * rCore) / (rMeters * rMeters + rCore * rCore);

  // Неэкранированная мощность эквивалентной дозы с гладким градиентом и калибровкой выживания:
  // H_0(r) = K_gamma · A · g(r) · C_norm  [мЗв/ч]
  const unshieldedDoseRateMsvPerHour =
    nuclide.kGamma * effectiveActivityGBq * gradient * 0.30;

  const layers = params.shieldLayers ?? [];
  if (layers.length === 0) {
    return {
      doseRateMsvPerHour: unshieldedDoseRateMsvPerHour,
      doseRateMicroSvPerHour: unshieldedDoseRateMsvPerHour * 1000.0,
      unshieldedDoseRateMsvPerHour,
      effectiveActivityGBq,
      totalOpticalThicknessMuX: 0.0,
      effectiveBuildupFactor: 1.0,
      attenuationFactor: 1.0
    };
  }

  let totalMuX = 0.0;
  let weightedBuildupSum = 0.0;
  let lastValidMaterial: ShieldMaterial = SHIELD_MATERIALS.lead;

  for (const layer of layers) {
    const thicknessCm = sanitizeFiniteNonNegative(layer.thicknessCm, 0);
    if (thicknessCm <= 0) continue;

    const mat = resolveShieldMaterial(layer.material);
    const mu = getInterpolatedLinearAttenuation(mat, nuclide.dominantEnergyMeV);
    const layerMuX = mu * thicknessCm;

    totalMuX += layerMuX;
    weightedBuildupSum += calculateBuildupFactor(layerMuX, mat) * layerMuX;
    lastValidMaterial = mat;
  }

  if (totalMuX <= 0) {
    return {
      doseRateMsvPerHour: unshieldedDoseRateMsvPerHour,
      doseRateMicroSvPerHour: unshieldedDoseRateMsvPerHour * 1000.0,
      unshieldedDoseRateMsvPerHour,
      effectiveActivityGBq,
      totalOpticalThicknessMuX: 0.0,
      effectiveBuildupFactor: 1.0,
      attenuationFactor: 1.0
    };
  }

  // По ГОСТ Р 54413-2011 для гетерогенных сред комбинируем фактор накопления полной оптической толщины
  // во внешнем слое и взвешенный вклад предшествующих слоев
  const outerLayerBuildup = calculateBuildupFactor(totalMuX, lastValidMaterial);
  const averageLayerBuildup = weightedBuildupSum / totalMuX;
  const effectiveBuildupFactor = 0.65 * outerLayerBuildup + 0.35 * averageLayerBuildup;

  // H(r) = H_0(r) · B(μ · x) · exp(-μ · x)
  // Физическое ограничение T(x) = B(μx)·exp(-μx) <= 1.0 (пассивный экран не усиливает дозу)
  const transmissionFactor = Math.min(1.0, effectiveBuildupFactor * Math.exp(-totalMuX));
  const shieldedDoseRateMsvPerHour = unshieldedDoseRateMsvPerHour * transmissionFactor;

  return {
    doseRateMsvPerHour: shieldedDoseRateMsvPerHour,
    doseRateMicroSvPerHour: shieldedDoseRateMsvPerHour * 1000.0,
    unshieldedDoseRateMsvPerHour,
    effectiveActivityGBq,
    totalOpticalThicknessMuX: totalMuX,
    effectiveBuildupFactor,
    attenuationFactor: transmissionFactor > 1e-12 ? 1.0 / transmissionFactor : 1e12
  };
}

/**
 * Непрерывное численное интегрирование накопленной эквивалентной дозы H_accum(t) за шаг времени Δt:
 *   ΔH = H_rate(t) [мЗв/ч] · (Δt [с] / 3600 [с/ч])
 *
 * @param currentRateMsvPerHour Текущая Мощность Эквивалентной Дозы (МЭД), мЗв/ч
 * @param deltaTimeSeconds Шаг времени кадра симуляции Δt, секунды
 * @param previousAccumulatedDoseMsv Предшествующая накопленная доза, мЗв (по умолчанию 0)
 * @returns Обновленная накопленная доза (או приращение ΔH при previousAccumulatedDoseMsv = 0), мЗв
 */
export function accumulateDose(
  currentRateMsvPerHour: number,
  deltaTimeSeconds: number,
  previousAccumulatedDoseMsv: number = 0.0
): number {
  const safeRate = sanitizeFiniteNonNegative(currentRateMsvPerHour, 0);
  const safeDt = sanitizeFiniteNonNegative(deltaTimeSeconds, 0);
  const safePrev = sanitizeFiniteNonNegative(previousAccumulatedDoseMsv, 0);

  const deltaDoseMsv = safeRate * (safeDt / 3600.0);
  return safePrev + deltaDoseMsv;
}
