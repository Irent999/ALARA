/**
 * ALARA-Planner Pro — Модуль аналитики разбора полетов (After Action Review / AARAnalytics.tsx)
 *
 * Обеспечивает:
 * 1. Запись пространственно-временной 3D-траектории спасателя с привязкой к МЭД H(r), накопленной дозе и ЧСС.
 * 2. Автоматическую фиксацию нарушений регламента ОСПОРБ-99/2010 и НРБ-99/2009.
 * 3. Расчет интегрального балла ALARA (0–100) по четырем критериям: Время, Расстояние, Экранирование, СИЗ.
 * 4. Визуализацию тепловой карты маршрута (Trajectory Dose Heatmap) и экспорт протокола в JSON/CSV.
 */

import React, { useMemo } from 'react';
import { AlertTriangle } from 'lucide-react';
import { PPEChecklistResult, ProtectionCoefficientsResult } from './PPECheckModule';
import { PhysiologicalTelemetry } from './PhysiologicalStress';
import type { MchsMissionMetrics } from '../scene/EvacuationManager';

export interface AARTrajectorySample {
  timestampSec: number;
  position: [number, number, number];
  doseRateMsvPerHour: number;
  cumulativeDoseMsv: number;
  heartRateBpm: number;
  shieldAttenuationFactor: number;
  ppeProtectionFactor: number;
}

export interface AARProtocolViolation {
  id: string;
  timestampSec: number;
  severity: 'WARNING' | 'CRITICAL_VIOLATION';
  code: string;
  descriptionRu: string;
  penaltyPoints: number;
}

export interface AARScoreBreakdown {
  totalScore: number; // 0 - 100
  timeEfficiencyScore: number; // 0 - 25
  distanceOptimizationScore: number; // 0 - 25
  shieldingUsageScore: number; // 0 - 25
  ppeComplianceScore: number; // 0 - 25
  gradeRu: 'ОТЛИЧНО (Допуск 1-й категории)' | 'ХОРОШО (Допуск подтвержден)' | 'УДОВЛЕТВОРИТЕЛЬНО (Переэкзаменовка)' | 'НЕУДОВЛЕТВОРИТЕЛЬНО (Отстранение от работ)';
  passedCertification: boolean;
}

export interface AARSummaryReport {
  scenarioId: number;
  scenarioTitle: string;
  missionDurationSec: number;
  targetDurationSec: number;
  doseResetCount: number;
  finalAccumulatedDoseMsv: number;
  doseLimitMsv: number;
  peakDoseRateMsvPerHour: number;
  averageDoseRateMsvPerHour: number;
  peakHeartRateBpm: number;
  minOxygenReservePercent: number;
  ppeChecklistPassedAtEntry: boolean;
  trajectorySamples: AARTrajectorySample[];
  violations: AARProtocolViolation[];
  scoreBreakdown: AARScoreBreakdown;
  mchsMetrics?: MchsMissionMetrics;
  generatedAtIso: string;
}

/**
 * Вычисляет интегральный рейтинг прохождения сценария по принципам ALARA
 */
export function evaluateAARSummary(params: {
  scenarioId: number;
  scenarioTitle: string;
  missionDurationSec: number;
  targetDurationSec: number;
  doseResetCount?: number;
  finalAccumulatedDoseMsv: number;
  doseLimitMsv: number;
  ppeChecklist: PPEChecklistResult;
  ppeProtection: ProtectionCoefficientsResult;
  physiology: PhysiologicalTelemetry;
  trajectorySamples: AARTrajectorySample[];
  violations: AARProtocolViolation[];
  mchsMetrics?: MchsMissionMetrics;
}): AARSummaryReport {
  const {
    scenarioId,
    scenarioTitle,
    missionDurationSec,
    targetDurationSec,
    doseResetCount = 0,
    finalAccumulatedDoseMsv,
    doseLimitMsv,
    ppeChecklist,
    physiology,
    trajectorySamples,
    violations,
    mchsMetrics
  } = params;

  let peakDoseRate = 0;
  let sumDoseRate = 0;
  let peakBpm = physiology.heartRateBpm;
  let sumShieldFactor = 0;

  for (const sample of trajectorySamples) {
    if (sample.doseRateMsvPerHour > peakDoseRate) {
      peakDoseRate = sample.doseRateMsvPerHour;
    }
    if (sample.heartRateBpm > peakBpm) {
      peakBpm = sample.heartRateBpm;
    }
    sumDoseRate += sample.doseRateMsvPerHour;
    sumShieldFactor += sample.shieldAttenuationFactor;
  }

  const count = Math.max(1, trajectorySamples.length);
  const avgDoseRate = sumDoseRate / count;
  const avgShieldFactor = sumShieldFactor / count;

  const timeRatio = missionDurationSec / Math.max(30, targetDurationSec);
  const timeEfficiencyScore = Number(
    Math.max(0, Math.min(25, timeRatio <= 1.0 ? 25 : 25 * Math.exp(-(timeRatio - 1.0) * 1.2))).toFixed(1)
  );

  const doseRatio = finalAccumulatedDoseMsv / Math.max(0.01, doseLimitMsv);
  const distanceOptimizationScore = Number(
    Math.max(0, Math.min(25, doseRatio <= 1.0 ? 25 * (1.0 - doseRatio * 0.45) : 0)).toFixed(1)
  );

  const shieldingUsageScore = Number(
    Math.max(5, Math.min(25, 12 + Math.log10(Math.max(1.0, avgShieldFactor)) * 13.0)).toFixed(1)
  );

  let ppeComplianceScore = ppeChecklist.isReadyForDirtyZone ? 25 : 5;
  for (const v of violations) {
    ppeComplianceScore = Math.max(0, ppeComplianceScore - v.penaltyPoints * 0.5);
  }
  ppeComplianceScore = Number(ppeComplianceScore.toFixed(1));

  const hasLoggedBareHand = violations.some(v => v.code === 'BARE_HAND_ISOTOPE_GRAB');
  const extraBareHandPenalty =
    mchsMetrics && mchsMetrics.bareHandViolations > 0 && !hasLoggedBareHand
      ? mchsMetrics.bareHandViolations * 15
      : 0;
  if (extraBareHandPenalty > 0) {
    ppeComplianceScore = Number(Math.max(0, ppeComplianceScore - extraBareHandPenalty * 0.5).toFixed(1));
  }

  const doseResetPenalty = doseResetCount * 25;
  const penaltySum = violations.reduce((acc, v) => acc + v.penaltyPoints, 0) + extraBareHandPenalty;
  const rawTotal =
    timeEfficiencyScore + distanceOptimizationScore + shieldingUsageScore + ppeComplianceScore - penaltySum * 0.35 - doseResetPenalty;
  const totalScore = Number(Math.max(0, Math.min(100, rawTotal)).toFixed(1));

  let gradeRu: AARScoreBreakdown['gradeRu'] = 'НЕУДОВЛЕТВОРИТЕЛЬНО (Отстранение от работ)';
  if (totalScore >= 85 && finalAccumulatedDoseMsv <= doseLimitMsv && ppeChecklist.isReadyForDirtyZone && doseResetCount === 0) {
    gradeRu = 'ОТЛИЧНО (Допуск 1-й категории)';
  } else if (totalScore >= 70 && finalAccumulatedDoseMsv <= doseLimitMsv && doseResetCount === 0) {
    gradeRu = 'ХОРОШО (Допуск подтвержден)';
  } else if (totalScore >= 50) {
    gradeRu = 'УДОВЛЕТВОРИТЕЛЬНО (Переэкзаменовка)';
  }

  return {
    scenarioId,
    scenarioTitle,
    missionDurationSec: Number(missionDurationSec.toFixed(1)),
    targetDurationSec: Number(targetDurationSec.toFixed(1)),
    doseResetCount: Number(doseResetCount),
    finalAccumulatedDoseMsv: Number(finalAccumulatedDoseMsv.toFixed(4)),
    doseLimitMsv,
    peakDoseRateMsvPerHour: Number(peakDoseRate.toFixed(3)),
    averageDoseRateMsvPerHour: Number(avgDoseRate.toFixed(3)),
    peakHeartRateBpm: Number(peakBpm.toFixed(0)),
    minOxygenReservePercent: Number(physiology.remainingOxygenPercent.toFixed(1)),
    ppeChecklistPassedAtEntry: ppeChecklist.isReadyForDirtyZone,
    trajectorySamples,
    violations,
    scoreBreakdown: {
      totalScore,
      timeEfficiencyScore,
      distanceOptimizationScore,
      shieldingUsageScore,
      ppeComplianceScore,
      gradeRu,
      passedCertification: totalScore >= 70 && finalAccumulatedDoseMsv <= doseLimitMsv && doseResetCount === 0
    },
    mchsMetrics,
    generatedAtIso: new Date().toISOString()
  };
}

/**
 * Экспорт отчета AAR в формат CSV для архива аттестационной комиссии
 */
export function exportAARReportToCSV(report: AARSummaryReport): string {
  const header = [
    'Time_s',
    'Pos_X_m',
    'Pos_Y_m',
    'Pos_Z_m',
    'DoseRate_mSv_h',
    'CumulativeDose_mSv',
    'HeartRate_BPM',
    'ShieldAttenuation',
    'PPE_Factor'
  ].join(',');

  const rows = report.trajectorySamples.map(s =>
    [
      s.timestampSec.toFixed(1),
      s.position[0].toFixed(2),
      s.position[1].toFixed(2),
      s.position[2].toFixed(2),
      s.doseRateMsvPerHour.toFixed(4),
      s.cumulativeDoseMsv.toFixed(5),
      s.heartRateBpm.toFixed(0),
      s.shieldAttenuationFactor.toFixed(2),
      s.ppeProtectionFactor.toFixed(2)
    ].join(',')
  );

  return [header, ...rows].join('\n');
}

export interface AARAnalyticsModalProps {
  isOpen: boolean;
  onClose: () => void;
  report: AARSummaryReport;
  onExportPdf?: () => void | Promise<void>;
}

/**
 * Интерактивная панель послеполетного разбора (After Action Review) с тепловой картой маршрута
 */
export const AARAnalytics: React.FC<AARAnalyticsModalProps> = ({ isOpen, onClose, report, onExportPdf }) => {
  const heatmapPoints = useMemo(() => {
    if (report.trajectorySamples.length === 0) return [];
    const maxRate = Math.max(0.01, report.peakDoseRateMsvPerHour);
    return report.trajectorySamples.map(sample => {
      const svgX = Math.max(12, Math.min(288, 150 + sample.position[0] * 11));
      const svgY = Math.max(12, Math.min(188, 100 + sample.position[2] * 8));
      const ratio = Math.min(1.0, sample.doseRateMsvPerHour / maxRate);
      const color =
        ratio > 0.66 ? '#EF4444' : ratio > 0.25 ? '#F59E0B' : '#10B981';
      return {
        svgX,
        svgY,
        color,
        doseRate: sample.doseRateMsvPerHour,
        timeSec: sample.timestampSec
      };
    });
  }, [report]);

  if (!isOpen) return null;

  const handleDownloadJson = () => {
    const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `AAR_Scenario_${report.scenarioId}_${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleDownloadCsv = () => {
    const csv = exportAARReportToCSV(report);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `AAR_Trajectory_S${report.scenarioId}_${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#0B1117]/80 backdrop-blur-md p-4 pointer-events-auto">
      <div className="w-full max-w-4xl alara-glass-elevated rounded-xl overflow-hidden text-[#F1F5F9] font-sans">
        {/* Шапка AAR */}
        <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5 border-b border-[rgba(148,163,184,0.16)]">
          <div>
            <div className="text-[11px] font-mono uppercase tracking-wider text-[#0EA5E9]">
              Разбор действий (After Action Review · ГОСТ / ОСПОРБ-99)
            </div>
            <h2 className="text-lg font-bold text-[#F1F5F9] mt-0.5">{report.scenarioTitle}</h2>
          </div>
          <div className="flex items-center gap-2">
            {onExportPdf && (
              <button
                onClick={onExportPdf}
                className="px-3 py-1.5 text-xs font-mono bg-[#0EA5E9]/15 hover:bg-[#0EA5E9]/25 text-[#0EA5E9] border border-[#0EA5E9]/35 rounded-[10px] transition cursor-pointer"
              >
                PDF
              </button>
            )}
            <button
              onClick={handleDownloadCsv}
              className="px-3 py-1.5 text-xs font-mono bg-[#10B981]/15 hover:bg-[#10B981]/25 text-[#10B981] border border-[#10B981]/35 rounded-[10px] transition cursor-pointer"
            >
              CSV
            </button>
            <button
              onClick={handleDownloadJson}
              className="px-3 py-1.5 text-xs font-mono bg-[#14B8A6]/15 hover:bg-[#14B8A6]/25 text-[#14B8A6] border border-[#14B8A6]/35 rounded-[10px] transition cursor-pointer"
            >
              JSON
            </button>
            <button
              onClick={onClose}
              className="px-3 py-1.5 text-xs font-mono bg-white/10 hover:bg-white/15 text-[#F1F5F9] rounded-[10px] transition cursor-pointer"
            >
              Закрыть [ESC]
            </button>
          </div>
        </div>

        <div className="p-5 grid grid-cols-1 md:grid-cols-12 gap-4 max-h-[80vh] overflow-y-auto">
          {/* Левая колонка */}
          <div className="md:col-span-7 space-y-4">
            <div className="p-4 rounded-xl alara-surface flex items-center justify-between">
              <div>
                <div className="text-xs text-[#94A3B8]">Итоговая аттестация курсанта</div>
                <div
                  className={`text-sm font-bold mt-1 ${
                    report.scoreBreakdown.passedCertification ? 'text-[#10B981]' : 'text-[#EF4444]'
                  }`}
                >
                  {report.scoreBreakdown.gradeRu}
                </div>
              </div>
              <div className="text-right">
                <div className="text-3xl font-mono alara-tabular font-bold text-[#0EA5E9]">
                  {report.scoreBreakdown.totalScore}
                  <span className="text-sm text-[#64748B]">/100</span>
                </div>
                <div className="text-[10px] font-mono text-[#94A3B8]">ИНДЕКС ALARA</div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2.5 text-xs font-mono alara-tabular">
              <div className="p-3 rounded-[10px] alara-surface">
                <div className="text-[#94A3B8]">1. ЗАЩИТА ВРЕМЕНЕМ</div>
                <div className="text-base font-bold text-[#F1F5F9] mt-1">
                  {report.scoreBreakdown.timeEfficiencyScore} / 25
                </div>
                <div className="text-[11px] text-[#94A3B8] mt-0.5">
                  <span className="text-[#0EA5E9] font-bold">{report.missionDurationSec} с</span> / норма {report.targetDurationSec} с
                </div>
              </div>
              <div className="p-3 rounded-[10px] alara-surface">
                <div className="text-[#94A3B8]">2. ЗАЩИТА РАССТОЯНИЕМ</div>
                <div className="text-base font-bold text-[#F1F5F9] mt-1">
                  {report.scoreBreakdown.distanceOptimizationScore} / 25
                </div>
                <div className="text-[11px] text-[#94A3B8] mt-0.5">
                  Доза: {report.finalAccumulatedDoseMsv.toFixed(3)} / {report.doseLimitMsv.toFixed(2)} мЗв
                </div>
                {report.doseResetCount > 0 && (
                  <div className="text-[10px] text-[#EF4444] font-bold mt-0.5">
                    Сбросов по переоблучению: {report.doseResetCount}
                  </div>
                )}
              </div>
              <div className="p-3 rounded-[10px] alara-surface">
                <div className="text-[#94A3B8]">3. ЭКРАНИРОВАНИЕ B(μx)</div>
                <div className="text-base font-bold text-[#F1F5F9] mt-1">
                  {report.scoreBreakdown.shieldingUsageScore} / 25
                </div>
                <div className="text-[11px] text-[#94A3B8] mt-0.5">
                  Пик МЭД: {report.peakDoseRateMsvPerHour.toFixed(2)} мЗв/ч
                </div>
              </div>
              <div className="p-3 rounded-[10px] alara-surface">
                <div className="text-[#94A3B8]">4. РЕГЛАМЕНТ СИЗ И ТБ</div>
                <div className="text-base font-bold text-[#F1F5F9] mt-1">
                  {report.scoreBreakdown.ppeComplianceScore} / 25
                </div>
                <div className="text-[11px] text-[#94A3B8] mt-0.5">
                  Допуск СИЗ: {report.ppeChecklistPassedAtEntry ? 'ПРОЙДЕН' : 'НАРУШЕН'}
                </div>
              </div>
            </div>

            {report.doseResetCount > 0 && (
              <div className="p-3 rounded-[10px] bg-[#EF4444]/12 border border-[#EF4444]/35 text-[#F1F5F9] text-xs font-mono flex items-start gap-2.5">
                <AlertTriangle className="w-4 h-4 text-[#EF4444] shrink-0 mt-0.5" />
                <div>
                  <div className="font-bold text-[#EF4444] uppercase">
                    Аварийный сброс по переоблучению
                  </div>
                  <div className="mt-0.5 text-[11px] text-[#94A3B8] leading-relaxed font-sans">
                    Зафиксировано <strong className="text-[#F1F5F9]">{report.doseResetCount}</strong> сброс(ов) по превышению предела дозы (НРБ-99/2009).
                  </div>
                </div>
              </div>
            )}

            <div className="p-3.5 rounded-xl alara-surface">
              <div className="text-xs font-mono uppercase text-[#94A3B8] mb-2">
                Журнал регламента безопасности ({report.violations.length})
              </div>
              {report.violations.length === 0 ? (
                <div className="text-xs text-[#10B981] font-mono">
                  Нарушений регламента ОСПОРБ-99/2010 не зафиксировано.
                </div>
              ) : (
                <div className="space-y-1.5 max-h-36 overflow-y-auto pr-1">
                  {report.violations.map(v => (
                    <div
                      key={v.id}
                      className="text-xs p-2 rounded-[10px] bg-[#EF4444]/10 border border-[#EF4444]/30 flex items-start justify-between gap-2"
                    >
                      <div>
                        <span className="font-mono text-[#EF4444] font-semibold">[{v.code}]</span>{' '}
                        <span className="text-[#F1F5F9]">{v.descriptionRu}</span>
                      </div>
                      <span className="font-mono alara-tabular text-[#EF4444] shrink-0">-{v.penaltyPoints} б.</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Правая колонка */}
          <div className="md:col-span-5 flex flex-col justify-between space-y-4">
            <div className="p-3.5 rounded-xl alara-surface">
              <div className="flex items-center justify-between text-xs font-mono alara-tabular text-[#94A3B8] mb-2">
                <span>ТЕПЛОВАЯ КАРТА H(r)</span>
                <span>{report.trajectorySamples.length} точек</span>
              </div>
              <svg
                viewBox="0 0 300 200"
                className="w-full h-44 bg-[#0B1117] rounded-[10px] border border-[rgba(148,163,184,0.16)]"
              >
                <line x1="150" y1="0" x2="150" y2="200" stroke="rgba(148,163,184,0.15)" strokeWidth="1" />
                <line x1="0" y1="100" x2="300" y2="100" stroke="rgba(148,163,184,0.15)" strokeWidth="1" />
                <circle
                  cx="150"
                  cy="65"
                  r="22"
                  fill="rgba(239,68,68,0.12)"
                  stroke="rgba(239,68,68,0.45)"
                  strokeDasharray="3 3"
                />
                {heatmapPoints.length > 1 && (
                  <polyline
                    fill="none"
                    stroke="#0EA5E9"
                    strokeWidth="1.5"
                    strokeOpacity="0.65"
                    points={heatmapPoints.map(p => `${p.svgX},${p.svgY}`).join(' ')}
                  />
                )}
                {heatmapPoints.map((pt, idx) => (
                  <circle
                    key={idx}
                    cx={pt.svgX}
                    cy={pt.svgY}
                    r={idx === heatmapPoints.length - 1 ? 4.5 : 2.8}
                    fill={pt.color}
                  />
                ))}
              </svg>
              <div className="flex items-center justify-between text-[10px] font-mono text-[#94A3B8] mt-2">
                <span className="text-[#10B981]">НОРМА (&lt;25%)</span>
                <span className="text-[#F59E0B]">ПОВЫШЕННЫЙ ФОН</span>
                <span className="text-[#EF4444]">ОЧАГ ИИИ</span>
              </div>
            </div>

            <div className="p-3.5 rounded-xl alara-surface space-y-2 text-xs font-mono alara-tabular">
              <div className="text-[#94A3B8] uppercase">Биометрический итог</div>
              <div className="flex justify-between">
                <span className="text-[#94A3B8]">Пиковая ЧСС:</span>
                <span className="text-[#F59E0B] font-bold">{report.peakHeartRateBpm} уд/мин</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[#94A3B8]">Остаток воздуха АСВ-2:</span>
                <span className="text-[#0EA5E9] font-bold">{report.minOxygenReservePercent}%</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[#94A3B8]">Средняя МЭД:</span>
                <span className="text-[#F1F5F9]">{report.averageDoseRateMsvPerHour.toFixed(3)} мЗв/ч</span>
              </div>
            </div>

            {report.mchsMetrics &&
              (report.mchsMetrics.operationsCompleted > 0 ||
                report.mchsMetrics.totalExtractable > 0 ||
                report.mchsMetrics.bareHandViolations > 0) && (
                <div className="p-3.5 rounded-xl alara-surface space-y-1.5 text-xs font-mono alara-tabular">
                  <div className="text-[#0EA5E9] uppercase font-bold">
                    Операции МЧС и САР
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[#94A3B8]">Технологических операций:</span>
                    <span className="text-[#F1F5F9] font-bold">{report.mchsMetrics.operationsCompleted}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[#94A3B8]">Изолировано в САР:</span>
                    <span className="text-[#10B981] font-bold">
                      {report.mchsMetrics.extractedCount} / {report.mchsMetrics.totalExtractable}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[#94A3B8]">Захват щипцами ЦМ-1.5:</span>
                    <span className="text-[#0EA5E9] font-bold">
                      {report.mchsMetrics.tongsCompliantExtractions}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[#94A3B8]">Хват ИИИ без щипцов:</span>
                    <span
                      className={
                        report.mchsMetrics.bareHandViolations > 0
                          ? 'text-[#EF4444] font-bold'
                          : 'text-[#10B981]'
                      }
                    >
                      {report.mchsMetrics.bareHandViolations}
                    </span>
                  </div>
                </div>
              )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default AARAnalytics;
