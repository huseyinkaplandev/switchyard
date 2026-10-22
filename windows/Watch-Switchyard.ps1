# Watchdog started by the Scheduled Task: checks the server every 10 seconds and restarts it when it stops answering.
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$launcher = Join-Path $PSScriptRoot 'Start-Switchyard.ps1'
$repository = Split-Path -Parent $PSScriptRoot
$next = Join-Path $repository 'node_modules\next\dist\bin\next'
if (-not (Test-Path -LiteralPath $next)) { $next = Join-Path $repository 'ui\node_modules\next\dist\bin\next' }
$logDirectory = Join-Path $env:LOCALAPPDATA 'Switchyard'
New-Item -ItemType Directory -Path $logDirectory -Force | Out-Null
$watchLog = Join-Path $logDirectory 'watchdog.log'
$mutex = [System.Threading.Mutex]::new($false, "Local\Switchyard3010-$env:USERNAME")
$ownsMutex = $false

try {
    try { $ownsMutex = $mutex.WaitOne(0) }
    catch [System.Threading.AbandonedMutexException] { $ownsMutex = $true }
    if (-not $ownsMutex) { exit 0 }
    "$(Get-Date -Format o) Watchdog started" | Add-Content -LiteralPath $watchLog
    $failures = 0
    while ($true) {
        try {
            $response = Invoke-WebRequest -Uri 'http://127.0.0.1:3010/' -TimeoutSec 3 -UseBasicParsing
            if ($response.StatusCode -ne 200) { throw 'Switchyard unhealthy' }
            $failures = 0
        } catch {
            $failures++
            try {
                $listener = Get-NetTCPConnection -LocalPort 3010 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
                $canStart = -not $listener
                if ($listener -and $failures -ge 3) {
                    $server = Get-CimInstance Win32_Process -Filter "ProcessId=$($listener.OwningProcess)"
                    # Restart only this repository's server, never another application on this port.
                    if ($server.CommandLine -and $server.CommandLine.IndexOf($next, [System.StringComparison]::OrdinalIgnoreCase) -ge 0 -and ((Get-Date) - $server.CreationDate).TotalSeconds -ge 120) {
                        Stop-Process -Id $listener.OwningProcess -Force
                        $canStart = $true
                    }
                }
                if ($canStart) {
                    "$(Get-Date -Format o) Recovering Switchyard" | Add-Content -LiteralPath $watchLog
                    # Wait for the launcher only: Start-Process -Wait would also wait for the server it spawns.
                    $launch = Start-Process -FilePath 'powershell.exe' -ArgumentList "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$launcher`"" -WindowStyle Hidden -PassThru
                    if (-not $launch.WaitForExit(60000)) {
                        Stop-Process -Id $launch.Id -Force -ErrorAction SilentlyContinue
                        throw 'Launcher timed out'
                    }
                    if ($launch.ExitCode -ne 0) { throw "Launcher exited $($launch.ExitCode)" }
                    $failures = 0
                }
            } catch {
                "$(Get-Date -Format o) Recovery failed: $($_.Exception.Message)" | Add-Content -LiteralPath $watchLog
            }
        }
        Start-Sleep -Seconds 10
    }
} finally {
    if ($ownsMutex) { $mutex.ReleaseMutex() }
    $mutex.Dispose()
}
