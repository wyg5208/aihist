# Loads `KEY=VALUE` pairs from the deployment env file into the process
# environment. `api.env` is written in the same format on Linux and Windows, so
# one file shape serves both.
#
# dot-source it, do not run it:
#   . "$AppDir\deploy\windows\env.ps1" -Path $EnvFile
#
# It is deliberately not named *.ps1 in a way that suggests execution: a value
# containing `=` (argon2 hashes, base64 secrets) must survive intact, so only
# the first `=` splits a line.

[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$Path
)

if (-not (Test-Path -LiteralPath $Path)) {
    throw "env file not found: $Path"
}

# Variables are prefixed so dot-sourcing cannot clobber the caller's names.
# `$AihistEnvNames` lists the keys that were loaded, so callers can copy the whole
# file somewhere else (the WinSW service) without hard-coding a whitelist.
$AihistEnvNames = @()
foreach ($envLineRaw in Get-Content -LiteralPath $Path) {
    $envLine = $envLineRaw.Trim()
    if ($envLine.Length -eq 0 -or $envLine.StartsWith("#")) { continue }

    $envSplit = $envLine.IndexOf("=")
    if ($envSplit -lt 1) { continue }

    $envKey = $envLine.Substring(0, $envSplit).Trim()
    $envValue = $envLine.Substring($envSplit + 1).Trim()

    # Tolerate `KEY="value"` and `KEY='value'`.
    if ($envValue.Length -ge 2) {
        $envFirst = $envValue.Substring(0, 1)
        $envLast = $envValue.Substring($envValue.Length - 1, 1)
        if (($envFirst -eq '"' -and $envLast -eq '"') -or ($envFirst -eq "'" -and $envLast -eq "'")) {
            $envValue = $envValue.Substring(1, $envValue.Length - 2)
        }
    }

    Set-Item -Path "Env:$envKey" -Value $envValue
    $AihistEnvNames += $envKey
}
Remove-Variable -Name envLineRaw, envLine, envSplit, envKey, envValue, envFirst, envLast -ErrorAction SilentlyContinue
