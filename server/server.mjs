// setlog2 サーバー（自宅PCなどで動かし、Cloudflare Tunnel で公開する）
//  ・画面ファイルの配信、API、リアルタイム更新（Server-Sent Events）、プッシュ通知をこれ1つで行う
//  ・データは DATA_DIR（既定 ./data）に保存：setlog.db（SQLite）と media/（動画）
// 起動: npm run server   設定: .env（.env.example 参照）
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import webpush from 'web-push';
import {
  localParts, hourlyDue, remindDue, DEFAULT_NOTIFY, slotLabel, genCode, MAX_MEMBERS, clipIdOf, isActiveHour, addDaysKey,
} from '../js/logic.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
loadEnv(path.join(ROOT, '.env'));
const env = process.env;
const PORT = +env.PORT || 8787;
const HOST = env.HOST || '127.0.0.1'; // Cloudflare Tunnel から来るので外部には開けない
const DATA = path.resolve(ROOT, env.DATA_DIR || 'data');
const SIGNUP_CODE = (env.SIGNUP_CODE || '').trim(); // 設定するとアカウント作成に合言葉が必要
const RETENTION_DAYS = +env.RETENTION_DAYS || 0; // 0=無期限
const TZ = env.DEFAULT_TZ || 'Asia/Tokyo';
const PUBLIC_URL = (env.PUBLIC_URL || '').replace(/\/$/, '');

fs.mkdirSync(path.join(DATA, 'media'), { recursive: true });

function loadEnv(file) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}
const log = (...a) => console.log(new Date().toISOString().slice(0, 19).replace('T', ' '), ...a);

// ---------------- データベース ----------------
const db = new DatabaseSync(path.join(DATA, 'setlog.db'));
db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA synchronous = NORMAL;
  PRAGMA foreign_keys = ON;
  CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, profile TEXT NOT NULL DEFAULT '{}', created INTEGER NOT NULL, last_hourly TEXT, last_remind TEXT);
  CREATE TABLE IF NOT EXISTS tokens (hash TEXT PRIMARY KEY, user TEXT NOT NULL, created INTEGER NOT NULL, ua TEXT);
  CREATE TABLE IF NOT EXISTS push (user TEXT NOT NULL, key TEXT NOT NULL, sub TEXT NOT NULL, created INTEGER, PRIMARY KEY (user, key));
  CREATE TABLE IF NOT EXISTS logs (id TEXT PRIMARY KEY, data TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS codes (code TEXT PRIMARY KEY, log TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS clips (log TEXT NOT NULL, id TEXT NOT NULL, uid TEXT NOT NULL, date TEXT NOT NULL, slot TEXT NOT NULL, created INTEGER NOT NULL, data TEXT NOT NULL, PRIMARY KEY (log, id));
  CREATE INDEX IF NOT EXISTS clips_by_date ON clips (log, date);
  CREATE INDEX IF NOT EXISTS clips_by_user ON clips (uid, date, slot);
  CREATE TABLE IF NOT EXISTS messages (id TEXT PRIMARY KEY, log TEXT NOT NULL, uid TEXT NOT NULL, created INTEGER NOT NULL, data TEXT NOT NULL);
  CREATE INDEX IF NOT EXISTS messages_by_log ON messages (log, created);
  CREATE TABLE IF NOT EXISTS transfers (code TEXT PRIMARY KEY, user TEXT NOT NULL, expires INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT NOT NULL);
`);
const q = (sql) => db.prepare(sql);
const kvGet = (k) => q('SELECT v FROM kv WHERE k = ?').get(k)?.v;
const kvSet = (k, v) => q('INSERT INTO kv (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v').run(k, v);
const J = (s, d = null) => { try { return JSON.parse(s); } catch { return d; } };
const tx = (fn) => { db.exec('BEGIN'); try { const r = fn(); db.exec('COMMIT'); return r; } catch (e) { db.exec('ROLLBACK'); throw e; } };

// ログはメモリにも持つ（少人数向け・高速）
const logs = new Map(q('SELECT id, data FROM logs').all().map((r) => [r.id, J(r.data)]));
const saveLog = (id) => q('INSERT INTO logs (id, data) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data').run(id, JSON.stringify(logs.get(id)));
const logsOf = (uid) => [...logs.entries()].filter(([, l]) => l.members.includes(uid)).map(([id, l]) => ({ id, ...l }));

// プッシュ通知の鍵（初回に自動作成）
let vapid = J(kvGet('vapid'));
if (!vapid) { vapid = webpush.generateVAPIDKeys(); kvSet('vapid', JSON.stringify(vapid)); }
webpush.setVapidDetails(env.VAPID_SUBJECT || (PUBLIC_URL.startsWith('https://') ? PUBLIC_URL : 'mailto:admin@example.com'), vapid.publicKey, vapid.privateKey);

// ---------------- ユーティリティ ----------------
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const rid = (n = 16) => crypto.randomBytes(n).toString('base64url');
const isId = (s) => typeof s === 'string' && /^[A-Za-z0-9_-]{1,80}$/.test(s);
const isDate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
const str = (v, max) => (typeof v === 'string' ? v.slice(0, max) : '');
const cleanName = (v) => str(v, 40).replace(/\s+/g, ' ').trim().slice(0, 20);
const color = (v) => (typeof v === 'string' && /^#[0-9a-fA-F]{3,8}$/.test(v) ? v : '#8d99ae');
const emoji = (v) => str(v, 16) || '🙂';
const photo = (v) => (typeof v === 'string' && v.startsWith('data:image/') && v.length < 60_000 ? v : null);
class HttpError extends Error { constructor(status, msg) { super(msg); this.status = status; } }
const fail = (status, msg) => { throw new HttpError(status, msg); };

function userInfo(p) {
  return { name: cleanName(p.name), emoji: emoji(p.emoji), color: color(p.color), ...(photo(p.photo) ? { photo: p.photo } : {}) };
}
function getUser(uid) {
  const r = q('SELECT * FROM users WHERE id = ?').get(uid);
  return r ? { ...r, profile: J(r.profile, {}) } : null;
}
function profileOut(u) {
  const push = Object.fromEntries(q('SELECT key, sub FROM push WHERE user = ?').all(u.id).map((r) => [r.key, { endpoint: J(r.sub)?.endpoint }]));
  return { ...u.profile, push };
}
function needLog(id, uid) {
  const l = isId(id) && logs.get(id);
  if (!l || !l.members.includes(uid)) fail(404, 'ログが見つかりません');
  return l;
}
function clipOut(r) {
  return { id: r.id, uid: r.uid, date: r.date, slot: r.slot, createdAt: r.created, ...J(r.data, {}) };
}

// 簡易レート制限（IPごと）
const buckets = new Map();
function limit(key, max, perMs) {
  const now = Date.now();
  const b = buckets.get(key) || { n: 0, t: now };
  if (now - b.t > perMs) { b.n = 0; b.t = now; }
  b.n++;
  buckets.set(key, b);
  if (b.n > max) fail(429, '少し時間をおいてからもう一度お試しください');
}
setInterval(() => { const now = Date.now(); for (const [k, b] of buckets) if (now - b.t > 3600e3) buckets.delete(k); }, 600e3).unref();

// ---------------- リアルタイム（SSE） ----------------
const streams = new Map(); // uid -> Set(res)
function emit(uids, ev) {
  const data = `data: ${JSON.stringify(ev)}\n\n`;
  for (const u of new Set(uids)) for (const res of streams.get(u) || []) res.write(data);
}
setInterval(() => { for (const set of streams.values()) for (const res of set) res.write(': ping\n\n'); }, 25e3).unref();

// ---------------- プッシュ通知 ----------------
const pref = (u) => ({ ...DEFAULT_NOTIFY, ...(u?.profile?.notify || {}) });
const recentPush = new Map();
async function push(uid, msg, { throttle = 20e3 } = {}) {
  const k = uid + '|' + msg.tag;
  const now = Date.now();
  if (throttle && now - (recentPush.get(k) || 0) < throttle) return;
  recentPush.set(k, now);
  for (const r of q('SELECT key, sub FROM push WHERE user = ?').all(uid)) {
    try {
      await webpush.sendNotification(J(r.sub), JSON.stringify(msg), { TTL: msg.tag === 'hourly' ? 1800 : 3600, urgency: 'high' });
    } catch (e) {
      if (e.statusCode === 404 || e.statusCode === 410) q('DELETE FROM push WHERE user = ? AND key = ?').run(uid, r.key);
      else log('通知の送信に失敗', uid, e.statusCode || e.message);
    }
  }
}
const pushMany = (uids, mk) => { for (const u of uids) push(u, mk(u)).catch(() => {}); };

// 毎時・リマインド（30秒ごとに確認）
function hourlyTick() {
  const now = Date.now();
  const users = q('SELECT u.* FROM users u WHERE EXISTS (SELECT 1 FROM push p WHERE p.user = u.id)').all();
  for (const r of users) {
    const u = { ...r, profile: J(r.profile, {}) };
    if (!logsOf(u.id).length) continue;
    const parts = localParts(now, u.profile.tz || TZ);
    const key = `${parts.date}_${parts.slot}`;
    if (hourlyDue(u.profile.notify, u.last_hourly, parts)) {
      q('UPDATE users SET last_hourly = ? WHERE id = ?').run(key, u.id);
      push(u.id, { title: `📸 ${slotLabel(parts.slot)} 今の瞬間を撮ろう`, body: '2秒だけ、今を残そう', tag: 'hourly', url: './#cam' }, { throttle: 0 }).catch(() => {});
    }
    const posted = !!q('SELECT 1 FROM clips WHERE uid = ? AND date = ? AND slot = ? LIMIT 1').get(u.id, parts.date, parts.slot);
    if (remindDue(u.profile.notify, u.last_remind, parts, posted)) {
      q('UPDATE users SET last_remind = ? WHERE id = ?').run(key, u.id);
      push(u.id, { title: `⏰ ${slotLabel(parts.slot)}の枠はあと${60 - parts.minute}分`, body: 'みんな撮ってるよ。今のうちに2秒だけ', tag: 'remind', url: './#cam' }, { throttle: 0 }).catch(() => {});
    }
  }
}

// 古い動画の自動削除（RETENTION_DAYS を設定したとき）
function cleanup() {
  if (!RETENTION_DAYS) return;
  const before = addDaysKey(localParts(Date.now(), TZ).date, -RETENTION_DAYS);
  const old = q('SELECT log, id FROM clips WHERE date < ?').all(before);
  for (const c of old) {
    removeMedia(c.log, c.id);
    q('DELETE FROM clips WHERE log = ? AND id = ?').run(c.log, c.id);
  }
  q('DELETE FROM transfers WHERE expires < ?').run(Date.now());
  if (old.length) log(`古い動画 ${old.length} 本を削除しました`);
}

// ---------------- 動画ファイル ----------------
const EXT = { 'video/mp4': 'mp4', 'video/webm': 'webm', 'image/jpeg': 'jpg' };
const mediaPath = (logId, clipId, ext) => path.join(DATA, 'media', logId, `${clipId}.${ext}`);
function removeMedia(logId, clipId) {
  for (const ext of Object.values(EXT)) fs.rm(mediaPath(logId, clipId, ext), { force: true }, () => {});
}
function parseDataUrl(s, maxBytes) {
  const m = typeof s === 'string' && s.match(/^data:([a-z]+\/[a-z0-9.+-]+)(?:;[^,]*)?;base64,(.+)$/);
  if (!m) fail(400, 'データの形式が正しくありません');
  const buf = Buffer.from(m[2], 'base64');
  if (buf.length > maxBytes) fail(413, '大きすぎます');
  return { mime: m[1], buf };
}

// ---------------- API ----------------
const routes = [];
const route = (method, pattern, fn, { auth = true } = {}) => routes.push({ method, re: new RegExp('^' + pattern.replace(/:(\w+)/g, '(?<$1>[^/]+)') + '$'), fn, auth });

route('GET', '/api/config', () => ({ ok: true, version: 1, vapidPublicKey: vapid.publicKey, signupCode: !!SIGNUP_CODE, maxMembers: MAX_MEMBERS }), { auth: false });
route('GET', '/api/health', () => ({ ok: true, users: q('SELECT COUNT(*) n FROM users').get().n, logs: logs.size }), { auth: false });

route('POST', '/api/signup', ({ body, ip, req }) => {
  limit('signup:' + ip, 10, 3600e3);
  if (SIGNUP_CODE && str(body.signupCode, 100).trim() !== SIGNUP_CODE) fail(403, '合言葉が違います');
  const id = 'u' + rid(9);
  const token = rid(32);
  tx(() => {
    q('INSERT INTO users (id, created) VALUES (?, ?)').run(id, Date.now());
    q('INSERT INTO tokens (hash, user, created, ua) VALUES (?, ?, ?, ?)').run(sha(token), id, Date.now(), str(req.headers['user-agent'], 200));
  });
  log('新しいアカウント', id);
  return { uid: id, token };
}, { auth: false });

// 引き継ぎ（別の端末で同じアカウントを使う）
route('POST', '/api/transfer', ({ uid }) => {
  const code = genCode(8);
  q('INSERT INTO transfers (code, user, expires) VALUES (?, ?, ?)').run(code, uid, Date.now() + 15 * 60e3);
  return { code, expires: Date.now() + 15 * 60e3 };
});
route('POST', '/api/transfer/redeem', ({ body, ip, req }) => {
  limit('redeem:' + ip, 10, 600e3);
  const code = str(body.code, 20).toUpperCase().replace(/[^A-Z0-9]/g, '');
  const t = q('SELECT * FROM transfers WHERE code = ?').get(code);
  if (!t || t.expires < Date.now()) fail(404, 'コードが見つからないか、期限切れです');
  q('DELETE FROM transfers WHERE code = ?').run(code);
  const token = rid(32);
  q('INSERT INTO tokens (hash, user, created, ua) VALUES (?, ?, ?, ?)').run(sha(token), t.user, Date.now(), str(req.headers['user-agent'], 200));
  return { uid: t.user, token };
}, { auth: false });
route('POST', '/api/logout', ({ token }) => { q('DELETE FROM tokens WHERE hash = ?').run(sha(token)); return { ok: true }; });

route('GET', '/api/me', ({ user }) => ({ uid: user.id, profile: user.profile.name ? profileOut(user) : null }));
route('PATCH', '/api/me', ({ user, body }) => {
  const p = { ...user.profile };
  if ('name' in body) p.name = cleanName(body.name);
  if ('emoji' in body) p.emoji = emoji(body.emoji);
  if ('color' in body) p.color = color(body.color);
  if ('photo' in body) p.photo = photo(body.photo);
  if ('tz' in body && typeof body.tz === 'string') { try { localParts(0, body.tz); p.tz = body.tz; } catch { /* 不正なタイムゾーン */ } }
  if (body.notify && typeof body.notify === 'object') {
    const n = { ...DEFAULT_NOTIFY, ...(p.notify || {}) };
    for (const k of Object.keys(DEFAULT_NOTIFY)) if (k in body.notify) n[k] = typeof DEFAULT_NOTIFY[k] === 'number' ? Math.max(0, Math.min(23, +body.notify[k] || 0)) : !!body.notify[k];
    p.notify = n;
  }
  if (body.posted && typeof body.posted === 'object') {
    p.posted = { ...(p.posted || {}) };
    for (const k of Object.keys(body.posted)) if (isDate(k)) p.posted[k] = true;
  }
  if (!p.name) fail(400, '名前を入力してください');
  q('UPDATE users SET profile = ? WHERE id = ?').run(JSON.stringify(p), user.id);
  // 参加中のログの表示名も更新
  const info = userInfo(p);
  const changed = [];
  for (const [id, l] of logs) {
    if (!l.members.includes(user.id)) continue;
    if (JSON.stringify(l.info[user.id]) !== JSON.stringify(info)) { l.info[user.id] = info; saveLog(id); changed.push(...l.members); }
  }
  emit([user.id], { type: 'profile' });
  if (changed.length) emit(changed, { type: 'logs' });
  return { ok: true };
});
route('PUT', '/api/push/:key', ({ user, params, body }) => {
  const sub = body.sub;
  if (!isId(params.key) || !sub?.endpoint?.startsWith('https://') || !sub.keys?.p256dh || !sub.keys?.auth) fail(400, '購読情報が正しくありません');
  q('INSERT INTO push (user, key, sub, created) VALUES (?, ?, ?, ?) ON CONFLICT(user, key) DO UPDATE SET sub = excluded.sub').run(user.id, params.key, JSON.stringify({ endpoint: sub.endpoint, keys: sub.keys }), Date.now());
  if (typeof body.tz === 'string') {
    const p = { ...user.profile, tz: body.tz };
    q('UPDATE users SET profile = ? WHERE id = ?').run(JSON.stringify(p), user.id);
  }
  emit([user.id], { type: 'profile' });
  return { ok: true };
});
route('DELETE', '/api/push/:key', ({ user, params }) => { q('DELETE FROM push WHERE user = ? AND key = ?').run(user.id, params.key); return { ok: true }; });
route('POST', '/api/push/test', async ({ user }) => {
  await push(user.id, { title: '📸 テスト通知', body: 'こんな感じで毎時お知らせします', tag: 'test', url: './#home' }, { throttle: 0 });
  return { ok: true, devices: q('SELECT COUNT(*) n FROM push WHERE user = ?').get(user.id).n };
});

// ログ
route('GET', '/api/logs', ({ user }) => logsOf(user.id));
route('POST', '/api/logs', ({ user, body }) => {
  if (!user.profile.name) fail(400, '先にプロフィールを設定してください');
  if (logsOf(user.id).length >= 30) fail(400, '参加できるログは30個までです');
  const name = cleanName(body.name);
  if (!name) fail(400, '名前を入力してください');
  const id = 'l' + rid(9);
  let code;
  do { code = genCode(); } while (q('SELECT 1 FROM codes WHERE code = ?').get(code));
  logs.set(id, { name, emoji: emoji(body.emoji), color: color(body.color), owner: user.id, members: [user.id], info: { [user.id]: userInfo(user.profile) }, code, locked: false, muted: {}, createdAt: Date.now() });
  tx(() => { saveLog(id); q('INSERT INTO codes (code, log) VALUES (?, ?)').run(code, id); });
  emit([user.id], { type: 'logs' });
  return { id };
});
route('PATCH', '/api/logs/:id', ({ user, params, body }) => {
  const l = needLog(params.id, user.id);
  if ('name' in body) { const n = cleanName(body.name); if (n) l.name = n; }
  if ('emoji' in body) l.emoji = emoji(body.emoji);
  if ('color' in body) l.color = color(body.color);
  if ('locked' in body) { if (l.owner !== user.id) fail(403, '作成者だけが変更できます'); l.locked = !!body.locked; }
  saveLog(params.id);
  emit(l.members, { type: 'logs' });
  return { ok: true };
});
route('POST', '/api/logs/:id/mute', ({ user, params, body }) => {
  const l = needLog(params.id, user.id);
  l.muted[user.id] = !!body.on;
  saveLog(params.id);
  emit([user.id], { type: 'logs' });
  return { ok: true };
});
route('POST', '/api/logs/:id/leave', ({ user, params }) => {
  const l = needLog(params.id, user.id);
  const before = [...l.members];
  l.members = l.members.filter((u) => u !== user.id);
  if (l.owner === user.id && l.members.length) l.owner = l.members[0]; // 作成者が抜けたら次の人に
  saveLog(params.id);
  emit(before, { type: 'logs' });
  return { ok: true };
});
route('POST', '/api/logs/:id/kick', ({ user, params, body }) => {
  const l = needLog(params.id, user.id);
  if (l.owner !== user.id) fail(403, '作成者だけが外せます');
  if (body.uid === user.id) fail(400, '自分は外せません');
  const before = [...l.members];
  l.members = l.members.filter((u) => u !== body.uid);
  saveLog(params.id);
  emit(before, { type: 'logs' });
  return { ok: true };
});
route('POST', '/api/logs/:id/code', ({ user, params }) => {
  const l = needLog(params.id, user.id);
  if (l.owner !== user.id) fail(403, '作成者だけが変更できます');
  let code;
  do { code = genCode(); } while (q('SELECT 1 FROM codes WHERE code = ?').get(code));
  tx(() => {
    q('DELETE FROM codes WHERE log = ?').run(params.id);
    q('INSERT INTO codes (code, log) VALUES (?, ?)').run(code, params.id);
    l.code = code;
    saveLog(params.id);
  });
  emit(l.members, { type: 'logs' });
  return { code };
});
route('GET', '/api/codes/:code', ({ params, ip }) => {
  limit('code:' + ip, 60, 600e3);
  const r = q('SELECT log FROM codes WHERE code = ?').get(str(params.code, 10).toUpperCase());
  const l = r && logs.get(r.log);
  if (!l) return null;
  return { logId: r.log, name: l.name, emoji: l.emoji, count: l.members.length };
});
route('POST', '/api/join', ({ user, body, ip }) => {
  limit('join:' + ip, 30, 600e3);
  if (!user.profile.name) fail(400, '先にプロフィールを設定してください');
  const r = q('SELECT log FROM codes WHERE code = ?').get(str(body.code, 10).toUpperCase());
  const l = r && logs.get(r.log);
  if (!l) fail(404, '招待コードが見つかりません');
  if (!l.members.includes(user.id)) {
    if (l.locked) fail(403, 'このログは参加受付を停止しています');
    if (l.members.length >= MAX_MEMBERS) fail(403, `満員です（最大${MAX_MEMBERS}人）`);
    l.members.push(user.id);
  }
  l.info[user.id] = userInfo(user.profile);
  saveLog(r.log);
  emit(l.members, { type: 'logs' });
  pushMany(l.members.filter((u) => u !== user.id && !l.muted[u]), () => ({ title: `${l.emoji} ${l.name}`, body: `${l.info[user.id].name}が参加しました`, tag: 'join-' + r.log, url: `./#log/${r.log}` }));
  return { id: r.log };
});

// 動画
route('GET', '/api/logs/:id/clips', ({ user, params, query }) => {
  needLog(params.id, user.id);
  const from = query.get('from'), to = query.get('to') || from;
  if (!isDate(from) || !isDate(to)) fail(400, '日付が正しくありません');
  return q('SELECT * FROM clips WHERE log = ? AND date >= ? AND date <= ? ORDER BY created').all(params.id, from, to).map(clipOut);
});
route('GET', '/api/logs/:id/day/:date', ({ user, params }) => {
  needLog(params.id, user.id);
  if (!isDate(params.date)) fail(400, '日付が正しくありません');
  const all = q('SELECT COUNT(*) n FROM clips WHERE log = ? AND date = ?').get(params.id, params.date).n;
  const mine = q('SELECT COUNT(*) n FROM clips WHERE log = ? AND date = ? AND uid = ?').get(params.id, params.date, user.id).n;
  const first = q('SELECT data FROM clips WHERE log = ? AND date = ? ORDER BY created LIMIT 1').get(params.id, params.date);
  return { count: all, mine, cover: first ? J(first.data, {}).thumb : null };
});
route('POST', '/api/logs/:id/clips', ({ user, params, body }) => {
  const l = needLog(params.id, user.id);
  const { date, slot } = body;
  if (!isDate(date) || !/^([01]\d|2[0-3])$/.test(slot || '')) fail(400, '撮影枠が正しくありません');
  // 今の枠（または切り替わって10分以内の直前の枠）だけ投稿できる
  const tz = user.profile.tz || TZ;
  const okSlots = [localParts(Date.now(), tz), localParts(Date.now() - 10 * 60e3, tz)].map((p) => `${p.date}_${p.slot}`);
  if (!okSlots.includes(`${date}_${slot}`)) fail(400, 'この時間の枠はもう終わっています');
  const id = clipIdOf(date, slot, user.id);
  if (q('SELECT 1 FROM clips WHERE log = ? AND id = ?').get(params.id, id)) fail(409, 'この時間はもう投稿済みです');
  const media = parseDataUrl(body.media, 1_000_000);
  const ext = EXT[media.mime];
  if (!ext) fail(400, '対応していない形式です');
  const thumb = typeof body.thumb === 'string' && body.thumb.startsWith('data:image/jpeg') && body.thumb.length < 80_000 ? body.thumb : fail(400, 'サムネイルが正しくありません');
  fs.mkdirSync(path.join(DATA, 'media', params.id), { recursive: true });
  fs.writeFileSync(mediaPath(params.id, id, ext), media.buf);
  const data = { caption: str(body.caption, 60).replace(/\s+/g, ' ').trim().slice(0, 30), thumb, mime: media.mime, ontime: !!body.ontime, recordedAt: +body.recordedAt || Date.now(), reactions: {} };
  q('INSERT INTO clips (log, id, uid, date, slot, created, data) VALUES (?, ?, ?, ?, ?, ?, ?)').run(params.id, id, user.id, date, slot, Date.now(), JSON.stringify(data));
  emit(l.members, { type: 'clips', log: params.id, date });
  const nm = l.info[user.id]?.name || 'だれか';
  pushMany(l.members.filter((u) => u !== user.id && !l.muted[u] && pref(getUser(u)).friends), () => ({ title: `${l.emoji} ${l.name}`, body: `${nm}が${slotLabel(slot)}の瞬間を投稿${data.caption ? '「' + data.caption + '」' : ''}`, tag: 'post-' + params.id, url: `./#log/${params.id}` }));
  return { id };
});
route('GET', '/api/logs/:id/clips/:cid/media', ({ user, params, res, req }) => {
  needLog(params.id, user.id);
  const r = isId(params.cid) && q('SELECT data FROM clips WHERE log = ? AND id = ?').get(params.id, params.cid);
  if (!r) fail(404, '見つかりません');
  const mime = J(r.data, {}).mime;
  const file = mediaPath(params.id, params.cid, EXT[mime] || 'webm');
  if (!fs.existsSync(file)) fail(404, '見つかりません');
  sendFile(req, res, file, mime, 'private, max-age=31536000, immutable');
  return undefined;
});
route('DELETE', '/api/logs/:id/clips/:cid', ({ user, params }) => {
  const l = needLog(params.id, user.id);
  const r = isId(params.cid) && q('SELECT * FROM clips WHERE log = ? AND id = ?').get(params.id, params.cid);
  if (!r) fail(404, '見つかりません');
  if (r.uid !== user.id) fail(403, '自分の投稿だけ削除できます');
  q('DELETE FROM clips WHERE log = ? AND id = ?').run(params.id, params.cid);
  removeMedia(params.id, params.cid);
  emit(l.members, { type: 'clips', log: params.id, date: r.date });
  return { ok: true };
});
route('PUT', '/api/logs/:id/clips/:cid/react', ({ user, params, body }) => {
  const l = needLog(params.id, user.id);
  const r = isId(params.cid) && q('SELECT * FROM clips WHERE log = ? AND id = ?').get(params.id, params.cid);
  if (!r) fail(404, '見つかりません');
  const data = J(r.data, {});
  data.reactions ||= {};
  const e = body.emoji ? str(body.emoji, 16) : null;
  if (e) data.reactions[user.id] = e;
  else delete data.reactions[user.id];
  q('UPDATE clips SET data = ? WHERE log = ? AND id = ?').run(JSON.stringify(data), params.id, params.cid);
  emit(l.members, { type: 'clips', log: params.id, date: r.date });
  if (e && r.uid !== user.id && !l.muted[r.uid] && pref(getUser(r.uid)).reaction) {
    push(r.uid, { title: `${e} ${l.info[user.id]?.name || 'だれか'}がリアクション`, body: `${l.name}・${slotLabel(r.slot)}のあなたの動画`, tag: 'react-' + params.id, url: `./#log/${params.id}` }).catch(() => {});
  }
  return { ok: true };
});

// チャット・つつく
route('GET', '/api/logs/:id/messages', ({ user, params, query }) => {
  needLog(params.id, user.id);
  const n = Math.max(1, Math.min(300, +query.get('limit') || 150));
  return q('SELECT * FROM messages WHERE log = ? ORDER BY created DESC LIMIT ?').all(params.id, n).reverse().map((r) => ({ id: r.id, uid: r.uid, createdAt: r.created, ...J(r.data, {}) }));
});
route('POST', '/api/logs/:id/messages', ({ user, params, body, ip }) => {
  limit('msg:' + user.id, 60, 60e3);
  const l = needLog(params.id, user.id);
  const text = str(body.text, 500).trim();
  if (!text) fail(400, 'メッセージが空です');
  const data = { text };
  if (body.clip && isId(body.clip.id) && isDate(body.clip.date)) {
    const c = q('SELECT * FROM clips WHERE log = ? AND id = ?').get(params.id, body.clip.id);
    if (c) data.clip = { id: c.id, date: c.date, slot: c.slot, uid: c.uid, thumb: J(c.data, {}).thumb };
  }
  const id = 'm' + Date.now().toString(36) + rid(4);
  q('INSERT INTO messages (id, log, uid, created, data) VALUES (?, ?, ?, ?, ?)').run(id, params.id, user.id, Date.now(), JSON.stringify(data));
  emit(l.members, { type: 'messages', log: params.id });
  const nm = l.info[user.id]?.name || 'だれか';
  pushMany(l.members.filter((u) => u !== user.id && !l.muted[u] && pref(getUser(u)).chat), (u) => ({ title: `💬 ${l.name}`, body: `${nm}${data.clip?.uid === u ? '（あなたの動画に返信）' : ''}：${text.slice(0, 80)}`, tag: 'chat-' + params.id, url: `./#chat/${params.id}` }));
  return { id };
});
route('DELETE', '/api/logs/:id/messages/:mid', ({ user, params }) => {
  const l = needLog(params.id, user.id);
  const r = q('SELECT uid FROM messages WHERE id = ? AND log = ?').get(params.mid, params.id);
  if (!r) fail(404, '見つかりません');
  if (r.uid !== user.id) fail(403, '自分のメッセージだけ取り消せます');
  q('DELETE FROM messages WHERE id = ?').run(params.mid);
  emit(l.members, { type: 'messages', log: params.id });
  return { ok: true };
});
route('POST', '/api/logs/:id/pokes', ({ user, params, body }) => {
  const l = needLog(params.id, user.id);
  if (!l.members.includes(body.to) || body.to === user.id) fail(400, 'つつけません');
  limit(`poke:${user.id}:${body.to}`, 1, 30 * 60e3);
  if (pref(getUser(body.to)).poke) {
    push(body.to, { title: `👉 ${l.info[user.id]?.name || 'だれか'}につつかれた`, body: `${l.name}であなたの瞬間を待ってるよ`, tag: 'poke', url: './#cam' }, { throttle: 0 }).catch(() => {});
  }
  return { ok: true };
});

// ---------------- HTTPサーバー ----------------
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };
const PUBLIC = new Set(['index.html', 'sw.js', 'manifest.webmanifest', 'icon.svg', 'icon-180.png', 'icon-192.png', 'icon-512.png']);
const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'same-origin',
  'X-Frame-Options': 'DENY',
  'Permissions-Policy': 'camera=(self), microphone=(self), geolocation=()',
  'Content-Security-Policy': "default-src 'self'; script-src 'self' https://www.gstatic.com; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' data: blob:; connect-src 'self' data: blob: https://*.googleapis.com https://www.gstatic.com; worker-src 'self'; frame-ancestors 'none'; base-uri 'self'",
};

function sendFile(req, res, file, type, cache = 'no-cache') {
  const st = fs.statSync(file);
  const etag = `"${st.size.toString(36)}-${st.mtimeMs.toString(36)}"`;
  if (req.headers['if-none-match'] === etag) { res.writeHead(304, { ETag: etag }); res.end(); return; }
  const range = req.headers.range?.match(/^bytes=(\d*)-(\d*)$/);
  const head = { 'Content-Type': type, 'Cache-Control': cache, ETag: etag, 'Accept-Ranges': 'bytes', ...SECURITY_HEADERS };
  if (range) {
    const start = range[1] ? +range[1] : st.size - +range[2];
    const end = range[1] && range[2] ? Math.min(+range[2], st.size - 1) : st.size - 1;
    if (start >= st.size || start < 0) { res.writeHead(416, { 'Content-Range': `bytes */${st.size}` }); res.end(); return; }
    res.writeHead(206, { ...head, 'Content-Range': `bytes ${start}-${end}/${st.size}`, 'Content-Length': end - start + 1 });
    fs.createReadStream(file, { start, end }).pipe(res);
    return;
  }
  res.writeHead(200, { ...head, 'Content-Length': st.size });
  if (req.method === 'HEAD') res.end();
  else fs.createReadStream(file).pipe(res);
}

function serveStatic(req, res, pathname) {
  let rel = decodeURIComponent(pathname).replace(/^\/+/, '') || 'index.html';
  const ok = PUBLIC.has(rel) || /^(css|js)\/[A-Za-z0-9_-]+\.(css|js)$/.test(rel);
  if (!ok) rel = 'index.html'; // それ以外は画面を返す（ハッシュルーティング）
  const file = path.join(ROOT, rel);
  if (!fs.existsSync(file)) { res.writeHead(404); res.end('Not found'); return; }
  sendFile(req, res, file, TYPES[path.extname(file)] || 'application/octet-stream');
}

function readBody(req, max = 2_500_000) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > max) { reject(new HttpError(413, '大きすぎます')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      if (!size) return resolve({});
      const b = J(Buffer.concat(chunks).toString('utf8'));
      if (!b || typeof b !== 'object') reject(new HttpError(400, 'JSONが正しくありません'));
      else resolve(b);
    });
    req.on('error', reject);
  });
}
function authUser(token) {
  if (!token) return null;
  const t = q('SELECT user FROM tokens WHERE hash = ?').get(sha(token));
  return t ? getUser(t.user) : null;
}
const json = (res, status, obj) => {
  const s = JSON.stringify(obj ?? null);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...SECURITY_HEADERS });
  res.end(s);
};

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const ip = req.headers['cf-connecting-ip'] || req.socket.remoteAddress || '';
  try {
    if (!url.pathname.startsWith('/api/')) {
      if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); res.end(); return; }
      return serveStatic(req, res, url.pathname);
    }
    // リアルタイム更新
    if (url.pathname === '/api/events') {
      const user = authUser(url.searchParams.get('token'));
      if (!user) return json(res, 401, { error: 'ログインしてください' });
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
      res.write('retry: 3000\n\n: hello\n\n');
      if (!streams.has(user.id)) streams.set(user.id, new Set());
      streams.get(user.id).add(res);
      req.on('close', () => { streams.get(user.id)?.delete(res); });
      return;
    }
    const r = routes.find((x) => x.method === req.method && x.re.test(url.pathname));
    if (!r) return json(res, 404, { error: '見つかりません' });
    const params = url.pathname.match(r.re).groups || {};
    const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    const user = authUser(token);
    if (r.auth && !user) return json(res, 401, { error: 'ログインしてください' });
    const body = req.method === 'GET' || req.method === 'HEAD' ? {} : await readBody(req);
    const out = await r.fn({ req, res, url, query: url.searchParams, params, body, user, uid: user?.id, token, ip });
    if (out !== undefined) json(res, 200, out);
  } catch (e) {
    if (e instanceof HttpError) return json(res, e.status, { error: e.message });
    log('エラー', req.method, url.pathname, e);
    if (!res.headersSent) json(res, 500, { error: 'サーバーでエラーが起きました' });
  }
});

server.listen(PORT, HOST, () => {
  log(`setlog2 サーバー起動: http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}  データ: ${DATA}`);
  if (PUBLIC_URL) log(`公開URL: ${PUBLIC_URL}`);
  if (SIGNUP_CODE) log('アカウント作成には合言葉が必要です');
});
const timers = [setInterval(hourlyTick, 30e3), setInterval(cleanup, 6 * 3600e3)];
setTimeout(hourlyTick, 3000);
setTimeout(cleanup, 10e3);

function shutdown() {
  log('停止します');
  timers.forEach(clearInterval);
  for (const set of streams.values()) for (const res of set) res.end();
  server.close(() => { db.close(); process.exit(0); });
  setTimeout(() => process.exit(0), 3000).unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

export { server, db, isActiveHour };
