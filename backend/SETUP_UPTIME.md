# UptimeRobot: real uptime and SSL expiry for the dashboard

Flow: UptimeRobot --> `npm run ingest -- uptime` (daily 06:30, part of `ingest all`) --> MongoDB `uptime_daily` and `uptime_monitors` --> backend API --> dashboard.

What the dashboard gets:
- **Uptime %** for every complete day (the Uptime card on the Executive overview, and the "Website availability" alert when it drops below 99.5% over 7 days).
- **SSL certificate expiry** (the "SSL certificate" alert when it expires within 30 days). UptimeRobot only gives this on paid plans, so the backend reads it straight from the site's own certificate (a normal TLS connection to port 443, no UptimeRobot needed). It runs in the same daily job, even before you add an UptimeRobot key.
- Daily average **response time** is saved in MongoDB too (not shown on a page yet).

## 1. Create a read-only API key (you, about 1 minute)
1. Sign in at https://dashboard.uptimerobot.com
2. Integrations & API > **API** > **Read-only API key** > create it.
   Use the read-only key, not the Main API key: it can only look at monitors, not change or delete them.
3. Make sure a monitor for https://www.tritorc.com exists (HTTP(s) type). Add one if not; it needs a day or two to build history. HTTPS monitors also report the SSL expiry.

## 2. Put the key in `backend/.env`
```
UPTIMEROBOT_API_KEY=<the read-only key>
# UPTIMEROBOT_MONITOR_IDS=123456789,987654321     # optional; without it, monitors whose URL contains tritorc.com are used
# UPTIME_DAYS=90                                  # optional history to read, 7-180 days
```
Never paste the key into chat or commit `.env`.

## 3. Run it
```
node --env-file=.env src/ingest.js uptime
```
It prints which monitors it used. If none matches the site, it lists the monitors it found so you can set `UPTIMEROBOT_MONITOR_IDS`.

## Notes
- Only complete days are stored (up to yesterday), as UTC days.
- With several monitors for the site, the dashboard shows their average per day.
- UptimeRobot's free plan has a short history and 5-minute checks; if the API says "invalid" or "rate limit", wait a minute and re-run.
- This replaces the old "browser ping" for the uptime number. The "Check now" button on Connections is still only a single ping from your browser.
