<#
Hard-stops Bonfire services and frees model resources quickly.
#>
$ErrorActionPreference = "SilentlyContinue"
$root = Split-Path -Parent $PSScriptRoot

Write-Host "Killing llama-server.exe model server..."
Get-Process -Name "llama-server" -ErrorAction SilentlyContinue | Stop-Process -Force

Write-Host "Killing Vite frontend (node)..."
Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -like "*vite*" -or $_.CommandLine -like "*node_modules\\vite\\*" } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }

Write-Host "Killing Bonfire backend (node)..."
Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -like "*backend*src*index.js*" -or $_.CommandLine -like "*bonfire-backend*" } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }

Write-Host "Killing SearXNG container..."
docker kill searxng *> $null

Write-Host "Turning Bonfire Funnel off best-effort..."
& (Join-Path $PSScriptRoot "set-funnel.ps1") -Enabled "false" *> $null

Write-Host "Done."
