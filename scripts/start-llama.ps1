<#
Starts the llama.cpp server with Vulkan GPU offload on 127.0.0.1:8080.
#>
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot

$serverExe = Join-Path $root "vendor\llama.cpp\build\bin\llama-server.exe"
if (-not (Test-Path $serverExe)) {
    $found = Get-ChildItem -Path (Join-Path $root "vendor\llama.cpp\build") -Recurse -Filter "llama-server.exe" -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($found) { $serverExe = $found.FullName }
}
if (-not (Test-Path $serverExe)) {
    Write-Error "llama-server.exe not found under vendor\llama.cpp\build. Build llama.cpp first."
    exit 1
}

$modelPath = Join-Path $root "models\Dolphin3.0-Llama3.1-8B-Q4_K_M.gguf"
if (-not (Test-Path $modelPath)) {
    Write-Error "Model not found at $modelPath"
    exit 1
}

# Context size: 8192 by default. If the server OOMs on the 8GB RX 6600 XT,
# lower to 4096 here (see README GPU/Vulkan troubleshooting section).
$ctxSize = if ($env:LLAMA_CTX_SIZE) { $env:LLAMA_CTX_SIZE } else { "8192" }
$gpuLayers = if ($env:LLAMA_GPU_LAYERS) { $env:LLAMA_GPU_LAYERS } else { "999" }

Write-Host "Starting llama-server: $serverExe"
Write-Host "Model: $modelPath"
Write-Host "Context size: $ctxSize | GPU layers: $gpuLayers"

& $serverExe `
    --model $modelPath `
    --host 127.0.0.1 `
    --port 8080 `
    --ctx-size $ctxSize `
    --n-gpu-layers $gpuLayers
