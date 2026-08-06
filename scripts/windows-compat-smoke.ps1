$ErrorActionPreference = "Stop"

$RepositoryRoot = Split-Path $PSScriptRoot -Parent
$FilesToParse = @(
    (Join-Path $RepositoryRoot "install.ps1"),
    (Join-Path $RepositoryRoot "install-claude.ps1"),
    (Join-Path $RepositoryRoot "plugins\scientific-illustrator\scripts\powerpoint-bridge.ps1")
)

foreach ($File in $FilesToParse) {
    $Tokens = $null
    $Errors = $null
    $null = [System.Management.Automation.Language.Parser]::ParseFile($File, [ref]$Tokens, [ref]$Errors)
    if ($Errors.Count -gt 0) {
        $Messages = @($Errors | ForEach-Object { "$($_.Extent.StartLineNumber):$($_.Message)" }) -join "; "
        throw "PowerShell syntax errors in ${File}: $Messages"
    }
}

$Bridge = Join-Path $RepositoryRoot "plugins\scientific-illustrator\scripts\powerpoint-bridge.ps1"
$PayloadJson = '{"action":"status","arguments":{"focus_policy":"foreground"}}'
$PayloadBase64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($PayloadJson))
$WindowsPowerShell = Join-Path $env:SystemRoot "System32\WindowsPowerShell\v1.0\powershell.exe"
$StatusLines = & $WindowsPowerShell -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $Bridge -PayloadBase64 $PayloadBase64
$BridgeExitCode = $LASTEXITCODE
if ($BridgeExitCode -ne 0) { throw "Windows COM status bridge exited with code $BridgeExitCode." }
$StatusText = $StatusLines -join [Environment]::NewLine
if ([string]::IsNullOrWhiteSpace($StatusText)) { throw "Windows COM status bridge returned no JSON." }
$Status = $StatusText | ConvertFrom-Json
if ($Status.platform -ne "win32") { throw "Windows COM status returned an unexpected platform." }
if ($Status.control_scope -ne "PowerPoint native COM object model only") { throw "Windows COM status returned an unexpected control scope." }

Write-Output "Windows PowerShell syntax and non-mutating PowerPoint COM status checks passed."
