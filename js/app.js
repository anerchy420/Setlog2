// 画面とイベント処理
import * as L from './logic.js';
import { load, save, loadTimer, saveTimer, requestPersist } from './store.js';

let S = load();
let EX = {};
reindex();
let timer = loadTimer(); // 休憩タイマー { end, total, label, alerted }

// 画面ごとの一時状態
const ui = {
  histMonth: L.dayStart(Date.now()),
  histDay: null,
  histEx: '',
  exQ: '',
  exPart: '',
  exMetric: 'e1rm',
  exMore: false,
  statWeeks: 12,
};

const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const unit = () => S.settings.unit;

function reindex() {
  EX = Object.fromEntries(S.exercises.map((e) => [e.id, e]));
}
let saveT = null;
function persist() {
  clearTimeout(saveT);
  saveT = setTimeout(flush, 250);
}
function flush() {
  clearTimeout(saveT);
  saveT = null;
  if (!save(S)) toast('保存できませんでした（空き容量を確認してください）');
}
function commit() {
  persist();
  render();
}
document.addEventListener('visibilitychange', () => { if (document.hidden && saveT) flush(); });
window.addEventListener('pagehide', () => { if (saveT) flush(); });

// ---------------- 共通UI ----------------
let toastT = null;
function toast(msg, kind = '') {
  const el = $('#toast');
  el.textContent = msg;
  el.className = 'toast ' + kind;
  clearTimeout(toastT);
  toastT = setTimeout(() => el.classList.add('hidden'), kind === 'pr' ? 3200 : 2200);
}

let sheetDone = null;
function openSheet(html, onClose = null) {
  if (sheetDone) { const f = sheetDone; sheetDone = null; f(); }
  const sh = $('#sheet');
  sh.innerHTML = '<div class="grab"></div>' + html;
  sh.classList.remove('hidden');
  $('#backdrop').classList.remove('hidden');
  document.body.classList.add('noscroll');
  sh.scrollTop = 0;
  sheetDone = onClose;
}
function closeSheet() {
  $('#sheet').classList.add('hidden');
  $('#backdrop').classList.add('hidden');
  document.body.classList.remove('noscroll');
  if (sheetDone) { const f = sheetDone; sheetDone = null; f(); }
}
$('#backdrop').addEventListener('click', closeSheet);
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('#sheet').classList.contains('hidden')) closeSheet(); });

function confirmSheet(msg, ok = 'OK', danger = false) {
  return new Promise((res) => {
    let v = false;
    openSheet(`<h2>${esc(msg)}</h2><div class="row" style="margin-top:16px">
      <button class="btn" data-a="sheet-close">キャンセル</button>
      <button class="btn ${danger ? 'danger' : 'primary'}" id="cf-ok">${esc(ok)}</button></div>`, () => res(v));
    $('#cf-ok').onclick = () => { v = true; closeSheet(); };
  });
}
function promptSheet(title, value = '', { multiline = false, placeholder = '' } = {}) {
  return new Promise((res) => {
    let v = null;
    openSheet(`<h2>${esc(title)}</h2>
      ${multiline ? `<textarea id="pr-in" rows="4" placeholder="${esc(placeholder)}">${esc(value)}</textarea>` : `<input id="pr-in" value="${esc(value)}" placeholder="${esc(placeholder)}">`}
      <div class="row" style="margin-top:12px"><button class="btn" data-a="sheet-close">キャンセル</button><button class="btn primary" id="pr-ok">OK</button></div>`, () => res(v));
    const inp = $('#pr-in');
    setTimeout(() => inp.focus(), 50);
    const ok = () => { v = inp.value; closeSheet(); };
    $('#pr-ok').onclick = ok;
    if (!multiline) inp.onkeydown = (e) => { if (e.key === 'Enter') ok(); };
  });
}

function download(name, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    toast('コピーしました');
  } catch {
    promptSheet('コピーしてください', text, { multiline: true });
  }
}

const ICON = {
  back: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M15 5l-7 7 7 7"/></svg>',
  more: '<svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/></svg>',
  gear: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>',
  plus: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
  check: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12l5 5 9-10"/></svg>',
  tool: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 7h8M8 12h2M14 12h2M8 16h2M14 16h2"/></svg>',
};

// ---------------- ルーティング ----------------
function route() {
  const [name, arg] = (location.hash.slice(1) || 'home').split('/');
  return { name, arg: arg ? decodeURIComponent(arg) : null };
}
function go(h) {
  if (location.hash.slice(1) === h) render();
  else location.hash = h;
}
window.addEventListener('hashchange', () => { closeSheet(); render(); window.scrollTo(0, 0); });

const VIEWS = {};
function render() {
  const r = route();
  const v = (VIEWS[r.name] || VIEWS.home)(r.arg);
  const left = v.back ? `<button class="icon-btn" data-a="back" data-to="${esc(v.back)}" aria-label="戻る">${ICON.back}</button>` : '';
  $('#top').innerHTML = `${left}<div class="title">${v.title}${v.sub ? `<div class="sub">${v.sub}</div>` : ''}</div>${v.actions || ''}`;
  $('#view').innerHTML = v.body;
  const navName = { w: 'history', edit: 'history', ex: 'exercises', tpl: 'home', settings: 'home' }[r.name] || r.name;
  document.querySelectorAll('#nav a').forEach((a) => a.classList.toggle('active', a.dataset.nav === navName));
  v.after?.();
  updateLive();
  wakeLock();
}

// ---------------- ホーム ----------------
VIEWS.home = () => {
  const now = Date.now();
  const st = S.settings;
  const ws = S.workouts;
  const wk = L.weekStartOf(now, st.weekStart);
  const thisWeek = ws.filter((w) => w.start >= wk);
  const weekVol = thisWeek.reduce((a, w) => a + L.workoutStats(w, EX).volume, 0);
  const streak = L.streakWeeks(ws, st.weeklyGoal, now, st.weekStart);
  const recent = L.byStartDesc(ws).slice(0, 3);
  const lastPart = L.lastTrainedByPart(ws, EX);
  const pct = Math.min(100, (thisWeek.length / st.weeklyGoal) * 100);
  const d = new Date();

  let start;
  if (S.active) {
    const a = S.active;
    const done = a.entries.reduce((n, e) => n + e.sets.filter((s) => s.done).length, 0);
    start = `<div class="card tap" data-a="go" data-to="workout" style="border-color:var(--accent)">
      <div class="between"><div><div class="badge acc">記録中</div><h2 style="margin-top:4px">${esc(a.name || 'トレーニング')}</h2>
      <div class="muted small">${a.entries.length}種目・${done}セット完了</div></div>
      <div style="font-size:24px;font-weight:800" class="num" data-tick="elapsed"></div></div></div>`;
  } else {
    start = `<button class="btn primary big block" data-a="start-empty">${ICON.plus} 空のワークアウトを開始</button>`;
  }

  const parts = L.PARTS.filter((p) => p !== '全身・その他').map((p) => {
    const t = lastPart[p];
    const days = t ? Math.floor((L.dayStart(now) - L.dayStart(t)) / 86400000) : null;
    const label = days === null ? '未実施' : days === 0 ? '今日' : `${days}日前`;
    return `<span class="chip" style="cursor:default">${p} <span class="${days !== null && days <= 1 ? 'muted' : ''}">${label}</span></span>`;
  }).join('');

  return {
    title: `${d.getMonth() + 1}月${d.getDate()}日`,
    sub: `${'日月火水木金土'[d.getDay()]}曜日`,
    actions: `<button class="icon-btn" data-a="tools" aria-label="ツール">${ICON.tool}</button><a class="icon-btn" href="#settings" aria-label="設定">${ICON.gear}</a>`,
    body: `
      <div style="margin:4px 0 14px">${start}</div>
      <div class="tiles c3">
        <div class="tile"><div class="k">今週の回数</div><div class="v">${thisWeek.length}<small>/ ${st.weeklyGoal}回</small></div><div class="meter"><i style="width:${pct}%"></i></div></div>
        <div class="tile"><div class="k">ボリューム</div><div class="v">${volShort(weekVol)}<small>${unit()}</small></div></div>
        <div class="tile"><div class="k">継続</div><div class="v">${streak}<small>週</small></div><div class="d">週${st.weeklyGoal}回以上</div></div>
      </div>
      <h3>部位ごとの前回</h3>
      <div class="chips">${parts}</div>
      <div class="between"><h3>マイメニュー</h3><button class="btn sm ghost" data-a="tpl-new">${ICON.plus}作成</button></div>
      ${S.templates.length ? `<div class="tpl-grid">${S.templates.map(tplCard).join('')}</div>` :
        `<div class="card muted small">よく行うメニューを登録しておくと、ワンタップで開始できます。ワークアウトの終了時に「メニューとして保存」することもできます。<div style="margin-top:8px"><button class="btn sm soft" data-a="tpl-samples">サンプルを追加（3分割）</button></div></div>`}
      <div class="between"><h3>最近の記録</h3>${ws.length ? '<a class="btn sm ghost" href="#history">すべて</a>' : ''}</div>
      ${recent.length ? recent.map(workoutCard).join('') : `<div class="card empty"><div class="ic">🏋️</div>まだ記録がありません。<br>ワークアウトを開始して最初のセットを記録しましょう。</div>`}
    `,
  };
};

function volShort(v) {
  if (v >= 100000) return (Math.round(v / 1000)).toLocaleString('ja-JP') + 'k';
  if (v >= 10000) return (Math.round(v / 100) / 10) + 'k';
  return L.fmtNum(v);
}

function tplCard(t) {
  const names = t.entries.map((e) => EX[e.exId]?.name).filter(Boolean);
  const last = L.byStartDesc(S.workouts).find((w) => w.tplId === t.id);
  return `<div class="tpl" data-a="tpl-open" data-id="${t.id}"><div class="t">${esc(t.name)}</div>
    <div class="s">${esc(names.join('・') || '種目なし')}</div>
    <div class="m">${t.entries.length}種目${last ? '・前回 ' + L.fmtDate(last.start) : ''}</div></div>`;
}

function workoutCard(w) {
  const st = L.workoutStats(w, EX);
  const prs = L.detectPRs(S.workouts, w, EX).length;
  const names = w.entries.filter((e) => e.sets.some((s) => s.done)).map((e) => {
    const n = e.sets.filter(L.isWork).length;
    return `${esc(EX[e.exId]?.name || '削除された種目')} ×${n}`;
  });
  return `<div class="card tap" data-a="go" data-to="w/${w.id}">
    <div class="between"><div class="grow"><div class="muted small">${L.fmtDate(w.start, true)} ${L.fmtTime(w.start)}</div>
    <h2 class="ellipsis">${esc(w.name || 'トレーニング')} ${prs ? `<span class="badge pr">🏆 ${prs}</span>` : ''}</h2></div></div>
    <div class="wo-stats" style="margin:4px 0 6px"><span>⏱ <b>${L.fmtDuration(st.duration, false)}</b></span><span><b>${st.sets}</b>セット</span><span><b>${L.fmtNum(st.volume)}</b>${unit()}</span></div>
    <div class="small muted" style="display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden">${names.join('<br>')}</div></div>`;
}

// ---------------- ワークアウト記録・編集 ----------------
function editing() {
  const r = route();
  if (r.name === 'workout') return S.active;
  if (r.name === 'edit') return S.workouts.find((w) => w.id === r.arg) || null;
  return null;
}

VIEWS.workout = () => {
  const w = S.active;
  if (!w) {
    return {
      title: 'ワークアウト',
      body: `<div style="margin:8px 0 14px"><button class="btn primary big block" data-a="start-empty">${ICON.plus} 空のワークアウトを開始</button></div>
        <h3>メニューから開始</h3>
        ${S.templates.length ? `<div class="tpl-grid">${S.templates.map(tplCard).join('')}</div>` : '<div class="card muted small">メニューはまだありません（ホームから作成できます）</div>'}
        ${S.workouts.length ? `<h3>前回をもう一度</h3>${L.byStartDesc(S.workouts).slice(0, 3).map((x) => `<div class="li card" style="padding:12px" data-a="repeat" data-id="${x.id}"><div class="grow"><div class="t">${esc(x.name || 'トレーニング')}</div><div class="s">${L.fmtDate(x.start)}・${x.entries.length}種目</div></div><span class="btn sm soft">開始</span></div>`).join('')}` : ''}`,
    };
  }
  return {
    title: `<input class="name" style="font-size:17px;font-weight:700;background:transparent;border:none;padding:2px 0;outline:none" data-wf="name" value="${esc(w.name)}" placeholder="トレーニング">`,
    sub: `<span data-tick="elapsed"></span>・<span id="wo-sum"></span>`,
    actions: `<button class="icon-btn" data-a="wo-menu" aria-label="メニュー">${ICON.more}</button><button class="btn primary sm" data-a="finish">終了</button>`,
    body: editorBody(w, false),
    after: () => updateSummary(w),
  };
};

VIEWS.edit = (id) => {
  const w = S.workouts.find((x) => x.id === id);
  if (!w) return VIEWS.history();
  const toLocal = (ts) => { const d = new Date(ts); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 16); };
  const mins = w.end ? Math.round((w.end - w.start) / 60000) : 60;
  return {
    back: 'w/' + id,
    title: '記録を編集',
    actions: `<button class="btn primary sm" data-a="back" data-to="w/${id}">完了</button>`,
    body: `<div class="card">
      <label class="f">名前<input data-wf="name" value="${esc(w.name)}" placeholder="トレーニング"></label>
      <div class="row"><label class="f grow">開始<input type="datetime-local" data-wf="start" value="${toLocal(w.start)}"></label>
      <label class="f" style="width:110px">時間（分）<input type="number" inputmode="numeric" data-wf="mins" value="${mins}"></label></div></div>
      ${editorBody(w, true)}`,
  };
};

function editorBody(w, isEdit) {
  const rows = w.entries.map((en, idx) => entryCard(w, en, idx)).join('');
  return `
    ${rows || `<div class="card empty"><div class="ic">＋</div>種目を追加して記録を始めましょう</div>`}
    <button class="btn soft big block" data-a="pick-add">${ICON.plus} 種目を追加</button>
    <label class="f" style="margin-top:14px">メモ（体調・気づき）<textarea data-wf="note" rows="2" placeholder="例：睡眠不足、肩に違和感">${esc(w.note)}</textarea></label>
    ${isEdit ? '' : `<div class="row" style="margin:6px 0 20px"><button class="btn danger" data-a="discard">破棄</button><button class="btn primary" data-a="finish">ワークアウトを終了</button></div>`}
  `;
}

// 記録中の前回の値・提案・自己ベストを計算
function entryContext(w, en) {
  const ex = EX[en.exId] || { name: '削除された種目', type: 'weight', part: '' };
  const last = L.lastEntryFor(S.workouts, en.exId, w.start, w.id);
  const prevSets = last ? last.entry.sets.filter((s) => s.done) : [];
  const inc = ex.inc || S.settings.inc;
  const sug = last ? L.suggestNext(prevSets, { inc, min: en.min, max: en.max, type: ex.type }) : null;
  const rec = L.records(S.workouts, en.exId, ex, { before: w.start, excludeId: w.id });
  return { ex, last, prevSets, sug, rec, inc };
}

// セットiの「前回」と入力欄の薄字（そのまま✓すると入る値）
function placeholders(en, ctx) {
  const out = [];
  const cnt = { n: 0, w: 0, d: 0, f: 0 };
  const prevBy = { n: [], w: [], d: [], f: [] };
  for (const s of ctx.prevSets) (prevBy[s.k === 'f' ? 'n' : s.k] || prevBy.n).push(s);
  const sugW = ctx.sug ? [...ctx.sug.sets] : [];
  let above = null;
  en.sets.forEach((s) => {
    const key = s.k === 'f' ? 'n' : s.k;
    const j = cnt[key]++;
    const prev = prevBy[key][j] || null;
    let ph = null;
    if (key === 'n' && sugW[j]) ph = sugW[j];
    else if (prev) ph = { w: prev.w, r: prev.r };
    else if (above) ph = { w: above.w, r: above.r };
    out.push({ prev, ph });
    if (s.w !== null || s.r !== null) above = { w: s.w ?? ph?.w ?? null, r: s.r ?? ph?.r ?? null };
    else if (ph) above = ph;
  });
  return out;
}

function entryCard(w, en, idx) {
  const ctx = entryContext(w, en);
  const { ex, last, sug, rec } = ctx;
  const type = ex.type || 'weight';
  const showRpe = S.settings.showRpe !== false;
  const phs = placeholders(en, ctx);
  const u = unit();
  const ssPrev = idx > 0 && en.ss && w.entries[idx - 1].ss === en.ss;

  const lastLine = last ? `<div class="line"><span>前回 ${L.fmtDate(last.workout.start)}</span><span class="ellipsis">${ctx.prevSets.filter((s) => s.k !== 'w').map((s) => L.setText(s, type, u)).join(', ')}</span></div>` : '<div class="line">初めての種目です</div>';
  const recLine = rec.count && type === 'weight' ? `<div class="line">ベスト 推定1RM <b class="num">${L.fmtW(L.round(rec.e1rm, 0.1))}</b>・最高 <b class="num">${L.fmtW(rec.weight)}${u}</b></div>` :
    rec.count && type === 'reps' ? `<div class="line">ベスト ${rec.reps}回</div>` : '';
  const target = en.min || en.max ? `<span class="badge">目標 ${en.min ? en.min + '〜' : ''}${en.max || ''}回</span>` : '';
  const sugBox = sug && en.sets.some((s) => !s.done) ? `<div class="suggest"><span>${sug.up ? '📈' : '💡'}</span><div class="grow"><b>${sug.sets.map((s) => L.setText({ w: s.w, r: s.r }, type, u)).filter((v, i, a) => a.indexOf(v) === i).join(' / ')}</b> <span class="muted">${esc(sug.reason)}</span></div><button class="btn sm soft" data-a="apply-sug" data-e="${en.id}">入力</button></div>` : '';

  const wCol = type === 'time' ? '' : `<span>${type === 'reps' ? '+' + u : u}</span>`;
  const rCol = type === 'time' ? '秒' : '回';
  const head = `<div class="set hd"><span>セット</span><span>前回</span>${wCol}<span>${rCol}</span>${showRpe ? '<span>RPE</span>' : ''}<span>✓</span></div>`;
  let no = 0;
  const sets = en.sets.map((s, i) => {
    const { prev, ph } = phs[i];
    const label = s.k === 'n' ? ++no : L.KINDS[s.k];
    const prs = L.setPRs(rec, s, ex);
    const wIn = type === 'time' ? '' : `<input inputmode="decimal" enterkeyhint="next" data-f="w" data-e="${en.id}" data-i="${i}" value="${L.fmtW(s.w)}" placeholder="${ph?.w != null ? L.fmtW(ph.w) : type === 'reps' ? '0' : ''}">`;
    return `<div class="set ${s.done ? 'done' : ''}">
      <button class="kind ${s.k}" data-a="set-menu" data-e="${en.id}" data-i="${i}">${label}</button>
      <span class="prev" data-a="use-prev" data-e="${en.id}" data-i="${i}">${prev ? L.setText(prev, type, u) + (prev.rpe ? ' @' + prev.rpe : '') : '—'}</span>
      ${wIn}
      <input inputmode="numeric" enterkeyhint="next" data-f="r" data-e="${en.id}" data-i="${i}" value="${s.r ?? ''}" placeholder="${ph?.r ?? ''}">
      ${showRpe ? `<input inputmode="decimal" enterkeyhint="done" data-f="rpe" data-e="${en.id}" data-i="${i}" value="${s.rpe ?? ''}" placeholder="-">` : ''}
      <button class="ok" data-a="toggle" data-e="${en.id}" data-i="${i}" aria-label="完了">${ICON.check}</button>
      ${prs.length ? `<div class="pr"><span class="badge pr">🏆 ${prs.map((p) => L.PR_NAMES[p]).join('・')}更新</span> ${type === 'weight' ? `<span class="muted">推定1RM ${L.fmtW(L.round(L.e1rm(s.w, s.r), 0.1))}</span>` : ''}</div>` : ''}
    </div>`;
  }).join('');

  return `${ssPrev ? '<div class="ssline">↕ スーパーセット</div>' : ''}<div class="entry ${en.ss ? 'ss' : ''}" id="e-${en.id}">
    <div class="entry-h"><div class="name" data-a="ex-peek" data-id="${en.exId}">${esc(ex.name)} <span class="s">${esc(ex.part || '')}</span> ${target}</div>
      <button class="icon-btn" data-a="entry-menu" data-e="${en.id}" aria-label="種目メニュー">${ICON.more}</button></div>
    <div class="entry-info">${lastLine}${recLine}</div>
    ${en.note ? `<div class="entry-note" data-a="entry-note" data-e="${en.id}">📝 ${esc(en.note)}</div>` : ''}
    ${sugBox}
    <div class="sets ${showRpe ? '' : 'norpe'} ${type === 'time' ? 'time' : ''}">${head}${sets}</div>
    <div class="entry-f"><button class="btn" data-a="add-set" data-e="${en.id}">${ICON.plus} セット</button>${type === 'weight' ? `<button class="btn" data-a="warmup" data-e="${en.id}">W-up</button><button class="btn" data-a="plates-for" data-e="${en.id}">プレート</button>` : ''}</div>
  </div>`;
}

function updateSummary(w) {
  const el = $('#wo-sum');
  if (!el || !w) return;
  const st = L.workoutStats(w, EX);
  el.textContent = `${st.sets}セット・${L.fmtNum(st.volume)}${unit()}`;
}

function findEntry(id) {
  const w = editing();
  if (!w) return {};
  const idx = w.entries.findIndex((e) => e.id === id);
  return { w, en: w.entries[idx], idx };
}

function startWorkout(src, tplId = null) {
  if (S.active) {
    toast('記録中のワークアウトがあります');
    go('workout');
    return;
  }
  S.active = L.newWorkout(src || {});
  if (tplId) S.active.tplId = tplId;
  requestPersist();
  commit();
  go('workout');
}

// 薄字の値を入れて完了にする
function completeSet(w, en, i) {
  const ctx = entryContext(w, en);
  const ph = placeholders(en, ctx)[i].ph;
  const s = en.sets[i];
  const type = ctx.ex.type || 'weight';
  if (s.w === null && ph?.w != null && type !== 'time') s.w = ph.w;
  if (s.r === null && ph?.r != null) s.r = ph.r;
  if (!(s.r > 0)) {
    toast(type === 'time' ? '秒数を入力してください' : '回数を入力してください');
    $(`input[data-f="r"][data-e="${en.id}"][data-i="${i}"]`)?.focus();
    return false;
  }
  if (type === 'weight' && s.w === null) {
    toast('重量を入力してください');
    $(`input[data-f="w"][data-e="${en.id}"][data-i="${i}"]`)?.focus();
    return false;
  }
  s.done = true;
  // 自己ベスト（過去の記録＋このワークアウトで先に行ったセットより上か）
  const rec = ctx.rec;
  const prs = L.setPRs(rec, s, ctx.ex);
  if (prs.length) {
    const others = w.entries.filter((e) => e.exId === en.exId).flatMap((e) => e.sets).filter((x) => x !== s && L.isWork(x));
    const beat = prs.filter((p) => others.every((o) => {
      if (p === 'e1rm') return L.e1rm(s.w, s.r) > L.e1rm(o.w, o.r);
      if (p === 'weight') return (s.w || 0) > (o.w || 0);
      return s.r > o.r;
    }));
    if (beat.length) {
      toast(`🏆 自己ベスト更新！ ${ctx.ex.name} ${beat.map((p) => L.PR_NAMES[p]).join('・')}`, 'pr');
      buzz([80, 60, 80, 60, 160]);
    }
  }
  return true;
}

// ---------------- 休憩タイマー ----------------
let audio = null;
function beep() {
  if (!S.settings.sound) return;
  try {
    audio ||= new (window.AudioContext || window.webkitAudioContext)();
    const t0 = audio.currentTime;
    [0, 0.22, 0.44].forEach((d, k) => {
      const o = audio.createOscillator(), g = audio.createGain();
      o.frequency.value = k === 2 ? 1320 : 880;
      g.gain.setValueAtTime(0.0001, t0 + d);
      g.gain.exponentialRampToValueAtTime(0.35, t0 + d + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + d + 0.18);
      o.connect(g).connect(audio.destination);
      o.start(t0 + d);
      o.stop(t0 + d + 0.2);
    });
  } catch { /* 音が出せない環境 */ }
}
function buzz(p) {
  if (S.settings.vibrate && navigator.vibrate) navigator.vibrate(p);
}
// 最初の操作で音声を使えるようにする（iOS対策）
document.addEventListener('pointerdown', () => {
  if (!audio && S.settings.sound) {
    try { audio = new (window.AudioContext || window.webkitAudioContext)(); } catch { /* 非対応 */ }
  } else if (audio?.state === 'suspended') audio.resume();
}, { once: false, passive: true });

function startRest(sec, label = '') {
  if (!(sec > 0)) return;
  timer = { end: Date.now() + sec * 1000, total: sec, label, alerted: false };
  saveTimer(timer);
  updateLive();
}
function stopRest() {
  timer = null;
  saveTimer(null);
  updateLive();
}

function updateLive() {
  const now = Date.now();
  const r = route();
  const a = S.active;
  document.querySelectorAll('[data-tick="elapsed"]').forEach((el) => { el.textContent = a ? L.fmtDuration(now - a.start) : ''; });

  let restText = '';
  const restEl = $('#rest');
  if (timer) {
    const left = Math.ceil((timer.end - now) / 1000);
    if (left <= 0 && !timer.alerted) {
      timer.alerted = true;
      saveTimer(timer);
      beep();
      buzz([300, 120, 300]);
      notifyRestEnd();
    }
    if (left < -180) { stopRest(); return; }
    restText = left > 0 ? L.fmtSec(left) : '+' + L.fmtSec(-left);
    if (r.name === 'workout' && a) {
      const pct = left > 0 ? (left / timer.total) * 100 : 0;
      if (restEl.classList.contains('hidden') || !restEl.firstChild) {
        restEl.innerHTML = `<div class="bar"></div><div class="in">
          <div class="time" data-a="rest-pick"><span class="t"></span><small></small></div>
          <button data-a="rest-add" data-v="-15">−15</button><button data-a="rest-add" data-v="15">＋15</button><button data-a="rest-skip">${left > 0 ? 'スキップ' : '閉じる'}</button></div>`;
      }
      restEl.classList.remove('hidden');
      restEl.classList.toggle('over', left <= 0);
      $('.bar', restEl).style.width = pct + '%';
      $('.t', restEl).textContent = restText;
      $('small', restEl).textContent = left > 0 ? (timer.label ? '次：' + timer.label : '休憩中') : '休憩終了';
      $('[data-a="rest-skip"]', restEl).textContent = left > 0 ? 'スキップ' : '閉じる';
    } else restEl.classList.add('hidden');
  } else restEl.classList.add('hidden');

  const dock = $('#dock');
  if (a && r.name !== 'workout') {
    dock.innerHTML = `<span class="pulse"></span><span class="grow ellipsis">${esc(a.name || 'トレーニング')} ${L.fmtDuration(now - a.start)}</span>${restText ? `<span class="num">休憩 ${restText}</span>` : ''}<span>›</span>`;
    dock.classList.remove('hidden');
  } else dock.classList.add('hidden');
  document.body.classList.toggle('has-dock', !!a && (r.name !== 'workout' || !!timer));
}
setInterval(updateLive, 250);

async function notifyRestEnd() {
  if (!document.hidden || !S.settings.notify || !('Notification' in window) || Notification.permission !== 'granted') return;
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    if (reg) reg.showNotification('休憩終了', { body: '次のセットを始めましょう', tag: 'rest', renotify: true, vibrate: [300, 120, 300] });
    else new Notification('休憩終了');
  } catch { /* 通知できない */ }
}

let lock = null;
async function wakeLock() {
  const want = S.active && route().name === 'workout' && S.settings.keepAwake && !document.hidden;
  try {
    if (want && !lock && navigator.wakeLock) {
      lock = await navigator.wakeLock.request('screen');
      lock.addEventListener('release', () => { lock = null; });
    } else if (!want && lock) {
      await lock.release();
      lock = null;
    }
  } catch { lock = null; }
}
document.addEventListener('visibilitychange', () => { if (!document.hidden) { wakeLock(); updateLive(); } });

// ---------------- 種目選択 ----------------
let pick = null; // { mode: 'add'|'replace'|'tpl', sel: [], q, part, target }
function lastUsedMap() {
  const m = {};
  for (const w of S.workouts) for (const e of w.entries) if (!m[e.exId] || w.start > m[e.exId]) m[e.exId] = w.start;
  return m;
}
function openPicker(mode, target = null) {
  pick = { mode, sel: [], q: '', part: '', target };
  openSheet(`<div class="sticky"><div class="between"><h2 style="margin:0">${mode === 'replace' ? '種目を入れ替え' : '種目を追加'}</h2><button class="btn sm ghost" data-a="ex-new-from-pick">${ICON.plus}新規</button></div>
    <input id="pick-q" type="search" placeholder="種目を検索" style="margin:8px 0" autocomplete="off">
    <div class="chips" id="pick-parts"></div></div>
    <div id="pick-list"></div>
    ${mode === 'replace' ? '' : '<div class="foot"><button class="btn primary block big" data-a="pick-done" id="pick-done" disabled>追加</button></div>'}`, () => { pick = null; });
  $('#pick-q').addEventListener('input', (e) => { pick.q = e.target.value; renderPickList(); });
  renderPickList();
}
function renderPickList() {
  if (!pick) return;
  $('#pick-parts').innerHTML = ['', ...L.PARTS].map((p) => `<button class="chip ${pick.part === p ? 'on' : ''}" data-a="pick-part" data-v="${p}">${p || 'すべて'}</button>`).join('');
  const used = lastUsedMap();
  const q = pick.q.trim().toLowerCase();
  let list = S.exercises.filter((e) => !e.archived && (!pick.part || e.part === pick.part) && (!q || e.name.toLowerCase().includes(q)));
  const item = (e) => {
    const on = pick.sel.includes(e.id);
    const n = on ? pick.sel.indexOf(e.id) + 1 : '';
    return `<div class="li ${on ? 'sel' : ''}" data-a="pick-toggle" data-id="${e.id}"><div class="grow"><div class="t">${esc(e.name)}</div><div class="s">${esc(e.part)}・${L.TYPES[e.type]}${used[e.id] ? '・前回 ' + L.fmtDate(used[e.id]) : ''}</div></div>${pick.mode === 'replace' ? '' : `<span class="tick">${n}</span>`}</div>`;
  };
  let html = '';
  if (!q && !pick.part) {
    const recent = S.exercises.filter((e) => used[e.id] && !e.archived).sort((a, b) => used[b.id] - used[a.id]).slice(0, 8);
    if (recent.length) html += `<h3>最近</h3><div class="list">${recent.map(item).join('')}</div>`;
    for (const p of L.PARTS) {
      const g = list.filter((e) => e.part === p);
      if (g.length) html += `<h3>${p}</h3><div class="list">${g.map(item).join('')}</div>`;
    }
  } else {
    html = list.length ? `<div class="list">${list.map(item).join('')}</div>` : '';
    if (q) html += `<button class="btn soft block" data-a="ex-new-from-pick">「${esc(pick.q.trim())}」を新しい種目として作成</button>`;
  }
  $('#pick-list').innerHTML = html;
  const b = $('#pick-done');
  if (b) { b.disabled = !pick.sel.length; b.textContent = pick.sel.length ? `${pick.sel.length}種目を追加` : '追加'; }
}
function pickApply(ids) {
  const p = pick;
  closeSheet();
  if (p.mode === 'tpl') {
    const t = S.templates.find((x) => x.id === p.target);
    for (const id of ids) t.entries.push({ exId: id, sets: [{ k: 'n' }, { k: 'n' }, { k: 'n' }], min: null, max: null, ss: null });
    commit();
    return;
  }
  const w = editing();
  if (!w) return;
  if (p.mode === 'replace') {
    const en = w.entries.find((e) => e.id === p.target);
    if (en) en.exId = ids[0];
  } else {
    let lastId = null;
    for (const id of ids) {
      const last = L.lastEntryFor(S.workouts, id, w.start, w.id);
      const kinds = last ? last.entry.sets.filter((s) => s.done).map((s) => ({ k: s.k })) : [];
      const nw = L.newWorkout({ entries: [{ exId: id, sets: kinds.length ? kinds : null, min: last?.entry.min, max: last?.entry.max }] });
      w.entries.push(nw.entries[0]);
      lastId = nw.entries[0].id;
    }
    if (lastId) setTimeout(() => $('#e-' + lastId)?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 50);
  }
  commit();
}

function exerciseForm(ex, fromPick = false) {
  const e = ex || { name: pick?.q?.trim() || '', part: pick?.part || '胸', type: 'weight', rest: S.settings.rest, inc: null, note: '' };
  const keepPick = fromPick ? { ...pick } : null;
  openSheet(`<h2>${ex ? '種目を編集' : '新しい種目'}</h2>
    <label class="f">名前<input id="xf-name" value="${esc(e.name)}" placeholder="例：スミスマシンスクワット"></label>
    <div class="row"><label class="f grow">部位<select id="xf-part">${L.PARTS.map((p) => `<option ${p === e.part ? 'selected' : ''}>${p}</option>`).join('')}</select></label>
    <label class="f grow">記録の種類<select id="xf-type">${Object.entries(L.TYPES).map(([k, v]) => `<option value="${k}" ${k === e.type ? 'selected' : ''}>${v}</option>`).join('')}</select></label></div>
    <div class="row"><label class="f grow">休憩（秒）<input id="xf-rest" type="number" inputmode="numeric" value="${e.rest ?? ''}" placeholder="${S.settings.rest}"></label>
    <label class="f grow">重量の刻み<input id="xf-inc" inputmode="decimal" value="${e.inc ?? ''}" placeholder="${S.settings.inc}"></label></div>
    <label class="f">フォームのメモ<textarea id="xf-note" rows="2" placeholder="例：シート高さ4、グリップ幅は肩幅+拳1つ">${esc(e.note)}</textarea></label>
    <div class="row" style="margin-top:8px"><button class="btn" data-a="sheet-close">キャンセル</button><button class="btn primary" id="xf-ok">保存</button></div>`, () => { if (keepPick) pick = null; });
  if (keepPick) pick = keepPick;
  $('#xf-ok').onclick = () => {
    const name = $('#xf-name').value.trim();
    if (!name) { toast('名前を入力してください'); return; }
    if (S.exercises.some((x) => x.name === name && x.id !== ex?.id && !x.archived)) { toast('同じ名前の種目があります'); return; }
    const data = { name, part: $('#xf-part').value, type: $('#xf-type').value, rest: L.parseNum($('#xf-rest').value), inc: L.parseNum($('#xf-inc').value), note: $('#xf-note').value.trim() };
    if (ex) Object.assign(ex, data);
    else S.exercises.push({ id: L.uid(), ...data });
    reindex();
    const id = ex ? ex.id : S.exercises[S.exercises.length - 1].id;
    if (keepPick && !ex) {
      pick = keepPick;
      pickApply([id]);
    } else {
      closeSheet();
      commit();
      toast('保存しました');
    }
  };
}

// ---------------- 種目のポップアップ（記録中に履歴を確認） ----------------
function exPeek(id) {
  const ex = EX[id];
  if (!ex) return;
  const hist = L.exerciseHistory(S.workouts, id, ex).reverse().slice(0, 6);
  const rec = L.records(S.workouts, id, ex);
  const u = unit();
  openSheet(`<div class="between"><h2>${esc(ex.name)}</h2><a class="btn sm soft" href="#ex/${id}">詳細</a></div>
    ${ex.note ? `<div class="entry-note" style="margin:0 0 10px">📝 ${esc(ex.note)}</div>` : ''}
    ${rec.count && ex.type === 'weight' ? `<div class="tiles c3"><div class="tile"><div class="k">推定1RM</div><div class="v">${L.fmtW(L.round(rec.e1rm, 0.1))}</div></div><div class="tile"><div class="k">最高重量</div><div class="v">${L.fmtW(rec.weight)}</div></div><div class="tile"><div class="k">回数</div><div class="v">${rec.count}</div></div></div>` : ''}
    ${hist.length ? hist.map((h) => `<div class="li" style="padding:10px 0;cursor:default"><div class="grow"><div class="t small">${L.fmtDate(h.start, true)}</div><div class="s">${h.list.map((s) => L.setText(s, ex.type, u)).join(', ')}</div></div></div>`).join('') : '<p class="muted">まだ記録がありません</p>'}`);
}

// ---------------- 履歴 ----------------
VIEWS.history = () => {
  const m = new Date(ui.histMonth);
  const y = m.getFullYear(), mo = m.getMonth();
  const first = new Date(y, mo, 1);
  const days = new Date(y, mo + 1, 0).getDate();
  const counts = L.dayCounts(S.workouts);
  const today = L.dateKey(Date.now());
  const off = (first.getDay() - S.settings.weekStart + 7) % 7;
  const wd = [...'日月火水木金土'];
  const wdo = [...wd.slice(S.settings.weekStart), ...wd.slice(0, S.settings.weekStart)];
  let cal = wdo.map((d) => `<div class="wd">${d}</div>`).join('');
  for (let i = 0; i < off; i++) cal += '<div class="d out"></div>';
  let monthCount = 0;
  for (let d = 1; d <= days; d++) {
    const k = L.dateKey(new Date(y, mo, d).getTime());
    if (counts[k]) monthCount++;
    cal += `<div class="d ${counts[k] ? 'has' : ''} ${k === today ? 'today' : ''} ${ui.histDay === k ? 'sel' : ''}" data-a="hist-day" data-v="${k}">${d}</div>`;
  }
  let list = L.byStartDesc(S.workouts);
  if (ui.histEx) list = list.filter((w) => w.entries.some((e) => e.exId === ui.histEx && e.sets.some((s) => s.done)));
  if (ui.histDay) list = list.filter((w) => L.dateKey(w.start) === ui.histDay);
  else list = list.filter((w) => { const d = new Date(w.start); return d.getFullYear() === y && d.getMonth() === mo; });
  const usedIds = new Set(S.workouts.flatMap((w) => w.entries.map((e) => e.exId)));
  const exOpts = S.exercises.filter((e) => usedIds.has(e.id)).map((e) => `<option value="${e.id}" ${ui.histEx === e.id ? 'selected' : ''}>${esc(e.name)}</option>`).join('');

  return {
    title: '履歴',
    sub: `全${S.workouts.length}回`,
    body: `<div class="card">
      <div class="between" style="margin-bottom:8px"><button class="icon-btn" data-a="hist-month" data-v="-1" aria-label="前の月">${ICON.back}</button>
      <div style="font-weight:700">${y}年${mo + 1}月 <span class="muted small">${monthCount}日</span></div>
      <button class="icon-btn" data-a="hist-month" data-v="1" aria-label="次の月" style="transform:scaleX(-1)">${ICON.back}</button></div>
      <div class="cal">${cal}</div></div>
      <select data-c="hist-ex" style="margin-bottom:10px"><option value="">すべての種目</option>${exOpts}</select>
      ${ui.histDay ? `<div class="between"><h3>${L.fmtDate(new Date(ui.histDay.replace(/-/g, '/')).getTime(), true)}</h3><button class="btn sm ghost" data-a="hist-day" data-v="${ui.histDay}">解除</button></div>` : ''}
      ${list.length ? list.map(workoutCard).join('') : '<div class="empty">この期間の記録はありません</div>'}`,
  };
};

VIEWS.w = (id) => {
  const w = S.workouts.find((x) => x.id === id);
  if (!w) return VIEWS.history();
  const st = L.workoutStats(w, EX);
  const prs = L.detectPRs(S.workouts, w, EX);
  const u = unit();
  const prSet = new Set(prs.map((p) => p.exId));
  const ents = w.entries.filter((e) => e.sets.some((s) => s.done)).map((en) => {
    const ex = EX[en.exId] || { name: '削除された種目', type: 'weight' };
    const es = L.entryStats(en, ex);
    let no = 0;
    return `<div class="card"><div class="between"><h2 class="tap" data-a="go" data-to="ex/${en.exId}" style="cursor:pointer">${esc(ex.name)} ${prSet.has(en.exId) ? '<span class="badge pr">🏆</span>' : ''}</h2>
      <span class="muted small">${es.sets}セット${ex.type !== 'time' ? '・' + L.fmtNum(es.volume) + u : ''}</span></div>
      <table class="tbl" style="margin-top:6px"><tbody>${en.sets.filter((s) => s.done).map((s) => `<tr><td style="width:40px" class="muted">${s.k === 'n' ? ++no : L.KINDS[s.k]}</td><td style="text-align:left"><b>${L.setText(s, ex.type, u)}</b>${s.rpe ? ` <span class="muted">@${s.rpe}</span>` : ''}</td><td class="muted small">${ex.type === 'weight' && s.k !== 'w' ? '1RM ' + L.fmtW(L.round(L.e1rm(s.w, s.r), 0.1)) : ''}</td></tr>`).join('')}</tbody></table>
      ${en.note ? `<div class="entry-note" style="margin:8px 0 0">📝 ${esc(en.note)}</div>` : ''}</div>`;
  }).join('');
  return {
    back: 'history',
    title: esc(w.name || 'トレーニング'),
    sub: `${L.fmtDate(w.start, true)} ${L.fmtTime(w.start)}${w.end ? '〜' + L.fmtTime(w.end) : ''}`,
    actions: `<button class="icon-btn" data-a="w-menu" data-id="${w.id}" aria-label="メニュー">${ICON.more}</button>`,
    body: `<div class="tiles c3">
        <div class="tile"><div class="k">時間</div><div class="v">${L.fmtDuration(st.duration, false)}</div></div>
        <div class="tile"><div class="k">セット</div><div class="v">${st.sets}</div><div class="d">${st.reps}回</div></div>
        <div class="tile"><div class="k">ボリューム</div><div class="v">${volShort(st.volume)}<small>${u}</small></div></div></div>
      ${prs.length ? `<div class="card" style="background:var(--gold-soft);border-color:transparent"><h2 style="color:var(--gold)">🏆 自己ベスト ${prs.length}件</h2>${prs.map((p) => `<div class="small" style="margin-top:4px"><b>${esc(EX[p.exId]?.name)}</b> ${L.PR_NAMES[p.type]} ${prFmt(p)}</div>`).join('')}</div>` : ''}
      ${w.note ? `<div class="card small" style="white-space:pre-wrap">📝 ${esc(w.note)}</div>` : ''}
      ${ents || '<div class="empty">完了したセットがありません</div>'}
      <div class="row" style="margin:8px 0 20px"><button class="btn" data-a="go" data-to="edit/${w.id}">編集</button><button class="btn soft" data-a="repeat" data-id="${w.id}">もう一度行う</button></div>`,
  };
};
function prFmt(p) {
  const f = (v) => (p.type === 'reps' ? v + '回' : L.fmtW(L.round(v, 0.1)) + unit());
  return `<b class="num">${f(p.value)}</b> <span class="muted">（前 ${f(p.prev)}）</span>`;
}

// ---------------- 種目一覧・詳細 ----------------
VIEWS.exercises = () => ({
  title: '種目',
  sub: `${S.exercises.filter((e) => !e.archived).length}種目`,
  actions: `<button class="icon-btn" data-a="ex-new" aria-label="種目を追加">${ICON.plus}</button>`,
  body: `<input id="ex-q" type="search" placeholder="種目を検索" value="${esc(ui.exQ)}" style="margin:4px 0 8px" autocomplete="off">
    <div class="chips">${['', ...L.PARTS].map((p) => `<button class="chip ${ui.exPart === p ? 'on' : ''}" data-a="ex-part" data-v="${p}">${p || 'すべて'}</button>`).join('')}</div>
    <div id="ex-list"></div>`,
  after: () => {
    $('#ex-q').addEventListener('input', (e) => { ui.exQ = e.target.value; renderExList(); });
    renderExList();
  },
});
function renderExList() {
  const used = lastUsedMap();
  const q = ui.exQ.trim().toLowerCase();
  const list = S.exercises.filter((e) => !e.archived && (!ui.exPart || e.part === ui.exPart) && (!q || e.name.toLowerCase().includes(q)));
  const best = {};
  for (const e of list) if (used[e.id]) best[e.id] = L.records(S.workouts, e.id, e);
  const item = (e) => {
    const r = best[e.id];
    const right = r ? (e.type === 'weight' ? `<div><b class="num">${L.fmtW(L.round(r.e1rm, 0.1))}</b><span class="small">${unit()}</span></div><div class="small">推定1RM</div>` : e.type === 'reps' ? `<div><b>${r.reps}</b>回</div><div class="small">最多</div>` : `<div><b>${L.fmtSec(r.reps)}</b></div><div class="small">最長</div>`) : '';
    return `<div class="li" data-a="go" data-to="ex/${e.id}"><div class="grow"><div class="t">${esc(e.name)}</div><div class="s">${esc(e.part)}・${L.TYPES[e.type]}${used[e.id] ? '・' + L.fmtDate(used[e.id]) : '・未実施'}</div></div><div class="r">${right}</div></div>`;
  };
  let html = '';
  for (const p of L.PARTS) {
    const g = list.filter((e) => e.part === p);
    if (g.length) html += `<h3>${p}</h3><div class="list">${g.map(item).join('')}</div>`;
  }
  $('#ex-list').innerHTML = html || `<div class="empty">見つかりません<br><button class="btn soft" style="margin-top:10px" data-a="ex-new">「${esc(ui.exQ)}」を作成</button></div>`;
}

const METRICS = { e1rm: '推定1RM', top: '最高重量', vol: 'ボリューム', reps: '最多回数' };
VIEWS.ex = (id) => {
  const ex = EX[id];
  if (!ex) return VIEWS.exercises();
  const hist = L.exerciseHistory(S.workouts, id, ex);
  const rec = L.records(S.workouts, id, ex);
  const u = unit();
  const metrics = ex.type === 'weight' ? ['e1rm', 'top', 'vol', 'reps'] : ex.type === 'reps' ? ['reps', 'vol'] : ['reps'];
  if (!metrics.includes(ui.exMetric)) ui.exMetric = metrics[0];
  const val = (h) => ({ e1rm: h.e1rm, top: h.topW, vol: h.volume, reps: h.maxR })[ui.exMetric];
  const fmtV = (v) => (ui.exMetric === 'reps' ? (ex.type === 'time' ? L.fmtSec(v) : v + '回') : L.fmtW(L.round(v, 0.1)) + u);
  const pts = hist.map((h) => ({ x: h.start, y: val(h), tip: `${L.fmtDate(h.start, true)}<br><b>${fmtV(val(h))}</b>` }));

  let tiles = '';
  if (ex.type === 'weight') {
    tiles = `<div class="tiles"><div class="tile"><div class="k">推定1RM</div><div class="v">${L.fmtW(L.round(rec.e1rm, 0.1))}<small>${u}</small></div></div>
      <div class="tile"><div class="k">最高重量</div><div class="v">${L.fmtW(rec.weight)}<small>${u}</small></div></div>
      <div class="tile"><div class="k">最大ボリューム</div><div class="v">${volShort(rec.volume)}<small>${u}</small></div></div>
      <div class="tile"><div class="k">実施</div><div class="v">${rec.count}<small>回</small></div></div></div>`;
  } else {
    tiles = `<div class="tiles"><div class="tile"><div class="k">${ex.type === 'time' ? '最長' : '最多回数'}</div><div class="v">${ex.type === 'time' ? L.fmtSec(rec.reps) : rec.reps + '<small>回</small>'}</div></div>
      <div class="tile"><div class="k">実施</div><div class="v">${rec.count}<small>回</small></div></div></div>`;
  }
  let rm = '';
  if (ex.type === 'weight' && rec.count) {
    const rows = [1, 2, 3, 4, 5, 6, 8, 10, 12, 15].map((r) => {
      const real = rec.repMax[r];
      return `<tr><td>${r}RM</td><td>${real ? `<b>${L.fmtW(real.w)}</b> <span class="muted small">${L.fmtDate(real.start)}</span>` : '<span class="muted">—</span>'}</td><td class="muted">${L.fmtW(L.floorTo(L.weightForReps(rec.e1rm, r), 0.5))}</td></tr>`;
    }).join('');
    rm = `<h3>回数別の記録</h3><div class="card" style="padding:4px 14px"><table class="tbl"><thead><tr><th>回数</th><th>実績</th><th>推定</th></tr></thead><tbody>${rows}</tbody></table></div>`;
  }
  const recent = [...hist].reverse();
  const shown = ui.exMore ? recent : recent.slice(0, 10);
  return {
    back: 'exercises',
    title: esc(ex.name),
    sub: `${esc(ex.part)}・${L.TYPES[ex.type]}`,
    actions: `<button class="icon-btn" data-a="ex-menu" data-id="${id}" aria-label="メニュー">${ICON.more}</button>`,
    body: `${ex.note ? `<div class="entry-note" style="margin:0 0 10px">📝 ${esc(ex.note)}</div>` : ''}
      ${tiles}
      ${hist.length ? `<div class="card"><div class="seg" style="margin-bottom:10px">${metrics.map((m) => `<button class="${ui.exMetric === m ? 'on' : ''}" data-a="ex-metric" data-v="${m}">${ex.type === 'time' && m === 'reps' ? '最長時間' : METRICS[m]}</button>`).join('')}</div>
        ${hist.length >= 2 ? lineChart('exc', pts, { fmt: (v) => (ui.exMetric === 'reps' ? Math.round(v) : L.fmtW(Math.round(v))) }) : '<p class="muted small center">2回以上記録するとグラフが表示されます</p>'}</div>` : '<div class="empty">まだ記録がありません</div>'}
      ${rm}
      ${recent.length ? `<h3>記録</h3><div class="list">${shown.map((h) => `<div class="li" data-a="go" data-to="w/${h.id}"><div class="grow"><div class="t small">${L.fmtDate(h.start, true)}</div><div class="s">${h.list.map((s) => L.setText(s, ex.type, u)).join(', ')}</div></div><div class="r">${ex.type === 'weight' ? L.fmtW(L.round(h.e1rm, 0.1)) : ''}</div></div>`).join('')}</div>
        ${recent.length > shown.length ? '<button class="btn block ghost" data-a="ex-more">もっと見る</button>' : ''}` : ''}`,
    after: () => bindCharts(),
  };
};

// ---------------- 分析 ----------------
VIEWS.stats = () => {
  const now = Date.now();
  const st = S.settings;
  const u = unit();
  const weeks = L.weeklySeries(S.workouts, EX, ui.statWeeks, now, st.weekStart);
  const wk = L.weekStartOf(now, st.weekStart);
  const cur = L.partSets(S.workouts, EX, wk, Infinity);
  const prev = L.partSets(S.workouts, EX, L.addDays(wk, -7), wk);
  const maxP = Math.max(10, ...Object.values(cur), ...Object.values(prev));
  const last4 = weeks.slice(-4);
  const avg = (k) => last4.reduce((a, w) => a + w[k], 0) / Math.max(1, last4.length);
  const total = S.workouts.length;
  const body = [...S.body].sort((a, b) => a.t - b.t);
  const lastBody = body[body.length - 1];
  const avgPts = L.movingAvg(body.map((b) => ({ t: b.t, v: b.w })), 7);

  const partRows = L.PARTS.map((p) => `<div class="hb"><span>${p}</span><div class="track"><i style="width:${(cur[p] / maxP) * 100}%"></i>${prev[p] ? `<span class="prev" style="left:${(prev[p] / maxP) * 100}%"></span>` : ''}</div><span class="v"><b>${cur[p]}</b> / 先週${prev[p]}</span></div>`).join('');

  return {
    title: '分析',
    body: `<div class="seg" style="margin:4px 0 10px">${[8, 12, 26, 52].map((n) => `<button class="${ui.statWeeks === n ? 'on' : ''}" data-a="stat-weeks" data-v="${n}">${n}週</button>`).join('')}</div>
      <div class="tiles">
        <div class="tile"><div class="k">週平均（直近4週）</div><div class="v">${(Math.round(avg('count') * 10) / 10)}<small>回</small></div></div>
        <div class="tile"><div class="k">週平均セット</div><div class="v">${Math.round(avg('sets'))}<small>セット</small></div></div>
        <div class="tile"><div class="k">週平均ボリューム</div><div class="v">${volShort(avg('volume'))}<small>${u}</small></div></div>
        <div class="tile"><div class="k">累計</div><div class="v">${total}<small>回</small></div></div></div>
      <div class="card"><h2>週ごとのボリューム（${u}）</h2><div class="muted small" style="margin-bottom:6px">完了セットの 重量×回数 の合計（ウォームアップ除く）</div>
        ${barChart('vol', weeks.map((w) => ({ label: `${new Date(w.start).getMonth() + 1}/${new Date(w.start).getDate()}`, v: w.volume, tip: `${L.fmtDate(w.start)}の週<br><b>${L.fmtNum(w.volume)}${u}</b><br>${w.count}回・${w.sets}セット` })), { fmt: (v) => (v >= 1000 ? Math.round(v / 100) / 10 + 'k' : String(Math.round(v))) })}</div>
      <div class="card"><h2>週ごとのトレーニング回数</h2><div class="muted small" style="margin-bottom:6px">破線は目標（週${st.weeklyGoal}回）</div>
        ${barChart('cnt', weeks.map((w) => ({ label: `${new Date(w.start).getMonth() + 1}/${new Date(w.start).getDate()}`, v: w.count, tip: `${L.fmtDate(w.start)}の週<br><b>${w.count}回</b>`, dim: w.count < st.weeklyGoal })), { goal: st.weeklyGoal, fmt: (v) => Math.round(v) })}</div>
      <div class="card"><h2>今週の部位別セット数</h2><div class="muted small" style="margin-bottom:6px">縦線は先週。筋肥大の目安は1部位あたり週10〜20セット</div><div class="hbars">${partRows}</div></div>
      <div class="card"><div class="between"><h2>体重</h2>${lastBody ? `<span class="muted small">最新 <b style="color:var(--text)">${L.fmtW(lastBody.w)}${u}</b> ${L.fmtDate(lastBody.t)}</span>` : ''}</div>
        <div class="row" style="margin:10px 0"><input id="bw-in" inputmode="decimal" placeholder="今日の体重（${u}）" value=""><button class="btn primary" data-a="bw-add" style="flex:none">記録</button></div>
        ${body.length >= 2 ? `<div class="small muted" style="display:flex;gap:12px;margin-bottom:4px"><span><span style="color:var(--chart)">●</span> 体重</span><span><span style="color:var(--chart2)">- -</span> 7日平均</span></div>${lineChart('bw', body.map((b) => ({ x: b.t, y: b.w, tip: `${L.fmtDate(b.t, true)}<br><b>${L.fmtW(b.w)}${u}</b>` })), { fmt: (v) => L.fmtW(Math.round(v * 10) / 10), second: avgPts.map((p) => ({ x: p.t, y: p.v })), pad: true })}` : '<p class="muted small">2日以上記録するとグラフが表示されます</p>'}
        ${body.length ? `<details style="margin-top:8px"><summary class="small muted">記録の一覧・削除</summary><div class="list" style="margin-top:8px">${[...body].reverse().slice(0, 60).map((b) => `<div class="li" style="cursor:default;min-height:44px;padding:8px 12px"><span class="grow">${L.fmtDate(b.t, true)}</span><b class="num">${L.fmtW(b.w)}${u}</b><button class="icon-btn" data-a="bw-del" data-t="${b.t}" aria-label="削除">×</button></div>`).join('')}</div></details>` : ''}</div>`,
    after: () => bindCharts(),
  };
};

// ---------------- グラフ（SVG） ----------------
const CH = {};
function niceTicks(min, max, n = 4) {
  if (min === max) { min -= 1; max += 1; }
  const span = max - min;
  const step0 = span / n;
  const mag = 10 ** Math.floor(Math.log10(step0));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= step0) || 10 * mag;
  const lo = Math.floor(min / step) * step, hi = Math.ceil(max / step) * step;
  const out = [];
  for (let v = lo; v <= hi + step / 2; v += step) out.push(Math.round(v * 1000) / 1000);
  return out;
}
function lineChart(id, pts, { fmt = String, second = null, pad = false } = {}) {
  const W = 340, H = 180, L0 = 38, R0 = 10, T0 = 10, B0 = 22;
  const xs = pts.map((p) => p.x), ys = [...pts.map((p) => p.y), ...(second || []).map((p) => p.y)];
  const x0 = Math.min(...xs), x1 = Math.max(...xs);
  let y0 = Math.min(...ys), y1 = Math.max(...ys);
  if (!pad) y0 = Math.min(y0, y1 - (y1 - y0) * 1.2);
  const ticks = niceTicks(y0, y1);
  const ty0 = ticks[0], ty1 = ticks[ticks.length - 1];
  const sx = (x) => L0 + (x1 === x0 ? (W - L0 - R0) / 2 : ((x - x0) / (x1 - x0)) * (W - L0 - R0));
  const sy = (y) => T0 + (1 - (y - ty0) / (ty1 - ty0 || 1)) * (H - T0 - B0);
  const path = (arr) => arr.map((p, i) => `${i ? 'L' : 'M'}${sx(p.x).toFixed(1)},${sy(p.y).toFixed(1)}`).join('');
  CH[id] = { pts: pts.map((p) => ({ px: sx(p.x), py: sy(p.y), tip: p.tip })), W, H, T0, B0 };
  const grid = ticks.map((t) => `<line class="gl" x1="${L0}" x2="${W - R0}" y1="${sy(t)}" y2="${sy(t)}"/><text class="ax" x="${L0 - 6}" y="${sy(t) + 3}" text-anchor="end">${fmt(t)}</text>`).join('');
  const xl = [x0, (x0 + x1) / 2, x1].filter((v, i, a) => x1 !== x0 || i === 0).map((x, i, a) => `<text class="ax" x="${sx(x)}" y="${H - 6}" text-anchor="${a.length === 1 ? 'middle' : i === 0 ? 'start' : i === a.length - 1 ? 'end' : 'middle'}">${L.fmtDate(x).replace(/\(.\)/, '')}</text>`).join('');
  const lastP = pts[pts.length - 1];
  const dots = pts.length <= 40 ? pts.map((p) => `<circle class="dt" cx="${sx(p.x)}" cy="${sy(p.y)}" r="${pts.length > 20 ? 2.5 : 4}"/>`).join('') : `<circle class="dt" cx="${sx(lastP.x)}" cy="${sy(lastP.y)}" r="4"/>`;
  return `<div class="chart" data-chart="${id}"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="推移グラフ">${grid}${xl}
    ${second ? `<path class="ln2" d="${path(second)}"/>` : ''}<path class="ln" d="${path(pts)}"/>${dots}
    <line class="cross hidden" y1="${T0}" y2="${H - B0}"/><circle class="dt hov hidden" r="5"/></svg><div class="tip hidden"></div></div>`;
}
function barChart(id, items, { fmt = String, goal = null } = {}) {
  const W = 340, H = 170, L0 = 34, R0 = 6, T0 = 10, B0 = 22;
  const max = Math.max(goal || 0, ...items.map((i) => i.v), 1);
  const ticks = niceTicks(0, max, 3);
  const top = ticks[ticks.length - 1];
  const bw = (W - L0 - R0) / items.length;
  const gap = Math.min(4, bw * 0.25);
  const sy = (v) => T0 + (1 - v / top) * (H - T0 - B0);
  const every = Math.ceil(items.length / 6);
  CH[id] = { pts: items.map((it, i) => ({ px: L0 + bw * i + bw / 2, py: sy(it.v), tip: it.tip })), W, H, T0, B0, bar: true };
  const grid = ticks.map((t) => `<line class="gl" x1="${L0}" x2="${W - R0}" y1="${sy(t)}" y2="${sy(t)}"/><text class="ax" x="${L0 - 6}" y="${sy(t) + 3}" text-anchor="end">${fmt(t)}</text>`).join('');
  const bars = items.map((it, i) => {
    const x = L0 + bw * i + gap / 2, w = bw - gap, y = sy(it.v), h = H - B0 - y;
    const r = Math.min(4, w / 2, h);
    const d = h > 0 ? `M${x},${H - B0}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${H - B0}Z` : '';
    return `${d ? `<path class="bar ${it.dim ? 'dim' : ''}" d="${d}"/>` : ''}${(items.length - 1 - i) % every === 0 ? `<text class="ax" x="${x + w / 2}" y="${H - 6}" text-anchor="middle">${it.label}</text>` : ''}`;
  }).join('');
  const g = goal ? `<line x1="${L0}" x2="${W - R0}" y1="${sy(goal)}" y2="${sy(goal)}" stroke="var(--text)" stroke-opacity=".5" stroke-dasharray="4 3"/>` : '';
  return `<div class="chart" data-chart="${id}"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="棒グラフ">${grid}${bars}${g}<line class="cross hidden" y1="${T0}" y2="${H - B0}"/></svg><div class="tip hidden"></div></div>`;
}
function bindCharts() {
  document.querySelectorAll('.chart[data-chart]').forEach((el) => {
    const c = CH[el.dataset.chart];
    if (!c) return;
    const svg = $('svg', el), tip = $('.tip', el), cross = $('.cross', el), hov = $('.hov', el);
    const show = (ev) => {
      const rect = svg.getBoundingClientRect();
      const x = ((ev.clientX - rect.left) / rect.width) * c.W;
      let best = c.pts[0], bd = Infinity;
      for (const p of c.pts) { const d = Math.abs(p.px - x); if (d < bd) { bd = d; best = p; } }
      if (!best) return;
      const k = rect.width / c.W;
      cross.setAttribute('x1', best.px); cross.setAttribute('x2', best.px); cross.classList.remove('hidden');
      if (hov) { hov.setAttribute('cx', best.px); hov.setAttribute('cy', best.py); hov.classList.remove('hidden'); }
      tip.innerHTML = best.tip;
      tip.classList.remove('hidden');
      const tx = Math.max(50, Math.min(rect.width - 50, best.px * k));
      tip.style.left = tx + 'px';
      tip.style.top = Math.max(30, best.py * k) + 'px';
    };
    const hide = () => { tip.classList.add('hidden'); cross.classList.add('hidden'); hov?.classList.add('hidden'); };
    el.addEventListener('pointermove', show);
    el.addEventListener('pointerdown', show);
    el.addEventListener('pointerleave', hide);
  });
}

// ---------------- メニュー（テンプレート） ----------------
VIEWS.tpl = (id) => {
  const t = S.templates.find((x) => x.id === id);
  if (!t) return VIEWS.home();
  const rows = t.entries.map((en, i) => {
    const ex = EX[en.exId] || { name: '削除された種目' };
    const n = en.sets.length;
    const w = en.sets.filter((s) => s.k === 'w').length;
    return `<div class="card" style="padding:10px 12px">
      <div class="between"><div class="grow"><b>${esc(ex.name)}</b> ${en.ss ? '<span class="badge acc">SS</span>' : ''}<div class="small muted">${n}セット${w ? `（うちW-up ${w}）` : ''}</div></div>
      <button class="icon-btn" data-a="tpl-move" data-i="${i}" data-v="-1" ${i === 0 ? 'disabled' : ''} aria-label="上へ">↑</button>
      <button class="icon-btn" data-a="tpl-move" data-i="${i}" data-v="1" ${i === t.entries.length - 1 ? 'disabled' : ''} aria-label="下へ">↓</button>
      <button class="icon-btn" data-a="tpl-del" data-i="${i}" aria-label="削除">×</button></div>
      <div class="row" style="margin-top:6px"><div class="row" style="flex:none"><button class="btn sm" data-a="tpl-sets" data-i="${i}" data-v="-1">−</button><span class="num" style="min-width:56px;text-align:center">${n}セット</span><button class="btn sm" data-a="tpl-sets" data-i="${i}" data-v="1">＋</button></div>
      <span class="small muted" style="margin-left:auto">目標</span><input style="width:56px;padding:6px" inputmode="numeric" data-tf="min" data-i="${i}" value="${en.min ?? ''}" placeholder="下限"><span class="muted">〜</span><input style="width:56px;padding:6px" inputmode="numeric" data-tf="max" data-i="${i}" value="${en.max ?? ''}" placeholder="上限"><span class="small muted">回</span></div></div>`;
  }).join('');
  return {
    back: 'home',
    title: 'メニューを編集',
    actions: `<button class="btn primary sm" data-a="tpl-start" data-id="${t.id}">開始</button>`,
    body: `<label class="f">メニュー名<input data-tf="name" value="${esc(t.name)}"></label>
      ${rows || '<div class="empty">種目がありません</div>'}
      <button class="btn soft block big" data-a="tpl-add">${ICON.plus} 種目を追加</button>
      <p class="small muted">目標回数を入れると、全セットで上限に達した次の回に重量アップを提案します（ダブルプログレッション）。</p>
      <button class="btn danger block" data-a="tpl-remove" data-id="${t.id}" style="margin:10px 0 20px">このメニューを削除</button>`,
  };
};

const SAMPLES = [
  ['Push（胸・肩・三頭）', ['ベンチプレス', 'インクラインダンベルプレス', 'ショルダープレス', 'サイドレイズ', 'トライセプスプッシュダウン'], [6, 10]],
  ['Pull（背中・二頭）', ['デッドリフト', '懸垂', 'ベントオーバーロウ', 'フェイスプル', 'ダンベルカール'], [6, 10]],
  ['Legs（脚・腹）', ['スクワット', 'ルーマニアンデッドリフト', 'レッグプレス', 'レッグカール', 'カーフレイズ', 'アブローラー'], [8, 12]],
];

// ---------------- ツール ----------------
function openTools(target = null) {
  const st = S.settings;
  openSheet(`<h2>ツール</h2>
    <div class="seg" style="margin-bottom:12px"><button class="on" data-a="tool-tab" data-v="plate">プレート計算</button><button data-a="tool-tab" data-v="rm">1RM計算</button></div>
    <div id="tool-plate"><label class="f">目標重量（${unit()}）<input id="pl-w" inputmode="decimal" value="${target ?? ''}" placeholder="例：100"></label>
      <div class="small muted">バー ${L.fmtW(st.bar)}${unit()}・使えるプレート ${st.plates.map(L.fmtW).join(' / ')}（設定で変更）</div>
      <div id="pl-out"></div></div>
    <div id="tool-rm" class="hidden"><div class="row"><label class="f grow">重量<input id="rm-w" inputmode="decimal" placeholder="80"></label><label class="f grow">回数<input id="rm-r" inputmode="numeric" placeholder="8"></label></div><div id="rm-out"></div></div>`);
  const plate = () => {
    const w = L.parseNum($('#pl-w').value);
    const out = $('#pl-out');
    if (!(w > 0)) { out.innerHTML = ''; return; }
    const p = L.platesFor(w, st.bar, st.plates);
    const colors = ['#c92a2a', '#1971c2', '#e8a400', '#2f9e44', '#495057', '#868e96', '#adb5bd'];
    const sorted = [...st.plates].sort((a, b) => b - a);
    const plates = p.side.map((x) => {
      const k = sorted.indexOf(x);
      const h = 40 + (x / sorted[0]) * 70;
      return `<div class="pl" style="height:${h}px;width:${x >= 10 ? 18 : 12}px;background:${colors[Math.min(k, colors.length - 1)]}">${L.fmtW(x)}</div>`;
    }).join('');
    out.innerHTML = `<div class="plates"><div class="barend"></div><div class="sleeve"></div>${plates || '<span class="muted small">プレートなし</span>'}</div>
      <div class="center"><b style="font-size:18px">片側：${p.side.length ? p.side.map(L.fmtW).join(' + ') : 'なし'}</b></div>
      ${p.rest ? `<p class="center bad small">${L.fmtW(p.rest)}${unit()} 足りません（${L.fmtW(p.achieved)}${unit()}になります）</p>` : `<p class="center muted small">合計 ${L.fmtW(p.achieved)}${unit()}</p>`}
      <h3>ウォームアップの目安</h3><div class="small">${L.warmupSets(w, st.bar, st.inc).map((s) => `${L.fmtW(s.w)}${unit()}×${s.r}`).join(' → ') || '—'}</div>`;
  };
  const rm = () => {
    const w = L.parseNum($('#rm-w').value), r = L.parseNum($('#rm-r').value);
    const out = $('#rm-out');
    if (!(w > 0 && r > 0)) { out.innerHTML = ''; return; }
    const one = L.e1rm(w, r);
    out.innerHTML = `<div class="tile" style="margin:6px 0 10px"><div class="k">推定1RM（Epley式）</div><div class="v">${L.fmtW(L.round(one, 0.1))}<small>${unit()}</small></div></div>
      <table class="tbl"><thead><tr><th>%</th><th>重量</th><th>目安回数</th></tr></thead><tbody>${[100, 95, 90, 85, 80, 75, 70, 65, 60, 50].map((p) => `<tr><td>${p}%</td><td><b>${L.fmtW(L.round((one * p) / 100, st.inc))}</b></td><td class="muted">${p === 100 ? 1 : Math.max(1, Math.round(30 * (100 / p - 1)))}回</td></tr>`).join('')}</tbody></table>`;
  };
  $('#pl-w').addEventListener('input', plate);
  $('#rm-w').addEventListener('input', rm);
  $('#rm-r').addEventListener('input', rm);
  plate();
}

// ---------------- 設定 ----------------
VIEWS.settings = () => {
  const s = S.settings;
  const tg = (k, label, desc = '') => `<label class="check"><input type="checkbox" data-sf="${k}" ${s[k] !== false && s[k] ? 'checked' : ''}><span class="grow">${label}${desc ? `<div class="small muted">${desc}</div>` : ''}</span></label>`;
  const bytes = new Blob([JSON.stringify(S)]).size;
  return {
    back: 'home',
    title: '設定',
    body: `<h3>記録</h3><div class="card">
      <div class="row"><label class="f grow">単位<select data-sf="unit"><option value="kg" ${s.unit === 'kg' ? 'selected' : ''}>kg</option><option value="lb" ${s.unit === 'lb' ? 'selected' : ''}>lb</option></select></label>
      <label class="f grow">重量の刻み<input data-sf="inc" inputmode="decimal" value="${s.inc}"></label></div>
      <div class="row"><label class="f grow">既定の休憩（秒）<input data-sf="rest" type="number" inputmode="numeric" value="${s.rest}"></label>
      <label class="f grow">週の目標回数<input data-sf="weeklyGoal" type="number" inputmode="numeric" value="${s.weeklyGoal}"></label></div>
      <label class="f">週の始まり<select data-sf="weekStart"><option value="1" ${s.weekStart === 1 ? 'selected' : ''}>月曜日</option><option value="0" ${s.weekStart === 0 ? 'selected' : ''}>日曜日</option></select></label>
      ${tg('showRpe', 'RPE（きつさ）の欄を表示', '10=限界、8=あと2回できる。提案の判断に使います')}
      ${tg('autoRest', 'セット完了で休憩タイマーを開始')}
      ${tg('sound', '休憩終了の音')}
      ${tg('vibrate', '休憩終了のバイブ')}
      ${tg('notify', '休憩終了を通知（画面を閉じているとき）')}
      ${tg('keepAwake', '記録中は画面を消さない')}
      </div>
      <h3>プレート</h3><div class="card">
      <label class="f">バーの重さ<input data-sf="bar" inputmode="decimal" value="${s.bar}"></label>
      <label class="f">使えるプレート（片側・カンマ区切り）<input data-sf="plates" value="${s.plates.join(', ')}"></label></div>
      <h3>表示</h3><div class="card"><div class="seg">${[['auto', '自動'], ['light', 'ライト'], ['dark', 'ダーク']].map(([k, v]) => `<button class="${s.theme === k ? 'on' : ''}" data-a="theme" data-v="${k}">${v}</button>`).join('')}</div></div>
      <h3>データ（この端末に保存・${Math.round(bytes / 1024)}KB）</h3>
      <div class="list">
        <div class="li" data-a="export-json"><div class="grow"><div class="t">バックアップを書き出す（JSON）</div><div class="s">機種変更や別の端末への移行に</div></div></div>
        <div class="li" data-a="import-json"><div class="grow"><div class="t">バックアップから復元</div><div class="s">現在のデータは置き換えられます</div></div></div>
        <div class="li" data-a="export-csv"><div class="grow"><div class="t">CSVで書き出す</div><div class="s">Excel・スプレッドシートで分析</div></div></div>
        <div class="li" data-a="reset" style="color:var(--bad)"><div class="grow"><div class="t">すべてのデータを削除</div></div></div>
      </div>
      <p class="small muted center" style="margin:16px 0 24px">SetLog2・データはサーバーに送信されません</p>`,
  };
};

function applyTheme() {
  const t = S.settings.theme;
  if (t === 'auto') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', t);
}

// ---------------- イベント ----------------
const A = {};
document.addEventListener('click', (ev) => {
  const el = ev.target.closest('[data-a]');
  if (!el || el.disabled) return;
  const f = A[el.dataset.a];
  if (f) { ev.preventDefault(); f(el, ev); }
});

A['sheet-close'] = () => closeSheet();
A.go = (el) => go(el.dataset.to);
A.back = (el) => go(el.dataset.to);
A.tools = () => openTools();
A['start-empty'] = () => startWorkout();
A.repeat = (el) => {
  const w = S.workouts.find((x) => x.id === el.dataset.id);
  if (w) startWorkout({ name: w.name, entries: w.entries.map((e) => ({ ...e, sets: e.sets.filter((s) => s.done).length ? e.sets.filter((s) => s.done) : e.sets })) }, w.tplId);
};

A.toggle = (el) => {
  const { w, en, idx } = findEntry(el.dataset.e);
  if (!en) return;
  const i = +el.dataset.i;
  const s = en.sets[i];
  if (s.done) { s.done = false; commit(); return; }
  if (!completeSet(w, en, i)) return;
  const isEdit = route().name === 'edit';
  if (!isEdit && S.settings.autoRest) {
    const next = w.entries[idx + 1];
    if (en.ss && next && next.ss === en.ss) {
      toast(`スーパーセット → ${EX[next.exId]?.name || ''}`);
    } else {
      const ex = EX[en.exId];
      const sec = en.rest ?? ex?.rest ?? S.settings.rest;
      const nextSet = en.sets.find((x) => !x.done);
      const ssFirst = en.ss ? w.entries.find((e) => e.ss === en.ss) : null;
      const label = nextSet ? ex?.name : ssFirst && ssFirst.sets.some((x) => !x.done) ? EX[ssFirst.exId]?.name : (next ? EX[next.exId]?.name : '');
      startRest(sec, label || '');
    }
  }
  buzz(30);
  commit();
};
A['use-prev'] = (el) => {
  const { w, en } = findEntry(el.dataset.e);
  if (!en) return;
  const i = +el.dataset.i;
  const ph = placeholders(en, entryContext(w, en))[i].prev;
  if (!ph) return;
  en.sets[i].w = ph.w;
  en.sets[i].r = ph.r;
  commit();
};
A['apply-sug'] = (el) => {
  const { w, en } = findEntry(el.dataset.e);
  const ctx = entryContext(w, en);
  if (!ctx.sug) return;
  let j = 0;
  for (const s of en.sets) {
    if (s.k === 'w' || s.k === 'd') continue;
    const v = ctx.sug.sets[Math.min(j, ctx.sug.sets.length - 1)];
    j++;
    if (s.done) continue;
    s.w = v.w;
    s.r = v.r;
  }
  commit();
};
A['add-set'] = (el) => {
  const { en } = findEntry(el.dataset.e);
  if (!en) return;
  const last = [...en.sets].reverse().find((s) => s.k !== 'w');
  en.sets.push({ w: null, r: null, rpe: null, k: last?.k === 'f' || last?.k === 'd' ? 'n' : 'n', done: false });
  commit();
};
A.warmup = (el) => {
  const { w, en } = findEntry(el.dataset.e);
  if (!en) return;
  const ctx = entryContext(w, en);
  const phs = placeholders(en, ctx);
  const i = en.sets.findIndex((s) => s.k !== 'w');
  const target = i >= 0 ? (en.sets[i].w ?? phs[i].ph?.w) : null;
  if (!(target > 0)) { toast('先に1セット目の重量を入力してください'); return; }
  const ws = L.warmupSets(target, S.settings.bar, ctx.inc);
  if (!ws.length) { toast('ウォームアップ不要の重量です'); return; }
  en.sets = [...ws.map((s) => ({ w: s.w, r: s.r, rpe: null, k: 'w', done: false })), ...en.sets.filter((s) => s.k !== 'w' || s.done)];
  toast(`ウォームアップ${ws.length}セットを追加しました`);
  commit();
};
A['plates-for'] = (el) => {
  const { w, en } = findEntry(el.dataset.e);
  if (!en) return;
  const phs = placeholders(en, entryContext(w, en));
  let k = en.sets.findIndex((s) => !s.done && s.k !== 'w');
  if (k < 0) k = en.sets.findIndex((s) => s.k !== 'w');
  if (k < 0) k = en.sets.length - 1;
  openTools(k >= 0 ? (en.sets[k].w ?? phs[k].ph?.w ?? null) : null);
};
A['set-menu'] = (el) => {
  const { en } = findEntry(el.dataset.e);
  if (!en) return;
  const i = +el.dataset.i;
  const s = en.sets[i];
  openSheet(`<h2>${i + 1}セット目</h2>
    <div class="seg" style="margin-bottom:10px">${Object.entries(L.KIND_NAMES).map(([k, v]) => `<button class="${s.k === k ? 'on' : ''}" data-a="set-kind" data-e="${en.id}" data-i="${i}" data-v="${k}">${v}</button>`).join('')}</div>
    <div class="menu">
      <div class="mi" data-a="set-dup" data-e="${en.id}" data-i="${i}"><span class="ic">⧉</span>このセットを複製</div>
      <div class="mi" data-a="set-drop" data-e="${en.id}" data-i="${i}"><span class="ic">↘</span>ドロップセットを追加（重量−20%）</div>
      <div class="mi danger" data-a="set-del" data-e="${en.id}" data-i="${i}"><span class="ic">×</span>このセットを削除</div></div>`);
};
A['set-kind'] = (el) => {
  const { en } = findEntry(el.dataset.e);
  en.sets[+el.dataset.i].k = el.dataset.v;
  closeSheet();
  commit();
};
A['set-dup'] = (el) => {
  const { en } = findEntry(el.dataset.e);
  const i = +el.dataset.i;
  en.sets.splice(i + 1, 0, { ...en.sets[i], done: false });
  closeSheet();
  commit();
};
A['set-drop'] = (el) => {
  const { w, en } = findEntry(el.dataset.e);
  const i = +el.dataset.i;
  const ctx = entryContext(w, en);
  const base = en.sets[i].w ?? placeholders(en, ctx)[i].ph?.w;
  en.sets.splice(i + 1, 0, { w: base ? L.floorTo(base * 0.8, ctx.inc) : null, r: null, rpe: null, k: 'd', done: false });
  closeSheet();
  commit();
};
A['set-del'] = (el) => {
  const { en } = findEntry(el.dataset.e);
  en.sets.splice(+el.dataset.i, 1);
  closeSheet();
  commit();
};

A['entry-menu'] = (el) => {
  const { w, en, idx } = findEntry(el.dataset.e);
  if (!en) return;
  const ex = EX[en.exId];
  const next = w.entries[idx + 1];
  const linked = en.ss && next && next.ss === en.ss;
  openSheet(`<h2>${esc(ex?.name || '')}</h2><div class="menu">
    <div class="mi" data-a="entry-note" data-e="${en.id}"><span class="ic">📝</span>メモ${en.note ? '（編集）' : ''}</div>
    <div class="mi" data-a="entry-target" data-e="${en.id}"><span class="ic">🎯</span>目標回数${en.min || en.max ? `（${en.min ?? ''}〜${en.max ?? ''}回）` : ''}</div>
    <div class="mi" data-a="entry-rest" data-e="${en.id}"><span class="ic">⏱</span>休憩時間（${L.fmtSec(en.rest ?? ex?.rest ?? S.settings.rest)}）</div>
    <div class="mi" data-a="entry-fill" data-e="${en.id}"><span class="ic">⇩</span>前回の値をすべて入力</div>
    ${next ? `<div class="mi" data-a="entry-ss" data-e="${en.id}"><span class="ic">↕</span>${linked ? 'スーパーセットを解除' : '次の種目とスーパーセットにする'}</div>` : ''}
    <div class="mi" data-a="entry-move" data-e="${en.id}" data-v="-1"><span class="ic">↑</span>上へ移動</div>
    <div class="mi" data-a="entry-move" data-e="${en.id}" data-v="1"><span class="ic">↓</span>下へ移動</div>
    <div class="mi" data-a="entry-replace" data-e="${en.id}"><span class="ic">⇄</span>種目を入れ替え</div>
    <div class="mi" data-a="go" data-to="ex/${en.exId}"><span class="ic">📈</span>種目の記録とグラフ</div>
    <div class="mi danger" data-a="entry-del" data-e="${en.id}"><span class="ic">×</span>この種目を削除</div></div>`);
};
A['entry-note'] = async (el) => {
  const { en } = findEntry(el.dataset.e);
  const v = await promptSheet('メモ', en.note, { multiline: true, placeholder: '例：右肩に違和感、グリップを広めに' });
  if (v === null) return;
  en.note = v.trim();
  commit();
};
A['entry-target'] = (el) => {
  const { en } = findEntry(el.dataset.e);
  openSheet(`<h2>目標回数</h2><p class="small muted">全セットで上限に届いたら、次回は重量アップを提案します。</p>
    <div class="chips">${[[3, 5], [5, 8], [6, 10], [8, 12], [10, 15], [12, 20]].map(([a, b]) => `<button class="chip" data-a="tgt-pick" data-v="${a}-${b}">${a}〜${b}回</button>`).join('')}</div>
    <div class="row"><input id="tg-min" inputmode="numeric" placeholder="下限" value="${en.min ?? ''}"><span>〜</span><input id="tg-max" inputmode="numeric" placeholder="上限" value="${en.max ?? ''}"></div>
    <div class="row" style="margin-top:12px"><button class="btn" id="tg-clear">なし</button><button class="btn primary" id="tg-ok">決定</button></div>`);
  A['tgt-pick'] = (b) => { const [a, c] = b.dataset.v.split('-'); $('#tg-min').value = a; $('#tg-max').value = c; };
  $('#tg-ok').onclick = () => {
    en.min = L.parseNum($('#tg-min').value);
    en.max = L.parseNum($('#tg-max').value);
    if (en.min && en.max && en.min > en.max) [en.min, en.max] = [en.max, en.min];
    closeSheet();
    commit();
  };
  $('#tg-clear').onclick = () => { en.min = en.max = null; closeSheet(); commit(); };
};
A['entry-rest'] = (el) => {
  const { en } = findEntry(el.dataset.e);
  const ex = EX[en.exId];
  openSheet(`<h2>休憩時間</h2><div class="chips" style="flex-wrap:wrap">${[30, 45, 60, 90, 120, 150, 180, 240, 300].map((s) => `<button class="chip ${(en.rest ?? ex?.rest) === s ? 'on' : ''}" data-a="rest-set" data-e="${en.id}" data-v="${s}">${L.fmtSec(s)}</button>`).join('')}</div>
    <label class="check"><input type="checkbox" id="rest-save" checked><span>この種目の既定にする</span></label>`);
};
A['rest-set'] = (el) => {
  const { en } = findEntry(el.dataset.e);
  const v = +el.dataset.v;
  if ($('#rest-save')?.checked && EX[en.exId]) { EX[en.exId].rest = v; en.rest = undefined; delete en.rest; } else en.rest = v;
  closeSheet();
  commit();
};
A['entry-fill'] = (el) => {
  const { w, en } = findEntry(el.dataset.e);
  const phs = placeholders(en, entryContext(w, en));
  en.sets.forEach((s, i) => {
    if (s.done || !phs[i].ph) return;
    if (s.w === null) s.w = phs[i].ph.w;
    if (s.r === null) s.r = phs[i].ph.r;
  });
  closeSheet();
  commit();
};
A['entry-ss'] = (el) => {
  const { w, en, idx } = findEntry(el.dataset.e);
  const next = w.entries[idx + 1];
  if (en.ss && next.ss === en.ss) {
    // 解除：このエントリと次を切り離す
    const g = en.ss;
    const after = w.entries.slice(idx + 1).filter((e) => e.ss === g);
    const nid = L.uid();
    for (const e of after) e.ss = after.length > 1 ? nid : null;
    if (!w.entries.some((e, i) => i < idx && e.ss === g)) en.ss = null;
  } else {
    const g = en.ss || next.ss || L.uid();
    const old = next.ss;
    en.ss = g;
    if (old && old !== g) w.entries.forEach((e) => { if (e.ss === old) e.ss = g; });
    next.ss = g;
  }
  closeSheet();
  commit();
};
A['entry-move'] = (el) => {
  const { w, idx } = findEntry(el.dataset.e);
  const j = idx + +el.dataset.v;
  if (j < 0 || j >= w.entries.length) { closeSheet(); return; }
  [w.entries[idx], w.entries[j]] = [w.entries[j], w.entries[idx]];
  closeSheet();
  commit();
};
A['entry-replace'] = (el) => openPicker('replace', el.dataset.e);
A['entry-del'] = async (el) => {
  const { w, en, idx } = findEntry(el.dataset.e);
  if (en.sets.some((s) => s.done) && !(await confirmSheet(`${EX[en.exId]?.name || 'この種目'}の記録を削除しますか？`, '削除', true))) return;
  w.entries.splice(idx, 1);
  closeSheet();
  commit();
};
A['ex-peek'] = (el) => exPeek(el.dataset.id);

A['pick-add'] = () => openPicker('add');
A['tpl-add'] = () => openPicker('tpl', route().arg);
A['pick-part'] = (el) => { pick.part = el.dataset.v; renderPickList(); };
A['pick-toggle'] = (el) => {
  const id = el.dataset.id;
  if (pick.mode === 'replace') { pickApply([id]); return; }
  const k = pick.sel.indexOf(id);
  if (k >= 0) pick.sel.splice(k, 1);
  else pick.sel.push(id);
  renderPickList();
};
A['pick-done'] = () => pickApply(pick.sel);
A['ex-new-from-pick'] = () => exerciseForm(null, true);
A['ex-new'] = () => exerciseForm(null);

A['rest-add'] = (el) => {
  if (!timer) return;
  const now = Date.now();
  if (timer.end < now) timer.end = now;
  timer.end += +el.dataset.v * 1000;
  timer.total = Math.max(timer.total + +el.dataset.v, 1);
  timer.alerted = timer.end <= now;
  saveTimer(timer);
  updateLive();
};
A['rest-skip'] = () => stopRest();
A['rest-pick'] = () => {
  openSheet(`<h2>休憩タイマー</h2><div class="chips" style="flex-wrap:wrap">${[30, 45, 60, 90, 120, 150, 180, 240, 300].map((s) => `<button class="chip" data-a="rest-start" data-v="${s}">${L.fmtSec(s)}</button>`).join('')}</div>`);
};
A['rest-start'] = (el) => { startRest(+el.dataset.v, timer?.label || ''); closeSheet(); };

A['wo-menu'] = () => {
  openSheet(`<h2>ワークアウト</h2><div class="menu">
    <div class="mi" data-a="rest-pick"><span class="ic">⏱</span>休憩タイマーを開始</div>
    <div class="mi" data-a="tools"><span class="ic">🧮</span>プレート計算・1RM計算</div>
    <div class="mi" data-a="wo-copy"><span class="ic">⧉</span>内容をテキストでコピー</div>
    <div class="mi" data-a="wo-time"><span class="ic">🕒</span>開始時刻を変更</div>
    <div class="mi danger" data-a="discard"><span class="ic">×</span>ワークアウトを破棄</div></div>`);
};
A['wo-copy'] = () => { const w = editing(); if (w) copyText(L.workoutToText(w, EX, unit())); closeSheet(); };
A['wo-time'] = async () => {
  const w = S.active;
  const v = await promptSheet('開始時刻（例 18:30）', L.fmtTime(w.start));
  const m = v && v.match(/^(\d{1,2})[:：](\d{2})$/);
  if (!m) return;
  const d = new Date(w.start);
  d.setHours(+m[1], +m[2], 0, 0);
  if (d.getTime() > Date.now()) d.setDate(d.getDate() - 1);
  w.start = d.getTime();
  commit();
};
A.discard = async () => {
  if (!(await confirmSheet('このワークアウトを破棄しますか？記録は保存されません。', '破棄', true))) return;
  S.active = null;
  stopRest();
  commit();
  go('home');
};
A.finish = () => {
  const w = S.active;
  if (!w) return;
  const st = L.workoutStats(w, EX);
  const undone = w.entries.reduce((n, e) => n + e.sets.filter((s) => !s.done).length, 0);
  if (!st.sets && !w.entries.some((e) => e.sets.some((s) => s.done))) {
    confirmSheet('完了したセットがありません。破棄しますか？', '破棄', true).then((ok) => {
      if (ok) { S.active = null; stopRest(); commit(); go('home'); }
    });
    return;
  }
  const end = Date.now();
  const prs = L.detectPRs([...S.workouts, w], { ...w, end }, EX);
  const tpl = w.tplId && S.templates.find((t) => t.id === w.tplId);
  openSheet(`<h2>ワークアウトを終了</h2>
    <div class="tiles c3"><div class="tile"><div class="k">時間</div><div class="v">${L.fmtDuration(end - w.start, false)}</div></div>
    <div class="tile"><div class="k">セット</div><div class="v">${st.sets}</div></div>
    <div class="tile"><div class="k">ボリューム</div><div class="v">${volShort(st.volume)}</div></div></div>
    ${prs.length ? `<div class="card" style="background:var(--gold-soft);border-color:transparent"><b style="color:var(--gold)">🏆 自己ベスト ${prs.length}件</b>${prs.map((p) => `<div class="small">${esc(EX[p.exId]?.name)} ${L.PR_NAMES[p.type]} ${prFmt(p)}</div>`).join('')}</div>` : ''}
    ${undone ? `<label class="check"><input type="checkbox" id="fin-drop" checked><span>未完了の${undone}セットを削除する</span></label>` : ''}
    ${tpl ? `<label class="check"><input type="checkbox" id="fin-upd"><span>メニュー「${esc(tpl.name)}」を今回の内容で更新</span></label>` : `<label class="check"><input type="checkbox" id="fin-tpl"><span>メニューとして保存</span></label><input id="fin-name" class="hidden" placeholder="メニュー名" value="${esc(w.name || '')}">`}
    <div class="row" style="margin-top:12px"><button class="btn" data-a="sheet-close">続ける</button><button class="btn primary" id="fin-ok">保存して終了</button></div>`);
  $('#fin-tpl')?.addEventListener('change', (e) => $('#fin-name').classList.toggle('hidden', !e.target.checked));
  $('#fin-ok').onclick = () => {
    if ($('#fin-drop')?.checked) for (const e of w.entries) e.sets = e.sets.filter((s) => s.done);
    w.entries = w.entries.filter((e) => e.sets.length);
    w.end = end;
    if ($('#fin-tpl')?.checked) S.templates.push(L.workoutToTemplate(w, $('#fin-name').value.trim() || w.name || 'メニュー'));
    if ($('#fin-upd')?.checked && tpl) { const nt = L.workoutToTemplate(w, tpl.name); tpl.entries = nt.entries; }
    S.workouts.push(w);
    S.active = null;
    stopRest();
    closeSheet();
    flush();
    go('w/' + w.id);
    toast(prs.length ? `お疲れさまでした！自己ベスト${prs.length}件 🏆` : 'お疲れさまでした！', prs.length ? 'pr' : '');
  };
};

A['w-menu'] = (el) => {
  const id = el.dataset.id;
  openSheet(`<div class="menu">
    <div class="mi" data-a="go" data-to="edit/${id}"><span class="ic">✎</span>編集</div>
    <div class="mi" data-a="repeat" data-id="${id}"><span class="ic">↻</span>もう一度行う</div>
    <div class="mi" data-a="w-tpl" data-id="${id}"><span class="ic">☆</span>メニューとして保存</div>
    <div class="mi" data-a="w-copy" data-id="${id}"><span class="ic">⧉</span>テキストでコピー</div>
    ${navigator.share ? `<div class="mi" data-a="w-share" data-id="${id}"><span class="ic">↗</span>共有</div>` : ''}
    <div class="mi danger" data-a="w-del" data-id="${id}"><span class="ic">×</span>削除</div></div>`);
};
const wById = (id) => S.workouts.find((x) => x.id === id);
A['w-copy'] = (el) => { closeSheet(); copyText(L.workoutToText(wById(el.dataset.id), EX, unit())); };
A['w-share'] = (el) => { closeSheet(); navigator.share({ text: L.workoutToText(wById(el.dataset.id), EX, unit()) }).catch(() => {}); };
A['w-tpl'] = async (el) => {
  const w = wById(el.dataset.id);
  const name = await promptSheet('メニュー名', w.name || '');
  if (name === null) return;
  S.templates.push(L.workoutToTemplate(w, name.trim()));
  commit();
  toast('メニューに保存しました');
};
A['w-del'] = async (el) => {
  if (!(await confirmSheet('この記録を削除しますか？', '削除', true))) return;
  S.workouts = S.workouts.filter((x) => x.id !== el.dataset.id);
  commit();
  go('history');
};

A['hist-month'] = (el) => {
  const d = new Date(ui.histMonth);
  d.setDate(1);
  d.setMonth(d.getMonth() + +el.dataset.v);
  ui.histMonth = d.getTime();
  ui.histDay = null;
  render();
};
A['hist-day'] = (el) => { ui.histDay = ui.histDay === el.dataset.v ? null : el.dataset.v; render(); };

A['ex-part'] = (el) => { ui.exPart = el.dataset.v; render(); };
A['ex-metric'] = (el) => { ui.exMetric = el.dataset.v; render(); };
A['ex-more'] = () => { ui.exMore = true; render(); };
A['ex-menu'] = (el) => {
  const ex = EX[el.dataset.id];
  openSheet(`<h2>${esc(ex.name)}</h2><div class="menu">
    <div class="mi" data-a="ex-edit" data-id="${ex.id}"><span class="ic">✎</span>編集</div>
    <div class="mi" data-a="ex-hist" data-id="${ex.id}"><span class="ic">📅</span>この種目を行った日を履歴で見る</div>
    <div class="mi danger" data-a="ex-del" data-id="${ex.id}"><span class="ic">×</span>削除</div></div>`);
};
A['ex-edit'] = (el) => exerciseForm(EX[el.dataset.id]);
A['ex-hist'] = (el) => { ui.histEx = el.dataset.id; ui.histDay = null; closeSheet(); go('history'); };
A['ex-del'] = async (el) => {
  const ex = EX[el.dataset.id];
  const used = S.workouts.some((w) => w.entries.some((e) => e.exId === ex.id)) || S.active?.entries.some((e) => e.exId === ex.id);
  if (used) {
    if (!(await confirmSheet(`「${ex.name}」には記録があります。一覧から非表示にしますか？（記録は残ります）`, '非表示にする'))) return;
    ex.archived = true;
  } else {
    if (!(await confirmSheet(`「${ex.name}」を削除しますか？`, '削除', true))) return;
    S.exercises = S.exercises.filter((x) => x.id !== ex.id);
    S.templates.forEach((t) => { t.entries = t.entries.filter((e) => e.exId !== ex.id); });
  }
  reindex();
  commit();
  go('exercises');
};

A['stat-weeks'] = (el) => { ui.statWeeks = +el.dataset.v; render(); };
A['bw-add'] = () => {
  const v = L.parseNum($('#bw-in').value);
  if (!(v > 0)) { toast('体重を入力してください'); return; }
  const t = L.dayStart(Date.now());
  S.body = S.body.filter((b) => b.t !== t);
  S.body.push({ t, w: v });
  commit();
  toast('記録しました');
};
A['bw-del'] = (el) => { S.body = S.body.filter((b) => b.t !== +el.dataset.t); commit(); };

A['tpl-new'] = () => {
  const t = { id: L.uid(), name: '新しいメニュー', entries: [] };
  S.templates.push(t);
  commit();
  go('tpl/' + t.id);
};
A['tpl-samples'] = () => {
  const byName = Object.fromEntries(S.exercises.map((e) => [e.name, e.id]));
  for (const [name, list, [min, max]] of SAMPLES) {
    S.templates.push({ id: L.uid(), name, entries: list.filter((n) => byName[n]).map((n, i) => ({ exId: byName[n], min: i === 0 ? null : min, max: i === 0 ? null : max, ss: null, sets: i === 0 ? [{ k: 'w' }, { k: 'w' }, { k: 'n' }, { k: 'n' }, { k: 'n' }] : [{ k: 'n' }, { k: 'n' }, { k: 'n' }] })) });
  }
  commit();
  toast('サンプルメニューを追加しました');
};
A['tpl-open'] = (el) => {
  const t = S.templates.find((x) => x.id === el.dataset.id);
  if (!t) return;
  openSheet(`<h2>${esc(t.name)}</h2>
    <div class="list">${t.entries.map((e) => {
      const ex = EX[e.exId];
      const last = L.lastEntryFor(S.workouts, e.exId);
      const best = last ? last.entry.sets.filter(L.isWork).map((s) => L.setText(s, ex?.type || 'weight', unit())).join(', ') : '初めて';
      return `<div class="li" style="cursor:default"><div class="grow"><div class="t">${esc(ex?.name || '削除された種目')}</div><div class="s">${e.sets.length}セット${e.min || e.max ? `・目標${e.min ?? ''}〜${e.max ?? ''}回` : ''}</div><div class="s ellipsis">前回 ${best}</div></div></div>`;
    }).join('') || '<div class="li">種目がありません</div>'}</div>
    <div class="row"><button class="btn" data-a="go" data-to="tpl/${t.id}">編集</button><button class="btn" data-a="tpl-copy" data-id="${t.id}">複製</button><button class="btn primary" data-a="tpl-start" data-id="${t.id}">開始</button></div>`);
};
A['tpl-start'] = (el) => {
  const t = S.templates.find((x) => x.id === el.dataset.id);
  closeSheet();
  startWorkout(t, t.id);
};
A['tpl-copy'] = (el) => {
  const t = S.templates.find((x) => x.id === el.dataset.id);
  S.templates.push({ ...JSON.parse(JSON.stringify(t)), id: L.uid(), name: t.name + '（コピー）' });
  closeSheet();
  commit();
};
const curTpl = () => S.templates.find((x) => x.id === route().arg);
A['tpl-move'] = (el) => {
  const t = curTpl(), i = +el.dataset.i, j = i + +el.dataset.v;
  if (j < 0 || j >= t.entries.length) return;
  [t.entries[i], t.entries[j]] = [t.entries[j], t.entries[i]];
  commit();
};
A['tpl-del'] = (el) => { curTpl().entries.splice(+el.dataset.i, 1); commit(); };
A['tpl-sets'] = (el) => {
  const en = curTpl().entries[+el.dataset.i];
  if (+el.dataset.v > 0) en.sets.push({ k: 'n' });
  else if (en.sets.length > 1) en.sets.pop();
  commit();
};
A['tpl-remove'] = async (el) => {
  if (!(await confirmSheet('このメニューを削除しますか？', '削除', true))) return;
  S.templates = S.templates.filter((x) => x.id !== el.dataset.id);
  commit();
  go('home');
};

A['tool-tab'] = (el) => {
  document.querySelectorAll('[data-a="tool-tab"]').forEach((b) => b.classList.toggle('on', b === el));
  $('#tool-plate').classList.toggle('hidden', el.dataset.v !== 'plate');
  $('#tool-rm').classList.toggle('hidden', el.dataset.v !== 'rm');
};

A.theme = (el) => { S.settings.theme = el.dataset.v; applyTheme(); commit(); };
A['export-json'] = () => {
  flush();
  download(`setlog2-backup-${L.dateKey(Date.now())}.json`, JSON.stringify(S, null, 1), 'application/json');
};
A['export-csv'] = () => download(`setlog2-${L.dateKey(Date.now())}.csv`, '﻿' + L.toCSV(S.workouts, EX), 'text/csv');
A['import-json'] = () => $('#file').click();
$('#file').addEventListener('change', async (e) => {
  const f = e.target.files[0];
  e.target.value = '';
  if (!f) return;
  try {
    const obj = JSON.parse(await f.text());
    if (!obj || !Array.isArray(obj.workouts)) throw new Error('形式が違います');
    const n = L.normalizeState(obj);
    if (!(await confirmSheet(`ワークアウト${n.workouts.length}件・種目${n.exercises.length}件を読み込みます。現在のデータは置き換えられます。`, '復元する', true))) return;
    S = n;
    reindex();
    applyTheme();
    commit();
    toast('復元しました');
  } catch (err) {
    toast('読み込めませんでした：' + err.message);
  }
});
A.reset = async () => {
  if (!(await confirmSheet('すべての記録・メニュー・種目を削除しますか？元に戻せません。', '削除', true))) return;
  S = L.emptyState();
  reindex();
  stopRest();
  applyTheme();
  commit();
  go('home');
};

// 入力欄
document.addEventListener('input', (ev) => {
  const t = ev.target;
  if (t.dataset.f) {
    const { w, en } = findEntry(t.dataset.e);
    if (!en) return;
    const s = en.sets[+t.dataset.i];
    let v = L.parseNum(t.value);
    if (t.dataset.f === 'rpe' && v !== null) v = Math.max(1, Math.min(10, v));
    if (t.dataset.f === 'r' && v !== null) v = Math.max(0, Math.round(v));
    s[t.dataset.f] = v;
    persist();
    updateSummary(w);
  } else if (t.dataset.wf) {
    const w = editing();
    if (!w) return;
    const k = t.dataset.wf;
    if (k === 'name' || k === 'note') w[k] = t.value;
    else if (k === 'start') {
      const d = new Date(t.value).getTime();
      if (Number.isFinite(d)) { const dur = (w.end || d) - w.start; w.start = d; w.end = d + dur; }
    } else if (k === 'mins') {
      const m = L.parseNum(t.value);
      if (m > 0) w.end = w.start + m * 60000;
    }
    persist();
  } else if (t.dataset.tf) {
    const tp = curTpl();
    if (!tp) return;
    if (t.dataset.tf === 'name') tp.name = t.value;
    else tp.entries[+t.dataset.i][t.dataset.tf] = L.parseNum(t.value);
    persist();
  }
});
// 設定・選択
document.addEventListener('change', (ev) => {
  const t = ev.target;
  if (t.dataset.sf) {
    const k = t.dataset.sf;
    const st = S.settings;
    if (t.type === 'checkbox') {
      st[k] = t.checked;
      if (k === 'notify' && t.checked && 'Notification' in window && Notification.permission === 'default') Notification.requestPermission();
    } else if (k === 'unit') {
      if (t.value !== st.unit) {
        confirmSheet(`記録をすべて${t.value}に換算しますか？`, '換算する').then((ok) => {
          if (ok) S = L.convertUnits(S, t.value);
          else S.settings.unit = t.value;
          commit();
        });
        return;
      }
    } else if (k === 'plates') {
      const ps = t.value.split(/[,、\s]+/).map(L.parseNum).filter((x) => x > 0);
      if (ps.length) st.plates = ps.sort((a, b) => b - a);
    } else if (k === 'weekStart') st[k] = +t.value;
    else {
      const v = L.parseNum(t.value);
      if (v !== null && v >= 0) st[k] = v;
    }
    persist();
  } else if (t.dataset.c === 'hist-ex') {
    ui.histEx = t.value;
    render();
  }
});
// Enterで次の欄へ
document.addEventListener('keydown', (ev) => {
  if (ev.key !== 'Enter' || !ev.target.dataset?.f) return;
  ev.preventDefault();
  const all = [...document.querySelectorAll('.set input[data-f]')];
  const i = all.indexOf(ev.target);
  if (all[i + 1]) all[i + 1].focus();
  else ev.target.blur();
});
// 入力欄にフォーカスしたら全選択（すぐ打ち直せるように）
document.addEventListener('focusin', (ev) => {
  if (ev.target.matches?.('.set input')) setTimeout(() => ev.target.select?.(), 0);
});

// ---------------- 起動 ----------------
applyTheme();
render();
if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
