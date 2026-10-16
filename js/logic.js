// 計算ロジック（DOMに依存しない純粋関数。tests/logic.test.mjs でテスト）

export const PARTS = ['胸', '背中', '脚', '肩', '腕', '腹', '全身・その他'];
export const TYPES = { weight: '重量×回数', reps: '自重（回数）', time: '時間' };
export const KINDS = { n: '通常', w: 'W', d: 'D', f: 'F' }; // 通常 / ウォームアップ / ドロップ / 限界
export const KIND_NAMES = { n: '通常セット', w: 'ウォームアップ', d: 'ドロップセット', f: '限界まで' };

export const DEFAULT_SETTINGS = {
  unit: 'kg',
  rest: 90, // 既定の休憩（秒）
  autoRest: true, // セット完了で休憩タイマーを自動開始
  sound: true,
  vibrate: true,
  keepAwake: true, // 記録中は画面を消さない
  showRpe: true,
  notify: false,
  bar: 20,
  plates: [25, 20, 15, 10, 5, 2.5, 1.25],
  inc: 2.5, // 重量を上げるときの刻み
  weekStart: 1, // 1=月曜
  weeklyGoal: 3, // 週のトレーニング回数目標
  theme: 'auto',
};

// [名前, 部位, 種類, 休憩秒]
const LIB = [
  ['ベンチプレス', '胸', 'weight', 180], ['インクラインベンチプレス', '胸', 'weight', 150],
  ['ダンベルプレス', '胸', 'weight', 120], ['インクラインダンベルプレス', '胸', 'weight', 120],
  ['ダンベルフライ', '胸', 'weight', 90], ['チェストプレス', '胸', 'weight', 90],
  ['ケーブルクロスオーバー', '胸', 'weight', 60], ['ディップス', '胸', 'reps', 120], ['腕立て伏せ', '胸', 'reps', 60],
  ['デッドリフト', '背中', 'weight', 180], ['懸垂', '背中', 'reps', 120], ['ラットプルダウン', '背中', 'weight', 90],
  ['ベントオーバーロウ', '背中', 'weight', 120], ['ワンハンドダンベルロウ', '背中', 'weight', 90],
  ['シーテッドロウ', '背中', 'weight', 90], ['Tバーロウ', '背中', 'weight', 120], ['バックエクステンション', '背中', 'reps', 60],
  ['スクワット', '脚', 'weight', 180], ['フロントスクワット', '脚', 'weight', 180], ['レッグプレス', '脚', 'weight', 120],
  ['ルーマニアンデッドリフト', '脚', 'weight', 150], ['ブルガリアンスクワット', '脚', 'weight', 90],
  ['レッグエクステンション', '脚', 'weight', 60], ['レッグカール', '脚', 'weight', 60],
  ['ヒップスラスト', '脚', 'weight', 120], ['カーフレイズ', '脚', 'weight', 60],
  ['ショルダープレス', '肩', 'weight', 150], ['ダンベルショルダープレス', '肩', 'weight', 120],
  ['サイドレイズ', '肩', 'weight', 60], ['リアレイズ', '肩', 'weight', 60], ['フェイスプル', '肩', 'weight', 60],
  ['アップライトロウ', '肩', 'weight', 90],
  ['バーベルカール', '腕', 'weight', 90], ['ダンベルカール', '腕', 'weight', 60], ['ハンマーカール', '腕', 'weight', 60],
  ['トライセプスプッシュダウン', '腕', 'weight', 60], ['フレンチプレス', '腕', 'weight', 90],
  ['ナローベンチプレス', '腕', 'weight', 120],
  ['クランチ', '腹', 'reps', 60], ['アブローラー', '腹', 'reps', 60], ['ハンギングレッグレイズ', '腹', 'reps', 60],
  ['プランク', '腹', 'time', 60],
];
export const DEFAULT_EXERCISES = LIB.map(([name, part, type, rest], i) => ({ id: 'x' + (i + 1), name, part, type, rest, note: '' }));

export function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

export function emptyState() {
  return {
    version: 1,
    settings: { ...DEFAULT_SETTINGS },
    exercises: DEFAULT_EXERCISES.map((e) => ({ ...e })),
    workouts: [],
    templates: [],
    body: [],
    active: null,
  };
}

// 読み込んだデータ（保存済み・インポート）の欠けを埋める
export function normalizeState(obj) {
  const base = emptyState();
  if (!obj || typeof obj !== 'object') return base;
  const arr = (v) => (Array.isArray(v) ? v : []);
  return {
    version: 1,
    settings: { ...base.settings, ...(obj.settings || {}) },
    exercises: arr(obj.exercises).length ? arr(obj.exercises) : base.exercises,
    workouts: arr(obj.workouts).map(normWorkout),
    templates: arr(obj.templates),
    body: arr(obj.body),
    active: obj.active ? normWorkout(obj.active) : null,
  };
}
function normWorkout(w) {
  return {
    id: w.id || uid(), name: w.name || '', note: w.note || '',
    start: +w.start || Date.now(), end: w.end ? +w.end : null,
    ...(w.tplId ? { tplId: w.tplId } : {}),
    entries: (w.entries || []).map((e) => ({
      id: e.id || uid(), exId: e.exId, note: e.note || '', ss: e.ss || null,
      min: e.min ?? null, max: e.max ?? null,
      ...(e.rest ? { rest: e.rest } : {}),
      sets: (e.sets || []).map((s) => ({ w: num(s.w), r: num(s.r), rpe: num(s.rpe), k: s.k || 'n', done: !!s.done })),
    })),
  };
}
function num(v) {
  return v === null || v === undefined || v === '' || !Number.isFinite(+v) ? null : +v;
}

// 全角数字・カンマ小数にも対応
export function parseNum(s) {
  if (s === null || s === undefined) return null;
  const t = String(s).trim().replace(/[０-９．]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0)).replace(',', '.');
  if (t === '') return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

export function round(x, step = 0.01) {
  const r = Math.round(x / step) * step;
  return Math.round(r * 1000) / 1000;
}
export function floorTo(x, step) {
  return Math.round(Math.floor(x / step + 1e-9) * step * 1000) / 1000;
}

export function fmtW(w) {
  if (w === null || w === undefined) return '';
  return String(Math.round(w * 100) / 100);
}
export function fmtNum(n) {
  return Math.round(n).toLocaleString('ja-JP');
}

// 推定1RM（Epley式）。1回ならその重量
export function e1rm(w, r) {
  if (!(w > 0) || !(r > 0)) return 0;
  if (r === 1) return w;
  return w * (1 + r / 30);
}
// 1RMから、指定回数でできる重量
export function weightForReps(oneRm, r) {
  if (!(oneRm > 0) || !(r > 0)) return 0;
  return r === 1 ? oneRm : oneRm / (1 + r / 30);
}

// 記録として数えるセット（完了済み・ウォームアップ以外・回数あり）
export function isWork(s) {
  return !!s.done && s.k !== 'w' && s.r > 0;
}

export function entryStats(entry, ex) {
  const type = ex?.type || 'weight';
  const work = entry.sets.filter(isWork);
  let volume = 0, reps = 0, topW = 0, best = 0, bestSet = null, maxR = 0;
  for (const s of work) {
    reps += s.r;
    if (s.r > maxR) maxR = s.r;
    if (type !== 'time') volume += (s.w || 0) * s.r;
    if ((s.w || 0) > topW) topW = s.w || 0;
    if (type === 'weight') {
      const e = e1rm(s.w, s.r);
      if (e > best) { best = e; bestSet = s; }
    } else if (!bestSet || s.r > bestSet.r) bestSet = s;
  }
  return { sets: work.length, reps, volume, topW, e1rm: best, bestSet, maxR };
}

export function workoutStats(workout, exMap) {
  let sets = 0, volume = 0, reps = 0;
  const parts = {};
  for (const en of workout.entries) {
    const ex = exMap[en.exId];
    const st = entryStats(en, ex);
    sets += st.sets; volume += st.volume; reps += st.reps;
    if (st.sets) {
      const p = ex?.part || '全身・その他';
      parts[p] = (parts[p] || 0) + st.sets;
    }
  }
  const duration = workout.end ? workout.end - workout.start : 0;
  return { sets, volume, reps, duration, parts };
}

export function byStartDesc(ws) {
  return [...ws].sort((a, b) => b.start - a.start);
}

// その種目の直近の記録（beforeより前で、完了セットがあるもの）
export function lastEntryFor(workouts, exId, before = Infinity, excludeId = null) {
  let best = null;
  for (const w of workouts) {
    if (w.id === excludeId || w.start >= before) continue;
    if (best && w.start <= best.workout.start) continue;
    const en = [...w.entries].reverse().find((e) => e.exId === exId && e.sets.some((s) => s.done));
    if (en) best = { workout: w, entry: en };
  }
  return best;
}

// 種目ごとの日別推移（古い順）
export function exerciseHistory(workouts, exId, ex) {
  const out = [];
  for (const w of workouts) {
    const ens = w.entries.filter((e) => e.exId === exId);
    if (!ens.length) continue;
    const merged = { sets: ens.flatMap((e) => e.sets) };
    const st = entryStats(merged, ex);
    if (!st.sets) continue;
    out.push({ id: w.id, start: w.start, ...st, list: merged.sets.filter(isWork) });
  }
  return out.sort((a, b) => a.start - b.start);
}

// 自己ベスト集計（beforeより前の記録だけで計算することもできる）
export function records(workouts, exId, ex, { before = Infinity, excludeId = null } = {}) {
  const rec = { e1rm: 0, weight: 0, volume: 0, reps: 0, repMax: {}, count: 0 };
  const ws = workouts.filter((w) => w.id !== excludeId && w.start < before);
  for (const h of exerciseHistory(ws, exId, ex)) {
    rec.count++;
    rec.e1rm = Math.max(rec.e1rm, h.e1rm);
    rec.volume = Math.max(rec.volume, h.volume);
    rec.weight = Math.max(rec.weight, h.topW);
    rec.reps = Math.max(rec.reps, h.maxR);
    for (const s of h.list) {
      const r = s.r;
      if (r > 20) continue;
      const cur = rec.repMax[r];
      if (!cur || (s.w || 0) > cur.w) rec.repMax[r] = { w: s.w || 0, start: h.start };
    }
  }
  return rec;
}

// 1セットが自己ベスト更新か（記録中に判定）。prevは records() の結果
export function setPRs(prev, set, ex) {
  if (!isWork(set) || !prev || !prev.count) return [];
  const type = ex?.type || 'weight';
  const out = [];
  if (type === 'weight') {
    if (e1rm(set.w, set.r) > prev.e1rm + 1e-9) out.push('e1rm');
    if ((set.w || 0) > prev.weight + 1e-9) out.push('weight');
  } else if (set.r > prev.reps) out.push('reps');
  return out;
}

// ワークアウト全体の自己ベスト（終了画面・履歴で表示）
export function detectPRs(workouts, workout, exMap) {
  const out = [];
  const seen = new Set();
  for (const en of workout.entries) {
    if (seen.has(en.exId)) continue;
    seen.add(en.exId);
    const ex = exMap[en.exId];
    const prev = records(workouts, en.exId, ex, { before: workout.start, excludeId: workout.id });
    if (!prev.count) continue;
    const now = exerciseHistory([workout], en.exId, ex)[0];
    if (!now) continue;
    const type = ex?.type || 'weight';
    if (type === 'weight') {
      if (now.e1rm > prev.e1rm + 1e-9) out.push({ exId: en.exId, type: 'e1rm', value: now.e1rm, prev: prev.e1rm });
      if (now.topW > prev.weight + 1e-9) out.push({ exId: en.exId, type: 'weight', value: now.topW, prev: prev.weight });
    } else if (now.maxR > prev.reps) out.push({ exId: en.exId, type: 'reps', value: now.maxR, prev: prev.reps });
    if (type !== 'time' && now.volume > prev.volume + 1e-9 && prev.volume > 0) out.push({ exId: en.exId, type: 'volume', value: now.volume, prev: prev.volume });
  }
  return out;
}
export const PR_NAMES = { e1rm: '推定1RM', weight: '最高重量', volume: 'ボリューム', reps: '最多回数' };

// 次回の提案（ダブルプログレッション）
// 目標回数 min〜max があれば：全セットmax達成で重量アップ→minから。未達ならmaxまで回数を伸ばす
// なければ：前回RPEがすべて7以下なら重量アップ、それ以外は前回と同じ
export function suggestNext(lastSets, { inc = 2.5, min = null, max = null, type = 'weight' } = {}) {
  const work = (lastSets || []).filter(isWork).filter((s) => s.k === 'n' || s.k === 'f');
  if (!work.length) return null;
  const addW = type === 'weight' || (type === 'reps' && work.some((s) => s.w > 0));
  if (max) {
    if (work.every((s) => s.r >= max)) {
      if (!addW) return { sets: work.map(() => ({ w: null, r: max + 1 })), reason: `全セット${max}回達成 → 回数アップ`, up: true };
      return { sets: work.map((s) => ({ w: round((s.w || 0) + inc), r: min || max })), reason: `全セット${max}回達成 → +${fmtW(inc)}`, up: true };
    }
    return { sets: work.map((s) => ({ w: s.w, r: Math.min(s.r + 1, max) })), reason: `目標${min ? min + '〜' : ''}${max}回まで回数を伸ばす`, up: false };
  }
  const rpes = work.map((s) => s.rpe).filter((v) => v !== null && v !== undefined);
  if (addW && rpes.length === work.length && Math.max(...rpes) <= 7) {
    return { sets: work.map((s) => ({ w: round((s.w || 0) + inc), r: s.r })), reason: `余裕あり（RPE7以下）→ +${fmtW(inc)}`, up: true };
  }
  return { sets: work.map((s) => ({ w: s.w, r: s.r })), reason: '前回と同じ', up: false };
}

// プレート計算（片側）。重さは0.01単位の整数で計算して誤差を出さない
export function platesFor(target, bar, plates) {
  const per = Math.round(((target - bar) / 2) * 100);
  if (!(per > 0)) return { side: [], achieved: bar, rest: Math.max(0, round(target - bar)) };
  let left = per;
  const side = [];
  for (const p of [...plates].map((x) => Math.round(x * 100)).filter((x) => x > 0).sort((a, b) => b - a)) {
    while (left >= p) { side.push(p / 100); left -= p; }
  }
  return { side, achieved: round(bar + ((per - left) / 100) * 2), rest: round((left / 100) * 2) };
}

// ウォームアップ（空バー×10 → 40%×5 → 60%×3 → 80%×2）。刻みで切り捨て
export function warmupSets(target, bar = 20, inc = 2.5) {
  if (!(target > bar)) return [];
  const out = [{ w: bar, r: 10 }];
  for (const [p, r] of [[0.4, 5], [0.6, 3], [0.8, 2]]) {
    const w = floorTo(target * p, inc);
    if (w > out[out.length - 1].w && w < target) out.push({ w, r });
  }
  return out;
}

// ---------- 日付 ----------
export function dateKey(ts) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
export function dayStart(ts) {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}
export function weekStartOf(ts, startDay = 1) {
  const d = new Date(dayStart(ts));
  const diff = (d.getDay() - startDay + 7) % 7;
  d.setDate(d.getDate() - diff);
  return d.getTime();
}
export function addDays(ts, n) {
  const d = new Date(ts);
  d.setDate(d.getDate() + n);
  return d.getTime();
}
const WD = ['日', '月', '火', '水', '木', '金', '土'];
export function fmtDate(ts, withYear = false) {
  const d = new Date(ts);
  return `${withYear ? d.getFullYear() + '/' : ''}${d.getMonth() + 1}/${d.getDate()}(${WD[d.getDay()]})`;
}
export function fmtTime(ts) {
  const d = new Date(ts);
  return `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
}
export function fmtDuration(ms, withSec = true) {
  const t = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = t % 60;
  if (!withSec) return h ? `${h}時間${m}分` : `${m}分`;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
}
export function fmtSec(sec) {
  return fmtDuration(sec * 1000);
}

// 週ごとの集計（古い順、weeks週分）
export function weeklySeries(workouts, exMap, weeks, now = Date.now(), startDay = 1) {
  const cur = weekStartOf(now, startDay);
  const out = [];
  for (let i = weeks - 1; i >= 0; i--) {
    const s = addDays(cur, -7 * i), e = addDays(s, 7);
    let count = 0, volume = 0, sets = 0;
    for (const w of workouts) {
      if (w.start < s || w.start >= e) continue;
      const st = workoutStats(w, exMap);
      count++; volume += st.volume; sets += st.sets;
    }
    out.push({ start: s, count, volume, sets });
  }
  return out;
}

// 期間内の部位別セット数
export function partSets(workouts, exMap, from, to) {
  const out = Object.fromEntries(PARTS.map((p) => [p, 0]));
  for (const w of workouts) {
    if (w.start < from || w.start >= to) continue;
    const st = workoutStats(w, exMap);
    for (const [p, n] of Object.entries(st.parts)) out[p] = (out[p] || 0) + n;
  }
  return out;
}

// 部位ごとの最終トレーニング日
export function lastTrainedByPart(workouts, exMap) {
  const out = {};
  for (const w of workouts) {
    for (const p of Object.keys(workoutStats(w, exMap).parts)) {
      if (!out[p] || w.start > out[p]) out[p] = w.start;
    }
  }
  return out;
}

// 連続して週の目標回数を達成した週数（今週は未達でも途切れ扱いにしない）
export function streakWeeks(workouts, goal = 1, now = Date.now(), startDay = 1) {
  const counts = {};
  for (const w of workouts) {
    const k = weekStartOf(w.start, startDay);
    counts[k] = (counts[k] || 0) + 1;
  }
  let wk = weekStartOf(now, startDay);
  let n = 0;
  if ((counts[wk] || 0) >= goal) n++;
  wk = addDays(wk, -7);
  while ((counts[wk] || 0) >= goal) { n++; wk = addDays(wk, -7); }
  return n;
}

export function dayCounts(workouts) {
  const m = {};
  for (const w of workouts) {
    const k = dateKey(w.start);
    m[k] = (m[k] || 0) + 1;
  }
  return m;
}

// ---------- 書き出し ----------
export function setText(s, type, unit) {
  if (type === 'time') return `${s.w ? fmtW(s.w) + unit + '×' : ''}${fmtSec(s.r || 0)}`;
  if (type === 'reps') return `${s.w ? '+' + fmtW(s.w) + unit + '×' : ''}${s.r ?? '-'}回`;
  return `${fmtW(s.w ?? 0)}${unit}×${s.r ?? '-'}`;
}

export function workoutToText(workout, exMap, unit = 'kg') {
  const st = workoutStats(workout, exMap);
  const lines = [`${fmtDate(workout.start, true)} ${workout.name || 'トレーニング'}`];
  if (st.duration) lines.push(`時間 ${fmtDuration(st.duration, false)} / ${st.sets}セット / ${fmtNum(st.volume)}${unit}`);
  for (const en of workout.entries) {
    const ex = exMap[en.exId];
    const sets = en.sets.filter((s) => s.done);
    if (!sets.length) continue;
    lines.push('', `■ ${ex?.name || '（削除された種目）'}`);
    sets.forEach((s, i) => {
      const tag = s.k !== 'n' ? `[${KINDS[s.k]}] ` : '';
      lines.push(`${i + 1}. ${tag}${setText(s, ex?.type || 'weight', unit)}${s.rpe ? ' @' + s.rpe : ''}`);
    });
    if (en.note) lines.push(`  メモ: ${en.note}`);
  }
  if (workout.note) lines.push('', workout.note);
  return lines.join('\n');
}

function csvCell(v) {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
export function toCSV(workouts, exMap) {
  const rows = [['日付', '開始', 'ワークアウト', '種目', '部位', 'セット', '種別', '重量', '回数/秒', 'RPE', '推定1RM', 'メモ']];
  for (const w of [...workouts].sort((a, b) => a.start - b.start)) {
    for (const en of w.entries) {
      const ex = exMap[en.exId];
      let i = 0;
      for (const s of en.sets) {
        if (!s.done) continue;
        i++;
        const e = ex?.type === 'weight' || !ex ? e1rm(s.w, s.r) : 0;
        rows.push([dateKey(w.start), fmtTime(w.start), w.name, ex?.name || '', ex?.part || '', i, KIND_NAMES[s.k] || '', s.w ?? '', s.r ?? '', s.rpe ?? '', e ? round(e, 0.1) : '', en.note]);
      }
    }
  }
  return rows.map((r) => r.map(csvCell).join(',')).join('\r\n');
}

// ワークアウトをテンプレート化
export function workoutToTemplate(workout, name) {
  return {
    id: uid(),
    name: name || workout.name || 'メニュー',
    entries: workout.entries.map((en) => ({
      exId: en.exId, ss: en.ss || null, min: en.min ?? null, max: en.max ?? null,
      sets: (en.sets.some((s) => s.done) ? en.sets.filter((s) => s.done) : en.sets).map((s) => ({ k: s.k })),
    })),
  };
}

// テンプレートや過去のワークアウトから新しいワークアウトを作る（重量・回数は空にして「前回」を表示）
export function newWorkout({ name = '', entries = [] } = {}, now = Date.now()) {
  return {
    id: uid(), name, note: '', start: now, end: null,
    entries: entries.map((en) => ({
      id: uid(), exId: en.exId, note: '', ss: en.ss || null, min: en.min ?? null, max: en.max ?? null,
      sets: (en.sets?.length ? en.sets : [{ k: 'n' }, { k: 'n' }, { k: 'n' }]).map((s) => ({ w: null, r: null, rpe: null, k: s.k || 'n', done: false })),
    })),
  };
}

// 重量単位の変換（全データ）
export function convertUnits(state, to) {
  const from = state.settings.unit;
  if (from === to) return state;
  const f = from === 'kg' && to === 'lb' ? 2.20462 : 1 / 2.20462;
  const cw = (w) => (w === null || w === undefined ? w : round(w * f, 0.05));
  const cvW = (wk) => ({ ...wk, entries: wk.entries.map((e) => ({ ...e, sets: e.sets.map((s) => ({ ...s, w: cw(s.w) })) })) });
  return {
    ...state,
    settings: {
      ...state.settings, unit: to,
      bar: to === 'lb' ? 45 : 20,
      inc: to === 'lb' ? 5 : 2.5,
      plates: to === 'lb' ? [45, 35, 25, 10, 5, 2.5] : [25, 20, 15, 10, 5, 2.5, 1.25],
    },
    workouts: state.workouts.map(cvW),
    active: state.active ? cvW(state.active) : null,
    body: state.body.map((b) => ({ ...b, w: cw(b.w) })),
  };
}

// 体重の移動平均（7日）
export function movingAvg(points, days = 7) {
  const sorted = [...points].sort((a, b) => a.t - b.t);
  return sorted.map((p) => {
    const from = p.t - (days - 1) * 86400000;
    const win = sorted.filter((q) => q.t >= from && q.t <= p.t);
    return { t: p.t, v: win.reduce((a, q) => a + q.v, 0) / win.length };
  });
}
