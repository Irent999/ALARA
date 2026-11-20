import React, { useState } from 'react';
import {
  BookOpen,
  X,
  Check,
  Volume2,
  ShieldCheck,
  Zap,
  AlertCircle,
  Activity,
  Layers,
  HelpCircle,
  Cpu,
  Calculator,
  Box
} from 'lucide-react';
import { GOST_INSTRUMENTS, InstrumentId, InstrumentProfile } from '../instruments/gostInstruments';
import { Equipment3DInspector } from './Equipment3DInspector';

interface GostInstrumentsModalProps {
  isOpen: boolean;
  onClose: () => void;
  selectedInstrumentId: InstrumentId;
  onSelectInstrument: (id: InstrumentId) => void;
}

export const GostInstrumentsModal: React.FC<GostInstrumentsModalProps> = ({
  isOpen,
  onClose,
  selectedInstrumentId,
  onSelectInstrument
}) => {
  const [activeTab, setActiveTab] = useState<'inspector3d' | 'all' | 'formulas' | InstrumentId>('inspector3d');

  if (!isOpen) return null;

  const instrumentsList: InstrumentProfile[] = Object.values(GOST_INSTRUMENTS);

  const filteredInstruments = activeTab === 'all'
    ? instrumentsList
    : instrumentsList.filter(i => i.id === activeTab);

  return (
    <div className="fixed inset-0 z-50 bg-black/85 backdrop-blur-md flex items-center justify-center p-4">
      <div className="glass-panel max-w-5xl w-full rounded-2xl p-6 border border-yellow-500/40 flex flex-col gap-5 max-h-[92vh] overflow-hidden shadow-2xl">
        {/* Заголовок */}
        <div className="flex justify-between items-center border-b border-slate-700/80 pb-4 shrink-0">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-yellow-500/20 text-yellow-400 rounded-xl border border-yellow-500/30">
              <BookOpen className="w-6 h-6" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-white flex items-center gap-2">
                <span>Справочник дозиметрических средств измерений</span>
                <span className="text-xs px-2 py-0.5 rounded bg-yellow-500/20 text-yellow-400 border border-yellow-500/40 font-mono">
                  ГОСТ 27451-87
                </span>
              </h2>
              <p className="text-xs text-slate-400 mt-0.5">
                Метрологические характеристики, погрешности, диапазоны и правила применения в радиационной безопасности
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-white p-2 rounded-lg hover:bg-slate-800 transition"
            title="Закрыть справочник (✕)"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Интерактивные вкладки (Tabs) */}
        <div className="flex flex-wrap gap-2 border-b border-slate-800 pb-3 shrink-0">
          <button
            onClick={() => setActiveTab('inspector3d')}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold transition flex items-center gap-1.5 whitespace-nowrap ${
              activeTab === 'inspector3d'
                ? 'bg-yellow-500 text-black shadow-md'
                : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
            }`}
          >
            <Box className="w-3.5 h-3.5" />
            <span>3D CAD / PBR Инспектор</span>
          </button>
          <button
            onClick={() => setActiveTab('all')}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold transition flex items-center gap-1.5 whitespace-nowrap ${
              activeTab === 'all'
                ? 'bg-yellow-500 text-black shadow-md'
                : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
            }`}
          >
            <Layers className="w-3.5 h-3.5" />
            <span>Все детекторы ({instrumentsList.length})</span>
          </button>
          {instrumentsList.map(inst => (
            <button
              key={inst.id}
              onClick={() => setActiveTab(inst.id)}
              className={`px-2.5 py-1.5 rounded-xl text-xs font-bold transition flex items-center gap-1.5 whitespace-nowrap ${
                activeTab === inst.id
                  ? 'bg-yellow-500 text-black shadow-md'
                  : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
              }`}
            >
              <span>{inst.name.split('/')[0].trim()}</span>
            </button>
          ))}
          <button
            onClick={() => setActiveTab('formulas')}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold transition flex items-center gap-1.5 ml-auto ${
              activeTab === 'formulas'
                ? 'bg-amber-500 text-black shadow-md'
                : 'bg-slate-800/80 text-amber-300 hover:bg-slate-700 border border-amber-500/30'
            }`}
          >
            <Calculator className="w-3.5 h-3.5" />
            <span>Формулы & ГОСТ</span>
          </button>
        </div>

        {/* Тело модального окна */}
        <div className="overflow-y-auto pr-1 flex flex-col gap-4">
          {activeTab === 'inspector3d' ? (
            <Equipment3DInspector
              selectedInstrumentId={selectedInstrumentId}
              onSelectInstrument={onSelectInstrument}
            />
          ) : activeTab === 'formulas' ? (
            /* Вкладка формул и теории ГОСТ */
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
              <div className="p-4 rounded-xl bg-slate-900/80 border border-slate-800 space-y-3">
                <h4 className="font-bold text-yellow-400 text-sm flex items-center gap-2">
                  <Calculator className="w-4 h-4" />
                  <span>1. Эквивалентная доза и закон обратных квадратов</span>
                </h4>
                <div className="p-3 bg-slate-950 font-mono text-emerald-400 rounded-lg border border-slate-800">
                  H = D · w_R<br />
                  Ḋ = (Г · A) / r²
                </div>
                <p className="text-slate-300 leading-relaxed">
                  По <b>ГОСТ Р 8.804-2012</b> мощность поглощенной дозы Ḋ от точечного гамма-источника активностью A
                  на расстоянии r пропорциональна дифференциальной гамма-постоянной Г. Эквивалентная доза H
                  учитывает биологическую взвешенность w_R (для гамма и бета w_R = 1, для нейтронов w_R = 5...20).
                </p>
              </div>

              <div className="p-4 rounded-xl bg-slate-900/80 border border-slate-800 space-y-3">
                <h4 className="font-bold text-yellow-400 text-sm flex items-center gap-2">
                  <ShieldCheck className="w-4 h-4" />
                  <span>2. Фактор накопления Тейлора (Taylor Buildup)</span>
                </h4>
                <div className="p-3 bg-slate-950 font-mono text-cyan-400 rounded-lg border border-slate-800">
                  K = B · exp(-μ · d)<br />
                  B = A₁ · exp(-α₁ · μd) + (1 - A₁) · exp(-α₂ · μd)
                </div>
                <p className="text-slate-300 leading-relaxed">
                  Учитывает вклад многократно рассеянных фотонов в толще тяжелой биологической защиты.
                  Для свинца (Pb) накопление минимально из-за преобладания фотоэффекта, для бетона и воды
                  рассеяние дает кратный прирост мощности дозы за барьером.
                </p>
              </div>

              <div className="p-4 rounded-xl bg-slate-900/80 border border-slate-800 space-y-3">
                <h4 className="font-bold text-yellow-400 text-sm flex items-center gap-2">
                  <Layers className="w-4 h-4" />
                  <span>3. Слои половинного (HVL) и десятикратного (TVL) ослабления</span>
                </h4>
                <div className="p-3 bg-slate-950 font-mono text-purple-400 rounded-lg border border-slate-800">
                  d₁/₂ = ln(2) / μ = 0.693 / μ<br />
                  d₁/₁₀ = ln(10) / μ = 2.303 / μ
                </div>
                <p className="text-slate-300 leading-relaxed">
                  Толщина защитного материала, необходимая для снижения первичного фотонного пучка в 2 и в 10 раз.
                  Для ⁶⁰Co в свинце d₁/₂ ≈ 1.1 см, в бетоне ≈ 5.3 см.
                </p>
              </div>

              <div className="p-4 rounded-xl bg-slate-900/80 border border-slate-800 space-y-3">
                <h4 className="font-bold text-yellow-400 text-sm flex items-center gap-2">
                  <Activity className="w-4 h-4" />
                  <span>4. Нормативы ОСПОРБ-99/2010 и пределы ALARA</span>
                </h4>
                <div className="p-3 bg-slate-950 font-mono text-amber-400 rounded-lg border border-slate-800">
                  Персонал группы А: 20 мЗв/год (сменный предел ~0.08 мЗв)<br />
                  Население / Свободный режим: 1 мЗв/год (фоновый предел 0.3 мкЗв/ч)
                </div>
                <p className="text-slate-300 leading-relaxed">
                  Концепция ALARA (As Low As Reasonably Achievable): любое облучение должно быть удержано на столь низком
                  уровне, насколько это разумно достижимо с учетом экономических и социальных факторов.
                </p>
              </div>
            </div>
          ) : (
            /* Список карточек приборов */
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {filteredInstruments.map(inst => {
                const isSelected = inst.id === selectedInstrumentId;

                return (
                  <div
                    key={inst.id}
                    onClick={() => onSelectInstrument(inst.id)}
                    className={`p-5 rounded-2xl border transition-all cursor-pointer flex flex-col justify-between ${
                      isSelected
                        ? 'border-yellow-500 bg-yellow-500/10 shadow-xl shadow-yellow-500/10'
                        : 'border-slate-800 bg-slate-900/70 hover:border-slate-700 hover:bg-slate-900/90'
                    }`}
                  >
                    <div>
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <span className="text-[10px] font-bold tracking-wider px-2 py-0.5 rounded bg-slate-800 text-yellow-400 uppercase font-mono">
                            {inst.gostStandard}
                          </span>
                          <h3 className="text-base font-bold text-white mt-1.5">{inst.name}</h3>
                          <p className="text-xs text-slate-300 font-medium">{inst.nameFull}</p>
                        </div>
                        {isSelected ? (
                          <div className="px-3 py-1 bg-yellow-500 text-black font-extrabold text-xs rounded-xl flex items-center gap-1 shrink-0 shadow-md">
                            <Check className="w-3.5 h-3.5" /> Активен
                          </div>
                        ) : (
                          <button
                            onClick={e => {
                              e.stopPropagation();
                              onSelectInstrument(inst.id);
                            }}
                            className="px-3 py-1 bg-slate-800 hover:bg-yellow-500 hover:text-black text-xs font-bold rounded-xl transition text-slate-200 shrink-0"
                          >
                            Выбрать
                          </button>
                        )}
                      </div>

                      {/* Метрологические параметры по ГОСТ */}
                      <div className="mt-3.5 space-y-2 text-xs">
                        <div className="bg-slate-950/70 p-3 rounded-xl border border-slate-800/80 space-y-1.5">
                          <div className="flex justify-between">
                            <span className="text-slate-400">Первичный детектор:</span>
                            <span className="font-semibold text-slate-200 text-right max-w-[240px]">
                              {inst.detectorTypeRu}
                            </span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-slate-400">Диапазон Ḣ*(10):</span>
                            <span className="font-semibold text-yellow-300">{inst.measurementRangeRu}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-slate-400">Энергетический диапазон:</span>
                            <span className="font-semibold text-slate-200">{inst.energyRangeRu}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-slate-400">Основная погрешность:</span>
                            <span className="font-mono font-bold text-emerald-400">±{inst.basicErrorPercent}%</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-slate-400">Инерционность (τ усреднения):</span>
                            <span className="font-mono text-slate-200">{inst.timeConstantSec} сек</span>
                          </div>
                        </div>

                        {/* Назначение */}
                        <div className="pt-1">
                          <span className="text-slate-400 font-semibold">Назначение по ГОСТ:</span>
                          <p className="text-slate-300 mt-0.5 leading-relaxed text-[11px]">{inst.applicationRu}</p>
                        </div>

                        {/* Преимущества и ограничения */}
                        <div className="grid grid-cols-2 gap-2 pt-2 border-t border-slate-800/80 text-[11px]">
                          <div>
                            <span className="text-emerald-400 font-bold flex items-center gap-1">
                              <ShieldCheck className="w-3 h-3" /> Преимущества:
                            </span>
                            <ul className="list-disc list-inside text-slate-300 mt-1 space-y-0.5">
                              {inst.advantagesRu.map((adv, idx) => (
                                <li key={idx} className="leading-tight">{adv}</li>
                              ))}
                            </ul>
                          </div>
                          <div>
                            <span className="text-amber-400 font-bold flex items-center gap-1">
                              <AlertCircle className="w-3 h-3" /> Ограничения:
                            </span>
                            <ul className="list-disc list-inside text-slate-300 mt-1 space-y-0.5">
                              {inst.limitationsRu.map((lim, idx) => (
                                <li key={idx} className="leading-tight">{lim}</li>
                              ))}
                            </ul>
                          </div>
                        </div>
                      </div>
                    </div>

                    <button
                      onClick={() => onSelectInstrument(inst.id)}
                      className={`w-full mt-4 py-2 rounded-xl text-xs font-bold transition flex items-center justify-center gap-2 ${
                        isSelected
                          ? 'bg-yellow-500/20 text-yellow-400 border border-yellow-500/40'
                          : 'bg-slate-800 hover:bg-yellow-500 hover:text-black text-slate-200'
                      }`}
                    >
                      <Volume2 className="w-3.5 h-3.5" />
                      <span>{isSelected ? 'Прибор уже выбран' : 'Применить данный прибор в руку'}</span>
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Футер */}
        <div className="flex justify-between items-center pt-3 border-t border-slate-800 text-xs text-slate-400 shrink-0">
          <div>Все приборы поверены согласно требованиям ГОСТ 8.087-2000 и ОСПОРБ-99/2010.</div>
          <button
            onClick={onClose}
            className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-white font-semibold rounded-xl transition"
          >
            Закрыть справочник
          </button>
        </div>
      </div>
    </div>
  );
};
