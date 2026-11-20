/**
 * ALARA — Единый контракт состояния сценариев (Сценарии 1–3 + Сценарий №4 АЭС)
 * (src/state/scenarioContract.ts)
 *
 * Обеспечивает единый интерфейс управления состоянием и телеметрией для селектора
 * сценариев, HUD, тактического планшета и VR-панели.
 */

export type UnifiedScenarioId = 1 | 2 | 3 | 4;

export type UnifiedLifecyclePhase =
  | 'LOADING_ASSET'
  | 'BRIEFING_ENTRY'
  | 'ACTIVE_OPERATION'
  | 'CRITICAL_WARNING'
  | 'COMPLETED'
  | 'FAILED';

export interface UnifiedScenarioObjectiveItem {
  readonly id: string;
  readonly labelRu: string;
  readonly isDone: boolean;
  readonly isCurrent: boolean;
}

export interface UnifiedScenarioState {
  readonly scenarioId: UnifiedScenarioId;
  readonly titleRu: string;
  readonly phase: UnifiedLifecyclePhase;
  readonly stepNumber: number;
  readonly totalSteps: number;
  readonly stepTitleRu: string;
  readonly instructionRu: string;
  readonly elapsedSec: number;
  readonly maxDurationSec: number;
  readonly currentDoseRateMsvPerHour: number;
  readonly accumulatedDoseMsv: number;
  readonly doseLimitMsv: number;
  readonly isCompleted: boolean;
  readonly isFailed: boolean;
  readonly failureReasonRu: string | null;
  readonly warningMessageRu: string | null;
  readonly objectives: ReadonlyArray<UnifiedScenarioObjectiveItem>;
}

/**
 * Адаптер состояния штатных сценариев 1–3 к единому интерфейсу UnifiedScenarioState
 */
export function createLegacyScenarioStateAdapter(params: {
  scenarioId: number;
  titleRu: string;
  currentStepIndex: number;
  stages: ReadonlyArray<{ titleRu: string; taskRu: string }>;
  elapsedSec: number;
  maxDurationSec: number;
  currentDoseRateMicroSvPerHour: number;
  accumulatedDoseMsv: number;
  doseLimitMsv: number;
  isCompleted: boolean;
  isFailed: boolean;
  failureReasonRu: string | null;
  warningMessageRu: string | null;
}): UnifiedScenarioState {
  const safeId = (
    params.scenarioId >= 1 && params.scenarioId <= 4 ? params.scenarioId : 1
  ) as UnifiedScenarioId;
  const clampedIdx = Math.max(
    0,
    Math.min(params.stages.length - 1, params.currentStepIndex)
  );
  const currentStage = params.stages[clampedIdx];

  let phase: UnifiedLifecyclePhase = 'ACTIVE_OPERATION';
  if (params.isFailed) phase = 'FAILED';
  else if (params.isCompleted) phase = 'COMPLETED';
  else if (params.warningMessageRu) phase = 'CRITICAL_WARNING';

  return {
    scenarioId: safeId,
    titleRu: params.titleRu,
    phase,
    stepNumber: clampedIdx + 1,
    totalSteps: Math.max(1, params.stages.length),
    stepTitleRu: currentStage?.titleRu ?? 'Выполнение регламента РХБЗ',
    instructionRu: currentStage?.taskRu ?? '',
    elapsedSec: params.elapsedSec,
    maxDurationSec: params.maxDurationSec,
    currentDoseRateMsvPerHour: params.currentDoseRateMicroSvPerHour / 1000,
    accumulatedDoseMsv: params.accumulatedDoseMsv,
    doseLimitMsv: params.doseLimitMsv,
    isCompleted: params.isCompleted,
    isFailed: params.isFailed,
    failureReasonRu: params.failureReasonRu,
    warningMessageRu: params.warningMessageRu,
    objectives: params.stages.map((s, idx) => ({
      id: `sc${safeId}_stage_${idx + 1}`,
      labelRu: s.titleRu,
      isDone: params.isCompleted || idx < clampedIdx,
      isCurrent: !params.isCompleted && !params.isFailed && idx === clampedIdx
    }))
  };
}
