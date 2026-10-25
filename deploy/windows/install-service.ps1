# Registers the FastAPI app as a real Windows service.
#
# Python cannot be a service by itself: the SCM expects a process that talks to
# it, and python.exe does not, so `sc create` yields error 1053. WinSW is a
# single signed exe that provides that shim, restarts on crash, and rolls logs.
#
# usage (elevated):
#   powershell -ExecutionPolicy Bypass -File deploy\windows\install-service.ps1
#   ... -WsxExe C:\tools\WinSW-x64.exe     # if the download is blocked

[CmdletBinding()]
param(
    [string]$AppDir = "D:\srv\aihist",
    [string]$EnvFile = "",
    [string]$WsxExe = "",
    [int]$Port = 8000
)

$ErrorActionPreference = "Stop"

if (-not $EnvFile) { $EnvFile = Join-Path $AppDir "deploy\api.env" }

$serviceName = "aihist-api"
$serviceDir = Join-Path $AppDir "service"
$serviceExe = Join-Path $serviceDir "$serviceName.exe"
$serviceXml = Join-Path $serviceDir "$serviceName.xml"

New-Item -ItemType Directory -Force -Path $serviceDir | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $AppDir "logs") | Out-Null

Write-Host "==> WinSW"
if (-not (Test-Path -LiteralPath $serviceExe)) {
    $source = $WsxExe
    if (-not $source) {
        $source = Join-Path $env:TEMP "WinSW-x64.exe"
        if (-not (Test-Path -LiteralPath $source)) {
            Write-Host "    downloading WinSW..."
            Invoke-WebRequest -UseBasicParsing `
                -Uri "https://github.com/winsw/winsw/releases/latest/download/WinSW-x64.exe" `
                -OutFile $source
        }
    }
    Copy-Item -LiteralPath $source -Destination $serviceExe
}

Write-Host "==> configuration"
$python = Join-Path $AppDir ".venv\Scripts\python.exe"
if (-not (Test-Path -LiteralPath $python)) { throw "venv missing: run install.ps1 first" }

# Every key in api.env is forwarded verbatim. A whitelist here would silently
# drop one on the next config change — and a missing editorial key means the
# collection run holds every candidate instead of admitting it.
. (Join-Path $AppDir "deploy\windows\env.ps1") -Path $EnvFile

$envXml = ""
foreach ($name in $AihistEnvNames) {
    $value = [Environment]::GetEnvironmentVariable($name)
    if ($null -ne $value -and $value -ne "") {
        $escaped = [System.Security.SecurityElement]::Escape($value)
        $envXml += "    <env name=`"$name`" value=`"$escaped`"/>`r`n"
    }
}

$xml = @"
<service>
  <id>$serviceName</id>
  <name>AI 纪年 API</name>
  <description>FastAPI backend for aihist.net, answered on api.aihist.net, reading a local SQLite database.</description>
  <executable>$python</executable>
  <arguments>-m uvicorn app.main:app --host 127.0.0.1 --port $Port --workers 2 --proxy-headers --forwarded-allow-ips 127.0.0.1</arguments>
  <workingdirectory>$AppDir</workingdirectory>
  <env name="PYTHONUNBUFFERED" value="1"/>
$envXml  <logpath>$(Join-Path $AppDir "logs")</logpath>
  <log mode="roll-by-size">
    <sizeThreshold>10240</sizeThreshold>
    <keepFiles>8</keepFiles>
  </log>
  <onfailure action="restart" delay="10 sec"/>
  <onfailure action="restart" delay="30 sec"/>
  <stoptimeout>20 sec</stoptimeout>
  <startmode>Automatic</startmode>
  <delayedAutoStart>true</delayedAutoStart>
</service>
"@

Set-Content -LiteralPath $serviceXml -Value $xml -Encoding UTF8

Write-Host "==> service registration"
# `install` refuses to overwrite, so uninstall first when reconfiguring.
if (Get-Service -Name $serviceName -ErrorAction SilentlyContinue) {
    & $serviceExe stop 2>$null | Out-Null
    & $serviceExe uninstall 2>$null | Out-Null
    Start-Sleep -Seconds 2
}
& $serviceExe install
& $serviceExe start

Start-Sleep -Seconds 3
$service = Get-Service -Name $serviceName -ErrorAction SilentlyContinue
if ($service -and $service.Status -eq "Running") {
    Write-Host "==> $serviceName is running on 127.0.0.1:$Port" -ForegroundColor Green
    Write-Host "    check: curl.exe -s http://127.0.0.1:$Port/api/v1/status"
} else {
    Write-Host "==> service did not start; see $AppDir\logs\$serviceName.wrapper.log" -ForegroundColor Yellow
    exit 1
}
