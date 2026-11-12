# Real-user Core Web Vitals through GTM and GA4

Flow: visitor's browser (web-vitals script) -> dataLayer -> GA4 events `cwv_lcp`, `cwv_inp`, `cwv_cls` -> `npm run ingest -- rum` -> MongoDB `cwv_field` -> dashboard.

GTM container: GTM-KFP4XBML. GA4 measurement ID: G-NRLWY940HH.

## 1. Loader tag
GTM > Tags > New > **Custom HTML**. Name: `CWV - web-vitals loader`. Paste `web-vitals-tag.html`. Trigger: **All Pages**.

## 2. Two variables
GTM > Variables > User-defined > New > **Data Layer Variable** (version 2):
- `DLV - cwv_event`, data layer variable name `cwv_event`
- `DLV - cwv_bucket`, data layer variable name `cwv_bucket`

## 3. Trigger
GTM > Triggers > New > **Custom Event**. Event name `web_vitals`. Name: `CE - web_vitals`.

## 4. GA4 event tag
GTM > Tags > New > **Google Analytics: GA4 Event**.
- Measurement ID: `G-NRLWY940HH` (or choose your existing GA4 configuration tag).
- Event name: `{{DLV - cwv_event}}`
- Event parameter: name `cwv_bucket`, value `{{DLV - cwv_bucket}}`
- Trigger: `CE - web_vitals`

Use **Preview** (Tag Assistant), open a page, switch tabs, and check that `cwv_lcp` / `cwv_cls` events fire with a `cwv_bucket` value. Then **Submit / Publish**.

## 5. Register the custom dimension in GA4 (required, once)
GA4 > Admin > Custom definitions > Custom dimensions > **Create custom dimension**:
- Dimension name: `CWV bucket`
- Scope: **Event**
- Event parameter: `cwv_bucket`

GA4 only starts reporting a custom dimension from the moment it exists, and it can take up to 24-48 hours to show in the API.

## 6. Pull the data
```
node --env-file=.env src/ingest.js rum
```
`all` already includes it, so the daily 06:30 task picks it up. The job uses the last 28 days and needs at least `RUM_MIN_SAMPLES` (default 50) readings per metric, page and device before it reports a number. The dashboard prefers these readings over CrUX when both exist.

## Notes
- The script loads from unpkg.com (pinned version 4.2.4). To avoid a third-party request, download `web-vitals.iife.js` and host it on tritorc.com, then change `s.src`.
- LCP and CLS are reported when a visitor leaves or switches tab; INP only when they interact, so INP has fewer readings.
- Tablet visits are ignored (CrUX-style phone and desktop only).
- Values are rounded (LCP to 100 ms, INP to 25 ms, CLS to 0.01), so the 75th percentile is accurate to that step.
