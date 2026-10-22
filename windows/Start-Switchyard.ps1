# Starts the production server on 127.0.0.1:3010 unless it is already running.
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$repository = Split-Path -Parent $PSScriptRoot
$ui = Join-Path $repository 'ui'
$logDirectory = Join-Path $env:LOCALAPPDATA 'Switchyard'
New-Item -ItemType Directory -Path $logDirectory -Force | Out-Null
$logFile = Join-Path $logDirectory 'server.log'
$errorLog = Join-Path $logDirectory 'server-error.log'

try {
    $response = Invoke-WebRequest -Uri 'http://127.0.0.1:3010' -TimeoutSec 2 -UseBasicParsing
    if ($response.StatusCode -eq 200) {
        Invoke-WebRequest -Uri 'http://127.0.0.1:3010/api/schedules' -TimeoutSec 10 -UseBasicParsing | Out-Null
        exit 0
    }
} catch { }

Set-Location -LiteralPath $ui
$node = (Get-Command node.exe -ErrorAction Stop).Source
$next = Join-Path $repository 'node_modules\next\dist\bin\next'
if (-not (Test-Path -LiteralPath $next)) { $next = Join-Path $ui 'node_modules\next\dist\bin\next' }
$env:NEXT_DIST_DIR = '.next-build'
$existingServer = Get-CimInstance Win32_Process -Filter "name='node.exe'" | Where-Object { $_.CommandLine -and $_.CommandLine.IndexOf($next, [System.StringComparison]::OrdinalIgnoreCase) -ge 0 } | Select-Object -First 1
if ($existingServer) { exit 0 } # A cold server may not be listening yet; do not launch a duplicate.
"$(Get-Date -Format o) Starting Switchyard on 127.0.0.1:3010" | Add-Content -LiteralPath (Join-Path $logDirectory 'launcher.log')
$process = Start-Process -FilePath $node -ArgumentList "`"$next`" start --port 3010 --hostname 127.0.0.1" -WorkingDirectory $ui -WindowStyle Hidden -RedirectStandardOutput $logFile -RedirectStandardError $errorLog -PassThru
for ($attempt = 0; $attempt -lt 90; $attempt++) {
    Start-Sleep -Milliseconds 500
    if ($process.HasExited) { throw "Switchyard exited with code $($process.ExitCode). See $errorLog" }
    try {
        $response = Invoke-WebRequest -Uri 'http://127.0.0.1:3010' -TimeoutSec 2 -UseBasicParsing
        if ($response.StatusCode -eq 200) {
            Invoke-WebRequest -Uri 'http://127.0.0.1:3010/api/schedules' -TimeoutSec 10 -UseBasicParsing | Out-Null
            exit 0
        }
    } catch { }
}
throw "Switchyard did not start on port 3010. See $errorLog"
