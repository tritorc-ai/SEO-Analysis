# Converts tritorc_data.json (+ ga4_events_snapshot.json) into MongoDB import files (one JSON document per line).
# Output folder: .\mongo_export\<collection>.json   -- import with Compass or mongoimport (see README_mongodb.md)
# Reads no keys or tokens, and writes none.
param([string]$SiteId = 'tritorc')
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Web.Extensions
$js = New-Object System.Web.Script.Serialization.JavaScriptSerializer
$js.MaxJsonLength = [int]::MaxValue; $js.RecursionLimit = 100
$dir = $PSScriptRoot
$out = Join-Path $dir 'mongo_export'; New-Item -ItemType Directory -Force $out | Out-Null
$enc = New-Object System.Text.UTF8Encoding($false)

$root = $js.DeserializeObject((Get-Content (Join-Path $dir 'tritorc_data.json') -Raw -Encoding UTF8))
$d = $root['data']; $L = $d['live']
function D($s) { @{ '$date' = ($(if ($s.Length -le 10) { "${s}T00:00:00Z" } else { $s })) } }
function Get-Val($h, $k) { if ($h -ne $null -and $h.ContainsKey($k)) { $h[$k] } else { $null } }
$counts = [ordered]@{}
function Unwrap($v) {
  if ($null -eq $v) { return $null }
  $v = $v.psobject.BaseObject
  if ($v -is [string] -or $v -is [ValueType]) { return $v }
  if ($v -is [System.Collections.IDictionary]) { $h = New-Object 'System.Collections.Generic.Dictionary[string,object]'; foreach ($k in @($v.Keys)) { $r = Unwrap $v[$k]; if ($null -ne $r) { $r = $r.psobject.BaseObject }; $h.Add([string]$k, $r) }; return , $h }
  if ($v -is [System.Collections.IEnumerable]) { $a = New-Object System.Collections.ArrayList; foreach ($i in $v) { $r = Unwrap $i; if ($null -ne $r) { $r = $r.psobject.BaseObject }; [void]$a.Add($r) }; return , $a }
  return $v
}
function Write-Coll($name, $docs) {
  $sw = New-Object System.IO.StreamWriter((Join-Path $out "$name.json"), $false, $enc)
  $n = 0; foreach ($doc in $docs) { $u = Unwrap $doc; $u = $u.psobject.BaseObject; $sw.WriteLine($js.Serialize($u)); $n++ }
  $sw.Close(); $script:counts[$name] = $n
}

$days = @($L['daily'].Keys | Sort-Object); $lastDay = $days[-1]
$lastPsi = Get-Val $d['src']['key'] 'lastPsi'; $lastCrux = Get-Val $d['src']['key'] 'lastCrux'
$crawlLog = Join-Path $dir 'crawler.log'
$crawlAt = if (Test-Path $crawlLog) { (Get-Item $crawlLog).LastWriteTimeUtc.ToString('yyyy-MM-ddTHH:mm:ssZ') } else { (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ') }
$runId = 'crawl-' + $crawlAt.Substring(0, 10)

# sites
Write-Coll 'sites' @(, [ordered]@{ siteId = $SiteId; url = $d['site']; ga4PropertyId = (Get-Val $d['src']['ga4'] 'prop'); gscProperty = (Get-Val $d['src']['gsc'] 'site'); brandTerms = $d['brand']; auditWeights = $d['w']; passThreshold = $d['thr'] })

# pages
Write-Coll 'pages' ($L['pages'].Keys | ForEach-Object { $p = $L['pages'][$_]; [ordered]@{ siteId = $SiteId; path = $_; group = $p['group']; priority = $p['pri']; region = $p['region']; title = $(if ($p['title']) { $p['title'] } else { $null }); targetKeyword = $(if ($p['kw']) { $p['kw'] } else { $null }); indexStatus = $p['idx']; active = $true } })

# ga4_daily
Write-Coll 'ga4_daily' ($days | Where-Object { $L['daily'][$_].ContainsKey('users') } | ForEach-Object { $x = $L['daily'][$_]; [ordered]@{ siteId = $SiteId; date = (D $_); users = $x['users']; newUsers = Get-Val $x 'newU'; sessions = Get-Val $x 'sessions'; engagedSessions = Get-Val $x 'eng'; engagementSeconds = Get-Val $x 'engSec'; keyEvents = Get-Val $x 'keyEv'; channels = Get-Val $x 'ch'; events = [ordered]@{ form_submit = (Get-Val $x 'sub'); quote_request = (Get-Val $x 'quote'); file_download = (Get-Val $x 'dl'); whatsapp_click = (Get-Val $x 'wa'); phone_click = (Get-Val $x 'ph') } } })

# gsc_daily
Write-Coll 'gsc_daily' ($days | Where-Object { $L['daily'][$_].ContainsKey('clicks') } | ForEach-Object { $x = $L['daily'][$_]; [ordered]@{ siteId = $SiteId; date = (D $_); clicks = $x['clicks']; impressions = Get-Val $x 'impr'; positionSum = Get-Val $x 'posSum' } })

# page_metrics (28-day windows ending on the last synced day)
$wEnd = D $lastDay
$pm = New-Object System.Collections.ArrayList
foreach ($k in $L['pages'].Keys) {
  $p = $L['pages'][$k]
  if ($p.ContainsKey('ga')) { $g = $p['ga']; [void]$pm.Add([ordered]@{ siteId = $SiteId; path = $k; source = 'ga4'; windowEnd = $wEnd; windowDays = 28; sessions = Get-Val $g 's'; engagedSessions = Get-Val $g 'eng'; views = Get-Val $g 'views'; organicSessions = Get-Val $g 'org'; formSubmits = Get-Val $g 'sub' }) }
  if ($p.ContainsKey('gsc')) { $g = $p['gsc']; [void]$pm.Add([ordered]@{ siteId = $SiteId; path = $k; source = 'gsc'; windowEnd = $wEnd; windowDays = 28; clicks = Get-Val $g 'c'; impressions = Get-Val $g 'i'; positionSum = Get-Val $g 'ps' }) }
}
Write-Coll 'page_metrics' $pm

# queries
Write-Coll 'queries' ($L['queries'] | ForEach-Object { [ordered]@{ siteId = $SiteId; windowEnd = $wEnd; windowDays = 28; query = $_['q']; path = $_['page']; clicks = $_['c']; impressions = $_['i']; position = $_['p'] } })

# lighthouse_runs
$lh = New-Object System.Collections.ArrayList
foreach ($k in $L['pages'].Keys) { $p = $L['pages'][$k]; if ($p.ContainsKey('lh') -and $p['lh'] -ne $null) { foreach ($pair in @(@('m', 'mobile'), @('d', 'desktop'))) { $r = Get-Val $p['lh'] $pair[0]; if ($r) { [void]$lh.Add([ordered]@{ siteId = $SiteId; path = $k; strategy = $pair[1]; runAt = (D $lastPsi); performance = Get-Val $r 'p'; seo = Get-Val $r 's' }) } } } }
Write-Coll 'lighthouse_runs' $lh

# cwv_field (site-wide records written once per device; page-level records per page)
$cw = New-Object System.Collections.ArrayList; $originDone = @{}
foreach ($k in $L['pages'].Keys) { $p = $L['pages'][$k]; if ($p.ContainsKey('cwv') -and $p['cwv'] -ne $null) { foreach ($pair in @(@('m', 'phone'), @('d', 'desktop'))) { $r = Get-Val $p['cwv'] $pair[0]; if (-not $r) { continue }
  $isOrigin = ($r.ContainsKey('o') -and $r['o'])
  if ($isOrigin) { if ($originDone[$pair[1]]) { continue }; $originDone[$pair[1]] = $true }
  [void]$cw.Add([ordered]@{ siteId = $SiteId; scope = $(if ($isOrigin) { 'origin' } else { 'url' }); path = $(if ($isOrigin) { $null } else { $k }); formFactor = $pair[1]; fetchedAt = (D $lastCrux); lcpSeconds = Get-Val $r 'lcp'; inpMs = Get-Val $r 'inp'; cls = Get-Val $r 'cls' }) } } }
Write-Coll 'cwv_field' $cw

# audit_runs + page_audits
$audits = New-Object System.Collections.ArrayList
foreach ($k in $L['pages'].Keys) { $p = $L['pages'][$k]; if ($p.ContainsKey('chk') -and $p['chk'] -ne $null -and $p['chk'].Count -gt 0) { $c = $p['chk']
  [void]$audits.Add([ordered]@{ siteId = $SiteId; runId = $runId; path = $k; reachable = ($c['crawl'] -ne 0 -or $c['meta'] -ne $null); title = $(if ($p['title']) { $p['title'] } else { $null }); scores = [ordered]@{ crawl = Get-Val $c 'crawl'; meta = Get-Val $c 'meta'; content = Get-Val $c 'content'; links = Get-Val $c 'links'; schema = Get-Val $c 'schema'; other = Get-Val $c 'other' } }) } }
Write-Coll 'page_audits' $audits
Write-Coll 'audit_runs' @(, [ordered]@{ siteId = $SiteId; runId = $runId; startedAt = (D $crawlAt); pagesCrawled = $audits.Count; tool = 'tritorc-crawler.ps1 (raw HTML, no JavaScript)' })

# issues
Write-Coll 'issues' ($L['issues'] | ForEach-Object { [ordered]@{ siteId = $SiteId; issueKey = $_['id']; path = $_['url']; type = $_['type']; severity = $_['sev']; status = $_['status']; owner = $_['owner']; firstSeen = (D $_['first']); lastSeen = (D $_['last']); resolvedAt = $(if ($_['status'] -eq 'Resolved') { D $_['last'] } else { $null }); evidence = $_['evidence']; fix = $_['fix'] } })

# audience_snapshots
$mix = $L['mix']; Write-Coll 'audience_snapshots' @(, [ordered]@{ siteId = $SiteId; windowEnd = $wEnd; windowDays = 28; device = $mix['device']; country = $mix['country'] })

# ga4_event_catalog (from the earlier console pull)
$ev = Join-Path $dir 'ga4_events_snapshot.json'
if (Test-Path $ev) { $e = $js.DeserializeObject((Get-Content $ev -Raw -Encoding UTF8)); Write-Coll 'ga4_event_catalog' @(, [ordered]@{ siteId = $SiteId; pulledAt = (D $e['period']['retrieved']); period = $e['period']; events = $e['events']; clickLinks = $e['click_link_urls']; fileDownloads = $e['file_downloads'] }) }

# sync_log
$sl = @(); foreach ($pair in @(@('ga4', (Get-Val $d['src']['ga4'] 'last')), @('gsc', (Get-Val $d['src']['gsc'] 'last')), @('pagespeed', $lastPsi), @('crux', $lastCrux), @('crawler', $crawlAt))) { if ($pair[1]) { $sl += [ordered]@{ siteId = $SiteId; source = $pair[0]; finishedAt = (D $pair[1]); status = 'ok' } } }
Write-Coll 'sync_log' $sl

# --- prefer the fresh crawler CSVs for page_audits / audit_runs / issues (they update on every crawl, no dashboard import needed)
function NumOrNull($s) { if ($null -eq $s -or "$s".Trim() -eq '') { $null } else { [double]$s } }
$auditCsv = Join-Path $dir 'crawl_audit.csv'; $issuesCsv = Join-Path $dir 'crawl_issues.csv'
if (Test-Path $auditCsv) {
  $rowsCsv = @(Import-Csv $auditCsv -Encoding UTF8)
  $audits2 = foreach ($r in $rowsCsv) { [ordered]@{ siteId = $SiteId; runId = $runId; path = $r.url; reachable = (($r.crawl -ne '0' -and $r.crawl -ne '') -or ($r.meta -ne '')); title = $(if ($r.title) { $r.title } else { $null }); scores = [ordered]@{ crawl = (NumOrNull $r.crawl); meta = (NumOrNull $r.meta); content = (NumOrNull $r.content); links = (NumOrNull $r.links); schema = (NumOrNull $r.schema); other = (NumOrNull $r.other) } } }
  Write-Coll 'page_audits' $audits2
  Write-Coll 'audit_runs' @(, [ordered]@{ siteId = $SiteId; runId = $runId; startedAt = (D $crawlAt); pagesCrawled = $rowsCsv.Count; tool = 'tritorc-crawler.ps1 (raw HTML, no JavaScript)' })
}
if (Test-Path $issuesCsv) {
  $iss2 = foreach ($r in (Import-Csv $issuesCsv -Encoding UTF8)) { [ordered]@{ siteId = $SiteId; issueKey = $r.id; path = $r.url; type = $r.type; severity = $r.severity; status = $r.status; owner = $r.owner; firstSeen = (D $r.first_seen); lastSeen = (D $r.last_seen); resolvedAt = $(if ($r.status -eq 'Resolved') { D $r.last_seen } else { $null }); evidence = $r.evidence; fix = $r.fix } }
  Write-Coll 'issues' $iss2
}
Write-Host "Export written to $out"; $counts.GetEnumerator() | ForEach-Object { '{0,-20} {1,6}' -f $_.Key, $_.Value }
