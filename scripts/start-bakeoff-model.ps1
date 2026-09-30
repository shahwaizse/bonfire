<# Run manually when the GPU is available. Starts only the selected model. #>
param(
    [Parameter(Mandatory=$true)][ValidateSet('dolphin','qwen','gemma')][string]$Model,
    [string]$ModelDirectory = 'D:\Projects\bonfire-models',
    [int]$Port = 8081,
    [switch]$Thinking
)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$profile = (Get-Content (Join-Path $root 'backend\bench\profiles.json') -Raw | ConvertFrom-Json).$Model
$modelPath = if ($profile.storage -eq 'repo') {Join-Path $root "models\$($profile.file)"} else {Join-Path $ModelDirectory $profile.file}
if (-not (Test-Path -LiteralPath $modelPath)) {throw "Model is missing: $modelPath. Download models first."}
if (Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue) {throw "Port $Port is already in use. Stop the previous benchmark server or choose another port."}
$server = Join-Path $root 'vendor\llama.cpp\build\bin\llama-server.exe'
if (-not (Test-Path -LiteralPath $server)) {throw 'Build llama.cpp first.'}
$reasoning = if ($Thinking) {'on'} else {'off'}
Write-Host "Starting $($profile.label) on 127.0.0.1:$Port; thinking=$reasoning. Stop with Ctrl+C before switching models."
# Identical local runtime settings; one model at a time, GPU fit, native Jinja tools.
$previousTemplateOptions = $env:LLAMA_ARG_CHAT_TEMPLATE_KWARGS
try {
    # Environment avoids Windows PowerShell's native-command JSON quoting issues.
    $env:LLAMA_ARG_CHAT_TEMPLATE_KWARGS = @{enable_thinking = [bool]$Thinking} | ConvertTo-Json -Compress
    $templateArgs = @()
    if ($profile.template) {$templateArgs = @('--chat-template-file', (Join-Path $root "backend\bench\$($profile.template)"))}
    & $server --model $modelPath --alias $Model --host 127.0.0.1 --port $Port --ctx-size 8192 --n-gpu-layers 999 --parallel 1 --jinja --reasoning $reasoning --cache-ram 0 @templateArgs
    if ($LASTEXITCODE -ne 0) {throw "llama-server exited with code $LASTEXITCODE. Check model architecture/template support."}
} finally {
    $env:LLAMA_ARG_CHAT_TEMPLATE_KWARGS = $previousTemplateOptions
}
