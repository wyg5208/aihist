# One-time provisioning on Windows Server. Idempotent: re-running it only
# refreshes the virtualenv, replays the migrations and reseeds.
#
# No database server to install and no service to start: SQLite is a single file
# under $AppDir\data. That is the whole reason this deployment is a PowerShell
# script instead of PostgreSQL + systemd.
#
# Two shapes are supported:
#   Vercel + this box    aihist.net -> Vercel, api.aihist.net -> here (default)
#   fully self-hosted    this box answers aihist.net and /api itself; add
#                        -BuildSite and use deploy\windows\Caddyfile
#
# usage (elevated PowerShell):
#   powershell -ExecutionPolicy Bypass -File deploy\windows\install.ps1
#
# Optional overrides:
#   -AppDir     D:\srv\aihist
#   -EnvFile    D:\srv\aihist\deploy\api.env
#   -SiteOrigin https://aihist.net   (the front end; must match api.env)
#   -ApiHost    api.aihist.net       (this box, used for the Caddy hint)
#   -BuildSite                      (build dist\ here instead of on Vercel)

[CmdletBinding()]
param(
    [string]$AppDir = "D:\srv\aihist",
    [string]$EnvFile = "",
    [string]$SiteOrigin = "https://aihist.net",
    [string]$ApiHost = "api.aihist.net",
    [switch]$BuildSite
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

# SITE_ORIGIN belongs to the front end, not to this origin. The subscription
# confirm link (/api/v1/subscribe/confirm) and the referrer classification are
# both built from it, and the link has to open the page Vercel serves. Pointing
# it at $ApiHost would send every confirmation to a 404.
$expectedOrigin = $SiteOrigin.TrimEnd("/")
if ($env:SITE_ORIGIN) {
    $configuredOrigin = ($env:SITE_ORIGIN).TrimEnd("/")
    if ($configuredOrigin -ne $expectedOrigin) {
        throw "SITE_ORIGIN in $EnvFile is '$configuredOrigin' but the front end is served from '$expectedOrigin'. Keep it on the apex domain, not on $ApiHost."
    }
}
Write-Host "    SITE_ORIGIN  = $expectedOrigin (front end)"
Write-Host "    API origin   = https://$ApiHost (this box)"

Write-Host "==> analytics log"
# The hourly ingest reads one file. With the site on Vercel the only log this
# box still writes is the API origin's, so an ANALYTICS_LOG_PATH pointing at the
# old access.log would tail a file that stopped growing.
if ($env:ANALYTICS_LOG_PATH -and $env:ANALYTICS_LOG_PATH -notmatch "access\.api\.log") {
    Write-Host "    warning: ANALYTICS_LOG_PATH points at $($env:ANALYTICS_LOG_PATH)" -ForegroundColor Yellow
    Write-Host "    with aihist.net on Vercel the API origin writes $(Join-Path $AppDir 'logs\access.api.log')" -ForegroundColor Yellow
}

Write-Host "==> migrations"
# `-c` from any directory: alembic.ini anchors script_location with %(here)s.
& $python -m alembic -c (Join-Path $AppDir "backend\alembic.ini") upgrade head
if ($LASTEXITCODE -ne 0) { throw "alembic upgrade failed" }

Write-Host "==> seed"
& $python -m app.cli seed
if ($LASTEXITCODE -ne 0) { throw "seed failed" }

Write-Host "==> static bundle"
# The front end is built and served by Vercel (see vercel.json), so this box
# only needs the API. -BuildSite keeps the fully self-hosted shape alive for
# the day the site has to run without a CDN.
if (-not $BuildSite) {
    Write-Host "    skipped: dist\ is built by Vercel; pass -BuildSite to build it here" -ForegroundColor Yellow
} else {
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
}

Write-Host ""
Write-Host "==> done. Next:" -ForegroundColor Green
Write-Host "    1. register the API service:       deploy\windows\install-service.ps1"
Write-Host "    2. register the schedules:         deploy\windows\register-tasks.ps1"
Write-Host "    3. switch Caddy to the API origin: deploy\windows\switch-caddy.ps1 -ApiHost $ApiHost"
Write-Host ""
Write-Host "  Before step 3:"
Write-Host "    - DNS  $ApiHost -> this box. aihist.net stays on Vercel."
Write-Host "    - env  ANALYTICS_LOG_PATH=$(Join-Path $AppDir 'logs\access.api.log'), then re-run install-service.ps1."
