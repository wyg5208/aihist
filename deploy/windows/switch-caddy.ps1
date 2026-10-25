# Swaps the Caddy site on this box from "serve the whole site" to "answer only
# /api and /go for api.aihist.net".
#
# Why this is a separate step from install.ps1: the application and the edge
# change at different times. install.ps1 / install-service.ps1 only touch the
# virtualenv, the database and the service; this script is the one that decides
# what the internet can reach. Keeping them apart means a failed Caddy render
# cannot leave you with a half-provisioned box.
#
# The old Caddyfile is kept, not deleted: a rollback is "point the service at
# the backup and restart", and the backup path is printed at the end.
#
# Order matters. This box stops answering page requests the moment the new file
# is live, so aihist.net must already resolve to Vercel before you run this.
# Doing it the other way round gives you a working API and a 404 front end
# until the DNS TTL expires. The script re-checks the apex record and waits.
#
# usage (elevated):
#   powershell -ExecutionPolicy Bypass -File deploy\windows\switch-caddy.ps1
#   ... -ApiHost api.aihist.net
#   ... -CaddyfilePath C:\Caddyfile -ServiceName caddy
#   ... -DryRun          # render + validate, leave the service alone

[CmdletBinding()]
param(
    [string]$AppDir = "D:\srv\aihist",
    [string]$ApiHost = "api.aihist.net",
    [string]$SiteOrigin = "https://aihist.net",
    [string]$CaddyfilePath = "",
    [string]$CaddyExe = "",
    [string]$ServiceName = "",
    [switch]$DryRun
)

$ErrorActionPreference = "Stop"

$templatePath = Join-Path $AppDir "deploy\windows\Caddyfile.api"
if (-not (Test-Path -LiteralPath $templatePath)) {
    throw "missing $templatePath"
}

# api.aihist.net must never be the apex: that would take the site offline and
# leave Vercel rewriting into a box that no longer serves pages.
$apexHost = ([uri]$SiteOrigin).Host
if ($ApiHost -eq $apexHost) {
    throw "-ApiHost is $ApiHost, which is the front end. Use a subdomain such as api.$apexHost."
}

# --- render ----------------------------------------------------------------

Write-Host "==> render ($ApiHost)"
$template = [System.IO.File]::ReadAllText($templatePath, [System.Text.Encoding]::UTF8)
if ($template -notmatch '(?m)^api\.aihist\.net \{') {
    throw "template has no 'api.aihist.net {' site block; refusing to guess"
}
# -replace treats $ specially in the replacement, so escape it even though a
# hostname never contains one.
$replacement = $ApiHost.Replace('$', '$$')
$rendered = $template -replace '(?m)^api\.aihist\.net \{', "$replacement {"
if ($rendered -notmatch [regex]::Escape("$ApiHost {")) {
    throw "render produced no '$ApiHost {' block"
}

$staged = Join-Path $env:TEMP "Caddyfile.api.$([guid]::NewGuid().ToString('N')).staged"
[System.IO.File]::WriteAllText($staged, $rendered, (New-Object System.Text.UTF8Encoding($false)))
Write-Host "    staged: $staged"

# Any throw below must not leave a half-validated Caddyfile in TEMP. The trap
# falls through to the normal error, so the message still reaches the operator.
trap { Remove-Item -LiteralPath $staged -Force -ErrorAction SilentlyContinue }

# --- locate caddy ----------------------------------------------------------

Write-Host "==> caddy executable"
$resolvedExe = ""
if ($CaddyExe) {
    if (-not (Test-Path -LiteralPath $CaddyExe)) { throw "caddy not found at $CaddyExe" }
    $resolvedExe = $CaddyExe
} else {
    $onPath = Get-Command caddy -ErrorAction SilentlyContinue
    if ($onPath) {
        $resolvedExe = $onPath.Source
    } else {
        foreach ($candidate in @(
            "C:\Program Files\Caddy\caddy.exe",
            "C:\ProgramData\chocolatey\bin\caddy.exe",
            (Join-Path $AppDir "caddy.exe")
        )) {
            if (Test-Path -LiteralPath $candidate) { $resolvedExe = $candidate; break }
        }
    }
}
if (-not $resolvedExe) {
    throw "caddy.exe not found. Install it (choco install caddy) or pass -CaddyExe."
}
Write-Host "    $resolvedExe"

# --- locate the service and its config -------------------------------------

Write-Host "==> caddy service"
$service = $null
if ($ServiceName) {
    $service = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
    if (-not $service) { throw "service '$ServiceName' does not exist" }
} else {
    $caddyServices = @(Get-Service | Where-Object { $_.Name -match 'caddy' -or $_.DisplayName -match 'caddy' })
    if ($caddyServices.Count -eq 1) {
        $service = $caddyServices[0]
    } elseif ($caddyServices.Count -gt 1) {
        $names = ($caddyServices | ForEach-Object { $_.Name }) -join ", "
        throw "several caddy services ($names); pass -ServiceName"
    } else {
        throw "no caddy service found. Register one first, or pass -ServiceName."
    }
}
Write-Host "    $($service.Name) [$($service.Status)]"

if (-not $CaddyfilePath) {
    # The service command line is the only reliable source: caddy has no
    # registry entry, and the working directory is whatever WinSW was given.
    $wmi = Get-CimInstance Win32_Service -Filter "Name='$($service.Name)'"
    $imagePath = if ($wmi) { $wmi.PathName } else { "" }
    if ($imagePath -match '--config\s+"?([^"]+)"?') {
        $CaddyfilePath = $Matches[1].Trim()
    }
}
if (-not $CaddyfilePath) {
    throw "cannot tell which Caddyfile the service uses. Query it with: (Get-CimInstance Win32_Service -Filter ""Name='$($service.Name)'"").PathName  then pass -CaddyfilePath."
}
if (-not (Test-Path -LiteralPath $CaddyfilePath)) {
    throw "Caddyfile not found at $CaddyfilePath"
}
Write-Host "    $CaddyfilePath"

# --- validate before touching anything -------------------------------------

Write-Host "==> validate"
$validateOutput = & $resolvedExe validate --config $staged --adapter caddyfile 2>&1
$validateCode = $LASTEXITCODE
if ($validateCode -ne 0) {
    Write-Host ($validateOutput | Out-String)
    Remove-Item -LiteralPath $staged -Force -ErrorAction SilentlyContinue
    throw "caddy validate failed (exit $validateCode); nothing was changed"
}
Write-Host "    ok" -ForegroundColor Green

if ($DryRun) {
    Write-Host ""
    Write-Host "==> dry run: rendered and validated only" -ForegroundColor Yellow
    Write-Host "    staged file kept at $staged"
    exit 0
}

# --- order check -----------------------------------------------------------

$apexDns = @()
if (Get-Command Resolve-DnsName -ErrorAction SilentlyContinue) {
    $apexDns = @(Resolve-DnsName -Name $apexHost -Type A -ErrorAction SilentlyContinue |
        Where-Object { $_.IPAddress })
}
if ($apexDns.Count -gt 0) {
    $apexIps = ($apexDns | ForEach-Object { $_.IPAddress }) -join ", "
    Write-Host "==> order check"
    Write-Host "    $apexHost still resolves to $apexIps" -ForegroundColor Yellow
    Write-Host "    if that is this box, the front end 404s the moment Caddy reloads." -ForegroundColor Yellow
    Write-Host "    Move the DNS record to Vercel first. Continuing in 8s; Ctrl+C to abort." -ForegroundColor Yellow
    Start-Sleep -Seconds 8
}

# --- backup, install, restart ----------------------------------------------

$backupDir = Join-Path $AppDir "backups"
New-Item -ItemType Directory -Force -Path $backupDir | Out-Null
$stamp = (Get-Date).ToString("yyyyMMdd-HHmmss")
$backupPath = Join-Path $backupDir "Caddyfile.$stamp"
Copy-Item -LiteralPath $CaddyfilePath -Destination $backupPath -Force
Write-Host "==> backup"
Write-Host "    $backupPath"

Write-Host "==> install"
Copy-Item -LiteralPath $staged -Destination $CaddyfilePath -Force
Remove-Item -LiteralPath $staged -Force -ErrorAction SilentlyContinue

Write-Host "==> restart"
if ((Get-Service -Name $service.Name).Status -eq "Running") {
    Restart-Service -Name $service.Name -Force
} else {
    Start-Service -Name $service.Name
}
Start-Sleep -Seconds 3
$service = Get-Service -Name $service.Name
if ($service.Status -ne "Running") {
    Write-Host "    service is $($service.Status)" -ForegroundColor Yellow
    Write-Host "    rollback: Copy-Item '$backupPath' '$CaddyfilePath'; Restart-Service $($service.Name)" -ForegroundColor Yellow
    exit 1
}
Write-Host "    $($service.Name) is running" -ForegroundColor Green

# --- verify ----------------------------------------------------------------

Write-Host "==> verify"
$resolved = @()
if (Get-Command Resolve-DnsName -ErrorAction SilentlyContinue) {
    $resolved = @(Resolve-DnsName -Name $ApiHost -Type A -ErrorAction SilentlyContinue)
}
$curl = Get-Command curl.exe -ErrorAction SilentlyContinue
if ($resolved.Count -eq 0) {
    Write-Host "    $ApiHost does not resolve yet; finish the DNS record, then re-check:" -ForegroundColor Yellow
    Write-Host "      curl.exe -i https://$ApiHost/api/v1/health"
} elseif (-not $curl) {
    Write-Host "    DNS resolves but curl.exe is missing; check by hand:" -ForegroundColor Yellow
    Write-Host "      https://$ApiHost/api/v1/health"
} else {
    $probe = & $curl.Source -s -o NUL -w "%{http_code}" "https://$ApiHost/api/v1/health" 2>$null
    if ($probe -eq "200") {
        Write-Host "    https://$ApiHost/api/v1/health -> 200" -ForegroundColor Green
    } else {
        Write-Host "    https://$ApiHost/api/v1/health -> $probe" -ForegroundColor Yellow
        Write-Host "    the certificate is issued on first request; if it stays non-200 check" -ForegroundColor Yellow
        Write-Host "    $AppDir\logs\ and the service log for a TLS or upstream error" -ForegroundColor Yellow
    }
}

# --- what still has to change by hand --------------------------------------

$envFile = Join-Path $AppDir "deploy\api.env"
if (Test-Path -LiteralPath $envFile) {
    . (Join-Path $AppDir "deploy\windows\env.ps1") -Path $envFile
    if ($env:ANALYTICS_LOG_PATH -and $env:ANALYTICS_LOG_PATH -notmatch 'access\.api\.log') {
        Write-Host ""
        Write-Host "==> action required" -ForegroundColor Yellow
        Write-Host "    ANALYTICS_LOG_PATH is $($env:ANALYTICS_LOG_PATH)" -ForegroundColor Yellow
        Write-Host "    this origin now writes $(Join-Path $AppDir 'logs\access.api.log');" -ForegroundColor Yellow
        Write-Host "    update $envFile and re-run install-service.ps1, or crawl_hits stops growing." -ForegroundColor Yellow
    }
}

Write-Host ""
Write-Host "==> rollback, if needed:" -ForegroundColor Green
Write-Host "    Copy-Item '$backupPath' '$CaddyfilePath' -Force"
Write-Host "    Restart-Service $($service.Name) -Force"
