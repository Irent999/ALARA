import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Chart as ChartJS, registerables } from 'chart.js';
import {
  Activity,
  Minimize2,
  Maximize2,
  Download,
  RotateCcw,
  Shield,
  Clock,
  Ruler,
  UserCheck,
  AlertTriangle,
  BarChart3,
  PieChart,
  Mic,
  Send,
  X,
  Layers,
  FileText,
  Loader2
} from 'lucide-react';
import {
  ComprehensiveProtectionAnalysis,
  PPELoadoutId,
  PPE_LOADOUTS,
  RemoteToolId,
  REMOTE_TOOLS,
  calculateSafeStayTime,
  sanitizeNonNegativeFinite
} from '../physics/gostPhysics';
import type { VoiceLogEntry, VoiceLoggerMode } from '../vr/voiceTaskLogger';
import type { IScenarioConfig } from '../scene/scenarioConfigRegistry';
import type { ScenarioRulesEvaluationResult } from '../scene/scenarioRulesEngine';
import {
  exportDoseHistoryPdfReport,
  type ScenarioMetadataSummary,
  type SessionExposureLimitsTracker
} from '../utils/pdfDoseReportExporter';
import type { MchsMissionMetrics } from '../scene/EvacuationManager';

ChartJS.register(...registerables);

export interface TelemetryHistoryPoint {
  timestampIso: string;
  timeLabel: string;
  elapsedSec: number;
  doseRateMicroSv: number;
  unshieldedDoseRateMicroSv: number;
  cumulativeDoseMsv: number;
  simpsonCumulativeDoseMsv?: number;
  convergenceErrorPercent?: number;
  permitLimitMsv: number;
  distanceM: number;
  effectiveDistanceM: number;
  attenuationFactor: number;
  alphaRate: number;
  betaRate: number;
  gammaRate: number;
  neutronRate: number;
  kDist: number;
  kShield: number;
  kPpe: number;
  kProtTotal: number;
  voiceProtocolNote?: string;
}

interface FloatingAnalyticsWindowProps {
  isOpen: boolean;
  onClose: () => void;
  history: TelemetryHistoryPoint[];
  currentAnalysis: ComprehensiveProtectionAnalysis;
  cumulativeDoseMsv: number;
  missionTimeSec: number;
  permitLimitMsv: number;
  onChangePermitLimitMsv: (limitMsv: number) => void;
  selectedPpeId: PPELoadoutId;
  onChangePpeId: (id: PPELoadoutId) => void;
  selectedRemoteToolId: RemoteToolId;
  onChangeRemoteToolId: (id: RemoteToolId) => void;
  onResetCharts: () => void;
  scenarioTitle: string;
  voiceLogs?: ReadonlyArray<VoiceLogEntry>;
  isMinimizedExternal?: boolean;
  onToggleMinimizedExternal?: (minimized: boolean) => void;
  exportCsvSignal?: number;
  onSubmitVoiceFallbackText?: (text: string, mode?: VoiceLoggerMode) => void;
  scenarioConfig?: IScenarioConfig;
  scenarioMeta?: ScenarioMetadataSummary;
  rulesEvaluation?: ScenarioRulesEvaluationResult | null;
  onResetScenario?: () => void;
  doseResetCount?: number;
  getSessionLimitsSummary?: () => SessionExposureLimitsTracker;
  mchsMetrics?: MchsMissionMetrics;
}

const MAX_CHART_POINTS = 40;

export const FloatingAnalyticsWindow: React.FC<FloatingAnalyticsWindowProps> = ({
  isOpen,
  onClose,
  history,
  currentAnalysis,
  cumulativeDoseMsv,
  missionTimeSec,
  permitLimitMsv,
  onChangePermitLimitMsv,
  selectedPpeId,
  onChangePpeId,
  selectedRemoteToolId,
  onChangeRemoteToolId,
  onResetCharts,
  scenarioTitle,
  voiceLogs = [],
  isMinimizedExternal,
  onToggleMinimizedExternal,
  exportCsvSignal = 0,
  onSubmitVoiceFallbackText,
  scenarioConfig,
  scenarioMeta,
  rulesEvaluation,
  onResetScenario,
  doseResetCount = 0,
  getSessionLimitsSummary,
  mchsMetrics
}) => {
  const [isMinimizedInternal, setIsMinimizedInternal] = useState(false);
  const [activeTab, setActiveTab] = useState<'charts' | 'protection' | 'voice'>('charts');
  const [spectralChartMode, setSpectralChartMode] = useState<'doughnut' | 'bar'>('bar');
  const [fallbackInputText, setFallbackInputText] = useState('');
  const [isExportingPdf, setIsExportingPdf] = useState(false);

  const isMinimized = isMinimizedExternal !== undefined ? isMinimizedExternal : isMinimizedInternal;
  const setMinimizedState = useCallback(
    (next: boolean) => {
      setIsMinimizedInternal(next);
      onToggleMinimizedExternal?.(next);
    },
    [onToggleMinimizedExternal]
  );

  const doseRateCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const cumulativeCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const spectralCanvasRef = useRef<HTMLCanvasElement | null>(null);

  const doseRateChartRef = useRef<ChartJS | null>(null);
  const cumulativeChartRef = useRef<ChartJS | null>(null);
  const spectralChartRef = useRef<ChartJS | null>(null);

  const currentProtectedRate = sanitizeNonNegativeFinite(currentAnalysis.finalProtectedDoseRateMicroSv, 0.1);
  const currentUnshieldedRate = sanitizeNonNegativeFinite(currentAnalysis.unshieldedBaseDoseRateMicroSv, 0.1);
  const safeAccumDoseMsv = sanitizeNonNegativeFinite(cumulativeDoseMsv, 0.0);
  const safePermitLimitMsv = sanitizeNonNegativeFinite(permitLimitMsv, 0.1);
  const safeMissionTimeSec = sanitizeNonNegativeFinite(missionTimeSec, 0.0);

  // Остаточное допустимое время пребывания: T_rem = (H_limit - H_accum) / D_current
  // Динамически и мгновенно реагирует на изменение расстояния, СИЗ и установку экранов
  const safeStay = calculateSafeStayTime(currentProtectedRate, safePermitLimitMsv, safeAccumDoseMsv);

  // Автоматический выбор размерности мощности дозы для читаемости графика
  const useMilliSvRate = currentProtectedRate >= 1000 || currentUnshieldedRate >= 2500;
  const rateUnitLabel = useMilliSvRate ? 'мЗв/ч' : 'мкЗв/ч';
  const rateScaleFactor = useMilliSvRate ? 0.001 : 1.0;

  // Формируем актуальный срез временного ряда с добавлением живой точки текущего момента времени t
  const recentHistory = history.slice(-MAX_CHART_POINTS);
  const liveTimeLabel = `${safeMissionTimeSec.toFixed(1)}с`;
  const lastHistPt = recentHistory.length > 0 ? recentHistory[recentHistory.length - 1] : null;
  const latestConvergenceErr =
    lastHistPt?.convergenceErrorPercent !== undefined
      ? sanitizeNonNegativeFinite(lastHistPt.convergenceErrorPercent, 0.01)
      : 0.01;

  // ============================================================================
  // ГРАФИК 1: Мощность дозы D(t) и неэкранированный уровень D_0(t) в реальном времени
  // ============================================================================
  useEffect(() => {
    if (!isOpen || isMinimized || activeTab !== 'charts' || !doseRateCanvasRef.current) return;

    const existing = ChartJS.getChart(doseRateCanvasRef.current);
    if (!doseRateChartRef.current && existing) {
      doseRateChartRef.current = existing;
    }

    const labels = recentHistory.map(p => p.timeLabel);
    const protectedSeries = recentHistory.map(p =>
      Number((sanitizeNonNegativeFinite(p.doseRateMicroSv) * rateScaleFactor).toFixed(4))
    );
    const unshieldedSeries = recentHistory.map(p =>
      Number((sanitizeNonNegativeFinite(p.unshieldedDoseRateMicroSv) * rateScaleFactor).toFixed(4))
    );

    // Гарантируем отображение текущего момента времени в реальном времени
    if (labels.length === 0 || labels[labels.length - 1] !== liveTimeLabel) {
      labels.push(liveTimeLabel);
      protectedSeries.push(Number((currentProtectedRate * rateScaleFactor).toFixed(4)));
      unshieldedSeries.push(Number((currentUnshieldedRate * rateScaleFactor).toFixed(4)));
    } else {
      protectedSeries[protectedSeries.length - 1] = Number((currentProtectedRate * rateScaleFactor).toFixed(4));
      unshieldedSeries[unshieldedSeries.length - 1] = Number((currentUnshieldedRate * rateScaleFactor).toFixed(4));
    }

    if (!doseRateChartRef.current) {
      doseRateChartRef.current = new ChartJS(doseRateCanvasRef.current, {
        type: 'line',
        data: {
          labels,
          datasets: [
            {
              label: `Защищенная D(t), ${rateUnitLabel}`,
              data: protectedSeries,
              borderColor: '#F59E0B',
              backgroundColor: 'rgba(245, 158, 11, 0.16)',
              borderWidth: 2,
              pointRadius: 1.5,
              fill: true,
              tension: 0.25
            },
            {
              label: `Без защиты D₀(t), ${rateUnitLabel}`,
              data: unshieldedSeries,
              borderColor: 'rgba(239, 68, 68, 0.7)',
              borderDash: [4, 4],
              borderWidth: 1.5,
              pointRadius: 0,
              fill: false,
              tension: 0.25
            }
          ]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          animation: false,
          interaction: { mode: 'index', intersect: false },
          scales: {
            x: {
              ticks: { color: '#94A3B8', font: { size: 10 }, maxTicksLimit: 7 },
              grid: { color: 'rgba(148, 163, 184, 0.08)' }
            },
            y: {
              beginAtZero: true,
              title: {
                display: true,
                text: rateUnitLabel,
                color: '#F59E0B',
                font: { size: 10 }
              },
              ticks: { color: '#F59E0B', font: { size: 10 } },
              grid: { color: 'rgba(245, 158, 11, 0.08)' }
            }
          },
          plugins: {
            legend: {
              display: true,
              labels: { color: '#cbd5e1', boxWidth: 10, font: { size: 10 } }
            }
          }
        }
      });
    } else {
      const chart = doseRateChartRef.current;
      chart.data.labels = labels;
      chart.data.datasets[0].label = `Защищенная D(t), ${rateUnitLabel}`;
      chart.data.datasets[0].data = protectedSeries;
      chart.data.datasets[1].label = `Без защиты D₀(t), ${rateUnitLabel}`;
      chart.data.datasets[1].data = unshieldedSeries;
      if (chart.options.scales?.y && 'title' in chart.options.scales.y && chart.options.scales.y.title) {
        chart.options.scales.y.title.text = rateUnitLabel;
      }
      chart.update('none');
    }
  }, [
    recentHistory,
    isOpen,
    isMinimized,
    rateScaleFactor,
    rateUnitLabel,
    liveTimeLabel,
    currentProtectedRate,
    currentUnshieldedRate
  ]);

  // ============================================================================
  // ГРАФИК 2: Численный интеграл накопленной дозы H_accum(t) = \int_0^t D(\tau) d\tau (мЗв)
  // ============================================================================
  useEffect(() => {
    if (!isOpen || isMinimized || activeTab !== 'charts' || !cumulativeCanvasRef.current) return;

    const existing = ChartJS.getChart(cumulativeCanvasRef.current);
    if (!cumulativeChartRef.current && existing) {
      cumulativeChartRef.current = existing;
    }

    const labels = recentHistory.map(p => p.timeLabel);
    const cumulativeSeries = recentHistory.map(p =>
      Number(sanitizeNonNegativeFinite(p.cumulativeDoseMsv).toFixed(6))
    );
    const limitSeries = recentHistory.map(() => safePermitLimitMsv);

    if (labels.length === 0 || labels[labels.length - 1] !== liveTimeLabel) {
      labels.push(liveTimeLabel);
      cumulativeSeries.push(Number(safeAccumDoseMsv.toFixed(6)));
      limitSeries.push(safePermitLimitMsv);
    } else {
      cumulativeSeries[cumulativeSeries.length - 1] = Number(safeAccumDoseMsv.toFixed(6));
      limitSeries[limitSeries.length - 1] = safePermitLimitMsv;
    }

    if (!cumulativeChartRef.current) {
      cumulativeChartRef.current = new ChartJS(cumulativeCanvasRef.current, {
        type: 'line',
        data: {
          labels,
          datasets: [
            {
              label: 'Интеграл H(t) (Трапеций/Симпсон), мЗв',
              data: cumulativeSeries,
              borderColor: '#0EA5E9',
              backgroundColor: 'rgba(14, 165, 233, 0.16)',
              borderWidth: 2,
              pointRadius: 1.5,
              fill: true,
              tension: 0.2
            },
            {
              label: `Лимит H_limit (${safePermitLimitMsv.toFixed(2)} мЗв)`,
              data: limitSeries,
              borderColor: '#EF4444',
              borderDash: [6, 4],
              borderWidth: 1.8,
              pointRadius: 0,
              fill: false
            }
          ]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          animation: false,
          interaction: { mode: 'index', intersect: false },
          scales: {
            x: {
              ticks: { color: '#94A3B8', font: { size: 10 }, maxTicksLimit: 7 },
              grid: { color: 'rgba(148, 163, 184, 0.08)' }
            },
            y: {
              beginAtZero: true,
              title: {
                display: true,
                text: 'мЗв',
                color: '#0EA5E9',
                font: { size: 10 }
              },
              ticks: { color: '#0EA5E9', font: { size: 10 } },
              grid: { color: 'rgba(14, 165, 233, 0.08)' }
            }
          },
          plugins: {
            legend: {
              display: true,
              labels: { color: '#cbd5e1', boxWidth: 10, font: { size: 10 } }
            }
          }
        }
      });
    } else {
      const chart = cumulativeChartRef.current;
      chart.data.labels = labels;
      chart.data.datasets[0].data = cumulativeSeries;
      chart.data.datasets[1].label = `Лимит H_limit (${safePermitLimitMsv.toFixed(2)} мЗв)`;
      chart.data.datasets[1].data = limitSeries;
      chart.update('none');
    }
  }, [recentHistory, isOpen, isMinimized, safePermitLimitMsv, liveTimeLabel, safeAccumDoseMsv]);

  // ============================================================================
  // ГРАФИК 3: Спектральный состав и вклад видов излучения (\alpha, \beta, \gamma, n)
  // ============================================================================
  useEffect(() => {
    if (!isOpen || isMinimized || activeTab !== 'charts' || !spectralCanvasRef.current) return;

    const existing = ChartJS.getChart(spectralCanvasRef.current);
    if (existing && (existing.config as { type?: string }).type !== spectralChartMode) {
      existing.destroy();
      spectralChartRef.current = null;
    } else if (!spectralChartRef.current && existing) {
      spectralChartRef.current = existing;
    }

    const shares = currentAnalysis.spectralSharesPercent;
    const dataValues = [
      sanitizeNonNegativeFinite(shares.alpha),
      sanitizeNonNegativeFinite(shares.beta),
      sanitizeNonNegativeFinite(shares.gamma),
      sanitizeNonNegativeFinite(shares.neutron)
    ];
    const labels = ['Альфа (α, wR=20)', 'Бета (β, wR=1)', 'Гамма (γ, wR=1)', 'Нейтроны (n, wR=10)'];
    const bgColors = [
      'rgba(244, 63, 94, 0.80)',
      'rgba(56, 189, 248, 0.80)',
      'rgba(234, 179, 8, 0.85)',
      'rgba(168, 85, 247, 0.85)'
    ];
    const borderColors = ['#f43f5e', '#38bdf8', '#eab308', '#a855f7'];

    if (!spectralChartRef.current) {
      spectralChartRef.current = new ChartJS(spectralCanvasRef.current, {
        type: spectralChartMode,
        data: {
          labels,
          datasets: [
            {
              label: 'Вклад в эквивалентную дозу (%)',
              data: dataValues,
              backgroundColor: bgColors,
              borderColor: borderColors,
              borderWidth: 1.5
            }
          ]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          animation: false,
          scales:
            spectralChartMode === 'bar'
              ? {
                  x: {
                    ticks: { color: '#cbd5e1', font: { size: 10 } },
                    grid: { display: false }
                  },
                  y: {
                    beginAtZero: true,
                    max: 100,
                    ticks: { color: '#94a3b8', font: { size: 10 }, callback: v => `${v}%` },
                    grid: { color: 'rgba(255,255,255,0.06)' }
                  }
                }
              : undefined,
          plugins: {
            legend: {
              display: spectralChartMode === 'doughnut',
              position: 'right',
              labels: { color: '#cbd5e1', boxWidth: 10, font: { size: 10 } }
            }
          }
        }
      });
    } else {
      const chart = spectralChartRef.current;
      chart.data.datasets[0].data = dataValues;
      chart.update('none');
    }
  }, [currentAnalysis, isOpen, isMinimized, spectralChartMode]);

  // Освобождение памяти инстансов Chart.js при сворачивании, смене вкладки или размонтировании
  useEffect(() => {
    if (isMinimized || !isOpen || activeTab !== 'charts') {
      [doseRateChartRef, cumulativeChartRef, spectralChartRef].forEach(ref => {
        if (ref.current) {
          ref.current.destroy();
          ref.current = null;
        }
      });
    }
  }, [isMinimized, isOpen, activeTab]);

  useEffect(() => {
    return () => {
      [doseRateChartRef, cumulativeChartRef, spectralChartRef].forEach(ref => {
        if (ref.current) {
          ref.current.destroy();
          ref.current = null;
        }
      });
    };
  }, []);

  // ============================================================================
  // ЭКСПОРТ ДАННЫХ В CSV С ВАЛИДАЦИЕЙ И КОЛОНКОЙ VoiceProtocolNotes (ПРИВЯЗКА К D(t) И H(t))
  // ============================================================================
  const handleExportCsv = useCallback(() => {
    const escapeCsvField = (raw: string): string => {
      if (!raw) return '';
      const escaped = raw.replace(/"/g, '""');
      return `"${escaped}"`;
    };

    const header = [
      'Timestamp',
      'ElapsedTime_s',
      'DoseRate_uSv_h',
      'AccumDose_mSv',
      'Distance_m',
      'AttenuationFactor',
      'UnshieldedDoseRate_uSv_h',
      'EffectiveDistance_m',
      'K_dist',
      'K_shield',
      'K_ppe',
      'Alpha_uSv_h',
      'Beta_uSv_h',
      'Gamma_uSv_h',
      'Neutron_uSv_h',
      'PermitLimit_mSv',
      'SimpsonIntegral_mSv',
      'ConvergenceError_pct',
      'VoiceProtocolNotes'
    ].join(',');

    const exportSource: TelemetryHistoryPoint[] =
      history.length > 0
        ? history
        : [
            {
              timestampIso: new Date().toISOString(),
              timeLabel: liveTimeLabel,
              elapsedSec: safeMissionTimeSec,
              doseRateMicroSv: currentProtectedRate,
              unshieldedDoseRateMicroSv: currentUnshieldedRate,
              cumulativeDoseMsv: safeAccumDoseMsv,
              simpsonCumulativeDoseMsv: safeAccumDoseMsv,
              convergenceErrorPercent: 0.0,
              permitLimitMsv: safePermitLimitMsv,
              distanceM: sanitizeNonNegativeFinite(currentAnalysis.baseDistanceM),
              effectiveDistanceM: sanitizeNonNegativeFinite(currentAnalysis.effectiveDistanceM),
              attenuationFactor: sanitizeNonNegativeFinite(currentAnalysis.kProtTotal, 1.0),
              alphaRate: sanitizeNonNegativeFinite(currentAnalysis.spectralDoseRatesMicroSv.alpha),
              betaRate: sanitizeNonNegativeFinite(currentAnalysis.spectralDoseRatesMicroSv.beta),
              gammaRate: sanitizeNonNegativeFinite(currentAnalysis.spectralDoseRatesMicroSv.gamma),
              neutronRate: sanitizeNonNegativeFinite(currentAnalysis.spectralDoseRatesMicroSv.neutron),
              kDist: sanitizeNonNegativeFinite(currentAnalysis.kDist, 1.0),
              kShield: sanitizeNonNegativeFinite(currentAnalysis.kShield, 1.0),
              kPpe: sanitizeNonNegativeFinite(currentAnalysis.kPpe, 1.0),
              kProtTotal: sanitizeNonNegativeFinite(currentAnalysis.kProtTotal, 1.0)
            }
          ];

    // Привязываем каждую запись VoiceLogEntry к ближайшей временной метке графика D(t) и H(t)
    const notesByRowIndex = new Map<number, string[]>();
    if (exportSource.length > 0 && voiceLogs.length > 0) {
      voiceLogs.forEach(entry => {
        let bestIdx = 0;
        let bestDiff = Math.abs(exportSource[0].elapsedSec - entry.elapsedSec);
        for (let i = 1; i < exportSource.length; i++) {
          const diff = Math.abs(exportSource[i].elapsedSec - entry.elapsedSec);
          if (diff < bestDiff) {
            bestDiff = diff;
            bestIdx = i;
          }
        }
        const formattedNote = `[${entry.location} | ${entry.currentDoseRate} мкЗв/ч | ${entry.activeShielding}] ${entry.textNote}`;
        const existingList = notesByRowIndex.get(bestIdx) ?? [];
        if (!existingList.includes(formattedNote)) {
          existingList.push(formattedNote);
        }
        notesByRowIndex.set(bestIdx, existingList);
      });
    }

    const rows = exportSource.map((pt, idx) => {
      const elapsed = sanitizeNonNegativeFinite(pt.elapsedSec);
      const doseRate = sanitizeNonNegativeFinite(pt.doseRateMicroSv);
      const accumDose = sanitizeNonNegativeFinite(pt.cumulativeDoseMsv);
      const dist = sanitizeNonNegativeFinite(pt.distanceM ?? currentAnalysis.baseDistanceM);
      const attenFactor = Math.max(1.0, sanitizeNonNegativeFinite(pt.attenuationFactor ?? pt.kProtTotal, 1.0));
      const unshielded = sanitizeNonNegativeFinite(pt.unshieldedDoseRateMicroSv);
      const effDist = sanitizeNonNegativeFinite(pt.effectiveDistanceM ?? currentAnalysis.effectiveDistanceM);
      const kDistVal = Math.max(1.0, sanitizeNonNegativeFinite(pt.kDist, 1.0));
      const kShieldVal = Math.max(1.0, sanitizeNonNegativeFinite(pt.kShield, 1.0));
      const kPpeVal = Math.max(1.0, sanitizeNonNegativeFinite(pt.kPpe, 1.0));
      const alphaVal = sanitizeNonNegativeFinite(pt.alphaRate);
      const betaVal = sanitizeNonNegativeFinite(pt.betaRate);
      const gammaVal = sanitizeNonNegativeFinite(pt.gammaRate);
      const neutronVal = sanitizeNonNegativeFinite(pt.neutronRate);
      const limitVal = sanitizeNonNegativeFinite(pt.permitLimitMsv, 0.1);
      const simpsonVal = sanitizeNonNegativeFinite(pt.simpsonCumulativeDoseMsv ?? accumDose);
      const convErrVal = sanitizeNonNegativeFinite(pt.convergenceErrorPercent ?? 0.0);

      const matchedVoiceNotes = [...(notesByRowIndex.get(idx) ?? [])];
      if (pt.voiceProtocolNote && !matchedVoiceNotes.includes(pt.voiceProtocolNote)) {
        matchedVoiceNotes.unshift(pt.voiceProtocolNote);
      }
      const voiceProtocolCell = escapeCsvField(matchedVoiceNotes.join(' || '));

      return [
        pt.timestampIso || new Date().toISOString(),
        elapsed.toFixed(2),
        doseRate.toFixed(3),
        accumDose.toFixed(6),
        dist.toFixed(2),
        attenFactor.toFixed(2),
        unshielded.toFixed(3),
        effDist.toFixed(2),
        kDistVal.toFixed(2),
        kShieldVal.toFixed(2),
        kPpeVal.toFixed(2),
        alphaVal.toFixed(3),
        betaVal.toFixed(3),
        gammaVal.toFixed(3),
        neutronVal.toFixed(3),
        limitVal.toFixed(3),
        simpsonVal.toFixed(6),
        convErrVal.toFixed(4),
        voiceProtocolCell
      ].join(',');
    });

    const csvContent = '\uFEFF' + [header, ...rows].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `alara_telemetry_${Date.now()}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }, [
    history,
    voiceLogs,
    liveTimeLabel,
    safeMissionTimeSec,
    currentProtectedRate,
    currentUnshieldedRate,
    safeAccumDoseMsv,
    safePermitLimitMsv,
    currentAnalysis
  ]);

  // Автоматическое выполнение экспорта CSV по голосовой команде «Экспорт отчета / CSV»
  const lastExportSignalRef = useRef(exportCsvSignal);
  useEffect(() => {
    if (exportCsvSignal > lastExportSignalRef.current) {
      lastExportSignalRef.current = exportCsvSignal;
      handleExportCsv();
    }
  }, [exportCsvSignal, handleExportCsv]);

  const handleExportPdf = useCallback(async () => {
    if (isExportingPdf) return;
    setIsExportingPdf(true);
    try {
      await exportDoseHistoryPdfReport({
        history,
        currentAnalysis,
        cumulativeDoseMsv: safeAccumDoseMsv,
        missionTimeSec: safeMissionTimeSec,
        permitLimitMsv: safePermitLimitMsv,
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
      console.error('Ошибка формирования PDF-отчета телеметрии:', err);
    } finally {
      setIsExportingPdf(false);
    }
  }, [
    isExportingPdf,
    history,
    currentAnalysis,
    safeAccumDoseMsv,
    safeMissionTimeSec,
    safePermitLimitMsv,
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

  if (!isOpen) return null;

  if (isMinimized) {
    return (
      <div className="fixed bottom-16 left-4 z-40 pointer-events-auto alara-glass rounded-xl px-3.5 py-2 flex items-center gap-3">
        <Activity className="w-4 h-4 text-[#0EA5E9] shrink-0" />
        <div className="text-[11px] font-mono alara-tabular text-[#F1F5F9] whitespace-nowrap">
          K_prot <strong className="text-[#10B981]">{currentAnalysis.kProtTotal}×</strong> · T_rem{' '}
          <strong className={safeStay.isLimitExceeded ? 'text-[#EF4444]' : 'text-[#F59E0B]'}>
            {safeStay.textRu}
          </strong>
        </div>
        <button
          onClick={() => setMinimizedState(false)}
          className="px-2.5 py-1 rounded-[10px] alara-surface hover:bg-slate-800/80 text-[#F1F5F9] text-[11px] font-medium flex items-center gap-1 transition whitespace-nowrap shrink-0 cursor-pointer"
          title="Развернуть окно аналитики"
        >
          <Maximize2 className="w-3 h-3" />
          <span>Развернуть</span>
        </button>
      </div>
    );
  }

  return (
    <div className="fixed inset-x-3 bottom-16 md:inset-x-auto md:left-4 md:bottom-16 z-40 pointer-events-auto w-auto md:w-[min(840px,94vw)] max-h-[72vh] overflow-y-auto alara-glass-elevated rounded-xl p-4 text-[#F1F5F9]">
      {/* Компактная шапка аналитического окна */}
      <div className="flex flex-wrap items-center justify-between gap-2 pb-2.5 border-b border-slate-400/15">
        <div className="flex items-center gap-2">
          <Activity className="w-4 h-4 text-[#0EA5E9] shrink-0" />
          <div>
            <h2 className="text-xs font-semibold text-[#F1F5F9]">
              Дозиметрический анализ ALARA
            </h2>
            <p className="text-[11px] text-[#94A3B8] font-mono truncate max-w-md">{scenarioTitle}</p>
          </div>
        </div>

        {/* Вложенные вкладки */}
        <div className="flex items-center gap-1 alara-surface p-0.5 rounded-[10px]">
          <button
            onClick={() => setActiveTab('charts')}
            className={`px-2.5 py-1 rounded-[8px] text-[11px] font-medium transition whitespace-nowrap cursor-pointer ${
              activeTab === 'charts' ? 'bg-[#0EA5E9] text-[#0B1117] font-semibold' : 'text-[#94A3B8] hover:text-[#F1F5F9]'
            }`}
          >
            Графики (3)
          </button>
          <button
            onClick={() => setActiveTab('protection')}
            className={`px-2.5 py-1 rounded-[8px] text-[11px] font-medium transition whitespace-nowrap cursor-pointer ${
              activeTab === 'protection' ? 'bg-[#0EA5E9] text-[#0B1117] font-semibold' : 'text-[#94A3B8] hover:text-[#F1F5F9]'
            }`}
          >
            Защита и органы
          </button>
          <button
            onClick={() => setActiveTab('voice')}
            className={`px-2.5 py-1 rounded-[8px] text-[11px] font-medium transition whitespace-nowrap cursor-pointer ${
              activeTab === 'voice' ? 'bg-[#0EA5E9] text-[#0B1117] font-semibold' : 'text-[#94A3B8] hover:text-[#F1F5F9]'
            }`}
          >
            Лог ({voiceLogs.length})
          </button>
        </div>

        <div className="flex items-center gap-1">
          <button
            onClick={handleExportCsv}
            className="px-2.5 py-1 rounded-[10px] bg-[#10B981]/15 hover:bg-[#10B981]/25 text-[#10B981] border border-[#10B981]/35 text-[11px] font-medium flex items-center gap-1 transition whitespace-nowrap cursor-pointer"
            title="Экспорт CSV телеметрии"
          >
            <Download className="w-3 h-3" />
            <span>CSV</span>
          </button>

          <button
            onClick={handleExportPdf}
            disabled={isExportingPdf}
            className="px-2.5 py-1 rounded-[10px] bg-[#0EA5E9]/15 hover:bg-[#0EA5E9]/25 disabled:opacity-60 text-[#0EA5E9] border border-[#0EA5E9]/35 text-[11px] font-medium flex items-center gap-1 transition whitespace-nowrap cursor-pointer"
            title="Экспорт PDF-отчета по телеметрии дозы и пределам"
          >
            {isExportingPdf ? (
              <Loader2 className="w-3 h-3 animate-spin" />
            ) : (
              <FileText className="w-3 h-3" />
            )}
            <span>PDF</span>
          </button>

          <button
            onClick={onResetCharts}
            className="p-1.5 rounded-[10px] alara-surface hover:bg-slate-800/80 text-[#F59E0B] transition cursor-pointer"
            title="Очистить графики"
          >
            <RotateCcw className="w-3.5 h-3.5" />
          </button>

          {onResetScenario && (
            <button
              onClick={onResetScenario}
              className="px-2.5 py-1 rounded-[10px] bg-[#EF4444]/15 hover:bg-[#EF4444]/25 text-[#EF4444] border border-[#EF4444]/35 text-[11px] font-medium transition whitespace-nowrap cursor-pointer"
              title="Полный сброс сценария"
            >
              Сброс
            </button>
          )}

          <button
            onClick={() => setMinimizedState(true)}
            className="p-1.5 rounded-[10px] alara-surface hover:bg-slate-800/80 text-[#94A3B8] hover:text-[#F1F5F9] transition cursor-pointer"
            title="Свернуть"
          >
            <Minimize2 className="w-3.5 h-3.5" />
          </button>

          <button
            onClick={onClose}
            className="p-1.5 rounded-[10px] alara-surface hover:bg-[#EF4444]/20 text-[#94A3B8] hover:text-[#EF4444] transition cursor-pointer"
            title="Закрыть окно"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* ВКЛАДКА 1: 3 ЖИВЫХ ГРАФИКА */}
      {activeTab === 'charts' && (
        <>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5 my-2.5">
            <div className="alara-surface rounded-xl p-2.5">
              <div className="flex items-center justify-between text-[11px] text-[#94A3B8] mb-1">
                <span className="font-medium flex items-center gap-1 text-[#10B981]">
                  <UserCheck className="w-3.5 h-3.5" /> СИЗ
                </span>
                <span className="font-mono alara-tabular text-[#F1F5F9]">K={currentAnalysis.kPpe.toFixed(2)}×</span>
              </div>
              <select
                value={selectedPpeId}
                onChange={e => onChangePpeId(e.target.value as PPELoadoutId)}
                className="w-full bg-[#0B1117] text-xs text-[#F1F5F9] border border-slate-400/20 rounded-[10px] px-2 py-1 focus:outline-none focus:border-[#10B981]"
              >
                {Object.values(PPE_LOADOUTS).map(ppe => (
                  <option key={ppe.id} value={ppe.id}>
                    {ppe.shortNameRu}
                  </option>
                ))}
              </select>
            </div>

            <div className="alara-surface rounded-xl p-2.5">
              <div className="flex items-center justify-between text-[11px] text-[#94A3B8] mb-1">
                <span className="font-medium flex items-center gap-1 text-[#0EA5E9]">
                  <Ruler className="w-3.5 h-3.5" /> Дистанция (1/r²)
                </span>
                <span className="font-mono alara-tabular text-[#F1F5F9]">K={currentAnalysis.kDist.toFixed(2)}×</span>
              </div>
              <select
                value={selectedRemoteToolId}
                onChange={e => onChangeRemoteToolId(e.target.value as RemoteToolId)}
                className="w-full bg-[#0B1117] text-xs text-[#F1F5F9] border border-slate-400/20 rounded-[10px] px-2 py-1 focus:outline-none focus:border-[#0EA5E9]"
              >
                {Object.values(REMOTE_TOOLS).map(tool => (
                  <option key={tool.id} value={tool.id}>
                    {tool.shortNameRu}
                  </option>
                ))}
              </select>
            </div>

            <div className="alara-surface rounded-xl p-2.5">
              <div className="flex items-center justify-between text-[11px] text-[#94A3B8] mb-1">
                <span className="font-medium flex items-center gap-1 text-[#F59E0B]">
                  <Clock className="w-3.5 h-3.5" /> Лимит H_limit
                </span>
                <span className={`font-mono alara-tabular font-semibold ${safeStay.isLimitExceeded ? 'text-[#EF4444]' : 'text-[#10B981]'}`}>
                  {safeStay.textRu}
                </span>
              </div>
              <select
                value={permitLimitMsv}
                onChange={e => onChangePermitLimitMsv(Number(e.target.value))}
                className="w-full bg-[#0B1117] text-xs text-[#F1F5F9] border border-slate-400/20 rounded-[10px] px-2 py-1 focus:outline-none focus:border-[#F59E0B]"
              >
                <option value={0.01}>0.01 мЗв (10 мкЗв)</option>
                <option value={0.05}>0.05 мЗв (50 мкЗв)</option>
                <option value={0.10}>0.10 мЗв (100 мкЗв)</option>
                <option value={0.20}>0.20 мЗв (200 мкЗв)</option>
                <option value={0.50}>0.50 мЗв (500 мкЗв)</option>
                <option value={1.00}>1.00 мЗв (Аварийный)</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5 my-2">
            <div className="alara-surface rounded-xl p-2.5 flex flex-col h-48">
              <div className="flex items-center justify-between text-[11px] font-semibold text-[#F59E0B] mb-1">
                <span>D(t) Мощность дозы</span>
                <span className="font-mono alara-tabular text-[#F1F5F9]">
                  {(currentProtectedRate * rateScaleFactor).toFixed(2)} {rateUnitLabel}
                </span>
              </div>
              <div className="flex-1 min-h-0">
                <canvas ref={doseRateCanvasRef} />
              </div>
            </div>

            <div className="alara-surface rounded-xl p-2.5 flex flex-col h-48">
              <div className="flex items-center justify-between text-[11px] font-semibold text-[#0EA5E9] mb-1">
                <span>H(t) Интеграл (±{latestConvergenceErr.toFixed(2)}%)</span>
                <span className="font-mono alara-tabular text-[#F1F5F9]">
                  {safeAccumDoseMsv.toFixed(4)} / {safePermitLimitMsv.toFixed(2)} мЗв
                </span>
              </div>
              <div className="flex-1 min-h-0">
                <canvas ref={cumulativeCanvasRef} />
              </div>
            </div>

            <div className="alara-surface rounded-xl p-2.5 flex flex-col h-48">
              <div className="flex items-center justify-between text-[11px] font-semibold text-[#14B8A6] mb-1">
                <span>Спектр (α, β, γ, n)</span>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => setSpectralChartMode('bar')}
                    className={`p-1 rounded cursor-pointer ${spectralChartMode === 'bar' ? 'bg-[#0EA5E9]/20 text-[#0EA5E9]' : 'text-[#94A3B8] hover:text-[#F1F5F9]'}`}
                  >
                    <BarChart3 className="w-3 h-3" />
                  </button>
                  <button
                    onClick={() => setSpectralChartMode('doughnut')}
                    className={`p-1 rounded cursor-pointer ${spectralChartMode === 'doughnut' ? 'bg-[#0EA5E9]/20 text-[#0EA5E9]' : 'text-[#94A3B8] hover:text-[#F1F5F9]'}`}
                  >
                    <PieChart className="w-3 h-3" />
                  </button>
                </div>
              </div>
              <div className="flex-1 min-h-0">
                <canvas ref={spectralCanvasRef} />
              </div>
            </div>
          </div>

          {safeStay.isLimitExceeded && (
            <div className="mt-1 text-[11px] text-[#EF4444] font-medium flex items-center gap-1.5">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
              <span>Превышен контрольный предел дозы по наряду-допуску.</span>
            </div>
          )}
        </>
      )}

      {/* ВКЛАДКА 2: ФАКТОРЫ ОСЛАБЛЕНИЯ K_prot И КРИТИЧЕСКИЕ ОРГАНЫ */}
      {activeTab === 'protection' && (
        <div className="mt-2.5 space-y-2.5">
          {scenarioConfig && (
            <div className="rounded-xl px-3 py-2 alara-surface text-[11px] flex flex-wrap items-center justify-between gap-2 text-[#94A3B8] font-mono alara-tabular">
              <span>
                Сценарий #{scenarioConfig.scenarioId} · H_limit:{' '}
                <strong className="text-[#F1F5F9]">{scenarioConfig.hLimitMsv.toFixed(3)} мЗв</strong> · Изотопы:{' '}
                <strong className="text-[#10B981]">{scenarioConfig.isotopes.join(', ')}</strong>
              </span>
              <span className="text-[#EF4444] font-sans">{scenarioConfig.failMessagesRu.ppeViolation}</span>
            </div>
          )}

          <div className="alara-surface rounded-xl p-3">
            <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
              <div className="flex items-center gap-2 text-xs font-semibold text-[#F1F5F9]">
                <Shield className="w-4 h-4 text-[#10B981]" />
                <span>Факторы ослабления:</span>
                <span className="font-mono alara-tabular text-[#10B981]">
                  K_prot = K_dist × K_shield × K_ppe = {currentAnalysis.kDist.toFixed(2)} ×{' '}
                  {currentAnalysis.kShield.toFixed(2)} × {currentAnalysis.kPpe.toFixed(2)} ={' '}
                  {currentAnalysis.kProtTotal.toFixed(2)}×
                </span>
              </div>
              <div className="text-[11px] font-mono text-[#64748B]">
                I = I₀ · B(E, μd) · exp(-μd) · D(r) = (Γ_γ · A) / r²
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs font-mono alara-tabular">
                <thead>
                  <tr className="border-b border-slate-400/15 text-[#94A3B8] text-[11px]">
                    <th className="py-1.5 pr-3 font-sans">Фактор защиты (НРБ-99/2009)</th>
                    <th className="py-1.5 px-3 font-sans">Текущий режим / Параметры среды</th>
                    <th className="py-1.5 px-3 font-sans">Коэффициент</th>
                    <th className="py-1.5 pl-3 text-right font-sans">Снижение</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-400/10 text-[11px]">
                  <tr>
                    <td className="py-1.5 pr-3 font-sans font-medium text-[#0EA5E9]">
                      Защита расстоянием (K_dist)
                    </td>
                    <td className="py-1.5 px-3 text-[#94A3B8]">
                      {REMOTE_TOOLS[selectedRemoteToolId].shortNameRu} · r = {currentAnalysis.effectiveDistanceM.toFixed(2)} м
                    </td>
                    <td className="py-1.5 px-3 font-semibold text-[#F1F5F9]">{currentAnalysis.kDist.toFixed(2)}×</td>
                    <td className="py-1.5 pl-3 text-right text-[#10B981]">
                      -{((1 - 1 / Math.max(1, currentAnalysis.kDist)) * 100).toFixed(1)}%
                    </td>
                  </tr>
                  <tr>
                    <td className="py-1.5 pr-3 font-sans font-medium text-[#F59E0B]">
                      Защита экранированием (K_shield)
                    </td>
                    <td className="py-1.5 px-3 text-[#94A3B8]">
                      {currentAnalysis.activeShieldMaterialRu} (d = {currentAnalysis.activeShieldThicknessCm.toFixed(1)} см, μ ={' '}
                      {currentAnalysis.activeMu.toFixed(3)} см⁻¹, B = {currentAnalysis.activeBuildupB.toFixed(2)})
                    </td>
                    <td className="py-1.5 px-3 font-semibold text-[#F1F5F9]">{currentAnalysis.kShield.toFixed(2)}×</td>
                    <td className="py-1.5 pl-3 text-right text-[#10B981]">
                      -{((1 - 1 / Math.max(1, currentAnalysis.kShield)) * 100).toFixed(1)}%
                    </td>
                  </tr>
                  <tr>
                    <td className="py-1.5 pr-3 font-sans font-medium text-[#10B981]">
                      Средства инд. защиты СИЗ (K_ppe)
                    </td>
                    <td className="py-1.5 px-3 text-[#94A3B8]">
                      {PPE_LOADOUTS[selectedPpeId].shortNameRu} (α: {PPE_LOADOUTS[selectedPpeId].alphaAttenuationPercent}
                      %, β: {PPE_LOADOUTS[selectedPpeId].betaAttenuationPercent}%)
                    </td>
                    <td className="py-1.5 px-3 font-semibold text-[#F1F5F9]">{currentAnalysis.kPpe.toFixed(2)}×</td>
                    <td className="py-1.5 pl-3 text-right text-[#10B981]">
                      -{((1 - 1 / Math.max(1, currentAnalysis.kPpe)) * 100).toFixed(1)}%
                    </td>
                  </tr>
                  <tr className="bg-[#0B1117]/60">
                    <td className="py-1.5 pr-3 font-sans font-semibold text-[#F1F5F9]">
                      Итоговый коэффициент защиты (K_prot)
                    </td>
                    <td className="py-1.5 px-3 text-[#94A3B8]">
                      D₀ = {currentUnshieldedRate.toFixed(2)} мкЗв/ч → D(t) = {currentProtectedRate.toFixed(2)} мкЗв/ч
                    </td>
                    <td className="py-1.5 px-3 font-bold text-[#10B981]">
                      {currentAnalysis.kProtTotal.toFixed(2)}×
                    </td>
                    <td className="py-1.5 pl-3 text-right font-semibold text-[#10B981]">
                      -{((1 - 1 / Math.max(1, currentAnalysis.kProtTotal)) * 100).toFixed(2)}%
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          <div className="alara-surface rounded-xl p-3">
            <div className="flex flex-wrap items-center justify-between gap-2 mb-2.5">
              <div className="flex items-center gap-2 text-xs font-semibold text-[#0EA5E9]">
                <Layers className="w-4 h-4" />
                <span>Расширенная радиационная физика и критические органы (НРБ-99/2009)</span>
              </div>
              <div className="text-[11px] font-mono text-[#64748B]">
                Органы · Альбедо стен · Тормозное излучение
              </div>
            </div>

            {(() => {
              const critOrgans = currentAnalysis.criticalOrgans ?? {
                skinMicroSvPerHour: 0,
                eyeLensMicroSvPerHour: 0,
                bloodMarrowMicroSvPerHour: 0
              };
              const advPhys = currentAnalysis.advancedPhysics ?? {
                albedoGammaScatterMicroSv: 0,
                bremsstrahlungDoseRateMicroSv: 0,
                isBremsstrahlungHigh: false,
                twoLayerShieldRecommended: false,
                aerosolInhalationRateMicroSv: 0
              };

              return (
                <>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 mb-2.5">
                    <div className="p-2.5 rounded-[10px] bg-[#0B1117]/75 border border-slate-400/15">
                      <div className="flex items-center justify-between text-[11px] text-[#94A3B8]">
                        <span className="font-medium text-[#F59E0B]">1. Кожные покровы</span>
                        <span className="font-mono text-[10px]">w_T = 0.01</span>
                      </div>
                      <div className="text-sm font-mono alara-tabular font-semibold text-[#F1F5F9] mt-1">
                        {(critOrgans.skinMicroSvPerHour * rateScaleFactor).toFixed(2)} {rateUnitLabel}
                      </div>
                      <div className="text-[11px] text-[#64748B] mt-0.5">
                        β-спектр + мягкий рентген · Задержка СИЗ
                      </div>
                    </div>

                    <div className="p-2.5 rounded-[10px] bg-[#0B1117]/75 border border-slate-400/15">
                      <div className="flex items-center justify-between text-[11px] text-[#94A3B8]">
                        <span className="font-medium text-[#14B8A6]">2. Хрусталик глаза</span>
                        <span className="font-mono text-[10px]">w_T = 0.12</span>
                      </div>
                      <div className="text-sm font-mono alara-tabular font-semibold text-[#F1F5F9] mt-1">
                        {(critOrgans.eyeLensMicroSvPerHour * rateScaleFactor).toFixed(2)} {rateUnitLabel}
                      </div>
                      <div className="text-[11px] text-[#64748B] mt-0.5">
                        {selectedPpeId !== 'none' ? 'Защищён маской СИЗОД' : 'Открытый хрусталик (риск)'}
                      </div>
                    </div>

                    <div className="p-2.5 rounded-[10px] bg-[#0B1117]/75 border border-slate-400/15">
                      <div className="flex items-center justify-between text-[11px] text-[#94A3B8]">
                        <span className="font-medium text-[#EF4444]">3. Кроветворные органы</span>
                        <span className="font-mono text-[10px]">d = 10 мм</span>
                      </div>
                      <div className="text-sm font-mono alara-tabular font-semibold text-[#F1F5F9] mt-1">
                        {(critOrgans.bloodMarrowMicroSvPerHour * rateScaleFactor).toFixed(2)} {rateUnitLabel}
                      </div>
                      <div className="text-[11px] text-[#64748B] mt-0.5">
                        {PPE_LOADOUTS[selectedPpeId].leadEquivalentMm > 0
                          ? `Экранирован Pb (${PPE_LOADOUTS[selectedPpeId].leadEquivalentMm} мм)`
                          : 'Без свинцового фартука'}
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 text-xs font-mono alara-tabular">
                    <div className="p-2.5 rounded-[10px] bg-[#0B1117]/75 border border-slate-400/15">
                      <span className="text-[11px] text-[#94A3B8] block font-sans font-medium">
                        Альбедо рассеяния (Стены/Пол):
                      </span>
                      <span className="text-[#0EA5E9] font-semibold block mt-1">
                        +{(advPhys.albedoGammaScatterMicroSv * rateScaleFactor).toFixed(2)} {rateUnitLabel}
                      </span>
                    </div>

                    <div
                      className={`p-2.5 rounded-[10px] border ${
                        advPhys.twoLayerShieldRecommended
                          ? 'bg-[#F59E0B]/12 border-[#F59E0B]/45 text-[#F59E0B]'
                          : 'bg-[#0B1117]/75 border-slate-400/15 text-[#F1F5F9]'
                      }`}
                    >
                      <span className="text-[11px] text-[#94A3B8] block font-sans font-medium">
                        Тормозное излучение:
                      </span>
                      <span className="font-semibold block mt-1">
                        {(advPhys.bremsstrahlungDoseRateMicroSv * rateScaleFactor).toFixed(2)} {rateUnitLabel}
                      </span>
                    </div>

                    <div className="p-2.5 rounded-[10px] bg-[#0B1117]/75 border border-slate-400/15">
                      <span className="text-[11px] text-[#94A3B8] block font-sans font-medium">
                        Ингаляция аэрозолей:
                      </span>
                      <span className="text-[#10B981] font-semibold block mt-1">
                        {(advPhys.aerosolInhalationRateMicroSv * rateScaleFactor).toFixed(2)} {rateUnitLabel}
                      </span>
                    </div>
                  </div>
                </>
              );
            })()}
          </div>
        </div>
      )}

      {/* ВКЛАДКА 3: ГОЛОСОВОЙ ПРОТОКОЛ */}
      {activeTab === 'voice' && (
        <div className="mt-2.5 alara-surface rounded-xl p-3">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
            <div className="flex items-center gap-2 text-xs font-semibold text-[#10B981]">
              <Mic className="w-4 h-4" />
              <span>Голосовой протокол (VoiceTaskLogger · ru-RU)</span>
              <span className="font-mono alara-tabular text-[11px] text-[#94A3B8]">
                · Записей: {voiceLogs.length}
              </span>
            </div>
            <div className="text-[11px] font-mono text-[#64748B]">
              VR: [Y / Стик] лев. · ПК: [V]
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 mb-2">
            <input
              type="text"
              value={fallbackInputText}
              onChange={e => setFallbackInputText(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && fallbackInputText.trim()) {
                  onSubmitVoiceFallbackText?.(fallbackInputText.trim());
                  setFallbackInputText('');
                }
              }}
              placeholder="Запись замера или команда (напр.: Точка А-1, 45 мкЗв/ч)..."
              className="flex-1 min-w-[240px] bg-[#0B1117] border border-slate-400/20 rounded-[10px] px-3 py-1.5 text-xs text-[#F1F5F9] placeholder-[#64748B] focus:outline-none focus:border-[#0EA5E9]"
            />
            <button
              onClick={() => {
                if (fallbackInputText.trim()) {
                  onSubmitVoiceFallbackText?.(fallbackInputText.trim());
                  setFallbackInputText('');
                }
              }}
              className="px-3 py-1.5 rounded-[10px] bg-[#10B981] hover:bg-emerald-400 text-[#0B1117] font-semibold text-xs flex items-center gap-1 transition cursor-pointer"
            >
              <Send className="w-3.5 h-3.5" />
              <span>Протоколировать</span>
            </button>
            <button
              onClick={() =>
                onSubmitVoiceFallbackText?.(
                  `Точка А-1, мощность дозы ${currentProtectedRate.toFixed(1)} мкЗв/ч, установлен свинцовый экран ${currentAnalysis.activeShieldThicknessCm.toFixed(1)} см`,
                  'dictation'
                )
              }
              className="px-2.5 py-1.5 rounded-[10px] bg-[#0B1117] hover:bg-slate-800/80 text-[#F59E0B] border border-[#F59E0B]/35 text-[11px] font-medium transition cursor-pointer"
            >
              + Пример замера А-1
            </button>
          </div>

          {voiceLogs.length > 0 && (
            <div className="max-h-28 overflow-y-auto space-y-1 pr-1">
              {voiceLogs
                .slice()
                .reverse()
                .map(entry => (
                  <div
                    key={entry.id}
                    className="flex flex-wrap items-center justify-between gap-2 bg-[#0B1117]/75 border border-slate-400/15 rounded-[10px] px-2.5 py-1.5 text-[11px]"
                  >
                    <div className="flex items-center gap-2">
                      <span className="font-mono font-semibold text-[#F59E0B]">[{entry.location}]</span>
                      <span className="text-[#F1F5F9]">«{entry.textNote}»</span>
                    </div>
                    <div className="flex items-center gap-3 font-mono alara-tabular text-[11px]">
                      <span className="text-[#10B981]">H = {entry.currentDoseRate.toFixed(1)} мкЗв/ч</span>
                      <span className="text-[#0EA5E9]">Экран: {entry.activeShielding}</span>
                      <span className="text-[#64748B]">t = {entry.elapsedSec.toFixed(1)}с</span>
                    </div>
                  </div>
                ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
