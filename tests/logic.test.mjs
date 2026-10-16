import test from 'node:test';
import assert from 'node:assert/strict';
import {
  slotOf, clipIdOf, localParts, isActiveHour, hourlyDue, remindDue, genCode, normCode, stickerPos,
  slotsOfDay, groupBySlot, dayCounts, streakDays, reactionSummary, vlogSegments, vlogDuration, gridDims,
  addDaysKey, fmtAgo, cleanName, dateKey,
} from '../js/logic.js';

test('撮影枠とID', () => {
  const t = new Date(2026, 9, 16, 20, 7).getTime();
  assert.deepEqual(slotOf(t), { date: '2026-10-16', hour: 20, slot: '20', minute: 7 });
  assert.equal(slotOf(new Date(2026, 0, 2, 9, 0).getTime()).slot, '09');
  assert.equal(clipIdOf('2026-10-16', '09', 'abc'), '2026-10-16_09_abc');
});

test('タイムゾーン指定の分解（通知サーバー用）', () => {
  const t = Date.UTC(2026, 9, 16, 11, 5); // 日本時間 20:05
  assert.deepEqual(localParts(t, 'Asia/Tokyo'), { date: '2026-10-16', hour: 20, slot: '20', minute: 5 });
  assert.equal(localParts(Date.UTC(2026, 9, 16, 15, 30), 'Asia/Tokyo').date, '2026-10-17');
});

test('通知する時間帯（日またぎ対応）', () => {
  assert.ok(isActiveHour(8, 8, 23));
  assert.ok(isActiveHour(23, 8, 23));
  assert.ok(!isActiveHour(7, 8, 23));
  assert.ok(isActiveHour(1, 22, 2));
  assert.ok(!isActiveHour(12, 22, 2));
});

test('毎時通知とリマインドの判定', () => {
  const p = { date: '2026-10-16', hour: 20, slot: '20', minute: 3 };
  assert.ok(hourlyDue({}, null, p));
  assert.ok(!hourlyDue({}, '2026-10-16_20', p), '同じ時間に2回送らない');
  assert.ok(!hourlyDue({ hourly: false }, null, p));
  assert.ok(!hourlyDue({ start: 21, end: 23 }, null, p));
  assert.ok(!hourlyDue({}, null, { ...p, minute: 40 }), '30分を過ぎたら送らない');
  const q = { ...p, minute: 47 };
  assert.ok(remindDue({}, null, q, false));
  assert.ok(!remindDue({}, null, q, true), '撮影済みなら送らない');
  assert.ok(!remindDue({ remind: false }, null, q, false));
  assert.ok(!remindDue({}, null, p, false), '45分より前は送らない');
});

test('招待コード', () => {
  let i = 0;
  const seq = [0, 0.999, 0.5, 0.1, 0.2, 0.3];
  const c = genCode(6, () => seq[i++]);
  assert.equal(c.length, 6);
  assert.match(genCode(), /^[A-HJ-NP-Z2-9]{6}$/);
  assert.equal(normCode(' ab c-12 3 '), 'ABC123');
  assert.equal(normCode('https://x.github.io/setlog2/?join=xy7k2p#home'), 'XY7K2P');
});

test('スタンプの位置は同じ入力なら同じ', () => {
  assert.deepEqual(stickerPos('a1'), stickerPos('a1'));
  const p = stickerPos('zzz');
  assert.ok(p.x >= 8 && p.x < 78 && p.y >= 22 && p.y < 74 && p.rot >= -20 && p.rot < 20);
});

const C = (uid, date, slot, extra = {}) => ({ id: clipIdOf(date, slot, uid), uid, date, slot, createdAt: 0, ...extra });

test('その日の枠・集計', () => {
  const now = new Date(2026, 9, 16, 20, 10).getTime();
  const cs = [C('a', '2026-10-16', '09'), C('b', '2026-10-16', '09'), C('a', '2026-10-16', '15'), C('a', '2026-10-15', '22')];
  assert.deepEqual(slotsOfDay(cs, '2026-10-16', now), ['09', '15', '20']);
  assert.deepEqual(slotsOfDay(cs, '2026-10-15', now), ['22']);
  assert.equal(groupBySlot(cs)['09'].length, 2);
  assert.deepEqual(dayCounts(cs, 'a')['2026-10-16'], { total: 3, mine: 2 });
});

test('連続日数', () => {
  assert.equal(streakDays(['2026-10-14', '2026-10-15', '2026-10-16'], '2026-10-16'), 3);
  assert.equal(streakDays(['2026-10-14', '2026-10-15'], '2026-10-16'), 2, '今日まだでも昨日までは継続');
  assert.equal(streakDays(['2026-10-13'], '2026-10-16'), 0);
  assert.equal(addDaysKey('2026-03-01', -1), '2026-02-28');
});

test('リアクションの集計', () => {
  const r = reactionSummary({ a: '😆', b: '🔥', c: '😆', d: null });
  assert.deepEqual(r, [{ emoji: '😆', uids: ['a', 'c'] }, { emoji: '🔥', uids: ['b'] }]);
});

test('Vlogの構成', () => {
  const cs = [C('b', '2026-10-16', '09'), C('a', '2026-10-16', '09'), C('a', '2026-10-16', '15')];
  const tl = vlogSegments(cs, { layout: 'timeline', order: ['a', 'b'] });
  assert.deepEqual(tl.map((s) => s.type), ['title', 'clip', 'clip', 'clip', 'end']);
  assert.equal(tl[1].clips[0].uid, 'a', 'メンバー順');
  const gr = vlogSegments(cs, { layout: 'grid', order: ['a', 'b'] });
  assert.deepEqual(gr.map((s) => s.type), ['title', 'grid', 'grid', 'end']);
  assert.equal(gr[1].clips.length, 2);
  const me = vlogSegments(cs, { layout: 'me', uid: 'b' });
  assert.equal(me.filter((s) => s.type === 'clip').length, 1);
  assert.deepEqual(vlogSegments([], {}), []);
  assert.ok(Math.abs(vlogDuration(tl) - 9.2) < 1e-9);
  assert.ok(Math.abs(vlogDuration(tl, 2) - 6.2) < 1e-9);
});

test('分割画面の形', () => {
  assert.deepEqual(gridDims(1, 1280, 720), { cols: 1, rows: 1 });
  assert.deepEqual(gridDims(4, 1280, 720), { cols: 2, rows: 2 });
  assert.deepEqual(gridDims(2, 720, 1130), { cols: 1, rows: 2 });
  const g = gridDims(12, 720, 1130);
  assert.ok(g.cols * g.rows >= 12);
});

test('表示', () => {
  const now = new Date(2026, 9, 16, 20, 0).getTime();
  assert.equal(fmtAgo(now - 20e3, now), 'たった今');
  assert.equal(fmtAgo(now - 5 * 60e3, now), '5分前');
  assert.equal(fmtAgo(new Date(2026, 9, 15, 9, 5).getTime(), now), '昨日 9:05');
  assert.equal(cleanName('  えん   どう  '), 'えん どう');
  assert.equal(dateKey(new Date(2026, 0, 5).getTime()), '2026-01-05');
});
