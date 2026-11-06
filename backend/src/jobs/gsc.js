import { cfg, ymd, addDays, dayDate } from '../config.js';
import { gpost } from './google.js';

export async function runGsc(db) {
  if (!cfg.gscProperty) throw new Error('GSC_PROPERTY is not set in .env');
  const url = `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(cfg.gscProperty)}/searchAnalytics/query`;
  const q = (b) => gpost(url, b).then((d) => d.rows || []);
  const siteId = cfg.siteId, today = new Date();
  const end = addDays(today, -1), curStart = addDays(end, -27), prevEnd = addDays(end, -28), prevStart = addDays(end, -55);
  const pathOf = (u) => { try { return new URL(u).pathname; } catch { return u; } };

  // daily totals, 365 days
  const daily = await q({ startDate: ymd(addDays(end, -364)), endDate: ymd(end), dimensions: ['date'], rowLimit: 25000, dataState: 'all' });
  if (daily.length) await db.collection('gsc_daily').bulkWrite(daily.map((r) => ({ updateOne: { filter: { siteId, date: dayDate(r.keys[0]) }, update: { $set: { clicks: r.clicks, impressions: r.impressions, positionSum: r.position * r.impressions } }, upsert: true } })), { ordered: false });

  // pages: current 28 days and the 28 days before (for "vs prior"); URL variants of one path are summed
  let pageCount = 0;
  for (const [s, e] of [[curStart, end], [prevStart, prevEnd]]) {
    const agg = {};
    for (const r of await q({ startDate: ymd(s), endDate: ymd(e), dimensions: ['page'], rowLimit: 5000, dataState: 'all' })) {
      const p = pathOf(r.keys[0]); const a = (agg[p] ||= { clicks: 0, impressions: 0, positionSum: 0 });
      a.clicks += r.clicks; a.impressions += r.impressions; a.positionSum += r.position * r.impressions;
    }
    const windowEnd = dayDate(ymd(e));
    const ops = Object.entries(agg).map(([path, v]) => ({ updateOne: { filter: { siteId, path, source: 'gsc', windowEnd }, update: { $set: { windowDays: 28, ...v } }, upsert: true } }));
    if (ops.length) await db.collection('page_metrics').bulkWrite(ops, { ordered: false });
    if (e === end) pageCount = ops.length;
  }

  // queries (current window)
  const qa = {};
  for (const r of await q({ startDate: ymd(curStart), endDate: ymd(end), dimensions: ['query', 'page'], rowLimit: 1000, dataState: 'all' })) {
    const k = r.keys[0] + '\u0000' + pathOf(r.keys[1]); const a = (qa[k] ||= { query: r.keys[0], path: pathOf(r.keys[1]), clicks: 0, impressions: 0, posSum: 0 });
    a.clicks += r.clicks; a.impressions += r.impressions; a.posSum += r.position * r.impressions;
  }
  const windowEnd = dayDate(ymd(end));
  const qops = Object.values(qa).map((a) => ({ updateOne: { filter: { siteId, windowEnd, query: a.query, path: a.path }, update: { $set: { windowDays: 28, clicks: a.clicks, impressions: a.impressions, position: a.impressions ? +(a.posSum / a.impressions).toFixed(1) : null } }, upsert: true } }));
  if (qops.length) await db.collection('queries').bulkWrite(qops, { ordered: false });
  return `${daily.length} days, ${pageCount} pages (+ prior window), ${qops.length} queries`;
}
