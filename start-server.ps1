$root = $PSScriptRoot
$csvPath = Join-Path $root "Badook-2012026154636-2025-hangashat-meyda-plili.csv"
$port = if ($env:PORT) { $env:PORT } else { "3000" }
$listener = [Net.HttpListener]::new()
$listener.Prefixes.Add("http://127.0.0.1:$port/")
$listener.Start()

Write-Output "PolNet 3D running at http://127.0.0.1:$port"

$mime = @{
  ".html" = "text/html; charset=utf-8"
  ".css" = "text/css; charset=utf-8"
  ".js" = "application/javascript; charset=utf-8"
  ".csv" = "text/csv; charset=utf-8"
  ".svg" = "image/svg+xml"
}

while ($listener.IsListening) {
  $context = $listener.GetContext()
  $request = $context.Request
  $response = $context.Response
  $path = [Uri]::UnescapeDataString($request.Url.AbsolutePath)

  if ($path -eq "/api/health") {
    $body = [Text.Encoding]::UTF8.GetBytes('{"status":"ok"}')
    $response.ContentType = "application/json; charset=utf-8"
    $response.ContentLength64 = $body.Length
    $response.OutputStream.Write($body, 0, $body.Length)
  } elseif ($path -eq "/api/summary") {
    $encoding = [Text.Encoding]::GetEncoding(1255)
    $text = $encoding.GetString([IO.File]::ReadAllBytes($csvPath))
    $lines = $text.Split(@("`r`n", "`n"), [StringSplitOptions]::RemoveEmptyEntries)
    $header = $lines[0].Split(",")
    $count = [Math]::Max(0, $lines.Length - 1)
    $yeshuvIndex = [Array]::IndexOf($header, "Yeshuv")
    $cases = [System.Collections.Generic.HashSet[string]]::new()
    $cities = [System.Collections.Generic.HashSet[string]]::new()
    $caseIndex = [Array]::IndexOf($header, "FictiveIDNumber")
    for ($i = 1; $i -lt $lines.Length; $i++) {
      $fields = $lines[$i].Split(",")
      if ($caseIndex -ge 0 -and $caseIndex -lt $fields.Length) { $null = $cases.Add($fields[$caseIndex]) }
      if ($yeshuvIndex -ge 0 -and $yeshuvIndex -lt $fields.Length) { $null = $cities.Add($fields[$yeshuvIndex]) }
    }
    $json = ConvertTo-Json @{
      incidents = $count
      uniqueCases = $cases.Count
      settlements = $cities.Count
    } -Compress
    $body = [Text.Encoding]::UTF8.GetBytes($json)
    $response.ContentType = "application/json; charset=utf-8"
    $response.ContentLength64 = $body.Length
    $response.OutputStream.Write($body, 0, $body.Length)
  } else {
    if ($path -eq "/" -or [string]::IsNullOrEmpty($path)) { $path = "/code1.html" }
    $filePath = [IO.Path]::GetFullPath((Join-Path $root ($path.TrimStart("/").Replace("/", "\"))))
    if (-not $filePath.StartsWith($root, [StringComparison]::OrdinalIgnoreCase) -or -not [IO.File]::Exists($filePath)) {
      $response.StatusCode = 404
      $body = [Text.Encoding]::UTF8.GetBytes("Not found")
      $response.OutputStream.Write($body, 0, $body.Length)
    } else {
      $bytes = [IO.File]::ReadAllBytes($filePath)
      $extension = [IO.Path]::GetExtension($filePath)
      $response.ContentType = if ($mime.ContainsKey($extension)) { $mime[$extension] } else { "application/octet-stream" }
      $response.ContentLength64 = $bytes.Length
      $response.OutputStream.Write($bytes, 0, $bytes.Length)
    }
  }
  $response.OutputStream.Close()
}
