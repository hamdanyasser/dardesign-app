# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**DarDesign** is a bilingual (English/Arabic) AI interior design web app. Users upload a room photo, choose an Arabic architectural style (Lebanese, Khaleeji, or Moroccan), and get an AI-generated redesign. The app has a gold-on-dark luxury aesthetic with full RTL support.

**Stack:** Next.js 16 App Router (Turbopack), React 19, TypeScript 5, Tailwind CSS 3.4, shadcn/ui (radix-nova style), Lucide icons. Upgraded from Next 14 / React 18 on 2026-08-12 as part of the visual overhaul.

---

## Commands

**This is a two-language repo** — a Next.js frontend *and* a FastAPI backend (`backend/`, `tests/`, `scripts/`) in one tree. CI runs both ([.github/workflows/ci.yml](.github/workflows/ci.yml)): `pytest` under `DARDESIGN_LIGHT=1` and `npm run build`. Run both before claiming a change is green.

### Frontend

```bash
npm run dev                       # next dev on :3000
npm run dev:tunnel <url>          # write .env.local + probe /healthz + next dev — the normal session start
npm run build                     # production build; type check included. Must pass with zero errors
npm run lint                      # BROKEN under Next 16 — see below
```

**`npm run lint` does not work.** Next 16 removed the `next lint` command, so the script fails with `Invalid project directory provided, no such directory: …\lint`. CI never ran it (the frontend job is `npm run build` alone), so nothing is silently unchecked that used to be checked — but `npm run build` is currently the only frontend gate. Fixing it means migrating to the ESLint 9 flat config (`eslint.config.mjs`) that `eslint-config-next` v16 expects; the repo still has the eslintrc-format `.eslintrc.json`.

`npm run dev:tunnel` refuses to fall back off :3000 — the backend's default CORS allowlist is `localhost:3000` only, and Next's silent :3001 fallback would break every `/redesign` call. Flags need npm's separator: `-- --set-only`, `-- --no-check`, `-- --any-port`.

### Backend + tests

```bash
python -m pytest tests -q                          # full suite (531 tests, no GPU, ~20s)
python -m pytest tests/test_subscriptions.py -q    # one file
python -m pytest tests/test_api.py -k redesign -q  # one test / pattern
python -m uvicorn backend.main:app --port 8000     # serve the API
```

Every test needs `DARDESIGN_LIGHT=1` — the suite exercises the real FastAPI app with the placeholder render branch. **Set it per shell, not inline**: `$env:DARDESIGN_LIGHT="1"` in PowerShell (the primary shell here — `VAR=x cmd` is a parse error), `DARDESIGN_LIGHT=1 python -m pytest …` in Git Bash.

The `Makefile` wraps the same commands (`make test`, `make backend-light`, `make smoke-prompt`, plus the Kaggle-only training/eval targets) but its recipes are POSIX — on Windows use Git Bash or copy the command bodies.

### The local data backend (Windows)

```powershell
powershell -ExecutionPolicy Bypass -File scripts\run-local-backend.ps1
```

The one command for day-to-day work with accounts and saved designs. It generates/reuses the session-signing key in `.dardesign-secret` (without a stable key every restart logs you out), loads `.dardesign-smtp` if present, sets `DARDESIGN_LIGHT=1`, and serves on :8000. It **never renders** — see "Two backends" below.

---

## File Structure

```
src/
├── app/
│   ├── globals.css              # All CSS variables, themes, animations, utility classes (~548 lines)
│   ├── layout.tsx               # Root layout — fonts (Tajawal, Reem Kufi, Noto Kufi, Amiri, Inter, DM Sans, JetBrains Mono); imports cinema.css + dar-cinema.css; both providers, <html> defaults
│   ├── page.tsx                 # Home — thin wrapper that renders <DarCinema /> from src/components/dar/                                             
│   ├── studio/page.tsx          # The product — upload → /redesign → reveal + six result tabs
│   └── transform|result/page.tsx # Retired — redirect("/studio") stubs only
├── components/
│   ├── ui/                      # shadcn primitives (button, card, badge, separator, switch, dropdown-menu)
│   ├── dar/                     # DarCinema — the DEFAULT cinematic RTL landing (Claude Design handoff), scoped under .dar-cinema
│   │   ├── DarCinema.tsx         # 5-scene scrollytelling: intro bloom → threshold tunnel (scroll 3D) → 3D scan → souls carousel → orbit room → provenance
│   │   └── dar-cinema.css        # ~180 lines, scoped under .dar-cinema (warm charcoal/gold v2 tokens, Reem Kufi + Tajawal, dark/light toggle)
│   ├── cinema/                  # Shared cinematic pieces for /studio + error + 404 (ArchCanvas, DissolveCanvas, DustLayer, MotifTiles, copy, hooks, cinema.css). CinemaChrome was deleted 2026-08-12 — the redesign's sidebar replaced it and nothing imported it
│   ├── design/                  # Build Mode UI (see "Build Mode" below)
│   │   ├── DesignCanvas.tsx      # Pointer/key gestures → store actions; owns no scene logic
│   │   ├── CatalogDock.tsx       # Bottom rail; cut-out PNGs live HERE only, never in the 3D scene
│   │   ├── Inspector.tsx         # Object + room panels (dimensions, rotation, material, provenance)
│   │   ├── HandoffPanel.tsx      # "Finish" → conditioning evidence + Render with DAR
│   │   ├── PlanMinimap.tsx       # SVG plan view, click-to-select
│   │   ├── SourceCard.tsx        # Corner thumbnail: the DAR render / photo you are designing from
│   │   ├── EnterBuildMode.tsx    # The doorway from Studio; writes the sessionStorage handoff
│   │   └── design.css            # Scoped under .dar-build, reuses the cinema token surface
│   ├── story/                   # Narrative layer for /studio results + wait (see "Narrative layer" below)
│   │   ├── DesignStory.tsx       # 8-chapter editorial reading of one finished result
│   │   ├── CultureDNA.tsx        # Ontology vocabulary for one culture, or all three side by side
│   │   ├── GenerationStory.tsx   # "Inside DAR" — 7-chapter documentary loop
│   │   ├── StoryComparison.tsx   # Accessible built-in wipe used inside DesignStory
│   │   ├── RoomUnderstandingFigure.tsx  # Detections + top-down projection figure
│   │   ├── adapters.ts           # RedesignResult → story data. The truth gate; see README.md
│   │   ├── cultureData.ts        # Reads the canonical root ontology/ontology.json
│   │   ├── copy.ts / types.ts    # Bilingual copy + public types
│   │   ├── *.module.css          # Scoped CSS modules (authored to a 1480px measure)
│   │   └── README.md             # Integration contract — read before wiring anything new
│   ├── islamic-pattern.tsx      # Decorative 8-pointed star repeating SVG background
│   └── before-after-slider.tsx  # Pointer/keyboard/ARIA image comparison wipe
├── context/
│   ├── ThemeLanguageContext.tsx  # Language (EN/AR), theme (dark/light), all translations
│   └── ImageContext.tsx          # Cross-page state: uploaded image + selected style + jobId
└── lib/
    ├── design/                  # Build Mode model — no React, no THREE.* in the scene object
    │   ├── types.ts              # DesignScene / PlacedObject / RoomShell. Centimetres, serializable
    │   ├── store.ts              # Reducer + snapshot undo/redo + localStorage persistence
    │   ├── roomModel.ts          # RedesignResult → shell + "found" massing (the DAR advantage)
    │   ├── placement.ts          # Oriented-rect SAT collision, snapping, two-tier verdict
    │   ├── catalog.ts            # Reads ontology/furniture.json — no second copy of dimensions
    │   ├── materials.ts          # Palette sourced from ontology.json's own color_palette
    │   ├── geometry.ts           # Procedural furniture at real cm — never billboarded PNGs
    │   ├── scene3d.ts            # DesignWorld: renderer, camera rig, wall culling, conditioning capture
    │   ├── handoff.ts            # The sessionStorage key, alone, so /design's bundle stays out of Studio
    │   └── ade20k.ts             # GENERATED from the backend palette; do not hand-edit
    ├── api.ts                   # Typed backend client — redesignRoom/restyleRoom, renderScene, colour + furniture, auth, history, subscription/usage, admin. (uploadImage/startTransform/pollStatus are the retired async flow, still exported)
    └── utils.ts                 # cn() utility (clsx + tailwind-merge)
```

Outside `src/`, the directories that are load-bearing rather than incidental:

| path | what it is |
|---|---|
| `backend/` | the FastAPI service — see "Backend" below |
| `ontology/` | **canonical** cultural vocabulary (`ontology.json`) + `furniture.json` dimensions + `knowledge/<culture>.json` (the RAG editorial layer). `src/data/ontology.json` is a second copy — keep them in step |
| `configs/` | `pipeline.yaml` + `sweep_winners.json` — ControlNet weights are tuned here, not in code |
| `scripts/` | training/eval/ops (`train_lora.py`, `controlnet_sweep.py`, `metrics.py`, `backfill_evaluation.py`, `dev-tunnel.mjs`, `run-local-backend.ps1`) |
| `tests/` | pytest, backend only — there is **no frontend test runner**; `npm run build` is the frontend's gate |
| `docs/` | thesis chapters, defense Q&A, demo runbook, Zainab handoff |
| `kaggle/` | paste-into-cell runbooks for the T4 notebook |
| `eval/` · `outputs/` · `datasets/` · `models/loras/` | eval CSVs, generated batches, per-culture training data, trained LoRAs (weights gitignored) |

---

## Architecture

### Provider Hierarchy (layout.tsx)

```
<html lang="en" dir="ltr" data-theme="dark">
  <body>
    <ThemeLanguageProvider>
      <ImageProvider>
        {children}
      </ImageProvider>
    </ThemeLanguageProvider>
  </body>
</html>
```

### Routing / User Flow

| Route | Purpose |
|-------|---------|
| `/` | **DarCinema** — cinematic 5-scene RTL-Arabic scrollytelling (the default design, `src/components/dar/`). Header dark/light toggle + studio CTA. Door CTA → `/studio`. |
| `/studio` | **The product.** Upload → `/redesign` → reveal wipe + six result tabs (Result · Design Story · Culture DNA · Inside DAR · Understand · Edit). `?demo=1` adds the Defense Mode strip of pre-rendered rooms. |
| `/design` | **DAR Build Mode** — metric 3D room designer + "Render with DAR". Entered from a Studio result; the scene crosses in `sessionStorage`. See "Build Mode" below. |
| `/history` · `/others` | Saved designs; other users' saved work + ratings |
| `/subscription` | Both plans, current weekly usage, subscribe/unsubscribe |
| `/login` · `/register` | Auth (A1 underline-only inputs) |
| `/evaluation` | Admin-only evaluation dashboard (A3) |
| `/admin/users` · `/admin/subscriptions` | Admin: accounts + the approve/decline queue |
| `/audit` | Unlinked admin audit table (token-gated endpoint) |
| `/v2` | Understood Room Three.js rebuild (see `UNDERSTOOD_ROOM_THREEJS_SPEC.md`) |
| `/transform` · `/result` | **Retired** — server-side `redirect("/studio")` stubs only |

### Context: ThemeLanguageContext

- **State:** `language` (`"en"` / `"ar"`), `theme` (`"dark"` / `"light"`)
- **Derived:** `isArabic`, `copy` (typed translations for current language)
- **Methods:** `toggleLanguage()`, `toggleTheme()`, `t(dotPath)`
- **Side effects:** Sets `lang`, `dir`, `data-theme` on `document.documentElement`
- **Translations:** Deeply typed via `TranslationShape` with `satisfies Record<Language, TranslationShape>`
- **Exports:** `Language`, `Theme` types, `useThemeLanguage()` hook

### Context: ImageContext

- **State:** `imageFile`, `imagePreviewUrl`, `selectedStyle`
- **Methods:** `setImage(file)`, `clearImage()`, `setSelectedStyle(style)`, `reset()`
- **Memory safety:** `URL.revokeObjectURL` called on clear/reset
- **Exports:** `StyleId` type (`"lebanese" | "khaleeji" | "moroccan"`), `useImage()` hook

---

## Design System

### Color Palette (CSS Custom Properties)

All colors are defined via `--dd-*` variables in `globals.css` under `@layer base`. Theme switching uses `[data-theme="dark"]` and `[data-theme="light"]` selectors.

| Variable | Dark Value | Light Value | Purpose |
|----------|-----------|-------------|---------|
| `--dd-bg` | `#0a0a0f` | `#faf8f5` | Page background |
| `--dd-surface` | `#12121a` | `#ffffff` | Card backgrounds |
| `--dd-surface-strong` | `#181821` | `#f2ede4` | Elevated surfaces |
| `--dd-gold` | `#d4af37` | `#b8960c` | Primary accent |
| `--dd-gold-hover` | `#f0d78c` | `#d4af37` | Gold hover state |
| `--dd-gold-dim` | `#8b7432` | `#9c7d08` | Muted gold |
| `--dd-text` | `#f5f0e8` | `#1a1a2e` | Primary text |
| `--dd-text-soft` | `#e8e0d0` | `#312c46` | Secondary text |
| `--dd-text-secondary` | `#8a8598` | `#6b6580` | Tertiary/muted text |
| `--dd-ink` | `#16110a` | `#16110a` | Text on gold |
| `--dd-glass-bg` | `rgba(10,10,15,0.8)` | `rgba(250,248,245,0.8)` | Glassmorphism bg |
| `--error` | `#e85d4a` | `#e85d4a` | Error states |
| `--success` | `#4a9e6e` | `#4a9e6e` | Success states |

**Tailwind aliases** (in `tailwind.config.ts`): `charcoal`, `charcoal-soft`, `charcoal-hover`, `gold`, `gold-light`, `gold-dim`, `cream`, `cream-soft`, `cream-muted` — all map to `--dd-*` via intermediate variables.

**shadcn variables:** `--background`, `--primary`, `--card`, etc. all point to `--dd-*` vars for automatic theme switching.

**Style gradients:** `--dd-style-lebanese`, `--dd-style-khaleeji`, `--dd-style-moroccan` — used in style showcase cards.

### Typography

| Font | Variable | Usage |
|------|----------|-------|
| Inter | `--font-inter` | English body fallback |
| DM Sans | `--font-dm-sans` | English UI text (`.font-ui`) |
| Noto Kufi Arabic | `--font-noto-kufi-arabic` | Arabic calligraphic headings (`.font-arabic` on landing) |
| Tajawal | `--font-tajawal` | Arabic body text (`.font-brand-arabic`) |

**Font classes in CSS:**
- `.font-ui` — DM Sans → Inter fallback
- `.font-display` — Inter with tight letter-spacing
- `.font-arabic` — Noto Kufi Arabic → Tajawal fallback
- `.font-brand-arabic` — Tajawal → Noto Kufi Arabic fallback

**Language-aware body:** `html[lang="en"] body` uses DM Sans/Inter; `html[lang="ar"] body` uses Tajawal.

### Key CSS Classes

| Class | Purpose |
|-------|---------|
| `.noise-overlay::before` | SVG feTurbulence noise texture at 3% opacity |
| `.shimmer-btn` | Gold gradient button with animated shimmer highlight |
| `.upload-zone-dashed` | Dashed border dropzone with hover/dragover gold border |
| `.glass-panel` | Glassmorphism with backdrop-blur |
| `.hero-mesh` | Animated radial gradient mesh background |
| `.floating-shape` | Animated floating hexagon/diamond/circle decorations |
| `.social-marquee` | Infinite horizontal scroll for social proof |
| `.how-card` | How-it-works step card with oversized number |
| `.style-showcase-card` | 3D perspective tilt card for style showcase |
| `.gold-line` | Horizontal gold gradient divider |
| `.reveal` / `.reveal.visible` | Scroll-triggered fade-in via IntersectionObserver |

### Animations

| Name | Duration | Purpose |
|------|----------|---------|
| `fade-in-up` | 0.8s | Element entrance (staggered via `-d2`, `-d3` variants) |
| `shimmer` | 2s loop | Gold shimmer sweep on buttons |
| `spin-slow` | 8s loop | Loading screen star rotation |
| `progress-fill` | 8s once | Loading bar 0%→100% width |
| `fade-cycle` | 0.6s | Loading message transitions |
| `pulse-gold` | 2s loop | Subtle gold glow pulse |
| `mesh-shift` | 20s loop | Hero mesh background movement |
| `float-shape` | variable | Floating decorative elements |
| `marquee` | 25s loop | Social proof horizontal scroll |

### Visual direction (frozen 2026-08-10)

Three intensities of one identity — same palette, type and material logic, differing only in how much spatial drama vs. drawing-instrument language each surface carries. Source of truth: Claude Design project "DAR Design — Contemporary Arab Architectural Editorial" (`00 Design Context.dc.html` + `A1/A2/A3 *.dc.html`).

| Variant | Character | Governs | Signature move |
|---|---|---|---|
| A1 | Editorial Minimal | History · Others · Auth · Subscription · Admin | Type and hairline rules carry everything; image small, whitespace large |
| A2 | Cinematic Editorial | Landing · Studio · Result | Image is the page; type sits over/beside it at scale |
| A3 | Technical Editorial | Understand · Evaluation | Drawing sheet: dimension ticks, leader lines, mono annotation |

Shared, non-negotiable: hairline rules instead of card borders; one radius family (2/6/14px, never pill except toggles); no drop shadows except one cinematic lift on hero imagery; mono restricted to metric values/dimensions/durations/codes, never headings/body/buttons/nav; em-dash (never a fabricated zero) for any unmeasured figure.

A1/A2/A3 are implemented across the app: Landing/Studio/Result carry A2 (Studio tabs, the material culture picker), and History/Others/Subscription/Admin Users/Admin Subscriptions/Login/Register carry A1's concrete patterns (hairline-only entries, diamond-shaped ratings, underline-only auth inputs, non-card subscription rows, plain hairline admin tables). Evaluation's A3 restructure (01–04 sectioning) is tracked separately below.

The `src/components/story/` narrative tabs are a **separate handoff** styled in scoped CSS modules rather than the `--dd-*`/cinema token surface. They read as A1-at-editorial-scale — numbered chapters, hairline rules, mono confined to chapter numbers and measurement values — and they honour the em-dash rule strictly (see "Narrative layer" below). They have **not** been formally reconciled against the A1/A2/A3 mockups; treat that as open rather than settled.

Known tensions in the source material itself (not yet reconciled, currently resolved in code by favoring the actual A1/A2 mockups over the context doc's prose summary): the context doc says "no glass" and "mono forbidden on nav/buttons," but the A2 mockup's own `.chrome` uses `backdrop-filter:blur`, and both A1 and A2 set `.nav`/`.btn` to the mono font. (The `CinemaChrome` scrim that settled this in practice — `backdrop-filter: blur(8px)`, replacing an unreadable `mix-blend-mode: difference` — went away with the component on 2026-08-12; the tension itself is still unreconciled, and the sidebar now makes the call.)

**Flags retired (2026-08-10, completed).** The design context doc called national flag emoji "the single clearest thing to replace" with a material-stack + proportion-motif treatment. No flag emoji or flag-like imagery remains anywhere in the app. Studio's culture picker, the "All three" triptych, and the post-generation result tiles all render `MotifTiles[STYLE_MOTIF[id]]` (`src/components/cinema/svg/MotifTiles.tsx` — qanater for Lebanese, majlis for Khaleeji, zellige for Moroccan; the "Original" result tile keeps its house icon — it isn't a culture). The Moroccan `zellige` tile was itself rebuilt: it was a literal 5-pointed star shape, which reads as a flag emblem rather than tessellation — replaced with the design doc's own reference construction (a square + the same square rotated 45°, i.e. an 8-pointed geometric lattice, outline only, no filled star silhouette). The dead `style-card.tsx`/`style-selector.tsx` pair (unreachable — their only caller was the retired `/transform` flow) has been deleted rather than left as unused code, along with its orphaned `.style-card-base`/`.style-card-selected` CSS and `ThemeLanguageContext`'s `StyleCopy.flag` field.

---

## Component API Reference

### BeforeAfterSlider
```tsx
<BeforeAfterSlider
  beforeSrc={string} afterSrc={string}
  beforeLabel="Before" afterLabel="After"
  beforeAlt={string} afterAlt={string}      // default to the labels
  sliderLabel={string}                       // aria-label; defaults to "before / after"
  afterSide={"left" | "right"}               // omit to follow reading direction
  className={string}
/>
```
Comparison wipe using `clip-path: inset()`. **Pointer events with pointer capture**, so a drag keeps tracking after the cursor leaves the frame — one code path for mouse, touch and pen. Keyboard: `←/↓` and `→/↑` step 2%, `Shift` steps 10%, `Home`/`End` jump to the ends. Exposed as `role="slider"` with live `aria-valuenow`/`aria-valuetext`, and `touch-action: pan-y` so vertical page scrolling still works over it.

By default the result follows the reading direction (right in EN, left in AR). `afterSide` pins it to a physical side for callers with an established convention — `/studio` passes `"right"` because `.lbl.before`/`.lbl.after` in `cinema.css` are pinned left/right in both languages, so the images must match.

### IslamicPattern
```tsx
<IslamicPattern opacity={0.04} className="" />
```
Absolutely positioned repeating SVG 8-pointed star pattern.

---

## Conventions

### Bilingual Pattern
Every component uses `const { copy, isArabic } = useThemeLanguage()` and:
- Text: `{copy.section.key}` — never hardcoded strings
- Arabic font: `isArabic ? "font-arabic" : "font-display"` or `isArabic && "font-arabic"`
- RTL layout: `isArabic ? "text-right" : "text-left"`, `isArabic && "flex-row-reverse"`

### Styling Pattern
- Colors: always reference `var(--dd-*)` or Tailwind aliases (`text-gold`, `bg-charcoal`)
- Never hardcode hex colors in components
- Use `cn()` from `@/lib/utils` for conditional class merging
- All components are `"use client"` — no server components beyond layout

### File Conventions
- All components: default export, PascalCase filename matching component name
- shadcn components live in `src/components/ui/`, custom components in `src/components/`
- Path alias: `@/*` maps to `./src/*`

### Images
- User uploads use `URL.createObjectURL` for preview (stored in ImageContext)
- Placeholder images are inline SVG data URIs, not files in `/public/`
- `<img>` tags used instead of `next/image` (blob URLs + data URIs don't work well with next/image)

### Next.js Specifics
- `useSearchParams()` must be inside a `<Suspense>` boundary (Next.js 14 requirement)
- `suppressHydrationWarning` on `<html>` because `data-theme`/`lang`/`dir` are set client-side
- Global 300ms CSS transition on color/background/border/shadow for smooth theme switching

---

## Three Styles

| ID | Motif (`MotifTiles` key) | English Name | Arabic Name |
|----|---------------------------|-------------|-------------|
| `lebanese` | `qanater` — triple-arch, limestone/cedar | Lebanese | لبناني |
| `khaleeji` | `majlis` — brass lamp, deep-shadow bench | Khaleeji | خليجي |
| `moroccan` | `zellige` — cobalt tessellation | Moroccan | مغربي |

Each style has: `name`, `selectorDescription`, `origin`, `landingDescription`, `tags[]`, `learnMore` — defined in both EN and AR translations. (A `flag` field used to live here; removed along with the rest of the flag system — see "Flags retired" above.)

A 4th culture, `persian` (فارسي), is **prompt-only** and restyle-only — it exists in the backend `StylePack`/ontology and the intensity slider, but not in the core `StyleId`, `/redesign`, or the landing copy.

---

## Known Decisions

- **Backend lives in [backend/](backend/):** FastAPI, real SDXL + dual ControlNet pipeline in [backend/transform.py](backend/transform.py), `DARDESIGN_LIGHT=1` for placeholder-PNG mode without a GPU. See "Backend" below for the module map and the two-host split. (`/upload`, `/transform`, `/status`, `/result`, `/retry` still exist but are the **retired** async flow — the live path is `/redesign`.)
- **Theme/language persist via localStorage** (`dd-theme`, `dd-language` keys): a blocking inline script in `layout.tsx` reads them and sets `data-theme`/`lang`/`dir` on `<html>` before first paint (avoids a flash of the wrong theme), and `ThemeLanguageProvider` restores the same keys into React state on mount, gated so it can't stomp the inline script's value. Keep the storage keys in sync between the two if either changes.
- **No next/image:** Using `<img>` elements because blob URLs and SVG data URIs are incompatible with Next.js image optimization. ESLint warnings for this are expected.
- **All client components:** Every page and component uses `"use client"` since they depend on context providers.
- **Sprint worktrees are merged, not authoritative (2026-08-11).** `C:\Users\hamda\dar-designer` (`sprint/designer`) and `C:\Users\hamda\dar-story` (`sprint/story`) are `git worktree` checkouts of this repo. Both sat on the *same* commit as main with their work **uncommitted**, so `git log` showed nothing — `git -C <path> status` / `diff HEAD` is the only way to see what they hold. Their finished work (the `BeforeAfterSlider` rewrite; the whole `src/components/story/` package) now lives here. Their copies of `src/app/studio/page.tsx` are built on the **pre-overhaul baseline** and are older than this one: never copy that file across, port the hunk. `git worktree list` is the quickest way to re-check what exists.

---

## Backend (`backend/`)

One FastAPI app (`backend/main.py`, ~1970 lines) that can be run in two very different roles, plus a placeholder mode.

**Two backends, one codebase — this is the fact that explains the most surprising code.** `NEXT_PUBLIC_API_URL` is the **render host** (Kaggle T4 behind a rotating tunnel; holds no durable state, wiped between sessions); `NEXT_PUBLIC_DATA_API_URL` is the **data host** (SQLite at `backend/dardesign.db` + `images/`, normally your own machine). Unset, the data URL follows the render URL and one backend does everything. `src/lib/api.ts` routes each call deliberately: renders and room compute (`/redesign`, `/restyle`, `/render-scene`, `/api/furniture/*`) go to `API_URL`; accounts, history, feedback, subscription and admin go to `DATA_API_URL`. **The GPU host has no users table and is sent no session cookie** — that is why `/api/usage/consume` is a separate endpoint instead of a check inside `/redesign`, and why anything touching auth must go through `DATA_API_URL`.

**`DARDESIGN_LIGHT=1` is a first-class mode, not a mock.** `backend/transform.py` is canonical and has a placeholder branch; nothing else is stubbed. The whole test suite and the local data backend run in it. Consequences to expect rather than debug: the synthetic room has no ADE20K floor (floor recolour correctly reports "not detected"), and `placeholder: true` propagates to `object_map` / `seg_regions` / `room_analysis` so the frontend's truth gates suppress them.

| module | role |
|---|---|
| `main.py` | the entire HTTP surface + pydantic models. Endpoint families: render (`/redesign`, `/restyle`, `/render-scene`), retired async job flow (`/upload`, `/transform`, `/status`, `/result`, `/retry`), share, auth, history, feedback, subscription + usage, `/api/admin/*`, `/api/furniture/*`, `/audit`, `/healthz` |
| `transform.py` | SDXL + dual ControlNet, lazy per-culture LoRA, OOM→SD1.5 fallback, `DARDESIGN_LIGHT` branch. `_generate(control_override=None)` is what `/render-scene` rides |
| `room_analysis.py` · `projection.py` | one depth+seg pass → floor/occupied masks, top-down object map, seg bounding boxes |
| `prompt_builder.py` | `ontology/ontology.json` → bilingual positive/negative prompts; seedable |
| `placement.py` · `furniture.py` · `compositing.py` | furniture recommendation, candidate positions, validation, and compositing into a finished render |
| `recolor.py` · `recolor_api.py` | masked HSV wall/floor recolour (`/api/color/*` router) |
| `quality.py` · `evaluation.py` | SSIM/LPIPS/CLIP scoring and the `/api/admin/evaluation` aggregation |
| `db.py` | all SQLite (~1300 lines). Holds storage only — every policy number is passed in |
| `auth.py` · `subscriptions.py` · `mailer.py` | sessions; plan policy + expiry service; decision emails |
| `jobs.py` · `ttl_cleanup.py` · `audit.py` · `share.py` | in-memory job registry, TTL sweeper, append-only JSONL audit, HMAC share tokens |
| `validators.py` · `errors.py` · `guardrails.py` | upload validation; **every `HTTPException` carries `{code, message_en, message_ar}`** — there is no client-side error mapping table |

Two invariants that are easy to break:

- **`_GEN_LOCK` serialises every generation.** The cached diffusers pipeline and its LoRA fuse state are not concurrency-safe; a second request arriving mid-hot-swap corrupts the accelerate offload hooks (`_hf_hook` AttributeError on the T4). Any new generating endpoint must take that lock.
- **Long endpoints stream keepalives.** `_stream_keepalive()` yields whitespace every 10s while the work runs, then the JSON body — free tunnels 524 anything that waits ~100s for its first byte. Leading whitespace is a valid JSON prefix, so `res.json()` is unchanged. The catch: **once the stream starts the 200 is already sent**, so post-start failures come back in-band as an `ApiError`-shaped `detail` body — which is why `src/lib/api.ts` validates response *shape*, not just status.

`ARCHITECTURE.md` is **stale** — its diagram and tables describe the retired `/upload`+`/transform`+`/status` flow and `style-selector.tsx`, which no longer exists. Prefer this file and the code; treat ARCHITECTURE.md's "Key design decisions" list as the only part still broadly true.

---

## Studio flow + `/redesign` (Week 1 wiring)

Demo path: `/` (DarCinema landing, CTA → `/studio`) → **`/studio`** (upload → all three redesigns).

- **`POST /redesign`** (one shot, ~1–2 min, keepalive-streamed): multipart `file` + optional `styles` (comma-separated subset — defaults to all three; asking for one is ~3x faster because the depth+seg pass and room analysis run once regardless, which makes the iterate-and-retest loop practical without changing the default). Returns `{ original, lebanese, khaleeji, moroccan }` as base64 PNG **data URLs**, plus `object_map` (top-down projection), `seg_regions` (on-image highlighter bboxes from `seg_bounding_boxes()` in `backend/projection.py`), `depth_map` (grayscale depth PNG data URL for DepthOrbit), `room_analysis` (the Build Mode shell source), and `job_id` / `duration_s` / `ssim` — all from one depth+seg pass, null on failure, `placeholder: true` in LIGHT mode. The depth/seg block is best-effort in its own `try`: a failure there must never cost the user their three designs. Client = `redesignRoom()` in `src/lib/api.ts` (≥180s timeout, `AbortController`, typed bilingual errors, response-shape validation — the shape check is what catches an in-band error arriving under a streamed 200). Replaces the old async `/upload`+`/transform`+`/status`+`/result` polling flow.
- **`/studio`** (`src/app/studio/page.tsx`): drag-drop (inlined in the page since the 2026-08-12 redesign; the shared `UploadZone` it used to call is gone) → cinematic loading scene (indeterminate ring + measured elapsed time + scope label — **no percentage**, because `/redesign` returns once and has no intermediate state to report) → the reveal: a `BeforeAfterSlider` wipe over the featured culture, a design-directions rail, then a six-tab working area. Bilingual error + retry. RTL/Tajawal, gold-on-charcoal.
- **Result tabs** (`ResultTab` in `studio/page.tsx`): **Result** (all generated tiles + per-image download) · **Design Story** · **Culture DNA** · **Inside DAR** · **Understand** (highlighter, 2D map, DepthOrbit, narration) · **Edit** (colour, furniture, intensity). The three narrative tabs are **conditionally mounted**, not CSS-hidden like the tool tabs — `GenerationStory` runs a timed chapter loop and `DesignStory` measures natural image ratios, both of which would otherwise run offscreen. `TOOL_TABS` is what keeps the shared Understand/Edit wrapper from leaking into the narrative tabs; it is the thing to update if a tab is ever added.
- **`/transform` and `/result`** are retired — they now `redirect("/studio")`.
- **CulturalElementHighlighter** (`src/components/CulturalElementHighlighter.tsx` + `src/data/ontology.json`): overlays segmentation regions (SVG + accessible hotspots) and reveals an element's Arabic term + note on click. **Wired**: real regions arrive in `/redesign`'s `seg_regions`; `DEMO_REGIONS` is the fallback for placeholder/absent data. `/studio` labels the section "(live)" when both regions and map are real.
- **Env:** `NEXT_PUBLIC_API_URL` in `.env.local` (gitignored; template in `.env.example`). The tunnel URL rotates each session — keep it swappable. **`npm run dev:tunnel <url>`** (`scripts/dev-tunnel.mjs`) is the one-command session start: writes `.env.local`, probes `/healthz`, then runs `next dev` on :3000. It hard-fails if :3000 is taken, because the backend's CORS allowlist is localhost:3000 only and Next's silent fallback to :3001 would break every `/redesign` call. Re-run with no URL to reuse the saved one.
- **RoomMap2D** (`src/components/RoomMap2D.tsx`): top-down 2D layout map — furniture footprints + door/window wall openings + AR/EN labels (from `ontology.json`), click-to-read note. **Wired**: real objects arrive in `/redesign`'s `object_map` (from `project_top_down()`); `DEMO_MAP` is the fallback.
- **DepthOrbit** (`src/components/DepthOrbit.tsx`): Tier A interactive 3D — the featured styled image displaced by `/redesign`'s `depth_map` PNG, clamped parallax orbit (three.js 0.150). Mounted in `/studio` results below the highlighter/map grid. Completes the "Understood Room" trio: how it looks (restyle) / how it's laid out (2D map) / how it feels to be in (3D orbit).
- **Persian (prompt-only 4th culture)**: in `ontology.json`, `CULTURES`, and `StylePack`, served by `/restyle` + the Style Intensity Slider only — `/redesign` loops `CORE_STYLES` (the 3 trained cultures) so demo timing/contract never change. No LoRA file → `_attach_lora`'s prompt-only fallback. Terms are `verified: false` pending Zainab's sign-off.
- **Colour Control** (`backend/recolor.py` + `backend/recolor_api.py` + `src/components/ColorControl.tsx`): recolour the **wall** or **floor** of a finished render. Not a second generation pass — a masked HSV edit on the render we already have, so hue/saturation come from the picked colour while the value channel (every shadow, highlight and bit of texture) is kept. Masks are the ones `analyze_room()` already built during `/redesign`, read from `RoomAnalysis.seg_ids` so "floor" means ADE20K floor and *not* the rug on it (`floor_mask` counts rugs as standing-room for furniture on purpose). `POST /api/color/{preview,apply,undo,reset}` + `GET /api/color/targets`; apply repoints `job.style_outputs[style]` exactly like furniture placement, so colour edits stack on furniture insertions and the existing **Save design** button stores the result as a new history row (no schema change). Mask edges are **feathered, never eroded** — eroding traces every object in the old colour, which reads as a glow. A surface covering <0.5% of the frame is reported as undetected, bilingually. CPU-only, milliseconds. In `DARDESIGN_LIGHT` the synthetic room has no ADE20K floor, so **floor recolour correctly reports "not detected"** there; wall works.
- **Cultural furniture catalogue** (`ontology/furniture.json` + `backend/furniture.py` + `backend/placement.py` + `backend/compositing.py` + `src/components/FurniturePlacement.tsx`): **9 pieces per culture** (v0.2 — was 5). Every culture now has a sofa, an armchair, a coffee table, a side table, a light, an ottoman and a wall console; the two gaps closed first were the ones that made a room undesignable — Khaleeji had no chair of any kind, Moroccan had no sofa. Placement is asset compositing, not inpainting, so what the user positioned is exactly what lands.
  - **Categories must use the room analyser's spelling.** `existing_categories` arrives in ADE20K's vocabulary via `ADE_TO_CATEGORY` and the recommender compares it to `category` by string equality, so a category the analyser cannot name silently never de-duplicates. `armchair`, `console` and `screen` join `lantern` and `cultural_object` in having no ADE class — they never take the duplicate penalty, which is the state the catalogue already shipped in. (ADE class 30 *is* an armchair but maps to `sofa`; remapping it would change how sofas rank in every existing room, which is not worth the nuance.) A test asserts that set is exactly those five, so a mis-spelled new category is caught rather than silently never matching.
  - **Prompt length is capped by what has already rendered, not by CLIP's limit.** `<generation_prompt>, <trigger>, <STYLE_SUFFIX>` measures 91–99 CLIP tokens for the items that rendered correctly, so ~20 tokens are already being truncated — the tail is quality boilerplate, which is survivable. A *longer* prompt would push the framing instruction "the entire object visible and centered" off the end too, and a cropped asset composites into a room as a cut-off object. The ceiling is therefore 99, enforced by a test.
  - `MAX_RESULTS = 6` in `backend/furniture.py` still caps the recommendation panel, so a 9-item culture is now a genuine ranked shortlist. `/api/furniture/catalogue?culture=…` returns all of them, unranked — that is the endpoint an agent should read.
- **RoomReport** (`src/components/RoomReport.tsx`): client-side canvas → downloadable branded PNG of before/after + ontology elements + 2D plan + provenance footer. Button lives in the `/studio` results header.
- **Evaluation dashboard** (`backend/evaluation.py` + `src/app/evaluation/page.tsx` + `src/components/EvaluationChart.tsx`): `/evaluation` (admin-only, `GET /api/admin/evaluation`) — system overview, human evaluation, automatic model evaluation, CLIP recognition matrix, evaluation coverage, LoRA-vs-baseline ablation, recent feedback. **Every section takes the same `culture` + `since`/`until`, applied in SQL**, and the page renders what comes back rather than narrowing anything itself: an average cannot be filtered after it has been taken. All history-derived queries are built from one helper, `db._history_filters`, which is what makes "the KPI cards, the metrics and the matrix are reading the same population" checkable rather than hoped for. Ratings come from `db.feedback_stats` / `feedback_by_culture` / `list_feedback`, which now take the culture too.
  - **Two populations, both named.** `roomsGenerated` is every saved design in the filters; every average is over `evaluableDesigns` — `IsEdited = 0 AND IsLight = 0`. `history.IsLight` marks a `DARDESIGN_LIGHT` placeholder (client reports `light`, since the renderer and the accounts backend can be different hosts): still a saved design, never a timing or model statistic, because a tint returns in milliseconds. `editedExcluded` / `lightExcluded` are returned so the arithmetic closes on screen.
  - **Coverage** (`db.evaluation_coverage`) prints SSIM/LPIPS/CLIP/ratings/timing as `n/total` over that corpus — the denominators behind the averages.
  - **Every unmeasured figure is `null` and renders as "No data", never 0** — on a 1-5 scale a zero is unreachable, so printing one would fabricate a result. "Average overall rating" is the mean of the three rated dimensions, labelled as derived (there is no Overall column). SSIM/LPIPS/CLIP each carry their reading direction, because LPIPS ↑ is a bigger change, not a worse model.
  - **`db.culture_confusion`** is the CLIP zero-shot recognition matrix (cells show count + row %), drawn from the same pipeline-only corpus and never labelled as human accuracy.
  - **Ablation — computed, not displayed.** The panel is **removed from the page** for the FYP demo: the corpus has not been rendered, so its only possible state was an empty "not generated yet" box, which reads as unfinished rather than as an honest absence. The endpoint still serves `automatic` and the typed shapes are still in `src/lib/api.ts`, so restoring it is a paste job once `eval/results.csv` exists (the component is in git history at `src/app/evaluation/page.tsx`). `automatic_metrics` splits `eval/results.csv` by its `set` column (`lora` / `baseline`) instead of pooling the arms — pooled, a LoRA row and its own baseline row landed in the same bucket. Both arms present → a metric-by-metric comparison with deltas; one arm or no file → an explicit "Ablation results not generated yet", never an invented delta. The corpus has no timestamps, so it reports `dateFilterable: false` rather than pretending the date filter applied. Charts are plain CSS bars: no charting dependency.
- **Saved designs are the evaluation dataset**: every unedited design saved to `history` is measured once — SSIM at generation time (`backend/quality.py`, numpy+scipy, matches skimage to 1e-9), then LPIPS + CLIP in a FastAPI background task after the save responds. The scores are **columns on the history row**, which is what makes deletion total: remove a design and it leaves every average and the confusion matrix in the same instant, with no side table to keep in step. `Culture` vs `PredictedCulture` *is* the confusion matrix (`db.culture_confusion()`). Designs edited by colour control or furniture placement carry `IsEdited=1` and are never measured — they are real designs but no longer the pipeline's own output. LPIPS/CLIP need `pip install lpips open_clip_torch`; without them the values stay null and `scripts/backfill_evaluation.py` fills them in later (it never overwrites a generation-time SSIM). The dashboard aggregates **all users**, not the viewer.
- **Audit trail**: `backend/audit.py` (append-only JSONL, metadata only, never raises) ← logged by `/redesign` + `/restyle`; `GET /audit` (token via `DARDESIGN_AUDIT_TOKEN`) → `/audit` page (unlinked admin table). `backend/audit.jsonl` is gitignored.
- **Ops**: root `Dockerfile` (LIGHT image on `backend/requirements-light.txt`) + `.github/workflows/ci.yml` (pytest in LIGHT + `npm run build`).

---

## Narrative layer (`src/components/story/`)

Three client components that turn data `/redesign` **already returned** into a bilingual narrative. They never fetch, generate, save, or manufacture evidence. Integrated into `/studio` on 2026-08-11 from the `sprint/story` worktree.

- **DesignStory** — eight chapters over one finished, single-culture result. Stateful actions stay as React-node slots (`save`, `history`, `report`, `designer`, `comparison`) so the story never duplicates a flow that already has an owner.
- **CultureDNA** — canonical ontology vocabulary for one culture, or an editorial synthesis of all three. `"all"` is **not** a blended backend style, a percentage mixture, or a cultural-accuracy score.
- **GenerationStory** ("Inside DAR") — a seven-chapter documentary loop. Mounted twice: during the live wait (`phase === "loading"`), and as a post-result replay on the Inside DAR tab.

**`adapters.ts` is the truth gate, and the reason this layer is safe.** `createDesignStoryData(result, culture, opts)` excludes placeholder segmentation/map/depth artifacts, never falls back to `DEMO_REGIONS`/`DEMO_MAP`, preserves genuine numeric zeroes, emits unavailable measurements as `value: null, measured: false`, and returns `null` outright when the original or the selected output is missing. Read measurements through that gate rather than off the raw response. Consequence worth expecting: in Defense Mode and LIGHT runs, **duration and SSIM correctly render as "—"** because the demo pack reports neither — that is the gate working, not a wiring bug.

Rules that are easy to violate:

- **Never pass Studio's animated `progress` as `reportedProgress`.** It is an animation curve, not telemetry. The only supported envelope is `BackendReportedProgress` with `source: "backend"`, and `/redesign` has none. The chapter clock is documentary pacing and does not estimate completion.
- Pass the culture **actually on screen** (`featured`), not `result.object_map.style` — the map describes a shared analysis artifact, not the selected output.
- `slots.report` is deliberately **not** auto-wired: `RoomReport`'s canvas footer hardcodes SDXL 1.0 + dual ControlNet + a cultural LoRA, which is not true for every runtime/culture path, and `/redesign` returns no provenance to prove it. Make that footer take real capability props first.
- `cultureData.ts` reads the canonical root `ontology/ontology.json`, while `RoomReport` and the highlighter read `src/data/ontology.json`. **Two copies — keep them in step** until they share one import.
- Unavailable facts stay absent or `null`. The components render honest empty states and em dashes; never substitute sample values for presentation.

**Layout note.** The `.module.css` files are authored to a `max-width: 1480px` measure, which the surrounding `max-w-5xl` results column would collapse (the chapter rail labels collide). `/studio` breaks the three panels out with symmetric negative `margin-inline`, clamped to `min(1480px, calc(100vw - 2rem))`. Use logical margins here, **not** the usual `left-1/2` + `-translate-x-1/2` trick: `left` resolves against the inline start, so in RTL that throws the panel hundreds of pixels off the side of the page.

Full integration contract, including the `/restyle` provenance path and the explicitly unsupported list: [src/components/story/README.md](src/components/story/README.md).

---

## Build Mode + Render with DAR (`/design`)

The loop: photo → `/redesign` → **Design it yourself** → move/add furniture, change materials → **Render with DAR** → a photoreal result conditioned on the composed scene.

**The room arrives already understood — that is the whole point.** Build Mode does not open on an empty grid. `deriveRoom()` backs a floor area out of `room_analysis` (`free_floor_m2 / free_floor_of_floor`) and reconstructs `object_map` footprints as **locked `found` massing**, so you continue designing *your* room. `shellSource` is `measured` / `estimated` / `default` and the header chip says which — a default room is never presented as a measurement.

- **Units are centimetres everywhere**, Y up, floor centred on the origin. A `DesignScene` is a plain serializable object: no class instances, no `THREE.*`. That is what makes persistence, undo/redo and the render hand-off the same problem.
- **Undo/redo is snapshot-based with gesture coalescing** (`beginGesture`/`endGesture`), so a 200-frame drag is one history entry. Scenes persist to `localStorage` keyed by job id.
- **Placement has two tiers, and conflating them made the editor feel broken.** *Blocking* = physics the user cannot mean (out of bounds; inside a piece they placed). *Advisory* = judgement (standing a sofa where the photo found the old one; `must_touch_wall`). Advisories are stated in amber and **never refuse the drop** — replacing existing furniture is the most likely act of redesign. Collision is oriented-rectangle SAT, so a sofa rotated into a corner is judged correctly.
- **Found objects are locked** by default: they describe the room as it is, so moving one silently turns a measurement into a fiction. The `N found` chip is also the layer toggle; hiding never changes collision.
- **Furniture is procedural geometry at real ontology dimensions.** The cut-out PNGs appear in the catalogue rail and nowhere else — a billboarded photo among lit volumes reads as a sticker the moment the camera moves. The look is a deliberate architect's maquette, which also means DAR never implies it rendered something it did not.

### Render with DAR

**The conditioning strategy came from reading the pipeline, not from inventing one.** `backend/transform.py` already runs SDXL with a **dual ControlNet — Depth Anything depth + ADE20K-palette OneFormer segmentation** — normally derived from the photograph. Those two images *are* the layout signal, so Build Mode renders depth and segmentation **from the 3D scene** and substitutes them. Layout stops being something the model infers from a sentence and becomes something it is conditioned on.

- `scene3d.renderConditioning(w, h)` captures three offscreen passes: beauty (for the evidence strip), linear depth, and flat ADE20K segmentation.
- **`src/lib/design/ade20k.ts` is generated from the backend's own palette and class table.** The seg ControlNet only understands those exact colours, so a hand-transcription slip would degrade conditioning *silently* rather than erroring. Regenerate it rather than editing it.
- Three bugs that only surfaced by **measuring the captured pixels**, not looking at them: ACES tone mapping shifted the palette (wall `120`→`129`, lamp `224,255,8`→`187,189,40`) so both conditioning passes force `NoToneMapping` + `LinearEncoding`; the camera-facing walls, faded on screen, rendered **opaque** in capture and walled off the room; and the maquette framing left ~42% of the frame empty, i.e. 42% of pixels SDXL would invent (now ~16%).
- **`POST /render-scene`** takes `depth` + `seg` + `style` and reuses the ordinary cultural path — prompt builder, per-culture LoRA, sweep-winner ControlNet weights. `_generate()` gained one optional `control_override`; `None` behaves exactly as before, so **the `/redesign` path is byte-for-byte unchanged**. No model, notebook or Colab change was needed or made.
- **`"all"` collapses to Lebanese** for rendering — the generator takes one culture.

**Honesty contract (load-bearing).** The panel shows the actual conditioning images as evidence, and states the limit: *held* — placement, orientation, geometry, viewpoint, because they are the control signal; *not held* — the appearance of any individual piece, because the model invents surface and ornament inside the silhouette, and materials reach it through the prompt so they steer rather than bind. A LIGHT backend returns `placeholder: true` and the UI says **"That last image is not a real render."** There is no fake render button.

**Verified without a GPU** (instrumented, not assumed): `control_override` is passed; depth and seg arrive at full size with correct ADE20K classes; `use_lora=True` with the selected culture; and **`_prepare_conditioning` is called 0 times — no silent fallback to photo-derived annotators.** Segmentation output is pixel-exact against the backend palette.

**Verified end-to-end on a real GPU (2026-08-13).** Against a live render host (`/healthz` → `light_mode: false`), a Build Mode scene — 10 `found` objects from a real `object_map` plus 3 user-placed Khaleeji pieces — captured its conditioning and came back as a genuine render in **35.61 s**. The path works: `control_override` reaches the pipeline, both control images arrive, and no photo-derived annotator runs.

That first render read as a wooden-screen storage room rather than a majlis, which confirmed the doll's-house diagnosis below. **The capture camera was then rebuilt, and the same scene re-rendered as a believable room** (2026-08-13, A/B on the identical 13-object scene restored from `localStorage`).

**The camera was the root cause, and it is fixed.** The capture used to clone the on-screen orbit camera: *outside* the room, ~30° above horizontal, 38° FOV. SDXL and both ControlNets were trained on interior photographs made from inside rooms at eye height with a wide lens, so every capture handed them a viewpoint no camera could occupy. `renderConditioning` now builds its own camera — inside the room, `CAPTURE_EYE_Y` 155 cm, `CAPTURE_FOV_DEG` 54 (a ~24mm interior lens), standing `CAPTURE_WALL_CLEARANCE` off the back wall. It keeps only the user's **azimuth**, the part that carries which way they were facing; the editor camera is untouched. Two consequences followed from being inside:

- **All four walls now stay.** The exterior camera had to hide the walls it looked through, so the generator got a room with holes where its corners belonged. From inside, the near wall is simply behind the lens and the frame closes itself.
- **A capture-only ceiling** in the real `ADE20K_CEILING` class, because an open top reads as sky from inside. Verified pixel-exact in the seg output: ceiling `120,120,80`, wall `120,120,120`.

**Two follow-on defects, both found by measuring the conditioning and both fixed.**

1. **A cushion the width of the room.** The segmenter finds every cushion along a bench and the projection merges the run into ONE footprint, so the demo majlis produced a `cushion` **520 × 142 × 75 cm** — the full room width, extruded solid, 33.8% of the floor, sitting on top of the two sofas it belongs to. `roomModel.ts` already drops wall-mounted classes for exactly this reason ("a painting standing in the middle of the room"); `ON_FURNITURE_CLASSES` now does the same for `cushion`/`pillow`. Found floor coverage **69.6% → 35.8%**, and seg `table` class **23.7% → 3.3%**.
2. **The camera stood inside the sofa.** A fixed stand-off works in an empty room and fails in a furnished one — with a planned majlis the seating runs along the very wall the lens backs onto, and one slatted screen filled the whole frame. The capture now walks in from the wall and stops at the first spot clear of every object's world bounds by `CAPTURE_BODY_CM`, falling back to the old position if the room is too full.

**Verification status, precisely.** The interior camera is GPU-verified (the 34.8s render above). The cushion and camera-occupancy fixes are verified **in the conditioning only** — measured class shares and an inspected beauty pass showing a proper corner view with clear centre floor — because the render tunnel expired before they could be re-rendered. **Re-run one Render with DAR when a GPU host is next up.**

**Still not claimed:** layout-preservation *quality* is unmeasured — there is no side-by-side study, and a handful of renders is an observation, not a result.

---

## Design Planner (`/design` → "Describe your room")

Empty room → the user writes what they want → an LLM plans the furniture → it appears in Build Mode → they edit it → **Render with DAR**. Added 2026-08-12.

The model also **reads the brief**: one call returns an `understood` block (culture, room type, capacity, cultural intensity, wall/floor material, requirements, requested pieces) beside the placements. There is deliberately no separate "interpret, then plan" round trip — it would double latency and cost for information the one response already carries.

**Every field in `understood` is validated against a vocabulary DAR already owns**, so nothing in it is free text: `roomType` is `prompt_builder.py`'s own `room_ar_map` keys, `intensity` is the `/restyle` `scale` with the same 0–1 clamp, and wall/floor are `materials.ts`'s `WALL_CHOICES`/`FLOOR_CHOICES`. An unknown value becomes `null`, never a plausible guess, and `null` always means "not said — leave the room alone".

**Colour intent goes to Build Mode materials, never to Colour Control.** `/api/color/*` repaints a **finished PNG** and needs a `job_id`, a rendered image and the cached segmentation from a `/redesign` pass; a Build Mode scene that was never rendered has none of those. The scene's real colour system is `RoomShell.wallMaterialKey`/`floorMaterialKey` via `setShellMaterial`. Two systems, no overlap — do not wire them together.

**Capacity is DAR's arithmetic, not the model's claim.** The ontology has no seat counts, so `seats_of()` derives them from real widths (a sofa seats `width / 60`, an armchair/chair/pouf seats one) and the panel prints *"Seats about 6"* as an estimate. When the plan falls short of a requested capacity the panel says so (*"· 6 asked for"*) instead of quietly claiming success.

**The model is a design planner, never a renderer and never a source of facts.** It picks pieces from the cultural catalogue and proposes where they stand. It emits **no dimensions at all** — those come from `ontology/furniture.json`. Six gates, each one a place a hallucination dies:

1. **Closed vocabulary.** `catalogId` is a JSON-Schema `enum` of exactly that culture's 9 ids, so structured outputs (`output_config.format`) make an invented id *unrepresentable*, not merely unlikely.
2. **No invented dimensions.** Sizes come from the catalogue via `catalogItem(id)`.
3. **Backend validation** (`validate_items`): unknown id, non-finite or absurd coordinate, unknown material → dropped **and reported**, never quietly rounded into something plausible.
4. **Client re-validation** (`src/lib/design/planner.ts` → `gatePlan`): every placement runs `evaluatePlacement()`, the same oriented-rect SAT that colours the drag ghost and refuses a human drop. Blocking → one repair attempt through `findSpot` → else dropped. Items are validated **in order against the scene as it is being built**, so the second piece is judged against the first.
5. **Advisory verdicts still pass.** Standing a sofa where the photo found the old one is the most likely act of redesign.
6. **Culture coherence.** The model is handed all 27 pieces (it cannot know the culture before reading the brief, and a second call to find out is not worth it), so it can also *mix* them. Any item whose culture ≠ `understood.culture` is dropped and named. One room, one culture, unless "all" was asked for.

**Openings are enforced, not requested.** `WallOpening` already existed but only `DesignCanvas` ever saw it; it is now threaded to the planner as prompt facts *and* checked deterministically in `gatePlan` — a door gets a 90 cm keep-clear zone (window 40 cm), derived exactly as `scene3d.ts:280-302` positions the opening. A piece landing in one gets a `findSpot` repair, then is kept with a visible advisory. **Advisory, not blocking**: standing near a door is judgement, not physics. With no handoff `openings` is `[]`, and the panel says *"No door or window detected"* rather than implying knowledge. Opening heights are constant priors (door 210 / window 140) and are never presented as measured.

Rules that are easy to violate:

- **`format` and `effort` are sibling keys inside ONE `output_config`.** Two separate `output_config` kwargs silently overwrite each other. Pinned by `test_format_and_effort_are_siblings_in_one_output_config`.
- **Apply a plan with `beginGesture` → N × `addAt` → `endGesture`, never `replace`.** `replace` wipes `undo`/`redo` (`store.ts:301-309`), so an AI plan would be unundoable. Gestures collapse N adds into one entry — **one Ctrl+Z removes the whole plan**, wall and floor materials included (verified: 4 objects + 2 materials → 0 in one undo).
- **`scene.culture` is deliberately never changed by a plan**, even when the brief asks for a different culture. Switching it goes through `setCulture`, which dispatches `replace` and would wipe history mid-gesture. The plan expresses culture through the pieces it places and the shell materials it sets — which is what is actually visible.
- **Cultural intensity and room type live in page state (`renderIntent`), not in `DesignScene`.** A new scene field bumps `SCENE_VERSION`, and `loadScene` silently drops any scene whose version does not match — i.e. it would throw away every room a user had saved. From there `roomType` reaches `/render-scene`'s existing `room` param (it was hardcoded `"living room"`) and `intensity` its new optional `scale`, which is a pass-through to the `lora_scale` `render_scene()` already accepted. **Omitted, the render path is byte-for-byte what it was** — the same discipline as `control_override`.
- `addAt` takes an optional `materialKey` (added for this feature); omitted, the ontology's own default for the piece stands.
- The planner endpoint is on **`DATA_API_URL`, not `API_URL`** — the model key belongs on a machine the user controls, never on a throwaway Kaggle GPU container. It is also **behind `_require_user`**, because every call spends real money.
- The room rectangle is **sent by the client**. `RoomAnalysis.summary()` returns no width/depth/height at all — only `free_floor_m2` and ratios. `deriveRoom()` backs the rectangle out client-side.

**Unconfigured is a working mode** (the `mailer.py` precedent). With no `ANTHROPIC_API_KEY`, a provider error, or the per-process call cap reached, `fallback_plan()` returns a deterministic rule-based layout tagged `source: "rules"` and the UI badge says **"Planned by DAR's rules"** instead of naming a model. CI and the tests run that path, so the feature is never dark. This is not theoretical — it was first exercised against a real `400 credit balance too low`, and the user still got a furnished room.

**Cost.** The catalogue is 9 items per culture, so a plan is ~1k tokens in / ~1.5k out — about $0.02 on `claude-sonnet-5` (the default; `DARDESIGN_LLM_MODEL` overrides). Do **not** send `furniture.json` wholesale (9.4k tokens); `catalogue_projection()` is the compact view. **Prompt caching is deliberately unused** — the minimum cacheable prefix is 1024 tokens on Sonnet 5 and 4096 on Haiku 4.5, so a prompt this small would silently fail to cache and pay the write premium for nothing. An in-process response cache keyed on `sha256(room + culture + normalised brief)` makes a repeated demo free, and `MAX_CALLS_PER_PROCESS = 200` bounds a runaway loop.

Config: `.dardesign-llm` (gitignored; template in `.dardesign-llm.example`), loaded by `run-local-backend.ps1` exactly like `.dardesign-smtp`. Tests: [tests/test_design_planner.py](tests/test_design_planner.py) — 25 tests, **no live API calls**, fake client injected via `plan(..., client=…)`.

---

## Cultural RAG (`backend/knowledge.py` + `backend/retrieval.py`)

Retrieval-Augmented Generation in front of the Design Planner, so the model designs **with evidence** rather than from pretrained memory. Added 2026-08-14.

```
brief → detect culture + room → retrieve top-k cultural chunks → planner prompt
      → LLM plans → validate_items → gatePlan → Build Mode → Render with DAR
```

**The division of labour is the whole architecture, and it is what keeps the feature honest:** RAG = cultural knowledge · the LLM = design reasoning · the catalogue/ontology = allowed vocabulary · the placement engine = spatial truth. RAG **never** names a catalogue id, states a dimension, or proposes a coordinate — a test asserts that no chunk contains any of them.

**A chunk is assembled at load time, never stored.** Three files own one layer each, joined rather than copied, because CLAUDE.md already records the pain of `ontology.json` existing in two places and a knowledge base that re-stated the terms would be a third copy:

| file | layer |
|---|---|
| `ontology/ontology.json` | canonical bilingual vocabulary — term, Arabic, `weight`, `verified`, `hex` |
| `ontology/sources.md` | public citations, for the minority of terms that have one |
| `ontology/knowledge/<culture>.json` | the editorial layer — how to *use* the element, how it is misused, which rooms suit it, and alias words a person might type |

The consequence worth knowing: **the day Zainab flips Lebanese to `verified: true`, the evidence becomes verified with no edit to any code.**

**Three evidence states, never collapsed to a boolean.** `verified-cited` · `verified` · `unverified`. As of writing **Khaleeji and Moroccan are 30/30 verified, Lebanese is 0/30**, and only **6 of 30 terms per culture carry a citation**. That asymmetry is a real fact about the project, reported rather than smoothed over — a Lebanese plan shows "unverified" labels in the panel and says `UNVERIFIED` in the prompt, and it should. Persian is deliberately **absent** from the KB (0/23 verified, no LoRA); offering it as cultural evidence would overstate what DAR has.

**Retrieval is lexical BM25, not sentence embeddings.** This was a decision, not a shortcut:

1. **CI installs `requirements-light.txt` alone** — no `sentence-transformers`, no `torch`, no `sklearn`. Embedding a *query* needs the model at runtime, so no amount of precomputing the corpus avoids a ~470MB download. "Tests stay green and the feature is free" and "the retriever needs a model download" cannot both be true.
2. **The corpus is already a parallel en/ar dictionary**, so each chunk's retrieval surface carries both languages and an Arabic query reaches the Arabic surface of the same chunk with no translation step. On a closed vocabulary of craft proper nouns this is the *better* signal, not a compromise.
3. **It is inspectable**, which is the point of the feature — a scored token match can be shown and argued about in a defence; a cosine distance cannot.

`score_chunks` is the only place similarity is computed, so going dense later means replacing one function.

Traps that are easy to reintroduce:

- **Stopwords are load-bearing, not tidiness.** Once real prose entered the corpus, `"hello how are you"` scored five chunks because "you" appears in a sentence about keeping a liwan's floor clear. BM25's IDF damps a common term but cannot zero it across ~35 documents per culture.
- **Arabic proclitics must be stripped or half the Arabic briefs miss.** `بزليج` is `بـ` + `زليج`; without light stemming a brief asking for zellige retrieves none. Strip identically on documents and queries — consistent over-stripping is harmless, asymmetric stemming is the bug.
- **A negation in the brief does not filter the corpus.** *"Lebanese bedroom with no arches"* retrieves arch knowledge **on purpose**: RAG supplies what the culture is, the brief supplies the constraint, the planner reconciles them. Filtering on a negation would make the retriever a second designer.
- **`evidenceMeta.injected` is the honesty flag.** Retrieval is local and free so it runs on every path, but only the model path *designs* with it. A rule-based plan reports evidence with `injected: false` and the panel says "not used by this plan" — never claim an influence that did not happen.
- **`build_user_message` must stay byte-identical with no evidence.** A test asserts it. That is what makes the no-evidence path a genuine fallback rather than a second prompt that resembles the first — same discipline as `control_override` in `transform.py`.
- **`DARDESIGN_RAG=0`** disables retrieval and is in the cache key, so toggling it cannot serve the other mode's plan.

**Cost: zero.** Local BM25 over ~105 chunks, microseconds, no second model call. The evidence block adds roughly 300–600 tokens to a prompt that was already ~1k.

Evaluation: **`python scripts/rag_eval.py`** (add `--prompt` to print the block the planner receives) — 11 briefs across both languages, each with a written expectation, printing every retrieved chunk with score and citation. Tests: [tests/test_cultural_rag.py](tests/test_cultural_rag.py) — 69 tests, no network, including `test_evidence_reaches_the_model_prompt`, which reads the prompt the fake provider was handed and finds the top-scoring element inside it.

---

## Plans and the weekly allowance

- **Two plans, one flag.** `users.IsSubscribed` *is* the plan: 0 = **Basic** (free, 3 designs/week), 1 = **Pro** ($20, 30 days, unlimited). Policy lives in [backend/subscriptions.py](backend/subscriptions.py) (`PRO_PRICE_USD`, `PRO_DURATION_DAYS`, `BASIC_WEEKLY_LIMIT`, `USAGE_WINDOW_SECONDS`); `db.py` holds only the storage and is handed every number, so the limit changes in one place and the schema has no opinion about it. `/api/subscription` ships `terms` to the client, so the price on the page cannot drift from the price enforced.
- **Nobody subscribes themselves.** "Subscribe" writes a `subscription_requests` row and returns the user's *unchanged* plan; only `POST /api/admin/subscriptions/{id}/decision` sets `IsSubscribed`, `PlanStartedAt` and `PlanExpiryDate = now + 30d`, in one transaction with the verdict. A partial unique index (`Status = 'pending'`) makes "one open request per user" a property of the data, and a decided request 409s rather than granting a second 30 days. **Unsubscribing is the user's own** and is immediate — an admin gates who *gains* a paid plan, not who gives one up.
- **The counter is weekly and resets lazily.** `NumberOfUses` is spent generations inside the window opened at `UsageWindowStart`; a window older than 7 days is replaced (counter to 0) on the next generation, so "3 per week" holds even on a backend that has been down for a month. Pro increments the counter too but is never blocked by it, and returning to Basic (cancel *or* expiry) clears the window — Pro-era generations must not eat into the free week the user drops back into.
- **`POST /api/usage/consume` is the gate**, called by `/studio` immediately before `/redesign`. It reads, decides and increments under one lock in one transaction, so two tabs cannot both spend the third use. It is a separate endpoint rather than a check inside `/redesign` because renders and accounts can be **different backends** (`NEXT_PUBLIC_DATA_API_URL`): the GPU host has no users table and is sent no session cookie. The studio therefore fails *closed* on `quota_exceeded`/`not_authenticated` and *open* on anything else — an unreachable accounts backend is not the user's overspend. A use is spent when a generation starts; there is deliberately no refund endpoint, since any client could call it after every render.
- **Daily expiry service**: `subscriptions.start_expiry_service()` (daemon thread, same shape as the TTL sweeper) runs `db.expire_subscriptions()` every 24h from the FastAPI lifespan — one UPDATE returning every plan past its date to Basic. It sweeps **once at startup**, so a backend that was down over an expiry date catches up on boot; the interval only decides how promptly an expired plan is noticed, never whether it is.
- **Decision emails** ([backend/mailer.py](backend/mailer.py)): approving or declining mails the user the verdict — *"Your subscription to the Pro plan has been accepted/declined."* plus the Arabic, the expiry date on an approval and the weekly limit on a decline. Stdlib `smtplib`, no dependency, plain text. Queued as a **FastAPI background task after the response**, and `send()` returns a bool instead of raising: the admin approved the plan, so the plan is approved — a mail server that is down costs the notification, never the decision. Only a decision that actually landed queues a mail, so the 409 on a re-decided request cannot send a second one. **Unconfigured is a working mode**: with no `DARDESIGN_SMTP_HOST` the whole message is written to the log, so the demo and the tests need no mail account. Config via `DARDESIGN_SMTP_*` (locally: a gitignored `.dardesign-smtp`, loaded by `run-local-backend.ps1`; template in `.dardesign-smtp.example`). Tests: [tests/test_email.py](tests/test_email.py).
- **Pages**: `/subscription` (both plans, current usage, subscribe/unsubscribe, pending-request banner), `/admin/subscriptions` — *Manage Subscriptions*, the approve/decline queue — and `/admin/users` — *Users*, every account with its plan and when it starts and ends. All three are linked from the app sidebar; the two admin ones are hidden from non-admins as a convenience only, since every `/api/admin/*` endpoint checks the role server-side. `db.list_users` names its columns, so the password hash never leaves the database. Basic accounts print "—" for plan dates, never today's date. Tests: [tests/test_subscriptions.py](tests/test_subscriptions.py).

---

## LoRA training (Kaggle T4)

- **`scripts/train_lora.py`** trains a per-culture SDXL LoRA. The recipe that fits a 16 GB T4 *without* NaN: **cache image latents + text embeddings once** (fp16 VAE/text encoders), free them, then train only the **fp32-master UNet + LoRA** with `autocast(fp16)` + `GradScaler`. Loading the frozen base in fp32 OOMs; in fp16 it NaNs (SDXL fp16 overflow) — the caching is what makes it both fit *and* stay stable.
- **Runs on Kaggle T4 only** — the Kaggle API grants a P100 (sm_60), which can't run SDXL fp16; you must select **GPU T4 x2** in the Kaggle UI and "Save & Run All (Commit)". Dataset = `datasets/<culture>/{images,captions.jsonl}`, uploaded to the private Kaggle dataset `yasserhamdanfr/dardesign-culture-datasets`.
- Output → `models/loras/<culture>/dardesign-<culture>-lora.safetensors` (+ checkpoints at 500/1000/1500). The backend lazy-loads it from `models/loras/<culture>/` — no code change. **Lebanese is trained** (hero, 19 imgs); Khaleeji/Moroccan (12–14 imgs) are prompt-only-acceptable per the cut order.
- **Deployed Lebanese checkpoint is step1500**, verified by hash (2026-08-02): `_save_checkpoint` copies *every* checkpoint over the canonical filename, so the last one written (step1500) is what `dardesign-lebanese-lora.safetensors` contains — the step1000 pick described in `kaggle/TRAIN_NOW.md` §3 was never applied. Kept deliberately: step1500 generalises across different input rooms in practice, so the "1500 may be baked-in" note was a pre-render precaution, not an observed failure. No side-by-side step1000-vs-1500 comparison has been run — don't claim one.
- `kaggle/TRAIN_NOW.md` = paste-into-cell runbook; `push_kernel.py` (repo root) pushes a self-contained training kernel via the Kaggle REST API (KGAT bearer token — the old `kaggle` CLI can't read it).

---

## UI / Frontend tooling

MCP servers configured for this project (see `.mcp.json` for project scope, `~/.claude.json` for user scope).

- **Chrome DevTools** (`mcp__chrome-devtools__*`, user scope) — inspect the *rendered* app rather than guessing from source. Use it to read the DOM, the console, computed CSS, network activity, and to run performance/accessibility checks. After any meaningful visual change, verify it in Chrome at the relevant viewport and check the console for errors. It launches its own Chrome profile (`~/.cache/chrome-devtools-mcp/`), so it does not touch personal browsing; keep it pointed at `localhost` unless told otherwise.
- **Context7** (`mcp__plugin_context7_context7__*`, user scope) — fetch *current* framework/library documentation instead of relying on model memory. Use whenever Next.js, React, Tailwind, or three.js behaviour matters.
- **shadcn** (`mcp__shadcn__*`, project scope) — discover robust, accessible primitives. The registry tools need the registry passed explicitly (`registries: ["@shadcn"]`); they do not auto-resolve it.
- **Figma** (`mcp__figma__*`, user scope) — use when working from approved design-system or design context.

Rules:

- Preserve DarDesign's custom architectural/cinematic identity. Do **not** turn it into a generic shadcn/SaaS template.
- Never install a component or major dependency just because a registry offers it — first show that it improves on what exists.
- The theme is driven entirely by CSS variables under `[data-theme]`; there are **no Tailwind `dark:` utilities** and `tailwind.config.ts` sets no `darkMode`. Adding a `dark:` class would silently follow the OS setting rather than the app toggle. Stay with the CSS-variable system.
- `--ink` means *page background* in `cinema.css` but *text colour* in `dar-cinema.css`; the latter is scoped under `.dar-cinema`. Keep that scoping intact.
<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
