# Shared app model settings. Benchmark servers use their separate port 8081.
$modelPath = if ($env:BONFIRE_MODEL_PATH) { $env:BONFIRE_MODEL_PATH } else { 'D:\Projects\bonfire-models\Qwen3.5-9B-Q4_K_M.gguf' }
$modelPort = 8082
$ctxSize = if ($env:LLAMA_CTX_SIZE) { $env:LLAMA_CTX_SIZE } else { '8192' }
$gpuLayers = if ($env:LLAMA_GPU_LAYERS) { $env:LLAMA_GPU_LAYERS } else { '999' }
$modelArgs = @('--model', "`"$modelPath`"", '--alias', 'qwen', '--host', '127.0.0.1', '--port', "$modelPort", '--ctx-size', $ctxSize, '--n-gpu-layers', $gpuLayers, '--parallel', '1', '--jinja', '--reasoning', 'off', '--cache-ram', '0')
