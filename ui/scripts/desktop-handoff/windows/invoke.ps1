param([Parameter(Mandatory=$true)][string]$RequestFile)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
try {
    $handoffRequest = Get-Content -LiteralPath $RequestFile -Raw -Encoding UTF8 | ConvertFrom-Json
    Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes, WindowsBase, System.Windows.Forms, Accessibility
    $handoffReferences = @('UIAutomationClient', 'UIAutomationTypes', 'WindowsBase', 'System.Windows.Forms', 'System.Core', 'System', 'Accessibility')
    Add-Type -Path (Join-Path $PSScriptRoot 'Controller.cs') -ReferencedAssemblies $handoffReferences
    if ($handoffRequest.action -eq 'compile') { @{ compiled=$true } | ConvertTo-Json -Compress; exit 0 }
    $result = [DesktopHandoffController]::Run($handoffRequest.action, $handoffRequest.cwd, $handoffRequest.text, $handoffRequest.title, $handoffRequest.expectedSession, $handoffRequest.stopFile)
    @{ url=$result[0]; title=$result[1]; pid=$result[2] } | ConvertTo-Json -Compress
} catch {
    $handoffPhase = 'compile'
    $handoffStep = 'compile'
    if ('DesktopHandoffController' -as [type]) {
        $handoffPhase = [DesktopHandoffController]::Phase
        $handoffStep = [DesktopHandoffController]::Step
    }
    $handoffCause = $_.Exception
    $handoffCauses = @()
    for ($handoffDepth = 0; $null -ne $handoffCause -and $handoffDepth -lt 12; $handoffDepth++) {
        $handoffCauses += @{ type=$handoffCause.GetType().FullName; message=$handoffCause.Message }
        $handoffRootCause = $handoffCause
        $handoffCause = $handoffCause.InnerException
    }
    $handoffError = '[' + $handoffRootCause.GetType().FullName + ']'
    if (-not [string]::IsNullOrWhiteSpace($handoffRootCause.Message)) { $handoffError += ' ' + $handoffRootCause.Message }
    $handoffError += ' (step: ' + $handoffStep + ')'
    @{ error=$handoffError; phase=$handoffPhase; step=$handoffStep; exceptionType=$handoffRootCause.GetType().FullName; causes=$handoffCauses } | ConvertTo-Json -Compress -Depth 5
    exit 1
}
