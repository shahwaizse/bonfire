<#
Stops Bonfire services after a UI-triggered shutdown request.
Backend is stopped first, then the frontend, so the backend has a chance to
return the shutdown response before this script removes the UI.
#>
$ErrorActionPreference = "SilentlyContinue"
$root = Split-Path -Parent $PSScriptRoot

Start-Sleep -Seconds 1

Write-Host "Stopping Bonfire backend..."
Get-CimInstance Win32_Process -Filter "Name = 'python.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -like "*uvicorn*app.main:app*" } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }

Start-Sleep -Seconds 1

Write-Host "Stopping Bonfire frontend..."
Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -like "*vite*" -or $_.CommandLine -like "*node_modules\\vite\\*" } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }

Write-Host "Turning Bonfire Funnel off for this shutdown..."
& (Join-Path $root "scripts\set-funnel.ps1") -Enabled "false" *> $null

Write-Host "Stopping llama-server.exe..."
Get-Process -Name "llama-server" -ErrorAction SilentlyContinue | Stop-Process -Force

Write-Host "Stopping SearXNG..."
Push-Location (Join-Path $root "infra")
docker compose down
Pop-Location

Write-Host "Bonfire shutdown complete."
