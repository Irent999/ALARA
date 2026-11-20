import React from 'react';
import {
  Trophy,
  CheckCircle2,
  RotateCcw,
  ArrowRight,
  BarChart3,
  ShieldCheck,
  Clock,
  Radiation,
  X,
  Award
} from 'lucide-react';

export interface ScenarioSuccessModalProps {
  isOpen: boolean;
  scenarioId: number;
  scenarioTitle: string;
  cumulativeDoseMsv: number;
  permitLimitMsv: number;
  missionTimeSec: number;
  alaraRating?: string;
  completedTasksCount?: number;
  totalTasksCount?: number;
  onNextScenario: () => void;
  onRestartScenario: () => void;
  onOpenReport: () => void;
  onClose: () => void;
}

export const ScenarioSuccessModal: React.FC<ScenarioSuccessModalProps> = ({
  isOpen,
  scenarioId,
  scenarioTitle,
  cumulativeDoseMsv,
  permitLimitMsv,
  missionTimeSec,
  alaraRating,
  completedTasksCount = 3,
  totalTasksCount = 3,
  onNextScenario,
  onRestartScenario,
  onOpenReport,
  onClose
}) => {
  if (!isOpen) return null;

  let grade = alaraRating || 'ОТЛИЧНО (КЛАСС А)';
  let gradeColor = 'text-emerald-400';
  let gradeBadgeBg = 'bg-emerald-500/20 border-emerald-500/50';
  if (cumulativeDoseMsv > permitLimitMsv * 0.8) {
    grade = 'УДОВЛЕТВОРИТЕЛЬНО (КЛАСС C)';
    gradeColor = 'text-amber-400';
    gradeBadgeBg = 'bg-amber-500/20 border-amber-500/50';
  } else if (cumulativeDoseMsv > permitLimitMsv * 0.4) {
    grade = 'ХОРОШО (КЛАСС B)';
    gradeColor = 'text-sky-400';
    gradeBadgeBg = 'bg-sky-500/20 border-sky-500/50';
  }

  const mins = Math.floor(missionTimeSec / 60);
  const secs = Math.floor(missionTimeSec % 60);
  const timeFormatted = `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/85 backdrop-blur-md p-4 pointer-events-auto animate-fadeIn">
      {/* Мягкий изумрудный периметр успеха */}
      <div className="absolute inset-0 border-4 border-emerald-500/40 pointer-events-none shadow-[inset_0_0_80px_rgba(16,185,129,0.25)]" />

      <div className="relative w-full max-w-2xl bg-slate-950/95 border-2 border-emerald-500/80 rounded-3xl p-6 md:p-8 shadow-[0_0_80px_rgba(16,185,129,0.4)] text-slate-100">
        {/* Кнопка закрытия [ ✕ ] */}
        <button
          onClick={onClose}
          className="absolute top-5 right-5 p-2 rounded-xl bg-slate-900/80 hover:bg-slate-800 text-slate-400 hover:text-white transition cursor-pointer"
          title="Закрыть"
        >
          <X className="w-5 h-5" />
        </button>

        {/* Заголовок с золотым кубком */}
        <div className="flex items-start gap-4">
          <div className="p-3.5 rounded-2xl bg-gradient-to-br from-emerald-500/30 to-amber-500/30 border border-emerald-500/60 text-amber-400 shrink-0 shadow-lg shadow-emerald-500/20">
            <Trophy className="w-9 h-9 animate-bounce text-amber-400" />
          </div>
          <div className="flex-1 pr-8">
            <div className="flex items-center gap-2">
              <span className="px-2.5 py-0.5 rounded-md bg-emerald-600 text-white text-[11px] font-extrabold uppercase tracking-wider flex items-center gap-1.5">
                <CheckCircle2 className="w-3.5 h-3.5" />
                СЦЕНАРИЙ УСПЕШНО ЗАВЕРШЕН
              </span>
              <span className="font-mono text-xs text-emerald-400 font-bold">
                Сценарий #{scenarioId} / 12
              </span>
            </div>
            <h2 className="text-xl md:text-2xl font-black text-white mt-1.5 leading-tight">
              {scenarioTitle}
            </h2>
            <p className="text-xs text-emerald-400/90 font-mono mt-0.5">
              Все целевые критерии безопасности и радиационные задачи выполнены в полном объеме
            </p>
          </div>
        </div>

        {/* Метрики выполнения */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-6">
          {/* Доза */}
          <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-3.5 flex flex-col justify-between">
            <div className="text-[11px] text-slate-400 flex items-center gap-1">
              <Radiation className="w-3.5 h-3.5 text-emerald-400" />
              <span>Накопленная доза</span>
            </div>
            <div className="mt-1.5">
              <div className="text-lg font-mono font-bold text-emerald-400">
                {(cumulativeDoseMsv * 1000).toFixed(1)} <span className="text-xs font-normal">мкЗв</span>
              </div>
              <div className="text-[10px] font-mono text-slate-500">
                Лимит: {(permitLimitMsv * 1000).toFixed(0)} мкЗв
              </div>
            </div>
          </div>

          {/* Время */}
          <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-3.5 flex flex-col justify-between">
            <div className="text-[11px] text-slate-400 flex items-center gap-1">
              <Clock className="w-3.5 h-3.5 text-sky-400" />
              <span>Время миссии</span>
            </div>
            <div className="mt-1.5">
              <div className="text-lg font-mono font-bold text-sky-400">{timeFormatted}</div>
              <div className="text-[10px] font-mono text-slate-500">
                {Math.round(missionTimeSec)} секунд
              </div>
            </div>
          </div>

          {/* Задачи */}
          <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-3.5 flex flex-col justify-between">
            <div className="text-[11px] text-slate-400 flex items-center gap-1">
              <ShieldCheck className="w-3.5 h-3.5 text-amber-400" />
              <span>Задачи этапов</span>
            </div>
            <div className="mt-1.5">
              <div className="text-lg font-bold text-amber-400">
                {completedTasksCount} / {totalTasksCount}
              </div>
              <div className="text-[10px] font-mono text-emerald-400">100% Выполнено</div>
            </div>
          </div>

          {/* Оценка ALARA */}
          <div className={`rounded-2xl p-3.5 border flex flex-col justify-between ${gradeBadgeBg}`}>
            <div className="text-[11px] text-slate-400 flex items-center gap-1">
              <Award className="w-3.5 h-3.5 text-amber-300" />
              <span>Рейтинг ALARA</span>
            </div>
            <div className="mt-1.5">
              <div className={`text-sm md:text-base font-black ${gradeColor}`}>{grade}</div>
              <div className="text-[10px] font-mono text-slate-400">ОСПОРБ-99/2010</div>
            </div>
          </div>
        </div>

        {/* Текстовое резюме безопасности */}
        <div className="mt-4 p-4 rounded-2xl bg-emerald-950/30 border border-emerald-500/30 text-xs text-slate-300 space-y-1.5">
          <div className="font-bold text-emerald-300 flex items-center gap-1.5">
            <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0" />
            <span>Заключение службы радиационной безопасности:</span>
          </div>
          <p className="leading-relaxed">
            Операция выполнена с соблюдением всех трех составляющих оптимизации радиационной защиты
            (ALARA): минимальное время пребывания в поле излучения, соблюдение безопасной дистанции
            и эффективное применение экранирующих барьеров.
          </p>
        </div>

        {/* Кнопки действий */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mt-6">
          <button
            onClick={() => {
              onClose();
              onNextScenario();
            }}
            className="py-3 px-4 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white font-extrabold text-xs uppercase tracking-wider flex items-center justify-center gap-2 shadow-lg shadow-emerald-600/30 transition cursor-pointer"
          >
            <span>Следующий сценарий</span>
            <ArrowRight className="w-4 h-4" />
          </button>

          <button
            onClick={() => {
              onClose();
              onRestartScenario();
            }}
            className="py-3 px-4 rounded-xl bg-amber-600/80 hover:bg-amber-600 text-white font-extrabold text-xs uppercase tracking-wider flex items-center justify-center gap-2 transition cursor-pointer"
          >
            <RotateCcw className="w-4 h-4" />
            <span>Повторить сценарий</span>
          </button>

          <button
            onClick={() => {
              onClose();
              onOpenReport();
            }}
            className="py-3 px-4 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 hover:text-white font-extrabold text-xs uppercase tracking-wider flex items-center justify-center gap-2 transition cursor-pointer"
          >
            <BarChart3 className="w-4 h-4 text-sky-400" />
            <span>Анализ ALARA (Отчет)</span>
          </button>
        </div>
      </div>
    </div>
  );
};
