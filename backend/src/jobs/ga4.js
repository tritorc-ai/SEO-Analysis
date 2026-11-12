import { cfg, ymd, addDays, dayDate, log } from '../config.js';
import { gpost } from './google.js';

const dk = (s) => `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6)}`;
const evFilter = (name) => ({ filter: { fieldName: 'eventName', stringFilter: { value: name } } });
const linkContains = (v) => ({ filter: { fieldName: 'linkUrl', stringFilter: { matchType: 'CONTAINS', value: v } } });

export async function runGa4(db) {
  if (!cfg.ga4Property) throw new Error('GA4_PROPERTY_ID is not set in .env');
  const url = `https://analyticsdata.googleapis.com/v1beta/properties/${cfg.ga4Property}:runReport`;
  const rep = (b) => gpost(url, { limit: 100000, ...b }).then((d) => d.rows || []);
  const m = (names) => names.map((name) => ({ name }));
  const yr = [{ startDate: '365daysAgo', endDate: 'yesterday' }], r28 = [{ startDate: '28daysAgo', endDate: 'yesterday' }];
  const siteId = cfg.siteId, now = new Date(), windowEnd = dayDate(ymd(addDays(now, -1)));
  const sets = {};                                             // date -> { field: value }
  const slot = (k) => (sets[k] ||= {});

  // 1. daily totals
  for (const r of await rep({ dateRanges: yr, dimensions: m(['date']), metrics: m(['activeUsers', 'newUsers', 'sessions', 'engagedSessions', 'userEngagementDuration', 'keyEvents']) })) {
    const v = r.metricValues.map((x) => +x.value);
    Object.assign(slot(dk(r.dimensionValues[0].value)), { users: v[0], newUsers: v[1], sessions: v[2], engagedSessions: v[3], engagementSeconds: v[4], keyEvents: v[5] });
  }
  // 2. daily channel split
  const ch = {};
  for (const r of await rep({ dateRanges: yr, dimensions: m(['date', 'sessionDefaultChannelGroup']), metrics: m(['sessions']) })) {
    const k = dk(r.dimensionValues[0].value); (ch[k] ||= {})[r.dimensionValues[1].value] = +r.metricValues[0].value;
  }
  for (const k in ch) slot(k).channels = ch[k];
  // 3. daily event counts (each is a separate filtered query)
  const events = [
    ['form_submit', evFilter(cfg.events.form)], ['quote_request', evFilter(cfg.events.quote)], ['phone_click', evFilter(cfg.events.phone)],
    ['file_download', evFilter(cfg.events.download)],
    ['whatsapp_click', { andGroup: { expressions: [evFilter('click'), { orGroup: { expressions: [linkContains('wa.me'), linkContains('whatsapp')] } }] } }]
  ];
  for (const [key, filter] of events) {
    try {
      for (const r of await rep({ dateRanges: yr, dimensions: m(['date']), metrics: m(['eventCount']), dimensionFilter: filter })) slot(dk(r.dimensionValues[0].value))['events.' + key] = +r.metricValues[0].value;
    } catch (e) { log(`ga4: event "${key}" skipped: ${e.message}`); }
  }
  const ops = Object.entries(sets).map(([k, set]) => ({ updateOne: { filter: { siteId, date: dayDate(k) }, update: { $set: set }, upsert: true } }));
  if (ops.length) await db.collection('ga4_daily').bulkWrite(ops, { ordered: false });

  // 4. landing pages, last 28 days
  const pageMap = {};
  const pg = (p) => (pageMap[p] ||= {});
  for (const r of await rep({ dateRanges: r28, dimensions: m(['landingPage']), metrics: m(['sessions', 'engagedSessions', 'screenPageViews']), limit: 10000 })) {
    const p = r.dimensionValues[0].value; if (!p || p === '(not set)') continue;
    Object.assign(pg(p), { sessions: +r.metricValues[0].value, engagedSessions: +r.metricValues[1].value, views: +r.metricValues[2].value });
  }
  for (const r of await rep({ dateRanges: r28, dimensions: m(['landingPage']), metrics: m(['sessions']), limit: 10000, dimensionFilter: { filter: { fieldName: 'sessionDefaultChannelGroup', stringFilter: { value: 'Organic Search' } } } })) {
    const p = r.dimensionValues[0].value; if (pageMap[p]) pageMap[p].organicSessions = +r.metricValues[0].value;
  }
  try {                                                         // paid = any "Paid ..." default channel group (Search, Social, Video, Shopping, Other)
    for (const r of await rep({ dateRanges: r28, dimensions: m(['landingPage']), metrics: m(['sessions']), limit: 10000, dimensionFilter: { filter: { fieldName: 'sessionDefaultChannelGroup', stringFilter: { matchType: 'BEGINS_WITH', value: 'Paid' } } } })) {
      const p = r.dimensionValues[0].value; if (pageMap[p]) pageMap[p].paidSessions = +r.metricValues[0].value;
    }
  } catch (e) { log('ga4: page paid sessions skipped: ' + e.message); }
  try {
    for (const r of await rep({ dateRanges: r28, dimensions: m(['landingPage']), metrics: m(['eventCount']), limit: 10000, dimensionFilter: evFilter(cfg.events.form) })) {
      const p = r.dimensionValues[0].value; if (pageMap[p]) pageMap[p].formSubmits = +r.metricValues[0].value;
    }
  } catch (e) { log('ga4: page form submits skipped: ' + e.message); }
  // the 28 days before that, so the dashboard can show "vs prior" for sessions
  const prevEnd = dayDate(ymd(addDays(now, -29))), prevMap = {};
  for (const r of await rep({ dateRanges: [{ startDate: '56daysAgo', endDate: '29daysAgo' }], dimensions: m(['landingPage']), metrics: m(['sessions', 'engagedSessions']), limit: 10000 })) {
    const p = r.dimensionValues[0].value; if (p && p !== '(not set)') prevMap[p] = { sessions: +r.metricValues[0].value, engagedSessions: +r.metricValues[1].value };
  }
  const pops = [], mops = [];
  for (const [path, v] of Object.entries(prevMap)) mops.push({ updateOne: { filter: { siteId, path, source: 'ga4', windowEnd: prevEnd }, update: { $set: { windowDays: 28, ...v } }, upsert: true } });
  for (const [path, v] of Object.entries(pageMap)) {
    pops.push({ updateOne: { filter: { siteId, path }, update: { $setOnInsert: { group: 'Corporate', priority: 3, region: 'Global', title: null, targetKeyword: null, indexStatus: 'Not inspected', active: true, firstSeen: now } }, upsert: true } });
    mops.push({ updateOne: { filter: { siteId, path, source: 'ga4', windowEnd }, update: { $set: { windowDays: 28, ...v } }, upsert: true } });
  }
  if (pops.length) await db.collection('pages').bulkWrite(pops, { ordered: false });
  if (mops.length) await db.collection('page_metrics').bulkWrite(mops, { ordered: false });

  // 5. device + country mix
  const mix = { device: {}, country: {} };
  for (const [key, dim] of [['device', 'deviceCategory'], ['country', 'country']]) {
    const rows = await rep({ dateRanges: r28, dimensions: m([dim]), metrics: m(['sessions']), limit: 8, orderBys: [{ metric: { metricName: 'sessions' }, desc: true }] });
    const tot = rows.reduce((s, r) => s + +r.metricValues[0].value, 0) || 1;
    for (const r of rows) mix[key][r.dimensionValues[0].value] = +r.metricValues[0].value / tot;
  }
  await db.collection('audience_snapshots').updateOne({ siteId, windowEnd }, { $set: { windowDays: 28, ...mix } }, { upsert: true });
  return Object.keys(sets).length + ' days, ' + Object.keys(pageMap).length + ' landing pages';
}
