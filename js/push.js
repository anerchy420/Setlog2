// 通知：プッシュ通知の購読（サーバーから毎時届く）と、画面を開いているときの端末内通知
import { VAPID_PUBLIC_KEY } from './firebase-config.js';
import { hashStr } from './logic.js';

export const isIOS = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
export const isStandalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
export const notifSupported = () => 'Notification' in window && 'serviceWorker' in navigator;
export const pushSupported = () => notifSupported() && 'PushManager' in window && !!VAPID_PUBLIC_KEY;
export const permission = () => (notifSupported() ? Notification.permission : 'unsupported');

function b64ToBytes(b64) {
  const pad = '='.repeat((4 - (b64.length % 4)) % 4);
  const s = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(s, (c) => c.charCodeAt(0));
}

// 通知を許可してプッシュを購読。戻り値 { ok, sub(JSON), key, reason }
export async function enablePush() {
  if (!notifSupported()) return { ok: false, reason: isIOS() && !isStandalone() ? 'ios-install' : 'unsupported' };
  const p = await Notification.requestPermission();
  if (p !== 'granted') return { ok: false, reason: 'denied' };
  if (!pushSupported()) return { ok: true, local: true };
  const reg = await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(VAPID_PUBLIC_KEY) });
  const json = sub.toJSON();
  return { ok: true, sub: json, key: 'p' + hashStr(json.endpoint).toString(36) };
}

export async function currentPushKey() {
  if (!pushSupported() || Notification.permission !== 'granted') return null;
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = await reg?.pushManager.getSubscription();
  return sub ? 'p' + hashStr(sub.endpoint).toString(36) : null;
}

export async function disablePush() {
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = await reg?.pushManager.getSubscription();
  if (!sub) return null;
  const key = 'p' + hashStr(sub.endpoint).toString(36);
  await sub.unsubscribe();
  return key;
}

export async function showLocal(title, body, { tag = 'setlog', url = './' } = {}) {
  if (permission() !== 'granted') return false;
  try {
    const reg = await navigator.serviceWorker.getRegistration();
    if (reg) await reg.showNotification(title, { body, tag, renotify: true, icon: 'icon-192.png', badge: 'icon-192.png', data: { url } });
    else new Notification(title, { body, tag });
    return true;
  } catch {
    return false;
  }
}
