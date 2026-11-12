# MongoDB schema (database `tritorc_seo`)

Design rules: store raw numbers (CTR, averages and composite scores are calculated when read); `null` means "no data", which is different from 0;
paths are case-sensitive; every collection has a natural unique key so loads can be repeated without duplicates (upsert).

| Collection | One document per | Unique / main index |
|---|---|---|
| `sites` | website | `siteId` |
| `pages` | page path | `siteId, path` |
| `ga4_daily` | site and day | `siteId, date` |
| `gsc_daily` | site and day | `siteId, date` |
| `page_metrics` | page, source (`ga4` or `gsc`) and 28-day window | `siteId, path, source, windowEnd` |
| `queries` | query, page and window | `siteId, windowEnd, query, path` |
| `lighthouse_runs` | page, device and run (history kept) | `siteId, path, strategy, runAt desc` |
| `cwv_field` | scope (`origin` or `url`), device and fetch; `source: "rum"` rows are our own real-user readings (preferred over CrUX) | `siteId, scope, path, formFactor, fetchedAt desc` |
| `paid_rows` | ad platform (`google`, `linkedin`, `meta`), account, campaign (or ad set) and day | `siteId, date, platform, account, cid` (unique) |
| `paid_funds` | recorded top-up (optional) | `siteId, platform, date` |
| `uptime_daily` | UptimeRobot monitor and complete day | `siteId, monitorId, date` (unique) |
| `uptime_monitors` | monitor, plus one `tls-<host>` row with the site's SSL expiry read directly | `siteId, monitorId` |
| `audit_runs` | crawl | `siteId, runId` |
| `page_audits` | page and crawl | `siteId, runId, path` |
| `issues` | issue | `siteId, issueKey`; also `siteId, status, severity` |
| `audience_snapshots` | window | `siteId, windowEnd` |
| `ga4_event_catalog` | pull | `siteId, pulledAt desc` |
| `sync_log` | sync | `siteId, source, finishedAt desc` |

## Example documents

`pages`
```json
{ "siteId": "tritorc", "path": "/careers", "group": "Corporate", "priority": 1, "region": "Global",
  "title": "Careers at Tritorc", "targetKeyword": null, "indexStatus": "Not inspected", "active": true, "inRegistry": true }
```

`ga4_daily`
```json
{ "siteId": "tritorc", "date": { "$date": "2026-11-05T00:00:00Z" }, "users": 492, "newUsers": 395, "sessions": 608,
  "engagedSessions": 315, "engagementSeconds": 17305, "keyEvents": 0,
  "channels": { "Direct": 321, "Organic Search": 198 },
  "events": { "form_submit": null, "quote_request": null, "file_download": 3, "whatsapp_click": 1, "phone_click": null } }
```

`lighthouse_runs`
```json
{ "siteId": "tritorc", "path": "/careers", "strategy": "mobile", "runAt": { "$date": "2026-11-06T09:08:33Z" },
  "performance": 69, "seo": 92 }
```

`paid_rows` (amounts stay in each account's own currency; nothing is converted in the database)
```json
{ "siteId": "tritorc", "date": { "$date": "2026-11-05T00:00:00Z" }, "platform": "meta", "account": "Tritorc Group · act_933966175668454",
  "cid": "120200000000000001", "campaign": "Hydraulic-torque-wrench", "type": "OUTCOME_LEADS", "currency": "INR",
  "impressions": 40123, "clicks": 2650, "spend": 1840.5, "reach": 31100, "landing_page_views": 410, "conversions": 5, "lead_form_submissions": 0 }
```

`uptime_daily`
```json
{ "siteId": "tritorc", "monitorId": "804645429", "name": "www.tritorc.com/", "date": { "$date": "2026-11-13T00:00:00Z" }, "uptimePct": 100, "avgResponseMs": 145 }
```

`issues`
```json
{ "siteId": "tritorc", "issueKey": "ISS-27AF09", "path": "/example", "type": "Page not reachable", "severity": "Critical",
  "status": "Open", "owner": "Web dev", "firstSeen": { "$date": "2026-11-06T00:00:00Z" }, "lastSeen": { "$date": "2026-11-06T00:00:00Z" },
  "resolvedAt": null, "evidence": "Page returns 404", "fix": "Fix the URL or redirect it" }
```
