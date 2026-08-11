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
│   ├── studio/page.tsx          # The product — upload → /redesign → reveal + six result tabs
│   └── transform|result/page.tsx # Retired — redirect("/studio") stubs only
├── components/
│   ├── ui/                      # shadcn primitives (button, card, badge, separator, switch, dropdown-menu)
│   ├── dar/                     # DarCinema — the DEFAULT cinematic RTL landing (Claude Design handoff), scoped under .dar-cinema
│   │   ├── DarCinema.tsx         # 5-scene scrollytelling: intro bloom → threshold tunnel (scroll 3D) → 3D scan → souls carousel → orbit room → provenance
│   │   └── dar-cinema.css        # ~180 lines, scoped under .dar-cinema (warm charcoal/gold v2 tokens, Reem Kufi + Tajawal, dark/light toggle)
│   ├── cinema/                  # Shared cinematic chrome for /studio + error + 404 only (CinemaChrome, ArchCanvas, DissolveCanvas, DustLayer, copy, hooks, cinema.css)
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
│   ├── gold-button.tsx          # Primary CTA — renders as <Link> or <button>
│   ├── upload-zone.tsx          # Drag-and-drop image upload with preview
│   ├── loading-screen.tsx       # 8s loading animation with spinning star + progress bar
│   ├── error-banner.tsx         # Bilingual error display + retry CTA
│   ├── share-dialog.tsx         # Copy-to-clipboard share modal
│   └── before-after-slider.tsx  # Pointer/keyboard/ARIA image comparison wipe
├── context/
│   ├── ThemeLanguageContext.tsx  # Language (EN/AR), theme (dark/light), all translations
│   └── ImageContext.tsx          # Cross-page state: uploaded image + selected style + jobId
└── lib/
    ├── api.ts                   # Typed backend client — redesignRoom/restyleRoom, colour + furniture, auth, history, subscription/usage, admin. (uploadImage/startTransform/pollStatus are the retired async flow, still exported)
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
| `/studio` | **The product.** Upload → `/redesign` → reveal wipe + six result tabs (Result · Design Story · Culture DNA · Inside DAR · Understand · Edit). `?demo=1` adds the Defense Mode strip of pre-rendered rooms. |
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

A1/A2/A3 are implemented across the app: Landing/Studio/Result carry A2 (CinemaChrome, Studio tabs, the material culture picker), and History/Others/Subscription/Admin Users/Admin Subscriptions/Login/Register carry A1's concrete patterns (hairline-only entries, diamond-shaped ratings, underline-only auth inputs, non-card subscription rows, plain hairline admin tables). Evaluation's A3 restructure (01–04 sectioning) is tracked separately below.

The `src/components/story/` narrative tabs are a **separate handoff** styled in scoped CSS modules rather than the `--dd-*`/cinema token surface. They read as A1-at-editorial-scale — numbered chapters, hairline rules, mono confined to chapter numbers and measurement values — and they honour the em-dash rule strictly (see "Narrative layer" below). They have **not** been formally reconciled against the A1/A2/A3 mockups; treat that as open rather than settled.

Known tensions in the source material itself (not yet reconciled, currently resolved in code by favoring the actual A1/A2 mockups over the context doc's prose summary): the context doc says "no glass" and "mono forbidden on nav/buttons," but the A2 mockup's own `.chrome` uses `backdrop-filter:blur`, and both A1 and A2 set `.nav`/`.btn` to the mono font. The current `CinemaChrome` scrim (`backdrop-filter: blur(8px)`, replacing an unreadable `mix-blend-mode: difference`) is a deliberate, working legibility fix — kept as-is.

**Flags retired (2026-08-10, completed).** The design context doc called national flag emoji "the single clearest thing to replace" with a material-stack + proportion-motif treatment. No flag emoji or flag-like imagery remains anywhere in the app. Studio's culture picker, the "All three" triptych, and the post-generation result tiles all render `MotifTiles[STYLE_MOTIF[id]]` (`src/components/cinema/svg/MotifTiles.tsx` — qanater for Lebanese, majlis for Khaleeji, zellige for Moroccan; the "Original" result tile keeps its house icon — it isn't a culture). The Moroccan `zellige` tile was itself rebuilt: it was a literal 5-pointed star shape, which reads as a flag emblem rather than tessellation — replaced with the design doc's own reference construction (a square + the same square rotated 45°, i.e. an 8-pointed geometric lattice, outline only, no filled star silhouette). The dead `style-card.tsx`/`style-selector.tsx` pair (unreachable — their only caller was the retired `/transform` flow) has been deleted rather than left as unused code, along with its orphaned `.style-card-base`/`.style-card-selected` CSS and `ThemeLanguageContext`'s `StyleCopy.flag` field.

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

- **Backend lives in [backend/](backend/):** FastAPI service with `/upload`, `/transform`, `/status`, `/result`, `/retry`, `/share`. Real SDXL + dual ControlNet pipeline in [backend/transform.py](backend/transform.py). Set `DARDESIGN_LIGHT=1` for placeholder-PNG mode without a GPU.
- **Theme/language persist via localStorage** (`dd-theme`, `dd-language` keys): a blocking inline script in `layout.tsx` reads them and sets `data-theme`/`lang`/`dir` on `<html>` before first paint (avoids a flash of the wrong theme), and `ThemeLanguageProvider` restores the same keys into React state on mount, gated so it can't stomp the inline script's value. Keep the storage keys in sync between the two if either changes.
- **No next/image:** Using `<img>` elements because blob URLs and SVG data URIs are incompatible with Next.js image optimization. ESLint warnings for this are expected.
- **All client components:** Every page and component uses `"use client"` since they depend on context providers.
- **Sprint worktrees are merged, not authoritative (2026-08-11).** `C:\Users\hamda\dar-designer` (`sprint/designer`) and `C:\Users\hamda\dar-story` (`sprint/story`) are `git worktree` checkouts of this repo. Both sat on the *same* commit as main with their work **uncommitted**, so `git log` showed nothing — `git -C <path> status` / `diff HEAD` is the only way to see what they hold. Their finished work (the `BeforeAfterSlider` rewrite; the whole `src/components/story/` package) now lives here. Their copies of `src/app/studio/page.tsx` are built on the **pre-overhaul baseline** and are older than this one: never copy that file across, port the hunk. `git worktree list` is the quickest way to re-check what exists.

---

## Studio flow + `/redesign` (Week 1 wiring)

Demo path: `/` (DarCinema landing, CTA → `/studio`) → **`/studio`** (upload → all three redesigns).

- **`POST /redesign`** (synchronous, ~1–2 min): multipart `file`; returns `{ original, lebanese, khaleeji, moroccan }` as base64 PNG **data URLs**, plus `object_map` (top-down projection), `seg_regions` (on-image highlighter bboxes from `seg_bounding_boxes()` in `backend/projection.py`), and `depth_map` (grayscale depth PNG data URL for DepthOrbit) — all from one depth+seg pass, null on failure, `placeholder: true` in LIGHT mode. Client = `redesignRoom()` in `src/lib/api.ts` (≥180s timeout, `AbortController`, typed bilingual errors, response-shape validation). Replaces the old async `/upload`+`/transform`+`/status`+`/result` polling flow.
- **`/studio`** (`src/app/studio/page.tsx`): drag-drop (`UploadZone`) → cinematic loading scene (indeterminate ring + measured elapsed time + scope label — **no percentage**, because `/redesign` returns once and has no intermediate state to report) → the reveal: a `BeforeAfterSlider` wipe over the featured culture, a design-directions rail, then a six-tab working area. Bilingual error + retry. RTL/Tajawal, gold-on-charcoal.
- **Result tabs** (`ResultTab` in `studio/page.tsx`): **Result** (all generated tiles + per-image download) · **Design Story** · **Culture DNA** · **Inside DAR** · **Understand** (highlighter, 2D map, DepthOrbit, narration) · **Edit** (colour, furniture, intensity). The three narrative tabs are **conditionally mounted**, not CSS-hidden like the tool tabs — `GenerationStory` runs a timed chapter loop and `DesignStory` measures natural image ratios, both of which would otherwise run offscreen. `TOOL_TABS` is what keeps the shared Understand/Edit wrapper from leaking into the narrative tabs; it is the thing to update if a tab is ever added.
- **`/transform` and `/result`** are retired — they now `redirect("/studio")`.
- **CulturalElementHighlighter** (`src/components/CulturalElementHighlighter.tsx` + `src/data/ontology.json`): overlays segmentation regions (SVG + accessible hotspots) and reveals an element's Arabic term + note on click. **Wired**: real regions arrive in `/redesign`'s `seg_regions`; `DEMO_REGIONS` is the fallback for placeholder/absent data. `/studio` labels the section "(live)" when both regions and map are real.
- **Env:** `NEXT_PUBLIC_API_URL` in `.env.local` (gitignored; template in `.env.example`). The tunnel URL rotates each session — keep it swappable. **`npm run dev:tunnel <url>`** (`scripts/dev-tunnel.mjs`) is the one-command session start: writes `.env.local`, probes `/healthz`, then runs `next dev` on :3000. It hard-fails if :3000 is taken, because the backend's CORS allowlist is localhost:3000 only and Next's silent fallback to :3001 would break every `/redesign` call. Re-run with no URL to reuse the saved one.
- **RoomMap2D** (`src/components/RoomMap2D.tsx`): top-down 2D layout map — furniture footprints + door/window wall openings + AR/EN labels (from `ontology.json`), click-to-read note. **Wired**: real objects arrive in `/redesign`'s `object_map` (from `project_top_down()`); `DEMO_MAP` is the fallback.
- **DepthOrbit** (`src/components/DepthOrbit.tsx`): Tier A interactive 3D — the featured styled image displaced by `/redesign`'s `depth_map` PNG, clamped parallax orbit (three.js 0.150). Mounted in `/studio` results below the highlighter/map grid. Completes the "Understood Room" trio: how it looks (restyle) / how it's laid out (2D map) / how it feels to be in (3D orbit).
- **Persian (prompt-only 4th culture)**: in `ontology.json`, `CULTURES`, and `StylePack`, served by `/restyle` + the Style Intensity Slider only — `/redesign` loops `CORE_STYLES` (the 3 trained cultures) so demo timing/contract never change. No LoRA file → `_attach_lora`'s prompt-only fallback. Terms are `verified: false` pending Zainab's sign-off.
- **Colour Control** (`backend/recolor.py` + `backend/recolor_api.py` + `src/components/ColorControl.tsx`): recolour the **wall** or **floor** of a finished render. Not a second generation pass — a masked HSV edit on the render we already have, so hue/saturation come from the picked colour while the value channel (every shadow, highlight and bit of texture) is kept. Masks are the ones `analyze_room()` already built during `/redesign`, read from `RoomAnalysis.seg_ids` so "floor" means ADE20K floor and *not* the rug on it (`floor_mask` counts rugs as standing-room for furniture on purpose). `POST /api/color/{preview,apply,undo,reset}` + `GET /api/color/targets`; apply repoints `job.style_outputs[style]` exactly like furniture placement, so colour edits stack on furniture insertions and the existing **Save design** button stores the result as a new history row (no schema change). Mask edges are **feathered, never eroded** — eroding traces every object in the old colour, which reads as a glow. A surface covering <0.5% of the frame is reported as undetected, bilingually. CPU-only, milliseconds. In `DARDESIGN_LIGHT` the synthetic room has no ADE20K floor, so **floor recolour correctly reports "not detected"** there; wall works.
- **RoomReport** (`src/components/RoomReport.tsx`): client-side canvas → downloadable branded PNG of before/after + ontology elements + 2D plan + provenance footer. Button lives in the `/studio` results header.
- **Evaluation dashboard** (`backend/evaluation.py` + `src/app/evaluation/page.tsx` + `src/components/EvaluationChart.tsx`): `/evaluation` (admin-only, `GET /api/admin/evaluation`) — summary cards, per-culture rating comparison, evaluation overview, recent feedback, culture + date filters. Aggregation is **reused unchanged** from `db.feedback_stats` / `feedback_by_culture` / `list_feedback`; the only new computation is generation statistics, which come from `audit.jsonl` because **no table records generations** (`history` = designs a user chose to *save*, jobs are in-memory). `light: true` placeholder runs are excluded from counts and timings and reported separately. **Every unmeasured figure is `null` and renders as "—", never 0** — on a 1-5 scale a zero is unreachable, so printing one would fabricate a result. "Average overall rating" is the mean of the three rated dimensions, labelled as derived (there is no Overall column). The Automatic-metrics section reads `eval/results.csv` (from `eval/run_metrics.py`: SSIM/LPIPS/CLIP + confusion matrix) **if it exists** and otherwise says it hasn't been computed — nothing there is ever estimated. Charts are plain CSS bars: no charting dependency.
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

## Plans and the weekly allowance

- **Two plans, one flag.** `users.IsSubscribed` *is* the plan: 0 = **Basic** (free, 3 designs/week), 1 = **Pro** ($20, 30 days, unlimited). Policy lives in [backend/subscriptions.py](backend/subscriptions.py) (`PRO_PRICE_USD`, `PRO_DURATION_DAYS`, `BASIC_WEEKLY_LIMIT`, `USAGE_WINDOW_SECONDS`); `db.py` holds only the storage and is handed every number, so the limit changes in one place and the schema has no opinion about it. `/api/subscription` ships `terms` to the client, so the price on the page cannot drift from the price enforced.
- **Nobody subscribes themselves.** "Subscribe" writes a `subscription_requests` row and returns the user's *unchanged* plan; only `POST /api/admin/subscriptions/{id}/decision` sets `IsSubscribed`, `PlanStartedAt` and `PlanExpiryDate = now + 30d`, in one transaction with the verdict. A partial unique index (`Status = 'pending'`) makes "one open request per user" a property of the data, and a decided request 409s rather than granting a second 30 days. **Unsubscribing is the user's own** and is immediate — an admin gates who *gains* a paid plan, not who gives one up.
- **The counter is weekly and resets lazily.** `NumberOfUses` is spent generations inside the window opened at `UsageWindowStart`; a window older than 7 days is replaced (counter to 0) on the next generation, so "3 per week" holds even on a backend that has been down for a month. Pro increments the counter too but is never blocked by it, and returning to Basic (cancel *or* expiry) clears the window — Pro-era generations must not eat into the free week the user drops back into.
- **`POST /api/usage/consume` is the gate**, called by `/studio` immediately before `/redesign`. It reads, decides and increments under one lock in one transaction, so two tabs cannot both spend the third use. It is a separate endpoint rather than a check inside `/redesign` because renders and accounts can be **different backends** (`NEXT_PUBLIC_DATA_API_URL`): the GPU host has no users table and is sent no session cookie. The studio therefore fails *closed* on `quota_exceeded`/`not_authenticated` and *open* on anything else — an unreachable accounts backend is not the user's overspend. A use is spent when a generation starts; there is deliberately no refund endpoint, since any client could call it after every render.
- **Daily expiry service**: `subscriptions.start_expiry_service()` (daemon thread, same shape as the TTL sweeper) runs `db.expire_subscriptions()` every 24h from the FastAPI lifespan — one UPDATE returning every plan past its date to Basic. It sweeps **once at startup**, so a backend that was down over an expiry date catches up on boot; the interval only decides how promptly an expired plan is noticed, never whether it is.
- **Decision emails** ([backend/mailer.py](backend/mailer.py)): approving or declining mails the user the verdict — *"Your subscription to the Pro plan has been accepted/declined."* plus the Arabic, the expiry date on an approval and the weekly limit on a decline. Stdlib `smtplib`, no dependency, plain text. Queued as a **FastAPI background task after the response**, and `send()` returns a bool instead of raising: the admin approved the plan, so the plan is approved — a mail server that is down costs the notification, never the decision. Only a decision that actually landed queues a mail, so the 409 on a re-decided request cannot send a second one. **Unconfigured is a working mode**: with no `DARDESIGN_SMTP_HOST` the whole message is written to the log, so the demo and the tests need no mail account. Config via `DARDESIGN_SMTP_*` (locally: a gitignored `.dardesign-smtp`, loaded by `run-local-backend.ps1`; template in `.dardesign-smtp.example`). Tests: [tests/test_email.py](tests/test_email.py).
- **Pages**: `/subscription` (both plans, current usage, subscribe/unsubscribe, pending-request banner), `/admin/subscriptions` — *Manage Subscriptions*, the approve/decline queue — and `/admin/users` — *Users*, every account with its plan and when it starts and ends. All three are linked from `CinemaChrome`; the two admin ones are hidden from non-admins as a convenience only, since every `/api/admin/*` endpoint checks the role server-side. `db.list_users` names its columns, so the password hash never leaves the database. Basic accounts print "—" for plan dates, never today's date. Tests: [tests/test_subscriptions.py](tests/test_subscriptions.py).

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
