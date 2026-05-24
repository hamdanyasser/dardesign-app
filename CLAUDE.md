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
│   ├── layout.tsx               # Root layout — 5 fonts (Inter, DM Sans, Noto Kufi Arabic, Tajawal, Cormorant Garamond), both providers, <html> defaults
│   ├── page.tsx                 # Home — thin wrapper that renders <AtelierApp /> from src/components/atelier/
│   ├── transform/page.tsx       # Upload + style selection page
│   └── result/page.tsx          # Loading animation + before/after slider
├── components/
│   ├── ui/                      # shadcn primitives (button, card, badge, separator, switch, dropdown-menu)
│   ├── atelier/                 # 7-act cinematic landing — every module scoped under .atelier-page
│   │   ├── AtelierApp.tsx        # Composer (cinema intro → hero → manifesto → … → coda)
│   │   ├── atelier.css           # ~1020 lines, scoped under .atelier-page so the global selectors don't leak
│   │   ├── effects.tsx           # Custom cursor + chrome, useScrollProgress, useReveal, useActLabel, useMouseParallax
│   │   ├── intro.tsx             # CinemaIntro, CursorTrail, CountTo, AmbientOrnament
│   │   ├── hero.tsx              # 3-layer pointed-arch hero with mouse-parallax 3D tilt
│   │   ├── extras.tsx            # CalligraphyDar, DustMotes, Interlude, Morpher (drag-cross-fade across 3 cultures)
│   │   ├── acts.tsx              # The Three Houses — Lebanese / Khaleeji / Moroccan SVG stages
│   │   ├── content.tsx           # Manifesto, Alchemy (5-step), Atlas (8 motifs), Coda (door, CTA → /transform)
│   │   ├── finale.tsx            # ArchTunnel (3D), Palette, ZelligeAssembler, Colophon
│   │   └── floating-controls.tsx # Top-right EN/AR + dark/light toggles, wired to ThemeLanguageContext
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
| `/` | Cinematic 7-act scrollytelling (Atelier) — was the 8-section landing, now the home. Floating EN/AR + dark/light toggles in top-right. Coda CTA → `/transform`. |
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

---

## Known Decisions

- **Backend lives in [backend/](backend/):** FastAPI service with `/upload`, `/transform`, `/status`, `/result`, `/retry`, `/share`. Real SDXL + dual ControlNet pipeline in [backend/transform.py](backend/transform.py). Set `DARDESIGN_LIGHT=1` for placeholder-PNG mode without a GPU.
- **No localStorage:** Theme and language state reset on page reload (context-only persistence).
- **No next/image:** Using `<img>` elements because blob URLs and SVG data URIs are incompatible with Next.js image optimization. ESLint warnings for this are expected.
- **All client components:** Every page and component uses `"use client"` since they depend on context providers.
