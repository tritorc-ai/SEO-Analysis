# TRITORC on-page audit crawler
# Reads the page registry from tritorc_data.json, fetches each page, scores it 0-1 on six areas,
# and writes two CSVs the dashboard can import:
#   crawl_audit.csv   (Import dataset: Crawler audit)
#   crawl_issues.csv  (Import dataset: SEO issues)
param(
  [string]$DataFile = (Join-Path $PSScriptRoot 'tritorc_data.json'),
  [int]$Limit = 200,
  [int]$DelayMs = 300
)
$ErrorActionPreference = 'Continue'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$dir = $PSScriptRoot
$today = (Get-Date).ToString('yyyy-MM-dd')

# ---- read site + registry from saved dashboard data ----
$raw = Get-Content $DataFile -Raw -Encoding UTF8
$site = 'https://www.tritorc.com'
$ms = [regex]::Match($raw, '"data":\{"demo":(?:true|false),"site":"([^"]+)"')
if ($ms.Success) { $site = $ms.Groups[1].Value.TrimEnd('/') }
$mr = [regex]::Match($raw, '"reg":"((?:[^"\\]|\\.)*)"')
if (-not $mr.Success) { throw 'No page registry found in the data file.' }
$regText = [regex]::Unescape($mr.Groups[1].Value)
$pages = @()
foreach ($line in ($regText -split "`n")) {
  $t = $line.Trim(); if (-not $t) { continue }
  $p = $t -split ','
  $u = $p[0].Trim(); if ($u -notmatch '^/') { continue }
  $g = if ($p.Count -gt 1) { $p[1].Trim() } else { 'Corporate' }
  $pr = if ($p.Count -gt 2) { $p[2].Trim() } else { '2' }
  $pages += [pscustomobject]@{ Path = $u; Group = $g; Pri = $pr }
}
$pages = $pages | Select-Object -First $Limit
Write-Host "Site: $site   Pages to crawl: $($pages.Count)"

# ---- helpers ----
function Clamp($v) { if ($v -lt 0) { 0 } elseif ($v -gt 1) { 1 } else { [math]::Round($v, 2) } }
function Clean($s) { if ($null -eq $s) { return '' }; ([System.Net.WebUtility]::HtmlDecode(($s -replace '\s+', ' ').Trim())) }
function Q($s) { '"' + (([string]$s) -replace '"', "'" -replace '[\r\n]+', ' ') + '"' }
function Meta($html, $name) {
  $m = [regex]::Match($html, "<meta[^>]+(?:name|property)=[`"']$name[`"'][^>]*content=[`"']([^`"']*)[`"']", 'IgnoreCase')
  if (-not $m.Success) { $m = [regex]::Match($html, "<meta[^>]+content=[`"']([^`"']*)[`"'][^>]*(?:name|property)=[`"']$name[`"']", 'IgnoreCase') }
  if ($m.Success) { Clean $m.Groups[1].Value } else { '' }
}
$issues = New-Object System.Collections.ArrayList
function Add-Issue($url, $type, $sev, $evidence, $fix, $owner) {
  [void]$issues.Add([pscustomobject]@{ url = $url; type = $type; sev = $sev; evidence = $evidence; fix = $fix; owner = $owner })
}

# ---- crawl ----
$rows = @(); $i = 0
foreach ($pg in $pages) {
  $i++
  $url = $site + [Uri]::EscapeUriString($pg.Path)
  $status = 0; $html = ''; $final = $url; $ms2 = 0; $robotsHdr = ''
  $sw = [Diagnostics.Stopwatch]::StartNew()
  try {
    $r = Invoke-WebRequest -Uri $url -UseBasicParsing -UserAgent 'TRITORC-SEO-Audit/1.0' -TimeoutSec 30 -MaximumRedirection 5
    $status = [int]$r.StatusCode; $html = [string]$r.Content
    try { $final = $r.BaseResponse.ResponseUri.AbsoluteUri } catch {}
    try { $robotsHdr = [string]$r.Headers['X-Robots-Tag'] } catch {}
  } catch {
    try { $status = [int]$_.Exception.Response.StatusCode } catch { $status = 0 }
  }
  $sw.Stop(); $ms2 = $sw.ElapsedMilliseconds
  $o = [ordered]@{ url = $pg.Path; group = $pg.Group; priority = $pg.Pri; title = ''; kw = ''; crawl = ''; meta = ''; content = ''; links = ''; schema = ''; other = '' }

  if ($status -ne 200 -or -not $html) {
    $o.crawl = 0
    $sev = 'Critical'
    $t = if ($status -ge 400 -or $status -eq 0) { "Page returns $status" } else { 'Empty response' }
    Add-Issue $pg.Path 'Page not reachable' $sev "$t ($url). If it loads in your browser, the server may be blocking automated requests - verify manually." 'Fix the URL, restore the page, or redirect it to the right page' 'Web dev'
    $rows += [pscustomobject]$o; Write-Host "[$i/$($pages.Count)] $($pg.Path)  status $status"; Start-Sleep -Milliseconds $DelayMs; continue
  }

  # --- extract ---
  $title = ''; $tm = [regex]::Match($html, '<title[^>]*>(.*?)</title>', 'IgnoreCase,Singleline'); if ($tm.Success) { $title = Clean $tm.Groups[1].Value }
  $desc = Meta $html 'description'
  $robots = (Meta $html 'robots') + ' ' + $robotsHdr
  $noindex = $robots -match 'noindex'
  $canon = ''; $cm = [regex]::Match($html, '<link[^>]+rel=["'']canonical["''][^>]*href=["'']([^"'']+)["'']', 'IgnoreCase')
  if (-not $cm.Success) { $cm = [regex]::Match($html, '<link[^>]+href=["'']([^"'']+)["''][^>]*rel=["'']canonical["'']', 'IgnoreCase') }
  if ($cm.Success) { $canon = $cm.Groups[1].Value }
  $viewport = (Meta $html 'viewport') -ne ''
  $lang = $html -match '<html[^>]*\blang=["'']'
  $ogT = (Meta $html 'og:title') -ne ''; $ogI = (Meta $html 'og:image') -ne ''
  $h1 = ([regex]::Matches($html, '<h1\b', 'IgnoreCase')).Count
  $h2 = ([regex]::Matches($html, '<h2\b', 'IgnoreCase')).Count
  $body = $html -replace '(?is)<(script|style|noscript|svg|head|nav|footer)\b.*?</\1>', ' ' -replace '<[^>]+>', ' '
  $words = ([regex]::Matches((Clean $body), "[\p{L}\p{N}']+")).Count
  $imgs = [regex]::Matches($html, '<img\b[^>]*>', 'IgnoreCase'); $imgTotal = $imgs.Count; $imgAlt = 0
  foreach ($im in $imgs) { if ($im.Value -match '\balt\s*=') { $imgAlt++ } }
  $altFrac = if ($imgTotal -gt 0) { $imgAlt / $imgTotal } else { 1 }
  $links = [regex]::Matches($html, '<a\b[^>]*href=["'']([^"'']+)["''][^>]*>(.*?)</a>', 'IgnoreCase,Singleline')
  $intSet = @{}; $anchorOk = 0; $anchorAll = 0
  foreach ($l in $links) {
    $h = $l.Groups[1].Value
    if ($h -match '^(#|javascript:|mailto:|tel:)') { continue }
    $isInt = ($h -match '^/(?!/)') -or ($h -match 'tritorc\.com')
    if ($isInt) { $intSet[$h] = 1 }
    $anchorAll++; if ((Clean ($l.Groups[2].Value -replace '<[^>]+>', ' ')) -ne '' -or $l.Groups[2].Value -match '<img') { $anchorOk++ }
  }
  $intCount = $intSet.Count
  $ld = [regex]::Matches($html, '<script[^>]*type=["'']application/ld\+json["''][^>]*>(.*?)</script>', 'IgnoreCase,Singleline')
  $ldTypes = @(); $ldValid = 0
  foreach ($b in $ld) { try { $null = $b.Groups[1].Value | ConvertFrom-Json; $ldValid++ } catch {}; foreach ($tt in [regex]::Matches($b.Groups[1].Value, '"@type"\s*:\s*"([^"]+)"')) { $ldTypes += $tt.Groups[1].Value } }
  $goodType = $false; foreach ($tt in $ldTypes) { if ($tt -match '^(Product|Organization|Article|BlogPosting|BreadcrumbList|FAQPage|WebSite|WebPage|LocalBusiness|Service)$') { $goodType = $true } }
  $redirected = ($final.TrimEnd('/') -ne $url.TrimEnd('/'))
  $canonNorm = ($canon -replace '^(https?://)www\.', '$1').TrimEnd('/'); $finalNorm = ($final -replace '^(https?://)www\.', '$1').TrimEnd('/')
  $canonWww = ($canon -ne '' -and $canon.TrimEnd('/') -ne $final.TrimEnd('/') -and $canonNorm -eq $finalNorm)
  $canonOther = ($canon -ne '' -and $canonNorm -ne $finalNorm)

  # --- scores (0-1) ---
  $crawl = 1.0
  if ($redirected) { $crawl -= 0.2 }
  if ($noindex) { $crawl -= 0.5 }
  if ($canon -eq '') { $crawl -= 0.2 } elseif ($canonOther) { $crawl -= 0.3 } elseif ($canonWww) { $crawl -= 0.1 }
  if ($ms2 -gt 3000) { $crawl -= 0.1 }
  $meta = 0.0
  if ($title) { $meta += 0.3 }; if ($title.Length -ge 30 -and $title.Length -le 65) { $meta += 0.2 }
  if ($desc) { $meta += 0.3 }; if ($desc.Length -ge 70 -and $desc.Length -le 170) { $meta += 0.1 }
  if ($viewport) { $meta += 0.1 }
  $wscore = if ($words -ge 600) { 1 } elseif ($words -ge 300) { 0.5 + 0.5 * (($words - 300) / 300) } else { 0.5 * $words / 300 }
  $content = 0.6 * $wscore + $(if ($h1 -eq 1) { 0.3 } elseif ($h1 -gt 1) { 0.15 } else { 0 }) + $(if ($h2 -ge 1) { 0.1 } else { 0 })
  $anchorFrac = if ($anchorAll -gt 0) { $anchorOk / $anchorAll } else { 0 }
  $linksScore = 0.7 * [math]::Min(1, $intCount / 10) + 0.3 * $anchorFrac
  $schema = 0.0; if ($ldValid -gt 0) { $schema += 0.5 }; if ($goodType) { $schema += 0.5 }
  $other = 0.4 * $altFrac + $(if ($lang) { 0.2 } else { 0 }) + $(if ($ogT -and $ogI) { 0.2 } elseif ($ogT -or $ogI) { 0.1 } else { 0 }) + $(if ($final -like 'https://*') { 0.2 } else { 0 })

  $o.title = ($title -replace '"', "'"); $o.crawl = Clamp $crawl; $o.meta = Clamp $meta; $o.content = Clamp $content
  $o.links = Clamp $linksScore; $o.schema = Clamp $schema; $o.other = Clamp $other
  $o.kw = ''
  $rows += [pscustomobject]$o

  # --- issues ---
  $path = $pg.Path
  if ($noindex) { Add-Issue $path 'Page set to noindex' 'Critical' "robots: $($robots.Trim())" 'Remove noindex if this page should rank' 'Web dev' }
  if (-not $title) { Add-Issue $path 'Missing title tag' 'Critical' 'No <title> found' 'Add a unique 30-65 character title' 'Content' }
  elseif ($title.Length -lt 30 -or $title.Length -gt 65) { Add-Issue $path 'Title length outside 30-65 characters' 'Notice' "$($title.Length) characters" 'Rewrite the title to 30-65 characters' 'Content' }
  if (-not $desc) { Add-Issue $path 'Missing meta description' 'Warning' 'No meta description found' 'Write a 70-170 character description' 'Content' }
  elseif ($desc.Length -lt 70 -or $desc.Length -gt 170) { Add-Issue $path 'Meta description length' 'Notice' "$($desc.Length) characters" 'Aim for 70-170 characters' 'Content' }
  if ($h1 -eq 0) { Add-Issue $path 'Missing H1' 'Warning' 'No <h1> on the page' 'Add one descriptive H1' 'Content' }
  elseif ($h1 -gt 1) { Add-Issue $path 'Multiple H1 tags' 'Warning' "$h1 H1 tags" 'Keep a single H1' 'Content' }
  if ($words -lt 300) { Add-Issue $path 'Thin content (<300 words)' 'Warning' "$words words" 'Expand with useful detail' 'Content' }
  if ($canon -eq '') { Add-Issue $path 'Missing canonical tag' 'Warning' 'No rel=canonical' 'Add a self-referencing canonical' 'Web dev' }
  elseif ($canonOther) { Add-Issue $path 'Canonical points elsewhere' 'Warning' "canonical $canon vs page $final" 'Check the canonical is intended' 'Web dev' }
  elseif ($canonWww -and $path -eq '/') { Add-Issue $path 'Canonical host differs from served host (www vs non-www)' 'Warning' "Pages are served on $site but canonical tags use the non-www host ($canon). Site-wide." 'Pick one host, redirect the other, and make canonicals match' 'Web dev' }
  if ($redirected) { Add-Issue $path 'URL redirects' 'Warning' "$url -> $final" 'Link to the final URL directly' 'Web dev' }
  if ($imgTotal -gt $imgAlt) { Add-Issue $path 'Images missing alt attribute' 'Warning' "$($imgTotal - $imgAlt) of $imgTotal images" 'Add descriptive alt text' 'Content' }
  if ($ldValid -eq 0) { Add-Issue $path 'No structured data (JSON-LD)' 'Notice' 'No valid JSON-LD found' 'Add Organization/Product/Article schema as relevant' 'Web dev' }
  if ($intCount -lt 3) { Add-Issue $path 'Few internal links' 'Notice' "$intCount internal links" 'Link to related pages' 'SEO' }
  if ($ms2 -gt 3000) { Add-Issue $path 'Slow server response' 'Warning' "$ms2 ms" 'Investigate server or caching' 'Web dev' }
  if (-not $lang) { Add-Issue $path 'Missing html lang attribute' 'Notice' 'No lang on <html>' 'Add lang="en"' 'Web dev' }

  Write-Host "[$i/$($pages.Count)] $($pg.Path)  200  meta $($o.meta) content $($o.content)"
  Start-Sleep -Milliseconds $DelayMs
}

# duplicate titles
$dups = $rows | Where-Object { $_.title } | Group-Object title | Where-Object { $_.Count -gt 1 }
foreach ($d in $dups) { foreach ($r in $d.Group) { Add-Issue $r.url 'Duplicate title tag' 'Warning' "Same title on $($d.Count) pages" 'Make the title unique' 'Content' } }

# ---- audit CSV ----
$enc = New-Object System.Text.UTF8Encoding($false)
$sb = New-Object System.Text.StringBuilder
[void]$sb.AppendLine('url,group,priority,title,kw,crawl,meta,content,links,schema,other')
foreach ($r in $rows) { [void]$sb.AppendLine(((Q $r.url), (Q $r.group), $r.priority, (Q $r.title), (Q $r.kw), $r.crawl, $r.meta, $r.content, $r.links, $r.schema, $r.other) -join ',') }
[IO.File]::WriteAllText((Join-Path $dir 'crawl_audit.csv'), $sb.ToString(), $enc)

# ---- issues CSV with persistent first_seen / resolved tracking ----
$stateFile = Join-Path $dir 'issues_state.json'
$state = @{}
if (Test-Path $stateFile) { try { (Get-Content $stateFile -Raw -Encoding UTF8 | ConvertFrom-Json).PSObject.Properties | ForEach-Object { $state[$_.Name] = $_.Value } } catch {} }
$md5 = [Security.Cryptography.MD5]::Create()
$current = @{}
foreach ($iss in $issues) {
  $h = ($md5.ComputeHash([Text.Encoding]::UTF8.GetBytes($iss.url + '|' + $iss.type)) | Select-Object -First 3 | ForEach-Object { $_.ToString('X2') }) -join ''
  $id = "ISS-$h"; $iss | Add-Member -NotePropertyName id -NotePropertyValue $id -Force
  $first = if ($state.ContainsKey($id)) { $state[$id].first } else { $today }
  $current[$id] = [pscustomobject]@{ id = $id; url = $iss.url; type = $iss.type; sev = $iss.sev; evidence = $iss.evidence; fix = $iss.fix; owner = $iss.owner; first = $first; last = $today; status = 'Open' }
}
$crawledPaths = @{}; foreach ($p in $pages) { $crawledPaths[$p.Path] = 1 }
foreach ($k in $state.Keys) {
  if (-not $current.ContainsKey($k)) {
    $o = $state[$k]
    if ($crawledPaths.ContainsKey($o.url)) {
      $resolvedOn = if ($o.status -eq 'Resolved') { $o.last } else { $today }
      if (((Get-Date) - [datetime]$resolvedOn).TotalDays -le 60) { $current[$k] = [pscustomobject]@{ id = $k; url = $o.url; type = $o.type; sev = $o.sev; evidence = $o.evidence; fix = $o.fix; owner = $o.owner; first = $o.first; last = $resolvedOn; status = 'Resolved' } }
    } else { $current[$k] = $o }
  }
}
$ib = New-Object System.Text.StringBuilder
[void]$ib.AppendLine('id,url,type,severity,first_seen,last_seen,status,owner,evidence,fix')
foreach ($c in ($current.Values | Sort-Object @{e={ switch ($_.sev) { 'Critical' { 0 } 'Warning' { 1 } default { 2 } } }}, url)) {
  [void]$ib.AppendLine(((Q $c.id), (Q $c.url), (Q $c.type), (Q $c.sev), $c.first, $c.last, (Q $c.status), (Q $c.owner), (Q $c.evidence), (Q $c.fix)) -join ',')
}
[IO.File]::WriteAllText((Join-Path $dir 'crawl_issues.csv'), $ib.ToString(), $enc)
($current | ConvertTo-Json -Depth 4) | Out-Null
$stateOut = @{}; foreach ($k in $current.Keys) { $c = $current[$k]; $stateOut[$k] = @{ url = $c.url; type = $c.type; sev = $c.sev; evidence = $c.evidence; fix = $c.fix; owner = $c.owner; first = $c.first; last = $c.last; status = $c.status } }
[IO.File]::WriteAllText($stateFile, ($stateOut | ConvertTo-Json -Depth 4), $enc)

$open = ($current.Values | Where-Object { $_.status -eq 'Open' }).Count
Write-Host ""
Write-Host "Done. Pages: $($rows.Count)   Issues open: $open"
Write-Host "Files: $(Join-Path $dir 'crawl_audit.csv')  and  $(Join-Path $dir 'crawl_issues.csv')"
