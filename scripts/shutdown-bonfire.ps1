<#
Hard kill switch for UI-triggered shutdown.
This is intentionally blunt: free RAM/VRAM first, cleanup best-effort after.
#>
$ErrorActionPreference = "SilentlyContinue"
$root = Split-Path -Parent $PSScriptRoot

Start-Sleep -Milliseconds 350

Write-Host "Killing llama-server.exe model server..."
Get-Process -Name "llama-server" -ErrorAction SilentlyContinue | Stop-Process -Force

Write-Host "Killing Bonfire frontend..."
Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -like "*vite*" -or $_.CommandLine -like "*node_modules\\vite\\*" } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }

Write-Host "Killing Bonfire backend..."
Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -like "*backend*src*index.js*" -or $_.CommandLine -like "*bonfire-backend*" } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }

Write-Host "Best-effort SearXNG/Funnel cleanup..."
Start-Process -FilePath "powershell.exe" -ArgumentList @(
    "-NoProfile",
    "-ExecutionPolicy", "Bypass",
    "-Command",
    "docker kill searxng *> `$null; & `"$root\scripts\set-funnel.ps1`" -Enabled false *> `$null"
) -WindowStyle Hidden

Write-Host "Bonfire kill signal sent."
