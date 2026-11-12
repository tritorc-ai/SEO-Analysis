// Real-user Core Web Vitals measured on tritorc.com itself (web-vitals script in GTM -> GA4 events -> here).
// GA4 events: cwv_lcp, cwv_inp, cwv_cls, each with the custom dimension "cwv_bucket" (the reading rounded into small steps:
// LCP in 100 ms steps, INP in 25 ms steps, CLS x100). We count readings per bucket and compute the 75th percentile (what CrUX reports).
import { cfg } from '../config.js';
import { gpost } from './google.js';

const EV = { cwv_lcp: 'lcp', cwv_inp: 'inp', cwv_cls: 'cls' };

// p75 of a list of [value, count] pairs; null when there are fewer than `min` readings.
export function p75(pairs, min) {
  const tot = pairs.reduce((s, [, n]) => s + n, 0);
  if (tot < min) return null;
  const sorted = [...pairs].sort((a, b) => a[0] - b[0]); let cum = 0;
  for (const [v, n] of sorted) { cum += n; if (cum >= 0.75 * tot) return v; }
  return null;
}

export async function runRum(db) {
  if (!cfg.ga4Property) throw new Error('GA4_PROPERTY_ID is not set in .env');
  const url = `https://analyticsdata.googleapis.com/v1beta/properties/${cfg.ga4Property}:runReport`;
  const body = {
    dateRanges: [{ startDate: '28daysAgo', endDate: 'yesterday' }],
    dimensions: ['pagePath', 'deviceCategory', 'eventName', 'customEvent:cwv_bucket'].map((name) => ({ name })),
    metrics: [{ name: 'eventCount' }], limit: 100000,
    dimensionFilter: { filter: { fieldName: 'eventName', inListFilter: { values: Object.keys(EV) } } }
  };
  const rows = [];
  try {
    for (let offset = 0; ; offset += 100000) {
      const d = await gpost(url, { ...body, offset });
      rows.push(...(d.rows || []));
      if (rows.length >= (d.rowCount || 0) || !(d.rows || []).length) break;
    }
  } catch (e) {
    if (/customEvent:cwv_bucket/i.test(e.message)) return 'skipped: GA4 custom dimension "cwv_bucket" is not registered yet (see gtm/GTM_WEB_VITALS.md, step 5)';
    throw e;
  }
  if (!rows.length) return 'no web-vitals events in GA4 yet (publish the GTM tag, then allow up to 48 hours)';

  // path|device|metric -> Map(value -> count); also site-wide per device|metric
  const per = new Map(), site = new Map();
  const add = (m, k, v, n) => { const mm = m.get(k) || m.set(k, new Map()).get(k); mm.set(v, (mm.get(v) || 0) + n); };
  for (const r of rows) {
    const [path, dev, ev, bucket] = r.dimensionValues.map((x) => x.value), n = +r.metricValues[0].value, v = +bucket;
    const ff = dev === 'mobile' ? 'phone' : dev === 'desktop' ? 'desktop' : null;
    if (!ff || !EV[ev] || !Number.isFinite(v) || bucket === '(not set)') continue;
    add(per, `${path}|${ff}|${EV[ev]}`, v, n); add(site, `${ff}|${EV[ev]}`, v, n);
  }
  const min = cfg.rumMinSamples, now = new Date(), siteId = cfg.siteId, docs = [];
  const build = (get, base) => {
    const lcp = p75([...(get('lcp') || [])], min), inp = p75([...(get('inp') || [])], min), cls = p75([...(get('cls') || [])], min);
    if (lcp == null || inp == null || cls == null) return;             // the dashboard needs all three
    const n = (m) => [...(get(m) || new Map())].reduce((s, [, c]) => s + c, 0);
    docs.push({ siteId, ...base, fetchedAt: now, source: 'rum', lcpSeconds: lcp / 1000, inpMs: inp, cls: cls / 100, samples: { lcp: n('lcp'), inp: n('inp'), cls: n('cls') } });
  };
  for (const ff of ['phone', 'desktop']) build((m) => site.get(`${ff}|${m}`), { scope: 'origin', path: null, formFactor: ff });
  const pages = new Set([...per.keys()].map((k) => k.split('|').slice(0, 2).join('|')));
  for (const pf of pages) { const [path, ff] = pf.split('|'); build((m) => per.get(`${path}|${ff}|${m}`), { scope: 'url', path, formFactor: ff }); }
  if (docs.length) await db.collection('cwv_field').insertMany(docs);
  return `${rows.length} GA4 rows -> ${docs.length} records (${docs.filter((d) => d.scope === 'origin').length} site-wide, ${docs.filter((d) => d.scope === 'url').length} page-level, min ${min} readings per metric)`;
}
