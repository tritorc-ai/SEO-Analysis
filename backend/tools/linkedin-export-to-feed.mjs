// Converts a LinkedIn Campaign Manager performance export (daily breakdown) into a file the dashboard's Paid advertising page can import.
// No credentials, no network, no dependencies.
//
//   node tools/linkedin-export-to-feed.mjs <export.csv> [--out result.csv] [--json] [--account "Name"] [--currency INR] [--date-format mdy|dmy]
//
// Handles: metadata lines above the header, UTF-8 / UTF-16 files, comma / tab / semicolon separators, MM/DD/YYYY or DD/MM/YYYY or ISO dates,
// thousands separators, "Total" rows, and the different column names LinkedIn uses. Output columns match what the page reads.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const argv = process.argv.slice(2), flag = (n) => argv.includes('--' + n), opt = (n) => { const i = argv.indexOf('--' + n); return i >= 0 ? argv[i + 1] : undefined; };
const input = argv.find((a, i) => !a.startsWith('--') && !(i > 0 && argv[i - 1].startsWith('--') && !['json'].includes(argv[i - 1].slice(2))));

/* ---------- reading ---------- */
export function decode(buf) {
  if (buf[0] === 0xff && buf[1] === 0xfe) return buf.subarray(2).toString('utf16le');
  if (buf[0] === 0xfe && buf[1] === 0xff) { const b = Buffer.from(buf.subarray(2)); b.swap16(); return b.toString('utf16le'); }
  return buf.toString('utf8').replace(/^﻿/, '');
}
export function splitRow(line, d) {
  const out = []; let cur = '', q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) { if (c === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; }
    else if (c === '"') q = true; else if (c === d) { out.push(cur); cur = ''; } else cur += c;
  }
  out.push(cur); return out.map((s) => s.trim());
}
const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const ALIASES = {
  date: ['start date in utc', 'start date', 'date', 'day', 'date start'],
  campaign: ['campaign name', 'campaign'],
  cid: ['campaign id', 'campaign urn'],
  adset: ['ad set id'],
  account: ['account name', 'account', 'ad account', 'account id'],
  type: ['campaign objective', 'objective type', 'objective', 'campaign type'],
  currency: ['currency', 'currency code', 'account currency'],
  impressions: ['impressions'],
  clicks: ['clicks'],
  spend: ['total spent', 'spent', 'spend', 'cost', 'total spend'],
  lpv: ['landing page clicks'],
  forms: ['leads', 'lead form completions', 'one click leads', 'oneclickleads', 'lead form submissions', 'lead forms'],
  conv: ['conversions', 'website conversions', 'external website conversions']
};
const num = (v) => { if (v == null) return null; const s = String(v).replace(/[^0-9.\-]/g, ''); if (s === '' || s === '-' || s === '.') return null; const x = +s; return Number.isFinite(x) ? x : null; };
const pad = (n) => String(n).padStart(2, '0');

/* ---------- main conversion (exported so it can be tested) ---------- */
export function convert(text, o = {}) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== '');
  const hi = lines.findIndex((l) => { const n = norm(l); return n.includes('impressions') && n.includes('clicks'); });
  if (hi < 0) throw new Error('Could not find a header row containing "Impressions" and "Clicks". Is this the Campaign Manager performance export?');
  const head = lines[hi], d = [['\t', (head.match(/\t/g) || []).length], [';', (head.match(/;/g) || []).length], [',', (head.match(/,/g) || []).length]].sort((a, b) => b[1] - a[1])[0][0];
  const H = splitRow(head, d).map(norm), col = {};
  for (const [k, names] of Object.entries(ALIASES)) { for (const nm of names) { const i = H.indexOf(nm); if (i >= 0) { col[k] = i; break; } } }
  const missing = ['date', 'campaign', 'impressions', 'clicks', 'spend'].filter((k) => col[k] == null);
  if (missing.length) throw new Error('Missing column(s): ' + missing.join(', ') + '. Columns found: ' + splitRow(head, d).join(' | '));

  const raw = lines.slice(hi + 1).map((l) => splitRow(l, d)).filter((r) => r.length > 2);
  // dates
  const ds = raw.map((r) => (r[col.date] || '').trim()), warnings = [];
  const slash = ds.filter((s) => /^\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{4}$/.test(s));
  let fmt = o.dateFormat || null;
  if (!fmt && slash.length) {
    const dmy = slash.some((s) => +s.split(/[\/\-.]/)[0] > 12), mdy = slash.some((s) => +s.split(/[\/\-.]/)[1] > 12);
    fmt = dmy && !mdy ? 'dmy' : mdy && !dmy ? 'mdy' : null;
    if (!fmt) { fmt = 'mdy'; warnings.push('Dates like 03/04/2026 are ambiguous in this file (no day above 12). Assumed MM/DD/YYYY; re-run with --date-format dmy if your export is DD/MM/YYYY.'); }
  }
  const parseDate = (s) => {
    s = (s || '').trim(); let m;
    if ((m = s.match(/^(\d{4})-(\d{2})-(\d{2})/))) return `${m[1]}-${m[2]}-${m[3]}`;
    if ((m = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})$/))) { const [a, b, y] = [+m[1], +m[2], m[3]], [mo, da] = fmt === 'dmy' ? [b, a] : [a, b]; return mo >= 1 && mo <= 12 && da >= 1 && da <= 31 ? `${y}-${pad(mo)}-${pad(da)}` : null; }
    const t = Date.parse(s + ' UTC'); return Number.isFinite(t) ? new Date(t).toISOString().slice(0, 10) : null;
  };
  const rows = []; let skipped = 0;
  for (const r of raw) {
    const date = parseDate(r[col.date]); if (!date) { skipped++; continue; }                // header repeats, totals, footers
    const g = (k) => (col[k] == null ? null : r[col[k]]), imp = num(g('impressions')) || 0, clk = num(g('clicks')) || 0, sp = num(g('spend')) || 0, forms = num(g('forms')) || 0, conv = num(g('conv')) || 0;
    if (!imp && !clk && !sp && !forms && !conv) { skipped++; continue; }
    rows.push({ date, platform: 'linkedin', account: (g('account') || o.account || 'LinkedIn Ads').trim(), campaign: (g('campaign') || '(unnamed)').trim(), campaign_id: ((g('cid') || '').trim() + (g('adset') ? '-' + String(g('adset')).trim() : '')), type: (g('type') || '').trim(),
      currency: (g('currency') || o.currency || '').trim(), impressions: imp, clicks: clk, spend: sp, landing_page_views: num(g('lpv')), lead_form_submissions: forms, conversions: conv });
  }
  if (!rows.length) throw new Error('No usable rows found (every row was empty or had no valid date).');
  rows.sort((a, b) => a.date.localeCompare(b.date));
  if (col.account == null && !o.account) warnings.push('No account column in the export. Rows use the name "LinkedIn Ads"; add --account "Tritorc LinkedIn" to name it.');
  if (col.currency == null && !o.currency) warnings.push('No currency column in the export. The page will show its default currency; add --currency INR (or USD) if needed.');
  return { rows, skipped, warnings, dates: [rows[0].date, rows[rows.length - 1].date], format: fmt || 'iso' };
}

const FIELDS = ['date', 'platform', 'account', 'campaign', 'campaign_id', 'type', 'currency', 'impressions', 'clicks', 'spend', 'landing_page_views', 'lead_form_submissions', 'conversions'];
export const toCsv = (rows) => [FIELDS.join(',')].concat(rows.map((r) => FIELDS.map((f) => { const v = r[f] == null ? '' : String(r[f]); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }).join(','))).join('\n') + '\n';

/* ---------- command line ---------- */
const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isMain) {
  if (!input) { console.log('Usage: node tools/linkedin-export-to-feed.mjs <export.csv> [--out result.csv] [--json] [--account "Name"] [--currency INR] [--date-format mdy|dmy]'); process.exit(2); }
  try {
    const res = convert(decode(fs.readFileSync(input)), { account: opt('account'), currency: opt('currency'), dateFormat: opt('date-format') });
    const json = flag('json'), out = opt('out') || input.replace(/\.[^.\\/]+$/, '') + '.converted.' + (json ? 'json' : 'csv');
    fs.writeFileSync(out, json ? JSON.stringify({ currency: res.rows.find((r) => r.currency)?.currency || undefined, rows: res.rows }, null, 1) : toCsv(res.rows), 'utf8');
    const t = (k) => res.rows.reduce((s, r) => s + (r[k] || 0), 0);
    console.log(`Converted ${res.rows.length} rows (${res.skipped} skipped), ${res.dates[0]} to ${res.dates[1]}, date format: ${res.format}`);
    console.log(`Totals: spend ${t('spend').toFixed(2)}, impressions ${t('impressions')}, clicks ${t('clicks')}, leads ${t('lead_form_submissions')}`);
    res.warnings.forEach((w) => console.log('WARNING: ' + w));
    console.log('Written: ' + out);
  } catch (e) { console.error('ERROR: ' + e.message); process.exit(1); }
}
