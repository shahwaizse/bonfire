<#
Starts Docker Desktop if needed and waits until the Docker daemon is ready.
#>
$ErrorActionPreference = "Stop"

$env:PATH = [System.Environment]::GetEnvironmentVariable("PATH", "Machine") + ";" + [System.Environment]::GetEnvironmentVariable("PATH", "User")

function Test-DockerReady {
    try {
        docker info *> $null
        return $LASTEXITCODE -eq 0
    } catch {
        return $false
    }
}

if (Test-DockerReady) {
    Write-Host "Docker Desktop already running."
    exit 0
}

$dockerDesktop = Join-Path $env:ProgramFiles "Docker\Docker\Docker Desktop.exe"
if (-not (Test-Path $dockerDesktop)) {
    $dockerDesktop = Join-Path ${env:ProgramFiles(x86)} "Docker\Docker\Docker Desktop.exe"
}
if (-not (Test-Path $dockerDesktop)) {
    Write-Error "Docker Desktop.exe not found. Install Docker Desktop or update scripts\ensure-docker-desktop.ps1."
    exit 1
}

Write-Host "Starting Docker Desktop..."
Start-Process -FilePath $dockerDesktop -WindowStyle Hidden

$deadline = (Get-Date).AddSeconds(150)
while ((Get-Date) -lt $deadline) {
    if (Test-DockerReady) {
        Write-Host "Docker Desktop is ready."
        exit 0
    }
    Start-Sleep -Seconds 3
}

Write-Error "Docker Desktop did not become ready within 150 seconds."
exit 1
