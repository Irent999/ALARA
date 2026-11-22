import React, { useEffect, useRef, useState, useCallback } from 'react';
import {
  Chart as ChartJS,
  registerables
} from 'chart.js';
import { Award, Clock, Radiation, X, RotateCcw, TrendingDown, FileText, Loader2 } from 'lucide-react';
import type {
  ComprehensiveProtectionAnalysis,
  PPELoadoutId,
  RemoteToolId
} from '../physics/gostPhysics';
import type { IScenarioConfig } from '../scene/scenarioConfigRegistry';
import type { ScenarioRulesEvaluationResult } from '../scene/scenarioRulesEngine';
import type { VoiceLogEntry } from '../vr/voiceTaskLogger';
import type { TelemetryHistoryPoint } from './FloatingAnalyticsWindow';
import {
  exportDoseHistoryPdfReport,
  type ScenarioMetadataSummary,
  type SessionExposureLimitsTracker
} from '../utils/pdfDoseReportExporter';
import type { MchsMissionMetrics } from '../scene/EvacuationManager';

ChartJS.register(...registerables);

interface AlaraReportModalProps {
  isOpen: boolean;
  onClose: () => void;
  cumulativeDoseMsv: number;
  missionTimeSec: number;
  chartLabels: string[];
  chartDoseRate: number[];
  onRestartMission: () => void;
  scenarioTitle: string;
  telemetryHistory?: ReadonlyArray<TelemetryHistoryPoint>;
  protectionAnalysis?: ComprehensiveProtectionAnalysis;
  permitLimitMsv?: number;
  selectedPpeId?: PPELoadoutId;
  selectedRemoteToolId?: RemoteToolId;
  scenarioConfig?: IScenarioConfig;
  scenarioMeta?: ScenarioMetadataSummary;
  rulesEvaluation?: ScenarioRulesEvaluationResult | null;
  voiceLogs?: ReadonlyArray<VoiceLogEntry>;
  doseResetCount?: number;
  getSessionLimitsSummary?: () => SessionExposureLimitsTracker;
  mchsMetrics?: MchsMissionMetrics;
}

export const AlaraReportModal: React.FC<AlaraReportModalProps> = ({
  isOpen,
  onClose,
  cumulativeDoseMsv,
  missionTimeSec,
  chartLabels,
  chartDoseRate,
  onRestartMission,
  scenarioTitle,
  telemetryHistory = [],
  protectionAnalysis,
  permitLimitMsv = 0.1,
  selectedPpeId = 'hazmat_suit',
  selectedRemoteToolId = 'hand',
  scenarioConfig,
  scenarioMeta,
  rulesEvaluation,
  voiceLogs = [],
  doseResetCount = 0,
  getSessionLimitsSummary,
  mchsMetrics
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const chartInstanceRef = useRef<ChartJS | null>(null);
  const [isExportingPdf, setIsExportingPdf] = useState(false);

  const handleExportPdf = useCallback(async () => {
    if (isExportingPdf || !protectionAnalysis) return;
    setIsExportingPdf(true);
    try {
      await exportDoseHistoryPdfReport({
        history: telemetryHistory,
        currentAnalysis: protectionAnalysis,
        cumulativeDoseMsv,
        missionTimeSec,
        permitLimitMsv,
        selectedPpeId,
        selectedRemoteToolId,
        scenarioTitle,
        scenarioConfig,
        scenarioMeta,
        rulesEvaluation,
        voiceLogs,
        doseResetCount,
        sessionLimits: getSessionLimitsSummary?.() ?? null,
        mchsMetrics
      });
    } catch (err) {
      console.error('Ошибка формирования PDF-отчета ALARA:', err);
    } finally {
      setIsExportingPdf(false);
    }
  }, [
    isExportingPdf,
    protectionAnalysis,
    telemetryHistory,
    cumulativeDoseMsv,
    missionTimeSec,
    permitLimitMsv,
    selectedPpeId,
    selectedRemoteToolId,
    scenarioTitle,
    scenarioConfig,
    scenarioMeta,
    rulesEvaluation,
    voiceLogs,
    doseResetCount,
    getSessionLimitsSummary,
    mchsMetrics
  ]);

  useEffect(() => {
    if (!isOpen || !canvasRef.current) return;

    // Уничтожаем предыдущий экземпляр если есть по ref или по canvas
    if (chartInstanceRef.current) {
      chartInstanceRef.current.destroy();
      chartInstanceRef.current = null;
    }
    const existingChart = ChartJS.getChart(canvasRef.current);
    if (existingChart) {
      existingChart.destroy();
    }

    const ctx = canvasRef.current.getContext('2d');
    if (!ctx) return;

    try {
      chartInstanceRef.current = new ChartJS(canvasRef.current, {
        type: 'line',
        data: {
          labels: chartLabels.length > 0 ? chartLabels : ['0с'],
          datasets: [
            {
              label: 'Мощность дозы (мкЗв/ч)',
              data: chartDoseRate.length > 0 ? chartDoseRate : [0],
              borderColor: '#F59E0B',
              backgroundColor: 'rgba(245, 158, 11, 0.16)',
              fill: true,
              tension: 0.3,
              borderWidth: 2
            }
          ]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          scales: {
            x: {
              ticks: { color: '#94A3B8' },
              grid: { color: 'rgba(148, 163, 184, 0.08)' }
            },
            y: {
              ticks: { color: '#94A3B8' },
              grid: { color: 'rgba(148, 163, 184, 0.08)' },
              title: { display: true, text: 'мкЗв/ч', color: '#94A3B8' }
            }
          },
          plugins: {
            legend: { labels: { color: '#fff' } }
          }
        }
      });
    } catch (e) {
      console.error('Error initializing report chart:', e);
    }

    return () => {
      if (chartInstanceRef.current) {
        chartInstanceRef.current.destroy();
        chartInstanceRef.current = null;
      }
      if (canvasRef.current) {
        const chart = ChartJS.getChart(canvasRef.current);
        if (chart) {
          chart.destroy();
        }
      }
    };
  }, [isOpen, chartLabels, chartDoseRate]);

  if (!isOpen) return null;

  // Расчет грейда ALARA
  let grade = 'ОТЛИЧНО (A)';
  let gradeColor = 'text-[#10B981] border-[#10B981]/40 bg-[#10B981]/10';
  let gradeComment = 'Вы следовали всем трем факторам ALARA: минимальное время, безопасная дистанция и эффективное экранирование.';

  if (cumulativeDoseMsv > 0.05) {
    grade = 'ПРЕВЫШЕНИЕ ДОЗЫ (F)';
    gradeColor = 'text-[#EF4444] border-[#EF4444]/40 bg-[#EF4444]/10';
    gradeComment = 'Зафиксировано опасное накопление дозы. Требуется пересмотреть маршрут и установить защиту до начала работ.';
  } else if (cumulativeDoseMsv > 0.01) {
    grade = 'ХОРОШО (B)';
    gradeColor = 'text-[#F59E0B] border-[#F59E0B]/40 bg-[#F59E0B]/10';
    gradeComment = 'Задача выполнена, однако время пребывания в зоне повышенного поля можно сократить.';
  }

  const mins = Math.floor(missionTimeSec / 60);
  const secs = Math.floor(missionTimeSec % 60);
  const timeFormatted = `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;

  return (
    <div className="fixed inset-0 z-50 bg-[#0B1117]/75 flex items-center justify-center p-4 font-sans select-none">
      <div className="alara-glass-elevated max-w-3xl w-full rounded-xl p-6 flex flex-col gap-5 max-h-[90vh] overflow-y-auto text-[#F1F5F9]">
        <div className="flex justify-between items-center border-b border-slate-400/15 pb-3">
          <div className="flex items-center gap-2.5">
            <Award className="w-5 h-5 text-[#F59E0B]" />
            <div>
              <h2 className="text-lg font-semibold text-[#F1F5F9]">Анализ ALARA и Протокол безопасности</h2>
              <p className="text-xs text-[#94A3B8]">{scenarioTitle}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-[#94A3B8] hover:text-[#F1F5F9] p-1.5 rounded-[10px] alara-surface cursor-pointer transition"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* 3 Metric Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-center">
          <div className="alara-surface p-3.5 rounded-xl">
            <span className="text-xs text-[#94A3B8] flex items-center justify-center gap-1">
              <Radiation className="w-3.5 h-3.5 text-[#F59E0B]" /> Суммарная доза
            </span>
            <div className="text-2xl font-bold text-[#F59E0B] mt-1 font-mono alara-tabular">
              {cumulativeDoseMsv.toFixed(4)} <span className="text-xs">мЗв</span>
            </div>
            <div className="text-[11px] text-[#64748B] font-mono alara-tabular mt-0.5">
              {(cumulativeDoseMsv * 1000).toFixed(1)} мкЗв (w_R = 1)
            </div>
          </div>

          <div className="alara-surface p-3.5 rounded-xl">
            <span className="text-xs text-[#94A3B8] flex items-center justify-center gap-1">
              <Clock className="w-3.5 h-3.5 text-[#0EA5E9]" /> Время в зоне
            </span>
            <div className="text-2xl font-bold text-[#0EA5E9] mt-1 font-mono alara-tabular">{timeFormatted}</div>
            <div className="text-[11px] text-[#64748B] mt-0.5">Хронометраж операции</div>
          </div>

          <div className={`p-3.5 rounded-xl border ${gradeColor}`}>
            <span className="text-xs flex items-center justify-center gap-1">
              <Award className="w-3.5 h-3.5" /> Оценка ALARA
            </span>
            <div className="text-lg font-bold mt-1">{grade}</div>
            <div className="text-[11px] opacity-80 mt-0.5 font-mono">ГОСТ Р 8.804-2012</div>
          </div>
        </div>

        {/* Chart View */}
        <div className="alara-surface p-3.5 rounded-xl relative h-64">
          <canvas ref={canvasRef} />
        </div>

        {/* ALARA Principles Analysis */}
        <div className="text-xs text-[#94A3B8] alara-surface p-4 rounded-xl space-y-2">
          <p className="font-semibold text-[#F59E0B] flex items-center gap-1.5">
            <TrendingDown className="w-4 h-4" /> Заключение по безопасности:
          </p>
          <p className="text-[#F1F5F9]">{gradeComment}</p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-2 pt-2 border-t border-slate-400/15 text-[11px]">
            <div>
              <span className="font-semibold text-[#F1F5F9] block">1. Время (Time):</span>
              Минимизация экспозиции снижает интегральную дозу прямо пропорционально.
            </div>
            <div>
              <span className="font-semibold text-[#F1F5F9] block">2. Расстояние (Distance):</span>
              Увеличение дистанции снижает фон по закону 1/r² для точечных источников.
            </div>
            <div>
              <span className="font-semibold text-[#F1F5F9] block">3. Защита (Shielding):</span>
              Свинцовые и стальные экраны поглощают фотоны с учетом фактора Тейлора.
            </div>
          </div>
          {mchsMetrics &&
            (mchsMetrics.operationsCompleted > 0 ||
              mchsMetrics.totalExtractable > 0 ||
              mchsMetrics.bareHandViolations > 0) && (
              <div className="pt-2 border-t border-slate-400/15 flex flex-wrap items-center gap-4 font-mono alara-tabular text-[11px] text-[#14B8A6]">
                <span>Операций МЧС: {mchsMetrics.operationsCompleted}</span>
                <span>
                  Эвакуация в САР: {mchsMetrics.extractedCount}/{mchsMetrics.totalExtractable}
                </span>
                <span>Щипцы ЦМ-1.5: {mchsMetrics.tongsCompliantExtractions}</span>
                {mchsMetrics.bareHandViolations > 0 && (
                  <span className="text-[#EF4444] font-semibold">
                    Хват ИИИ без щипцов: {mchsMetrics.bareHandViolations}
                  </span>
                )}
              </div>
            )}
        </div>

        <div className="flex flex-wrap gap-2.5">
          {protectionAnalysis && (
            <button
              onClick={handleExportPdf}
              disabled={isExportingPdf}
              className="px-4 py-2.5 bg-[#0EA5E9]/15 hover:bg-[#0EA5E9]/25 disabled:opacity-60 text-[#0EA5E9] border border-[#0EA5E9]/40 font-semibold rounded-[10px] transition flex items-center justify-center gap-2 cursor-pointer text-xs"
            >
              {isExportingPdf ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <FileText className="w-4 h-4" />
              )}
              <span>Экспорт PDF</span>
            </button>
          )}
          <button
            onClick={() => {
              onClose();
              onRestartMission();
            }}
            className="flex-1 py-2.5 bg-[#F59E0B] hover:bg-amber-400 text-[#0B1117] font-semibold rounded-[10px] transition flex items-center justify-center gap-2 cursor-pointer text-xs"
          >
            <RotateCcw className="w-4 h-4" /> Пройти миссию заново
          </button>
          <button
            onClick={onClose}
            className="px-5 py-2.5 alara-surface hover:bg-slate-800/80 text-[#F1F5F9] font-medium rounded-[10px] transition cursor-pointer text-xs"
          >
            Продолжить
          </button>
        </div>
      </div>
    </div>
  );
};
