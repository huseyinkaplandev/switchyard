# Registers a per-user Scheduled Task that keeps Switchyard running on 127.0.0.1:3010.
$ErrorActionPreference = 'Stop'
$repository = Split-Path -Parent $PSScriptRoot
$launcher = Join-Path $PSScriptRoot 'Watch-Switchyard.ps1'
$ui = Join-Path $repository 'ui'

if (-not (Test-Path -LiteralPath (Join-Path $ui '.next-build\BUILD_ID'))) {
    throw 'Production build missing. Run "npm ci" and "npm run build" in the repository root first.'
}

$taskName = 'Switchyard 3010'
$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$launcher`""
$triggers = @(
    (New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME),
    (New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 1))
)
$settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit (New-TimeSpan -Seconds 0) -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -MultipleInstances IgnoreNew -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -DontStopOnIdleEnd
$principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive -RunLevel Limited
Stop-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $triggers -Settings $settings -Principal $principal -Force | Out-Null
Start-ScheduledTask -TaskName $taskName
Write-Output "Installed: $taskName"
