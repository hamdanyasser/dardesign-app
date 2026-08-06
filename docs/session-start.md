# Starting a session

Two backends, on purpose:

| | runs where | owns | survives the session? |
|---|---|---|---|
| **render backend** | Colab GPU, via a cloudflared tunnel | `/redesign`, `/restyle`, `/api/furniture/*` | no — container wiped, new URL each time |
| **data backend** | your laptop, port 8000 | accounts, saved designs, ratings, `images/` | yes — SQLite + PNGs on your disk |

The frontend routes calls between them by what each needs: `NEXT_PUBLIC_API_URL`
for anything needing the GPU, `NEXT_PUBLIC_DATA_API_URL` for anything that must
outlive the session (`src/lib/api.ts`).

---

## 1 · Colab — the render backend

Run the notebook cells top to bottom. Two things must be true in it:

- `BRANCH = "master"` in Step 1 — that's where the code lives.
- Step 4 does `os.chdir("/content")` **before** `shutil.rmtree(REPO)`. Without
  it, re-running the cell deletes the directory the kernel is sitting in, and
  every later subprocess dies with `getcwd() failed` / exit 128.

Copy the `https://….trycloudflare.com` URL it prints at the end.

> The Colab container has its own empty `dardesign.db`. Ignore it — nothing you
> care about is stored there once step 3 below is in place.

## 2 · Local — the data backend

In its own terminal, left running all session:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\run-local-backend.ps1
```

Generates a stable signing key on first run (`.dardesign-secret`, gitignored) so
restarts don't log you out, then serves on `http://localhost:8000` with
`DARDESIGN_LIGHT=1` — it stores, it never renders.

## 3 · Frontend

```bash
npm run dev:tunnel https://your-new-url.trycloudflare.com
```

Writes `NEXT_PUBLIC_API_URL`, probes `/healthz`, starts Next on :3000. It
rewrites **only** that one line, so `NEXT_PUBLIC_DATA_API_URL` survives.

`.env.local` should end up with both:

```
NEXT_PUBLIC_API_URL=https://….trycloudflare.com
NEXT_PUBLIC_DATA_API_URL=http://localhost:8000
```

⚠️ Never append to this file with `>>` in PowerShell — it writes UTF-16 and Next
silently stops seeing the key. Use `Add-Content .env.local 'KEY=value' -Encoding utf8`.

Next reads env only at boot: after editing `.env.local`, restart the dev server.

---

## Check it worked

```bash
python scripts/inspect_db.py
```

Upload a room, generate, save it — then re-run the command. A new `history` row
and two new files under `images/old/` + `images/new/` mean the split is live.

In devtools → Network, `login` must go to `localhost:8000`. If it goes to
`trycloudflare.com`, the env var isn't being read (see the UTF-16 warning).

## When something is wrong

| symptom | cause |
|---|---|
| login says wrong password for an account you're sure of | you're on the other backend's database — check the Network tab, then `python scripts/inspect_db.py --check EMAIL --password PW` |
| logged out after restarting the backend | started without `run-local-backend.ps1`, so the signing key was random |
| `getcwd() failed`, exit 128 in Colab | missing `os.chdir("/content")` before `rmtree` |
| history images 404 | data backend down, or `NEXT_PUBLIC_DATA_API_URL` unset — the URLs are relative and resolve against it |
| new account isn't Admin | only the first account in an empty table gets Admin; promote with `UPDATE users SET Role='Admin' WHERE Email=…` |
