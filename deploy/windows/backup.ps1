# Nightly consistent backup, 14 days of history, plus a rotation that keeps at
# most one archive per day.
#
# The copy itself goes through deploy\backup.py (SQLite backup API). Copy-Item is
# not used on purpose: with WAL enabled, a plain file copy can capture a torn
# snapshot and silently produce a corrupt archive.
#
# usage:
#   powershell -ExecutionPolicy Bypass -File deploy\windows\backup.ps1
#   ... -RetentionDays 30 -BackupDir E:\backups\aihist

[CmdletBinding()]
param(
    [string]$AppDir = "D:\srv\aihist",
    [string]$EnvFile = "",
    [string]$BackupDir = "",
    [int]$RetentionDays = 14
)

$ErrorActionPreference = "Stop"

if (-not $EnvFile) { $EnvFile = Join-Path $AppDir "deploy\api.env" }
if (-not $BackupDir) { $BackupDir = Join-Path $AppDir "backups" }

New-Item -ItemType Directory -Force -Path $BackupDir | Out-Null
$logDir = Join-Path $AppDir "logs"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$logFile = Join-Path $logDir "backup.log"

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
$stamp = (Get-Date).ToUniversalTime().ToString("yyyyMMddTHHmmssZ")
$target = Join-Path $BackupDir "aihist-$stamp.db"

& $python (Join-Path $AppDir "deploy\backup.py") $target 2>&1 | ForEach-Object { Write-Log $_ }
if ($LASTEXITCODE -ne 0) {
    Write-Log "FAILED: backup.py exited $LASTEXITCODE"
    exit $LASTEXITCODE
}

$size = "{0:N1} MB" -f ((Get-Item -LiteralPath $target).Length / 1MB)
Write-Log "backup written: $target ($size)"

# Rotation: anything past the retention window goes away.
$cutoff = (Get-Date).AddDays(-$RetentionDays)
Get-ChildItem -LiteralPath $BackupDir -Filter "aihist-*.db" -File |
    Where-Object { $_.LastWriteTime -lt $cutoff } |
    ForEach-Object {
        Remove-Item -LiteralPath $_.FullName -Force
        Write-Log "rotated out: $($_.Name)"
    }

exit 0
