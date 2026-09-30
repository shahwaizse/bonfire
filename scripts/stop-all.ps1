<#
Hard-stops Bonfire services and frees model resources quickly.
#>
$ErrorActionPreference = "SilentlyContinue"
$root = Split-Path -Parent $PSScriptRoot

Write-Host "Killing llama-server.exe model server..."
Get-CimInstance Win32_Process -Filter "Name = 'llama-server.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.ExecutablePath -and $_.ExecutablePath.StartsWith($root + '\', [StringComparison]::OrdinalIgnoreCase) -and $_.CommandLine -match '--port\s+8082\b' } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force }

Write-Host "Stopping Bonfire processes (model port 8082; Steam port 8080 is untouched)..."

Write-Host "Killing Vite frontend (node)..."
Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -like "*$root*" -and ($_.CommandLine -like "*vite*" -or $_.CommandLine -like "*node_modules\\vite\\*") } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }

Write-Host "Killing Bonfire backend (node)..."
Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -like "*$root*" -and ($_.CommandLine -like "*backend*src*index.js*" -or $_.CommandLine -like "*backend*src*mcp-workspace.js*") } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }

Write-Host "Done."
