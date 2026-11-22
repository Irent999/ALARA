/**
 * ALARA-Planner Pro VR — Главное меню виртуального лабораторного практикума (Main Menu UI)
 * Унифицированная тактическая дизайн-система для сценариев 1–4.
 */

import React, { useState } from 'react';
import {
  Shield,
  BookOpen,
  Settings,
  X,
  Play,
  CheckCircle2,
  Flame,
  Activity,
  ChevronRight,
  Atom,
  FileSpreadsheet
} from 'lucide-react';
import { SCENARIOS } from '../scene/scenarios';
import { InstrumentId, GOST_INSTRUMENTS } from '../instruments/gostInstruments';
import { ISOTOPE_DATABASE, NORMAL_CONDITIONS, RemoteToolId } from '../physics/gostPhysics';
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
  selectedIsotopeId: _selectedIsotopeId,
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
    <div className="fixed inset-0 z-50 bg-[#0B1117]/80 backdrop-blur-md flex items-center justify-center p-3 sm:p-5 font-sans select-none">
      <div className="alara-glass-elevated max-w-6xl w-full h-[92vh] rounded-xl flex flex-col overflow-hidden text-[#F1F5F9]">

        {/* Верхняя шапка */}
        <header className="flex flex-wrap items-center justify-between gap-3 px-6 py-4 border-b border-[rgba(148,163,184,0.16)] shrink-0">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-[#0EA5E9]/15 border border-[#0EA5E9]/35 rounded-[10px] text-[#0EA5E9]">
              <Shield className="w-5 h-5" />
            </div>
            <div>
              <h1 className="text-lg font-bold tracking-tight text-[#F1F5F9]">
                ALARA МЧС — Тренажёр Ликвидации ЧС на АЭС
              </h1>
              <p className="text-xs text-[#94A3B8] mt-0.5">
                МЧС Узбекистана · НРБ-99/2009 · Подготовка подразделений к радиационной разведке и аварийным работам
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <div className="flex items-center p-1 rounded-[10px] alara-surface text-xs font-semibold">
              <button
                onClick={() => onChangeExamMode(false)}
                className={`px-3 py-1.5 rounded-[8px] transition ${
                  !isExamMode
                    ? 'bg-[#0EA5E9] text-[#0B1117] font-bold'
                    : 'text-[#94A3B8] hover:text-[#F1F5F9]'
                }`}
              >
                Практикум
              </button>
              <button
                onClick={() => onChangeExamMode(true)}
                className={`px-3 py-1.5 rounded-[8px] transition ${
                  isExamMode
                    ? 'bg-[#F59E0B] text-[#0B1117] font-bold'
                    : 'text-[#94A3B8] hover:text-[#F1F5F9]'
                }`}
              >
                Экзамен
              </button>
            </div>

            <button
              onClick={onClose}
              className="p-2 rounded-[10px] text-[#94A3B8] hover:text-[#F1F5F9] hover:bg-white/5 transition"
              title="Закрыть меню (Esc)"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </header>

        {/* Навигация */}
        <nav className="flex flex-wrap items-center gap-1.5 px-6 py-2.5 border-b border-[rgba(148,163,184,0.16)] shrink-0 text-xs font-semibold">
          <button
            onClick={() => setActiveTab('labs')}
            className={`px-3.5 py-2 rounded-[10px] transition flex items-center gap-2 ${
              activeTab === 'labs'
                ? 'bg-[#0EA5E9] text-[#0B1117] font-bold'
                : 'text-[#94A3B8] hover:text-[#F1F5F9] hover:bg-white/5'
            }`}
          >
            <BookOpen className="w-4 h-4" />
            <span>1. Сценарии 1–4</span>
          </button>
          <button
            onClick={() => setActiveTab('database')}
            className={`px-3.5 py-2 rounded-[10px] transition flex items-center gap-2 ${
              activeTab === 'database'
                ? 'bg-[#0EA5E9] text-[#0B1117] font-bold'
                : 'text-[#94A3B8] hover:text-[#F1F5F9] hover:bg-white/5'
            }`}
          >
            <Atom className="w-4 h-4" />
            <span>2. Приборы и источники</span>
          </button>
          <button
            onClick={() => setActiveTab('ppe')}
            className={`px-3.5 py-2 rounded-[10px] transition flex items-center gap-2 ${
              activeTab === 'ppe'
                ? 'bg-[#0EA5E9] text-[#0B1117] font-bold'
                : 'text-[#94A3B8] hover:text-[#F1F5F9] hover:bg-white/5'
            }`}
          >
            <Shield className="w-4 h-4" />
            <span>3. Экипировка и 3D-манекен</span>
          </button>
          <button
            onClick={() => setActiveTab('settings')}
            className={`px-3.5 py-2 rounded-[10px] transition flex items-center gap-2 ${
              activeTab === 'settings'
                ? 'bg-[#0EA5E9] text-[#0B1117] font-bold'
                : 'text-[#94A3B8] hover:text-[#F1F5F9] hover:bg-white/5'
            }`}
          >
            <Settings className="w-4 h-4" />
            <span>4. Настройки и регламент</span>
          </button>
        </nav>

        {/* Основной контент */}
        <div className="flex-1 overflow-y-auto p-6 space-y-5">

          {/* РАЗДЕЛ 1: СЦЕНАРИИ 1–4 */}
          {activeTab === 'labs' && (
            <div className="space-y-5">
              {/* Режим и быстрые инструменты */}
              <div className={`p-4 rounded-xl border flex flex-wrap items-center justify-between gap-3 ${
                isExamMode
                  ? 'bg-[#F59E0B]/10 border-[#F59E0B]/35 text-[#F1F5F9]'
                  : 'bg-[#0EA5E9]/10 border-[#0EA5E9]/30 text-[#F1F5F9]'
              }`}>
                <div>
                  <h3 className="font-bold text-sm text-[#F1F5F9]">
                    {isExamMode ? 'Режим экзамена и квалификационного зачёта' : 'Режим учебного практикума'}
                  </h3>
                  <p className="text-xs text-[#94A3B8] mt-0.5">
                    {isExamMode
                      ? 'Подсказки и маркеры скрыты. Действия оцениваются по нормативам НРБ-99/2009.'
                      : 'Доступны пошаговые подсказки, журнал расчётов и спектрометр МКА.'}
                  </p>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={onOpenLabNotebook}
                    className="px-3.5 py-1.5 alara-surface hover:bg-white/10 text-[#0EA5E9] font-semibold rounded-[10px] text-xs transition flex items-center gap-1.5"
                  >
                    <FileSpreadsheet className="w-3.5 h-3.5" />
                    <span>Лаб. журнал</span>
                  </button>
                  <button
                    onClick={onOpenSpectrometry}
                    className="px-3.5 py-1.5 alara-surface hover:bg-white/10 text-[#14B8A6] font-semibold rounded-[10px] text-xs transition flex items-center gap-1.5"
                  >
                    <Activity className="w-3.5 h-3.5" />
                    <span>Спектрометр МКА</span>
                  </button>
                </div>
              </div>

              {/* Унифицированная сетка 2×2 сценариев 1–4 */}
              <div>
                <div className="flex items-center justify-between mb-3">
                  <h2 className="text-xs font-semibold text-[#94A3B8] uppercase tracking-wider">
                    Оперативные сценарии АЭС (1–4)
                  </h2>
                  <span className="text-xs font-mono alara-tabular text-[#64748B]">
                    Активен: #{activeScenarioId}
                  </span>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
                  {SCENARIOS.map((scenario) => {
                    const isSelected = scenario.id === activeScenarioId;
                    const isScenario4 = scenario.id === 4;
                    return (
                      <div
                        key={scenario.id}
                        onClick={() => onSelectScenario(scenario.id)}
                        className={`p-4 rounded-xl border transition cursor-pointer flex flex-col justify-between ${
                          isSelected
                            ? 'bg-[#0EA5E9]/10 border-[#0EA5E9] ring-1 ring-[#0EA5E9]/50'
                            : 'alara-surface hover:border-[rgba(148,163,184,0.32)]'
                        }`}
                      >
                        <div className="space-y-2">
                          <div className="flex items-center justify-between gap-2">
                            <span className={`text-[11px] font-mono font-bold alara-tabular ${
                              isScenario4 ? 'text-[#14B8A6]' : 'text-[#F59E0B]'
                            }`}>
                              СЦЕНАРИЙ #{scenario.id}{isScenario4 ? ' · АЭС (.GLB)' : ''}
                            </span>
                            {isSelected && (
                              <span className="text-xs text-[#10B981] font-semibold flex items-center gap-1">
                                <CheckCircle2 className="w-3.5 h-3.5" /> Выбран
                              </span>
                            )}
                          </div>
                          <h3 className="font-bold text-sm text-[#F1F5F9] line-clamp-2">
                            {scenario.titleRu}
                          </h3>
                          <p className="text-xs text-[#94A3B8] leading-relaxed line-clamp-2">
                            {scenario.shortDescriptionRu}
                          </p>
                        </div>

                        <div className="pt-3 border-t border-[rgba(148,163,184,0.12)] mt-3 flex items-center justify-between text-xs">
                          <span className="text-[#64748B] font-mono alara-tabular truncate pr-2">
                            {scenario.dominantIsotopes.join(', ')} · лимит {scenario.recommendedPermitLimitMsv} мЗв
                          </span>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              onSelectScenario(scenario.id);
                              onClose();
                            }}
                            className={`px-3 py-1.5 rounded-[10px] font-bold transition flex items-center gap-1 shrink-0 ${
                              isSelected
                                ? 'bg-[#0EA5E9] text-[#0B1117]'
                                : 'bg-white/10 hover:bg-white/15 text-[#F1F5F9]'
                            }`}
                          >
                            <span>Запуск</span>
                            <ChevronRight className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Быстрое комплектование СИЗ */}
              <div className="p-4 rounded-xl alara-surface space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h2 className="text-xs font-semibold text-[#F59E0B] uppercase tracking-wider flex items-center gap-1.5">
                      <Shield className="w-4 h-4" />
                      <span>Комплект СИЗ МЧС перед выходом</span>
                    </h2>
                    <p className="text-[11px] text-[#94A3B8] mt-0.5">
                      Выберите базовый комплект или настройте элементы вручную в 3D-редакторе.
                    </p>
                  </div>
                  <button
                    onClick={() => setActiveTab('ppe')}
                    className="px-3 py-1.5 rounded-[10px] bg-white/5 hover:bg-white/10 border border-[rgba(148,163,184,0.16)] text-[#0EA5E9] text-xs font-semibold transition"
                  >
                    3D-манекен →
                  </button>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
                  <button
                    onClick={() => {
                      onSelectInstrument('dp5');
                      onChangePPE({ suitId: 'bop_suit', respiratorId: 'ppm88_mask', instrumentId: 'dp5' });
                    }}
                    className={`p-3.5 rounded-[10px] border text-left transition ${
                      ppeState.suitId === 'bop_suit'
                        ? 'bg-[#F59E0B]/15 border-[#F59E0B] text-[#F1F5F9]'
                        : 'bg-[#0B1117]/60 border-[rgba(148,163,184,0.16)] hover:border-[rgba(148,163,184,0.32)]'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-[#F59E0B] flex items-center gap-1.5">
                        <Flame className="w-3.5 h-3.5" />
                        Пожарный расчёт БОП-1
                      </span>
                      <span className="text-[11px] font-mono alara-tabular text-[#94A3B8]">
                        350°C
                      </span>
                    </div>
                    <div className="text-[11px] text-[#94A3B8] mt-1">
                      БОП-1 + Маска ППМ-88 + ДП-5В
                    </div>
                  </button>

                  <button
                    onClick={() => {
                      onSelectInstrument('dp5');
                      onChangePPE({ suitId: 'kih4_suit', respiratorId: 'gp7vm_gasmask', instrumentId: 'dp5' });
                    }}
                    className={`p-3.5 rounded-[10px] border text-left transition ${
                      ppeState.suitId === 'kih4_suit'
                        ? 'bg-[#0EA5E9]/15 border-[#0EA5E9] text-[#F1F5F9]'
                        : 'bg-[#0B1117]/60 border-[rgba(148,163,184,0.16)] hover:border-[rgba(148,163,184,0.32)]'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-[#0EA5E9] flex items-center gap-1.5">
                        <Shield className="w-3.5 h-3.5" />
                        РХБ-защита КИХ-4
                      </span>
                      <span className="text-[11px] font-mono alara-tabular text-[#94A3B8]">
                        α/β 100%
                      </span>
                    </div>
                    <div className="text-[11px] text-[#94A3B8] mt-1">
                      КИХ-4 + Противогаз ГП-7ВМ + ДП-5В
                    </div>
                  </button>

                  <button
                    onClick={() => {
                      onSelectInstrument('dp5');
                      onChangePPE({ suitId: 'l1_suit', respiratorId: 'asv2_scba', instrumentId: 'dp5' });
                    }}
                    className={`p-3.5 rounded-[10px] border text-left transition ${
                      ppeState.suitId === 'l1_suit'
                        ? 'bg-[#10B981]/15 border-[#10B981] text-[#F1F5F9]'
                        : 'bg-[#0B1117]/60 border-[rgba(148,163,184,0.16)] hover:border-[rgba(148,163,184,0.32)]'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-[#10B981] flex items-center gap-1.5">
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        Разведка Л-1 + АСВ-2
                      </span>
                      <span className="text-[11px] font-mono alara-tabular text-[#94A3B8]">
                        300 бар
                      </span>
                    </div>
                    <div className="text-[11px] text-[#94A3B8] mt-1">
                      Костюм Л-1 + ДАСВ АСВ-2 + ДП-5В
                    </div>
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* РАЗДЕЛ 2: БАЗА ПРИБОРОВ И ИСТОЧНИКОВ */}
          {activeTab === 'database' && (
            <div className="space-y-5">
              <div className="flex flex-wrap items-center gap-2 border-b border-[rgba(148,163,184,0.16)] pb-3">
                <button
                  onClick={() => setDbSubTab('instruments')}
                  className={`px-3.5 py-1.5 rounded-[10px] text-xs font-bold transition ${
                    dbSubTab === 'instruments'
                      ? 'bg-[#0EA5E9] text-[#0B1117]'
                      : 'alara-surface text-[#94A3B8] hover:text-[#F1F5F9]'
                  }`}
                >
                  Дозиметры (ГОСТ 27451-87)
                </button>
                <button
                  onClick={() => setDbSubTab('isotopes')}
                  className={`px-3.5 py-1.5 rounded-[10px] text-xs font-bold transition ${
                    dbSubTab === 'isotopes'
                      ? 'bg-[#0EA5E9] text-[#0B1117]'
                      : 'alara-surface text-[#94A3B8] hover:text-[#F1F5F9]'
                  }`}
                >
                  Радионуклиды (Co-60, Cs-137, Am-241, Sr-90, Pu-239, Cf-252)
                </button>
              </div>

              {dbSubTab === 'instruments' && (
                <div className="space-y-4">
                  <div className="flex flex-wrap gap-2 text-xs">
                    {[
                      { id: 'all', label: 'Все детекторы' },
                      { id: 'geiger', label: 'Счетчики Гейгера-Мюллера' },
                      { id: 'scintillator', label: 'Сцинтилляционные (NaI, ZnS)' },
                      { id: 'semiconductor', label: 'Полупроводниковые (CdZnTe, PIPS)' },
                      { id: 'ion_chamber', label: 'Ионизационные камеры' },
                      { id: 'neutron', label: 'Нейтронные рем-метры' }
                    ].map(f => (
                      <button
                        key={f.id}
                        onClick={() => setInstrumentCategoryFilter(f.id)}
                        className={`px-3 py-1.5 rounded-[10px] border transition ${
                          instrumentCategoryFilter === f.id
                            ? 'bg-[#0EA5E9]/15 border-[#0EA5E9] text-[#0EA5E9] font-semibold'
                            : 'alara-surface text-[#94A3B8] hover:text-[#F1F5F9]'
                        }`}
                      >
                        {f.label}
                      </button>
                    ))}
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3.5">
                    {Object.values(GOST_INSTRUMENTS)
                      .filter(inst => instrumentCategoryFilter === 'all' || inst.category === instrumentCategoryFilter)
                      .map(inst => {
                        const isEquipped = inst.id === selectedInstrumentId;
                        return (
                          <div
                            key={inst.id}
                            className={`p-4 rounded-xl border transition flex flex-col justify-between ${
                              isEquipped
                                ? 'bg-[#0EA5E9]/10 border-[#0EA5E9] ring-1 ring-[#0EA5E9]/50'
                                : 'alara-surface hover:border-[rgba(148,163,184,0.32)]'
                            }`}
                          >
                            <div className="space-y-2">
                              <div className="flex items-center justify-between gap-2">
                                <span className="text-[11px] font-mono text-[#94A3B8]">
                                  {inst.gostStandard}
                                </span>
                                <span className="text-[10px] uppercase font-mono font-bold text-[#F59E0B]">
                                  {inst.detectedRadiation.join(' · ')}
                                </span>
                              </div>
                              <h4 className="font-bold text-sm text-[#F1F5F9]">{inst.name}</h4>
                              <p className="text-[11px] text-[#94A3B8] line-clamp-2">{inst.nameFull}</p>

                              <div className="pt-2 text-[11px] font-mono alara-tabular space-y-1 text-[#94A3B8] border-t border-[rgba(148,163,184,0.12)]">
                                <div>Диапазон: <span className="text-[#0EA5E9]">{inst.measurementRangeRu}</span></div>
                                <div>Погрешность: <span className="text-[#F59E0B]">±{inst.basicErrorPercent}%</span></div>
                                <div>Инерционность: <span className="text-[#F1F5F9]">τ = {inst.timeConstantSec} с</span></div>
                              </div>
                            </div>

                            <button
                              onClick={() => {
                                onSelectInstrument(inst.id);
                                onChangePPE({ ...ppeState, instrumentId: inst.id });
                              }}
                              className={`mt-3 w-full py-2 rounded-[10px] text-xs font-bold transition flex items-center justify-center gap-1.5 ${
                                isEquipped
                                  ? 'bg-[#10B981]/20 text-[#10B981] border border-[#10B981]/40'
                                  : 'bg-white/10 hover:bg-white/15 text-[#F1F5F9]'
                              }`}
                            >
                              {isEquipped ? <CheckCircle2 className="w-3.5 h-3.5" /> : null}
                              <span>{isEquipped ? 'Экипирован' : 'Выбрать прибор'}</span>
                            </button>
                          </div>
                        );
                      })}
                  </div>
                </div>
              )}

              {dbSubTab === 'isotopes' && (
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 items-start">
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
                          className={`p-3 rounded-[10px] border transition cursor-pointer flex items-center justify-between ${
                            isSel
                              ? 'bg-[#0EA5E9]/15 border-[#0EA5E9] text-[#F1F5F9]'
                              : 'alara-surface hover:border-[rgba(148,163,184,0.32)] text-[#94A3B8]'
                          }`}
                        >
                          <div>
                            <div className="font-bold text-sm text-[#F1F5F9] flex items-center gap-2">
                              <span>{iso.symbol}</span>
                              <span className="text-xs text-[#94A3B8] font-normal">({iso.nameRu})</span>
                            </div>
                            <div className="text-[11px] text-[#64748B] font-mono alara-tabular mt-0.5">
                              T½: {iso.halfLifeText} · w_R = {iso.wR}
                            </div>
                          </div>
                          <span className="text-xs font-mono font-bold text-[#F59E0B]">
                            {iso.radiationType.toUpperCase()}
                          </span>
                        </div>
                      );
                    })}
                  </div>

                  {ISOTOPE_DATABASE[selectedDbNuclideKey] && (
                    <div className="lg:col-span-2 p-5 rounded-xl alara-surface space-y-4 text-xs">
                      {(() => {
                        const iso = ISOTOPE_DATABASE[selectedDbNuclideKey];
                        return (
                          <>
                            <div className="flex items-center justify-between border-b border-[rgba(148,163,184,0.16)] pb-3 gap-3">
                              <div>
                                <h3 className="text-base font-bold text-[#F1F5F9] flex items-center gap-2">
                                  <span>{iso.symbol}</span>
                                  <span className="text-[#94A3B8] font-normal">{iso.nameRu}</span>
                                </h3>
                                <p className="text-[#94A3B8] text-xs mt-0.5">{iso.descriptionRu}</p>
                              </div>
                              <button
                                onClick={() => onSelectIsotope(iso.id)}
                                className="px-3.5 py-2 bg-[#0EA5E9] hover:bg-[#38BDF8] text-[#0B1117] font-bold rounded-[10px] transition shrink-0"
                              >
                                В 3D-сцену
                              </button>
                            </div>

                            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 font-mono alara-tabular">
                              <div className="p-3 rounded-[10px] bg-[#0B1117]/70 border border-[rgba(148,163,184,0.14)]">
                                <span className="text-[#64748B] block text-[10px]">Период полураспада T½</span>
                                <strong className="text-[#0EA5E9] text-sm">{iso.halfLifeText}</strong>
                              </div>
                              <div className="p-3 rounded-[10px] bg-[#0B1117]/70 border border-[rgba(148,163,184,0.14)]">
                                <span className="text-[#64748B] block text-[10px]">Гамма-постоянная Г_γ</span>
                                <strong className="text-[#F59E0B] text-sm">{iso.gammaConstant} (мкЗв·м²)/(ч·МБк)</strong>
                              </div>
                              <div className="p-3 rounded-[10px] bg-[#0B1117]/70 border border-[rgba(148,163,184,0.14)]">
                                <span className="text-[#64748B] block text-[10px]">Весовой коэф. w_R</span>
                                <strong className="text-[#EF4444] text-sm">{iso.wR} (НРБ-99/2009)</strong>
                              </div>
                              <div className="p-3 rounded-[10px] bg-[#0B1117]/70 border border-[rgba(148,163,184,0.14)]">
                                <span className="text-[#64748B] block text-[10px]">Энергия E_γ (средняя)</span>
                                <strong className="text-[#F1F5F9] text-sm">{iso.energyMev} МэВ</strong>
                              </div>
                              <div className="p-3 rounded-[10px] bg-[#0B1117]/70 border border-[rgba(148,163,184,0.14)]">
                                <span className="text-[#64748B] block text-[10px]">Макс. энергия E_β</span>
                                <strong className="text-[#F1F5F9] text-sm">{iso.maxBetaEnergyMev} МэВ</strong>
                              </div>
                              <div className="p-3 rounded-[10px] bg-[#0B1117]/70 border border-[rgba(148,163,184,0.14)]">
                                <span className="text-[#64748B] block text-[10px]">Доля излучения</span>
                                <strong className="text-[#10B981] text-sm">
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

          {/* РАЗДЕЛ 3: ЭКИПИРОВКА (СИЗ) И 3D-МАНЕКЕН */}
          {activeTab === 'ppe' && (
            <div className="space-y-4">
              <div className="p-3.5 rounded-xl alara-surface text-xs text-[#94A3B8] leading-relaxed">
                <strong className="text-[#0EA5E9]">Регламент обеспечения СИЗ (ОСПОРБ-99/2010):</strong>{' '}
                Вращайте 3D-манекен и переключайте костюмы, респираторы и приборы в реальном времени.
              </div>

              <CharacterCustomizer3D
                ppeState={ppeState}
                onChangePPE={onChangePPE}
                selectedRemoteToolId={selectedRemoteToolId}
                onChangeRemoteTool={onSelectRemoteTool}
              />
            </div>
          )}

          {/* РАЗДЕЛ 4: НАСТРОЙКИ И РЕГЛАМЕНТ */}
          {activeTab === 'settings' && (
            <div className="space-y-4 max-w-2xl text-xs">
              <div className="p-4 rounded-xl alara-surface space-y-3">
                <h3 className="font-bold text-sm text-[#F1F5F9]">Запуск тренажёра</h3>
                <label className="flex items-center gap-3 cursor-pointer p-2.5 rounded-[10px] hover:bg-white/5 transition">
                  <input
                    type="checkbox"
                    checked={hideStartupModal}
                    onChange={e => onToggleHideStartupModal(e.target.checked)}
                    className="w-4 h-4 rounded accent-[#0EA5E9] cursor-pointer"
                  />
                  <div>
                    <span className="font-semibold text-[#F1F5F9]">Скрывать стартовое меню при запуске</span>
                    <p className="text-[11px] text-[#94A3B8] mt-0.5">
                      Меню всегда доступно по клавишам Tab / Esc или через кнопку в верхней панели HUD.
                    </p>
                  </div>
                </label>
              </div>

              <div className="p-4 rounded-xl alara-surface space-y-3">
                <h3 className="font-bold text-sm text-[#F1F5F9]">Нормальные условия (НУ) и стандарты</h3>
                <div className="grid grid-cols-2 gap-3 font-mono alara-tabular">
                  <div className="p-3 rounded-[10px] bg-[#0B1117]/70 border border-[rgba(148,163,184,0.14)]">
                    <span className="text-[#64748B] block text-[10px]">Температура Т₀</span>
                    <strong className="text-[#0EA5E9]">{NORMAL_CONDITIONS.temperatureC} °C (293.15 K)</strong>
                  </div>
                  <div className="p-3 rounded-[10px] bg-[#0B1117]/70 border border-[rgba(148,163,184,0.14)]">
                    <span className="text-[#64748B] block text-[10px]">Давление Р₀</span>
                    <strong className="text-[#0EA5E9]">{NORMAL_CONDITIONS.pressureKpa} кПа</strong>
                  </div>
                  <div className="p-3 rounded-[10px] bg-[#0B1117]/70 border border-[rgba(148,163,184,0.14)]">
                    <span className="text-[#64748B] block text-[10px]">Плотность воздуха ρ₀</span>
                    <strong className="text-[#0EA5E9]">{NORMAL_CONDITIONS.airDensityGPerCm3} г/см³</strong>
                  </div>
                  <div className="p-3 rounded-[10px] bg-[#0B1117]/70 border border-[rgba(148,163,184,0.14)]">
                    <span className="text-[#64748B] block text-[10px]">Стандарт</span>
                    <strong className="text-[#10B981]">ГОСТ Р 8.804-2012</strong>
                  </div>
                </div>
              </div>
            </div>
          )}

        </div>

        {/* Нижняя панель */}
        <footer className="flex flex-wrap items-center justify-between gap-3 px-6 py-3.5 border-t border-[rgba(148,163,184,0.16)] shrink-0 text-xs">
          <div className="text-[#94A3B8]">
            Выбран сценарий: <strong className="text-[#F1F5F9]">{currentLabScenario.titleRu}</strong>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={() => onToggleHideStartupModal(!hideStartupModal)}
              className="px-3 py-2 text-[#94A3B8] hover:text-[#F1F5F9] transition text-xs"
            >
              {hideStartupModal ? 'Меню скрыто при старте' : 'Показывать при старте'}
            </button>

            <button
              onClick={onClose}
              className="px-5 py-2 bg-[#0EA5E9] hover:bg-[#38BDF8] text-[#0B1117] font-bold rounded-[10px] transition flex items-center gap-2"
            >
              <Play className="w-4 h-4 fill-current" />
              <span>Начать операцию</span>
            </button>
          </div>
        </footer>

      </div>
    </div>
  );
};
