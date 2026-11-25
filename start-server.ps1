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

function Write-JsonResponse($response, $statusCode, $value) {
  $response.StatusCode = $statusCode
  $response.ContentType = "application/json; charset=utf-8"
  $response.Headers.Add("Cache-Control", "no-store")
  $body = [Text.Encoding]::UTF8.GetBytes((ConvertTo-Json -InputObject $value -Compress -Depth 10))
  $response.ContentLength64 = $body.Length
  $response.OutputStream.Write($body, 0, $body.Length)
}

while ($listener.IsListening) {
  $context = $listener.GetContext()
  $request = $context.Request
  $response = $context.Response
  $path = [Uri]::UnescapeDataString($request.Url.AbsolutePath)

  if ($path -eq "/api/recipes") {
    if ($request.HttpMethod -ne "POST") {
      $response.Headers.Add("Allow", "POST")
      Write-JsonResponse $response 405 @{ error = "Method not allowed" }
    } elseif (-not $env:MAKE_RECIPES_WEBHOOK_URL) {
      Write-JsonResponse $response 503 @{ error = "יש להגדיר MAKE_RECIPES_WEBHOOK_URL בסביבת השרת." }
    } elseif ($request.ContentLength64 -gt 4096) {
      Write-JsonResponse $response 413 @{ error = "גודל הבקשה חורג מהמותר." }
    } else {
      $requestBody = $null
      $bodyParsed = $false
      try {
        $reader = [IO.StreamReader]::new($request.InputStream, [Text.Encoding]::UTF8)
        $requestBody = ConvertFrom-Json -InputObject $reader.ReadToEnd() -ErrorAction Stop
        $bodyParsed = $true
      } catch {
        Write-JsonResponse $response 400 @{ error = "נתוני השפים אינם בפורמט תקין." }
      }
      if ($bodyParsed) {
        $properties = @($requestBody.PSObject.Properties)
        if ($properties.Count -ne 1 -or $properties[0].Name -ne "chefs" -or
            -not ($requestBody.chefs -is [string]) -or
            [string]::IsNullOrWhiteSpace($requestBody.chefs) -or $requestBody.chefs.Trim().Length -gt 300) {
          Write-JsonResponse $response 400 @{ error = "יש להזין שמות שפים בלבד, עד 300 תווים." }
        } else {
          $webhookUri = $null
          if (-not [Uri]::TryCreate($env:MAKE_RECIPES_WEBHOOK_URL, [UriKind]::Absolute, [ref]$webhookUri) -or $webhookUri.Scheme -ne "https") {
            Write-JsonResponse $response 503 @{ error = "כתובת ה-Webhook של המתכונים אינה תקינה." }
          } else {
            $payload = @{ chefs = $requestBody.chefs.Trim() } | ConvertTo-Json -Compress
            try {
              $makeResponse = Invoke-WebRequest -Method Post -Uri $webhookUri.AbsoluteUri -ContentType "application/json; charset=utf-8" -Body ([Text.Encoding]::UTF8.GetBytes($payload)) -TimeoutSec 60 -UseBasicParsing -ErrorAction Stop
              $reply = [string]$makeResponse.Content
              try {
                $parsedReply = ConvertFrom-Json -InputObject $reply -ErrorAction Stop
                if ($parsedReply -is [string]) {
                  $reply = $parsedReply
                } elseif ($null -ne $parsedReply) {
                  foreach ($propertyName in @("reply", "response", "answer", "message")) {
                    $replyProperty = $parsedReply.PSObject.Properties[$propertyName]
                    if ($null -ne $replyProperty -and $replyProperty.Value -is [string]) {
                      $reply = $replyProperty.Value
                      break
                    }
                  }
                }
              } catch {
                $reply = [string]$makeResponse.Content
              }
              if ($reply -match '^\s*(?:\d{1,3}\s+){3,}\d{1,3}\s*$') {
                $byteValues = @($reply.Trim() -split '\s+' | ForEach-Object { [int]$_ })
                if (-not ($byteValues | Where-Object { $_ -gt 255 })) {
                  $byteArray = [byte[]]$byteValues
                  $strictUtf8 = [Text.UTF8Encoding]::new($false, $true)
                  for ($reverse = 0; $reverse -lt 2; $reverse++) {
                    $candidate = $byteArray
                    if ($reverse -eq 1) {
                      $candidate = [byte[]]$byteArray.Clone()
                      [Array]::Reverse($candidate)
                    }
                    try {
                      $decoded = $strictUtf8.GetString($candidate)
                      if ($decoded -match '[\u0590-\u05FF]') {
                        $reply = $decoded
                        break
                      }
                    } catch [System.Text.DecoderFallbackException] {
                    }
                  }
                }
              }
              if ([string]::IsNullOrWhiteSpace($reply)) {
                Write-JsonResponse $response 502 @{ error = "Make לא החזיר תשובה." }
              } else {
                Write-JsonResponse $response 200 @{ reply = $reply.Trim() }
              }
            } catch {
              Write-JsonResponse $response 502 @{ error = "לא ניתן לקבל תשובה מ-Make כרגע." }
            }
          }
        }
      }
    }
  } elseif ($path -eq "/api/suspicious-point") {
    if ($request.HttpMethod -ne "POST") {
      $response.Headers.Add("Allow", "POST")
      Write-JsonResponse $response 405 @{ error = "Method not allowed" }
    } elseif (-not $env:MAKE_WEBHOOK_URL) {
      Write-JsonResponse $response 503 @{ error = "יש להגדיר MAKE_WEBHOOK_URL בסביבת השרת." }
    } elseif ($request.ContentLength64 -gt 4096) {
      Write-JsonResponse $response 413 @{ error = "גודל הבקשה חורג מהמותר." }
    } else {
      $requestBody = $null
      $bodyParsed = $false
      try {
        $reader = [IO.StreamReader]::new($request.InputStream, [Text.Encoding]::UTF8)
        $requestBody = ConvertFrom-Json -InputObject $reader.ReadToEnd() -ErrorAction Stop
        $bodyParsed = $true
      } catch {
        Write-JsonResponse $response 400 @{ error = "נתוני המיקום אינם בפורמט תקין." }
      }
      if ($bodyParsed) {
        $properties = @($requestBody.PSObject.Properties)
        if ($properties.Count -ne 1 -or $properties[0].Name -ne "city" -or
            -not ($requestBody.city -is [string]) -or
            [string]::IsNullOrWhiteSpace($requestBody.city) -or $requestBody.city.Trim().Length -gt 300) {
          Write-JsonResponse $response 400 @{ error = "יש להזין מיקום אחד בלבד, עד 300 תווים." }
        } else {
          $webhookUri = $null
          if (-not [Uri]::TryCreate($env:MAKE_WEBHOOK_URL, [UriKind]::Absolute, [ref]$webhookUri) -or $webhookUri.Scheme -ne "https") {
            Write-JsonResponse $response 503 @{ error = "כתובת ה-Webhook של Make אינה תקינה." }
          } else {
            $payload = @{ city = $requestBody.city.Trim() } | ConvertTo-Json -Compress
            try {
              $null = Invoke-RestMethod -Method Post -Uri $webhookUri.AbsoluteUri -ContentType "application/json; charset=utf-8" -Body ([Text.Encoding]::UTF8.GetBytes($payload)) -TimeoutSec 10 -ErrorAction Stop
              Write-JsonResponse $response 200 @{ ok = $true }
            } catch {
              Write-JsonResponse $response 502 @{ error = "לא ניתן לשלוח את המיקום ל-Make כרגע." }
            }
          }
        }
      }
    }
  } elseif ($path -eq "/api/chat") {
    if ($request.HttpMethod -ne "POST") {
      $response.Headers.Add("Allow", "POST")
      Write-JsonResponse $response 405 @{ error = "Method not allowed" }
    } elseif (-not $env:GEMINI_API_KEY) {
      Write-JsonResponse $response 503 @{ error = "יש להגדיר GEMINI_API_KEY בסביבת השרת." }
    } elseif ($request.ContentLength64 -gt 65536) {
      Write-JsonResponse $response 413 @{ error = "גודל הבקשה חורג מהמותר." }
    } else {
      try {
        $reader = [IO.StreamReader]::new($request.InputStream, [Text.Encoding]::UTF8)
        $requestBody = $reader.ReadToEnd()
        $chatRequest = ConvertFrom-Json -InputObject $requestBody -ErrorAction Stop
        $contents = @($chatRequest.contents)
        if ($contents.Count -lt 1 -or $contents.Count -gt 24) {
          Write-JsonResponse $response 400 @{ error = "היסטוריית השיחה אינה תקינה." }
        } else {
          $totalCharacters = 0
          $validatedContents = @()
          $valid = $true
          foreach ($message in $contents) {
            $messageParts = @($message.parts)
            if ($message.role -notin @("user", "model") -or $messageParts.Count -lt 1 -or
                -not ($messageParts[0].text -is [string]) -or
                [string]::IsNullOrWhiteSpace($messageParts[0].text) -or $messageParts[0].text.Length -gt 5000) {
              $valid = $false
              break
            }
            $totalCharacters += $messageParts[0].text.Length
            $validatedContents += @{
              role = $message.role
              parts = @(@{ text = $messageParts[0].text })
            }
          }
          if (-not $valid -or $totalCharacters -gt 24000 -or $contents[-1].role -ne "user") {
            Write-JsonResponse $response 400 @{ error = "היסטוריית השיחה חורגת מהמגבלה או אינה תקינה." }
          } else {
            $googleBody = @{
              systemInstruction = @{ parts = @(@{ text = "ענה בעברית ברורה ומדויקת. אם אינך יודע, אמור זאת במפורש." }) }
              contents = $validatedContents
              generationConfig = @{ thinkingConfig = @{ thinkingLevel = "MINIMAL" } }
            } | ConvertTo-Json -Compress -Depth 10
            $escapedKey = [Uri]::EscapeDataString($env:GEMINI_API_KEY)
            $googleUri = "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite`:generateContent?key=$escapedKey"
            $googleResponse = Invoke-RestMethod -Method Post -Uri $googleUri -ContentType "application/json; charset=utf-8" -Body ([Text.Encoding]::UTF8.GetBytes($googleBody)) -TimeoutSec 60 -ErrorAction Stop
            $candidate = @($googleResponse.candidates)[0]
            $reply = (@($candidate.content.parts) | ForEach-Object { $_.text }) -join ""
            if ([string]::IsNullOrWhiteSpace($reply)) {
              Write-JsonResponse $response 502 @{ error = "Gemini לא החזיר תשובה." }
            } else {
              Write-JsonResponse $response 200 @{ reply = $reply }
            }
          }
        }
      } catch {
        Write-JsonResponse $response 502 @{ error = "שגיאה בשליחת ההודעה ל-Gemini. בדקו את המפתח, שם המודל והחיבור לרשת." }
      }
    }
  } elseif ($path -eq "/api/health") {
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
      if ($extension -eq ".html") {
        $html = [Text.Encoding]::UTF8.GetString($bytes)
        $html = [regex]::Replace($html, "(?i)</body>", '<script src="/chat-widget.js" defer></script></body>', 1)
        $bytes = [Text.Encoding]::UTF8.GetBytes($html)
      }
      $response.ContentType = if ($mime.ContainsKey($extension)) { $mime[$extension] } else { "application/octet-stream" }
      $response.ContentLength64 = $bytes.Length
      $response.OutputStream.Write($bytes, 0, $bytes.Length)
    }
  }
  $response.OutputStream.Close()
}
