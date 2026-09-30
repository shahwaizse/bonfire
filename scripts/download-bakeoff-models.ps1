<# Downloads pinned, text-only GGUFs; uses no GPU or inference APIs. #>
param([string]$ModelDirectory = 'D:\Projects\bonfire-models')
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$targetRoot = [IO.Path]::GetFullPath($ModelDirectory)
if ([IO.Path]::GetPathRoot($targetRoot) -ine 'D:\') { throw 'Bake-off downloads must stay on D:.' }
New-Item -ItemType Directory -Path $targetRoot -Force | Out-Null
$profiles = Get-Content (Join-Path $root 'backend\bench\profiles.json') -Raw | ConvertFrom-Json
foreach ($name in @('qwen','gemma')) {
    $profile = $profiles.$name
    $target = [IO.Path]::GetFullPath((Join-Path $targetRoot $profile.file))
    if (-not $target.StartsWith($targetRoot + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'Model path escapes download directory.' }
    $partial = $target + '.part'
    if (Test-Path -LiteralPath $target) {
        if ((Get-Item -LiteralPath $target).Length -ne $profile.bytes -or (Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash -ine $profile.sha256) {throw "Existing $name file failed integrity check. It was not overwritten."}
        Write-Host "$name already downloaded and verified."
        continue
    }
    Write-Host "Downloading $name to $partial (resumable)..."
    $url = "https://huggingface.co/$($profile.repo)/resolve/$($profile.revision)/$($profile.file)"
    & curl.exe --location --fail --silent --show-error --connect-timeout 30 --speed-limit 1024 --speed-time 120 --retry 3 --continue-at - --output $partial $url
    if ($LASTEXITCODE -ne 0) {throw "$name download failed. Re-run to resume the .part file."}
    if ((Get-Item -LiteralPath $partial).Length -ne $profile.bytes) {throw "$name file size differs from manifest."}
    Write-Host "Checking $name SHA-256..."
    if ((Get-FileHash -LiteralPath $partial -Algorithm SHA256).Hash -ine $profile.sha256) {throw "$name checksum mismatch. Partial file retained for inspection."}
    Move-Item -LiteralPath $partial -Destination $target
    Write-Host "$name downloaded and verified."
}
Write-Host "All bake-off model downloads complete. No models were started."
