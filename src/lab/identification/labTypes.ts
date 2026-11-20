/**
 * Лабораторная работа «Идентификация прибора и источника» — общие типы.
 * Модуль не зависит от Three.js/React: чистая логика, тестируется в Node.
 */

export type LabRadiationClass = 'alpha' | 'beta' | 'gamma';
export type DetectorType = 'geiger_muller' | 'scintillator' | 'ionization_chamber';
export type DisplayUnit = 'uSv_h' | 'cps' | 'keV';
export type InstrumentRole = 'dosimeter' | 'radiometer' | 'spectrometer';
export type ScreenMaterial = 'paper' | 'aluminium' | 'lead';
export type Difficulty = 'easy' | 'medium' | 'hard';

export interface Screen {
  material: ScreenMaterial;
  thicknessMm: number;
}

/** Полное (скрытое от студента) описание прибора. */
export interface LabInstrumentConfig {
  presetId: string;
  nameRu: string;
  role: InstrumentRole;
  detectorType: DetectorType;
  /** Тонкое входное окно (слюда/майлар) — только оно пропускает α и мягкую β. */
  hasThinWindow: boolean;
  /** Поверхностная плотность входного окна/стенки, мг/см². */
  windowMgCm2: number;
  displayUnit: DisplayUnit;
  detectorAreaCm2: number;
  /** Чувствительность к γ (эталон Cs-137): имп/с на 1 мкЗв/ч. */
  cpsPerUSvh: number;
  /** Эффективность регистрации частицы, попавшей в окно (0..1). */
  intrinsicEfficiency: number;
  /** Мёртвое время, с (0 — не применимо). */
  deadTimeSec: number;
  /** Собственный фон прибора, имп/с. */
  intrinsicBackgroundCps: number;
  /** Основная относительная погрешность по паспорту, %. */
  basicErrorPercent: number;
  /** Разрешение на 662 кэВ (FWHM/E), только для спектрометра. */
  resolutionAt662?: number;
}

/** Что студент видит в паспорте/на корпусе (без типа детектора, окна и мёртвого времени). */
export interface PublicInstrumentView {
  nameRu: string;
  displayUnit: DisplayUnit;
  detectorAreaCm2: number;
  cpsPerUSvh: number;
  intrinsicEfficiency: number;
  basicErrorPercent: number;
}

export interface ParticleLine {
  cls: 'alpha' | 'beta';
  /** α: энергия частицы, β: граничная энергия E_max, МэВ. */
  energyMeV: number;
  yieldPerDecay: number;
}

/** Скрытая истина о источнике. */
export interface LabSource {
  presetId: string;
  isotopeId: string;
  nameRu: string;
  primaryClass: LabRadiationClass;
  activityMBq: number;
  /** Определяющая энергия: γ — эффективная, β — E_max самой жёсткой ветви, α — энергия, МэВ. */
  energyMeV: number;
  /** Гамма-постоянная, мкЗв·м²/(ч·МБк); 0 для чистых α/β-источников. */
  gammaConstant: number;
  particleLines: ParticleLine[];
  /** Фотопики спектра, кэВ (для спектрометра). */
  gammaPeaksKeV: number[];
  /** Источник запаян в капсулу: α/β наружу не выходят. */
  sealed: boolean;
}

export interface MeasurementConditions {
  distanceM: number;
  screens: Screen[];
  durationSec: number;
  sourcePresent: boolean;
}

/** То, что показывает прибор (попадает в журнал студента). */
export interface MeasurementResult {
  id: number;
  conditions: MeasurementConditions;
  displayedValue: number;
  displayUnit: DisplayUnit;
  /** Число импульсов за экспозицию (нет у ионизационной камеры). */
  counts: number | null;
  /** Статистическая неопределённость показания, отн. ед. (1σ). */
  relStatUncertainty: number;
  /** Для спектрометра: частота счёта и найденные пики. */
  countRateCps?: number;
  peaksKeV?: number[];
}

/** Скрытая «истина» измерения — используется только проверяющей системой. */
export interface MeasurementTruth {
  trueRateCps: number;
  observedMeanCps: number;
  deadTimeLossFraction: number;
  gammaDoseRateUSvh: number;
  backgroundDoseEquivUSvh: number;
}

export interface LoggedMeasurement {
  result: MeasurementResult;
  truth: MeasurementTruth;
}

export type TaskId = 'background' | 'screen_test' | 'distance_test' | 'lead_absorption';

export interface TaskProgress {
  id: TaskId;
  titleRu: string;
  done: boolean;
  hintRu: string;
}

export interface StudentAnswers {
  instrumentRole?: InstrumentRole;
  radiationClass?: LabRadiationClass;
  isotopeId?: string;
  /** Энергия γ (или β E_max / α E), кэВ. */
  energyKeV?: number;
  /** Слой половинного ослабления в свинце, мм. */
  hvlLeadMm?: number;
  activityMBq?: number;
  /** Мощность дозы на расстоянии 1 м, мкЗв/ч (для γ-источников). */
  doseRateAt1mUSvh?: number;
}

export type Grade = '5 (Отлично)' | '4 (Хорошо)' | '3 (Удовл.)' | '2 (Не зачтено)';

export interface ToleranceBudget {
  statisticalPercent: number;
  instrumentPercent: number;
  methodPercent: number;
  combinedPercent: number;
  coveragePercent: number;
}

export interface ReportItem {
  field: keyof StudentAnswers;
  titleRu: string;
  applicable: boolean;
  studentValue: number | string | null;
  referenceValue: number | string | null;
  unit: string;
  relativeErrorPercent: number | null;
  tolerance: ToleranceBudget | null;
  points: number;
  maxPoints: number;
  passed: boolean;
  grade: Grade | null;
  explanationRu: string;
  diagnosisRu: string[];
}

export interface LabReport {
  items: ReportItem[];
  score: number;
  maxScore: number;
  percent: number;
  grade: Grade;
  passed: boolean;
  warningsRu: string[];
  evidenceRu: string[];
  /** Раскрытие истины — показывать только после сдачи работы. */
  truthRevealed: {
    instrument: string;
    role: InstrumentRole;
    detectorType: DetectorType;
    hasThinWindow: boolean;
    source: string;
    primaryClass: LabRadiationClass;
    activityMBq: number;
  };
}
