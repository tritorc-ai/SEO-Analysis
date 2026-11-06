// Read-only API for the dashboard. Listens on 127.0.0.1 only (this PC). Holds the only copy of the Atlas credentials.
import http from 'node:http';
import { cfg, log } from './config.js';
import { getDb } from './db.js';
import { buildState } from './state.js';

let cache = null, cacheAt = 0, building = null;
async function state() {
  if (cache && Date.now() - cacheAt < 60_000) return cache;
  if (!building) building = (async () => { try { cache = await buildState(await getDb()); cacheAt = Date.now(); return cache; } finally { building = null; } })();
  return building;
}

const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Private-Network', 'true');
  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
  const url = new URL(req.url, 'http://localhost');
  try {
    if (req.method === 'GET' && url.pathname === '/api/health') {
      const db = await getDb(); await db.command({ ping: 1 });
      res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ ok: true, db: cfg.dbName, time: new Date().toISOString() }));
    }
    if (req.method === 'GET' && url.pathname === '/api/state') {
      if (url.searchParams.get('fresh') === '1') cache = null;
      const s = await state();
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); return res.end(JSON.stringify(s));
    }
    res.writeHead(404, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'not found' }));
  } catch (e) {
    log('request error:', e.message);
    res.writeHead(500, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'server error' }));
  }
});
server.listen(cfg.port, '127.0.0.1', () => log(`TRITORC backend listening on http://127.0.0.1:${cfg.port}  (db: ${cfg.dbName})`));
