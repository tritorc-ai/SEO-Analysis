# Paid advertising: automatic daily data (Google Ads, LinkedIn Ads, Meta Ads)

How it flows:

```
Google Ads / LinkedIn / Meta APIs --> npm run ingest -- paid (daily, 06:30) --> MongoDB "paid_rows" --> /api/paid/feed --> dashboard "Paid advertising" page
```

The job runs as part of `ingest all`, so the existing "TRITORC Backend Ingest" task (06:30) already includes it. A platform is skipped until **all** of its settings
are in `backend/.env`. Never paste these values into chat or commit `.env`.

Run it by hand: `node --env-file=.env src/ingest.js paid`

## 1. Meta Ads (quickest)
1. Meta Business Settings > Users > **System users** > add a system user (Admin or Employee) > **Add assets** > your ad account(s) with **View performance**.
2. **Generate new token** for your app with the `ads_read` permission (choose "never expires" if offered).
3. In `.env`:
```
META_ACCESS_TOKEN=...
META_AD_ACCOUNTS=act_1234567890,act_9876543210
```

## 2a. Google Ads through a Google Sheet (no API approval needed) <- the route in use
Google's API Center no longer issues developer tokens for the regular Google Ads API, so this route avoids that approval.
1. A script in the manager account (`google-ads-script/export-to-sheet.js`, saved as "TRITORC daily export to Sheet") writes the last 35 days for every client account
   to a Google Sheet, and shares the sheet with the backend's service account (`tritorc-seo-reader@seo-monitoring-513906.iam.gserviceaccount.com`).
2. In the Google Ads script editor click **Authorize** (Google asks you to allow Ads, Sheets and Drive access for the script), then **Run** once.
   The log prints `SPREADSHEET_ID = ...`. Paste that ID into the script (`var SPREADSHEET_ID = '...'`), **Save**, and set the script's **Frequency** to Daily (before 06:30).
3. In Google Cloud (project `seo-monitoring-513906`) enable the **Google Sheets API**:
   https://console.cloud.google.com/apis/library/sheets.googleapis.com?project=seo-monitoring-513906
4. In `.env`: `GOOGLE_ADS_SHEET_ID=<the ID>`. A Sheet ID takes priority over the API settings below.
5. Test: `node --env-file=.env src/ingest.js paid`.
If the job says "403 ... does not have permission", the sheet is not shared with the service account, or the Sheets API is not enabled yet.

## 2b. Google Ads through the API (needs a developer token, approval can take days)
1. In your Google Ads **manager (MCC) account**: Tools > API Center > apply for a **developer token** (Basic access is enough for reporting).
2. In Google Cloud (project `seo-monitoring-513906`): enable the **Google Ads API**, create an **OAuth client ID** (Desktop app), and generate a **refresh token**
   for a Google user who has access to the Ads accounts (scope `https://www.googleapis.com/auth/adwords`). The OAuth Playground can do this once.
3. In `.env`:
```
GOOGLE_ADS_DEVELOPER_TOKEN=...
GOOGLE_ADS_CLIENT_ID=...
GOOGLE_ADS_CLIENT_SECRET=...
GOOGLE_ADS_REFRESH_TOKEN=...
GOOGLE_ADS_LOGIN_CUSTOMER_ID=1112223333        # the manager (MCC) account id, digits only; leave blank if you use a single account directly
GOOGLE_ADS_CUSTOMER_IDS=905-117-3340,412-885-1020,733-204-5518
# GOOGLE_ADS_API_VERSION=v21                     # change if Google retires this version
```
The refresh token does not expire hourly. It stops working only if the user removes access or it goes unused for 6 months.

## 3. LinkedIn Ads (needs an approved app)
1. Create an app at developer.linkedin.com and request the **Advertising API** product (Marketing Developer Platform). Approval can take weeks.
2. Generate an access token with `r_ads` and `r_ads_reporting`. LinkedIn access tokens last about 60 days, so renew it before it expires.
3. In `.env`:
```
LINKEDIN_ACCESS_TOKEN=...
LINKEDIN_AD_ACCOUNTS=512345678
# LINKEDIN_API_VERSION=202511
```

## Other settings
```
PAID_DAYS=35              # how many days back each run re-reads (re-reading a day replaces it)
PAID_FEED_TOKEN=          # optional: if set, the feed needs the header "Authorization: Bearer <this value>"
```

## Connect the dashboard
Open the Paid advertising page. On each platform card, **Configure connection**:
- Feed URL: `http://127.0.0.1:8790/api/paid/feed?platform=google` (use `linkedin` or `meta` on the other cards)
- Feed bearer token: only if you set `PAID_FEED_TOKEN`
- Press **Save & sync**, then untick **demo data**. "Auto-refresh" on the page re-reads the feed while the page is open.
(Meta can also be read directly from the page with a token, but the backend route keeps the token on the server.)

## What is and is not filled
Filled from the APIs: date, account, campaign, campaign type or objective, impressions, clicks, spend, conversions, and where the platform provides them reach, landing page views and lead-form submissions.
Not filled automatically: country and product (add them from the lead registry CSV), valid and qualified enquiries (lead registry CSV), and funds added (top-ups: record them on the page or import a CSV).

## Notes and limits
- The API calls follow each platform's documented endpoints but were tested here only with simulated responses. Run it once with real credentials and check the numbers against each platform's own report before relying on them.
- Platforms revise conversions for several days, which is why each run re-reads the last `PAID_DAYS` days.
- Currencies are kept per row. The page shows a "mixed currencies" notice if accounts differ.
