<#
Starts llama.cpp, the Express backend, and the Vite frontend,
all hidden/in the background, then waits for all of them to report healthy,
prints a single status line, and blocks until Enter is pressed. Closing this
window after that does NOT stop the app -- everything was launched as
independent, detached processes.
#>
param([switch]$NoWait)
$ErrorActionPreference = "Stop"
$Host.UI.RawUI.WindowTitle = "Bonfire"
$root = Split-Path -Parent $PSScriptRoot

# Double-clicking this from Explorer inherits whatever PATH explorer.exe had
# at login. Tools installed later won't be visible until PATH is re-read
# from the registry.
$env:PATH = [System.Environment]::GetEnvironmentVariable("PATH", "Machine") + ";" + [System.Environment]::GetEnvironmentVariable("PATH", "User")

function Wait-Healthy($url, $label, $timeoutSec) {
    Write-Host "Waiting for $label..."
    $deadline = (Get-Date).AddSeconds($timeoutSec)
    while ((Get-Date) -lt $deadline) {
        try {
            Invoke-WebRequest -Uri $url -TimeoutSec 3 -UseBasicParsing | Out-Null
            return $true
        } catch {
            Start-Sleep -Seconds 2
        }
    }
    return $false
}

function Test-Healthy($url) {
    try {
        Invoke-WebRequest -Uri $url -TimeoutSec 2 -UseBasicParsing | Out-Null
        return $true
    } catch {
        return $false
    }
}

Write-Host "Starting Bonfire..."
Write-Host ""

# 1. llama.cpp server
$llamaExe = Join-Path $root "vendor\llama.cpp\build\bin\llama-server.exe"
. (Join-Path $PSScriptRoot 'model-settings.ps1')
$llamaHealthUrl = "http://127.0.0.1:$modelPort/health"
if (-not (Test-Healthy $llamaHealthUrl)) {
    Write-Host "Starting llama.cpp server..."
    $ctxSize = if ($env:LLAMA_CTX_SIZE) { $env:LLAMA_CTX_SIZE } else { "8192" }
    $gpuLayers = if ($env:LLAMA_GPU_LAYERS) { $env:LLAMA_GPU_LAYERS } else { "999" }
    if (-not (Test-Path -LiteralPath $modelPath)) { throw "Missing model: $modelPath" }
    $previousOptions = $env:LLAMA_ARG_CHAT_TEMPLATE_KWARGS
    $env:LLAMA_ARG_CHAT_TEMPLATE_KWARGS = '{"enable_thinking":false}'
    try { Start-Process -FilePath $llamaExe -ArgumentList $modelArgs -WindowStyle Hidden `
      -RedirectStandardOutput (Join-Path $root "vendor\llama_server_stdout.txt") `
      -RedirectStandardError (Join-Path $root "vendor\llama_server_log.txt")
    } finally { $env:LLAMA_ARG_CHAT_TEMPLATE_KWARGS = $previousOptions }
} else {
    Write-Host "llama.cpp server already running on $modelPort."
}

# 2. Express backend
$backendDir = Join-Path $root "backend"
$backendHealthUrl = "http://127.0.0.1:8000/health"
if (-not (Test-Healthy $backendHealthUrl)) {
    Write-Host "Starting backend..."
    if (-not (Test-Path (Join-Path $backendDir "node_modules"))) {
        Write-Host "Installing backend dependencies..."
        Push-Location $backendDir
        npm install
        Pop-Location
    }
    if (-not (Test-Path (Join-Path $backendDir ".env"))) {
        Copy-Item (Join-Path $backendDir ".env.example") (Join-Path $backendDir ".env")
    }
    Start-Process -FilePath "node.exe" `
      -ArgumentList @("`"$(Join-Path $backendDir 'src\index.js')`"") `
      -WorkingDirectory $backendDir `
      -WindowStyle Hidden `
      -RedirectStandardOutput (Join-Path $backendDir "backend_stdout.log") `
      -RedirectStandardError (Join-Path $backendDir "backend_stderr.log")
} else {
    Write-Host "Backend already running on 8000."
}

# 3. Vite frontend
$frontendDir = Join-Path $root "frontend"
$frontendAlreadyUp = $false
try {
    Invoke-WebRequest -Uri "http://127.0.0.1:3000" -TimeoutSec 2 -UseBasicParsing | Out-Null
    $frontendAlreadyUp = $true
} catch {}

if (-not $frontendAlreadyUp) {
    if (-not (Test-Path (Join-Path $frontendDir "node_modules"))) {
        Write-Host "Installing frontend dependencies..."
        Push-Location $frontendDir
        npm install
        Pop-Location
    }
    Write-Host "Starting frontend..."
    Start-Process -FilePath "node.exe" -ArgumentList @("`"$(Join-Path $frontendDir 'node_modules\vite\bin\vite.js')`"", '--host', '0.0.0.0', '--port', '3000', '--strictPort') `
      -WorkingDirectory $frontendDir `
      -WindowStyle Hidden `
      -RedirectStandardOutput (Join-Path $frontendDir "frontend_dev.log") `
      -RedirectStandardError (Join-Path $frontendDir "frontend_dev_err.log")
} else {
    Write-Host "Frontend already running."
}

Write-Host ""
$llamaOk = Wait-Healthy $llamaHealthUrl "llama.cpp" 120
$backendOk = Wait-Healthy $backendHealthUrl "backend" 60
$frontendOk = Wait-Healthy "http://127.0.0.1:3000" "frontend" 60

Write-Host ""
if ($llamaOk -and $backendOk -and $frontendOk) {
    Write-Host "LLM is running: OK"
    Write-Host ""
    Write-Host "  Local:     http://127.0.0.1:3000"
} else {
    Write-Host "Something did not start correctly:"
    Write-Host "  llama.cpp : $(if ($llamaOk) { 'OK' } else { 'FAILED -- check vendor\llama_server_log.txt' })"
    Write-Host "  backend   : $(if ($backendOk) { 'OK' } else { 'FAILED -- check backend\backend_stderr.log' })"
    Write-Host "  frontend  : $(if ($frontendOk) { 'OK' } else { 'FAILED -- check frontend\frontend_dev_err.log' })"
}

Write-Host ""
if (-not $NoWait) { Read-Host "Press Enter to close this window (the app keeps running in the background)" }
