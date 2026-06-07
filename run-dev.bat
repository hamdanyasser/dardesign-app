@echo off
REM ── DarDesign — one-step dev launcher (Windows) ────────────────────────────
REM Double-click this file, or run it from a terminal, to start the app.
cd /d "%~dp0"

if not exist ".env.local" (
  echo No .env.local found - creating one from .env.example.
  echo IMPORTANT: open .env.local and paste your CURRENT ngrok URL into NEXT_PUBLIC_API_URL.
  copy ".env.example" ".env.local" >nul
)

if not exist "node_modules" (
  echo Installing dependencies ^(first run only^)...
  call npm install
)

echo.
echo Starting DarDesign at http://localhost:3000
echo  - Landing + Studio UI work immediately.
echo  - The actual redesign needs your backend up and the ngrok URL set in .env.local.
echo.
call npm run dev
