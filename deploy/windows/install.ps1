# One-time provisioning on Windows Server. Idempotent: re-running it only
# refreshes the virtualenv, replays the migrations and reseeds.
#
# No database server to install and no service to start: SQLite is a single file
# under $AppDir\data. That is the whole reason this deployment is a PowerShell
# script instead of PostgreSQL + systemd.
#
# usage (elevated PowerShell):
#   powershell -ExecutionPolicy Bypass -File deploy\windows\install.ps1
#
# Optional overrides:
#   -AppDir  D:\srv\aihist
#   -EnvFile D:\srv\aihist\deploy\api.env

[CmdletBinding()]
param(
    [string]$AppDir = "D:\srv\aihist",
    [string]$EnvFile = ""
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

if (-not $EnvFile) { $EnvFile = Join-Path $AppDir "deploy\api.env" }

$python = Join-Path $AppDir ".venv\Scripts\python.exe"

Write-Host "==> app dir: $AppDir"

if (-not (Test-Path -LiteralPath (Join-Path $AppDir "backend"))) {
    throw "$AppDir does not look like the repository (missing backend\)"
}

Write-Host "==> virtualenv"
if (-not (Test-Path -LiteralPath $python)) {
    $system = Get-Command python -ErrorAction SilentlyContinue
    if (-not $system) { throw "python is not on PATH; install Python 3.12 (x64) first" }
    & $system.Source -m venv (Join-Path $AppDir ".venv")
}
& $python -m pip install --upgrade pip wheel --quiet
& $python -m pip install -e (Join-Path $AppDir "backend") --quiet

Write-Host "==> directories"
foreach ($dir in @("data", "logs")) {
    New-Item -ItemType Directory -Force -Path (Join-Path $AppDir $dir) | Out-Null
}

Write-Host "==> configuration"
if (-not (Test-Path -LiteralPath $EnvFile)) {
    Copy-Item (Join-Path $AppDir "deploy\api.env.example") $EnvFile
    Write-Host ""
    Write-Host "  Created $EnvFile" -ForegroundColor Yellow
    Write-Host "  Edit DATABASE_URL, SESSION_SECRET, ADMIN_PASSWORD_HASH, then re-run this script." -ForegroundColor Yellow
    Write-Host "  Generate the secrets with:" -ForegroundColor Yellow
    Write-Host "    & '$python' -c `"import secrets;print(secrets.token_urlsafe(48))`"" -ForegroundColor Yellow
    Write-Host "    & '$python' -m app.cli hash-password `"your long passphrase`"" -ForegroundColor Yellow
    exit 1
}

. (Join-Path $AppDir "deploy\windows\env.ps1") -Path $EnvFile

if (-not $env:DATABASE_URL) { throw "DATABASE_URL is empty in $EnvFile" }
Write-Host "    DATABASE_URL = $env:DATABASE_URL"

Write-Host "==> migrations"
# `-c` from any directory: alembic.ini anchors script_location with %(here)s.
& $python -m alembic -c (Join-Path $AppDir "backend\alembic.ini") upgrade head
if ($LASTEXITCODE -ne 0) { throw "alembic upgrade failed" }

Write-Host "==> seed"
& $python -m app.cli seed
if ($LASTEXITCODE -ne 0) { throw "seed failed" }

Write-Host "==> static bundle"
$npm = Get-Command npm -ErrorAction SilentlyContinue
if ($npm) {
    Push-Location $AppDir
    try {
        & $npm.Source ci
        & $npm.Source run build
        if ($LASTEXITCODE -ne 0) { throw "npm run build failed" }
    } finally {
        Pop-Location
    }
} else {
    Write-Host "    npm not found: build dist\ elsewhere and copy it to $AppDir\dist" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "==> done. Next:" -ForegroundColor Green
Write-Host "    1. register the API service:  deploy\windows\install-service.ps1"
Write-Host "    2. register the schedules:    deploy\windows\register-tasks.ps1"
Write-Host "    3. point Caddy at 127.0.0.1:8000 (deploy\windows\Caddyfile)"
