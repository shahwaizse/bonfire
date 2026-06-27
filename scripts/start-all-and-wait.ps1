<#
Starts SearXNG, llama.cpp, the Express backend, and the Vite frontend,
all hidden/in the background, then waits for all of them to report healthy,
prints a single status line, and blocks until Enter is pressed. Closing this
window after that does NOT stop the app -- everything was launched as
independent, detached processes.
#>
$ErrorActionPreference = "Stop"
$Host.UI.RawUI.WindowTitle = "Bonfire"
$root = Split-Path -Parent $PSScriptRoot

# Double-clicking this from Explorer inherits whatever PATH explorer.exe had
# at login. Tools installed later in the same Windows session (Docker,
# Tailscale, etc.) won't be visible until PATH is re-read from the registry.
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

# 1. SearXNG (Docker) -- docker compose itself returns immediately; the
#    container is managed by the Docker daemon, independent of this window.
& (Join-Path $root "scripts\ensure-docker-desktop.ps1")
Write-Host "Starting SearXNG..."
Push-Location (Join-Path $root "infra")
docker compose up -d | Out-Null
Pop-Location

# 2. llama.cpp server
$llamaExe = Join-Path $root "vendor\llama.cpp\build\bin\llama-server.exe"
$modelPath = Join-Path $root "models\Dolphin3.0-Llama3.1-8B-Q4_K_M.gguf"
$llamaHealthUrl = "http://127.0.0.1:8080/health"
if (-not (Test-Healthy $llamaHealthUrl)) {
    Write-Host "Starting llama.cpp server..."
    $ctxSize = if ($env:LLAMA_CTX_SIZE) { $env:LLAMA_CTX_SIZE } else { "8192" }
    $gpuLayers = if ($env:LLAMA_GPU_LAYERS) { $env:LLAMA_GPU_LAYERS } else { "999" }
    Start-Process -FilePath $llamaExe -ArgumentList @(
        "--model", "`"$modelPath`"",
        "--host", "127.0.0.1",
        "--port", "8080",
        "--ctx-size", $ctxSize,
        "--n-gpu-layers", $gpuLayers
    ) -WindowStyle Hidden `
      -RedirectStandardOutput (Join-Path $root "vendor\llama_server_stdout.txt") `
      -RedirectStandardError (Join-Path $root "vendor\llama_server_log.txt")
} else {
    Write-Host "llama.cpp server already running on 8080."
}

# 3. Express backend
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
    Start-Process -FilePath "npm.cmd" `
      -ArgumentList @("run", "start") `
      -WorkingDirectory $backendDir `
      -WindowStyle Hidden `
      -RedirectStandardOutput (Join-Path $backendDir "backend_stdout.log") `
      -RedirectStandardError (Join-Path $backendDir "backend_stderr.log")
} else {
    Write-Host "Backend already running on 8000."
}

# 4. Vite frontend
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
    Start-Process -FilePath "npm.cmd" -ArgumentList @("run", "start") `
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
$funnelOk = $false
$funnelEnabled = $false
if ($backendOk -and $frontendOk) {
    try {
        $settings = Invoke-RestMethod -Uri "http://127.0.0.1:8000/settings" -TimeoutSec 5
        $funnelEnabled = [bool]$settings.funnel_enabled
        $funnelArg = if ($funnelEnabled) { "true" } else { "false" }
        & (Join-Path $root "scripts\set-funnel.ps1") -Enabled $funnelArg
        $funnelOk = $true
    } catch {
        Write-Warning "Could not apply saved Funnel setting: $($_.Exception.Message)"
    }
}

Write-Host ""
if ($llamaOk -and $backendOk -and $frontendOk) {
    Write-Host "LLM is running: OK"
    Write-Host ""
    Write-Host "  Local:     http://127.0.0.1:3000"
    if ($funnelEnabled -and $funnelOk) {
        Write-Host "  Funnel:    https://riebeck.tail4fc8a6.ts.net"
    } else {
        Write-Host "  Funnel:    Off"
    }
} else {
    Write-Host "Something did not start correctly:"
    Write-Host "  llama.cpp : $(if ($llamaOk) { 'OK' } else { 'FAILED -- check vendor\llama_server_log.txt' })"
    Write-Host "  backend   : $(if ($backendOk) { 'OK' } else { 'FAILED -- check backend\backend_stderr.log' })"
    Write-Host "  frontend  : $(if ($frontendOk) { 'OK' } else { 'FAILED -- check frontend\frontend_dev_err.log' })"
}

Write-Host ""
Read-Host "Press Enter to close this window (the app keeps running in the background)"
