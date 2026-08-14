# Start the LOCAL data backend: accounts, saved designs, ratings, images/.
#
#     powershell -ExecutionPolicy Bypass -File scripts\run-local-backend.ps1
#
# No GPU. DARDESIGN_LIGHT=1 means this process never renders — /redesign and
# /restyle keep going to the GPU tunnel. It exists to own the data: SQLite at
# backend\dardesign.db and the PNGs under images\.
#
# The session-signing key is generated once into .dardesign-secret (gitignored)
# and reused, so restarting the backend no longer logs you out. Without a stable
# key the backend invents a random one per process and every cookie dies with it.

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$secretFile = Join-Path $root ".dardesign-secret"
$venvPython = Join-Path $root ".venv\Scripts\python.exe"
$py = if (Test-Path $venvPython) { $venvPython } else { "python" }

if (-not (Test-Path $secretFile)) {
    $bytes = New-Object byte[] 32
    [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
    $secret = -join ($bytes | ForEach-Object { $_.ToString("x2") })
    # utf8 explicitly: Set-Content defaults to ANSI, and >> would write UTF-16.
    Set-Content -Path $secretFile -Value $secret -Encoding utf8 -NoNewline
    Write-Host "generated a new signing key -> .dardesign-secret" -ForegroundColor Yellow
}

$env:DARDESIGN_SECRET = (Get-Content $secretFile -Raw).Trim()
$env:DARDESIGN_LIGHT = "1"

# Optional email settings, KEY=VALUE per line in .dardesign-smtp (gitignored,
# same idea as .dardesign-secret above — an app password does not belong in a
# script that is committed). Without the file the backend logs the message it
# would have sent instead of sending it, which is a working mode, not an error.
$smtpFile = Join-Path $root ".dardesign-smtp"
if (Test-Path $smtpFile) {
    Get-Content $smtpFile | ForEach-Object {
        $line = $_.Trim()
        if ($line -and -not $line.StartsWith("#")) {
            $key, $value = $line -split "=", 2
            Set-Item -Path "env:$($key.Trim())" -Value $value.Trim()
        }
    }
    Write-Host "email         : $env:DARDESIGN_SMTP_HOST as $env:DARDESIGN_SMTP_USER" -ForegroundColor Cyan
} else {
    Write-Host "email         : not configured - decision emails will be logged, not sent" -ForegroundColor Yellow
}

# Design Planner key, same gitignored KEY=VALUE pattern as the SMTP file above.
# Without it the planner answers from DAR's placement rules instead, which is a
# working mode rather than an error - see backend/design_planner.py.
$llmFile = Join-Path $root ".dardesign-llm"
if (Test-Path $llmFile) {
    Get-Content $llmFile | ForEach-Object {
        $line = $_.Trim()
        if ($line -and -not $line.StartsWith("#")) {
            $key, $value = $line -split "=", 2
            Set-Item -Path "env:$($key.Trim())" -Value $value.Trim()
        }
    }
    # ASK the planner rather than guessing. This line used to hardcode
    # "claude-sonnet-5" whenever DARDESIGN_LLM_MODEL was unset, so a Gemini
    # setup was told every startup that it was using Anthropic - and a
    # .dardesign-llm with every key still commented out was reported as
    # configured. Both are the wrong layer to be debugging during a demo.
    # design_planner.provider()/model_name() are the only things that decide
    # this, so they are what gets printed; a duplicate of that logic here would
    # just drift.
    $status = ""
    try {
        $status = & $py -c "import sys; sys.path.insert(0, r'$root'); from backend import design_planner as p; prov = p.provider(); print(f'{prov} - {p.model_name()}' if prov else '')" 2>$null
    } catch {
        $status = ""
    }
    if ($status) {
        Write-Host "planner       : $($status.Trim())" -ForegroundColor Cyan
    } else {
        Write-Host "planner       : .dardesign-llm has no usable key - rooms are planned by DAR's placement rules" -ForegroundColor Yellow
    }
} else {
    Write-Host "planner       : not configured - rooms are planned by DAR's placement rules" -ForegroundColor Yellow
}

Write-Host "data backend  : http://localhost:8000" -ForegroundColor Cyan
Write-Host "database      : $(Join-Path $root 'backend\dardesign.db')"
Write-Host "images        : $(Join-Path $root 'images')"
Write-Host "renders        : NOT served here - they come from NEXT_PUBLIC_API_URL"
Write-Host ""

Set-Location $root
& $py -m uvicorn backend.main:app --port 8000
