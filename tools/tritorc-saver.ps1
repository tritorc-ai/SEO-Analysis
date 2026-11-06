# TRITORC dashboard background saver.
# Listens on http://localhost:8787 (this PC only) and writes the dashboard's fetched data to JSON.
#   POST /save  -> writes tritorc_data.json (+ one dated backup per day)
#   GET  /data  -> returns the saved JSON
$dir  = Split-Path -Parent $MyInvocation.MyCommand.Path
$main = Join-Path $dir 'tritorc_data.json'
$l = New-Object System.Net.HttpListener
$l.Prefixes.Add('http://localhost:8787/')
$l.Start()
while ($l.IsListening) {
  $c = $l.GetContext(); $rq = $c.Request; $rs = $c.Response
  try {
    $rs.Headers.Add('Access-Control-Allow-Origin', '*')
    $rs.Headers.Add('Access-Control-Allow-Methods', 'POST, GET, OPTIONS')
    $rs.Headers.Add('Access-Control-Allow-Headers', 'Content-Type')
    $rs.Headers.Add('Access-Control-Allow-Private-Network', 'true')
    $path = $rq.Url.AbsolutePath
    if ($rq.HttpMethod -eq 'OPTIONS') { $rs.StatusCode = 204 }
    elseif ($rq.HttpMethod -eq 'POST' -and $path -eq '/save') {
      if ($rq.ContentLength64 -gt 50MB) { $rs.StatusCode = 413 }
      else {
        $sr = New-Object System.IO.StreamReader($rq.InputStream, [System.Text.Encoding]::UTF8)
        $body = $sr.ReadToEnd(); $sr.Close()
        if ($body.TrimStart().StartsWith('{')) {
          $tmp = "$main.tmp"
          [System.IO.File]::WriteAllText($tmp, $body, (New-Object System.Text.UTF8Encoding($false)))
          Move-Item -Force $tmp $main
          Copy-Item -Force $main (Join-Path $dir ("tritorc_data_{0}.json" -f (Get-Date -Format 'yyyy-MM-dd')))
          $rs.StatusCode = 200
        } else { $rs.StatusCode = 400 }
      }
    }
    elseif ($rq.HttpMethod -eq 'GET' -and $path -eq '/data' -and (Test-Path $main)) {
      $bytes = [System.IO.File]::ReadAllBytes($main)
      $rs.ContentType = 'application/json'; $rs.OutputStream.Write($bytes, 0, $bytes.Length)
    }
    else { $rs.StatusCode = 404 }
  } catch { try { $rs.StatusCode = 500 } catch {} }
  finally { try { $rs.Close() } catch {} }
}
