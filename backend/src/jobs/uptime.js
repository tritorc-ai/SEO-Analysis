// UptimeRobot: daily uptime %, daily average response time and SSL certificate expiry for the site's monitors.
// Uses a READ-ONLY API key (UptimeRobot > Integrations & API > API > Read-only API key). Credentials are never logged.
// Stored in MongoDB: "uptime_daily" (one row per monitor and day) and "uptime_monitors" (latest status and SSL expiry per monitor).
import tls from 'node:tls';
import { cfg, ymd, addDays, dayDate, log } from '../config.js';

const API = 'https://api.uptimerobot.com/v2/getMonitors';
const num = (v) => { const x = +v; return Number.isFinite(x) ? x : null; };
const unixDay = (d) => Math.floor(Date.parse(d + 'T00:00:00Z') / 1000);
const toIso = (v) => {                                       // unix seconds, unix milliseconds or a date string -> YYYY-MM-DD; 0, empty and pre-2020 values mean "not available"
  if (v == null || v === '' || +v === 0) return null;
  const n = +v, t = Number.isFinite(n) && n > 0 ? (n > 1e12 ? n : n * 1000) : Date.parse(v);
  return Number.isFinite(t) && t >= Date.parse('2020-01-01T00:00:00Z') ? new Date(t).toISOString().slice(0, 10) : null;
};

// Reads all monitors with one daily uptime ratio per complete day (yesterday back `days` days), daily response times and SSL expiry.
export async function fetchMonitors(c, days, f = fetch, now = new Date()) {
  const dates = []; for (let i = days; i >= 1; i--) dates.push(ymd(addDays(now, -i)));
  const ranges = dates.map((d) => `${unixDay(d)}_${unixDay(d) + 86399}`).join('-');
  const respFrom = dates[Math.max(0, dates.length - 7)];          // the API allows at most 7 days of response times per request; each daily run adds the newest day
  const out = []; let offset = 0;
  for (let page = 0; page < 20; page++) {
    const r = await f(API, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Cache-Control': 'no-cache' },
      body: new URLSearchParams({ api_key: c.key, format: 'json', custom_uptime_ranges: ranges, response_times: '1', response_times_average: '1440',
        response_times_start_date: String(unixDay(respFrom)), response_times_end_date: String(unixDay(dates[dates.length - 1]) + 86399), ssl: '1', limit: '50', offset: String(offset) }) });
    const d = await r.json().catch(() => ({}));
    if (d.stat !== 'ok') throw new Error('UptimeRobot: ' + (d.error?.message || d.error?.type || ('HTTP ' + r.status)));
    for (const m of d.monitors || []) {
      const pct = String(m.custom_uptime_ranges || '').split('-'), resp = {};
      for (const x of m.response_times || []) { const day = toIso(x.datetime); if (day && num(x.value) != null) resp[day] = Math.round(num(x.value)); }
      // UptimeRobot reports 100% for days before a monitor existed, so only days AFTER the creation day count (the creation day is partial)
      const created = toIso(m.create_datetime);
      out.push({ id: String(m.id), name: m.friendly_name || String(m.id), url: m.url || '', status: m.status, sslExpires: toIso(m.ssl?.expires), created,
        daily: dates.map((date, i) => ({ date, uptimePct: num(pct[i]), avgResponseMs: resp[date] ?? null })).filter((x) => x.uptimePct != null && (!created || x.date > created)) });
    }
    const total = d.pagination?.total ?? out.length; offset += 50;
    if (offset >= total || !(d.monitors || []).length) break;
  }
  return out;
}

/* ---------- SSL certificate expiry straight from the site (free; UptimeRobot only offers it on paid plans) ---------- */
const realGetCert = (host) => new Promise((resolve, reject) => {
  const s = tls.connect({ host, port: 443, servername: host, rejectUnauthorized: false, timeout: 10000 }, () => { const cert = s.getPeerCertificate(), authorized = s.authorized; s.end(); resolve({ ...cert, authorized }); });
  s.on('error', reject); s.on('timeout', () => { s.destroy(); reject(new Error('timed out connecting to ' + host + ':443')); });
});
export async function checkSsl(host, getCert = realGetCert) {
  const c = await getCert(host), t = Date.parse(c.valid_to);
  if (!Number.isFinite(t)) throw new Error('the server sent no certificate expiry date');
  return { expires: new Date(t).toISOString().slice(0, 10), issuer: c.issuer?.O || c.issuer?.CN || null, authorized: c.authorized !== false, daysLeft: Math.floor((t - Date.now()) / 864e5) };
}
async function sslCheck(db, getCert) {
  const host = new URL(cfg.siteUrl).hostname;
  try {
    const s = await checkSsl(host, getCert), id = 'tls-' + host;
    await db.collection('uptime_monitors').updateOne({ siteId: cfg.siteId, monitorId: id }, { $set: { siteId: cfg.siteId, monitorId: id, name: 'TLS certificate (' + host + ')', url: 'https://' + host, status: null, sslExpires: s.expires, sslIssuer: s.issuer, sslAuthorized: s.authorized, updatedAt: new Date() } }, { upsert: true });
    return `SSL certificate for ${host} expires ${s.expires} (${s.daysLeft} days)${s.authorized ? '' : ', NOT trusted by this PC'}`;
  } catch (e) { return 'SSL check failed: ' + e.message; }
}

export async function runUptime(db, f = fetch, getCert) {
  const ssl = await sslCheck(db, getCert);              // independent of UptimeRobot: runs even without an API key
  return (await runMonitors(db, f)) + ' | ' + ssl;
}

async function runMonitors(db, f = fetch) {
  const c = cfg.uptime;
  if (!c.key) return 'skipped: UPTIMEROBOT_API_KEY is not set in .env yet (see SETUP_UPTIME.md)';
  const all = await fetchMonitors(c, c.days, f);
  const host = new URL(cfg.siteUrl).hostname.replace(/^www\./, '');
  const hostOf = (u) => { try { return new URL(u).hostname.toLowerCase(); } catch { return ''; } };
  const siteHost = new URL(cfg.siteUrl).hostname.toLowerCase();
  const exact = all.filter((m) => hostOf(m.url) === siteHost);                      // www.tritorc.com itself wins over other tritorc.com hosts such as app.tritorc.com
  const mine = c.monitors.length ? all.filter((m) => c.monitors.includes(m.id)) : (exact.length ? exact : all.filter((m) => hostOf(m.url).replace(/^www\./, '') === host));
  if (!mine.length) return `skipped: no monitor matched ${c.monitors.length ? 'the ids ' + c.monitors.join(',') : 'the site ' + host}. Monitors found: ${all.map((m) => `${m.name} (${m.id})`).join(', ') || 'none'}. Set UPTIMEROBOT_MONITOR_IDS in .env.`;
  const siteId = cfg.siteId, now = new Date(), col = db.collection('uptime_daily');
  await col.createIndex({ siteId: 1, monitorId: 1, date: 1 }, { unique: true });
  if (!mine.some((m) => m.daily.length)) log('uptime: the monitor(s) were created too recently to have a complete day yet; history starts tomorrow');
  const ops = mine.flatMap((m) => m.daily.map((x) => ({ updateOne: { filter: { siteId, monitorId: m.id, date: dayDate(x.date) },
    update: { $set: { siteId, monitorId: m.id, name: m.name, url: m.url, date: dayDate(x.date), uptimePct: x.uptimePct, avgResponseMs: x.avgResponseMs, fetchedAt: now } }, upsert: true } })));
  if (ops.length) await col.bulkWrite(ops, { ordered: false });
  await db.collection('uptime_monitors').bulkWrite(mine.map((m) => ({ updateOne: { filter: { siteId, monitorId: m.id },
    update: { $set: { siteId, monitorId: m.id, name: m.name, url: m.url, status: m.status, sslExpires: m.sslExpires, updatedAt: now } }, upsert: true } })), { ordered: false });
  log('uptime: monitors ' + mine.map((m) => m.name).join(', '));
  return `${mine.length} monitor(s), ${ops.length} daily rows (${mine.map((m) => m.name).join(', ')})`;
}
