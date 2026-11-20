/**
 * Строгая система лабораторных заданий — общие типы.
 * Модуль не зависит от Three.js/React: сенсоры приходят «плоским» снимком, команды — от UI/VR-планшета.
 */

export type LabTaskId =
  | 'background'        // 1. Измерение фона
  | 'inverse_square'    // 2. Закон 1/r²
  | 'shield_efficiency' // 3. Эффективность экрана
  | 'alara_time'        // 4. Время по ALARA
  | 'contamination';    // 5. α/β-загрязнение поверхностей

export type TaskStatus = 'locked' | 'active' | 'completed';

export interface Vec3 { x: number; y: number; z: number }

/** Снимок сенсоров, который App собирает один раз за кадр. */
export interface QuestSensors {
  /** Время миссии, с (монотонное). */
  timeSec: number;
  /** Шаг кадра, с (будет ограничен менеджером, чтобы лаги не «накручивали» таймеры). */
  dt: number;
  /** Прибор находится в руке игрока (не занята другим предметом). */
  instrumentHeld: boolean;
  instrumentId: string;
  /** Выбранный прибор регистрирует α/β (для задания 5). */
  instrumentDetectsAlphaBeta: boolean;
  probePos: Vec3;
  /** Расстояние зонд → ближайший источник, м. */
  nearestSourceDistM: number;
  /** Показание прибора (с шумом и инерцией), мкЗв/ч. */
  readingUSvh: number;
  /** Raycast зонд → источник: есть ли физический экран на линии. */
  shield: { present: boolean; kShield: number; material?: string; thicknessCm?: number };
  /** Теоретическая мощность дозы у оператора (для зон и ALARA), мкЗв/ч. */
  doseRateUSvh: number;
  /** Накопленная доза оператора, мЗв. */
  cumulativeDoseMSv: number;
  /** Расстояние от зонда до ближайшей поверхности (стена/пол/оборудование), м; null — нет данных. */
  surfaceDistanceM: number | null;
  /** Уровень загрязнения под зондом 0..1 (из ContaminationScanManager.sampleLevel). */
  contaminationLevel: number;
}

/* ------------------------------------------------------------------ команды UI */

export type QuestCommand =
  | { type: 'hold_fix_background'; down: boolean }
  | { type: 'save_distance_point' }
  | { type: 'measure_under_shield' }
  | { type: 'set_alara_limit'; limitMSv: number }
  | { type: 'start_work_timer' };

/* ----------------------------------------------------------------- данные журнала */

export interface BackgroundRecord { valueUSvh: number; distanceM: number; atTimeSec: number }
export interface DistancePoint { id: number; distanceM: number; readingUSvh: number; netUSvh: number; atTimeSec: number }
export interface ShieldMeasurement {
  shieldedUSvh: number; unshieldedEstimateUSvh: number; attenuationK: number;
  material?: string; thicknessCm?: number; atTimeSec: number;
}
export interface AlaraRun {
  limitMSv: number; startDoseMSv: number; endDoseMSv: number; workSec: number; leftZoneBeforeLimit: boolean;
}
export interface ScanRecord { scanSec: number; pathLengthM: number; cells: number; peakLevel: number }

export interface QuestJournal {
  background: BackgroundRecord | null;
  distancePoints: DistancePoint[];
  shield: ShieldMeasurement | null;
  alara: AlaraRun | null;
  scan: ScanRecord | null;
}

/* ------------------------------------------------------------------- отображение */

export interface StepView {
  id: string;
  titleRu: string;
  state: 'pending' | 'current' | 'done';
}

export interface TaskView {
  id: LabTaskId;
  index: number;
  titleRu: string;
  goalRu: string;
  status: TaskStatus;
  steps: StepView[];
  /** Прогресс текущего шага/всего задания 0..1 (для кольца/полосы). */
  progress: number;
  /** Подсказка, что делать прямо сейчас. */
  instructionRu: string;
  /** Какие кнопки планшета доступны сейчас. */
  controls: TaskControl[];
}

export type TaskControl =
  | { kind: 'hold'; id: 'fix_background'; labelRu: string; enabled: boolean; holding: boolean }
  | { kind: 'press'; id: 'save_distance_point'; labelRu: string; enabled: boolean }
  | { kind: 'press'; id: 'measure_under_shield'; labelRu: string; enabled: boolean }
  | { kind: 'number'; id: 'alara_limit'; labelRu: string; enabled: boolean; value: number | null; unit: string }
  | { kind: 'press'; id: 'start_work_timer'; labelRu: string; enabled: boolean };

export interface QuestFeedback {
  seq: number;
  kind: 'info' | 'warn' | 'error' | 'success';
  text: string;
}

export interface QuestSnapshot {
  tasks: TaskView[];
  activeIndex: number;        // -1 — всё выполнено
  completedCount: number;
  total: number;
  allCompleted: boolean;
  journal: QuestJournal;
  feedback: QuestFeedback | null;
  /** Журнал отклонённых попыток (для отчёта преподавателю), последние 30. */
  rejections: Array<{ atTimeSec: number; taskId: LabTaskId | 'none'; reasonRu: string }>;
}

export interface QuestHooks {
  onTaskCompleted?: (task: TaskView, completedCount: number) => void;
  onAllCompleted?: () => void;
  onFeedback?: (f: QuestFeedback) => void;
  /** Звуковой лимит ALARA сработал (задание 4) — App проигрывает сирену. */
  onAlaraLimitReached?: () => void;
}

export interface QuestConfig {
  /** Фон: минимальная дистанция до источника, м. */
  backgroundMinDistM: number;
  backgroundHoldSec: number;
  /** Допустимый относительный разброс показаний за время удержания (σ/μ). */
  backgroundMaxRelStd: number;
  /** Закон 1/r²: минимальное число точек и минимальный шаг по расстоянию, м. */
  distanceMinPoints: number;
  distanceMinSeparationM: number;
  distanceMinDistM: number;
  distanceMaxDistM: number;
  /** Минимальный полезный сигнал над фоном, мкЗв/ч. */
  distanceMinNetUSvh: number;
  /** Экран: минимальное ослабление K и время интегрирования измерения, с. */
  shieldMinK: number;
  shieldIntegrateSec: number;
  /** ALARA: порог входа/выхода из зоны высокой дозы, мкЗв/ч (гистерезис). */
  highDoseEnterUSvh: number;
  highDoseExitUSvh: number;
  alaraMinWorkSec: number;
  alaraMaxLimitMSv: number;
  /** Загрязнение: расстояние до поверхности, скорость скана, время и покрытие. */
  scanMaxSurfaceDistM: number;
  scanMinSpeedMps: number;
  scanMaxSpeedMps: number;
  scanRequiredSec: number;
  scanMinLevel: number;
  scanCellSizeM: number;
  scanMinCells: number;
  /** Потеря контакта/условий дольше этого времени сбрасывает накопленный скан, с. */
  scanGraceSec: number;
  /** Для α/β-скана нужен прибор, регистрирующий α/β. */
  scanRequireAlphaBetaInstrument: boolean;
  /** Максимальный dt, засчитываемый в таймеры, с. */
  maxDtSec: number;
}

export const DEFAULT_QUEST_CONFIG: QuestConfig = {
  backgroundMinDistM: 3.0,
  backgroundHoldSec: 3.0,
  backgroundMaxRelStd: 0.25,
  distanceMinPoints: 3,
  distanceMinSeparationM: 0.5,
  distanceMinDistM: 0.3,
  distanceMaxDistM: 8,
  distanceMinNetUSvh: 0.05,
  shieldMinK: 1.25,
  shieldIntegrateSec: 1.5,
  highDoseEnterUSvh: 12,   // нижняя граница «зоны контролируемого доступа» (evaluateRadiationZone)
  highDoseExitUSvh: 10,
  alaraMinWorkSec: 8,
  alaraMaxLimitMSv: 20,
  scanMaxSurfaceDistM: 0.10,
  scanMinSpeedMps: 0.02,
  scanMaxSpeedMps: 0.5,
  scanRequiredSec: 6,
  scanMinLevel: 0.15,
  scanCellSizeM: 0.10,
  scanMinCells: 8,
  scanGraceSec: 1.0,
  scanRequireAlphaBetaInstrument: true,
  maxDtSec: 0.1
};
