/**
 * Планшет лабораторных заданий (DOM, Desktop). Кнопка «Зафиксировать фон» — настоящее удержание
 * (pointerdown → down:true, pointerup/leave/cancel → down:false).
 */
import React, { useEffect, useRef, useState } from 'react';
import type { QuestCommand, QuestSnapshot, TaskControl } from '../quest';

interface Props {
  snapshot: QuestSnapshot | null;
  onCommand: (cmd: QuestCommand) => void;
  visible?: boolean;
}

const ICON = { locked: '🔒', active: '▶', completed: '✅' } as const;

export const QuestPanel: React.FC<Props> = ({ snapshot, onCommand, visible = true }) => {
  const [limitText, setLimitText] = useState('0.05');
  const holdingRef = useRef(false);

  // Страховка: если окно потеряло фокус при удержании — отпускаем кнопку.
  useEffect(() => {
    const release = () => {
      if (holdingRef.current) { holdingRef.current = false; onCommand({ type: 'hold_fix_background', down: false }); }
    };
    window.addEventListener('blur', release);
    window.addEventListener('pointerup', release);
    return () => { window.removeEventListener('blur', release); window.removeEventListener('pointerup', release); };
  }, [onCommand]);

  if (!visible || !snapshot) return null;
  const active = snapshot.activeIndex >= 0 ? snapshot.tasks[snapshot.activeIndex] : null;

  const renderControl = (c: TaskControl) => {
    const base = 'w-full px-3 py-2 rounded-lg text-xs font-bold border transition select-none ';
    const on = 'bg-cyan-600/30 hover:bg-cyan-500/40 border-cyan-400/60 text-cyan-100 active:scale-95';
    const off = 'bg-slate-800/60 border-slate-600/50 text-slate-500 cursor-not-allowed';
    if (c.kind === 'hold') {
      return (
        <button key={c.id} disabled={!c.enabled}
          className={base + (c.enabled ? (c.holding ? 'bg-amber-500/40 border-amber-300 text-amber-100' : on) : off)}
          onPointerDown={(e) => { if (!c.enabled) return; (e.target as HTMLElement).setPointerCapture?.(e.pointerId); holdingRef.current = true; onCommand({ type: 'hold_fix_background', down: true }); }}
          onPointerUp={() => { holdingRef.current = false; onCommand({ type: 'hold_fix_background', down: false }); }}
          onPointerCancel={() => { holdingRef.current = false; onCommand({ type: 'hold_fix_background', down: false }); }}>
          {c.holding ? '⏳ ' : '⏺ '}{c.labelRu}
        </button>
      );
    }
    if (c.kind === 'press') {
      return <button key={c.id} disabled={!c.enabled} className={base + (c.enabled ? on : off)}
        onClick={() => onCommand({ type: c.id === 'save_distance_point' ? 'save_distance_point' : c.id === 'measure_under_shield' ? 'measure_under_shield' : 'start_work_timer' })}>{c.labelRu}</button>;
    }
    return (
      <div key={c.id} className="flex gap-2 items-center">
        <input value={limitText} onChange={(e) => setLimitText(e.target.value)} disabled={!c.enabled} inputMode="decimal"
          className="w-20 px-2 py-1.5 rounded bg-slate-900 border border-slate-600 text-slate-100 text-xs font-mono disabled:opacity-40" />
        <span className="text-[11px] text-slate-400">{c.unit}</span>
        <button disabled={!c.enabled} className={base.replace('w-full', 'flex-1') + (c.enabled ? on : off)}
          onClick={() => onCommand({ type: 'set_alara_limit', limitMSv: parseFloat(limitText.replace(',', '.')) })}>
          Задать предел{c.value !== null ? ` (✓ ${c.value})` : ''}
        </button>
      </div>
    );
  };

  return (
    <div className="fixed left-3 bottom-3 z-40 w-[330px] rounded-xl border border-cyan-500/40 bg-slate-950/90 backdrop-blur p-3 text-slate-200 shadow-2xl pointer-events-auto">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-bold text-cyan-300">📟 ПЛАНШЕТ ЛАБОРАТОРНЫХ ЗАДАНИЙ</span>
        <span className="text-[11px] font-mono text-slate-400">{snapshot.completedCount}/{snapshot.total}</span>
      </div>
      <ul className="space-y-0.5 mb-2">
        {snapshot.tasks.map(t => (
          <li key={t.id} className={'text-[11px] flex gap-1.5 ' + (t.status === 'active' ? 'text-white font-semibold' : t.status === 'completed' ? 'text-emerald-300' : 'text-slate-500')}>
            <span>{ICON[t.status]}</span><span>{t.index + 1}. {t.titleRu}</span>
          </li>
        ))}
      </ul>
      {active ? (
        <div className="border-t border-slate-700 pt-2 space-y-2">
          <div className="text-[11px] text-slate-300">{active.goalRu}</div>
          <ol className="space-y-0.5">
            {active.steps.map(s => (
              <li key={s.id} className={'text-[11px] ' + (s.state === 'done' ? 'text-emerald-300' : s.state === 'current' ? 'text-cyan-200' : 'text-slate-500')}>
                {s.state === 'done' ? '✓' : s.state === 'current' ? '▶' : '○'} {s.titleRu}
              </li>
            ))}
          </ol>
          <div className="h-1.5 rounded bg-slate-800 overflow-hidden"><div className="h-full bg-cyan-400 transition-all" style={{ width: `${Math.round(active.progress * 100)}%` }} /></div>
          <div className="text-[11px] text-amber-200 min-h-[2.2em]">{active.instructionRu}</div>
          <div className="space-y-1.5">{active.controls.map(renderControl)}</div>
        </div>
      ) : (
        <div className="text-xs text-emerald-300 font-bold border-t border-slate-700 pt-2">Все задания выполнены 🎓</div>
      )}
      {snapshot.feedback && (
        <div className={'mt-2 text-[11px] rounded px-2 py-1 ' + (snapshot.feedback.kind === 'warn' || snapshot.feedback.kind === 'error' ? 'bg-red-900/40 text-red-200' : snapshot.feedback.kind === 'success' ? 'bg-emerald-900/40 text-emerald-200' : 'bg-slate-800 text-slate-300')}>
          {snapshot.feedback.text}
        </div>
      )}
      <div className="mt-1 text-[10px] text-slate-500">Клавиши: B — удерживать «фон», P — сохранить точку, M — измерить под экраном</div>
    </div>
  );
};
