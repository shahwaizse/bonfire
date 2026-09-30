<#
Starts Qwen with Vulkan GPU offload on 127.0.0.1:8082.
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

. (Join-Path $PSScriptRoot 'model-settings.ps1')
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

$previousOptions = $env:LLAMA_ARG_CHAT_TEMPLATE_KWARGS
try {
    $env:LLAMA_ARG_CHAT_TEMPLATE_KWARGS = '{"enable_thinking":false}'
    # Direct invocation needs an unquoted path; Start-Process uses the quoted form.
    $modelArgs[1] = $modelPath
    & $serverExe @modelArgs
} finally { $env:LLAMA_ARG_CHAT_TEMPLATE_KWARGS = $previousOptions }
