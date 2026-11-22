import React from 'react';
import {
  AlertTriangle,
  Droplets,
  Eye,
  EyeOff,
  Glasses,
  PackageCheck,
  Radiation,
  Tablet
} from 'lucide-react';
import { MchsToolId, NozzleSprayMode, TOOL_SLOTS } from '../scene/ToolManager';
import type { HoldProgressSnapshot } from '../vr/InteractionHoldSystem';
import type { CarriedHazardInfo, MchsMissionMetrics } from '../scene/EvacuationManager';
import { InstrumentId } from '../instruments/gostInstruments';
import { ScenarioDefinition } from '../scene/scenarios';
import {
  ComprehensiveProtectionAnalysis,
  PPELoadoutId,
  RemoteToolId
} from '../physics/gostPhysics';
import { FloatingAnalyticsWindow, TelemetryHistoryPoint } from './FloatingAnalyticsWindow';
import type {
  VoiceLogEntry,
  VoiceLoggerMode,
  VoiceToastFeedItem
} from '../vr/voiceTaskLogger';
import type { IScenarioConfig } from '../scene/scenarioConfigRegistry';
import type { ScenarioRulesEvaluationResult } from '../scene/scenarioRulesEngine';
import { ScenarioFailedModal } from './ScenarioFailedModal';
import { useXR } from '../vr/VRManager';
import type { SessionExposureLimitsTracker } from '../utils/pdfDoseReportExporter';
import type { Scenario4HudSnapshot } from '../scenarios/scenario4-npp-rescue/config';
import {
  RADIONUCLIDES,
  SHIELD_MATERIALS,
  RadionuclideId,
  ShieldMaterialId,
  calculateDoseRateDetailed,
  accumulateDose
} from '../physics/PhysicsEngine';

export interface TargetedObjectContext {
  id: string;
  nameRu: string;
  type:
    | 'shield'
    | 'valve'
    | 'container'
    | 'source'
    | 'sample'
    | 'cover'
    | 'flashlight'
    | 'breaker'
    | 'extinguisher'
    | 'hydrant'
    | 'generator'
    | 'evac_point'
    | 'spill'
    | 'extractable'
    | 'casualty'
    | 'control_unit'
    | 'drop_zone';
  distanceM: number;
  isGrabbed?: boolean;
  holdPromptRu?: string;
  requiresTongs?: boolean;
  recommendedSlot?: number;
}

export interface DesktopDebugHUDProps {
  readonly currentDoseRateMsvPerHour?: number;
  readonly accumulatedDoseMsv?: number;
  readonly activeIsotopeId?: RadionuclideId;
  readonly distanceMeters?: number;
  readonly activityGBq?: number;
  readonly shieldMaterialId?: ShieldMaterialId;
  readonly shieldThicknessCm?: number;
  readonly isFlashlightOn?: boolean;
  readonly onToggleFlashlight?: () => void;
}

/**
 * Автономный отладочный 2D HUD для режима Desktop/Debug.
 * При входе в VR-шлем (isPresenting === true) полностью исключается из рендера (return null).
 */
export const DesktopDebugHUD: React.FC<DesktopDebugHUDProps> = ({
  currentDoseRateMsvPerHour,
  accumulatedDoseMsv = 0,
  activeIsotopeId = 'Cs-137',
  distanceMeters = 1.5,
  activityGBq = 10.0,
  shieldMaterialId = 'lead',
  shieldThicknessCm = 2.0,
  isFlashlightOn = false,
  onToggleFlashlight
}) => {
  const { isPresenting } = useXR();

  if (isPresenting) {
    return null;
  }

  const nuclide = RADIONUCLIDES[activeIsotopeId] ?? RADIONUCLIDES['Cs-137'];
  const shieldMat = SHIELD_MATERIALS[shieldMaterialId] ?? SHIELD_MATERIALS.lead;
  const calc = calculateDoseRateDetailed({
    radionuclide: nuclide,
    activityGBq,
    distanceMeters,
    shieldLayers: shieldThicknessCm > 0 ? [{ material: shieldMat, thicknessCm: shieldThicknessCm }] : []
  });

  const displayRateMsv =
    typeof currentDoseRateMsvPerHour === 'number'
      ? currentDoseRateMsvPerHour
      : calc.doseRateMsvPerHour;
  const nextMinuteDoseMsv = accumulateDose(displayRateMsv, 60, accumulatedDoseMsv);

  return (
    <div className="pointer-events-auto rounded-xl border border-white/10 bg-slate-950/90 p-3 text-xs text-slate-200 shadow-xl">
      <div className="flex items-center justify-between border-b border-white/10 pb-1.5 mb-2">
        <span className="font-semibold text-amber-300">Ядро ГОСТ Р 54413-2011</span>
        <span className="font-mono tabular-nums text-[11px] text-emerald-300">
          {nuclide.symbol} · Kγ={nuclide.kGamma}
        </span>
      </div>
      <div className="grid grid-cols-2 gap-2 font-mono tabular-nums text-[11px]">
        <div>
          <span className="text-slate-400">МЭД H(r): </span>
          <b className="text-white">{displayRateMsv.toFixed(4)} мЗв/ч</b>
        </div>
        <div>
          <span className="text-slate-400">Доза H(t): </span>
          <b className="text-amber-300">{accumulatedDoseMsv.toFixed(4)} мЗв</b>
        </div>
        <div>
          <span className="text-slate-400">B(μx): </span>
          <b className="text-sky-300">{calc.effectiveBuildupFactor.toFixed(2)}</b>
        </div>
        <div>
          <span className="text-slate-400">K_att: </span>
          <b className="text-emerald-300">×{calc.attenuationFactor.toFixed(1)}</b>
        </div>
        <div className="col-span-2 text-slate-400">
          Экран: <span className="text-slate-200">{shieldMat.nameRu}</span> ({shieldThicknessCm} см) · +60с:{' '}
          {nextMinuteDoseMsv.toFixed(4)} мЗв
        </div>
      </div>
      {onToggleFlashlight && (
        <button
          onClick={onToggleFlashlight}
          className="mt-2 w-full rounded-lg bg-slate-800 hover:bg-slate-700 py-1.5 text-[11px] font-medium text-amber-300 transition whitespace-nowrap"
        >
          Фонарь (5500K): {isFlashlightOn ? 'Вкл' : 'Выкл'}
        </button>
      )}
    </div>
  );
};

interface HUDProps {
  scenario: ScenarioDefinition;
  scenarioStep: number;
  onScenarioChange?: (id: number) => void;
  selectedInstrumentId?: InstrumentId;
  onInstrumentChange?: (id: InstrumentId) => void;
  isAudioMuted?: boolean;
  onToggleAudio?: () => void;
  threatLevel: 'normal' | 'warning' | 'danger';
  zoneName?: string;
  cumulativeDoseMsv: number;
  currentDoseRateMicroSv: number;
  vitalsBpm?: number;
  isCrouched?: boolean;
  onToggleCrouch?: () => void;
  isExtendedArm?: boolean;
  onToggleExtendArm?: () => void;
  isGripped?: boolean;
  onToggleGrip?: () => void;
  onRotateWrist?: () => void;
  isTeleportActive?: boolean;
  onToggleTeleport?: () => void;
  onOpenGostGuide?: () => void;
  onOpenAlaraReport?: () => void;
  onToggleVR: () => void;
  isVRSupported: boolean;
  isInVR: boolean;
  isRadiationFieldVisible?: boolean;
  onToggleRadiationField?: () => void;
  telemetryHistory: TelemetryHistoryPoint[];
  protectionAnalysis: ComprehensiveProtectionAnalysis;
  missionTimeSec: number;
  permitLimitMsv: number;
  onChangePermitLimitMsv: (limitMsv: number) => void;
  selectedPpeId: PPELoadoutId;
  onChangePpeId: (id: PPELoadoutId) => void;
  selectedRemoteToolId: RemoteToolId;
  onChangeRemoteToolId: (id: RemoteToolId) => void;
  onResetCharts: () => void;
  isFlashlightOn?: boolean;
  isFlashlightEquipped?: boolean;
  onToggleFlashlight?: () => void;
  isLowLightMode?: boolean;
  onToggleLowLightMode?: () => void;
  hapticStrength?: number;
  onChangeHapticStrength?: (strength: number) => void;
  voiceLogs: ReadonlyArray<VoiceLogEntry>;
  isVoicePushToTalkActive: boolean;
  voiceMode: VoiceLoggerMode;
  voiceVolumeLevel: number;
  voiceInterimTranscript: string;
  latestVoiceToast: VoiceToastFeedItem | null;
  onStartVoicePushToTalk?: () => void;
  onStopVoicePushToTalk?: () => void;
  onToggleVoiceMode?: () => void;
  onSubmitVoiceFallbackText: (text: string, mode?: VoiceLoggerMode) => void;
  isAnalyticsMinimized: boolean;
  onToggleAnalyticsMinimized: (minimized: boolean) => void;
  exportCsvSignal: number;
  scenarioConfig: IScenarioConfig;
  rulesEvaluation: ScenarioRulesEvaluationResult | null;
  onResetScenario: () => void;
  visible?: boolean;
  onToggleVisibility?: (visible: boolean) => void;
  onOpenMainMenu?: () => void;
  onOpenTablet?: () => void;
  onOpenLabNotebook?: () => void;
  onOpenSpectrometry?: () => void;
  isExamMode?: boolean;
  onChangeExamMode?: (exam: boolean) => void;
  onStepChange?: (step: number) => void;
  targetedObject?: TargetedObjectContext | null;
  coopRoleCallsign?: string;
  coopPeersCount?: number;
  onCycleCoopRole?: () => void;
  oxygenPercent?: number;
  spO2Percent?: number;
  coreBodyTempC?: number;
  hilLabel?: string;
  hilCountsPerSec?: number;
  hilProtocolTitle?: string;
  onConnectHil?: () => void;
  isRandomizedHazardMode?: boolean;
  onToggleRandomizedHazardMode?: () => void;
  onOpenAAR?: () => void;
  doseResetCount?: number;
  getSessionLimitsSummary?: () => SessionExposureLimitsTracker;
  activeToolId?: MchsToolId;
  onSelectTool?: (id: MchsToolId) => void;
  holdSnapshot?: HoldProgressSnapshot | null;
  carriedHazard?: CarriedHazardInfo | null;
  mchsMetrics?: MchsMissionMetrics;
  scenario4Snapshot?: Scenario4HudSnapshot | null;
  nozzleSprayMode?: NozzleSprayMode;
  onToggleNozzleSprayMode?: () => void;
  isAnalyticsWindowOpen?: boolean;
  onCloseAnalyticsWindow?: () => void;
}

export const HUD: React.FC<HUDProps> = ({
  scenario,
  scenarioStep,
  threatLevel,
  cumulativeDoseMsv,
  currentDoseRateMicroSv,
  onToggleVR,
  isVRSupported,
  isInVR,
  telemetryHistory,
  protectionAnalysis,
  missionTimeSec,
  permitLimitMsv,
  onChangePermitLimitMsv,
  selectedPpeId,
  onChangePpeId,
  selectedRemoteToolId,
  onChangeRemoteToolId,
  onResetCharts,
  voiceLogs,
  isVoicePushToTalkActive,
  voiceMode,
  voiceVolumeLevel,
  voiceInterimTranscript,
  latestVoiceToast,
  onSubmitVoiceFallbackText,
  isAnalyticsMinimized,
  onToggleAnalyticsMinimized,
  exportCsvSignal,
  scenarioConfig,
  rulesEvaluation,
  onResetScenario,
  visible = true,
  onToggleVisibility,
  onOpenMainMenu,
  onOpenTablet,
  targetedObject = null,
  doseResetCount = 0,
  getSessionLimitsSummary,
  activeToolId = 'dp5',
  onSelectTool,
  holdSnapshot = null,
  carriedHazard = null,
  mchsMetrics,
  scenario4Snapshot = null,
  nozzleSprayMode = 'SPRAY',
  onToggleNozzleSprayMode,
  isAnalyticsWindowOpen = false,
  onCloseAnalyticsWindow
}) => {
  const { isPresenting } = useXR(undefined, isInVR);

  // Строгое исключение 2D HTML-оверлея при надетом VR-шлеме
  if (isPresenting || isInVR) {
    return null;
  }

  const openTabletHandler = onOpenTablet ?? onOpenMainMenu;

  const tMaxSec = scenarioConfig?.tMaxSec || 300;
  const remainingMissionSec = Math.max(0, tMaxSec - missionTimeSec);
  const remMins = Math.floor(remainingMissionSec / 60);
  const remSecs = Math.floor(remainingMissionSec % 60);
  const countdownFormatted = `${remMins.toString().padStart(2, '0')}:${remSecs
    .toString()
    .padStart(2, '0')}`;

  const formattedDoseRate =
    currentDoseRateMicroSv < 1000
      ? currentDoseRateMicroSv.toFixed(1)
      : (currentDoseRateMicroSv / 1000).toFixed(2);
  const doseRateUnit = currentDoseRateMicroSv < 1000 ? 'мкЗв/ч' : 'мЗв/ч';

  const threatTextColor =
    threatLevel === 'danger'
      ? 'text-rose-300'
      : threatLevel === 'warning'
      ? 'text-amber-300'
      : 'text-emerald-300';

  const isScenario4 = scenario.id === 4 && Boolean(scenario4Snapshot);
  const activeStepNumber = isScenario4 ? scenario4Snapshot!.stepNumber : scenarioStep + 1;
  const totalSteps = isScenario4 ? scenario4Snapshot!.totalSteps : scenario.stages.length;

  const holdProgress01 = holdSnapshot?.isHolding ? holdSnapshot.progress : 0;
  const isHoldingAny = Boolean(holdSnapshot?.isHolding);
  const holdLabel = holdSnapshot?.isHolding ? holdSnapshot.labelRu : null;

  // Контекстная подсказка у прицела
  const scen4Prompt = isScenario4 && !scenario4Snapshot!.debrief ? scenario4Snapshot!.targetPromptRu : null;
  const showCrosshairPrompt = Boolean(scen4Prompt || targetedObject || holdLabel);

  // Режим 100% скрытия HUD ([H]): оставляем только кнопку возврата в углу + критические системные модалки
  if (!visible) {
    return (
      <>
        <ScenarioFailedModal
          failState={rulesEvaluation?.failState ?? null}
          isWarning80Active={Boolean(rulesEvaluation?.isWarning80Active)}
          warning80MessageRu={rulesEvaluation?.warning80MessageRu ?? null}
          doseProgressRatio={rulesEvaluation?.doseProgressRatio ?? 0}
          timeProgressRatio={rulesEvaluation?.timeProgressRatio ?? 0}
          onResetImmediately={onResetScenario}
          zoneAlertLevel={rulesEvaluation?.zoneAlertLevel ?? 'green'}
          isRetreatCountdownActive={Boolean(rulesEvaluation?.isRetreatCountdownActive)}
          retreatCountdownRemainingSec={rulesEvaluation?.retreatCountdownRemainingSec ?? 8.0}
          retreatAlertMessageRu={rulesEvaluation?.retreatAlertMessageRu ?? null}
        />

        <FloatingAnalyticsWindow
          isOpen={isAnalyticsWindowOpen}
          onClose={() => onCloseAnalyticsWindow?.()}
          history={telemetryHistory}
          currentAnalysis={protectionAnalysis}
          cumulativeDoseMsv={cumulativeDoseMsv}
          missionTimeSec={missionTimeSec}
          permitLimitMsv={permitLimitMsv}
          onChangePermitLimitMsv={onChangePermitLimitMsv}
          selectedPpeId={selectedPpeId}
          onChangePpeId={onChangePpeId}
          selectedRemoteToolId={selectedRemoteToolId}
          onChangeRemoteToolId={onChangeRemoteToolId}
          onResetCharts={onResetCharts}
          scenarioTitle={`${scenario.titleRu} — ${scenario.facilityRu}`}
          voiceLogs={voiceLogs}
          isMinimizedExternal={isAnalyticsMinimized}
          onToggleMinimizedExternal={onToggleAnalyticsMinimized}
          exportCsvSignal={exportCsvSignal}
          onSubmitVoiceFallbackText={onSubmitVoiceFallbackText}
          scenarioConfig={scenarioConfig}
          scenarioMeta={{
            id: scenario.id,
            titleRu: scenario.titleRu,
            facilityRu: scenario.facilityRu,
            categoryRu: scenario.categoryRu,
            shortDescriptionRu: scenario.shortDescriptionRu,
            dominantIsotopes: scenario.dominantIsotopes,
            recommendedPermitLimitMsv: scenario.recommendedPermitLimitMsv
          }}
          rulesEvaluation={rulesEvaluation}
          onResetScenario={onResetScenario}
          doseResetCount={doseResetCount}
          getSessionLimitsSummary={getSessionLimitsSummary}
          mchsMetrics={mchsMetrics}
        />

        <div className="fixed top-3 right-3 z-50 pointer-events-auto">
          <button
            type="button"
            onClick={() => onToggleVisibility?.(true)}
            className="px-3 py-1.5 rounded-lg bg-slate-950/90 hover:bg-slate-900 text-slate-200 border border-slate-700 shadow-lg transition flex items-center gap-1.5 text-xs font-mono cursor-pointer"
            title="Показать 2D HUD [H]"
          >
            <Eye className="w-3.5 h-3.5 text-amber-400" />
            <span>[H] Показать HUD</span>
          </button>
        </div>
      </>
    );
  }

  // Основные слоты 1–4 + дополнительные 5–6
  const primarySlots = TOOL_SLOTS.filter(s => s.slot <= 4);
  const secondarySlots = TOOL_SLOTS.filter(s => s.slot > 4);
  const ringCircumference = 2 * Math.PI * 19;
  const ringOffset = ringCircumference * (1 - Math.min(1, Math.max(0, holdProgress01)));

  return (
    <>
      <ScenarioFailedModal
        failState={rulesEvaluation?.failState ?? null}
        isWarning80Active={Boolean(rulesEvaluation?.isWarning80Active)}
        warning80MessageRu={rulesEvaluation?.warning80MessageRu ?? null}
        doseProgressRatio={rulesEvaluation?.doseProgressRatio ?? 0}
        timeProgressRatio={rulesEvaluation?.timeProgressRatio ?? 0}
        onResetImmediately={onResetScenario}
        zoneAlertLevel={rulesEvaluation?.zoneAlertLevel ?? 'green'}
        isRetreatCountdownActive={Boolean(rulesEvaluation?.isRetreatCountdownActive)}
        retreatCountdownRemainingSec={rulesEvaluation?.retreatCountdownRemainingSec ?? 8.0}
        retreatAlertMessageRu={rulesEvaluation?.retreatAlertMessageRu ?? null}
      />

      <FloatingAnalyticsWindow
        isOpen={isAnalyticsWindowOpen}
        onClose={() => onCloseAnalyticsWindow?.()}
        history={telemetryHistory}
        currentAnalysis={protectionAnalysis}
        cumulativeDoseMsv={cumulativeDoseMsv}
        missionTimeSec={missionTimeSec}
        permitLimitMsv={permitLimitMsv}
        onChangePermitLimitMsv={onChangePermitLimitMsv}
        selectedPpeId={selectedPpeId}
        onChangePpeId={onChangePpeId}
        selectedRemoteToolId={selectedRemoteToolId}
        onChangeRemoteToolId={onChangeRemoteToolId}
        onResetCharts={onResetCharts}
        scenarioTitle={`${scenario.titleRu} — ${scenario.facilityRu}`}
        voiceLogs={voiceLogs}
        isMinimizedExternal={isAnalyticsMinimized}
        onToggleMinimizedExternal={onToggleAnalyticsMinimized}
        exportCsvSignal={exportCsvSignal}
        onSubmitVoiceFallbackText={onSubmitVoiceFallbackText}
        scenarioConfig={scenarioConfig}
        scenarioMeta={{
          id: scenario.id,
          titleRu: scenario.titleRu,
          facilityRu: scenario.facilityRu,
          categoryRu: scenario.categoryRu,
          shortDescriptionRu: scenario.shortDescriptionRu,
          dominantIsotopes: scenario.dominantIsotopes,
          recommendedPermitLimitMsv: scenario.recommendedPermitLimitMsv
        }}
        rulesEvaluation={rulesEvaluation}
        onResetScenario={onResetScenario}
        doseResetCount={doseResetCount}
        getSessionLimitsSummary={getSessionLimitsSummary}
        mchsMetrics={mchsMetrics}
      />

      {/* Контекстный уведомитель голоса (PTT [V]) — только во время записи или свежего тоста */}
      {(isVoicePushToTalkActive || latestVoiceToast) && (
        <div className="fixed top-14 left-1/2 -translate-x-1/2 z-40 pointer-events-none max-w-md w-[88vw]">
          <div
            className={`bg-slate-950/92 border rounded-xl px-3.5 py-2 shadow-xl ${
              isVoicePushToTalkActive
                ? 'border-emerald-400/70'
                : latestVoiceToast?.kind === 'error'
                ? 'border-rose-500/70'
                : latestVoiceToast?.kind === 'command'
                ? 'border-sky-400/70'
                : 'border-amber-400/70'
            }`}
          >
            <div className="flex items-center justify-between gap-3 mb-0.5">
              <span className="text-[10px] font-mono font-semibold text-emerald-300">
                {isVoicePushToTalkActive
                  ? `Голос PTT [${
                      voiceMode === 'commands'
                        ? 'Команды'
                        : voiceMode === 'dictation'
                        ? 'Протокол'
                        : 'Авто NLU'
                    }]`
                  : latestVoiceToast?.title}
              </span>
              <div className="flex items-center gap-0.5 h-2.5">
                {[0, 1, 2, 3, 4].map(idx => {
                  const activeBar = isVoicePushToTalkActive
                    ? Math.max(20, Math.min(100, Math.round(voiceVolumeLevel * 100 - idx * 12)))
                    : 20;
                  return (
                    <span
                      key={idx}
                      className={`w-1 rounded-sm ${
                        isVoicePushToTalkActive ? 'bg-emerald-400' : 'bg-slate-600'
                      }`}
                      style={{ height: `${activeBar}%` }}
                    />
                  );
                })}
              </div>
            </div>
            <div className="text-xs text-white leading-snug">
              {isVoicePushToTalkActive
                ? voiceInterimTranscript || 'Произнесите замер или команду...'
                : latestVoiceToast?.text}
            </div>
          </div>
        </div>
      )}

      {/* ВЕРХНЯЯ ПАНЕЛЬ: единая компактная строка телеметрии слева + системные кнопки справа */}
      <div className="fixed top-3 left-3 right-3 z-40 flex items-center justify-between gap-2 pointer-events-none">
        <button
          type="button"
          onClick={() => openTabletHandler?.()}
          className="pointer-events-auto flex items-center gap-2.5 px-3 py-1.5 rounded-lg bg-slate-950/90 hover:bg-slate-900 border border-white/12 shadow-lg text-[11px] font-mono tabular-nums text-slate-200 cursor-pointer whitespace-nowrap"
          title="Открыть Тактический Планшет [Tab]"
        >
          <span className="font-bold text-sky-300">Сц. {scenario.id}</span>
          <span className="text-slate-500">·</span>
          <span className="text-slate-300">
            Фаза {activeStepNumber}/{totalSteps}
          </span>
          <span className="text-slate-500">·</span>
          <span className={`flex items-center gap-1 font-semibold ${threatTextColor}`}>
            <Radiation className="w-3 h-3 shrink-0" />
            {formattedDoseRate} {doseRateUnit}
          </span>
          <span className="text-slate-400 hidden sm:inline">
            · Доза {(cumulativeDoseMsv * 1000).toFixed(1)} мкЗв
          </span>
          <span className="text-slate-500 hidden md:inline">· {countdownFormatted}</span>
        </button>

        <div className="pointer-events-auto flex items-center gap-1.5">
          {openTabletHandler && (
            <button
              type="button"
              onClick={openTabletHandler}
              className="px-2.5 py-1.5 rounded-lg bg-slate-950/90 hover:bg-slate-900 border border-white/12 text-slate-200 text-xs font-medium flex items-center gap-1.5 shadow-lg cursor-pointer whitespace-nowrap"
              title="Тактический Планшет [Tab]"
            >
              <Tablet className="w-3.5 h-3.5 text-sky-400" />
              <span className="hidden sm:inline">Планшет</span>
              <span className="text-[10px] font-mono text-slate-400">[Tab]</span>
            </button>
          )}

          <button
            type="button"
            onClick={onToggleVR}
            disabled={!isVRSupported}
            className={`px-2.5 py-1.5 rounded-lg text-xs font-medium border shadow-lg flex items-center gap-1 whitespace-nowrap ${
              isVRSupported
                ? 'bg-slate-950/90 hover:bg-slate-900 border-white/12 text-amber-300 cursor-pointer'
                : 'bg-slate-950/60 border-white/5 text-slate-500 cursor-not-allowed'
            }`}
            title={isVRSupported ? 'Войти в VR-режим (WebXR)' : 'WebXR не обнаружен'}
          >
            <Glasses className="w-3.5 h-3.5" />
            <span>VR</span>
          </button>

          <button
            type="button"
            onClick={() => onToggleVisibility?.(false)}
            className="px-2.5 py-1.5 rounded-lg bg-slate-950/90 hover:bg-slate-900 border border-white/12 text-slate-300 text-xs flex items-center gap-1 shadow-lg cursor-pointer whitespace-nowrap"
            title="Скрыть 2D HUD [H]"
          >
            <EyeOff className="w-3.5 h-3.5" />
            <span className="hidden md:inline font-mono text-[10px] text-slate-400">[H]</span>
          </button>
        </div>
      </div>

      {/* ЦЕНТРАЛЬНЫЙ ПРИЦЕЛ + КОЛЬЦЕВОЙ ИНДИКАТОР УДЕРЖАНИЯ + КОНТЕКСТНАЯ ПОДСКАЗКА */}
      <div className="fixed inset-0 pointer-events-none flex items-center justify-center z-20">
        <div className="relative flex items-center justify-center">
          {/* Круговой SVG-индикатор прогресса удержания (только во время зажима) */}
          {isHoldingAny && holdProgress01 > 0 && (
            <svg className="w-12 h-12 -rotate-90" viewBox="0 0 44 44">
              <circle
                cx="22"
                cy="22"
                r="19"
                fill="none"
                stroke="rgba(15, 23, 42, 0.75)"
                strokeWidth="3"
              />
              <circle
                cx="22"
                cy="22"
                r="19"
                fill="none"
                stroke="#34d399"
                strokeWidth="3"
                strokeLinecap="round"
                strokeDasharray={ringCircumference}
                strokeDashoffset={ringOffset}
              />
            </svg>
          )}

          {/* Точка прицела 6px */}
          <div
            className={`absolute w-1.5 h-1.5 rounded-full border border-slate-950 ${
              isHoldingAny
                ? 'bg-emerald-400 scale-125'
                : targetedObject || scen4Prompt
                ? 'bg-amber-300'
                : 'bg-white/75'
            }`}
          />

          {/* Единая компактная строка взаимодействия ровно под прицелом (только при наведении/удержании) */}
          {showCrosshairPrompt && (
            <div className="absolute top-8 left-1/2 -translate-x-1/2 whitespace-nowrap max-w-[85vw]">
              {holdLabel && holdProgress01 > 0 ? (
                <div className="px-3 py-1 rounded-lg bg-slate-950/92 border border-emerald-400/70 text-[11px] font-mono text-emerald-300 shadow-lg">
                  {holdLabel} — {Math.round(holdProgress01 * 100)}%
                </div>
              ) : scen4Prompt ? (
                <div className="px-3 py-1.5 rounded-lg bg-slate-950/92 border border-sky-400/70 text-[11px] text-sky-100 font-medium shadow-lg">
                  {scen4Prompt}
                </div>
              ) : targetedObject ? (
                <div className="px-3 py-1.5 rounded-lg bg-slate-950/90 border border-slate-700 text-[11px] text-slate-100 shadow-lg flex items-center gap-2">
                  <span className="font-bold text-white">{targetedObject.nameRu}</span>
                  <span className="text-slate-400 font-mono">{targetedObject.distanceM.toFixed(1)}м</span>
                  <span className="text-amber-300 font-mono">
                    {targetedObject.isGrabbed
                      ? '[E] Отпустить'
                      : targetedObject.holdPromptRu
                      ? `[E/ЛКМ] ${targetedObject.holdPromptRu}`
                      : targetedObject.requiresTongs
                      ? '[6] Щипцы + [E]'
                      : '[E] Взять'}
                  </span>
                </div>
              ) : null}
            </div>
          )}
        </div>
      </div>

      {/* НИЖНИЙ КОМПАКТНЫЙ ХОТБАР ИНСТРУМЕНТОВ [1–4] + ДОП. [5–6] */}
      <div className="fixed bottom-3 left-1/2 -translate-x-1/2 z-40 pointer-events-auto flex flex-col items-center gap-1.5 max-w-[96vw]">
        {/* Индикатор переносимого в САР опасного объекта — появляется только при переноске */}
        {carriedHazard && (
          <div
            className={`px-3 py-1 rounded-lg border text-[11px] font-medium flex items-center gap-2 shadow-lg ${
              carriedHazard.bareHandViolation
                ? 'bg-rose-950/95 border-rose-500/70 text-rose-200'
                : 'bg-emerald-950/95 border-emerald-500/70 text-emerald-200'
            }`}
          >
            {carriedHazard.bareHandViolation ? (
              <AlertTriangle className="w-3.5 h-3.5 text-rose-400 shrink-0" />
            ) : (
              <PackageCheck className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
            )}
            <span>
              В руках: <strong>{carriedHazard.item.nameRu}</strong>
              {carriedHazard.nearestDropZoneDistanceM !== null
                ? ` · До САР: ${carriedHazard.nearestDropZoneDistanceM.toFixed(1)} м`
                : ' · Донесите до контейнера САР [E]'}
            </span>
          </div>
        )}

        {/* Строка слотов инструментов */}
        <div className="flex items-center gap-1 px-1.5 py-1 rounded-lg bg-slate-950/90 border border-white/12 shadow-xl">
          {primarySlots.map(slot => {
            const isSelected = activeToolId === slot.id;
            return (
              <button
                key={slot.id}
                type="button"
                onClick={() => onSelectTool?.(slot.id)}
                className={`px-2.5 py-1 rounded-md text-[11px] font-mono transition flex items-center gap-1.5 cursor-pointer whitespace-nowrap ${
                  isSelected
                    ? 'bg-sky-500 text-slate-950 font-bold shadow'
                    : 'bg-slate-900/90 hover:bg-slate-800 text-slate-300 border border-white/8'
                }`}
                title={`${slot.nameRu} — ${slot.purposeRu} [${slot.hotkey}]`}
              >
                <span className={isSelected ? 'text-slate-950 font-black' : 'text-sky-400'}>
                  [{slot.hotkey}]
                </span>
                <span>{slot.shortNameRu}</span>
              </button>
            );
          })}

          {!isScenario4 && (
            <>
              <div className="w-px h-5 bg-white/10 mx-0.5 hidden sm:block" />
              {secondarySlots.map(slot => {
                const isSelected = activeToolId === slot.id;
                return (
                  <button
                    key={slot.id}
                    type="button"
                    onClick={() => onSelectTool?.(slot.id)}
                    className={`px-2 py-1 rounded-md text-[11px] font-mono transition hidden sm:flex items-center gap-1 cursor-pointer whitespace-nowrap ${
                      isSelected
                        ? 'bg-amber-400 text-slate-950 font-bold shadow'
                        : 'bg-slate-900/60 hover:bg-slate-800 text-slate-400 border border-white/8'
                    }`}
                    title={`${slot.nameRu} — ${slot.purposeRu} [${slot.hotkey}]`}
                  >
                    <span className={isSelected ? 'text-slate-950 font-black' : 'text-slate-500'}>
                      [{slot.hotkey}]
                    </span>
                    <span>{slot.shortNameRu}</span>
                  </button>
                );
              })}
            </>
          )}

          {/* Переключатель режима струи [Q] только при активном стволе/огнетушителе [3] */}
          {activeToolId === 'extinguisher' && (
            <button
              type="button"
              onClick={onToggleNozzleSprayMode}
              className="ml-0.5 px-2.5 py-1 rounded-md text-[11px] font-mono font-semibold bg-cyan-950/90 hover:bg-cyan-900 border border-cyan-400/45 text-cyan-200 flex items-center gap-1 cursor-pointer whitespace-nowrap"
              title="Переключить режим струи [Q]"
            >
              <Droplets className="w-3 h-3 text-cyan-300" />
              <span>[Q] {nozzleSprayMode === 'SOLID' ? 'Сплошная' : 'Распыл'}</span>
            </button>
          )}
        </div>
      </div>
    </>
  );
};
