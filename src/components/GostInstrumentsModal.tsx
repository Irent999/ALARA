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
    <div className="fixed inset-0 z-50 bg-[#0B1117]/75 flex items-center justify-center p-4 font-sans select-none">
      <div className="alara-glass-elevated max-w-5xl w-full rounded-xl p-6 flex flex-col gap-5 max-h-[92vh] overflow-hidden text-[#F1F5F9]">
        {/* Заголовок */}
        <div className="flex justify-between items-center border-b border-slate-400/15 pb-4 shrink-0">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-[#0EA5E9]/15 text-[#0EA5E9] rounded-[10px] border border-[#0EA5E9]/35">
              <BookOpen className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2 text-xs text-[#94A3B8]">
                <span className="font-mono text-[#F59E0B] font-semibold">ГОСТ 27451-87</span>
                <span aria-hidden="true">·</span>
                <span>Метрологический справочник</span>
              </div>
              <h2 className="text-lg font-semibold text-[#F1F5F9]">
                Справочник дозиметрических средств измерений
              </h2>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-[#94A3B8] hover:text-[#F1F5F9] p-2 rounded-[10px] alara-surface hover:bg-slate-800/80 transition cursor-pointer"
            title="Закрыть справочник"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Интерактивные вкладки */}
        <div className="flex flex-wrap gap-1.5 border-b border-slate-400/15 pb-3 shrink-0">
          <button
            onClick={() => setActiveTab('inspector3d')}
            className={`px-3 py-1.5 rounded-[10px] text-xs font-semibold transition flex items-center gap-1.5 whitespace-nowrap cursor-pointer ${
              activeTab === 'inspector3d'
                ? 'bg-[#0EA5E9] text-[#0B1117]'
                : 'alara-surface text-[#94A3B8] hover:text-[#F1F5F9]'
            }`}
          >
            <Box className="w-3.5 h-3.5" />
            <span>3D CAD / PBR Инспектор</span>
          </button>
          <button
            onClick={() => setActiveTab('all')}
            className={`px-3 py-1.5 rounded-[10px] text-xs font-semibold transition flex items-center gap-1.5 whitespace-nowrap cursor-pointer ${
              activeTab === 'all'
                ? 'bg-[#0EA5E9] text-[#0B1117]'
                : 'alara-surface text-[#94A3B8] hover:text-[#F1F5F9]'
            }`}
          >
            <Layers className="w-3.5 h-3.5" />
            <span>Все детекторы ({instrumentsList.length})</span>
          </button>
          {instrumentsList.map(inst => (
            <button
              key={inst.id}
              onClick={() => setActiveTab(inst.id)}
              className={`px-2.5 py-1.5 rounded-[10px] text-xs font-medium transition flex items-center gap-1.5 whitespace-nowrap cursor-pointer ${
                activeTab === inst.id
                  ? 'bg-[#0EA5E9] text-[#0B1117] font-semibold'
                  : 'alara-surface text-[#94A3B8] hover:text-[#F1F5F9]'
              }`}
            >
              <span>{inst.name.split('/')[0].trim()}</span>
            </button>
          ))}
          <button
            onClick={() => setActiveTab('formulas')}
            className={`px-3 py-1.5 rounded-[10px] text-xs font-semibold transition flex items-center gap-1.5 ml-auto cursor-pointer ${
              activeTab === 'formulas'
                ? 'bg-[#F59E0B] text-[#0B1117]'
                : 'alara-surface text-[#F59E0B] border-[#F59E0B]/35 hover:bg-[#F59E0B]/15'
            }`}
          >
            <Calculator className="w-3.5 h-3.5" />
            <span>Формулы и ГОСТ</span>
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
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
              <div className="p-4 rounded-xl alara-surface space-y-3">
                <h4 className="font-semibold text-[#F59E0B] text-sm flex items-center gap-2">
                  <Calculator className="w-4 h-4" />
                  <span>1. Эквивалентная доза и закон обратных квадратов</span>
                </h4>
                <div className="p-3 bg-[#0B1117] font-mono text-[#10B981] rounded-[10px] border border-slate-400/15">
                  H = D · w_R<br />
                  Ḋ = (Г · A) / r²
                </div>
                <p className="text-[#94A3B8] leading-relaxed">
                  По <b className="text-[#F1F5F9]">ГОСТ Р 8.804-2012</b> мощность поглощенной дозы Ḋ от точечного гамма-источника активностью A
                  на расстоянии r пропорциональна дифференциальной гамма-постоянной Г. Эквивалентная доза H
                  учитывает биологическую взвешенность w_R (для гамма и бета w_R = 1, для нейтронов w_R = 5...20).
                </p>
              </div>

              <div className="p-4 rounded-xl alara-surface space-y-3">
                <h4 className="font-semibold text-[#0EA5E9] text-sm flex items-center gap-2">
                  <ShieldCheck className="w-4 h-4" />
                  <span>2. Фактор накопления Тейлора (Taylor Buildup)</span>
                </h4>
                <div className="p-3 bg-[#0B1117] font-mono text-[#14B8A6] rounded-[10px] border border-slate-400/15">
                  K = B · exp(-μ · d)<br />
                  B = A₁ · exp(-α₁ · μd) + (1 - A₁) · exp(-α₂ · μd)
                </div>
                <p className="text-[#94A3B8] leading-relaxed">
                  Учитывает вклад многократно рассеянных фотонов в толще тяжелой биологической защиты.
                  Для свинца (Pb) накопление минимально из-за фотоэффекта, для бетона и воды
                  рассеяние дает кратный прирост мощности дозы за барьером.
                </p>
              </div>

              <div className="p-4 rounded-xl alara-surface space-y-3">
                <h4 className="font-semibold text-[#14B8A6] text-sm flex items-center gap-2">
                  <Layers className="w-4 h-4" />
                  <span>3. Слои половинного (HVL) и десятикратного (TVL) ослабления</span>
                </h4>
                <div className="p-3 bg-[#0B1117] font-mono text-[#0EA5E9] rounded-[10px] border border-slate-400/15">
                  d₁/₂ = ln(2) / μ = 0.693 / μ<br />
                  d₁/₁₀ = ln(10) / μ = 2.303 / μ
                </div>
                <p className="text-[#94A3B8] leading-relaxed">
                  Толщина защитного материала для снижения первичного фотонного пучка в 2 и 10 раз.
                  Для ⁶⁰Co в свинце d₁/₂ ≈ 1.1 см, в бетоне ≈ 5.3 см.
                </p>
              </div>

              <div className="p-4 rounded-xl alara-surface space-y-3">
                <h4 className="font-semibold text-[#F59E0B] text-sm flex items-center gap-2">
                  <Activity className="w-4 h-4" />
                  <span>4. Нормативы ОСПОРБ-99/2010 и пределы ALARA</span>
                </h4>
                <div className="p-3 bg-[#0B1117] font-mono text-[#F59E0B] rounded-[10px] border border-slate-400/15">
                  Персонал группы А: 20 мЗв/год (сменный предел ~0.08 мЗв)<br />
                  Население: 1 мЗв/год (фоновый предел 0.3 мкЗв/ч)
                </div>
                <p className="text-[#94A3B8] leading-relaxed">
                  Принцип ALARA: любое облучение должно удерживаться на разумно достижимом низком уровне
                  с помощью оптимизации времени, дистанции и экранирования.
                </p>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {filteredInstruments.map(inst => {
                const isSelected = inst.id === selectedInstrumentId;

                return (
                  <div
                    key={inst.id}
                    onClick={() => onSelectInstrument(inst.id)}
                    className={`p-5 rounded-xl border transition-all cursor-pointer flex flex-col justify-between ${
                      isSelected
                        ? 'border-[#0EA5E9] bg-[#0EA5E9]/10'
                        : 'alara-surface hover:border-slate-400/35'
                    }`}
                  >
                    <div>
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <span className="text-[11px] font-semibold text-[#F59E0B] font-mono">
                            {inst.gostStandard}
                          </span>
                          <h3 className="text-base font-semibold text-[#F1F5F9] mt-1">{inst.name}</h3>
                          <p className="text-xs text-[#94A3B8]">{inst.nameFull}</p>
                        </div>
                        {isSelected ? (
                          <div className="px-2.5 py-1 bg-[#10B981]/15 text-[#10B981] border border-[#10B981]/40 font-semibold text-xs rounded-[10px] flex items-center gap-1 shrink-0">
                            <Check className="w-3.5 h-3.5" /> Активен
                          </div>
                        ) : (
                          <button
                            onClick={e => {
                              e.stopPropagation();
                              onSelectInstrument(inst.id);
                            }}
                            className="px-3 py-1 bg-[#0EA5E9] hover:bg-sky-400 text-[#0B1117] text-xs font-semibold rounded-[10px] transition shrink-0 cursor-pointer"
                          >
                            Выбрать
                          </button>
                        )}
                      </div>

                      <div className="mt-3.5 space-y-2 text-xs">
                        <div className="bg-[#0B1117]/75 p-3 rounded-[10px] border border-slate-400/15 space-y-1.5">
                          <div className="flex justify-between gap-2">
                            <span className="text-[#94A3B8]">Первичный детектор:</span>
                            <span className="font-medium text-[#F1F5F9] text-right max-w-[240px]">
                              {inst.detectorTypeRu}
                            </span>
                          </div>
                          <div className="flex justify-between gap-2">
                            <span className="text-[#94A3B8]">Диапазон Ḣ*(10):</span>
                            <span className="font-mono alara-tabular font-semibold text-[#F59E0B]">{inst.measurementRangeRu}</span>
                          </div>
                          <div className="flex justify-between gap-2">
                            <span className="text-[#94A3B8]">Энергетический диапазон:</span>
                            <span className="font-mono alara-tabular text-[#F1F5F9]">{inst.energyRangeRu}</span>
                          </div>
                          <div className="flex justify-between gap-2">
                            <span className="text-[#94A3B8]">Основная погрешность:</span>
                            <span className="font-mono alara-tabular font-semibold text-[#10B981]">±{inst.basicErrorPercent}%</span>
                          </div>
                          <div className="flex justify-between gap-2">
                            <span className="text-[#94A3B8]">Инерционность (τ):</span>
                            <span className="font-mono alara-tabular text-[#F1F5F9]">{inst.timeConstantSec} сек</span>
                          </div>
                        </div>

                        <div className="pt-1">
                          <span className="text-[#94A3B8] font-medium">Назначение по ГОСТ:</span>
                          <p className="text-[#F1F5F9]/90 mt-0.5 leading-relaxed text-[11px]">{inst.applicationRu}</p>
                        </div>

                        <div className="grid grid-cols-2 gap-2 pt-2 border-t border-slate-400/15 text-[11px]">
                          <div>
                            <span className="text-[#10B981] font-semibold flex items-center gap-1">
                              <ShieldCheck className="w-3 h-3" /> Преимущества:
                            </span>
                            <ul className="list-disc list-inside text-[#94A3B8] mt-1 space-y-0.5">
                              {inst.advantagesRu.map((adv, idx) => (
                                <li key={idx} className="leading-tight">{adv}</li>
                              ))}
                            </ul>
                          </div>
                          <div>
                            <span className="text-[#F59E0B] font-semibold flex items-center gap-1">
                              <AlertCircle className="w-3 h-3" /> Ограничения:
                            </span>
                            <ul className="list-disc list-inside text-[#94A3B8] mt-1 space-y-0.5">
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
                      className={`w-full mt-4 py-2 rounded-[10px] text-xs font-semibold transition flex items-center justify-center gap-2 cursor-pointer ${
                        isSelected
                          ? 'bg-[#10B981]/15 text-[#10B981] border border-[#10B981]/40'
                          : 'bg-[#0EA5E9] hover:bg-sky-400 text-[#0B1117]'
                      }`}
                    >
                      <Volume2 className="w-3.5 h-3.5" />
                      <span>{isSelected ? 'Прибор уже выбран' : 'Применить прибор в руку'}</span>
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Футер */}
        <div className="flex justify-between items-center pt-3 border-t border-slate-400/15 text-xs text-[#94A3B8] shrink-0">
          <div>Все приборы поверены согласно ГОСТ 8.087-2000 и ОСПОРБ-99/2010.</div>
          <button
            onClick={onClose}
            className="px-4 py-2 alara-surface hover:bg-slate-800/80 text-[#F1F5F9] font-medium rounded-[10px] transition cursor-pointer"
          >
            Закрыть справочник
          </button>
        </div>
      </div>
    </div>
  );
};
