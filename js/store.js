// 保存層：この端末のブラウザ（localStorage）に保存。JSONで書き出し・読み込みできる
import { normalizeState } from './logic.js';

const KEY = 'setlog2';
const TIMER_KEY = 'setlog2.timer';

export function load() {
  try {
    return normalizeState(JSON.parse(localStorage.getItem(KEY)));
  } catch {
    return normalizeState(null);
  }
}

export function save(state) {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
    return true;
  } catch (e) {
    console.error(e);
    return false;
  }
}

export function loadTimer() {
  try {
    const t = JSON.parse(localStorage.getItem(TIMER_KEY));
    return t && t.end ? t : null;
  } catch {
    return null;
  }
}
export function saveTimer(t) {
  try {
    if (t) localStorage.setItem(TIMER_KEY, JSON.stringify(t));
    else localStorage.removeItem(TIMER_KEY);
  } catch { /* 保存できなくてもタイマーは動く */ }
}

// ブラウザにデータを消されにくくする
export async function requestPersist() {
  try {
    if (navigator.storage?.persist && !(await navigator.storage.persisted())) await navigator.storage.persist();
  } catch { /* 非対応 */ }
}
