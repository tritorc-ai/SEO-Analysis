# Deploying: Render (API) + Vercel (dashboard) + GitHub Actions (daily refresh)

```
Browser --password--> Vercel (dashboard + /api proxy) --Bearer API_TOKEN--> Render (API) --> MongoDB Atlas
GitHub Actions (daily) --> ingest jobs --> MongoDB Atlas
```
The API token lives only in Render and Vercel. The browser only ever sees the shared username and password.

## 0. Make two secrets (any long random text)
- `API_TOKEN`: e.g. 40+ random characters. Same value in Render and Vercel.
- `DASH_PASS`: the shared dashboard password. `DASH_USER`: e.g. `tritorc`.

## 1. MongoDB Atlas: allow the cloud
Atlas > Network Access > Add IP Address > **Allow access from anywhere (0.0.0.0/0)**. Render and GitHub use changing IPs; the database user's strong password is the protection.

## 2. Render (API)
1. render.com > New > **Blueprint** > pick the `SEO-Analysis` repo (it reads `render.yaml`).
2. Enter when asked: `MONGODB_URI` (from backend/.env), `API_TOKEN`, `PAID_FEED_TOKEN` (can be blank).
3. After deploy, open `https://<service>.onrender.com/api/health`. It should say `{"ok":true,...}`. `/api/state` without the token must say `unauthorized`.
Free plan sleeps when idle, so the first load after a quiet spell takes ~30-50 s. The dashboard waits up to 60 s. The $7 Starter plan removes that.

## 3. Vercel (dashboard)
1. vercel.com > Add New > Project > import the repo. **Root Directory: `dashboard`**. Framework: Other.
2. Environment variables: `DASH_USER`, `DASH_PASS`, `API_TOKEN`, `BACKEND_URL` (the Render URL, no trailing slash).
3. Deploy, open the URL: the browser asks for the username and password, then the dashboard loads live data.

## 4. GitHub Actions (daily refresh, 06:30 IST)
Repo > Settings > Secrets and variables > Actions > New repository secret, one each (values from backend/.env):
`MONGODB_URI`, `GA4_PROPERTY_ID`, `GSC_PROPERTY`, `GOOGLE_API_KEY`, `META_ACCESS_TOKEN`, `META_AD_ACCOUNTS`, `GOOGLE_ADS_SHEET_ID`, `UPTIMEROBOT_API_KEY`,
and `GOOGLE_SERVICE_ACCOUNT_JSON` = the **entire contents** of `google-sa.json`.
Then Actions > "Daily data refresh" > Run workflow once to test.

After this you can switch off the PC's scheduled tasks (they would only duplicate the work).
Meta's token expires ~11 Jan 2027: replace the `META_ACCESS_TOKEN` secret then.
