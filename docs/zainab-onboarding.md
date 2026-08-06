# Zainab — full project access, in one page

أهلاً! This gets you from zero to running (and shipping) the whole project.
Time to first running app: **~10 minutes**. Time to first real render: whenever
a Kaggle session is up.

---

## 1 · What you need installed (once)

| Tool | Why | Get it |
|------|-----|--------|
| Git | clone + commit | git-scm.com |
| Node.js 20+ | run the frontend | nodejs.org (LTS) |
| Python 3.10+ | backend LIGHT mode, scripts | python.org |
| Claude Code | your AI pair — you direct, it types | `npm install -g @anthropic-ai/claude-code` + a Claude Pro account |

Accounts: **GitHub** (accept the repo invite), **Kaggle** (phone-verified — GPU
access needs it), your **Claude Pro**.

## 2 · Run the app (no GPU needed)

```bash
git clone https://github.com/hamdanyasser/dardesign-app.git
cd dardesign-app
npm install
npm run dev            # → http://localhost:3000
```

That's the cinematic landing + the full UI. For the complete flow without a GPU:

```bash
# second terminal — placeholder backend (instant tinted stand-ins)
pip install -r backend/requirements-light.txt
DARDESIGN_LIGHT=1 uvicorn backend.main:app --port 8000
```

**Defense Mode** (real pre-rendered results, zero backend): ask Yasser for the
`public/demo/` folder (~40 MB, not in git) or build it from `outputs/finals/`
with `python scripts/make_demo_pack.py`, then open
`http://localhost:3000/studio?demo=1`.

## 3 · Real generations (Kaggle T4)

One of us starts a session: Kaggle → `dardesign-backend` → **GPU T4 x2** →
**Save & Run All** → after ~6 min the log prints a `https://….trycloudflare.com`
URL → paste it into `.env.local` as `NEXT_PUBLIC_API_URL=…` → restart
`npm run dev`. Any photo you upload at `/studio` now renders live (~4 min).

Code changes deploy themselves: any push to `master` restarts the
live backend within ~60 s (same URL). **Never push while renders are running.**

## 4 · Your two flagship tasks

### 🧪 A — The Evidence Run (this week)
1. Kaggle → the `dardesign-verify` notebook (shared with you) → **Copy & Edit**
   → Session options → **GPU T4 x2** → **Save & Run All**. (~2 h, unattended.)
   It produces the CLIP confusion matrix, LoRA-vs-prompt-only ablation, and
   SSIM/LPIPS scores.
2. Download the outputs, open **Claude Code** in the repo, and drive it:
   > "Here are raw eval outputs in `outputs/verify/`. Build an analysis
   > notebook: 3×3 confusion-matrix heatmaps (LoRA vs prompt-only), SSIM/LPIPS
   > table, per-culture accuracy chart — thesis-quality, gold-on-charcoal."
3. Write the 1-page interpretation. This is YOUR chapter and the top 3 slides.

### 🗺️ B — The Cultural Atlas (next week)
A new `/atlas` route: your 113-term bilingual ontology as a browsable, RTL,
searchable encyclopedia. You build it by directing Claude Code — first prompt:
> "Read CLAUDE.md and `ontology/ontology.json`. Create a new `/atlas` route: an
> RTL, bilingual, searchable encyclopedia of all ontology terms, grouped by
> culture, using the existing `--dd-*` design tokens and Tajawal/Noto Kufi
> fonts. Match the gold-on-charcoal style of `/studio`."

Iterate like a director; commit small; push branch `feat/atlas`.
While you're in the data: **53 terms still need your verification** — all 30
Lebanese + all 23 Persian (`ontology/ontology.json`, flip `verified: false`).

## 5 · Adding features & fixing design

The loop: `npm run dev` in one terminal, **Claude Code** in another, browser on
localhost:3000. Describe → review the diff → test → commit small.

- **Branches:** create `feat/<your-feature>` off `master` and
  push that. ⚠️ Pushing to `master` itself **redeploys the live
  backend within 60 s** (the auto-deploy watchdog) — merge into it only when
  the work is done and no renders are running.
- **Design system:** every color is a `--dd-*` CSS variable in
  `src/app/globals.css` (+ Tailwind aliases like `text-gold`, `bg-charcoal`).
  The cinematic landing tokens live in `src/components/dar/dar-cinema.css`,
  the studio chrome in `src/components/cinema/cinema.css`. **Never hardcode a
  hex** — change the variable and both themes follow.
- **Bilingual rule:** no hardcoded strings — copy comes from
  `ThemeLanguageContext` / component copy files, Arabic-first, RTL-aware
  (`isArabic` patterns are everywhere; copy an existing component).
- **Before pushing:** `npx tsc --noEmit` and `npm run build` must both pass.
  CI runs the backend tests + build on every push.

## 6 · Where everything lives

- **Notion HQ** — plan, tasks board (your view: 👤 Zainab), decisions log.
- **`docs/`** — thesis draft, defense Q&A, demo runbook, survey kit, slides
  outline, this file.
- **`datasets/`** — the training images + captions; `datasets/LICENSING.csv`
  needs sources/licenses filled (panel will ask).
- **`ontology/ontology.json`** — your knowledge base; the prompt builder reads
  it live.
- **CLAUDE.md** — the repo map Claude Code reads automatically; skim it once.

Questions → Yasser, or honestly: open Claude Code and ask it. It has read the
whole repo.
