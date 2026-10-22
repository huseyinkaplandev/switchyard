$ErrorActionPreference = 'Stop'
# Compile and exercise pure text normalization only; no Desktop UI operations.
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes, WindowsBase, System.Windows.Forms, Accessibility
Add-Type -Path (Join-Path $PSScriptRoot 'Controller.cs') -ReferencedAssemblies @('UIAutomationClient', 'UIAutomationTypes', 'WindowsBase', 'System.Windows.Forms', 'System.Core', 'System', 'Accessibility')
$cases = @(
    @{ input="first`r`nsecond`r`n`r`n"; expected="first`nsecond" },
    @{ input="first`rsecond`r"; expected="first`nsecond" },
    @{ input=" first `n`nsecond "; expected=" first `n`nsecond " },
    @{ input="`n"; expected='' },
    @{ input=$null; expected='' }
)
foreach ($case in $cases) {
    if ([DesktopHandoffController]::NormalizeEditorText($case.input) -cne $case.expected) {
        throw 'Editor normalization regression'
    }
}
if ([DesktopHandoffController]::NormalizeEditorText("first`n`nsecond") -ceq [DesktopHandoffController]::NormalizeEditorText("first`nsecond")) {
    throw 'Internal paragraph differences must not match'
}
$missingRequest = Join-Path ([System.IO.Path]::GetTempPath()) ('missing-handoff-' + [guid]::NewGuid() + '.json')
$diagnostic = (& powershell.exe -NoProfile -STA -File (Join-Path $PSScriptRoot 'invoke.ps1') -RequestFile $missingRequest) | ConvertFrom-Json
if ($LASTEXITCODE -ne 1 -or [string]::IsNullOrWhiteSpace($diagnostic.error) -or [string]::IsNullOrWhiteSpace($diagnostic.exceptionType) -or $diagnostic.step -ne 'compile' -or $diagnostic.causes.Count -lt 1) {
    throw 'Exception diagnostics regression'
}
Write-Output 'PASS: C# compile, six editor normalization checks, structured exception diagnostics. No Desktop UI invoked.'
