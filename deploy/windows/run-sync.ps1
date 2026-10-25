# One collection pass, for the scheduled task. Equivalent to
# `python -m app.cli sync --trigger auto` with the env file loaded.
#
# usage:
#   powershell -ExecutionPolicy Bypass -File deploy\windows\run-sync.ps1
#   powershell -ExecutionPolicy Bypass -File deploy\windows\run-sync.ps1 -Trigger manual

[CmdletBinding()]
param(
    [string]$AppDir = "D:\srv\aihist",
    [string]$EnvFile = "",
    [ValidateSet("auto", "manual")]
    [string]$Trigger = "auto"
)

$ErrorActionPreference = "Stop"

if (-not $EnvFile) { $EnvFile = Join-Path $AppDir "deploy\api.env" }

$logDir = Join-Path $AppDir "logs"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$logFile = Join-Path $logDir "sync.log"

function Write-Log([string]$Message) {
    $stamp = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
    Add-Content -LiteralPath $logFile -Value "$stamp $Message"
}

try {
    . (Join-Path $AppDir "deploy\windows\env.ps1") -Path $EnvFile
} catch {
    Write-Log "FAILED to load env: $($_.Exception.Message)"
    exit 1
}

$python = Join-Path $AppDir ".venv\Scripts\python.exe"
if (-not (Test-Path -LiteralPath $python)) {
    Write-Log "FAILED: venv missing at $python"
    exit 1
}

Push-Location $AppDir
try {
    Write-Log "start trigger=$Trigger"
    # The CLI prints one summary line; the run itself is recorded in the database.
    $output = & $python -m app.cli sync --trigger $Trigger 2>&1
    $code = $LASTEXITCODE
    foreach ($line in $output) { Write-Log "  $line" }
    Write-Log "end exit=$code"
} finally {
    Pop-Location
}

exit $code
