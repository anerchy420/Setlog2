// サーバーのAPIテスト（一時フォルダにデータを作って実際に起動する）
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { localParts } from '../js/logic.js';

const PORT = 18000 + Math.floor(Math.random() * 2000);
const BASE = `http://127.0.0.1:${PORT}`;
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'setlog2-test-'));
let proc;

const THUMB = 'data:image/jpeg;base64,' + Buffer.from('fakejpeg').toString('base64');
const VIDEO = 'data:video/webm;base64,' + Buffer.alloc(2000, 7).toString('base64');

async function api(token, method, p, body) {
  const r = await fetch(BASE + '/api/' + p, {
    method,
    headers: { ...(token ? { Authorization: 'Bearer ' + token } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const j = await r.json().catch(() => null);
  return { status: r.status, ...((j && typeof j === 'object' && !Array.isArray(j)) ? j : { data: j }) };
}
async function user(name, extra = {}) {
  const s = await api(null, 'POST', 'signup', extra);
  assert.equal(s.status, 200, JSON.stringify(s));
  const p = await api(s.token, 'PATCH', 'me', { name, emoji: '😀', color: '#ff0000', tz: 'Asia/Tokyo' });
  assert.equal(p.status, 200);
  return s;
}

test.before(async () => {
  proc = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'server/server.mjs'], {
    env: { ...process.env, PORT: String(PORT), DATA_DIR: DATA, SIGNUP_CODE: '' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let err = '';
  proc.stderr.on('data', (d) => { err += d; });
  for (let i = 0; i < 50; i++) {
    try { if ((await fetch(BASE + '/api/config')).ok) return; } catch { /* 起動待ち */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('サーバーが起動しませんでした ' + err);
});
test.after(() => { proc?.kill(); fs.rmSync(DATA, { recursive: true, force: true }); });

test('設定と画面ファイル', async () => {
  const c = await api(null, 'GET', 'config');
  assert.ok(c.ok && c.vapidPublicKey.length > 40);
  const html = await fetch(BASE + '/');
  assert.equal(html.status, 200);
  assert.match(html.headers.get('content-security-policy'), /default-src 'self'/);
  assert.match(await html.text(), /setlog2/);
  assert.equal((await fetch(BASE + '/js/logic.js')).status, 200);
  // 内部ファイルは見せない（画面を返す）
  const secret = await fetch(BASE + '/server/server.mjs');
  assert.match(await secret.text(), /<!doctype html>/i);
  assert.match(await (await fetch(BASE + '/data/setlog.db')).text(), /<!doctype html>/i);
  assert.equal((await api(null, 'GET', 'logs')).status, 401);
});

test('ログ作成・招待・投稿・リアクション・チャット・権限', async () => {
  const a = await user('あい');
  const b = await user('びー');
  const c = await user('しー');

  const lg = await api(a.token, 'POST', 'logs', { name: 'ねむい組', emoji: '🌙', color: '#8a6cff' });
  assert.equal(lg.status, 200);
  const logs = (await api(a.token, 'GET', 'logs')).data;
  assert.equal(logs.length, 1);
  const code = logs[0].code;
  assert.match(code, /^[A-Z2-9]{6}$/);

  const prev = await api(b.token, 'GET', 'codes/' + code);
  assert.equal(prev.name, 'ねむい組');
  assert.equal((await api(b.token, 'POST', 'join', { code })).id, lg.id);
  assert.equal((await api(b.token, 'POST', 'join', { code: 'ZZZZZZ' })).status, 404);

  // メンバー以外は見えない
  assert.equal((await api(c.token, 'GET', `logs/${lg.id}/clips?from=2026-01-01`)).status, 404);
  assert.equal((await api(c.token, 'GET', `logs/${lg.id}/messages`)).status, 404);

  // 投稿：今の枠だけ・1人1本
  const now = localParts(Date.now(), 'Asia/Tokyo');
  const clip = { date: now.date, slot: now.slot, caption: 'これがうまい', thumb: THUMB, mime: 'video/webm', media: VIDEO };
  const p1 = await api(b.token, 'POST', `logs/${lg.id}/clips`, clip);
  assert.equal(p1.status, 200, JSON.stringify(p1));
  assert.equal((await api(b.token, 'POST', `logs/${lg.id}/clips`, clip)).status, 409);
  const old = await api(a.token, 'POST', `logs/${lg.id}/clips`, { ...clip, date: '2020-01-01' });
  assert.equal(old.status, 400, '過去の枠には投稿できない');
  assert.equal((await api(c.token, 'POST', `logs/${lg.id}/clips`, clip)).status, 404);

  const list = (await api(a.token, 'GET', `logs/${lg.id}/clips?from=${now.date}`)).data;
  assert.equal(list.length, 1);
  assert.equal(list[0].caption, 'これがうまい');
  assert.equal(list[0].uid, b.uid);

  const media = await fetch(`${BASE}/api/logs/${lg.id}/clips/${p1.id}/media`, { headers: { Authorization: 'Bearer ' + a.token } });
  assert.equal(media.status, 200);
  assert.equal(media.headers.get('content-type'), 'video/webm');
  assert.equal((await media.arrayBuffer()).byteLength, 2000);
  const ranged = await fetch(`${BASE}/api/logs/${lg.id}/clips/${p1.id}/media`, { headers: { Authorization: 'Bearer ' + a.token, Range: 'bytes=0-99' } });
  assert.equal(ranged.status, 206);
  assert.equal((await fetch(`${BASE}/api/logs/${lg.id}/clips/${p1.id}/media`, { headers: { Authorization: 'Bearer ' + c.token } })).status, 404);

  // リアクション
  assert.equal((await api(a.token, 'PUT', `logs/${lg.id}/clips/${p1.id}/react`, { emoji: '😆' })).status, 200);
  let cl = (await api(a.token, 'GET', `logs/${lg.id}/clips?from=${now.date}`)).data[0];
  assert.deepEqual(cl.reactions, { [a.uid]: '😆' });
  await api(a.token, 'PUT', `logs/${lg.id}/clips/${p1.id}/react`, { emoji: null });
  cl = (await api(a.token, 'GET', `logs/${lg.id}/clips?from=${now.date}`)).data[0];
  assert.deepEqual(cl.reactions, {});

  // 削除は本人だけ
  assert.equal((await api(a.token, 'DELETE', `logs/${lg.id}/clips/${p1.id}`)).status, 403);

  // チャット（動画への返信つき）
  const m = await api(a.token, 'POST', `logs/${lg.id}/messages`, { text: 'それな', clip: { id: p1.id, date: now.date } });
  assert.equal(m.status, 200);
  const msgs = (await api(b.token, 'GET', `logs/${lg.id}/messages`)).data;
  assert.equal(msgs[0].text, 'それな');
  assert.equal(msgs[0].clip.uid, b.uid);
  assert.equal((await api(b.token, 'DELETE', `logs/${lg.id}/messages/${m.id}`)).status, 403);

  // カレンダー用
  const day = await api(a.token, 'GET', `logs/${lg.id}/day/${now.date}`);
  assert.equal(day.count, 1);
  assert.equal(day.mine, 0);

  // 作成者の操作：参加受付停止・コード変更・メンバーを外す
  assert.equal((await api(b.token, 'PATCH', `logs/${lg.id}`, { locked: true })).status, 403);
  await api(a.token, 'PATCH', `logs/${lg.id}`, { locked: true });
  assert.equal((await api(c.token, 'POST', 'join', { code })).status, 403);
  await api(a.token, 'PATCH', `logs/${lg.id}`, { locked: false });
  const nc = await api(a.token, 'POST', `logs/${lg.id}/code`);
  assert.equal((await api(c.token, 'POST', 'join', { code })).status, 404, '古いコードは使えない');
  assert.equal((await api(c.token, 'POST', 'join', { code: nc.code })).status, 200);
  await api(a.token, 'POST', `logs/${lg.id}/kick`, { uid: c.uid });
  assert.equal((await api(c.token, 'GET', `logs/${lg.id}/messages`)).status, 404);

  // プロフィールの変更がログの表示名に反映
  await api(b.token, 'PATCH', 'me', { name: 'びーちゃん' });
  const l2 = (await api(a.token, 'GET', 'logs')).data[0];
  assert.equal(l2.info[b.uid].name, 'びーちゃん');

  // 退出
  await api(b.token, 'POST', `logs/${lg.id}/leave`);
  assert.equal((await api(b.token, 'GET', 'logs')).data.length, 0);
});

test('引き継ぎコード', async () => {
  const a = await user('ひきつぎ');
  const t = await api(a.token, 'POST', 'transfer');
  assert.match(t.code, /^[A-Z2-9]{8}$/);
  const r = await api(null, 'POST', 'transfer/redeem', { code: t.code.toLowerCase() });
  assert.equal(r.uid, a.uid);
  assert.notEqual(r.token, a.token);
  assert.equal((await api(r.token, 'GET', 'me')).profile.name, 'ひきつぎ');
  assert.equal((await api(null, 'POST', 'transfer/redeem', { code: t.code })).status, 404, '1回だけ');
  await api(r.token, 'POST', 'logout');
  assert.equal((await api(r.token, 'GET', 'me')).status, 401);
  assert.equal((await api(a.token, 'GET', 'me')).status, 200, '元の端末はそのまま');
});

test('プッシュ購読の登録と不正な入力', async () => {
  const a = await user('つうち');
  const sub = { endpoint: 'https://push.example.com/abc', keys: { p256dh: 'x', auth: 'y' } };
  assert.equal((await api(a.token, 'PUT', 'push/pabc', { sub, tz: 'Asia/Tokyo' })).status, 200);
  assert.ok((await api(a.token, 'GET', 'me')).profile.push.pabc);
  assert.equal((await api(a.token, 'PUT', 'push/pabc', { sub: { endpoint: 'http://evil' } })).status, 400);
  assert.equal((await api(a.token, 'POST', 'logs', { name: '' })).status, 400);
  const big = await fetch(BASE + '/api/me', { method: 'PATCH', headers: { Authorization: 'Bearer ' + a.token, 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'x'.repeat(3_000_000) }) }).catch(() => ({ status: 413 }));
  assert.equal(big.status, 413);
});
