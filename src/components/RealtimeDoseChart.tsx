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
                borderColor: '#F59E0B',
                backgroundColor: 'rgba(245, 158, 11, 0.15)',
                borderWidth: 2,
                pointRadius: 0,
                fill: true,
                tension: 0.35,
                yAxisID: 'y'
              },
              {
                label: 'Накопленная доза (мЗв)',
                data: cumulativeDoseData.slice(-25),
                borderColor: '#0EA5E9',
                backgroundColor: 'rgba(14, 165, 233, 0.12)',
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
                  color: '#F59E0B',
                  font: { size: 10 }
                },
                ticks: { color: '#F59E0B', font: { size: 10 } },
                grid: { color: 'rgba(245, 158, 11, 0.1)' }
              },
              y1: {
                type: 'linear',
                display: isExpanded,
                position: 'right',
                title: {
                  display: isExpanded,
                  text: 'мЗв',
                  color: '#0EA5E9',
                  font: { size: 10 }
                },
                ticks: { color: '#0EA5E9', font: { size: 10 } },
                grid: { drawOnChartArea: false }
              }
            },
            plugins: {
              legend: {
                display: isExpanded,
                labels: {
                  color: '#F1F5F9',
                  boxWidth: 12,
                  font: { size: 10 }
                }
              },
              tooltip: {
                enabled: true,
                backgroundColor: 'rgba(11, 17, 23, 0.94)',
                titleColor: '#F59E0B',
                bodyColor: '#F1F5F9',
                borderColor: 'rgba(148, 163, 184, 0.25)',
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
      className={`alara-glass rounded-xl p-2.5 md:p-3 pointer-events-auto transition-all duration-200 max-h-[35vh] flex flex-col ${
        isExpanded ? 'w-80 md:w-96 h-48 md:h-52' : 'w-52 md:w-56 h-24 md:h-28'
      }`}
    >
      <div className="flex items-center justify-between pb-1 border-b border-slate-400/15 text-xs flex-shrink-0">
        <div className="flex items-center gap-1.5 font-semibold text-[#F59E0B] text-[11px] md:text-xs">
          <Activity className="w-3.5 h-3.5" />
          <span>Динамика дозы (ГОСТ)</span>
        </div>
        <button
          onClick={onToggleExpand}
          className="p-1 rounded-[8px] text-[#94A3B8] hover:text-[#F1F5F9] hover:bg-slate-800/80 transition cursor-pointer"
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
