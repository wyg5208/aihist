# Registers the four recurring jobs. This is the Windows replacement for
# deploy/cron.d/aihist: there is no cron on Windows Server.
#
#   aihist-sync       every 6 hours   (the only thing that ever writes new events)
#   aihist-backup     daily 03:20     (SQLite backup API + rotation)
#   aihist-analytics  hourly          (access log -> crawl_hits)
#   aihist-prune      weekly, Sun      (analytics retention)
#
# `aihist-prune` is the only task allowed to delete rows, and it deletes only
# from page_views, crawl_hits, api_key_usage and audit_log.
#
# All four run as SYSTEM so they do not depend on an interactive login.
#
# usage (elevated):
#   powershell -ExecutionPolicy Bypass -File deploy\windows\register-tasks.ps1
#   ... -SyncHours 4 -BackupAt 02:30 -PruneAt 04:40

[CmdletBinding()]
param(
    [string]$AppDir = "D:\srv\aihist",
    [int]$SyncHours = 6,
    [string]$BackupAt = "03:20",
    [string]$PruneAt = "04:40"
)

$ErrorActionPreference = "Stop"

$syncScript = Join-Path $AppDir "deploy\windows\run-sync.ps1"
$backupScript = Join-Path $AppDir "deploy\windows\backup.ps1"
$cliScript = Join-Path $AppDir "deploy\windows\run-cli.ps1"

foreach ($script in @($syncScript, $backupScript, $cliScript)) {
    if (-not (Test-Path -LiteralPath $script)) { throw "missing $script" }
}

function New-AihistAction([string]$ScriptPath, [string]$Arguments) {
    $powerShellExe = Join-Path $env:SystemRoot "System32\WindowsPowerShell\v1.0\powershell.exe"
    return New-ScheduledTaskAction `
        -Execute $powerShellExe `
        -Argument "-NoProfile -NonInteractive -ExecutionPolicy Bypass -File `"$ScriptPath`" -AppDir `"$AppDir`" $Arguments" `
        -WorkingDirectory $AppDir
}

function New-AihistPrincipal {
    return New-ScheduledTaskPrincipal -UserId "SYSTEM" -LogonType ServiceAccount -RunLevel Highest
}

function New-AihistSettings {
    return New-ScheduledTaskSettingsSet `
        -AllowStartIfOnBatteries `
        -DontStopIfGoingOnBatteries `
        -StartWhenAvailable `
        -MultipleInstances IgnoreNew `
        -ExecutionTimeLimit (New-TimeSpan -Hours 1)
}

Write-Host "==> aihist-sync (every $SyncHours h)"
# Five minutes past the hour, so it never collides with the backup at :20.
$startAt = (Get-Date).Date.AddHours(1).AddMinutes(5)
$syncTrigger = New-ScheduledTaskTrigger `
    -Once -At $startAt `
    -RepetitionInterval (New-TimeSpan -Hours $SyncHours) `
    -RepetitionDuration (New-TimeSpan -Days 3650)

Register-ScheduledTask `
    -TaskName "aihist-sync" `
    -Action (New-AihistAction $syncScript "") `
    -Trigger $syncTrigger `
    -Principal (New-AihistPrincipal) `
    -Settings (New-AihistSettings) `
    -Description "AI 纪年: collect public sources. The only writer of new events." `
    -Force | Out-Null

Write-Host "==> aihist-backup (daily $BackupAt)"
$backupTrigger = New-ScheduledTaskTrigger -Daily -At $BackupAt

Register-ScheduledTask `
    -TaskName "aihist-backup" `
    -Action (New-AihistAction $backupScript "") `
    -Trigger $backupTrigger `
    -Principal (New-AihistPrincipal) `
    -Settings (New-AihistSettings) `
    -Description "AI 纪年: consistent SQLite backup with 14-day rotation." `
    -Force | Out-Null

Write-Host "==> aihist-analytics (hourly)"
# Seventeen minutes past, so it never lands on top of the sync at :05.
$analyticsStart = (Get-Date).Date.AddHours(1).AddMinutes(17)
$analyticsTrigger = New-ScheduledTaskTrigger `
    -Once -At $analyticsStart `
    -RepetitionInterval (New-TimeSpan -Hours 1) `
    -RepetitionDuration (New-TimeSpan -Days 3650)

Register-ScheduledTask `
    -TaskName "aihist-analytics" `
    -Action (New-AihistAction $cliScript "-Command ingest-access-log") `
    -Trigger $analyticsTrigger `
    -Principal (New-AihistPrincipal) `
    -Settings (New-AihistSettings) `
    -Description "AI 纪年: ingest new access-log lines into crawl_hits. The only record of the scriptless citation pages being read." `
    -Force | Out-Null

Write-Host "==> aihist-prune (weekly, Sunday $PruneAt)"
$pruneTrigger = New-ScheduledTaskTrigger -Weekly -DaysOfWeek Sunday -At $PruneAt

Register-ScheduledTask `
    -TaskName "aihist-prune" `
    -Action (New-AihistAction $cliScript "-Command prune") `
    -Trigger $pruneTrigger `
    -Principal (New-AihistPrincipal) `
    -Settings (New-AihistSettings) `
    -Description "AI 纪年: analytics retention. Deletes only page_views, crawl_hits, api_key_usage and audit_log." `
    -Force | Out-Null

Write-Host ""
Write-Host "==> registered. Verify:" -ForegroundColor Green
Get-ScheduledTask -TaskName "aihist-*" |
    Select-Object TaskName, State |
    Format-Table -AutoSize

Write-Host "Run one by hand:   Start-ScheduledTask -TaskName aihist-sync"
Write-Host "Watch the log:     Get-Content $AppDir\logs\sync.log -Tail 20 -Wait"
Write-Host "Ingest the log:    powershell -File $cliScript -Command ingest-access-log -Arguments @('--dry-run')"
