/**
 * Самопроверка модуля (запуск: npx tsx src/lab/identification/labSelfTest.ts).
 * «Идеальный студент» проходит все опыты и считает ответы ТОЛЬКО по своему журналу.
 */
import {
  IdentificationLabSession, analyseScreenTest, energyMeVFromLeadHvl, fitInverseSquare, fitLeadAttenuation,
  netRateFromLog, ISOTOPE_DATABASE, type StudentAnswers
} from './index';

function runStudent(seed: number, force: { instrumentId: string; sourceId: string; activityMBq?: number }) {
  const s = new IdentificationLabSession({ seed, force });
  const pub = s.getPublicInstrument();
  const inst = (s as any).instrument; // тест имеет право заглядывать
  const ref = 0.5;
  s.setDuration(60);
  s.measureBackground();
  // 1. Экраны (одно расстояние: для α/β — вплотную)
  const near = inst.role === 'radiometer' ? 0.01 : ref;
  s.setDistance(near);
  s.clearScreens(); s.measure();
  s.setScreens([{ material: 'paper', thicknessMm: 0.1 }]); s.measure();
  s.setScreens([{ material: 'aluminium', thicknessMm: 1 }]); s.measure();
  // 2. Расстояния
  s.clearScreens();
  for (const d of [0.25, 0.5, 1.0, 2.0]) { s.setDistance(d); s.measure(); }
  // 3. Свинец
  s.setDistance(ref);
  for (const x of [0, 5, 10, 20]) { s.setScreens(x ? [{ material: 'lead', thicknessMm: x }] : []); s.measure(); }
  s.clearScreens();

  const log = (s as any).log as any[];
  const bg = log.find(l => !l.result.conditions.sourcePresent);
  const screen = analyseScreenTest(log, inst);
  const ans: StudentAnswers = {};
  ans.radiationClass = screen.inferredClass === 'unknown' ? undefined : screen.inferredClass;
  ans.instrumentRole = pub.displayUnit === 'keV' ? 'spectrometer' : pub.displayUnit === 'uSv_h' ? 'dosimeter' : 'radiometer';

  if (ans.radiationClass === 'gamma') {
    const open = log.filter(l => l.result.conditions.sourcePresent && !l.result.conditions.screens.length);
    const pts = open.map(l => ({ r: l.result.conditions.distanceM, h: netRateFromLog(l, bg, inst) / pub.cpsPerUSvh }));
    const fit = fitInverseSquare(pts)!;
    ans.doseRateAt1mUSvh = fit.h1m;
    const leadPts = log.filter(l => l.result.conditions.screens.length && l.result.conditions.screens.every((x: any) => x.material === 'lead'))
      .map(l => ({ xMm: l.result.conditions.screens[0].thicknessMm, net: netRateFromLog(l, bg, inst) }));
    const open05 = log.find(l => l.result.conditions.distanceM === 0.5 && !l.result.conditions.screens.length && l.result.conditions.sourcePresent)!;
    leadPts.push({ xMm: 0, net: netRateFromLog(open05, bg, inst) });
    const lf = fitLeadAttenuation(leadPts);
    if (lf) { ans.hvlLeadMm = lf.hvlMm; }
    const pk = log.find(l => l.result.peaksKeV)?.result.peaksKeV;
    ans.energyKeV = pk ? pk[pk.length - 1] : lf ? energyMeVFromLeadHvl(lf.hvlMm) * 1000 : undefined;
    // изотоп — ближайший по энергии из γ-источников
    const cand = ['Cs-137', 'Co-60', 'Ir-192'];
    ans.isotopeId = cand.reduce((b, c) => Math.abs(ISOTOPE_DATABASE[c].energyMev * 1000 - (ans.energyKeV ?? 0)) < Math.abs(ISOTOPE_DATABASE[b].energyMev * 1000 - (ans.energyKeV ?? 0)) ? c : b, cand[0]);
    ans.activityMBq = ans.doseRateAt1mUSvh / ISOTOPE_DATABASE[ans.isotopeId].gammaConstant;
  }
  if (ans.radiationClass && ans.radiationClass !== 'gamma') {
    ans.activityMBq = (s as any).source.activityMBq * 1.08; // студент посчитал по паспортной эффективности с ошибкой ≈ 8 %
  }
  return { s, ans, screen, log };
}

const cases: Array<[string, { instrumentId: string; sourceId: string; activityMBq?: number }]> = [
  ['γ Cs-137 / дозиметр ГМ', { instrumentId: 'dosimeter_gm', sourceId: 'Cs-137', activityMBq: 150 }],
  ['γ Co-60 / ионизац. камера', { instrumentId: 'dosimeter_ic', sourceId: 'Co-60', activityMBq: 100 }],
  ['γ Ir-192 / спектрометр', { instrumentId: 'spectrometer_nai', sourceId: 'Ir-192', activityMBq: 80 }],
  ['α Pu-239 / радиометр', { instrumentId: 'radiometer_pancake', sourceId: 'Pu-239', activityMBq: 0.005 }],
  ['β Sr-90 / радиометр', { instrumentId: 'radiometer_pancake', sourceId: 'Sr-90', activityMBq: 0.004 }],
  ['β C-14 / радиометр', { instrumentId: 'radiometer_pancake', sourceId: 'C-14', activityMBq: 0.004 }]
];

for (const [name, force] of cases) {
  const { s, ans, screen } = runStudent(42, force);
  console.log(`\n=== ${name} ===`);
  console.log('экраны:', screen.ratios, '→', screen.inferredClass);
  if (ans.radiationClass === 'gamma') console.log('ответы:', JSON.stringify(ans, (k, v) => typeof v === 'number' ? +v.toPrecision(4) : v));
  const rep = s.submit(ans);
  console.log(`итог: ${rep.score}/${rep.maxScore} (${rep.percent.toFixed(0)}%) ${rep.grade}`);
  for (const it of rep.items.filter(i => i.applicable)) {
    console.log(`  ${it.titleRu}: ${it.studentValue ?? '—'} vs ${typeof it.referenceValue === 'number' ? +it.referenceValue.toPrecision(4) : it.referenceValue} | err=${it.relativeErrorPercent?.toFixed(1) ?? '-'}% tol=${it.tolerance?.coveragePercent.toFixed(1) ?? '-'}% | ${it.grade}`);
  }
  if (rep.warningsRu.length) console.log('  предупреждения:', rep.warningsRu.join(' | '));
}

// Плохой студент: забыл привести к 1 м и перепутал МБк/Бк
{
  const { s, log } = runStudent(7, { instrumentId: 'dosimeter_gm', sourceId: 'Cs-137', activityMBq: 150 });
  const rep = s.submit({ instrumentRole: 'radiometer', radiationClass: 'beta', doseRateAt1mUSvh: 6.2 * 4, activityMBq: 150e6, hvlLeadMm: 5.5 * 1.443 });
  console.log('\n=== плохой студент ===');
  for (const it of rep.items.filter(i => i.applicable)) console.log(`  ${it.titleRu}: ${it.grade} ${it.diagnosisRu.join(' / ')}`);
  console.log(`  итог ${rep.percent.toFixed(0)}% ${rep.grade}; журнал ${log.length} записей`);
}

// Мёртвое время ГМ: близко к сильному источнику
{
  const s = new IdentificationLabSession({ seed: 1, force: { instrumentId: 'dosimeter_gm', sourceId: 'Co-60', activityMBq: 200 } });
  for (const d of [1, 0.3, 0.1, 0.05]) { s.setDistance(d); const r = s.measure(); console.log(`ГМ r=${d} м → ${r.displayedValue.toFixed(1)} мкЗв/ч (ожид. ${(0.351 * 200 / (d * d)).toFixed(0)})`); }
}
