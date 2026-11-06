// Rebuilds, from MongoDB, the exact data shape the dashboard uses (S.live + a few settings).
import { cfg } from './config.js';

const iso = (d) => (d instanceof Date ? d : new Date(d)).toISOString().slice(0, 10);
const latestBy = (arr, keyFn, dateFn) => {
  const m = new Map();
  for (const x of arr) { const k = keyFn(x); const cur = m.get(k); if (!cur || dateFn(x) > dateFn(cur)) m.set(k, x); }
  return m;
};

export async function buildState(db) {
  const siteId = cfg.siteId, col = (n) => db.collection(n).find({ siteId });
  const [pages, ga4d, gscd, pm, qs, lh, cw, audits, issues, aud, syncs, site] = await Promise.all([
    col('pages').toArray(), col('ga4_daily').sort({ date: 1 }).toArray(), col('gsc_daily').sort({ date: 1 }).toArray(),
    col('page_metrics').toArray(), col('queries').toArray(), col('lighthouse_runs').toArray(), col('cwv_field').toArray(),
    col('page_audits').toArray(), col('issues').toArray(), col('audience_snapshots').sort({ windowEnd: -1 }).limit(1).toArray(),
    col('sync_log').toArray(), db.collection('sites').findOne({ siteId })
  ]);

  // daily
  const daily = {};
  for (const r of ga4d) {
    const o = (daily[iso(r.date)] = daily[iso(r.date)] || {});
    Object.assign(o, { users: r.users, newU: r.newUsers, sessions: r.sessions, eng: r.engagedSessions, engSec: r.engagementSeconds, keyEv: r.keyEvents, ch: r.channels || {} });
    const e = r.events || {};
    if (e.form_submit != null) o.sub = e.form_submit;
    if (e.quote_request != null) o.quote = e.quote_request;
    if (e.file_download != null) o.dl = e.file_download;
    if (e.whatsapp_click != null) o.wa = e.whatsapp_click;
    if (e.phone_click != null) o.ph = e.phone_click;
  }
  for (const r of gscd) { const o = (daily[iso(r.date)] = daily[iso(r.date)] || {}); Object.assign(o, { clicks: r.clicks, impr: r.impressions, posSum: r.positionSum }); }

  // per-page lookups
  const pmLatest = (src) => latestBy(pm.filter((x) => x.source === src), (x) => x.path, (x) => +new Date(x.windowEnd));
  const gaM = pmLatest('ga4'), gscM = pmLatest('gsc');
  const gscAll = new Map(), gaAll = new Map(); // all windows per path, for the previous-period comparison
  for (const x of pm) { const mp = x.source === 'gsc' ? gscAll : x.source === 'ga4' ? gaAll : null; if (!mp) continue; const a = mp.get(x.path) || []; a.push(x); mp.set(x.path, a); }
  const lhM = latestBy(lh, (x) => x.path + '|' + x.strategy, (x) => +new Date(x.runAt));
  const urlCw = latestBy(cw.filter((x) => x.scope === 'url'), (x) => x.path + '|' + x.formFactor, (x) => +new Date(x.fetchedAt));
  const originCw = latestBy(cw.filter((x) => x.scope === 'origin'), (x) => x.formFactor, (x) => +new Date(x.fetchedAt));
  const auditM = latestBy(audits, (x) => x.path, (x) => x.runId);
  const cwOf = (x) => (x ? { lcp: x.lcpSeconds, inp: x.inpMs, cls: x.cls } : null);

  const outPages = {};
  for (const p of pages) {
    const path = p.path, inReg = lhM.has(path + '|mobile') || lhM.has(path + '|desktop') || p.inRegistry;
    const o = {
      url: path, group: p.group || 'Corporate', pri: p.priority || 3, region: p.region || 'Global', title: p.title || '', kw: p.targetKeyword || '',
      chk: {}, lh: {}, cwv: {}, bl: {}, idx: p.indexStatus || 'Not inspected'
    };
    const a = auditM.get(path);
    if (a && a.scores) { o.chk = { ...a.scores }; if (!o.title && a.title) o.title = a.title; }
    const lm = lhM.get(path + '|mobile'), ld = lhM.get(path + '|desktop');
    if (lm) o.lh.m = { p: lm.performance, s: lm.seo };
    if (ld) o.lh.d = { p: ld.performance, s: ld.seo };
    for (const [k, ff] of [['m', 'phone'], ['d', 'desktop']]) {
      const own = cwOf(urlCw.get(path + '|' + ff));
      if (own) o.cwv[k] = own;
      else if (inReg && originCw.get(ff)) o.cwv[k] = { o: 1, ...cwOf(originCw.get(ff)) };
    }
    const g = gaM.get(path); if (g && g.sessions != null) o.ga = { s: g.sessions, eng: g.engagedSessions, views: g.views, org: g.organicSessions, ...(g.formSubmits != null ? { sub: g.formSubmits } : {}) };
    const s = gscM.get(path); if (s && s.clicks != null) o.gsc = { c: s.clicks, i: s.impressions, ps: s.positionSum };
    const hist = (gscAll.get(path) || []).filter((x) => s && +new Date(x.windowEnd) < +new Date(s.windowEnd)).sort((x, y) => +new Date(y.windowEnd) - +new Date(x.windowEnd))[0];
    if (hist) o.gscp = { c: hist.clicks, i: hist.impressions, ps: hist.positionSum };
    const gHist = (gaAll.get(path) || []).filter((x) => g && +new Date(x.windowEnd) < +new Date(g.windowEnd)).sort((x, y) => +new Date(y.windowEnd) - +new Date(x.windowEnd))[0];
    if (gHist && gHist.sessions != null) o.gap = { s: gHist.sessions, eng: gHist.engagedSessions };
    outPages[path] = o;
  }

  // queries: latest window only
  const qMax = qs.reduce((m, x) => Math.max(m, +new Date(x.windowEnd)), 0);
  const queries = qs.filter((x) => +new Date(x.windowEnd) === qMax).map((x) => ({ q: x.query, page: x.path, c: x.clicks, i: x.impressions, p: x.position }));

  const outIssues = issues.map((x) => ({ id: x.issueKey, url: x.path, type: x.type, sev: x.severity, first: iso(x.firstSeen), last: iso(x.lastSeen), status: x.status, owner: x.owner, evidence: x.evidence, fix: x.fix }));
  const mix = aud[0] ? { device: aud[0].device, country: aud[0].country } : null;

  const reg = Object.values(outPages).filter((p) => p.lh.m || p.lh.d).sort((a, b) => a.pri - b.pri).map((p) => `${p.url}, ${p.group}, ${p.pri}`).join('\n');
  const lastSync = {}; for (const s of syncs.filter((x) => x.status !== 'error' && !['init', 'crawllog'].includes(x.source))) { const t = +new Date(s.finishedAt); if (!lastSync[s.source] || t > +new Date(lastSync[s.source])) lastSync[s.source] = new Date(s.finishedAt).toISOString(); }

  return {
    source: 'mongodb', generatedAt: new Date().toISOString(), site: site?.url || cfg.siteUrl, brand: site?.brandTerms || 'tritorc', reg, lastSync,
    counts: { days: Object.keys(daily).length, pages: pages.length, queries: queries.length, issues: outIssues.length },
    live: { daily, pages: outPages, queries, issues: outIssues, bl: null, mix, ssl: null }
  };
}
