import React from 'react';
import { AlertTriangle, CheckCircle2, Shield, Info, X } from 'lucide-react';

export interface ToastItem {
  id: string;
  type: 'danger' | 'warning' | 'success' | 'info';
  title: string;
  message: string;
  timestamp: number;
}

interface ToastNotificationsProps {
  toasts: ToastItem[];
  onDismiss: (id: string) => void;
}

export const ToastNotifications: React.FC<ToastNotificationsProps> = ({ toasts, onDismiss }) => {
  if (toasts.length === 0) return null;

  return (
    <div className="fixed top-20 right-4 z-50 flex flex-col gap-2 max-w-sm w-full pointer-events-auto">
      {toasts.map(toast => {
        let borderClass = 'border-blue-500/40 bg-slate-900/90 text-blue-300';
        let Icon = Info;

        if (toast.type === 'danger') {
          borderClass = 'border-red-500/60 bg-red-950/90 text-red-200 shadow-lg shadow-red-950/50';
          Icon = AlertTriangle;
        } else if (toast.type === 'warning') {
          borderClass = 'border-amber-500/60 bg-amber-950/90 text-amber-200 shadow-lg shadow-amber-950/50';
          Icon = AlertTriangle;
        } else if (toast.type === 'success') {
          borderClass = 'border-emerald-500/60 bg-emerald-950/90 text-emerald-200 shadow-lg shadow-emerald-950/50';
          Icon = CheckCircle2;
        }

        return (
          <div
            key={toast.id}
            className={`p-3.5 rounded-xl border backdrop-blur-md flex items-start gap-3 transition-all duration-300 transform translate-x-0 ${borderClass}`}
          >
            <div className="p-1 rounded-lg bg-white/10 shrink-0 mt-0.5">
              <Icon className="w-5 h-5" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-xs font-bold uppercase tracking-wider">{toast.title}</div>
              <div className="text-xs text-slate-300 mt-0.5 leading-snug">{toast.message}</div>
            </div>
            <button
              onClick={() => onDismiss(toast.id)}
              className="text-slate-400 hover:text-white p-1 rounded transition"
              title="Закрыть"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        );
      })}
    </div>
  );
};
