$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$frontendDir = Join-Path $root "frontend"

Push-Location $frontendDir
try {
    if (-not (Test-Path "node_modules")) {
        Write-Host "Installing frontend dependencies..."
        npm install
    }
    npm run start
} finally {
    Pop-Location
}
