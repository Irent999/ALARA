import React, { useState } from 'react';
import {
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Droplets,
  Eye,
  EyeOff,
  Glasses,
  PackageCheck,
  Radiation,
  RotateCcw,
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
import type { XRDiagnosticsStatus } from '../scene/webxrManager';
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
    <div className="pointer-events-auto rounded-xl alara-glass p-3 text-xs text-[#F1F5F9]">
      <div className="flex items-center justify-between border-b border-slate-400/15 pb-1.5 mb-2">
        <span className="font-semibold text-[#F59E0B]">Ядро ГОСТ Р 54413-2011</span>
        <span className="font-mono alara-tabular text-[11px] text-[#10B981]">
          {nuclide.symbol} · Kγ={nuclide.kGamma}
        </span>
      </div>
      <div className="grid grid-cols-2 gap-2 font-mono alara-tabular text-[11px]">
        <div>
          <span className="text-[#94A3B8]">МЭД H(r): </span>
          <b className="text-[#F1F5F9]">{displayRateMsv.toFixed(4)} мЗв/ч</b>
        </div>
        <div>
          <span className="text-[#94A3B8]">Доза H(t): </span>
          <b className="text-[#F59E0B]">{accumulatedDoseMsv.toFixed(4)} мЗв</b>
        </div>
        <div>
          <span className="text-[#94A3B8]">B(μx): </span>
          <b className="text-[#0EA5E9]">{calc.effectiveBuildupFactor.toFixed(2)}</b>
        </div>
        <div>
          <span className="text-[#94A3B8]">K_att: </span>
          <b className="text-[#10B981]">×{calc.attenuationFactor.toFixed(1)}</b>
        </div>
        <div className="col-span-2 text-[#94A3B8]">
          Экран: <span className="text-[#F1F5F9]">{shieldMat.nameRu}</span> ({shieldThicknessCm} см) · +60с:{' '}
          {nextMinuteDoseMsv.toFixed(4)} мЗв
        </div>
      </div>
      {onToggleFlashlight && (
        <button
          onClick={onToggleFlashlight}
          className="mt-2 w-full rounded-[10px] alara-surface hover:bg-slate-800/70 py-1.5 text-[11px] font-medium text-[#F59E0B] transition whitespace-nowrap cursor-pointer"
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
  vrDiagnostics?: XRDiagnosticsStatus;
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
  coopRoleBadgeCode?: string;
  coopRoleSummaryRu?: string;
  coopPeersCount?: number;
  onCycleCoopRole?: () => void;
  effectiveReachM?: number;
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
  onOpenGostGuide,
  onToggleVR,
  isVRSupported,
  isInVR,
  vrDiagnostics,
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
  onStepChange,
  targetedObject = null,
  coopRoleCallsign,
  coopRoleBadgeCode,
  coopRoleSummaryRu,
  onCycleCoopRole,
  effectiveReachM,
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
  const [isMissionCollapsed, setIsMissionCollapsed] = useState(true);
  const [isHintOpen, setIsHintOpen] = useState(false);

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
      ? 'text-[#EF4444]'
      : threatLevel === 'warning'
      ? 'text-[#F59E0B]'
      : 'text-[#10B981]';

  const isScenario4 = scenario.id === 4 && Boolean(scenario4Snapshot);
  const activeStepNumber = isScenario4 ? scenario4Snapshot!.stepNumber : scenarioStep + 1;
  const totalSteps = isScenario4 ? scenario4Snapshot!.totalSteps : scenario.stages.length;
  const currentStage = scenario.stages[scenarioStep] || scenario.stages[0];

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
            className="px-3 py-1.5 rounded-[10px] alara-glass hover:bg-slate-800/80 text-[#F1F5F9] transition flex items-center gap-1.5 text-xs font-mono cursor-pointer whitespace-nowrap"
            title="Показать 2D HUD [H]"
          >
            <Eye className="w-3.5 h-3.5 text-[#F59E0B]" />
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

      {/* Контекстный уведомитель голоса (PTT [V]) */}
      {(isVoicePushToTalkActive || latestVoiceToast) && (
        <div className="fixed top-14 left-1/2 -translate-x-1/2 z-40 pointer-events-none max-w-md w-[88vw]">
          <div
            className={`alara-glass rounded-xl px-3.5 py-2 ${
              isVoicePushToTalkActive
                ? 'border-[#10B981]/60'
                : latestVoiceToast?.kind === 'error'
                ? 'border-[#EF4444]/60'
                : latestVoiceToast?.kind === 'command'
                ? 'border-[#0EA5E9]/60'
                : 'border-[#F59E0B]/60'
            }`}
          >
            <div className="flex items-center justify-between gap-3 mb-0.5">
              <span className="text-[11px] font-mono font-semibold text-[#10B981]">
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
                        isVoicePushToTalkActive ? 'bg-[#10B981]' : 'bg-slate-600'
                      }`}
                      style={{ height: `${activeBar}%` }}
                    />
                  );
                })}
              </div>
            </div>
            <div className="text-xs text-[#F1F5F9] leading-snug">
              {isVoicePushToTalkActive
                ? voiceInterimTranscript || 'Произнесите замер или команду...'
                : latestVoiceToast?.text}
            </div>
          </div>
        </div>
      )}

      {/* ВЕРХНЯЯ ПАНЕЛЬ: единая компактная строка телеметрии слева + системные кнопки справа */}
      <div className="fixed top-3 left-3 right-3 z-40 flex items-center justify-between gap-2 pointer-events-none">
        <div className="pointer-events-auto flex items-center rounded-xl alara-glass overflow-hidden text-[12px] font-mono alara-tabular text-[#F1F5F9]">
          <button
            type="button"
            onClick={() => openTabletHandler?.()}
            className="flex items-center gap-2.5 px-3 py-1.5 hover:bg-slate-800/80 cursor-pointer whitespace-nowrap transition"
            title="Открыть Тактический Планшет [Tab]"
          >
            <span className="font-bold text-[#0EA5E9]">Сц. {scenario.id}</span>
            <span className="text-[#64748B]">·</span>
            <span className="text-[#94A3B8]">
              Фаза {activeStepNumber}/{totalSteps}
            </span>
            <span className="text-[#64748B]">·</span>
            <span className={`flex items-center gap-1 font-semibold ${threatTextColor}`}>
              <Radiation className="w-3.5 h-3.5 shrink-0" />
              {formattedDoseRate} {doseRateUnit}
            </span>
            <span className="text-[#94A3B8] hidden sm:inline">
              · Доза {(cumulativeDoseMsv * 1000).toFixed(1)} мкЗв
            </span>
            <span className="text-[#64748B] hidden md:inline">· {countdownFormatted}</span>
          </button>

          {(coopRoleBadgeCode || coopRoleCallsign || effectiveReachM !== undefined) && (
            <>
              <div className="w-px h-4 bg-slate-400/20 hidden lg:block" />
              <button
                type="button"
                onClick={() => onCycleCoopRole?.()}
                className="hidden lg:flex items-center gap-1.5 px-2.5 py-1.5 hover:bg-slate-800/80 text-[#14B8A6] cursor-pointer whitespace-nowrap transition"
                title={coopRoleSummaryRu ? `${coopRoleCallsign ?? coopRoleBadgeCode}: ${coopRoleSummaryRu} (нажмите для смены роли)` : 'Сменить роль звена РХБЗ'}
              >
                <span className="font-semibold">{coopRoleBadgeCode || coopRoleCallsign}</span>
                {effectiveReachM !== undefined && (
                  <span className="text-[#94A3B8]">· {effectiveReachM.toFixed(1)}м</span>
                )}
              </button>
            </>
          )}
        </div>

        <div className="pointer-events-auto flex items-center gap-1.5">
          {openTabletHandler && (
            <button
              type="button"
              onClick={openTabletHandler}
              className="px-3 py-1.5 rounded-[10px] alara-glass hover:bg-slate-800/80 text-[#F1F5F9] text-xs font-medium flex items-center gap-1.5 cursor-pointer whitespace-nowrap transition"
              title="Тактический Планшет [Tab]"
            >
              <Tablet className="w-3.5 h-3.5 text-[#0EA5E9]" />
              <span className="hidden sm:inline">Планшет</span>
              <span className="text-[11px] font-mono text-[#94A3B8]">[Tab]</span>
            </button>
          )}

          <button
            type="button"
            onClick={onToggleVR}
            className={`px-3 py-1.5 rounded-[10px] text-xs font-medium alara-glass flex items-center gap-1.5 whitespace-nowrap cursor-pointer transition ${
              isInVR
                ? 'bg-[#F59E0B]/20 border border-[#F59E0B]/60 text-[#F59E0B]'
                : isVRSupported
                ? 'hover:bg-slate-800/80 text-[#F59E0B]'
                : 'hover:bg-slate-800/80 text-[#94A3B8]'
            }`}
            title={
              vrDiagnostics
                ? `${vrDiagnostics.statusSummaryRu}. ${vrDiagnostics.lastErrorMessageRu || vrDiagnostics.hintRu}`
                : isVRSupported
                ? 'Войти в VR-режим (HTC Vive / WebXR)'
                : 'Проверить WebXR и войти в VR (HTC Vive / SteamVR)'
            }
          >
            <Glasses className="w-3.5 h-3.5" />
            <span>{isInVR ? 'Выход VR' : isVRSupported ? 'VR' : 'VR (?)'}</span>
          </button>

          <button
            type="button"
            onClick={() => onToggleVisibility?.(false)}
            className="px-2.5 py-1.5 rounded-[10px] alara-glass hover:bg-slate-800/80 text-[#94A3B8] hover:text-[#F1F5F9] text-xs flex items-center gap-1 cursor-pointer whitespace-nowrap transition"
            title="Скрыть 2D HUD [H]"
          >
            <EyeOff className="w-3.5 h-3.5" />
            <span className="hidden md:inline font-mono text-[11px]">[H]</span>
          </button>
        </div>
      </div>

      {/* КОЛЛАПСИРУЕМАЯ КАРТОЧКА ЗАДАЧИ ДЛЯ СЦЕНАРИЕВ 1–3 (унифицировано со Сценарием 4) */}
      {!isScenario4 && currentStage && (
        <div className="fixed top-14 left-3 z-30 pointer-events-auto max-w-sm">
          {isMissionCollapsed ? (
            <button
              type="button"
              onClick={() => setIsMissionCollapsed(false)}
              className="flex items-center gap-2 px-3 py-1.5 rounded-xl alara-glass hover:bg-slate-800/80 text-xs text-[#F1F5F9] transition cursor-pointer"
              title="Развернуть текущую задачу миссии"
            >
              <span className="font-mono alara-tabular font-semibold text-[#0EA5E9]">
                Задача {activeStepNumber}/{totalSteps}
              </span>
              <span className="text-[#94A3B8] truncate max-w-[210px]">{currentStage.titleRu}</span>
              <ChevronDown className="w-3.5 h-3.5 text-[#94A3B8] shrink-0" />
            </button>
          ) : (
            <div className="rounded-xl alara-glass p-3.5 space-y-2.5 text-xs text-[#F1F5F9]">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="font-mono alara-tabular text-[11px] font-semibold text-[#0EA5E9]">
                    Шаг {activeStepNumber} из {totalSteps}
                  </div>
                  <div className="font-semibold text-sm text-[#F1F5F9] truncate">
                    {currentStage.titleRu}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setIsMissionCollapsed(true)}
                  className="p-1.5 rounded-[10px] alara-surface hover:bg-slate-800/80 text-[#94A3B8] hover:text-[#F1F5F9] cursor-pointer shrink-0"
                  title="Свернуть карточку"
                >
                  <ChevronUp className="w-3.5 h-3.5" />
                </button>
              </div>

              <p className="text-[#94A3B8] leading-relaxed">{currentStage.taskRu}</p>

              {currentStage.hintRu && (
                <div>
                  <button
                    type="button"
                    onClick={() => setIsHintOpen(prev => !prev)}
                    className="flex items-center gap-1 text-[11px] font-medium text-[#14B8A6] hover:text-[#0EA5E9] cursor-pointer"
                  >
                    <ChevronRight
                      className={`w-3.5 h-3.5 transition-transform ${isHintOpen ? 'rotate-90' : ''}`}
                    />
                    <span>Подсказка ALARA</span>
                  </button>
                  {isHintOpen && (
                    <div className="mt-1.5 p-2.5 rounded-[10px] alara-surface text-[11px] text-[#94A3B8] leading-relaxed">
                      {currentStage.hintRu}
                    </div>
                  )}
                </div>
              )}

              <div className="flex flex-wrap items-center gap-1.5 pt-1 border-t border-slate-400/15">
                {onStepChange && scenarioStep < totalSteps - 1 && (
                  <button
                    type="button"
                    onClick={() => onStepChange(scenarioStep + 1)}
                    className="px-2.5 py-1.5 rounded-[10px] bg-[#0EA5E9] hover:bg-sky-400 text-[#0B1117] font-semibold text-[11px] cursor-pointer whitespace-nowrap transition"
                  >
                    Зачесть шаг →
                  </button>
                )}
                {onOpenGostGuide && (
                  <button
                    type="button"
                    onClick={onOpenGostGuide}
                    className="px-2.5 py-1.5 rounded-[10px] alara-surface hover:bg-slate-800/80 text-[#F1F5F9] text-[11px] font-medium cursor-pointer whitespace-nowrap transition"
                  >
                    Приборы ГОСТ
                  </button>
                )}
                <button
                  type="button"
                  onClick={onResetScenario}
                  className="ml-auto px-2.5 py-1.5 rounded-[10px] alara-surface hover:bg-slate-800/80 text-[#94A3B8] hover:text-[#F1F5F9] text-[11px] flex items-center gap-1 cursor-pointer whitespace-nowrap transition"
                >
                  <RotateCcw className="w-3 h-3" />
                  <span>Сброс</span>
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ЦЕНТРАЛЬНЫЙ ПРИЦЕЛ + КОЛЬЦЕВОЙ ИНДИКАТОР УДЕРЖАНИЯ + КОНТЕКСТНАЯ ПОДСКАЗКА */}
      <div className="fixed inset-0 pointer-events-none flex items-center justify-center z-20">
        <div className="relative flex items-center justify-center">
          {/* Круговой SVG-индикатор прогресса удержания */}
          {isHoldingAny && holdProgress01 > 0 && (
            <svg className="w-12 h-12 -rotate-90" viewBox="0 0 44 44">
              <circle
                cx="22"
                cy="22"
                r="19"
                fill="none"
                stroke="rgba(11, 17, 23, 0.78)"
                strokeWidth="3"
              />
              <circle
                cx="22"
                cy="22"
                r="19"
                fill="none"
                stroke="#10B981"
                strokeWidth="3"
                strokeLinecap="round"
                strokeDasharray={ringCircumference}
                strokeDashoffset={ringOffset}
              />
            </svg>
          )}

          {/* Точка прицела 6px */}
          <div
            className={`absolute w-1.5 h-1.5 rounded-full border border-[#0B1117] ${
              isHoldingAny
                ? 'bg-[#10B981] scale-125'
                : targetedObject || scen4Prompt
                ? 'bg-[#F59E0B]'
                : 'bg-[#F1F5F9]/80'
            }`}
          />

          {/* Единая компактная строка взаимодействия ровно под прицелом */}
          {showCrosshairPrompt && (
            <div className="absolute top-8 left-1/2 -translate-x-1/2 whitespace-nowrap max-w-[85vw]">
              {holdLabel && holdProgress01 > 0 ? (
                <div className="px-3 py-1 rounded-[10px] alara-glass border-[#10B981]/60 text-[11px] font-mono alara-tabular text-[#10B981]">
                  {holdLabel} — {Math.round(holdProgress01 * 100)}%
                </div>
              ) : scen4Prompt ? (
                <div className="px-3 py-1.5 rounded-[10px] alara-glass border-[#0EA5E9]/50 text-xs text-[#F1F5F9] font-medium">
                  {scen4Prompt}
                </div>
              ) : targetedObject ? (
                <div className="px-3 py-1.5 rounded-[10px] alara-glass text-xs text-[#F1F5F9] flex items-center gap-2">
                  <span className="font-semibold text-[#F1F5F9]">{targetedObject.nameRu}</span>
                  <span className="text-[#94A3B8] font-mono alara-tabular">
                    {targetedObject.distanceM.toFixed(1)} м
                  </span>
                  <span className="text-[#F59E0B] font-mono">
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
        {carriedHazard && (
          <div
            className={`px-3 py-1.5 rounded-[10px] alara-glass text-xs font-medium flex items-center gap-2 ${
              carriedHazard.bareHandViolation
                ? 'border-[#EF4444]/60 text-[#EF4444]'
                : 'border-[#10B981]/60 text-[#10B981]'
            }`}
          >
            {carriedHazard.bareHandViolation ? (
              <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
            ) : (
              <PackageCheck className="w-3.5 h-3.5 shrink-0" />
            )}
            <span className="text-[#F1F5F9]">
              В руках: <strong>{carriedHazard.item.nameRu}</strong>
              {carriedHazard.nearestDropZoneDistanceM !== null
                ? ` · До САР: ${carriedHazard.nearestDropZoneDistanceM.toFixed(1)} м`
                : ' · Донесите до контейнера САР [E]'}
            </span>
          </div>
        )}

        {/* Строка слотов инструментов */}
        <div className="flex items-center gap-1 p-1 rounded-xl alara-glass">
          {primarySlots.map(slot => {
            const isSelected = activeToolId === slot.id;
            return (
              <button
                key={slot.id}
                type="button"
                onClick={() => onSelectTool?.(slot.id)}
                className={`px-2.5 py-1.5 rounded-[10px] text-[11px] font-mono alara-tabular transition flex items-center gap-1.5 cursor-pointer whitespace-nowrap ${
                  isSelected
                    ? 'bg-[#0EA5E9] text-[#0B1117] font-bold'
                    : 'alara-surface hover:bg-slate-800/80 text-[#94A3B8] hover:text-[#F1F5F9]'
                }`}
                title={`${slot.nameRu} — ${slot.purposeRu} [${slot.hotkey}]`}
              >
                <span className={isSelected ? 'text-[#0B1117] font-bold' : 'text-[#0EA5E9]'}>
                  [{slot.hotkey}]
                </span>
                <span>{slot.shortNameRu}</span>
              </button>
            );
          })}

          {!isScenario4 && (
            <>
              <div className="w-px h-5 bg-slate-400/15 mx-0.5 hidden sm:block" />
              {secondarySlots.map(slot => {
                const isSelected = activeToolId === slot.id;
                return (
                  <button
                    key={slot.id}
                    type="button"
                    onClick={() => onSelectTool?.(slot.id)}
                    className={`px-2.5 py-1.5 rounded-[10px] text-[11px] font-mono alara-tabular transition hidden sm:flex items-center gap-1 cursor-pointer whitespace-nowrap ${
                      isSelected
                        ? 'bg-[#F59E0B] text-[#0B1117] font-bold'
                        : 'alara-surface hover:bg-slate-800/80 text-[#94A3B8] hover:text-[#F1F5F9]'
                    }`}
                    title={`${slot.nameRu} — ${slot.purposeRu} [${slot.hotkey}]`}
                  >
                    <span className={isSelected ? 'text-[#0B1117] font-bold' : 'text-[#64748B]'}>
                      [{slot.hotkey}]
                    </span>
                    <span>{slot.shortNameRu}</span>
                  </button>
                );
              })}
            </>
          )}

          {activeToolId === 'extinguisher' && (
            <button
              type="button"
              onClick={onToggleNozzleSprayMode}
              className="ml-0.5 px-2.5 py-1.5 rounded-[10px] text-[11px] font-mono font-semibold bg-[#14B8A6]/15 hover:bg-[#14B8A6]/25 border border-[#14B8A6]/45 text-[#14B8A6] flex items-center gap-1 cursor-pointer whitespace-nowrap transition"
              title="Переключить режим струи [Q]"
            >
              <Droplets className="w-3.5 h-3.5" />
              <span>[Q] {nozzleSprayMode === 'SOLID' ? 'Сплошная' : 'Распыл'}</span>
            </button>
          )}
        </div>
      </div>
    </>
  );
};
