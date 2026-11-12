# LinkedIn Ads: import into the Paid advertising page without the API

Use this until LinkedIn approves an Advertising API app (see SETUP_PAID.md). No credentials are needed.

## 1. Export from Campaign Manager
1. LinkedIn Campaign Manager > your ad account > **Campaigns**.
2. Set the date range from your first campaign date to today (always a full range: the page replaces everything from the earliest date in the file onwards).
3. Choose the **Daily** breakdown (Breakdown / "Show by: Day"), pick columns: Impressions, Clicks, Total spent, Leads (lead form completions), Conversions, Landing page clicks.
4. **Export**. A CSV (or Excel saved as CSV) is fine. If you get an .xlsx file, open it in Excel and Save As **CSV**.

## 2. Convert
Drag the exported file onto `convert-linkedin.cmd`, or run:
```
tools\convert-linkedin.cmd "C:\path\to\export.csv" --account "Tritorc LinkedIn" --currency USD
```
It writes `export.converted.csv` next to your file and prints the totals so you can check them against Campaign Manager.

Options:
- `--account "Name"`: account name to show when the export has no account column.
- `--currency CODE`: currency when the export has none (for example INR or USD).
- `--date-format dmy` (or `mdy`): only needed when every date in the file has a day of 12 or less, so the order cannot be told. The converter warns when this happens.
- `--json`: write a JSON feed instead of CSV.
- `--out file`: choose the output file name.

## 3. Import into the dashboard
Paid advertising page > **LinkedIn Ads** card > **Configure connection** > **Import CSV/JSON** > choose the `.converted.csv`. Untick **demo data** at the top.

## What it understands
Metadata lines above the header, UTF-8 and UTF-16 files, comma / tab / semicolon separators, dates as YYYY-MM-DD, MM/DD/YYYY or DD/MM/YYYY, numbers with thousands separators,
"Total" rows (ignored), and the different column names LinkedIn uses (Start Date (in UTC), Campaign Name, Total Spent, Leads, Currency Code and so on).
If a needed column is missing it stops and lists the columns it found.

## Valid and qualified enquiries
LinkedIn lead-form counts come through as "Lead form fill-ups". Valid and qualified enquiries come from the lead registry CSV on the same page.
