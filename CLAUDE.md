# CLAUDE.md — DarDesign Project Reference

## Project Overview

**DarDesign** is a bilingual (English/Arabic) AI interior design web app. Users upload a room photo, choose an Arabic architectural style (Lebanese, Khaleeji, or Moroccan), and get an AI-generated redesign. The app has a gold-on-dark luxury aesthetic with full RTL support.

**Stack:** Next.js 14 App Router, React 18, TypeScript 5, Tailwind CSS 3.4, shadcn/ui (radix-nova style), Lucide icons

---

## Commands

```bash
npm run dev       # Start dev server (localhost:3000)
npm run build     # Production build — must pass with zero errors
npm run start     # Serve production build
npm run lint      # ESLint check
```

---

## File Structure

```
src/
├── app/
│   ├── globals.css              # All CSS variables, themes, animations, utility classes (~548 lines)
│   ├── layout.tsx               # Root layout — fonts (Tajawal, Reem Kufi, Noto Kufi, Amiri, Inter, DM Sans, JetBrains Mono); imports cinema.css + dar-cinema.css; both providers, <html> defaults
│   ├── page.tsx                 # Home — thin wrapper that renders <DarCinema /> from src/components/dar/                                             
│   ├── transform/page.tsx       # Upload + style selection page
│   └── result/page.tsx          # Loading animation + before/after slider
├── components/
│   ├── ui/                      # shadcn primitives (button, card, badge, separator, switch, dropdown-menu)
│   ├── dar/                     # DarCinema — the DEFAULT cinematic RTL landing (Claude Design handoff), scoped under .dar-cinema
│   │   ├── DarCinema.tsx         # 5-scene scrollytelling: intro bloom → threshold tunnel (scroll 3D) → 3D scan → souls carousel → orbit room → provenance
│   │   └── dar-cinema.css        # ~180 lines, scoped under .dar-cinema (warm charcoal/gold v2 tokens, Reem Kufi + Tajawal, dark/light toggle)
│   ├── cinema/                  # Shared cinematic chrome for /studio + error + 404 only (CinemaChrome, ArchCanvas, DissolveCanvas, DustLayer, copy, hooks, cinema.css)
│   ├── islamic-pattern.tsx      # Decorative 8-pointed star repeating SVG background
│   ├── gold-button.tsx          # Primary CTA — renders as <Link> or <button>
│   ├── upload-zone.tsx          # Drag-and-drop image upload with preview
│   ├── style-card.tsx           # Single style option card with radio indicator
│   ├── style-selector.tsx       # Grid of 3 StyleCards
│   ├── loading-screen.tsx       # 8s loading animation with spinning star + progress bar
│   ├── error-banner.tsx         # Bilingual error display + retry CTA
│   ├── share-dialog.tsx         # Copy-to-clipboard share modal
│   └── before-after-slider.tsx  # Draggable clip-path image comparison slider
├── context/
│   ├── ThemeLanguageContext.tsx  # Language (EN/AR), theme (dark/light), all translations
│   └── ImageContext.tsx          # Cross-page state: uploaded image + selected style + jobId
└── lib/
    ├── api.ts                   # Typed backend client (uploadImage, startTransform, pollStatus, …)
    └── utils.ts                 # cn() utility (clsx + tailwind-merge)
```

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
| `/transform` | Upload room photo + select style |
| `/result?jobId=…&style=…` | Live progress polling → before/after slider, download, share, try-another-style |

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
| `.style-card-base` | Base style card with surface bg + border |
| `.style-card-selected` | Gold border + glow shadow on selected card |
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

---

## Component API Reference

### GoldButton
```tsx
<GoldButton href="/transform" disabled={false} className="" onClick={fn}>
  Label
</GoldButton>
```
Renders `<Link>` when `href` provided (and not disabled), otherwise `<button>`.

### UploadZone
```tsx
<UploadZone
  onImageSelect={(file: File) => void}
  imagePreviewUrl={string | null}
  onRemove={() => void}
/>
```
Validates: image type + max 10MB. Shows preview with remove button when image is set.

### StyleCard
```tsx
<StyleCard
  id="lebanese" flag="🇱🇧" name="Lebanese" description="..."
  selected={boolean} onSelect={(id) => void}
/>
```

### StyleSelector
```tsx
<StyleSelector
  selectedStyle={string | null}
  onStyleSelect={(style: string) => void}
/>
```
Renders 3 cards from `styleOrder` array. Pulls copy from `copy.shared.styles[styleId]`.

### LoadingScreen
```tsx
<LoadingScreen onComplete={() => void} />
```
8-second animation. Calls `onComplete` after timeout. Cycles through `copy.loading.messages` every 2.5s.

### BeforeAfterSlider
```tsx
<BeforeAfterSlider
  beforeSrc={string} afterSrc={string}
  beforeLabel="Before" afterLabel="After"
/>
```
Draggable comparison slider using `clip-path: inset()`. Supports mouse + touch. RTL-aware labels.

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

| ID | Flag | English Name | Arabic Name |
|----|------|-------------|-------------|
| `lebanese` | 🇱🇧 | Lebanese | لبناني |
| `khaleeji` | 🇦🇪 | Khaleeji | خليجي |
| `moroccan` | 🇲🇦 | Moroccan | مغربي |

Each style has: `flag`, `name`, `selectorDescription`, `origin`, `landingDescription`, `tags[]`, `learnMore` — defined in both EN and AR translations.

A 4th culture, `persian` (فارسي), is **prompt-only** and restyle-only — it exists in the backend `StylePack`/ontology and the intensity slider, but not in the core `StyleId`, `/redesign`, or the landing copy.

---

## Known Decisions

- **Backend lives in [backend/](backend/):** FastAPI service with `/upload`, `/transform`, `/status`, `/result`, `/retry`, `/share`. Real SDXL + dual ControlNet pipeline in [backend/transform.py](backend/transform.py). Set `DARDESIGN_LIGHT=1` for placeholder-PNG mode without a GPU.
- **No localStorage:** Theme and language state reset on page reload (context-only persistence).
- **No next/image:** Using `<img>` elements because blob URLs and SVG data URIs are incompatible with Next.js image optimization. ESLint warnings for this are expected.
- **All client components:** Every page and component uses `"use client"` since they depend on context providers.

---

## Studio flow + `/redesign` (Week 1 wiring)

Demo path: `/` (DarCinema landing, CTA → `/studio`) → **`/studio`** (upload → all three redesigns).

- **`POST /redesign`** (synchronous, ~1–2 min): multipart `file`; returns `{ original, lebanese, khaleeji, moroccan }` as base64 PNG **data URLs**, plus `object_map` (top-down projection), `seg_regions` (on-image highlighter bboxes from `seg_bounding_boxes()` in `backend/projection.py`), and `depth_map` (grayscale depth PNG data URL for DepthOrbit) — all from one depth+seg pass, null on failure, `placeholder: true` in LIGHT mode. Client = `redesignRoom()` in `src/lib/api.ts` (≥180s timeout, `AbortController`, typed bilingual errors, response-shape validation). Replaces the old async `/upload`+`/transform`+`/status`+`/result` polling flow.
- **`/studio`** (`src/app/studio/page.tsx`): drag-drop (`UploadZone`) → skeleton loading (`جارٍ التصميم…` + elapsed timer, `.dd-skeleton` shimmer) → responsive 2-col grid of original + Lebanese/Khaleeji/Moroccan, each labelled AR+EN with a per-image PNG download. Bilingual error + retry. RTL/Tajawal, gold-on-charcoal.
- **`/transform` and `/result`** are retired — they now `redirect("/studio")`.
- **CulturalElementHighlighter** (`src/components/CulturalElementHighlighter.tsx` + `src/data/ontology.json`): overlays segmentation regions (SVG + accessible hotspots) and reveals an element's Arabic term + note on click. **Wired**: real regions arrive in `/redesign`'s `seg_regions`; `DEMO_REGIONS` is the fallback for placeholder/absent data. `/studio` labels the section "(live)" when both regions and map are real.
- **Env:** `NEXT_PUBLIC_API_URL` in `.env.local` (gitignored; template in `.env.example`). The tunnel URL rotates each session — keep it swappable. **`npm run dev:tunnel <url>`** (`scripts/dev-tunnel.mjs`) is the one-command session start: writes `.env.local`, probes `/healthz`, then runs `next dev` on :3000. It hard-fails if :3000 is taken, because the backend's CORS allowlist is localhost:3000 only and Next's silent fallback to :3001 would break every `/redesign` call. Re-run with no URL to reuse the saved one.
- **RoomMap2D** (`src/components/RoomMap2D.tsx`): top-down 2D layout map — furniture footprints + door/window wall openings + AR/EN labels (from `ontology.json`), click-to-read note. **Wired**: real objects arrive in `/redesign`'s `object_map` (from `project_top_down()`); `DEMO_MAP` is the fallback.
- **DepthOrbit** (`src/components/DepthOrbit.tsx`): Tier A interactive 3D — the featured styled image displaced by `/redesign`'s `depth_map` PNG, clamped parallax orbit (three.js 0.150). Mounted in `/studio` results below the highlighter/map grid. Completes the "Understood Room" trio: how it looks (restyle) / how it's laid out (2D map) / how it feels to be in (3D orbit).
- **Persian (prompt-only 4th culture)**: in `ontology.json`, `CULTURES`, and `StylePack`, served by `/restyle` + the Style Intensity Slider only — `/redesign` loops `CORE_STYLES` (the 3 trained cultures) so demo timing/contract never change. No LoRA file → `_attach_lora`'s prompt-only fallback. Terms are `verified: false` pending Zainab's sign-off.
- **Colour Control** (`backend/recolor.py` + `backend/recolor_api.py` + `src/components/ColorControl.tsx`): recolour the **wall** or **floor** of a finished render. Not a second generation pass — a masked HSV edit on the render we already have, so hue/saturation come from the picked colour while the value channel (every shadow, highlight and bit of texture) is kept. Masks are the ones `analyze_room()` already built during `/redesign`, read from `RoomAnalysis.seg_ids` so "floor" means ADE20K floor and *not* the rug on it (`floor_mask` counts rugs as standing-room for furniture on purpose). `POST /api/color/{preview,apply,undo,reset}` + `GET /api/color/targets`; apply repoints `job.style_outputs[style]` exactly like furniture placement, so colour edits stack on furniture insertions and the existing **Save design** button stores the result as a new history row (no schema change). Mask edges are **feathered, never eroded** — eroding traces every object in the old colour, which reads as a glow. A surface covering <0.5% of the frame is reported as undetected, bilingually. CPU-only, milliseconds. In `DARDESIGN_LIGHT` the synthetic room has no ADE20K floor, so **floor recolour correctly reports "not detected"** there; wall works.
- **RoomReport** (`src/components/RoomReport.tsx`): client-side canvas → downloadable branded PNG of before/after + ontology elements + 2D plan + provenance footer. Button lives in the `/studio` results header.
- **Audit trail**: `backend/audit.py` (append-only JSONL, metadata only, never raises) ← logged by `/redesign` + `/restyle`; `GET /audit` (token via `DARDESIGN_AUDIT_TOKEN`) → `/audit` page (unlinked admin table). `backend/audit.jsonl` is gitignored.
- **Ops**: root `Dockerfile` (LIGHT image on `backend/requirements-light.txt`) + `.github/workflows/ci.yml` (pytest in LIGHT + `npm run build`).

---

## LoRA training (Kaggle T4)

- **`scripts/train_lora.py`** trains a per-culture SDXL LoRA. The recipe that fits a 16 GB T4 *without* NaN: **cache image latents + text embeddings once** (fp16 VAE/text encoders), free them, then train only the **fp32-master UNet + LoRA** with `autocast(fp16)` + `GradScaler`. Loading the frozen base in fp32 OOMs; in fp16 it NaNs (SDXL fp16 overflow) — the caching is what makes it both fit *and* stay stable.
- **Runs on Kaggle T4 only** — the Kaggle API grants a P100 (sm_60), which can't run SDXL fp16; you must select **GPU T4 x2** in the Kaggle UI and "Save & Run All (Commit)". Dataset = `datasets/<culture>/{images,captions.jsonl}`, uploaded to the private Kaggle dataset `yasserhamdanfr/dardesign-culture-datasets`.
- Output → `models/loras/<culture>/dardesign-<culture>-lora.safetensors` (+ checkpoints at 500/1000/1500). The backend lazy-loads it from `models/loras/<culture>/` — no code change. **Lebanese is trained** (hero, 19 imgs); Khaleeji/Moroccan (12–14 imgs) are prompt-only-acceptable per the cut order.
- **Deployed Lebanese checkpoint is step1500**, verified by hash (2026-08-02): `_save_checkpoint` copies *every* checkpoint over the canonical filename, so the last one written (step1500) is what `dardesign-lebanese-lora.safetensors` contains — the step1000 pick described in `kaggle/TRAIN_NOW.md` §3 was never applied. Kept deliberately: step1500 generalises across different input rooms in practice, so the "1500 may be baked-in" note was a pre-render precaution, not an observed failure. No side-by-side step1000-vs-1500 comparison has been run — don't claim one.
- `kaggle/TRAIN_NOW.md` = paste-into-cell runbook; `push_kernel.py` (repo root) pushes a self-contained training kernel via the Kaggle REST API (KGAT bearer token — the old `kaggle` CLI can't read it).
