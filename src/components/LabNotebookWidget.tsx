/**
 * ALARA-Planner Pro VR — Лабораторный журнал студента (Lab Notebook Widget)
 * Интерактивный модуль самостоятельных расчетов по закону обратных квадратов (1/r²),
 * закону Бугера-Ламберта-Бера (I = I0·B·e^(-μd)) и расчету доз E = H_T·w_T = D·w_R·w_T
 * в строгом соответствии с ГОСТ Р 8.804-2012, НРБ-99/2009 и ОСПОРБ-99/2010.
 */

import React, { useState } from 'react';
import {
  BookOpen,
  Calculator,
  CheckCircle2,
  AlertTriangle,
  FileText,
  RotateCcw,
  Sparkles,
  ArrowRight,
  Shield,
  Clock,
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
  StudentCalculationVerification,
  calculateSafeStayTime
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
  currentDistanceMeters = 1.0,
  selectedShieldMaterial = 'lead',
  selectedShieldThicknessCm = 2.0
}) => {
  const [activeTab, setActiveTab] = useState<'inv_sq' | 'attenuation' | 'dose_calc' | 'summary'>('inv_sq');

  // --- Раздел 1: Закон обратных квадратов 1/r² ---
  const [invR1, setInvR1] = useState<number>(1.0);
  const [invR2, setInvR2] = useState<number>(2.5);
  const [invDose1, setInvDose1] = useState<number>(100.0); // мкЗв/ч
  const [studentInvDose2, setStudentInvDose2] = useState<string>('');
  const [studentInvRatio, setStudentInvRatio] = useState<string>('');
  const [invResults, setInvResults] = useState<StudentCalculationVerification[] | null>(null);

  // --- Раздел 2: Ослабление материалами и СИЗ ---
  const [attMaterial, setAttMaterial] = useState<ShieldMaterialType>(selectedShieldMaterial);
  const [attThicknessCm, setAttThicknessCm] = useState<number>(selectedShieldThicknessCm || 2.0);
  const [attI0, setAttI0] = useState<number>(150.0); // мкЗв/ч
  const [attEnergyMev, setAttEnergyMev] = useState<string>('0.662'); // Cs-137
  const [studentMu, setStudentMu] = useState<string>('');
  const [studentBuildupB, setStudentBuildupB] = useState<string>('');
  const [studentAttIntensity, setStudentAttIntensity] = useState<string>('');
  const [studentKShield, setStudentKShield] = useState<string>('');
  const [studentKppe, setStudentKppe] = useState<string>('1.5');
  const [attResults, setAttResults] = useState<StudentCalculationVerification[] | null>(null);

  // --- Раздел 3: Расчет поглощенной, эквивалентной и эффективной дозы E = H_T·w_T = D·w_R·w_T ---
  const [doseDoseRate, setDoseDoseRate] = useState<number>(50.0); // мкЗв/ч
  const [doseTimeHours, setDoseTimeHours] = useState<number>(0.5); // 30 минут = 0.5 ч
  const [doseRadType, setDoseRadType] = useState<RadiationType>('gamma');
  const [doseTissue, setDoseTissue] = useState<string>('whole_body');
  const [dosePpeFactor, setDosePpeFactor] = useState<number>(1.2);
  const [studentAbsorbedD, setStudentAbsorbedD] = useState<string>(''); // мГр
  const [studentEquivalentH, setStudentEquivalentH] = useState<string>(''); // мЗв
  const [studentEffectiveE, setStudentEffectiveE] = useState<string>(''); // мЗв
  const [doseResults, setDoseResults] = useState<StudentCalculationVerification[] | null>(null);

  if (!isOpen) return null;

  // --- Вычисление эталонов Раздела 1 ---
  const handleCheckInverseSquare = () => {
    const r1 = Math.max(0.1, invR1);
    const r2 = Math.max(0.1, invR2);
    const d1 = Math.max(0, invDose1);

    // D2 = D1 * (r1 / r2)^2
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
      'Коэффициент изменения поля (r₁/r₂)',
      valRatio,
      refRatio,
      'б/р'
    );

    setInvResults([resD2, resRatio]);
  };

  // --- Вычисление эталонов Раздела 2 ---
  const handleCheckAttenuation = () => {
    const matProps = SHIELD_PROPERTIES[attMaterial];
    const energyKey = attEnergyMev === '1.25' ? '1.25' : '0.662';
    const refMu = matProps.muByEnergy[energyKey] || 0.77; // см^-1
    const d = Math.max(0, attThicknessCm);
    const opticalThick = refMu * d;

    // Фактор Тейлора
    const { A, alpha1, alpha2 } = matProps.taylorParams;
    const refBuildup = Math.max(
      1.0,
      A * Math.exp(-alpha1 * opticalThick) + (1.0 - A) * Math.exp(-alpha2 * opticalThick)
    );

    // Закон Бугера: I = I0 * B * exp(-mu * d)
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

  // --- Вычисление эталонов Раздела 3 ---
  const handleCheckDose = () => {
    const doseRateMsvH = doseDoseRate / 1000.0; // мЗв/ч
    const tH = Math.max(0, doseTimeHours);
    const wR = RADIATION_WEIGHTING_FACTORS_WR[doseRadType] ?? 1.0;
    const tissueObj = TISSUE_WEIGHTING_FACTORS_WT[doseTissue] ?? TISSUE_WEIGHTING_FACTORS_WT.whole_body;
    const wT = tissueObj.wT;
    const kPpe = Math.max(1.0, dosePpeFactor);

    // Поглощенная доза D (мГр): для гамма/бета при wR=1 численно 1 мЗв = 1 мГр
    const refAbsorbedMgy = (doseRateMsvH * tH) / (wR === 0 ? 1 : 1);
    // Эквивалентная доза H_T = D * w_R (мЗв)
    const refEquivMsv = refAbsorbedMgy * wR;
    // Эффективная доза E = H_T * w_T / k_ppe (мЗв)
    const refEffectiveMsv = (refEquivMsv * wT) / kPpe;

    const valD = parseFloat(studentAbsorbedD.replace(',', '.')) || 0;
    const valH = parseFloat(studentEquivalentH.replace(',', '.')) || 0;
    const valE = parseFloat(studentEffectiveE.replace(',', '.')) || 0;

    const rD = evaluateStudentCalculation('Поглощенная доза D = Ḋ·t', valD, refAbsorbedMgy, 'мГр');
    const rH = evaluateStudentCalculation('Эквивалентная доза H_T = D·w_R', valH, refEquivMsv, 'мЗв');
    const rE = evaluateStudentCalculation('Эффективная доза E = H_T·w_T/k_PPE', valE, refEffectiveMsv, 'мЗв');

    setDoseResults([rD, rH, rE]);
  };

  // Общий подсчет успеваемости
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
    <div className="fixed inset-0 z-50 bg-black/85 backdrop-blur-md flex items-center justify-center p-3 font-sans">
      <div className="glass-panel max-w-5xl w-full rounded-2xl p-6 border border-cyan-500/40 flex flex-col gap-5 max-h-[94vh] overflow-hidden shadow-2xl bg-slate-950/95 text-slate-100">
        
        {/* Заголовок журнала */}
        <div className="flex justify-between items-center border-b border-slate-800 pb-3 shrink-0">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-cyan-500/20 text-cyan-400 rounded-xl border border-cyan-500/40">
              <Calculator className="w-6 h-6" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-white flex items-center gap-2">
                <span>Лабораторный журнал студента (Самостоятельные расчёты)</span>
                <span className="text-xs px-2 py-0.5 rounded bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 font-mono">
                  ГОСТ Р 8.804-2012 • НРБ-99/2009
                </span>
              </h2>
              <p className="text-xs text-slate-400 mt-0.5">
                Нормальные условия (НУ): T = {NORMAL_CONDITIONS.temperatureC}°C, P = {NORMAL_CONDITIONS.pressureKpa} кПа. Вручную введите расчетные данные для сверки с эталоном.
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-white p-2 rounded-lg hover:bg-slate-800 transition"
            title="Закрыть журнал (✕)"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Вкладки разделов расчетов */}
        <div className="flex flex-wrap gap-2 border-b border-slate-800 pb-2.5 shrink-0 text-xs">
          <button
            onClick={() => setActiveTab('inv_sq')}
            className={`px-3 py-1.5 rounded-xl font-bold transition flex items-center gap-1.5 ${
              activeTab === 'inv_sq'
                ? 'bg-cyan-500 text-black shadow-md'
                : 'bg-slate-850 text-slate-300 hover:bg-slate-800'
            }`}
          >
            <Target className="w-3.5 h-3.5" />
            <span>1. Закон обратных квадратов (1/r²)</span>
          </button>
          <button
            onClick={() => setActiveTab('attenuation')}
            className={`px-3 py-1.5 rounded-xl font-bold transition flex items-center gap-1.5 ${
              activeTab === 'attenuation'
                ? 'bg-cyan-500 text-black shadow-md'
                : 'bg-slate-850 text-slate-300 hover:bg-slate-800'
            }`}
          >
            <Shield className="w-3.5 h-3.5" />
            <span>2. Закон Бугера (Ослабление и СИЗ)</span>
          </button>
          <button
            onClick={() => setActiveTab('dose_calc')}
            className={`px-3 py-1.5 rounded-xl font-bold transition flex items-center gap-1.5 ${
              activeTab === 'dose_calc'
                ? 'bg-cyan-500 text-black shadow-md'
                : 'bg-slate-850 text-slate-300 hover:bg-slate-800'
            }`}
          >
            <Layers className="w-3.5 h-3.5" />
            <span>3. Дозиметрия: E = D·w_R·w_T·k_PPE</span>
          </button>
          <button
            onClick={() => setActiveTab('summary')}
            className={`px-3 py-1.5 rounded-xl font-bold transition flex items-center gap-1.5 ${
              activeTab === 'summary'
                ? 'bg-amber-500 text-black shadow-md'
                : 'bg-slate-850 text-slate-300 hover:bg-slate-800'
            }`}
          >
            <Award className="w-3.5 h-3.5" />
            <span>Итоговая ведомость и Оценка ({passedCount}/{allResults.length || 0})</span>
          </button>
        </div>

        {/* Тело журнала с прокруткой */}
        <div className="flex-1 overflow-y-auto pr-1 text-sm space-y-4">
          
          {/* ========================================================================= */}
          {/* 1. ЗАКОН ОБРАТНЫХ КВАДРАТОВ 1/r² */}
          {/* ========================================================================= */}
          {activeTab === 'inv_sq' && (
            <div className="space-y-4">
              <div className="p-3 rounded-xl bg-slate-900 border border-slate-800 text-xs text-slate-300 leading-relaxed">
                <strong className="text-cyan-400">Теоретическая формула ГОСТ Р 8.804:</strong>{' '}
                Мощность эквивалентной дозы точечного изотропного источника убывает обратно пропорционально квадрату расстояния:{' '}
                <code className="text-amber-300 font-mono">Ḋ(r₂) = Ḋ(r₁) · (r₁ / r₂)²</code>. При двукратном удалении интенсивность падает в 4 раза.
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-3 bg-slate-900/60 p-4 rounded-xl border border-slate-800">
                <div>
                  <label className="text-xs text-slate-400 block mb-1">Дистанция 1 (r₁), метры:</label>
                  <input
                    type="number"
                    step="0.1"
                    min="0.1"
                    value={invR1}
                    onChange={e => setInvR1(parseFloat(e.target.value) || 0.1)}
                    className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-1.5 font-mono text-cyan-300"
                  />
                </div>
                <div>
                  <label className="text-xs text-slate-400 block mb-1">Дистанция 2 (r₂), метры:</label>
                  <input
                    type="number"
                    step="0.1"
                    min="0.1"
                    value={invR2}
                    onChange={e => setInvR2(parseFloat(e.target.value) || 0.1)}
                    className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-1.5 font-mono text-cyan-300"
                  />
                </div>
                <div>
                  <label className="text-xs text-slate-400 block mb-1">Измеренная Ḋ(r₁), мкЗв/ч:</label>
                  <div className="flex gap-2">
                    <input
                      type="number"
                      step="1"
                      min="0"
                      value={invDose1}
                      onChange={e => setInvDose1(parseFloat(e.target.value) || 0)}
                      className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-1.5 font-mono text-cyan-300"
                    />
                    <button
                      onClick={() => setInvDose1(Math.round(currentDoseRateMicroSv * 10) / 10)}
                      title="Вставить текущее показание датчика"
                      className="px-2.5 py-1 text-xs bg-slate-800 hover:bg-slate-700 rounded border border-slate-700 whitespace-nowrap text-amber-300"
                    >
                      С датчика
                    </button>
                  </div>
                </div>
              </div>

              {/* Поля студенческого ввода */}
              <div className="p-4 rounded-xl bg-cyan-950/20 border border-cyan-800/40 space-y-3">
                <h4 className="text-xs font-bold text-cyan-300 uppercase tracking-wider flex items-center gap-2">
                  <Calculator className="w-4 h-4" />
                  Ручной расчёт студента (заполните перед проверкой):
                </h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="text-xs text-slate-300 block mb-1">
                      1. Рассчитанный геометрический фактор (r₁/r₂)²:
                    </label>
                    <input
                      type="text"
                      placeholder="Например: 0.16"
                      value={studentInvRatio}
                      onChange={e => setStudentInvRatio(e.target.value)}
                      className="w-full bg-slate-900 border border-cyan-700/60 rounded-lg px-3 py-2 font-mono text-white placeholder-slate-600 focus:outline-none focus:border-cyan-400"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-slate-300 block mb-1">
                      2. Ожидаемая мощность дозы Ḋ(r₂), мкЗв/ч:
                    </label>
                    <input
                      type="text"
                      placeholder="Например: 16.0"
                      value={studentInvDose2}
                      onChange={e => setStudentInvDose2(e.target.value)}
                      className="w-full bg-slate-900 border border-cyan-700/60 rounded-lg px-3 py-2 font-mono text-white placeholder-slate-600 focus:outline-none focus:border-cyan-400"
                    />
                  </div>
                </div>
                <div className="flex justify-end pt-1">
                  <button
                    onClick={handleCheckInverseSquare}
                    className="px-4 py-2 bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-bold rounded-xl transition shadow-lg flex items-center gap-2"
                  >
                    <span>Сверить расчет с эталоном (НУ)</span>
                    <ArrowRight className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {/* Таблица проверки */}
              {invResults && (
                <div className="mt-3 overflow-hidden rounded-xl border border-slate-800">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="bg-slate-900 text-slate-400 border-b border-slate-800">
                        <th className="p-3">Физический параметр</th>
                        <th className="p-3">Значение студента</th>
                        <th className="p-3">Номинальный эталон (НУ)</th>
                        <th className="p-3">Погрешность δ</th>
                        <th className="p-3">Оценка</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800 font-mono">
                      {invResults.map((res, i) => (
                        <tr key={i} className="hover:bg-slate-900/40">
                          <td className="p-3 font-sans text-slate-200">{res.parameterName}</td>
                          <td className="p-3 text-cyan-300 font-bold">{res.studentValue} {res.unit}</td>
                          <td className="p-3 text-amber-300">{res.referenceValue.toFixed(3)} {res.unit}</td>
                          <td className={`p-3 font-bold ${res.relativeErrorPercent <= 5 ? 'text-emerald-400' : res.relativeErrorPercent <= 15 ? 'text-yellow-400' : 'text-rose-400'}`}>
                            {res.relativeErrorPercent.toFixed(1)}%
                          </td>
                          <td className="p-3 font-sans">
                            <span className={`px-2 py-0.5 rounded text-[11px] font-bold ${res.isPassed ? 'bg-emerald-500/20 text-emerald-300' : 'bg-rose-500/20 text-rose-300'}`}>
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

          {/* ========================================================================= */}
          {/* 2. ЗАКОН БУГЕРА-ЛАМБЕРТА-БЕРА (ОСЛАБЛЕНИЕ И СИЗ) */}
          {/* ========================================================================= */}
          {activeTab === 'attenuation' && (
            <div className="space-y-4">
              <div className="p-3 rounded-xl bg-slate-900 border border-slate-800 text-xs text-slate-300 leading-relaxed">
                <strong className="text-cyan-400">Закон экспоненциального ослабления:</strong>{' '}
                <code className="text-amber-300 font-mono">I(d) = I₀ · B(E, μd) · exp(-μ(E) · d)</code>, где{' '}
                <code className="text-cyan-300 font-mono">μ</code> — линейный коэффициент ослабления (см⁻¹),{' '}
                <code className="text-cyan-300 font-mono">B</code> — фактор накопления рассеянного излучения Тейлора,{' '}
                <code className="text-cyan-300 font-mono">K_shield = I₀ / I(d)</code> — кратность ослабления.
              </div>

              <div className="grid grid-cols-1 md:grid-cols-4 gap-3 bg-slate-900/60 p-4 rounded-xl border border-slate-800">
                <div>
                  <label className="text-xs text-slate-400 block mb-1">Материал экрана:</label>
                  <select
                    value={attMaterial}
                    onChange={e => setAttMaterial(e.target.value as ShieldMaterialType)}
                    className="w-full bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs font-mono text-cyan-300"
                  >
                    <option value="lead">Свинец (ρ = 11.34 г/см³)</option>
                    <option value="steel">Сталь марки 20 (ρ = 7.85 г/см³)</option>
                    <option value="concrete">Тяжелый бетон (ρ = 2.35 г/см³)</option>
                    <option value="water">Водный барьер (ρ = 1.0 г/см³)</option>
                    <option value="paraffin_borated">Борированный полиэтилен 5% B</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs text-slate-400 block mb-1">Толщина d, см:</label>
                  <input
                    type="number"
                    step="0.5"
                    min="0"
                    value={attThicknessCm}
                    onChange={e => setAttThicknessCm(parseFloat(e.target.value) || 0)}
                    className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-1.5 font-mono text-cyan-300"
                  />
                </div>
                <div>
                  <label className="text-xs text-slate-400 block mb-1">Энергия E_γ, МэВ:</label>
                  <select
                    value={attEnergyMev}
                    onChange={e => setAttEnergyMev(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs font-mono text-cyan-300"
                  >
                    <option value="0.662">0.662 МэВ (¹³⁷Cs)</option>
                    <option value="1.25">1.25 МэВ (⁶⁰Co)</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs text-slate-400 block mb-1">Падающая I₀, мкЗв/ч:</label>
                  <input
                    type="number"
                    step="5"
                    value={attI0}
                    onChange={e => setAttI0(parseFloat(e.target.value) || 0)}
                    className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-1.5 font-mono text-cyan-300"
                  />
                </div>
              </div>

              {/* Поля студенческого ввода */}
              <div className="p-4 rounded-xl bg-cyan-950/20 border border-cyan-800/40 space-y-3">
                <h4 className="text-xs font-bold text-cyan-300 uppercase tracking-wider flex items-center gap-2">
                  <Calculator className="w-4 h-4" />
                  Расчёт коэффициентов студентом:
                </h4>
                <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                  <div>
                    <label className="text-xs text-slate-300 block mb-1">
                      1. Коэффициент μ, см⁻¹:
                    </label>
                    <input
                      type="text"
                      placeholder="напр. 0.77"
                      value={studentMu}
                      onChange={e => setStudentMu(e.target.value)}
                      className="w-full bg-slate-900 border border-cyan-700/60 rounded-lg px-3 py-2 font-mono text-white text-xs placeholder-slate-600 focus:outline-none focus:border-cyan-400"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-slate-300 block mb-1">
                      2. Фактор Тейлора B:
                    </label>
                    <input
                      type="text"
                      placeholder="напр. 1.25"
                      value={studentBuildupB}
                      onChange={e => setStudentBuildupB(e.target.value)}
                      className="w-full bg-slate-900 border border-cyan-700/60 rounded-lg px-3 py-2 font-mono text-white text-xs placeholder-slate-600 focus:outline-none focus:border-cyan-400"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-slate-300 block mb-1">
                      3. Интенсивность I(d):
                    </label>
                    <input
                      type="text"
                      placeholder="напр. 40.5"
                      value={studentAttIntensity}
                      onChange={e => setStudentAttIntensity(e.target.value)}
                      className="w-full bg-slate-900 border border-cyan-700/60 rounded-lg px-3 py-2 font-mono text-white text-xs placeholder-slate-600 focus:outline-none focus:border-cyan-400"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-slate-300 block mb-1">
                      4. Кратность K_shield:
                    </label>
                    <input
                      type="text"
                      placeholder="напр. 3.7"
                      value={studentKShield}
                      onChange={e => setStudentKShield(e.target.value)}
                      className="w-full bg-slate-900 border border-cyan-700/60 rounded-lg px-3 py-2 font-mono text-white text-xs placeholder-slate-600 focus:outline-none focus:border-cyan-400"
                    />
                  </div>
                </div>
                <div className="flex justify-end pt-1">
                  <button
                    onClick={handleCheckAttenuation}
                    className="px-4 py-2 bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-bold rounded-xl transition shadow-lg flex items-center gap-2"
                  >
                    <span>Сверить с эталоном Бугера</span>
                    <ArrowRight className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {/* Таблица проверки */}
              {attResults && (
                <div className="mt-3 overflow-hidden rounded-xl border border-slate-800">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="bg-slate-900 text-slate-400 border-b border-slate-800">
                        <th className="p-3">Физический параметр</th>
                        <th className="p-3">Значение студента</th>
                        <th className="p-3">Номинальный эталон (НУ)</th>
                        <th className="p-3">Погрешность δ</th>
                        <th className="p-3">Оценка</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800 font-mono">
                      {attResults.map((res, i) => (
                        <tr key={i} className="hover:bg-slate-900/40">
                          <td className="p-3 font-sans text-slate-200">{res.parameterName}</td>
                          <td className="p-3 text-cyan-300 font-bold">{res.studentValue} {res.unit}</td>
                          <td className="p-3 text-amber-300">{res.referenceValue.toFixed(3)} {res.unit}</td>
                          <td className={`p-3 font-bold ${res.relativeErrorPercent <= 5 ? 'text-emerald-400' : res.relativeErrorPercent <= 15 ? 'text-yellow-400' : 'text-rose-400'}`}>
                            {res.relativeErrorPercent.toFixed(1)}%
                          </td>
                          <td className="p-3 font-sans">
                            <span className={`px-2 py-0.5 rounded text-[11px] font-bold ${res.isPassed ? 'bg-emerald-500/20 text-emerald-300' : 'bg-rose-500/20 text-rose-300'}`}>
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

          {/* ========================================================================= */}
          {/* 3. РАСЧЕТ ДОЗ: ПОГЛОЩЕННАЯ, ЭКВИВАЛЕНТНАЯ И ЭФФЕКТИВНАЯ */}
          {/* ========================================================================= */}
          {activeTab === 'dose_calc' && (
            <div className="space-y-4">
              <div className="p-3 rounded-xl bg-slate-900 border border-slate-800 text-xs text-slate-300 leading-relaxed">
                <strong className="text-cyan-400">Формулы регламента НРБ-99/2009 (СанПиН 2.6.1.2523-09):</strong>
                <ul className="list-disc list-inside mt-1 space-y-0.5 font-mono text-[11px]">
                  <li>Поглощенная доза: <span className="text-amber-300">D = Ḋ · t</span> (мГр)</li>
                  <li>Эквивалентная доза органа/ткани: <span className="text-amber-300">H_T = D · w_R</span> (мЗв)</li>
                  <li>Эффективная доза с учетом СИЗ: <span className="text-amber-300">E = H_T · w_T · (1 / k_PPE)</span> (мЗв)</li>
                </ul>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-5 gap-3 bg-slate-900/60 p-4 rounded-xl border border-slate-800">
                <div>
                  <label className="text-xs text-slate-400 block mb-1">Мощность Ḋ, мкЗв/ч:</label>
                  <input
                    type="number"
                    step="1"
                    value={doseDoseRate}
                    onChange={e => setDoseDoseRate(parseFloat(e.target.value) || 0)}
                    className="w-full bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-1.5 font-mono text-cyan-300"
                  />
                </div>
                <div>
                  <label className="text-xs text-slate-400 block mb-1">Время t, часов:</label>
                  <input
                    type="number"
                    step="0.1"
                    value={doseTimeHours}
                    onChange={e => setDoseTimeHours(parseFloat(e.target.value) || 0)}
                    className="w-full bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-1.5 font-mono text-cyan-300"
                  />
                </div>
                <div>
                  <label className="text-xs text-slate-400 block mb-1">Вид излучения (w_R):</label>
                  <select
                    value={doseRadType}
                    onChange={e => setDoseRadType(e.target.value as RadiationType)}
                    className="w-full bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs font-mono text-cyan-300"
                  >
                    <option value="gamma">Гамма / Рентген (w_R = 1.0)</option>
                    <option value="beta">Бета-частицы (w_R = 1.0)</option>
                    <option value="alpha">Альфа-частицы (w_R = 20.0)</option>
                    <option value="fast_neutron">Быстрые нейтроны (w_R = 10.0)</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs text-slate-400 block mb-1">Орган / Ткань (w_T):</label>
                  <select
                    value={doseTissue}
                    onChange={e => setDoseTissue(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs font-mono text-cyan-300"
                  >
                    {Object.values(TISSUE_WEIGHTING_FACTORS_WT).map(t => (
                      <option key={t.id} value={t.id}>
                        {t.nameRu} (w_T={t.wT})
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-xs text-slate-400 block mb-1">Фактор СИЗ k_PPE:</label>
                  <input
                    type="number"
                    step="0.1"
                    min="1.0"
                    value={dosePpeFactor}
                    onChange={e => setDosePpeFactor(parseFloat(e.target.value) || 1.0)}
                    className="w-full bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-1.5 font-mono text-cyan-300"
                  />
                </div>
              </div>

              {/* Поля студенческого ввода */}
              <div className="p-4 rounded-xl bg-cyan-950/20 border border-cyan-800/40 space-y-3">
                <h4 className="text-xs font-bold text-cyan-300 uppercase tracking-wider flex items-center gap-2">
                  <Calculator className="w-4 h-4" />
                  Расчёт доз студентом (мГр / мЗв):
                </h4>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <div>
                    <label className="text-xs text-slate-300 block mb-1">
                      1. Поглощенная доза D, мГр:
                    </label>
                    <input
                      type="text"
                      placeholder="напр. 0.025"
                      value={studentAbsorbedD}
                      onChange={e => setStudentAbsorbedD(e.target.value)}
                      className="w-full bg-slate-900 border border-cyan-700/60 rounded-lg px-3 py-2 font-mono text-white text-xs placeholder-slate-600 focus:outline-none focus:border-cyan-400"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-slate-300 block mb-1">
                      2. Эквивалентная доза H_T, мЗв:
                    </label>
                    <input
                      type="text"
                      placeholder="напр. 0.025"
                      value={studentEquivalentH}
                      onChange={e => setStudentEquivalentH(e.target.value)}
                      className="w-full bg-slate-900 border border-cyan-700/60 rounded-lg px-3 py-2 font-mono text-white text-xs placeholder-slate-600 focus:outline-none focus:border-cyan-400"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-slate-300 block mb-1">
                      3. Эффективная доза E, мЗв:
                    </label>
                    <input
                      type="text"
                      placeholder="напр. 0.021"
                      value={studentEffectiveE}
                      onChange={e => setStudentEffectiveE(e.target.value)}
                      className="w-full bg-slate-900 border border-cyan-700/60 rounded-lg px-3 py-2 font-mono text-white text-xs placeholder-slate-600 focus:outline-none focus:border-cyan-400"
                    />
                  </div>
                </div>
                <div className="flex justify-end pt-1">
                  <button
                    onClick={handleCheckDose}
                    className="px-4 py-2 bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-bold rounded-xl transition shadow-lg flex items-center gap-2"
                  >
                    <span>Сверить расчет доз по НРБ-99/2009</span>
                    <ArrowRight className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {/* Таблица проверки */}
              {doseResults && (
                <div className="mt-3 overflow-hidden rounded-xl border border-slate-800">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="bg-slate-900 text-slate-400 border-b border-slate-800">
                        <th className="p-3">Физический параметр</th>
                        <th className="p-3">Значение студента</th>
                        <th className="p-3">Номинальный эталон (НУ)</th>
                        <th className="p-3">Погрешность δ</th>
                        <th className="p-3">Оценка</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800 font-mono">
                      {doseResults.map((res, i) => (
                        <tr key={i} className="hover:bg-slate-900/40">
                          <td className="p-3 font-sans text-slate-200">{res.parameterName}</td>
                          <td className="p-3 text-cyan-300 font-bold">{res.studentValue} {res.unit}</td>
                          <td className="p-3 text-amber-300">{res.referenceValue.toFixed(4)} {res.unit}</td>
                          <td className={`p-3 font-bold ${res.relativeErrorPercent <= 5 ? 'text-emerald-400' : res.relativeErrorPercent <= 15 ? 'text-yellow-400' : 'text-rose-400'}`}>
                            {res.relativeErrorPercent.toFixed(1)}%
                          </td>
                          <td className="p-3 font-sans">
                            <span className={`px-2 py-0.5 rounded text-[11px] font-bold ${res.isPassed ? 'bg-emerald-500/20 text-emerald-300' : 'bg-rose-500/20 text-rose-300'}`}>
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

          {/* ========================================================================= */}
          {/* ИТОГОВАЯ ВЕДОМОСТЬ И ОЦЕНКА */}
          {/* ========================================================================= */}
          {activeTab === 'summary' && (
            <div className="space-y-4">
              <div className="p-4 rounded-xl bg-slate-900 border border-slate-800 flex items-center justify-between">
                <div>
                  <h3 className="text-base font-bold text-white flex items-center gap-2">
                    <Award className="w-5 h-5 text-amber-400" />
                    <span>Итоговый протокол математического этапа практикума</span>
                  </h3>
                  <p className="text-xs text-slate-400 mt-0.5">
                    Комплексная оценка выполнения самостоятельных расчетов по ГОСТ Р 8.804-2012
                  </p>
                </div>
                <div className="text-right">
                  <div className="text-2xl font-black font-mono text-cyan-400">
                    {passedCount} / {allResults.length || 0}
                  </div>
                  <div className="text-[11px] text-slate-400">Пройдено этапов</div>
                </div>
              </div>

              {allResults.length === 0 ? (
                <div className="p-8 text-center text-slate-500 border border-dashed border-slate-800 rounded-xl">
                  Вы пока не провели ни одного расчета. Перейдите во вкладки 1, 2 или 3, введите данные и нажмите «Сверить с эталоном».
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    <div className="p-3 rounded-xl bg-slate-900/60 border border-slate-800 text-center">
                      <div className="text-xs text-slate-400">Средняя погрешность:</div>
                      <div className={`text-xl font-bold font-mono ${avgError <= 5 ? 'text-emerald-400' : avgError <= 15 ? 'text-amber-400' : 'text-rose-400'}`}>
                        {avgError.toFixed(2)}%
                      </div>
                    </div>
                    <div className="p-3 rounded-xl bg-slate-900/60 border border-slate-800 text-center">
                      <div className="text-xs text-slate-400">Итоговая оценка:</div>
                      <div className="text-xl font-bold text-amber-300">
                        {avgError <= 5 ? '5 (Отлично)' : avgError <= 12 ? '4 (Хорошо)' : avgError <= 25 ? '3 (Удовл.)' : '2 (Не зачтено)'}
                      </div>
                    </div>
                    <div className="p-3 rounded-xl bg-slate-900/60 border border-slate-800 text-center">
                      <div className="text-xs text-slate-400">Статус зачета:</div>
                      <div className={`text-xl font-bold ${passedCount === allResults.length ? 'text-emerald-400' : 'text-amber-400'}`}>
                        {passedCount === allResults.length ? 'ЗАЧТЕНО' : 'ТРЕБУЕТСЯ ДОРАБОТКА'}
                      </div>
                    </div>
                  </div>

                  <div className="overflow-hidden rounded-xl border border-slate-800 text-xs">
                    <table className="w-full text-left border-collapse">
                      <thead>
                        <tr className="bg-slate-900 text-slate-400 border-b border-slate-800">
                          <th className="p-2.5">Параметр</th>
                          <th className="p-2.5">Студент</th>
                          <th className="p-2.5">Эталон (НУ)</th>
                          <th className="p-2.5">Погрешность δ</th>
                          <th className="p-2.5">Оценка</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-800 font-mono">
                        {allResults.map((r, idx) => (
                          <tr key={idx} className="hover:bg-slate-900/40">
                            <td className="p-2.5 font-sans text-slate-200">{r.parameterName}</td>
                            <td className="p-2.5 text-cyan-300">{r.studentValue} {r.unit}</td>
                            <td className="p-2.5 text-amber-300">{r.referenceValue.toFixed(3)} {r.unit}</td>
                            <td className={`p-2.5 font-bold ${r.relativeErrorPercent <= 5 ? 'text-emerald-400' : 'text-yellow-400'}`}>
                              {r.relativeErrorPercent.toFixed(1)}%
                            </td>
                            <td className="p-2.5 font-sans">
                              <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${r.isPassed ? 'bg-emerald-500/20 text-emerald-300' : 'bg-rose-500/20 text-rose-300'}`}>
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
        <div className="flex justify-between items-center border-t border-slate-800 pt-3 shrink-0 text-xs">
          <div className="text-slate-400 flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            <span>Автоматическая поверка формул по НРБ-99/2009 и ГОСТ 27451-87 активна</span>
          </div>
          <button
            onClick={onClose}
            className="px-5 py-2 bg-slate-800 hover:bg-slate-700 text-white font-bold rounded-xl transition"
          >
            Закрыть журнал
          </button>
        </div>

      </div>
    </div>
  );
};
