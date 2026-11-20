import React, { useEffect, useRef } from 'react';
import {
  Chart as ChartJS,
  registerables
} from 'chart.js';
import { Activity, Minimize2, Maximize2 } from 'lucide-react';

ChartJS.register(...registerables);

interface RealtimeDoseChartProps {
  labels: string[];
  doseRateData: number[]; // мкЗв/ч
  cumulativeDoseData: number[]; // мЗв
  isExpanded: boolean;
  onToggleExpand: () => void;
}

export const RealtimeDoseChart: React.FC<RealtimeDoseChartProps> = ({
  labels,
  doseRateData,
  cumulativeDoseData,
  isExpanded,
  onToggleExpand
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const chartInstanceRef = useRef<ChartJS | null>(null);

  useEffect(() => {
    if (!canvasRef.current) return;

    // Проверяем, есть ли уже активный график на этом canvas элементе в Chart.js
    const existingChart = ChartJS.getChart(canvasRef.current);
    if (!chartInstanceRef.current && existingChart) {
      chartInstanceRef.current = existingChart;
    }

    if (!chartInstanceRef.current) {
      try {
        chartInstanceRef.current = new ChartJS(canvasRef.current, {
          type: 'line',
          data: {
            labels: labels.slice(-25),
            datasets: [
              {
                label: 'Мощность дозы (мкЗв/ч)',
                data: doseRateData.slice(-25),
                borderColor: '#eab308',
                backgroundColor: 'rgba(234, 179, 8, 0.15)',
                borderWidth: 2,
                pointRadius: 0,
                fill: true,
                tension: 0.35,
                yAxisID: 'y'
              },
              {
                label: 'Накопленная доза (мЗв)',
                data: cumulativeDoseData.slice(-25),
                borderColor: '#38bdf8',
                backgroundColor: 'rgba(56, 189, 248, 0.1)',
                borderWidth: 2,
                borderDash: [4, 4],
                pointRadius: 0,
                fill: false,
                tension: 0.2,
                yAxisID: 'y1'
              }
            ]
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            animation: {
              duration: 0
            },
            interaction: {
              mode: 'index',
              intersect: false
            },
            scales: {
              x: {
                display: true,
                ticks: { color: '#94a3b8', font: { size: 10 } },
                grid: { color: 'rgba(255, 255, 255, 0.05)' }
              },
              y: {
                type: 'linear',
                display: true,
                position: 'left',
                title: {
                  display: isExpanded,
                  text: 'мкЗв/ч',
                  color: '#eab308',
                  font: { size: 10 }
                },
                ticks: { color: '#eab308', font: { size: 10 } },
                grid: { color: 'rgba(234, 179, 8, 0.1)' }
              },
              y1: {
                type: 'linear',
                display: isExpanded,
                position: 'right',
                title: {
                  display: isExpanded,
                  text: 'мЗв',
                  color: '#38bdf8',
                  font: { size: 10 }
                },
                ticks: { color: '#38bdf8', font: { size: 10 } },
                grid: { drawOnChartArea: false }
              }
            },
            plugins: {
              legend: {
                display: isExpanded,
                labels: {
                  color: '#e2e8f0',
                  boxWidth: 12,
                  font: { size: 10 }
                }
              },
              tooltip: {
                enabled: true,
                backgroundColor: 'rgba(15, 23, 42, 0.95)',
                titleColor: '#eab308',
                bodyColor: '#e2e8f0',
                borderColor: 'rgba(234, 179, 8, 0.3)',
                borderWidth: 1
              }
            }
          }
        });
      } catch (err) {
        console.error('Error creating realtime dose chart:', err);
      }
    } else {
      const chart = chartInstanceRef.current;
      chart.data.labels = labels.slice(-25);
      if (chart.data.datasets[0]) {
        chart.data.datasets[0].data = doseRateData.slice(-25);
      }
      if (chart.data.datasets[1]) {
        chart.data.datasets[1].data = cumulativeDoseData.slice(-25);
      }
      chart.update('none');
    }
  }, [labels, doseRateData, cumulativeDoseData, isExpanded]);

  useEffect(() => {
    return () => {
      if (chartInstanceRef.current) {
        chartInstanceRef.current.destroy();
        chartInstanceRef.current = null;
      }
      if (canvasRef.current) {
        const existingChart = ChartJS.getChart(canvasRef.current);
        if (existingChart) {
          existingChart.destroy();
        }
      }
    };
  }, []);

  return (
    <div
      className={`glass-panel rounded-xl p-2.5 md:p-3 pointer-events-auto transition-all duration-300 max-h-[35vh] flex flex-col ${
        isExpanded ? 'w-80 md:w-96 h-48 md:h-52' : 'w-52 md:w-56 h-24 md:h-28'
      }`}
    >
      <div className="flex items-center justify-between pb-1 border-b border-slate-700/60 text-xs flex-shrink-0">
        <div className="flex items-center gap-1.5 font-bold text-yellow-400 text-[11px] md:text-xs">
          <Activity className="w-3.5 h-3.5" />
          <span>Динамика Дозы (ГОСТ)</span>
        </div>
        <button
          onClick={onToggleExpand}
          className="p-1 rounded text-slate-400 hover:text-white hover:bg-slate-800 transition"
          title={isExpanded ? 'Свернуть' : 'Развернуть'}
        >
          {isExpanded ? <Minimize2 className="w-3 h-3 md:w-3.5 md:h-3.5" /> : <Maximize2 className="w-3 h-3 md:w-3.5 md:h-3.5" />}
        </button>
      </div>

      <div className="w-full flex-1 min-h-0 pt-1">
        <canvas ref={canvasRef} />
      </div>
    </div>
  );
};
