// Vercel serverless gate for the dashboard.
//  - Every request needs the shared username + password (DASH_USER / DASH_PASS) via HTTP Basic auth.
//  - "/"          -> the dashboard HTML (kept outside the public folder so it cannot be fetched without the password)
//  - "/api/state" and "/api/paid/feed" -> forwarded to the Render backend with the secret API_TOKEN added here, on the server.
//    The token never reaches the browser.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const same = (a, b) => {
  const x = crypto.createHash('sha256').update(String(a)).digest(), y = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(x, y);
};
const deny = (res) => { res.statusCode = 401; res.setHeader('WWW-Authenticate', 'Basic realm="TRITORC SEO dashboard", charset="UTF-8"'); res.setHeader('Cache-Control', 'no-store'); res.end('Authentication required'); };
const fail = (res, code, msg) => { res.statusCode = code; res.setHeader('Content-Type', 'application/json'); res.setHeader('Cache-Control', 'no-store'); res.end(JSON.stringify({ error: msg })); };

let html;
module.exports = async (req, res) => {
  const { DASH_USER, DASH_PASS, BACKEND_URL, API_TOKEN } = process.env;
  if (!DASH_USER || !DASH_PASS) return fail(res, 500, 'DASH_USER / DASH_PASS are not set on Vercel');
  const m = /^Basic (.+)$/.exec(req.headers.authorization || '');
  const [u, ...rest] = m ? Buffer.from(m[1], 'base64').toString('utf8').split(':') : [''];
  // Evaluate both comparisons so timing does not reveal which one failed.
  const okU = same(u, DASH_USER), okP = same(rest.join(':'), DASH_PASS);
  if (!(okU && okP)) return deny(res);

  const url = new URL(req.url, 'http://x');
  const route = url.searchParams.get('r');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');

  if (route === 'page') {
    html ||= fs.readFileSync(path.join(process.cwd(), 'TRITORC_Website_SEO_Dashboard.html'));
    res.statusCode = 200; res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.setHeader('Cache-Control', 'private, no-store');
    return res.end(html);
  }

  if (route === 'state' || route === 'feed') {
    if (!BACKEND_URL || !API_TOKEN) return fail(res, 500, 'BACKEND_URL / API_TOKEN are not set on Vercel');
    url.searchParams.delete('r');
    const qs = url.searchParams.toString();
    const target = BACKEND_URL.replace(/\/+$/, '') + (route === 'state' ? '/api/state' : '/api/paid/feed') + (qs ? '?' + qs : '');
    try {
      const r = await fetch(target, { headers: { Authorization: 'Bearer ' + API_TOKEN }, signal: AbortSignal.timeout(55000) });
      const body = Buffer.from(await r.arrayBuffer());
      res.statusCode = r.status; res.setHeader('Content-Type', r.headers.get('content-type') || 'application/json'); res.setHeader('Cache-Control', 'private, no-store');
      return res.end(body);
    } catch (e) {
      return fail(res, 502, 'backend unreachable (' + (e.name === 'TimeoutError' ? 'timed out' : e.message) + ')');
    }
  }
  return fail(res, 404, 'not found');
};
