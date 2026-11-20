/**
 * ALARA-Planner Pro VR — Генератор структурированных PDF-отчетов по дозиметрической телеметрии
 *
 * Формирует многостраничный PDF-протокол (jsPDF + jspdf-autotable) с поддержкой кириллицы (DejaVu Sans / Mono):
 * 1. Паспортные метаданные активного сценария, СИЗ, дистанционного инструмента и нормативов НРБ-99/2009 / ОСПОРБ-99/2010.
 * 2. Сводка достигнутых пределов облучения и пороговых зон за сессию (80%/100% H_limit, T_max, Желтая/Строгая/Красная зоны).
 * 3. Векторные графики D(t) (мощность дозы) и H(t) (накопленная доза с линиями пределов 80% и 100%).
 * 4. Полная хронологическая таблица истории телеметрии радиационной дозы.
 * 5. Журнал голосовых протоколов и зафиксированных нарушений регламента.
 */

import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import dejaVuRegularUrl from '../assets/fonts/DejaVuSans.ttf?url';
import dejaVuBoldUrl from '../assets/fonts/DejaVuSans-Bold.ttf?url';
import dejaVuMonoUrl from '../assets/fonts/DejaVuSansMono.ttf?url';
import {
  ComprehensiveProtectionAnalysis,
  PPELoadoutId,
  PPE_LOADOUTS,
  RemoteToolId,
  REMOTE_TOOLS,
  sanitizeNonNegativeFinite
} from '../physics/gostPhysics';
import type { IScenarioConfig } from '../scene/scenarioConfigRegistry';
import type { ScenarioRulesEvaluationResult } from '../scene/scenarioRulesEngine';
import type { VoiceLogEntry } from '../vr/voiceTaskLogger';
import type { TelemetryHistoryPoint } from '../components/FloatingAnalyticsWindow';
import type { MchsMissionMetrics } from '../scene/EvacuationManager';

export interface ExposureLimitEvent {
  elapsedSec: number;
  code: string;
  labelRu: string;
  measuredValue: string;
  thresholdValue: string;
  severity: 'INFO' | 'WARNING' | 'CRITICAL';
}

export interface SessionExposureLimitsTracker {
  peakProtectedRateMicroSv: number;
  peakProtectedRateAtSec: number | null;
  peakUnshieldedRateMicroSv: number;
  peakCumulativeDoseMsv: number;
  minDistanceM: number | null;
  maxTotalProtectionFactor: number;
  controlledZoneEnteredAtSec: number | null;
  yellowZoneEnteredAtSec: number | null;
  strictZoneEnteredAtSec: number | null;
  redRetreatEnteredAtSec: number | null;
  doseWarn80ReachedAtSec: number | null;
  doseLimit100ReachedAtSec: number | null;
  timeWarn80ReachedAtSec: number | null;
  timeLimit100ReachedAtSec: number | null;
  secondsInControlledZone: number;
  secondsInYellowZone: number;
  secondsInStrictZone: number;
  secondsInRedRetreatZone: number;
  limitEvents: ExposureLimitEvent[];
}

export function createEmptySessionExposureLimitsTracker(): SessionExposureLimitsTracker {
  return {
    peakProtectedRateMicroSv: 0,
    peakProtectedRateAtSec: null,
    peakUnshieldedRateMicroSv: 0,
    peakCumulativeDoseMsv: 0,
    minDistanceM: null,
    maxTotalProtectionFactor: 1.0,
    controlledZoneEnteredAtSec: null,
    yellowZoneEnteredAtSec: null,
    strictZoneEnteredAtSec: null,
    redRetreatEnteredAtSec: null,
    doseWarn80ReachedAtSec: null,
    doseLimit100ReachedAtSec: null,
    timeWarn80ReachedAtSec: null,
    timeLimit100ReachedAtSec: null,
    secondsInControlledZone: 0,
    secondsInYellowZone: 0,
    secondsInStrictZone: 0,
    secondsInRedRetreatZone: 0,
    limitEvents: []
  };
}

export interface ScenarioMetadataSummary {
  id?: number;
  titleRu?: string;
  facilityRu?: string;
  categoryRu?: string;
  shortDescriptionRu?: string;
  dominantIsotopes?: ReadonlyArray<string>;
  recommendedPermitLimitMsv?: number;
}

export interface DoseHistoryPdfReportInput {
  history: ReadonlyArray<TelemetryHistoryPoint>;
  currentAnalysis: ComprehensiveProtectionAnalysis;
  cumulativeDoseMsv: number;
  missionTimeSec: number;
  permitLimitMsv: number;
  selectedPpeId: PPELoadoutId;
  selectedRemoteToolId: RemoteToolId;
  scenarioTitle: string;
  scenarioConfig?: IScenarioConfig;
  scenarioMeta?: ScenarioMetadataSummary;
  rulesEvaluation?: ScenarioRulesEvaluationResult | null;
  voiceLogs?: ReadonlyArray<VoiceLogEntry>;
  doseResetCount?: number;
  sessionLimits?: SessionExposureLimitsTracker | null;
  mchsMetrics?: MchsMissionMetrics;
}

interface CachedFontData {
  regularBase64: string;
  boldBase64: string;
  monoBase64: string;
}

let cachedFontsPromise: Promise<CachedFontData> | null = null;

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

async function fetchFontBase64(url: string): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Не удалось загрузить шрифт PDF: ${url} (${response.status})`);
  }
  const buf = await response.arrayBuffer();
  return arrayBufferToBase64(buf);
}

async function loadDejaVuFonts(): Promise<CachedFontData> {
  if (!cachedFontsPromise) {
    cachedFontsPromise = Promise.all([
      fetchFontBase64(dejaVuRegularUrl),
      fetchFontBase64(dejaVuBoldUrl),
      fetchFontBase64(dejaVuMonoUrl)
    ])
      .then(([regularBase64, boldBase64, monoBase64]) => ({
        regularBase64,
        boldBase64,
        monoBase64
      }))
      .catch(err => {
        cachedFontsPromise = null;
        throw err;
      });
  }
  return cachedFontsPromise;
}

function formatDurationSec(totalSec: number): string {
  const safe = Math.max(0, Math.round(totalSec));
  const mins = Math.floor(safe / 60);
  const secs = safe % 60;
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')} (${totalSec.toFixed(1)} с)`;
}

function formatRate(microSvPerHour: number): string {
  const safe = sanitizeNonNegativeFinite(microSvPerHour, 0);
  if (safe >= 1000) {
    return `${(safe / 1000).toFixed(3)} мЗв/ч (${safe.toFixed(0)} мкЗв/ч)`;
  }
  return `${safe.toFixed(2)} мкЗв/ч`;
}

function getZoneStatusLabel(doseRateMicroSv: number, cumulativeMsv: number, permitLimitMsv: number): string {
  if (cumulativeMsv >= permitLimitMsv && permitLimitMsv > 0) {
    return 'ПРЕВЫШ. H_lim';
  }
  if (doseRateMicroSv >= 8000) {
    return 'КРАСНАЯ (>=8000)';
  }
  if (doseRateMicroSv >= 1000) {
    return 'СТРОГАЯ (>=1000)';
  }
  if (doseRateMicroSv >= 800) {
    return 'ЖЕЛТАЯ (>=800)';
  }
  if (doseRateMicroSv >= 12) {
    return 'КОНТРОЛЬ (>=12)';
  }
  return 'НОРМА';
}

interface ComputedExposureSummary {
  tracker: SessionExposureLimitsTracker;
  avgProtectedRateMicroSv: number;
  avgUnshieldedRateMicroSv: number;
  avgTotalProtectionFactor: number;
  finalDoseMsv: number;
  effectivePermitLimitMsv: number;
  doseRatioPercent: number;
  tMaxSec: number;
  timeRatioPercent: number;
  peakDoseRatioPercent: number;
  doseResetCount: number;
}

function mergeExposureSummary(input: DoseHistoryPdfReportInput): ComputedExposureSummary {
  const {
    history,
    currentAnalysis,
    cumulativeDoseMsv,
    missionTimeSec,
    permitLimitMsv,
    scenarioConfig,
    rulesEvaluation,
    doseResetCount = 0,
    sessionLimits
  } = input;

  const tracker: SessionExposureLimitsTracker = sessionLimits
    ? {
        ...sessionLimits,
        limitEvents: [...sessionLimits.limitEvents]
      }
    : createEmptySessionExposureLimitsTracker();

  const effectivePermitLimitMsv = Math.max(0.001, sanitizeNonNegativeFinite(permitLimitMsv, scenarioConfig?.hLimitMsv ?? 0.1));
  const tMaxSec = Math.max(1, scenarioConfig?.tMaxSec ?? 300);
  const warnRatio = scenarioConfig?.warningThresholdRatio ?? 0.8;

  let sumProtected = 0;
  let sumUnshielded = 0;
  let sumKProt = 0;

  const addEventIfMissing = (ev: ExposureLimitEvent) => {
    if (!tracker.limitEvents.some(existing => existing.code === ev.code)) {
      tracker.limitEvents.push(ev);
    }
  };

  for (let i = 0; i < history.length; i++) {
    const pt = history[i];
    const dtStep =
      i > 0
        ? Math.max(0.1, Math.min(2.0, pt.elapsedSec - history[i - 1].elapsedSec))
        : 0.5;
    const rate = sanitizeNonNegativeFinite(pt.doseRateMicroSv, 0);
    const unshielded = sanitizeNonNegativeFinite(pt.unshieldedDoseRateMicroSv, rate);
    const accum = sanitizeNonNegativeFinite(pt.cumulativeDoseMsv, 0);
    const dist = sanitizeNonNegativeFinite(pt.distanceM, currentAnalysis.baseDistanceM);
    const kProt = Math.max(1.0, sanitizeNonNegativeFinite(pt.kProtTotal, 1.0));
    const ptLimit = Math.max(0.001, sanitizeNonNegativeFinite(pt.permitLimitMsv, effectivePermitLimitMsv));

    sumProtected += rate;
    sumUnshielded += unshielded;
    sumKProt += kProt;

    if (rate > tracker.peakProtectedRateMicroSv) {
      tracker.peakProtectedRateMicroSv = rate;
      tracker.peakProtectedRateAtSec = pt.elapsedSec;
    }
    if (unshielded > tracker.peakUnshieldedRateMicroSv) {
      tracker.peakUnshieldedRateMicroSv = unshielded;
    }
    if (accum > tracker.peakCumulativeDoseMsv) {
      tracker.peakCumulativeDoseMsv = accum;
    }
    if (tracker.minDistanceM === null || dist < tracker.minDistanceM) {
      tracker.minDistanceM = dist;
    }
    if (kProt > tracker.maxTotalProtectionFactor) {
      tracker.maxTotalProtectionFactor = kProt;
    }

    if (rate >= 12) {
      if (!sessionLimits) tracker.secondsInControlledZone += dtStep;
      if (tracker.controlledZoneEnteredAtSec === null) {
        tracker.controlledZoneEnteredAtSec = pt.elapsedSec;
        addEventIfMissing({
          elapsedSec: pt.elapsedSec,
          code: 'ZONE_CONTROLLED_12',
          labelRu: 'Вход в зону контролируемого доступа (>= 12 мкЗв/ч)',
          measuredValue: formatRate(rate),
          thresholdValue: '12.0 мкЗв/ч',
          severity: 'INFO'
        });
      }
    }
    if (rate >= 800) {
      if (!sessionLimits) tracker.secondsInYellowZone += dtStep;
      if (tracker.yellowZoneEnteredAtSec === null) {
        tracker.yellowZoneEnteredAtSec = pt.elapsedSec;
        addEventIfMissing({
          elapsedSec: pt.elapsedSec,
          code: 'ZONE_YELLOW_800',
          labelRu: 'Порог оперативной Желтой зоны МЭД (>= 800 мкЗв/ч)',
          measuredValue: formatRate(rate),
          thresholdValue: '800 мкЗв/ч (0.80 мЗв/ч)',
          severity: 'WARNING'
        });
      }
    }
    if (rate >= 1000) {
      if (!sessionLimits) tracker.secondsInStrictZone += dtStep;
      if (tracker.strictZoneEnteredAtSec === null) {
        tracker.strictZoneEnteredAtSec = pt.elapsedSec;
        addEventIfMissing({
          elapsedSec: pt.elapsedSec,
          code: 'ZONE_STRICT_1000',
          labelRu: 'Вход в зону строгого режима ОСПОРБ-99 (>= 1.0 мЗв/ч)',
          measuredValue: formatRate(rate),
          thresholdValue: '1000 мкЗв/ч (1.00 мЗв/ч)',
          severity: 'WARNING'
        });
      }
    }
    if (rate >= 8000) {
      if (!sessionLimits) tracker.secondsInRedRetreatZone += dtStep;
      if (tracker.redRetreatEnteredAtSec === null) {
        tracker.redRetreatEnteredAtSec = pt.elapsedSec;
        addEventIfMissing({
          elapsedSec: pt.elapsedSec,
          code: 'ZONE_RED_RETREAT_8000',
          labelRu: 'Красная зона экстренного отступления (>= 8.0 мЗв/ч)',
          measuredValue: formatRate(rate),
          thresholdValue: '8000 мкЗв/ч (8.00 мЗв/ч)',
          severity: 'CRITICAL'
        });
      }
    }
    if (accum >= ptLimit * warnRatio && tracker.doseWarn80ReachedAtSec === null) {
      tracker.doseWarn80ReachedAtSec = pt.elapsedSec;
      addEventIfMissing({
        elapsedSec: pt.elapsedSec,
        code: 'DOSE_WARN_80',
        labelRu: `Достигнут предупредительный порог ${(warnRatio * 100).toFixed(0)}% H_limit`,
        measuredValue: `${(accum * 1000).toFixed(1)} мкЗв`,
        thresholdValue: `${(ptLimit * warnRatio * 1000).toFixed(1)} мкЗв`,
        severity: 'WARNING'
      });
    }
    if (accum >= ptLimit && tracker.doseLimit100ReachedAtSec === null) {
      tracker.doseLimit100ReachedAtSec = pt.elapsedSec;
      addEventIfMissing({
        elapsedSec: pt.elapsedSec,
        code: 'DOSE_LIMIT_100',
        labelRu: 'Превышен предел индивидуальной дозы по наряду-допуску (100% H_limit)',
        measuredValue: `${(accum * 1000).toFixed(1)} мкЗв`,
        thresholdValue: `${(ptLimit * 1000).toFixed(1)} мкЗв`,
        severity: 'CRITICAL'
      });
    }
    if (pt.elapsedSec >= tMaxSec * warnRatio && tracker.timeWarn80ReachedAtSec === null) {
      tracker.timeWarn80ReachedAtSec = pt.elapsedSec;
      addEventIfMissing({
        elapsedSec: pt.elapsedSec,
        code: 'TIME_WARN_80',
        labelRu: `Достигнуто ${(warnRatio * 100).toFixed(0)}% норматива времени T_max`,
        measuredValue: `${pt.elapsedSec.toFixed(1)} с`,
        thresholdValue: `${(tMaxSec * warnRatio).toFixed(0)} с`,
        severity: 'WARNING'
      });
    }
    if (pt.elapsedSec >= tMaxSec && tracker.timeLimit100ReachedAtSec === null) {
      tracker.timeLimit100ReachedAtSec = pt.elapsedSec;
      addEventIfMissing({
        elapsedSec: pt.elapsedSec,
        code: 'TIME_LIMIT_100',
        labelRu: 'Превышен норматив времени пребывания в зоне T_max',
        measuredValue: `${pt.elapsedSec.toFixed(1)} с`,
        thresholdValue: `${tMaxSec} с`,
        severity: 'CRITICAL'
      });
    }
  }

  // Сверка с текущим мгновенным состоянием
  const liveRate = sanitizeNonNegativeFinite(currentAnalysis.finalProtectedDoseRateMicroSv, 0);
  const liveUnshielded = sanitizeNonNegativeFinite(currentAnalysis.unshieldedBaseDoseRateMicroSv, liveRate);
  const finalDoseMsv = sanitizeNonNegativeFinite(cumulativeDoseMsv, 0);

  if (liveRate > tracker.peakProtectedRateMicroSv) {
    tracker.peakProtectedRateMicroSv = liveRate;
    tracker.peakProtectedRateAtSec = missionTimeSec;
  }
  if (liveUnshielded > tracker.peakUnshieldedRateMicroSv) {
    tracker.peakUnshieldedRateMicroSv = liveUnshielded;
  }
  if (finalDoseMsv > tracker.peakCumulativeDoseMsv) {
    tracker.peakCumulativeDoseMsv = finalDoseMsv;
  }
  if (tracker.minDistanceM === null || currentAnalysis.baseDistanceM < tracker.minDistanceM) {
    tracker.minDistanceM = sanitizeNonNegativeFinite(currentAnalysis.baseDistanceM, 0);
  }
  if (currentAnalysis.kProtTotal > tracker.maxTotalProtectionFactor) {
    tracker.maxTotalProtectionFactor = currentAnalysis.kProtTotal;
  }

  if (finalDoseMsv >= effectivePermitLimitMsv * warnRatio && tracker.doseWarn80ReachedAtSec === null) {
    tracker.doseWarn80ReachedAtSec = missionTimeSec;
  }
  if (finalDoseMsv >= effectivePermitLimitMsv && tracker.doseLimit100ReachedAtSec === null) {
    tracker.doseLimit100ReachedAtSec = missionTimeSec;
  }
  if (missionTimeSec >= tMaxSec * warnRatio && tracker.timeWarn80ReachedAtSec === null) {
    tracker.timeWarn80ReachedAtSec = missionTimeSec;
  }
  if (missionTimeSec >= tMaxSec && tracker.timeLimit100ReachedAtSec === null) {
    tracker.timeLimit100ReachedAtSec = missionTimeSec;
  }
  if (rulesEvaluation?.zoneAlertLevel === 'red_retreat' && tracker.redRetreatEnteredAtSec === null) {
    tracker.redRetreatEnteredAtSec = missionTimeSec;
  }
  if (rulesEvaluation?.failState) {
    addEventIfMissing({
      elapsedSec: rulesEvaluation.failState.failedAtSec,
      code: rulesEvaluation.failState.failCode,
      labelRu: rulesEvaluation.failState.titleRu,
      measuredValue: `${(rulesEvaluation.failState.finalDoseMsv * 1000).toFixed(1)} мкЗв`,
      thresholdValue: `${(rulesEvaluation.failState.hLimitMsv * 1000).toFixed(0)} мкЗв`,
      severity: 'CRITICAL'
    });
  }

  tracker.limitEvents.sort((a, b) => a.elapsedSec - b.elapsedSec);

  const n = Math.max(1, history.length);
  const avgProtectedRateMicroSv = history.length > 0 ? sumProtected / n : liveRate;
  const avgUnshieldedRateMicroSv = history.length > 0 ? sumUnshielded / n : liveUnshielded;
  const avgTotalProtectionFactor = history.length > 0 ? sumKProt / n : Math.max(1, currentAnalysis.kProtTotal);

  return {
    tracker,
    avgProtectedRateMicroSv,
    avgUnshieldedRateMicroSv,
    avgTotalProtectionFactor,
    finalDoseMsv,
    effectivePermitLimitMsv,
    doseRatioPercent: (finalDoseMsv / effectivePermitLimitMsv) * 100,
    peakDoseRatioPercent: (tracker.peakCumulativeDoseMsv / effectivePermitLimitMsv) * 100,
    tMaxSec,
    timeRatioPercent: (missionTimeSec / tMaxSec) * 100,
    doseResetCount
  };
}

function drawVectorChart(
  doc: jsPDF,
  opts: {
    x: number;
    y: number;
    w: number;
    h: number;
    title: string;
    series: Array<{ label: string; color: [number, number, number]; values: number[]; dashed?: boolean }>;
    referenceLines?: Array<{ label: string; value: number; color: [number, number, number] }>;
    xLabels: string[];
    yUnit: string;
    minMaxOverride?: number;
  }
): void {
  const { x, y, w, h, title, series, referenceLines = [], xLabels, yUnit, minMaxOverride } = opts;

  // Контейнер карточки графика
  doc.setFillColor(248, 250, 252);
  doc.setDrawColor(203, 213, 225);
  doc.setLineWidth(0.3);
  doc.roundedRect(x, y, w, h, 2, 2, 'FD');

  doc.setFont('DejaVuSans', 'bold');
  doc.setFontSize(8.5);
  doc.setTextColor(15, 23, 42);
  doc.text(title, x + 3, y + 5.2);

  const plotX = x + 13;
  const plotY = y + 9;
  const plotW = w - 16;
  const plotH = h - 18;

  let maxVal = minMaxOverride ?? 0;
  for (const s of series) {
    for (const v of s.values) {
      if (Number.isFinite(v) && v > maxVal) maxVal = v;
    }
  }
  for (const r of referenceLines) {
    if (Number.isFinite(r.value) && r.value > maxVal) maxVal = r.value;
  }
  if (maxVal <= 0) maxVal = 1;
  maxVal *= 1.12;

  // Сетка по Y
  doc.setDrawColor(226, 232, 240);
  doc.setLineWidth(0.2);
  doc.setFont('DejaVuSansMono', 'normal');
  doc.setFontSize(6.2);
  doc.setTextColor(100, 116, 139);

  for (let i = 0; i <= 4; i++) {
    const frac = i / 4;
    const gy = plotY + plotH - frac * plotH;
    doc.line(plotX, gy, plotX + plotW, gy);
    const val = maxVal * frac;
    const valStr = val >= 100 ? val.toFixed(0) : val >= 1 ? val.toFixed(1) : val.toFixed(3);
    doc.text(valStr, plotX - 1.5, gy + 1.2, { align: 'right' });
  }

  // Оси
  doc.setDrawColor(148, 163, 184);
  doc.setLineWidth(0.35);
  doc.line(plotX, plotY, plotX, plotY + plotH);
  doc.line(plotX, plotY + plotH, plotX + plotW, plotY + plotH);

  // Референсные линии порогов
  for (const ref of referenceLines) {
    if (ref.value <= 0 || ref.value > maxVal) continue;
    const ry = plotY + plotH - (ref.value / maxVal) * plotH;
    doc.setDrawColor(...ref.color);
    doc.setLineWidth(0.4);
    doc.setLineDashPattern([1.5, 1.2], 0);
    doc.line(plotX, ry, plotX + plotW, ry);
    doc.setLineDashPattern([], 0);
    doc.setFont('DejaVuSans', 'bold');
    doc.setFontSize(5.8);
    doc.setTextColor(...ref.color);
    doc.text(ref.label, plotX + plotW - 1, ry - 1, { align: 'right' });
  }

  // Линии графиков
  for (const s of series) {
    if (s.values.length === 0) continue;
    doc.setDrawColor(...s.color);
    doc.setLineWidth(s.dashed ? 0.45 : 0.65);
    if (s.dashed) {
      doc.setLineDashPattern([1.2, 1.2], 0);
    } else {
      doc.setLineDashPattern([], 0);
    }

    const pts = s.values.map((v, idx) => {
      const px =
        s.values.length === 1 ? plotX + plotW / 2 : plotX + (idx / (s.values.length - 1)) * plotW;
      const py = plotY + plotH - (Math.max(0, v) / maxVal) * plotH;
      return { x: px, y: py };
    });

    if (pts.length === 1) {
      doc.setFillColor(...s.color);
      doc.circle(pts[0].x, pts[0].y, 0.9, 'F');
    } else {
      for (let i = 1; i < pts.length; i++) {
        doc.line(pts[i - 1].x, pts[i - 1].y, pts[i].x, pts[i].y);
      }
    }
    doc.setLineDashPattern([], 0);
  }

  // Подписи оси X (начало, середина, конец) и легенда
  doc.setFont('DejaVuSansMono', 'normal');
  doc.setFontSize(6.0);
  doc.setTextColor(71, 85, 105);
  if (xLabels.length > 0) {
    doc.text(xLabels[0], plotX, plotY + plotH + 3.4);
    if (xLabels.length > 2) {
      const midIdx = Math.floor(xLabels.length / 2);
      doc.text(xLabels[midIdx], plotX + plotW / 2, plotY + plotH + 3.4, { align: 'center' });
    }
    if (xLabels.length > 1) {
      doc.text(xLabels[xLabels.length - 1], plotX + plotW, plotY + plotH + 3.4, { align: 'right' });
    }
  }
  doc.text(yUnit, x + 2.5, plotY + 2.2);

  // Легенда внизу справа
  let legendX = x + 3;
  const legendY = y + h - 2.2;
  doc.setFont('DejaVuSans', 'normal');
  doc.setFontSize(6.2);
  for (const s of series) {
    doc.setFillColor(...s.color);
    doc.rect(legendX, legendY - 1.8, 3.2, 1.4, 'F');
    doc.setTextColor(51, 65, 85);
    doc.text(s.label, legendX + 4.2, legendY);
    legendX += doc.getTextWidth(s.label) + 9;
  }
}

function getLastTableFinalY(doc: jsPDF, fallbackY: number): number {
  const internal = doc as unknown as { lastAutoTable?: { finalY?: number } };
  return typeof internal.lastAutoTable?.finalY === 'number' ? internal.lastAutoTable.finalY : fallbackY;
}

/**
 * Генерирует и запускает скачивание структурированного PDF-отчета по телеметрии доз
 */
export async function exportDoseHistoryPdfReport(
  input: DoseHistoryPdfReportInput
): Promise<{ fileName: string; rowCount: number }> {
  const fonts = await loadDejaVuFonts();
  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4',
    compress: true
  });

  // Регистрация Unicode-шрифтов с поддержкой кириллицы
  doc.addFileToVFS('DejaVuSans.ttf', fonts.regularBase64);
  doc.addFont('DejaVuSans.ttf', 'DejaVuSans', 'normal');
  doc.addFileToVFS('DejaVuSans-Bold.ttf', fonts.boldBase64);
  doc.addFont('DejaVuSans-Bold.ttf', 'DejaVuSans', 'bold');
  doc.addFileToVFS('DejaVuSansMono.ttf', fonts.monoBase64);
  doc.addFont('DejaVuSansMono.ttf', 'DejaVuSansMono', 'normal');
  doc.setFont('DejaVuSans', 'normal');

  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const marginX = 12;
  const contentW = pageWidth - marginX * 2;

  const summary = mergeExposureSummary(input);
  const { tracker } = summary;
  const {
    history,
    currentAnalysis,
    missionTimeSec,
    selectedPpeId,
    selectedRemoteToolId,
    scenarioTitle,
    scenarioConfig,
    scenarioMeta,
    rulesEvaluation,
    voiceLogs = []
  } = input;

  const generatedNow = new Date();
  const generatedRu = generatedNow.toLocaleString('ru-RU', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });

  const scenarioId = scenarioConfig?.scenarioId ?? scenarioMeta?.id ?? 0;
  const resolvedTitle = scenarioConfig?.titleRu || scenarioMeta?.titleRu || scenarioTitle;
  const resolvedFacility = scenarioConfig?.facilityRu || scenarioMeta?.facilityRu || 'Объект радиационного контроля';
  const resolvedIsotopes =
    scenarioConfig?.isotopes?.join(', ') ||
    scenarioMeta?.dominantIsotopes?.join(', ') ||
    'Смешанный спектр (α, β, γ, n)';
  const ppeDef = PPE_LOADOUTS[selectedPpeId];
  const toolDef = REMOTE_TOOLS[selectedRemoteToolId];

  // Подготовка массива строк телеметрии (если буфер пуст — добавляем контрольную строку текущего состояния)
  const effectiveRows: TelemetryHistoryPoint[] =
    history.length > 0
      ? [...history]
      : [
          {
            timestampIso: generatedNow.toISOString(),
            timeLabel: `${missionTimeSec.toFixed(1)}с`,
            elapsedSec: sanitizeNonNegativeFinite(missionTimeSec, 0),
            doseRateMicroSv: sanitizeNonNegativeFinite(currentAnalysis.finalProtectedDoseRateMicroSv, 0),
            unshieldedDoseRateMicroSv: sanitizeNonNegativeFinite(currentAnalysis.unshieldedBaseDoseRateMicroSv, 0),
            cumulativeDoseMsv: summary.finalDoseMsv,
            simpsonCumulativeDoseMsv: summary.finalDoseMsv,
            convergenceErrorPercent: 0,
            permitLimitMsv: summary.effectivePermitLimitMsv,
            distanceM: sanitizeNonNegativeFinite(currentAnalysis.baseDistanceM, 0),
            effectiveDistanceM: sanitizeNonNegativeFinite(currentAnalysis.effectiveDistanceM, 0),
            attenuationFactor: sanitizeNonNegativeFinite(currentAnalysis.kProtTotal, 1),
            alphaRate: sanitizeNonNegativeFinite(currentAnalysis.spectralDoseRatesMicroSv.alpha, 0),
            betaRate: sanitizeNonNegativeFinite(currentAnalysis.spectralDoseRatesMicroSv.beta, 0),
            gammaRate: sanitizeNonNegativeFinite(currentAnalysis.spectralDoseRatesMicroSv.gamma, 0),
            neutronRate: sanitizeNonNegativeFinite(currentAnalysis.spectralDoseRatesMicroSv.neutron, 0),
            kDist: sanitizeNonNegativeFinite(currentAnalysis.kDist, 1),
            kShield: sanitizeNonNegativeFinite(currentAnalysis.kShield, 1),
            kPpe: sanitizeNonNegativeFinite(currentAnalysis.kPpe, 1),
            kProtTotal: sanitizeNonNegativeFinite(currentAnalysis.kProtTotal, 1)
          }
        ];

  // ============================================================================
  // ШАПКА ДОКУМЕНТА (HEADER BANNER)
  // ============================================================================
  doc.setFillColor(15, 23, 42); // slate-900
  doc.rect(0, 0, pageWidth, 27, 'F');
  doc.setFillColor(245, 158, 11); // amber-500 accent bar
  doc.rect(0, 27, pageWidth, 1.4, 'F');

  doc.setFont('DejaVuSans', 'bold');
  doc.setFontSize(13);
  doc.setTextColor(255, 255, 255);
  doc.text('ALARA-PLANNER PRO VR — ПРОТОКОЛ ДОЗИМЕТРИЧЕСКОЙ ТЕЛЕМЕТРИИ', marginX, 10.5);

  doc.setFont('DejaVuSans', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(203, 213, 225);
  doc.text(
    'Отчет истории облучения персонала, метаданных сценария и достигнутых пределов безопасности',
    marginX,
    16
  );

  doc.setFont('DejaVuSansMono', 'normal');
  doc.setFontSize(7.2);
  doc.setTextColor(251, 191, 36);
  doc.text(
    `Нормативы: НРБ-99/2009 (СанПиН 2.6.1.2523-09) · ОСПОРБ-99/2010 · ГОСТ Р 8.804-2012   |   Сформирован: ${generatedRu}`,
    marginX,
    22.5
  );

  let cursorY = 33;

  // ============================================================================
  // РАЗДЕЛ 1: МЕТАДАННЫЕ СЦЕНАРИЯ И КОНФИГУРАЦИЯ СРЕДЫ
  // ============================================================================
  doc.setFont('DejaVuSans', 'bold');
  doc.setFontSize(10.5);
  doc.setTextColor(15, 23, 42);
  doc.text('1. Метаданные сценария и параметры радиационной защиты', marginX, cursorY);
  cursorY += 2.5;

  const metadataRows: Array<[string, string, string, string]> = [
    [
      'Сценарий / Код',
      scenarioId > 0 ? `#${scenarioId} · ${scenarioConfig?.codeName || 'SCENARIO'}` : 'Текущая сессия',
      'Длительность сессии',
      `${formatDurationSec(missionTimeSec)} / норм. ${summary.tMaxSec} с (${summary.timeRatioPercent.toFixed(1)}%)`
    ],
    [
      'Наименование задачи',
      resolvedTitle,
      'Контрольный лимит H_limit',
      `${summary.effectivePermitLimitMsv.toFixed(3)} мЗв (${(summary.effectivePermitLimitMsv * 1000).toFixed(0)} мкЗв)`
    ],
    [
      'Объект / Помещение',
      scenarioMeta?.categoryRu ? `${resolvedFacility} (${scenarioMeta.categoryRu})` : resolvedFacility,
      'Доминирующие изотопы',
      resolvedIsotopes
    ],
    [
      'Применённые СИЗ (K_ppe)',
      `${ppeDef.shortNameRu} (K_ppe=${currentAnalysis.kPpe.toFixed(2)}×, Pb=${ppeDef.leadEquivalentMm} мм)`,
      'Дист. инструмент (K_dist)',
      `${toolDef.shortNameRu} (K_dist=${currentAnalysis.kDist.toFixed(2)}×)`
    ],
    [
      'Экранирование (K_shield)',
      `${currentAnalysis.activeShieldMaterialRu} (d=${currentAnalysis.activeShieldThicknessCm.toFixed(1)} см, K=${currentAnalysis.kShield.toFixed(2)}×)`,
      'Записей в телеметрии',
      `${history.length} точек (${voiceLogs.length} голос. записей)`
    ],
    ...(input.mchsMetrics &&
    (input.mchsMetrics.operationsCompleted > 0 ||
      input.mchsMetrics.totalExtractable > 0 ||
      input.mchsMetrics.bareHandViolations > 0)
      ? [
          [
            'Операции МЧС / САР',
            `Операций: ${input.mchsMetrics.operationsCompleted} (дезакт. ${input.mchsMetrics.spillsDecontaminated}, туш. ${input.mchsMetrics.firesExtinguished}, армат. ${input.mchsMetrics.valvesClosed})`,
            'Эвакуация ИИИ (САР)',
            `${input.mchsMetrics.extractedCount}/${input.mchsMetrics.totalExtractable} · Щипцы ЦМ-1.5: ${input.mchsMetrics.tongsCompliantExtractions} · Нарушения: ${input.mchsMetrics.bareHandViolations}`
          ] as [string, string, string, string]
        ]
      : [])
  ];

  autoTable(doc, {
    startY: cursorY,
    margin: { left: marginX, right: marginX },
    theme: 'grid',
    styles: {
      font: 'DejaVuSans',
      fontSize: 7.5,
      cellPadding: 2.0,
      textColor: [30, 41, 59],
      lineColor: [203, 213, 225],
      lineWidth: 0.2
    },
    columnStyles: {
      0: { fontStyle: 'bold', fillColor: [241, 245, 249], cellWidth: 37 },
      1: { cellWidth: 56 },
      2: { fontStyle: 'bold', fillColor: [241, 245, 249], cellWidth: 38 },
      3: { cellWidth: contentW - 131 }
    },
    body: metadataRows
  });

  cursorY = getLastTableFinalY(doc, cursorY + 32) + 6;

  // ============================================================================
  // РАЗДЕЛ 2: СВОДКА ДОСТИГНУТЫХ ПРЕДЕЛОВ ОБЛУЧЕНИЯ И ПОРОГОВЫХ ЗОН
  // ============================================================================
  doc.setFont('DejaVuSans', 'bold');
  doc.setFontSize(10.5);
  doc.setTextColor(15, 23, 42);
  doc.text('2. Сводка достигнутых пределов облучения и пороговых зон за сессию', marginX, cursorY);
  cursorY += 3;

  // 4 KPI карточки
  const cardGap = 3;
  const cardW = (contentW - cardGap * 3) / 4;
  const cardH = 16;

  const isDoseExceeded =
    summary.doseRatioPercent >= 100 || summary.doseResetCount > 0 || tracker.doseLimit100ReachedAtSec !== null;
  const isDoseWarning = !isDoseExceeded && (summary.doseRatioPercent >= 80 || tracker.doseWarn80ReachedAtSec !== null);

  const kpiCards: Array<{
    label: string;
    value: string;
    sub: string;
    accent: [number, number, number];
  }> = [
    {
      label: 'Итоговая доза H_accum',
      value: `${summary.finalDoseMsv.toFixed(4)} мЗв`,
      sub: `${(summary.finalDoseMsv * 1000).toFixed(1)} мкЗв (${summary.doseRatioPercent.toFixed(1)}% H_lim)`,
      accent: isDoseExceeded ? [220, 38, 38] : isDoseWarning ? [217, 119, 6] : [5, 150, 105]
    },
    {
      label: 'Пиковая МЭД D_max',
      value: formatRate(tracker.peakProtectedRateMicroSv),
      sub: `Без защиты D₀: ${formatRate(tracker.peakUnshieldedRateMicroSv)}`,
      accent: tracker.peakProtectedRateMicroSv >= 8000 ? [220, 38, 38] : tracker.peakProtectedRateMicroSv >= 800 ? [217, 119, 6] : [14, 116, 144]
    },
    {
      label: 'Сред. МЭД / Мин. дистанция',
      value: formatRate(summary.avgProtectedRateMicroSv),
      sub: `r_min = ${tracker.minDistanceM !== null ? tracker.minDistanceM.toFixed(2) : '—'} м · K_prot max ${tracker.maxTotalProtectionFactor.toFixed(1)}×`,
      accent: [51, 65, 85]
    },
    {
      label: 'Сбросы / Статус ПТБ',
      value: summary.doseResetCount > 0 || rulesEvaluation?.isFailed ? 'НАРУШЕНИЕ' : isDoseWarning ? 'ПРЕДУПР. 80%' : 'В НОРМЕ',
      sub: `Аварийных сбросов: ${summary.doseResetCount} · Событий порогов: ${tracker.limitEvents.length}`,
      accent: summary.doseResetCount > 0 || rulesEvaluation?.isFailed ? [220, 38, 38] : isDoseWarning ? [217, 119, 6] : [5, 150, 105]
    }
  ];

  kpiCards.forEach((card, idx) => {
    const cx = marginX + idx * (cardW + cardGap);
    doc.setFillColor(248, 250, 252);
    doc.setDrawColor(203, 213, 225);
    doc.setLineWidth(0.25);
    doc.roundedRect(cx, cursorY, cardW, cardH, 1.5, 1.5, 'FD');

    doc.setFillColor(...card.accent);
    doc.rect(cx, cursorY, 1.4, cardH, 'F');

    doc.setFont('DejaVuSans', 'normal');
    doc.setFontSize(6.5);
    doc.setTextColor(100, 116, 139);
    doc.text(card.label, cx + 3, cursorY + 4.3);

    doc.setFont('DejaVuSans', 'bold');
    doc.setFontSize(8.8);
    doc.setTextColor(...card.accent);
    doc.text(card.value, cx + 3, cursorY + 9.5, { maxWidth: cardW - 4.5 });

    doc.setFont('DejaVuSansMono', 'normal');
    doc.setFontSize(5.9);
    doc.setTextColor(71, 85, 105);
    doc.text(card.sub, cx + 3, cursorY + 13.8, { maxWidth: cardW - 4.5 });
  });

  cursorY += cardH + 4;

  // Таблица всех нормативных пределов и пороговых зон
  const warnRatioPct = Math.round((scenarioConfig?.warningThresholdRatio ?? 0.8) * 100);
  const limitRows: Array<[string, string, string, string, string]> = [
    [
      `Предупредительный порог дозы (${warnRatioPct}% H_limit)`,
      `${(summary.effectivePermitLimitMsv * (warnRatioPct / 100) * 1000).toFixed(1)} мкЗв`,
      `${(tracker.peakCumulativeDoseMsv * 1000).toFixed(1)} мкЗв (${summary.peakDoseRatioPercent.toFixed(1)}%)`,
      tracker.doseWarn80ReachedAtSec !== null ? `Достигнут на t=${tracker.doseWarn80ReachedAtSec.toFixed(1)} с` : 'Не достигнут',
      tracker.doseWarn80ReachedAtSec !== null ? 'ДОСТИГНУТ' : 'В НОРМЕ'
    ],
    [
      'Предел дозы по наряду-допуску (100% H_limit)',
      `${(summary.effectivePermitLimitMsv * 1000).toFixed(0)} мкЗв (${summary.effectivePermitLimitMsv.toFixed(3)} мЗв)`,
      `${(tracker.peakCumulativeDoseMsv * 1000).toFixed(1)} мкЗв (сбросов: ${summary.doseResetCount})`,
      tracker.doseLimit100ReachedAtSec !== null ? `Превышен на t=${tracker.doseLimit100ReachedAtSec.toFixed(1)} с` : 'Не превышен',
      tracker.doseLimit100ReachedAtSec !== null || summary.doseResetCount > 0 ? 'ПРЕВЫШЕН' : 'СОБЛЮДЕН'
    ],
    [
      'Зона контролируемого доступа (ОСПОРБ >= 12 мкЗв/ч)',
      '12.0 мкЗв/ч',
      formatRate(tracker.peakProtectedRateMicroSv),
      tracker.controlledZoneEnteredAtSec !== null
        ? `Вход t=${tracker.controlledZoneEnteredAtSec.toFixed(1)} с · в зоне ${tracker.secondsInControlledZone.toFixed(1)} с`
        : 'Не фиксировался',
      tracker.controlledZoneEnteredAtSec !== null ? 'ЗАФИКСИРОВАН' : 'В НОРМЕ'
    ],
    [
      'Желтая зона предупреждения МЭД (>= 800 мкЗв/ч)',
      '800 мкЗв/ч (0.80 мЗв/ч)',
      formatRate(tracker.peakProtectedRateMicroSv),
      tracker.yellowZoneEnteredAtSec !== null
        ? `Вход t=${tracker.yellowZoneEnteredAtSec.toFixed(1)} с · в зоне ${tracker.secondsInYellowZone.toFixed(1)} с`
        : 'Не фиксировался',
      tracker.yellowZoneEnteredAtSec !== null ? 'ДОСТИГНУТ' : 'В НОРМЕ'
    ],
    [
      'Зона строгого режима (ОСПОРБ >= 1000 мкЗв/ч)',
      '1000 мкЗв/ч (1.00 мЗв/ч)',
      formatRate(tracker.peakProtectedRateMicroSv),
      tracker.strictZoneEnteredAtSec !== null
        ? `Вход t=${tracker.strictZoneEnteredAtSec.toFixed(1)} с · в зоне ${tracker.secondsInStrictZone.toFixed(1)} с`
        : 'Не фиксировался',
      tracker.strictZoneEnteredAtSec !== null ? 'ДОСТИГНУТ' : 'В НОРМЕ'
    ],
    [
      'Красная зона экстренного отступления (>= 8000 мкЗв/ч)',
      '8000 мкЗв/ч (8.00 мЗв/ч)',
      formatRate(tracker.peakProtectedRateMicroSv),
      tracker.redRetreatEnteredAtSec !== null
        ? `Тревога t=${tracker.redRetreatEnteredAtSec.toFixed(1)} с · в зоне ${tracker.secondsInRedRetreatZone.toFixed(1)} с`
        : 'Не фиксировался',
      tracker.redRetreatEnteredAtSec !== null ? 'КРИТИЧНО' : 'В НОРМЕ'
    ],
    [
      `Контроль времени операции (${warnRatioPct}% / 100% T_max)`,
      `${Math.round(summary.tMaxSec * (warnRatioPct / 100))} с / ${summary.tMaxSec} с`,
      `${missionTimeSec.toFixed(1)} с (${summary.timeRatioPercent.toFixed(1)}%)`,
      tracker.timeLimit100ReachedAtSec !== null
        ? `Лимит исчерпан на t=${tracker.timeLimit100ReachedAtSec.toFixed(1)} с`
        : tracker.timeWarn80ReachedAtSec !== null
        ? `Порог ${warnRatioPct}% на t=${tracker.timeWarn80ReachedAtSec.toFixed(1)} с`
        : 'В пределах норматива',
      tracker.timeLimit100ReachedAtSec !== null
        ? 'ПРЕВЫШЕН'
        : tracker.timeWarn80ReachedAtSec !== null
        ? 'ДОСТИГНУТ'
        : 'В НОРМЕ'
    ]
  ];

  autoTable(doc, {
    startY: cursorY,
    margin: { left: marginX, right: marginX },
    theme: 'striped',
    headStyles: {
      font: 'DejaVuSans',
      fontStyle: 'bold',
      fontSize: 7.2,
      fillColor: [30, 41, 59],
      textColor: [255, 255, 255]
    },
    styles: {
      font: 'DejaVuSans',
      fontSize: 7.0,
      cellPadding: 1.8,
      textColor: [30, 41, 59]
    },
    columnStyles: {
      0: { cellWidth: 56, fontStyle: 'bold' },
      1: { cellWidth: 32, font: 'DejaVuSansMono' },
      2: { cellWidth: 37, font: 'DejaVuSansMono' },
      3: { cellWidth: 38 },
      4: { cellWidth: contentW - 163, halign: 'center', fontStyle: 'bold' }
    },
    head: [['Предел / Пороговый критерий', 'Норматив', 'Достигнуто за сессию', 'Фиксация по времени', 'Статус']],
    body: limitRows,
    didParseCell: data => {
      if (data.section === 'body' && data.column.index === 4) {
        const val = String(data.cell.raw || '');
        if (val === 'ПРЕВЫШЕН' || val === 'КРИТИЧНО') {
          data.cell.styles.textColor = [185, 28, 28];
          data.cell.styles.fillColor = [254, 226, 226];
        } else if (val === 'ДОСТИГНУТ' || val === 'ЗАФИКСИРОВАН') {
          data.cell.styles.textColor = [180, 83, 9];
          data.cell.styles.fillColor = [254, 243, 199];
        } else {
          data.cell.styles.textColor = [4, 120, 87];
          data.cell.styles.fillColor = [209, 250, 229];
        }
      }
    }
  });

  cursorY = getLastTableFinalY(doc, cursorY + 45) + 5;

  // Хронологический журнал достижения порогов и нарушений (если зафиксированы события)
  if (tracker.limitEvents.length > 0 || rulesEvaluation?.failState) {
    if (cursorY > pageHeight - 55) {
      doc.addPage();
      cursorY = 16;
    }

    doc.setFont('DejaVuSans', 'bold');
    doc.setFontSize(9.5);
    doc.setTextColor(15, 23, 42);
    doc.text('Хронология достижения пороговых пределов и предупреждений', marginX, cursorY);
    cursorY += 2.5;

    autoTable(doc, {
      startY: cursorY,
      margin: { left: marginX, right: marginX },
      theme: 'grid',
      headStyles: {
        font: 'DejaVuSans',
        fontStyle: 'bold',
        fontSize: 7.0,
        fillColor: [51, 65, 85],
        textColor: [255, 255, 255]
      },
      styles: {
        font: 'DejaVuSans',
        fontSize: 6.8,
        cellPadding: 1.6,
        textColor: [30, 41, 59]
      },
      columnStyles: {
        0: { cellWidth: 18, font: 'DejaVuSansMono', halign: 'right' },
        1: { cellWidth: 22, halign: 'center', fontStyle: 'bold' },
        2: { cellWidth: 78 },
        3: { cellWidth: 34, font: 'DejaVuSansMono' },
        4: { cellWidth: contentW - 152, font: 'DejaVuSansMono' }
      },
      head: [['Время t', 'Уровень', 'Пороговое событие', 'Зафиксировано', 'Порог']],
      body: tracker.limitEvents.map(ev => [
        `${ev.elapsedSec.toFixed(1)} с`,
        ev.severity === 'CRITICAL' ? 'КРИТИЧНО' : ev.severity === 'WARNING' ? 'ВНИМАНИЕ' : 'ИНФО',
        ev.labelRu,
        ev.measuredValue,
        ev.thresholdValue
      ]),
      didParseCell: data => {
        if (data.section === 'body' && data.column.index === 1) {
          const val = String(data.cell.raw || '');
          if (val === 'КРИТИЧНО') {
            data.cell.styles.textColor = [185, 28, 28];
          } else if (val === 'ВНИМАНИЕ') {
            data.cell.styles.textColor = [180, 83, 9];
          } else {
            data.cell.styles.textColor = [3, 105, 161];
          }
        }
      }
    });

    cursorY = getLastTableFinalY(doc, cursorY + 25) + 5;
  }

  // ============================================================================
  // РАЗДЕЛ 3: ВЕКТОРНЫЕ ГРАФИКИ D(t) И H(t) С ЛИНИЯМИ ПРЕДЕЛОВ
  // ============================================================================
  if (cursorY > pageHeight - 65) {
    doc.addPage();
    cursorY = 16;
  }

  doc.setFont('DejaVuSans', 'bold');
  doc.setFontSize(10.5);
  doc.setTextColor(15, 23, 42);
  doc.text('3. Динамика мощности дозы D(t) и накопленной дозы H(t)', marginX, cursorY);
  cursorY += 3;

  const chartGap = 4;
  const chartW = (contentW - chartGap) / 2;
  const chartH = 48;
  const xLabels = effectiveRows.map(r => r.timeLabel || `${r.elapsedSec.toFixed(1)}с`);

  drawVectorChart(doc, {
    x: marginX,
    y: cursorY,
    w: chartW,
    h: chartH,
    title: 'D(t) Мощность эквивалентной дозы',
    yUnit: 'мкЗв/ч',
    xLabels,
    series: [
      {
        label: 'D(t) защищ.',
        color: [217, 119, 6],
        values: effectiveRows.map(r => sanitizeNonNegativeFinite(r.doseRateMicroSv, 0))
      },
      {
        label: 'D₀ без экранов',
        color: [148, 163, 184],
        values: effectiveRows.map(r => sanitizeNonNegativeFinite(r.unshieldedDoseRateMicroSv, 0)),
        dashed: true
      }
    ],
    referenceLines: [
      { label: 'Желтая 800', value: 800, color: [217, 119, 6] },
      { label: 'Красная 8000', value: 8000, color: [220, 38, 38] }
    ]
  });

  drawVectorChart(doc, {
    x: marginX + chartW + chartGap,
    y: cursorY,
    w: chartW,
    h: chartH,
    title: 'H(t) Интегральная доза vs Лимит H_limit',
    yUnit: 'мЗв',
    xLabels,
    minMaxOverride: summary.effectivePermitLimitMsv,
    series: [
      {
        label: 'H(t) трапеции',
        color: [2, 132, 199],
        values: effectiveRows.map(r => sanitizeNonNegativeFinite(r.cumulativeDoseMsv, 0))
      },
      {
        label: 'H(t) Симпсон',
        color: [16, 185, 129],
        values: effectiveRows.map(r => sanitizeNonNegativeFinite(r.simpsonCumulativeDoseMsv ?? r.cumulativeDoseMsv, 0)),
        dashed: true
      }
    ],
    referenceLines: [
      {
        label: `${warnRatioPct}% (${(summary.effectivePermitLimitMsv * (warnRatioPct / 100)).toFixed(3)})`,
        value: summary.effectivePermitLimitMsv * (warnRatioPct / 100),
        color: [217, 119, 6]
      },
      {
        label: `100% H_lim (${summary.effectivePermitLimitMsv.toFixed(3)})`,
        value: summary.effectivePermitLimitMsv,
        color: [220, 38, 38]
      }
    ]
  });

  cursorY += chartH + 6;

  // ============================================================================
  // РАЗДЕЛ 4: ХРОНОЛОГИЧЕСКАЯ ТАБЛИЦА ТЕЛЕМЕТРИИ ИСТОРИИ ДОЗ
  // ============================================================================
  if (cursorY > pageHeight - 40) {
    doc.addPage();
    cursorY = 16;
  }

  doc.setFont('DejaVuSans', 'bold');
  doc.setFontSize(10.5);
  doc.setTextColor(15, 23, 42);
  doc.text(
    `4. Хронологическая таблица истории радиационной дозы (${effectiveRows.length} записей)`,
    marginX,
    cursorY
  );
  cursorY += 2.5;

  const telemetryBody = effectiveRows.map((pt, idx) => {
    const rate = sanitizeNonNegativeFinite(pt.doseRateMicroSv, 0);
    const unshielded = sanitizeNonNegativeFinite(pt.unshieldedDoseRateMicroSv, rate);
    const accum = sanitizeNonNegativeFinite(pt.cumulativeDoseMsv, 0);
    const ptLim = Math.max(0.001, sanitizeNonNegativeFinite(pt.permitLimitMsv, summary.effectivePermitLimitMsv));
    const pctLim = (accum / ptLim) * 100;
    const dist = sanitizeNonNegativeFinite(pt.distanceM, 0);
    const kProt = Math.max(1, sanitizeNonNegativeFinite(pt.kProtTotal, 1));
    const spectrumStr = `${sanitizeNonNegativeFinite(pt.alphaRate, 0).toFixed(0)}/${sanitizeNonNegativeFinite(pt.betaRate, 0).toFixed(0)}/${sanitizeNonNegativeFinite(pt.gammaRate, 0).toFixed(0)}/${sanitizeNonNegativeFinite(pt.neutronRate, 0).toFixed(0)}`;
    const zoneLabel = getZoneStatusLabel(rate, accum, ptLim);

    return [
      String(idx + 1),
      pt.elapsedSec.toFixed(1),
      rate.toFixed(2),
      unshielded.toFixed(1),
      accum.toFixed(5),
      `${pctLim.toFixed(1)}%`,
      dist.toFixed(2),
      `${kProt.toFixed(1)}×`,
      spectrumStr,
      zoneLabel
    ];
  });

  autoTable(doc, {
    startY: cursorY,
    margin: { left: marginX, right: marginX, bottom: 14 },
    theme: 'striped',
    showHead: 'everyPage',
    headStyles: {
      font: 'DejaVuSans',
      fontStyle: 'bold',
      fontSize: 6.5,
      fillColor: [15, 23, 42],
      textColor: [255, 255, 255]
    },
    styles: {
      font: 'DejaVuSansMono',
      fontSize: 6.1,
      cellPadding: 1.2,
      textColor: [30, 41, 59]
    },
    columnStyles: {
      0: { cellWidth: 8, halign: 'right' },
      1: { cellWidth: 12, halign: 'right' },
      2: { cellWidth: 20, halign: 'right' },
      3: { cellWidth: 20, halign: 'right' },
      4: { cellWidth: 21, halign: 'right' },
      5: { cellWidth: 14, halign: 'right' },
      6: { cellWidth: 13, halign: 'right' },
      7: { cellWidth: 14, halign: 'right' },
      8: { cellWidth: 34, halign: 'center' },
      9: { cellWidth: contentW - 156, font: 'DejaVuSans', fontStyle: 'bold', halign: 'center' }
    },
    head: [[
      '#',
      't (с)',
      'D_защ (мкЗв/ч)',
      'D₀ (мкЗв/ч)',
      'H (мЗв)',
      '% Lim',
      'r (м)',
      'K_prot',
      'α/β/γ/n (мкЗв/ч)',
      'Статус зоны'
    ]],
    body: telemetryBody,
    didParseCell: data => {
      if (data.section === 'body' && data.column.index === 9) {
        const val = String(data.cell.raw || '');
        if (val.includes('ПРЕВЫШ') || val.includes('КРАСНАЯ')) {
          data.cell.styles.textColor = [185, 28, 28];
          data.cell.styles.fillColor = [254, 226, 226];
        } else if (val.includes('СТРОГАЯ') || val.includes('ЖЕЛТАЯ')) {
          data.cell.styles.textColor = [180, 83, 9];
          data.cell.styles.fillColor = [254, 243, 199];
        } else if (val.includes('КОНТРОЛЬ')) {
          data.cell.styles.textColor = [3, 105, 161];
        } else {
          data.cell.styles.textColor = [4, 120, 87];
        }
      }
    }
  });

  // ============================================================================
  // РАЗДЕЛ 5: ЖУРНАЛ ГОЛОСОВОГО ПРОТОКОЛИРОВАНИЯ (ЕСЛИ ЕСТЬ ЗАПИСИ)
  // ============================================================================
  if (voiceLogs.length > 0) {
    cursorY = getLastTableFinalY(doc, cursorY + 30) + 6;
    if (cursorY > pageHeight - 35) {
      doc.addPage();
      cursorY = 16;
    }

    doc.setFont('DejaVuSans', 'bold');
    doc.setFontSize(10.5);
    doc.setTextColor(15, 23, 42);
    doc.text(`5. Журнал голосовых протоколов замеров (${voiceLogs.length})`, marginX, cursorY);
    cursorY += 2.5;

    autoTable(doc, {
      startY: cursorY,
      margin: { left: marginX, right: marginX, bottom: 14 },
      theme: 'grid',
      headStyles: {
        font: 'DejaVuSans',
        fontStyle: 'bold',
        fontSize: 7.0,
        fillColor: [6, 95, 70],
        textColor: [255, 255, 255]
      },
      styles: {
        font: 'DejaVuSans',
        fontSize: 6.8,
        cellPadding: 1.5,
        textColor: [30, 41, 59]
      },
      columnStyles: {
        0: { cellWidth: 16, font: 'DejaVuSansMono', halign: 'right' },
        1: { cellWidth: 26, fontStyle: 'bold' },
        2: { cellWidth: 28, font: 'DejaVuSansMono', halign: 'right' },
        3: { cellWidth: 38 },
        4: { cellWidth: contentW - 108 }
      },
      head: [['t (с)', 'Локация', 'МЭД (мкЗв/ч)', 'Экранирование', 'Протокольная запись']],
      body: voiceLogs.map(v => [
        `${v.elapsedSec.toFixed(1)} с`,
        v.location,
        v.currentDoseRate.toFixed(1),
        v.activeShielding,
        v.textNote
      ])
    });
  }

  // ============================================================================
  // КОЛОНТИТУЛЫ И НУМЕРАЦИЯ СТРАНИЦ
  // ============================================================================
  const totalPages = doc.getNumberOfPages();
  for (let p = 1; p <= totalPages; p++) {
    doc.setPage(p);
    doc.setDrawColor(203, 213, 225);
    doc.setLineWidth(0.2);
    doc.line(marginX, pageHeight - 10, pageWidth - marginX, pageHeight - 10);

    doc.setFont('DejaVuSans', 'normal');
    doc.setFontSize(7);
    doc.setTextColor(100, 116, 139);
    doc.text(
      `ALARA-Planner Pro VR · Сценарий #${scenarioId || '—'} · Дозиметрический протокол`,
      marginX,
      pageHeight - 5.5
    );
    doc.setFont('DejaVuSansMono', 'normal');
    doc.text(`Страница ${p} из ${totalPages}`, pageWidth - marginX, pageHeight - 5.5, {
      align: 'right'
    });
  }

  const stamp = generatedNow.toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const fileName = `alara_dose_report_S${scenarioId || 'X'}_${stamp}.pdf`;
  doc.save(fileName);
  return { fileName, rowCount: effectiveRows.length };
}
