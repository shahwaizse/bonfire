<# Removes only the old Bonfire SearXNG container, once Docker is available. #>
$ErrorActionPreference = "Stop"
docker info *> $null
if ($LASTEXITCODE -ne 0) {
    throw "Docker daemon is unavailable. Run this cleanup later when Docker is running. Bonfire no longer needs Docker."
}
$containerJson = docker inspect searxng 2>$null
if ($LASTEXITCODE -ne 0) {
    Write-Host "No searxng container to remove."
    exit 0
}
$container = ($containerJson | ConvertFrom-Json)[0]
$expectedMount = [IO.Path]::GetFullPath((Join-Path (Split-Path -Parent $PSScriptRoot) "infra\searxng"))
$bonfireMount = @($container.Mounts | Where-Object {
    $_.Type -eq "bind" -and $_.Destination -eq "/etc/searxng" -and
    $_.Source.Replace('/', '\').TrimEnd('\') -ieq $expectedMount.TrimEnd('\')
})
if ($container.Config.Image -notmatch '(^|/)searxng/searxng(:|@|$)' -or $bonfireMount.Count -ne 1) {
    throw "The searxng container does not match Bonfire's old image and mount. Cleanup stopped."
}
# Remove the container's anonymous cache volume as well.
docker rm -f -v searxng
if ($LASTEXITCODE -ne 0) { throw "Could not remove the searxng container." }
Write-Host "Removed Bonfire's SearXNG container."
