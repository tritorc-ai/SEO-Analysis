# TRITORC dashboard data -> MongoDB

Files in `mongo_export/` are MongoDB Extended JSON, one document per line. Dates are `{"$date": ...}` so they import as real Date values.

## 1. Refresh the files (any time)
Right-click `export-to-mongo-format.ps1` -> Run with PowerShell. It reads `tritorc_data.json` (kept up to date by the dashboard + saver) and rewrites `mongo_export/`.

## 2. Create a database
- Local: install MongoDB Community Server (+ Compass).
- Cloud: MongoDB Atlas free tier. Keep the connection string in an environment variable, never in chat or in these files.
- Database name used below: `tritorc_seo`

## 3a. Import with Compass (no command line)
For each file: Compass -> database `tritorc_seo` -> Create collection with the file's name -> Add Data -> Import JSON or CSV file -> choose the file -> JSON lines -> Import.

## 3b. Import with mongoimport (MongoDB Database Tools)
Re-runnable: `--mode=upsert` updates documents that already exist instead of duplicating them.
```
mongoimport --uri "%MONGODB_URI%" --db tritorc_seo --collection sites               --file mongo_export\sites.json               --mode=upsert --upsertFields=siteId
mongoimport --uri "%MONGODB_URI%" --db tritorc_seo --collection pages               --file mongo_export\pages.json               --mode=upsert --upsertFields=siteId,path
mongoimport --uri "%MONGODB_URI%" --db tritorc_seo --collection ga4_daily           --file mongo_export\ga4_daily.json           --mode=upsert --upsertFields=siteId,date
mongoimport --uri "%MONGODB_URI%" --db tritorc_seo --collection gsc_daily           --file mongo_export\gsc_daily.json           --mode=upsert --upsertFields=siteId,date
mongoimport --uri "%MONGODB_URI%" --db tritorc_seo --collection page_metrics        --file mongo_export\page_metrics.json        --mode=upsert --upsertFields=siteId,path,source,windowEnd
mongoimport --uri "%MONGODB_URI%" --db tritorc_seo --collection queries             --file mongo_export\queries.json             --mode=upsert --upsertFields=siteId,windowEnd,query,path
mongoimport --uri "%MONGODB_URI%" --db tritorc_seo --collection lighthouse_runs     --file mongo_export\lighthouse_runs.json     --mode=upsert --upsertFields=siteId,path,strategy,runAt
mongoimport --uri "%MONGODB_URI%" --db tritorc_seo --collection cwv_field           --file mongo_export\cwv_field.json           --mode=upsert --upsertFields=siteId,scope,path,formFactor,fetchedAt
mongoimport --uri "%MONGODB_URI%" --db tritorc_seo --collection audit_runs          --file mongo_export\audit_runs.json          --mode=upsert --upsertFields=siteId,runId
mongoimport --uri "%MONGODB_URI%" --db tritorc_seo --collection page_audits         --file mongo_export\page_audits.json         --mode=upsert --upsertFields=siteId,runId,path
mongoimport --uri "%MONGODB_URI%" --db tritorc_seo --collection issues              --file mongo_export\issues.json              --mode=upsert --upsertFields=siteId,issueKey
mongoimport --uri "%MONGODB_URI%" --db tritorc_seo --collection audience_snapshots  --file mongo_export\audience_snapshots.json  --mode=upsert --upsertFields=siteId,windowEnd
mongoimport --uri "%MONGODB_URI%" --db tritorc_seo --collection ga4_event_catalog   --file mongo_export\ga4_event_catalog.json   --mode=upsert --upsertFields=siteId,pulledAt
mongoimport --uri "%MONGODB_URI%" --db tritorc_seo --collection sync_log            --file mongo_export\sync_log.json            --mode=upsert --upsertFields=siteId,source,finishedAt
```

## 4. Create the indexes (do this BEFORE the first import so upserts are fast)
```
mongosh "%MONGODB_URI%" create_indexes.js
```

## Notes
- No API keys or OAuth tokens are exported.
- `null` means "no data", which is different from 0.
- Paths are case-sensitive (`/nfc-cards/najam-siddiqui` and `/nfc-cards/Najam-siddiqui` are different documents).
- `page_audits.reachable=false` means the crawler could not read the page; its scores are not meaningful.
