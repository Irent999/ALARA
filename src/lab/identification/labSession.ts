/**
 * Сессия лабораторной работы: хранит скрытую истину, состояние стенда, журнал студента,
 * прогресс заданий и выдаёт итоговый отчёт. Ни одно скрытое поле наружу не отдаётся до submit().
 */
import type {
  Difficulty, LabInstrumentConfig, LabReport, LabSource, LoggedMeasurement, MeasurementConditions,
  MeasurementResult, PublicInstrumentView, Screen, StudentAnswers, TaskProgress
} from './labTypes';
import { DetectorResponseModel, SeededRng } from './labPhysics';
import { generateLabAssignment } from './labPresets';
import { gradeSubmission } from './labGrader';

export interface LabSessionOptions {
  seed?: number;
  difficulty?: Difficulty;
  /** Для тестов/преподавателя: зафиксировать прибор/источник/активность. */
  force?: { instrumentId?: string; sourceId?: string; activityMBq?: number };
  onMeasurement?: (result: MeasurementResult) => void;
}

const sameDist = (a: number, b: number) => Math.abs(a - b) / Math.max(a, b, 1e-9) < 0.02;

export class IdentificationLabSession {
  private readonly instrument: LabInstrumentConfig;
  private readonly source: LabSource;
  private readonly model: DetectorResponseModel;
  private readonly log: LoggedMeasurement[] = [];
  private cond: MeasurementConditions = { distanceM: 0.5, screens: [], durationSec: 30, sourcePresent: true };
  private submitted: LabReport | null = null;
  private windowInspected: boolean | null = null;
  private readonly onMeasurement?: (r: MeasurementResult) => void;

  readonly seed: number;

  constructor(opts: LabSessionOptions = {}) {
    this.seed = opts.seed ?? Math.floor(Math.random() * 2 ** 31);
    const a = generateLabAssignment(this.seed, opts.difficulty ?? 'medium', opts.force);
    this.instrument = a.instrument;
    this.source = a.source;
    // Отдельный поток ГСЧ для шума измерений, чтобы он не зависел от генерации задания.
    this.model = new DetectorResponseModel(this.instrument, new SeededRng(this.seed ^ 0x9e3779b9));
    this.onMeasurement = opts.onMeasurement;
  }

  /* ----------------------- стенд (вызывается VR-интеракциями) ----------------------- */

  /** Расстояние «источник — окно детектора», м. В VR: |probeTipWorldPos − sourceWorldPos|. */
  setDistance(m: number): void { this.assertOpen(); this.cond.distanceM = Math.max(0.005, m); }
  setDuration(sec: number): void { this.assertOpen(); this.cond.durationSec = Math.min(600, Math.max(1, sec)); }
  /** Полностью заменить набор экранов между источником и прибором. */
  setScreens(screens: Screen[]): void { this.assertOpen(); this.cond.screens = screens.map(s => ({ ...s })); }
  clearScreens(): void { this.setScreens([]); }
  getConditions(): Readonly<MeasurementConditions> { return this.cond; }

  /** Визуальный осмотр: тонкое окно видно (слюда) — не раскрывая тип детектора. Фиксируется в журнале. */
  inspectWindow(): boolean {
    this.windowInspected = this.instrument.hasThinWindow;
    return this.windowInspected;
  }

  getPublicInstrument(): PublicInstrumentView {
    const i = this.instrument;
    return {
      nameRu: i.nameRu, displayUnit: i.displayUnit, detectorAreaCm2: i.detectorAreaCm2,
      cpsPerUSvh: i.cpsPerUSvh, intrinsicEfficiency: i.intrinsicEfficiency, basicErrorPercent: i.basicErrorPercent
    };
  }

  /* ------------------------------ измерения ------------------------------ */

  measure(): MeasurementResult {
    this.assertOpen();
    return this.record({ ...this.cond, sourcePresent: true });
  }

  /** Фон: источник убран, экраны не нужны. */
  measureBackground(): MeasurementResult {
    this.assertOpen();
    return this.record({ ...this.cond, screens: [], sourcePresent: false });
  }

  private record(cond: MeasurementConditions): MeasurementResult {
    const { result, truth } = this.model.measure(this.source, cond);
    this.log.push({ result, truth });
    this.onMeasurement?.(result);
    return result;
  }

  /** Публичный журнал студента (без скрытой истины). */
  getJournal(): readonly MeasurementResult[] { return this.log.map(l => l.result); }

  /* ------------------------------- задания ------------------------------- */

  getTaskProgress(): TaskProgress[] {
    const src = this.log.filter(l => l.result.conditions.sourcePresent).map(l => l.result.conditions);
    const noScreen = (c: MeasurementConditions) => c.screens.every(s => s.thicknessMm <= 0);
    const onlyMat = (c: MeasurementConditions, m: string) =>
      c.screens.some(s => s.thicknessMm > 0) && c.screens.every(s => s.material === m || s.thicknessMm <= 0);

    const open = src.filter(noScreen);
    const screenDone = open.some(o =>
      src.some(c => onlyMat(c, 'paper') && sameDist(c.distanceM, o.distanceM)) &&
      src.some(c => onlyMat(c, 'aluminium') && sameDist(c.distanceM, o.distanceM)));

    const dists = [...new Set(open.map(c => c.distanceM))].sort((a, b) => a - b);
    let distinct = dists.length ? 1 : 0;
    for (let i = 1; i < dists.length; i++) if (dists[i] / dists[i - 1] >= 1.3) distinct++;

    const leadDone = open.some(o => {
      const t = new Set(src.filter(c => onlyMat(c, 'lead') && sameDist(c.distanceM, o.distanceM))
        .map(c => c.screens.reduce((a, s) => a + s.thicknessMm, 0)));
      return t.size >= 3;
    });

    return [
      { id: 'background', titleRu: 'Измерение фона', done: this.log.some(l => !l.result.conditions.sourcePresent), hintRu: 'уберите источник и измерьте фон.' },
      { id: 'screen_test', titleRu: 'Опыт с экранами', done: screenDone, hintRu: 'измерьте без экрана, с бумагой и с алюминием на одном расстоянии.' },
      { id: 'distance_test', titleRu: 'Зависимость от расстояния', done: distinct >= 3, hintRu: 'снимите ≥ 3 расстояний, различающихся ≥ 1.3 раза (проверка 1/r²).' },
      { id: 'lead_absorption', titleRu: 'Поглощение в свинце', done: leadDone, hintRu: 'измерьте ≥ 3 разных толщин Pb на одном расстоянии (для HVL).' }
    ];
  }

  /* -------------------------------- сдача -------------------------------- */

  /** Единственная сдача: после неё стенд блокируется, а истина раскрывается в отчёте. */
  submit(answers: StudentAnswers): LabReport {
    if (this.submitted) return this.submitted;
    this.submitted = gradeSubmission(answers, {
      instrument: this.instrument, source: this.source, log: this.log, tasks: this.getTaskProgress()
    });
    return this.submitted;
  }
  get isSubmitted(): boolean { return this.submitted !== null; }

  private assertOpen(): void {
    if (this.submitted) throw new Error('Работа уже сдана: стенд заблокирован.');
  }
}
