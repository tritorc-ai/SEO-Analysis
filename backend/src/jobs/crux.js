// Real-user Core Web Vitals (CrUX). Site-wide data for everyone; page-level only for pages busy enough to have it.
import { cfg } from '../config.js';
import { needKey, sleep } from './google.js';

export async function runCrux(db) {
  const key = needKey(), siteId = cfg.siteId, now = new Date(), SKIP = 14 * 864e5;
  const endpoint = 'https://chromeuxreport.googleapis.com/v1/records:queryRecord?key=' + key;
  let last = 0;
  const q = async (body) => {
    for (let a = 0; a < 6; a++) {
      const wait = last + 550 - Date.now(); if (wait > 0) await sleep(wait); last = Date.now();   // stay under ~150 requests/minute
      const r = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }), d = await r.json();
      if (d.error && (d.error.code === 429 || /quota/i.test(d.error.message || ''))) { await sleep(30000); continue; }
      if (d.error && d.error.code !== 404) throw new Error(d.error.message);
      return d.record || null;
    }
    throw new Error('CrUX rate limit still active, try again later');
  };
  const metrics = (rec) => { if (!rec) return null; const m = rec.metrics || {}, g = (k) => (m[k]?.percentiles?.p75 != null ? +m[k].percentiles.p75 : null), l = g('largest_contentful_paint'); return { lcpSeconds: l == null ? null : l / 1000, inpMs: g('interaction_to_next_paint'), cls: g('cumulative_layout_shift') }; };
  const docs = []; let own = 0, asked = 0;
  for (const ff of ['PHONE', 'DESKTOP']) {                                   // 1. site-wide
    const m = metrics(await q({ origin: cfg.siteUrl, formFactor: ff }));
    if (m) docs.push({ siteId, scope: 'origin', path: null, formFactor: ff.toLowerCase(), fetchedAt: now, ...m });
  }
  // 2. busy pages: latest GA4 28-day sessions >= threshold, not recently "not found"
  const latest = await db.collection('page_metrics').find({ siteId, source: 'ga4' }).sort({ windowEnd: -1 }).limit(1).toArray();
  if (latest[0]) {
    const busy = await db.collection('page_metrics').find({ siteId, source: 'ga4', windowEnd: latest[0].windowEnd, sessions: { $gte: cfg.cruxMinSessions } }).project({ path: 1 }).toArray();
    const skip = new Set((await db.collection('pages').find({ siteId, cwvNotFoundAt: { $gte: new Date(now - SKIP) } }).project({ path: 1 }).toArray()).map((x) => x.path));
    for (const { path } of busy) {
      if (skip.has(path)) continue; asked++; let hit = false;
      for (const ff of ['PHONE', 'DESKTOP']) {
        const m = metrics(await q({ url: cfg.siteUrl + encodeURI(path), formFactor: ff }));
        if (m) { hit = true; own++; docs.push({ siteId, scope: 'url', path, formFactor: ff.toLowerCase(), fetchedAt: now, ...m }); }
      }
      if (!hit) await db.collection('pages').updateOne({ siteId, path }, { $set: { cwvNotFoundAt: now } });
    }
  }
  if (docs.length) await db.collection('cwv_field').insertMany(docs);
  return `${docs.length} records (${docs.filter((d) => d.scope === 'origin').length} site-wide, ${own} page-level from ${asked} busy pages asked)`;
}
