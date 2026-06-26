<#
Turns Bonfire's Tailscale Funnel routes on or off without changing Bonfire's
saved setting. The backend and startup scripts own persistence.
#>
param(
    [Parameter(Mandatory = $true)]
    [string]$Enabled
)

$ErrorActionPreference = "Stop"
$env:PATH = [System.Environment]::GetEnvironmentVariable("PATH", "Machine") + ";" + [System.Environment]::GetEnvironmentVariable("PATH", "User")
$enabledBool = $Enabled -match "^(1|true|yes|on)$"

if (-not (Get-Command tailscale -ErrorAction SilentlyContinue)) {
    Write-Error "tailscale CLI not found."
    exit 1
}

function Invoke-Tailscale($Arguments) {
    & tailscale @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "tailscale $($Arguments -join ' ') failed with exit code $LASTEXITCODE"
    }
}

function Get-FunnelHosts {
    $raw = tailscale funnel status --json 2>$null
    if ($LASTEXITCODE -ne 0 -or -not $raw) {
        return @()
    }
    try {
        $status = $raw | ConvertFrom-Json
    } catch {
        return @()
    }
    if (-not $status.Web) {
        return @()
    }
    return @($status.Web.PSObject.Properties.Name)
}

function Test-FunnelPort($Hosts, [string]$Port) {
    return @($Hosts | Where-Object { $_ -match ":$Port$" }).Count -gt 0
}

if ($enabledBool) {
    Write-Host "Turning Bonfire Funnel on..."
    Invoke-Tailscale @("funnel", "--bg", "--yes", "--https=443", "127.0.0.1:3000")
    Invoke-Tailscale @("funnel", "--bg", "--yes", "--https=8443", "127.0.0.1:8000")
    Write-Host "Bonfire Funnel is on."
} else {
    Write-Host "Turning Bonfire Funnel off..."
    $hosts = Get-FunnelHosts
    if (Test-FunnelPort $hosts "443") {
        Invoke-Tailscale @("funnel", "--https=443", "off")
    } else {
        Write-Host "Frontend Funnel already off."
    }
    if (Test-FunnelPort $hosts "8443") {
        Invoke-Tailscale @("funnel", "--https=8443", "off")
    } else {
        Write-Host "Backend Funnel already off."
    }
    Write-Host "Bonfire Funnel is off."
}
