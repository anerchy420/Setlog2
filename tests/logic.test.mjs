import test from 'node:test';
import assert from 'node:assert/strict';
import {
  e1rm, weightForReps, entryStats, workoutStats, lastEntryFor, records, setPRs, detectPRs,
  suggestNext, platesFor, warmupSets, weekStartOf, streakWeeks, weeklySeries, partSets,
  parseNum, toCSV, workoutToText, workoutToTemplate, newWorkout, normalizeState, convertUnits,
  fmtDuration, movingAvg, DEFAULT_EXERCISES,
} from '../js/logic.js';

const exMap = Object.fromEntries(DEFAULT_EXERCISES.map((e) => [e.id, e]));
const BENCH = DEFAULT_EXERCISES.find((e) => e.name === 'ベンチプレス').id;
const PULL = DEFAULT_EXERCISES.find((e) => e.name === '懸垂').id;
const S = (w, r, k = 'n', done = true, rpe = null) => ({ w, r, k, done, rpe });
const W = (id, day, entries) => ({ id, name: '', note: '', start: new Date(2026, 9, day, 18).getTime(), end: new Date(2026, 9, day, 19).getTime(), entries });

test('推定1RM（Epley）', () => {
  assert.equal(e1rm(100, 1), 100);
  assert.equal(Math.round(e1rm(100, 10) * 10) / 10, 133.3);
  assert.equal(e1rm(0, 5), 0);
  assert.equal(Math.round(weightForReps(e1rm(80, 8), 8) * 1000) / 1000, 80);
});

test('集計：ウォームアップと未完了は除外', () => {
  const en = { exId: BENCH, sets: [S(40, 10, 'w'), S(80, 8), S(80, 7), S(85, 5, 'n', false)] };
  const st = entryStats(en, exMap[BENCH]);
  assert.equal(st.sets, 2);
  assert.equal(st.volume, 80 * 15);
  assert.equal(st.topW, 80);
  assert.equal(st.bestSet.r, 8);
  const ws = workoutStats(W('a', 1, [en, { exId: PULL, sets: [S(null, 10)] }]), exMap);
  assert.equal(ws.sets, 3);
  assert.deepEqual(ws.parts, { 胸: 2, 背中: 1 });
  assert.equal(ws.duration, 3600000);
});

test('前回の記録と自己ベスト', () => {
  const hist = [
    W('a', 1, [{ exId: BENCH, sets: [S(80, 8), S(80, 8)] }]),
    W('b', 5, [{ exId: BENCH, sets: [S(85, 5)] }]),
    W('c', 3, [{ exId: PULL, sets: [S(null, 8)] }]),
  ];
  assert.equal(lastEntryFor(hist, BENCH).workout.id, 'b');
  assert.equal(lastEntryFor(hist, BENCH, hist[1].start).workout.id, 'a');
  const rec = records(hist, BENCH, exMap[BENCH]);
  assert.equal(rec.weight, 85);
  assert.equal(rec.count, 2);
  assert.equal(rec.repMax[8].w, 80);
  assert.deepEqual(setPRs(rec, S(80, 10), exMap[BENCH]), ['e1rm']);
  assert.deepEqual(setPRs(rec, S(87.5, 1), exMap[BENCH]), ['weight']);
  assert.deepEqual(setPRs(rec, S(60, 5), exMap[BENCH]), []);
  const now = W('d', 8, [{ exId: BENCH, sets: [S(90, 4)] }, { exId: PULL, sets: [S(null, 10)] }]);
  const prs = detectPRs([...hist, now], now, exMap);
  assert.deepEqual(prs.map((p) => p.type).sort(), ['e1rm', 'reps', 'weight']);
  // 初回は自己ベスト扱いしない
  assert.deepEqual(detectPRs([hist[0]], hist[0], exMap), []);
});

test('次回の提案：ダブルプログレッション', () => {
  const up = suggestNext([S(60, 12), S(60, 12), S(60, 12)], { min: 8, max: 12, inc: 2.5 });
  assert.ok(up.up);
  assert.deepEqual(up.sets[0], { w: 62.5, r: 8 });
  const keep = suggestNext([S(60, 12), S(60, 10)], { min: 8, max: 12 });
  assert.deepEqual(keep.sets, [{ w: 60, r: 12 }, { w: 60, r: 11 }]);
  const rpe = suggestNext([S(100, 5, 'n', true, 7), S(100, 5, 'n', true, 6)], { inc: 5 });
  assert.equal(rpe.sets[0].w, 105);
  assert.equal(suggestNext([S(100, 5, 'n', true, 9)], {}).reason, '前回と同じ');
  assert.equal(suggestNext([S(20, 10, 'w')], {}), null);
  const bw = suggestNext([S(null, 10)], { max: 10, type: 'reps' });
  assert.equal(bw.sets[0].r, 11);
});

test('プレート計算とウォームアップ', () => {
  const p = platesFor(102.5, 20, [25, 20, 15, 10, 5, 2.5, 1.25]);
  assert.deepEqual(p.side, [25, 15, 1.25]);
  assert.equal(p.achieved, 102.5);
  assert.equal(p.rest, 0);
  const q = platesFor(101, 20, [20, 10, 5]);
  assert.equal(q.achieved, 100);
  assert.equal(q.rest, 1);
  assert.deepEqual(platesFor(15, 20, [20]).side, []);
  assert.deepEqual(warmupSets(100, 20, 2.5), [{ w: 20, r: 10 }, { w: 40, r: 5 }, { w: 60, r: 3 }, { w: 80, r: 2 }]);
  assert.deepEqual(warmupSets(30, 20, 2.5), [{ w: 20, r: 10 }, { w: 22.5, r: 2 }]);
  assert.deepEqual(warmupSets(20, 20), []);
});

test('週と継続', () => {
  const thu = new Date(2026, 9, 15, 12).getTime(); // 2026/10/15 木
  assert.equal(new Date(weekStartOf(thu, 1)).getDate(), 12);
  assert.equal(new Date(weekStartOf(thu, 0)).getDate(), 11);
  const hist = [W('a', 1, []), W('b', 6, []), W('c', 8, [])];
  assert.equal(streakWeeks(hist, 1, thu), 2); // 今週なし・先週(5-11)あり・先々週(9/28-10/4)あり
  assert.equal(streakWeeks(hist, 2, thu), 1); // 先週は2回
  assert.equal(streakWeeks(hist, 3, thu), 0);
  const ws = weeklySeries(hist, exMap, 3, thu);
  assert.deepEqual(ws.map((w) => w.count), [1, 2, 0]);
  const ps = partSets([W('a', 6, [{ exId: BENCH, sets: [S(80, 5)] }])], exMap, 0, Infinity);
  assert.equal(ps['胸'], 1);
  assert.equal(ps['脚'], 0);
});

test('入力と表示', () => {
  assert.equal(parseNum('６２．５'), 62.5);
  assert.equal(parseNum('62,5'), 62.5);
  assert.equal(parseNum(''), null);
  assert.equal(parseNum('abc'), null);
  assert.equal(fmtDuration(3725000), '1:02:05');
  assert.equal(fmtDuration(65000), '1:05');
  assert.equal(fmtDuration(3725000, false), '1時間2分');
});

test('書き出し・テンプレート・新規作成', () => {
  const w = W('a', 1, [{ id: 'e', exId: BENCH, note: '肩に注意', sets: [S(40, 10, 'w'), S(80, 8, 'n', true, 8), S(70, 3, 'n', false)] }]);
  const csv = toCSV([w], exMap).split('\r\n');
  assert.equal(csv.length, 3);
  assert.match(csv[2], /ベンチプレス,胸,2,通常セット,80,8,8,101.3,肩に注意/);
  const txt = workoutToText(w, exMap);
  assert.match(txt, /■ ベンチプレス/);
  assert.match(txt, /1\. \[W\] 40kg×10/);
  assert.match(txt, /2\. 80kg×8 @8/);
  const t = workoutToTemplate(w, '胸の日');
  assert.equal(t.entries[0].sets.length, 2);
  const nw = newWorkout(t);
  assert.equal(nw.entries[0].sets[0].k, 'w');
  assert.equal(nw.entries[0].sets[1].w, null);
  assert.equal(nw.entries[0].sets[1].done, false);
});

test('データの補完と単位変換', () => {
  const st = normalizeState({ settings: { rest: 120 }, workouts: [{ start: 1, entries: [{ exId: 'x1', sets: [{ w: '60', r: 5, done: 1 }] }] }] });
  assert.equal(st.settings.rest, 120);
  assert.equal(st.settings.unit, 'kg');
  assert.ok(st.exercises.length > 10);
  assert.equal(st.workouts[0].entries[0].sets[0].w, 60);
  assert.equal(st.workouts[0].entries[0].sets[0].k, 'n');
  const lb = convertUnits(st, 'lb');
  assert.equal(lb.settings.unit, 'lb');
  assert.equal(lb.workouts[0].entries[0].sets[0].w, 132.3);
  assert.equal(lb.settings.bar, 45);
});

test('移動平均', () => {
  const d = 86400000;
  const m = movingAvg([{ t: 0, v: 70 }, { t: d, v: 72 }, { t: 10 * d, v: 71 }], 7);
  assert.deepEqual(m.map((x) => x.v), [70, 71, 71]);
});
