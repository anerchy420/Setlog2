// データ層：Firebase（本番） / この端末だけのデモ。どちらも同じ関数を持つ
import { FIREBASE_CONFIG } from './firebase-config.js';
import { clipIdOf, genCode, MAX_MEMBERS, DEFAULT_NOTIFY, slotOf, pad2, REACTIONS, dateKey, addDaysKey } from './logic.js';

export const isDemo = !FIREBASE_CONFIG || !FIREBASE_CONFIG.apiKey;

// 使う順：Firebase設定あり → Firebase / 自前サーバー（server/server.mjs）が応答 → サーバー / どちらもなし → デモ
export let mode = 'demo';
export async function createBackend() {
  if (!isDemo) { mode = 'firebase'; return createFirebase(); }
  try {
    const r = await fetch('api/config', { cache: 'no-store' });
    const cfg = r.ok && (await r.json());
    if (cfg?.ok) { mode = 'server'; return new ServerBackend(cfg); }
  } catch { /* サーバーなし */ }
  return new DemoBackend();
}

// ---------------- 自前サーバー ----------------
class ServerBackend {
  constructor(cfg) {
    this.kind = 'server';
    this.cfg = cfg;
    this.token = localStorage.getItem('setlog2.token');
    this.uid = localStorage.getItem('setlog2.uid');
    this.user = null;
    this.watchers = new Set();
  }
  async api(method, p, body) {
    const r = await fetch('api/' + p, {
      method,
      headers: { ...(this.token ? { Authorization: 'Bearer ' + this.token } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      cache: 'no-store',
    });
    const j = await r.json().catch(() => null);
    if (r.status === 401 && this.token) { this.clear(); this.authCb?.(null); }
    if (!r.ok) { const e = new Error(j?.error || `通信エラー（${r.status}）`); e.status = r.status; throw e; }
    return j;
  }
  clear() {
    this.token = this.uid = null;
    this.user = null;
    localStorage.removeItem('setlog2.token');
    localStorage.removeItem('setlog2.uid');
    this.es?.close();
    this.es = null;
  }
  setAuth({ uid, token }) {
    this.token = token; this.uid = uid;
    localStorage.setItem('setlog2.token', token);
    localStorage.setItem('setlog2.uid', uid);
  }
  onAuth(cb) {
    this.authCb = cb;
    (async () => {
      if (!this.token) return cb(null);
      try {
        const me = await this.api('GET', 'me');
        this.uid = me.uid;
        this.user = { uid: me.uid, anonymous: true, provider: 'server' };
        this.connect();
        cb(this.user);
      } catch (e) {
        if (e.status === 401) cb(null);
        else { emitErr(e); setTimeout(() => this.onAuth(cb), 5000); } // サーバーが止まっているときは再試行
      }
    })();
    return () => {};
  }
  async signInAnon(signupCode) {
    this.setAuth(await this.api('POST', 'signup', { signupCode }));
    this.onAuth(this.authCb);
  }
  async redeemTransfer(code) {
    this.setAuth(await this.api('POST', 'transfer/redeem', { code }));
    this.onAuth(this.authCb);
  }
  issueTransfer() { return this.api('POST', 'transfer'); }
  async signInGoogle() { throw new Error('このサーバーでは引き継ぎコードを使ってください'); }
  async signOut() {
    await this.api('POST', 'logout').catch(() => {});
    this.clear();
    this.authCb?.(null);
  }

  // リアルタイム更新：サーバーから「変わった」と届いたら該当の購読だけ取り直す
  connect() {
    this.es?.close();
    const es = new EventSource('api/events?token=' + encodeURIComponent(this.token));
    this.es = es;
    let wasDown = false;
    es.onmessage = (m) => {
      const ev = JSON.parse(m.data);
      for (const w of this.watchers) if (w.match(ev)) w.refresh();
    };
    es.onerror = () => { wasDown = true; };
    es.onopen = () => { if (wasDown) { wasDown = false; for (const w of this.watchers) w.refresh(); } };
  }
  watch(match, load, cb) {
    let t = 0, alive = true;
    const w = {
      match,
      refresh: () => {
        clearTimeout(t);
        t = setTimeout(() => load().then((v) => { if (alive) cb(v); }).catch((e) => { if (e.status !== 401) emitErr(e); }), 60);
      },
    };
    this.watchers.add(w);
    load().then((v) => { if (alive) cb(v); }).catch((e) => emitErr(e));
    return () => { alive = false; this.watchers.delete(w); };
  }
  watchProfile(cb) { return this.watch((e) => e.type === 'profile', () => this.api('GET', 'me').then((m) => m.profile), cb); }
  saveProfile(p) { return this.api('PATCH', 'me', p.push ? { ...p, push: undefined } : p); }
  async savePush(key, sub, tz) { return this.api('PUT', 'push/' + key, { sub, tz }); }
  testPush() { return this.api('POST', 'push/test'); }

  watchLogs(cb) { return this.watch((e) => e.type === 'logs', () => this.api('GET', 'logs'), cb); }
  async createLog({ name, emoji, color }) { return (await this.api('POST', 'logs', { name, emoji, color })).id; }
  previewCode(code) { return this.api('GET', 'codes/' + encodeURIComponent(code)); }
  async joinByCode(code) { return (await this.api('POST', 'join', { code })).id; }
  updateLog(id, patch) { return this.api('PATCH', 'logs/' + id, patch); }
  setMyInfo() { return Promise.resolve(); } // サーバーがプロフィール保存時に反映する
  setMute(id, on) { return this.api('POST', `logs/${id}/mute`, { on }); }
  leaveLog(id) { return this.api('POST', `logs/${id}/leave`); }
  removeMember(id, uid) { return this.api('POST', `logs/${id}/kick`, { uid }); }
  async regenCode(id) { return (await this.api('POST', `logs/${id}/code`)).code; }

  watchClips(logId, from, to, cb) {
    return this.watch((e) => e.type === 'clips' && e.log === logId && e.date >= from && e.date <= to, () => this.api('GET', `logs/${logId}/clips?from=${from}&to=${to}`), cb);
  }
  dayInfo(logId, date) { return this.api('GET', `logs/${logId}/day/${date}`); }
  async getMedia(logId, clipId) {
    const r = await fetch(`api/logs/${logId}/clips/${clipId}/media`, { headers: { Authorization: 'Bearer ' + this.token } });
    if (!r.ok) return null;
    const blob = await r.blob();
    return { mime: blob.type, data: URL.createObjectURL(blob) };
  }
  async postClip(logId, clip, media) {
    return (await this.api('POST', `logs/${logId}/clips`, { ...clip, media: media.data })).id;
  }
  deleteClip(logId, clipId) { return this.api('DELETE', `logs/${logId}/clips/${clipId}`); }
  react(logId, clipId, emoji) { return this.api('PUT', `logs/${logId}/clips/${clipId}/react`, { emoji }); }

  watchMessages(logId, cb, limit = 150) {
    return this.watch((e) => e.type === 'messages' && e.log === logId, () => this.api('GET', `logs/${logId}/messages?limit=${limit}`), cb);
  }
  sendMessage(logId, m) { return this.api('POST', `logs/${logId}/messages`, m); }
  deleteMessage(logId, id) { return this.api('DELETE', `logs/${logId}/messages/${id}`); }
  poke(logId, to) { return this.api('POST', `logs/${logId}/pokes`, { to }); }
}

const emitErr = (e) => { console.error(e); window.dispatchEvent(new CustomEvent('backend-error', { detail: e })); };

// ---------------- Firebase ----------------
const V = '10.12.2';
async function createFirebase() {
  const [{ initializeApp }, fs, au] = await Promise.all([
    import(`https://www.gstatic.com/firebasejs/${V}/firebase-app.js`),
    import(`https://www.gstatic.com/firebasejs/${V}/firebase-firestore.js`),
    import(`https://www.gstatic.com/firebasejs/${V}/firebase-auth.js`),
  ]);
  const app = initializeApp(FIREBASE_CONFIG);
  let db;
  try {
    db = fs.initializeFirestore(app, { localCache: fs.persistentLocalCache({ tabManager: fs.persistentMultipleTabManager() }) });
  } catch {
    db = fs.getFirestore(app);
  }
  const auth = au.getAuth(app);
  await au.setPersistence(auth, au.browserLocalPersistence).catch(() => {});
  const d = (...p) => fs.doc(db, ...p);
  const c = (...p) => fs.collection(db, ...p);
  const snapList = (s) => s.docs.map((x) => ({ id: x.id, ...x.data() }));
  const ts = (v) => (v?.toMillis ? v.toMillis() : v || 0);
  const fixTimes = (o) => ({ ...o, createdAt: ts(o.createdAt) });

  const B = {
    kind: 'firebase',
    uid: null,
    user: null,
    onAuth(cb) {
      return au.onAuthStateChanged(auth, (u) => {
        B.uid = u?.uid || null;
        B.user = u ? { uid: u.uid, anonymous: u.isAnonymous, email: u.email, provider: u.providerData[0]?.providerId || 'anonymous' } : null;
        cb(B.user);
      });
    },
    signInAnon: () => au.signInAnonymously(auth),
    async signInGoogle() {
      const p = new au.GoogleAuthProvider();
      if (auth.currentUser?.isAnonymous) {
        try {
          await au.linkWithPopup(auth.currentUser, p);
          B.user = { ...B.user, anonymous: false, email: auth.currentUser.email, provider: 'google.com' };
          return 'linked';
        } catch (e) {
          if (e.code !== 'auth/credential-already-in-use') throw e;
          const cred = au.GoogleAuthProvider.credentialFromError(e);
          await au.signInWithCredential(auth, cred);
          return 'switched';
        }
      }
      await au.signInWithPopup(auth, p);
      return 'signed-in';
    },
    signOut: () => au.signOut(auth),

    watchProfile(cb) {
      return fs.onSnapshot(d('users', B.uid), (s) => cb(s.exists() ? s.data() : null), emitErr);
    },
    saveProfile(p) {
      return fs.setDoc(d('users', B.uid), p, { merge: true });
    },

    watchLogs(cb) {
      const q = fs.query(c('logs'), fs.where('members', 'array-contains', B.uid));
      return fs.onSnapshot(q, (s) => cb(snapList(s).map(fixTimes)), emitErr);
    },
    async createLog({ name, emoji, color, info }) {
      const ref = fs.doc(c('logs'));
      const code = genCode();
      const b = fs.writeBatch(db);
      b.set(ref, { name, emoji, color, owner: B.uid, members: [B.uid], info: { [B.uid]: info }, code, locked: false, muted: {}, createdAt: fs.serverTimestamp() });
      await b.commit();
      await fs.setDoc(d('codes', code), { logId: ref.id, name, emoji });
      return ref.id;
    },
    async previewCode(code) {
      const s = await fs.getDoc(d('codes', code));
      return s.exists() ? s.data() : null;
    },
    async joinByCode(code, info) {
      const cd = await B.previewCode(code);
      if (!cd) throw new Error('招待コードが見つかりません');
      try {
        await fs.updateDoc(d('logs', cd.logId), { members: fs.arrayUnion(B.uid), [`info.${B.uid}`]: info, joinCode: code });
      } catch (e) {
        if (e.code === 'permission-denied') throw new Error('参加できませんでした（満員・参加受付停止中・コードが古いなど）');
        throw e;
      }
      return cd.logId;
    },
    updateLog(id, patch) {
      const p = fs.updateDoc(d('logs', id), patch);
      if (patch.name || patch.emoji) {
        fs.getDoc(d('logs', id)).then((s) => {
          const code = s.data()?.code;
          if (code && s.data().owner === B.uid) fs.setDoc(d('codes', code), { name: s.data().name, emoji: s.data().emoji }, { merge: true }).catch(() => {});
        });
      }
      return p;
    },
    setMyInfo(id, info) { return fs.updateDoc(d('logs', id), { [`info.${B.uid}`]: info }); },
    setMute(id, on) { return fs.updateDoc(d('logs', id), { [`muted.${B.uid}`]: !!on }); },
    leaveLog(id) { return fs.updateDoc(d('logs', id), { members: fs.arrayRemove(B.uid) }); },
    removeMember(id, uid) { return fs.updateDoc(d('logs', id), { members: fs.arrayRemove(uid) }); },
    async regenCode(id, old) {
      const code = genCode();
      const s = await fs.getDoc(d('logs', id));
      await fs.setDoc(d('codes', code), { logId: id, name: s.data().name, emoji: s.data().emoji });
      await fs.updateDoc(d('logs', id), { code });
      if (old) await fs.deleteDoc(d('codes', old)).catch(() => {});
      return code;
    },

    watchClips(logId, from, to, cb) {
      const q = fs.query(c('logs', logId, 'clips'), fs.where('date', '>=', from), fs.where('date', '<=', to));
      return fs.onSnapshot(q, (s) => cb(snapList(s).map(fixTimes)), emitErr);
    },
    // カレンダー用：その日の本数・自分の本数・表紙（動画本体は読まない）
    async dayInfo(logId, date) {
      const q = fs.query(c('logs', logId, 'clips'), fs.where('date', '==', date));
      const [all, mine, first] = await Promise.all([
        fs.getCountFromServer(q),
        fs.getCountFromServer(fs.query(q, fs.where('uid', '==', B.uid))),
        fs.getDocs(fs.query(q, fs.limit(1))),
      ]);
      return { count: all.data().count, mine: mine.data().count, cover: first.docs[0]?.data().thumb || null };
    },
    async getMedia(logId, clipId) {
      const s = await fs.getDoc(d('logs', logId, 'media', clipId));
      return s.exists() ? s.data() : null;
    },
    async postClip(logId, clip, media) {
      const id = clipIdOf(clip.date, clip.slot, B.uid);
      const b = fs.writeBatch(db);
      b.set(d('logs', logId, 'media', id), { uid: B.uid, data: media.data, mime: media.mime });
      b.set(d('logs', logId, 'clips', id), { ...clip, uid: B.uid, reactions: {}, createdAt: fs.serverTimestamp() });
      await b.commit();
      return id;
    },
    async deleteClip(logId, clipId) {
      const b = fs.writeBatch(db);
      b.delete(d('logs', logId, 'clips', clipId));
      b.delete(d('logs', logId, 'media', clipId));
      await b.commit();
    },
    react(logId, clipId, emoji) {
      const p = { [`reactions.${B.uid}`]: emoji || fs.deleteField() };
      if (emoji) Object.assign(p, { reactedAt: fs.serverTimestamp(), lastReact: { uid: B.uid, emoji } });
      return fs.updateDoc(d('logs', logId, 'clips', clipId), p);
    },

    watchMessages(logId, cb, limit = 150) {
      const q = fs.query(c('logs', logId, 'messages'), fs.orderBy('createdAt', 'desc'), fs.limit(limit));
      return fs.onSnapshot(q, (s) => cb(snapList(s).map(fixTimes).map((m) => ({ ...m, createdAt: m.createdAt || Date.now() })).reverse()), emitErr);
    },
    sendMessage(logId, m) {
      return fs.addDoc(c('logs', logId, 'messages'), { ...m, uid: B.uid, createdAt: fs.serverTimestamp() });
    },
    deleteMessage(logId, id) { return fs.deleteDoc(d('logs', logId, 'messages', id)); },
    poke(logId, to, slot) {
      return fs.addDoc(c('logs', logId, 'pokes'), { from: B.uid, to, slot, createdAt: fs.serverTimestamp() });
    },
  };
  return B;
}

// ---------------- デモ（この端末だけ・架空の友だち入り） ----------------
const DKEY = 'setlog2-demo';
const FRIENDS = [
  ['f1', 'しあん', '🦊', '#ff9f43'], ['f2', 'こはく', '🐧', '#3ccfcf'], ['f3', 'らむね', '🫧', '#4d9dff'],
  ['f4', 'ぱをん', '🐻', '#c86bfa'], ['f5', 'みそ', '🍑', '#ff6b9a'],
];
const SCENES = [
  ['☕', '朝のコーヒー', '#f6d365', '#fda085'], ['🚃', '満員電車…', '#a1c4fd', '#c2e9fb'], ['📚', 'テスト勉強', '#d4fc79', '#96e6a1'],
  ['🍙', 'おにぎり', '#ffecd2', '#fcb69f'], ['🐶', 'いぬ派です', '#e0c3fc', '#8ec5fc'], ['🍰', 'おやつタイム', '#fbc2eb', '#a6c1ee'],
  ['🎮', 'ランク上げ中', '#667eea', '#764ba2'], ['🌇', '夕焼けきれい', '#fa709a', '#fee140'], ['🍜', 'これがうまい', '#f093fb', '#f5576c'],
  ['🛁', 'お風呂', '#89f7fe', '#66a6ff'], ['🎧', '作業用BGM', '#30cfd0', '#330867'], ['😴', 'ねむい', '#434343', '#000000'],
];

function demoImage(seed, label, emoji, c1, c2, hour) {
  const cv = document.createElement('canvas');
  cv.width = 480; cv.height = 270;
  const g = cv.getContext('2d');
  const gr = g.createLinearGradient(0, 0, 480, 270);
  gr.addColorStop(0, c1); gr.addColorStop(1, c2);
  g.fillStyle = gr; g.fillRect(0, 0, 480, 270);
  g.globalAlpha = 0.15;
  for (let i = 0; i < 6; i++) { g.beginPath(); g.arc((seed * 97 + i * 83) % 480, (seed * 53 + i * 61) % 270, 30 + i * 9, 0, 7); g.fillStyle = '#fff'; g.fill(); }
  g.globalAlpha = 1;
  g.font = '110px serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(emoji, 240, 125);
  g.font = 'bold 22px sans-serif'; g.fillStyle = 'rgba(0,0,0,.35)'; g.fillText(label, 241, 226); g.fillStyle = '#fff'; g.fillText(label, 240, 224);
  return cv.toDataURL('image/jpeg', 0.7);
}

// 動画・画像はIndexedDBへ（localStorageの容量対策）
function idb() {
  return new Promise((res, rej) => {
    const r = indexedDB.open('setlog2-demo', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('media');
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
async function idbOp(mode, fn) {
  const db = await idb();
  return new Promise((res, rej) => {
    const tx = db.transaction('media', mode);
    const out = fn(tx.objectStore('media'));
    tx.oncomplete = () => res(out?.result);
    tx.onerror = () => rej(tx.error);
  });
}

class DemoBackend {
  constructor() {
    this.kind = 'demo';
    const q = new URLSearchParams(location.search).get('demoUser');
    if (q) sessionStorage.setItem('setlog2-demo-uid', q);
    this.uid = sessionStorage.getItem('setlog2-demo-uid') || 'me';
    this.user = null;
    this.subs = new Set();
    this.load();
    try {
      this.bc = new BroadcastChannel(DKEY);
      this.bc.onmessage = () => { this.load(); this.emit(); };
    } catch { /* 非対応 */ }
  }
  load() {
    try { this.s = JSON.parse(localStorage.getItem(DKEY)) || {}; } catch { this.s = {}; }
    for (const k of ['users', 'logs', 'codes', 'clips', 'messages']) this.s[k] ||= {};
  }
  save() {
    try { localStorage.setItem(DKEY, JSON.stringify(this.s)); } catch (e) { emitErr(e); }
    this.bc?.postMessage(1);
    this.emit();
    return Promise.resolve();
  }
  // Firestoreと同じく、変更の通知は非同期でまとめて届ける
  emit() {
    if (this.emitT) return;
    this.emitT = setTimeout(() => { this.emitT = 0; for (const f of [...this.subs]) f(); }, 0);
  }
  sub(f) { this.subs.add(f); queueMicrotask(f); return () => this.subs.delete(f); }

  onAuth(cb) {
    const u = this.s.users[this.uid]?.signedIn ? { uid: this.uid, anonymous: true, provider: 'demo' } : null;
    this.user = u;
    queueMicrotask(() => cb(u));
    this.authCb = cb;
    return () => {};
  }
  async signInAnon() {
    this.s.users[this.uid] = { ...(this.s.users[this.uid] || {}), signedIn: true };
    await this.save();
    if (!this.s.seeded) await this.seed();
    this.user = { uid: this.uid, anonymous: true, provider: 'demo' };
    this.authCb?.(this.user);
  }
  async signInGoogle() { throw new Error('デモモードではGoogleログインは使えません'); }
  async signOut() {
    this.s.users[this.uid].signedIn = false;
    await this.save();
    this.user = null;
    this.authCb?.(null);
  }

  watchProfile(cb) {
    return this.sub(() => { const u = this.s.users[this.uid]; cb(u?.name ? structuredClone(u) : null); });
  }
  saveProfile(p) { this.s.users[this.uid] = { ...this.s.users[this.uid], ...structuredClone(p) }; return this.save(); }

  watchLogs(cb) {
    return this.sub(() => cb(Object.entries(this.s.logs).filter(([, l]) => l.members.includes(this.uid)).map(([id, l]) => ({ id, ...structuredClone(l) }))));
  }
  async createLog({ name, emoji, color, info }) {
    const id = 'l' + Date.now().toString(36);
    const code = genCode();
    this.s.logs[id] = { name, emoji, color, owner: this.uid, members: [this.uid], info: { [this.uid]: info }, code, locked: false, muted: {}, createdAt: Date.now() };
    this.s.codes[code] = { logId: id, name, emoji };
    await this.save();
    return id;
  }
  async previewCode(code) { return this.s.codes[code] ? { ...this.s.codes[code] } : null; }
  async joinByCode(code, info) {
    const cd = this.s.codes[code];
    if (!cd) throw new Error('招待コードが見つかりません');
    const l = this.s.logs[cd.logId];
    if (l.locked || l.members.length >= MAX_MEMBERS) throw new Error('参加できませんでした（満員・参加受付停止中）');
    if (!l.members.includes(this.uid)) l.members.push(this.uid);
    l.info[this.uid] = info;
    await this.save();
    return cd.logId;
  }
  updateLog(id, patch) { Object.assign(this.s.logs[id], structuredClone(patch)); return this.save(); }
  setMyInfo(id, info) { this.s.logs[id].info[this.uid] = info; return this.save(); }
  setMute(id, on) { this.s.logs[id].muted[this.uid] = !!on; return this.save(); }
  leaveLog(id) { const l = this.s.logs[id]; l.members = l.members.filter((u) => u !== this.uid); return this.save(); }
  removeMember(id, uid) { const l = this.s.logs[id]; l.members = l.members.filter((u) => u !== uid); return this.save(); }
  async regenCode(id, old) {
    const code = genCode();
    delete this.s.codes[old];
    this.s.codes[code] = { logId: id, name: this.s.logs[id].name, emoji: this.s.logs[id].emoji };
    this.s.logs[id].code = code;
    await this.save();
    return code;
  }

  watchClips(logId, from, to, cb) {
    return this.sub(() => cb(Object.values(this.s.clips[logId] || {}).filter((c) => c.date >= from && c.date <= to).map((c) => structuredClone(c))));
  }
  async dayInfo(logId, date) {
    const cs = Object.values(this.s.clips[logId] || {}).filter((c) => c.date === date);
    return { count: cs.length, mine: cs.filter((c) => c.uid === this.uid).length, cover: cs[0]?.thumb || null };
  }
  async getMedia(logId, clipId) { return idbOp('readonly', (st) => st.get(logId + '/' + clipId)); }
  async postClip(logId, clip, media) {
    const id = clipIdOf(clip.date, clip.slot, this.uid);
    if (this.s.clips[logId]?.[id]) throw new Error('この時間はもう投稿済みです');
    await idbOp('readwrite', (st) => st.put({ uid: this.uid, ...media }, logId + '/' + id));
    (this.s.clips[logId] ||= {})[id] = { id, ...clip, uid: this.uid, reactions: {}, createdAt: Date.now() };
    await this.save();
    // 架空の友だちが少ししてリアクション
    const l = this.s.logs[logId];
    const bots = l.members.filter((u) => u.startsWith('f'));
    bots.slice(0, 2 + Math.floor(Math.random() * 2)).forEach((b, i) => setTimeout(() => {
      this.load();
      const c = this.s.clips[logId]?.[id];
      if (!c) return;
      c.reactions[b] = REACTIONS[Math.floor(Math.random() * REACTIONS.length)];
      this.save();
    }, 2500 + i * 1800));
    return id;
  }
  async deleteClip(logId, clipId) {
    delete this.s.clips[logId]?.[clipId];
    await idbOp('readwrite', (st) => st.delete(logId + '/' + clipId));
    return this.save();
  }
  react(logId, clipId, emoji) {
    const c = this.s.clips[logId][clipId];
    if (emoji) c.reactions[this.uid] = emoji;
    else delete c.reactions[this.uid];
    return this.save();
  }

  watchMessages(logId, cb) { return this.sub(() => cb(structuredClone(this.s.messages[logId] || []))); }
  sendMessage(logId, m) {
    (this.s.messages[logId] ||= []).push({ id: 'm' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), ...structuredClone(m), uid: this.uid, createdAt: Date.now() });
    const r = this.save();
    const l = this.s.logs[logId];
    if (l?.members.includes('f2') && Math.random() < 0.7) {
      setTimeout(() => {
        this.load();
        const replies = ['それな', 'わかる〜', 'ｗｗｗ', 'いいね！', '今それ見てた', '😂😂'];
        (this.s.messages[logId] ||= []).push({ id: 'm' + Date.now().toString(36), uid: 'f2', text: replies[Math.floor(Math.random() * replies.length)], createdAt: Date.now() });
        this.save();
      }, 2200);
    }
    return r;
  }
  deleteMessage(logId, id) { this.s.messages[logId] = (this.s.messages[logId] || []).filter((m) => m.id !== id); return this.save(); }
  async poke() { /* デモでは送信のみ */ }

  // 架空の友だちとサンプルのログを作る（今日と過去3日分）
  async seed() {
    this.s.seeded = true;
    const info = Object.fromEntries(FRIENDS.map(([id, name, emoji, color]) => [id, { name, emoji, color }]));
    const id = 'demo1';
    this.s.logs[id] = { name: 'ねむい組', emoji: '🌙', color: '#8a6cff', owner: 'f1', members: [...FRIENDS.map((f) => f[0]), this.uid], info: { ...info, [this.uid]: { name: 'わたし', emoji: '😀', color: '#4d9dff' } }, code: 'DEMO42', locked: false, muted: {}, createdAt: Date.now() };
    this.s.codes.DEMO42 = { logId: id, name: 'ねむい組', emoji: '🌙' };
    const clips = (this.s.clips[id] = {});
    const now = slotOf();
    const puts = [];
    let n = 0;
    for (let dd = 3; dd >= 0; dd--) {
      const date = addDaysKey(dateKey(), -dd);
      const last = dd === 0 ? now.hour - 1 : 23;
      for (let h = 8; h <= last; h++) {
        for (const [uid] of FRIENDS) {
          if ((h * 7 + uid.charCodeAt(1) * 3 + dd) % 5 > 1) continue; // まばらに投稿
          const sc = SCENES[(h + uid.charCodeAt(1) + dd) % SCENES.length];
          const cid = clipIdOf(date, pad2(h), uid);
          const data = demoImage(n++, sc[1], sc[0], sc[2], sc[3], h);
          const reactions = {};
          FRIENDS.forEach(([o], k) => { if (o !== uid && (h + k + dd) % 3 === 0) reactions[o] = REACTIONS[(h + k) % REACTIONS.length]; });
          clips[cid] = { id: cid, date, slot: pad2(h), uid, caption: sc[1], thumb: data, mime: 'image/jpeg', reactions, createdAt: new Date(parseInt(date.slice(0, 4)), +date.slice(5, 7) - 1, +date.slice(8), h, 3 + (n % 40)).getTime() };
          puts.push([id + '/' + cid, { uid, data, mime: 'image/jpeg' }]);
        }
      }
    }
    this.s.messages[id] = [
      { id: 'm1', uid: 'f1', text: 'セットログ始めたよ〜 毎時撮ろ！', createdAt: Date.now() - 3600e3 * 5 },
      { id: 'm2', uid: 'f4', text: 'らじゃ', createdAt: Date.now() - 3600e3 * 4.9 },
      { id: 'm3', uid: 'f3', text: '通知きたら即撮るルールね', createdAt: Date.now() - 3600e3 * 2 },
    ];
    await idbOp('readwrite', (st) => { for (const [k, v] of puts) st.put(v, k); });
    await this.save();
  }
}

export { DEFAULT_NOTIFY };
