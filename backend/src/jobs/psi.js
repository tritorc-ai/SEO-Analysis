// Lighthouse via the PageSpeed Insights API. Every run is stored (history), 4 requests at a time.
import { cfg, log } from '../config.js';
import { needKey, sleep } from './google.js';

export async function runPsi(db) {
  const key = needKey(), siteId = cfg.siteId;
  const pages = await db.collection('pages').find({ siteId, inRegistry: true }).project({ path: 1 }).toArray();
  if (!pages.length) throw new Error('no registry pages: run "node src/ingest.js init" first');
  const jobs = pages.flatMap((p) => ['mobile', 'desktop'].map((s) => [p.path, s]));
  let i = 0, ok = 0, fail = 0, lastErr = '';
  const one = async ([path, strategy]) => {
    const api = 'https://www.googleapis.com/pagespeedonline/v5/runPagespeed?category=performance&category=seo&strategy=' + strategy + '&url=' + encodeURIComponent(cfg.siteUrl + encodeURI(path)) + '&key=' + key;
    for (let a = 0; a < 2; a++) {
      try {
        const r = await fetch(api), d = await r.json();
        if (!r.ok || d.error) throw new Error(d.error?.message || r.status);
        const c = d.lighthouseResult.categories, au = d.lighthouseResult.audits;
        await db.collection('lighthouse_runs').insertOne({ siteId, path, strategy, runAt: new Date(), performance: Math.round(c.performance.score * 100), seo: Math.round(c.seo.score * 100), lcpMs: au['largest-contentful-paint']?.numericValue ?? null, cls: au['cumulative-layout-shift']?.numericValue ?? null, tbtMs: au['total-blocking-time']?.numericValue ?? null });
        ok++; return;
      } catch (e) { lastErr = String(e.message || e); if (a) fail++; else await sleep(2000); }
    }
  };
  const worker = async () => { while (i < jobs.length) { const j = jobs[i++]; await one(j); if ((ok + fail) % 25 === 0) log(`psi ${ok + fail}/${jobs.length}`); } };
  await Promise.all([worker(), worker(), worker(), worker()]);
  if (ok === 0) throw new Error(lastErr || 'all requests failed');
  return `${ok} runs stored` + (fail ? `, ${fail} failed (last: ${lastErr})` : '');
}
