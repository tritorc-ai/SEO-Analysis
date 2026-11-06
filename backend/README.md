# TRITORC SEO backend

Separate from the dashboard. It does two jobs:

1. **Ingest** (`src/ingest.js`): fetches GA4, Search Console, PageSpeed and CrUX data and writes it to MongoDB Atlas (`tritorc_seo`).
2. **API** (`src/server.js`): read-only, listens on `127.0.0.1:8790` (this PC only). The dashboard loads `GET /api/state` from it.

The on-page crawl (audit scores + issues) is run by `TRITORC_data\refresh-all.ps1` and also writes to Atlas.

## Layout
- `.env` -- all secrets and settings (Atlas URI, Google key paths). Never share it.
- `node\` -- portable Node.js v26.13.0 (nothing is installed system-wide).
- `src\jobs\` -- `ga4.js`, `gsc.js`, `psi.js`, `crux.js`, `google.js`
- `logs\` -- `server.log`, `ingest.log`

## Commands (from this folder)
```
node\node-v26.13.0-win-x64\node.exe --env-file=.env src\server.js          # start the API
node\node-v26.13.0-win-x64\node.exe --env-file=.env src\ingest.js all      # ga4 + gsc + psi + crux
node\node-v26.13.0-win-x64\node.exe --env-file=.env src\ingest.js ga4      # one job: ga4 | gsc | psi | crux | init
```
Health check: http://127.0.0.1:8790/api/health

## Scheduled tasks (Windows Task Scheduler)
- `TRITORC Backend API` -- starts the API at login.
- `TRITORC SEO Daily Refresh` -- 07:30, crawls the site and loads audits/issues into Atlas.
- `TRITORC Backend Ingest` -- daily Google ingest (enable after SETUP_GOOGLE.md is done).
- `TRITORC Dashboard Saver` -- legacy backup of the dashboard's browser data.

## Setup
Follow `SETUP_GOOGLE.md` once.
