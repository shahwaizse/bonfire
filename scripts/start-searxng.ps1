<#
Starts the SearXNG container via Docker Compose on 127.0.0.1:8888.
#>
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$infraDir = Join-Path $root "infra"

& (Join-Path $PSScriptRoot "ensure-docker-desktop.ps1")

Push-Location $infraDir
try {
    docker compose up -d
    Write-Host "SearXNG starting at http://127.0.0.1:8888"
} finally {
    Pop-Location
}
