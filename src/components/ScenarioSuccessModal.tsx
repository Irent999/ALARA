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
import type { MchsMissionMetrics } from '../scene/EvacuationManager';

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
  mchsMetrics?: MchsMissionMetrics;
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
  mchsMetrics,
  onNextScenario,
  onRestartScenario,
  onOpenReport,
  onClose
}) => {
  if (!isOpen) return null;

  let grade = alaraRating || 'ОТЛИЧНО (КЛАСС А)';
  let gradeColor = 'text-[#10B981]';
  let gradeBadgeBg = 'bg-[#10B981]/10 border-[#10B981]/40';
  if (cumulativeDoseMsv > permitLimitMsv * 0.8) {
    grade = 'УДОВЛЕТВОРИТЕЛЬНО (КЛАСС C)';
    gradeColor = 'text-[#F59E0B]';
    gradeBadgeBg = 'bg-[#F59E0B]/10 border-[#F59E0B]/40';
  } else if (cumulativeDoseMsv > permitLimitMsv * 0.4) {
    grade = 'ХОРОШО (КЛАСС B)';
    gradeColor = 'text-[#0EA5E9]';
    gradeBadgeBg = 'bg-[#0EA5E9]/10 border-[#0EA5E9]/40';
  }

  const mins = Math.floor(missionTimeSec / 60);
  const secs = Math.floor(missionTimeSec % 60);
  const timeFormatted = `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#0B1117]/85 backdrop-blur-sm p-4 pointer-events-auto">
      <div className="relative w-full max-w-2xl alara-glass-elevated border-[#10B981]/45 rounded-xl p-6 space-y-5">
        <button
          type="button"
          onClick={onClose}
          className="absolute top-4 right-4 p-2 rounded-[10px] alara-surface hover:bg-slate-800/80 text-[#94A3B8] hover:text-[#F1F5F9] transition cursor-pointer"
          title="Закрыть"
        >
          <X className="w-4 h-4" />
        </button>

        <div className="flex items-start gap-3.5 border-b border-slate-400/15 pb-4">
          <div className="p-2.5 rounded-xl bg-[#10B981]/15 border border-[#10B981]/40 text-[#10B981] shrink-0">
            <Trophy className="w-7 h-7" />
          </div>
          <div className="flex-1 pr-8 min-w-0">
            <div className="flex flex-wrap items-center gap-2 font-mono text-[11px]">
              <span className="text-[#10B981] font-bold uppercase tracking-wider flex items-center gap-1">
                <CheckCircle2 className="w-3.5 h-3.5" />
                Сценарий завершён
              </span>
              <span className="text-[#64748B]">·</span>
              <span className="text-[#94A3B8]">Сценарий #{scenarioId} / 4</span>
            </div>
            <h2 className="text-lg md:text-xl font-bold text-[#F1F5F9] mt-1 leading-tight">
              {scenarioTitle}
            </h2>
            <p className="text-xs text-[#94A3B8] mt-0.5">
              Все целевые критерии радиационной безопасности выполнены в полном объёме
            </p>
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5">
          <div className="alara-surface rounded-[10px] p-3 flex flex-col justify-between">
            <div className="text-[11px] text-[#94A3B8] flex items-center gap-1">
              <Radiation className="w-3.5 h-3.5 text-[#10B981]" />
              <span>Доза</span>
            </div>
            <div className="mt-1.5">
              <div className="text-base font-mono alara-tabular font-bold text-[#10B981]">
                {(cumulativeDoseMsv * 1000).toFixed(1)} <span className="text-[11px] font-normal">мкЗв</span>
              </div>
              <div className="text-[10px] font-mono alara-tabular text-[#64748B]">
                Лимит {(permitLimitMsv * 1000).toFixed(0)} мкЗв
              </div>
            </div>
          </div>

          <div className="alara-surface rounded-[10px] p-3 flex flex-col justify-between">
            <div className="text-[11px] text-[#94A3B8] flex items-center gap-1">
              <Clock className="w-3.5 h-3.5 text-[#0EA5E9]" />
              <span>Время</span>
            </div>
            <div className="mt-1.5">
              <div className="text-base font-mono alara-tabular font-bold text-[#0EA5E9]">{timeFormatted}</div>
              <div className="text-[10px] font-mono alara-tabular text-[#64748B]">
                {Math.round(missionTimeSec)} с
              </div>
            </div>
          </div>

          <div className="alara-surface rounded-[10px] p-3 flex flex-col justify-between">
            <div className="text-[11px] text-[#94A3B8] flex items-center gap-1">
              <ShieldCheck className="w-3.5 h-3.5 text-[#F59E0B]" />
              <span>Этапы</span>
            </div>
            <div className="mt-1.5">
              <div className="text-base font-mono alara-tabular font-bold text-[#F59E0B]">
                {completedTasksCount} / {totalTasksCount}
              </div>
              <div className="text-[10px] font-mono text-[#10B981]">100% Выполнено</div>
            </div>
          </div>

          <div className={`rounded-[10px] p-3 border flex flex-col justify-between ${gradeBadgeBg}`}>
            <div className="text-[11px] text-[#94A3B8] flex items-center gap-1">
              <Award className="w-3.5 h-3.5 text-[#F59E0B]" />
              <span>Рейтинг ALARA</span>
            </div>
            <div className="mt-1.5">
              <div className={`text-xs font-bold leading-snug ${gradeColor}`}>{grade}</div>
              <div className="text-[10px] font-mono text-[#64748B] mt-0.5">ОСПОРБ-99/2010</div>
            </div>
          </div>
        </div>

        <div className="p-3.5 rounded-[10px] alara-surface border-[#10B981]/30 text-xs text-[#94A3B8] space-y-1.5">
          <div className="font-semibold text-[#10B981] flex items-center gap-1.5">
            <ShieldCheck className="w-4 h-4 shrink-0" />
            <span>Заключение службы радиационной безопасности</span>
          </div>
          <p className="leading-relaxed text-[#F1F5F9]">
            Операция выполнена с соблюдением трёх принципов оптимизации ALARA: минимальное время, безопасная дистанция и эффективное экранирование.
          </p>
          {mchsMetrics && (mchsMetrics.operationsCompleted > 0 || mchsMetrics.totalExtractable > 0) && (
            <div className="pt-2 border-t border-slate-400/15 flex flex-wrap gap-3 font-mono alara-tabular text-[11px] text-[#14B8A6]">
              <span>Операций МЧС: {mchsMetrics.operationsCompleted}</span>
              <span>Эвакуация в САР: {mchsMetrics.extractedCount}/{mchsMetrics.totalExtractable}</span>
              <span>Щипцы ЦМ-1.5: {mchsMetrics.tongsCompliantExtractions}</span>
              {mchsMetrics.bareHandViolations > 0 && (
                <span className="text-[#EF4444]">
                  Хват без щипцов: {mchsMetrics.bareHandViolations}
                </span>
              )}
            </div>
          )}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5">
          <button
            type="button"
            onClick={() => {
              onClose();
              onNextScenario();
            }}
            className="py-2.5 px-4 rounded-[10px] bg-[#10B981] hover:bg-emerald-400 text-[#0B1117] font-bold text-xs flex items-center justify-center gap-1.5 transition cursor-pointer whitespace-nowrap"
          >
            <span>Следующий сценарий</span>
            <ArrowRight className="w-4 h-4" />
          </button>

          <button
            type="button"
            onClick={() => {
              onClose();
              onRestartScenario();
            }}
            className="py-2.5 px-4 rounded-[10px] alara-surface border-[#F59E0B]/40 hover:bg-slate-800/80 text-[#F59E0B] font-semibold text-xs flex items-center justify-center gap-1.5 transition cursor-pointer whitespace-nowrap"
          >
            <RotateCcw className="w-4 h-4" />
            <span>Повторить</span>
          </button>

          <button
            type="button"
            onClick={() => {
              onClose();
              onOpenReport();
            }}
            className="py-2.5 px-4 rounded-[10px] alara-surface hover:bg-slate-800/80 text-[#F1F5F9] font-semibold text-xs flex items-center justify-center gap-1.5 transition cursor-pointer whitespace-nowrap"
          >
            <BarChart3 className="w-4 h-4 text-[#0EA5E9]" />
            <span>Отчёт ALARA</span>
          </button>
        </div>
      </div>
    </div>
  );
};
