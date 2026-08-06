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

Write-Host "data backend  : http://localhost:8000" -ForegroundColor Cyan
Write-Host "database      : $(Join-Path $root 'backend\dardesign.db')"
Write-Host "images        : $(Join-Path $root 'images')"
Write-Host "renders        : NOT served here - they come from NEXT_PUBLIC_API_URL"
Write-Host ""

Set-Location $root
python -m uvicorn backend.main:app --port 8000
