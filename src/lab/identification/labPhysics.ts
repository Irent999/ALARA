/**
 * Физическая модель отклика прибора + расчётные утилиты для студента и проверяющей системы.
 *
 * Допущения (учебные, намеренно простые и прозрачные):
 *  - источник точечный; γ — узкий пучок (без накопления), поэтому ослабление в свинце — чистая экспонента;
 *  - α-частицы: ступенчатая модель пробега R_α(воздух) = 0.31·E^1.5 см (4–8 МэВ), эквивалент по массовой толщине;
 *  - β: пробег и ослабление из gostPhysics.calculateBetaTransmission (R_max, μ_m = 17·E^-1.14);
 *  - тормозное излучение β в свинце не моделируется;
 *  - мёртвое время счётчика Гейгера — непродлеваемое-парализуемое: m = n·exp(−n·τ).
 */
import {
  ISOTOPE_DATABASE,
  calculateBetaTransmission,
  getLinearAttenuationCoefficient
} from '../../physics/gostPhysics';
import type {
  DetectorType,
  LabInstrumentConfig,
  LabSource,
  LoggedMeasurement,
  MeasurementConditions,
  MeasurementResult,
  MeasurementTruth,
  Screen
} from './labTypes';

export { ISOTOPE_DATABASE };

/* ---------------------------------------------------------------- RNG */

/** Детерминированный ГСЧ (mulberry32): одинаковый seed → одинаковая лабораторная. */
export class SeededRng {
  private s: number;
  constructor(seed: number) {
    this.s = seed >>> 0;
  }
  next(): number {
    this.s = (this.s + 0x6d2b79f5) >>> 0;
    let t = this.s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  uniform(a: number, b: number): number {
    return a + (b - a) * this.next();
  }
  logUniform(a: number, b: number): number {
    return Math.exp(this.uniform(Math.log(a), Math.log(b)));
  }
  gaussian(): number {
    const u = Math.max(1e-12, this.next());
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * this.next());
  }
  pick<T>(arr: readonly T[]): T {
    return arr[Math.floor(this.next() * arr.length) % arr.length];
  }
  /** Пуассон: Кнут для малых средних, нормальное приближение для больших. */
  poisson(mean: number): number {
    if (mean <= 0) return 0;
    if (mean > 30) return Math.max(0, Math.round(mean + Math.sqrt(mean) * this.gaussian()));
    const L = Math.exp(-mean);
    let k = 0;
    let p = 1;
    do {
      k++;
      p *= this.next();
    } while (p > L);
    return k - 1;
  }
}

/* ---------------------------------------------------------- константы */

export const AIR_DENSITY_G_CM3 = 0.001225;
export const NATURAL_BACKGROUND_USVH = 0.12;
export const MIN_GAMMA_DISTANCE_M = 0.05;
export const MIN_PARTICLE_DISTANCE_CM = 0.5;

/** Плотность, г/см³ (бумага — типовая 80 г/м² ⇒ лист 0.1 мм = 8 мг/см²). */
export const SCREEN_DENSITY_G_CM3: Record<Screen['material'], number> = {
  paper: 0.8,
  aluminium: 2.7,
  lead: 11.34
};

/** Массовый коэффициент ослабления γ в Al (NIST XCOM), см²/г — для Al и бумаги. */
const AL_MASS_ATT: Array<[number, number]> = [
  [0.06, 0.2778], [0.1, 0.1704], [0.15, 0.1378], [0.2, 0.1223], [0.3, 0.1042],
  [0.4, 0.0928], [0.5, 0.0845], [0.6, 0.078], [0.8, 0.0684], [1.0, 0.0615],
  [1.25, 0.055], [1.5, 0.0501], [2.0, 0.0432]
];

export function arealDensityGcm2(screen: Screen): number {
  return (SCREEN_DENSITY_G_CM3[screen.material] * Math.max(0, screen.thicknessMm)) / 10;
}

export function totalLeadMm(screens: Screen[]): number {
  return screens.filter(s => s.material === 'lead').reduce((a, s) => a + Math.max(0, s.thicknessMm), 0);
}

function massAttenuationAl(energyMeV: number): number {
  const e = Math.min(2.0, Math.max(0.06, energyMeV));
  for (let i = 0; i < AL_MASS_ATT.length - 1; i++) {
    const [e0, m0] = AL_MASS_ATT[i];
    const [e1, m1] = AL_MASS_ATT[i + 1];
    if (e >= e0 && e <= e1) {
      const t = Math.log(e / e0) / Math.log(e1 / e0);
      return Math.exp(Math.log(m0) * (1 - t) + Math.log(m1) * t);
    }
  }
  return AL_MASS_ATT[AL_MASS_ATT.length - 1][1];
}

/* -------------------------------------------------- элементарные модели */

/** Пробег α в воздухе, см. */
export function alphaRangeAirCm(energyMeV: number): number {
  return energyMeV >= 4 ? 0.31 * Math.pow(energyMeV, 1.5) : 0.56 * energyMeV;
}

/** Пропускание α по массовой толщине пути (воздух + экраны + окно). Плавный «край» 90–100 % пробега. */
export function alphaTransmission(energyMeV: number, pathArealGcm2: number): number {
  const range = alphaRangeAirCm(energyMeV) * AIR_DENSITY_G_CM3;
  if (pathArealGcm2 <= 0.9 * range) return 1;
  if (pathArealGcm2 >= range) return 0;
  const t = (pathArealGcm2 - 0.9 * range) / (0.1 * range);
  return 1 - t * t * (3 - 2 * t);
}

/** Телесный угол диска радиуса a на оси на расстоянии r, доля от 4π. */
export function solidAngleFraction(distanceCm: number, detectorAreaCm2: number): number {
  const a = Math.sqrt(detectorAreaCm2 / Math.PI);
  const r = Math.max(MIN_PARTICLE_DISTANCE_CM, distanceCm);
  return 0.5 * (1 - r / Math.sqrt(r * r + a * a));
}

/** Энергетический ход чувствительности к γ (перегрузка на мягком излучении). */
export function energyResponseFactor(type: DetectorType, energyMeV: number): number {
  switch (type) {
    case 'geiger_muller': return 1 + 2.5 * Math.exp(-energyMeV / 0.07);
    case 'scintillator': return 1 + 4.0 * Math.exp(-energyMeV / 0.1);
    default: return 1;
  }
}

/** Ослабление γ узким пучком в наборе экранов. */
export function gammaScreenTransmission(screens: Screen[], energyMeV: number): number {
  let exponent = 0;
  for (const s of screens) {
    if (s.thicknessMm <= 0) continue;
    if (s.material === 'lead') {
      exponent += getLinearAttenuationCoefficient('lead', energyMeV) * (s.thicknessMm / 10);
    } else {
      exponent += massAttenuationAl(energyMeV) * arealDensityGcm2(s); // бумага ≈ Al по массовой толщине
    }
  }
  return Math.exp(-exponent);
}

/* -------------------------------------------- расчёты для студента/проверки */

export const hvlMmFromMu = (muPerCm: number): number => (Math.LN2 / muPerCm) * 10;
export const muFromHvlMm = (hvlMm: number): number => Math.LN2 / (hvlMm / 10);

export function leadHvlMm(energyMeV: number): number {
  return hvlMmFromMu(getLinearAttenuationCoefficient('lead', energyMeV));
}

/**
 * Энергия γ по измеренному HVL в свинце (бисекция по монотонному участку μ(E), 0.14–2.1 МэВ).
 */
export function energyMeVFromLeadHvl(hvlMm: number): number {
  const target = muFromHvlMm(hvlMm);
  let lo = 0.14;
  let hi = 2.1;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (getLinearAttenuationCoefficient('lead', mid) > target) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}

/** |dlnμ/dlnE| в свинце — чувствительность E(HVL): чем она меньше, тем хуже энергия определяется по HVL. */
export function leadMuLogSlope(energyMeV: number): number {
  const e1 = energyMeV * 0.95;
  const e2 = energyMeV * 1.05;
  const m1 = getLinearAttenuationCoefficient('lead', e1);
  const m2 = getLinearAttenuationCoefficient('lead', e2);
  return Math.abs(Math.log(m2 / m1) / Math.log(e2 / e1));
}

/** Поправка на мёртвое время для парализуемой модели (нижняя ветвь): n = m·exp(n·τ). */
export function deadTimeCorrection(observedCps: number, tauSec: number): { trueCps: number; overload: boolean } {
  if (tauSec <= 0) return { trueCps: observedCps, overload: false };
  if (observedCps * tauSec * Math.E >= 1) return { trueCps: Infinity, overload: true };
  let n = observedCps;
  for (let i = 0; i < 80; i++) n = observedCps * Math.exp(n * tauSec);
  return { trueCps: n, overload: false };
}

export interface InverseSquareFit {
  /** Среднее H·r² — мощность дозы на 1 м, мкЗв/ч. */
  h1m: number;
  /** Относительный разброс (1σ среднего), отн. ед. */
  relScatter: number;
  /** Показатель степени в H ∝ r^p (для α≈ n/a; γ → ≈ −2). */
  exponent: number;
}

/** Подгонка закона 1/r² по точкам (расстояние м, мощность дозы мкЗв/ч). */
export function fitInverseSquare(points: Array<{ r: number; h: number }>): InverseSquareFit | null {
  const pts = points.filter(p => p.h > 0 && p.r > 0);
  if (pts.length < 2) return null;
  const vals = pts.map(p => p.h * p.r * p.r);
  const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
  const varr = vals.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, vals.length - 1);
  const lx = pts.map(p => Math.log(p.r));
  const ly = pts.map(p => Math.log(p.h));
  const mx = lx.reduce((a, b) => a + b, 0) / lx.length;
  const my = ly.reduce((a, b) => a + b, 0) / ly.length;
  let sxy = 0, sxx = 0;
  for (let i = 0; i < lx.length; i++) { sxy += (lx[i] - mx) * (ly[i] - my); sxx += (lx[i] - mx) ** 2; }
  return {
    h1m: mean,
    relScatter: Math.sqrt(varr / vals.length) / mean,
    exponent: sxx > 0 ? sxy / sxx : NaN
  };
}

/** Линейная регрессия ln(net) от толщины свинца → μ (см⁻¹), HVL (мм). */
export function fitLeadAttenuation(points: Array<{ xMm: number; net: number }>): { muPerCm: number; hvlMm: number } | null {
  const pts = points.filter(p => p.net > 0);
  if (pts.length < 3) return null;
  const xs = pts.map(p => p.xMm / 10);
  const ys = pts.map(p => Math.log(p.net));
  const mx = xs.reduce((a, b) => a + b, 0) / xs.length;
  const my = ys.reduce((a, b) => a + b, 0) / ys.length;
  let sxy = 0, sxx = 0;
  for (let i = 0; i < xs.length; i++) { sxy += (xs[i] - mx) * (ys[i] - my); sxx += (xs[i] - mx) ** 2; }
  if (sxx <= 0) return null;
  const mu = -sxy / sxx;
  return mu > 0 ? { muPerCm: mu, hvlMm: hvlMmFromMu(mu) } : null;
}

/* ------------------------------------------------------ модель отклика */

export interface RateBreakdown {
  gammaDoseRateUSvh: number;
  gammaCps: number;
  alphaCps: number;
  betaCps: number;
  backgroundCps: number;
  trueCps: number;
  observedCps: number;
  deadTimeLossFraction: number;
}

export class DetectorResponseModel {
  private counter = 0;

  constructor(
    public readonly instrument: LabInstrumentConfig,
    private readonly rng: SeededRng
  ) {}

  /** Детерминированные (ожидаемые) скорости счёта без статистических флуктуаций. */
  computeExpectedRates(source: LabSource | null, cond: MeasurementConditions): RateBreakdown {
    const inst = this.instrument;
    const k = inst.cpsPerUSvh;
    const active = source && cond.sourcePresent ? source : null;

    // --- γ-компонента: закон 1/r² + ослабление экранами + энергетический ход ---
    let gammaDose = 0;
    let gammaCps = 0;
    if (active && active.gammaConstant > 0) {
      const r = Math.max(MIN_GAMMA_DISTANCE_M, cond.distanceM);
      gammaDose = (active.gammaConstant * active.activityMBq) / (r * r);
      gammaDose *= gammaScreenTransmission(cond.screens, active.energyMeV);
      gammaCps = k * energyResponseFactor(inst.detectorType, active.energyMeV) * gammaDose;
    }

    // --- α/β-компоненты: геометрия × экраны × окно × эффективность ---
    let alphaCps = 0;
    let betaCps = 0;
    if (active && !active.sealed) {
      const distCm = Math.max(MIN_PARTICLE_DISTANCE_CM, cond.distanceM * 100);
      const omega = solidAngleFraction(distCm, inst.detectorAreaCm2);
      const activityBq = active.activityMBq * 1e6;
      const airG = distCm * AIR_DENSITY_G_CM3;
      const screensG = cond.screens.reduce((a, s) => a + arealDensityGcm2(s), 0);
      const windowG = inst.windowMgCm2 / 1000;
      const path = airG + screensG + windowG;
      for (const line of active.particleLines) {
        const t = line.cls === 'alpha'
          ? alphaTransmission(line.energyMeV, path)
          : calculateBetaTransmission(line.energyMeV, path);
        const rate = activityBq * line.yieldPerDecay * omega * t * inst.intrinsicEfficiency;
        if (line.cls === 'alpha') alphaCps += rate; else betaCps += rate;
      }
    }

    const backgroundCps = k * NATURAL_BACKGROUND_USVH + inst.intrinsicBackgroundCps;
    const trueCps = gammaCps + alphaCps + betaCps + backgroundCps;
    const tau = inst.deadTimeSec;
    const observedCps = tau > 0 ? trueCps * Math.exp(-trueCps * tau) : trueCps;
    return {
      gammaDoseRateUSvh: gammaDose,
      gammaCps, alphaCps, betaCps, backgroundCps, trueCps, observedCps,
      deadTimeLossFraction: trueCps > 0 ? 1 - observedCps / trueCps : 0
    };
  }

  /** Одно виртуальное измерение: статистика Пуассона, шум, единицы дисплея. */
  measure(source: LabSource | null, cond: MeasurementConditions): { result: MeasurementResult; truth: MeasurementTruth } {
    const inst = this.instrument;
    const T = Math.max(1, cond.durationSec);
    const exp = this.computeExpectedRates(source, cond);
    const id = ++this.counter;

    let counts: number | null = null;
    let rateCps: number;
    let relStat: number;
    if (inst.detectorType === 'ionization_chamber') {
      // Токовый режим: нет дискретных импульсов, шум ≈ 1.5 % + электроника.
      const sigmaAbs = 0.04 * inst.cpsPerUSvh / Math.sqrt(T);
      rateCps = Math.max(0, exp.observedCps * (1 + 0.015 * this.rng.gaussian()) + sigmaAbs * this.rng.gaussian());
      relStat = Math.hypot(0.015, sigmaAbs / Math.max(1e-9, exp.observedCps));
    } else {
      counts = this.rng.poisson(exp.observedCps * T);
      rateCps = counts / T;
      relStat = counts > 0 ? 1 / Math.sqrt(counts) : 1;
    }

    const result: MeasurementResult = {
      id, conditions: { ...cond, screens: cond.screens.map(s => ({ ...s })) },
      displayedValue: 0, displayUnit: inst.displayUnit, counts, relStatUncertainty: relStat
    };

    if (inst.displayUnit === 'uSv_h') result.displayedValue = rateCps / inst.cpsPerUSvh;
    else if (inst.displayUnit === 'cps') result.displayedValue = rateCps;
    else {
      // Спектрометр: основной показатель — энергия доминирующего пика; частота счёта — рядом.
      result.countRateCps = rateCps;
      const netGamma = exp.gammaCps * T;
      if (source && cond.sourcePresent && source.gammaPeaksKeV.length && netGamma >= 100) {
        const res = inst.resolutionAt662 ?? 0.075;
        const perPeak = netGamma / source.gammaPeaksKeV.length;
        result.peaksKeV = source.gammaPeaksKeV.map(e => {
          const fwhm = res * 662 * Math.sqrt(e / 662);
          return Math.round(e * (1 + 0.002 * this.rng.gaussian()) + (fwhm / 2.355 / Math.sqrt(perPeak)) * this.rng.gaussian());
        });
        const dominant = source.gammaPeaksKeV.indexOf(Math.max(...source.gammaPeaksKeV));
        result.displayedValue = result.peaksKeV[dominant];
      } else {
        result.displayedValue = NaN; // «недостаточно статистики / нет пиков»
      }
    }

    const truth: MeasurementTruth = {
      trueRateCps: exp.trueCps,
      observedMeanCps: exp.observedCps,
      deadTimeLossFraction: exp.deadTimeLossFraction,
      gammaDoseRateUSvh: exp.gammaDoseRateUSvh,
      backgroundDoseEquivUSvh: exp.backgroundCps / inst.cpsPerUSvh
    };
    return { result, truth };
  }
}

/** Чистая скорость счёта (за вычетом фоновых измерений) — вспомогательная функция анализа журнала. */
export function netRateFromLog(
  entry: LoggedMeasurement,
  background: LoggedMeasurement | undefined,
  inst: LabInstrumentConfig
): number {
  const toRate = (m: LoggedMeasurement) =>
    inst.displayUnit === 'uSv_h' ? m.result.displayedValue * inst.cpsPerUSvh
      : inst.displayUnit === 'cps' ? m.result.displayedValue
      : (m.result.countRateCps ?? 0);
  return Math.max(0, toRate(entry) - (background ? toRate(background) : 0));
}
