import React from 'react';
import { AlertTriangle, CheckCircle2, Info, X } from 'lucide-react';

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
    <div className="fixed top-16 right-3 z-50 flex flex-col gap-2 max-w-sm w-[calc(100vw-24px)] pointer-events-auto">
      {toasts.map(toast => {
        let accentBorder = 'border-[#0EA5E9]/40 border-l-[3px] border-l-[#0EA5E9]';
        let iconBg = 'bg-[#0EA5E9]/15 text-[#0EA5E9]';
        let titleColor = 'text-[#0EA5E9]';
        let Icon = Info;

        if (toast.type === 'danger') {
          accentBorder = 'border-[#EF4444]/45 border-l-[3px] border-l-[#EF4444]';
          iconBg = 'bg-[#EF4444]/15 text-[#EF4444]';
          titleColor = 'text-[#EF4444]';
          Icon = AlertTriangle;
        } else if (toast.type === 'warning') {
          accentBorder = 'border-[#F59E0B]/45 border-l-[3px] border-l-[#F59E0B]';
          iconBg = 'bg-[#F59E0B]/15 text-[#F59E0B]';
          titleColor = 'text-[#F59E0B]';
          Icon = AlertTriangle;
        } else if (toast.type === 'success') {
          accentBorder = 'border-[#10B981]/45 border-l-[3px] border-l-[#10B981]';
          iconBg = 'bg-[#10B981]/15 text-[#10B981]';
          titleColor = 'text-[#10B981]';
          Icon = CheckCircle2;
        }

        return (
          <div
            key={toast.id}
            className={`alara-glass p-3 rounded-xl flex items-start gap-2.5 transition-all duration-200 ${accentBorder}`}
          >
            <div className={`p-1.5 rounded-[10px] shrink-0 mt-0.5 ${iconBg}`}>
              <Icon className="w-4 h-4" />
            </div>
            <div className="flex-1 min-w-0">
              <div className={`text-[11px] font-mono font-bold uppercase tracking-wider ${titleColor}`}>
                {toast.title}
              </div>
              <div className="text-xs text-[#F1F5F9] mt-0.5 leading-snug">{toast.message}</div>
            </div>
            <button
              type="button"
              onClick={() => onDismiss(toast.id)}
              className="text-[#94A3B8] hover:text-[#F1F5F9] p-1 rounded-[10px] transition cursor-pointer"
              title="Закрыть"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        );
      })}
    </div>
  );
};
