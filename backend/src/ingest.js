// Usage: node --env-file=.env src/ingest.js <ga4|gsc|psi|crux|init|all>
import { cfg, log } from './config.js';
import { getDb, closeDb } from './db.js';
import { runGa4 } from './jobs/ga4.js';
import { runGsc } from './jobs/gsc.js';
import { runPsi } from './jobs/psi.js';
import { runCrux } from './jobs/crux.js';
import { runRum } from './jobs/rum.js';
import { runPaid } from './jobs/paid.js';
import { runUptime } from './jobs/uptime.js';

// One-off: mark the pages that already have Lighthouse runs as "registry" pages (the ones PageSpeed/CrUX check).
async function runInit(db) {
  const paths = await db.collection('lighthouse_runs').distinct('path', { siteId: cfg.siteId });
  const r = await db.collection('pages').updateMany({ siteId: cfg.siteId, path: { $in: paths } }, { $set: { inRegistry: true } });
  return `${r.modifiedCount} pages marked as registry pages (${paths.length} with Lighthouse history)`;
}

// Called by the crawl refresh (PowerShell) so the dashboard can show when the crawler last ran.
async function runCrawlLog(db) {
  await db.collection('sync_log').insertOne({ siteId: cfg.siteId, source: 'crawler', finishedAt: new Date(), status: 'ok' });
  return 'crawler run logged';
}

const JOBS = { init: runInit, ga4: runGa4, gsc: runGsc, psi: runPsi, crux: runCrux, rum: runRum, paid: runPaid, uptime: runUptime, crawllog: runCrawlLog };
const which = process.argv[2] || 'all';
const list = which === 'all' ? ['ga4', 'gsc', 'psi', 'crux', 'rum', 'paid', 'uptime'] : [which];
if (!list.every((j) => JOBS[j])) { console.log('Unknown job. Use: ' + Object.keys(JOBS).join(' | ') + ' | all'); process.exit(2); }

const db = await getDb();
let failed = 0;
for (const job of list) {
  const started = Date.now();
  try {
    log(`${job}: started`);
    const msg = await JOBS[job](db);
    log(`${job}: OK, ${msg} (${Math.round((Date.now() - started) / 1000)}s)`);
    if (job !== 'init' && job !== 'crawllog') await db.collection('sync_log').insertOne({ siteId: cfg.siteId, source: job === 'psi' ? 'pagespeed' : job, finishedAt: new Date(), status: 'ok', detail: msg });
  } catch (e) {
    failed++; log(`${job}: FAILED, ${e.message}`);
    await db.collection('sync_log').insertOne({ siteId: cfg.siteId, source: job === 'psi' ? 'pagespeed' : job, finishedAt: new Date(), status: 'error', error: String(e.message).slice(0, 300) });
  }
}
await closeDb();
process.exit(failed ? 1 : 0);
