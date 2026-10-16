// 通知サーバー（GitHub Actions から5分おきに実行。Firebaseの無料プランのままで動く）
//  ・毎時：「20:00 今の瞬間を撮ろう」（各自の通知時間帯だけ）
//  ・毎時45分：まだ撮っていない人へリマインド
//  ・前回の実行以降の出来事：友だちの投稿 / チャット・返信 / リアクション / つつく
// 必要な環境変数: FIREBASE_SERVICE_ACCOUNT（JSON）, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT（mailto:…）
import admin from 'firebase-admin';
import webpush from 'web-push';
import { localParts, hourlyDue, remindDue, DEFAULT_NOTIFY, slotLabel } from '../js/logic.js';

const env = process.env;
if (!env.FIREBASE_SERVICE_ACCOUNT || !env.VAPID_PRIVATE_KEY || !env.VAPID_PUBLIC_KEY) {
  console.log('通知の設定（シークレット）がまだないため、何もしません。README の「通知の設定」を参照。');
  process.exit(0);
}
admin.initializeApp({ credential: admin.credential.cert(JSON.parse(env.FIREBASE_SERVICE_ACCOUNT)) });
webpush.setVapidDetails(env.VAPID_SUBJECT || 'mailto:admin@example.com', env.VAPID_PUBLIC_KEY, env.VAPID_PRIVATE_KEY);
const db = admin.firestore();
const now = Date.now();
const DRY = env.DRY_RUN === '1';

const metaRef = db.doc('meta/notifier');
const meta = (await metaRef.get()).data() || {};
const since = Math.max(meta.lastRun || 0, now - 30 * 60e3); // 長く止まっていても古い通知はまとめて出さない
const sinceTs = admin.firestore.Timestamp.fromMillis(since);
const nowTs = admin.firestore.Timestamp.fromMillis(now);

const [usersSnap, logsSnap] = await Promise.all([db.collection('users').get(), db.collection('logs').get()]);
const users = new Map(usersSnap.docs.map((d) => [d.id, d.data()]));
const logs = new Map(logsSnap.docs.map((d) => [d.id, d.data()]));
const name = (log, uid) => log?.info?.[uid]?.name || 'だれか';
const pref = (uid) => ({ ...DEFAULT_NOTIFY, ...(users.get(uid)?.notify || {}) });
const muted = (log, uid) => !!log?.muted?.[uid];

// ユーザーごとに送る通知をためる（1回の実行で1人あたり最大3件）
const outbox = new Map();
const queue = (uid, msg) => {
  if (!users.get(uid)?.push) return;
  const list = outbox.get(uid) || [];
  const same = list.find((m) => m.tag === msg.tag);
  if (same) { same.count = (same.count || 1) + 1; same.body = msg.body; return; }
  list.push(msg);
  outbox.set(uid, list);
};

// 1) 毎時の撮影通知とリマインド
const recent = await db.collectionGroup('clips').where('createdAt', '>=', admin.firestore.Timestamp.fromMillis(now - 60 * 60e3)).get();
const userUpdates = [];
for (const [uid, u] of users) {
  if (!u.push || !Object.keys(u.push).length) continue;
  const parts = localParts(now, u.tz || 'Asia/Tokyo');
  const key = `${parts.date}_${parts.slot}`;
  if (hourlyDue(u.notify, u.lastHourly, parts)) {
    queue(uid, { title: `📸 ${slotLabel(parts.slot)} 今の瞬間を撮ろう`, body: '2秒だけ、今を残そう', tag: 'hourly', url: './#cam' });
    userUpdates.push([uid, { lastHourly: key }]);
  }
  const posted = recent.docs.some((d) => { const c = d.data(); return c.uid === uid && c.date === parts.date && c.slot === parts.slot; });
  if (remindDue(u.notify, u.lastRemind, parts, posted)) {
    queue(uid, { title: `⏰ ${slotLabel(parts.slot)}の枠はあと${60 - parts.minute}分`, body: 'みんな撮ってるよ。今のうちに2秒だけ', tag: 'remind', url: './#cam' });
    userUpdates.push([uid, { lastRemind: key }]);
  }
}

// 2) 前回からの出来事
const [clips, msgs, pokes, reacts] = await Promise.all([
  db.collectionGroup('clips').where('createdAt', '>', sinceTs).where('createdAt', '<=', nowTs).get(),
  db.collectionGroup('messages').where('createdAt', '>', sinceTs).where('createdAt', '<=', nowTs).get(),
  db.collectionGroup('pokes').where('createdAt', '>', sinceTs).where('createdAt', '<=', nowTs).get(),
  db.collectionGroup('clips').where('reactedAt', '>', sinceTs).where('reactedAt', '<=', nowTs).get(),
]);
const logIdOf = (doc) => doc.ref.parent.parent.id;

for (const d of clips.docs) {
  const c = d.data(), lid = logIdOf(d), log = logs.get(lid);
  if (!log) continue;
  for (const m of log.members) {
    if (m === c.uid || muted(log, m) || !pref(m).friends) continue;
    queue(m, { title: `${log.emoji || ''} ${log.name}`, body: `${name(log, c.uid)}が${slotLabel(c.slot)}の瞬間を投稿${c.caption ? '「' + c.caption + '」' : ''}`, tag: 'post-' + lid, url: `./#log/${lid}` });
  }
}
for (const d of msgs.docs) {
  const m0 = d.data(), lid = logIdOf(d), log = logs.get(lid);
  if (!log) continue;
  for (const m of log.members) {
    if (m === m0.uid || muted(log, m) || !pref(m).chat) continue;
    const toMe = m0.clip?.uid === m;
    queue(m, { title: `💬 ${log.name}`, body: `${name(log, m0.uid)}${toMe ? '（あなたの動画に返信）' : ''}：${(m0.text || '').slice(0, 80)}`, tag: 'chat-' + lid, url: `./#chat/${lid}` });
  }
}
for (const d of pokes.docs) {
  const p = d.data(), lid = logIdOf(d), log = logs.get(lid);
  if (!log || !pref(p.to).poke) continue;
  queue(p.to, { title: `👉 ${name(log, p.from)}につつかれた`, body: `${log.name}で${slotLabel(p.slot || '00')}の瞬間を待ってるよ`, tag: 'poke', url: './#cam' });
}
for (const d of reacts.docs) {
  const c = d.data(), lid = logIdOf(d), log = logs.get(lid);
  const r = c.lastReact;
  if (!log || !r || r.uid === c.uid || muted(log, c.uid) || !pref(c.uid).reaction) continue;
  queue(c.uid, { title: `${r.emoji} ${name(log, r.uid)}がリアクション`, body: `${log.name}・${slotLabel(c.slot)}のあなたの動画`, tag: 'react-' + lid, url: `./#log/${lid}` });
}

// 3) 送信（無効になった購読は削除）
let sent = 0, removed = 0;
for (const [uid, list] of outbox) {
  const u = users.get(uid);
  for (const msg of list.slice(0, 3)) {
    const payload = JSON.stringify({ ...msg, body: msg.count > 1 ? `${msg.body}（ほか${msg.count - 1}件）` : msg.body });
    for (const [k, sub] of Object.entries(u.push || {})) {
      if (DRY) { console.log('[dry]', uid, payload); continue; }
      try {
        await webpush.sendNotification({ endpoint: sub.endpoint, keys: sub.keys }, payload, { TTL: msg.tag === 'hourly' ? 1800 : 3600, urgency: 'high' });
        sent++;
      } catch (e) {
        if (e.statusCode === 404 || e.statusCode === 410) {
          await db.doc(`users/${uid}`).update({ [`push.${k}`]: admin.firestore.FieldValue.delete() });
          removed++;
        } else console.error('送信失敗', uid, e.statusCode, e.body || e.message);
      }
    }
  }
}
if (!DRY) {
  for (const [uid, p] of userUpdates) await db.doc(`users/${uid}`).set(p, { merge: true });
  await metaRef.set({ lastRun: now }, { merge: true });
}
console.log(`送信 ${sent}件 / 無効な購読を削除 ${removed}件 / 対象ユーザー ${outbox.size}人`);
process.exit(0);
