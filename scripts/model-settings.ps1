# Shared app model settings. Benchmark servers use their separate port 8081.
$modelPath = if ($env:BONFIRE_MODEL_PATH) { $env:BONFIRE_MODEL_PATH } else { 'D:\Projects\bonfire-models\gemma-4-E4B-it-Q4_K_M.gguf' }
$modelPort = 8082
$ctxSize = if ($env:LLAMA_CTX_SIZE) { $env:LLAMA_CTX_SIZE } else { '8192' }
$gpuLayers = if ($env:LLAMA_GPU_LAYERS) { $env:LLAMA_GPU_LAYERS } else { '999' }
# RX 6600 XT tuning: smaller microbatches and full SWA cache reduce prefill/reprocessing.
# Environment overrides make experiments reversible without editing launcher code.
$batchSize = if ($env:LLAMA_BATCH_SIZE) { $env:LLAMA_BATCH_SIZE } else { '1024' }
$ubatchSize = if ($env:LLAMA_UBATCH_SIZE) { $env:LLAMA_UBATCH_SIZE } else { '128' }
$cacheRam = if ($env:LLAMA_CACHE_RAM) { $env:LLAMA_CACHE_RAM } else { '512' }
$threads = if ($env:LLAMA_THREADS) { $env:LLAMA_THREADS } else { '6' }
$flashAttention = if ($env:LLAMA_FLASH_ATTN) { $env:LLAMA_FLASH_ATTN } else { 'on' }
$modelArgs = @('--model', "`"$modelPath`"", '--alias', 'gemma', '--host', '127.0.0.1', '--port', "$modelPort", '--ctx-size', $ctxSize, '--n-gpu-layers', $gpuLayers, '--parallel', '1', '--jinja', '--reasoning', 'off', '--cache-ram', $cacheRam, '--batch-size', $batchSize, '--ubatch-size', $ubatchSize, '--threads', $threads, '--threads-batch', $threads, '--flash-attn', $flashAttention)
if ($env:LLAMA_SWA_FULL -ne 'false') { $modelArgs += '--swa-full' }
# MTP remains opt-in: it was slower on this GPU in our measured workloads.
if ($env:BONFIRE_DRAFT_MODEL_PATH) {
    if (-not (Test-Path -LiteralPath $env:BONFIRE_DRAFT_MODEL_PATH)) { throw 'Missing draft model' }
    $modelArgs += @('--spec-type', 'draft-mtp', '--model-draft', "`"$env:BONFIRE_DRAFT_MODEL_PATH`"", '--spec-draft-n-max', '2', '--n-gpu-layers-draft', $gpuLayers)
}
