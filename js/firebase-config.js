// Firebaseコンソール「プロジェクトの設定 → マイアプリ → SDKの設定と構成 → Config」の値を貼ります。
// apiKey が空のあいだは「デモモード」（この端末だけで動き、架空の友だちが投稿します）。
// ※この値は公開されて問題ない種類のものです（データは Firestore ルールで保護）。
export const FIREBASE_CONFIG = {
  apiKey: '',
  authDomain: '',
  projectId: '',
  storageBucket: '',
  messagingSenderId: '',
  appId: '',
};

// プッシュ通知用の公開鍵（README の「通知の設定」で作る VAPID 公開鍵）
export const VAPID_PUBLIC_KEY = '';
