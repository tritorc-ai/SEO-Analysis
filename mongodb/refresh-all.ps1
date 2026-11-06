# Daily refresh: crawl the site -> rebuild MongoDB export files -> load into Atlas. Logs to refresh.log (never logs the connection string).
$dir = $PSScriptRoot
$log = Join-Path $dir 'refresh.log'
function Log($m) { ('{0}  {1}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $m) | Add-Content $log -Encoding UTF8 }
Log '=== refresh started ==='
try {
  # 1. crawler (needs tritorc_data.json for the page registry)
  Log 'crawling pages ...'
  & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $dir 'tritorc-crawler.ps1') *> (Join-Path $dir 'crawler.log')
  $pagesCrawled = @(Import-Csv (Join-Path $dir 'crawl_audit.csv') -Encoding UTF8).Count
  Log "crawl done: $pagesCrawled pages"
  if ($pagesCrawled -lt 10) { throw "crawler produced only $pagesCrawled pages, stopping before the load" }
  # 2. export
  & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $dir 'export-to-mongo-format.ps1') | Out-Null
  Log 'export files rebuilt'
  # 3. load into Atlas
  $o = & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $dir 'load-to-atlas.ps1') -Only page_audits,audit_runs,issues 2>&1 | Out-String
  $bad = ([regex]::Matches($o, '(\d+) document\(s\) failed')) | Where-Object { $_.Groups[1].Value -ne '0' }
  if ($bad -or $o -match 'bad auth|MongoServerError|MongoParseError|not contain a valid|Index creation failed') { Log ('LOAD PROBLEM: ' + (($o -split "`n" | Where-Object { $_ -match 'bad auth|Error|invalid|failed' -and $_ -notmatch ' 0 document\(s\) failed' } | Select-Object -First 3) -join ' | ')); throw 'load reported problems' }
  Log 'loaded into Atlas OK'
  $nd = if ($env:TRITORC_BACKEND_DIR) { $env:TRITORC_BACKEND_DIR } else { Join-Path (Split-Path $dir -Parent) 'backend' }; $node = (Get-ChildItem "$nd\node" -Recurse -Filter node.exe -ErrorAction SilentlyContinue | Select-Object -First 1).FullName; if (-not $node) { $node = 'node' }; & $node --env-file="$nd\.env" "$nd\src\ingest.js" crawllog | Out-Null
} catch { Log "ERROR: $($_.Exception.Message)"; exit 1 }
Log '=== refresh finished ==='

