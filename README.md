# SEO-Analysis

Website performance and SEO dashboard for tritorc.com, with a MongoDB Atlas data store and a small Node.js backend.

## What is in this repository

| Folder | What it is |
|---|---|
| `dashboard/` | Single-file HTML dashboard (traffic, search, Core Web Vitals, on-page audit, issue log, page explorer, paid advertising). Charts have date ranges, day-to-year grouping and hover values; Core Web Vitals, SEO and the page explorer filter by subdirectory, country and traffic source. Loads its data from the backend API; falls back to its own browser cache when the backend is offline. |
| `crawler/` | PowerShell on-page crawler. Scores each page 0-1 on crawl, meta, content, links, schema and other, and produces an issue log. |
| `mongodb/` | PowerShell scripts that convert data to MongoDB import files, create indexes and load into Atlas; the daily crawl refresh. |
| `backend/` | Node.js backend: read-only API for the dashboard and daily ingest jobs for GA4, Search Console, PageSpeed, CrUX, real-user Core Web Vitals, paid advertising (Meta, Google Ads, LinkedIn), UptimeRobot and the SSL certificate. Also holds `gtm/` (web-vitals tag), `google-ads-script/` (daily export to a Sheet) and `tools/` (LinkedIn export converter, paid CSV import). |
| `tools/` | Background saver that writes the dashboard's browser data to a local JSON file. |
| `docs/` | MongoDB schema. |

## How the data flows

```
Google (GA4, Search Console, PageSpeed, CrUX) --> backend ingest jobs --> MongoDB Atlas --> backend API --> dashboard
Visitors' browsers (web-vitals tag in GTM) --> GA4 events --> backend job --> real-user Core Web Vitals
Meta, Google Ads (through a Sheet), LinkedIn (CSV export) --> paid_rows --> /api/paid/feed --> Paid advertising page
UptimeRobot + the site's TLS certificate --> uptime_daily / uptime_monitors --> uptime and SSL alerts
tritorc.com --> crawler --> MongoDB Atlas (audit scores and issues)
```

## Security

- Secrets live only in `.env` files and a Google service-account key file. Both are git-ignored.
- Copy `backend/.env.example` to `backend/.env` and fill it in. Never commit it.
- The backend API listens on `127.0.0.1` only and has no login. Add authentication before exposing it on a network.
- Analytics data files and exports are git-ignored on purpose.

## Setup

1. Create a MongoDB Atlas cluster and a database user.
2. `cd backend`, install dependencies with `npm install`, copy `.env.example` to `.env` and fill it in.
3. Follow `backend/SETUP_GOOGLE.md` to create the Google service account.
4. Start the API with `npm start`; run ingest jobs with `npm run ingest -- all`.
5. Open `dashboard/TRITORC_Website_SEO_Dashboard.html`.

Note: the PowerShell scripts under `crawler/`, `mongodb/` and `tools/` are written to run from a single data folder
(they read and write `tritorc_data.json`, the CSVs and `mongo_export/` next to themselves). Copy them into one working folder to use them.
