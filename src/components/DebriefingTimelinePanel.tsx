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
      <div className="p-3 rounded-xl bg-slate-900 border border-slate-800 text-xs text-slate-400">
        {emptyTextRu}
      </div>
    );
  }

  return (
    <div className={`space-y-2 overflow-y-auto pr-1 ${maxHeightClass}`}>
      {events.map(evt => {
        let borderCls = 'border-slate-800 bg-slate-900/95';
        let badgeCls = 'bg-slate-800 text-slate-300';
        let badgeLabel = 'СОБЫТИЕ';
        let Icon = Radio;
        let iconCls = 'text-sky-400';

        if (evt.kind === 'TRAP') {
          borderCls = 'border-amber-500/50 bg-amber-950/35';
          badgeCls = 'bg-amber-500/20 text-amber-300 border border-amber-500/40';
          badgeLabel = 'ТАКТИЧЕСКАЯ ЛОВУШКА';
          Icon = AlertTriangle;
          iconCls = 'text-amber-400';
        } else if (evt.kind === 'VIOLATION') {
          borderCls = 'border-rose-500/60 bg-rose-950/45';
          badgeCls = 'bg-rose-500/25 text-rose-200 border border-rose-500/50';
          badgeLabel = 'НАРУШЕНИЕ / ТУПИК';
          Icon = AlertOctagon;
          iconCls = 'text-rose-400';
        } else if (evt.kind === 'RECOVERY') {
          borderCls = 'border-cyan-500/50 bg-cyan-950/30';
          badgeCls = 'bg-cyan-500/20 text-cyan-200 border border-cyan-500/40';
          badgeLabel = 'ТАКТИЧЕСКИЙ ВЫХОД';
          Icon = RotateCcw;
          iconCls = 'text-cyan-300';
        } else if (evt.kind === 'RECON') {
          borderCls = 'border-sky-500/40 bg-sky-950/25';
          badgeCls = 'bg-sky-500/20 text-sky-200 border border-sky-500/40';
          badgeLabel = 'РАЗВЕДКА';
          Icon = Compass;
          iconCls = 'text-sky-300';
        } else if (evt.kind === 'SUCCESS') {
          borderCls = 'border-emerald-500/50 bg-emerald-950/30';
          badgeCls = 'bg-emerald-500/20 text-emerald-200 border border-emerald-500/40';
          badgeLabel = 'ВЫПОЛНЕНО';
          Icon = CheckCircle2;
          iconCls = 'text-emerald-400';
        }

        const doseFormatted =
          evt.doseRateMicroSv >= 1000
            ? `${(evt.doseRateMicroSv / 1000).toFixed(2)} мЗв/ч`
            : `${evt.doseRateMicroSv.toFixed(1)} мкЗв/ч`;

        return (
          <div key={evt.id} className={`p-2.5 rounded-xl border text-xs ${borderCls}`}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <Icon className={`w-4 h-4 shrink-0 ${iconCls}`} />
                <span className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-slate-950 text-slate-300 border border-slate-800">
                  T+{formatTimeSec(evt.elapsedSec)}
                </span>
                <span className={`text-[10px] font-mono font-bold px-1.5 py-0.5 rounded ${badgeCls}`}>
                  {badgeLabel}
                </span>
              </div>
              <span className="font-mono text-[10px] text-slate-400 shrink-0">
                МЭД {doseFormatted} · H {(evt.cumulativeDoseMsv * 1000).toFixed(1)} мкЗв
              </span>
            </div>

            <div className="font-bold text-white mt-1.5">{evt.titleRu}</div>
            <p className="text-[11px] text-slate-300 leading-snug mt-0.5">{evt.detailRu}</p>

            {evt.correctActionRu && (
              <div className="mt-1.5 p-2 rounded-lg bg-slate-950/90 border border-slate-800 text-[11px] text-emerald-300 flex items-start gap-1.5">
                <ShieldCheck className="w-3.5 h-3.5 shrink-0 mt-0.5 text-emerald-400" />
                <span>
                  <strong className="text-emerald-200">Верное действие ALARA:</strong> {evt.correctActionRu}
                </span>
              </div>
            )}

            {evt.normativeRu && (
              <div className="mt-1 text-[10px] font-mono text-amber-300/90">
                Регламент: {evt.normativeRu}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};
