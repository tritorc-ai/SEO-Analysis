// Google access: a service account (no hourly tokens) for GA4 + Search Console, an API key for PageSpeed + CrUX.
import { GoogleAuth } from 'google-auth-library';
import { cfg } from '../config.js';

let auth;
async function token() {
  if (!cfg.saFile) throw new Error('GOOGLE_SERVICE_ACCOUNT_FILE is not set in .env (see SETUP_GOOGLE.md)');
  auth ||= new GoogleAuth({
    keyFile: cfg.saFile,
    scopes: ['https://www.googleapis.com/auth/analytics.readonly', 'https://www.googleapis.com/auth/webmasters.readonly', 'https://www.googleapis.com/auth/spreadsheets.readonly']
  });
  const c = await auth.getClient();
  const t = await c.getAccessToken();
  return t.token;
}

export async function gpost(url, body) {
  const r = await fetch(url, { method: 'POST', headers: { Authorization: 'Bearer ' + (await token()), 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok || d.error) throw new Error(`${r.status} ${d.error?.message || 'request failed'}`);
  return d;
}

export async function gget(url) {
  const r = await fetch(url, { headers: { Authorization: 'Bearer ' + (await token()) } });
  const d = await r.json().catch(() => ({}));
  if (!r.ok || d.error) throw new Error(`${r.status} ${d.error?.message || 'request failed'}`);
  return d;
}

export function needKey() {
  if (!cfg.apiKey) throw new Error('GOOGLE_API_KEY is not set in .env');
  return cfg.apiKey;
}
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
