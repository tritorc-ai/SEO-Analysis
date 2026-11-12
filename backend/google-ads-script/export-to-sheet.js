/**
 * TRITORC: daily export of Google Ads campaign performance to a Google Sheet.
 *
 * Install in the MANAGER account (Tools > Bulk actions > Scripts > + > New script), authorize it once, then schedule it Daily.
 * It reads every client account under the manager and rewrites the sheet "rows" with the last DAYS days.
 * The TRITORC backend then reads that sheet (shared with its service account) and feeds the dashboard's Paid advertising page.
 *
 * First run: leave SPREADSHEET_ID empty. The script creates the sheet, shares it with SHARE_WITH, and prints the ID in the log.
 * Paste that ID below (and into backend/.env as GOOGLE_ADS_SHEET_ID), save, and the next runs update the same sheet.
 */
var SPREADSHEET_ID = '';
var SHARE_WITH = 'tritorc-seo-reader@seo-monitoring-513906.iam.gserviceaccount.com';
var DAYS = 35;
var SHEET_NAME = 'rows';
var HEADERS = ['date', 'customer_id', 'account', 'currency', 'campaign_id', 'campaign', 'type', 'impressions', 'clicks', 'cost', 'conversions'];

function main() {
  var tz = AdsApp.currentAccount().getTimeZone();
  var to = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd');
  var from = Utilities.formatDate(new Date(new Date().getTime() - DAYS * 86400000), tz, 'yyyy-MM-dd');
  var query = 'SELECT segments.date, customer.id, customer.descriptive_name, customer.currency_code, ' +
    'campaign.id, campaign.name, campaign.advertising_channel_type, ' +
    'metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions ' +
    "FROM campaign WHERE segments.date BETWEEN '" + from + "' AND '" + to + "'";

  var rows = [], done = 0, skipped = [];
  var accounts = AdsManagerApp.accounts().get();
  while (accounts.hasNext()) {
    var acc = accounts.next();
    try {
      AdsManagerApp.select(acc);
      var res = AdsApp.search(query);
      while (res.hasNext()) {
        var r = res.next(), m = r.metrics;
        var imp = Number(m.impressions) || 0, clk = Number(m.clicks) || 0, cost = (Number(m.costMicros) || 0) / 1e6, conv = Number(m.conversions) || 0;
        if (!imp && !clk && !cost && !conv) continue;               // skip all-zero days
        rows.push([String(r.segments.date), String(r.customer.id), r.customer.descriptiveName || '', r.customer.currencyCode || '',
          String(r.campaign.id), r.campaign.name || '', String(r.campaign.advertisingChannelType || ''), imp, clk, cost, conv]);
      }
      done++;
    } catch (e) {
      skipped.push(acc.getCustomerId() + ' (' + e.message + ')');   // e.g. sub-manager accounts or accounts with no access
    }
  }

  var ss = SPREADSHEET_ID ? SpreadsheetApp.openById(SPREADSHEET_ID) : SpreadsheetApp.create('TRITORC Google Ads daily export');
  var sh = ss.getSheetByName(SHEET_NAME) || ss.insertSheet(SHEET_NAME);
  sh.clearContents();
  sh.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]);
  if (rows.length) {
    sh.getRange(2, 1, rows.length, 2).setNumberFormat('@');        // keep dates and customer IDs as text
    sh.getRange(2, 5, rows.length, 1).setNumberFormat('@');        // campaign id as text
    sh.getRange(2, 1, rows.length, HEADERS.length).setValues(rows);
  }
  if (!SPREADSHEET_ID && SHARE_WITH) ss.addViewer(SHARE_WITH);
  Logger.log('Wrote ' + rows.length + ' rows from ' + done + ' accounts (' + from + ' to ' + to + ').');
  if (skipped.length) Logger.log('Skipped: ' + skipped.join('; '));
  Logger.log('SPREADSHEET_ID = ' + ss.getId());
  Logger.log('Sheet URL: ' + ss.getUrl());
}
