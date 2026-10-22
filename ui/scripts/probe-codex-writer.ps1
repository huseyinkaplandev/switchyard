param([Parameter(Mandatory=$true)][string]$Path)
$ErrorActionPreference = 'Stop'
if (!(Test-Path -LiteralPath $Path)) { 'free'; exit 0 }
$stream = $null
try {
    $stream = [IO.File]::Open($Path, [IO.FileMode]::Open, [IO.FileAccess]::ReadWrite, [IO.FileShare]::ReadWrite -bor [IO.FileShare]::Delete)
    try { $stream.Lock(0, 1); $stream.Unlock(0, 1); 'free' }
    catch [IO.IOException] { 'busy' }
} catch { 'unknown' }
finally { if ($stream) { $stream.Dispose() } }
