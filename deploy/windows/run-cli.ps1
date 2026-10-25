# Run any `app.cli` subcommand for a scheduled task. Equivalent to
# `deploy/run-cli.sh`: the env file is loaded the same way the API service
# loads it, so the CLI cannot drift from the service.
#
# usage:
#   powershell -ExecutionPolicy Bypass -File deploy\windows\run-cli.ps1 -Command ingest-access-log
#   powershell -ExecutionPolicy Bypass -File deploy\windows\run-cli.ps1 -Command prune -Arguments @("--dry-run")

[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$Command,
    [string]$AppDir = "D:\srv\aihist",
    [string]$EnvFile = "",
    [string[]]$Arguments = @()
)

$ErrorActionPreference = "Stop"

if (-not $EnvFile) { $EnvFile = Join-Path $AppDir "deploy\api.env" }

$logDir = Join-Path $AppDir "logs"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$logFile = Join-Path $logDir "$Command.log"

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
    Write-Log "start $Command $($Arguments -join ' ')"
    $output = & $python -m app.cli $Command @Arguments 2>&1
    $code = $LASTEXITCODE
    foreach ($line in $output) { Write-Log "  $line" }
    Write-Log "end exit=$code"
} finally {
    Pop-Location
}

exit $code
