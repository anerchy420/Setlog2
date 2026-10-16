// 画面とイベント処理
import * as L from './logic.js';
import { createBackend, isDemo } from './backend.js';
import { Camera } from './camera.js';
import { VlogPlayer, FILTERS, canExportVideo } from './vlog.js';
import { enablePush, currentPushKey, showLocal, permission, pushSupported, notifSupported, isIOS, isStandalone } from './push.js';

const B = await createBackend();

const st = {
  user: undefined, // undefined=確認中 / null=未ログイン
  profile: undefined,
  logs: [],
  clips: {}, // `${logId}|${from}|${to}` -> clips[]
  lastMsg: {}, // logId -> message
  msgs: {}, // logId -> messages[]
  pushKey: null,
};
const ui = {
  slot: {}, // `${logId}|${date}` -> slot
  calMonth: {}, // logId -> 'YYYY-MM-01'
  vlog: { layout: 'timeline', aspect: '9:16', filter: 'none', names: true, captions: true, clipAudio: true, speed: 1, bgm: null },
};
const subs = new Map();
const A = {}; // data-a="名前" のボタンを押したときの処理
const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const today = () => L.dateKey();
const myInfo = () => ({ name: st.profile?.name || '', emoji: st.profile?.emoji || '🙂', color: st.profile?.color || '#8d99ae', ...(st.profile?.photo ? { photo: st.profile.photo } : {}) });
const logById = (id) => st.logs.find((l) => l.id === id);

window.addEventListener('backend-error', (e) => {
  const m = e.detail?.code === 'permission-denied' ? '権限がありません（ログから外れた可能性があります）' : '通信エラー：' + (e.detail?.message || '');
  toast(m);
});

// ---------------- アイコン ----------------
const svg = (d, fill = 'none') => `<svg viewBox="0 0 24 24" fill="${fill}" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
const I = {
  back: svg('<path d="M15 5l-7 7 7 7"/>'),
  cal: svg('<rect x="3.5" y="5" width="17" height="15.5" rx="3"/><path d="M3.5 10h17M8 3v4M16 3v4"/><path d="M8 14h.01M12 14h.01M16 14h.01M8 17h.01M12 17h.01"/>'),
  share: svg('<path d="M12 15V3M7 8l5-5 5 5"/><path d="M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7"/>'),
  chat: svg('<path d="M4 5h16v11H9l-5 4z"/>', 'currentColor'),
  down: svg('<path d="M6 9l6 6 6-6"/>'),
  heart: svg('<path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z"/>'),
  reply: svg('<path d="M10 8L5 12l5 4"/><path d="M5 12h9a5 5 0 0 1 5 5v1"/>'),
  close: svg('<path d="M6 6l12 12M18 6L6 18"/>'),
  flip: svg('<path d="M4 7h11a4 4 0 0 1 4 4v1"/><path d="M16 4l3 3-3 3"/><path d="M20 17H9a4 4 0 0 1-4-4v-1"/><path d="M8 20l-3-3 3-3"/>'),
  gear: svg('<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1"/>'),
  plus: svg('<path d="M12 5v14M5 12h14"/>'),
  more: svg('<circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/>', 'currentColor'),
  film: svg('<rect x="3" y="5" width="18" height="14" rx="3"/><path d="M10 9.5v5l4-2.5z" fill="currentColor"/>'),
  sound: svg('<path d="M4 9v6h4l5 4V5L8 9z" fill="currentColor"/><path d="M16 9a4 4 0 0 1 0 6M18.5 6.5a8 8 0 0 1 0 11"/>'),
  mute: svg('<path d="M4 9v6h4l5 4V5L8 9z" fill="currentColor"/><path d="M17 9l5 6M22 9l-5 6"/>'),
  left: svg('<path d="M14 6l-6 6 6 6"/>'),
  right: svg('<path d="M10 6l6 6-6 6"/>'),
};

// ---------------- 共通UI ----------------
function av(info, cls = '') {
  info ||= {};
  if (info.photo) return `<span class="av ${cls}" style="background:${esc(info.color || '#ccc')}"><img src="${esc(info.photo)}" alt=""></span>`;
  return `<span class="av ${cls}" style="background:${esc(info.color || '#ccc')}">${esc(info.emoji || '🙂')}</span>`;
}
let toastT;
function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.remove('hidden');
  clearTimeout(toastT);
  toastT = setTimeout(() => el.classList.add('hidden'), 2400);
}
let bannerT;
function banner(html, onTap) {
  const el = $('#banner');
  el.innerHTML = html;
  el.classList.remove('hidden');
  el.onclick = () => { el.classList.add('hidden'); onTap?.(); };
  clearTimeout(bannerT);
  bannerT = setTimeout(() => el.classList.add('hidden'), 9000);
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
  if (!$('#overlay').firstChild) document.body.classList.remove('noscroll');
  if (sheetDone) { const f = sheetDone; sheetDone = null; f(); }
}
$('#backdrop').addEventListener('click', closeSheet);
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (!$('#sheet').classList.contains('hidden')) closeSheet();
  else if (overlay) closeOverlay();
});
function confirmSheet(msg, ok = 'OK', danger = false, desc = '') {
  return new Promise((res) => {
    let v = false;
    openSheet(`<h2>${esc(msg)}</h2>${desc ? `<p class="muted">${esc(desc)}</p>` : ''}<div class="row" style="margin-top:16px">
      <button class="btn" data-a="sheet-close">キャンセル</button><button class="btn ${danger ? 'danger' : 'primary'}" id="cf-ok">${esc(ok)}</button></div>`, () => res(v));
    $('#cf-ok').onclick = () => { v = true; closeSheet(); };
  });
}
async function copyText(t, msg = 'コピーしました') {
  try { await navigator.clipboard.writeText(t); toast(msg); } catch { openSheet(`<h2>コピーしてください</h2><textarea rows="3" readonly>${esc(t)}</textarea>`); }
}
async function shareOrCopy(data) {
  if (navigator.share) {
    try { await navigator.share(data); return; } catch (e) { if (e.name === 'AbortError') return; }
  }
  copyText(data.url || data.text);
}

// ---------------- データ購読 ----------------
function subscribe(key, fn) {
  if (subs.has(key)) return;
  subs.set(key, fn());
}
function unsubscribeAll() {
  for (const u of subs.values()) try { u?.(); } catch { /* 解除済み */ }
  subs.clear();
}
function useClips(logId, from, to = from) {
  const key = `${logId}|${from}|${to}`;
  subscribe('c:' + key, () => B.watchClips(logId, from, to, (cs) => { st.clips[key] = cs; schedule(); }));
  return st.clips[key];
}
function todayClips(logId) { return useClips(logId, today()) || []; }
function useMessages(logId) {
  subscribe('m:' + logId, () => B.watchMessages(logId, (ms) => { st.msgs[logId] = ms; st.lastMsg[logId] = ms[ms.length - 1]; schedule(); }));
  return st.msgs[logId];
}
function postedNow(logId) {
  const s = L.slotOf();
  return todayClips(logId).some((c) => c.slot === s.slot && c.uid === B.uid);
}

// メディア（動画本体）はキャッシュしてObjectURLで使う
const mediaCache = new Map();
function getMedia(logId, clip) {
  const k = logId + '/' + clip.id;
  if (!mediaCache.has(k)) {
    mediaCache.set(k, B.getMedia(logId, clip.id).then((m) => {
      if (!m) return null;
      return fetch(m.data).then((r) => r.blob()).then((b) => ({ ...m, url: URL.createObjectURL(b) }));
    }).catch(() => { mediaCache.delete(k); return null; }));
  }
  return mediaCache.get(k);
}

B.onAuth((u) => {
  unsubscribeAll();
  st.user = u;
  st.profile = undefined;
  st.logs = [];
  st.logsLoaded = false;
  if (u) {
    subscribe('profile', () => B.watchProfile((p) => {
      st.profile = p;
      if (p) syncMyInfo();
      schedule();
    }));
    subscribe('logs', () => B.watchLogs((ls) => {
      st.logs = ls.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
      st.logsLoaded = true;
      syncMyInfo();
      schedule();
    }));
    currentPushKey().then((k) => { st.pushKey = k; });
  }
  schedule();
});

// プロフィールを変えたら、参加中の全ログの表示名も更新
const synced = new Map();
function syncMyInfo() {
  if (!st.profile?.name) return;
  const mine = myInfo();
  const sig = JSON.stringify(mine);
  for (const l of st.logs) {
    const cur = l.info?.[B.uid] || {};
    if (cur.name !== mine.name || cur.emoji !== mine.emoji || cur.color !== mine.color || (cur.photo || '') !== (mine.photo || '')) {
      if (synced.get(l.id) === sig) continue; // 反映待ち
      synced.set(l.id, sig);
      B.setMyInfo(l.id, mine).catch(() => synced.delete(l.id));
    }
  }
}

// ---------------- ルーティングと描画 ----------------
function route() {
  const [name, a, b] = (location.hash.slice(1) || 'home').split('/');
  return { name, a: a ? decodeURIComponent(a) : null, b: b ? decodeURIComponent(b) : null };
}
function go(h) {
  if (location.hash.slice(1) === h) schedule();
  else location.hash = h;
}
window.addEventListener('hashchange', () => {
  closeSheet();
  if (player) { player.stop(); player = null; }
  if (route().name === 'cam') { history.replaceState(null, '', '#home'); openCamera(); }
  render();
  window.scrollTo(0, 0);
});

let rafId = 0;
function schedule() {
  if (rafId) return;
  rafId = requestAnimationFrame(() => { rafId = 0; render(); });
}

const VIEWS = {};
function render() {
  rafId = 0;
  if (player && route().name === 'vlog') return; // 書き出し・プレビュー中は描き直さない
  // 入力中の欄を保つ
  const act = document.activeElement;
  const keep = act?.id && $('#view').contains(act) ? { id: act.id, v: act.value, s: act.selectionStart } : null;
  const pager = $('#pager');
  const pagerX = pager?.scrollLeft;
  const r = route();
  let v;
  if (st.user === undefined) v = { bare: true, body: '<div class="empty" style="padding-top:40vh">読み込み中…</div>' };
  else if (!st.user) v = VIEWS.welcome();
  else if (st.profile === undefined) v = { bare: true, body: '<div class="empty" style="padding-top:40vh">読み込み中…</div>' };
  else if (!st.profile?.name) v = VIEWS.onboard();
  else v = (VIEWS[r.name] || VIEWS.home)(r.a, r.b);
  const top = $('#top');
  top.classList.toggle('hidden', !!v.bare);
  if (!v.bare) top.innerHTML = v.top || '';
  $('#view').innerHTML = v.body;
  if (keep) {
    const el = document.getElementById(keep.id);
    if (el) { el.value = keep.v; el.focus(); try { el.setSelectionRange(keep.s, keep.s); } catch { /* 非対応の欄 */ } }
  }
  const np = $('#pager');
  if (np && pagerX !== undefined && pager) np.scrollLeft = pagerX;
  v.after?.();
  overlay?.update?.();
  document.querySelector('.demo-tag')?.remove();
  if (isDemo && st.user) document.body.insertAdjacentHTML('beforeend', '<div class="demo-tag" data-a="demo-info">デモモード</div>');
  maybeJoinFromLink();
}

// ---------------- はじめに ----------------
VIEWS.welcome = () => ({
  bare: true,
  body: `<div class="welcome">
    <div class="logo">setlog2</div>
    <h1>同じ1日、それぞれの瞬間。</h1>
    <p class="muted" style="margin:0">毎時の通知で2秒だけ撮って、友だちと「今」を見せ合う。1日の終わりにはみんなの瞬間がVlogになります。</p>
    <div class="card">
      <div class="feat"><span class="ic">⏰</span><div><b>1時間に1本、2秒だけ</b><div class="small muted">通知が来たら今の瞬間を撮影。盛らない、ありのまま。</div></div></div>
      <div class="feat" style="margin-top:10px"><span class="ic">👯</span><div><b>最大${L.MAX_MEMBERS}人のログ</b><div class="small muted">同じ時間のみんなを分割画面で。リアクションとチャットも。</div></div></div>
      <div class="feat" style="margin-top:10px"><span class="ic">🎬</span><div><b>Vlogを自動で</b><div class="small muted">縦型・分割・フィルター・BGMを選んで書き出し、そのまま投稿。</div></div></div>
    </div>
    <button class="btn accent big block" data-a="start">はじめる</button>
    ${isDemo ? '<p class="small muted center">デモモード：この端末だけで動きます。架空の友だちが投稿しています。</p>' : '<button class="btn block" data-a="google">Googleでログイン（機種変更しても引き継げる）</button>'}
  </div>`,
});

VIEWS.onboard = () => {
  const p = ui.onb ||= { name: '', emoji: L.AVATAR_EMOJIS[Math.floor(Math.random() * 8)], color: L.COLORS[Math.floor(Math.random() * L.COLORS.length)], photo: null };
  return {
    bare: true,
    body: `<div class="welcome">
      <h1>プロフィール</h1>
      <p class="muted" style="margin:0">ログの中で友だちに表示されます。あとから変えられます。</p>
      <div class="center">${av(p, 'lg')}</div>
      <label class="f">名前<input id="onb-name" maxlength="20" value="${esc(p.name)}" placeholder="例：えんどう" autocomplete="nickname"></label>
      ${avatarPicker(p)}
      <button class="btn accent big block" data-a="onb-done">はじめる</button>
    </div>`,
    after: () => { $('#onb-name').oninput = (e) => { p.name = e.target.value; }; },
  };
};
function avatarPicker(p) {
  return `<div class="opt"><div class="k">アイコン</div><div class="pick">${L.AVATAR_EMOJIS.map((e) => `<button class="${!p.photo && p.emoji === e ? 'on' : ''}" data-a="pick-emoji" data-v="${e}">${e}</button>`).join('')}</div></div>
    <div class="opt"><div class="k">色</div><div class="pick colors">${L.COLORS.map((c) => `<button class="${p.color === c ? 'on' : ''}" style="background:${c}" data-a="pick-color" data-v="${c}" aria-label="色"></button>`).join('')}</div></div>
    <div class="row"><button class="btn sm" data-a="pick-photo">📷 写真にする</button>${p.photo ? '<button class="btn sm" data-a="clear-photo">写真をやめる</button>' : ''}</div>`;
}

// ---------------- ホーム ----------------
VIEWS.home = () => {
  const s = L.slotOf();
  const logs = st.logs;
  const posted = logs.filter((l) => postedNow(l.id));
  const n = L.DEFAULT_NOTIFY;
  const notify = { ...n, ...(st.profile.notify || {}) };
  const active = L.isActiveHour(s.hour, notify.start, notify.end);
  const allDone = logs.length && posted.length === logs.length;
  const streak = L.streakDays(Object.keys(st.profile.posted || {}));
  for (const l of logs) useMessages(l.id);

  let notice = '';
  if (isIOS() && !isStandalone()) {
    notice = `<div class="notice"><span class="ic">📲</span><div class="grow"><b>ホーム画面に追加してください</b><div class="small muted">iPhoneは「共有 → ホーム画面に追加」してから開くと通知が届きます</div></div></div>`;
  } else if (notifSupported() && permission() !== 'granted') {
    notice = `<div class="notice" data-a="enable-notify" style="cursor:pointer"><span class="ic">🔔</span><div class="grow"><b>通知をオンにする</b><div class="small muted">毎時「撮影の時間」をお知らせします</div></div><span class="btn sm primary">オン</span></div>`;
  }

  const cards = logs.map((l) => {
    const cs = todayClips(l.id);
    const now = cs.filter((c) => c.slot === s.slot);
    const last = st.lastMsg[l.id];
    const unread = last && last.uid !== B.uid && last.createdAt > (+localStorage.getItem('read:' + l.id) || 0);
    const thumbs = [...cs].sort((a, b) => b.createdAt - a.createdAt).slice(0, 5);
    const ids = l.members.slice(0, 8);
    return `<div class="logcard" data-a="go" data-to="log/${l.id}">
      <div class="hd"><div class="em" style="background:${esc(l.color)}33">${esc(l.emoji)}</div>
        <div class="grow"><div class="nm ellipsis">${esc(l.name)} ${unread ? '<span class="badge-dot" style="display:inline-block;width:8px;height:8px;border-radius:50%;background:var(--accent);vertical-align:middle"></span>' : ''}</div>
        <div class="small muted">${L.slotLabel(s.slot)}は ${now.length}/${l.members.length}人・今日 ${cs.length}本${last ? '・💬 ' + esc((l.info?.[last.uid]?.name || '') + '：' + (last.text || '動画に返信')).slice(0, 24) : ''}</div></div>
        <div class="avs">${ids.map((u) => av(l.info?.[u], 'sm')).join('')}</div></div>
      ${thumbs.length ? `<div class="strip">${thumbs.map((c) => `<img src="${esc(c.thumb)}" alt="" loading="lazy">`).join('')}${'<span class="ph"></span>'.repeat(Math.max(0, 5 - thumbs.length))}</div>` : ''}
    </div>`;
  }).join('');

  return {
    top: `<div class="title"><span class="logo" style="font-size:28px">setlog2</span></div><button class="circle" data-a="go" data-to="settings" aria-label="設定" style="padding:0">${av(myInfo(), 'md')}</button>`,
    body: `
      <div class="now-card ${allDone ? 'done' : ''}">
        <div class="between"><div><div class="time">${L.slotLabel(s.slot)}</div>
        <div class="sub">${allDone ? `撮影済み・次は ${L.slotLabel(L.pad2((s.hour + 1) % 24))}（あと${L.untilNextSlot()}分）` : `今の瞬間を撮ろう・あと${L.untilNextSlot()}分${!active ? '（通知はお休み中の時間）' : ''}`}</div></div>
        <div style="text-align:right"><div style="font-size:26px;font-weight:900">🔥${streak}</div><div class="sub">連続日数</div></div></div>
        ${logs.length ? `<button class="btn block big" data-a="camera">${allDone ? '📸 もう一度見る・撮る' : `📸 撮影する${posted.length ? `（${posted.length}/${logs.length}ログ済み）` : ''}`}</button>` : ''}
      </div>
      ${notice}
      <div class="between"><h3>ログ</h3><span class="small muted">${logs.length}件</span></div>
      ${cards || `<div class="card empty"><div class="ic">🫶</div><b>まだログがありません</b><p class="small">友だちとログを作るか、招待コードで参加しましょう。</p></div>`}
      <div class="row" style="margin-top:6px"><button class="btn primary" data-a="log-new">＋ ログを作る</button><button class="btn" data-a="join-open">コードで参加</button></div>
      ${logs.length ? `<button class="btn ghost block" style="margin-top:8px" data-a="go" data-to="vlog/me/${today()}">🎬 今日の自分のVlogを作る</button>` : ''}`,
  };
};

// ---------------- ログ（時間ごとの分割画面） ----------------
VIEWS.log = (id, date) => {
  const l = logById(id);
  if (!l) return { top: topBack('home', 'ログ'), body: `<div class="empty">${st.logsLoaded ? 'ログが見つかりません（退出したか、外されました）' : '読み込み中…'}</div>` };
  date ||= today();
  const clips = useClips(id, date) || [];
  const isToday = date === today();
  const now = L.slotOf();
  const slots = L.slotsOfDay(clips, date);
  const key = id + '|' + date;
  if (!ui.slot[key] || !slots.includes(ui.slot[key])) ui.slot[key] = slots[slots.length - 1];
  const sel = ui.slot[key];
  const by = L.groupBySlot(clips);
  const last = st.lastMsg[id] || useMessages(id)?.slice(-1)[0];
  const unread = last && last.uid !== B.uid && last.createdAt > (+localStorage.getItem('read:' + id) || 0);
  const members = [...l.members];
  // 退出した人の投稿も表示
  for (const c of clips) if (!members.includes(c.uid)) members.push(c.uid);

  const pages = slots.map((s) => {
    const cs = by[s] || [];
    const cur = isToday && s === now.slot;
    const cells = members.map((u) => {
      const c = cs.find((x) => x.uid === u);
      const info = l.info?.[u] || { name: '退出した人', emoji: '👋', color: '#999' };
      const who = `<div class="who">${av(info, 'sm')}<span>${esc(info.name)}</span></div>`;
      if (!c) {
        if (u === B.uid && cur) return `<div class="cell me" data-a="camera" data-log="${id}">${who}<span class="wm">${L.slotLabel(s)}</span><span class="shoot">タップして撮影</span></div>`;
        if (!l.members.includes(u)) return '';
        return `<div class="cell">${who}<span class="wm">${L.slotLabel(s)}</span>${cur ? `<button class="poke" data-a="poke" data-log="${id}" data-uid="${u}">👉 つつく</button>` : ''}</div>`;
      }
      const stickers = Object.entries(c.reactions || {}).filter(([, e]) => e).slice(0, 8).map(([ru, e]) => {
        const p = L.stickerPos(c.id + ru);
        return `<span class="sticker" style="left:${p.x}%;top:${p.y}%;transform:rotate(${p.rot}deg)">${esc(e)}</span>`;
      }).join('');
      const mine = c.reactions?.[B.uid] === '❤️';
      return `<div class="cell has" data-a="view" data-log="${id}" data-clip="${c.id}" data-date="${date}">
        <img class="media" src="${esc(c.thumb)}" alt="" loading="lazy">${who}
        <div class="ov"><div class="tm">${L.fmtClock(c.createdAt)}</div>${c.caption ? `<div class="cap">${esc(c.caption)}</div>` : ''}</div>
        ${stickers}
        <div class="acts"><button class="${mine ? 'on' : ''}" data-a="heart" data-log="${id}" data-clip="${c.id}" aria-label="いいね">${I.heart}</button><button data-a="view" data-log="${id}" data-clip="${c.id}" data-date="${date}" data-reply="1" aria-label="返信">${I.reply}</button></div>
        ${c.mime?.startsWith('video') ? '<span class="live">▶</span>' : ''}
      </div>`;
    }).join('');
    const cnt = cs.length;
    return `<section class="page" data-slot="${s}">
      <div class="page-h"><span class="t">${L.slotLabel(s)}</span><span class="small muted">${cur ? `<b style="color:var(--accent)">● 撮影中</b> あと${L.untilNextSlot()}分・` : ''}${cnt}/${l.members.length}人</span></div>
      <div class="grid">${cells}${cur || slots.length === 1 ? `<div class="cell invite" data-a="invite" data-log="${id}"><span class="plus">＋</span>友だちを招待</div>` : ''}</div>
    </section>`;
  }).join('');

  return {
    top: `<button class="circle" data-a="go" data-to="home" aria-label="戻る">${I.back}</button>
      <button class="circle" data-a="go" data-to="cal/${id}" aria-label="カレンダー">${I.cal}</button>
      <button class="picker-pill" data-a="log-switch" data-log="${id}"><span>${esc(l.emoji)} ${esc(l.name)}</span>${I.down.replace('<svg', '<svg width="18" height="18"')}</button>
      <button class="circle" data-a="go" data-to="vlog/${id}/${date}" aria-label="Vlog">${I.share}</button>
      <button class="circle" data-a="go" data-to="chat/${id}" aria-label="チャット">${I.chat}${unread ? '<span class="dot-badge"></span>' : ''}</button>`,
    body: `${!isToday ? `<div class="between" style="margin:2px 4px 8px"><b>${L.fmtDateKey(date, true)}</b><button class="btn sm" data-a="go" data-to="log/${id}">今日へ</button></div>` : ''}
      ${slots.length ? `<div class="dots">${slots.map((s) => `<button class="${s === sel ? 'on' : ''} ${(by[s] || []).some((c) => c.uid === B.uid) ? 'mine' : ''}" data-a="slot" data-key="${key}" data-v="${s}" aria-label="${L.slotLabel(s)}"></button>`).join('')}</div>
      <div class="pager" id="pager">${pages}</div>` : `<div class="empty"><div class="ic">🌙</div>この日の投稿はありません</div>`}
      <div class="row" style="margin-top:14px"><button class="btn sm" data-a="go" data-to="logset/${id}">${I.gear.replace('<svg', '<svg width="16" height="16"')} ログの設定</button><button class="btn sm" data-a="invite" data-log="${id}">＋ 招待</button></div>`,
    after: () => {
      const pg = $('#pager');
      if (!pg) return;
      const idx = slots.indexOf(sel);
      if (ui.lastPagerKey !== key) { pg.scrollLeft = idx * pg.clientWidth; ui.lastPagerKey = key; }
      let t;
      pg.onscroll = () => {
        clearTimeout(t);
        t = setTimeout(() => {
          const i = Math.round(pg.scrollLeft / pg.clientWidth);
          if (slots[i] && slots[i] !== ui.slot[key]) {
            ui.slot[key] = slots[i];
            document.querySelectorAll('.dots button').forEach((b, k) => b.classList.toggle('on', k === i));
            attachVideos(id, pg.children[i]);
          }
        }, 90);
      };
      attachVideos(id, pg.children[Math.max(0, slots.indexOf(ui.slot[key]))]);
    },
  };
};
function topBack(to, title) {
  return `<button class="circle" data-a="go" data-to="${to}" aria-label="戻る">${I.back}</button><div class="title"><h2 class="ellipsis">${title}</h2></div>`;
}

// 表示中のページの動画を再生（同じ動画は要素を使い回して途切れない）
const videoEls = new Map();
function attachVideos(logId, page) {
  if (!page) return;
  const all = st.clips;
  page.querySelectorAll('.cell.has[data-clip]').forEach(async (cell) => {
    const id = cell.dataset.clip;
    const clip = Object.values(all).flat().find((c) => c.id === id);
    if (!clip?.mime?.startsWith('video')) return;
    const k = logId + '/' + id;
    let v = videoEls.get(k);
    if (!v) {
      const m = await getMedia(logId, clip);
      if (!m) return;
      v = document.createElement('video');
      Object.assign(v, { muted: true, loop: true, autoplay: true, playsInline: true, src: m.url });
      v.className = 'media';
      v.setAttribute('playsinline', '');
      videoEls.set(k, v);
    }
    if (!cell.isConnected) return;
    const img = cell.querySelector('img.media');
    if (img) img.replaceWith(v);
    else if (!cell.contains(v)) cell.prepend(v);
    v.play().catch(() => {});
  });
}

// ---------------- カメラ ----------------
let overlay = null;
function closeOverlay() {
  overlay?.close?.();
  overlay = null;
  $('#overlay').innerHTML = '';
  document.body.classList.remove('noscroll');
  schedule();
}

async function openCamera(logId = null) {
  if (!st.logs.length) { toast('先にログを作るか参加してください'); return; }
  const s0 = L.slotOf();
  // 投稿先：開いたログ（ホームからなら、まだ撮っていない全ログ）
  const sel = new Set(logId ? [logId] : st.logs.filter((l) => !postedNow(l.id)).map((l) => l.id));
  if (!sel.size && logId === null) st.logs.forEach((l) => sel.add(l.id));
  let shot = null, cam = null, state = 'live', slot = s0;
  const root = $('#overlay');
  document.body.classList.add('noscroll');
  root.innerHTML = `<div class="full" id="camui">
    <div class="bar"><button class="circle" data-a="cam-close" aria-label="閉じる">${I.close}</button><div class="grow center"><b id="cam-slot" style="font-size:18px">${L.slotLabel(slot.slot)}</b><div class="small" style="opacity:.75">あと${L.untilNextSlot()}分</div></div><button class="circle" data-a="cam-flip" aria-label="カメラ切替">${I.flip}</button></div>
    <div class="stage"><div class="frame" id="cam-frame"><video id="cam-v" playsinline muted></video><div class="cam-hint hidden" id="cam-hint">📱 横向きにすると全体が写ります</div><div class="cam-time hidden" id="cam-count"></div></div></div>
    <div class="bottom" id="cam-bottom"></div></div>`;
  const vEl = $('#cam-v');
  cam = new Camera(vEl);
  const bottom = $('#cam-bottom');

  const drawBottom = () => {
    if (state === 'live' || state === 'rec') {
      bottom.innerHTML = `<div class="center small" style="opacity:.8;margin-bottom:10px">${L.CLIP_SECONDS}秒の動画を撮ります・送る前なら撮り直せます</div>
        <div class="center"><button class="shutter ${state === 'rec' ? 'rec' : ''}" data-a="cam-shoot" aria-label="撮影"><svg viewBox="0 0 78 78"><circle cx="39" cy="39" r="36" fill="none" stroke="var(--accent)" stroke-width="5" stroke-dasharray="226" stroke-dashoffset="226" id="cam-ring"/></svg><i></i></button></div>`;
    } else {
      const posted = (lid) => todayClips(lid).some((c) => c.slot === slot.slot && c.uid === B.uid);
      bottom.innerHTML = `<input id="cam-cap" maxlength="30" placeholder="ひとこと（なくてもOK）" enterkeyhint="send" value="${esc(shot?.caption || '')}">
        <div class="dest">${st.logs.map((l) => posted(l.id) ? `<button class="off" disabled>${esc(l.emoji)} ${esc(l.name)}・投稿済み</button>` : `<button class="${sel.has(l.id) ? 'on' : ''}" data-a="cam-dest" data-log="${l.id}">${sel.has(l.id) ? '✓ ' : ''}${esc(l.emoji)} ${esc(l.name)}</button>`).join('')}</div>
        <div class="row"><button class="btn" data-a="cam-retake">撮り直す</button><button class="btn light" data-a="cam-send" ${state === 'sending' ? 'disabled' : ''}>${state === 'sending' ? '送信中…' : `送る（${[...sel].filter((x) => !posted(x)).length}）`}</button></div>`;
      $('#cam-cap').oninput = (e) => { shot.caption = e.target.value; };
      $('#cam-cap').onkeydown = (e) => { if (e.key === 'Enter') A['cam-send'](); };
    }
  };
  const startLive = async () => {
    state = 'live';
    const fr = $('#cam-frame');
    fr.querySelector('.review')?.remove();
    vEl.classList.remove('hidden');
    drawBottom();
    try {
      await cam.start();
      setTimeout(() => $('#cam-hint')?.classList.toggle('hidden', !cam.portrait), 600);
    } catch (e) {
      bottom.innerHTML = `<p class="center">カメラを使えませんでした。<br><span class="small" style="opacity:.8">${e.name === 'NotAllowedError' ? 'ブラウザの設定でカメラ（とマイク）を許可してください。' : esc(e.message || e.name)}</span></p><button class="btn block" data-a="cam-close">閉じる</button>`;
    }
  };
  overlay = {
    close: () => cam?.stopStream(),
    update: () => { if (state === 'review') drawBottom(); },
  };
  A['cam-close'] = closeOverlay;
  A['cam-flip'] = () => { if (state === 'live') cam.flip().catch(() => toast('切り替えできませんでした')); };
  A['cam-shoot'] = async () => {
    if (state !== 'live') return;
    slot = L.slotOf();
    $('#cam-slot').textContent = L.slotLabel(slot.slot);
    state = 'rec';
    drawBottom();
    const ring = $('#cam-ring');
    try {
      const r = await cam.record(L.CLIP_SECONDS, (p) => { ring?.setAttribute('stroke-dashoffset', String(226 * (1 - p))); });
      shot = { ...r, caption: '', recordedAt: Date.now(), slot };
      cam.stopStream();
      state = 'review';
      const fr = $('#cam-frame');
      vEl.classList.add('hidden');
      $('#cam-hint')?.classList.add('hidden');
      const el = r.kind === 'video' ? Object.assign(document.createElement('video'), { src: r.data, loop: true, autoplay: true, playsInline: true, muted: false, className: 'review' }) : Object.assign(document.createElement('img'), { src: r.data, className: 'review' });
      fr.appendChild(el);
      el.play?.().catch(() => { el.muted = true; el.play().catch(() => {}); });
      drawBottom();
    } catch (e) {
      toast(e.message || '撮影に失敗しました');
      state = 'live';
      drawBottom();
    }
  };
  A['cam-retake'] = () => { shot = null; startLive(); };
  A['cam-dest'] = (el) => { const id = el.dataset.log; if (sel.has(id)) sel.delete(id); else sel.add(id); drawBottom(); };
  A['cam-send'] = async () => {
    if (state !== 'review' || !shot) return;
    const targets = [...sel].filter((lid) => !todayClips(lid).some((c) => c.slot === shot.slot.slot && c.uid === B.uid));
    if (!targets.length) { toast('投稿先のログを選んでください'); return; }
    state = 'sending';
    drawBottom();
    const now = L.slotOf();
    const ontime = shot.recordedAt - new Date(shot.recordedAt).setMinutes(0, 0, 0) < 10 * 60e3;
    const clip = { date: shot.slot.date, slot: shot.slot.slot, caption: L.cleanName(shot.caption, 30), thumb: shot.thumb, mime: shot.mime, ontime, recordedAt: shot.recordedAt };
    let ok = 0;
    for (const lid of targets) {
      try { await B.postClip(lid, clip, { data: shot.data, mime: shot.mime }); ok++; } catch (e) { toast(e.message || '送信に失敗しました'); }
    }
    if (ok) {
      B.saveProfile({ posted: { ...(st.profile.posted || {}), [clip.date]: true } }).catch(() => {});
      toast(now.slot !== clip.slot ? `${L.slotLabel(clip.slot)}の枠に投稿しました` : `${ok}つのログに投稿しました`);
      closeOverlay();
      if (targets.length === 1) go('log/' + targets[0]);
    } else {
      state = 'review';
      drawBottom();
    }
  };
  startLive();
}

// ---------------- 動画を見る・リアクション ----------------
function openViewer(logId, clipId, date, focusReply = false) {
  const l = logById(logId);
  const findClips = () => (st.clips[`${logId}|${date}|${date}`] || []);
  let clip = findClips().find((c) => c.id === clipId);
  if (!l || !clip) return;
  document.body.classList.add('noscroll');
  const root = $('#overlay');
  let soundOn = true;
  const show = async () => {
    clip = findClips().find((c) => c.id === clipId) || clip;
    const info = l.info?.[clip.uid] || {};
    const same = findClips().filter((c) => c.slot === clip.slot).sort((a, b) => l.members.indexOf(a.uid) - l.members.indexOf(b.uid));
    const i = same.findIndex((c) => c.id === clip.id);
    const summary = L.reactionSummary(clip.reactions);
    const mineR = clip.reactions?.[B.uid];
    const frameExists = root.querySelector('#vw-frame')?.dataset.clip === clip.id;
    if (!frameExists) {
      root.innerHTML = `<div class="full" id="vw">
        <div class="bar"><button class="circle" data-a="vw-close" aria-label="閉じる">${I.close}</button>
          <div class="grow row" style="gap:8px">${av(info, 'md')}<div class="grow"><b class="ellipsis" style="display:block">${esc(info.name || '')}</b><span class="small" style="opacity:.75">${L.slotLabel(clip.slot)}の枠・${L.fmtClock(clip.createdAt)}${clip.ontime ? ' ⚡すぐ撮影' : ''}</span></div></div>
          <button class="circle" data-a="vw-more" aria-label="メニュー">${I.more}</button></div>
        <div class="stage"><div class="frame" id="vw-frame" data-clip="${clip.id}"><img src="${esc(clip.thumb)}" alt=""></div>
          ${i > 0 ? `<button class="circle" style="position:absolute;left:14px" data-a="vw-go" data-v="${same[i - 1].id}" aria-label="前">${I.left}</button>` : ''}
          ${i < same.length - 1 ? `<button class="circle" style="position:absolute;right:14px" data-a="vw-go" data-v="${same[i + 1].id}" aria-label="次">${I.right}</button>` : ''}
        </div>
        <div class="bottom" id="vw-bottom"></div></div>`;
      const m = await getMedia(logId, clip);
      const fr = $('#vw-frame');
      if (m && fr?.dataset.clip === clip.id) {
        if (m.mime.startsWith('video')) {
          const v = Object.assign(document.createElement('video'), { src: m.url, loop: true, autoplay: true, playsInline: true, muted: !soundOn });
          fr.innerHTML = '';
          fr.appendChild(v);
          fr.insertAdjacentHTML('beforeend', `<button class="circle" style="position:absolute;right:10px;bottom:10px" data-a="vw-sound">${soundOn ? I.sound : I.mute}</button>`);
          v.play().catch(() => { v.muted = true; soundOn = false; v.play().catch(() => {}); });
        } else fr.innerHTML = `<img src="${esc(m.url)}" alt="">`;
      }
    }
    const bottom = $('#vw-bottom');
    if (!bottom) return;
    const keep = document.activeElement?.id === 'vw-reply' ? $('#vw-reply').value : null;
    bottom.innerHTML = `${clip.caption ? `<div style="font-weight:800;font-size:17px;margin-bottom:6px">${esc(clip.caption)}</div>` : ''}
      <div class="react-bar">${['❤️', ...L.REACTIONS].map((e) => `<button class="${mineR === e ? 'on' : ''}" data-a="vw-react" data-v="${e}">${e}</button>`).join('')}</div>
      ${summary.length ? `<div class="reacted">${summary.map((r) => `<span>${r.emoji} ${r.uids.map((u) => esc(l.info?.[u]?.name || '?')).join('、')}</span>`).join('')}</div>` : '<div class="small" style="opacity:.6">スタンプでリアクションしよう</div>'}
      <div class="row" style="margin-top:10px"><input id="vw-reply" placeholder="${esc(info.name || '')}に返信…" enterkeyhint="send" maxlength="300"><button class="btn light" data-a="vw-send" style="flex:none">送信</button></div>`;
    const inp = $('#vw-reply');
    if (keep !== null) { inp.value = keep; inp.focus(); }
    inp.onkeydown = (e) => { if (e.key === 'Enter' && !e.isComposing) A['vw-send'](); };
    if (focusReply) { focusReply = false; setTimeout(() => inp.focus(), 100); }
  };
  overlay = { update: show, close: () => {} };
  A['vw-close'] = closeOverlay;
  A['vw-go'] = (el) => { clipId = el.dataset.v; clip = findClips().find((c) => c.id === clipId); show(); };
  A['vw-sound'] = (el) => {
    const v = $('#vw-frame video');
    if (!v) return;
    soundOn = !soundOn;
    v.muted = !soundOn;
    el.innerHTML = soundOn ? I.sound : I.mute;
  };
  A['vw-react'] = (el) => {
    const e = el.dataset.v;
    const cur = clip.reactions?.[B.uid];
    B.react(logId, clip.id, cur === e ? null : e).catch((er) => toast(er.message));
    navigator.vibrate?.(15);
  };
  A['vw-send'] = () => {
    const t = $('#vw-reply').value.trim();
    if (!t) return;
    B.sendMessage(logId, { text: t, clip: { id: clip.id, date: clip.date, slot: clip.slot, uid: clip.uid, thumb: clip.thumb } }).then(() => toast('返信しました')).catch((e) => toast(e.message));
    $('#vw-reply').value = '';
  };
  A['vw-more'] = () => {
    const own = clip.uid === B.uid;
    openSheet(`<div class="menu">
      <div class="mi" data-a="vw-save"><span class="ic">⬇️</span>この動画を保存</div>
      <div class="mi" data-a="vw-chat"><span class="ic">💬</span>チャットを開く</div>
      ${own ? '<div class="mi danger" data-a="vw-del"><span class="ic">🗑</span>自分の投稿を削除</div>' : ''}</div>`);
  };
  A['vw-save'] = async () => {
    closeSheet();
    const m = await getMedia(logId, clip);
    if (!m) return;
    const ext = m.mime.includes('mp4') ? 'mp4' : m.mime.includes('webm') ? 'webm' : 'jpg';
    const a = Object.assign(document.createElement('a'), { href: m.url, download: `setlog_${clip.date}_${clip.slot}00.${ext}` });
    a.click();
  };
  A['vw-chat'] = () => { closeSheet(); closeOverlay(); go('chat/' + logId); };
  A['vw-del'] = async () => {
    if (!(await confirmSheet('この投稿を削除しますか？', '削除', true, '削除すると、この時間に撮り直すことはできます。'))) return;
    await B.deleteClip(logId, clip.id);
    mediaCache.delete(logId + '/' + clip.id);
    videoEls.delete(logId + '/' + clip.id);
    closeOverlay();
    toast('削除しました');
  };
  show();
}

// ---------------- カレンダー ----------------
const dayInfoCache = new Map();
VIEWS.cal = (id) => {
  const l = logById(id);
  if (!l) return VIEWS.home();
  const m0 = ui.calMonth[id] || today().slice(0, 8) + '01';
  const d0 = new Date(L.parseDateKey(m0));
  const y = d0.getFullYear(), mo = d0.getMonth();
  const days = new Date(y, mo + 1, 0).getDate();
  const off = (d0.getDay() + 6) % 7;
  const t = today();
  let cells = '月火水木金土日'.split('').map((w) => `<div class="wd">${w}</div>`).join('');
  for (let i = 0; i < off; i++) cells += '<div class="d out"></div>';
  const pending = [];
  let monthTotal = 0, monthDays = 0;
  for (let d = 1; d <= days; d++) {
    const k = `${y}-${L.pad2(mo + 1)}-${L.pad2(d)}`;
    const future = k > t;
    const ck = id + '|' + k;
    const info = dayInfoCache.get(ck);
    if (!future && !info && k !== t) pending.push(k);
    const live = k === t ? (() => { const cs = todayClips(id); return { count: cs.length, mine: cs.filter((c) => c.uid === B.uid).length, cover: cs[cs.length - 1]?.thumb }; })() : info;
    if (live?.count) { monthTotal += live.count; monthDays++; }
    cells += `<div class="d ${live?.count ? 'has' : ''} ${k === t ? 'today' : ''} ${future ? 'future' : ''}" ${future ? '' : `data-a="go" data-to="log/${id}/${k}"`}>
      ${live?.cover ? `<img src="${esc(live.cover)}" alt="" loading="lazy">` : ''}<span class="n">${d}</span>${live?.count ? `<span class="c">${live.count}</span>` : ''}${live?.mine ? '<span class="me"></span>' : ''}</div>`;
  }
  return {
    top: topBack('log/' + id, `${esc(l.emoji)} ${esc(l.name)}`),
    body: `<div class="tiles"><div class="tile"><div class="k">連続（自分）</div><div class="v">🔥${L.streakDays(Object.keys(st.profile.posted || {}))}</div></div>
      <div class="tile"><div class="k">${mo + 1}月の投稿</div><div class="v">${monthTotal}</div></div><div class="tile"><div class="k">記録した日</div><div class="v">${monthDays}</div></div></div>
      <div class="card"><div class="between" style="margin-bottom:10px"><button class="circle" data-a="cal-month" data-log="${id}" data-v="-1" aria-label="前の月">${I.left}</button><b style="font-size:17px">${y}年${mo + 1}月</b><button class="circle" data-a="cal-month" data-log="${id}" data-v="1" aria-label="次の月" ${`${y}-${L.pad2(mo + 1)}` >= t.slice(0, 7) ? 'disabled' : ''}>${I.right}</button></div>
      <div class="cal">${cells}</div><p class="small muted" style="margin:10px 0 0">数字はその日の投稿数、<span style="color:var(--accent)">●</span>は自分が投稿した日。日付をタップするとその日の記録とVlogが見られます。</p></div>`,
    after: () => {
      if (!pending.length) return;
      Promise.all(pending.map((k) => B.dayInfo(id, k).then((r) => dayInfoCache.set(id + '|' + k, r)).catch(() => dayInfoCache.set(id + '|' + k, { count: 0 })))).then(() => { if (route().name === 'cal') schedule(); });
    },
  };
};

// ---------------- チャット ----------------
VIEWS.chat = (id) => {
  const l = logById(id);
  if (!l) return VIEWS.home();
  const ms = useMessages(id);
  const last = ms?.[ms.length - 1];
  if (last) localStorage.setItem('read:' + id, String(Math.max(last.createdAt, +localStorage.getItem('read:' + id) || 0)));
  let prevDay = '';
  const items = (ms || []).map((m) => {
    const me = m.uid === B.uid;
    const info = l.info?.[m.uid] || { name: '退出した人', emoji: '👋' };
    const day = L.dateKey(m.createdAt);
    const sep = day !== prevDay ? `<div class="daysep">${L.fmtDateKey(day)}</div>` : '';
    prevDay = day;
    const ref = m.clip ? `<div class="ref" data-a="chat-clip" data-log="${id}" data-clip="${esc(m.clip.id)}" data-date="${esc(m.clip.date)}"><img src="${esc(m.clip.thumb)}" alt=""><span>${L.slotLabel(m.clip.slot)}・${esc(l.info?.[m.clip.uid]?.name || '')}の動画へ</span></div>` : '';
    return `${sep}<div class="msg ${me ? 'me' : ''}" ${me ? `data-a="msg-menu" data-log="${id}" data-id="${m.id}"` : ''}>${me ? '' : av(info, 'sm')}<div>${me ? '' : `<div class="nm">${esc(info.name)}</div>`}<div class="bub">${ref}${esc(m.text || '')}</div></div><span class="meta">${L.fmtClock(m.createdAt)}</span></div>`;
  }).join('');
  return {
    top: topBack('log/' + id, `💬 ${esc(l.name)}`),
    body: `<div class="chat" id="chat">${items || '<div class="empty"><div class="ic">💬</div>まだメッセージはありません</div>'}</div>
      <div class="composer"><input id="chat-in" placeholder="メッセージ" enterkeyhint="send" maxlength="500" autocomplete="off"><button class="btn primary" data-a="chat-send" data-log="${id}" style="flex:none">送信</button></div>`,
    after: () => {
      const inp = $('#chat-in');
      inp.onkeydown = (e) => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); A['chat-send']({ dataset: { log: id } }); } };
      if (ui.chatCount !== (ms || []).length || ui.chatId !== id) { window.scrollTo(0, document.body.scrollHeight); ui.chatCount = (ms || []).length; ui.chatId = id; }
    },
  };
};

// ---------------- Vlog ----------------
VIEWS.vlog = (id, date) => {
  date ||= today();
  const isMe = id === 'me';
  const l = isMe ? null : logById(id);
  if (!isMe && !l) return VIEWS.home();
  const o = ui.vlog;
  if (isMe && o.layout !== 'me') o.layout = 'me';
  if (!isMe && o.layout === 'me') o.layout = 'timeline';
  let clips = [];
  let loading = false;
  if (isMe) {
    for (const lg of st.logs) {
      const cs = useClips(lg.id, date);
      if (!cs) loading = true;
      for (const c of cs || []) if (c.uid === B.uid) clips.push({ ...c, logId: lg.id });
    }
    // 複数のログに同じ枠を投稿していれば1本に
    const seen = new Set();
    clips = clips.filter((c) => (seen.has(c.slot) ? false : seen.add(c.slot)));
  } else {
    const cs = useClips(id, date);
    if (!cs) loading = true;
    clips = (cs || []).map((c) => ({ ...c, logId: id }));
  }
  const segs = L.vlogSegments(clips, { layout: o.layout, uid: B.uid, order: l?.members || [B.uid] });
  const dur = Math.round(L.vlogDuration(segs, o.speed));
  const opt = (k, list) => `<div class="seg">${list.map(([v, n]) => `<button class="${String(o[k]) === String(v) ? 'on' : ''}" data-a="vopt" data-k="${k}" data-v="${v}">${n}</button>`).join('')}</div>`;
  const canExport = canExportVideo();
  ui.vlogCtx = { id, date, clips, segs, l };
  return {
    top: topBack(isMe ? 'home' : 'log/' + id + (date !== today() ? '/' + date : ''), `🎬 ${isMe ? '自分のVlog' : esc(l.name) + 'のVlog'}`),
    body: `<div class="between" style="margin:2px 4px 10px"><b>${L.fmtDateKey(date, true)}</b><span class="small muted">${clips.length}本・約${dur}秒</span></div>
      <div class="vlog-stage" id="vl-stage"><canvas id="vl-canvas"></canvas>${clips.length ? '<button class="play" data-a="vl-preview" aria-label="プレビュー">▶</button>' : ''}</div>
      <div class="prog hidden" id="vl-prog"><i></i></div>
      <div id="vl-status" class="small muted center"></div>
      ${!clips.length ? `<div class="empty">${loading ? '読み込み中…' : 'この日の動画はまだありません'}</div>` : ''}
      ${isMe ? '' : `<div class="opt"><div class="k">並べ方</div>${opt('layout', [['timeline', '時刻順に1人ずつ'], ['grid', '同じ時刻を分割']])}</div>`}
      <div class="opt"><div class="k">画面の形</div>${opt('aspect', [['9:16', '縦（リール・TikTok）'], ['16:9', '横'], ['1:1', '正方形']])}</div>
      <div class="opt"><div class="k">フィルター</div><div class="chips">${Object.entries(FILTERS).map(([k, f]) => `<button class="chip ${o.filter === k ? 'on' : ''}" data-a="vopt" data-k="filter" data-v="${k}">${f.name}</button>`).join('')}</div></div>
      <div class="opt"><div class="k">速さ</div>${opt('speed', [[1, '1倍'], [1.5, '1.5倍'], [2, '2倍']])}</div>
      <div class="card" style="padding:4px 16px">
        <label class="check"><span class="grow">名前を表示</span><input type="checkbox" class="switch" data-vk="names" ${o.names ? 'checked' : ''}></label>
        <label class="check"><span class="grow">ひとことを表示</span><input type="checkbox" class="switch" data-vk="captions" ${o.captions ? 'checked' : ''}></label>
        <label class="check"><span class="grow">動画の音を入れる</span><input type="checkbox" class="switch" data-vk="clipAudio" ${o.clipAudio ? 'checked' : ''}></label>
        <div class="check" data-a="vl-bgm"><span class="grow">BGM<div>${o.bgm ? esc(o.bgm.name) : '端末の音楽ファイルを選ぶ（任意）'}</div></span><span class="btn sm">${o.bgm ? '変更' : '選ぶ'}</span></div>
      </div>
      ${canExport ? `<button class="btn accent big block" data-a="vl-export" ${clips.length ? '' : 'disabled'}>動画を書き出す</button><p class="small muted center">書き出し中は画面を開いたままにしてください（約${dur}秒）</p>` : '<p class="card small">このブラウザは動画の書き出しに対応していません（Chrome / Safari の最新版でお試しください）。プレビューは見られます。</p>'}
      <div id="vl-result">${vlogResultHtml(id, date)}</div>`,
    after: () => {
      drawVlogPoster();
      if (ui.vlogScroll && $('#vl-result video')) { ui.vlogScroll = false; $('#vl-result').scrollIntoView({ behavior: 'smooth' }); }
    },
  };
};
let player = null;
function vlogOpts() {
  const { segs, l, date, id } = ui.vlogCtx;
  const info = l ? l.info : { [B.uid]: myInfo() };
  const total = ui.vlogCtx.clips.length;
  const people = new Set(ui.vlogCtx.clips.map((c) => c.uid)).size;
  return {
    ...ui.vlog, segments: segs, info, order: l?.members || [B.uid], date, color: l?.color || myInfo().color,
    title: l ? l.name : `${myInfo().name}の1日`, emoji: l ? l.emoji : myInfo().emoji, stats: l ? `${people}人・${total}本の瞬間` : `${total}本の瞬間`, id,
  };
}
async function loadVlogMedia() {
  const media = new Map();
  await Promise.all(ui.vlogCtx.clips.map(async (c) => {
    const m = await getMedia(c.logId, c);
    if (m) media.set(c.id, { mime: m.mime, data: m.url });
  }));
  return media;
}
function drawVlogPoster() {
  const cv = $('#vl-canvas');
  if (!cv) return;
  const p = new VlogPlayer(cv);
  p.prepare({ ...vlogOpts(), media: new Map(), segments: [] }).catch(() => {});
}
async function runVlog(record) {
  if (player) { player.stop(); return; }
  const cv = $('#vl-canvas');
  const prog = $('#vl-prog'), status = $('#vl-status');
  prog.classList.remove('hidden');
  $('#vl-stage .play')?.classList.add('hidden');
  status.textContent = '動画を読み込み中…';
  player = new VlogPlayer(cv);
  try {
    const media = await loadVlogMedia();
    await player.prepare({ ...vlogOpts(), media, onLoad: (p) => { prog.firstChild.style.width = p * 100 + '%'; } });
    status.textContent = record ? '書き出し中…（画面を閉じないでください）' : 'プレビュー中（もう一度タップで停止）';
    const blob = await player.play({ record, onProgress: (p) => { if (prog.isConnected) prog.firstChild.style.width = p * 100 + '%'; } });
    if (blob && !player.stopFlag) showVlogResult(blob);
    status.textContent = '';
  } catch (e) {
    console.error(e);
    status.textContent = '失敗しました：' + (e.message || e);
  } finally {
    player = null;
    $('#vl-stage .play')?.classList.remove('hidden');
    prog.classList.add('hidden');
    schedule();
  }
}
function showVlogResult(blob) {
  const { date, l, id } = ui.vlogCtx;
  const ext = blob.type.includes('mp4') ? 'mp4' : 'webm';
  const name = `setlog_${l ? l.name : 'me'}_${date}.${ext}`.replace(/[\\/:*?"<>|\s]/g, '_');
  if (ui.vlogResult) URL.revokeObjectURL(ui.vlogResult.url);
  ui.vlogResult = { key: id + '|' + date, blob, url: URL.createObjectURL(blob), name, ext };
  ui.vlogScroll = true;
}
function vlogResultHtml(id, date) {
  const r = ui.vlogResult;
  if (!r || r.key !== id + '|' + date) return '';
  const { blob, url, name, ext } = r;
  return `<h3>できあがり（${(blob.size / 1024 / 1024).toFixed(1)}MB）</h3><div class="vlog-stage"><video src="${url}" controls playsinline loop></video></div>
    <div class="row" style="margin-top:10px"><a class="btn primary" href="${url}" download="${esc(name)}">保存</a><button class="btn accent" data-a="vl-share">共有・投稿</button></div>
    ${ext === 'webm' ? '<p class="small muted">WebM形式です。Instagram等で使えない場合は、Safari か最新のChromeで書き出すとMP4になります。</p>' : ''}`;
}
A['vl-share'] = async () => {
  const r = ui.vlogResult;
  if (!r) return;
  const file = new File([r.blob], r.name, { type: r.blob.type });
  if (navigator.canShare?.({ files: [file] })) {
    try { await navigator.share({ files: [file], title: 'setlog' }); } catch { /* キャンセル */ }
  } else toast('この端末では直接共有できません。「保存」してから投稿してください');
};

// ---------------- ログの設定 ----------------
VIEWS.logset = (id) => {
  const l = logById(id);
  if (!l) return VIEWS.home();
  const owner = l.owner === B.uid;
  const muted = !!l.muted?.[B.uid];
  return {
    top: topBack('log/' + id, 'ログの設定'),
    body: `<div class="card">
      <label class="f">ログの名前<input id="ls-name" maxlength="20" value="${esc(l.name)}"></label>
      <div class="opt"><div class="k">アイコン</div><div class="pick">${L.LOG_EMOJIS.map((e) => `<button class="${l.emoji === e ? 'on' : ''}" data-a="ls-emoji" data-log="${id}" data-v="${e}">${e}</button>`).join('')}</div></div>
      <div class="opt"><div class="k">色</div><div class="pick colors">${L.COLORS.map((c) => `<button class="${l.color === c ? 'on' : ''}" style="background:${c}" data-a="ls-color" data-log="${id}" data-v="${c}" aria-label="色"></button>`).join('')}</div></div></div>
      <h3>招待</h3><div class="card"><div class="code">${esc(l.code)}</div>
      <div class="row"><button class="btn" data-a="invite" data-log="${id}">リンクを送る</button>${owner ? `<button class="btn" data-a="ls-regen" data-log="${id}">コードを変更</button>` : ''}</div>
      ${owner ? `<label class="check" style="margin-top:6px"><span class="grow">新しい参加を受け付ける<div>オフにすると招待コードで参加できなくなります</div></span><input type="checkbox" class="switch" data-ls="open" data-log="${id}" ${l.locked ? '' : 'checked'}></label>` : ''}</div>
      <h3>メンバー（${l.members.length}/${L.MAX_MEMBERS}）</h3><div class="list">${l.members.map((u) => `<div class="li">${av(l.info?.[u], 'md')}<div class="grow"><b>${esc(l.info?.[u]?.name || '?')}</b>${u === l.owner ? ' <span class="small muted">作成者</span>' : ''}${u === B.uid ? ' <span class="small muted">（自分）</span>' : ''}</div>${owner && u !== B.uid ? `<button class="btn sm danger" data-a="ls-kick" data-log="${id}" data-uid="${u}">外す</button>` : ''}</div>`).join('')}</div>
      <h3>通知</h3><div class="card" style="padding:4px 16px"><label class="check"><span class="grow">このログの通知をオフ<div>友だちの投稿・チャット・リアクションの通知を止めます（毎時の撮影通知は届きます）</div></span><input type="checkbox" class="switch" data-ls="mute" data-log="${id}" ${muted ? 'checked' : ''}></label></div>
      <button class="btn danger block" style="margin:16px 0 30px" data-a="ls-leave" data-log="${id}">このログから抜ける</button>`,
    after: () => {
      $('#ls-name').onchange = (e) => { const v = L.cleanName(e.target.value); if (v) B.updateLog(id, { name: v }).then(() => toast('変更しました')); };
    },
  };
};

// ---------------- 設定 ----------------
VIEWS.settings = () => {
  const p = st.profile;
  const n = { ...L.DEFAULT_NOTIFY, ...(p.notify || {}) };
  const perm = permission();
  const sw = (k, label, desc = '') => `<label class="check"><span class="grow">${label}${desc ? `<div>${desc}</div>` : ''}</span><input type="checkbox" class="switch" data-nk="${k}" ${n[k] ? 'checked' : ''}></label>`;
  const hours = (k) => `<select data-nh="${k}" style="width:96px;flex:none">${Array.from({ length: 24 }, (_, h) => `<option value="${h}" ${n[k] === h ? 'selected' : ''}>${h}:00</option>`).join('')}</select>`;
  let status;
  if (!notifSupported()) status = isIOS() && !isStandalone() ? 'iPhoneは「共有 → ホーム画面に追加」して、追加したアイコンから開くと通知を使えます。' : 'このブラウザは通知に対応していません。';
  else if (perm === 'denied') status = '通知がブロックされています。ブラウザ（または端末）の設定でこのサイトの通知を許可してください。';
  else if (perm !== 'granted') status = '通知はまだオフです。';
  else if (isDemo || !pushSupported()) status = 'オン（この画面を開いている間の通知）。アプリを閉じていても届くようにするには、管理者が通知サーバーを設定します（README参照）。';
  else status = st.pushKey && p.push?.[st.pushKey] ? 'オン：アプリを閉じていても届きます。' : 'オンですが、この端末はまだ登録されていません。下のボタンで登録してください。';
  const acct = B.user;
  return {
    top: topBack('home', '設定'),
    body: `<h3>プロフィール</h3><div class="card">
        <div class="row">${av(myInfo(), 'lg')}<div class="grow"><b style="font-size:18px">${esc(p.name)}</b><div class="small muted">${st.logs.length}ログに参加中・🔥${L.streakDays(Object.keys(p.posted || {}))}日連続</div></div><button class="btn sm" data-a="prof-edit">編集</button></div></div>
      <h3>通知</h3><div class="card" style="padding:10px 16px">
        <p class="small" style="margin:4px 0 8px">${status}</p>
        ${perm !== 'granted' || (pushSupported() && !(st.pushKey && p.push?.[st.pushKey])) ? '<button class="btn primary block" data-a="enable-notify">通知をオンにする</button>' : '<button class="btn block sm" data-a="test-notify">テスト通知を送る</button>'}
        ${sw('hourly', '毎時の撮影通知', '「20:00 今の瞬間を撮ろう」')}
        <div class="row" style="padding:10px 0;border-bottom:1px solid var(--line)"><span class="grow small muted" style="white-space:nowrap">通知する時間帯</span>${hours('start')}<span>〜</span>${hours('end')}</div>
        ${sw('remind', 'まだ撮っていないときのリマインド', '毎時45分ごろ')}
        ${sw('friends', '友だちが投稿したとき', '多くなるのでオフがおすすめ')}
        ${sw('reaction', '自分の動画にリアクションが付いたとき')}
        ${sw('chat', 'チャット・返信')}
        ${sw('poke', 'つつかれたとき')}
      </div>
      <h3>表示</h3><div class="card"><div class="seg">${[['auto', '自動'], ['light', 'ライト'], ['dark', 'ダーク']].map(([k, v]) => `<button class="${(localStorage.getItem('theme') || 'auto') === k ? 'on' : ''}" data-a="theme" data-v="${k}">${v}</button>`).join('')}</div></div>
      <h3>アカウント</h3><div class="card">
        ${isDemo ? '<p class="small">デモモード：データはこの端末のブラウザ内だけにあります。</p><button class="btn block danger" data-a="demo-reset">デモのデータを消してやり直す</button>' : acct?.anonymous ? `<p class="small">この端末だけのアカウントです。Googleと連携すると、機種変更やほかの端末でも同じアカウントで使えます。</p><button class="btn block primary" data-a="google">Googleと連携する</button>` : `<p class="small">${esc(acct?.email || '')} でログイン中</p>`}
        ${isDemo ? '' : '<button class="btn block ghost" data-a="signout" style="margin-top:8px">ログアウト</button>'}
      </div>
      <p class="small muted center" style="margin:18px 0 30px">setlog2 · 動画は友だちのログの中だけで共有されます</p>`,
  };
};

// ---------------- イベント ----------------
document.addEventListener('click', (ev) => {
  const el = ev.target.closest('[data-a]');
  if (!el || el.disabled) return;
  const f = A[el.dataset.a];
  if (f) { ev.preventDefault(); ev.stopPropagation(); f(el, ev); }
});
A['sheet-close'] = () => closeSheet();
A.go = (el) => go(el.dataset.to);
A.start = async (el) => {
  el.disabled = true;
  try { await B.signInAnon(); } catch (e) { toast(e.message); el.disabled = false; }
};
A.google = async () => {
  try {
    const r = await B.signInGoogle();
    toast(r === 'linked' ? 'Googleと連携しました' : 'ログインしました');
    schedule();
  } catch (e) { if (e.code !== 'auth/popup-closed-by-user') toast(e.message); }
};
A.signout = async () => { if (await confirmSheet('ログアウトしますか？', 'ログアウト', true, B.user?.anonymous ? 'Googleと連携していないアカウントは、ログアウトすると戻れません。' : '')) B.signOut(); };
A['demo-info'] = () => openSheet(`<h2>デモモード</h2><p>Firebaseが未設定のため、この端末だけで動いています。「ねむい組」の友だちは架空で、投稿するとリアクションやチャットが返ってきます。</p><p class="small muted">別のタブで <code>?demoUser=b</code> を付けて開くと、別の人として同じデータを操作できます。</p><button class="btn block" data-a="sheet-close">閉じる</button>`);
A['demo-reset'] = async () => {
  if (!(await confirmSheet('デモのデータを消しますか？', '消す', true))) return;
  localStorage.removeItem('setlog2-demo');
  indexedDB.deleteDatabase('setlog2-demo');
  location.href = location.pathname;
};

// プロフィール
A['pick-emoji'] = (el) => { const p = ui.onb || ui.prof; p.emoji = el.dataset.v; p.photo = null; refreshProfileForm(); };
A['pick-color'] = (el) => { const p = ui.onb || ui.prof; p.color = el.dataset.v; refreshProfileForm(); };
A['pick-photo'] = () => $('#file-photo').click();
A['clear-photo'] = () => { const p = ui.onb || ui.prof; p.photo = null; refreshProfileForm(); };
$('#file-photo').addEventListener('change', async (e) => {
  const f = e.target.files[0];
  e.target.value = '';
  if (!f) return;
  const img = new Image();
  img.src = URL.createObjectURL(f);
  await img.decode().catch(() => {});
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const s = Math.max(128 / img.width, 128 / img.height);
  c.getContext('2d').drawImage(img, (128 - img.width * s) / 2, (128 - img.height * s) / 2, img.width * s, img.height * s);
  const p = ui.onb || ui.prof;
  p.photo = c.toDataURL('image/jpeg', 0.8);
  refreshProfileForm();
});
function refreshProfileForm() {
  if (ui.prof) A['prof-edit'](null, true);
  else schedule();
}
A['onb-done'] = async () => {
  const p = ui.onb;
  p.name = L.cleanName($('#onb-name').value);
  if (!p.name) { toast('名前を入力してください'); return; }
  await B.saveProfile({ name: p.name, emoji: p.emoji, color: p.color, photo: p.photo || null, notify: L.DEFAULT_NOTIFY, tz: Intl.DateTimeFormat().resolvedOptions().timeZone, createdAt: Date.now() });
  ui.onb = null;
};
A['prof-edit'] = (_, keep = false) => {
  if (!keep) ui.prof = { name: st.profile.name, emoji: st.profile.emoji, color: st.profile.color, photo: st.profile.photo || null };
  const p = ui.prof;
  const name = $('#pf-name')?.value ?? p.name;
  openSheet(`<h2>プロフィール</h2><div class="center">${av(p, 'lg')}</div>
    <label class="f">名前<input id="pf-name" maxlength="20" value="${esc(name)}"></label>${avatarPicker(p)}
    <button class="btn primary block" style="margin-top:14px" data-a="prof-save">保存</button>`, () => { ui.prof = null; });
};
A['prof-save'] = async () => {
  const p = ui.prof;
  const name = L.cleanName($('#pf-name').value);
  if (!name) { toast('名前を入力してください'); return; }
  await B.saveProfile({ name, emoji: p.emoji, color: p.color, photo: p.photo || null });
  closeSheet();
  toast('保存しました');
};

// 通知
A['enable-notify'] = async () => {
  try {
    const r = await enablePush();
    if (!r.ok) {
      toast(r.reason === 'ios-install' ? 'ホーム画面に追加してから開いてください' : r.reason === 'denied' ? '通知が許可されませんでした' : 'このブラウザは通知に対応していません');
      return;
    }
    if (r.sub) {
      st.pushKey = r.key;
      await B.saveProfile({ push: { ...(st.profile.push || {}), [r.key]: { ...r.sub, ua: navigator.userAgent.slice(0, 120), at: Date.now() } }, tz: Intl.DateTimeFormat().resolvedOptions().timeZone });
      toast('通知をオンにしました');
    } else toast('この画面を開いている間の通知をオンにしました');
    schedule();
  } catch (e) { toast('通知を設定できませんでした：' + e.message); }
};
A['test-notify'] = () => showLocal('📸 テスト', 'こんな感じで毎時お知らせします', { url: './#cam' }).then((ok) => toast(ok ? '送りました' : '通知を出せませんでした'));
A.theme = (el) => { localStorage.setItem('theme', el.dataset.v); applyTheme(); schedule(); };

// ログ
A['log-new'] = () => {
  const d = { name: '', emoji: L.LOG_EMOJIS[Math.floor(Math.random() * L.LOG_EMOJIS.length)], color: L.COLORS[Math.floor(Math.random() * L.COLORS.length)] };
  const draw = () => openSheet(`<h2>ログを作る</h2><p class="small muted" style="margin-top:-6px">仲のいい友だちのグループ。最大${L.MAX_MEMBERS}人まで。</p>
    <label class="f">名前<input id="ln-name" maxlength="20" placeholder="例：ねむい組" value="${esc(d.name)}"></label>
    <div class="opt"><div class="k">アイコン</div><div class="pick">${L.LOG_EMOJIS.map((e) => `<button class="${d.emoji === e ? 'on' : ''}" data-a="ln-emoji" data-v="${e}">${e}</button>`).join('')}</div></div>
    <div class="opt"><div class="k">色</div><div class="pick colors">${L.COLORS.map((c) => `<button class="${d.color === c ? 'on' : ''}" style="background:${c}" data-a="ln-color" data-v="${c}" aria-label="色"></button>`).join('')}</div></div>
    <button class="btn accent block big" data-a="ln-ok">作って友だちを招待</button>`);
  A['ln-emoji'] = (el) => { d.name = $('#ln-name').value; d.emoji = el.dataset.v; draw(); };
  A['ln-color'] = (el) => { d.name = $('#ln-name').value; d.color = el.dataset.v; draw(); };
  A['ln-ok'] = async () => {
    const name = L.cleanName($('#ln-name').value);
    if (!name) { toast('名前を入力してください'); return; }
    try {
      const id = await B.createLog({ name, emoji: d.emoji, color: d.color, info: myInfo() });
      closeSheet();
      go('log/' + id);
      setTimeout(() => A.invite({ dataset: { log: id } }), 400);
    } catch (e) { toast(e.message); }
  };
  draw();
  setTimeout(() => $('#ln-name')?.focus(), 80);
};
A['join-open'] = (_, code = '') => {
  openSheet(`<h2>コードで参加</h2><p class="small muted" style="margin-top:-6px">友だちから届いた6文字の招待コード（またはリンク）を入力</p>
    <input id="jn-code" class="code" style="font-size:26px" maxlength="80" placeholder="ABC123" value="${esc(code)}" autocapitalize="characters" autocomplete="off">
    <div id="jn-prev" class="center" style="min-height:60px;padding:10px"></div>
    <button class="btn accent block big" data-a="jn-ok" id="jn-ok" disabled>参加する</button>`);
  const inp = $('#jn-code');
  let found = null;
  const check = async () => {
    const c = L.normCode(inp.value);
    found = null;
    $('#jn-ok').disabled = true;
    if (c.length < 6) { $('#jn-prev').innerHTML = ''; return; }
    $('#jn-prev').innerHTML = '<span class="muted">確認中…</span>';
    const p = await B.previewCode(c).catch(() => null);
    if (L.normCode(inp.value) !== c) return;
    if (!p) { $('#jn-prev').innerHTML = '<span class="muted">見つかりません</span>'; return; }
    if (logById(p.logId)) { $('#jn-prev').innerHTML = `<b>${esc(p.emoji)} ${esc(p.name)}</b><div class="small muted">参加済みです</div>`; return; }
    found = { ...p, code: c };
    $('#jn-prev').innerHTML = `<div style="font-size:40px">${esc(p.emoji)}</div><b>${esc(p.name)}</b>`;
    $('#jn-ok').disabled = false;
  };
  inp.oninput = check;
  A['jn-ok'] = async () => {
    if (!found) return;
    try {
      const id = await B.joinByCode(found.code, myInfo());
      closeSheet();
      toast(`${found.name}に参加しました`);
      go('log/' + id);
    } catch (e) { toast(e.message); }
  };
  if (code) check(); else setTimeout(() => inp.focus(), 80);
};
let joinChecked = false;
function maybeJoinFromLink() {
  if (joinChecked || !st.profile?.name || !st.logsLoaded) return;
  const code = new URLSearchParams(location.search).get('join') || sessionStorage.getItem('pendingJoin');
  joinChecked = true;
  if (!code) return;
  sessionStorage.removeItem('pendingJoin');
  history.replaceState(null, '', location.pathname + location.hash);
  setTimeout(() => A['join-open'](null, code), 300);
}
{
  const code = new URLSearchParams(location.search).get('join');
  if (code) sessionStorage.setItem('pendingJoin', code);
}
A.invite = (el) => {
  const l = logById(el.dataset.log);
  if (!l) return;
  const url = `${location.origin}${location.pathname}?join=${l.code}`;
  openSheet(`<h2>${esc(l.emoji)} ${esc(l.name)}に招待</h2><p class="small muted" style="margin-top:-6px">リンクを送るか、コードを伝えてください（${l.members.length}/${L.MAX_MEMBERS}人）</p>
    <div class="code">${esc(l.code)}</div>
    <div class="row"><button class="btn" data-a="inv-copy">リンクをコピー</button><button class="btn accent" data-a="inv-share">送る</button></div>
    ${l.locked ? '<p class="small bad" style="color:var(--bad)">参加受付を停止中です（ログの設定で変更）</p>' : ''}`);
  const text = `setlogで「${l.name}」に参加しよう！ 毎時2秒の動画で1日をシェアするやつ📸\n招待コード：${l.code}`;
  A['inv-copy'] = () => copyText(url, 'リンクをコピーしました');
  A['inv-share'] = () => shareOrCopy({ title: 'setlog2', text, url });
};
A['log-switch'] = (el) => {
  const cur = el.dataset.log;
  openSheet(`<h2>ログを切り替え</h2><div class="menu">${st.logs.map((l) => `<div class="mi ${l.id === cur ? 'on' : ''}" data-a="go" data-to="log/${l.id}"><span class="ic">${esc(l.emoji)}</span><span class="grow">${esc(l.name)}</span><span class="small muted">${todayClips(l.id).length}本</span></div>`).join('')}
    <div class="mi" data-a="log-new"><span class="ic">＋</span>ログを作る</div><div class="mi" data-a="join-open"><span class="ic">🔑</span>コードで参加</div></div>`);
};
A.slot = (el) => {
  const key = el.dataset.key;
  ui.slot[key] = el.dataset.v;
  const pg = $('#pager');
  const i = [...document.querySelectorAll('.dots button')].indexOf(el);
  pg?.scrollTo({ left: i * pg.clientWidth, behavior: 'smooth' });
};
A.camera = (el) => openCamera(el?.dataset?.log || null);
A.view = (el) => openViewer(el.dataset.log, el.dataset.clip, el.dataset.date || today(), !!el.dataset.reply);
A['chat-clip'] = (el) => {
  const { log, clip, date } = el.dataset;
  const cs = useClips(log, date);
  if (cs?.some((c) => c.id === clip)) openViewer(log, clip, date);
  else { toast('動画が見つかりません（削除された可能性があります）'); }
};
A.heart = (el) => {
  const key = Object.keys(st.clips).find((k) => k.startsWith(el.dataset.log + '|') && st.clips[k].some((c) => c.id === el.dataset.clip));
  const c = st.clips[key]?.find((x) => x.id === el.dataset.clip);
  B.react(el.dataset.log, el.dataset.clip, c?.reactions?.[B.uid] === '❤️' ? null : '❤️').catch((e) => toast(e.message));
  navigator.vibrate?.(15);
};
A.poke = (el) => {
  const l = logById(el.dataset.log);
  const k = `poke:${el.dataset.log}:${el.dataset.uid}:${L.slotOf().date}_${L.slotOf().slot}`;
  if (sessionStorage.getItem(k)) { toast('この時間はもうつついています'); return; }
  sessionStorage.setItem(k, '1');
  B.poke(el.dataset.log, el.dataset.uid, L.slotOf().slot).then(() => toast(`${l.info?.[el.dataset.uid]?.name || ''}をつつきました👉`)).catch((e) => toast(e.message));
};
A['chat-send'] = (el) => {
  const inp = $('#chat-in');
  const t = inp.value.trim();
  if (!t) return;
  inp.value = '';
  B.sendMessage(el.dataset.log, { text: t }).catch((e) => toast(e.message));
  inp.focus();
};
A['msg-menu'] = (el) => {
  openSheet(`<div class="menu"><div class="mi danger" data-a="msg-del" data-log="${el.dataset.log}" data-id="${el.dataset.id}"><span class="ic">🗑</span>送信を取り消す</div></div>`);
};
A['msg-del'] = (el) => { B.deleteMessage(el.dataset.log, el.dataset.id); closeSheet(); };
A['cal-month'] = (el) => {
  const id = el.dataset.log;
  const d = new Date(L.parseDateKey(ui.calMonth[id] || today().slice(0, 8) + '01'));
  d.setMonth(d.getMonth() + +el.dataset.v);
  ui.calMonth[id] = L.dateKey(d.getTime());
  schedule();
};

// Vlog
A.vopt = (el) => {
  const k = el.dataset.k;
  ui.vlog[k] = k === 'speed' ? +el.dataset.v : el.dataset.v;
  player?.stop();
  schedule();
};
A['vl-preview'] = () => runVlog(false);
A['vl-export'] = () => runVlog(true);
A['vl-bgm'] = () => $('#file-bgm').click();
$('#file-bgm').addEventListener('change', (e) => { ui.vlog.bgm = e.target.files[0] || null; e.target.value = ''; schedule(); });

// ログ設定
A['ls-emoji'] = (el) => B.updateLog(el.dataset.log, { emoji: el.dataset.v });
A['ls-color'] = (el) => B.updateLog(el.dataset.log, { color: el.dataset.v });
A['ls-regen'] = async (el) => {
  if (!(await confirmSheet('招待コードを変更しますか？', '変更', false, '今までのコード・リンクでは参加できなくなります。'))) return;
  const l = logById(el.dataset.log);
  await B.regenCode(l.id, l.code);
  toast('新しいコードにしました');
};
A['ls-kick'] = async (el) => {
  const l = logById(el.dataset.log);
  if (!(await confirmSheet(`${l.info?.[el.dataset.uid]?.name}をログから外しますか？`, '外す', true))) return;
  B.removeMember(l.id, el.dataset.uid);
};
A['ls-leave'] = async (el) => {
  const l = logById(el.dataset.log);
  if (!(await confirmSheet(`「${l.name}」から抜けますか？`, '抜ける', true, 'もう一度入るには招待コードが必要です。'))) return;
  await B.leaveLog(l.id);
  go('home');
};

document.addEventListener('change', (ev) => {
  const t = ev.target;
  if (t.dataset.nk || t.dataset.nh) {
    const n = { ...L.DEFAULT_NOTIFY, ...(st.profile.notify || {}) };
    if (t.dataset.nk) n[t.dataset.nk] = t.checked;
    else n[t.dataset.nh] = +t.value;
    B.saveProfile({ notify: n });
  } else if (t.dataset.vk) {
    ui.vlog[t.dataset.vk] = t.checked;
    player?.stop();
  } else if (t.dataset.ls === 'open') B.updateLog(t.dataset.log, { locked: !t.checked });
  else if (t.dataset.ls === 'mute') B.setMute(t.dataset.log, t.checked);
});

// ---------------- 毎時のお知らせ（画面を開いているとき） ----------------
function tickHourly() {
  if (!st.profile?.name || !st.logs.length) return;
  const s = L.slotOf();
  const key = `${s.date}_${s.slot}`;
  const n = { ...L.DEFAULT_NOTIFY, ...(st.profile.notify || {}) };
  if (localStorage.getItem('lastSlotNotice') === key) return;
  if (!n.hourly || !L.isActiveHour(s.hour, n.start, n.end) || s.minute >= 15) return;
  if (st.logs.every((l) => postedNow(l.id))) return;
  localStorage.setItem('lastSlotNotice', key);
  const title = `📸 ${L.slotLabel(s.slot)} 今の瞬間を撮ろう`;
  if (document.visibilityState === 'visible') {
    banner(`<span style="font-size:28px">📸</span><div class="grow"><b>${L.slotLabel(s.slot)} 撮影の時間です</b><div class="small muted">タップして2秒だけ撮ろう</div></div>`, () => openCamera());
    navigator.vibrate?.([80, 60, 80]);
  } else if (!(st.pushKey && st.profile.push?.[st.pushKey])) {
    showLocal(title, 'タップして2秒だけ撮ろう', { tag: 'hourly', url: './#cam' });
  }
}
setInterval(tickHourly, 15000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) { tickHourly(); schedule(); } });
// 分が変わったら残り時間などを更新
let lastMin = new Date().getMinutes();
setInterval(() => {
  const m = new Date().getMinutes();
  if (m !== lastMin && !overlay && !document.activeElement?.matches?.('input,textarea')) { lastMin = m; schedule(); }
}, 5000);

function applyTheme() {
  const t = localStorage.getItem('theme') || 'auto';
  if (t === 'auto') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', t);
}

// ---------------- 起動 ----------------
applyTheme();
if (route().name === 'cam') {
  history.replaceState(null, '', '#home');
  const wait = setInterval(() => { if (st.logs.length) { clearInterval(wait); openCamera(); } }, 300);
  setTimeout(() => clearInterval(wait), 8000);
}
render();
if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js').catch(() => {});
