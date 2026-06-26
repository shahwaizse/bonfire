<#
Launches SearXNG (Docker), llama.cpp server, FastAPI backend, and the
Vite frontend, each in its own PowerShell window.
#>
$ErrorActionPreference = "Stop"
$scriptsDir = $PSScriptRoot

Write-Host "Starting SearXNG..."
& (Join-Path $scriptsDir "start-searxng.ps1")

Write-Host "Starting llama.cpp server in a new window..."
Start-Process powershell -ArgumentList "-NoExit", "-File", (Join-Path $scriptsDir "start-llama.ps1")

Write-Host "Waiting for llama.cpp server to come up..."
$ready = $false
for ($i = 0; $i -lt 60; $i++) {
    try {
        $resp = Invoke-RestMethod -Uri "http://127.0.0.1:8080/health" -Method Get -TimeoutSec 2
        $ready = $true
        break
    } catch {
        Start-Sleep -Seconds 2
    }
}
if (-not $ready) {
    Write-Warning "llama.cpp server did not respond on /health within timeout. Continuing anyway."
}

Write-Host "Starting FastAPI backend in a new window..."
Start-Process powershell -ArgumentList "-NoExit", "-File", (Join-Path $scriptsDir "start-backend.ps1")

Write-Host "Starting Vite frontend in a new window..."
Start-Process powershell -ArgumentList "-NoExit", "-File", (Join-Path $scriptsDir "start-frontend.ps1")

Write-Host "Applying saved Funnel setting in the background..."
Start-Process powershell -ArgumentList "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", (Join-Path $scriptsDir "apply-funnel-setting.ps1") -WindowStyle Hidden

Write-Host ""
Write-Host "All services launching:"
Write-Host "  llama.cpp : http://127.0.0.1:8080"
Write-Host "  SearXNG   : http://127.0.0.1:8888"
Write-Host "  Backend   : http://127.0.0.1:8000"
Write-Host "  Frontend  : http://127.0.0.1:3000"
