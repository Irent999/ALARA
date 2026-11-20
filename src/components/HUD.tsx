import React, { useState, useEffect, useRef } from 'react';
import {
  Radiation,
  Eye,
  EyeOff,
  Heart,
  Volume2,
  VolumeX,
  BookOpen,
  FileText,
  Glasses,
  Compass,
  ArrowDownToLine,
  Hand,
  RotateCw,
  Radio,
  CheckCircle2,
  X,
  Clock,
  Shield,
  Target,
  BarChart3,
  UserCheck,
  Ruler,
  Flashlight,
  Moon,
  Mic,
  RotateCcw,
  ListChecks,
  PanelBottomOpen,
  PanelBottomClose,
  Sliders,
  Layers,
  Menu,
  NotebookPen,
  Activity,
  AlertTriangle
} from 'lucide-react';
import { InstrumentId, GOST_INSTRUMENTS } from '../instruments/gostInstruments';
import { ScenarioDefinition, MissionStage, SCENARIOS } from '../scene/scenarios';
import {
  ComprehensiveProtectionAnalysis,
  PPELoadoutId,
  PPE_LOADOUTS,
  RemoteToolId,
  REMOTE_TOOLS,
  calculateSafeStayTime
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
  type: 'shield' | 'valve' | 'container' | 'source' | 'sample' | 'cover' | 'flashlight';
  distanceM: number;
  isGrabbed?: boolean;
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
    <div className="pointer-events-auto rounded-xl border border-white/10 bg-slate-950/80 p-3 text-xs text-slate-200 shadow-xl backdrop-blur-md">
      <div className="flex items-center justify-between border-b border-white/10 pb-1.5 mb-2">
        <span className="font-semibold text-amber-300">
          Ядро ГОСТ Р 54413-2011
        </span>
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
          Экран: <span className="text-slate-200">{shieldMat.nameRu}</span> ({shieldThicknessCm} см) · +60с: {nextMinuteDoseMsv.toFixed(4)} мЗв
        </div>
      </div>
      {onToggleFlashlight && (
        <button
          onClick={onToggleFlashlight}
          className="mt-2 w-full rounded-lg bg-slate-800/80 hover:bg-slate-700 py-1.5 text-[11px] font-medium text-amber-300 transition whitespace-nowrap"
        >
          Фонарь (5500K): {isFlashlightOn ? 'Вкл' : 'Выкл'}
        </button>
      )}
    </div>
  );
};

const OBJECT_TYPE_LABELS: Record<TargetedObjectContext['type'], string> = {
  source: 'Источник ИИИ',
  shield: 'Биозащита',
  container: 'Контейнер',
  valve: 'Арматура / Вентиль',
  sample: 'Проба / Образец',
  cover: 'Люк / Заслонка',
  flashlight: 'Фонарь'
};

interface HUDProps {
  scenario: ScenarioDefinition;
  scenarioStep: number;
  onScenarioChange: (id: number) => void;
  selectedInstrumentId: InstrumentId;
  onInstrumentChange: (id: InstrumentId) => void;
  isAudioMuted: boolean;
  onToggleAudio: () => void;
  threatLevel: 'normal' | 'warning' | 'danger';
  zoneName: string;
  cumulativeDoseMsv: number;
  currentDoseRateMicroSv: number;
  vitalsBpm: number;
  isCrouched: boolean;
  onToggleCrouch: () => void;
  isExtendedArm: boolean;
  onToggleExtendArm: () => void;
  isGripped: boolean;
  onToggleGrip: () => void;
  onRotateWrist: () => void;
  isTeleportActive: boolean;
  onToggleTeleport: () => void;
  onOpenGostGuide: () => void;
  onOpenAlaraReport: () => void;
  onToggleVR: () => void;
  isVRSupported: boolean;
  isInVR: boolean;
  isRadiationFieldVisible: boolean;
  onToggleRadiationField: () => void;
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
  isFlashlightOn: boolean;
  isFlashlightEquipped: boolean;
  onToggleFlashlight: () => void;
  isLowLightMode: boolean;
  onToggleLowLightMode: () => void;
  hapticStrength: number;
  onChangeHapticStrength: (strength: number) => void;
  voiceLogs: ReadonlyArray<VoiceLogEntry>;
  isVoicePushToTalkActive: boolean;
  voiceMode: VoiceLoggerMode;
  voiceVolumeLevel: number;
  voiceInterimTranscript: string;
  latestVoiceToast: VoiceToastFeedItem | null;
  onStartVoicePushToTalk: () => void;
  onStopVoicePushToTalk: () => void;
  onToggleVoiceMode: () => void;
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
}

export const HUD: React.FC<HUDProps> = ({
  scenario,
  scenarioStep,
  onScenarioChange,
  selectedInstrumentId,
  onInstrumentChange,
  isAudioMuted,
  onToggleAudio,
  threatLevel,
  zoneName,
  cumulativeDoseMsv,
  currentDoseRateMicroSv,
  vitalsBpm,
  isCrouched,
  onToggleCrouch,
  isExtendedArm,
  onToggleExtendArm,
  isGripped,
  onToggleGrip,
  onRotateWrist,
  isTeleportActive,
  onToggleTeleport,
  onOpenGostGuide,
  onOpenAlaraReport,
  onToggleVR,
  isVRSupported,
  isInVR,
  isRadiationFieldVisible,
  onToggleRadiationField,
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
  isFlashlightOn,
  isFlashlightEquipped,
  onToggleFlashlight,
  isLowLightMode,
  onToggleLowLightMode,
  hapticStrength,
  onChangeHapticStrength,
  voiceLogs,
  isVoicePushToTalkActive,
  voiceMode,
  voiceVolumeLevel,
  voiceInterimTranscript,
  latestVoiceToast,
  onStartVoicePushToTalk,
  onStopVoicePushToTalk,
  onToggleVoiceMode,
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
  onOpenLabNotebook,
  onOpenSpectrometry,
  isExamMode = false,
  onChangeExamMode,
  onStepChange,
  targetedObject = null,
  coopRoleCallsign,
  coopPeersCount = 0,
  onCycleCoopRole,
  oxygenPercent = 96,
  spO2Percent = 98,
  coreBodyTempC = 36.7,
  hilLabel = 'OFF',
  hilCountsPerSec = 0,
  hilProtocolTitle,
  onConnectHil,
  isRandomizedHazardMode = false,
  onToggleRandomizedHazardMode,
  onOpenAAR
}) => {
  // По умолчанию панель управления свернута для 100% обзора 3D-сцены
  const [internalHudVisible, setInternalHudVisible] = useState(true);
  const [isExpanded, setIsExpanded] = useState(false);
  const [activePopover, setActivePopover] = useState<'none' | 'gear' | 'hand' | 'modules'>('none');
  const [isChecklistOpen, setIsChecklistOpen] = useState(false);
  const [showTaskBanner, setShowTaskBanner] = useState(false);
  const [countdown, setCountdown] = useState(5);
  const [isAnalyticsWindowOpen, setIsAnalyticsWindowOpen] = useState(false);

  const effectiveHudVisible = visible && internalHudVisible;
  const { isPresenting } = useXR(undefined, isInVR);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  const openTaskBanner = () => {
    setShowTaskBanner(true);
    setCountdown(5);
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = setInterval(() => {
      setCountdown(prev => {
        if (prev <= 1) {
          setShowTaskBanner(false);
          if (timerRef.current) clearInterval(timerRef.current);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  };

  const toggleExpandUI = () => {
    setIsExpanded(prev => {
      const next = !prev;
      if (!next) {
        setActivePopover('none');
      }
      return next;
    });
  };

  const togglePopover = (tab: 'gear' | 'hand' | 'modules') => {
    setActivePopover(prev => (prev === tab ? 'none' : tab));
  };

  const currentStage: MissionStage = scenario.stages[scenarioStep] || scenario.stages[0];
  const safeStay = calculateSafeStayTime(
    currentDoseRateMicroSv,
    permitLimitMsv,
    cumulativeDoseMsv
  );

  const tMaxSec = scenarioConfig?.tMaxSec || 300;
  const remainingMissionSec = Math.max(0, tMaxSec - missionTimeSec);
  const remMins = Math.floor(remainingMissionSec / 60);
  const remSecs = Math.floor(remainingMissionSec % 60);
  const countdownFormatted = `${remMins.toString().padStart(2, '0')}:${remSecs
    .toString()
    .padStart(2, '0')}`;

  let threatTitle = 'Норма';
  let threatTextColor = 'text-emerald-400';
  let threatBorderColor = 'border-white/10';

  if (threatLevel === 'warning') {
    threatTitle = 'Повышенный фон';
    threatTextColor = 'text-amber-300';
    threatBorderColor = 'border-amber-500/40';
  } else if (threatLevel === 'danger') {
    threatTitle = 'Опасная зона';
    threatTextColor = 'text-rose-400';
    threatBorderColor = 'border-rose-500/60';
  }

  const isElevatedRadiationContext =
    threatLevel !== 'normal' ||
    Boolean(rulesEvaluation?.isWarning80Active) ||
    (rulesEvaluation?.zoneAlertLevel && rulesEvaluation.zoneAlertLevel !== 'green');

  // Строгое исключение 2D HTML-оверлея при надетом VR-шлеме
  if (isPresenting || isInVR) {
    return null;
  }

  // Минимальный режим полного скрытия HUD
  if (!effectiveHudVisible) {
    return (
      <div className="fixed top-4 right-4 z-50 pointer-events-auto">
        <button
          onClick={() => {
            setInternalHudVisible(true);
            onToggleVisibility?.(true);
          }}
          className="px-3.5 py-2 rounded-xl bg-slate-950/75 hover:bg-slate-900/90 text-slate-100 border border-white/15 shadow-lg backdrop-blur-md transition flex items-center gap-2 text-xs font-medium cursor-pointer whitespace-nowrap"
          title="Показать интерфейс (HUD)"
        >
          <Eye className="w-4 h-4 text-amber-400" />
          <span>Показать HUD</span>
        </button>
      </div>
    );
  }

  const formattedDoseRate =
    currentDoseRateMicroSv < 1000
      ? currentDoseRateMicroSv.toFixed(1)
      : (currentDoseRateMicroSv / 1000).toFixed(2);
  const doseRateUnit = currentDoseRateMicroSv < 1000 ? 'мкЗв/ч' : 'мЗв/ч';

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
        onClose={() => setIsAnalyticsWindowOpen(false)}
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
        rulesEvaluation={rulesEvaluation}
        onResetScenario={onResetScenario}
      />

      {/* Контекстный уведомитель голоса (PTT) */}
      {(isVoicePushToTalkActive || latestVoiceToast) && (
        <div className="fixed top-20 left-1/2 -translate-x-1/2 z-50 pointer-events-none max-w-lg w-[90vw]">
          <div
            className={`backdrop-blur-md bg-slate-950/80 border rounded-xl px-4 py-2.5 shadow-xl transition ${
              isVoicePushToTalkActive
                ? 'border-emerald-400/70'
                : latestVoiceToast?.kind === 'error'
                ? 'border-rose-500/70'
                : latestVoiceToast?.kind === 'command'
                ? 'border-sky-400/70'
                : 'border-amber-400/70'
            }`}
          >
            <div className="flex items-center justify-between gap-3 mb-1">
              <span className="text-[11px] font-mono font-semibold text-emerald-300">
                {isVoicePushToTalkActive
                  ? `Голосовая запись [${
                      voiceMode === 'commands'
                        ? 'Команды'
                        : voiceMode === 'dictation'
                        ? 'Протокол'
                        : 'Авто NLU'
                    }]`
                  : latestVoiceToast?.title}
              </span>
              <div className="flex items-center gap-0.5 h-3">
                {[0, 1, 2, 3, 4].map(idx => {
                  const activeBar = isVoicePushToTalkActive
                    ? Math.max(20, Math.min(100, Math.round(voiceVolumeLevel * 100 - idx * 12)))
                    : 20;
                  return (
                    <span
                      key={idx}
                      className={`w-1 rounded-sm transition-all ${
                        isVoicePushToTalkActive ? 'bg-emerald-400' : 'bg-slate-600'
                      }`}
                      style={{ height: `${activeBar}%` }}
                    />
                  );
                })}
              </div>
            </div>
            <div className="text-xs font-medium text-white leading-snug">
              {isVoicePushToTalkActive
                ? voiceInterimTranscript ||
                  'Произнесите замер или команду («Точка А-1, мощность дозы 45 мкЗв/ч»)...'
                : latestVoiceToast?.text}
            </div>
            {latestVoiceToast?.metaTag && !isVoicePushToTalkActive && (
              <div className="mt-1 text-[11px] font-mono text-amber-300">
                {latestVoiceToast.metaTag}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ВЕРХНИЙ ЛЕВЫЙ УГОЛ: Компактная телеметрия (всегда легко считывается, не мешает сцене) */}
      <div className="fixed top-3.5 left-3.5 z-40 pointer-events-auto flex flex-col gap-2 max-w-[92vw]">
        <div
          className={`flex items-center gap-3 px-3.5 py-2 rounded-xl bg-slate-950/70 backdrop-blur-md border ${threatBorderColor} shadow-lg`}
        >
          <button
            onClick={toggleExpandUI}
            className="flex items-center gap-2 text-left hover:opacity-85 transition cursor-pointer shrink-0"
            title="Развернуть или свернуть панель параметров"
          >
            <Radiation className={`w-4 h-4 ${threatTextColor}`} />
            <div className="leading-tight">
              <div className={`text-[11px] font-semibold ${threatTextColor}`}>
                {threatTitle}
              </div>
              <div className="text-[11px] text-slate-300 truncate max-w-[140px]">
                #{scenario.id} · {zoneName}
              </div>
            </div>
          </button>

          <div className="h-6 w-px bg-white/10" />

          <div className="flex items-baseline gap-1 font-mono tabular-nums whitespace-nowrap">
            <span className="text-sm font-bold text-white">{formattedDoseRate}</span>
            <span className="text-[11px] text-amber-300">{doseRateUnit}</span>
          </div>

          <div className="hidden sm:block h-6 w-px bg-white/10" />

          <div className="hidden sm:flex items-baseline gap-1 font-mono tabular-nums text-xs text-sky-300 whitespace-nowrap">
            <span>{(cumulativeDoseMsv * 1000).toFixed(1)}</span>
            <span className="text-[11px] text-slate-400">
              / {(permitLimitMsv * 1000).toFixed(0)} мкЗв
            </span>
          </div>

          <div className="hidden md:block h-6 w-px bg-white/10" />

          <div
            className={`hidden md:flex items-center gap-1 font-mono tabular-nums text-xs whitespace-nowrap ${
              remainingMissionSec <= 30
                ? 'text-rose-400 font-bold'
                : remainingMissionSec <= 60
                ? 'text-amber-300 font-semibold'
                : 'text-slate-200'
            }`}
            title={`Нормативное время миссии: ${tMaxSec} с`}
          >
            <Clock className="w-3.5 h-3.5 text-cyan-400" />
            <span>{countdownFormatted}</span>
          </div>
        </div>

        {/* Раскрываемая полоса выбора сценария и режима при развернутом UI */}
        {isExpanded && (
          <div className="flex flex-wrap items-center gap-2 px-3 py-2 rounded-xl bg-slate-950/80 backdrop-blur-md border border-white/10 shadow-lg">
            <select
              value={scenario.id}
              onChange={e => onScenarioChange(Number(e.target.value))}
              className="bg-slate-900/90 text-xs text-white border border-white/10 rounded-lg px-2.5 py-1.5 focus:outline-none focus:border-amber-400 cursor-pointer max-w-[260px]"
              title="Выбор объекта обследования (11 сценариев)"
            >
              {SCENARIOS.map(scen => (
                <option key={scen.id} value={scen.id}>
                  {scen.id}. {scen.titleRu}
                </option>
              ))}
            </select>

            <button
              onClick={openTaskBanner}
              className="px-2.5 py-1.5 rounded-lg bg-slate-800/80 hover:bg-slate-700 text-amber-300 text-xs font-medium border border-white/10 transition flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer"
              title="Показать описание текущего этапа"
            >
              <Target className="w-3.5 h-3.5" />
              <span>Задача</span>
            </button>

            <button
              onClick={() => onChangeExamMode?.(!isExamMode)}
              className={`px-2.5 py-1.5 rounded-lg text-xs font-medium border transition whitespace-nowrap shrink-0 cursor-pointer ${
                isExamMode
                  ? 'bg-amber-500/20 text-amber-300 border-amber-400/40'
                  : 'bg-slate-800/80 text-emerald-300 border-white/10 hover:bg-slate-700'
              }`}
              title="Переключение режима Свободный / Экзамен"
            >
              {isExamMode ? 'Режим: Экзамен' : 'Режим: Свободный'}
            </button>
          </div>
        )}
      </div>

      {/* ВЕРХНИЙ ПРАВЫЙ УГОЛ: Аккуратные кнопки вызова и явная кнопка «Свернуть / Развернуть» */}
      <div className="fixed top-3.5 right-3.5 z-40 pointer-events-auto flex items-center gap-1.5 px-2 py-1.5 rounded-xl bg-slate-950/70 backdrop-blur-md border border-white/10 shadow-lg">
        <button
          onClick={toggleExpandUI}
          className={`px-3 py-1.5 rounded-lg text-xs font-medium transition flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer ${
            isExpanded
              ? 'bg-amber-500 text-slate-950 font-semibold'
              : 'bg-slate-800/80 hover:bg-slate-700 text-slate-100 border border-white/10'
          }`}
          title={isExpanded ? 'Свернуть панели управления' : 'Развернуть панели управления'}
        >
          {isExpanded ? (
            <>
              <PanelBottomClose className="w-3.5 h-3.5" />
              <span>Свернуть</span>
            </>
          ) : (
            <>
              <PanelBottomOpen className="w-3.5 h-3.5 text-amber-300" />
              <span>Развернуть</span>
            </>
          )}
        </button>

        {onOpenMainMenu && (
          <button
            onClick={onOpenMainMenu}
            className="px-2.5 py-1.5 rounded-lg bg-slate-800/70 hover:bg-slate-700 text-slate-200 border border-white/10 transition flex items-center gap-1.5 text-xs font-medium whitespace-nowrap shrink-0 cursor-pointer"
            title="Главное меню практикума"
          >
            <Menu className="w-3.5 h-3.5 text-sky-400" />
            <span className="hidden sm:inline">Меню</span>
          </button>
        )}

        <button
          onClick={() => setIsChecklistOpen(prev => !prev)}
          className={`px-2.5 py-1.5 rounded-lg border transition flex items-center gap-1.5 text-xs font-medium whitespace-nowrap shrink-0 cursor-pointer ${
            isChecklistOpen
              ? 'bg-cyan-500 text-slate-950 border-cyan-400 font-semibold'
              : 'bg-slate-800/70 hover:bg-slate-700 text-cyan-300 border-white/10'
          }`}
          title="Чек-лист этапов сценария"
        >
          <ListChecks className="w-3.5 h-3.5" />
          <span className="font-mono tabular-nums">
            {scenarioStep + 1}/{scenario.stages.length}
          </span>
        </button>

        <button
          onClick={onToggleVR}
          className={`px-2.5 py-1.5 rounded-lg text-xs font-medium border transition flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer ${
            isInVR
              ? 'bg-indigo-600 text-white border-indigo-400'
              : 'bg-slate-800/70 hover:bg-indigo-600/80 text-indigo-200 border-white/10'
          }`}
          title={isVRSupported ? 'Войти в WebXR VR' : 'WebXR VR'}
        >
          <Glasses className="w-3.5 h-3.5" />
          <span>{isInVR ? 'Выход' : 'VR'}</span>
        </button>

        <button
          onClick={() => {
            setInternalHudVisible(false);
            onToggleVisibility?.(false);
          }}
          className="p-1.5 rounded-lg bg-slate-800/70 hover:bg-slate-700 text-slate-300 hover:text-white border border-white/10 transition cursor-pointer shrink-0"
          title="Скрыть HUD полностью"
        >
          <EyeOff className="w-4 h-4 text-amber-300" />
        </button>
      </div>

      {/* КОНТЕКСТНАЯ ПАНЕЛЬ РАДИАЦИИ И СИЗ: появляется только при повышенном фоне / тревоге */}
      {isElevatedRadiationContext && (
        <div className="fixed top-16 left-1/2 -translate-x-1/2 z-30 pointer-events-auto max-w-[92vw]">
          <div className="flex flex-wrap items-center gap-3 px-3.5 py-2 rounded-xl bg-slate-950/75 backdrop-blur-md border border-amber-400/40 shadow-lg text-xs">
            <div className="flex items-center gap-1.5 font-medium text-amber-300 whitespace-nowrap">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
              <span>{threatTitle}</span>
            </div>
            <span className="text-slate-500" aria-hidden="true">·</span>
            <div className="font-mono tabular-nums text-slate-200 whitespace-nowrap">
              T_доп: <span className={safeStay.isLimitExceeded ? 'text-rose-400 font-bold' : 'text-emerald-300'}>{safeStay.textRu}</span>
            </div>
            <span className="text-slate-500" aria-hidden="true">·</span>
            <div className="font-mono tabular-nums text-emerald-300 whitespace-nowrap">
              K_prot {protectionAnalysis.kProtTotal}×
            </div>
            <span className="text-slate-500" aria-hidden="true">·</span>
            <label className="flex items-center gap-1.5 text-slate-300 whitespace-nowrap">
              <Shield className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
              <select
                value={selectedPpeId}
                onChange={e => onChangePpeId(e.target.value as PPELoadoutId)}
                className="bg-slate-900/90 text-white text-xs border border-white/15 rounded-lg px-2 py-1 focus:outline-none focus:border-emerald-400 cursor-pointer"
                title="Быстрый выбор средств индивидуальной защиты"
              >
                {Object.values(PPE_LOADOUTS).map(ppe => (
                  <option key={ppe.id} value={ppe.id}>
                    {ppe.shortNameRu}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </div>
      )}

      {/* КОНТЕКСТНАЯ КАРТОЧКА ОБЪЕКТА: появляется только при наведении на интерактивный 3D-объект или удержании в руке */}
      {targetedObject && (
        <div
          className={`fixed left-1/2 -translate-x-1/2 z-30 pointer-events-auto transition-all duration-200 ${
            isExpanded ? 'bottom-20' : 'bottom-4'
          }`}
        >
          <div className="flex items-center gap-3 px-4 py-2 rounded-xl bg-slate-950/75 backdrop-blur-md border border-cyan-400/35 shadow-xl text-xs">
            <div className="flex flex-col">
              <div className="font-semibold text-white leading-tight">{targetedObject.nameRu}</div>
              <div className="text-[11px] text-slate-400 font-mono tabular-nums">
                {OBJECT_TYPE_LABELS[targetedObject.type]} ·{' '}
                {targetedObject.isGrabbed
                  ? 'Удерживается в руке'
                  : `${targetedObject.distanceM.toFixed(2)} м`}
              </div>
            </div>
            <button
              onClick={onToggleGrip}
              className="px-3 py-1.5 rounded-lg bg-cyan-500/20 hover:bg-cyan-500/30 border border-cyan-400/40 text-cyan-200 font-medium whitespace-nowrap shrink-0 cursor-pointer transition"
              title="Клавиша E — взаимодействие с объектом"
            >
              [E]{' '}
              {targetedObject.isGrabbed
                ? 'Отпустить'
                : targetedObject.type === 'valve' || targetedObject.type === 'cover'
                ? 'Переключить'
                : 'Взять'}
            </button>
          </div>
        </div>
      )}

      {/* ПЛАВАЮЩЕЕ ОКНО ТЕКУЩЕЙ ЗАДАЧИ: открывается строго по требованию кнопкой «Задача» */}
      {showTaskBanner && (
        <div className="fixed inset-0 z-50 flex items-center justify-center pointer-events-none px-4">
          <div className="pointer-events-auto bg-slate-950/85 backdrop-blur-xl border border-amber-400/35 p-5 rounded-2xl max-w-md w-full shadow-2xl relative">
            <div className="w-full bg-slate-800/80 h-1 rounded-full overflow-hidden mb-3">
              <div
                className="bg-amber-400 h-full transition-all duration-1000 ease-linear"
                style={{ width: `${(countdown / 5) * 100}%` }}
              />
            </div>

            <button
              onClick={() => setShowTaskBanner(false)}
              className="absolute top-4 right-4 p-1.5 rounded-lg bg-slate-800/80 text-slate-400 hover:text-white transition cursor-pointer"
              title="Закрыть окно задачи"
            >
              <X className="w-4 h-4" />
            </button>

            <div className="pr-8">
              <div className="flex items-center gap-2 text-[11px] text-slate-400 font-mono tabular-nums">
                <span className="text-amber-300">Шаг {currentStage.stepNumber} / {scenario.stages.length}</span>
                <span aria-hidden="true">·</span>
                <span>Скрытие через {countdown}с</span>
              </div>
              <h3 className="text-base font-bold text-white mt-1">{scenario.titleRu}</h3>
            </div>

            <div className="mt-3 text-xs text-slate-300 space-y-2.5">
              <p className="leading-relaxed">{scenario.shortDescriptionRu}</p>
              <div className="p-3 rounded-xl bg-slate-900/80 border border-white/10 space-y-1.5">
                <div className="font-semibold text-amber-300 flex items-center gap-1.5">
                  <Target className="w-3.5 h-3.5 shrink-0" />
                  <span>{currentStage.titleRu}</span>
                </div>
                <div className="text-white leading-snug">{currentStage.taskRu}</div>
                <div className="text-slate-400 text-[11px] pt-1 border-t border-white/10">
                  Подсказка: {currentStage.hintRu}
                </div>
              </div>
              <div className="text-[11px] text-emerald-300 flex items-center gap-1.5">
                <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                <span>{currentStage.alaraRuleRu}</span>
              </div>
            </div>

            <button
              onClick={() => setShowTaskBanner(false)}
              className="w-full mt-4 py-2 bg-amber-500 hover:bg-amber-400 text-slate-950 font-semibold text-xs rounded-xl transition cursor-pointer"
            >
              Продолжить
            </button>
          </div>
        </div>
      )}

      {/* ВСПЛЫВАЮЩЕЕ ОКНО ЧЕК-ЛИСТА ЗАДАЧ */}
      {isChecklistOpen && (
        <div className="pointer-events-auto fixed right-3.5 top-16 z-50 w-96 max-w-[92vw] rounded-2xl border border-white/10 bg-slate-950/85 p-4 text-slate-100 shadow-2xl backdrop-blur-xl">
          <div className="flex items-center justify-between border-b border-white/10 pb-2.5 mb-3">
            <div className="flex items-center gap-2 min-w-0">
              <ListChecks className="w-4 h-4 text-cyan-400 shrink-0" />
              <div className="min-w-0">
                <h3 className="text-sm font-semibold text-white">Задачи сценария</h3>
                <p className="text-[11px] text-slate-400 truncate">{scenario.titleRu}</p>
              </div>
            </div>
            <button
              onClick={() => setIsChecklistOpen(false)}
              className="p-1.5 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-white transition cursor-pointer"
              title="Закрыть чек-лист"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="mb-3 space-y-1.5">
            <div className="flex justify-between text-[11px] font-mono tabular-nums text-slate-400">
              <span>Выполнено: {scenarioStep}/{scenario.stages.length}</span>
              <span className="text-cyan-300">{countdownFormatted} / {tMaxSec}с</span>
            </div>
            <div className="w-full bg-slate-800 rounded-full h-1.5 overflow-hidden">
              <div
                className="bg-cyan-400 h-1.5 rounded-full transition-all duration-300"
                style={{
                  width: `${Math.min(100, (scenarioStep / Math.max(1, scenario.stages.length)) * 100)}%`
                }}
              />
            </div>
          </div>

          <div className="space-y-2 max-h-68 overflow-y-auto pr-1">
            {scenario.stages.map((stage, idx) => {
              const isCompleted = idx < scenarioStep;
              const isCurrent = idx === scenarioStep;
              return (
                <div
                  key={stage.stepNumber}
                  className={`p-2.5 rounded-xl border text-xs transition ${
                    isCurrent
                      ? 'bg-cyan-950/40 border-cyan-400/40'
                      : isCompleted
                      ? 'bg-slate-900/50 border-emerald-500/30 text-slate-300'
                      : 'bg-slate-900/30 border-white/5 text-slate-500'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="font-medium flex-1">
                      <span
                        className={`font-mono text-[11px] mr-1.5 ${
                          isCompleted
                            ? 'text-emerald-400'
                            : isCurrent
                            ? 'text-cyan-300'
                            : 'text-slate-500'
                        }`}
                      >
                        {isCompleted ? '✓' : isCurrent ? '▶' : '○'} {idx + 1}.
                      </span>
                      <span className={isCurrent ? 'text-white' : ''}>{stage.titleRu}</span>
                    </div>
                    {isCurrent && onStepChange && (
                      <button
                        onClick={() => onStepChange(idx + 1)}
                        className="px-2 py-0.5 rounded text-[11px] font-medium bg-cyan-500/20 hover:bg-cyan-500/35 text-cyan-200 border border-cyan-400/40 transition whitespace-nowrap shrink-0 cursor-pointer"
                      >
                        Зачесть
                      </button>
                    )}
                  </div>
                  <p className={`mt-1 text-[11px] leading-relaxed ${isCurrent ? 'text-slate-200' : 'text-slate-400'}`}>
                    {stage.taskRu}
                  </p>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* РАЗВЕРНУТАЯ НИЖНЯЯ ПАНЕЛЬ (КОМПАКТНЫЙ ДОК + ВЛОЖЕННЫЕ ВКЛАДКИ / POPOVERS) */}
      {isExpanded && (
        <div className="fixed bottom-3.5 left-1/2 -translate-x-1/2 z-40 pointer-events-auto flex flex-col items-center gap-2 max-w-[95vw]">
          {/* Вложенное модальное меню: СИЗ, Приборы и Среда */}
          {activePopover === 'gear' && (
            <div className="w-[min(580px,92vw)] rounded-2xl bg-slate-950/85 backdrop-blur-xl border border-white/10 p-4 shadow-2xl text-xs space-y-3">
              <div className="flex items-center justify-between border-b border-white/10 pb-2">
                <span className="font-semibold text-white">Приборы, СИЗ и среда</span>
                <button
                  onClick={() => setActivePopover('none')}
                  className="p-1 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-white cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <span className="text-[11px] text-slate-400 block mb-1">Радиометр ГОСТ 27451-87</span>
                  <div className="grid grid-cols-4 gap-1 bg-slate-900/90 p-1 rounded-lg border border-white/10">
                    {(['dp5', 'ion', 'nai', 'neutron'] as InstrumentId[]).map(id => (
                      <button
                        key={id}
                        onClick={() => onInstrumentChange(id)}
                        className={`py-1.5 text-[11px] font-medium rounded-md transition whitespace-nowrap cursor-pointer ${
                          selectedInstrumentId === id
                            ? 'bg-amber-500 text-slate-950 font-semibold'
                            : 'text-slate-300 hover:bg-slate-800'
                        }`}
                        title={GOST_INSTRUMENTS[id].nameFull}
                      >
                        {id === 'dp5' && 'МКС'}
                        {id === 'ion' && 'ДРГЗ'}
                        {id === 'nai' && 'NaI'}
                        {id === 'neutron' && 'Нейтр.'}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="text-[11px] text-slate-400 block mb-1">
                    Спецодежда / СИЗ (обновляет 3D-перчатки)
                  </label>
                  <div className="flex items-center gap-1.5 bg-slate-900/90 px-2.5 py-1.5 rounded-lg border border-white/10">
                    <UserCheck className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                    <select
                      value={selectedPpeId}
                      onChange={e => onChangePpeId(e.target.value as PPELoadoutId)}
                      className="w-full bg-transparent text-white text-xs focus:outline-none cursor-pointer"
                    >
                      {Object.values(PPE_LOADOUTS).map(ppe => (
                        <option key={ppe.id} value={ppe.id} className="bg-slate-900 text-white">
                          {ppe.shortNameRu}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div>
                  <label className="text-[11px] text-slate-400 block mb-1">Дистанционный инструмент</label>
                  <div className="flex items-center gap-1.5 bg-slate-900/90 px-2.5 py-1.5 rounded-lg border border-white/10">
                    <Ruler className="w-3.5 h-3.5 text-sky-400 shrink-0" />
                    <select
                      value={selectedRemoteToolId}
                      onChange={e => onChangeRemoteToolId(e.target.value as RemoteToolId)}
                      className="w-full bg-transparent text-white text-xs focus:outline-none cursor-pointer"
                    >
                      {Object.values(REMOTE_TOOLS).map(tool => (
                        <option key={tool.id} value={tool.id} className="bg-slate-900 text-white">
                          {tool.shortNameRu}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div>
                  <label className="text-[11px] text-slate-400 block mb-1">
                    Лимит дозы наряда-допуска (мЗв)
                  </label>
                  <select
                    value={permitLimitMsv}
                    onChange={e => onChangePermitLimitMsv(Number(e.target.value))}
                    className="w-full bg-slate-900/90 text-white text-xs border border-white/10 rounded-lg px-2.5 py-1.5 focus:outline-none cursor-pointer font-mono tabular-nums"
                  >
                    <option value={0.05}>0.05 мЗв (50 мкЗв)</option>
                    <option value={0.1}>0.10 мЗв (100 мкЗв)</option>
                    <option value={0.25}>0.25 мЗв (250 мкЗв)</option>
                    <option value={0.5}>0.50 мЗв (500 мкЗв)</option>
                    <option value={1.0}>1.00 мЗв (1000 мкЗв)</option>
                  </select>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-white/10">
                <button
                  onClick={onToggleFlashlight}
                  className={`px-3 py-1.5 rounded-lg border transition flex items-center gap-1.5 whitespace-nowrap cursor-pointer ${
                    isFlashlightOn
                      ? 'bg-amber-500/20 text-amber-300 border-amber-400/50'
                      : 'bg-slate-900/80 text-slate-300 border-white/10 hover:bg-slate-800'
                  }`}
                >
                  <Flashlight className="w-3.5 h-3.5" />
                  <span>Фонарь: {isFlashlightOn ? 'Вкл' : 'Выкл'}{isFlashlightEquipped ? '' : ' (нет)'}</span>
                </button>

                <button
                  onClick={onToggleLowLightMode}
                  className={`px-3 py-1.5 rounded-lg border transition flex items-center gap-1.5 whitespace-nowrap cursor-pointer ${
                    isLowLightMode
                      ? 'bg-sky-500/20 text-sky-300 border-sky-400/50'
                      : 'bg-slate-900/80 text-slate-300 border-white/10 hover:bg-slate-800'
                  }`}
                >
                  <Moon className="w-3.5 h-3.5" />
                  <span>{isLowLightMode ? 'Темный бункер' : 'Штатный свет'}</span>
                </button>

                <button
                  onClick={onToggleRadiationField}
                  className={`px-3 py-1.5 rounded-lg border transition flex items-center gap-1.5 whitespace-nowrap cursor-pointer ${
                    isRadiationFieldVisible
                      ? 'bg-emerald-500/20 text-emerald-300 border-emerald-400/50'
                      : 'bg-slate-900/80 text-slate-300 border-white/10 hover:bg-slate-800'
                  }`}
                >
                  <Radio className="w-3.5 h-3.5" />
                  <span>Поле квантов: {isRadiationFieldVisible ? 'Вкл' : 'Выкл'}</span>
                </button>

                <button
                  onClick={onToggleAudio}
                  className={`px-3 py-1.5 rounded-lg border transition flex items-center gap-1.5 whitespace-nowrap cursor-pointer ${
                    isAudioMuted
                      ? 'bg-slate-900/80 text-slate-400 border-white/10'
                      : 'bg-amber-500/15 text-amber-300 border-amber-400/40'
                  }`}
                >
                  {isAudioMuted ? <VolumeX className="w-3.5 h-3.5" /> : <Volume2 className="w-3.5 h-3.5" />}
                  <span>Звук: {isAudioMuted ? 'Выкл' : 'Вкл'}</span>
                </button>

                <div className="flex items-center gap-2 ml-auto text-[11px] text-slate-300">
                  <span className="font-mono tabular-nums">Вибро VR {Math.round(hapticStrength * 100)}%</span>
                  <input
                    type="range"
                    min={0}
                    max={100}
                    step={5}
                    value={Math.round(hapticStrength * 100)}
                    onChange={e => onChangeHapticStrength(Number(e.target.value) / 100)}
                    className="w-20 h-1.5 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-sky-400"
                  />
                </div>
              </div>
            </div>
          )}

          {/* Вложенное меню: Управление рукой и перемещение */}
          {activePopover === 'hand' && (
            <div className="w-[min(520px,92vw)] rounded-2xl bg-slate-950/85 backdrop-blur-xl border border-white/10 p-4 shadow-2xl text-xs space-y-3">
              <div className="flex items-center justify-between border-b border-white/10 pb-2">
                <span className="font-semibold text-white">Управление рукой и перемещением</span>
                <button
                  onClick={() => setActivePopover('none')}
                  className="p-1 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-white cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  onClick={onToggleCrouch}
                  className={`px-3 py-2 rounded-lg font-medium border transition flex items-center gap-1.5 whitespace-nowrap cursor-pointer ${
                    isCrouched
                      ? 'bg-amber-500 text-slate-950 border-amber-400'
                      : 'bg-slate-900/80 text-slate-200 border-white/10 hover:bg-slate-800'
                  }`}
                >
                  <ArrowDownToLine className="w-3.5 h-3.5" />
                  <span>{isCrouched ? 'Встать [C]' : 'Присесть [C]'}</span>
                </button>

                <button
                  onClick={onToggleExtendArm}
                  className={`px-3 py-2 rounded-lg font-medium border transition flex items-center gap-1.5 whitespace-nowrap cursor-pointer ${
                    isExtendedArm
                      ? 'bg-amber-500 text-slate-950 border-amber-400'
                      : 'bg-slate-900/80 text-slate-200 border-white/10 hover:bg-slate-800'
                  }`}
                >
                  <Hand className="w-3.5 h-3.5" />
                  <span>{isExtendedArm ? 'Прижать [R]' : 'Вытянуть [R]'}</span>
                </button>

                <button
                  onClick={onToggleGrip}
                  className={`px-3 py-2 rounded-lg font-medium border transition flex items-center gap-1.5 whitespace-nowrap cursor-pointer ${
                    isGripped
                      ? 'bg-emerald-500 text-slate-950 border-emerald-400'
                      : 'bg-slate-900/80 text-slate-200 border-white/10 hover:bg-slate-800'
                  }`}
                >
                  <Hand className="w-3.5 h-3.5" />
                  <span>{isGripped ? 'Отпустить [E]' : 'Хват [E]'}</span>
                </button>

                <button
                  onClick={onRotateWrist}
                  className="px-3 py-2 rounded-lg bg-slate-900/80 hover:bg-slate-800 text-slate-200 border border-white/10 transition flex items-center gap-1.5 whitespace-nowrap cursor-pointer"
                >
                  <RotateCw className="w-3.5 h-3.5" />
                  <span>Поворот [Q]</span>
                </button>

                <button
                  onClick={onToggleTeleport}
                  className={`px-3 py-2 rounded-lg font-medium border transition flex items-center gap-1.5 whitespace-nowrap cursor-pointer ${
                    isTeleportActive
                      ? 'bg-indigo-600 text-white border-indigo-400'
                      : 'bg-slate-900/80 text-slate-200 border-white/10 hover:bg-slate-800'
                  }`}
                >
                  <Compass className="w-3.5 h-3.5" />
                  <span>Телепорт [T]</span>
                </button>
              </div>

              <div className="pt-2 border-t border-white/10 text-[11px] text-slate-400 flex flex-wrap gap-x-3 gap-y-1">
                <span><b className="text-slate-200">WASD</b> Ходьба</span>
                <span><b className="text-slate-200">F / X/A</b> Фонарь</span>
                <span><b className="text-slate-200">V / Y</b> Голос PTT</span>
                <span><b className="text-slate-200">Мышь</b> Обзор</span>
              </div>
            </div>
          )}

          {/* Вложенное меню: Практикум, Отчеты, Co-op и HIL */}
          {activePopover === 'modules' && (
            <div className="w-[min(560px,92vw)] rounded-2xl bg-slate-950/85 backdrop-blur-xl border border-white/10 p-4 shadow-2xl text-xs space-y-3">
              <div className="flex items-center justify-between border-b border-white/10 pb-2">
                <span className="font-semibold text-white">Инструменты практикума и телеметрия</span>
                <button
                  onClick={() => setActivePopover('none')}
                  className="p-1 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-white cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                {onOpenLabNotebook && (
                  <button
                    onClick={() => {
                      setActivePopover('none');
                      onOpenLabNotebook();
                    }}
                    className="px-3 py-1.5 rounded-lg bg-slate-900/80 hover:bg-slate-800 text-cyan-300 border border-white/10 transition flex items-center gap-1.5 whitespace-nowrap cursor-pointer"
                  >
                    <NotebookPen className="w-3.5 h-3.5" />
                    <span>Лаб. журнал</span>
                  </button>
                )}

                {onOpenSpectrometry && (
                  <button
                    onClick={() => {
                      setActivePopover('none');
                      onOpenSpectrometry();
                    }}
                    className="px-3 py-1.5 rounded-lg bg-slate-900/80 hover:bg-slate-800 text-purple-300 border border-white/10 transition flex items-center gap-1.5 whitespace-nowrap cursor-pointer"
                  >
                    <Activity className="w-3.5 h-3.5" />
                    <span>Спектрометр МКА</span>
                  </button>
                )}

                <button
                  onClick={() => {
                    setActivePopover('none');
                    onOpenGostGuide();
                  }}
                  className="px-3 py-1.5 rounded-lg bg-slate-900/80 hover:bg-slate-800 text-slate-200 border border-white/10 transition flex items-center gap-1.5 whitespace-nowrap cursor-pointer"
                >
                  <BookOpen className="w-3.5 h-3.5 text-amber-300" />
                  <span>Справочник ГОСТ</span>
                </button>

                <button
                  onClick={() => {
                    setActivePopover('none');
                    onOpenAlaraReport();
                  }}
                  className="px-3 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 font-semibold transition flex items-center gap-1.5 whitespace-nowrap cursor-pointer"
                >
                  <FileText className="w-3.5 h-3.5" />
                  <span>Отчет ALARA</span>
                </button>

                {onOpenAAR && (
                  <button
                    onClick={() => {
                      setActivePopover('none');
                      onOpenAAR();
                    }}
                    className="px-3 py-1.5 rounded-lg bg-cyan-500/20 hover:bg-cyan-500/30 text-cyan-200 border border-cyan-400/40 font-medium transition whitespace-nowrap cursor-pointer"
                  >
                    Разбор AAR
                  </button>
                )}
              </div>

              <div className="pt-2 border-t border-white/10 flex flex-wrap items-center justify-between gap-2 text-[11px] font-mono tabular-nums text-slate-300">
                <div className="flex flex-wrap items-center gap-2">
                  {onCycleCoopRole && (
                    <button
                      onClick={onCycleCoopRole}
                      className="px-2 py-1 rounded bg-slate-900 hover:bg-slate-800 border border-white/10 text-cyan-300 cursor-pointer whitespace-nowrap"
                      title="Сменить роль в звене РХБЗ"
                    >
                      {coopRoleCallsign || 'Звено'} ({coopPeersCount + 1}/3)
                    </button>
                  )}
                  <span className="flex items-center gap-1 text-rose-300">
                    <Heart className="w-3 h-3" /> {vitalsBpm}
                  </span>
                  <span>
                    O₂ <b className="text-emerald-300">{oxygenPercent.toFixed(0)}%</b> · SpO₂{' '}
                    {spO2Percent.toFixed(0)}% · {coreBodyTempC.toFixed(1)}°C
                  </span>
                </div>

                <div className="flex items-center gap-1.5">
                  {onConnectHil && (
                    <button
                      onClick={onConnectHil}
                      className="px-2 py-1 rounded bg-slate-900 hover:bg-slate-800 border border-white/10 text-amber-300 cursor-pointer whitespace-nowrap"
                      title={hilProtocolTitle || 'Подключение HIL ESP32'}
                    >
                      HIL: {hilLabel} ({hilCountsPerSec} имп/с)
                    </button>
                  )}
                  {onToggleRandomizedHazardMode && (
                    <button
                      onClick={onToggleRandomizedHazardMode}
                      className={`px-2 py-1 rounded border transition cursor-pointer whitespace-nowrap ${
                        isRandomizedHazardMode
                          ? 'bg-amber-500/20 border-amber-400/50 text-amber-300 font-semibold'
                          : 'bg-slate-900 border-white/10 text-slate-300 hover:bg-slate-800'
                      }`}
                    >
                      Рандом угроз: {isRandomizedHazardMode ? 'Вкл' : 'Выкл'}
                    </button>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* ГЛАВНЫЙ КОМПАКТНЫЙ НИЖНИЙ ДОК (1 строка) */}
          <div className="flex flex-wrap items-center justify-center gap-1.5 px-2.5 py-2 rounded-2xl bg-slate-950/75 backdrop-blur-md border border-white/10 shadow-2xl">
            <button
              onClick={() => togglePopover('gear')}
              className={`px-3 py-1.5 rounded-xl text-xs font-medium border transition flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer ${
                activePopover === 'gear'
                  ? 'bg-amber-500 text-slate-950 border-amber-400 font-semibold'
                  : 'bg-slate-900/70 hover:bg-slate-800 text-slate-200 border-white/10'
              }`}
            >
              <Sliders className="w-3.5 h-3.5" />
              <span>СИЗ и Приборы</span>
            </button>

            <button
              onClick={() => togglePopover('hand')}
              className={`px-3 py-1.5 rounded-xl text-xs font-medium border transition flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer ${
                activePopover === 'hand'
                  ? 'bg-amber-500 text-slate-950 border-amber-400 font-semibold'
                  : 'bg-slate-900/70 hover:bg-slate-800 text-slate-200 border-white/10'
              }`}
            >
              <Hand className="w-3.5 h-3.5" />
              <span>Рука</span>
            </button>

            <button
              onClick={() => setIsAnalyticsWindowOpen(prev => !prev)}
              className={`px-3 py-1.5 rounded-xl text-xs font-medium border transition flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer ${
                isAnalyticsWindowOpen
                  ? 'bg-amber-500 text-slate-950 border-amber-400 font-semibold'
                  : 'bg-slate-900/70 hover:bg-slate-800 text-amber-300 border-white/10'
              }`}
              title="Открыть графики дозиметрического анализа и таблицу защиты"
            >
              <BarChart3 className="w-3.5 h-3.5" />
              <span>Аналитика</span>
            </button>

            <div className="flex items-center rounded-xl border border-emerald-500/30 bg-slate-900/80 overflow-hidden shrink-0">
              <button
                onMouseDown={onStartVoicePushToTalk}
                onMouseUp={onStopVoicePushToTalk}
                onMouseLeave={() => {
                  if (isVoicePushToTalkActive) onStopVoicePushToTalk();
                }}
                onTouchStart={e => {
                  e.preventDefault();
                  onStartVoicePushToTalk();
                }}
                onTouchEnd={e => {
                  e.preventDefault();
                  onStopVoicePushToTalk();
                }}
                className={`px-2.5 py-1.5 text-xs font-medium transition flex items-center gap-1.5 whitespace-nowrap cursor-pointer ${
                  isVoicePushToTalkActive
                    ? 'bg-emerald-500 text-slate-950 font-semibold'
                    : 'text-emerald-300 hover:bg-emerald-500/15'
                }`}
                title="Удерживайте для записи речи (V / Y)"
              >
                <Mic className="w-3.5 h-3.5" />
                <span>{isVoicePushToTalkActive ? 'Запись...' : 'Голос PTT'}</span>
              </button>
              <button
                onClick={onToggleVoiceMode}
                className="px-2 py-1.5 text-[10px] font-mono bg-slate-800/80 hover:bg-slate-700 text-amber-300 border-l border-white/10 cursor-pointer"
                title="Режим распознавания NLU"
              >
                {voiceMode === 'hybrid' ? 'АВТО' : voiceMode === 'dictation' ? 'ЛОГ' : 'КОМ'}
              </button>
            </div>

            <button
              onClick={() => togglePopover('modules')}
              className={`px-3 py-1.5 rounded-xl text-xs font-medium border transition flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer ${
                activePopover === 'modules'
                  ? 'bg-cyan-500 text-slate-950 border-cyan-400 font-semibold'
                  : 'bg-slate-900/70 hover:bg-slate-800 text-slate-200 border-white/10'
              }`}
            >
              <Layers className="w-3.5 h-3.5" />
              <span>Практикум</span>
            </button>

            <button
              onClick={onResetScenario}
              className="px-2.5 py-1.5 rounded-xl bg-rose-600/80 hover:bg-rose-500 text-white text-xs font-medium border border-rose-400/40 transition flex items-center gap-1 whitespace-nowrap shrink-0 cursor-pointer"
              title="Сброс сценария (обнуление дозы и возврат 3D-объектов)"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Сброс</span>
            </button>
          </div>
        </div>
      )}
    </>
  );
};
