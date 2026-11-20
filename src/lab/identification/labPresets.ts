/**
 * Каталог приборов и источников + генератор случайного «задания».
 * Гамма-источники берут Γ и энергию из ISOTOPE_DATABASE (единый источник правды с остальным симулятором).
 */
import { ISOTOPE_DATABASE } from '../../physics/gostPhysics';
import { ISOTOPE_GAMMA_PEAKS } from '../../instruments/gostInstruments';
import type { Difficulty, LabInstrumentConfig, LabSource } from './labTypes';
import { SeededRng } from './labPhysics';

export const INSTRUMENT_PRESETS: Record<string, LabInstrumentConfig> = {
  dosimeter_gm: {
    presetId: 'dosimeter_gm', nameRu: 'Дозиметр ДКС-«Гамма»', role: 'dosimeter',
    detectorType: 'geiger_muller', hasThinWindow: false, windowMgCm2: 400,
    displayUnit: 'uSv_h', detectorAreaCm2: 8, cpsPerUSvh: 4.0, intrinsicEfficiency: 0.5,
    deadTimeSec: 150e-6, intrinsicBackgroundCps: 0.05, basicErrorPercent: 15
  },
  dosimeter_ic: {
    presetId: 'dosimeter_ic', nameRu: 'Дозиметр-ИК «Камера-1»', role: 'dosimeter',
    detectorType: 'ionization_chamber', hasThinWindow: false, windowMgCm2: 300,
    displayUnit: 'uSv_h', detectorAreaCm2: 30, cpsPerUSvh: 0.8, intrinsicEfficiency: 0.3,
    deadTimeSec: 0, intrinsicBackgroundCps: 0, basicErrorPercent: 10
  },
  radiometer_pancake: {
    presetId: 'radiometer_pancake', nameRu: 'Радиометр загрязнённости «Блин-2»', role: 'radiometer',
    detectorType: 'geiger_muller', hasThinWindow: true, windowMgCm2: 2,
    displayUnit: 'cps', detectorAreaCm2: 15.5, cpsPerUSvh: 2.0, intrinsicEfficiency: 0.45,
    deadTimeSec: 100e-6, intrinsicBackgroundCps: 0.4, basicErrorPercent: 20
  },
  radiometer_zns: {
    presetId: 'radiometer_zns', nameRu: 'Альфа-радиометр ZnS(Ag)', role: 'radiometer',
    detectorType: 'scintillator', hasThinWindow: true, windowMgCm2: 3,
    displayUnit: 'cps', detectorAreaCm2: 100, cpsPerUSvh: 0.3, intrinsicEfficiency: 0.6,
    deadTimeSec: 3e-6, intrinsicBackgroundCps: 0.02, basicErrorPercent: 20
  },
  spectrometer_nai: {
    presetId: 'spectrometer_nai', nameRu: 'Спектрометр NaI(Tl) «Гамма-Спектр»', role: 'spectrometer',
    detectorType: 'scintillator', hasThinWindow: false, windowMgCm2: 135,
    displayUnit: 'keV', detectorAreaCm2: 20, cpsPerUSvh: 40, intrinsicEfficiency: 0.7,
    deadTimeSec: 3e-6, intrinsicBackgroundCps: 0.5, basicErrorPercent: 10, resolutionAt662: 0.075
  }
};

const gammaSource = (isotopeId: string, nameRu: string): Omit<LabSource, 'activityMBq'> => {
  const iso = ISOTOPE_DATABASE[isotopeId];
  return {
    presetId: isotopeId, isotopeId, nameRu, primaryClass: 'gamma',
    energyMeV: iso.energyMev, gammaConstant: iso.gammaConstant, particleLines: [],
    gammaPeaksKeV: ISOTOPE_GAMMA_PEAKS[isotopeId]?.peaksKev ?? [iso.energyMev * 1000],
    sealed: true // γ-эталоны запаяны в капсулу, β/α наружу не выходят
  };
};

/**
 * Источники: диапазон активности (МБк) подобран под рабочие дистанции.
 * γ-эталоны — 5–200 см; α/β-пластины (0.5–10 кБк) — вплотную (≈ 1–5 см), иначе радиометр насыщается/не видит α.
 */
export const SOURCE_PRESETS: Record<string, { base: Omit<LabSource, 'activityMBq'>; activityRangeMBq: [number, number] }> = {
  'Cs-137': { base: gammaSource('Cs-137', 'Цезий-137'), activityRangeMBq: [20, 400] },
  'Co-60': { base: gammaSource('Co-60', 'Кобальт-60'), activityRangeMBq: [10, 200] },
  'Ir-192': { base: gammaSource('Ir-192', 'Иридий-192'), activityRangeMBq: [10, 300] },
  'Sr-90': {
    base: {
      presetId: 'Sr-90', isotopeId: 'Sr-90', nameRu: 'Стронций-90/Иттрий-90', primaryClass: 'beta',
      energyMeV: 2.28, gammaConstant: 0, gammaPeaksKeV: [], sealed: false,
      particleLines: [{ cls: 'beta', energyMeV: 0.546, yieldPerDecay: 1 }, { cls: 'beta', energyMeV: 2.28, yieldPerDecay: 1 }]
    },
    activityRangeMBq: [0.0005, 0.01]
  },
  'C-14': {
    base: {
      presetId: 'C-14', isotopeId: 'C-14', nameRu: 'Углерод-14 (мягкий β)', primaryClass: 'beta',
      energyMeV: 0.156, gammaConstant: 0, gammaPeaksKeV: [], sealed: false,
      particleLines: [{ cls: 'beta', energyMeV: 0.156, yieldPerDecay: 1 }]
    },
    activityRangeMBq: [0.0005, 0.01]
  },
  'Pu-239': {
    base: {
      presetId: 'Pu-239', isotopeId: 'Pu-239', nameRu: 'Плутоний-239 (α)', primaryClass: 'alpha',
      energyMeV: 5.157, gammaConstant: 0, gammaPeaksKeV: [], sealed: false,
      particleLines: [{ cls: 'alpha', energyMeV: 5.157, yieldPerDecay: 1 }]
    },
    activityRangeMBq: [0.0005, 0.01]
  },
  'Am-241': {
    base: {
      presetId: 'Am-241', isotopeId: 'Am-241', nameRu: 'Америций-241 (α)', primaryClass: 'alpha',
      energyMeV: 5.486, gammaConstant: 0, gammaPeaksKeV: [], sealed: false,
      particleLines: [{ cls: 'alpha', energyMeV: 5.486, yieldPerDecay: 1 }]
    },
    activityRangeMBq: [0.0005, 0.01]
  }
};

const POOLS: Record<Difficulty, { instruments: string[]; sources: string[] }> = {
  easy: { instruments: ['dosimeter_gm', 'radiometer_pancake', 'spectrometer_nai'], sources: ['Cs-137', 'Pu-239', 'Sr-90'] },
  medium: { instruments: ['dosimeter_gm', 'dosimeter_ic', 'radiometer_pancake', 'spectrometer_nai'], sources: ['Cs-137', 'Co-60', 'Ir-192', 'Sr-90', 'Am-241'] },
  hard: {
    instruments: Object.keys(INSTRUMENT_PRESETS),
    sources: Object.keys(SOURCE_PRESETS)
  }
};

export function generateLabAssignment(
  seed: number,
  difficulty: Difficulty,
  forced?: { instrumentId?: string; sourceId?: string; activityMBq?: number }
): { instrument: LabInstrumentConfig; source: LabSource } {
  const rng = new SeededRng(seed);
  const instrumentId = forced?.instrumentId ?? rng.pick(POOLS[difficulty].instruments);
  const sourceId = forced?.sourceId ?? rng.pick(POOLS[difficulty].sources);
  const preset = SOURCE_PRESETS[sourceId];
  const [lo, hi] = preset.activityRangeMBq;
  // Округляем до 2 значащих цифр: «красивая» активность проще сравнивать в отчёте.
  const raw = forced?.activityMBq ?? rng.logUniform(lo, hi);
  const exp = Math.floor(Math.log10(raw));
  const activityMBq = Math.round(raw / 10 ** (exp - 1)) * 10 ** (exp - 1);
  return {
    instrument: { ...INSTRUMENT_PRESETS[instrumentId] },
    source: { ...preset.base, particleLines: preset.base.particleLines.map(l => ({ ...l })), activityMBq }
  };
}
