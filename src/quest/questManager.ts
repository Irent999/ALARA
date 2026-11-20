/**
 * LabQuestManager — стейт-машина лабораторных заданий.
 *
 * Гарантии (проверяются в questSelfTest.ts):
 *  1. Строгая последовательность: в каждый момент активно РОВНО одно задание; остальные locked/completed.
 *  2. Задание получает сенсоры и команды только пока оно активно; чужие кнопки отклоняются с причиной.
 *  3. За один кадр завершается не более одного задания и не более одного шага внутри задания.
 *  4. После завершения задания команды блокируются на короткий интервал (нет «проскока» нажатия в следующее).
 *  5. Таймеры считают dt, ограниченный maxDtSec: лаг/сворачивание вкладки не засчитывает удержание.
 *  6. Никакого внешнего «зачесть»: единственный путь к completed — onUpdate() валидатора.
 */
import {
  DEFAULT_QUEST_CONFIG,
  type LabTaskId, type QuestCommand, type QuestConfig, type QuestFeedback, type QuestHooks,
  type QuestJournal, type QuestSensors, type QuestSnapshot, type StepView, type TaskControl, type TaskStatus, type TaskView
} from './questTypes';

/* --------------------------------------------------------------- утилиты */

export function mean(a: number[]): number { return a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0; }
export function relStd(a: number[]): number {
  if (a.length < 2) return 0;
  const m = mean(a);
  if (m <= 1e-9) return 0;
  return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1)) / m;
}

export interface TaskContext {
  cfg: QuestConfig;
  journal: QuestJournal;
  s: QuestSensors;
  /** dt, ограниченный maxDtSec. */
  dt: number;
  /** Показания за последние `sec` секунд. */
  recent(sec: number): number[];
  say(kind: QuestFeedback['kind'], text: string): void;
  /** Отклонить действие: пишет в журнал отклонений и показывает причину. */
  reject(reasonRu: string): void;
}

export interface StepDef { id: string; titleRu: string }

/** Базовый валидатор: хранит индекс шага и не даёт пройти больше одного шага за кадр. */
export abstract class TaskValidator {
  abstract readonly id: LabTaskId;
  abstract readonly titleRu: string;
  abstract readonly goalRu: string;
  abstract readonly steps: readonly StepDef[];
  /** Команды, которые этот валидатор вообще понимает. */
  abstract readonly commandTypes: readonly QuestCommand['type'][];

  protected step = 0;
  private advancedThisTick = false;

  get stepIndex(): number { return this.step; }

  beginTick(): void { this.advancedThisTick = false; }

  /** Перейти на шаг `target`: вперёд — максимум на 1 шаг за кадр, назад — свободно. */
  protected moveTo(target: number): boolean {
    if (target > this.step) {
      if (this.advancedThisTick) return false;
      this.step++;
      this.advancedThisTick = true;
      return true;
    }
    if (target < this.step) { this.step = target; return true; }
    return false;
  }

  /** Можно ли в этом кадре выполнять действие, завершающее шаг (шаг ещё не менялся). */
  protected get canAct(): boolean { return !this.advancedThisTick; }

  onEnter(_ctx: TaskContext): void { this.step = 0; this.advancedThisTick = false; this.reset(); }
  protected abstract reset(): void;
  abstract onCommand(cmd: QuestCommand, ctx: TaskContext): void;
  /** true — задание завершено (допустимо только на последнем шаге). */
  abstract onUpdate(ctx: TaskContext): boolean;
  abstract progress(ctx: TaskContext): number;
  abstract instruction(ctx: TaskContext): string;
  abstract controls(ctx: TaskContext): TaskControl[];
  /** Какие «дорогие» сенсоры нужны сейчас (чтобы App не считал лишние Raycast). */
  needs(): { shieldRay?: boolean; surfaceDistance?: boolean; contamination?: boolean } { return {}; }
}

/* ---------------------------------------------------------------- менеджер */

type Listener = (snap: QuestSnapshot) => void;

const emptyJournal = (): QuestJournal => ({ background: null, distancePoints: [], shield: null, alara: null, scan: null });

export class LabQuestManager {
  readonly cfg: QuestConfig;
  private readonly tasks: TaskValidator[];
  private readonly hooks: QuestHooks;
  private status: TaskStatus[];
  private activeIndex = 0;
  private journal: QuestJournal = emptyJournal();
  private queue: QuestCommand[] = [];
  private lastSensors: QuestSensors | null = null;
  private history: Array<{ t: number; v: number }> = [];
  private feedback: QuestFeedback | null = null;
  private feedbackSeq = 0;
  private rejections: QuestSnapshot['rejections'] = [];
  private commandLockUntil = 0;
  private needsEnter = true;
  private listeners = new Set<Listener>();
  private lastNotify = -1;
  private dirty = true;

  constructor(tasks: TaskValidator[], cfg: Partial<QuestConfig> = {}, hooks: QuestHooks = {}) {
    this.cfg = { ...DEFAULT_QUEST_CONFIG, ...cfg };
    this.tasks = tasks;
    this.hooks = hooks;
    this.status = tasks.map((_, i) => (i === 0 ? 'active' : 'locked'));
  }

  /* ------------------------------------------------------------ публичное API */

  /** Команда с планшета (кнопка). Выполняется в ближайшем update(), и только активным заданием. */
  dispatch(cmd: QuestCommand): void {
    const isRelease = cmd.type === 'hold_fix_background' && !cmd.down;
    const now = this.lastSensors?.timeSec ?? 0;
    if (!isRelease && now < this.commandLockUntil) {
      this.reject('none', 'Дождитесь активации следующего задания.');
      return;
    }
    this.queue.push(cmd);
  }

  update(sensors: QuestSensors): void {
    const s: QuestSensors = { ...sensors, dt: Math.min(Math.max(0, sensors.dt), this.cfg.maxDtSec) };
    this.lastSensors = s;
    this.history.push({ t: s.timeSec, v: s.readingUSvh });
    while (this.history.length && s.timeSec - this.history[0].t > 4) this.history.shift();

    const task = this.tasks[this.activeIndex];
    if (!task) { this.queue.length = 0; this.maybeNotify(s.timeSec); return; }

    const ctx = this.makeCtx(s);
    task.beginTick();
    if (this.needsEnter) { task.onEnter(ctx); this.needsEnter = false; this.queue.length = 0; this.dirty = true; return; }

    // 1. Команды — только активному заданию; чужие отклоняются.
    const cmds = this.queue; this.queue = [];
    for (const cmd of cmds) {
      if (task.commandTypes.includes(cmd.type)) { task.onCommand(cmd, ctx); this.dirty = true; }
      else {
        const owner = this.tasks.findIndex(t => t.commandTypes.includes(cmd.type));
        const idx = owner >= 0 ? owner : -1;
        if (idx >= 0 && this.status[idx] === 'completed') this.reject(task.id, 'Это действие относится к уже выполненному заданию.');
        else if (idx >= 0) this.reject(task.id, `Эта кнопка относится к заданию ${idx + 1}. Сейчас активно задание ${this.activeIndex + 1}: «${task.titleRu}».`);
      }
    }

    // 2. Покадровая проверка условий (единственный путь к завершению).
    const done = task.onUpdate(ctx);
    if (done) this.completeActive(s.timeSec);

    this.maybeNotify(s.timeSec);
  }

  getSnapshot(): QuestSnapshot {
    const s = this.lastSensors;
    const ctx = s ? this.makeCtx(s) : null;
    const tasks: TaskView[] = this.tasks.map((t, i) => {
      const st = this.status[i];
      const active = st === 'active' && ctx;
      const stepIdx = st === 'completed' ? t.steps.length : st === 'active' ? t.stepIndex : -1;
      const steps: StepView[] = t.steps.map((d, k) => ({
        id: d.id, titleRu: d.titleRu, state: k < stepIdx ? 'done' : k === stepIdx ? 'current' : 'pending'
      }));
      return {
        id: t.id, index: i, titleRu: t.titleRu, goalRu: t.goalRu, status: st, steps,
        progress: st === 'completed' ? 1 : active ? t.progress(ctx!) : 0,
        instructionRu: st === 'completed' ? 'Задание выполнено.' : st === 'locked' ? `Откроется после задания ${i}.` : ctx ? t.instruction(ctx) : '',
        controls: active ? t.controls(ctx!) : []
      };
    });
    const completedCount = this.status.filter(x => x === 'completed').length;
    return {
      tasks, activeIndex: this.activeIndex < this.tasks.length ? this.activeIndex : -1,
      completedCount, total: this.tasks.length, allCompleted: completedCount === this.tasks.length,
      journal: this.journal, feedback: this.feedback, rejections: this.rejections.slice(-30)
    };
  }

  /** Какие дорогие сенсоры нужны в этом кадре (для Raycast-экономии на Quest). */
  getRequiredSensors(): { shieldRay: boolean; surfaceDistance: boolean; contamination: boolean } {
    const n = this.tasks[this.activeIndex]?.needs() ?? {};
    return { shieldRay: !!n.shieldRay, surfaceDistance: !!n.surfaceDistance, contamination: !!n.contamination };
  }

  subscribe(fn: Listener): () => void { this.listeners.add(fn); return () => this.listeners.delete(fn); }

  reset(): void {
    this.journal = emptyJournal();
    this.status = this.tasks.map((_, i) => (i === 0 ? 'active' : 'locked'));
    this.activeIndex = 0;
    this.queue = [];
    this.history = [];
    this.feedback = null;
    this.rejections = [];
    this.commandLockUntil = 0;
    this.needsEnter = true;
    this.dirty = true;
    this.notify();
  }

  /* ------------------------------------------------------------ внутреннее */

  private makeCtx(s: QuestSensors): TaskContext {
    const id = this.tasks[this.activeIndex]?.id ?? 'none';
    return {
      cfg: this.cfg, journal: this.journal, s, dt: s.dt,
      recent: (sec: number) => this.history.filter(h => s.timeSec - h.t <= sec).map(h => h.v),
      say: (kind, text) => this.emit(kind, text),
      reject: (reason: string) => this.reject(id as LabTaskId | 'none', reason)
    };
  }

  private emit(kind: QuestFeedback['kind'], text: string): void {
    this.feedback = { seq: ++this.feedbackSeq, kind, text };
    this.dirty = true;
    this.hooks.onFeedback?.(this.feedback);
  }

  private reject(taskId: LabTaskId | 'none', reasonRu: string): void {
    this.rejections.push({ atTimeSec: this.lastSensors?.timeSec ?? 0, taskId, reasonRu });
    if (this.rejections.length > 60) this.rejections.shift();
    this.emit('warn', reasonRu);
  }

  private completeActive(now: number): void {
    const i = this.activeIndex;
    this.status[i] = 'completed';
    this.activeIndex = i + 1;
    if (this.tasks[this.activeIndex]) this.status[this.activeIndex] = 'active';
    this.needsEnter = true;               // следующее задание «войдёт» только в СЛЕДУЮЩЕМ кадре
    this.queue.length = 0;
    this.commandLockUntil = now + 0.4;    // защита от проскока нажатия
    this.dirty = true;
    const snap = this.getSnapshot();
    const view = snap.tasks[i];
    this.emit('success', `Задание ${i + 1} выполнено: «${view.titleRu}».`);
    this.hooks.onTaskCompleted?.(view, snap.completedCount);
    if (snap.allCompleted) this.hooks.onAllCompleted?.();
    this.notify();
  }

  private maybeNotify(now: number): void {
    if (this.dirty || now - this.lastNotify >= 0.15) {
      this.lastNotify = now;
      this.notify();
    }
  }

  private notify(): void {
    if (!this.listeners.size) { this.dirty = false; return; }
    const snap = this.getSnapshot();
    this.dirty = false;
    this.listeners.forEach(l => l(snap));
  }
}
