<#
Starts the FastAPI backend on 127.0.0.1:8000, creating/using a local venv.
#>
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$backendDir = Join-Path $root "backend"
$venvDir = Join-Path $backendDir ".venv"
$venvPython = Join-Path $venvDir "Scripts\python.exe"

Push-Location $backendDir
try {
    if (-not (Test-Path $venvPython)) {
        Write-Host "Creating virtual environment..."
        python -m venv .venv
        & $venvPython -m pip install --upgrade pip
        & $venvPython -m pip install -r requirements.txt
        & $venvPython -m playwright install chromium
    }

    if (-not (Test-Path ".env")) {
        Copy-Item ".env.example" ".env"
    }

    & $venvPython -m uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload
} finally {
    Pop-Location
}
