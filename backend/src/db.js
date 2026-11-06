import { MongoClient } from 'mongodb';
import { cfg } from './config.js';

// Special characters in the password (@ # / : ? ...) must be URL-encoded; do it automatically.
function fixUri(uri) {
  const m = /^(mongodb(?:\+srv)?:\/\/)([^:/@]*):(.*)@([^/@?]+)(\/[^?]*)?(\?.*)?$/.exec(uri || '');
  if (!m) return uri;
  let pw = m[3];
  if (!/%[0-9a-f]{2}/i.test(pw)) pw = encodeURIComponent(pw);
  return m[1] + m[2] + ':' + pw + '@' + m[4] + (m[5] || '') + (m[6] || '');
}

let client, db;
export async function getDb() {
  if (db) return db;
  if (!cfg.mongoUri) throw new Error('MONGODB_URI is not set in .env');
  let lastErr;
  for (let attempt = 1; attempt <= 3; attempt++) {   // DNS / network hiccups are retried
    try {
      client = new MongoClient(fixUri(cfg.mongoUri), { serverSelectionTimeoutMS: 15000 });
      await client.connect();
      db = client.db(cfg.dbName);
      return db;
    } catch (e) { lastErr = e; try { await client?.close(); } catch {} await new Promise((r) => setTimeout(r, 1500 * attempt)); }
  }
  throw lastErr;
}
export async function closeDb() { if (client) await client.close(); client = db = undefined; }
