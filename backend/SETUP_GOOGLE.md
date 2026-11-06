# One-time Google setup (so GA4, Search Console, PageSpeed and CrUX refresh by themselves)

The backend reads Google data with a **service account** (a robot login with a permanent key, so no hourly tokens)
and an **API key** (PageSpeed + CrUX).

## A. Service account (GA4 + Search Console)
1. Google Cloud Console -> your project (SEO-monitoring) -> **APIs & Services -> Library**.
   Enable: **Google Analytics Data API** and **Google Search Console API**.
   (PageSpeed Insights API and Chrome UX Report API should already be enabled.)
2. **APIs & Services -> Credentials -> Create credentials -> Service account**.
   Name it `tritorc-seo-reader`. Skip the optional role steps. Click Done.
3. Open the new service account -> **Keys -> Add key -> Create new key -> JSON**. A `.json` file downloads.
4. Move that file to a private place **outside any shared/synced folder**, for example
   `C:\path\to\private-folder\google-sa.json`.
5. Open `.env` in this folder and set:
   `GOOGLE_SERVICE_ACCOUNT_FILE=C:\path\to\private-folder\google-sa.json`
6. In that JSON file find `client_email` (looks like `tritorc-seo-reader@<project>.iam.gserviceaccount.com`).
   Give that email access:
   - **GA4**: Admin -> Property access management -> **+** -> add the email as **Viewer**.
   - **Search Console**: open the property `https://tritorc.com/` -> Settings -> Users and permissions -> Add user -> the email, permission **Restricted** (read-only).

## B. API key (PageSpeed + CrUX)
1. Credentials -> **Create credentials -> API key**. Restrict it to **PageSpeed Insights API** and **Chrome UX Report API**.
2. Put it in `.env`: `GOOGLE_API_KEY=...`
3. The key that appeared in earlier screenshots should be treated as exposed: delete it once the new one works.

## C. Test
```
cd <path to the backend folder>
node --env-file=.env src\ingest.js ga4
node --env-file=.env src\ingest.js gsc
node --env-file=.env src\ingest.js psi
node --env-file=.env src\ingest.js crux
```
Each prints OK or a clear error. Results land in MongoDB and the dashboard shows them after a reload.
