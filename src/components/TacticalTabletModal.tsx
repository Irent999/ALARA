/**
 * ALARA-Planner Pro VR — Единый Тактический Планшет (TacticalTabletModal.tsx)
 * Вызывается по клавише [Tab] или [Esc] (и кнопкой «Планшет [Tab]» в правом верхнем углу HUD).
 * Объединяет все второстепенные функции без загромождения 3D-экрана:
 *  1. Задачи и Сценарии (этапы, сброс, экзамен, выбор сценария #1–#4)
 *  2. Экипировка и СИЗ (пресеты МЧС, CharacterCustomizer3D, физио-телеметрия, звено РХБЗ)
 *  3. Приборы и Изотопы (ГОСТ 27451-87, база радионуклидов, справочник)
 *  4. Аналитика ALARA (факторы K_prot, лимит дозы, CSV/PDF экспорт, графики, журнал, МКА, AAR, голос PTT)
 *  5. Графика и Управление (горячие клавиши, освещение/поле квантов/звук/тени/Haptic VR, НУ)
 *
 * Правило WebGL-совместимости: строго без backdrop-filter / backdrop-blur-* и без animate-pulse.
 */

import React, { useState } from 'react';
import {
  Activity,
  Atom,
  Award,
  BarChart3,
  BookOpen,
  CheckCircle2,
  ChevronRight,
  Download,
  FileSpreadsheet,
  FileText,
  Flame,
  GraduationCap,
  Heart,
  Layers,
  Mic,
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
import { CharacterCustomizer3D, CharacterPPEState } from './CharacterCustomizer3D';
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
  coopRoleCallsign: string;
  coopPeersCount: number;
  onCycleCoopRole: () => void;

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
  coopRoleCallsign,
  coopPeersCount,
  onCycleCoopRole,
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
    <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-3 sm:p-5 font-sans select-none">
      <div className="max-w-6xl w-full h-[92vh] rounded-3xl border border-sky-500/40 flex flex-col overflow-hidden shadow-2xl bg-slate-950/95 text-slate-100">
        {/* Верхняя панель планшета */}
        <header className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5 border-b border-slate-800 bg-slate-900 shrink-0">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-sky-600 rounded-xl text-white shadow">
              <GraduationCap className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className="text-base sm:text-lg font-bold tracking-tight text-white uppercase">
                  Тактический Планшет ALARA МЧС
                </h1>
                <span className="text-[10px] px-2 py-0.5 rounded bg-orange-500/20 text-orange-300 border border-orange-500/30 font-mono font-bold">
                  СЦ. #{scenario.id} • НРБ-99/2009
                </span>
              </div>
              <p className="text-[11px] text-slate-400 truncate max-w-[540px]">
                {scenario.titleRu} — {scenario.facilityRu}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <div className="flex items-center p-1 rounded-xl bg-slate-950 border border-slate-800 text-xs font-semibold">
              <button
                type="button"
                onClick={() => onChangeExamMode(false)}
                className={`px-2.5 py-1 rounded-lg transition cursor-pointer ${
                  !isExamMode
                    ? 'bg-sky-500 text-slate-950 font-bold'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                Практикум
              </button>
              <button
                type="button"
                onClick={() => onChangeExamMode(true)}
                className={`px-2.5 py-1 rounded-lg transition cursor-pointer ${
                  isExamMode
                    ? 'bg-amber-500 text-slate-950 font-bold'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                Экзамен
              </button>
            </div>

            <button
              type="button"
              onClick={onClose}
              className="p-2 rounded-xl text-slate-300 hover:text-white hover:bg-slate-800 border border-slate-800 cursor-pointer"
              title="Закрыть планшет (Tab / Esc)"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </header>

        {/* Навигация по 5 вкладкам */}
        <nav className="flex flex-wrap items-center gap-1.5 px-5 py-2.5 border-b border-slate-800 bg-slate-950 shrink-0 text-xs font-bold">
          {[
            { id: 'tasks' as const, label: '1. Задачи и Сценарии', icon: BookOpen },
            { id: 'ppe' as const, label: '2. Экипировка и СИЗ', icon: Shield },
            { id: 'database' as const, label: '3. Приборы и Изотопы', icon: Atom },
            { id: 'analytics' as const, label: '4. Аналитика ALARA', icon: BarChart3 },
            { id: 'settings' as const, label: '5. Графика и Управление', icon: Settings }
          ].map(tab => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={`px-3.5 py-2 rounded-xl transition flex items-center gap-1.5 cursor-pointer ${
                  isActive
                    ? 'bg-sky-500 text-slate-950 shadow'
                    : 'text-slate-400 hover:text-white hover:bg-slate-900'
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </nav>

        {/* Содержимое активной вкладки */}
        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {/* ===================================================================== */}
          {/* ВКЛАДКА 1: ЗАДАЧИ И СЦЕНАРИИ */}
          {/* ===================================================================== */}
          {activeTab === 'tasks' && (
            <div className="space-y-5">
              {/* Текущая боевая задача и чек-лист этапов */}
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                <div className="lg:col-span-2 p-4 rounded-2xl bg-slate-900 border border-slate-800 space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 pb-2.5">
                    <div>
                      <div className="text-[11px] font-mono text-sky-400 uppercase font-bold">
                        Текущий шаг ({scenarioStep + 1}/{scenario.stages.length})
                      </div>
                      <h2 className="text-sm font-bold text-white mt-0.5">
                        {currentStage?.titleRu || scenario.titleRu}
                      </h2>
                    </div>
                    <div className="flex items-center gap-2">
                      {scenario.id !== 4 && (
                        <button
                          type="button"
                          onClick={() => onStepChange(scenarioStep + 1)}
                          className="px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold cursor-pointer"
                        >
                          Зачесть этап →
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={onResetScenario}
                        className="px-3 py-1.5 rounded-xl bg-rose-600/85 hover:bg-rose-500 text-white text-xs font-bold flex items-center gap-1 cursor-pointer"
                      >
                        <RotateCcw className="w-3.5 h-3.5" />
                        <span>Сброс</span>
                      </button>
                    </div>
                  </div>

                  <p className="text-xs text-slate-300 leading-relaxed">
                    {scenario4Snapshot && scenario.id === 4
                      ? scenario4Snapshot.instructionRu
                      : currentStage?.taskRu}
                  </p>

                  {scenario4Snapshot && scenario.id === 4 ? (
                    <div className="space-y-2 pt-1">
                      <div className="flex flex-wrap gap-3 text-[11px] font-mono text-slate-300 bg-slate-950 border border-slate-800 rounded-xl px-3 py-2">
                        <span>
                          Очаги: <strong className="text-orange-300">{scenario4Snapshot.firesExtinguished}/{scenario4Snapshot.totalFires}</strong>
                        </span>
                        <span>
                          Спасено: <strong className="text-emerald-300">{scenario4Snapshot.rescuedCount}/{scenario4Snapshot.totalNpcCount}</strong>
                        </span>
                        <span>
                          ОУ-5: <strong className="text-sky-300">{scenario4Snapshot.extinguisherChargePct}%</strong>
                        </span>
                        <span>
                          Ошибки: <strong className="text-amber-300">{scenario4Snapshot.safetyErrorCount}</strong>
                        </span>
                      </div>
                      <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
                        {SCENARIO4_STEP_ORDER.map((stepKey, idx) => {
                          const curIdx = SCENARIO4_STEP_ORDER.indexOf(scenario4Snapshot.stepId);
                          const isDone = idx < curIdx || Boolean(scenario4Snapshot.debrief);
                          const isCurrent = idx === curIdx && !scenario4Snapshot.debrief;
                          return (
                            <div
                              key={stepKey}
                              className={`px-3 py-1.5 rounded-lg border text-xs flex items-center justify-between ${
                                isCurrent
                                  ? 'bg-sky-950/60 border-sky-400/60 text-white'
                                  : isDone
                                  ? 'bg-emerald-950/25 border-emerald-500/30 text-emerald-300'
                                  : 'bg-slate-950 border-slate-800 text-slate-400'
                              }`}
                            >
                              <span>
                                {idx + 1}. {SCENARIO4_STEPS[stepKey].titleRu}
                              </span>
                              <span className="text-[10px] font-mono">
                                {isDone ? 'ГОТОВО' : isCurrent ? 'АКТИВНО' : 'ОЖИДАНИЕ'}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
                      {scenario.stages.map((st, idx) => {
                        const isDone = idx < scenarioStep;
                        const isCurrent = idx === scenarioStep;
                        return (
                          <div
                            key={st.titleRu + idx}
                            className={`px-3 py-2 rounded-lg border text-xs ${
                              isCurrent
                                ? 'bg-sky-950/60 border-sky-400/60 text-white'
                                : isDone
                                ? 'bg-emerald-950/25 border-emerald-500/30 text-emerald-300'
                                : 'bg-slate-950 border-slate-800 text-slate-400'
                            }`}
                          >
                            <div className="flex items-center justify-between font-bold">
                              <span>
                                {idx + 1}. {st.titleRu}
                              </span>
                              <span className="text-[10px] font-mono">
                                {isDone ? 'ГОТОВО' : isCurrent ? 'ТЕКУЩИЙ' : 'ДАЛЕЕ'}
                              </span>
                            </div>
                            <p className="text-[11px] opacity-85 mt-0.5">{st.taskRu}</p>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

                {/* Быстрые параметры прохождения */}
                <div className="p-4 rounded-2xl bg-slate-900 border border-slate-800 space-y-3 text-xs">
                  <h3 className="font-bold text-slate-200 uppercase tracking-wider text-[11px]">
                    Режим работы и инструменты
                  </h3>
                  <button
                    type="button"
                    onClick={onToggleRandomizedHazardMode}
                    className={`w-full px-3 py-2 rounded-xl border text-left transition flex items-center justify-between cursor-pointer ${
                      isRandomizedHazardMode
                        ? 'bg-amber-500/20 border-amber-400/60 text-amber-200 font-bold'
                        : 'bg-slate-950 border-slate-800 text-slate-300 hover:border-slate-700'
                    }`}
                  >
                    <span>Рандомизация очагов угроз</span>
                    <span className="font-mono text-[11px]">
                      {isRandomizedHazardMode ? 'ВКЛ' : 'ВЫКЛ'}
                    </span>
                  </button>

                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        onClose();
                        onOpenLabNotebook();
                      }}
                      className="px-3 py-2 rounded-xl bg-slate-950 hover:bg-slate-800 border border-slate-800 text-cyan-300 font-semibold flex items-center gap-1.5 cursor-pointer"
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
                      className="px-3 py-2 rounded-xl bg-slate-950 hover:bg-slate-800 border border-slate-800 text-purple-300 font-semibold flex items-center gap-1.5 cursor-pointer"
                    >
                      <Activity className="w-3.5 h-3.5" />
                      <span>Спектрометр</span>
                    </button>
                  </div>

                  <div className="p-3 rounded-xl bg-slate-950 border border-slate-800 space-y-1 font-mono text-[11px]">
                    <div className="text-slate-400">ВЫПОЛНЕНИЕ ЗАДАЧ МЧС</div>
                    <div className="flex justify-between text-slate-200">
                      <span>Операций / Эвак.:</span>
                      <strong>
                        {mchsMetrics.operationsCompleted} / {mchsMetrics.extractedCount} из{' '}
                        {mchsMetrics.totalExtractable}
                      </strong>
                    </div>
                    <div className="flex justify-between text-slate-200">
                      <span>Просыпи / Пожар:</span>
                      <strong>
                        {mchsMetrics.spillsDecontaminated} / {mchsMetrics.firesExtinguished}
                      </strong>
                    </div>
                  </div>
                </div>
              </div>

              {/* Основные сценарии МЧС #1–#3 */}
              <div>
                <h2 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">
                  Базовые оперативные сценарии МЧС на объектах АЭС (#1–#3):
                </h2>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  {SCENARIOS.slice(0, 3).map(scen => {
                    const isSelected = scen.id === activeScenarioId;
                    return (
                      <div
                        key={scen.id}
                        onClick={() => {
                          onSelectScenario(scen.id);
                          onClose();
                        }}
                        className={`p-4 rounded-2xl border transition cursor-pointer flex flex-col justify-between ${
                          isSelected
                            ? 'bg-sky-950/45 border-sky-400'
                            : 'bg-slate-900 border-slate-800 hover:border-slate-700'
                        }`}
                      >
                        <div className="space-y-1.5">
                          <div className="flex items-center justify-between">
                            <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-slate-800 text-orange-300 font-bold">
                              МЧС #{scen.id}
                            </span>
                            {isSelected && (
                              <span className="text-[11px] text-emerald-400 font-bold flex items-center gap-1">
                                <CheckCircle2 className="w-3 h-3" /> Активен
                              </span>
                            )}
                          </div>
                          <h3 className="font-bold text-xs text-white">{scen.titleRu}</h3>
                          <p className="text-[11px] text-slate-400 line-clamp-3">
                            {scen.shortDescriptionRu}
                          </p>
                        </div>
                        <div className="pt-3 mt-3 border-t border-slate-800 flex items-center justify-between text-[11px]">
                          <span className="text-slate-500 font-mono truncate">
                            {scen.dominantIsotopes.join(', ')}
                          </span>
                          <span className="text-sky-400 font-bold flex items-center gap-0.5">
                            Выезд <ChevronRight className="w-3 h-3" />
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Сценарий #4: Комплекс АЭС (.glb) */}
              {SCENARIOS.find(s => s.id === 4) && (
                <div>
                  <h2 className="text-xs font-bold text-emerald-300 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                    <Sparkles className="w-4 h-4 text-emerald-400" />
                    Практический VR-тренажёр МЧС на 3D-модели комплекса АЭС (Сценарий #4):
                  </h2>
                  {(() => {
                    const scen4 = SCENARIOS.find(s => s.id === 4)!;
                    const isSelected = scen4.id === activeScenarioId;
                    return (
                      <div
                        onClick={() => {
                          onSelectScenario(scen4.id);
                          onClose();
                        }}
                        className={`p-4 rounded-2xl border transition cursor-pointer flex flex-col md:flex-row md:items-center justify-between gap-3 ${
                          isSelected
                            ? 'bg-emerald-950/50 border-emerald-400'
                            : 'bg-slate-900 border-emerald-500/35 hover:border-emerald-400/70'
                        }`}
                      >
                        <div className="space-y-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300 font-bold border border-emerald-500/40">
                              СЦЕНАРИЙ #{scen4.id} • 3D-КОМПЛЕКС АЭС (.GLB)
                            </span>
                            {isSelected && (
                              <span className="text-xs text-emerald-400 font-bold flex items-center gap-1">
                                <CheckCircle2 className="w-3.5 h-3.5" /> Активен
                              </span>
                            )}
                          </div>
                          <h3 className="font-bold text-sm text-white">{scen4.titleRu}</h3>
                          <p className="text-xs text-slate-300">{scen4.shortDescriptionRu}</p>
                        </div>
                        <span className="px-4 py-2 rounded-xl bg-emerald-500 text-slate-950 font-bold text-xs flex items-center gap-1 shrink-0 self-start md:self-center">
                          <span>Запустить</span>
                          <ChevronRight className="w-4 h-4" />
                        </span>
                      </div>
                    );
                  })()}
                </div>
              )}
            </div>
          )}

          {/* ===================================================================== */}
          {/* ВКЛАДКА 2: ЭКИПИРОВКА И СИЗ */}
          {/* ===================================================================== */}
          {activeTab === 'ppe' && (
            <div className="space-y-4">
              {/* Регламентированные комплекты МЧС */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
                <button
                  type="button"
                  onClick={() => {
                    onSelectInstrument('dp5');
                    onChangePPE({ suitId: 'bop_suit', respiratorId: 'ppm88_mask', instrumentId: 'dp5' });
                  }}
                  className={`p-3.5 rounded-xl border text-left transition cursor-pointer ${
                    ppeState.suitId === 'bop_suit'
                      ? 'bg-orange-950/45 border-orange-400'
                      : 'bg-slate-900 border-slate-800 hover:border-slate-700'
                  }`}
                >
                  <div className="flex items-center justify-between font-bold text-orange-300">
                    <span className="flex items-center gap-1.5">
                      <Flame className="w-3.5 h-3.5" /> Пожарный расчёт БОП-1
                    </span>
                    <span className="text-[10px] font-mono">350°C • 10 кВ</span>
                  </div>
                  <div className="text-[11px] text-slate-300 mt-1">
                    БОП-1 термостойкий + Маска ППМ-88 + ДП-5В
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    onSelectInstrument('dp5');
                    onChangePPE({ suitId: 'kih4_suit', respiratorId: 'gp7vm_gasmask', instrumentId: 'dp5' });
                  }}
                  className={`p-3.5 rounded-xl border text-left transition cursor-pointer ${
                    ppeState.suitId === 'kih4_suit'
                      ? 'bg-amber-950/45 border-amber-400'
                      : 'bg-slate-900 border-slate-800 hover:border-slate-700'
                  }`}
                >
                  <div className="flex items-center justify-between font-bold text-amber-300">
                    <span className="flex items-center gap-1.5">
                      <Shield className="w-3.5 h-3.5" /> РХБ-защита КИХ-4
                    </span>
                    <span className="text-[10px] font-mono">α/β 100%</span>
                  </div>
                  <div className="text-[11px] text-slate-300 mt-1">
                    Изолирующий КИХ-4 + ГП-7ВМ + ДП-5В
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    onSelectInstrument('dp5');
                    onChangePPE({ suitId: 'l1_suit', respiratorId: 'asv2_scba', instrumentId: 'dp5' });
                  }}
                  className={`p-3.5 rounded-xl border text-left transition cursor-pointer ${
                    ppeState.suitId === 'l1_suit'
                      ? 'bg-emerald-950/45 border-emerald-400'
                      : 'bg-slate-900 border-slate-800 hover:border-slate-700'
                  }`}
                >
                  <div className="flex items-center justify-between font-bold text-emerald-300">
                    <span className="flex items-center gap-1.5">
                      <Sparkles className="w-3.5 h-3.5" /> Разведка Л-1 + АСВ-2
                    </span>
                    <span className="text-[10px] font-mono">300 бар</span>
                  </div>
                  <div className="text-[11px] text-slate-300 mt-1">
                    Костюм Л-1 + Дыхательный аппарат АСВ-2 + ДП-5В
                  </div>
                </button>
              </div>

              {/* Быстрая смена физиологического профиля СИЗ, дистанционного инструмента и звена РХБЗ */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3 p-3.5 rounded-2xl bg-slate-900 border border-slate-800 text-xs">
                <div>
                  <label className="text-[11px] text-slate-400 block mb-1">
                    Класс защиты СИЗ (физика ослабления)
                  </label>
                  <select
                    value={selectedPpeId}
                    onChange={e => onChangePpeId(e.target.value as PPELoadoutId)}
                    className="w-full bg-slate-950 text-white text-xs border border-slate-700 rounded-lg px-2.5 py-1.5"
                  >
                    {Object.values(PPE_LOADOUTS).map(ppe => (
                      <option key={ppe.id} value={ppe.id}>
                        {ppe.shortNameRu}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="text-[11px] text-slate-400 block mb-1">
                    Дистанционный инструмент
                  </label>
                  <select
                    value={selectedRemoteToolId}
                    onChange={e => onSelectRemoteTool(e.target.value as RemoteToolId)}
                    className="w-full bg-slate-950 text-white text-xs border border-slate-700 rounded-lg px-2.5 py-1.5"
                  >
                    {Object.values(REMOTE_TOOLS).map(tool => (
                      <option key={tool.id} value={tool.id}>
                        {tool.shortNameRu}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="flex flex-col justify-between">
                  <div className="flex items-center justify-between text-[11px] font-mono text-slate-300">
                    <span className="flex items-center gap-1 text-rose-300">
                      <Heart className="w-3.5 h-3.5" /> {vitalsBpm} уд/мин
                    </span>
                    <span>
                      O₂ <b className="text-emerald-300">{oxygenPercent.toFixed(0)}%</b> · SpO₂{' '}
                      {spO2Percent.toFixed(0)}% · {coreBodyTempC.toFixed(1)}°C
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={onCycleCoopRole}
                    className="mt-1.5 px-3 py-1.5 rounded-lg bg-slate-950 hover:bg-slate-800 border border-slate-700 text-cyan-300 text-xs font-semibold flex items-center justify-between cursor-pointer"
                  >
                    <span className="flex items-center gap-1.5">
                      <UserCheck className="w-3.5 h-3.5" /> Роль звена РХБЗ:
                    </span>
                    <span className="font-mono">
                      {coopRoleCallsign} ({coopPeersCount + 1}/3)
                    </span>
                  </button>
                </div>
              </div>

              <CharacterCustomizer3D
                ppeState={ppeState}
                onChangePPE={onChangePPE}
                selectedRemoteToolId={selectedRemoteToolId}
                onChangeRemoteTool={onSelectRemoteTool}
              />
            </div>
          )}

          {/* ===================================================================== */}
          {/* ВКЛАДКА 3: ПРИБОРЫ И ИЗОТОПЫ */}
          {/* ===================================================================== */}
          {activeTab === 'database' && (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 pb-2">
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setDbSubTab('instruments')}
                    className={`px-3 py-1.5 rounded-xl text-xs font-bold cursor-pointer ${
                      dbSubTab === 'instruments'
                        ? 'bg-sky-500 text-slate-950'
                        : 'bg-slate-900 text-slate-400 hover:text-white'
                    }`}
                  >
                    Приборы ГОСТ 27451-87
                  </button>
                  <button
                    type="button"
                    onClick={() => setDbSubTab('isotopes')}
                    className={`px-3 py-1.5 rounded-xl text-xs font-bold cursor-pointer ${
                      dbSubTab === 'isotopes'
                        ? 'bg-sky-500 text-slate-950'
                        : 'bg-slate-900 text-slate-400 hover:text-white'
                    }`}
                  >
                    База радионуклидов
                  </button>
                </div>

                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    onOpenGostGuide();
                  }}
                  className="px-3 py-1.5 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-700 text-amber-300 text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
                >
                  <BookOpen className="w-3.5 h-3.5" />
                  <span>Подробный справочник ГОСТ</span>
                </button>
              </div>

              {dbSubTab === 'instruments' && (
                <div className="space-y-3">
                  <div className="flex flex-wrap gap-1.5 text-xs">
                    {[
                      { id: 'all', label: 'Все' },
                      { id: 'geiger', label: 'Гейгер-Мюллер' },
                      { id: 'scintillator', label: 'Сцинтилляторы' },
                      { id: 'semiconductor', label: 'Полупроводниковые' },
                      { id: 'ion_chamber', label: 'Ионизационные камеры' },
                      { id: 'neutron', label: 'Нейтронные' }
                    ].map(f => (
                      <button
                        key={f.id}
                        type="button"
                        onClick={() => setInstrumentCategoryFilter(f.id)}
                        className={`px-2.5 py-1 rounded-lg border cursor-pointer ${
                          instrumentCategoryFilter === f.id
                            ? 'bg-sky-500/20 border-sky-400 text-sky-300 font-bold'
                            : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-white'
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
                            className={`p-3.5 rounded-2xl border flex flex-col justify-between ${
                              isEquipped
                                ? 'bg-sky-950/45 border-sky-400'
                                : 'bg-slate-900 border-slate-800'
                            }`}
                          >
                            <div className="space-y-1.5">
                              <div className="flex items-center justify-between">
                                <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-slate-800 text-slate-300">
                                  {inst.gostStandard}
                                </span>
                                <span className="text-[10px] font-mono text-amber-300 uppercase">
                                  {inst.detectedRadiation.join('/')}
                                </span>
                              </div>
                              <h4 className="font-bold text-sm text-white">{inst.name}</h4>
                              <p className="text-[11px] text-slate-400 line-clamp-2">{inst.nameFull}</p>
                              <div className="pt-1.5 text-[11px] font-mono text-slate-300 border-t border-slate-800 space-y-0.5">
                                <div>Диапазон: {inst.measurementRangeRu}</div>
                                <div>
                                  Погрешность ±{inst.basicErrorPercent}% · τ = {inst.timeConstantSec} с
                                </div>
                              </div>
                            </div>

                            <button
                              type="button"
                              onClick={() => {
                                onSelectInstrument(inst.id);
                                onChangePPE({ ...ppeState, instrumentId: inst.id });
                              }}
                              className={`mt-3 w-full py-1.5 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 cursor-pointer ${
                                isEquipped
                                  ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                                  : 'bg-slate-800 hover:bg-slate-700 text-white'
                              }`}
                            >
                              {isEquipped ? <CheckCircle2 className="w-3.5 h-3.5" /> : null}
                              <span>{isEquipped ? 'Экипирован' : 'Выбрать прибор'}</span>
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
                            className={`p-2.5 rounded-xl border cursor-pointer flex items-center justify-between ${
                              isSel
                                ? 'bg-sky-950/45 border-sky-400 text-sky-200'
                                : 'bg-slate-900 border-slate-800 text-slate-300 hover:border-slate-700'
                            }`}
                          >
                            <div>
                              <div className="font-bold text-xs text-white">
                                {iso.symbol}{' '}
                                <span className="text-slate-400 font-normal">({iso.nameRu})</span>
                              </div>
                              <div className="text-[10px] text-slate-500 font-mono">
                                T½: {iso.halfLifeText} · w_R = {iso.wR}
                              </div>
                            </div>
                            <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-slate-800 text-amber-300">
                              {iso.radiationType.toUpperCase()}
                            </span>
                          </div>
                        );
                      }
                    )}
                  </div>

                  {ISOTOPE_DATABASE[selectedDbNuclideKey] && (
                    <div className="lg:col-span-2 p-4 rounded-2xl bg-slate-900 border border-slate-800 space-y-3 text-xs">
                      {(() => {
                        const iso = ISOTOPE_DATABASE[selectedDbNuclideKey];
                        return (
                          <>
                            <div className="flex items-center justify-between border-b border-slate-800 pb-2.5">
                              <div>
                                <h3 className="text-base font-bold text-white">
                                  {iso.symbol} — {iso.nameRu}
                                </h3>
                                <p className="text-slate-400 text-[11px] mt-0.5">{iso.descriptionRu}</p>
                              </div>
                              <button
                                type="button"
                                onClick={() => onSelectIsotope(iso.id)}
                                className="px-3 py-1.5 bg-sky-500 hover:bg-sky-400 text-slate-950 font-bold rounded-xl cursor-pointer shrink-0"
                              >
                                Применить
                              </button>
                            </div>
                            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5 font-mono">
                              <div className="p-2.5 rounded-xl bg-slate-950 border border-slate-800">
                                <span className="text-slate-500 block text-[10px]">T½</span>
                                <strong className="text-cyan-300">{iso.halfLifeText}</strong>
                              </div>
                              <div className="p-2.5 rounded-xl bg-slate-950 border border-slate-800">
                                <span className="text-slate-500 block text-[10px]">Г_γ</span>
                                <strong className="text-amber-300">{iso.gammaConstant}</strong>
                              </div>
                              <div className="p-2.5 rounded-xl bg-slate-950 border border-slate-800">
                                <span className="text-slate-500 block text-[10px]">w_R (НРБ-99)</span>
                                <strong className="text-rose-300">{iso.wR}</strong>
                              </div>
                              <div className="p-2.5 rounded-xl bg-slate-950 border border-slate-800">
                                <span className="text-slate-500 block text-[10px]">E_γ (средняя)</span>
                                <strong className="text-white">{iso.energyMev} МэВ</strong>
                              </div>
                              <div className="p-2.5 rounded-xl bg-slate-950 border border-slate-800">
                                <span className="text-slate-500 block text-[10px]">E_β max</span>
                                <strong className="text-white">{iso.maxBetaEnergyMev} МэВ</strong>
                              </div>
                              <div className="p-2.5 rounded-xl bg-slate-950 border border-slate-800">
                                <span className="text-slate-500 block text-[10px]">Спектр</span>
                                <strong className="text-emerald-300 text-[10px]">
                                  {Object.entries(iso.emissionShares)
                                    .filter(([, v]) => v > 0)
                                    .map(([k, v]) => `${k}:${(v * 100).toFixed(0)}%`)
                                    .join(' ')}
                                </strong>
                              </div>
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
          {/* ВКЛАДКА 4: АНАЛИТИКА ALARA И ОТЧЁТЫ */}
          {/* ===================================================================== */}
          {activeTab === 'analytics' && (
            <div className="space-y-4 text-xs">
              {/* Сводка факторов защиты */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 font-mono">
                <div className="p-3 rounded-xl bg-slate-900 border border-slate-800">
                  <div className="text-[10px] text-slate-400">МЭД D(t)</div>
                  <div className="text-base font-bold text-white">
                    {currentDoseRateMicroSv >= 1000
                      ? `${(currentDoseRateMicroSv / 1000).toFixed(2)} мЗв/ч`
                      : `${currentDoseRateMicroSv.toFixed(1)} мкЗв/ч`}
                  </div>
                </div>
                <div className="p-3 rounded-xl bg-slate-900 border border-slate-800">
                  <div className="text-[10px] text-slate-400">ДОЗА H(t) / ЛИМИТ</div>
                  <div className="text-base font-bold text-amber-300">
                    {(cumulativeDoseMsv * 1000).toFixed(1)} / {(permitLimitMsv * 1000).toFixed(0)} мкЗв
                  </div>
                </div>
                <div className="p-3 rounded-xl bg-slate-900 border border-slate-800">
                  <div className="text-[10px] text-slate-400">БЕЗОПАСНОЕ ВРЕМЯ T_доп</div>
                  <div className="text-base font-bold text-emerald-300">
                    {safeStay.textRu}
                  </div>
                </div>
                <div className="p-3 rounded-xl bg-slate-900 border border-slate-800">
                  <div className="text-[10px] text-slate-400">K_prot (ЗАЩИТА)</div>
                  <div className="text-base font-bold text-sky-300">
                    ×{protectionAnalysis.kProtTotal.toFixed(1)}
                  </div>
                  <div className="text-[10px] text-slate-400 mt-0.5">
                    dist ×{protectionAnalysis.kDist.toFixed(1)} · shield ×{protectionAnalysis.kShield.toFixed(1)} · СИЗ ×{protectionAnalysis.kPpe.toFixed(1)}
                  </div>
                </div>
              </div>

              {/* Управление нарядом-допуском и окнами отчётов */}
              <div className="p-4 rounded-2xl bg-slate-900 border border-slate-800 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <label className="text-slate-300 font-semibold">Лимит наряда-допуска:</label>
                    <select
                      value={permitLimitMsv}
                      onChange={e => onChangePermitLimitMsv(Number(e.target.value))}
                      className="bg-slate-950 text-white border border-slate-700 rounded-lg px-2.5 py-1 font-mono"
                    >
                      <option value={0.05}>0.05 мЗв (50 мкЗв)</option>
                      <option value={0.1}>0.10 мЗв (100 мкЗв)</option>
                      <option value={0.25}>0.25 мЗв (250 мкЗв)</option>
                      <option value={0.5}>0.50 мЗв (500 мкЗв)</option>
                      <option value={1.0}>1.00 мЗв (1000 мкЗв)</option>
                    </select>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        onClose();
                        onOpenAnalyticsWindow();
                      }}
                      className="px-3 py-1.5 rounded-xl bg-sky-500 hover:bg-sky-400 text-slate-950 font-bold flex items-center gap-1.5 cursor-pointer"
                    >
                      <BarChart3 className="w-3.5 h-3.5" />
                      <span>Графики D(t)/H(t)</span>
                    </button>

                    <button
                      type="button"
                      onClick={onExportCsv}
                      className="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-100 font-semibold flex items-center gap-1.5 cursor-pointer"
                    >
                      <Download className="w-3.5 h-3.5 text-sky-400" />
                      <span>Экспорт CSV</span>
                    </button>

                    <button
                      type="button"
                      onClick={handleExportPdf}
                      disabled={isExportingPdf}
                      className="px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-semibold flex items-center gap-1.5 cursor-pointer"
                    >
                      <FileText className="w-3.5 h-3.5" />
                      <span>{isExportingPdf ? 'Генерация PDF...' : 'Экспорт PDF'}</span>
                    </button>

                    <button
                      type="button"
                      onClick={onResetCharts}
                      className="px-3 py-1.5 rounded-xl bg-slate-950 hover:bg-slate-800 border border-slate-700 text-slate-300 flex items-center gap-1 cursor-pointer"
                    >
                      <RotateCcw className="w-3.5 h-3.5" />
                      <span>Сброс графиков</span>
                    </button>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-slate-800">
                  <button
                    type="button"
                    onClick={() => {
                      onClose();
                      onOpenAlaraReport();
                    }}
                    className="px-3 py-1.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold flex items-center gap-1.5 cursor-pointer"
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
                    className="px-3 py-1.5 rounded-xl bg-cyan-500/20 hover:bg-cyan-500/30 text-cyan-200 border border-cyan-400/40 font-semibold flex items-center gap-1.5 cursor-pointer"
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
                    className="px-3 py-1.5 rounded-xl bg-slate-950 hover:bg-slate-800 border border-slate-700 text-cyan-300 flex items-center gap-1.5 cursor-pointer"
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
                    className="px-3 py-1.5 rounded-xl bg-slate-950 hover:bg-slate-800 border border-slate-700 text-purple-300 flex items-center gap-1.5 cursor-pointer"
                  >
                    <Activity className="w-3.5 h-3.5" />
                    <span>Спектрометр МКА</span>
                  </button>
                  <button
                    type="button"
                    onClick={onConnectHil}
                    className="ml-auto px-3 py-1.5 rounded-xl bg-slate-950 hover:bg-slate-800 border border-slate-700 text-amber-300 font-mono text-[11px] cursor-pointer"
                    title={hilProtocolTitle}
                  >
                    HIL: {hilLabel} ({hilCountsPerSec} имп/с)
                  </button>
                </div>
              </div>

              {/* Голосовой протокол и текстовый ввод NLU */}
              <div className="p-4 rounded-2xl bg-slate-900 border border-slate-800 space-y-2.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-bold text-slate-200 flex items-center gap-1.5">
                    <Mic className="w-4 h-4 text-emerald-400" />
                    <span>Голосовое протоколирование (PTT [V])</span>
                  </span>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onMouseDown={onStartVoicePushToTalk}
                      onMouseUp={onStopVoicePushToTalk}
                      onMouseLeave={() => {
                        if (isVoicePushToTalkActive) onStopVoicePushToTalk();
                      }}
                      className={`px-3 py-1 rounded-lg font-semibold cursor-pointer ${
                        isVoicePushToTalkActive
                          ? 'bg-emerald-500 text-slate-950'
                          : 'bg-slate-950 border border-emerald-500/40 text-emerald-300'
                      }`}
                    >
                      {isVoicePushToTalkActive ? 'Запись...' : 'Удерживать PTT'}
                    </button>
                    <button
                      type="button"
                      onClick={onToggleVoiceMode}
                      className="px-2.5 py-1 rounded-lg bg-slate-950 border border-slate-700 font-mono text-amber-300 cursor-pointer"
                    >
                      Режим: {voiceMode === 'hybrid' ? 'АВТО' : voiceMode === 'dictation' ? 'ЛОГ' : 'КОМ'}
                    </button>
                  </div>
                </div>

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
                    placeholder="Запись в оперативный журнал или команда..."
                    className="flex-1 bg-slate-950 border border-slate-700 rounded-xl px-3 py-1.5 text-xs text-white placeholder:text-slate-500 focus:outline-none focus:border-sky-500"
                  />
                  <button
                    type="submit"
                    className="px-3 py-1.5 rounded-xl bg-sky-500 hover:bg-sky-400 text-slate-950 font-bold flex items-center gap-1 cursor-pointer"
                  >
                    <Send className="w-3.5 h-3.5" />
                    <span>Отправить</span>
                  </button>
                </form>

                {voiceLogs.length > 0 && (
                  <div className="max-h-28 overflow-y-auto space-y-1 pt-1 font-mono text-[11px]">
                    {voiceLogs.slice(-6).reverse().map(entry => (
                      <div
                        key={entry.id}
                        className="px-2.5 py-1 rounded bg-slate-950 border border-slate-800 text-slate-300 flex justify-between gap-2"
                      >
                        <span className="truncate">
                          [{entry.location}] {entry.textNote}
                        </span>
                        <span className="text-sky-300 shrink-0">
                          {entry.currentDoseRate.toFixed(1)} мкЗв/ч
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ===================================================================== */}
          {/* ВКЛАДКА 5: ГРАФИКА, СРЕДА И УПРАВЛЕНИЕ */}
          {/* ===================================================================== */}
          {activeTab === 'settings' && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 text-xs">
              {/* Окружение, тени и звук */}
              <div className="p-4 rounded-2xl bg-slate-900 border border-slate-800 space-y-3">
                <h3 className="font-bold text-sm text-white flex items-center gap-1.5">
                  <Sliders className="w-4 h-4 text-sky-400" />
                  <span>Графика, Среда и Звук</span>
                </h3>

                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={onToggleLowLightMode}
                    className={`px-3 py-2 rounded-xl border flex items-center gap-2 cursor-pointer ${
                      isLowLightMode
                        ? 'bg-sky-500/20 border-sky-400/60 text-sky-200 font-semibold'
                        : 'bg-slate-950 border-slate-800 text-slate-300'
                    }`}
                  >
                    <Moon className="w-4 h-4" />
                    <span>{isLowLightMode ? 'Темный бункер' : 'Штатный свет'}</span>
                  </button>

                  <button
                    type="button"
                    onClick={onToggleRadiationField}
                    className={`px-3 py-2 rounded-xl border flex items-center gap-2 cursor-pointer ${
                      isRadiationFieldVisible
                        ? 'bg-emerald-500/20 border-emerald-400/60 text-emerald-200 font-semibold'
                        : 'bg-slate-950 border-slate-800 text-slate-300'
                    }`}
                  >
                    <Radio className="w-4 h-4" />
                    <span>Кванты: {isRadiationFieldVisible ? 'Вкл' : 'Выкл'}</span>
                  </button>

                  <button
                    type="button"
                    onClick={onToggleAudio}
                    className={`px-3 py-2 rounded-xl border flex items-center gap-2 cursor-pointer ${
                      !isAudioMuted
                        ? 'bg-amber-500/15 border-amber-400/50 text-amber-200 font-semibold'
                        : 'bg-slate-950 border-slate-800 text-slate-400'
                    }`}
                  >
                    {isAudioMuted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
                    <span>Звук: {isAudioMuted ? 'Выкл' : 'Вкл'}</span>
                  </button>

                  <div className="px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 flex items-center justify-between gap-2">
                    <span className="text-slate-300 flex items-center gap-1.5">
                      <Layers className="w-3.5 h-3.5 text-sky-400" /> Тени:
                    </span>
                    <div className="flex gap-1">
                      {(['low', 'medium'] as ShadowQualitySetting[]).map(q => (
                        <button
                          key={q}
                          type="button"
                          onClick={() => onChangeShadowQuality(q)}
                          className={`px-2 py-0.5 rounded font-mono text-[11px] cursor-pointer ${
                            shadowQuality === q
                              ? 'bg-sky-500 text-slate-950 font-bold'
                              : 'bg-slate-800 text-slate-300'
                          }`}
                        >
                          {q === 'low' ? '512' : '1024'}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="flex items-center justify-between gap-3 px-3 py-2 rounded-xl bg-slate-950 border border-slate-800">
                  <span className="text-slate-300">Виброотклик контроллеров VR:</span>
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-sky-300">{Math.round(hapticStrength * 100)}%</span>
                    <input
                      type="range"
                      min={0}
                      max={100}
                      step={5}
                      value={Math.round(hapticStrength * 100)}
                      onChange={e => onChangeHapticStrength(Number(e.target.value) / 100)}
                      className="w-28 h-1.5 bg-slate-700 rounded-lg cursor-pointer accent-sky-400"
                    />
                  </div>
                </div>

                <label className="flex items-center gap-3 cursor-pointer p-2.5 rounded-xl bg-slate-950 border border-slate-800">
                  <input
                    type="checkbox"
                    checked={hideStartupModal}
                    onChange={e => onToggleHideStartupModal(e.target.checked)}
                    className="w-4 h-4 rounded text-sky-500 cursor-pointer"
                  />
                  <div>
                    <span className="font-bold text-slate-200">
                      Не открывать планшет автоматически при старте
                    </span>
                    <p className="text-[11px] text-slate-400">
                      Всегда можно открыть клавишей [Tab] или [Esc].
                    </p>
                  </div>
                </label>

                <div className="grid grid-cols-2 gap-2 font-mono text-[11px] pt-1">
                  <div className="p-2 rounded-lg bg-slate-950 border border-slate-800">
                    <span className="text-slate-500">Т₀ / Р₀: </span>
                    <strong className="text-cyan-300">
                      {NORMAL_CONDITIONS.temperatureC}°C / {NORMAL_CONDITIONS.pressureKpa} кПа
                    </strong>
                  </div>
                  <div className="p-2 rounded-lg bg-slate-950 border border-slate-800">
                    <span className="text-slate-500">Стандарт: </span>
                    <strong className="text-emerald-300">ГОСТ Р 8.804-2012</strong>
                  </div>
                </div>
              </div>

              {/* Справочник горячих клавиш */}
              <div className="p-4 rounded-2xl bg-slate-900 border border-slate-800 space-y-2.5">
                <h3 className="font-bold text-sm text-white">Управление и Горячие клавиши</h3>
                <div className="grid grid-cols-2 gap-2 text-[11px]">
                  {[
                    ['WASD', 'Перемещение оператора'],
                    ['ЛКМ (зажим) / Мышь', 'Вращение обзора'],
                    ['E / ЛКМ (удержание)', 'Взять / Взаимодействие'],
                    ['Колесо мыши', 'Смена [1–4] / Вентиль'],
                    ['1 — ДП-5В', 'Радиометр-дозиметр'],
                    ['2 — Фонарь [F]', 'Тактический фонарь'],
                    ['3 — Ствол / ОУ-5', 'Пожарный ствол / ОУ-5'],
                    ['4 — Руки / Ключ', 'Захват и стыковка'],
                    ['5 / 6', 'Лопата БСЛ / Щипцы ЦМ'],
                    ['Q', 'Струя (Распыл/Сплошная) / Манифольд'],
                    ['C / R', 'Присесть / Вытянуть руку'],
                    ['T / V', 'Телепорт / Голос PTT'],
                    ['H', 'Показать / скрыть 2D HUD'],
                    ['Tab / Esc', 'Тактический планшет']
                  ].map(([key, desc]) => (
                    <div
                      key={key}
                      className="px-2.5 py-1.5 rounded-lg bg-slate-950 border border-slate-800 flex items-center justify-between gap-2"
                    >
                      <kbd className="font-mono text-sky-300 font-bold shrink-0">{key}</kbd>
                      <span className="text-slate-400 text-right truncate">{desc}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Нижний колонтитул */}
        <footer className="flex flex-wrap items-center justify-between gap-3 px-5 py-3 border-t border-slate-800 bg-slate-900 shrink-0 text-xs">
          <div className="flex items-center gap-2 text-slate-400">
            <span className="w-2 h-2 rounded-full bg-emerald-400" />
            <span>
              Активен: <strong className="text-white">{scenario.titleRu}</strong>
            </span>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="px-5 py-2 bg-sky-500 hover:bg-sky-400 text-slate-950 font-bold rounded-xl transition flex items-center gap-2 cursor-pointer"
          >
            <Play className="w-4 h-4 fill-current" />
            <span>Вернуться на 3D-сцену</span>
          </button>
        </footer>
      </div>
    </div>
  );
};
