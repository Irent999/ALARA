/**
 * ALARA-Planner Pro VR - Справочник и профили приборов по ГОСТ 27451-87
 * «Средства измерений ионизирующих излучений. Общие технические условия»
 * и ГОСТ Р 8.804-2012 «Измерение эквивалентной и эффективной дозы».
 */

export type InstrumentId =
  | 'dp5'
  | 'mica_gm'
  | 'hemispheric_gm'
  | 'nai'
  | 'alpha_zns'
  | 'ion'
  | 'cdznte'
  | 'pips'
  | 'neutron';

export type InstrumentCategory =
  | 'geiger'
  | 'scintillator'
  | 'semiconductor'
  | 'ion_chamber'
  | 'neutron';

export type RadiationClass = 'alpha' | 'beta' | 'gamma' | 'neutron';

export interface InstrumentProfile {
  id: InstrumentId;
  name: string;
  nameFull: string;
  category: InstrumentCategory;
  detectedRadiation: RadiationClass[];
  detectorTypeRu: string;
  gostStandard: string;
  measurementRangeRu: string;
  energyRangeRu: string;
  basicErrorPercent: number; // Основная относительная погрешность по ГОСТ
  timeConstantSec: number; // Постоянная времени инерционности тау (сек)
  sensitivityFactor: number; // Отклик на единицу мощности дозы
  audioStyle: 'geiger_clicks' | 'scintillator_tone' | 'ion_buzzer' | 'neutron_pulse';
  hasSpectrometryMode: boolean; // Поддержка спектрометрии и МКА
  applicationRu: string;
  advantagesRu: string[];
  limitationsRu: string[];
  model3dDetails: {
    color: string;
    screenGlowColor: string;
    probeType: 'cylinder_probe' | 'mica_probe' | 'hemisphere_probe' | 'chamber_box' | 'scintillator_wand' | 'czt_probe' | 'pips_chamber' | 'bonner_sphere';
  };
}

export const GOST_INSTRUMENTS: Record<InstrumentId, InstrumentProfile> = {
  dp5: {
    id: 'dp5',
    name: 'ДП-5В / МКС-АТ1117М',
    nameFull: 'Войсковой и аварийно-спасательный измеритель мощности дозы ДП-5В (МЧС) / МКС-АТ1117М',
    category: 'geiger',
    detectedRadiation: ['gamma', 'beta'],
    detectorTypeRu: 'Газоразрядные счетчики СБМ-20 / СИ-3БГ в поворотном экране зонда ДП-5В (режимы Г / Б / К)',
    gostStandard: 'ГОСТ 27451-87, ГОСТ 8.804-2012, ТУ ДП-5В',
    measurementRangeRu: '0.5 мкЗв/ч — 2.0 Зв/ч (0.05 мР/ч — 200 Р/ч; 6 поддиапазонов)',
    energyRangeRu: '50 кэВ — 3.0 МэВ (гамма), от 0.3 МэВ (бета со снятым экраном)',
    basicErrorPercent: 15,
    timeConstantSec: 3.5,
    sensitivityFactor: 1.0,
    audioStyle: 'geiger_clicks',
    hasSpectrometryMode: false,
    applicationRu: 'Аварийная радиационная разведка подразделений МЧС на АЭС, измерение уровней радиации и бета-загрязненности местности и оборудования.',
    advantagesRu: [
      'Сверхширокий аварийный диапазон до 200 Р/ч (2 Зв/ч) — не захлебывается при авариях на АЭС',
      'Поворотный бета-фильтр («Б» / «Г») и встроенный контрольный препарат ⁹⁰Sr+⁹⁰Y',
      'Высокая ударопрочность, герметичность зонда и работа в условиях пожара и задымления'
    ],
    limitationsRu: [
      'Толстостенная стальная/стеклянная колба зонда не регистрирует альфа-частицы',
      'Отсутствие спектрометрической идентификации нуклидов'
    ],
    model3dDetails: {
      color: '#4b5563',
      screenGlowColor: '#34d399',
      probeType: 'cylinder_probe'
    }
  },

  mica_gm: {
    id: 'mica_gm',
    name: 'МКС-01СА1М (Слюдяной счетчик)',
    nameFull: 'Радиометр-дозиметр с тонкостенным слюдяным торцевым окном (Бета-1 / СИ-8Б)',
    category: 'geiger',
    detectedRadiation: ['alpha', 'beta', 'gamma'],
    detectorTypeRu: 'Торцевой счетчик Гейгера-Мюллера со слюдяным входным окном плотностью 1.5–2.0 мг/см²',
    gostStandard: 'ГОСТ 27451-87, ГОСТ Р 52798-2007',
    measurementRangeRu: '0.01 мкЗв/ч — 10.0 мЗв/ч (поток α: 1 — 30 000 част/(мин·см²))',
    energyRangeRu: 'α от 2.5 МэВ; β от 50 кэВ; γ от 20 кэВ',
    basicErrorPercent: 12,
    timeConstantSec: 2.5,
    sensitivityFactor: 2.2,
    audioStyle: 'geiger_clicks',
    hasSpectrometryMode: false,
    applicationRu: 'Прецизионный поиск альфа- и мягкого бета-загрязнения поверхностей, одежды, кожных покровов и продуктов питания.',
    advantagesRu: [
      'Сверхтонкое входное окно пропускает альфа-частицы (Pu-239, Am-241) и мягкую бету (C-14, Sr-90)',
      'Высокая чувствительность к малым уровням загрязненности',
      'Возможность дифференциации альфа/бета/гамма с помощью сменных экранов'
    ],
    limitationsRu: [
      'Механическая хрупкость ультратонкой слюдяной мембраны (требует защитной сетки)',
      'Не позволяет определять энергию частиц (только интенсивность счета)'
    ],
    model3dDetails: {
      color: '#1e293b',
      screenGlowColor: '#38bdf8',
      probeType: 'mica_probe'
    }
  },

  hemispheric_gm: {
    id: 'hemispheric_gm',
    name: 'РЗБА-04Д (Полусферический счетчик)',
    nameFull: 'Специализированный радиометр поверхностной загрязненности с полусферической геометрией 2π',
    category: 'geiger',
    detectedRadiation: ['alpha', 'beta'],
    detectorTypeRu: 'Полусферический газонаполненный пропорционально-гейгеровский детектор с сетчатым катодом',
    gostStandard: 'ГОСТ 27451-87, ГОСТ 8.033-96',
    measurementRangeRu: '0.1 — 100 000 част/(мин·см²)',
    energyRangeRu: 'α: 3.0 — 8.0 МэВ; β: 0.1 — 3.5 МэВ',
    basicErrorPercent: 15,
    timeConstantSec: 3.0,
    sensitivityFactor: 3.5,
    audioStyle: 'geiger_clicks',
    hasSpectrometryMode: false,
    applicationRu: 'Входной и выходной санитарный контроль персонала, инструмента и оборудования в санпропускниках АЭС.',
    advantagesRu: [
      'Большая эффективная площадь окна (до 150 см²) для экспресс-контроля больших площадей',
      'Высокий геометрический фактор регистрации (близок к 2π стер)',
      'Минимальное краевое рассеяние'
    ],
    limitationsRu: [
      'Ограниченная применимость для узких точечных измерений',
      'Не измеряет дозу гамма-излучения'
    ],
    model3dDetails: {
      color: '#475569',
      screenGlowColor: '#f59e0b',
      probeType: 'hemisphere_probe'
    }
  },

  nai: {
    id: 'nai',
    name: 'СРП-68-01 / АТ6130 NaI(Tl)',
    nameFull: 'Высокочувствительный сцинтилляционный радиометр-спектрометр',
    category: 'scintillator',
    detectedRadiation: ['gamma'],
    detectorTypeRu: 'Монокристалл иодида натрия с таллием NaI(Tl) Ø40x40 мм с ФЭУ и 1024-канальным АЦП',
    gostStandard: 'ГОСТ 27451-87, ТУ 95.845-84',
    measurementRangeRu: '0.01 мкЗв/ч — 150.0 мкЗв/ч (до 50 000 имп/с)',
    energyRangeRu: '30 кэВ — 3.0 МэВ (энергетическое разрешение ~7.5% на 662 кэВ)',
    basicErrorPercent: 15,
    timeConstantSec: 0.6,
    sensitivityFactor: 35.0,
    audioStyle: 'scintillator_tone',
    hasSpectrometryMode: true,
    applicationRu: 'Поиск утерянных гамма-источников, экспресс-спектрометрия и идентификация изотопов (Cs-137, Co-60, Am-241, Ra-226).',
    advantagesRu: [
      'Квантовая эффективность к гамма-излучению в 30-50 раз выше счетчиков Гейгера',
      'Мгновенная реакция на микроаномалии радиационного фона (< 0.5 с)',
      'Построение энергетического спектра с автоматической идентификацией радионуклидов'
    ],
    limitationsRu: [
      'Насыщение при высоких мощностях дозы (> 0.3 мЗв/ч)',
      'Температурный дрейф фотоумножителя (требует термокомпенсации)'
    ],
    model3dDetails: {
      color: '#0f172a',
      screenGlowColor: '#a855f7',
      probeType: 'scintillator_wand'
    }
  },

  alpha_zns: {
    id: 'alpha_zns',
    name: 'РКБ4-1еМ (ZnS(Ag) Альфа-радиометр)',
    nameFull: 'Сцинтилляционный селективный радиометр альфа-активности на люминофоре ZnS(Ag)',
    category: 'scintillator',
    detectedRadiation: ['alpha'],
    detectorTypeRu: 'Сцинтилляционный экран из сернистого цинка, активированного серебром ZnS(Ag), со световодом и ФЭУ',
    gostStandard: 'ГОСТ 27451-87, ГОСТ 8.033-96',
    measurementRangeRu: '0.01 — 50 000 част/(мин·см²)',
    energyRangeRu: 'Альфа-частицы 3.5 — 9.0 МэВ',
    basicErrorPercent: 10,
    timeConstantSec: 1.2,
    sensitivityFactor: 12.0,
    audioStyle: 'scintillator_tone',
    hasSpectrometryMode: false,
    applicationRu: 'Селективное обнаружение альфа-загрязнения плутонием (Pu-239), ураном (U-238) и америцием (Am-241) на фоне мощных бета-гамма полей.',
    advantagesRu: [
      '100% нечувствительность к сопутствующему фону гамма- и бета-излучения до 50 мЗв/ч',
      'Нулевой собственный фон детектора (< 0.05 имп/мин)',
      'Высокая амплитуда импульсов от тяжелых альфа-частиц'
    ],
    limitationsRu: [
      'Полная непрозрачность для гамма- и бета-излучения (узкоспециализированный датчик)',
      'Требует строгого прижатия к поверхности на расстояние < 5 мм из-за пробега альфа в воздухе'
    ],
    model3dDetails: {
      color: '#1e1b4b',
      screenGlowColor: '#4ade80',
      probeType: 'scintillator_wand'
    }
  },

  ion: {
    id: 'ion',
    name: 'ДРГЗ-02 / Fluke 451P',
    nameFull: 'Прецизионный эталонный дозиметр на ионизационной камере высокого давления',
    category: 'ion_chamber',
    detectedRadiation: ['gamma'],
    detectorTypeRu: 'Герметичная вентилируемая ионизационная камера (объем 450 см³, заполнение аргоном под давлением)',
    gostStandard: 'ГОСТ 27451-87, МЭК 60846, ГОСТ 8.804-2012',
    measurementRangeRu: '0.1 мкЗв/ч — 500.0 мЗв/ч (пиковые поля до 50 Зв/ч)',
    energyRangeRu: '25 кэВ — 2.5 МэВ (ход с жесткостью менее ±5%)',
    basicErrorPercent: 7,
    timeConstantSec: 1.8,
    sensitivityFactor: 1.2,
    audioStyle: 'ion_buzzer',
    hasSpectrometryMode: false,
    applicationRu: 'Эталонная поверка, контроль пучков ускорителей, дефектоскопических гамма-аппаратов и импульсных полей.',
    advantagesRu: [
      'Идеальная линейность показаний во всем диапазоне без эффекта мертвого времени',
      'Минимальная погрешность энергетической зависимости (плоская кривая чувствительности)',
      'Достоверное измерение импульсного и рассеянного излучения'
    ],
    limitationsRu: [
      'Увеличенные габариты и масса измерительной камеры',
      'Необходимость введения поправки на плотность воздуха при разгерметизации'
    ],
    model3dDetails: {
      color: '#334155',
      screenGlowColor: '#0ea5e9',
      probeType: 'chamber_box'
    }
  },

  cdznte: {
    id: 'cdznte',
    name: 'RadSpect CZT-500 (Полупроводник)',
    nameFull: 'Комнатный полупроводниковый спектрометр на монокристалле CdZnTe (CZT)',
    category: 'semiconductor',
    detectedRadiation: ['gamma'],
    detectorTypeRu: 'Полупроводниковый планарный кристалл теллурида кадмия-цинка Cd(1-x)Zn(x)Te (10×10×5 мм) с микро-МКА',
    gostStandard: 'ГОСТ 27451-87, ГОСТ Р МЭК 61274',
    measurementRangeRu: '0.05 мкЗв/ч — 100.0 мЗв/ч',
    energyRangeRu: '15 кэВ — 1.5 МэВ (разрешение FWHM < 2.0% на 662 кэВ Cs-137)',
    basicErrorPercent: 8,
    timeConstantSec: 1.0,
    sensitivityFactor: 4.5,
    audioStyle: 'scintillator_tone',
    hasSpectrometryMode: true,
    applicationRu: 'Высокоточная спектрометрия радионуклидов без азотного охлаждения, идентификация неизвестных источников в полевых условиях.',
    advantagesRu: [
      'Энергетическое разрешение в 3-4 раза превосходит сцинтилляторы NaI(Tl)',
      'Четкое разделение близких пиков (например, дублет Co-60 1173 и 1332 кэВ)',
      'Компактные размеры детектора и отсутствие жидкого азота'
    ],
    limitationsRu: [
      'Ограниченная эффективность регистрации квантов высокой энергии (> 1.5 МэВ) из-за малого объема кристалла',
      'Высокая стоимость полупроводникового монокристалла'
    ],
    model3dDetails: {
      color: '#18181b',
      screenGlowColor: '#e11d48',
      probeType: 'czt_probe'
    }
  },

  pips: {
    id: 'pips',
    name: 'PIPS Alpha-Spec (Кремниевый PIPS)',
    nameFull: 'Полупроводниковый планарный кремниевый детектор с имплантированной структурой (PIPS)',
    category: 'semiconductor',
    detectedRadiation: ['alpha', 'beta'],
    detectorTypeRu: 'Кремниевый p-n переход планарного типа (площадь 450 мм², мертвое входное окно < 50 нм Si)',
    gostStandard: 'ГОСТ 27451-87, ГОСТ 8.033-96',
    measurementRangeRu: '0.005 — 50 000 Бк (спектрометрия альфа-пиков)',
    energyRangeRu: 'α: 1.0 — 10.0 МэВ (энергетическое разрешение FWHM < 18 кэВ)',
    basicErrorPercent: 5,
    timeConstantSec: 1.5,
    sensitivityFactor: 8.0,
    audioStyle: 'geiger_clicks',
    hasSpectrometryMode: true,
    applicationRu: 'Прецизионная альфа-спектрометрия проб: разделение изотопов урана (U-234/U-235/U-238) и плутония (Pu-238/Pu-239).',
    advantagesRu: [
      'Рекордное энергетическое разрешение для альфа-частиц (< 18 кэВ)',
      'Возможность точного спектрометрического разделения Pu-239 и Am-241',
      'Ультратонкое мертвое окно практически не искажает форму пика'
    ],
    limitationsRu: [
      'Для достижения паспортного разрешения требуется вакуумирование измерительной камеры (< 0.1 Торр)',
      'Светочувствителен (работает только в светонепроницаемом корпусе)'
    ],
    model3dDetails: {
      color: '#09090b',
      screenGlowColor: '#06b6d4',
      probeType: 'pips_chamber'
    }
  },

  neutron: {
    id: 'neutron',
    name: 'Berthold LB 6411 / УМФ-2000',
    nameFull: 'Нейтронный широкодиапазонный рем-метр эквивалента дозы H*(10)',
    category: 'neutron',
    detectedRadiation: ['neutron'],
    detectorTypeRu: 'Пропорциональный счетчик ³He / ¹⁰BF₃ в полиэтиленовом шаровом замедлителе Боннера Ø250 мм',
    gostStandard: 'ГОСТ 27451-87, ГОСТ Р МЭК 61005',
    measurementRangeRu: '0.1 мкЗв/ч — 100.0 мЗв/ч',
    energyRangeRu: 'Тепловые нейтроны (0.025 эВ) — быстрые нейтроны (20 МэВ)',
    basicErrorPercent: 20,
    timeConstantSec: 8.0,
    sensitivityFactor: 0.8,
    audioStyle: 'neutron_pulse',
    hasSpectrometryMode: false,
    applicationRu: 'Контроль биозащиты реакторов АЭС, хранилищ ОЯТ, каньонов ускорителей и источников нейтронов (Cf-252, Pu-Be).',
    advantagesRu: [
      'Корректное взвешивание дозы по кривой МКРЗ/ICRP 60 с учетом w_R нейтронов (от 5 до 20)',
      'Полная нечувствительность к сопутствующему гамма-фону до 10 Р/ч'
    ],
    limitationsRu: [
      'Значительная масса прибора (~9 кг из-за водородосодержащего замедлителя)',
      'Инерционность усреднения показаний при малых плотностях нейтронных потоков'
    ],
    model3dDetails: {
      color: '#3f3f46',
      screenGlowColor: '#f97316',
      probeType: 'bonner_sphere'
    }
  }
};

/**
 * Моделирование показаний детектора с учетом постоянной времени (инерционности),
 * чувствительности к типам излучения и статистического разброса Пуассона по ГОСТ 27451-87
 */
export function simulateDetectorReading(
  currentReading: number,
  targetDoseRate: number,
  instrument: InstrumentProfile,
  deltaTimeSec: number
): number {
  const alpha = 1.0 - Math.exp(-deltaTimeSec / Math.max(0.2, instrument.timeConstantSec));
  let smoothed = currentReading + (targetDoseRate - currentReading) * alpha;

  // Статистический шум Пуассона по ГОСТ 27451-87
  const relativeNoise = (instrument.basicErrorPercent / 100) * 0.35 * (Math.random() * 2 - 1);
  const fluctuating = Math.max(0, smoothed * (1 + relativeNoise));

  return fluctuating;
}

// ============================================================================
// АЛГОРИТМ СПЕКТРОМЕТРИИ И АВТОМАТИЧЕСКОЙ ИДЕНТИФИКАЦИИ ИЗОТОПОВ
// ============================================================================

export interface SpectrumPeak {
  energyKev: number;
  fwhmKev: number;
  netCounts: number;
  confidence: number;
  identifiedNuclide?: string;
}

export interface GammaSpectrumData {
  detectorId: InstrumentId;
  totalCounts: number;
  liveTimeSec: number;
  channels: number[]; // 512 каналов
  energyPerChannelKev: number;
  peaks: SpectrumPeak[];
  identifiedIsotopes: {
    isotopeId: string;
    confidencePercent: number;
    activityEstimateBq: number;
  }[];
}

/**
 * Паспортные фотопики изотопов для спектрометрической идентификации
 */
export const ISOTOPE_GAMMA_PEAKS: Record<string, { peaksKev: number[]; nameRu: string }> = {
  'Am-241': { peaksKev: [59.5], nameRu: 'Америций-241' },
  'Tc-99m': { peaksKev: [140.5], nameRu: 'Технеций-99m' },
  'Ir-192': { peaksKev: [296.0, 308.5, 316.5, 468.1], nameRu: 'Иридий-192' },
  'I-131': { peaksKev: [364.5], nameRu: 'Йод-131' },
  'F-18': { peaksKev: [511.0], nameRu: 'Фтор-18 (Аннигиляция)' },
  'Cs-137': { peaksKev: [661.7], nameRu: 'Цезий-137 / Барий-137m' },
  'Co-60': { peaksKev: [1173.2, 1332.5], nameRu: 'Кобальт-60' },
  'K-40': { peaksKev: [1460.8], nameRu: 'Калий-40' },
  'Ra-226': { peaksKev: [186.2, 351.9, 609.3, 1120.3], nameRu: 'Радий-226' },
  'Pu-239': { peaksKev: [51.6, 129.3, 375.0, 413.7], nameRu: 'Плутоний-239' },
  'Cf-252': { peaksKev: [43.4, 100.0, 2100.0], nameRu: 'Калифорний-252' }
};

/**
 * Синтезирует аппаратный спектр многоканального анализатора (МКА) на основе текущего изотопа
 */
export function generateSyntheticSpectrum(
  isotopeId: string,
  detectorId: InstrumentId,
  doseRateMicroSv: number,
  liveTimeSec: number = 10
): GammaSpectrumData {
  const channelCount = 512;
  const maxEnergyKev = detectorId === 'cdznte' ? 1600 : 2000;
  const energyPerChannel = maxEnergyKev / channelCount;
  const channels = new Array(channelCount).fill(0);

  const isoData = ISOTOPE_GAMMA_PEAKS[isotopeId] ?? ISOTOPE_GAMMA_PEAKS['Cs-137'];
  const resFactor = detectorId === 'cdznte' ? 0.022 : detectorId === 'pips' ? 0.015 : 0.075;

  let totalCounts = 0;
  const intensity = Math.max(50, Math.min(20000, doseRateMicroSv * 35));

  // Комптон-континуум и фоновый шум
  for (let ch = 0; ch < channelCount; ch++) {
    const e = ch * energyPerChannel;
    // Экспоненциальный спад комптоновского хвоста
    const compton = Math.exp(-e / 380) * (intensity * 0.18);
    const noise = Math.random() * Math.sqrt(Math.max(1, compton + 4));
    const chCounts = Math.round(compton + noise);
    channels[ch] = chCounts;
    totalCounts += chCounts;
  }

  // Генерация фотопиков полного поглощения с гауссовым распределением
  const peaks: SpectrumPeak[] = [];
  isoData.peaksKev.forEach(peakEnergy => {
    if (peakEnergy > maxEnergyKev) return;
    const centerCh = peakEnergy / energyPerChannel;
    const fwhmKev = peakEnergy * resFactor;
    const sigmaCh = (fwhmKev / 2.355) / energyPerChannel;
    const peakArea = intensity * 1.5;

    for (let ch = Math.max(0, Math.floor(centerCh - 4 * sigmaCh)); ch <= Math.min(channelCount - 1, Math.ceil(centerCh + 4 * sigmaCh)); ch++) {
      const g = (peakArea / (Math.sqrt(2 * Math.PI) * sigmaCh)) * Math.exp(-Math.pow(ch - centerCh, 2) / (2 * Math.pow(sigmaCh, 2)));
      const count = Math.round(g + (Math.random() - 0.5) * Math.sqrt(g));
      channels[ch] += count;
      totalCounts += count;
    }

    peaks.push({
      energyKev: peakEnergy,
      fwhmKev: Math.round(fwhmKev * 10) / 10,
      netCounts: Math.round(peakArea),
      confidence: 0.96,
      identifiedNuclide: isoData.nameRu
    });
  });

  return {
    detectorId,
    totalCounts,
    liveTimeSec,
    channels,
    energyPerChannelKev: energyPerChannel,
    peaks,
    identifiedIsotopes: [
      {
        isotopeId,
        confidencePercent: 96.8,
        activityEstimateBq: Math.round(doseRateMicroSv * 1.2e5)
      }
    ]
  };
}
