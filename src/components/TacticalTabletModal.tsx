/**
 * ALARA — Единый Тактический Планшет (TacticalTabletModal.tsx)
 * Вызывается по клавише [Tab] или [Esc] (и кнопкой «Планшет [Tab]» в HUD).
 */

import React, { useState } from 'react';
import {
  Activity,
  Atom,
  Award,
  BarChart3,
  BookOpen,
  CheckCircle2,
  ChevronDown,
  Download,
  FileSpreadsheet,
  FileText,
  Flame,
  Glasses,
  Heart,
  Layers,
  Mic,
  Monitor,
  Moon,
  NotebookPen,
  Play,
  Radio,
  RotateCcw,
  Send,
  Settings,
  Shield,
  Sliders,
  Sparkles,
  UserCheck,
  Volume2,
  VolumeX,
  X
} from 'lucide-react';
import { SCENARIOS, ScenarioDefinition } from '../scene/scenarios';
import type { XRDiagnosticsStatus } from '../scene/webxrManager';
import { InstrumentId, GOST_INSTRUMENTS } from '../instruments/gostInstruments';
import {
  ComprehensiveProtectionAnalysis,
  ISOTOPE_DATABASE,
  NORMAL_CONDITIONS,
  PPELoadoutId,
  PPE_LOADOUTS,
  RemoteToolId,
  REMOTE_TOOLS,
  calculateSafeStayTime
} from '../physics/gostPhysics';
import {
  COOP_ROLE_SPECIFICATIONS,
  type CoopSquadRole
} from '../network/MultiplayerManager';
import {
  CharacterCustomizer3D,
  CharacterPPEState,
  RESPIRATOR_DEFINITIONS,
  SUIT_DEFINITIONS
} from './CharacterCustomizer3D';
import type { TelemetryHistoryPoint } from './FloatingAnalyticsWindow';
import type { VoiceLogEntry, VoiceLoggerMode } from '../vr/voiceTaskLogger';
import type { IScenarioConfig } from '../scene/scenarioConfigRegistry';
import type { ScenarioRulesEvaluationResult } from '../scene/scenarioRulesEngine';
import {
  exportDoseHistoryPdfReport,
  type SessionExposureLimitsTracker
} from '../utils/pdfDoseReportExporter';
import type { MchsMissionMetrics } from '../scene/EvacuationManager';
import {
  SCENARIO4_STEPS,
  SCENARIO4_STEP_ORDER,
  Scenario4HudSnapshot
} from '../scenarios/scenario4-npp-rescue/config';

export type TacticalTabletTab = 'tasks' | 'ppe' | 'database' | 'analytics' | 'settings';

export type ShadowQualitySetting = 'low' | 'medium';

export interface TacticalTabletModalProps {
  isOpen: boolean;
  onClose: () => void;
  isVRSupported?: boolean;
  isInVR?: boolean;
  vrDiagnostics?: XRDiagnosticsStatus;
  onToggleVR?: () => void;

  activeScenarioId: number;
  scenario: ScenarioDefinition;
  scenarioStep: number;
  onSelectScenario: (id: number) => void;
  onStepChange: (step: number) => void;
  onResetScenario: () => void;
  scenario4Snapshot: Scenario4HudSnapshot | null;

  isExamMode: boolean;
  onChangeExamMode: (exam: boolean) => void;
  isRandomizedHazardMode: boolean;
  onToggleRandomizedHazardMode: () => void;

  selectedInstrumentId: InstrumentId;
  onSelectInstrument: (id: InstrumentId) => void;
  selectedIsotopeId: string;
  onSelectIsotope: (id: string) => void;
  ppeState: CharacterPPEState;
  onChangePPE: (state: CharacterPPEState) => void;
  selectedPpeId: PPELoadoutId;
  onChangePpeId: (id: PPELoadoutId) => void;
  selectedRemoteToolId: RemoteToolId;
  onSelectRemoteTool: (id: RemoteToolId) => void;

  vitalsBpm: number;
  oxygenPercent: number;
  spO2Percent: number;
  coreBodyTempC: number;
  coopRole?: CoopSquadRole;
  coopRoleCallsign: string;
  coopPeersCount: number;
  onCycleCoopRole: () => void;
  onSelectCoopRole?: (role: CoopSquadRole) => void;
  effectiveReachM?: number;

  currentDoseRateMicroSv: number;
  cumulativeDoseMsv: number;
  missionTimeSec: number;
  permitLimitMsv: number;
  onChangePermitLimitMsv: (limitMsv: number) => void;
  protectionAnalysis: ComprehensiveProtectionAnalysis;
  telemetryHistory: TelemetryHistoryPoint[];
  scenarioConfig: IScenarioConfig;
  rulesEvaluation: ScenarioRulesEvaluationResult | null;
  doseResetCount: number;
  getSessionLimitsSummary: () => SessionExposureLimitsTracker;
  mchsMetrics: MchsMissionMetrics;

  onOpenAnalyticsWindow: () => void;
  onExportCsv: () => void;
  onResetCharts: () => void;
  onOpenLabNotebook: () => void;
  onOpenSpectrometry: () => void;
  onOpenGostGuide: () => void;
  onOpenAlaraReport: () => void;
  onOpenAAR: () => void;
  onToast?: (type: 'info' | 'success' | 'warning' | 'danger', title: string, message: string) => void;

  voiceLogs: ReadonlyArray<VoiceLogEntry>;
  isVoicePushToTalkActive: boolean;
  voiceMode: VoiceLoggerMode;
  onStartVoicePushToTalk: () => void;
  onStopVoicePushToTalk: () => void;
  onToggleVoiceMode: () => void;
  onSubmitVoiceFallbackText: (text: string, mode?: VoiceLoggerMode) => void;

  hilLabel: string;
  hilCountsPerSec: number;
  hilProtocolTitle: string;
  onConnectHil: () => void;

  isLowLightMode: boolean;
  onToggleLowLightMode: () => void;
  isRadiationFieldVisible: boolean;
  onToggleRadiationField: () => void;
  isAudioMuted: boolean;
  onToggleAudio: () => void;
  hapticStrength: number;
  onChangeHapticStrength: (strength: number) => void;
  shadowQuality: ShadowQualitySetting;
  onChangeShadowQuality: (quality: ShadowQualitySetting) => void;
  hideStartupModal: boolean;
  onToggleHideStartupModal: (hide: boolean) => void;
}

export const TacticalTabletModal: React.FC<TacticalTabletModalProps> = ({
  isOpen,
  onClose,
  isVRSupported = false,
  isInVR = false,
  vrDiagnostics,
  onToggleVR,
  activeScenarioId,
  scenario,
  scenarioStep,
  onSelectScenario,
  onStepChange,
  onResetScenario,
  scenario4Snapshot,
  isExamMode,
  onChangeExamMode,
  isRandomizedHazardMode,
  onToggleRandomizedHazardMode,
  selectedInstrumentId,
  onSelectInstrument,
  onSelectIsotope,
  ppeState,
  onChangePPE,
  selectedPpeId,
  onChangePpeId,
  selectedRemoteToolId,
  onSelectRemoteTool,
  vitalsBpm,
  oxygenPercent,
  spO2Percent,
  coreBodyTempC,
  coopRole = 'RECON_DOSIMETRIST',
  coopRoleCallsign,
  coopPeersCount,
  onCycleCoopRole,
  onSelectCoopRole,
  effectiveReachM,
  currentDoseRateMicroSv,
  cumulativeDoseMsv,
  missionTimeSec,
  permitLimitMsv,
  onChangePermitLimitMsv,
  protectionAnalysis,
  telemetryHistory,
  scenarioConfig,
  rulesEvaluation,
  doseResetCount,
  getSessionLimitsSummary,
  mchsMetrics,
  onOpenAnalyticsWindow,
  onExportCsv,
  onResetCharts,
  onOpenLabNotebook,
  onOpenSpectrometry,
  onOpenGostGuide,
  onOpenAlaraReport,
  onOpenAAR,
  onToast,
  voiceLogs,
  isVoicePushToTalkActive,
  voiceMode,
  onStartVoicePushToTalk,
  onStopVoicePushToTalk,
  onToggleVoiceMode,
  onSubmitVoiceFallbackText,
  hilLabel,
  hilCountsPerSec,
  hilProtocolTitle,
  onConnectHil,
  isLowLightMode,
  onToggleLowLightMode,
  isRadiationFieldVisible,
  onToggleRadiationField,
  isAudioMuted,
  onToggleAudio,
  hapticStrength,
  onChangeHapticStrength,
  shadowQuality,
  onChangeShadowQuality,
  hideStartupModal,
  onToggleHideStartupModal
}) => {
  const [activeTab, setActiveTab] = useState<TacticalTabletTab>('tasks');
  const [dbSubTab, setDbSubTab] = useState<'instruments' | 'isotopes'>('instruments');
  const [instrumentCategoryFilter, setInstrumentCategoryFilter] = useState<string>('all');
  const [selectedDbNuclideKey, setSelectedDbNuclideKey] = useState<string>('Cs-137');
  const [voiceNoteInput, setVoiceNoteInput] = useState<string>('');
  const [isExportingPdf, setIsExportingPdf] = useState<boolean>(false);
  const [isMissionDetailsOpen, setIsMissionDetailsOpen] = useState<boolean>(false);
  const [isIsotopeDetailsOpen, setIsIsotopeDetailsOpen] = useState<boolean>(false);
  const [isVoicePanelOpen, setIsVoicePanelOpen] = useState<boolean>(false);
  const [isHotkeysOpen, setIsHotkeysOpen] = useState<boolean>(false);
  const [isNormsOpen, setIsNormsOpen] = useState<boolean>(false);

  if (!isOpen) return null;

  const safeStay = calculateSafeStayTime(
    currentDoseRateMicroSv,
    permitLimitMsv,
    cumulativeDoseMsv
  );
  const currentStage = scenario.stages[scenarioStep] || scenario.stages[0];

  const handleExportPdf = async () => {
    if (isExportingPdf) return;
    setIsExportingPdf(true);
    try {
      const res = await exportDoseHistoryPdfReport({
        history: telemetryHistory,
        currentAnalysis: protectionAnalysis,
        cumulativeDoseMsv,
        missionTimeSec,
        permitLimitMsv,
        selectedPpeId,
        selectedRemoteToolId,
        scenarioTitle: `${scenario.titleRu} — ${scenario.facilityRu}`,
        scenarioConfig,
        scenarioMeta: {
          id: scenario.id,
          titleRu: scenario.titleRu,
          facilityRu: scenario.facilityRu,
          categoryRu: scenario.categoryRu,
          shortDescriptionRu: scenario.shortDescriptionRu,
          dominantIsotopes: scenario.dominantIsotopes,
          recommendedPermitLimitMsv: scenario.recommendedPermitLimitMsv
        },
        rulesEvaluation,
        voiceLogs,
        doseResetCount,
        sessionLimits: getSessionLimitsSummary(),
        mchsMetrics
      });
      onToast?.('success', 'PDF-ОТЧЕТ СФОРМИРОВАН', `Сохранен файл: ${res.fileName}`);
    } catch (err) {
      console.error('[ALARA] Ошибка экспорта PDF из тактического планшета:', err);
      onToast?.('danger', 'ОШИБКА ЭКСПОРТА PDF', 'Не удалось сформировать PDF-отчет.');
    } finally {
      setIsExportingPdf(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-[#0B1117]/75 flex items-center justify-center p-3 sm:p-5 font-sans select-none">
      <div className="max-w-5xl w-full h-[90vh] rounded-xl alara-glass-elevated flex flex-col overflow-hidden text-[#F1F5F9]">
        {/* Верхняя панель */}
        <header className="flex flex-wrap items-center justify-between gap-3 px-5 py-3 border-b border-slate-400/15 shrink-0">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="p-2 rounded-[10px] bg-[#0EA5E9]/15 border border-[#0EA5E9]/35 text-[#0EA5E9] shrink-0">
              <Shield className="w-4 h-4" />
            </div>
            <h1 className="text-base font-semibold text-[#F1F5F9] tracking-tight truncate">
              ALARA · МЧС Узбекистана
            </h1>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            {/* Desktop / VR */}
            <div className="flex items-center p-0.5 rounded-[10px] alara-surface text-xs font-medium">
              <button
                type="button"
                onClick={() => {
                  if (isInVR && onToggleVR) onToggleVR();
                }}
                className={`px-2.5 py-1.5 rounded-[8px] flex items-center gap-1.5 transition cursor-pointer whitespace-nowrap ${
                  !isInVR ? 'bg-[#0EA5E9] text-[#0B1117] font-semibold' : 'text-[#94A3B8] hover:text-[#F1F5F9]'
                }`}
              >
                <Monitor className="w-3.5 h-3.5" />
                <span>Desktop</span>
              </button>
              <button
                type="button"
                disabled={!onToggleVR}
                onClick={() => {
                  if (!isInVR && onToggleVR) {
                    onClose();
                    onToggleVR();
                  }
                }}
                title={
                  vrDiagnostics
                    ? `${vrDiagnostics.statusSummaryRu}. ${vrDiagnostics.lastErrorMessageRu || vrDiagnostics.hintRu}`
                    : isVRSupported
                    ? 'VR-режим (HTC Vive)'
                    : 'Проверить WebXR и войти в VR (HTC Vive)'
                }
                className={`px-2.5 py-1.5 rounded-[8px] flex items-center gap-1.5 transition whitespace-nowrap ${
                  isInVR
                    ? 'bg-[#F59E0B] text-[#0B1117] font-semibold cursor-pointer'
                    : isVRSupported && onToggleVR
                    ? 'text-[#F59E0B] hover:bg-slate-800/70 cursor-pointer'
                    : onToggleVR
                    ? 'text-[#CBD5E1] hover:bg-slate-800/70 cursor-pointer'
                    : 'text-[#64748B] opacity-50 cursor-not-allowed'
                }`}
              >
                <Glasses className="w-3.5 h-3.5" />
                <span>{isVRSupported || isInVR ? 'VR' : 'VR (?)'}</span>
              </button>
            </div>

            {/* Практикум / Экзамен */}
            <div className="flex items-center p-0.5 rounded-[10px] alara-surface text-xs font-medium">
              <button
                type="button"
                onClick={() => onChangeExamMode(false)}
                className={`px-2.5 py-1.5 rounded-[8px] transition cursor-pointer whitespace-nowrap ${
                  !isExamMode
                    ? 'bg-[#14B8A6] text-[#0B1117] font-semibold'
                    : 'text-[#94A3B8] hover:text-[#F1F5F9]'
                }`}
              >
                Практикум
              </button>
              <button
                type="button"
                onClick={() => onChangeExamMode(true)}
                className={`px-2.5 py-1.5 rounded-[8px] transition cursor-pointer whitespace-nowrap ${
                  isExamMode
                    ? 'bg-[#F59E0B] text-[#0B1117] font-semibold'
                    : 'text-[#94A3B8] hover:text-[#F1F5F9]'
                }`}
              >
                Экзамен
              </button>
            </div>

            <button
              type="button"
              onClick={onClose}
              className="p-2 rounded-[10px] text-[#94A3B8] hover:text-[#F1F5F9] alara-surface hover:bg-slate-800/80 cursor-pointer transition"
              title="Закрыть (Tab / Esc)"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </header>

        {/* Навигация по 5 вкладкам */}
        <nav className="flex flex-wrap items-center gap-1 px-5 py-2 border-b border-slate-400/15 shrink-0 text-xs font-medium">
          {[
            { id: 'tasks' as const, label: 'Миссии', icon: BookOpen },
            { id: 'ppe' as const, label: 'Экипировка', icon: Shield },
            { id: 'database' as const, label: 'Приборы', icon: Atom },
            { id: 'analytics' as const, label: 'Отчёт', icon: BarChart3 },
            { id: 'settings' as const, label: 'Управление', icon: Settings }
          ].map(tab => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={`px-3 py-1.5 rounded-[10px] transition flex items-center gap-1.5 cursor-pointer whitespace-nowrap ${
                  isActive
                    ? 'bg-[#0EA5E9] text-[#0B1117] font-semibold'
                    : 'text-[#94A3B8] hover:text-[#F1F5F9] hover:bg-slate-800/60'
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </nav>

        {/* Содержимое активной вкладки */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {/* ===================================================================== */}
          {/* ВКЛАДКА 1: МИССИИ */}
          {/* ===================================================================== */}
          {activeTab === 'tasks' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-sm font-semibold text-[#F1F5F9]">Выбор миссии</h2>
                <span className="font-mono alara-tabular text-xs text-[#94A3B8]">
                  Активна: <strong className="text-[#0EA5E9]">#{activeScenarioId}</strong>
                </span>
              </div>

              {/* Сетка 2×2 карточек сценариев (строго 3 элемента на карточку) */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
                {SCENARIOS.map(scen => {
                  const isSelected = scen.id === activeScenarioId;
                  const cardTitle = scen.cardTitleRu || scen.titleRu;
                  const cardContext = scen.cardContextRu;
                  const cardEssence = scen.cardEssenceRu || scen.shortDescriptionRu;
                  const cardTags = scen.cardTags || scen.dominantIsotopes.slice(0, 3);

                  return (
                    <div
                      key={scen.id}
                      onClick={() => {
                        onSelectScenario(scen.id);
                        onClose();
                      }}
                      className={`p-4 rounded-xl border transition cursor-pointer flex flex-col justify-between gap-4 ${
                        isSelected
                          ? 'bg-[#0EA5E9]/10 border-[#0EA5E9]'
                          : 'alara-surface hover:border-slate-400/35 hover:bg-slate-900/70'
                      }`}
                    >
                      {/* Элемент 1 и 2: Короткий заголовок (+ контекст) и суть в одну строку */}
                      <div className="space-y-1.5">
                        <h3 className="font-semibold text-[15px] text-[#F1F5F9] leading-snug">
                          {cardTitle}
                          {cardContext ? (
                            <span className="ml-1.5 font-normal text-xs text-[#94A3B8]">
                              ({cardContext})
                            </span>
                          ) : null}
                        </h3>
                        <p className="text-xs text-[#94A3B8]">{cardEssence}</p>
                      </div>

                      {/* Элемент 3: Короткие теги + Крупная кнопка Старт / Активен */}
                      <div className="flex items-center justify-between gap-3 pt-2.5 border-t border-slate-400/15">
                        <div className="flex flex-wrap items-center gap-1.5 text-[11px] font-mono text-[#94A3B8]">
                          {cardTags.slice(0, 3).map((tag, idx) => (
                            <React.Fragment key={tag}>
                              {idx > 0 && <span className="text-[#475569]">·</span>}
                              <span>{tag}</span>
                            </React.Fragment>
                          ))}
                        </div>

                        <button
                          type="button"
                          onClick={e => {
                            e.stopPropagation();
                            if (!isSelected) {
                              onSelectScenario(scen.id);
                            }
                            onClose();
                          }}
                          className={`px-4 py-1.5 rounded-[10px] text-xs font-semibold flex items-center gap-1.5 cursor-pointer whitespace-nowrap transition shrink-0 ${
                            isSelected
                              ? 'bg-[#10B981]/15 text-[#10B981] border border-[#10B981]/45'
                              : 'bg-[#0EA5E9] hover:bg-sky-400 text-[#0B1117]'
                          }`}
                        >
                          {isSelected ? (
                            <>
                              <CheckCircle2 className="w-3.5 h-3.5" />
                              <span>Активен</span>
                            </>
                          ) : (
                            <>
                              <Play className="w-3.5 h-3.5 fill-current" />
                              <span>Старт</span>
                            </>
                          )}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Компактная полоса активной миссии + спойлер деталей */}
              <div className="rounded-xl alara-surface p-3.5 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-[11px] font-mono alara-tabular text-[#0EA5E9]">
                      Фаза{' '}
                      {scenario.id === 4 && scenario4Snapshot
                        ? scenario4Snapshot.stepNumber
                        : scenarioStep + 1}{' '}
                      /{' '}
                      {scenario.id === 4 && scenario4Snapshot
                        ? scenario4Snapshot.totalSteps
                        : scenario.stages.length}
                    </div>
                    <div className="text-xs font-semibold text-[#F1F5F9] truncate mt-0.5">
                      {scenario4Snapshot && scenario.id === 4
                        ? scenario4Snapshot.stepTitleRu
                        : currentStage?.titleRu || scenario.titleRu}
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    {scenario.id !== 4 && (
                      <button
                        type="button"
                        onClick={() => onStepChange(scenarioStep + 1)}
                        className="px-3 py-1.5 rounded-[10px] bg-[#10B981] hover:bg-emerald-400 text-[#0B1117] text-xs font-semibold cursor-pointer whitespace-nowrap transition"
                      >
                        Зачесть этап
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={onResetScenario}
                      className="px-3 py-1.5 rounded-[10px] bg-[#EF4444]/15 hover:bg-[#EF4444]/25 border border-[#EF4444]/40 text-[#EF4444] text-xs font-medium flex items-center gap-1.5 cursor-pointer whitespace-nowrap transition"
                    >
                      <RotateCcw className="w-3.5 h-3.5" />
                      <span>Сброс</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setIsMissionDetailsOpen(prev => !prev)}
                      className="px-2.5 py-1.5 rounded-[10px] bg-[#0B1117] border border-slate-400/20 text-[#94A3B8] hover:text-[#F1F5F9] text-xs font-medium flex items-center gap-1 cursor-pointer whitespace-nowrap transition"
                    >
                      <ChevronDown
                        className={`w-3.5 h-3.5 transition-transform ${
                          isMissionDetailsOpen ? 'rotate-180' : ''
                        }`}
                      />
                      <span>Подробнее ?</span>
                    </button>
                  </div>
                </div>

                {isMissionDetailsOpen && (
                  <div className="pt-3 border-t border-slate-400/15 space-y-3 text-xs">
                    <p className="text-[#94A3B8] leading-relaxed">
                      {scenario4Snapshot && scenario.id === 4
                        ? scenario4Snapshot.instructionRu
                        : currentStage?.taskRu}
                    </p>

                    {scenario4Snapshot && scenario.id === 4 && (
                      <div className="flex flex-wrap gap-4 font-mono alara-tabular text-[#94A3B8]">
                        <span>
                          Очаги:{' '}
                          <strong className="text-[#F59E0B]">
                            {scenario4Snapshot.firesExtinguished}/{scenario4Snapshot.totalFires}
                          </strong>
                        </span>
                        <span>
                          Спасено:{' '}
                          <strong className="text-[#10B981]">
                            {scenario4Snapshot.rescuedCount}/{scenario4Snapshot.totalNpcCount}
                          </strong>
                        </span>
                        <span>
                          ОУ-5:{' '}
                          <strong className="text-[#0EA5E9]">
                            {scenario4Snapshot.extinguisherChargePct}%
                          </strong>
                        </span>
                        <span>
                          Ошибки:{' '}
                          <strong className="text-[#EF4444]">
                            {scenario4Snapshot.safetyErrorCount}
                          </strong>
                        </span>
                      </div>
                    )}

                    <div className="space-y-1.5 max-h-44 overflow-y-auto pr-1">
                      {scenario4Snapshot && scenario.id === 4
                        ? SCENARIO4_STEP_ORDER.map((stepKey, idx) => {
                            const curIdx = SCENARIO4_STEP_ORDER.indexOf(scenario4Snapshot.stepId);
                            const isCompletedOutcome =
                              scenario4Snapshot.debrief?.outcome === 'COMPLETED';
                            const isFailedOutcome =
                              scenario4Snapshot.debrief?.outcome === 'FAILED';
                            const isDone = isCompletedOutcome || (curIdx >= 0 && idx < curIdx);
                            const isCurrent = !scenario4Snapshot.debrief && idx === curIdx;
                            return (
                              <div
                                key={stepKey}
                                className={`px-3 py-1.5 rounded-[10px] border flex items-center justify-between ${
                                  isCurrent
                                    ? 'bg-[#0EA5E9]/12 border-[#0EA5E9]/50 text-[#F1F5F9]'
                                    : isDone
                                    ? 'bg-[#10B981]/10 border-[#10B981]/35 text-[#10B981]'
                                    : isFailedOutcome && idx === SCENARIO4_STEP_ORDER.length - 1
                                    ? 'bg-[#EF4444]/10 border-[#EF4444]/40 text-[#EF4444]'
                                    : 'border-slate-400/15 text-[#94A3B8]'
                                }`}
                              >
                                <span>
                                  {idx + 1}. {SCENARIO4_STEPS[stepKey].titleRu}
                                </span>
                                <span className="text-[11px] font-mono alara-tabular">
                                  {isDone
                                    ? 'Готово'
                                    : isCurrent
                                    ? 'Активно'
                                    : isFailedOutcome && idx === SCENARIO4_STEP_ORDER.length - 1
                                    ? 'Срыв'
                                    : 'Далее'}
                                </span>
                              </div>
                            );
                          })
                        : scenario.stages.map((st, idx) => {
                            const isDone = idx < scenarioStep;
                            const isCurrent = idx === scenarioStep;
                            return (
                              <div
                                key={st.titleRu + idx}
                                className={`px-3 py-1.5 rounded-[10px] border ${
                                  isCurrent
                                    ? 'bg-[#0EA5E9]/12 border-[#0EA5E9]/50 text-[#F1F5F9]'
                                    : isDone
                                    ? 'bg-[#10B981]/10 border-[#10B981]/35 text-[#10B981]'
                                    : 'border-slate-400/15 text-[#94A3B8]'
                                }`}
                              >
                                <div className="flex items-center justify-between font-medium">
                                  <span>
                                    {idx + 1}. {st.titleRu}
                                  </span>
                                  <span className="text-[11px] font-mono">
                                    {isDone ? 'Готово' : isCurrent ? 'Текущий' : 'Далее'}
                                  </span>
                                </div>
                              </div>
                            );
                          })}
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5 pt-2 border-t border-slate-400/15">
                      <button
                        type="button"
                        onClick={onToggleRandomizedHazardMode}
                        className={`px-3 py-2 rounded-[10px] border text-left transition flex items-center justify-between cursor-pointer ${
                          isRandomizedHazardMode
                            ? 'bg-[#F59E0B]/15 border-[#F59E0B]/50 text-[#F59E0B] font-semibold'
                            : 'bg-[#0B1117] border-slate-400/20 text-[#94A3B8] hover:text-[#F1F5F9]'
                        }`}
                      >
                        <span>Рандомизация очагов</span>
                        <span className="font-mono alara-tabular">
                          {isRandomizedHazardMode ? 'Вкл' : 'Выкл'}
                        </span>
                      </button>

                      <div className="px-3 py-2 rounded-[10px] bg-[#0B1117] border border-slate-400/20 flex items-center justify-between font-mono alara-tabular text-[11px] text-[#94A3B8]">
                        <span>Прогресс МЧС:</span>
                        <strong className="text-[#F1F5F9]">
                          {mchsMetrics.operationsCompleted} опер. · {mchsMetrics.extractedCount}/
                          {mchsMetrics.totalExtractable} эвак. · {mchsMetrics.firesExtinguished} огн.
                        </strong>
                      </div>

                      <button
                        type="button"
                        onClick={() => {
                          onClose();
                          onOpenLabNotebook();
                        }}
                        className="px-3 py-2 rounded-[10px] bg-[#0B1117] hover:bg-slate-800/80 border border-slate-400/20 text-[#0EA5E9] font-medium flex items-center gap-2 cursor-pointer"
                      >
                        <NotebookPen className="w-3.5 h-3.5" />
                        <span>Лаб. журнал</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => {
                          onClose();
                          onOpenSpectrometry();
                        }}
                        className="px-3 py-2 rounded-[10px] bg-[#0B1117] hover:bg-slate-800/80 border border-slate-400/20 text-[#14B8A6] font-medium flex items-center gap-2 cursor-pointer"
                      >
                        <Activity className="w-3.5 h-3.5" />
                        <span>Спектрометр МКА</span>
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ===================================================================== */}
          {/* ВКЛАДКА 2: ЭКИПИРОВКА */}
          {/* ===================================================================== */}
          {activeTab === 'ppe' && (() => {
            const activeRoleSpec =
              COOP_ROLE_SPECIFICATIONS[coopRole] || COOP_ROLE_SPECIFICATIONS.RECON_DOSIMETRIST;
            const activeToolSpec = REMOTE_TOOLS[selectedRemoteToolId] || REMOTE_TOOLS.hand;
            const activeSuitDef = SUIT_DEFINITIONS[ppeState.suitId];
            const activeRespDef = RESPIRATOR_DEFINITIONS[ppeState.respiratorId];
            const computedReachM =
              effectiveReachM ??
              3.2 + activeToolSpec.addedDistanceM + activeRoleSpec.modifiers.interactionReachBonusM;

            return (
              <div className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
                  <button
                    type="button"
                    onClick={() => {
                      onSelectInstrument('dp5');
                      onChangePPE({ suitId: 'bop_suit', respiratorId: 'ppm88_mask', instrumentId: 'dp5' });
                      onSelectRemoteTool('hand');
                      onSelectCoopRole?.('LIQUIDATOR_OPERATOR');
                      onToast?.(
                        'success',
                        'БОП-1 АКТИВИРОВАН',
                        '350°C · 10 кВ · ППМ-88 · Роль АТОМ-2.'
                      );
                    }}
                    className={`p-3.5 rounded-xl border text-left transition cursor-pointer ${
                      ppeState.suitId === 'bop_suit'
                        ? 'bg-[#F59E0B]/12 border-[#F59E0B]'
                        : 'alara-surface hover:border-slate-400/35'
                    }`}
                  >
                    <div className="flex items-center justify-between font-semibold text-[#F59E0B]">
                      <span className="flex items-center gap-1.5">
                        <Flame className="w-3.5 h-3.5" /> Расчёт БОП-1
                      </span>
                      <span className="text-[11px] font-mono alara-tabular">350°C · 10 кВ</span>
                    </div>
                    <div className="text-[11px] text-[#94A3B8] mt-1">ППМ-88 · АТОМ-2</div>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      onSelectInstrument('dp5');
                      onChangePPE({ suitId: 'kih4_suit', respiratorId: 'gp7vm_gasmask', instrumentId: 'dp5' });
                      onSelectRemoteTool('manipulator_15m');
                      onSelectCoopRole?.('LIQUIDATOR_OPERATOR');
                      onToast?.(
                        'success',
                        'КИХ-4 АКТИВИРОВАН',
                        'Манипулятор +1.5 м · ГП-7ВМ · Роль АТОМ-2.'
                      );
                    }}
                    className={`p-3.5 rounded-xl border text-left transition cursor-pointer ${
                      ppeState.suitId === 'kih4_suit'
                        ? 'bg-[#0EA5E9]/12 border-[#0EA5E9]'
                        : 'alara-surface hover:border-slate-400/35'
                    }`}
                  >
                    <div className="flex items-center justify-between font-semibold text-[#0EA5E9]">
                      <span className="flex items-center gap-1.5">
                        <Shield className="w-3.5 h-3.5" /> РХБ-защита КИХ-4
                      </span>
                      <span className="text-[11px] font-mono alara-tabular">+1.5 м</span>
                    </div>
                    <div className="text-[11px] text-[#94A3B8] mt-1">ГП-7ВМ · Манипулятор</div>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      onSelectInstrument('dp5');
                      onChangePPE({ suitId: 'l1_suit', respiratorId: 'asv2_scba', instrumentId: 'dp5' });
                      onSelectRemoteTool('telescopic_rod_3m');
                      onSelectCoopRole?.('RECON_DOSIMETRIST');
                      onToast?.(
                        'success',
                        'Л-1 + АСВ-2 АКТИВИРОВАН',
                        'Штанга +2.8 м · АСВ-2 · Роль АТОМ-1.'
                      );
                    }}
                    className={`p-3.5 rounded-xl border text-left transition cursor-pointer ${
                      ppeState.suitId === 'l1_suit'
                        ? 'bg-[#14B8A6]/12 border-[#14B8A6]'
                        : 'alara-surface hover:border-slate-400/35'
                    }`}
                  >
                    <div className="flex items-center justify-between font-semibold text-[#14B8A6]">
                      <span className="flex items-center gap-1.5">
                        <Sparkles className="w-3.5 h-3.5" /> Разведка Л-1 + АСВ-2
                      </span>
                      <span className="text-[11px] font-mono alara-tabular">+2.8 м</span>
                    </div>
                    <div className="text-[11px] text-[#94A3B8] mt-1">Штанга 2.8 м · АТОМ-1</div>
                  </button>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-3 p-3.5 rounded-xl alara-surface text-xs">
                  <div>
                    <label className="text-[11px] text-[#94A3B8] block mb-1">Защита СИЗ</label>
                    <select
                      value={selectedPpeId}
                      onChange={e => onChangePpeId(e.target.value as PPELoadoutId)}
                      className="w-full bg-[#0B1117] text-[#F1F5F9] text-xs border border-slate-400/20 rounded-[10px] px-2.5 py-1.5 focus:outline-none focus:border-[#0EA5E9]"
                    >
                      {Object.values(PPE_LOADOUTS).map(ppe => (
                        <option key={ppe.id} value={ppe.id}>
                          {ppe.shortNameRu}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="text-[11px] text-[#94A3B8] block mb-1">Инструмент</label>
                    <select
                      value={selectedRemoteToolId}
                      onChange={e => onSelectRemoteTool(e.target.value as RemoteToolId)}
                      className="w-full bg-[#0B1117] text-[#F1F5F9] text-xs border border-slate-400/20 rounded-[10px] px-2.5 py-1.5 focus:outline-none focus:border-[#0EA5E9]"
                    >
                      {Object.values(REMOTE_TOOLS).map(tool => (
                        <option key={tool.id} value={tool.id}>
                          {tool.shortNameRu}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="flex flex-col justify-between">
                    <div className="flex items-center justify-between text-[11px] font-mono alara-tabular text-[#94A3B8]">
                      <span className="flex items-center gap-1 text-[#EF4444]">
                        <Heart className="w-3.5 h-3.5" /> {vitalsBpm}
                      </span>
                      <span>
                        O₂ <strong className="text-[#10B981]">{oxygenPercent.toFixed(0)}%</strong> · SpO₂{' '}
                        {spO2Percent.toFixed(0)}% · {coreBodyTempC.toFixed(1)}°C
                      </span>
                    </div>
                    {onSelectCoopRole ? (
                      <div className="mt-1.5">
                        <select
                          value={coopRole}
                          onChange={e => onSelectCoopRole(e.target.value as CoopSquadRole)}
                          className="w-full bg-[#0B1117] text-[#0EA5E9] text-xs font-mono border border-slate-400/20 rounded-[10px] px-2.5 py-1.5 focus:outline-none focus:border-[#0EA5E9]"
                          title="Роль звена"
                        >
                          {Object.values(COOP_ROLE_SPECIFICATIONS).map(spec => (
                            <option key={spec.role} value={spec.role}>
                              {spec.callsignRu} ({coopPeersCount + 1}/3)
                            </option>
                          ))}
                        </select>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={onCycleCoopRole}
                        className="mt-1.5 px-3 py-1.5 rounded-[10px] bg-[#0B1117] hover:bg-slate-800/80 border border-slate-400/20 text-[#0EA5E9] text-xs font-medium flex items-center justify-between cursor-pointer"
                      >
                        <span className="flex items-center gap-1.5">
                          <UserCheck className="w-3.5 h-3.5" /> Роль:
                        </span>
                        <span className="font-mono alara-tabular">
                          {coopRoleCallsign} ({coopPeersCount + 1}/3)
                        </span>
                      </button>
                    )}
                  </div>
                </div>

                {/* Компактная сводка параметров */}
                <div className="px-3.5 py-2 rounded-xl bg-[#0EA5E9]/8 border border-[#0EA5E9]/25 flex flex-wrap items-center justify-between gap-2 text-[11px] font-mono alara-tabular">
                  <span className="text-[#F1F5F9]">
                    Дистанция <strong className="text-[#0EA5E9]">{computedReachM.toFixed(1)} м</strong>
                    <span className="text-[#64748B] mx-1.5">·</span>
                    Термо <strong className="text-[#F59E0B]">{activeSuitDef.thermalRatingC}°C</strong>
                    <span className="text-[#64748B] mx-1.5">·</span>
                    Фильтр <strong className="text-[#10B981]">{activeRespDef.filtrationEfficiencyPercent}%</strong>
                  </span>
                  <span style={{ color: activeRoleSpec.primaryColorHex }} className="font-semibold">
                    {activeRoleSpec.badgeCodeRu}
                  </span>
                </div>

                <CharacterCustomizer3D
                  ppeState={ppeState}
                  onChangePPE={onChangePPE}
                  selectedRemoteToolId={selectedRemoteToolId}
                  onChangeRemoteTool={onSelectRemoteTool}
                  coopRole={coopRole}
                  onChangeCoopRole={onSelectCoopRole}
                />
              </div>
            );
          })()}

          {/* ===================================================================== */}
          {/* ВКЛАДКА 3: ПРИБОРЫ */}
          {/* ===================================================================== */}
          {activeTab === 'database' && (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-400/15 pb-2.5">
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setDbSubTab('instruments')}
                    className={`px-3 py-1.5 rounded-[10px] text-xs font-semibold cursor-pointer transition whitespace-nowrap ${
                      dbSubTab === 'instruments'
                        ? 'bg-[#0EA5E9] text-[#0B1117]'
                        : 'alara-surface text-[#94A3B8] hover:text-[#F1F5F9]'
                    }`}
                  >
                    Приборы
                  </button>
                  <button
                    type="button"
                    onClick={() => setDbSubTab('isotopes')}
                    className={`px-3 py-1.5 rounded-[10px] text-xs font-semibold cursor-pointer transition whitespace-nowrap ${
                      dbSubTab === 'isotopes'
                        ? 'bg-[#0EA5E9] text-[#0B1117]'
                        : 'alara-surface text-[#94A3B8] hover:text-[#F1F5F9]'
                    }`}
                  >
                    Изотопы
                  </button>
                </div>

                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    onOpenGostGuide();
                  }}
                  className="px-3 py-1.5 rounded-[10px] alara-surface hover:bg-slate-800/80 text-[#F59E0B] text-xs font-medium flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
                >
                  <BookOpen className="w-3.5 h-3.5" />
                  <span>Справочник ГОСТ</span>
                </button>
              </div>

              {dbSubTab === 'instruments' && (
                <div className="space-y-3">
                  <div className="flex flex-wrap gap-1.5 text-xs">
                    {[
                      { id: 'all', label: 'Все' },
                      { id: 'geiger', label: 'Гейгер' },
                      { id: 'scintillator', label: 'Сцинтиллятор' },
                      { id: 'semiconductor', label: 'Полупроводн.' },
                      { id: 'ion_chamber', label: 'Ионизац.' },
                      { id: 'neutron', label: 'Нейтронный' }
                    ].map(f => (
                      <button
                        key={f.id}
                        type="button"
                        onClick={() => setInstrumentCategoryFilter(f.id)}
                        className={`px-2.5 py-1 rounded-[10px] border cursor-pointer transition whitespace-nowrap ${
                          instrumentCategoryFilter === f.id
                            ? 'bg-[#0EA5E9]/15 border-[#0EA5E9] text-[#0EA5E9] font-semibold'
                            : 'alara-surface text-[#94A3B8] hover:text-[#F1F5F9]'
                        }`}
                      >
                        {f.label}
                      </button>
                    ))}
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                    {Object.values(GOST_INSTRUMENTS)
                      .filter(
                        inst =>
                          instrumentCategoryFilter === 'all' ||
                          inst.category === instrumentCategoryFilter
                      )
                      .map(inst => {
                        const isEquipped = inst.id === selectedInstrumentId;
                        return (
                          <div
                            key={inst.id}
                            title={inst.nameFull}
                            className={`p-3.5 rounded-xl border flex flex-col justify-between ${
                              isEquipped ? 'bg-[#0EA5E9]/10 border-[#0EA5E9]' : 'alara-surface'
                            }`}
                          >
                            <div className="space-y-1.5">
                              <div className="flex items-center justify-between text-[11px] font-mono">
                                <span className="text-[#94A3B8]">{inst.gostStandard}</span>
                                <span className="text-[#F59E0B] uppercase">
                                  {inst.detectedRadiation.join('/')}
                                </span>
                              </div>
                              <h4 className="font-semibold text-sm text-[#F1F5F9]">{inst.name}</h4>
                              <div className="pt-1.5 text-[11px] font-mono alara-tabular text-[#94A3B8] border-t border-slate-400/15 space-y-0.5">
                                <div>{inst.measurementRangeRu}</div>
                                <div>
                                  ±{inst.basicErrorPercent}% · τ {inst.timeConstantSec} с
                                </div>
                              </div>
                            </div>

                            <button
                              type="button"
                              onClick={() => {
                                onSelectInstrument(inst.id);
                                onChangePPE({ ...ppeState, instrumentId: inst.id });
                              }}
                              className={`mt-3 w-full py-1.5 rounded-[10px] text-xs font-semibold flex items-center justify-center gap-1.5 cursor-pointer transition whitespace-nowrap ${
                                isEquipped
                                  ? 'bg-[#10B981]/15 text-[#10B981] border border-[#10B981]/40'
                                  : 'bg-[#0EA5E9] hover:bg-sky-400 text-[#0B1117]'
                              }`}
                            >
                              {isEquipped ? <CheckCircle2 className="w-3.5 h-3.5" /> : null}
                              <span>{isEquipped ? 'Активен' : 'Выбрать'}</span>
                            </button>
                          </div>
                        );
                      })}
                  </div>
                </div>
              )}

              {dbSubTab === 'isotopes' && (
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 items-start">
                  <div className="space-y-1.5 max-h-[420px] overflow-y-auto pr-1">
                    {['Co-60', 'Cs-137', 'Am-241', 'Sr-90', 'Pu-239', 'Cf-252', 'Ir-192', 'Ra-226', 'F-18'].map(
                      key => {
                        const iso = ISOTOPE_DATABASE[key];
                        if (!iso) return null;
                        const isSel = selectedDbNuclideKey === key;
                        return (
                          <div
                            key={key}
                            onClick={() => {
                              setSelectedDbNuclideKey(key);
                              onSelectIsotope(key);
                            }}
                            className={`p-2.5 rounded-[10px] border cursor-pointer flex items-center justify-between transition ${
                              isSel
                                ? 'bg-[#0EA5E9]/12 border-[#0EA5E9] text-[#F1F5F9]'
                                : 'alara-surface text-[#94A3B8] hover:border-slate-400/35'
                            }`}
                          >
                            <div>
                              <div className="font-semibold text-xs text-[#F1F5F9]">
                                {iso.symbol}{' '}
                                <span className="text-[#94A3B8] font-normal">· {iso.nameRu}</span>
                              </div>
                              <div className="text-[11px] text-[#64748B] font-mono alara-tabular">
                                T½ {iso.halfLifeText} · wR {iso.wR}
                              </div>
                            </div>
                            <span className="text-[11px] font-mono text-[#F59E0B] uppercase">
                              {iso.radiationType}
                            </span>
                          </div>
                        );
                      }
                    )}
                  </div>

                  {ISOTOPE_DATABASE[selectedDbNuclideKey] && (
                    <div className="lg:col-span-2 p-4 rounded-xl alara-surface space-y-3 text-xs">
                      {(() => {
                        const iso = ISOTOPE_DATABASE[selectedDbNuclideKey];
                        return (
                          <>
                            <div className="flex items-center justify-between border-b border-slate-400/15 pb-2.5">
                              <h3 className="text-base font-semibold text-[#F1F5F9]">
                                {iso.symbol} · {iso.nameRu}
                              </h3>
                              <button
                                type="button"
                                onClick={() => onSelectIsotope(iso.id)}
                                className="px-3 py-1.5 bg-[#0EA5E9] hover:bg-sky-400 text-[#0B1117] font-semibold rounded-[10px] cursor-pointer shrink-0 transition whitespace-nowrap"
                              >
                                Применить
                              </button>
                            </div>
                            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5 font-mono alara-tabular">
                              <div className="p-2.5 rounded-[10px] bg-[#0B1117]/75 border border-slate-400/15">
                                <span className="text-[#64748B] block text-[11px]">Период T½</span>
                                <strong className="text-[#14B8A6]">{iso.halfLifeText}</strong>
                              </div>
                              <div className="p-2.5 rounded-[10px] bg-[#0B1117]/75 border border-slate-400/15">
                                <span className="text-[#64748B] block text-[11px]">Г_γ</span>
                                <strong className="text-[#F59E0B]">{iso.gammaConstant}</strong>
                              </div>
                              <div className="p-2.5 rounded-[10px] bg-[#0B1117]/75 border border-slate-400/15">
                                <span className="text-[#64748B] block text-[11px]">w_R</span>
                                <strong className="text-[#EF4444]">{iso.wR}</strong>
                              </div>
                              <div className="p-2.5 rounded-[10px] bg-[#0B1117]/75 border border-slate-400/15">
                                <span className="text-[#64748B] block text-[11px]">E_γ</span>
                                <strong className="text-[#F1F5F9]">{iso.energyMev} МэВ</strong>
                              </div>
                              <div className="p-2.5 rounded-[10px] bg-[#0B1117]/75 border border-slate-400/15">
                                <span className="text-[#64748B] block text-[11px]">E_β max</span>
                                <strong className="text-[#F1F5F9]">{iso.maxBetaEnergyMev} МэВ</strong>
                              </div>
                              <div className="p-2.5 rounded-[10px] bg-[#0B1117]/75 border border-slate-400/15">
                                <span className="text-[#64748B] block text-[11px]">Спектр</span>
                                <strong className="text-[#10B981] text-[11px]">
                                  {Object.entries(iso.emissionShares)
                                    .filter(([, v]) => v > 0)
                                    .map(([k, v]) => `${k}:${(v * 100).toFixed(0)}%`)
                                    .join(' ')}
                                </strong>
                              </div>
                            </div>

                            <div className="pt-1 border-t border-slate-400/15">
                              <button
                                type="button"
                                onClick={() => setIsIsotopeDetailsOpen(prev => !prev)}
                                className="flex items-center gap-1.5 text-xs text-[#94A3B8] hover:text-[#F1F5F9] cursor-pointer"
                              >
                                <ChevronDown
                                  className={`w-3.5 h-3.5 transition-transform ${
                                    isIsotopeDetailsOpen ? 'rotate-180' : ''
                                  }`}
                                />
                                <span>Подробнее ?</span>
                              </button>
                              {isIsotopeDetailsOpen && (
                                <p className="mt-2 text-xs text-[#94A3B8] leading-relaxed">
                                  {iso.descriptionRu}
                                </p>
                              )}
                            </div>
                          </>
                        );
                      })()}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* ===================================================================== */}
          {/* ВКЛАДКА 4: ОТЧЁТ */}
          {/* ===================================================================== */}
          {activeTab === 'analytics' && (
            <div className="space-y-4 text-xs">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 font-mono alara-tabular">
                <div className="p-3 rounded-xl alara-surface">
                  <div className="text-[11px] text-[#94A3B8] font-sans">МЭД</div>
                  <div className="text-base font-bold text-[#F1F5F9] mt-0.5">
                    {currentDoseRateMicroSv >= 1000
                      ? `${(currentDoseRateMicroSv / 1000).toFixed(2)} мЗв/ч`
                      : `${currentDoseRateMicroSv.toFixed(1)} мкЗв/ч`}
                  </div>
                </div>
                <div className="p-3 rounded-xl alara-surface">
                  <div className="text-[11px] text-[#94A3B8] font-sans">Доза / Лимит</div>
                  <div className="text-base font-bold text-[#F59E0B] mt-0.5">
                    {(cumulativeDoseMsv * 1000).toFixed(1)} / {(permitLimitMsv * 1000).toFixed(0)} мкЗв
                  </div>
                </div>
                <div className="p-3 rounded-xl alara-surface">
                  <div className="text-[11px] text-[#94A3B8] font-sans">Запас времени</div>
                  <div className="text-base font-bold text-[#10B981] mt-0.5">{safeStay.textRu}</div>
                </div>
                <div className="p-3 rounded-xl alara-surface">
                  <div className="text-[11px] text-[#94A3B8] font-sans">Защита K_prot</div>
                  <div className="text-base font-bold text-[#0EA5E9] mt-0.5">
                    ×{protectionAnalysis.kProtTotal.toFixed(1)}
                  </div>
                </div>
              </div>

              <div className="p-4 rounded-xl alara-surface space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <label className="text-[#94A3B8] font-medium">Лимит:</label>
                    <select
                      value={permitLimitMsv}
                      onChange={e => onChangePermitLimitMsv(Number(e.target.value))}
                      className="bg-[#0B1117] text-[#F1F5F9] border border-slate-400/20 rounded-[10px] px-2.5 py-1.5 font-mono alara-tabular"
                    >
                      <option value={0.05}>50 мкЗв</option>
                      <option value={0.1}>100 мкЗв</option>
                      <option value={0.25}>250 мкЗв</option>
                      <option value={0.5}>500 мкЗв</option>
                      <option value={1.0}>1000 мкЗв</option>
                    </select>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        onClose();
                        onOpenAnalyticsWindow();
                      }}
                      className="px-3 py-1.5 rounded-[10px] bg-[#0EA5E9] hover:bg-sky-400 text-[#0B1117] font-semibold flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
                    >
                      <BarChart3 className="w-3.5 h-3.5" />
                      <span>Графики</span>
                    </button>

                    <button
                      type="button"
                      onClick={onExportCsv}
                      className="px-3 py-1.5 rounded-[10px] bg-[#0B1117] hover:bg-slate-800/80 border border-slate-400/20 text-[#F1F5F9] font-medium flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
                    >
                      <Download className="w-3.5 h-3.5 text-[#0EA5E9]" />
                      <span>CSV</span>
                    </button>

                    <button
                      type="button"
                      onClick={handleExportPdf}
                      disabled={isExportingPdf}
                      className="px-3 py-1.5 rounded-[10px] bg-[#10B981] hover:bg-emerald-400 disabled:opacity-50 text-[#0B1117] font-semibold flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
                    >
                      <FileText className="w-3.5 h-3.5" />
                      <span>{isExportingPdf ? 'PDF...' : 'PDF'}</span>
                    </button>

                    <button
                      type="button"
                      onClick={onResetCharts}
                      className="px-3 py-1.5 rounded-[10px] bg-[#0B1117] hover:bg-slate-800/80 border border-slate-400/20 text-[#94A3B8] hover:text-[#F1F5F9] flex items-center gap-1 cursor-pointer whitespace-nowrap"
                    >
                      <RotateCcw className="w-3.5 h-3.5" />
                      <span>Сброс</span>
                    </button>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2 pt-2.5 border-t border-slate-400/15">
                  <button
                    type="button"
                    onClick={() => {
                      onClose();
                      onOpenAlaraReport();
                    }}
                    className="px-3 py-1.5 rounded-[10px] bg-[#F59E0B] hover:bg-amber-400 text-[#0B1117] font-semibold flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
                  >
                    <FileText className="w-3.5 h-3.5" />
                    <span>Отчёт ALARA</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      onClose();
                      onOpenAAR();
                    }}
                    className="px-3 py-1.5 rounded-[10px] bg-[#14B8A6]/15 hover:bg-[#14B8A6]/25 text-[#14B8A6] border border-[#14B8A6]/40 font-semibold flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
                  >
                    <Award className="w-3.5 h-3.5" />
                    <span>Разбор AAR</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      onClose();
                      onOpenLabNotebook();
                    }}
                    className="px-3 py-1.5 rounded-[10px] bg-[#0B1117] hover:bg-slate-800/80 border border-slate-400/20 text-[#0EA5E9] flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
                  >
                    <FileSpreadsheet className="w-3.5 h-3.5" />
                    <span>Лаб. журнал</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      onClose();
                      onOpenSpectrometry();
                    }}
                    className="px-3 py-1.5 rounded-[10px] bg-[#0B1117] hover:bg-slate-800/80 border border-slate-400/20 text-[#14B8A6] flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
                  >
                    <Activity className="w-3.5 h-3.5" />
                    <span>Спектрометр</span>
                  </button>
                  <button
                    type="button"
                    onClick={onConnectHil}
                    className="ml-auto px-3 py-1.5 rounded-[10px] bg-[#0B1117] hover:bg-slate-800/80 border border-slate-400/20 text-[#F59E0B] font-mono alara-tabular text-[11px] cursor-pointer whitespace-nowrap"
                    title={hilProtocolTitle}
                  >
                    HIL: {hilLabel} ({hilCountsPerSec} имп/с)
                  </button>
                </div>
              </div>

              {/* Голосовой журнал (сворачиваемый блок) */}
              <div className="rounded-xl alara-surface p-3.5 space-y-2.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <button
                    type="button"
                    onClick={() => setIsVoicePanelOpen(prev => !prev)}
                    className="font-semibold text-[#F1F5F9] flex items-center gap-1.5 cursor-pointer"
                  >
                    <Mic className="w-4 h-4 text-[#10B981]" />
                    <span>Голосовой журнал ({voiceLogs.length})</span>
                    <ChevronDown
                      className={`w-3.5 h-3.5 text-[#94A3B8] transition-transform ${
                        isVoicePanelOpen ? 'rotate-180' : ''
                      }`}
                    />
                  </button>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onMouseDown={onStartVoicePushToTalk}
                      onMouseUp={onStopVoicePushToTalk}
                      onMouseLeave={() => {
                        if (isVoicePushToTalkActive) onStopVoicePushToTalk();
                      }}
                      className={`px-3 py-1.5 rounded-[10px] font-semibold cursor-pointer whitespace-nowrap ${
                        isVoicePushToTalkActive
                          ? 'bg-[#10B981] text-[#0B1117]'
                          : 'bg-[#0B1117] border border-[#10B981]/40 text-[#10B981]'
                      }`}
                    >
                      {isVoicePushToTalkActive ? 'Запись...' : 'PTT [V]'}
                    </button>
                    <button
                      type="button"
                      onClick={onToggleVoiceMode}
                      className="px-2.5 py-1.5 rounded-[10px] bg-[#0B1117] border border-slate-400/20 font-mono text-[#F59E0B] cursor-pointer whitespace-nowrap"
                    >
                      {voiceMode === 'hybrid' ? 'АВТО' : voiceMode === 'dictation' ? 'ЛОГ' : 'КОМ'}
                    </button>
                  </div>
                </div>

                {isVoicePanelOpen && (
                  <div className="space-y-2.5 pt-2 border-t border-slate-400/15">
                    <form
                      onSubmit={e => {
                        e.preventDefault();
                        const trimmed = voiceNoteInput.trim();
                        if (!trimmed) return;
                        onSubmitVoiceFallbackText(trimmed, voiceMode);
                        setVoiceNoteInput('');
                      }}
                      className="flex gap-2"
                    >
                      <input
                        type="text"
                        value={voiceNoteInput}
                        onChange={e => setVoiceNoteInput(e.target.value)}
                        placeholder="Запись или команда..."
                        className="flex-1 bg-[#0B1117] border border-slate-400/20 rounded-[10px] px-3 py-1.5 text-xs text-[#F1F5F9] placeholder:text-[#64748B] focus:outline-none focus:border-[#0EA5E9]"
                      />
                      <button
                        type="submit"
                        className="px-3 py-1.5 rounded-[10px] bg-[#0EA5E9] hover:bg-sky-400 text-[#0B1117] font-semibold flex items-center gap-1 cursor-pointer whitespace-nowrap"
                      >
                        <Send className="w-3.5 h-3.5" />
                        <span>Записать</span>
                      </button>
                    </form>

                    <div className="text-[11px] font-mono alara-tabular text-[#94A3B8]">
                      Факторы защиты: дист. ×{protectionAnalysis.kDist.toFixed(1)} · экран ×
                      {protectionAnalysis.kShield.toFixed(1)} · СИЗ ×{protectionAnalysis.kPpe.toFixed(1)}
                    </div>

                    {voiceLogs.length > 0 && (
                      <div className="max-h-28 overflow-y-auto space-y-1 font-mono alara-tabular text-[11px]">
                        {voiceLogs.slice(-6).reverse().map(entry => (
                          <div
                            key={entry.id}
                            className="px-2.5 py-1 rounded-[10px] bg-[#0B1117]/75 border border-slate-400/15 text-[#94A3B8] flex justify-between gap-2"
                          >
                            <span className="truncate">
                              [{entry.location}] {entry.textNote}
                            </span>
                            <span className="text-[#0EA5E9] shrink-0">
                              {entry.currentDoseRate.toFixed(1)} мкЗв/ч
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ===================================================================== */}
          {/* ВКЛАДКА 5: УПРАВЛЕНИЕ */}
          {/* ===================================================================== */}
          {activeTab === 'settings' && (
            <div className="space-y-4 text-xs">
              {/* Диагностика WebXR / HTC Vive */}
              {vrDiagnostics && (
                <div className="p-4 rounded-xl alara-surface space-y-2.5 border border-slate-400/15">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h3 className="font-semibold text-sm text-[#F1F5F9] flex items-center gap-1.5">
                      <Glasses className="w-4 h-4 text-[#F59E0B]" />
                      <span>VR-гарнитура (HTC Vive / WebXR)</span>
                    </h3>
                    {onToggleVR && (
                      <button
                        type="button"
                        onClick={() => {
                          if (!isInVR) onClose();
                          onToggleVR();
                        }}
                        className={`px-3 py-1.5 rounded-[10px] font-semibold cursor-pointer whitespace-nowrap transition ${
                          isInVR
                            ? 'bg-[#EF4444]/20 border border-[#EF4444]/50 text-[#FCA5A5]'
                            : vrDiagnostics.isSupported
                            ? 'bg-[#F59E0B] text-[#0B1117] hover:bg-amber-400'
                            : 'bg-[#0B1117] border border-slate-400/30 text-[#E2E8F0] hover:border-[#0EA5E9]'
                        }`}
                      >
                        {isInVR ? 'Выйти из VR' : vrDiagnostics.isSupported ? 'Войти в VR' : 'Проверить / Войти в VR'}
                      </button>
                    )}
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 font-mono alara-tabular text-[11px]">
                    <div className="p-2 rounded-[10px] bg-[#0B1117] border border-slate-400/15">
                      <span className="text-[#64748B] block">HTTPS / Secure</span>
                      <strong className={vrDiagnostics.isSecureContext ? 'text-[#10B981]' : 'text-[#EF4444]'}>
                        {vrDiagnostics.isSecureContext ? 'OK' : 'НЕТ'}
                      </strong>
                    </div>
                    <div className="p-2 rounded-[10px] bg-[#0B1117] border border-slate-400/15">
                      <span className="text-[#64748B] block">navigator.xr</span>
                      <strong className={vrDiagnostics.hasNavigatorXr ? 'text-[#10B981]' : 'text-[#EF4444]'}>
                        {vrDiagnostics.hasNavigatorXr ? 'Доступен' : vrDiagnostics.isElectronEnv ? 'Выкл (Electron)' : 'Нет'}
                      </strong>
                    </div>
                    <div className="p-2 rounded-[10px] bg-[#0B1117] border border-slate-400/15">
                      <span className="text-[#64748B] block">immersive-vr</span>
                      <strong className={vrDiagnostics.isSupported ? 'text-[#10B981]' : 'text-[#F59E0B]'}>
                        {vrDiagnostics.isSupported ? 'Готов' : vrDiagnostics.supportState === 'checking' ? 'Проверка...' : 'Не найден'}
                      </strong>
                    </div>
                    <div className="p-2 rounded-[10px] bg-[#0B1117] border border-slate-400/15">
                      <span className="text-[#64748B] block">ReferenceSpace</span>
                      <strong className="text-[#0EA5E9]">{vrDiagnostics.activeReferenceSpaceType}</strong>
                    </div>
                  </div>

                  <div className="text-[11px] text-[#CBD5E1] leading-relaxed">
                    <span className="font-semibold text-[#F1F5F9]">{vrDiagnostics.statusSummaryRu}. </span>
                    <span className="text-[#94A3B8]">{vrDiagnostics.hintRu}</span>
                  </div>

                  {vrDiagnostics.lastErrorMessageRu && (
                    <div className="px-3 py-2 rounded-[10px] bg-[#EF4444]/10 border border-[#EF4444]/35 text-[#FCA5A5] text-[11px]">
                      {vrDiagnostics.lastErrorMessageRu}
                    </div>
                  )}
                </div>
              )}

              <div className="p-4 rounded-xl alara-surface space-y-3">
                <h3 className="font-semibold text-sm text-[#F1F5F9] flex items-center gap-1.5">
                  <Sliders className="w-4 h-4 text-[#0EA5E9]" />
                  <span>Среда и графика</span>
                </h3>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  <button
                    type="button"
                    onClick={onToggleLowLightMode}
                    className={`px-3 py-2 rounded-[10px] border flex items-center gap-2 cursor-pointer whitespace-nowrap ${
                      isLowLightMode
                        ? 'bg-[#0EA5E9]/15 border-[#0EA5E9]/50 text-[#0EA5E9] font-semibold'
                        : 'bg-[#0B1117] border-slate-400/20 text-[#94A3B8]'
                    }`}
                  >
                    <Moon className="w-4 h-4" />
                    <span>{isLowLightMode ? 'Темно' : 'Светло'}</span>
                  </button>

                  <button
                    type="button"
                    onClick={onToggleRadiationField}
                    className={`px-3 py-2 rounded-[10px] border flex items-center gap-2 cursor-pointer whitespace-nowrap ${
                      isRadiationFieldVisible
                        ? 'bg-[#10B981]/15 border-[#10B981]/50 text-[#10B981] font-semibold'
                        : 'bg-[#0B1117] border-slate-400/20 text-[#94A3B8]'
                    }`}
                  >
                    <Radio className="w-4 h-4" />
                    <span>Кванты: {isRadiationFieldVisible ? 'Вкл' : 'Выкл'}</span>
                  </button>

                  <button
                    type="button"
                    onClick={onToggleAudio}
                    className={`px-3 py-2 rounded-[10px] border flex items-center gap-2 cursor-pointer whitespace-nowrap ${
                      !isAudioMuted
                        ? 'bg-[#F59E0B]/15 border-[#F59E0B]/50 text-[#F59E0B] font-semibold'
                        : 'bg-[#0B1117] border-slate-400/20 text-[#64748B]'
                    }`}
                  >
                    {isAudioMuted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
                    <span>Звук: {isAudioMuted ? 'Выкл' : 'Вкл'}</span>
                  </button>

                  <div className="px-3 py-2 rounded-[10px] bg-[#0B1117] border border-slate-400/20 flex items-center justify-between gap-2">
                    <span className="text-[#94A3B8] flex items-center gap-1.5">
                      <Layers className="w-3.5 h-3.5 text-[#0EA5E9]" /> Тени
                    </span>
                    <div className="flex gap-1">
                      {(['low', 'medium'] as ShadowQualitySetting[]).map(q => (
                        <button
                          key={q}
                          type="button"
                          onClick={() => onChangeShadowQuality(q)}
                          className={`px-2 py-0.5 rounded font-mono text-[11px] cursor-pointer ${
                            shadowQuality === q
                              ? 'bg-[#0EA5E9] text-[#0B1117] font-semibold'
                              : 'bg-slate-800 text-[#94A3B8]'
                          }`}
                        >
                          {q === 'low' ? '512' : '1024'}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
                  <div className="flex items-center justify-between gap-3 px-3 py-2 rounded-[10px] bg-[#0B1117] border border-slate-400/20">
                    <span className="text-[#94A3B8]">Виброотклик VR</span>
                    <div className="flex items-center gap-2">
                      <span className="font-mono alara-tabular text-[#0EA5E9]">
                        {Math.round(hapticStrength * 100)}%
                      </span>
                      <input
                        type="range"
                        min={0}
                        max={100}
                        step={5}
                        value={Math.round(hapticStrength * 100)}
                        onChange={e => onChangeHapticStrength(Number(e.target.value) / 100)}
                        className="w-28 h-1.5 bg-slate-700 rounded-lg cursor-pointer accent-[#0EA5E9]"
                      />
                    </div>
                  </div>

                  <label className="flex items-center gap-3 cursor-pointer px-3 py-2 rounded-[10px] bg-[#0B1117] border border-slate-400/20">
                    <input
                      type="checkbox"
                      checked={hideStartupModal}
                      onChange={e => onToggleHideStartupModal(e.target.checked)}
                      className="w-4 h-4 rounded text-[#0EA5E9] cursor-pointer"
                    />
                    <span className="font-medium text-[#F1F5F9]">Не открывать при старте</span>
                  </label>
                </div>
              </div>

              {/* Сворачиваемая таблица горячих клавиш */}
              <div className="rounded-xl alara-surface p-3.5">
                <button
                  type="button"
                  onClick={() => setIsHotkeysOpen(prev => !prev)}
                  className="w-full flex items-center justify-between text-sm font-semibold text-[#F1F5F9] cursor-pointer"
                >
                  <span>Горячие клавиши</span>
                  <ChevronDown
                    className={`w-4 h-4 text-[#94A3B8] transition-transform ${
                      isHotkeysOpen ? 'rotate-180' : ''
                    }`}
                  />
                </button>

                {isHotkeysOpen && (
                  <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 text-[11px]">
                    {[
                      ['WASD', 'Движение'],
                      ['Мышь (зажим)', 'Обзор'],
                      ['E / ЛКМ', 'Действие'],
                      ['Колесо', 'Слот / Вентиль'],
                      ['1', 'ДП-5В'],
                      ['2 / F', 'Фонарь'],
                      ['3', 'Ствол / ОУ-5'],
                      ['4', 'Руки / Ключ'],
                      ['5 / 6', 'Лопата / Щипцы'],
                      ['Q', 'Струя / Клапан'],
                      ['C / R', 'Присед / Рука'],
                      ['T / V', 'Телепорт / Голос'],
                      ['H', 'Скрыть HUD'],
                      ['Tab / Esc', 'Планшет']
                    ].map(([key, desc]) => (
                      <div
                        key={key}
                        className="px-2.5 py-1.5 rounded-[10px] bg-[#0B1117] border border-slate-400/15 flex items-center justify-between gap-2"
                      >
                        <kbd className="font-mono text-[#0EA5E9] font-semibold shrink-0">{key}</kbd>
                        <span className="text-[#94A3B8] text-right truncate">{desc}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Сворачиваемый блок нормативов и констант */}
              <div className="rounded-xl alara-surface p-3.5">
                <button
                  type="button"
                  onClick={() => setIsNormsOpen(prev => !prev)}
                  className="w-full flex items-center justify-between text-sm font-semibold text-[#F1F5F9] cursor-pointer"
                >
                  <span>Нормы и стандарты</span>
                  <ChevronDown
                    className={`w-4 h-4 text-[#94A3B8] transition-transform ${
                      isNormsOpen ? 'rotate-180' : ''
                    }`}
                  />
                </button>

                {isNormsOpen && (
                  <div className="mt-3 grid grid-cols-1 sm:grid-cols-3 gap-2 font-mono alara-tabular text-[11px]">
                    <div className="p-2.5 rounded-[10px] bg-[#0B1117] border border-slate-400/15">
                      <span className="text-[#64748B] block">Условия Т₀ / Р₀</span>
                      <strong className="text-[#14B8A6]">
                        {NORMAL_CONDITIONS.temperatureC}°C / {NORMAL_CONDITIONS.pressureKpa} кПа
                      </strong>
                    </div>
                    <div className="p-2.5 rounded-[10px] bg-[#0B1117] border border-slate-400/15">
                      <span className="text-[#64748B] block">Физика и дозы</span>
                      <strong className="text-[#10B981]">ГОСТ Р 8.804-2012</strong>
                    </div>
                    <div className="p-2.5 rounded-[10px] bg-[#0B1117] border border-slate-400/15">
                      <span className="text-[#64748B] block">Безопасность</span>
                      <strong className="text-[#0EA5E9]">НРБ-99/2009</strong>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Нижний колонтитул */}
        <footer className="flex flex-wrap items-center justify-between gap-3 px-5 py-3 border-t border-slate-400/15 shrink-0 text-xs">
          <div className="text-[#94A3B8] truncate">
            Миссия: <strong className="text-[#F1F5F9]">{scenario.titleRu}</strong>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="px-5 py-2 bg-[#0EA5E9] hover:bg-sky-400 text-[#0B1117] font-semibold rounded-[10px] transition flex items-center gap-2 cursor-pointer whitespace-nowrap"
          >
            <Play className="w-4 h-4 fill-current" />
            <span>В 3D-сцену</span>
          </button>
        </footer>
      </div>
    </div>
  );
};
