/**
 * Проверка ответов студента: сравнение с истиной, бюджет допуска (статистика + прибор + метод),
 * диагностика типичных ошибок и анализ экспериментальных данных из журнала студента.
 */
import { ISOTOPE_DATABASE } from '../../physics/gostPhysics';
import type {
  Grade, LabInstrumentConfig, LabReport, LabSource, LoggedMeasurement, ReportItem,
  StudentAnswers, TaskProgress, ToleranceBudget
} from './labTypes';
import {
  energyResponseFactor, leadHvlMm, leadMuLogSlope, netRateFromLog
} from './labPhysics';

export interface GradingContext {
  instrument: LabInstrumentConfig;
  source: LabSource;
  log: LoggedMeasurement[];
  tasks: TaskProgress[];
}

const COVERAGE_K = 2;            // коэффициент охвата допуска
const MIN_TOLERANCE_PERCENT = 5; // пол допуска
const DISTANCE_METHOD_PERCENT = 4;   // 2 % на расстояние × квадрат
const HVL_METHOD_PERCENT = 8;        // регрессия по 3–5 слоям, узкий пучок
const PARTICLE_METHOD_PERCENT = 15;  // геометрия/эффективность для α/β

const MAX_POINTS: Record<keyof StudentAnswers, number> = {
  instrumentRole: 15, radiationClass: 20, isotopeId: 5, energyKeV: 15,
  hvlLeadMm: 10, activityMBq: 20, doseRateAt1mUSvh: 15
};

const ROLE_RU = { dosimeter: 'дозиметр', radiometer: 'радиометр', spectrometer: 'спектрометр' } as const;
const CLASS_RU = { alpha: 'α-излучение', beta: 'β-излучение', gamma: 'γ-излучение' } as const;

/* ------------------------------------------------ анализ журнала студента */

function backgroundOf(log: LoggedMeasurement[]): LoggedMeasurement | undefined {
  const bg = log.filter(m => !m.result.conditions.sourcePresent);
  return bg[bg.length - 1];
}

function sameDistance(a: number, b: number): boolean {
  return Math.abs(a - b) / Math.max(a, b) < 0.02;
}

export interface ScreenTestAnalysis {
  performed: boolean;
  inferredClass: 'alpha' | 'beta' | 'gamma' | 'unknown';
  ratios: { paper?: number; aluminium?: number };
  evidenceRu: string[];
}

/** Что следует из опыта с экранами, если судить ТОЛЬКО по данным, которые студент реально набрал. */
export function analyseScreenTest(log: LoggedMeasurement[], inst: LabInstrumentConfig): ScreenTestAnalysis {
  const bg = backgroundOf(log);
  const src = log.filter(m => m.result.conditions.sourcePresent);
  const only = (m: LoggedMeasurement, mat: string) =>
    m.result.conditions.screens.length > 0 && m.result.conditions.screens.every(s => s.material === mat && s.thicknessMm > 0);
  const opens = [...src].reverse().filter(m => m.result.conditions.screens.every(s => s.thicknessMm <= 0));
  if (!opens.length) return { performed: false, inferredClass: 'unknown', ratios: {}, evidenceRu: ['Нет измерения без экрана.'] };
  const pickAt = (mat: string, d: number) => [...src].reverse().find(m => only(m, mat) && sameDistance(m.result.conditions.distanceM, d));
  const sigma = (m: LoggedMeasurement) => Math.sqrt(Math.max(1, m.result.counts ?? 100)) / m.result.conditions.durationSec;

  // Берём самую свежую «тройку» (без экрана / бумага / алюминий) на одном расстоянии.
  const open = opens.find(o => pickAt('paper', o.result.conditions.distanceM) && pickAt('aluminium', o.result.conditions.distanceM));
  if (!open) {
    return { performed: false, inferredClass: 'unknown', ratios: {}, evidenceRu: ['Для вывода нужны измерения без экрана, с бумагой и с алюминием на ОДНОМ расстоянии.'] };
  }
  const d = open.result.conditions.distanceM;
  const paper = pickAt('paper', d)!;
  const al = pickAt('aluminium', d)!;
  const nOpen = netRateFromLog(open, bg, inst);
  const evidence: string[] = [];
  if (nOpen < 3 * sigma(open)) {
    return { performed: false, inferredClass: 'unknown', ratios: {}, evidenceRu: [`На ${(d * 100).toFixed(0)} см сигнал без экрана не отличим от фона — подойдите ближе или увеличьте время.`] };
  }
  const ratios: ScreenTestAnalysis['ratios'] = {};
  ratios.paper = netRateFromLog(paper, bg, inst) / nOpen;
  evidence.push(`Бумага: отклик ${(ratios.paper * 100).toFixed(1)} % от исходного.`);
  ratios.aluminium = netRateFromLog(al, bg, inst) / nOpen;
  evidence.push(`Алюминий: отклик ${(ratios.aluminium * 100).toFixed(1)} % от исходного.`);
  let cls: ScreenTestAnalysis['inferredClass'];
  if (ratios.paper! < 0.05) {
    cls = 'alpha';
    evidence.push('Бумага гасит отклик → излучение не проникает даже через лист ⇒ α-частицы (пробег в воздухе несколько см).');
    evidence.push('Прибор регистрирует α ⇒ у него есть тонкое входное окно ⇒ поверхностный радиометр.');
  } else if (ratios.aluminium! < 0.05) {
    cls = 'beta';
    evidence.push('Бумага не мешает, но 1 мм Al гасит отклик ⇒ мягкая β. Прибор с тонким окном ⇒ радиометр.');
  } else if (ratios.aluminium! < 0.7) {
    cls = 'beta';
    evidence.push('Алюминий ослабляет заметно, но не до нуля ⇒ жёсткая β (ослабление экспоненциальное, есть пробег).');
  } else {
    cls = 'gamma';
    evidence.push('Лёгкие экраны почти не влияют (< 30 %) ⇒ проникающее γ-излучение; далее — свинец и 1/r².');
  }
  return { performed: true, inferredClass: cls, ratios, evidenceRu: evidence };
}

/* ----------------------------------------------------- бюджет допуска */

function minRelStat(log: LoggedMeasurement[], filter: (m: LoggedMeasurement) => boolean): number | null {
  const v = log.filter(filter).map(m => m.result.relStatUncertainty);
  return v.length ? Math.min(...v) : null;
}

function buildBudget(statRel: number | null, instrumentPct: number, methodPct: number): ToleranceBudget {
  const statisticalPercent = (statRel ?? 0.05) * 100;
  const combinedPercent = Math.hypot(statisticalPercent, instrumentPct, methodPct);
  return {
    statisticalPercent, instrumentPercent: instrumentPct, methodPercent: methodPct, combinedPercent,
    coveragePercent: Math.max(MIN_TOLERANCE_PERCENT, COVERAGE_K * combinedPercent)
  };
}

function gradeFromRatio(errPct: number, tolPct: number): { grade: Grade; factor: number } {
  const x = errPct / tolPct;
  if (x <= 0.5) return { grade: '5 (Отлично)', factor: 1 };
  if (x <= 1.0) return { grade: '4 (Хорошо)', factor: 0.8 };
  if (x <= 1.5) return { grade: '3 (Удовл.)', factor: 0.5 };
  return { grade: '2 (Не зачтено)', factor: 0 };
}

/* ----------------------------------------------- диагностика ошибок */

function diagnose(student: number, truth: number, opts: {
  distanceM?: number; deadTimeLoss?: number; kind: 'activity' | 'dose' | 'hvl' | 'energy';
}): string[] {
  const out: string[] = [];
  if (!(student > 0) || !(truth > 0)) return out;
  const ratio = student / truth;
  const near = (x: number, target: number, tol = 0.12) => Math.abs(x / target - 1) < tol;
  if (near(ratio, 1e3) || near(ratio, 1e-3)) out.push('Расхождение ≈ в 1000 раз: проверьте приставки (мкЗв ↔ мЗв, кБк ↔ МБк).');
  if (near(ratio, 1e6) || near(ratio, 1e-6)) out.push('Расхождение ≈ в 10⁶ раз: перепутаны Бк и МБк.');
  if (near(ratio, 3600) || near(ratio, 1 / 3600)) out.push('Расхождение ≈ в 3600 раз: смешаны секунды и часы.');
  const r = opts.distanceM;
  if (r && Math.abs(r - 1) > 0.05) {
    if (near(ratio, r * r)) out.push(`Ответ завышен в r² = ${(r * r).toFixed(2)} раз: нужно приводить к 1 м (H₁ₘ = H·r²), а вы, вероятно, взяли показание на ${r} м.`);
    if (near(ratio, 1 / (r * r))) out.push(`Ответ занижен в r² = ${(r * r).toFixed(2)} раз: закон 1/r² применён в обратную сторону.`);
    if (near(ratio, r) || near(ratio, 1 / r)) out.push('Расстояние учтено в первой степени вместо квадрата (I ∝ 1/r², а не 1/r).');
  }
  if (opts.kind === 'hvl' || opts.kind === 'energy') {
    if (near(ratio, Math.LN2) || near(ratio, 1 / Math.LN2)) out.push('Расхождение ≈ в ln 2: перепутаны μ и HVL (HVL = ln 2 / μ).');
  }
  if (opts.deadTimeLoss && opts.deadTimeLoss > 0.03 && near(ratio, 1 - opts.deadTimeLoss, 0.08)) {
    out.push(`Не учтена поправка на мёртвое время: счётчик терял ≈ ${(opts.deadTimeLoss * 100).toFixed(0)} % импульсов (n = m·e^{nτ}).`);
  }
  if (!out.length && near(ratio, 2, 0.1)) out.push('Расхождение ≈ в 2 раза: проверьте диаметр/радиус и коэффициент геометрии.');
  if (!out.length && near(ratio, 0.5, 0.1)) out.push('Расхождение ≈ в 2 раза (занижено): проверьте коэффициент геометрии/эффективность.');
  return out.map(h => 'Возможная причина: ' + h);
}

/* ---------------------------------------------------------------- отчёт */

function emptyItem(field: keyof StudentAnswers, titleRu: string, unit: string, applicable: boolean): ReportItem {
  return {
    field, titleRu, applicable, studentValue: null, referenceValue: null, unit,
    relativeErrorPercent: null, tolerance: null, points: 0,
    maxPoints: applicable ? MAX_POINTS[field] : 0, passed: false, grade: null,
    explanationRu: '', diagnosisRu: []
  };
}

function categorical(
  field: keyof StudentAnswers, titleRu: string, student: string | undefined, truth: string,
  fmt: (v: string) => string, explainTruth: string
): ReportItem {
  const it = emptyItem(field, titleRu, '', true);
  it.studentValue = student ? fmt(student) : null;
  it.referenceValue = fmt(truth);
  if (!student) { it.explanationRu = 'Ответ не введён.'; return it; }
  it.passed = student === truth;
  it.points = it.passed ? it.maxPoints : 0;
  it.grade = it.passed ? '5 (Отлично)' : '2 (Не зачтено)';
  it.explanationRu = it.passed ? `Верно. ${explainTruth}` : `Неверно. Правильно: ${fmt(truth)}. ${explainTruth}`;
  return it;
}

function numeric(
  field: keyof StudentAnswers, titleRu: string, unit: string, student: number | undefined, truth: number,
  budget: ToleranceBudget, explainOk: string, hints: string[]
): ReportItem {
  const it = emptyItem(field, titleRu, unit, true);
  it.referenceValue = truth;
  it.tolerance = budget;
  if (student === undefined || !Number.isFinite(student)) { it.explanationRu = 'Ответ не введён.'; return it; }
  it.studentValue = student;
  const err = (Math.abs(student - truth) / truth) * 100;
  it.relativeErrorPercent = err;
  const g = gradeFromRatio(err, budget.coveragePercent);
  it.grade = g.grade;
  it.points = Math.round(it.maxPoints * g.factor * 100) / 100;
  it.passed = err <= budget.coveragePercent;
  it.diagnosisRu = it.passed ? [] : hints;
  it.explanationRu = it.passed
    ? `${explainOk} Отклонение ${err.toFixed(1)} % при допуске ±${budget.coveragePercent.toFixed(1)} % ` +
      `(статистика ${budget.statisticalPercent.toFixed(1)} %, прибор ${budget.instrumentPercent.toFixed(1)} %, метод ${budget.methodPercent.toFixed(1)} %, k=${COVERAGE_K}).`
    : `Отклонение ${err.toFixed(1)} % превышает допуск ±${budget.coveragePercent.toFixed(1)} %.` +
      (hints.length ? '' : ' Типовая ошибка не найдена — перепроверьте вычитание фона и расчётную формулу.');
  return it;
}

export function gradeSubmission(ans: StudentAnswers, ctx: GradingContext): LabReport {
  const { instrument: inst, source: src, log, tasks } = ctx;
  const isGamma = src.primaryClass === 'gamma';
  const bg = backgroundOf(log);
  const open = log.filter(m => m.result.conditions.sourcePresent && m.result.conditions.screens.every(s => s.thicknessMm <= 0));
  const leadSeries = log.filter(m => m.result.conditions.sourcePresent
    && m.result.conditions.screens.every(s => s.material === 'lead'));

  const statOpen = minRelStat(log, m => open.includes(m));
  const statLead = leadSeries.length ? leadSeries.reduce((a, m) => a + m.result.relStatUncertainty, 0) / leadSeries.length : null;
  const instPct = Math.hypot(
    inst.basicErrorPercent / 2,
    // энергетический ход чувствительности имеет смысл только для γ-источников
    isGamma ? Math.abs(energyResponseFactor(inst.detectorType, src.energyMeV) - 1) * 100 : 0
  );

  const items: ReportItem[] = [];
  const screen = analyseScreenTest(log, inst);
  const evidence = [...screen.evidenceRu];

  // 1. Тип прибора
  const roleExplain = {
    dosimeter: 'Единицы мкЗв/ч и отсутствие тонкого окна — измеритель мощности дозы γ.',
    radiometer: 'Показания в имп/с и тонкое входное окно — счётчик частиц, поверхностный радиометр (α/β).',
    spectrometer: 'Дисплей в кэВ, видны фотопики — спектрометр.'
  }[inst.role];
  items.push(categorical('instrumentRole', 'Тип прибора', ans.instrumentRole, inst.role, v => ROLE_RU[v as keyof typeof ROLE_RU], roleExplain));

  // 2. Вид излучения
  const classExplain = screen.performed
    ? `Согласуется с вашим опытом с экранами (вывод по данным: ${screen.inferredClass}).`
    : 'Для надёжного вывода выполните опыт с бумагой и алюминием на одном расстоянии.';
  items.push(categorical('radiationClass', 'Вид излучения источника', ans.radiationClass, src.primaryClass, v => CLASS_RU[v as keyof typeof CLASS_RU], classExplain));

  // 3. Изотоп
  items.push(categorical('isotopeId', 'Радионуклид', ans.isotopeId, src.isotopeId, v => ISOTOPE_DATABASE[v]?.nameRu ?? v,
    'Определяется по энергии γ-линий (спектрометр) либо по HVL в свинце и Γ.'));

  // 4. Энергия (только γ)
  const energy = emptyItem('energyKeV', 'Энергия γ-квантов', 'кэВ', isGamma);
  if (isGamma) {
    const accepted = [src.energyMeV * 1000, ...src.gammaPeaksKeV];
    const slope = Math.max(0.3, leadMuLogSlope(src.energyMeV));
    const budget = inst.role === 'spectrometer'
      ? buildBudget(0.01, 1, 3)
      : (() => {
          const hvl = buildBudget(statLead, 0, HVL_METHOD_PERCENT);
          const pct = Math.min(40, hvl.coveragePercent / slope);
          return { ...hvl, methodPercent: HVL_METHOD_PERCENT / slope, combinedPercent: pct / COVERAGE_K, coveragePercent: Math.max(MIN_TOLERANCE_PERCENT, pct) };
        })();
    const student = ans.energyKeV;
    const best = student !== undefined && Number.isFinite(student)
      ? accepted.reduce((b, e) => Math.abs(e - student) < Math.abs(b - student) ? e : b, accepted[0]) : accepted[0];
    const it = numeric('energyKeV', 'Энергия γ-квантов', 'кэВ', student, best, budget,
      'Энергия определена верно.', diagnose(student ?? 0, best, { kind: 'energy' }));
    it.explanationRu += inst.role === 'spectrometer' ? '' : ` Энергия по HVL определяется неточно: μ(E) в свинце меняется медленно (наклон ${slope.toFixed(2)}), поэтому допуск шире.`;
    items.push(it);
  } else items.push(energy);

  // 5. HVL в свинце (только γ)
  const hvlItem = emptyItem('hvlLeadMm', 'Слой половинного ослабления в Pb', 'мм', isGamma);
  if (isGamma) {
    const truthHvl = leadHvlMm(src.energyMeV);
    items.push(numeric('hvlLeadMm', 'Слой половинного ослабления в Pb', 'мм', ans.hvlLeadMm, truthHvl,
      buildBudget(statLead, 0, HVL_METHOD_PERCENT), 'HVL определён верно.',
      diagnose(ans.hvlLeadMm ?? 0, truthHvl, { kind: 'hvl' })));
  } else items.push(hvlItem);

  // 6. Активность
  const activityBudget = isGamma
    ? buildBudget(statOpen, instPct, DISTANCE_METHOD_PERCENT)
    : buildBudget(statOpen, instPct, PARTICLE_METHOD_PERCENT);
  const refDistance = open.length ? open[open.length - 1].result.conditions.distanceM : undefined;
  const worstLoss = Math.max(0, ...log.map(m => m.truth.deadTimeLossFraction));
  items.push(numeric('activityMBq', 'Активность источника A', 'МБк', ans.activityMBq, src.activityMBq, activityBudget,
    'Активность найдена верно.',
    diagnose(ans.activityMBq ?? 0, src.activityMBq, { kind: 'activity', distanceM: refDistance, deadTimeLoss: worstLoss })));

  // 7. Мощность дозы на 1 м (только γ)
  const doseItem = emptyItem('doseRateAt1mUSvh', 'Мощность дозы на 1 м', 'мкЗв/ч', isGamma);
  if (isGamma) {
    const truthDose = src.gammaConstant * src.activityMBq;
    items.push(numeric('doseRateAt1mUSvh', 'Мощность дозы на 1 м', 'мкЗв/ч', ans.doseRateAt1mUSvh, truthDose,
      buildBudget(statOpen, instPct, DISTANCE_METHOD_PERCENT), 'Мощность дозы на 1 м найдена верно.',
      diagnose(ans.doseRateAt1mUSvh ?? 0, truthDose, { kind: 'dose', distanceM: refDistance, deadTimeLoss: worstLoss })));
  } else items.push(doseItem);

  // Итог
  const applicable = items.filter(i => i.applicable);
  const maxScore = applicable.reduce((a, i) => a + i.maxPoints, 0);
  const score = Math.round(applicable.reduce((a, i) => a + i.points, 0) * 100) / 100;
  const percent = maxScore > 0 ? (score / maxScore) * 100 : 0;
  const grade: Grade = percent >= 90 ? '5 (Отлично)' : percent >= 75 ? '4 (Хорошо)' : percent >= 60 ? '3 (Удовл.)' : '2 (Не зачтено)';

  const warningsRu: string[] = [];
  for (const t of tasks) if (!t.done) warningsRu.push(`Не выполнено задание «${t.titleRu}»: ${t.hintRu}`);
  if (screen.performed && ans.radiationClass && screen.inferredClass !== 'unknown' && screen.inferredClass !== ans.radiationClass) {
    warningsRu.push('Ваш ответ о виде излучения противоречит вашим же измерениям с экранами.');
  }
  if (worstLoss > 0.1) {
    warningsRu.push(`В журнале есть измерения с потерей счёта на мёртвое время до ${(worstLoss * 100).toFixed(0)} % — такие точки нужно корректировать или отбрасывать.`);
  }

  return {
    items, score, maxScore, percent, grade, passed: percent >= 60, warningsRu, evidenceRu: evidence,
    truthRevealed: {
      instrument: inst.nameRu, role: inst.role, detectorType: inst.detectorType, hasThinWindow: inst.hasThinWindow,
      source: src.nameRu, primaryClass: src.primaryClass, activityMBq: src.activityMBq
    }
  };
}
