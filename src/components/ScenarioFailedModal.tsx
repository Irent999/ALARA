import React from 'react';
import { AlertOctagon, AlertTriangle, ArrowLeft, RotateCcw, ShieldAlert } from 'lucide-react';
import { ScenarioFailedState } from '../scene/scenarioRulesEngine';

interface ScenarioFailedModalProps {
  failState: ScenarioFailedState | null;
  isWarning80Active: boolean;
  warning80MessageRu: string | null;
  doseProgressRatio: number;
  timeProgressRatio: number;
  onResetImmediately: () => void;
  zoneAlertLevel?: 'green' | 'yellow' | 'red_retreat';
  isRetreatCountdownActive?: boolean;
  retreatCountdownRemainingSec?: number;
  retreatAlertMessageRu?: string | null;
}

export const ScenarioFailedModal: React.FC<ScenarioFailedModalProps> = ({
  failState,
  isWarning80Active,
  warning80MessageRu,
  doseProgressRatio,
  onResetImmediately,
  zoneAlertLevel = 'green',
  isRetreatCountdownActive = false,
  retreatCountdownRemainingSec = 8.0,
  retreatAlertMessageRu
}) => {
  const isRedRetreat = zoneAlertLevel === 'red_retreat' || isRetreatCountdownActive;
  const isYellowZone = !isRedRetreat && (zoneAlertLevel === 'yellow' || isWarning80Active);

  return (
    <>
      {/* 1. ЖЕЛТАЯ ЗОНА: Предупреждение визора (#F59E0B) */}
      {isYellowZone && !failState && (
        <div className="fixed inset-0 pointer-events-none z-30 overflow-hidden">
          <div className="absolute inset-0 border-[3px] border-[#F59E0B]/45 shadow-[inset_0_0_64px_rgba(245,158,11,0.22)]" />

          <div className="absolute top-14 left-1/2 -translate-x-1/2 alara-glass border-[#F59E0B]/55 px-4 py-2.5 rounded-xl flex items-center gap-3 max-w-xl w-[90vw]">
            <div className="p-1.5 rounded-[10px] bg-[#F59E0B]/15 text-[#F59E0B] shrink-0">
              <AlertTriangle className="w-5 h-5" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-[11px] font-mono font-bold uppercase tracking-wider text-[#F59E0B] flex items-center justify-between gap-2">
                <span>Жёлтая зона · Порог мощности поля</span>
                <span className="alara-tabular px-2 py-0.5 rounded-[8px] bg-[#F59E0B]/15 border border-[#F59E0B]/40 text-[#F59E0B]">
                  Доза {Math.min(100, Math.round(doseProgressRatio * 100))}%
                </span>
              </div>
              <div className="text-xs text-[#F1F5F9] font-medium mt-0.5 leading-snug">
                {warning80MessageRu ||
                  'Повышенная мощность поля / 80% контрольного лимита. Увеличьте дистанцию и сократите экспозицию.'}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 2. КРАСНАЯ ЗОНА: Экстренный отход (#EF4444) */}
      {isRedRetreat && !failState && (
        <div className="fixed inset-0 pointer-events-none z-40 overflow-hidden">
          <div className="absolute inset-0 border-4 border-[#EF4444]/70 shadow-[inset_0_0_96px_rgba(239,68,68,0.38)]" />

          <div className="absolute top-14 left-1/2 -translate-x-1/2 alara-glass-elevated border-[#EF4444]/65 px-5 py-3.5 rounded-xl max-w-xl w-[92vw]">
            <div className="flex items-center gap-3 mb-2">
              <div className="p-2 bg-[#EF4444]/20 border border-[#EF4444]/50 text-[#EF4444] rounded-[10px] shrink-0">
                <ArrowLeft className="w-5 h-5" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[11px] font-mono font-bold tracking-wider text-[#EF4444] uppercase">
                    Красная зона · Отступите назад
                  </span>
                  <span className="font-mono alara-tabular text-xs font-bold px-2.5 py-0.5 rounded-[8px] bg-[#EF4444] text-white">
                    {Math.max(0, retreatCountdownRemainingSec).toFixed(1)} с
                  </span>
                </div>
                <div className="text-xs font-semibold text-[#F1F5F9] mt-1 leading-snug">
                  {retreatAlertMessageRu ||
                    'Критическая мощность дозы. Отойдите на 2–3 метра назад для выхода из опасной зоны.'}
                </div>
              </div>
            </div>

            <div className="w-full bg-slate-800/80 h-1.5 rounded-full overflow-hidden">
              <div
                className="h-full bg-[#EF4444] transition-all duration-100 ease-linear"
                style={{
                  width: `${Math.max(0, Math.min(100, (retreatCountdownRemainingSec / 8.0) * 100))}%`
                }}
              />
            </div>

            <div className="flex items-center justify-between text-[10px] font-mono text-[#94A3B8] mt-1.5">
              <span className="text-[#F59E0B]">[S] или стик VR назад — безопасный рубеж</span>
              <span>Таймер сбросится при выходе</span>
            </div>
          </div>
        </div>
      )}

      {/* 3. МОДАЛЬНОЕ ОКНО ПРОВАЛА МИССИИ */}
      {failState && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#0B1117]/85 backdrop-blur-sm p-4 pointer-events-auto">
          <div className="relative w-full max-w-xl alara-glass-elevated border-[#EF4444]/55 rounded-xl p-6 space-y-4">
            {/* Полоса обратного отсчета до сброса */}
            <div className="w-full bg-slate-800/80 h-1.5 rounded-full overflow-hidden">
              <div
                className="bg-[#EF4444] h-full transition-all duration-100 ease-linear"
                style={{ width: `${Math.max(0, Math.min(100, (failState.countdownSec / 5.0) * 100))}%` }}
              />
            </div>

            <div className="flex items-start gap-3.5">
              <div className="p-2.5 rounded-xl bg-[#EF4444]/15 border border-[#EF4444]/40 text-[#EF4444] shrink-0">
                <AlertOctagon className="w-7 h-7" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-mono text-[11px] font-bold uppercase tracking-wider text-[#EF4444]">
                    Сценарий прерван · Движение заблокировано
                  </span>
                  <span className="font-mono alara-tabular text-xs font-semibold text-[#F59E0B]">
                    Сброс через {failState.countdownSec.toFixed(1)} с
                  </span>
                </div>
                <h2 className="text-lg font-bold text-[#F1F5F9] mt-1">
                  {failState.titleRu}
                </h2>
                <p className="text-xs text-[#94A3B8] font-mono mt-0.5">{failState.scenarioTitleRu}</p>
              </div>
            </div>

            <div className="p-3.5 rounded-[10px] alara-surface border-[#EF4444]/35 space-y-1.5">
              <div className="text-[11px] font-mono font-bold uppercase tracking-wider text-[#EF4444] flex items-center gap-1.5">
                <ShieldAlert className="w-4 h-4 shrink-0" />
                <span>Причина аварийной остановки</span>
              </div>
              <p className="text-xs text-[#F1F5F9] font-medium leading-relaxed">{failState.reasonRu}</p>
              <div className="pt-1.5 border-t border-slate-400/15 text-[11px] font-mono text-[#F59E0B]">
                Основание: {failState.normativeRu}
              </div>
            </div>

            <div className="grid grid-cols-3 gap-2.5 text-center text-xs font-mono alara-tabular">
              <div className="p-2.5 rounded-[10px] alara-surface">
                <span className="text-[10px] text-[#94A3B8] block">Накоплено H</span>
                <strong className="text-[#EF4444] font-bold">
                  {(failState.finalDoseMsv * 1000).toFixed(1)} мкЗв
                </strong>
              </div>
              <div className="p-2.5 rounded-[10px] alara-surface">
                <span className="text-[10px] text-[#94A3B8] block">Лимит H_lim</span>
                <strong className="text-[#F1F5F9]">
                  {(failState.hLimitMsv * 1000).toFixed(0)} мкЗв
                </strong>
              </div>
              <div className="p-2.5 rounded-[10px] alara-surface">
                <span className="text-[10px] text-[#94A3B8] block">Время работы</span>
                <strong className="text-[#0EA5E9] font-bold">
                  {failState.failedAtSec.toFixed(0)} с
                </strong>
              </div>
            </div>

            <div className="p-3 rounded-[10px] alara-surface text-[11px] text-[#94A3B8] leading-relaxed">
              <span className="text-[#0EA5E9] font-mono font-bold block mb-1">
                Рекомендация ALARA:
              </span>
              {failState.failCode === 'DOSE_LIMIT_EXCEEDED'
                ? 'Увеличьте рабочую дистанцию (1/r²), установите защитный экран B(μx) и сократите время пребывания в зоне повышенной МЭД.'
                : failState.failCode === 'TIMEOUT_EXCEEDED'
                ? 'Оптимизируйте маршрут и порядок выполнения этапов. Не задерживайтесь вблизи источников без экранирования.'
                : 'Соблюдайте регламент ОСПОРБ-99/2010 и применяйте дистанционные манипуляторы при работе с источниками.'}
            </div>

            <button
              type="button"
              onClick={onResetImmediately}
              className="w-full py-2.5 px-4 rounded-[10px] bg-[#EF4444] hover:bg-red-400 text-white font-bold text-xs uppercase tracking-wider flex items-center justify-center gap-2 transition cursor-pointer"
            >
              <RotateCcw className="w-4 h-4" />
              <span>Перезапустить задание ({Math.ceil(failState.countdownSec)} с)</span>
            </button>
          </div>
        </div>
      )}
    </>
  );
};
