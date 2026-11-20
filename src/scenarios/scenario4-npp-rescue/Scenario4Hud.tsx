/**
 * Минималистичный 2D HUD и финальный протокол разбора МЧС для Сценария №4 (.glb АЭС)
 * Правило WebGL-совместимости: строго без backdrop-blur-* и без animate-pulse.
 */

import React, { useRef } from 'react';
import { Flame, Users, ShieldAlert, Upload, RotateCcw, CheckCircle2, Award, Timer } from 'lucide-react';
import type { Scenario4HudSnapshot } from './config';

interface Scenario4HudProps {
  snapshot: Scenario4HudSnapshot;
  isHudVisible: boolean;
  onRestart: () => void;
  onSelectCustomGlbFile: (file: File) => void;
}

export const Scenario4Hud: React.FC<Scenario4HudProps> = ({
  snapshot,
  isHudVisible,
  onRestart,
  onSelectCustomGlbFile
}) => {
  const fileInputRef = useRef<HTMLInputElement | null>(null);

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

      {/* Индикатор асинхронной загрузки .glb комплекса АЭС */}
      {snapshot.isLoadingGlb && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-950/85 pointer-events-auto">
          <div className="w-96 max-w-[90vw] p-5 rounded-2xl bg-slate-900 border border-sky-500/40 shadow-2xl space-y-3 text-slate-100">
            <div className="text-xs font-mono text-sky-400 uppercase tracking-wider">
              Сценарий №4 • Инициализация комплекса АЭС (.glb)
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

      {/* Компактная строка задания и оперативных счётчиков Сценария №4 */}
      {isHudVisible && !snapshot.isLoadingGlb && !snapshot.debrief && (
        <div className="fixed top-14 left-3 z-30 pointer-events-none flex flex-col gap-1.5 max-w-[440px]">
          <div className="pointer-events-auto px-3.5 py-2 rounded-xl bg-slate-950/90 border border-slate-700/85 shadow-lg space-y-1.5">
            <div className="flex items-center justify-between gap-3 text-[11px] font-mono">
              <span className="text-sky-300 font-bold">
                ШАГ {snapshot.stepNumber}/{snapshot.totalSteps} · {snapshot.stepTitleRu}
              </span>
              <span className="text-slate-400 flex items-center gap-1">
                <Timer className="w-3 h-3" />
                {timeStr}
              </span>
            </div>

            <div className="text-xs text-slate-100 leading-snug">{snapshot.instructionRu}</div>

            <div className="flex flex-wrap items-center gap-2.5 pt-1 border-t border-slate-800 text-[11px] font-mono">
              <span className="flex items-center gap-1 text-orange-300">
                <Flame className="w-3.5 h-3.5" />
                Очаги: {snapshot.firesExtinguished}/{snapshot.totalFires}
              </span>
              <span className="flex items-center gap-1 text-emerald-300">
                <Users className="w-3.5 h-3.5" />
                Эвакуировано: {snapshot.rescuedCount}/{snapshot.totalNpcCount}
              </span>
              <span
                className={
                  snapshot.extinguisherStatus === 'EMPTY'
                    ? 'text-rose-400 font-bold'
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
                  : `${snapshot.extinguisherChargePct}%`}
              </span>
              {snapshot.usingProceduralFallback && (
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="ml-auto px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-sky-300 border border-slate-700 flex items-center gap-1 cursor-pointer"
                  title="Загрузить локальный .glb-файл комплекса АЭС"
                >
                  <Upload className="w-3 h-3" />
                  <span>.GLB</span>
                </button>
              )}
            </div>
          </div>

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

      {/* Финальный протокол разбора МЧС (Шаг 6) */}
      {snapshot.debrief && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/88 p-4 pointer-events-auto">
          <div className="max-w-xl w-full rounded-2xl bg-slate-900 border border-emerald-500/50 shadow-2xl p-6 space-y-4 text-slate-100">
            <div className="flex items-start justify-between gap-3 border-b border-slate-800 pb-3">
              <div>
                <div className="text-xs font-mono text-emerald-400 uppercase tracking-wider flex items-center gap-1.5">
                  <CheckCircle2 className="w-4 h-4" />
                  Операция МЧС на комплексе АЭС завершена
                </div>
                <h2 className="text-lg font-bold text-white mt-1">
                  Итоговый протокол разбора (Сценарий №4)
                </h2>
              </div>
              <div className="px-3 py-1.5 rounded-xl bg-emerald-500/20 border border-emerald-400/50 text-emerald-300 font-mono text-sm font-bold flex items-center gap-1.5">
                <Award className="w-4 h-4" />
                <span>Класс {snapshot.debrief.grade}</span>
              </div>
            </div>

            <div className="text-xs font-semibold text-emerald-300 bg-emerald-950/40 border border-emerald-500/30 rounded-xl px-3.5 py-2">
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
