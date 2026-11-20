/**
 * ALARA-Planner Pro VR — Модуль Гамма-спектрометрии и идентификации изотопов (МКА)
 * Отображает многоканальный амплитудный спектр импульсов, производит автоматический поиск пиков
 * и сопоставление с библиотекой нуклидов по ГОСТ 27451-87 и ГОСТ Р МЭК 61274.
 */

import React, { useEffect, useRef, useState } from 'react';
import {
  Activity,
  X,
  Target,
  Sparkles,
  Search,
  CheckCircle2,
  HelpCircle,
  BarChart2,
  RefreshCw,
  Zap,
  Info
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
  isBlindMode?: boolean; // Слепой режим (экзамен)
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
  const [isAccumulating, setIsAccumulating] = useState<boolean>(true);
  const [hoverEnergy, setHoverEnergy] = useState<number | null>(null);
  const [hoverCounts, setHoverCounts] = useState<number | null>(null);
  const [spectrumData, setSpectrumData] = useState<GammaSpectrumData | null>(null);
  const [studentSelectedNuclide, setStudentSelectedNuclide] = useState<string>('');
  const [verdictFeedback, setVerdictFeedback] = useState<string | null>(null);

  const instrument = GOST_INSTRUMENTS[selectedInstrumentId];

  // Генерация и обновление спектра
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

  // Отрисовка спектра на HTML5 Canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !spectrumData) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const w = canvas.width;
    const h = canvas.height;

    ctx.clearRect(0, 0, w, h);

    // Темный фон координатной сетки
    ctx.fillStyle = '#090d16';
    ctx.fillRect(0, 0, w, h);

    const padLeft = 45;
    const padRight = 20;
    const padTop = 20;
    const padBottom = 35;

    const plotW = w - padLeft - padRight;
    const plotH = h - padTop - padBottom;

    // Сетка
    ctx.strokeStyle = '#1e293b';
    ctx.lineWidth = 1;

    // Горизонтальные линии
    for (let i = 0; i <= 5; i++) {
      const y = padTop + (plotH / 5) * i;
      ctx.beginPath();
      ctx.moveTo(padLeft, y);
      ctx.lineTo(w - padRight, y);
      ctx.stroke();
    }

    // Вертикальные линии энергий (кэВ)
    const maxE = spectrumData.energyPerChannelKev * spectrumData.channels.length;
    for (let e = 0; e <= maxE; e += 250) {
      const x = padLeft + (e / maxE) * plotW;
      ctx.beginPath();
      ctx.moveTo(x, padTop);
      ctx.lineTo(x, h - padBottom);
      ctx.stroke();

      ctx.fillStyle = '#64748b';
      ctx.font = '10px monospace';
      ctx.textAlign = 'center';
      ctx.fillText(`${e}`, x, h - padBottom + 14);
    }

    // Поиск максимума импульсов
    const maxCounts = Math.max(10, ...spectrumData.channels);

    // Подписи осей
    ctx.fillStyle = '#94a3b8';
    ctx.font = '10px sans-serif';
    ctx.textAlign = 'right';
    for (let i = 0; i <= 5; i++) {
      const val = Math.round((maxCounts / 5) * (5 - i));
      const y = padTop + (plotH / 5) * i;
      ctx.fillText(`${val}`, padLeft - 6, y + 3);
    }

    // Градиент спектра
    const grad = ctx.createLinearGradient(0, padTop, 0, h - padBottom);
    grad.addColorStop(0, instrument.hasSpectrometryMode ? 'rgba(56, 189, 248, 0.65)' : 'rgba(234, 179, 8, 0.45)');
    grad.addColorStop(1, 'rgba(15, 23, 42, 0.05)');

    // Отрисовка области под кривой
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

    // Отрисовка контурной линии спектра
    ctx.beginPath();
    for (let i = 0; i < spectrumData.channels.length; i++) {
      const x = padLeft + (i / spectrumData.channels.length) * plotW;
      const count = spectrumData.channels[i];
      const y = h - padBottom - (count / maxCounts) * plotH;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = instrument.hasSpectrometryMode ? '#38bdf8' : '#eab308';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // Подсветка и аннотация фотопиков (если не в слепом режиме)
    if (!isBlindMode) {
      spectrumData.peaks.forEach(peak => {
        const peakX = padLeft + (peak.energyKev / maxE) * plotW;
        if (peakX < padLeft || peakX > w - padRight) return;

        // Вертикальная пунктирная линия
        ctx.setLineDash([3, 3]);
        ctx.strokeStyle = '#f43f5e';
        ctx.beginPath();
        ctx.moveTo(peakX, padTop);
        ctx.lineTo(peakX, h - padBottom);
        ctx.stroke();
        ctx.setLineDash([]);

        // Метка пика
        ctx.fillStyle = '#f43f5e';
        ctx.beginPath();
        ctx.arc(peakX, padTop + 14, 4, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = '#fecdd3';
        ctx.font = 'bold 11px monospace';
        ctx.textAlign = 'center';
        ctx.fillText(`${peak.energyKev.toFixed(0)} кэВ`, peakX, padTop + 8);
      });
    }

    // Подпись осей
    ctx.fillStyle = '#94a3b8';
    ctx.font = '11px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Энергия излучения E_γ (кэВ)', padLeft + plotW / 2, h - 8);

    ctx.save();
    ctx.translate(14, padTop + plotH / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText('Число отсчетов N (имп)', 0, 0);
    ctx.restore();
  }, [spectrumData, instrument, isBlindMode]);

  // Обработка движения мыши над канвасом для считывания энергии
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
      setVerdictFeedback('✓ ВЕРНО! Изотоп успешно идентифицирован по характеристическому спектру.');
      onIdentifyVerdict?.(studentSelectedNuclide);
    } else {
      setVerdictFeedback(`✕ ОШИБКА: Выбранный радионуклид ${studentSelectedNuclide} не соответствует наблюдаемому положению пиков.`);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/85 backdrop-blur-md flex items-center justify-center p-3 font-sans">
      <div className="glass-panel max-w-4xl w-full rounded-2xl p-5 border border-sky-500/40 flex flex-col gap-4 max-h-[92vh] overflow-hidden shadow-2xl bg-slate-950/95 text-slate-100">
        
        {/* Заголовок */}
        <div className="flex justify-between items-center border-b border-slate-800 pb-3 shrink-0">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-sky-500/20 text-sky-400 rounded-xl border border-sky-500/40">
              <Activity className="w-6 h-6" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-white flex items-center gap-2">
                <span>Многоканальный амплитудный анализатор (МКА)</span>
                <span className="text-xs px-2 py-0.5 rounded bg-sky-500/20 text-sky-300 border border-sky-500/40 font-mono">
                  {instrument.name}
                </span>
              </h2>
              <p className="text-xs text-slate-400 mt-0.5">
                {instrument.hasSpectrometryMode
                  ? 'Спектрометрический тракт активен: разрешение по энергии позволяет идентифицировать нуклиды.'
                  : 'Внимание: выбранный дозиметр работает в интегральном счетном режиме. Для детальной спектрометрии используйте NaI(Tl) или CdZnTe.'}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-white p-2 rounded-lg hover:bg-slate-800 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* График спектра Canvas */}
        <div className="relative rounded-xl overflow-hidden border border-slate-800 bg-slate-900/60 p-2">
          <canvas
            ref={canvasRef}
            width={720}
            height={300}
            className="w-full h-[280px] cursor-crosshair block"
            onMouseMove={handleMouseMove}
            onMouseLeave={() => {
              setHoverEnergy(null);
              setHoverCounts(null);
            }}
          />

          {/* Плавающий считыватель курсора */}
          {hoverEnergy !== null && (
            <div className="absolute top-4 right-4 bg-slate-950/90 border border-slate-700 rounded-lg px-3 py-1.5 font-mono text-xs shadow-lg backdrop-blur">
              <span className="text-slate-400">E: </span>
              <span className="text-sky-300 font-bold">{hoverEnergy} кэВ</span>
              <span className="text-slate-500 mx-2">|</span>
              <span className="text-slate-400">N: </span>
              <span className="text-amber-300 font-bold">{hoverCounts} имп</span>
            </div>
          )}
        </div>

        {/* Панель идентификации и характеристик */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
          
          {/* Левая колонка: Пики и параметры набора */}
          <div className="p-3.5 rounded-xl bg-slate-900/70 border border-slate-800 space-y-2">
            <h4 className="font-bold text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
              <Sparkles className="w-4 h-4 text-amber-400" />
              <span>Обнаруженные фотопики полного поглощения:</span>
            </h4>
            {spectrumData?.peaks && spectrumData.peaks.length > 0 ? (
              <div className="space-y-1.5">
                {spectrumData.peaks.map((p, idx) => (
                  <div key={idx} className="flex justify-between items-center p-2 rounded bg-slate-950 border border-slate-800 font-mono">
                    <div>
                      <span className="text-rose-400 font-bold">{p.energyKev.toFixed(1)} кэВ</span>
                      <span className="text-slate-500 text-[11px] ml-2">(FWHM: {p.fwhmKev} кэВ)</span>
                    </div>
                    <div className="text-slate-400">
                      S_net: <strong className="text-cyan-300">{p.netCounts}</strong> имп
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-slate-500 italic p-2">
                Фотопики не выражены или мощность дозы ниже порога статистической достоверности.
              </div>
            )}
          </div>

          {/* Правая колонка: Результат идентификации / Слепой вердикт студента */}
          <div className="p-3.5 rounded-xl bg-slate-900/70 border border-slate-800 space-y-2.5">
            <h4 className="font-bold text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
              <Search className="w-4 h-4 text-sky-400" />
              <span>Идентификация радионуклида:</span>
            </h4>

            {isBlindMode ? (
              <div className="space-y-2">
                <p className="text-amber-300 text-xs">
                  Режим слепой идентификации: проанализируйте положение пиков и выберите изотоп вручную.
                </p>
                <div className="flex gap-2">
                  <select
                    value={studentSelectedNuclide}
                    onChange={e => setStudentSelectedNuclide(e.target.value)}
                    className="flex-1 bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-1.5 font-mono text-cyan-300"
                  >
                    <option value="">-- Выберите предполагаемый изотоп --</option>
                    <option value="Cs-137">¹³⁷Cs (Цезий-137, 661.7 кэВ)</option>
                    <option value="Co-60">⁶⁰Co (Кобальт-60, 1173 + 1332 кэВ)</option>
                    <option value="Am-241">²⁴¹Am (Америций-241, 59.5 кэВ)</option>
                    <option value="Sr-90">⁹⁰Sr (Стронций-90, чистый бета-спектр)</option>
                    <option value="Pu-239">²³⁹Pu (Плутоний-239, 51.6 кэВ)</option>
                    <option value="Cf-252">²⁵²Cf (Калифорний-252, нейтроны + γ)</option>
                  </select>
                  <button
                    onClick={handleVerdictSubmit}
                    className="px-3 py-1.5 bg-sky-500 hover:bg-sky-400 text-slate-950 font-bold rounded-lg transition"
                  >
                    Подтвердить
                  </button>
                </div>
                {verdictFeedback && (
                  <div className={`p-2 rounded border text-xs font-semibold ${verdictFeedback.startsWith('✓') ? 'bg-emerald-950/40 border-emerald-500/40 text-emerald-300' : 'bg-rose-950/40 border-rose-500/40 text-rose-300'}`}>
                    {verdictFeedback}
                  </div>
                )}
              </div>
            ) : (
              <div className="space-y-2">
                {spectrumData?.identifiedIsotopes && spectrumData.identifiedIsotopes.length > 0 ? (
                  spectrumData.identifiedIsotopes.map((iso, i) => (
                    <div key={i} className="p-2.5 rounded-lg bg-emerald-950/30 border border-emerald-500/40 flex items-center justify-between">
                      <div>
                        <div className="font-bold text-emerald-300 text-sm">
                          {ISOTOPE_GAMMA_PEAKS[iso.isotopeId]?.nameRu || iso.isotopeId}
                        </div>
                        <div className="text-[11px] text-slate-400 mt-0.5">
                          Библиотечное совпадение спектральных линий по ГОСТ
                        </div>
                      </div>
                      <div className="text-right">
                        <span className="text-xs px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 font-mono font-bold">
                          {iso.confidencePercent.toFixed(1)}%
                        </span>
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="text-slate-500 italic">Набор спектра продолжается...</div>
                )}
              </div>
            )}
          </div>

        </div>

        {/* Нижняя панель управления */}
        <div className="flex justify-between items-center border-t border-slate-800 pt-2 shrink-0 text-xs">
          <div className="flex items-center gap-2">
            <span className="text-slate-400">Время экспозиции:</span>
            <select
              value={acquisitionTimeSec}
              onChange={e => setAcquisitionTimeSec(parseInt(e.target.value) || 10)}
              className="bg-slate-900 border border-slate-700 rounded px-2 py-1 font-mono text-cyan-300"
            >
              <option value={5}>5 секунд (Экспресс)</option>
              <option value={10}>10 секунд (Стандарт)</option>
              <option value={30}>30 секунд (Высокая статистика)</option>
              <option value={60}>60 секунд (Прецизионный)</option>
            </select>
          </div>
          <button
            onClick={onClose}
            className="px-4 py-1.5 bg-slate-800 hover:bg-slate-700 text-white font-bold rounded-lg transition"
          >
            Закрыть анализатор
          </button>
        </div>

      </div>
    </div>
  );
};
