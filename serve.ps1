# Простой локальный сервер для приложения "Поток".
# Запуск:  powershell -ExecutionPolicy Bypass -File serve.ps1
# Затем откройте http://127.0.0.1:8787/

$root = $PSScriptRoot
$port = 8787
$listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, $port)
$listener.Start()
Write-Host "Поток запущен: http://127.0.0.1:$port/"

$types = @{
  '.html' = 'text/html; charset=utf-8'
  '.css'  = 'text/css; charset=utf-8'
  '.js'   = 'application/javascript; charset=utf-8'
  '.svg'  = 'image/svg+xml'
  '.png'  = 'image/png'
  '.ico'  = 'image/x-icon'
  '.json' = 'application/json; charset=utf-8'
}

while ($true) {
  $client = $listener.AcceptTcpClient()
  try {
    $stream = $client.GetStream()
    $reader = [System.IO.StreamReader]::new($stream, [System.Text.Encoding]::ASCII)
    $requestLine = $reader.ReadLine()
    while ($true) {
      $line = $reader.ReadLine()
      if ([string]::IsNullOrEmpty($line)) { break }
    }

    $status = '200 OK'
    $body = $null
    $mime = 'text/plain; charset=utf-8'

    if ($requestLine -match '^GET\s+(\S+)\s+HTTP') {
      $rel = [System.Uri]::UnescapeDataString($Matches[1])
      $rel = $rel.Split('?')[0].TrimStart('/')
      if ([string]::IsNullOrEmpty($rel)) { $rel = 'index.html' }

      $full = [System.IO.Path]::GetFullPath((Join-Path $root $rel))
      if ($full.StartsWith([System.IO.Path]::GetFullPath($root)) -and (Test-Path $full -PathType Leaf)) {
        $body = [System.IO.File]::ReadAllBytes($full)
        $ext = [System.IO.Path]::GetExtension($full).ToLower()
        if ($types.ContainsKey($ext)) { $mime = $types[$ext] }
      } else {
        $status = '404 Not Found'
        $body = [System.Text.Encoding]::UTF8.GetBytes('Not found')
      }
    } else {
      $status = '405 Method Not Allowed'
      $body = [System.Text.Encoding]::UTF8.GetBytes('Only GET is supported')
    }

    $head = "HTTP/1.1 $status`r`nContent-Type: $mime`r`nContent-Length: $($body.Length)`r`nCache-Control: no-store`r`nConnection: close`r`n`r`n"
    $headBytes = [System.Text.Encoding]::ASCII.GetBytes($head)
    $stream.Write($headBytes, 0, $headBytes.Length)
    $stream.Write($body, 0, $body.Length)
    $stream.Flush()
  } catch {
    # ignore broken connections
  } finally {
    $client.Close()
  }
}
