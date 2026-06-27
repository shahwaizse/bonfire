<#
Starts the Express backend on 127.0.0.1:8000.
#>
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$backendDir = Join-Path $root "backend"

Push-Location $backendDir
try {
    if (-not (Test-Path "node_modules")) {
        Write-Host "Installing backend dependencies..."
        npm install
    }

    if (-not (Test-Path ".env")) {
        Copy-Item ".env.example" ".env"
    }

    npm run start
} finally {
    Pop-Location
}
