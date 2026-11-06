param([string[]]$Only)
# Loads mongo_export\*.json into MongoDB Atlas. Reads MONGODB_URI / MONGODB_DB from .env. Never prints the URI.
$ErrorActionPreference = 'Continue'   # mongoimport writes progress to stderr; failures are checked via exit codes
$dir = $PSScriptRoot
$envFile = Join-Path $dir '.env'
$cfg = @{}
Get-Content $envFile -Encoding UTF8 | ForEach-Object { if ($_ -match '^\s*([A-Z_]+)\s*=\s*(.*?)\s*$' -and $_ -notmatch '^\s*#') { $cfg[$Matches[1]] = $Matches[2].Trim('"').Trim("'") } }
$uri = $cfg['MONGODB_URI']; $dbName = if ($cfg['MONGODB_DB']) { $cfg['MONGODB_DB'] } else { 'tritorc_seo' }
if (-not $uri -or $uri -match 'PASTE_YOUR' -or $uri -notmatch '^mongodb(\+srv)?://') { Write-Host 'The .env file does not contain a valid MONGODB_URI yet.'; exit 1 }
if ($uri -match '<password>') { throw 'The connection string still contains <password>. Replace it with your real password.' }
# URL-encode the password part automatically (special characters such as @ # / : ? break the connection string otherwise)
$m = [regex]::Match($uri, '^(mongodb(?:\+srv)?://)([^:/@]*):(.*)@([^/@?]+)(/[^?]*)?(\?.*)?$')
if ($m.Success) {
  $pw = $m.Groups[3].Value
  if ($pw -notmatch '%[0-9A-Fa-f]{2}') { $pw = [Uri]::EscapeDataString($pw) }
  $uri = $m.Groups[1].Value + $m.Groups[2].Value + ':' + $pw + '@' + $m.Groups[4].Value + $m.Groups[5].Value + $m.Groups[6].Value
}
$imp = (Get-ChildItem (Join-Path $dir 'mongo_tools\dbtools') -Recurse -Filter mongoimport.exe | Select-Object -First 1).FullName
$sh = (Get-ChildItem (Join-Path $dir 'mongo_tools\mongosh') -Recurse -Filter mongosh.exe | Select-Object -First 1).FullName

Write-Host "Creating indexes in database '$dbName' ..."
$env:DB_NAME = $dbName
& $sh $uri --quiet --file (Join-Path $dir 'create_indexes.js') 2>&1 | ForEach-Object { $_ -replace [regex]::Escape($uri), '[URI]' }
if ($LASTEXITCODE -ne 0) { throw 'Index creation failed (check the user/password and Network Access in Atlas).' }

$upsert = [ordered]@{
  sites = 'siteId'; pages = 'siteId,path'; ga4_daily = 'siteId,date'; gsc_daily = 'siteId,date'
  page_metrics = 'siteId,path,source,windowEnd'; queries = 'siteId,windowEnd,query,path'
  lighthouse_runs = 'siteId,path,strategy,runAt'; cwv_field = 'siteId,scope,path,formFactor,fetchedAt'
  audit_runs = 'siteId,runId'; page_audits = 'siteId,runId,path'; issues = 'siteId,issueKey'
  audience_snapshots = 'siteId,windowEnd'; ga4_event_catalog = 'siteId,pulledAt'; sync_log = 'siteId,source,finishedAt'
}
foreach ($c in $upsert.Keys) {
  if ($Only -and ($Only -notcontains $c)) { continue }
  $f = Join-Path $dir "mongo_export\$c.json"
  if (-not (Test-Path $f)) { Write-Host "skip $c (no file)"; continue }
  $o = & $imp --uri $uri --db $dbName --collection $c --file $f --mode=upsert --upsertFields=$($upsert[$c]) 2>&1 | Out-String
  $line = ($o -split "`n" | Where-Object { $_ -match 'imported|error|failed' } | Select-Object -Last 1)
  Write-Host ("{0,-20} {1}" -f $c, ($line -replace [regex]::Escape($uri), '[URI]').Trim())
}

Write-Host "`nVerifying counts in Atlas ..."
$js = "const d=db.getSiblingDB('$dbName'); d.getCollectionNames().sort().forEach(n=>print(n.padEnd(22)+d[n].countDocuments()))"
& $sh $uri --quiet --eval $js 2>&1 | ForEach-Object { $_ -replace [regex]::Escape($uri), '[URI]' }

