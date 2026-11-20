/**
 * Пять валидаторов лабораторных заданий. Каждый — свой алгоритм действий студента,
 * свои шаги и свои причины отказа. Ни один не использует «близость к источнику» как триггер зачёта.
 */
import { TaskValidator, mean, relStd, type TaskContext } from './questManager';
import type { LabTaskId, QuestCommand, TaskControl } from './questTypes';

const f = (x: number, d = 2) => x.toFixed(d);
const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

/* =========================================================================
 * Задание 1. Измерение фона: прибор в руке → r > 3 м → удержание кнопки 3 с при стабильных показаниях
 * ========================================================================= */
export class BackgroundTask extends TaskValidator {
  readonly id: LabTaskId = 'background';
  readonly titleRu = 'Измерение фонового излучения';
  readonly goalRu = 'Зафиксируйте фон на удалении > 3 м от источника, удерживая кнопку 3 секунды.';
  readonly steps = [
    { id: 'take', titleRu: 'Возьмите прибор в руку' },
    { id: 'far', titleRu: 'Отойдите от источника дальше 3 м' },
    { id: 'hold', titleRu: 'Удерживайте «Зафиксировать фон» 3 с при стабильных показаниях' }
  ] as const;
  readonly commandTypes = ['hold_fix_background'] as const;

  private holding = false;
  private holdSec = 0;
  private samples: number[] = [];

  protected reset(): void { this.holding = false; this.holdSec = 0; this.samples = []; }

  private resetHold(): void { this.holdSec = 0; this.samples = []; }

  onCommand(cmd: QuestCommand, ctx: TaskContext): void {
    if (cmd.type !== 'hold_fix_background') return;
    if (cmd.down) {
      if (this.step < 2) {
        ctx.reject(this.step === 0 ? 'Сначала возьмите прибор в руку.' : `Слишком близко к источнику: нужно > ${f(ctx.cfg.backgroundMinDistM, 1)} м (сейчас ${f(ctx.s.nearestSourceDistM)} м).`);
        return;
      }
      this.holding = true;
      this.resetHold();
    } else {
      if (this.holding && this.holdSec > 0 && this.holdSec < ctx.cfg.backgroundHoldSec) {
        ctx.say('warn', `Кнопка отпущена через ${f(this.holdSec, 1)} с — нужно удерживать ${ctx.cfg.backgroundHoldSec} с.`);
      }
      this.holding = false;
      this.resetHold();
    }
  }

  onUpdate(ctx: TaskContext): boolean {
    const { s, cfg } = ctx;
    // Выбор шага по условиям; вперёд — не более 1 шага за кадр.
    const target = !s.instrumentHeld ? 0 : s.nearestSourceDistM > cfg.backgroundMinDistM ? 2 : 1;
    const before = this.step;
    this.moveTo(target);
    if (this.step < 2 && before === 2 && this.holding) {
      this.holding = false; this.resetHold();
      ctx.say('warn', 'Условия нарушены (прибор/дистанция) — удержание сброшено.');
    }
    if (this.step !== 2 || !this.holding || !this.canAct) return false;

    this.holdSec += ctx.dt;
    this.samples.push(s.readingUSvh);

    // Стабильность: после 1 с проверяем разброс по скользящему окну 1 с.
    if (this.holdSec >= 1) {
      const win = ctx.recent(1);
      if (relStd(win) > cfg.backgroundMaxRelStd) {
        ctx.say('warn', 'Показания нестабильны — дождитесь стабилизации и повторите удержание.');
        this.holding = false; this.resetHold();
        return false;
      }
    }
    if (this.holdSec >= cfg.backgroundHoldSec) {
      ctx.journal.background = { valueUSvh: mean(this.samples), distanceM: s.nearestSourceDistM, atTimeSec: s.timeSec };
      this.holding = false;
      return true;
    }
    return false;
  }

  progress(ctx: TaskContext): number {
    if (this.step < 2) return this.step / 3;
    return (2 + clamp01(this.holdSec / ctx.cfg.backgroundHoldSec)) / 3;
  }
  instruction(ctx: TaskContext): string {
    if (this.step === 0) return 'Возьмите дозиметр в руку.';
    if (this.step === 1) return `Отойдите от источника: сейчас ${f(ctx.s.nearestSourceDistM)} м, нужно > ${f(ctx.cfg.backgroundMinDistM, 1)} м.`;
    return this.holding ? `Удерживайте… ${f(this.holdSec, 1)} / ${ctx.cfg.backgroundHoldSec} с` : 'Нажмите и удерживайте «Зафиксировать фон».';
  }
  controls(ctx: TaskContext): TaskControl[] {
    return [{ kind: 'hold', id: 'fix_background', labelRu: 'Зафиксировать фон (удерживать 3 с)', enabled: this.step === 2, holding: this.holding }];
  }
}

/* =========================================================================
 * Задание 2. Закон 1/r²: ≥ 3 сохранённых точки на разных дистанциях + проверка согласия с 1/r²
 * ========================================================================= */
export class InverseSquareTask extends TaskValidator {
  readonly id: LabTaskId = 'inverse_square';
  readonly titleRu = 'Закон обратных квадратов I ~ 1/r²';
  readonly goalRu = 'Сохраните в журнал минимум 3 точки измерения на разных расстояниях (например, 1, 2 и 3 м).';
  readonly steps = [
    { id: 'p1', titleRu: 'Точка 1: сохраните измерение' },
    { id: 'p2', titleRu: 'Точка 2: на другой дистанции (≥ 0.5 м от прежней)' },
    { id: 'p3', titleRu: 'Точка 3: ещё на одной новой дистанции' },
    { id: 'verify', titleRu: 'Проверка: данные согласуются с H ∝ 1/r²' }
  ] as const;
  readonly commandTypes = ['save_distance_point'] as const;

  private lastSaveT = -1e9;
  private pointSeq = 0;
  private needsCheck = false;

  protected reset(): void { this.lastSaveT = -1e9; this.pointSeq = 0; this.needsCheck = false; }

  onCommand(cmd: QuestCommand, ctx: TaskContext): void {
    if (cmd.type !== 'save_distance_point') return;
    const { s, cfg, journal } = ctx;
    if (!s.instrumentHeld) return ctx.reject('Прибор должен быть в руке.');
    if (s.shield.present) return ctx.reject('На линии «источник — детектор» стоит экран. Для проверки 1/r² измеряйте без экрана.');
    const r = s.nearestSourceDistM;
    if (r < cfg.distanceMinDistM || r > cfg.distanceMaxDistM) {
      return ctx.reject(`Дистанция ${f(r)} м вне рабочего диапазона ${cfg.distanceMinDistM}–${cfg.distanceMaxDistM} м.`);
    }
    if (s.timeSec - this.lastSaveT < 0.7) return ctx.reject('Слишком частые нажатия: подождите, пока показания обновятся.');
    const dup = journal.distancePoints.find(p => Math.abs(p.distanceM - r) < cfg.distanceMinSeparationM);
    if (dup) return ctx.reject(`Точка на ${f(dup.distanceM)} м уже есть. Отойдите/подойдите минимум на ${cfg.distanceMinSeparationM} м.`);
    const win = ctx.recent(1);
    if (relStd(win) > 0.2) return ctx.reject('Показания ещё не установились (прибор инерционен). Подождите ≈ 1–2 с.');
    const bg = journal.background?.valueUSvh ?? 0;
    const reading = mean(win.length ? win : [s.readingUSvh]);
    const net = Math.max(0, reading - bg);
    if (net < cfg.distanceMinNetUSvh) return ctx.reject('Сигнал на уровне фона — подойдите ближе к источнику.');

    this.lastSaveT = s.timeSec;
    journal.distancePoints.push({ id: ++this.pointSeq, distanceM: r, readingUSvh: reading, netUSvh: net, atTimeSec: s.timeSec });
    const n = journal.distancePoints.length;
    ctx.say('success', `Точка ${n} сохранена: r = ${f(r)} м, H = ${f(net, 3)} мкЗв/ч (за вычетом фона).`);
    this.needsCheck = n >= cfg.distanceMinPoints;
  }

  onUpdate(ctx: TaskContext): boolean {
    const pts = ctx.journal.distancePoints;
    const n = pts.length;
    const target = Math.min(n, ctx.cfg.distanceMinPoints);
    this.moveTo(target);
    if (!this.needsCheck || this.step < ctx.cfg.distanceMinPoints || !this.canAct) return false;
    this.needsCheck = false;

    // Проверка по собственным данным студента: H·r² ≈ const и показатель степени ≈ −2.
    const prod = pts.map(p => p.netUSvh * p.distanceM ** 2);
    const spread = Math.max(...prod) / Math.max(1e-12, Math.min(...prod));
    const lx = pts.map(p => Math.log(p.distanceM)), ly = pts.map(p => Math.log(p.netUSvh));
    const mx = mean(lx), my = mean(ly);
    let sxy = 0, sxx = 0;
    for (let i = 0; i < lx.length; i++) { sxy += (lx[i] - mx) * (ly[i] - my); sxx += (lx[i] - mx) ** 2; }
    const p = sxx > 0 ? sxy / sxx : NaN;
    if (spread <= 2.0 && p >= -2.6 && p <= -1.4) return true;

    if (n >= 8) { ctx.journal.distancePoints.length = 0; ctx.say('error', 'Данные не сходятся с 1/r². Журнал очищен — повторите серию.'); this.moveTo(0); this.step = 0; return false; }
    ctx.say('warn', `Данные не согласуются с 1/r² (показатель ${f(p)}; ожидается ≈ −2). Проверьте отсутствие экранов, фон и добавьте точки.`);
    return false;
  }

  progress(ctx: TaskContext): number {
    return clamp01(ctx.journal.distancePoints.length / (ctx.cfg.distanceMinPoints + 1)) * 0.9 + (this.step >= 3 ? 0.1 : 0);
  }
  instruction(ctx: TaskContext): string {
    const n = ctx.journal.distancePoints.length;
    if (n >= ctx.cfg.distanceMinPoints) return 'Проверка данных…';
    return `Точек сохранено: ${n} из ${ctx.cfg.distanceMinPoints}. Сейчас ${f(ctx.s.nearestSourceDistM)} м — встаньте на новую дистанцию и нажмите «Сохранить точку».`;
  }
  controls(ctx: TaskContext): TaskControl[] {
    return [{ kind: 'press', id: 'save_distance_point', labelRu: 'Сохранить точку в журнал', enabled: ctx.s.instrumentHeld }];
  }
}

/* =========================================================================
 * Задание 3. Экран: физическая проверка (Raycast) + кнопка «Измерить под экраном» + интегрирование без потери экрана
 * ========================================================================= */
export class ShieldTask extends TaskValidator {
  readonly id: LabTaskId = 'shield_efficiency';
  readonly titleRu = 'Эффективность защитных экранов';
  readonly goalRu = 'Установите экран между источником и детектором и выполните измерение под экраном.';
  readonly steps = [
    { id: 'place', titleRu: 'Установите экран на линию «источник — детектор»' },
    { id: 'press', titleRu: 'Нажмите «Измерить под экраном»' },
    { id: 'hold', titleRu: 'Не убирайте экран во время измерения' }
  ] as const;
  readonly commandTypes = ['measure_under_shield'] as const;

  private presentSec = 0;
  private measuring = false;
  private measureSec = 0;
  private samples: number[] = [];

  protected reset(): void { this.presentSec = 0; this.measuring = false; this.measureSec = 0; this.samples = []; }
  needs() { return { shieldRay: true }; }

  private effective(ctx: TaskContext): boolean { return ctx.s.shield.present && ctx.s.shield.kShield >= ctx.cfg.shieldMinK; }

  onCommand(cmd: QuestCommand, ctx: TaskContext): void {
    if (cmd.type !== 'measure_under_shield') return;
    if (!ctx.s.instrumentHeld) return ctx.reject('Прибор должен быть в руке.');
    if (!ctx.s.shield.present) return ctx.reject('Между источником и детектором нет физического экрана (луч зонд → источник не пересекает экран).');
    if (!this.effective(ctx)) return ctx.reject(`Экран на линии, но ослабление слабое (K = ${f(ctx.s.shield.kShield)} < ${ctx.cfg.shieldMinK}). Возьмите экран потолще/подходящего материала.`);
    if (this.step !== 1 || !this.canAct) return ctx.reject('Подождите секунду: экран ещё проверяется на линии.');
    this.measuring = true; this.measureSec = 0; this.samples = [];
    this.moveTo(2);
  }

  onUpdate(ctx: TaskContext): boolean {
    const { s, cfg } = ctx;
    if (this.step === 0) {
      this.presentSec = this.effective(ctx) ? this.presentSec + ctx.dt : 0;
      if (this.presentSec >= 0.5) this.moveTo(1);          // экран должен стоять стабильно ≥ 0.5 с
      return false;
    }
    if (this.step === 1) {
      if (!this.effective(ctx)) { this.presentSec = 0; this.moveTo(0); }
      return false;
    }
    // step 2: идёт интегрирование — экран обязан оставаться на линии всё время
    if (!this.effective(ctx) || !s.instrumentHeld) {
      this.measuring = false; this.measureSec = 0; this.samples = [];
      ctx.say('warn', 'Экран убран/сдвинут во время измерения — измерение прервано.');
      this.step = 1;
      return false;
    }
    if (!this.canAct) return false;
    this.measureSec += ctx.dt;
    this.samples.push(s.readingUSvh);
    if (this.measureSec >= cfg.shieldIntegrateSec) {
      const shielded = mean(this.samples);
      ctx.journal.shield = {
        shieldedUSvh: shielded, unshieldedEstimateUSvh: shielded * s.shield.kShield, attenuationK: s.shield.kShield,
        material: s.shield.material, thicknessCm: s.shield.thicknessCm, atTimeSec: s.timeSec
      };
      this.measuring = false;
      return true;
    }
    return false;
  }

  progress(ctx: TaskContext): number {
    if (this.step === 0) return clamp01(this.presentSec / 0.5) * 0.33;
    if (this.step === 1) return 0.33;
    return 0.33 + 0.67 * clamp01(this.measureSec / ctx.cfg.shieldIntegrateSec);
  }
  instruction(ctx: TaskContext): string {
    if (this.step === 0) return ctx.s.shield.present ? `Экран на линии, K = ${f(ctx.s.shield.kShield)} — удерживайте положение…` : 'Установите защитный экран между источником и прибором (E / курок).';
    if (this.step === 1) return 'Экран на месте. Нажмите «Измерить под экраном».';
    return `Измерение… ${f(this.measureSec, 1)} / ${ctx.cfg.shieldIntegrateSec} с. Не двигайте экран.`;
  }
  controls(ctx: TaskContext): TaskControl[] {
    return [{ kind: 'press', id: 'measure_under_shield', labelRu: 'Измерить под экраном', enabled: this.step === 1 && !this.measuring }];
  }
}

/* =========================================================================
 * Задание 4. ALARA по времени: зона высокой дозы → ввод лимита → таймер работы → выход до лимита
 * ========================================================================= */
export class AlaraTimeTask extends TaskValidator {
  readonly id: LabTaskId = 'alara_time';
  readonly titleRu = 'Расчёт времени по принципу ALARA';
  readonly goalRu = 'В зоне повышенной дозы задайте допустимый предел, запустите таймер работы и покиньте зону до срабатывания лимита.';
  readonly steps = [
    { id: 'zone', titleRu: 'Войдите в зону повышенной дозы' },
    { id: 'limit', titleRu: 'Введите допустимый предел дозы на панели' },
    { id: 'start', titleRu: 'Запустите таймер выполнения работы' },
    { id: 'exit', titleRu: 'Покиньте опасную зону до срабатывания лимита' }
  ] as const;
  readonly commandTypes = ['set_alara_limit', 'start_work_timer'] as const;

  private limitMSv: number | null = null;
  private startDose = 0;
  private workSec = 0;
  private inZone = false;
  private limitHit = false;
  /** Для отображения/тестов. */
  get currentLimit(): number | null { return this.limitMSv; }

  protected reset(): void { this.limitMSv = null; this.startDose = 0; this.workSec = 0; this.inZone = false; this.limitHit = false; }

  /** Колбэк для App: звуковой лимит. Устанавливается в createLabQuest(). */
  onLimitReached: () => void = () => {};

  private zoneNow(ctx: TaskContext): boolean {
    const { s, cfg } = ctx;
    this.inZone = this.inZone ? s.doseRateUSvh >= cfg.highDoseExitUSvh : s.doseRateUSvh >= cfg.highDoseEnterUSvh; // гистерезис
    return this.inZone;
  }

  onCommand(cmd: QuestCommand, ctx: TaskContext): void {
    if (cmd.type === 'set_alara_limit') {
      if (this.step === 0) return ctx.reject('Предел вводится в зоне повышенной дозы: сначала войдите в неё.');
      if (this.step >= 2) return ctx.reject('Таймер уже запущен — предел менять нельзя.');
      const v = cmd.limitMSv;
      if (!Number.isFinite(v) || v <= 0) return ctx.reject('Предел дозы должен быть положительным числом (мЗв).');
      if (v > ctx.cfg.alaraMaxLimitMSv) return ctx.reject(`Предел ${f(v)} мЗв превышает годовой норматив ${ctx.cfg.alaraMaxLimitMSv} мЗв.`);
      if (!this.canAct) return;
      this.limitMSv = v;
      ctx.say('info', `Предел принят: ${f(v, 3)} мЗв (${f(v * 1000, 1)} мкЗв).`);
      this.moveTo(2);
      return;
    }
    if (cmd.type === 'start_work_timer') {
      if (this.step < 2 || this.limitMSv === null) return ctx.reject('Сначала введите допустимый предел дозы.');
      if (this.step > 2) return ctx.reject('Таймер уже запущен.');
      if (!this.zoneNow(ctx)) return ctx.reject('Работа начинается в зоне повышенной дозы — вы вне зоны.');
      if (!this.canAct) return;
      this.startDose = ctx.s.cumulativeDoseMSv;
      this.workSec = 0; this.limitHit = false;
      ctx.say('info', 'Таймер работы запущен. Выполните работу и покиньте зону до срабатывания лимита.');
      this.moveTo(3);
    }
  }

  onUpdate(ctx: TaskContext): boolean {
    const { s, cfg } = ctx;
    const inZone = this.zoneNow(ctx);

    if (this.step === 0) { if (inZone) this.moveTo(1); return false; }
    if (this.step === 1) { if (!inZone) this.moveTo(0); return false; }   // вышел до ввода — вернулись к входу
    if (this.step === 2) { if (!inZone) { this.moveTo(1); } return false; }

    // step 3: работа
    if (!this.canAct) return false;
    this.workSec += ctx.dt;
    const used = s.cumulativeDoseMSv - this.startDose;
    if (this.limitMSv !== null && used >= this.limitMSv) {
      this.limitHit = true;
      this.onLimitReached();
      ctx.reject(`Лимит ${f(this.limitMSv, 3)} мЗв достигнут (набрано ${f(used, 3)} мЗв) раньше, чем вы покинули зону. Задайте предел/время и повторите.`);
      this.step = 1;      // откат на ввод предела (в зоне)
      this.limitMSv = null;
      return false;
    }
    if (!inZone) {
      if (this.workSec < cfg.alaraMinWorkSec) {
        ctx.reject(`Вы покинули зону через ${f(this.workSec, 1)} с — работа не выполнена (нужно ≥ ${cfg.alaraMinWorkSec} с в зоне). Начните заново: войдите в зону, введите предел и запустите таймер.`);
        this.step = 0; this.workSec = 0; this.limitMSv = null;   // полный перезапуск процедуры
        return false;
      }
      ctx.journal.alara = { limitMSv: this.limitMSv!, startDoseMSv: this.startDose, endDoseMSv: s.cumulativeDoseMSv, workSec: this.workSec, leftZoneBeforeLimit: true };
      return true;
    }
    return false;
  }

  progress(ctx: TaskContext): number {
    if (this.step < 3) return this.step / 4;
    return 0.75 + 0.25 * clamp01(this.workSec / ctx.cfg.alaraMinWorkSec);
  }
  instruction(ctx: TaskContext): string {
    const { s, cfg } = ctx;
    if (this.step === 0) return `Подойдите в зону повышенной дозы (≥ ${cfg.highDoseEnterUSvh} мкЗв/ч). Сейчас ${f(s.doseRateUSvh, 1)} мкЗв/ч.`;
    if (this.step === 1) return 'Введите допустимый предел дозы (мЗв) и подтвердите.';
    if (this.step === 2) return `Предел: ${f(this.limitMSv ?? 0, 3)} мЗв. Нажмите «Запустить таймер работы».`;
    const used = s.cumulativeDoseMSv - this.startDose;
    return `Работа: ${f(this.workSec, 1)} с, набрано ${f(used * 1000, 1)} из ${f((this.limitMSv ?? 0) * 1000, 1)} мкЗв. Выйдите из зоны (< ${cfg.highDoseExitUSvh} мкЗв/ч) до лимита!`;
  }
  controls(ctx: TaskContext): TaskControl[] {
    return [
      { kind: 'number', id: 'alara_limit', labelRu: 'Допустимый предел дозы', enabled: this.step === 1, value: this.limitMSv, unit: 'мЗв' },
      { kind: 'press', id: 'start_work_timer', labelRu: 'Запустить таймер работы', enabled: this.step === 2 }
    ];
  }
}

/* =========================================================================
 * Задание 5. α/β-загрязнение: вплотную (≤ 10 см), плавный скан по загрязнённой области заданное время
 *            (БЕЗ триггера по расстоянию до источника)
 * ========================================================================= */
export class ContaminationTask extends TaskValidator {
  readonly id: LabTaskId = 'contamination';
  readonly titleRu = 'Альфа/бета-загрязнение поверхностей';
  readonly goalRu = 'Поднесите датчик вплотную к стене (≤ 10 см) и плавно сканируйте загрязнённую область заданное время.';
  readonly steps = [
    { id: 'equip', titleRu: 'Возьмите прибор, регистрирующий α/β' },
    { id: 'contact', titleRu: 'Поднесите датчик к поверхности на ≤ 10 см' },
    { id: 'scan', titleRu: 'Плавно сканируйте загрязнённую область' }
  ] as const;
  readonly commandTypes = [] as const;

  private lastPos: { x: number; y: number; z: number } | null = null;
  private speed = 0;
  private scanSec = 0;
  private graceLeft = 0;
  private path = 0;
  private peak = 0;
  private cells = new Set<string>();
  private lastWarnT = -1e9;

  protected reset(): void { this.lastPos = null; this.speed = 0; this.scanSec = 0; this.graceLeft = 0; this.path = 0; this.peak = 0; this.cells.clear(); }
  needs() { return { surfaceDistance: true, contamination: true }; }

  private clearScan(): void { this.scanSec = 0; this.path = 0; this.peak = 0; this.cells.clear(); }

  onCommand(): void { /* команд нет: задание выполняется движением */ }

  onUpdate(ctx: TaskContext): boolean {
    const { s, cfg } = ctx;
    // скорость зонда (EMA 0.25 с)
    if (this.lastPos && ctx.dt > 0) {
      const d = Math.hypot(s.probePos.x - this.lastPos.x, s.probePos.y - this.lastPos.y, s.probePos.z - this.lastPos.z);
      const inst = d / ctx.dt;
      const a = Math.min(1, ctx.dt / 0.25);
      this.speed += (inst - this.speed) * a;
    }
    const prev = this.lastPos;
    this.lastPos = { ...s.probePos };

    const equipped = s.instrumentHeld && (!cfg.scanRequireAlphaBetaInstrument || s.instrumentDetectsAlphaBeta);
    const near = s.surfaceDistanceM !== null && s.surfaceDistanceM <= cfg.scanMaxSurfaceDistM;
    const target = !equipped ? 0 : !near ? 1 : 2;
    this.moveTo(target);
    if (this.step < 2) { this.graceLeft = Math.max(0, this.graceLeft - ctx.dt); if (this.graceLeft === 0 && this.scanSec > 0) this.clearScan(); return false; }
    if (!this.canAct) return false;

    const onHot = s.contaminationLevel >= cfg.scanMinLevel;
    const smooth = this.speed >= cfg.scanMinSpeedMps && this.speed <= cfg.scanMaxSpeedMps;
    if (onHot && smooth) {
      this.graceLeft = cfg.scanGraceSec;
      this.scanSec += ctx.dt;
      this.peak = Math.max(this.peak, s.contaminationLevel);
      if (prev) this.path += Math.hypot(s.probePos.x - prev.x, s.probePos.y - prev.y, s.probePos.z - prev.z);
      const c = cfg.scanCellSizeM;
      this.cells.add(`${Math.floor(s.probePos.x / c)}:${Math.floor(s.probePos.y / c)}:${Math.floor(s.probePos.z / c)}`);
    } else {
      this.graceLeft = Math.max(0, this.graceLeft - ctx.dt);
      if (s.timeSec - this.lastWarnT > 2) {
        this.lastWarnT = s.timeSec;
        if (!onHot) ctx.say('info', 'Датчик вне загрязнённой области — ведите вдоль пятна.');
        else if (this.speed < cfg.scanMinSpeedMps) ctx.say('info', 'Двигайте датчик вдоль поверхности — на месте скан не идёт.');
        else ctx.say('warn', 'Слишком быстро — ведите датчик плавнее.');
      }
      if (this.graceLeft === 0 && this.scanSec > 0) { this.clearScan(); ctx.say('warn', 'Скан прерван — накопленное время сброшено.'); }
    }

    if (this.scanSec >= cfg.scanRequiredSec && this.cells.size >= cfg.scanMinCells) {
      ctx.journal.scan = { scanSec: this.scanSec, pathLengthM: this.path, cells: this.cells.size, peakLevel: this.peak };
      return true;
    }
    return false;
  }

  progress(ctx: TaskContext): number {
    if (this.step < 2) return this.step / 3;
    const tPart = clamp01(this.scanSec / ctx.cfg.scanRequiredSec);
    const cPart = clamp01(this.cells.size / ctx.cfg.scanMinCells);
    return (2 + Math.min(tPart, cPart)) / 3;
  }
  instruction(ctx: TaskContext): string {
    const { s, cfg } = ctx;
    if (this.step === 0) return cfg.scanRequireAlphaBetaInstrument ? 'Выберите радиометр α/β и возьмите его в руку.' : 'Возьмите прибор в руку.';
    if (this.step === 1) return `Поднесите датчик к стене: сейчас ${s.surfaceDistanceM === null ? '—' : f(s.surfaceDistanceM * 100, 0) + ' см'}, нужно ≤ ${f(cfg.scanMaxSurfaceDistM * 100, 0)} см.`;
    return `Скан: ${f(this.scanSec, 1)} / ${cfg.scanRequiredSec} с, покрытие ${this.cells.size} / ${cfg.scanMinCells} ячеек, скорость ${f(this.speed * 100, 0)} см/с.`;
  }
  controls(): TaskControl[] { return []; }
}

export function createLabTasks(): [BackgroundTask, InverseSquareTask, ShieldTask, AlaraTimeTask, ContaminationTask] {
  return [new BackgroundTask(), new InverseSquareTask(), new ShieldTask(), new AlaraTimeTask(), new ContaminationTask()];
}
