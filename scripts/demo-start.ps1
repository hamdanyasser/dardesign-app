<#
  DarDesign — one-click demo launcher.

  Everything the defence demo needs, started in the right order, with the one
  question that actually matters answered in words: can this machine render
  right now, or not?

  Written for the person presenting, not for the person who wrote the code.
  It types the commands so they don't have to, and it refuses to lie about
  what is running -- the same discipline as run-local-backend.ps1, which
  exists because a stale backend once answered for three hours behind a
  green banner.
#>

$ErrorActionPreference = "Continue"
$root = Split-Path -Parent $PSScriptRoot

function Write-Head($text) {
  Write-Host ""
  Write-Host "  $text" -ForegroundColor White
  Write-Host "  $('-' * $text.Length)" -ForegroundColor DarkGray
}
function Write-Good($text) { Write-Host "  [ OK ]   $text" -ForegroundColor Green }
function Write-Warn($text) { Write-Host "  [ !! ]   $text" -ForegroundColor Yellow }
function Write-Bad ($text) { Write-Host "  [FAIL]   $text" -ForegroundColor Red }
function Write-Step($text) { Write-Host "  ....     $text" -ForegroundColor DarkGray }

function Test-Listening($port) {
  try {
    $c = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction Stop
    return ($null -ne $c)
  } catch { return $false }
}

function Get-Health($url, $timeout) {
  try {
    return Invoke-RestMethod -Uri "$url/healthz" -TimeoutSec $timeout -ErrorAction Stop
  } catch { return $null }
}

Clear-Host
Write-Host ""
Write-Host "   DarDesign" -ForegroundColor Cyan
Write-Host "   starting everything for the demo" -ForegroundColor DarkGray

# ---------------------------------------------------------------- 1. data backend
Write-Head "1 of 4  Accounts, saved designs, AI planner"

if (Test-Listening 8000) {
  $h = Get-Health "http://localhost:8000" 8
  if ($null -ne $h) {
    Write-Good "already running on port 8000"
  } else {
    Write-Bad "something holds port 8000 but it is not answering"
    Write-Host "         Close that window and run this again." -ForegroundColor Yellow
  }
} else {
  Write-Step "starting it in a new window..."
  Start-Process powershell -ArgumentList @(
    "-NoExit", "-ExecutionPolicy", "Bypass", "-File", "$root\scripts\run-local-backend.ps1"
  ) -WorkingDirectory $root
  $ok = $false
  foreach ($i in 1..30) {
    Start-Sleep -Seconds 2
    if ($null -ne (Get-Health "http://localhost:8000" 4)) { $ok = $true; break }
  }
  if ($ok) { Write-Good "running on port 8000" }
  else     { Write-Bad  "did not come up -- check the new window for a red error" }
}

# ---------------------------------------------------------------- 2. GPU host
Write-Head "2 of 4  The image generator"

$envFile = Join-Path $root ".env.local"
$gpuUrl = $null
if (Test-Path $envFile) {
  foreach ($line in (Get-Content $envFile)) {
    if ($line -match '^\s*NEXT_PUBLIC_API_URL\s*=\s*(\S+)\s*$') { $gpuUrl = $Matches[1] }
  }
}

$gpuLive = $false
if ($gpuUrl -and $gpuUrl -notmatch 'localhost') {
  Write-Step "checking $gpuUrl"
  $g = Get-Health $gpuUrl 20
  if ($null -ne $g -and $g.ok -eq $true -and $g.light_mode -eq $false) {
    Write-Good "connected -- LIVE GENERATION WILL WORK"
    $gpuLive = $true
  } elseif ($null -ne $g -and $g.light_mode -eq $true) {
    Write-Warn "connected, but it is in placeholder mode (no GPU attached)"
  } else {
    Write-Warn "not answering -- the tunnel has probably expired"
  }
} else {
  Write-Warn "no tunnel address saved"
}

if (-not $gpuLive) {
  Write-Host ""
  Write-Host "         Open your Colab notebook, run all cells, and copy the" -ForegroundColor Yellow
  Write-Host "         https://....trycloudflare.com address it prints." -ForegroundColor Yellow
  Write-Host ""
  $paste = Read-Host "         Paste it here, or press Enter to skip"
  $paste = $paste.Trim().TrimEnd("/")
  if ($paste -match '^https?://') {
    Write-Step "checking that address..."
    $g2 = Get-Health $paste 25
    if ($null -ne $g2 -and $g2.ok -eq $true) {
      $body = @(
        "# DarDesign - the render host. Rotates every Colab session.",
        "NEXT_PUBLIC_API_URL=$paste",
        "NEXT_PUBLIC_DATA_API_URL=http://localhost:8000"
      )
      Set-Content -Path $envFile -Value $body -Encoding utf8
      if ($g2.light_mode -eq $false) {
        Write-Good "connected -- LIVE GENERATION WILL WORK"
        $gpuLive = $true
      } else {
        Write-Warn "connected, but in placeholder mode -- renders will not be real"
      }
    } else {
      Write-Bad "that address did not answer. Continuing without it."
    }
  }
}

# ---------------------------------------------------------------- 3. frontend
Write-Head "3 of 4  The app itself"

if (Test-Listening 3000) {
  Write-Good "already running on port 3000"
} else {
  Write-Step "starting it in a new window (takes about 20 seconds)..."
  Start-Process powershell -ArgumentList @(
    "-NoExit", "-Command", "Set-Location '$root'; npm run dev:tunnel -- --no-check"
  ) -WorkingDirectory $root
  $ok = $false
  foreach ($i in 1..40) {
    Start-Sleep -Seconds 2
    try {
      Invoke-WebRequest -Uri "http://localhost:3000/" -TimeoutSec 5 -UseBasicParsing -ErrorAction Stop | Out-Null
      $ok = $true; break
    } catch { }
  }
  if ($ok) { Write-Good "running on port 3000" }
  else     { Write-Bad  "did not come up -- check the new window" }
}

# ---------------------------------------------------------------- 4. browser
Write-Head "4 of 4  Opening the browser"

$chrome = $null
foreach ($p in @(
  "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
  "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
  "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe"
)) { if (Test-Path $p) { $chrome = $p; break } }

if ($chrome) {
  Start-Process $chrome -ArgumentList "--start-maximized", "http://localhost:3000/"
  Write-Good "Chrome opened"
} else {
  Start-Process "http://localhost:3000/"
  Write-Good "browser opened"
}

# ---------------------------------------------------------------- verdict
Write-Host ""
Write-Host "  ============================================================" -ForegroundColor DarkGray
if ($gpuLive) {
  Write-Host "   READY  --  demo the LIVE path" -ForegroundColor Green
  Write-Host ""
  Write-Host "   Upload a room in Studio and generate for real." -ForegroundColor Gray
  Write-Host "   It takes 1-2 minutes. Talk over the wait -- the" -ForegroundColor Gray
  Write-Host "   'Inside DAR' story plays on screen while it runs." -ForegroundColor Gray
} else {
  Write-Host "   READY  --  demo the PRE-RENDERED path" -ForegroundColor Yellow
  Write-Host ""
  Write-Host "   No GPU, so do NOT try to generate. Instead go to:" -ForegroundColor Gray
  Write-Host "     localhost:3000/studio?demo=1   (finished rooms)" -ForegroundColor White
  Write-Host "     localhost:3000/history         (33 saved designs)" -ForegroundColor White
  Write-Host ""
  Write-Host "   Everything except generating still works." -ForegroundColor Gray
}
Write-Host "  ============================================================" -ForegroundColor DarkGray
Write-Host ""
Write-Host "   Leave the other windows open. Closing them stops the app." -ForegroundColor DarkGray
Write-Host ""
Read-Host "   Press Enter to close this window"
