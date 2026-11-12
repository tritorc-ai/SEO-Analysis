// All settings come from .env (never hard-coded). Secrets are never logged.
const e = process.env;
export const cfg = {
  mongoUri: e.MONGODB_URI,
  dbName: e.MONGODB_DB || 'tritorc_seo',
  siteId: e.SITE_ID || 'tritorc',
  siteUrl: (e.SITE_URL || 'https://www.tritorc.com').replace(/\/+$/, ''),
  ga4Property: e.GA4_PROPERTY_ID,
  gscProperty: e.GSC_PROPERTY,
  saFile: e.GOOGLE_SERVICE_ACCOUNT_FILE,
  apiKey: e.GOOGLE_API_KEY,
  port: Number(e.PORT || 8790),
  cruxMinSessions: Number(e.CRUX_MIN_SESSIONS || 300),
  rumMinSamples: Number(e.RUM_MIN_SAMPLES || 50),
  events: {
    form: e.EVENT_FORM || 'form_submit',
    quote: e.EVENT_QUOTE || 'quote_request',
    phone: e.EVENT_PHONE || 'phone_click',
    email: e.EVENT_EMAIL || 'email_click',
    download: e.EVENT_DOWNLOAD || 'file_download'
  }
};
const list = (s) => (s || '').split(',').map((x) => x.trim()).filter(Boolean);
// Paid advertising (Google Ads, LinkedIn, Meta). A platform runs only when all of its settings are present.
cfg.paid = {
  days: Number(e.PAID_DAYS || 35),
  feedToken: e.PAID_FEED_TOKEN,
  // Optional currency conversion done in the feed. PAID_REPORT_CURRENCY=INR and PAID_FX=AED:23.8,USD:88 mean "1 AED = 23.8 INR, 1 USD = 88 INR".
  // Rows in a currency without a rate stay unconverted (the dashboard then shows its mixed-currency warning). Original amounts are kept in the database.
  reportCurrency: (e.PAID_REPORT_CURRENCY || '').trim().toUpperCase(),
  fx: Object.fromEntries((e.PAID_FX || '').split(',').map((s) => s.trim().split(':')).filter((p) => p.length === 2 && +p[1] > 0).map(([c, r]) => [c.trim().toUpperCase(), +r])),
  meta: { token: e.META_ACCESS_TOKEN, accounts: list(e.META_AD_ACCOUNTS), ver: e.META_API_VERSION || 'v23.0' },
  google: {
    devToken: e.GOOGLE_ADS_DEVELOPER_TOKEN, clientId: e.GOOGLE_ADS_CLIENT_ID, clientSecret: e.GOOGLE_ADS_CLIENT_SECRET, refresh: e.GOOGLE_ADS_REFRESH_TOKEN,
    sheetId: e.GOOGLE_ADS_SHEET_ID,
    login: (e.GOOGLE_ADS_LOGIN_CUSTOMER_ID || '').replace(/-/g, ''), customers: list(e.GOOGLE_ADS_CUSTOMER_IDS).map((x) => x.replace(/-/g, '')), ver: e.GOOGLE_ADS_API_VERSION || 'v21'
  },
  linkedin: { token: e.LINKEDIN_ACCESS_TOKEN, accounts: list(e.LINKEDIN_AD_ACCOUNTS), ver: e.LINKEDIN_API_VERSION || '202511' }
};
// UptimeRobot (read-only API key). UPTIMEROBOT_MONITOR_IDS is optional: without it, monitors whose URL contains the site's host are used.
cfg.uptime = { key: e.UPTIMEROBOT_API_KEY, monitors: list(e.UPTIMEROBOT_MONITOR_IDS), days: Math.min(180, Math.max(7, Number(e.UPTIME_DAYS || 90))) };
export const log = (...a) => console.log(new Date().toISOString().replace('T', ' ').slice(0, 19), ...a);
export const ymd = (d) => d.toISOString().slice(0, 10);
export const addDays = (d, n) => new Date(d.getTime() + n * 864e5);
export const dayDate = (s) => new Date(s + 'T00:00:00Z');
