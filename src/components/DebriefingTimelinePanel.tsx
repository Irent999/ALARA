/**
 * ALARA-Planner Pro VR — Компонент хронологического тактического разбора (DebriefingTimelinePanel)
 * Используется в модальных окнах провала/успеха и на Тактическом Планшете [Tab].
 * Строго без backdrop-blur-* и animate-pulse для стабильных 60-90 FPS поверх WebGL.
 */

import React from 'react';
import {
  AlertOctagon,
  AlertTriangle,
  CheckCircle2,
  Compass,
  Radio,
  RotateCcw,
  ShieldCheck
} from 'lucide-react';
import type { TacticalTimelineEvent } from '../scene/tacticalDebriefing';

export interface DebriefingTimelinePanelProps {
  events: ReadonlyArray<TacticalTimelineEvent>;
  maxHeightClass?: string;
  emptyTextRu?: string;
}

function formatTimeSec(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return `${m.toString().padStart(2, '0')}:${rem.toString().padStart(2, '0')}`;
}

export const DebriefingTimelinePanel: React.FC<DebriefingTimelinePanelProps> = ({
  events,
  maxHeightClass = 'max-h-56',
  emptyTextRu = 'Хронология тактических действий формируется по мере разведки и реагирования.'
}) => {
  if (!events || events.length === 0) {
    return (
      <div className="p-3 rounded-[10px] alara-surface text-xs text-[#94A3B8]">
        {emptyTextRu}
      </div>
    );
  }

  return (
    <div className={`space-y-2 overflow-y-auto pr-1 ${maxHeightClass}`}>
      {events.map(evt => {
        let borderCls = 'border-slate-400/15';
        let badgeCls = 'text-[#94A3B8]';
        let badgeLabel = 'СОБЫТИЕ';
        let Icon = Radio;
        let iconCls = 'text-[#0EA5E9]';

        if (evt.kind === 'TRAP') {
          borderCls = 'border-[#F59E0B]/40 border-l-[3px] border-l-[#F59E0B]';
          badgeCls = 'text-[#F59E0B]';
          badgeLabel = 'ТАКТИЧЕСКАЯ ЛОВУШКА';
          Icon = AlertTriangle;
          iconCls = 'text-[#F59E0B]';
        } else if (evt.kind === 'VIOLATION') {
          borderCls = 'border-[#EF4444]/45 border-l-[3px] border-l-[#EF4444]';
          badgeCls = 'text-[#EF4444]';
          badgeLabel = 'НАРУШЕНИЕ';
          Icon = AlertOctagon;
          iconCls = 'text-[#EF4444]';
        } else if (evt.kind === 'RECOVERY') {
          borderCls = 'border-[#14B8A6]/40 border-l-[3px] border-l-[#14B8A6]';
          badgeCls = 'text-[#14B8A6]';
          badgeLabel = 'ТАКТИЧЕСКИЙ ВЫХОД';
          Icon = RotateCcw;
          iconCls = 'text-[#14B8A6]';
        } else if (evt.kind === 'RECON') {
          borderCls = 'border-[#0EA5E9]/40 border-l-[3px] border-l-[#0EA5E9]';
          badgeCls = 'text-[#0EA5E9]';
          badgeLabel = 'РАЗВЕДКА';
          Icon = Compass;
          iconCls = 'text-[#0EA5E9]';
        } else if (evt.kind === 'SUCCESS') {
          borderCls = 'border-[#10B981]/40 border-l-[3px] border-l-[#10B981]';
          badgeCls = 'text-[#10B981]';
          badgeLabel = 'ВЫПОЛНЕНО';
          Icon = CheckCircle2;
          iconCls = 'text-[#10B981]';
        }

        const doseFormatted =
          evt.doseRateMicroSv >= 1000
            ? `${(evt.doseRateMicroSv / 1000).toFixed(2)} мЗв/ч`
            : `${evt.doseRateMicroSv.toFixed(1)} мкЗв/ч`;

        return (
          <div key={evt.id} className={`p-2.5 rounded-[10px] alara-surface text-xs ${borderCls}`}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0 font-mono alara-tabular text-[10px]">
                <Icon className={`w-3.5 h-3.5 shrink-0 ${iconCls}`} />
                <span className="text-[#94A3B8]">T+{formatTimeSec(evt.elapsedSec)}</span>
                <span className="text-[#64748B]">·</span>
                <span className={`font-bold uppercase ${badgeCls}`}>{badgeLabel}</span>
              </div>
              <span className="font-mono alara-tabular text-[10px] text-[#94A3B8] shrink-0">
                МЭД {doseFormatted} · H {(evt.cumulativeDoseMsv * 1000).toFixed(1)} мкЗв
              </span>
            </div>

            <div className="font-semibold text-[#F1F5F9] mt-1">{evt.titleRu}</div>
            <p className="text-[11px] text-[#94A3B8] leading-snug mt-0.5">{evt.detailRu}</p>

            {evt.correctActionRu && (
              <div className="mt-1.5 pt-1.5 border-t border-slate-400/15 text-[11px] text-[#10B981] flex items-start gap-1.5">
                <ShieldCheck className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                <span>
                  <strong>ALARA:</strong> {evt.correctActionRu}
                </span>
              </div>
            )}

            {evt.normativeRu && (
              <div className="mt-1 text-[10px] font-mono text-[#F59E0B]">
                Регламент: {evt.normativeRu}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};
