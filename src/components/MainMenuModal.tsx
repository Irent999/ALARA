/**
 * ALARA-Planner Pro VR — Главное меню виртуального лабораторного практикума (Main Menu UI)
 * Содержит 4 ключевых раздела:
 * 1. "Лабораторные работы" (Лабораторные 1, 2, 3 + выбор "Свободная лаборатория" / "Экзамен/Зачет")
 * 2. "База приборов и источников" (Каталог приборов по видам ИИ, карточки изотопов Co-60, Cs-137, Am-241, Sr-90, Pu-239, Cf-252)
 * 3. "Экипировка (СИЗ)" (3D-просмотр манекена с Orbit Controls и сменой СИЗ в реальном времени)
 * 4. "Настройки" (Звук, физика, ГОСТ константы, флаг скрытия начального окна выбора)
 */

import React, { useState } from 'react';
import {
  GraduationCap,
  BookOpen,
  Shield,
  Settings,
  X,
  Play,
  CheckCircle2,
  AlertCircle,
  Sparkles,
  Flame,
  Layers,
  Activity,
  Award,
  ChevronRight,
  Eye,
  EyeOff,
  Volume2,
  Atom,
  HelpCircle,
  FileSpreadsheet
} from 'lucide-react';
import { SCENARIOS, ScenarioDefinition } from '../scene/scenarios';
import { InstrumentId, GOST_INSTRUMENTS, InstrumentCategory } from '../instruments/gostInstruments';
import { ISOTOPE_DATABASE, IsotopeData, NORMAL_CONDITIONS, RemoteToolId } from '../physics/gostPhysics';
import { CharacterCustomizer3D, CharacterPPEState } from './CharacterCustomizer3D';

export type MainMenuTab = 'labs' | 'database' | 'ppe' | 'settings';

interface MainMenuModalProps {
  isOpen: boolean;
  onClose: () => void;
  activeScenarioId: number;
  onSelectScenario: (id: number) => void;
  isExamMode: boolean;
  onChangeExamMode: (exam: boolean) => void;
  selectedInstrumentId: InstrumentId;
  onSelectInstrument: (id: InstrumentId) => void;
  selectedIsotopeId: string;
  onSelectIsotope: (id: string) => void;
  ppeState: CharacterPPEState;
  onChangePPE: (state: CharacterPPEState) => void;
  selectedRemoteToolId?: RemoteToolId;
  onSelectRemoteTool?: (id: RemoteToolId) => void;
  hideStartupModal: boolean;
  onToggleHideStartupModal: (hide: boolean) => void;
  onOpenLabNotebook: () => void;
  onOpenSpectrometry: () => void;
}

export const MainMenuModal: React.FC<MainMenuModalProps> = ({
  isOpen,
  onClose,
  activeScenarioId,
  onSelectScenario,
  isExamMode,
  onChangeExamMode,
  selectedInstrumentId,
  onSelectInstrument,
  selectedIsotopeId,
  onSelectIsotope,
  ppeState,
  onChangePPE,
  selectedRemoteToolId,
  onSelectRemoteTool,
  hideStartupModal,
  onToggleHideStartupModal,
  onOpenLabNotebook,
  onOpenSpectrometry
}) => {
  const [activeTab, setActiveTab] = useState<MainMenuTab>('labs');
  const [dbSubTab, setDbSubTab] = useState<'instruments' | 'isotopes'>('instruments');
  const [instrumentCategoryFilter, setInstrumentCategoryFilter] = useState<string>('all');
  const [selectedDbNuclideKey, setSelectedDbNuclideKey] = useState<string>('Cs-137');

  if (!isOpen) return null;

  const currentLabScenario = SCENARIOS.find(s => s.id === activeScenarioId) || SCENARIOS[0];

  return (
    <div className="fixed inset-0 z-50 bg-black/90 backdrop-blur-lg flex items-center justify-center p-3 sm:p-5 font-sans select-none">
      <div className="glass-panel max-w-6xl w-full h-[92vh] rounded-3xl border border-sky-500/40 flex flex-col overflow-hidden shadow-2xl bg-slate-950/95 text-slate-100">
        
        {/* Верхняя шапка Главного Меню */}
        <header className="flex flex-wrap items-center justify-between gap-3 px-6 py-4 border-b border-slate-800 bg-slate-900/50 shrink-0">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-gradient-to-br from-sky-500 to-indigo-600 rounded-2xl shadow-lg shadow-sky-500/20 text-white">
              <GraduationCap className="w-6 h-6" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-xl font-black tracking-tight text-white uppercase">
                  Виртуальный Лабораторный Практикум
                </h1>
                <span className="text-[11px] px-2 py-0.5 rounded-full bg-sky-500/20 text-sky-300 border border-sky-500/30 font-mono font-bold">
                  ГОСТ Р 8.804 • НРБ-99/2009
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-0.5">
                Дозиметрия, радиационная физика и защита от ионизирующего излучения в среде WebXR / Three.js
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {/* Переключатель режимов: Свободная лабораторная / Экзамен */}
            <div className="flex items-center p-1 rounded-xl bg-slate-900 border border-slate-800 text-xs font-semibold">
              <button
                onClick={() => onChangeExamMode(false)}
                className={`px-3 py-1.5 rounded-lg transition ${
                  !isExamMode
                    ? 'bg-sky-500 text-slate-950 font-bold shadow-md'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                🔬 Свободная лабораторная
              </button>
              <button
                onClick={() => onChangeExamMode(true)}
                className={`px-3 py-1.5 rounded-lg transition ${
                  isExamMode
                    ? 'bg-amber-500 text-slate-950 font-bold shadow-md'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                🎓 Экзамен / Зачёт
              </button>
            </div>

            <button
              onClick={onClose}
              className="p-2 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 transition"
              title="Закрыть меню (Esc)"
            >
              <X className="w-6 h-6" />
            </button>
          </div>
        </header>

        {/* Навигационная панель разделов */}
        <nav className="flex items-center gap-2 px-6 py-2.5 border-b border-slate-800/80 bg-slate-950 shrink-0 text-xs font-bold">
          <button
            onClick={() => setActiveTab('labs')}
            className={`px-4 py-2 rounded-xl transition flex items-center gap-2 ${
              activeTab === 'labs'
                ? 'bg-sky-500 text-slate-950 shadow-md'
                : 'text-slate-400 hover:text-white hover:bg-slate-900'
            }`}
          >
            <BookOpen className="w-4 h-4" />
            <span>1. Лабораторные работы</span>
          </button>
          <button
            onClick={() => setActiveTab('database')}
            className={`px-4 py-2 rounded-xl transition flex items-center gap-2 ${
              activeTab === 'database'
                ? 'bg-sky-500 text-slate-950 shadow-md'
                : 'text-slate-400 hover:text-white hover:bg-slate-900'
            }`}
          >
            <Atom className="w-4 h-4" />
            <span>2. База приборов и источников</span>
          </button>
          <button
            onClick={() => setActiveTab('ppe')}
            className={`px-4 py-2 rounded-xl transition flex items-center gap-2 ${
              activeTab === 'ppe'
                ? 'bg-sky-500 text-slate-950 shadow-md'
                : 'text-slate-400 hover:text-white hover:bg-slate-900'
            }`}
          >
            <Shield className="w-4 h-4" />
            <span>3. Экипировка (СИЗ) и 3D-Манекен</span>
          </button>
          <button
            onClick={() => setActiveTab('settings')}
            className={`px-4 py-2 rounded-xl transition flex items-center gap-2 ${
              activeTab === 'settings'
                ? 'bg-sky-500 text-slate-950 shadow-md'
                : 'text-slate-400 hover:text-white hover:bg-slate-900'
            }`}
          >
            <Settings className="w-4 h-4" />
            <span>4. Настройки и Регламент</span>
          </button>
        </nav>

        {/* Основной контент активного раздела */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">

          {/* ===================================================================== */}
          {/* РАЗДЕЛ 1: ЛАБОРАТОРНЫЕ РАБОТЫ */}
          {/* ===================================================================== */}
          {activeTab === 'labs' && (
            <div className="space-y-6">
              
              {/* Баннер текущего режима */}
              <div className={`p-4 rounded-2xl border flex items-center justify-between ${
                isExamMode
                  ? 'bg-amber-950/30 border-amber-500/40 text-amber-200'
                  : 'bg-sky-950/30 border-sky-500/40 text-sky-200'
              }`}>
                <div>
                  <h3 className="font-bold text-sm flex items-center gap-2">
                    {isExamMode ? <Award className="w-4 h-4 text-amber-400" /> : <Sparkles className="w-4 h-4 text-sky-400" />}
                    <span>{isExamMode ? 'Режим экзамена и квалификационного зачёта' : 'Режим свободной лабораторной работы'}</span>
                  </h3>
                  <p className="text-xs opacity-80 mt-0.5">
                    {isExamMode
                      ? 'Маркеры изотопов скрыты. Необходим строгий расчет в журнале и защита отчета по критериям НРБ-99/2009.'
                      : 'Доступны подсказки, отображение траекторий частиц, формулы и ручной выбор оборудования.'}
                  </p>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={onOpenLabNotebook}
                    className="px-3.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-cyan-300 font-bold rounded-xl text-xs transition border border-slate-700 flex items-center gap-1.5"
                  >
                    <FileSpreadsheet className="w-3.5 h-3.5" />
                    <span>Лаб. Журнал</span>
                  </button>
                  <button
                    onClick={onOpenSpectrometry}
                    className="px-3.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-sky-300 font-bold rounded-xl text-xs transition border border-slate-700 flex items-center gap-1.5"
                  >
                    <Activity className="w-3.5 h-3.5" />
                    <span>Спектрометр МКА</span>
                  </button>
                </div>
              </div>

              {/* Карточки 3 академических лабораторных работ */}
              <div>
                <h2 className="text-sm font-bold text-slate-300 uppercase tracking-wider mb-3">
                  Академические лабораторные работы (Основной курс):
                </h2>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  {SCENARIOS.slice(0, 3).map((scenario) => {
                    const isSelected = scenario.id === activeScenarioId;
                    return (
                      <div
                        key={scenario.id}
                        onClick={() => onSelectScenario(scenario.id)}
                        className={`p-5 rounded-2xl border transition cursor-pointer flex flex-col justify-between group ${
                          isSelected
                            ? 'bg-sky-950/40 border-sky-400 shadow-xl shadow-sky-500/10 ring-1 ring-sky-400'
                            : 'bg-slate-900/60 border-slate-800 hover:border-slate-700 hover:bg-slate-900'
                        }`}
                      >
                        <div className="space-y-2.5">
                          <div className="flex items-center justify-between">
                            <span className="text-[11px] font-mono px-2 py-0.5 rounded bg-slate-800 text-sky-400 font-bold border border-slate-700">
                              ЛАБА #{scenario.id}
                            </span>
                            {isSelected && (
                              <span className="text-xs text-emerald-400 font-bold flex items-center gap-1">
                                <CheckCircle2 className="w-3.5 h-3.5" /> Активна
                              </span>
                            )}
                          </div>
                          <h3 className="font-bold text-sm text-white group-hover:text-sky-300 transition line-clamp-2">
                            {scenario.titleRu}
                          </h3>
                          <p className="text-xs text-slate-400 leading-relaxed line-clamp-3">
                            {scenario.shortDescriptionRu}
                          </p>
                        </div>

                        <div className="pt-4 border-t border-slate-800/80 mt-4 flex items-center justify-between text-xs">
                          <span className="text-slate-500 font-mono">
                            Изотопы: {scenario.dominantIsotopes.join(', ')}
                          </span>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              onSelectScenario(scenario.id);
                              onClose();
                            }}
                            className={`px-3 py-1.5 rounded-xl font-bold transition flex items-center gap-1 ${
                              isSelected
                                ? 'bg-sky-500 text-slate-950'
                                : 'bg-slate-800 text-slate-200 group-hover:bg-slate-700'
                            }`}
                          >
                            <span>Начать</span>
                            <ChevronRight className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Дополнительные практические сценарии радиационной безопасности */}
              <div>
                <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">
                  Дополнительные прикладные кейсы и инспекции (Свободный режим):
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-2.5">
                  {SCENARIOS.slice(3).map((scenario) => {
                    const isSelected = scenario.id === activeScenarioId;
                    return (
                      <button
                        key={scenario.id}
                        onClick={() => {
                          onSelectScenario(scenario.id);
                        }}
                        className={`p-3 rounded-xl border text-left transition ${
                          isSelected
                            ? 'bg-sky-950/40 border-sky-400 text-sky-200'
                            : 'bg-slate-900/40 border-slate-800/80 hover:bg-slate-800 text-slate-300'
                        }`}
                      >
                        <div className="text-[10px] text-slate-500 font-mono">Кейс #{scenario.id}</div>
                        <div className="text-xs font-semibold truncate mt-0.5">{scenario.titleRu}</div>
                      </button>
                    );
                  })}
                </div>
              </div>

            </div>
          )}

          {/* ===================================================================== */}
          {/* РАЗДЕЛ 2: БАЗА ПРИБОРОВ И ИСТОЧНИКОВ */}
          {/* ===================================================================== */}
          {activeTab === 'database' && (
            <div className="space-y-5">
              
              {/* Подвкладки: Приборы vs Радионуклиды */}
              <div className="flex items-center gap-2 border-b border-slate-800 pb-2">
                <button
                  onClick={() => setDbSubTab('instruments')}
                  className={`px-3 py-1.5 rounded-xl text-xs font-bold transition ${
                    dbSubTab === 'instruments'
                      ? 'bg-sky-500 text-slate-950'
                      : 'bg-slate-900 text-slate-400 hover:text-white'
                  }`}
                >
                  Детекторы и Дозиметры по видам ИИ (ГОСТ 27451-87)
                </button>
                <button
                  onClick={() => setDbSubTab('isotopes')}
                  className={`px-3 py-1.5 rounded-xl text-xs font-bold transition ${
                    dbSubTab === 'isotopes'
                      ? 'bg-sky-500 text-slate-950'
                      : 'bg-slate-900 text-slate-400 hover:text-white'
                  }`}
                >
                  Справочник радионуклидов (Co-60, Cs-137, Am-241, Sr-90, Pu-239, Cf-252)
                </button>
              </div>

              {/* Подраздел 2.1: База детекторов по видам излучения */}
              {dbSubTab === 'instruments' && (
                <div className="space-y-4">
                  {/* Фильтры категорий детектора */}
                  <div className="flex flex-wrap gap-2 text-xs">
                    {[
                      { id: 'all', label: 'Все детекторы' },
                      { id: 'geiger', label: 'Счетчики Гейгера-Мюллера (Слюдяные, Цилиндрические)' },
                      { id: 'scintillator', label: 'Сцинтилляционные (NaI, ZnS)' },
                      { id: 'semiconductor', label: 'Полупроводниковые (CdZnTe, PIPS)' },
                      { id: 'ion_chamber', label: 'Ионизационные камеры' },
                      { id: 'neutron', label: 'Нейтронные рем-метры' }
                    ].map(f => (
                      <button
                        key={f.id}
                        onClick={() => setInstrumentCategoryFilter(f.id)}
                        className={`px-3 py-1 rounded-lg border transition ${
                          instrumentCategoryFilter === f.id
                            ? 'bg-sky-500/20 border-sky-400 text-sky-300 font-bold'
                            : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-white'
                        }`}
                      >
                        {f.label}
                      </button>
                    ))}
                  </div>

                  {/* Список приборов */}
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3.5">
                    {Object.values(GOST_INSTRUMENTS)
                      .filter(inst => instrumentCategoryFilter === 'all' || inst.category === instrumentCategoryFilter)
                      .map(inst => {
                        const isEquipped = inst.id === selectedInstrumentId;
                        return (
                          <div
                            key={inst.id}
                            className={`p-4 rounded-2xl border transition flex flex-col justify-between ${
                              isEquipped
                                ? 'bg-sky-950/40 border-sky-400 ring-1 ring-sky-400'
                                : 'bg-slate-900/60 border-slate-800 hover:border-slate-700'
                            }`}
                          >
                            <div className="space-y-2">
                              <div className="flex items-center justify-between">
                                <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-slate-800 text-slate-300 border border-slate-700">
                                  {inst.gostStandard}
                                </span>
                                <div className="flex gap-1">
                                  {inst.detectedRadiation.map(r => (
                                    <span
                                      key={r}
                                      className={`text-[9px] uppercase px-1.5 py-0.2 rounded font-mono font-bold ${
                                        r === 'alpha' ? 'bg-rose-500/20 text-rose-300' :
                                        r === 'beta' ? 'bg-sky-500/20 text-sky-300' :
                                        r === 'gamma' ? 'bg-amber-500/20 text-amber-300' :
                                        'bg-purple-500/20 text-purple-300'
                                      }`}
                                    >
                                      {r}
                                    </span>
                                  ))}
                                </div>
                              </div>
                              <h4 className="font-bold text-sm text-white">{inst.name}</h4>
                              <p className="text-[11px] text-slate-400 line-clamp-2">{inst.nameFull}</p>
                              
                              <div className="pt-2 text-[11px] font-mono space-y-1 text-slate-300 border-t border-slate-800/80">
                                <div>Диапазон: <span className="text-cyan-300">{inst.measurementRangeRu}</span></div>
                                <div>Погрешность: <span className="text-amber-300">±{inst.basicErrorPercent}%</span></div>
                                <div>Инерционность: <span className="text-slate-400">τ = {inst.timeConstantSec} с</span></div>
                              </div>
                            </div>

                            <button
                              onClick={() => {
                                onSelectInstrument(inst.id);
                                onChangePPE({ ...ppeState, instrumentId: inst.id });
                              }}
                              className={`mt-3 w-full py-2 rounded-xl text-xs font-bold transition flex items-center justify-center gap-1.5 ${
                                isEquipped
                                  ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                                  : 'bg-slate-800 hover:bg-slate-700 text-white'
                              }`}
                            >
                              {isEquipped ? <CheckCircle2 className="w-3.5 h-3.5" /> : null}
                              <span>{isEquipped ? 'Экипирован в руку' : 'Выбрать данный прибор'}</span>
                            </button>
                          </div>
                        );
                      })}
                  </div>
                </div>
              )}

              {/* Подраздел 2.2: База радионуклидов */}
              {dbSubTab === 'isotopes' && (
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 items-start">
                  {/* Список радионуклидов */}
                  <div className="space-y-2 lg:col-span-1 max-h-[500px] overflow-y-auto pr-1">
                    {['Co-60', 'Cs-137', 'Am-241', 'Sr-90', 'Pu-239', 'Cf-252', 'Ir-192', 'Ra-226', 'F-18'].map(key => {
                      const iso = ISOTOPE_DATABASE[key];
                      if (!iso) return null;
                      const isSel = selectedDbNuclideKey === key;
                      return (
                        <div
                          key={key}
                          onClick={() => {
                            setSelectedDbNuclideKey(key);
                            onSelectIsotope(key);
                          }}
                          className={`p-3 rounded-xl border transition cursor-pointer flex items-center justify-between ${
                            isSel
                              ? 'bg-sky-950/40 border-sky-400 text-sky-200 shadow-md'
                              : 'bg-slate-900/60 border-slate-800 hover:border-slate-700 text-slate-300'
                          }`}
                        >
                          <div>
                            <div className="font-bold text-sm text-white flex items-center gap-2">
                              <span>{iso.symbol}</span>
                              <span className="text-xs text-slate-400 font-normal">({iso.nameRu})</span>
                            </div>
                            <div className="text-[11px] text-slate-500 font-mono mt-0.5">
                              T½: {iso.halfLifeText} • w_R = {iso.wR}
                            </div>
                          </div>
                          <span className="text-xs font-mono font-bold px-2 py-0.5 rounded bg-slate-800 text-amber-300">
                            {iso.radiationType.toUpperCase()}
                          </span>
                        </div>
                      );
                    })}
                  </div>

                  {/* Карточка паспортных данных выбранного радионуклида */}
                  {ISOTOPE_DATABASE[selectedDbNuclideKey] && (
                    <div className="lg:col-span-2 p-5 rounded-2xl bg-slate-900 border border-slate-800 space-y-4 text-xs">
                      {(() => {
                        const iso = ISOTOPE_DATABASE[selectedDbNuclideKey];
                        return (
                          <>
                            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                              <div>
                                <h3 className="text-lg font-bold text-white flex items-center gap-2">
                                  <span>{iso.symbol}</span>
                                  <span className="text-slate-400 font-normal">{iso.nameRu}</span>
                                </h3>
                                <p className="text-slate-400 text-xs mt-0.5">{iso.descriptionRu}</p>
                              </div>
                              <button
                                onClick={() => onSelectIsotope(iso.id)}
                                className="px-3 py-1.5 bg-sky-500 hover:bg-sky-400 text-slate-950 font-bold rounded-xl transition shadow"
                              >
                                Установить в 3D сцену
                              </button>
                            </div>

                            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 font-mono">
                              <div className="p-3 rounded-xl bg-slate-950 border border-slate-800">
                                <span className="text-slate-500 block text-[10px]">Период полураспада T½:</span>
                                <strong className="text-cyan-300 text-sm">{iso.halfLifeText}</strong>
                              </div>
                              <div className="p-3 rounded-xl bg-slate-950 border border-slate-800">
                                <span className="text-slate-500 block text-[10px]">Гамма-постоянная Г_γ:</span>
                                <strong className="text-amber-300 text-sm">{iso.gammaConstant} (мкЗв·м²)/(ч·МБк)</strong>
                              </div>
                              <div className="p-3 rounded-xl bg-slate-950 border border-slate-800">
                                <span className="text-slate-500 block text-[10px]">Весовой коэф. w_R:</span>
                                <strong className="text-rose-300 text-sm">{iso.wR} (НРБ-99/2009)</strong>
                              </div>
                              <div className="p-3 rounded-xl bg-slate-950 border border-slate-800">
                                <span className="text-slate-500 block text-[10px]">Энергия E_γ (средняя):</span>
                                <strong className="text-white text-sm">{iso.energyMev} МэВ</strong>
                              </div>
                              <div className="p-3 rounded-xl bg-slate-950 border border-slate-800">
                                <span className="text-slate-500 block text-[10px]">Макс. энергия E_β:</span>
                                <strong className="text-white text-sm">{iso.maxBetaEnergyMev} МэВ</strong>
                              </div>
                              <div className="p-3 rounded-xl bg-slate-950 border border-slate-800">
                                <span className="text-slate-500 block text-[10px]">Доля излучения:</span>
                                <strong className="text-emerald-300 text-sm">
                                  {Object.entries(iso.emissionShares)
                                    .filter(([_, v]) => v > 0)
                                    .map(([k, v]) => `${k}:${(v * 100).toFixed(0)}%`)
                                    .join(' ')}
                                </strong>
                              </div>
                            </div>
                          </>
                        );
                      })()}
                    </div>
                  )}
                </div>
              )}

            </div>
          )}

          {/* ===================================================================== */}
          {/* РАЗДЕЛ 3: ЭКИПИРОВКА (СИЗ) И 3D-МАНЕКЕН */}
          {/* ===================================================================== */}
          {activeTab === 'ppe' && (
            <div className="space-y-4">
              <div className="p-3 rounded-xl bg-slate-900 border border-slate-800 text-xs text-slate-300 leading-relaxed">
                <strong className="text-sky-400">Регламент обеспечения СИЗ (ОСПОРБ-99/2010):</strong>{' '}
                Кастомизация защитного снаряжения дозиметриста. Вращайте 3D-манекен мышью (360° CAD View) и переключайте костюмы, респираторы и приборы в реальном времени.
              </div>

              <CharacterCustomizer3D
                ppeState={ppeState}
                onChangePPE={onChangePPE}
                selectedRemoteToolId={selectedRemoteToolId}
                onChangeRemoteTool={onSelectRemoteTool}
              />
            </div>
          )}

          {/* ===================================================================== */}
          {/* РАЗДЕЛ 4: НАСТРОЙКИ И РЕГЛАМЕНТ */}
          {/* ===================================================================== */}
          {activeTab === 'settings' && (
            <div className="space-y-5 max-w-2xl text-xs">
              
              <div className="p-4 rounded-2xl bg-slate-900 border border-slate-800 space-y-3">
                <h3 className="font-bold text-sm text-white">Режим отображения интерфейса при запуске:</h3>
                <label className="flex items-center gap-3 cursor-pointer p-2.5 rounded-xl hover:bg-slate-800 transition">
                  <input
                    type="checkbox"
                    checked={hideStartupModal}
                    onChange={e => onToggleHideStartupModal(e.target.checked)}
                    className="w-4 h-4 rounded text-sky-500 focus:ring-0 cursor-pointer"
                  />
                  <div>
                    <span className="font-bold text-slate-200">Скрыть начальное окно выбора при следующем запуске</span>
                    <p className="text-[11px] text-slate-400 mt-0.5">
                      Студент сразу попадает в 3D-лабораторию без вступительного окна. Главное меню всегда доступно по кнопке 🏠 в верхнем левом углу HUD.
                    </p>
                  </div>
                </label>
              </div>

              <div className="p-4 rounded-2xl bg-slate-900 border border-slate-800 space-y-3">
                <h3 className="font-bold text-sm text-white">Физические параметры и Нормальные Условия (НУ):</h3>
                <div className="grid grid-cols-2 gap-3 font-mono">
                  <div className="p-2.5 rounded-lg bg-slate-950 border border-slate-800">
                    <span className="text-slate-500 block text-[10px]">Температура воздуха Т₀:</span>
                    <strong className="text-cyan-300">{NORMAL_CONDITIONS.temperatureC} °C (293.15 K)</strong>
                  </div>
                  <div className="p-2.5 rounded-lg bg-slate-950 border border-slate-800">
                    <span className="text-slate-500 block text-[10px]">Барометрическое давление Р₀:</span>
                    <strong className="text-cyan-300">{NORMAL_CONDITIONS.pressureKpa} кПа (760 мм рт. ст.)</strong>
                  </div>
                  <div className="p-2.5 rounded-lg bg-slate-950 border border-slate-800">
                    <span className="text-slate-500 block text-[10px]">Плотность воздуха ρ₀:</span>
                    <strong className="text-cyan-300">{NORMAL_CONDITIONS.airDensityGPerCm3} г/см³</strong>
                  </div>
                  <div className="p-2.5 rounded-lg bg-slate-950 border border-slate-800">
                    <span className="text-slate-500 block text-[10px]">Дозиметрический стандарт:</span>
                    <strong className="text-emerald-300">ГОСТ Р 8.804-2012</strong>
                  </div>
                </div>
              </div>

            </div>
          )}

        </div>

        {/* Нижний колонтитул */}
        <footer className="flex flex-wrap items-center justify-between gap-3 px-6 py-3.5 border-t border-slate-800 bg-slate-900/60 shrink-0 text-xs">
          <div className="flex items-center gap-2 text-slate-400">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            <span>Выбрана: <strong className="text-white">{currentLabScenario.titleRu}</strong></span>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={() => {
                onToggleHideStartupModal(!hideStartupModal);
              }}
              className="px-3 py-2 text-slate-400 hover:text-white transition text-xs"
            >
              {hideStartupModal ? '✓ Меню скрыто при старте' : 'Показывать меню при старте'}
            </button>

            <button
              onClick={onClose}
              className="px-6 py-2.5 bg-gradient-to-r from-sky-500 to-blue-600 hover:from-sky-400 hover:to-blue-500 text-slate-950 font-black rounded-xl transition shadow-lg shadow-sky-500/20 flex items-center gap-2"
            >
              <Play className="w-4 h-4 fill-current" />
              <span>Начать работу в 3D лаборатории</span>
            </button>
          </div>
        </footer>

      </div>
    </div>
  );
};
