<#
Stops SearXNG (Docker), llama.cpp server, FastAPI backend, and the
Vite frontend.
#>
$ErrorActionPreference = "SilentlyContinue"
$root = Split-Path -Parent $PSScriptRoot

Write-Host "Turning Bonfire Funnel off for this stop..."
& (Join-Path $PSScriptRoot "set-funnel.ps1") -Enabled "false" *> $null

Write-Host "Stopping uvicorn (FastAPI backend)..."
Get-CimInstance Win32_Process -Filter "Name = 'python.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -like "*uvicorn*app.main:app*" } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }

Start-Sleep -Seconds 1

Write-Host "Stopping Vite frontend (node)..."
Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -like "*vite*" -or $_.CommandLine -like "*node_modules\\vite\\*" } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }

Write-Host "Stopping llama-server.exe..."
Get-Process -Name "llama-server" -ErrorAction SilentlyContinue | Stop-Process -Force

Write-Host "Stopping SearXNG..."
Push-Location (Join-Path $root "infra")
docker compose down
Pop-Location

Write-Host "Done."
