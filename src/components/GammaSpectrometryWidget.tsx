/**
 * ALARA-Planner Pro VR — Модуль Гамма-спектрометрии и идентификации изотопов (МКА)
 * Отображает многоканальный амплитудный спектр импульсов, производит автоматический поиск пиков
 * и сопоставление с библиотекой нуклидов по ГОСТ 27451-87 и ГОСТ Р МЭК 61274.
 */

import React, { useEffect, useRef, useState } from 'react';
import {
  Activity,
  X,
  Search
} from 'lucide-react';
import {
  InstrumentId,
  GOST_INSTRUMENTS,
  GammaSpectrumData,
  generateSyntheticSpectrum,
  ISOTOPE_GAMMA_PEAKS
} from '../instruments/gostInstruments';

interface GammaSpectrometryWidgetProps {
  isOpen: boolean;
  onClose: () => void;
  selectedInstrumentId: InstrumentId;
  activeIsotopeId: string;
  currentDoseRateMicroSv: number;
  isBlindMode?: boolean;
  onIdentifyVerdict?: (isotopeId: string) => void;
}

export const GammaSpectrometryWidget: React.FC<GammaSpectrometryWidgetProps> = ({
  isOpen,
  onClose,
  selectedInstrumentId,
  activeIsotopeId,
  currentDoseRateMicroSv,
  isBlindMode = false,
  onIdentifyVerdict
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [acquisitionTimeSec, setAcquisitionTimeSec] = useState<number>(10);
  const [hoverEnergy, setHoverEnergy] = useState<number | null>(null);
  const [hoverCounts, setHoverCounts] = useState<number | null>(null);
  const [spectrumData, setSpectrumData] = useState<GammaSpectrumData | null>(null);
  const [studentSelectedNuclide, setStudentSelectedNuclide] = useState<string>('');
  const [verdictFeedback, setVerdictFeedback] = useState<string | null>(null);

  const instrument = GOST_INSTRUMENTS[selectedInstrumentId];

  useEffect(() => {
    if (!isOpen) return;
    const spec = generateSyntheticSpectrum(
      activeIsotopeId,
      selectedInstrumentId,
      currentDoseRateMicroSv,
      acquisitionTimeSec
    );
    setSpectrumData(spec);
  }, [isOpen, activeIsotopeId, selectedInstrumentId, currentDoseRateMicroSv, acquisitionTimeSec]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !spectrumData) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const w = canvas.width;
    const h = canvas.height;

    ctx.clearRect(0, 0, w, h);

    // Фон координатной сетки (#0B1117)
    ctx.fillStyle = '#0B1117';
    ctx.fillRect(0, 0, w, h);

    const padLeft = 45;
    const padRight = 20;
    const padTop = 20;
    const padBottom = 35;

    const plotW = w - padLeft - padRight;
    const plotH = h - padTop - padBottom;

    // Сетка
    ctx.strokeStyle = 'rgba(148, 163, 184, 0.14)';
    ctx.lineWidth = 1;

    for (let i = 0; i <= 5; i++) {
      const y = padTop + (plotH / 5) * i;
      ctx.beginPath();
      ctx.moveTo(padLeft, y);
      ctx.lineTo(w - padRight, y);
      ctx.stroke();
    }

    const maxE = spectrumData.energyPerChannelKev * spectrumData.channels.length;
    for (let e = 0; e <= maxE; e += 250) {
      const x = padLeft + (e / maxE) * plotW;
      ctx.beginPath();
      ctx.moveTo(x, padTop);
      ctx.lineTo(x, h - padBottom);
      ctx.stroke();

      ctx.fillStyle = '#64748B';
      ctx.font = '10px "JetBrains Mono", monospace';
      ctx.textAlign = 'center';
      ctx.fillText(`${e}`, x, h - padBottom + 14);
    }

    const maxCounts = Math.max(10, ...spectrumData.channels);

    ctx.fillStyle = '#94A3B8';
    ctx.font = '10px "JetBrains Mono", monospace';
    ctx.textAlign = 'right';
    for (let i = 0; i <= 5; i++) {
      const val = Math.round((maxCounts / 5) * (5 - i));
      const y = padTop + (plotH / 5) * i;
      ctx.fillText(`${val}`, padLeft - 6, y + 3);
    }

    const grad = ctx.createLinearGradient(0, padTop, 0, h - padBottom);
    grad.addColorStop(0, instrument.hasSpectrometryMode ? 'rgba(14, 165, 233, 0.55)' : 'rgba(245, 158, 11, 0.45)');
    grad.addColorStop(1, 'rgba(11, 17, 23, 0.05)');

    ctx.beginPath();
    ctx.moveTo(padLeft, h - padBottom);

    for (let i = 0; i < spectrumData.channels.length; i++) {
      const x = padLeft + (i / spectrumData.channels.length) * plotW;
      const count = spectrumData.channels[i];
      const y = h - padBottom - (count / maxCounts) * plotH;
      ctx.lineTo(x, y);
    }

    ctx.lineTo(padLeft + plotW, h - padBottom);
    ctx.closePath();
    ctx.fillStyle = grad;
    ctx.fill();

    ctx.beginPath();
    for (let i = 0; i < spectrumData.channels.length; i++) {
      const x = padLeft + (i / spectrumData.channels.length) * plotW;
      const count = spectrumData.channels[i];
      const y = h - padBottom - (count / maxCounts) * plotH;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = instrument.hasSpectrometryMode ? '#0EA5E9' : '#F59E0B';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    if (!isBlindMode) {
      spectrumData.peaks.forEach(peak => {
        const peakX = padLeft + (peak.energyKev / maxE) * plotW;
        if (peakX < padLeft || peakX > w - padRight) return;

        ctx.setLineDash([3, 3]);
        ctx.strokeStyle = '#EF4444';
        ctx.beginPath();
        ctx.moveTo(peakX, padTop);
        ctx.lineTo(peakX, h - padBottom);
        ctx.stroke();
        ctx.setLineDash([]);

        ctx.fillStyle = '#EF4444';
        ctx.beginPath();
        ctx.arc(peakX, padTop + 14, 4, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = '#F1F5F9';
        ctx.font = 'bold 11px "JetBrains Mono", monospace';
        ctx.textAlign = 'center';
        ctx.fillText(`${peak.energyKev.toFixed(0)} кэВ`, peakX, padTop + 8);
      });
    }

    ctx.fillStyle = '#94A3B8';
    ctx.font = '11px "IBM Plex Sans", sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Энергия излучения E_γ (кэВ)', padLeft + plotW / 2, h - 8);

    ctx.save();
    ctx.translate(14, padTop + plotH / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText('Число отсчетов N (имп)', 0, 0);
    ctx.restore();
  }, [spectrumData, instrument, isBlindMode]);

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas || !spectrumData) return;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;

    const padLeft = 45;
    const padRight = 20;
    const plotW = canvas.width - padLeft - padRight;
    const maxE = spectrumData.energyPerChannelKev * spectrumData.channels.length;

    if (x >= padLeft && x <= canvas.width - padRight) {
      const frac = (x - padLeft) / plotW;
      const energy = frac * maxE;
      const ch = Math.min(spectrumData.channels.length - 1, Math.max(0, Math.floor(frac * spectrumData.channels.length)));
      setHoverEnergy(Math.round(energy * 10) / 10);
      setHoverCounts(spectrumData.channels[ch]);
    } else {
      setHoverEnergy(null);
      setHoverCounts(null);
    }
  };

  const handleVerdictSubmit = () => {
    if (!studentSelectedNuclide) return;
    const isCorrect = studentSelectedNuclide.toLowerCase() === activeIsotopeId.toLowerCase();
    if (isCorrect) {
      setVerdictFeedback('ВЕРНО: изотоп успешно идентифицирован по характеристическому спектру.');
      onIdentifyVerdict?.(studentSelectedNuclide);
    } else {
      setVerdictFeedback(`ОШИБКА: радионуклид ${studentSelectedNuclide} не соответствует положению пиков.`);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 bg-[#0B1117]/80 backdrop-blur-md flex items-center justify-center p-3 font-sans">
      <div className="alara-glass-elevated max-w-4xl w-full rounded-xl p-5 flex flex-col gap-4 max-h-[92vh] overflow-hidden text-[#F1F5F9]">

        {/* Заголовок */}
        <div className="flex justify-between items-center border-b border-[rgba(148,163,184,0.16)] pb-3 shrink-0">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-[#0EA5E9]/15 text-[#0EA5E9] rounded-[10px] border border-[#0EA5E9]/35">
              <Activity className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-[#F1F5F9]">
                Многоканальный амплитудный анализатор (МКА) · {instrument.name}
              </h2>
              <p className="text-xs text-[#94A3B8] mt-0.5">
                {instrument.hasSpectrometryMode
                  ? 'Спектрометрический тракт активен: разрешение позволяет идентифицировать нуклиды.'
                  : 'Выбранный дозиметр работает в интегральном режиме. Для спектрометрии используйте NaI(Tl) или CdZnTe.'}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-[#94A3B8] hover:text-[#F1F5F9] p-2 rounded-[10px] hover:bg-white/5 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* График спектра Canvas */}
        <div className="relative rounded-xl overflow-hidden alara-surface p-2">
          <canvas
            ref={canvasRef}
            width={720}
            height={300}
            className="w-full h-[280px] cursor-crosshair block rounded-[8px]"
            onMouseMove={handleMouseMove}
            onMouseLeave={() => {
              setHoverEnergy(null);
              setHoverCounts(null);
            }}
          />

          {hoverEnergy !== null && (
            <div className="absolute top-4 right-4 bg-[#0B1117]/90 border border-[rgba(148,163,184,0.2)] rounded-[10px] px-3 py-1.5 font-mono alara-tabular text-xs">
              <span className="text-[#94A3B8]">E: </span>
              <span className="text-[#0EA5E9] font-bold">{hoverEnergy} кэВ</span>
              <span className="text-[#64748B] mx-2">|</span>
              <span className="text-[#94A3B8]">N: </span>
              <span className="text-[#F59E0B] font-bold">{hoverCounts} имп</span>
            </div>
          )}
        </div>

        {/* Панель идентификации и характеристик */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs overflow-y-auto">
          <div className="p-3.5 rounded-xl alara-surface space-y-2">
            <h4 className="font-bold text-[#94A3B8] uppercase tracking-wider">
              Фотопики полного поглощения
            </h4>
            {spectrumData?.peaks && spectrumData.peaks.length > 0 ? (
              <div className="space-y-1.5">
                {spectrumData.peaks.map((p, idx) => (
                  <div key={idx} className="flex justify-between items-center p-2 rounded-[10px] bg-[#0B1117]/70 border border-[rgba(148,163,184,0.14)] font-mono alara-tabular">
                    <div>
                      <span className="text-[#EF4444] font-bold">{p.energyKev.toFixed(1)} кэВ</span>
                      <span className="text-[#64748B] text-[11px] ml-2">(FWHM: {p.fwhmKev} кэВ)</span>
                    </div>
                    <div className="text-[#94A3B8]">
                      S_net: <strong className="text-[#0EA5E9]">{p.netCounts}</strong> имп
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-[#64748B] p-2">
                Фотопики не выражены или мощность дозы ниже порога статистической достоверности.
              </div>
            )}
          </div>

          <div className="p-3.5 rounded-xl alara-surface space-y-2.5">
            <h4 className="font-bold text-[#94A3B8] uppercase tracking-wider flex items-center gap-1.5">
              <Search className="w-4 h-4 text-[#0EA5E9]" />
              <span>Идентификация радионуклида</span>
            </h4>

            {isBlindMode ? (
              <div className="space-y-2">
                <p className="text-[#F59E0B] text-xs">
                  Режим слепой идентификации: проанализируйте пики и выберите изотоп.
                </p>
                <div className="flex gap-2">
                  <select
                    value={studentSelectedNuclide}
                    onChange={e => setStudentSelectedNuclide(e.target.value)}
                    className="flex-1 bg-[#0B1117] border border-[rgba(148,163,184,0.2)] rounded-[10px] px-2.5 py-1.5 font-mono text-[#0EA5E9]"
                  >
                    <option value="">-- Выберите изотоп --</option>
                    <option value="Cs-137">Cs-137 (Цезий-137, 661.7 кэВ)</option>
                    <option value="Co-60">Co-60 (Кобальт-60, 1173 + 1332 кэВ)</option>
                    <option value="Am-241">Am-241 (Америций-241, 59.5 кэВ)</option>
                    <option value="Sr-90">Sr-90 (Стронций-90, чистый бета-спектр)</option>
                    <option value="Pu-239">Pu-239 (Плутоний-239, 51.6 кэВ)</option>
                    <option value="Cf-252">Cf-252 (Калифорний-252, нейтроны + γ)</option>
                  </select>
                  <button
                    onClick={handleVerdictSubmit}
                    className="px-3 py-1.5 bg-[#0EA5E9] hover:bg-[#38BDF8] text-[#0B1117] font-bold rounded-[10px] transition"
                  >
                    Подтвердить
                  </button>
                </div>
                {verdictFeedback && (
                  <div className={`p-2 rounded-[10px] border text-xs font-semibold ${verdictFeedback.startsWith('ВЕРНО') ? 'bg-[#10B981]/10 border-[#10B981]/35 text-[#10B981]' : 'bg-[#EF4444]/10 border-[#EF4444]/35 text-[#EF4444]'}`}>
                    {verdictFeedback}
                  </div>
                )}
              </div>
            ) : (
              <div className="space-y-2">
                {spectrumData?.identifiedIsotopes && spectrumData.identifiedIsotopes.length > 0 ? (
                  spectrumData.identifiedIsotopes.map((iso, i) => (
                    <div key={i} className="p-2.5 rounded-[10px] bg-[#10B981]/10 border border-[#10B981]/30 flex items-center justify-between">
                      <div>
                        <div className="font-bold text-[#10B981] text-sm">
                          {ISOTOPE_GAMMA_PEAKS[iso.isotopeId]?.nameRu || iso.isotopeId}
                        </div>
                        <div className="text-[11px] text-[#94A3B8] mt-0.5">
                          Библиотечное совпадение линий по ГОСТ
                        </div>
                      </div>
                      <div className="text-right font-mono alara-tabular font-bold text-[#10B981]">
                        {iso.confidencePercent.toFixed(1)}%
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="text-[#64748B]">Набор спектра продолжается...</div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Нижняя панель */}
        <div className="flex justify-between items-center border-t border-[rgba(148,163,184,0.16)] pt-3 shrink-0 text-xs">
          <div className="flex items-center gap-2">
            <span className="text-[#94A3B8]">Время экспозиции:</span>
            <select
              value={acquisitionTimeSec}
              onChange={e => setAcquisitionTimeSec(parseInt(e.target.value) || 10)}
              className="bg-[#0B1117] border border-[rgba(148,163,184,0.2)] rounded-[10px] px-2.5 py-1 font-mono text-[#0EA5E9]"
            >
              <option value={5}>5 с (Экспресс)</option>
              <option value={10}>10 с (Стандарт)</option>
              <option value={30}>30 с (Высокая статистика)</option>
              <option value={60}>60 с (Прецизионный)</option>
            </select>
          </div>
          <button
            onClick={onClose}
            className="px-4 py-1.5 bg-white/10 hover:bg-white/15 text-[#F1F5F9] font-semibold rounded-[10px] transition"
          >
            Закрыть анализатор
          </button>
        </div>

      </div>
    </div>
  );
};
