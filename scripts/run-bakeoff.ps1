<# Manual entrypoint for later: starts, benchmarks, and stops one model at a time. #>
param(
    [string]$ModelDirectory = 'D:\Projects\bonfire-models',
    [ValidateRange(1,5)][int]$Repeat = 3,
    [ValidateRange(1024,65535)][int]$Port = 8081,
    [ValidateSet('dolphin','qwen','gemma')][string[]]$Models = @('dolphin','qwen','gemma'),
    [string]$Case,
    [switch]$Thinking
)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$backend = Join-Path $root 'backend'
$profiles = Get-Content (Join-Path $backend 'bench\profiles.json') -Raw | ConvertFrom-Json
$serverExe = Join-Path $root 'vendor\llama.cpp\build\bin\llama-server.exe'
$runner = Join-Path $backend 'bench\run.js'
$nodeExe = (Get-Command node -ErrorAction Stop).Source
$reasoning = if ($Thinking) {'on'} else {'off'}
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$resultsDir = Join-Path $backend 'bench\results'
$fullRuns = @()
if (-not (Test-Path -LiteralPath $serverExe)) {throw 'llama-server binary is missing.'}
foreach ($name in $Models) {
    $profile = $profiles.$name
    $modelPath = if ($profile.storage -eq 'repo') {Join-Path $root "models\$($profile.file)"} else {Join-Path $ModelDirectory $profile.file}
    if (-not (Test-Path -LiteralPath $modelPath)) {throw "Missing $modelPath. Finish downloads before running."}
}
New-Item -ItemType Directory -Path $resultsDir -Force | Out-Null
$previousOptions = $env:LLAMA_ARG_CHAT_TEMPLATE_KWARGS
try {
    $env:LLAMA_ARG_CHAT_TEMPLATE_KWARGS = @{enable_thinking = [bool]$Thinking} | ConvertTo-Json -Compress
    foreach ($name in $Models) {
        if (Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue) {throw "Port $Port is occupied. No existing process was stopped."}
        $profile = $profiles.$name
        $modelPath = if ($profile.storage -eq 'repo') {Join-Path $root "models\$($profile.file)"} else {Join-Path $ModelDirectory $profile.file}
        $prefix = Join-Path $resultsDir "$stamp-$name-$reasoning"
        $serverArgs = @('--model', ('"' + $modelPath + '"'), '--alias', $name, '--host','127.0.0.1','--port',"$Port",'--ctx-size','8192','--n-gpu-layers','999','--parallel','1','--jinja','--reasoning',$reasoning,'--cache-ram','0')
        if ($profile.template) {$serverArgs += @('--chat-template-file', ('"' + (Join-Path $backend "bench\$($profile.template)") + '"'))}
        Write-Host "Loading $($profile.label); thinking=$reasoning..."
        $serverProcess = Start-Process -FilePath $serverExe -ArgumentList $serverArgs -WindowStyle Hidden -PassThru -RedirectStandardOutput "$prefix-server.out.log" -RedirectStandardError "$prefix-server.err.log"
        try {
            $ready = $false
            for ($attempt=0; $attempt -lt 90; $attempt++) {
                if ($serverProcess.HasExited) {throw "Model server exited. Read $prefix-server.err.log."}
                try {
                    $health = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/health" -TimeoutSec 2
                    if ($health.status -eq 'ok') {$ready=$true;break}
                } catch { }
                Start-Sleep -Seconds 2
            }
            if (-not $ready) {throw "Model did not become ready. Read $prefix-server.err.log."}
            # Identical smoke/warmup case; excluded from the final comparison.
            & $nodeExe $runner --model $name --url "http://127.0.0.1:$Port" --thinking $reasoning --case dependent-lookup --out "$prefix-smoke.json"
            if ($LASTEXITCODE -ne 0) {throw "Smoke runner failed for $name."}
            $smoke = Get-Content "$prefix-smoke.json" -Raw | ConvertFrom-Json
            if (@($smoke.results | Where-Object { $_.error -and $_.errorKind -ne 'budget' -and $_.error -notmatch 'safety limit reached' }).Count) {throw "Smoke hit a server/protocol error for $name. Review its JSON before continuing."}
            $fullRun = "$prefix-full.json"
            $caseArgs = @()
            if ($Case) {$caseArgs = @('--case',$Case)}
            & $nodeExe $runner --model $name --url "http://127.0.0.1:$Port" --thinking $reasoning --repeat "$Repeat" --out $fullRun @caseArgs
            if ($LASTEXITCODE -ne 0) {throw "Benchmark runner failed for $name."}
            $fullResult = Get-Content $fullRun -Raw | ConvertFrom-Json
            if (-not $fullResult.summary.complete) {throw "Incomplete benchmark for $name. Review $fullRun before comparing models."}
            $fullRuns += $fullRun
        } finally {
            # Stop only the process created by this script, even on interruption.
            if (-not $serverProcess.HasExited) {$serverProcess.Kill();$serverProcess.WaitForExit()}
            $serverProcess.Dispose()
        }
    }
    & $nodeExe (Join-Path $backend 'bench\report.js') @fullRuns
    if ($LASTEXITCODE -ne 0) {throw 'Report generation failed.'}
    Write-Host "Done. Open $(Join-Path $resultsDir 'comparison.html'). All benchmark model servers stopped."
} finally {
    $env:LLAMA_ARG_CHAT_TEMPLATE_KWARGS = $previousOptions
}
