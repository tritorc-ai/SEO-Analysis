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
  events: {
    form: e.EVENT_FORM || 'form_submit',
    quote: e.EVENT_QUOTE || 'quote_request',
    phone: e.EVENT_PHONE || 'phone_click',
    email: e.EVENT_EMAIL || 'email_click',
    download: e.EVENT_DOWNLOAD || 'file_download'
  }
};
export const log = (...a) => console.log(new Date().toISOString().replace('T', ' ').slice(0, 19), ...a);
export const ymd = (d) => d.toISOString().slice(0, 10);
export const addDays = (d, n) => new Date(d.getTime() + n * 864e5);
export const dayDate = (s) => new Date(s + 'T00:00:00Z');
