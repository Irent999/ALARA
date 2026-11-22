/**
 * ALARA-Planner Pro VR — Лабораторный журнал студента (Lab Notebook Widget)
 * Интерактивный модуль самостоятельных расчетов по закону обратных квадратов (1/r²),
 * закону Бугера-Ламберта-Бера (I = I0·B·e^(-μd)) и расчету доз E = H_T·w_T = D·w_R·w_T
 * в строгом соответствии с ГОСТ Р 8.804-2012, НРБ-99/2009 и ОСПОРБ-99/2010.
 */

import React, { useState } from 'react';
import {
  Calculator,
  ArrowRight,
  Shield,
  Target,
  X,
  Award,
  Layers
} from 'lucide-react';
import {
  RADIATION_WEIGHTING_FACTORS_WR,
  TISSUE_WEIGHTING_FACTORS_WT,
  NORMAL_CONDITIONS,
  SHIELD_PROPERTIES,
  RadiationType,
  ShieldMaterialType,
  evaluateStudentCalculation,
  StudentCalculationVerification
} from '../physics/gostPhysics';

interface LabNotebookWidgetProps {
  isOpen: boolean;
  onClose: () => void;
  currentDoseRateMicroSv: number;
  currentDistanceMeters?: number;
  selectedShieldMaterial?: ShieldMaterialType;
  selectedShieldThicknessCm?: number;
}

export const LabNotebookWidget: React.FC<LabNotebookWidgetProps> = ({
  isOpen,
  onClose,
  currentDoseRateMicroSv,
  currentDistanceMeters: _currentDistanceMeters = 1.0,
  selectedShieldMaterial = 'lead',
  selectedShieldThicknessCm = 2.0
}) => {
  const [activeTab, setActiveTab] = useState<'inv_sq' | 'attenuation' | 'dose_calc' | 'summary'>('inv_sq');

  // --- Раздел 1: Закон обратных квадратов 1/r² ---
  const [invR1, setInvR1] = useState<number>(1.0);
  const [invR2, setInvR2] = useState<number>(2.5);
  const [invDose1, setInvDose1] = useState<number>(100.0);
  const [studentInvDose2, setStudentInvDose2] = useState<string>('');
  const [studentInvRatio, setStudentInvRatio] = useState<string>('');
  const [invResults, setInvResults] = useState<StudentCalculationVerification[] | null>(null);

  // --- Раздел 2: Ослабление материалами и СИЗ ---
  const [attMaterial, setAttMaterial] = useState<ShieldMaterialType>(selectedShieldMaterial);
  const [attThicknessCm, setAttThicknessCm] = useState<number>(selectedShieldThicknessCm || 2.0);
  const [attI0, setAttI0] = useState<number>(150.0);
  const [attEnergyMev, setAttEnergyMev] = useState<string>('0.662');
  const [studentMu, setStudentMu] = useState<string>('');
  const [studentBuildupB, setStudentBuildupB] = useState<string>('');
  const [studentAttIntensity, setStudentAttIntensity] = useState<string>('');
  const [studentKShield, setStudentKShield] = useState<string>('');
  const [attResults, setAttResults] = useState<StudentCalculationVerification[] | null>(null);

  // --- Раздел 3: Расчет доз ---
  const [doseDoseRate, setDoseDoseRate] = useState<number>(50.0);
  const [doseTimeHours, setDoseTimeHours] = useState<number>(0.5);
  const [doseRadType, setDoseRadType] = useState<RadiationType>('gamma');
  const [doseTissue, setDoseTissue] = useState<string>('whole_body');
  const [dosePpeFactor, setDosePpeFactor] = useState<number>(1.2);
  const [studentAbsorbedD, setStudentAbsorbedD] = useState<string>('');
  const [studentEquivalentH, setStudentEquivalentH] = useState<string>('');
  const [studentEffectiveE, setStudentEffectiveE] = useState<string>('');
  const [doseResults, setDoseResults] = useState<StudentCalculationVerification[] | null>(null);

  if (!isOpen) return null;

  const handleCheckInverseSquare = () => {
    const r1 = Math.max(0.1, invR1);
    const r2 = Math.max(0.1, invR2);
    const d1 = Math.max(0, invDose1);

    const refRatio = Math.pow(r1 / r2, 2);
    const refDose2 = d1 * refRatio;

    const valD2 = parseFloat(studentInvDose2.replace(',', '.')) || 0;
    const valRatio = parseFloat(studentInvRatio.replace(',', '.')) || 0;

    const resD2 = evaluateStudentCalculation(
      'Мощность дозы Ḋ₂ на расстоянии r₂',
      valD2,
      refDose2,
      'мкЗв/ч'
    );
    const resRatio = evaluateStudentCalculation(
      'Коэффициент изменения поля (r₁/r₂)²',
      valRatio,
      refRatio,
      'б/р'
    );

    setInvResults([resD2, resRatio]);
  };

  const handleCheckAttenuation = () => {
    const matProps = SHIELD_PROPERTIES[attMaterial];
    const energyKey = attEnergyMev === '1.25' ? '1.25' : '0.662';
    const refMu = matProps.muByEnergy[energyKey] || 0.77;
    const d = Math.max(0, attThicknessCm);
    const opticalThick = refMu * d;

    const { A, alpha1, alpha2 } = matProps.taylorParams;
    const refBuildup = Math.max(
      1.0,
      A * Math.exp(-alpha1 * opticalThick) + (1.0 - A) * Math.exp(-alpha2 * opticalThick)
    );

    const refIntensity = attI0 * refBuildup * Math.exp(-opticalThick);
    const refKShield = attI0 / Math.max(0.0001, refIntensity);

    const valMu = parseFloat(studentMu.replace(',', '.')) || 0;
    const valB = parseFloat(studentBuildupB.replace(',', '.')) || 0;
    const valI = parseFloat(studentAttIntensity.replace(',', '.')) || 0;
    const valK = parseFloat(studentKShield.replace(',', '.')) || 0;

    const rMu = evaluateStudentCalculation('Линейный коэффициент ослабления μ(E)', valMu, refMu, 'см⁻¹');
    const rB = evaluateStudentCalculation('Фактор накопления Тейлора B(E, μd)', valB, refBuildup, 'б/р');
    const rI = evaluateStudentCalculation('Ослабленная интенсивность I(d)', valI, refIntensity, 'мкЗв/ч');
    const rK = evaluateStudentCalculation('Кратность ослабления экрана K_shield', valK, refKShield, 'раз');

    setAttResults([rMu, rB, rI, rK]);
  };

  const handleCheckDose = () => {
    const doseRateMsvH = doseDoseRate / 1000.0;
    const tH = Math.max(0, doseTimeHours);
    const wR = RADIATION_WEIGHTING_FACTORS_WR[doseRadType] ?? 1.0;
    const tissueObj = TISSUE_WEIGHTING_FACTORS_WT[doseTissue] ?? TISSUE_WEIGHTING_FACTORS_WT.whole_body;
    const wT = tissueObj.wT;
    const kPpe = Math.max(1.0, dosePpeFactor);

    const refAbsorbedMgy = doseRateMsvH * tH;
    const refEquivMsv = refAbsorbedMgy * wR;
    const refEffectiveMsv = (refEquivMsv * wT) / kPpe;

    const valD = parseFloat(studentAbsorbedD.replace(',', '.')) || 0;
    const valH = parseFloat(studentEquivalentH.replace(',', '.')) || 0;
    const valE = parseFloat(studentEffectiveE.replace(',', '.')) || 0;

    const rD = evaluateStudentCalculation('Поглощенная доза D = Ḋ·t', valD, refAbsorbedMgy, 'мГр');
    const rH = evaluateStudentCalculation('Эквивалентная доза H_T = D·w_R', valH, refEquivMsv, 'мЗв');
    const rE = evaluateStudentCalculation('Эффективная доза E = H_T·w_T/k_PPE', valE, refEffectiveMsv, 'мЗв');

    setDoseResults([rD, rH, rE]);
  };

  const allResults = [
    ...(invResults || []),
    ...(attResults || []),
    ...(doseResults || [])
  ];
  const passedCount = allResults.filter(r => r.isPassed).length;
  const avgError = allResults.length > 0
    ? allResults.reduce((acc, r) => acc + r.relativeErrorPercent, 0) / allResults.length
    : 0;

  return (
    <div className="fixed inset-0 z-50 bg-[#0B1117]/80 backdrop-blur-md flex items-center justify-center p-3 font-sans">
      <div className="alara-glass-elevated max-w-5xl w-full rounded-xl p-6 flex flex-col gap-5 max-h-[94vh] overflow-hidden text-[#F1F5F9]">

        {/* Заголовок журнала */}
        <div className="flex justify-between items-center border-b border-[rgba(148,163,184,0.16)] pb-3 shrink-0">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-[#0EA5E9]/15 text-[#0EA5E9] rounded-[10px] border border-[#0EA5E9]/35">
              <Calculator className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-[#F1F5F9]">
                Лабораторный журнал расчётов
              </h2>
              <p className="text-xs text-[#94A3B8] mt-0.5">
                ГОСТ Р 8.804-2012 · НРБ-99/2009 · Нормальные условия: T = {NORMAL_CONDITIONS.temperatureC}°C, P = {NORMAL_CONDITIONS.pressureKpa} кПа
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-[#94A3B8] hover:text-[#F1F5F9] p-2 rounded-[10px] hover:bg-white/5 transition"
            title="Закрыть журнал"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Вкладки разделов расчетов */}
        <div className="flex flex-wrap gap-2 border-b border-[rgba(148,163,184,0.16)] pb-3 shrink-0 text-xs">
          <button
            onClick={() => setActiveTab('inv_sq')}
            className={`px-3 py-1.5 rounded-[10px] font-bold transition flex items-center gap-1.5 ${
              activeTab === 'inv_sq'
                ? 'bg-[#0EA5E9] text-[#0B1117]'
                : 'alara-surface text-[#94A3B8] hover:text-[#F1F5F9]'
            }`}
          >
            <Target className="w-3.5 h-3.5" />
            <span>1. Закон 1/r²</span>
          </button>
          <button
            onClick={() => setActiveTab('attenuation')}
            className={`px-3 py-1.5 rounded-[10px] font-bold transition flex items-center gap-1.5 ${
              activeTab === 'attenuation'
                ? 'bg-[#0EA5E9] text-[#0B1117]'
                : 'alara-surface text-[#94A3B8] hover:text-[#F1F5F9]'
            }`}
          >
            <Shield className="w-3.5 h-3.5" />
            <span>2. Закон Бугера и СИЗ</span>
          </button>
          <button
            onClick={() => setActiveTab('dose_calc')}
            className={`px-3 py-1.5 rounded-[10px] font-bold transition flex items-center gap-1.5 ${
              activeTab === 'dose_calc'
                ? 'bg-[#0EA5E9] text-[#0B1117]'
                : 'alara-surface text-[#94A3B8] hover:text-[#F1F5F9]'
            }`}
          >
            <Layers className="w-3.5 h-3.5" />
            <span>3. Дозиметрия E = D·w_R·w_T/k_PPE</span>
          </button>
          <button
            onClick={() => setActiveTab('summary')}
            className={`px-3 py-1.5 rounded-[10px] font-bold transition flex items-center gap-1.5 ${
              activeTab === 'summary'
                ? 'bg-[#F59E0B] text-[#0B1117]'
                : 'alara-surface text-[#94A3B8] hover:text-[#F1F5F9]'
            }`}
          >
            <Award className="w-3.5 h-3.5" />
            <span className="alara-tabular">Ведомость ({passedCount}/{allResults.length || 0})</span>
          </button>
        </div>

        {/* Тело журнала */}
        <div className="flex-1 overflow-y-auto pr-1 text-sm space-y-4">

          {/* 1. ЗАКОН ОБРАТНЫХ КВАДРАТОВ 1/r² */}
          {activeTab === 'inv_sq' && (
            <div className="space-y-4">
              <div className="p-3.5 rounded-xl alara-surface text-xs text-[#94A3B8] leading-relaxed">
                <strong className="text-[#0EA5E9]">ГОСТ Р 8.804:</strong>{' '}
                Мощность эквивалентной дозы точечного изотропного источника:{' '}
                <code className="text-[#F59E0B] font-mono">Ḋ(r₂) = Ḋ(r₁) · (r₁ / r₂)²</code>.
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-3 alara-surface p-4 rounded-xl">
                <div>
                  <label className="text-xs text-[#94A3B8] block mb-1">Дистанция 1 (r₁), м</label>
                  <input
                    type="number"
                    step="0.1"
                    min="0.1"
                    value={invR1}
                    onChange={e => setInvR1(parseFloat(e.target.value) || 0.1)}
                    className="w-full bg-[#0B1117] border border-[rgba(148,163,184,0.2)] rounded-[10px] px-3 py-1.5 font-mono alara-tabular text-[#0EA5E9] focus:outline-none focus:border-[#0EA5E9]"
                  />
                </div>
                <div>
                  <label className="text-xs text-[#94A3B8] block mb-1">Дистанция 2 (r₂), м</label>
                  <input
                    type="number"
                    step="0.1"
                    min="0.1"
                    value={invR2}
                    onChange={e => setInvR2(parseFloat(e.target.value) || 0.1)}
                    className="w-full bg-[#0B1117] border border-[rgba(148,163,184,0.2)] rounded-[10px] px-3 py-1.5 font-mono alara-tabular text-[#0EA5E9] focus:outline-none focus:border-[#0EA5E9]"
                  />
                </div>
                <div>
                  <label className="text-xs text-[#94A3B8] block mb-1">Измеренная Ḋ(r₁), мкЗв/ч</label>
                  <div className="flex gap-2">
                    <input
                      type="number"
                      step="1"
                      min="0"
                      value={invDose1}
                      onChange={e => setInvDose1(parseFloat(e.target.value) || 0)}
                      className="w-full bg-[#0B1117] border border-[rgba(148,163,184,0.2)] rounded-[10px] px-3 py-1.5 font-mono alara-tabular text-[#0EA5E9] focus:outline-none focus:border-[#0EA5E9]"
                    />
                    <button
                      onClick={() => setInvDose1(Math.round(currentDoseRateMicroSv * 10) / 10)}
                      title="Вставить текущее показание датчика"
                      className="px-2.5 py-1 text-xs bg-white/5 hover:bg-white/10 rounded-[10px] border border-[rgba(148,163,184,0.2)] whitespace-nowrap text-[#F59E0B]"
                    >
                      С датчика
                    </button>
                  </div>
                </div>
              </div>

              <div className="p-4 rounded-xl bg-[#0EA5E9]/8 border border-[#0EA5E9]/25 space-y-3">
                <h4 className="text-xs font-bold text-[#0EA5E9] uppercase tracking-wider flex items-center gap-2">
                  <Calculator className="w-4 h-4" />
                  <span>Ручной расчёт</span>
                </h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="text-xs text-[#F1F5F9] block mb-1">
                      1. Геометрический фактор (r₁/r₂)²
                    </label>
                    <input
                      type="text"
                      placeholder="Например: 0.16"
                      value={studentInvRatio}
                      onChange={e => setStudentInvRatio(e.target.value)}
                      className="w-full bg-[#0B1117] border border-[#0EA5E9]/35 rounded-[10px] px-3 py-2 font-mono alara-tabular text-[#F1F5F9] placeholder-[#64748B] focus:outline-none focus:border-[#0EA5E9]"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-[#F1F5F9] block mb-1">
                      2. Ожидаемая мощность дозы Ḋ(r₂), мкЗв/ч
                    </label>
                    <input
                      type="text"
                      placeholder="Например: 16.0"
                      value={studentInvDose2}
                      onChange={e => setStudentInvDose2(e.target.value)}
                      className="w-full bg-[#0B1117] border border-[#0EA5E9]/35 rounded-[10px] px-3 py-2 font-mono alara-tabular text-[#F1F5F9] placeholder-[#64748B] focus:outline-none focus:border-[#0EA5E9]"
                    />
                  </div>
                </div>
                <div className="flex justify-end pt-1">
                  <button
                    onClick={handleCheckInverseSquare}
                    className="px-4 py-2 bg-[#0EA5E9] hover:bg-[#38BDF8] text-[#0B1117] font-bold rounded-[10px] transition flex items-center gap-2 text-xs"
                  >
                    <span>Сверить с эталоном (НУ)</span>
                    <ArrowRight className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {invResults && (
                <div className="mt-3 overflow-hidden rounded-xl border border-[rgba(148,163,184,0.16)]">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="bg-[#0B1117] text-[#94A3B8] border-b border-[rgba(148,163,184,0.16)]">
                        <th className="p-3">Физический параметр</th>
                        <th className="p-3">Значение студента</th>
                        <th className="p-3">Эталон (НУ)</th>
                        <th className="p-3">Погрешность δ</th>
                        <th className="p-3">Оценка</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[rgba(148,163,184,0.12)] font-mono alara-tabular">
                      {invResults.map((res, i) => (
                        <tr key={i} className="hover:bg-white/5">
                          <td className="p-3 font-sans text-[#F1F5F9]">{res.parameterName}</td>
                          <td className="p-3 text-[#0EA5E9] font-bold">{res.studentValue} {res.unit}</td>
                          <td className="p-3 text-[#F59E0B]">{res.referenceValue.toFixed(3)} {res.unit}</td>
                          <td className={`p-3 font-bold ${res.relativeErrorPercent <= 5 ? 'text-[#10B981]' : res.relativeErrorPercent <= 15 ? 'text-[#F59E0B]' : 'text-[#EF4444]'}`}>
                            {res.relativeErrorPercent.toFixed(1)}%
                          </td>
                          <td className="p-3 font-sans">
                            <span className={`text-[11px] font-bold ${res.isPassed ? 'text-[#10B981]' : 'text-[#EF4444]'}`}>
                              {res.grade}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* 2. ЗАКОН БУГЕРА-ЛАМБЕРТА-БЕРА */}
          {activeTab === 'attenuation' && (
            <div className="space-y-4">
              <div className="p-3.5 rounded-xl alara-surface text-xs text-[#94A3B8] leading-relaxed">
                <strong className="text-[#0EA5E9]">Закон Бугера:</strong>{' '}
                <code className="text-[#F59E0B] font-mono">I(d) = I₀ · B(E, μd) · exp(-μ(E) · d)</code>, где{' '}
                <code className="text-[#0EA5E9] font-mono">K_shield = I₀ / I(d)</code>.
              </div>

              <div className="grid grid-cols-1 md:grid-cols-4 gap-3 alara-surface p-4 rounded-xl">
                <div>
                  <label className="text-xs text-[#94A3B8] block mb-1">Материал экрана</label>
                  <select
                    value={attMaterial}
                    onChange={e => setAttMaterial(e.target.value as ShieldMaterialType)}
                    className="w-full bg-[#0B1117] border border-[rgba(148,163,184,0.2)] rounded-[10px] px-2.5 py-1.5 text-xs font-mono text-[#0EA5E9]"
                  >
                    <option value="lead">Свинец (11.34 г/см³)</option>
                    <option value="steel">Сталь 20 (7.85 г/см³)</option>
                    <option value="concrete">Бетон (2.35 г/см³)</option>
                    <option value="water">Водный барьер (1.0 г/см³)</option>
                    <option value="paraffin_borated">Борированный полиэтилен</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs text-[#94A3B8] block mb-1">Толщина d, см</label>
                  <input
                    type="number"
                    step="0.5"
                    min="0"
                    value={attThicknessCm}
                    onChange={e => setAttThicknessCm(parseFloat(e.target.value) || 0)}
                    className="w-full bg-[#0B1117] border border-[rgba(148,163,184,0.2)] rounded-[10px] px-3 py-1.5 font-mono alara-tabular text-[#0EA5E9]"
                  />
                </div>
                <div>
                  <label className="text-xs text-[#94A3B8] block mb-1">Энергия E_γ, МэВ</label>
                  <select
                    value={attEnergyMev}
                    onChange={e => setAttEnergyMev(e.target.value)}
                    className="w-full bg-[#0B1117] border border-[rgba(148,163,184,0.2)] rounded-[10px] px-2.5 py-1.5 text-xs font-mono text-[#0EA5E9]"
                  >
                    <option value="0.662">0.662 МэВ (Cs-137)</option>
                    <option value="1.25">1.25 МэВ (Co-60)</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs text-[#94A3B8] block mb-1">Падающая I₀, мкЗв/ч</label>
                  <input
                    type="number"
                    step="5"
                    value={attI0}
                    onChange={e => setAttI0(parseFloat(e.target.value) || 0)}
                    className="w-full bg-[#0B1117] border border-[rgba(148,163,184,0.2)] rounded-[10px] px-3 py-1.5 font-mono alara-tabular text-[#0EA5E9]"
                  />
                </div>
              </div>

              <div className="p-4 rounded-xl bg-[#0EA5E9]/8 border border-[#0EA5E9]/25 space-y-3">
                <h4 className="text-xs font-bold text-[#0EA5E9] uppercase tracking-wider flex items-center gap-2">
                  <Calculator className="w-4 h-4" />
                  <span>Расчёт коэффициентов</span>
                </h4>
                <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                  <div>
                    <label className="text-xs text-[#F1F5F9] block mb-1">1. Коэффициент μ, см⁻¹</label>
                    <input
                      type="text"
                      placeholder="напр. 0.77"
                      value={studentMu}
                      onChange={e => setStudentMu(e.target.value)}
                      className="w-full bg-[#0B1117] border border-[#0EA5E9]/35 rounded-[10px] px-3 py-2 font-mono alara-tabular text-[#F1F5F9] text-xs placeholder-[#64748B] focus:outline-none focus:border-[#0EA5E9]"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-[#F1F5F9] block mb-1">2. Фактор Тейлора B</label>
                    <input
                      type="text"
                      placeholder="напр. 1.25"
                      value={studentBuildupB}
                      onChange={e => setStudentBuildupB(e.target.value)}
                      className="w-full bg-[#0B1117] border border-[#0EA5E9]/35 rounded-[10px] px-3 py-2 font-mono alara-tabular text-[#F1F5F9] text-xs placeholder-[#64748B] focus:outline-none focus:border-[#0EA5E9]"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-[#F1F5F9] block mb-1">3. Интенсивность I(d)</label>
                    <input
                      type="text"
                      placeholder="напр. 40.5"
                      value={studentAttIntensity}
                      onChange={e => setStudentAttIntensity(e.target.value)}
                      className="w-full bg-[#0B1117] border border-[#0EA5E9]/35 rounded-[10px] px-3 py-2 font-mono alara-tabular text-[#F1F5F9] text-xs placeholder-[#64748B] focus:outline-none focus:border-[#0EA5E9]"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-[#F1F5F9] block mb-1">4. Кратность K_shield</label>
                    <input
                      type="text"
                      placeholder="напр. 3.7"
                      value={studentKShield}
                      onChange={e => setStudentKShield(e.target.value)}
                      className="w-full bg-[#0B1117] border border-[#0EA5E9]/35 rounded-[10px] px-3 py-2 font-mono alara-tabular text-[#F1F5F9] text-xs placeholder-[#64748B] focus:outline-none focus:border-[#0EA5E9]"
                    />
                  </div>
                </div>
                <div className="flex justify-end pt-1">
                  <button
                    onClick={handleCheckAttenuation}
                    className="px-4 py-2 bg-[#0EA5E9] hover:bg-[#38BDF8] text-[#0B1117] font-bold rounded-[10px] transition flex items-center gap-2 text-xs"
                  >
                    <span>Сверить с эталоном</span>
                    <ArrowRight className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {attResults && (
                <div className="mt-3 overflow-hidden rounded-xl border border-[rgba(148,163,184,0.16)]">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="bg-[#0B1117] text-[#94A3B8] border-b border-[rgba(148,163,184,0.16)]">
                        <th className="p-3">Физический параметр</th>
                        <th className="p-3">Значение студента</th>
                        <th className="p-3">Эталон (НУ)</th>
                        <th className="p-3">Погрешность δ</th>
                        <th className="p-3">Оценка</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[rgba(148,163,184,0.12)] font-mono alara-tabular">
                      {attResults.map((res, i) => (
                        <tr key={i} className="hover:bg-white/5">
                          <td className="p-3 font-sans text-[#F1F5F9]">{res.parameterName}</td>
                          <td className="p-3 text-[#0EA5E9] font-bold">{res.studentValue} {res.unit}</td>
                          <td className="p-3 text-[#F59E0B]">{res.referenceValue.toFixed(3)} {res.unit}</td>
                          <td className={`p-3 font-bold ${res.relativeErrorPercent <= 5 ? 'text-[#10B981]' : res.relativeErrorPercent <= 15 ? 'text-[#F59E0B]' : 'text-[#EF4444]'}`}>
                            {res.relativeErrorPercent.toFixed(1)}%
                          </td>
                          <td className="p-3 font-sans">
                            <span className={`text-[11px] font-bold ${res.isPassed ? 'text-[#10B981]' : 'text-[#EF4444]'}`}>
                              {res.grade}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* 3. РАСЧЕТ ДОЗ */}
          {activeTab === 'dose_calc' && (
            <div className="space-y-4">
              <div className="p-3.5 rounded-xl alara-surface text-xs text-[#94A3B8] leading-relaxed">
                <strong className="text-[#0EA5E9]">Формулы НРБ-99/2009:</strong>
                <ul className="list-disc list-inside mt-1 space-y-0.5 font-mono text-[11px]">
                  <li>Поглощенная доза: <span className="text-[#F59E0B]">D = Ḋ · t</span> (мГр)</li>
                  <li>Эквивалентная доза: <span className="text-[#F59E0B]">H_T = D · w_R</span> (мЗв)</li>
                  <li>Эффективная доза: <span className="text-[#F59E0B]">E = H_T · w_T / k_PPE</span> (мЗв)</li>
                </ul>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-5 gap-3 alara-surface p-4 rounded-xl">
                <div>
                  <label className="text-xs text-[#94A3B8] block mb-1">Мощность Ḋ, мкЗв/ч</label>
                  <input
                    type="number"
                    step="1"
                    value={doseDoseRate}
                    onChange={e => setDoseDoseRate(parseFloat(e.target.value) || 0)}
                    className="w-full bg-[#0B1117] border border-[rgba(148,163,184,0.2)] rounded-[10px] px-2.5 py-1.5 font-mono alara-tabular text-[#0EA5E9]"
                  />
                </div>
                <div>
                  <label className="text-xs text-[#94A3B8] block mb-1">Время t, ч</label>
                  <input
                    type="number"
                    step="0.1"
                    value={doseTimeHours}
                    onChange={e => setDoseTimeHours(parseFloat(e.target.value) || 0)}
                    className="w-full bg-[#0B1117] border border-[rgba(148,163,184,0.2)] rounded-[10px] px-2.5 py-1.5 font-mono alara-tabular text-[#0EA5E9]"
                  />
                </div>
                <div>
                  <label className="text-xs text-[#94A3B8] block mb-1">Излучение (w_R)</label>
                  <select
                    value={doseRadType}
                    onChange={e => setDoseRadType(e.target.value as RadiationType)}
                    className="w-full bg-[#0B1117] border border-[rgba(148,163,184,0.2)] rounded-[10px] px-2.5 py-1.5 text-xs font-mono text-[#0EA5E9]"
                  >
                    <option value="gamma">Гамма (w_R = 1.0)</option>
                    <option value="beta">Бета (w_R = 1.0)</option>
                    <option value="alpha">Альфа (w_R = 20.0)</option>
                    <option value="fast_neutron">Нейтроны (w_R = 10.0)</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs text-[#94A3B8] block mb-1">Орган / ткань (w_T)</label>
                  <select
                    value={doseTissue}
                    onChange={e => setDoseTissue(e.target.value)}
                    className="w-full bg-[#0B1117] border border-[rgba(148,163,184,0.2)] rounded-[10px] px-2.5 py-1.5 text-xs font-mono text-[#0EA5E9]"
                  >
                    {Object.values(TISSUE_WEIGHTING_FACTORS_WT).map(t => (
                      <option key={t.id} value={t.id}>
                        {t.nameRu} (w_T={t.wT})
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-xs text-[#94A3B8] block mb-1">Фактор СИЗ k_PPE</label>
                  <input
                    type="number"
                    step="0.1"
                    min="1.0"
                    value={dosePpeFactor}
                    onChange={e => setDosePpeFactor(parseFloat(e.target.value) || 1.0)}
                    className="w-full bg-[#0B1117] border border-[rgba(148,163,184,0.2)] rounded-[10px] px-2.5 py-1.5 font-mono alara-tabular text-[#0EA5E9]"
                  />
                </div>
              </div>

              <div className="p-4 rounded-xl bg-[#0EA5E9]/8 border border-[#0EA5E9]/25 space-y-3">
                <h4 className="text-xs font-bold text-[#0EA5E9] uppercase tracking-wider flex items-center gap-2">
                  <Calculator className="w-4 h-4" />
                  <span>Расчёт доз (мГр / мЗв)</span>
                </h4>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <div>
                    <label className="text-xs text-[#F1F5F9] block mb-1">1. Поглощенная D, мГр</label>
                    <input
                      type="text"
                      placeholder="напр. 0.025"
                      value={studentAbsorbedD}
                      onChange={e => setStudentAbsorbedD(e.target.value)}
                      className="w-full bg-[#0B1117] border border-[#0EA5E9]/35 rounded-[10px] px-3 py-2 font-mono alara-tabular text-[#F1F5F9] text-xs placeholder-[#64748B] focus:outline-none focus:border-[#0EA5E9]"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-[#F1F5F9] block mb-1">2. Эквивалентная H_T, мЗв</label>
                    <input
                      type="text"
                      placeholder="напр. 0.025"
                      value={studentEquivalentH}
                      onChange={e => setStudentEquivalentH(e.target.value)}
                      className="w-full bg-[#0B1117] border border-[#0EA5E9]/35 rounded-[10px] px-3 py-2 font-mono alara-tabular text-[#F1F5F9] text-xs placeholder-[#64748B] focus:outline-none focus:border-[#0EA5E9]"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-[#F1F5F9] block mb-1">3. Эффективная E, мЗв</label>
                    <input
                      type="text"
                      placeholder="напр. 0.021"
                      value={studentEffectiveE}
                      onChange={e => setStudentEffectiveE(e.target.value)}
                      className="w-full bg-[#0B1117] border border-[#0EA5E9]/35 rounded-[10px] px-3 py-2 font-mono alara-tabular text-[#F1F5F9] text-xs placeholder-[#64748B] focus:outline-none focus:border-[#0EA5E9]"
                    />
                  </div>
                </div>
                <div className="flex justify-end pt-1">
                  <button
                    onClick={handleCheckDose}
                    className="px-4 py-2 bg-[#0EA5E9] hover:bg-[#38BDF8] text-[#0B1117] font-bold rounded-[10px] transition flex items-center gap-2 text-xs"
                  >
                    <span>Сверить по НРБ-99/2009</span>
                    <ArrowRight className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {doseResults && (
                <div className="mt-3 overflow-hidden rounded-xl border border-[rgba(148,163,184,0.16)]">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="bg-[#0B1117] text-[#94A3B8] border-b border-[rgba(148,163,184,0.16)]">
                        <th className="p-3">Физический параметр</th>
                        <th className="p-3">Значение студента</th>
                        <th className="p-3">Эталон (НУ)</th>
                        <th className="p-3">Погрешность δ</th>
                        <th className="p-3">Оценка</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[rgba(148,163,184,0.12)] font-mono alara-tabular">
                      {doseResults.map((res, i) => (
                        <tr key={i} className="hover:bg-white/5">
                          <td className="p-3 font-sans text-[#F1F5F9]">{res.parameterName}</td>
                          <td className="p-3 text-[#0EA5E9] font-bold">{res.studentValue} {res.unit}</td>
                          <td className="p-3 text-[#F59E0B]">{res.referenceValue.toFixed(4)} {res.unit}</td>
                          <td className={`p-3 font-bold ${res.relativeErrorPercent <= 5 ? 'text-[#10B981]' : res.relativeErrorPercent <= 15 ? 'text-[#F59E0B]' : 'text-[#EF4444]'}`}>
                            {res.relativeErrorPercent.toFixed(1)}%
                          </td>
                          <td className="p-3 font-sans">
                            <span className={`text-[11px] font-bold ${res.isPassed ? 'text-[#10B981]' : 'text-[#EF4444]'}`}>
                              {res.grade}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* ИТОГОВАЯ ВЕДОМОСТЬ */}
          {activeTab === 'summary' && (
            <div className="space-y-4">
              <div className="p-4 rounded-xl alara-surface flex items-center justify-between">
                <div>
                  <h3 className="text-base font-bold text-[#F1F5F9] flex items-center gap-2">
                    <Award className="w-5 h-5 text-[#F59E0B]" />
                    <span>Итоговый протокол расчётов</span>
                  </h3>
                  <p className="text-xs text-[#94A3B8] mt-0.5">
                    Комплексная проверка по ГОСТ Р 8.804-2012
                  </p>
                </div>
                <div className="text-right">
                  <div className="text-2xl font-bold font-mono alara-tabular text-[#0EA5E9]">
                    {passedCount} / {allResults.length || 0}
                  </div>
                  <div className="text-[11px] text-[#94A3B8]">Пройдено этапов</div>
                </div>
              </div>

              {allResults.length === 0 ? (
                <div className="p-8 text-center text-[#64748B] border border-dashed border-[rgba(148,163,184,0.2)] rounded-xl">
                  Вы пока не провели ни одного расчёта. Перейдите во вкладки 1, 2 или 3.
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    <div className="p-3 rounded-xl alara-surface text-center">
                      <div className="text-xs text-[#94A3B8]">Средняя погрешность</div>
                      <div className={`text-xl font-bold font-mono alara-tabular ${avgError <= 5 ? 'text-[#10B981]' : avgError <= 15 ? 'text-[#F59E0B]' : 'text-[#EF4444]'}`}>
                        {avgError.toFixed(2)}%
                      </div>
                    </div>
                    <div className="p-3 rounded-xl alara-surface text-center">
                      <div className="text-xs text-[#94A3B8]">Итоговая оценка</div>
                      <div className="text-xl font-bold text-[#F59E0B]">
                        {avgError <= 5 ? '5 (Отлично)' : avgError <= 12 ? '4 (Хорошо)' : avgError <= 25 ? '3 (Удовл.)' : '2 (Не зачтено)'}
                      </div>
                    </div>
                    <div className="p-3 rounded-xl alara-surface text-center">
                      <div className="text-xs text-[#94A3B8]">Статус зачета</div>
                      <div className={`text-xl font-bold ${passedCount === allResults.length ? 'text-[#10B981]' : 'text-[#F59E0B]'}`}>
                        {passedCount === allResults.length ? 'ЗАЧТЕНО' : 'ДОРАБОТКА'}
                      </div>
                    </div>
                  </div>

                  <div className="overflow-hidden rounded-xl border border-[rgba(148,163,184,0.16)] text-xs">
                    <table className="w-full text-left border-collapse">
                      <thead>
                        <tr className="bg-[#0B1117] text-[#94A3B8] border-b border-[rgba(148,163,184,0.16)]">
                          <th className="p-2.5">Параметр</th>
                          <th className="p-2.5">Студент</th>
                          <th className="p-2.5">Эталон (НУ)</th>
                          <th className="p-2.5">Погрешность δ</th>
                          <th className="p-2.5">Оценка</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[rgba(148,163,184,0.12)] font-mono alara-tabular">
                        {allResults.map((r, idx) => (
                          <tr key={idx} className="hover:bg-white/5">
                            <td className="p-2.5 font-sans text-[#F1F5F9]">{r.parameterName}</td>
                            <td className="p-2.5 text-[#0EA5E9]">{r.studentValue} {r.unit}</td>
                            <td className="p-2.5 text-[#F59E0B]">{r.referenceValue.toFixed(3)} {r.unit}</td>
                            <td className={`p-2.5 font-bold ${r.relativeErrorPercent <= 5 ? 'text-[#10B981]' : 'text-[#F59E0B]'}`}>
                              {r.relativeErrorPercent.toFixed(1)}%
                            </td>
                            <td className="p-2.5 font-sans">
                              <span className={`text-[11px] font-bold ${r.isPassed ? 'text-[#10B981]' : 'text-[#EF4444]'}`}>
                                {r.grade}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}

        </div>

        {/* Нижняя панель действий */}
        <div className="flex justify-between items-center border-t border-[rgba(148,163,184,0.16)] pt-3 shrink-0 text-xs">
          <div className="text-[#94A3B8]">
            Автоматическая поверка формул по НРБ-99/2009 и ГОСТ 27451-87
          </div>
          <button
            onClick={onClose}
            className="px-5 py-2 bg-white/10 hover:bg-white/15 text-[#F1F5F9] font-semibold rounded-[10px] transition"
          >
            Закрыть журнал
          </button>
        </div>

      </div>
    </div>
  );
};
