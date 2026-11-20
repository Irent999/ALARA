import React, { useEffect, useRef } from 'react';
import {
  Chart as ChartJS,
  registerables
} from 'chart.js';
import { Award, Clock, Radiation, Shield, X, RotateCcw, TrendingDown } from 'lucide-react';

ChartJS.register(...registerables);

interface AlaraReportModalProps {
  isOpen: boolean;
  onClose: () => void;
  cumulativeDoseMsv: number;
  missionTimeSec: number;
  chartLabels: string[];
  chartDoseRate: number[];
  onRestartMission: () => void;
  scenarioTitle: string;
}

export const AlaraReportModal: React.FC<AlaraReportModalProps> = ({
  isOpen,
  onClose,
  cumulativeDoseMsv,
  missionTimeSec,
  chartLabels,
  chartDoseRate,
  onRestartMission,
  scenarioTitle
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const chartInstanceRef = useRef<ChartJS | null>(null);

  useEffect(() => {
    if (!isOpen || !canvasRef.current) return;

    // Уничтожаем предыдущий экземпляр если есть по ref или по canvas
    if (chartInstanceRef.current) {
      chartInstanceRef.current.destroy();
      chartInstanceRef.current = null;
    }
    const existingChart = ChartJS.getChart(canvasRef.current);
    if (existingChart) {
      existingChart.destroy();
    }

    const ctx = canvasRef.current.getContext('2d');
    if (!ctx) return;

    try {
      chartInstanceRef.current = new ChartJS(canvasRef.current, {
        type: 'line',
        data: {
          labels: chartLabels.length > 0 ? chartLabels : ['0с'],
          datasets: [
            {
              label: 'Мощность дозы (мкЗв/ч)',
              data: chartDoseRate.length > 0 ? chartDoseRate : [0],
              borderColor: '#eab308',
              backgroundColor: 'rgba(234, 179, 8, 0.18)',
              fill: true,
              tension: 0.3,
              borderWidth: 2
            }
          ]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          scales: {
            x: {
              ticks: { color: '#94a3af' },
              grid: { color: 'rgba(255, 255, 255, 0.05)' }
            },
            y: {
              ticks: { color: '#94a3af' },
              grid: { color: 'rgba(255, 255, 255, 0.05)' },
              title: { display: true, text: 'мкЗв/ч', color: '#94a3af' }
            }
          },
          plugins: {
            legend: { labels: { color: '#fff' } }
          }
        }
      });
    } catch (e) {
      console.error('Error initializing report chart:', e);
    }

    return () => {
      if (chartInstanceRef.current) {
        chartInstanceRef.current.destroy();
        chartInstanceRef.current = null;
      }
      if (canvasRef.current) {
        const chart = ChartJS.getChart(canvasRef.current);
        if (chart) {
          chart.destroy();
        }
      }
    };
  }, [isOpen, chartLabels, chartDoseRate]);

  if (!isOpen) return null;

  // Расчет грейда ALARA
  let grade = 'ОТЛИЧНО (A)';
  let gradeColor = 'text-emerald-400 border-emerald-500/40 bg-emerald-950/40';
  let gradeComment = 'Вы великолепно следовали всем трем факторам ALARA: минимальное время, удаленное расстояние и эффективное экранирование.';

  if (cumulativeDoseMsv > 0.05) {
    grade = 'ПРЕВЫШЕНИЕ ДОЗЫ (F)';
    gradeColor = 'text-red-400 border-red-500/40 bg-red-950/40';
    gradeComment = 'Зафиксировано опасное накопление дозы! Требуется пересмотреть алгоритм передвижений и установить защиту до начала работ.';
  } else if (cumulativeDoseMsv > 0.01) {
    grade = 'ХОРОШО (B)';
    gradeColor = 'text-amber-400 border-amber-500/40 bg-amber-950/40';
    gradeComment = 'Задача выполнена, однако время пребывания в зоне повышенного поля можно сократить.';
  }

  const mins = Math.floor(missionTimeSec / 60);
  const secs = Math.floor(missionTimeSec % 60);
  const timeFormatted = `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;

  return (
    <div className="fixed inset-0 z-50 bg-black/85 backdrop-blur-md flex items-center justify-center p-4">
      <div className="glass-panel max-w-3xl w-full rounded-2xl p-6 border border-yellow-500/30 flex flex-col gap-5 max-h-[90vh] overflow-y-auto">
        <div className="flex justify-between items-center border-b border-slate-700 pb-3">
          <div className="flex items-center gap-2.5">
            <Award className="w-6 h-6 text-yellow-400" />
            <div>
              <h2 className="text-xl font-bold text-white">Анализ ALARA & Протокол Безопасности</h2>
              <p className="text-xs text-slate-400">{scenarioTitle}</p>
            </div>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-white p-1 rounded-lg">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* 3 Metric Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-center">
          <div className="bg-slate-900/80 p-3.5 rounded-xl border border-slate-800">
            <span className="text-xs text-slate-400 uppercase tracking-wider flex items-center justify-center gap-1">
              <Radiation className="w-3.5 h-3.5 text-yellow-400" /> Суммарная Доза
            </span>
            <div className="text-2xl font-black text-yellow-400 mt-1 font-mono">
              {cumulativeDoseMsv.toFixed(4)} <span className="text-xs">мЗв</span>
            </div>
            <div className="text-[11px] text-slate-400 mt-0.5">
              {(cumulativeDoseMsv * 1000).toFixed(1)} мкЗв (w_R = 1)
            </div>
          </div>

          <div className="bg-slate-900/80 p-3.5 rounded-xl border border-slate-800">
            <span className="text-xs text-slate-400 uppercase tracking-wider flex items-center justify-center gap-1">
              <Clock className="w-3.5 h-3.5 text-sky-400" /> Время в зоне
            </span>
            <div className="text-2xl font-black text-sky-400 mt-1 font-mono">{timeFormatted}</div>
            <div className="text-[11px] text-slate-400 mt-0.5">Хронометраж операции</div>
          </div>

          <div className={`p-3.5 rounded-xl border ${gradeColor}`}>
            <span className="text-xs uppercase tracking-wider flex items-center justify-center gap-1">
              <Award className="w-3.5 h-3.5" /> Оценка ALARA
            </span>
            <div className="text-xl font-black mt-1">{grade}</div>
            <div className="text-[11px] opacity-80 mt-0.5">ГОСТ Р 8.804-2012</div>
          </div>
        </div>

        {/* Chart View */}
        <div className="bg-slate-950/70 p-3.5 rounded-xl border border-slate-800 relative h-64">
          <canvas ref={canvasRef} />
        </div>

        {/* ALARA Principles Analysis */}
        <div className="text-xs text-slate-300 bg-slate-950/50 p-4 rounded-xl border border-slate-800/80 space-y-2">
          <p className="font-bold text-yellow-400 flex items-center gap-1.5">
            <TrendingDown className="w-4 h-4" /> Заключение эксперта по безопасности:
          </p>
          <p className="text-slate-300">{gradeComment}</p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-2 pt-2 border-t border-slate-800/60 text-[11px]">
            <div>
              <span className="font-bold text-white block">1. Время (Time):</span>
              Минимизация экспозиции снижает общую интегральную дозу прямо пропорционально.
            </div>
            <div>
              <span className="font-bold text-white block">2. Расстояние (Distance):</span>
              Увеличение дистанции снижает фон по закону 1/r² для точечных источников.
            </div>
            <div>
              <span className="font-bold text-white block">3. Защита (Shielding):</span>
              Свинцовые и стальные экраны поглощают фотоны с учетом фактора накопления Тейлора.
            </div>
          </div>
        </div>

        <div className="flex gap-3">
          <button
            onClick={() => {
              onClose();
              onRestartMission();
            }}
            className="flex-1 py-3 bg-yellow-500 hover:bg-yellow-400 text-black font-bold rounded-xl transition flex items-center justify-center gap-2"
          >
            <RotateCcw className="w-4 h-4" /> Пройти миссию заново
          </button>
          <button
            onClick={onClose}
            className="px-6 py-3 bg-slate-800 hover:bg-slate-700 text-white font-bold rounded-xl transition"
          >
            Продолжить
          </button>
        </div>
      </div>
    </div>
  );
};
