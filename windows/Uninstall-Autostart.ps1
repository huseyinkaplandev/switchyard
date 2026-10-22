# Removes the Scheduled Task created by Install-Autostart.ps1. A server that is already running keeps running.
$ErrorActionPreference = 'Stop'
$taskName = 'Switchyard 3010'
Stop-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue
Write-Output "Removed: $taskName"
