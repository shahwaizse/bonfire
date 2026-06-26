<#
Reads Bonfire's saved funnel_enabled setting from the backend and applies it
to Tailscale Funnel.
#>
param(
    [int]$TimeoutSec = 90
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot

function Wait-BackendSettings {
    $deadline = (Get-Date).AddSeconds($TimeoutSec)
    while ((Get-Date) -lt $deadline) {
        try {
            return Invoke-RestMethod -Uri "http://127.0.0.1:8000/settings" -TimeoutSec 3
        } catch {
            Start-Sleep -Seconds 2
        }
    }
    throw "Backend settings endpoint did not become ready within $TimeoutSec seconds."
}

$settings = Wait-BackendSettings
$enabled = [bool]$settings.funnel_enabled
$enabledArg = if ($enabled) { "true" } else { "false" }
& (Join-Path $root "scripts\set-funnel.ps1") -Enabled $enabledArg
