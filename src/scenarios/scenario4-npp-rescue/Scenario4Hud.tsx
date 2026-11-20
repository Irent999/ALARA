/**
 * Минималистичный 2D HUD, отладочная панель графа /assembly.glb и итоговый разбор МЧС (Сценарий №4)
 * Правило WebGL-совместимости: строго без backdrop-blur-* и без animate-pulse.
 */

import React, { useRef, useState } from 'react';
import {
  Flame,
  Users,
  ShieldAlert,
  Upload,
  RotateCcw,
  CheckCircle2,
  Award,
  Timer,
  Bug,
  XCircle,
  Crosshair,
  AlertTriangle
} from 'lucide-react';
import type { Scenario4HudSnapshot } from './config';

interface Scenario4HudProps {
  snapshot: Scenario4HudSnapshot;
  isHudVisible: boolean;
  onRestart: () => void;
  onRetryLoadGlb: () => void;
  onFocusModel: () => void;
  onSelectCustomGlbFile: (file: File) => void;
}

export const Scenario4Hud: React.FC<Scenario4HudProps> = ({
  snapshot,
  isHudVisible,
  onRestart,
  onRetryLoadGlb,
  onFocusModel,
  onSelectCustomGlbFile
}) => {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [isInspectorOpen, setIsInspectorOpen] = useState(false);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      onSelectCustomGlbFile(file);
    }
    e.target.value = '';
  };

  const mins = Math.floor(snapshot.elapsedSec / 60);
  const secs = Math.floor(snapshot.elapsedSec % 60);
  const timeStr = `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  const isFailed = snapshot.debrief?.outcome === 'FAILED';

  return (
    <>
      <input
        ref={fileInputRef}
        type="file"
        accept=".glb,.gltf"
        onChange={handleFileChange}
        className="hidden"
      />

      {/* Термическая виньетка при приближении к очагам */}
      {snapshot.thermalHeatLoad01 > 0.06 && (
        <div
          className="pointer-events-none fixed inset-0 z-10 transition-opacity duration-200"
          style={{
            opacity: Math.min(0.85, snapshot.thermalHeatLoad01 * 0.9),
            background:
              'radial-gradient(circle at center, rgba(251,146,60,0) 45%, rgba(234,88,12,0.38) 80%, rgba(185,28,28,0.68) 100%)'
          }}
        />
      )}

      {/* Индикатор асинхронной загрузки /assembly.glb */}
      {snapshot.isLoadingGlb && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-950/88 pointer-events-auto">
          <div className="w-96 max-w-[90vw] p-5 rounded-2xl bg-slate-900 border border-sky-500/40 shadow-2xl space-y-3 text-slate-100">
            <div className="text-xs font-mono text-sky-400 uppercase tracking-wider">
              Сценарий №4 • Загрузка 3D-модели АЭС (.glb)
            </div>
            <div className="text-sm font-semibold">{snapshot.loadStatusRu}</div>
            <div className="w-full h-2.5 rounded-full bg-slate-800 overflow-hidden">
              <div
                className="h-full bg-sky-400 transition-all duration-150"
                style={{ width: `${Math.max(4, Math.min(100, snapshot.loadProgressPct))}%` }}
              />
            </div>
            <div className="text-right text-xs font-mono text-slate-400">
              {Math.round(snapshot.loadProgressPct)}%
            </div>
          </div>
        </div>
      )}

      {/* Явное сообщение об ошибке загрузки /assembly.glb (без подмены процедурной комнатой) */}
      {!snapshot.isLoadingGlb && snapshot.loadErrorRu && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-950/90 p-4 pointer-events-auto">
          <div className="max-w-lg w-full p-5 rounded-2xl bg-slate-900 border border-rose-500/60 shadow-2xl space-y-3.5 text-slate-100">
            <div className="flex items-center gap-2 text-rose-400 text-xs font-mono uppercase tracking-wider font-bold">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              <span>Ошибка загрузки 3D-модели АЭС (/assembly.glb)</span>
            </div>
            <div className="text-sm font-semibold text-white">
              Не удалось загрузить оригинальную модель АЭС через GLTFLoader.
            </div>
            <div className="p-3 rounded-xl bg-rose-950/50 border border-rose-500/40 text-xs font-mono text-rose-200 break-words">
              {snapshot.loadErrorRu}
            </div>
            <div className="text-xs text-slate-300 leading-relaxed">
              Поместите бинарный файл <code className="px-1 py-0.5 rounded bg-slate-800 text-sky-300">assembly.glb</code> в{' '}
              <code className="px-1 py-0.5 rounded bg-slate-800 text-sky-300">public/assembly.glb</code> и нажмите «Повторить», либо откройте локальный файл с диска.
            </div>
            <div className="flex flex-wrap items-center justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={onRetryLoadGlb}
                className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>Повторить</span>
              </button>
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="px-4 py-2 rounded-xl bg-sky-500 hover:bg-sky-400 text-slate-950 text-xs font-bold flex items-center gap-1.5 cursor-pointer"
              >
                <Upload className="w-3.5 h-3.5" />
                <span>Выбрать локальный .glb</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Компактная строка задания, счётчиков и инспектора узлов .glb */}
      {isHudVisible && !snapshot.isLoadingGlb && !snapshot.loadErrorRu && !snapshot.debrief && (
        <div className="fixed top-14 left-3 z-30 pointer-events-none flex flex-col gap-1.5 max-w-[490px]">
          <div className="pointer-events-auto px-3.5 py-2 rounded-xl bg-slate-950/90 border border-slate-700/85 shadow-lg space-y-1.5">
            <div className="flex items-center justify-between gap-3 text-[11px] font-mono">
              <span className="text-sky-300 font-bold">
                ФАЗА {snapshot.stepNumber}/{snapshot.totalSteps} · {snapshot.stepTitleRu}
              </span>
              <span className="text-slate-400 flex items-center gap-1 shrink-0">
                <Timer className="w-3 h-3" />
                {timeStr}
              </span>
            </div>

            <div className="text-xs text-slate-100 leading-snug">{snapshot.instructionRu}</div>

            <div className="flex flex-wrap items-center gap-2 pt-1 border-t border-slate-800 text-[11px] font-mono">
              <span className="flex items-center gap-1 text-orange-300">
                <Flame className="w-3.5 h-3.5" />
                Очаги: {snapshot.firesExtinguished}/{snapshot.totalFires}
              </span>
              <span className="flex items-center gap-1 text-emerald-300">
                <Users className="w-3.5 h-3.5" />
                Эвак.: {snapshot.rescuedCount}/{snapshot.totalNpcCount}
              </span>
              <span
                className={
                  snapshot.extinguisherStatus === 'EMPTY'
                    ? 'text-rose-400 font-bold'
                    : snapshot.extinguisherLifecycleState === 'STOWED'
                    ? 'text-slate-300'
                    : snapshot.extinguisherStatus === 'ARMED'
                    ? 'text-cyan-300'
                    : 'text-amber-300'
                }
              >
                ОУ-5:{' '}
                {snapshot.extinguisherStatus === 'ON_POST'
                  ? 'на посту'
                  : snapshot.extinguisherStatus === 'HELD_LOCKED'
                  ? `${snapshot.extinguisherChargePct}% [чека!]`
                  : snapshot.extinguisherStatus === 'EMPTY'
                  ? 'ПУСТ'
                  : snapshot.extinguisherLifecycleState === 'STOWED'
                  ? `${snapshot.extinguisherChargePct}% (убран)`
                  : `${snapshot.extinguisherChargePct}%`}
              </span>

              <div className="ml-auto flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={onFocusModel}
                  className="px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-emerald-300 border border-slate-700 flex items-center gap-1 cursor-pointer"
                  title="Центрировать камеру на Box3 модели [K]"
                >
                  <Crosshair className="w-3 h-3" />
                  <span>Фокус [K]</span>
                </button>
                <button
                  type="button"
                  onClick={() => setIsInspectorOpen(v => !v)}
                  className="px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 flex items-center gap-1 cursor-pointer"
                  title="Показать диагностику узлов /assembly.glb"
                >
                  <Bug className="w-3 h-3" />
                  <span>Узлы</span>
                </button>
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-sky-300 border border-slate-700 flex items-center gap-1 cursor-pointer"
                  title="Загрузить локальный .glb-файл комплекса АЭС"
                >
                  <Upload className="w-3 h-3" />
                  <span>.GLB</span>
                </button>
              </div>
            </div>

            <div className="text-[10px] font-mono text-slate-400 truncate">
              {snapshot.activeInputLabelRu}
            </div>
          </div>

          {isInspectorOpen && snapshot.inspectionReport && (
            <div className="pointer-events-auto p-3 rounded-xl bg-slate-950/95 border border-slate-700 text-[11px] font-mono text-slate-200 space-y-1.5 shadow-xl max-h-64 overflow-y-auto">
              <div className="flex items-center justify-between text-sky-300 font-bold">
                <span>Инспектор графа АЭС ({snapshot.inspectionReport.sourceKind})</span>
                <span>{snapshot.inspectionReport.boundingBoxSize.join('×')} м</span>
              </div>
              <div className="text-slate-400 break-all">
                Источник: {snapshot.inspectionReport.sourceUrl}
              </div>
              <div className="text-slate-300">
                Box3: до {snapshot.inspectionReport.rawBoundingBoxSize.join('×')} → после{' '}
                {snapshot.inspectionReport.boundingBoxSize.join('×')} м
              </div>
              <div className="text-slate-300">
                Поворот: [{snapshot.inspectionReport.appliedRotationDeg.join('°, ')}°] · Масштаб: ×
                {snapshot.inspectionReport.appliedScale.toFixed(3)} · Настил Y:{' '}
                {snapshot.inspectionReport.deckSurfaceY} м
              </div>
              <div className="text-slate-400">
                Центр Box3: [{snapshot.inspectionReport.boundingBoxCenter.join(', ')}] · Узлов:{' '}
                {snapshot.inspectionReport.totalNodes} · Мешей:{' '}
                {snapshot.inspectionReport.totalMeshes}
              </div>
              {snapshot.inspectionReport.namedNodeCoords.length > 0 && (
                <div className="pt-1 border-t border-slate-800 text-slate-300 space-y-0.5">
                  <div className="text-sky-300 font-bold">
                    Узлы и мировые координаты ({snapshot.inspectionReport.namedNodeCoords.length}):
                  </div>
                  <div className="text-[10px] text-slate-400 space-y-0.5">
                    {snapshot.inspectionReport.namedNodeCoords.slice(0, 16).map((node, idx) => (
                      <div key={idx} className="truncate">
                        • {node.name} [{node.kind}]: [{node.worldPosition.join(', ')}]
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {snapshot.inspectionReport.missingExpectedNodes.length > 0 && (
                <div className="pt-1 border-t border-slate-800 text-amber-300 space-y-0.5">
                  <div className="font-bold">
                    Авто-привязанные зоны ({snapshot.inspectionReport.missingExpectedNodes.length}):
                  </div>
                  {snapshot.inspectionReport.missingExpectedNodes.map((m, idx) => (
                    <div key={idx} className="text-[10px] text-amber-200/90">
                      • {m}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {snapshot.targetPromptRu && (
            <div className="px-3 py-1.5 rounded-lg bg-sky-950/92 border border-sky-400/60 text-xs text-sky-100 font-medium shadow">
              {snapshot.targetPromptRu}
            </div>
          )}

          {snapshot.warningBannerRu && (
            <div className="px-3 py-2 rounded-lg bg-rose-950/95 border border-rose-500 text-xs text-rose-100 font-semibold flex items-center gap-2 shadow-lg">
              <ShieldAlert className="w-4 h-4 text-rose-400 shrink-0" />
              <span>{snapshot.warningBannerRu}</span>
            </div>
          )}
        </div>
      )}

      {/* Финальный протокол разбора МЧС (COMPLETED / FAILED) */}
      {snapshot.debrief && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/88 p-4 pointer-events-auto">
          <div
            className={`max-w-xl w-full rounded-2xl bg-slate-900 border shadow-2xl p-6 space-y-4 text-slate-100 ${
              isFailed ? 'border-rose-500/60' : 'border-emerald-500/50'
            }`}
          >
            <div className="flex items-start justify-between gap-3 border-b border-slate-800 pb-3">
              <div>
                <div
                  className={`text-xs font-mono uppercase tracking-wider flex items-center gap-1.5 ${
                    isFailed ? 'text-rose-400' : 'text-emerald-400'
                  }`}
                >
                  {isFailed ? (
                    <XCircle className="w-4 h-4" />
                  ) : (
                    <CheckCircle2 className="w-4 h-4" />
                  )}
                  {isFailed
                    ? 'Операция МЧС на комплексе АЭС прервана'
                    : 'Операция МЧС на комплексе АЭС завершена'}
                </div>
                <h2 className="text-lg font-bold text-white mt-1">
                  Итоговый протокол разбора (Сценарий №4)
                </h2>
              </div>
              <div
                className={`px-3 py-1.5 rounded-xl border font-mono text-sm font-bold flex items-center gap-1.5 ${
                  isFailed
                    ? 'bg-rose-500/20 border-rose-400/50 text-rose-300'
                    : 'bg-emerald-500/20 border-emerald-400/50 text-emerald-300'
                }`}
              >
                <Award className="w-4 h-4" />
                <span>Класс {snapshot.debrief.grade}</span>
              </div>
            </div>

            <div
              className={`text-xs font-semibold border rounded-xl px-3.5 py-2 ${
                isFailed
                  ? 'text-rose-200 bg-rose-950/40 border-rose-500/40'
                  : 'text-emerald-300 bg-emerald-950/40 border-emerald-500/30'
              }`}
            >
              {snapshot.debrief.gradeLabelRu}
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5 text-xs font-mono">
              <div className="p-3 rounded-xl bg-slate-950 border border-slate-800">
                <div className="text-[10px] text-slate-400">ВРЕМЯ ОПЕРАЦИИ</div>
                <div className="text-base font-bold text-white mt-0.5">{timeStr}</div>
              </div>
              <div className="p-3 rounded-xl bg-slate-950 border border-slate-800">
                <div className="text-[10px] text-slate-400">СПАСЕНО ПЕРСОНАЛА</div>
                <div className="text-base font-bold text-emerald-300 mt-0.5">
                  {snapshot.debrief.rescuedCount} / {snapshot.debrief.totalNpcCount} чел.
                </div>
              </div>
              <div className="p-3 rounded-xl bg-slate-950 border border-slate-800">
                <div className="text-[10px] text-slate-400">ПОТУШЕНО ОЧАГОВ</div>
                <div className="text-base font-bold text-orange-300 mt-0.5">
                  {snapshot.debrief.extinguishedFires} / {snapshot.debrief.totalFires}
                </div>
              </div>
              <div className="p-3 rounded-xl bg-slate-950 border border-slate-800">
                <div className="text-[10px] text-slate-400">ОСТАТОК ОУ-5</div>
                <div className="text-base font-bold text-sky-300 mt-0.5">
                  {snapshot.debrief.remainingExtinguisherPct}% ({snapshot.debrief.cylindersUsed} балл.)
                </div>
              </div>
              <div className="p-3 rounded-xl bg-slate-950 border border-slate-800">
                <div className="text-[10px] text-slate-400">ДОЗА ALARA</div>
                <div className="text-base font-bold text-amber-300 mt-0.5">
                  {(snapshot.debrief.cumulativeDoseMsv * 1000).toFixed(1)} мкЗв
                </div>
              </div>
              <div className="p-3 rounded-xl bg-slate-950 border border-slate-800">
                <div className="text-[10px] text-slate-400">ПИК ТЕПЛОВОЙ НАГР.</div>
                <div className="text-base font-bold text-rose-300 mt-0.5">
                  {snapshot.debrief.peakHeatLoadPct}%
                </div>
              </div>
            </div>

            {snapshot.debrief.safetyErrors.length > 0 ? (
              <div className="p-3 rounded-xl bg-rose-950/35 border border-rose-500/40 text-xs space-y-1">
                <div className="font-bold text-rose-300">
                  Замечания по безопасности ({snapshot.debrief.safetyErrors.length}):
                </div>
                <ul className="list-disc list-inside text-rose-200 space-y-0.5">
                  {snapshot.debrief.safetyErrors.map((err, i) => (
                    <li key={i}>{err}</li>
                  ))}
                </ul>
              </div>
            ) : (
              <div className="p-3 rounded-xl bg-emerald-950/25 border border-emerald-500/30 text-xs text-emerald-200">
                Нарушений правил пожарной и радиационной безопасности МЧС не зафиксировано.
              </div>
            )}

            <div className="flex flex-wrap items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
              >
                <Upload className="w-3.5 h-3.5" />
                <span>Загрузить .glb</span>
              </button>
              <button
                type="button"
                onClick={onRestart}
                className="px-5 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-xs font-bold flex items-center gap-1.5 cursor-pointer"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>Пройти сценарий заново</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
