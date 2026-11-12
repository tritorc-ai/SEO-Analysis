// Saves a converted paid-advertising CSV (the output of linkedin-export-to-feed.mjs, or any file with the same columns) into MongoDB "paid_rows",
// the same collection the backend jobs write to. The dashboard's Paid page then loads it automatically.
//
//   node --env-file=.env tools/import-paid-csv.mjs <converted.csv> [--dry-run]
//
// Columns: date, platform, account, campaign, campaign_id, type, currency, impressions, clicks, spend, landing_page_views, lead_form_submissions, conversions
// Safe to repeat: a row is identified by date + platform + account + campaign_id, so re-importing updates instead of duplicating.
import fs from 'node:fs';
import { cfg, dayDate } from '../src/config.js';
import { getDb, closeDb } from '../src/db.js';
import { splitRow } from './linkedin-export-to-feed.mjs';

const file = process.argv.slice(2).find((a) => !a.startsWith('--')), dry = process.argv.includes('--dry-run');
if (!file) { console.log('Usage: node --env-file=.env tools/import-paid-csv.mjs <converted.csv> [--dry-run]'); process.exit(2); }
const text = fs.readFileSync(file, 'utf8').replace(/^﻿/, ''), lines = text.split(/\r?\n/).filter((l) => l.trim());
const head = splitRow(lines[0], ','), idx = Object.fromEntries(head.map((h, i) => [h.trim().toLowerCase(), i]));
for (const need of ['date', 'platform', 'account', 'campaign', 'spend']) if (idx[need] == null) { console.error('ERROR: column "' + need + '" is missing. Found: ' + head.join(', ')); process.exit(1); }
const num = (v) => { const x = +String(v ?? '').replace(/,/g, ''); return v === '' || v == null || !Number.isFinite(x) ? null : x; };
const rows = [];
for (const l of lines.slice(1)) {
  const c = splitRow(l, ','), g = (k) => (idx[k] == null ? '' : c[idx[k]]), date = g('date'), platform = g('platform').toLowerCase();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^(google|linkedin|meta)$/.test(platform)) continue;
  rows.push({ siteId: cfg.siteId, date: dayDate(date), platform, account: g('account') || 'Unassigned account', cid: g('campaign_id'), campaign: g('campaign') || '(unnamed)', type: g('type') || null, currency: g('currency') || null,
    impressions: num(g('impressions')) ?? 0, clicks: num(g('clicks')) ?? 0, spend: num(g('spend')) ?? 0, reach: num(g('reach')), landing_page_views: num(g('landing_page_views')), conversions: num(g('conversions')) ?? 0, lead_form_submissions: num(g('lead_form_submissions')) ?? 0 });
}
if (!rows.length) { console.error('ERROR: no usable rows (need date as YYYY-MM-DD and platform google, linkedin or meta).'); process.exit(1); }
const keys = new Set(rows.map((r) => [r.date.getTime(), r.platform, r.account, r.cid].join('|')));
if (keys.size !== rows.length) { console.error(`ERROR: ${rows.length - keys.size} rows share the same date + platform + account + campaign_id and would overwrite each other. Nothing was written.`); process.exit(1); }
const sum = (k) => rows.reduce((s, r) => s + (r[k] || 0), 0), plats = [...new Set(rows.map((r) => r.platform))].join(', ');
console.log(`${rows.length} rows for ${plats}: ${rows[0].date.toISOString().slice(0, 10)} to ${rows[rows.length - 1].date.toISOString().slice(0, 10)}; spend ${sum('spend').toFixed(2)}, impressions ${sum('impressions')}, clicks ${sum('clicks')}, leads ${sum('lead_form_submissions')}`);
if (dry) { console.log('Dry run: nothing written.'); process.exit(0); }
const db = await getDb(), col = db.collection('paid_rows'), now = new Date();
await col.createIndex({ siteId: 1, date: 1, platform: 1, account: 1, cid: 1 }, { unique: true });
const res = await col.bulkWrite(rows.map((r) => ({ updateOne: { filter: { siteId: r.siteId, date: r.date, platform: r.platform, account: r.account, cid: r.cid }, update: { $set: { ...r, fetchedAt: now } }, upsert: true } })), { ordered: false });
console.log(`Saved to MongoDB tritorc_seo.paid_rows: ${res.upsertedCount} new, ${res.modifiedCount} updated, ${res.matchedCount - res.modifiedCount} unchanged.`);
await closeDb();
