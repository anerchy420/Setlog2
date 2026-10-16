// 計算ロジック（DOMに依存しない。ブラウザと通知スクリプト(Node)の両方から使う）

export const REACTIONS = ['😆', '🤣', '😍', '🥺', '😮', '🔥', '👏', '💯', '😴', '🤤', '👀', '🫶'];
export const LOG_EMOJIS = ['🌙', '☀️', '🍙', '🐶', '🐱', '🎧', '📚', '⚽', '🎮', '🍜', '🌸', '🫧', '🦖', '🧸', '🍓', '🚀'];
export const COLORS = ['#ff6b9a', '#ff9f43', '#f7c948', '#5bd17a', '#3ccfcf', '#4d9dff', '#8a6cff', '#c86bfa', '#ff6b6b', '#8d99ae'];
export const AVATAR_EMOJIS = ['😀', '😎', '🥳', '😴', '🤓', '🐶', '🐱', '🐻', '🐸', '🐧', '🦊', '🐼', '🐰', '🦄', '🍑', '⭐'];
export const MAX_MEMBERS = 20;
export const CLIP_SECONDS = 2;

export const DEFAULT_NOTIFY = {
  hourly: true, // 毎時「撮影の時間です」
  start: 8, // 通知する時間帯（開始）
  end: 23, // 通知する時間帯（終了・この時の回も含む）
  remind: true, // :45 にまだ撮っていなければもう一度
  friends: false, // 友だちが投稿したとき
  chat: true, // チャット・返信
  poke: true, // つつかれたとき
  reaction: true, // 自分の動画にリアクションが付いたとき
};

export const pad2 = (n) => String(n).padStart(2, '0');

export function dateKey(ts = Date.now()) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}
export function parseDateKey(k) {
  const [y, m, d] = k.split('-').map(Number);
  return new Date(y, m - 1, d).getTime();
}
export function addDaysKey(k, n) {
  const d = new Date(parseDateKey(k));
  d.setDate(d.getDate() + n);
  return dateKey(d.getTime());
}

// 今の撮影枠（1時間ごと）
export function slotOf(ts = Date.now()) {
  const d = new Date(ts);
  return { date: dateKey(ts), hour: d.getHours(), slot: pad2(d.getHours()), minute: d.getMinutes() };
}
export const clipIdOf = (date, slot, uid) => `${date}_${slot}_${uid}`;
export const slotLabel = (slot) => `${+slot}:00`;

// タイムゾーン指定で日時を分解（通知スクリプト用）
export function localParts(ts, tz) {
  const f = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  const p = Object.fromEntries(f.formatToParts(new Date(ts)).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, hour: +p.hour, slot: pad2(+p.hour), minute: +p.minute };
}

// 通知する時間帯か（start > end は日をまたぐ。例 22〜2）
export function isActiveHour(hour, start = 8, end = 23) {
  if (start <= end) return hour >= start && hour <= end;
  return hour >= start || hour <= end;
}

// 毎時通知を送るべきか（スクリプトは5分おき・遅れることもあるので、毎時0〜29分の間に1回）
export function hourlyDue(notify, lastKey, parts) {
  const n = { ...DEFAULT_NOTIFY, ...(notify || {}) };
  const key = `${parts.date}_${parts.slot}`;
  return n.hourly && isActiveHour(parts.hour, n.start, n.end) && parts.minute < 30 && lastKey !== key;
}
// まだ撮っていない人へのリマインド（:45〜:59）
export function remindDue(notify, lastKey, parts, posted) {
  const n = { ...DEFAULT_NOTIFY, ...(notify || {}) };
  const key = `${parts.date}_${parts.slot}`;
  return n.hourly && n.remind && !posted && isActiveHour(parts.hour, n.start, n.end) && parts.minute >= 45 && lastKey !== key;
}

// 招待コード（紛らわしい O/0/I/1 を除く）
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export function genCode(len = 6, rand = Math.random) {
  let s = '';
  for (let i = 0; i < len; i++) s += CODE_CHARS[Math.floor(rand() * CODE_CHARS.length)];
  return s;
}
export function normCode(s) {
  // 招待リンク全体を貼られても末尾のコードを拾う
  const m = String(s || '').match(/[?&]join=([A-Za-z0-9]+)/);
  return (m ? m[1] : String(s || '')).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
}

export function hashStr(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
// リアクションのスタンプを貼る位置（同じ人・同じ動画なら毎回同じ場所）
export function stickerPos(seed) {
  const h = hashStr(seed);
  return { x: 6 + (h % 56), y: 22 + ((h >>> 8) % 52), rot: ((h >>> 16) % 40) - 20 }; // 右端は♡・返信ボタンなので避ける
}

// その日の枠（投稿がある時間＋今日なら今の時間）を古い順に
export function slotsOfDay(clips, date, now = Date.now()) {
  const set = new Set(clips.filter((c) => c.date === date).map((c) => c.slot));
  const cur = slotOf(now);
  if (cur.date === date) set.add(cur.slot);
  return [...set].sort();
}
export function groupBySlot(clips) {
  const out = {};
  for (const c of clips) (out[c.slot] ||= []).push(c);
  return out;
}

// 日ごとの投稿数（カレンダー用） { 'YYYY-MM-DD': { total, mine } }
export function dayCounts(clips, uid) {
  const out = {};
  for (const c of clips) {
    const d = (out[c.date] ||= { total: 0, mine: 0 });
    d.total++;
    if (c.uid === uid) d.mine++;
  }
  return out;
}

// 連続して撮影した日数（今日まだでも昨日まで続いていれば継続）
export function streakDays(dates, today = dateKey()) {
  const set = new Set(dates);
  let k = set.has(today) ? today : addDaysKey(today, -1);
  let n = 0;
  while (set.has(k)) { n++; k = addDaysKey(k, -1); }
  return n;
}

// リアクションを絵文字ごとに集計 [{emoji, uids:[]}]
export function reactionSummary(reactions = {}) {
  const m = new Map();
  for (const [uid, e] of Object.entries(reactions || {})) {
    if (!e) continue;
    if (!m.has(e)) m.set(e, []);
    m.get(e).push(uid);
  }
  return [...m.entries()].map(([emoji, uids]) => ({ emoji, uids })).sort((a, b) => b.uids.length - a.uids.length);
}

// ---------- Vlog ----------
// 並べ方:
//  timeline … 時刻順に1本ずつ全画面
//  grid     … 同じ時刻の全員を分割画面で同時に
//  me       … 自分の動画だけ（全ログから）
export function vlogSegments(clips, { layout = 'timeline', uid = null, order = [], title = true } = {}) {
  const rank = (u) => { const i = order.indexOf(u); return i < 0 ? 999 : i; };
  let list = [...clips];
  if (layout === 'me') list = list.filter((c) => c.uid === uid);
  list.sort((a, b) => (a.date + a.slot).localeCompare(b.date + b.slot) || rank(a.uid) - rank(b.uid) || (a.createdAt || 0) - (b.createdAt || 0));
  const segs = [];
  if (title && list.length) segs.push({ type: 'title', dur: 1.6 });
  if (layout === 'grid') {
    const by = groupBySlot(list);
    for (const s of Object.keys(by).sort()) segs.push({ type: 'grid', slot: s, clips: by[s], dur: 2 });
  } else {
    for (const c of list) segs.push({ type: 'clip', slot: c.slot, clips: [c], dur: c.dur || 2 });
  }
  if (title && list.length) segs.push({ type: 'end', dur: 1.6 });
  return segs;
}
export const vlogDuration = (segs, speed = 1) => segs.reduce((a, s) => a + s.dur / (s.type === 'title' || s.type === 'end' ? 1 : speed), 0);

// n個を W×H の画面に分割するときの列数・行数（各マスが16:9に近く、空きが少ない形）
export function gridDims(n, W, H, aspect = 16 / 9) {
  let best = { cols: 1, rows: n, score: Infinity };
  for (let cols = 1; cols <= n; cols++) {
    const rows = Math.ceil(n / cols);
    const cell = W / cols / (H / rows);
    const score = Math.abs(Math.log(cell / aspect)) + (cols * rows - n) * 0.15;
    if (score < best.score) best = { cols, rows, score };
  }
  return { cols: best.cols, rows: best.rows };
}

// ---------- 表示 ----------
const WD = '日月火水木金土';
export function fmtDateKey(k, withYear = false) {
  const d = new Date(parseDateKey(k));
  return `${withYear ? d.getFullYear() + '年' : ''}${d.getMonth() + 1}月${d.getDate()}日(${WD[d.getDay()]})`;
}
export function fmtClock(ts) {
  const d = new Date(ts);
  return `${d.getHours()}:${pad2(d.getMinutes())}`;
}
export function fmtAgo(ts, now = Date.now()) {
  const s = Math.floor((now - ts) / 1000);
  if (s < 60) return 'たった今';
  if (s < 3600) return `${Math.floor(s / 60)}分前`;
  if (dateKey(ts) === dateKey(now)) return fmtClock(ts);
  if (dateKey(ts) === addDaysKey(dateKey(now), -1)) return '昨日 ' + fmtClock(ts);
  const d = new Date(ts);
  return `${d.getMonth() + 1}/${d.getDate()} ${fmtClock(ts)}`;
}
// 次の枠まで（"あと12分"）
export function untilNextSlot(now = Date.now()) {
  const d = new Date(now);
  return 60 - d.getMinutes();
}

export function cleanName(s, max = 20) {
  return String(s || '').replace(/\s+/g, ' ').trim().slice(0, max);
}
