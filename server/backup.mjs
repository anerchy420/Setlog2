// バックアップ：data/backups/日時/ にデータベースと動画をコピー（サーバーを動かしたままでOK）
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const envFile = path.join(ROOT, '.env');
let dataDir = 'data';
if (fs.existsSync(envFile)) {
  const m = fs.readFileSync(envFile, 'utf8').match(/^\s*DATA_DIR\s*=\s*(.+?)\s*$/m);
  if (m) dataDir = m[1].replace(/^["']|["']$/g, '');
}
const DATA = path.resolve(ROOT, process.env.DATA_DIR || dataDir);
const stamp = new Date().toISOString().slice(0, 19).replace(/[-:T]/g, '').replace(/^(\d{8})/, '$1-');
const out = path.join(DATA, 'backups', stamp);
fs.mkdirSync(out, { recursive: true });
const db = new DatabaseSync(path.join(DATA, 'setlog.db'));
db.exec(`VACUUM INTO '${path.join(out, 'setlog.db').replace(/'/g, "''")}'`);
db.close();
fs.cpSync(path.join(DATA, 'media'), path.join(out, 'media'), { recursive: true });
console.log('バックアップしました:', out);
console.log('戻すとき：サーバーを止めて、この中の setlog.db と media/ を', DATA, 'に上書きコピー');
