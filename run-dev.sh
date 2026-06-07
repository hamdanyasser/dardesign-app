#!/usr/bin/env bash
# ── DarDesign — one-step dev launcher (macOS / Linux) ───────────────────────
set -e
cd "$(dirname "$0")"

if [ ! -f .env.local ]; then
  echo "No .env.local found — creating one from .env.example."
  echo "IMPORTANT: edit .env.local and paste your CURRENT ngrok URL into NEXT_PUBLIC_API_URL."
  cp .env.example .env.local
fi

if [ ! -d node_modules ]; then
  echo "Installing dependencies (first run only)…"
  npm install
fi

echo
echo "Starting DarDesign at http://localhost:3000"
echo " - Landing + Studio UI work immediately."
echo " - The actual redesign needs your backend up and the ngrok URL set in .env.local."
echo
npm run dev
