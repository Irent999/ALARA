/**
 * Самопроверка (npx tsx src/quest/questSelfTest.ts): имитация мира + «читер» и «честный студент».
 */
import { createLabQuest, DEFAULT_QUEST_CONFIG, type QuestSensors, type QuestSnapshot } from './index';

let failures = 0;
const ok = (cond: boolean, msg: string) => { if (!cond) { failures++; console.error('  ✗ ' + msg); } else console.log('  ✓ ' + msg); };

/** Простая «физика» мира для теста. */
class World {
  t = 0;
  pos = { x: 10, y: 1, z: 0 };       // источник в (0,1,0)
  held = true;
  shield = false;
  kShield = 8;
  surface: number | null = null;     // расстояние до стены
  contamination = 0;
  cumulative = 0;                    // мЗв
  abInstrument = true;
  noise = 0.03;
  private seed = 12345;
  rnd() { this.seed = (this.seed * 1664525 + 1013904223) >>> 0; return this.seed / 4294967296; }
  dist() { return Math.max(0.1, Math.hypot(this.pos.x, this.pos.y - 1, this.pos.z)); }
  rate() { return 0.1 + (500 / (this.dist() ** 2)) / (this.shield ? this.kShield : 1); } // мкЗв/ч, фон 0.1
  sense(dt: number): QuestSensors {
    this.t += dt;
    const r = this.rate();
    this.cumulative += (r / 3600 / 1000) * dt; // мкЗв/ч → мЗв за dt секунд
    return {
      timeSec: this.t, dt, instrumentHeld: this.held, instrumentId: this.abInstrument ? 'alpha_zns' : 'dp5',
      instrumentDetectsAlphaBeta: this.abInstrument, probePos: { ...this.pos }, nearestSourceDistM: this.dist(),
      readingUSvh: r * (1 + this.noise * (this.rnd() * 2 - 1)),
      shield: { present: this.shield, kShield: this.shield ? this.kShield : 1, material: 'lead', thicknessCm: 5 },
      doseRateUSvh: r, cumulativeDoseMSv: this.cumulative, surfaceDistanceM: this.surface, contaminationLevel: this.contamination
    };
  }
}

function run(q: ReturnType<typeof createLabQuest>, w: World, seconds: number, dt = 1 / 72, each?: (t: number) => void) {
  const n = Math.round(seconds / dt);
  for (let i = 0; i < n; i++) { each?.(w.t); q.update(w.sense(dt)); }
}
const snap = (q: ReturnType<typeof createLabQuest>): QuestSnapshot => q.getSnapshot();
const statuses = (q: ReturnType<typeof createLabQuest>) => snap(q).tasks.map(t => t.status[0]).join('');

/* ---------------------------------------------------------------- 1. «Читер» */
console.log('\n[1] Читер: подошёл к источнику вплотную и стоит 120 с');
{
  const completed: number[] = [];
  const q = createLabQuest({}, { onTaskCompleted: (_t, n) => completed.push(n) });
  const w = new World();
  w.pos = { x: 0.8, y: 1, z: 0 };
  w.surface = 0.05; w.contamination = 1;
  run(q, w, 120);
  ok(snap(q).completedCount === 0, `ни одно задание не засчитано (статусы: ${statuses(q)})`);
  ok(snap(q).activeIndex === 0, 'активно по-прежнему задание 1');
}

/* ------------------------------------------- 2. Кнопки не по порядку / не те */
console.log('\n[2] Нажатия «не тех» кнопок отклоняются');
{
  const q = createLabQuest();
  const w = new World();
  run(q, w, 0.5);
  q.dispatch({ type: 'save_distance_point' });
  q.dispatch({ type: 'measure_under_shield' });
  q.dispatch({ type: 'start_work_timer' });
  run(q, w, 0.2);
  ok(snap(q).completedCount === 0, 'ничего не засчитано');
  ok(snap(q).rejections.length >= 3, `отказы записаны (${snap(q).rejections.length})`);
  ok(/задани/i.test(snap(q).rejections[0].reasonRu), 'причина отказа названа студенту');
}

/* ---------------------------------------------- 3. Задание 1: граничные случаи */
console.log('\n[3] Задание 1: фон');
{
  const q = createLabQuest();
  const w = new World(); // далеко (10 м)
  run(q, w, 0.3);
  ok(snap(q).tasks[0].steps.filter(s => s.state === 'done').length >= 1, 'шаг «возьмите прибор» пройден по факту');
  // не на 3 с: 2 с и отпустил
  q.dispatch({ type: 'hold_fix_background', down: true });
  run(q, w, 2);
  q.dispatch({ type: 'hold_fix_background', down: false });
  run(q, w, 0.2);
  ok(snap(q).completedCount === 0, 'удержание 2 с < 3 с — не засчитано');
  // слишком близко (2 м)
  w.pos = { x: 2, y: 1, z: 0 };
  run(q, w, 0.3);
  q.dispatch({ type: 'hold_fix_background', down: true });
  run(q, w, 4);
  ok(snap(q).completedCount === 0, 'на 2 м (< 3 м) удержание не засчитывается');
  q.dispatch({ type: 'hold_fix_background', down: false });
  // лаг-спайк: один кадр dt = 5 с не должен «накрутить» удержание
  w.pos = { x: 10, y: 1, z: 0 };
  run(q, w, 0.3);
  q.dispatch({ type: 'hold_fix_background', down: true });
  q.update(w.sense(0.014));
  q.update(w.sense(5));       // лаг
  ok(snap(q).completedCount === 0, 'лаг-спайк 5 с не засчитывает удержание');
  q.dispatch({ type: 'hold_fix_background', down: false });
  // нестабильные показания
  w.noise = 0.9;
  run(q, w, 0.2);
  q.dispatch({ type: 'hold_fix_background', down: true });
  run(q, w, 4);
  ok(snap(q).completedCount === 0, 'нестабильные показания — не засчитано');
  q.dispatch({ type: 'hold_fix_background', down: false });
  // честное выполнение
  w.noise = 0.03;
  run(q, w, 0.3);
  q.dispatch({ type: 'hold_fix_background', down: true });
  run(q, w, 3.3);
  ok(snap(q).completedCount === 1 && snap(q).journal.background !== null, `честное удержание 3 с на 10 м — засчитано (фон ${snap(q).journal.background?.valueUSvh.toFixed(3)} мкЗв/ч)`);
  ok(snap(q).activeIndex === 1, 'открыто задание 2 (и только оно)');
}

/* ----------------------------------------------- 4. Полный честный прогон */
console.log('\n[4] Честный студент проходит все 5 заданий');
{
  const completionTicks: number[] = [];
  let tick = 0;
  const alarmCalls: number[] = [];
  let all = 0;
  const q = createLabQuest({}, {
    onTaskCompleted: () => completionTicks.push(tick),
    onAllCompleted: () => all++,
    onAlaraLimitReached: () => alarmCalls.push(tick)
  });
  const w = new World();
  const step = (sec: number, dt = 1 / 72) => { const n = Math.round(sec / dt); for (let i = 0; i < n; i++) { tick++; q.update(w.sense(dt)); } };

  // Задание 1
  step(0.3); q.dispatch({ type: 'hold_fix_background', down: true }); step(3.3);
  ok(snap(q).completedCount === 1, 'задание 1 выполнено');

  // Задание 2: точки на 1, 2, 3 м; нажатие сразу после завершения 1 блокируется (защита от проскока)
  q.dispatch({ type: 'save_distance_point' }); step(0.1);
  ok(snap(q).journal.distancePoints.length === 0, 'нажатие в момент перехода между заданиями не сохраняет точку');
  step(0.6);
  w.pos = { x: 1, y: 1, z: 0 }; step(2.2);
  q.dispatch({ type: 'save_distance_point' }); step(0.2);
  q.dispatch({ type: 'save_distance_point' }); step(0.2);                  // дубль на той же дистанции
  ok(snap(q).journal.distancePoints.length === 1, 'повторная точка на той же дистанции отклонена');
  w.pos = { x: 2, y: 1, z: 0 }; step(2.2); q.dispatch({ type: 'save_distance_point' }); step(0.2);
  ok(snap(q).completedCount === 1, 'после 2 точек задание 2 ещё не засчитано');
  w.pos = { x: 3, y: 1, z: 0 }; step(2.2); q.dispatch({ type: 'save_distance_point' }); step(0.5);
  ok(snap(q).completedCount === 2, 'после 3 точек (1, 2, 3 м) и проверки 1/r² задание 2 выполнено');

  // Задание 3: без экрана — отказ; с экраном — измерение
  step(0.6);
  q.dispatch({ type: 'measure_under_shield' }); step(0.2);
  ok(snap(q).completedCount === 2, 'без физического экрана кнопка «Измерить под экраном» не засчитывается');
  w.shield = true; step(1.0);
  q.dispatch({ type: 'measure_under_shield' }); step(0.5);
  w.shield = false; step(0.3);   // убрал экран во время измерения
  ok(snap(q).completedCount === 2, 'экран убран во время измерения — измерение прервано');
  w.shield = true; step(1.0);
  q.dispatch({ type: 'measure_under_shield' }); step(1.8);
  ok(snap(q).completedCount === 3 && snap(q).journal.shield !== null, `с экраном (K=${snap(q).journal.shield?.attenuationK}) задание 3 выполнено`);
  w.shield = false;

  // Задание 4: ALARA. Сначала вне зоны (10 м) — задание не «видит» ввод; потом в зону.
  step(0.6);
  w.pos = { x: 10, y: 1, z: 0 }; step(0.3);
  q.dispatch({ type: 'set_alara_limit', limitMSv: 0.01 }); step(0.2);
  ok(snap(q).journal.alara === null && snap(q).completedCount === 3, 'вне зоны ввод предела отклонён');
  w.pos = { x: 3, y: 1, z: 0 }; step(0.5);   // 500/9 ≈ 55 мкЗв/ч — зона повышенной дозы
  q.dispatch({ type: 'start_work_timer' }); step(0.2);
  ok(snap(q).tasks[3].steps[2].state !== 'done', 'таймер нельзя запустить без предела');
  // Попытка 1: слишком маленький предел → лимит сработает
  q.dispatch({ type: 'set_alara_limit', limitMSv: 0.0001 }); step(0.3);
  q.dispatch({ type: 'start_work_timer' }); step(0.3);
  w.pos = { x: 0.6, y: 1, z: 0 };       // идёт работа у источника (≈1390 мкЗв/ч)
  step(2);
  ok(alarmCalls.length === 1, 'звуковой лимит сработал, пока студент оставался в зоне');
  ok(snap(q).completedCount === 3, 'при срабатывании лимита задание НЕ засчитано');
  // Попытка 2: разумный предел, но выход из зоны раньше минимального времени работы
  w.pos = { x: 3, y: 1, z: 0 }; step(0.5);
  q.dispatch({ type: 'set_alara_limit', limitMSv: 0.05 }); step(0.3);
  q.dispatch({ type: 'start_work_timer' }); step(0.3);
  w.pos = { x: 4, y: 1, z: 0 }; step(2);
  w.pos = { x: 10, y: 1, z: 0 }; step(0.3);
  ok(snap(q).completedCount === 3, 'выход из зоны раньше минимального времени работы — не засчитано, процедура начинается заново');
  // Попытка 3: полный алгоритм: зона → предел → таймер → работа ≥ 8 с → выход до лимита
  w.pos = { x: 3, y: 1, z: 0 }; step(0.5);
  q.dispatch({ type: 'set_alara_limit', limitMSv: 0.05 }); step(0.3);
  q.dispatch({ type: 'start_work_timer' }); step(0.3);
  step(9);                                               // работа 9 с на 3 м (≈55 мкЗв/ч → ≈ 0.14 мкЗв ≪ 50 мкЗв)
  ok(snap(q).completedCount === 3, 'пока студент остаётся в зоне — задание не засчитывается (нужно покинуть зону)');
  w.pos = { x: 10, y: 1, z: 0 }; step(0.5);
  ok(snap(q).completedCount === 4 && snap(q).journal.alara?.leftZoneBeforeLimit === true, 'задание 4: предел введён, таймер запущен, зона покинута до лимита');

  // Задание 5: триггер по расстоянию до источника отсутствует; нужны контакт + скан
  step(0.6);
  w.pos = { x: 0.5, y: 1, z: 0 }; w.surface = 0.05; w.contamination = 1;   // вплотную к источнику И к стене, но стоит
  step(30);
  ok(snap(q).completedCount === 4, 'стоять рядом с источником и стеной 30 с — не засчитывается (нет движения)');
  // слишком быстро
  const sweep = (speed: number, sec: number) => {
    const dt = 1 / 72; const n = Math.round(sec / dt);
    for (let i = 0; i < n; i++) { w.pos.x = 0.5 + ((w.t * speed) % 1.2); w.pos.z = 0.3 * Math.sin(w.t * speed * 4); tick++; q.update(w.sense(dt)); }
  };
  sweep(1.5, 12);
  ok(snap(q).completedCount === 4, 'слишком быстрый «взмах» (1.5 м/с) не засчитывается');
  // датчик далеко от стены
  w.surface = 0.4; sweep(0.2, 12);
  ok(snap(q).completedCount === 4, 'на расстоянии 40 см от стены (> 10 см) скан не идёт');
  // правильный плавный скан
  w.surface = 0.05; sweep(0.2, 8);
  ok(snap(q).completedCount === 5 && snap(q).journal.scan !== null, `плавный скан у стены 8 с — засчитано (покрытие ${snap(q).journal.scan?.cells} ячеек, путь ${snap(q).journal.scan?.pathLengthM.toFixed(2)} м)`);

  ok(all === 1, 'onAllCompleted вызван ровно один раз');
  ok(new Set(completionTicks).size === completionTicks.length, 'никакие два задания не завершились в одном кадре');
  ok(completionTicks.length === 5, 'ровно 5 событий завершения');
}

/* ------------------------------------------------------ 5. Сброс */
console.log('\n[5] reset()');
{
  const q = createLabQuest();
  q.reset();
  ok(snap(q).completedCount === 0 && snap(q).activeIndex === 0, 'после reset активно задание 1');
}

console.log(failures ? `\nПРОВАЛЕНО: ${failures}` : '\nВсе проверки пройдены');
process.exit(failures ? 1 : 0);
