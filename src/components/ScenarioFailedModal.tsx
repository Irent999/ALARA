import React from 'react';
import { AlertOctagon, AlertTriangle, RotateCcw, ShieldAlert, Clock, Radiation, ArrowLeft } from 'lucide-react';
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
  timeProgressRatio,
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
      {/* ======================================================================= */}
      {/* 1. ЖЕЛТАЯ ЗОНА: Мягкое янтарное свечение визора и звуковая пульсация прибора */}
      {/* ======================================================================= */}
      {isYellowZone && !failState && (
        <div className="fixed inset-0 pointer-events-none z-30 overflow-hidden">
          {/* Пульсирующий янтарно-желтый периметр тревоги (визор) */}
          <div className="absolute inset-0 border-[6px] border-amber-400/75 animate-pulse shadow-[inset_0_0_90px_rgba(245,158,11,0.45)]" />

          {/* Угловые визорные засечки опасности */}
          <div className="absolute top-2 left-2 w-16 h-16 border-t-4 border-l-4 border-amber-400 animate-pulse" />
          <div className="absolute top-2 right-2 w-16 h-16 border-t-4 border-r-4 border-amber-400 animate-pulse" />
          <div className="absolute bottom-2 left-2 w-16 h-16 border-b-4 border-l-4 border-amber-400 animate-pulse" />
          <div className="absolute bottom-2 right-2 w-16 h-16 border-b-4 border-r-4 border-amber-400 animate-pulse" />

          {/* Верхний плавающий баннер Желтой зоны с призывом контролировать дозу */}
          <div className="absolute top-16 left-1/2 -translate-x-1/2 bg-slate-950/95 border-2 border-amber-500 text-amber-100 px-5 py-3 rounded-2xl shadow-[0_0_40px_rgba(245,158,11,0.5)] backdrop-blur-md flex items-center gap-3.5 max-w-2xl w-[92vw]">
            <AlertTriangle className="w-7 h-7 text-amber-400 shrink-0 animate-bounce" />
            <div className="flex-1 min-w-0">
              <div className="text-xs font-black uppercase tracking-wider text-amber-300 flex items-center justify-between gap-2">
                <span>⚠️ ЖЕЛТАЯ ЗОНА • ЗВУКОВАЯ ПУЛЬСАЦИЯ ПРИБОРА</span>
                <span className="font-mono text-xs px-2 py-0.5 rounded bg-amber-900/80 border border-amber-500 text-amber-200">
                  Доза: {Math.min(100, Math.round(doseProgressRatio * 100))}%
                </span>
              </div>
              <div className="text-xs text-white font-bold mt-1">
                {warning80MessageRu ||
                  'Повышенная мощность поля / 80% контрольного лимита. Примените защиту временем и увеличьте расстояние!'}
              </div>
              <div className="text-[11px] font-mono text-amber-300/90 mt-0.5 flex items-center gap-2">
                <span>⚡ Дозиметр подает звуковые импульсы порога • Следите за накоплением дозы</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ======================================================================= */}
      {/* 2. КРАСНАЯ ЗОНА: 5–10 секунд на экстренный отход назад (Retreat Grace Window) */}
      {/* ======================================================================= */}
      {isRedRetreat && !failState && (
        <div className="fixed inset-0 pointer-events-none z-40 overflow-hidden">
          {/* Тревожное частое мигание красного визора */}
          <div className="absolute inset-0 border-[10px] border-red-600 animate-pulse shadow-[inset_0_0_150px_rgba(239,68,68,0.9)]" />

          {/* Угловые контрастные засечки */}
          <div className="absolute top-2 left-2 w-20 h-20 border-t-8 border-l-8 border-red-500 animate-ping" />
          <div className="absolute top-2 right-2 w-20 h-20 border-t-8 border-r-8 border-red-500 animate-ping" />
          <div className="absolute bottom-2 left-2 w-20 h-20 border-b-8 border-l-8 border-red-500 animate-ping" />
          <div className="absolute bottom-2 right-2 w-20 h-20 border-b-8 border-r-8 border-red-500 animate-ping" />

          {/* Центральный верхний блок отступления с обратным отсчетом 5–10 секунд */}
          <div className="absolute top-16 left-1/2 -translate-x-1/2 bg-red-950/95 border-2 border-red-500 text-red-100 px-6 py-4 rounded-3xl shadow-[0_0_60px_rgba(239,68,68,0.8)] backdrop-blur-md max-w-2xl w-[92vw]">
            <div className="flex items-center gap-3.5 mb-2.5">
              <div className="p-2.5 bg-red-600 text-white rounded-2xl animate-pulse">
                <ArrowLeft className="w-6 h-6 stroke-[3]" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-black tracking-widest text-red-300 uppercase">
                    🚨 КРАСНАЯ ЗОНА • СРОЧНО ОТСТУПИТЕ НАЗАД!
                  </span>
                  <span className="font-mono text-sm font-black px-2.5 py-0.5 rounded-lg bg-red-600 text-white shadow-lg animate-pulse">
                    Осталось: {Math.max(0, retreatCountdownRemainingSec).toFixed(1)} с
                  </span>
                </div>
                <div className="text-sm font-extrabold text-white mt-1 leading-snug">
                  {retreatAlertMessageRu ||
                    'Непрерывный треск прибора! Отойдите на 2–3 метра назад для предотвращения аварийного сброса!'}
                </div>
              </div>
            </div>

            {/* Полоса обратного отсчета grace-таймера (из 8.0 с) */}
            <div className="w-full bg-slate-900 h-2.5 rounded-full overflow-hidden border border-red-500/40">
              <div
                className="h-full bg-gradient-to-r from-red-500 via-amber-400 to-red-600 transition-all duration-100 ease-linear"
                style={{
                  width: `${Math.max(0, Math.min(100, (retreatCountdownRemainingSec / 8.0) * 100))}%`
                }}
              />
            </div>

            <div className="flex items-center justify-between text-[11px] font-mono text-amber-300 mt-2">
              <span className="flex items-center gap-1.5 font-bold">
                <ArrowLeft className="w-3.5 h-3.5" />
                Нажмите [S] или отклоните стик VR назад для безопасного рубежа
              </span>
              <span className="text-slate-300">При выходе таймер восстановится</span>
            </div>
          </div>
        </div>
      )}

      {/* ======================================================================= */}
      {/* 3. МОДАЛЬНОЕ ОКНО ПРОВАЛА МИССИИ (SCENARIO FAILED MODAL) ПОСЛЕ ИСТЕЧЕНИЯ ТАЙМЕРА */}
      {/* ======================================================================= */}
      {failState && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-red-950/80 backdrop-blur-md p-4 pointer-events-auto animate-fadeIn">
          {/* Пульсирующий красный периметр тревоги */}
          <div className="absolute inset-0 border-8 border-red-500/80 animate-pulse pointer-events-none shadow-[inset_0_0_100px_rgba(239,68,68,0.55)]" />

          <div className="relative w-full max-w-xl bg-slate-950/95 border-2 border-red-500 rounded-3xl p-6 shadow-[0_0_70px_rgba(239,68,68,0.6)] text-slate-100">
            {/* Полоса 5-секундного обратного отсчета до автоматического сброса */}
            <div className="w-full bg-slate-900 h-2.5 rounded-full overflow-hidden mb-5 border border-red-500/40">
              <div
                className="bg-gradient-to-r from-red-600 via-amber-500 to-red-500 h-full transition-all duration-100 ease-linear"
                style={{ width: `${Math.max(0, Math.min(100, (failState.countdownSec / 5.0) * 100))}%` }}
              />
            </div>

            <div className="flex items-start gap-4">
              <div className="p-3.5 rounded-2xl bg-red-500/20 border border-red-500/50 text-red-400 shrink-0">
                <AlertOctagon className="w-9 h-9 animate-pulse" />
              </div>
              <div className="flex-1">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="px-2.5 py-0.5 rounded-md bg-red-600 text-white text-[11px] font-extrabold uppercase tracking-wider">
                    СЦЕНАРИЙ ПРОВАЛЕН • ПЕРЕМЕЩЕНИЕ ЗАБЛОКИРОВАНО
                  </span>
                  <span className="font-mono text-xs font-bold text-amber-300">
                    Автосброс через {failState.countdownSec.toFixed(1)} с
                  </span>
                </div>
                <h2 className="text-lg md:text-xl font-extrabold text-red-400 mt-2">
                  {failState.titleRu}
                </h2>
                <p className="text-xs text-slate-400 font-mono mt-0.5">{failState.scenarioTitleRu}</p>
              </div>
            </div>

            {/* Точная контекстная причина провала */}
            <div className="mt-4 p-4 rounded-2xl bg-red-950/50 border border-red-500/40 space-y-2">
              <div className="text-xs font-bold uppercase tracking-wider text-red-300 flex items-center gap-1.5">
                <ShieldAlert className="w-4 h-4 shrink-0" />
                <span>Причина аварийной остановки работ:</span>
              </div>
              <p className="text-sm text-white font-medium leading-relaxed">{failState.reasonRu}</p>
              <div className="pt-2 border-t border-red-500/30 text-xs font-mono text-amber-300">
                Основание: {failState.normativeRu}
              </div>
            </div>

            {/* Сводка телеметрии на момент аварии */}
            <div className="mt-4 grid grid-cols-3 gap-2 text-center text-xs font-mono">
              <div className="p-2.5 rounded-xl bg-slate-900 border border-slate-800">
                <span className="text-[10px] text-slate-400 block">Накоплено H</span>
                <strong className="text-red-400 font-bold">
                  {(failState.finalDoseMsv * 1000).toFixed(1)} мкЗв
                </strong>
              </div>
              <div className="p-2.5 rounded-xl bg-slate-900 border border-slate-800">
                <span className="text-[10px] text-slate-400 block">Лимит H_lim</span>
                <strong className="text-slate-200">
                  {(failState.hLimitMsv * 1000).toFixed(0)} мкЗв
                </strong>
              </div>
              <div className="p-2.5 rounded-xl bg-slate-900 border border-slate-800">
                <span className="text-[10px] text-slate-400 block">Время работы</span>
                <strong className="text-sky-300 font-bold">
                  {failState.failedAtSec.toFixed(0)} с
                </strong>
              </div>
            </div>

            {/* Образовательная рекомендация ALARA для студента */}
            <div className="mt-4 p-3 rounded-xl bg-slate-900/90 border border-slate-700/80 text-[11px] font-mono text-slate-300">
              <span className="text-cyan-400 font-bold">💡 РЕКОМЕНДАЦИЯ ALARA ДЛЯ ПОВТОРНОГО ПРОХОЖДЕНИЯ:</span>
              {failState.failCode === 'DOSE_LIMIT_EXCEEDED' ? (
                <p className="mt-1 text-slate-200 leading-relaxed">
                  Увеличьте рабочую дистанцию от источника (закон обратных квадратов D ∝ 1/r²), установите свинцовый экран B(μx) и сократите время пребывания в зоне повышенной МЭД. Все позиции и накопленная доза обнуляются для закрепления навыка.
                </p>
              ) : failState.failCode === 'TIMEOUT_EXCEEDED' ? (
                <p className="mt-1 text-slate-200 leading-relaxed">
                  Оптимизируйте траекторию перемещения и порядок выполнения шагов чек-листа. Не задерживайтесь вблизи высокоактивных объектов без защитного экранирования.
                </p>
              ) : (
                <p className="mt-1 text-slate-200 leading-relaxed">
                  Строго соблюдайте регламент ОСПОРБ-99/2010 и используйте дистанционные манипуляторы при работе с источниками излучения.
                </p>
              )}
            </div>

            {/* Кнопка немедленного перезапуска сценария */}
            <div className="mt-5 flex items-center justify-end gap-3">
              <button
                onClick={onResetImmediately}
                className="w-full py-3 px-4 rounded-2xl bg-gradient-to-r from-red-600 to-amber-600 hover:from-red-500 hover:to-amber-500 text-white font-black text-sm uppercase tracking-wider flex items-center justify-center gap-2 shadow-xl hover:scale-[1.02] active:scale-[0.98] transition cursor-pointer"
              >
                <RotateCcw className="w-4 h-4" />
                <span>Перезапустить задание немедленно (Автосброс: {Math.ceil(failState.countdownSec)} с)</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
