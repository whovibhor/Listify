# Runs every local quality gate: backend lint/format/tests, frontend lint/format/types/tests/build.
# Usage (from the repository root):  powershell -ExecutionPolicy Bypass -File scripts\check.ps1
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$failed = @()

function Invoke-Step([string]$name, [string]$dir, [scriptblock]$command) {
    Write-Host "`n=== $name ===" -ForegroundColor Cyan
    Push-Location (Join-Path $root $dir)
    try {
        & $command
        if ($LASTEXITCODE -ne 0) { $script:failed += $name }
    } finally {
        Pop-Location
    }
}

$py = '.\.venv\Scripts'
Invoke-Step 'backend: ruff check' 'backend' { & "$py\ruff.exe" check . }
Invoke-Step 'backend: ruff format --check' 'backend' { & "$py\ruff.exe" format --check . }
Invoke-Step 'backend: pytest' 'backend' { & "$py\python.exe" -m pytest -q }

Invoke-Step 'frontend: lint' 'frontend' { npm run lint --silent }
Invoke-Step 'frontend: format:check' 'frontend' { npm run format:check --silent }
Invoke-Step 'frontend: test' 'frontend' { npm test --silent }
Invoke-Step 'frontend: build (includes typecheck)' 'frontend' { npm run build --silent }

if ($failed.Count) {
    Write-Host "`nFAILED: $($failed -join ', ')" -ForegroundColor Red
    exit 1
}
Write-Host "`nAll checks passed." -ForegroundColor Green
