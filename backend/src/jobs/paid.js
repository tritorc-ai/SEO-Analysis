// Paid advertising: pulls daily campaign performance from Google Ads, LinkedIn Ads and Meta Ads into MongoDB (collection "paid_rows")
// and serves it to the dashboard's Paid advertising page in the feed format that page expects (see paidFeed + /api/paid/feed).
// A platform is skipped unless all of its settings are present in .env. Credentials are never logged.
import { cfg, ymd, addDays, dayDate, log } from '../config.js';
import { gget } from './google.js';

const num = (v) => { const x = +v; return Number.isFinite(x) ? x : 0; };
async function j(f, url, opt) {
  const r = await f(url, opt), t = await r.text();
  let d = null; try { d = JSON.parse(t); } catch { /* not JSON */ }
  if (!r.ok) {
    const m = d && (d.error?.message || d.message || d[0]?.error?.message || d.error_description);
    throw new Error(`${r.status} ${typeof m === 'string' ? m.slice(0, 200) : 'request failed'}`);
  }
  return d;
}
const row = (platform, o) => ({ platform, cid: String(o.cid ?? ''), date: o.date, account: o.account, campaign: o.campaign || '(unnamed)', type: o.type || null, currency: o.currency || null,
  impressions: num(o.impressions), clicks: num(o.clicks), spend: num(o.spend), reach: o.reach == null ? null : num(o.reach), landing_page_views: o.lpv == null ? null : num(o.lpv),
  conversions: num(o.conversions), lead_form_submissions: num(o.forms) });

/* ---------- Meta (Marketing API insights, campaign level, daily) ---------- */
export async function fetchMeta(c, from, to, f = fetch) {
  const out = [];
  for (const raw of c.accounts) {
    const id = String(raw).replace(/^act_/, '');
    let url = `https://graph.facebook.com/${c.ver}/act_${id}/insights?` + new URLSearchParams({
      level: 'campaign', time_increment: '1', time_range: JSON.stringify({ since: from, until: to }), limit: '500',
      fields: 'campaign_id,campaign_name,objective,impressions,reach,clicks,inline_link_clicks,spend,actions,account_currency,account_name'
    });
    for (let i = 0; i < 80 && url; i++) {
      const d = await j(f, url, { headers: { Authorization: 'Bearer ' + c.token } });
      for (const r of d.data || []) {
        const A = (t) => num((r.actions || []).find((z) => z.action_type === t)?.value);
        out.push(row('meta', { cid: r.campaign_id, date: r.date_start, account: `${r.account_name || 'Meta'} · act_${id}`, campaign: r.campaign_name, type: r.objective, currency: r.account_currency,
          impressions: r.impressions, reach: r.reach, clicks: r.inline_link_clicks ?? r.clicks, spend: r.spend, lpv: A('landing_page_view'), forms: A('onsite_conversion.lead_grouped'), conversions: A('lead') }));
      }
      url = d.paging?.next || null;
    }
  }
  return out;
}

/* ---------- Google Ads (REST searchStream with GAQL; needs a developer token + OAuth refresh token) ---------- */
async function googleToken(c, f) {
  const r = await f('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: c.clientId, client_secret: c.clientSecret, refresh_token: c.refresh, grant_type: 'refresh_token' }) });
  const d = await r.json().catch(() => ({}));
  if (!d.access_token) throw new Error('Google Ads OAuth refresh failed: ' + (d.error_description || (typeof d.error === 'string' ? d.error : d.error?.message) || r.status));
  return d.access_token;
}
export async function fetchGoogle(c, from, to, f = fetch) {
  const tok = await googleToken(c, f), out = [];
  const query = `SELECT segments.date, customer.id, customer.descriptive_name, customer.currency_code, campaign.id, campaign.name, campaign.advertising_channel_type, metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions FROM campaign WHERE segments.date BETWEEN '${from}' AND '${to}'`;
  for (const cid of c.customers) {
    const d = await j(f, `https://googleads.googleapis.com/${c.ver}/customers/${cid}/googleAds:searchStream`, {
      method: 'POST', headers: { Authorization: 'Bearer ' + tok, 'developer-token': c.devToken, ...(c.login ? { 'login-customer-id': c.login } : {}), 'Content-Type': 'application/json' }, body: JSON.stringify({ query })
    });
    const fid = `${cid.slice(0, 3)}-${cid.slice(3, 6)}-${cid.slice(6)}`;
    for (const batch of Array.isArray(d) ? d : [d]) for (const r of batch.results || []) {
      out.push(row('google', { cid: r.campaign?.id, date: r.segments?.date, account: `${r.customer?.descriptiveName || 'Google Ads'} · ${fid}`, campaign: r.campaign?.name, type: r.campaign?.advertisingChannelType,
        currency: r.customer?.currencyCode, impressions: r.metrics?.impressions, clicks: r.metrics?.clicks, spend: num(r.metrics?.costMicros) / 1e6, conversions: r.metrics?.conversions }));
    }
  }
  return out;
}

/* ---------- Google Ads via Google Sheet: a Google Ads script (google-ads-script/export-to-sheet.js) writes the sheet "rows"; we read it with the service account ---------- */
const serialDate = (n) => ymd(new Date(Date.UTC(1899, 11, 30) + n * 864e5));
export async function fetchGoogleSheet(c, get = gget) {
  const d = await get(`https://sheets.googleapis.com/v4/spreadsheets/${c.sheetId}/values/${encodeURIComponent('rows!A2:K50000')}?valueRenderOption=UNFORMATTED_VALUE`);
  const out = [];
  for (const v of d.values || []) {
    const date = typeof v[0] === 'number' ? serialDate(v[0]) : String(v[0] || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    const id = String(v[1] ?? '').replace(/\D/g, ''), fid = id.length === 10 ? `${id.slice(0, 3)}-${id.slice(3, 6)}-${id.slice(6)}` : id;
    out.push(row('google', { cid: String(v[4] ?? ''), date, account: `${v[2] || 'Google Ads'} · ${fid}`, campaign: v[5], type: v[6], currency: v[3], impressions: v[7], clicks: v[8], spend: v[9], conversions: v[10] }));
  }
  return out;
}

/* ---------- LinkedIn (Marketing API adAnalytics, pivot CAMPAIGN, daily). Needs an approved app and an access token. ---------- */
export async function fetchLinkedin(c, from, to, f = fetch) {
  const H = { Authorization: 'Bearer ' + c.token, 'LinkedIn-Version': c.ver, 'X-Restli-Protocol-Version': '2.0.0' }, out = [];
  const [fy, fm, fd] = from.split('-').map(Number), [ty, tm, td] = to.split('-').map(Number);
  for (const acc of c.accounts) {
    const info = await j(f, `https://api.linkedin.com/rest/adAccounts/${acc}`, { headers: H }).catch(() => ({}));
    const names = {}; let start = 0;
    for (let i = 0; i < 30; i++) {
      const d = await j(f, `https://api.linkedin.com/rest/adAccounts/${acc}/adCampaigns?q=search&pageSize=100&start=${start}`, { headers: H }).catch(() => ({ elements: [] }));
      (d.elements || []).forEach((e) => { names[e.id] = e.name; });
      if ((d.elements || []).length < 100) break; start += 100;
    }
    const url = `https://api.linkedin.com/rest/adAnalytics?q=analytics&pivot=CAMPAIGN&timeGranularity=DAILY&dateRange=(start:(year:${fy},month:${fm},day:${fd}),end:(year:${ty},month:${tm},day:${td}))&accounts=List(urn%3Ali%3AsponsoredAccount%3A${acc})&fields=dateRange,pivotValues,impressions,clicks,landingPageClicks,costInLocalCurrency,oneClickLeads,oneClickLeadFormOpens,externalWebsiteConversions`;
    const d = await j(f, url, { headers: H });
    for (const e of d.elements || []) {
      const cid = String((e.pivotValues || [])[0] || '').split(':').pop(), s = e.dateRange?.start || {};
      out.push(row('linkedin', { cid, date: `${s.year}-${String(s.month).padStart(2, '0')}-${String(s.day).padStart(2, '0')}`, account: `${info.name || 'LinkedIn'} · ${acc}`, campaign: names[cid] || `Campaign ${cid}`,
        currency: info.currency, impressions: e.impressions, clicks: e.clicks, spend: e.costInLocalCurrency, lpv: e.landingPageClicks, forms: e.oneClickLeads, conversions: e.externalWebsiteConversions }));
    }
  }
  return out;
}

/* ---------- the ingest job ---------- */
export async function runPaid(db, f = fetch, get = gget) {
  const P = cfg.paid, to = ymd(new Date()), from = ymd(addDays(new Date(), -P.days));
  const plan = [
    ['meta', P.meta.token && P.meta.accounts.length, () => fetchMeta(P.meta, from, to, f)],
    // Google Ads: the Sheet route (no API approval) wins when GOOGLE_ADS_SHEET_ID is set; otherwise the Google Ads API when all its settings exist
    P.google.sheetId ? ['google', true, () => fetchGoogleSheet(P.google, get)]
      : ['google', P.google.devToken && P.google.clientId && P.google.clientSecret && P.google.refresh && P.google.customers.length, () => fetchGoogle(P.google, from, to, f)],
    ['linkedin', P.linkedin.token && P.linkedin.accounts.length, () => fetchLinkedin(P.linkedin, from, to, f)]
  ].filter((p) => p[1]);
  if (!plan.length) return 'skipped: no ad platform credentials in .env yet (see SETUP_PAID.md)';
  const col = db.collection('paid_rows');
  await col.createIndex({ siteId: 1, date: 1, platform: 1, account: 1, cid: 1 }, { unique: true });
  const done = [], failed = [], siteId = cfg.siteId, now = new Date();
  for (const [name, , run] of plan) {
    try {
      const rows = (await run()).filter((r) => r.date && /^\d{4}-\d{2}-\d{2}$/.test(r.date));
      const ops = rows.map((r) => ({ updateOne: { filter: { siteId, date: dayDate(r.date), platform: r.platform, account: r.account, cid: r.cid }, update: { $set: { ...r, date: dayDate(r.date), siteId, fetchedAt: now } }, upsert: true } }));
      if (ops.length) await col.bulkWrite(ops, { ordered: false });
      done.push(`${name} ${rows.length} rows`);
    } catch (e) { failed.push(`${name}: ${e.message}`); log(`paid: ${name} failed: ${e.message}`); }
  }
  const msg = `${done.join(', ') || 'no rows'} (${from} to ${to})` + (failed.length ? '; FAILED ' + failed.join(' | ') : '');
  if (failed.length && !done.length) throw new Error(msg);
  return msg;
}

/* ---------- the feed the dashboard reads: { currency, rows[], payments[] } ---------- */
export async function paidFeed(db, platform, days = 90) {
  const q = { siteId: cfg.siteId, date: { $gte: dayDate(ymd(addDays(new Date(), -Math.min(2600, Math.max(1, days))))) } };
  if (platform) q.platform = platform;
  const docs = await db.collection('paid_rows').find(q).sort({ date: 1 }).toArray();
  const rep = cfg.paid.reportCurrency, fx = cfg.paid.fx || {};
  const rows = docs.map((d) => {
    const rate = rep && d.currency && d.currency !== rep ? fx[d.currency] : null;             // convert only when a rate was configured
    return { date: ymd(d.date), platform: d.platform, account: d.account, campaign: d.campaign, campaign_id: d.cid, type: d.type, currency: rate ? rep : d.currency, impressions: d.impressions, clicks: d.clicks,
      spend: rate ? Math.round(d.spend * rate * 100) / 100 : d.spend, ...(rate ? { spend_original: d.spend, currency_original: d.currency, fx_rate: rate } : {}),
      reach: d.reach, landing_page_views: d.landing_page_views, conversions: d.conversions, lead_form_submissions: d.lead_form_submissions };
  });
  const pq = { siteId: cfg.siteId }; if (platform) pq.platform = platform;
  const pay = await db.collection('paid_funds').find(pq).sort({ date: 1 }).toArray().catch(() => []);
  const payments = pay.map((p) => ({ date: ymd(p.date), platform: p.platform, account: p.account, amount: p.amount, currency: p.currency, reference: p.reference }));
  const cnt = {}; rows.forEach((r) => { if (r.currency) cnt[r.currency] = (cnt[r.currency] || 0) + 1; });
  const currency = Object.entries(cnt).sort((a, b) => b[1] - a[1])[0]?.[0] || 'USD';
  return { currency, rows, payments };
}
