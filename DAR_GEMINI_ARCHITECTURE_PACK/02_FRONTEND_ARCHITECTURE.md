# 02 — Frontend Architecture

**Stack (verified from `package.json`):** Next.js `^16.3.0` (App Router, Turbopack) ·
React `^19.2.8` · TypeScript `^5` · Tailwind CSS `^3.4.1` · three.js `^0.150.0` ·
radix-ui `^1.4.3` / shadcn · lucide-react.

**No state-management library, no charting library, no 3D loader/helper packages.**
(`@react-three/fiber` and `drei` are *not* dependencies — three.js is used directly.)

---

## 1. Route map

| Route | File | Kind | Purpose |
|---|---|---|---|
| `/` | `src/app/page.tsx` | Page (5 lines) | Renders `<DarCinema />` — a 5-scene scroll-driven Arabic landing |
| **`/studio`** | `src/app/studio/page.tsx` (1523 lines) | Page | **The product.** Upload → `/redesign` → results |
| **`/design`** | `src/app/design/page.tsx` (609 lines) | Page | **Build Mode** — metric 3D editor + planner + Render with DAR |
| `/history` | `src/app/history/page.tsx` | Page | Own saved designs, rate/delete/publish |
| `/others` | `src/app/others/page.tsx` | Page | Public gallery of others' published designs |
| `/subscription` | `src/app/subscription/page.tsx` | Page | Basic/Pro plans, usage, request/cancel |
| `/login`, `/register` | `src/app/{login,register}/page.tsx` | Page | Auth |
| `/evaluation` | `src/app/evaluation/page.tsx` (911) | Page | Admin evaluation dashboard |
| `/admin/analytics` | `src/app/admin/analytics/page.tsx` (782) | Page | **Not in CLAUDE.md.** Combines users + evaluation + subscription queue |
| `/admin/subscriptions` | `.../admin/subscriptions/page.tsx` | Page | Approve/decline Pro queue |
| `/admin/users` | `.../admin/users/page.tsx` | Page | Every account + plan dates |
| `/audit` | `src/app/audit/page.tsx` | Page | Render audit trail (token-gated endpoint) |
| `/v2` | `src/app/v2/page.tsx` (13) | Page | "Understood Room" three.js rebuild → `components/dar/UnderstoodRoom` |
| `/transform`, `/result` | stubs (11, 10 lines) | **Redirect** | `redirect("/studio")` — retired async flow |

Non-route: `layout.tsx` (root), `error.tsx`, `not-found.tsx`, `globals.css`.

---

## 2. Provider hierarchy — `src/app/layout.tsx`

```
<html lang dir data-theme suppressHydrationWarning>
  <Script beforeInteractive>  ← restores dd-theme / dd-language before first paint
  <body>
    <ThemeLanguageProvider>     language, theme, bilingual copy
      <AuthProvider>            session (httpOnly cookie ⇒ fetchMe() on boot)
        <ImageProvider>         uploaded file, preview URL, style, jobId
          <AppShell>            sidebar nav
            {children}
```

**Theme default is LIGHT, not the OS setting.** The blocking inline script writes
`data-theme="light"` when `dd-theme` holds neither value — a deliberate choice because the
project is presented from a projector in a lit room.

Fonts loaded as CSS variables: Inter, Cormorant Garamond, Noto Kufi Arabic, Tajawal,
DM Sans, Amiri, Reem Kufi, JetBrains Mono.

---

## 3. State ownership

| Concern | Owner | Notes |
|---|---|---|
| Language + theme + all translations | `src/context/ThemeLanguageContext.tsx` (628 lines) | `{language, theme, isArabic, copy, t, toggleLanguage, toggleTheme}`. Storage keys `dd-theme` / `dd-language`. Sets `lang`, `dir`, `data-theme` on `<html>`. |
| Session / user | `src/context/AuthContext.tsx` | Cookie is httpOnly, so `fetchMe()` is the only way the client learns a session exists |
| Uploaded image + selection | `src/context/ImageContext.tsx` (105) | Revokes every `objectURL` it replaces |
| **Build Mode scene** | `src/lib/design/store.ts` — `useReducer(designReducer)` | Snapshot undo/redo, `localStorage` persistence |
| Studio flow | local `useState` in `studio/page.tsx` | `phase`, `result`, `featured`, `narrative` |
| Render intent (room type, intensity) | local state in `design/page.tsx` | Deliberately **outside** `DesignScene` — see §6 |

> There is no Redux/Zustand/Jotai. Cross-page state travels either through React context
> or, for the Studio → Build Mode jump, through **`sessionStorage`** under the single key
> exported by `src/lib/design/handoff.ts` (`"dar-build-handoff"`).

---

## 4. `/studio` — the product flow

`type Phase = "idle" | "loading" | "done" | "error"`.

```
1. acceptFile()        image/* · <10MB · ≥256×256 (dimensions decoded, not trusted)
        ↓
2. scope pick          "lebanese" | "khaleeji" | "moroccan" | "all"
        ↓
3. spendGeneration()   POST /api/usage/consume  → DATA_API_URL
        ↓                fails CLOSED on quota_exceeded / not_authenticated
        ↓                fails OPEN on anything else (a dead accounts host
        ↓                is not the user's overspend)
4. redesignRoom()      POST /redesign → API_URL, timeout 420 s, AbortController
        ↓
5. loading scene       DissolveCanvas particles + GenerationStory
        ↓                progress is an ANIMATION CURVE (1 - e^(-t/40), capped .92),
        ↓                explicitly NOT telemetry; the ring is indeterminate and
        ↓                the only real number shown is measured elapsed time
        ↓
6. done                900 ms hold → reveal
```

### The results screen — a correction to the project's own docs

> **`CLAUDE.md` describes "six result tabs" (Result · Design Story · Culture DNA · Inside
> DAR · Understand · Edit). That is not what renders.**
>
> `type ResultTab`, `TOOL_TABS` and the `resultTab` state variable exist in the source
> (lines 61, 65, 153) but **`resultTab` is never read** — it is only ever *set* by three
> reset calls, and `TOOL_TABS` is never referenced after its declaration. **They are dead
> code.**
>
> The only tab bar that renders is `NARRATIVE_TABS` — **three** tabs.

**What actually renders in the `done` phase:**

| Element | Condition |
|---|---|
| `BeforeAfterSlider` over the featured culture | always |
| Download / start-over actions | always |
| Tile grid: `original` + each generated culture | always |
| `SaveDesignButton`, `RoomReport`, `EnterBuildMode` | always |
| `ColorControl` | only when `result.job_id && result.room_analysis` |
| `CulturalElementHighlighter`, `RoomMap2D` | always (with demo fallback) |
| `DepthOrbit` | only when `result.depth_map` |
| `FurniturePlacement` | only when `job_id && room_analysis` |
| `CulturalNarration`, `StyleIntensitySlider` | always |
| **Narrative tab bar** (3) → one of `DesignStory` / `CultureDNA` / `GenerationStory` | user selection |

Everything except the narrative panel renders **unconditionally, in one scrolling column**.

**Why exactly one narrative panel is mounted (not CSS-hidden):** `GenerationStory` runs a
timed chapter loop and `DesignStory` measures natural image ratios — both would keep
running offscreen if merely hidden.

### Truth gating in Studio

Three different strictnesses coexist, and each one surfaces the distinction to the user:

| Gate | Behaviour on placeholder/missing data |
|---|---|
| Studio's `hasRealMap` / `hasRealRegions` | Falls back to `DEMO_MAP` / `DEMO_REGIONS`, heading says **"(preview)"** instead of "(live)" |
| `isPlaceholder` | Shows a bilingual **"PREVIEW MODE — no GPU connected"** banner |
| `adapters.createDesignStoryData` | **Refuses to fall back at all** — returns `null`, so the Design Story is simply not offered |
| `roomModel.deriveRoom` | Falls back to a room explicitly labelled `shellSource: "default"` |

### Defense Mode — `?demo=1`

Reads `/demo/manifest.json` and replays six pre-rendered rooms from static files with
**zero backend calls** — insurance if the GPU tunnel dies mid-defense. Each room supplies
`original/lebanese/khaleeji/moroccan/depth_map.png` + `meta.json` (`object_map`,
`seg_regions`). Built by `python scripts/make_demo_pack.py`.

*Implementation note: the check is `params.has("demo")`, so `?demo=0` also activates it.*

---

## 5. API communication — `src/lib/api.ts`

**Two base URLs, deliberately:**

```ts
const API_URL      = process.env.NEXT_PUBLIC_API_URL?.replace(/\/+$/,"")      ?? "http://localhost:8000";
const DATA_API_URL = process.env.NEXT_PUBLIC_DATA_API_URL?.replace(/\/+$/,"") ?? API_URL;
```

| Base | Carries | Why |
|---|---|---|
| `API_URL` | `/redesign`, `/restyle`, `/render-scene`, `/api/furniture/*`, `/api/color/*`, `/audit`, share, retired job flow | The GPU host. Holds no durable state, wiped between sessions, reached through a rotating tunnel |
| `DATA_API_URL` | auth, history, feedback, subscription, usage, `/api/admin/*`, **`/api/design/plan`** | Accounts and money. `DATA_API_URL` falls back to `API_URL`, so a single-backend setup behaves identically |

> **The planner is on `DATA_API_URL`, not `API_URL`** — the LLM API key belongs on a
> machine the user controls, never on a throwaway Kaggle GPU container. It is also the
> **only generation-adjacent endpoint behind `_require_user`**, because every call spends
> real money.

**Error contract.** Every backend `HTTPException` carries `{code, message_en, message_ar}`,
so there is **no client-side error-mapping table**. `class ApiError` exposes
`code`, `message_en`, `message_ar`, `http_status`.

**Response-shape validation.** `redesignRoom` checks that `original` is a `data:image`
string and that every requested culture is present, raising `ApiError("bad_response")`
otherwise. This exists because long endpoints stream keepalives — **once the stream
starts the HTTP 200 is already sent**, so a post-start failure arrives in-band with a
200 status. Validating shape rather than status is what catches it.

Every request carries `{"ngrok-skip-browser-warning": "true"}`; auth-aware calls add
`credentials: "include"`.

*Two implementation blemishes worth knowing (they do not change the architecture):
`safeFetch`'s network-failure message hardcodes `DATA_API_URL`/`NEXT_PUBLIC_DATA_API_URL`
even when used for the GPU base; and `renderScene` bypasses `safeFetch`, so its network
failures surface as raw `TypeError` rather than `ApiError` — `HandoffPanel` compensates.*

Full endpoint listing → [18_API_ENDPOINT_MAP.md](18_API_ENDPOINT_MAP.md).

---

## 6. `/design` — Build Mode composition

**Bootstrap order** (`design/page.tsx`):

```
readHandoff()               sessionStorage["dar-build-handoff"] → {result, culture}
      ↓
createScene(result, culture)   roomModel.deriveRoom → shell + found massing + openings
      ↓
loadScene(jobId)            a saved scene WINS for objects…
      ↓                      …but OPENINGS ARE ALWAYS RE-DERIVED
useReducer(designReducer)      "they belong to the photograph, not the user's edits"
      ↓
debounced 600 ms saveScene(scene) → localStorage["dar-scene-v3:<jobId>"]
```

**`renderIntent` (`{roomType, intensity}`) is held in page state, NOT in `DesignScene`.**
Adding a scene field would bump `SCENE_VERSION`, and `loadScene` **discards** any scene
whose version does not match — i.e. it would throw away every room a user had saved.

### Component ownership

| Component | File | Owns |
|---|---|---|
| `DesignCanvas` | `components/design/DesignCanvas.tsx` (398) | All pointer/key gestures → store actions. Holds the `DesignWorld`; **the 3D world decides nothing**. Lifts `renderConditioning` up via `onReady({capture})` |
| `PlanPanel` | `components/design/PlanPanel.tsx` (352) | The natural-language brief, planner status badge, `planLayout()`, then **`gatePlan()` before anything is shown**. Renders "DAR understood", accepted items with reasons, and a "Not placed" list |
| `HandoffPanel` | `components/design/HandoffPanel.tsx` (350) | Render with DAR. Exports `buildRenderPayload(scene)` (schema `"dar.scene/v3"`). Captures conditioning **before** the request so evidence survives a dead backend |
| `CatalogDock` | `components/design/CatalogDock.tsx` (155) | Bottom rail. **The only place the cut-out PNGs appear** — never in 3D |
| `Inspector` | `components/design/Inspector.tsx` (323) | `ObjectInspector` + `RoomInspector` (materials, rotate, duplicate, lock, room resize) |
| `PlanMinimap` | `components/design/PlanMinimap.tsx` (74) | SVG top-down plan, click-to-select |
| `SourceCard` | `components/design/SourceCard.tsx` (78) | "What am I designing from?" — toggles DAR render / original photo |
| `EnterBuildMode` | `components/design/EnterBuildMode.tsx` (103) | The doorway from Studio; writes the sessionStorage handoff |

**Keyboard:** `Ctrl/Cmd+Z` undo · `+Shift`/`Ctrl+Y` redo · `Ctrl+D` duplicate · `Esc`
deselect · `Del`/`Backspace` remove · `R`/`Shift+R` rotate ±15° · `F` focus · arrows nudge
10 cm (1 cm with Shift).

---

## 7. Bilingual / RTL behaviour

Every component uses `const { copy, isArabic } = useThemeLanguage()`:

- **Text** — `{copy.section.key}`; hardcoded user-facing strings are a violation
- **Font** — `isArabic ? "font-arabic" : "font-display"`
- **Layout** — `isArabic ? "text-right" : "text-left"`, `isArabic && "flex-row-reverse"`
- **Document** — `lang`, `dir` and `data-theme` are set on `<html>` client-side (hence
  `suppressHydrationWarning`)

**One RTL trap the codebase documents:** the story panels break out of the results column
with symmetric negative `margin-inline`, **not** the usual `left-1/2` +
`-translate-x-1/2` trick — `left` resolves against the inline start, so in RTL that throws
the panel hundreds of pixels off the side of the page.

`BeforeAfterSlider` takes an `afterSide` prop so labels and images agree under RTL;
`/studio` pins `"right"` because the CSS labels are pinned left/right in both languages.

---

## 8. Architecture boundaries that are load-bearing

| Boundary | Rule |
|---|---|
| **3D scene ↔ React** | `DesignScene` is plain serializable JSON — no class instances, no `THREE.*`, no functions. That is what makes persistence, undo/redo and the render hand-off the same problem. |
| **Gestures ↔ scene logic** | `DesignCanvas` translates input into store actions and owns no scene logic; `DesignWorld` draws and never decides. |
| **Catalogue PNGs ↔ 3D** | Cut-out PNGs appear in `CatalogDock` only. A billboarded photo among lit volumes reads as a sticker the moment the camera moves — and it would let DAR imply it rendered something it did not. |
| **Studio bundle ↔ `/design` bundle** | `handoff.ts` exports one constant and nothing else, so Studio can import the key without pulling Build Mode's three.js into its bundle. |
| **Truth gates** | `adapters.ts` never substitutes demo data. Unmeasured values are `null` + `measured: false`, rendered as an em-dash. |

---

## 9. Known frontend gaps

| Gap | Detail |
|---|---|
| `npm run lint` is broken | Next 16 removed `next lint`; the repo still has eslintrc-format `.eslintrc.json` while `eslint-config-next` v16 expects flat `eslint.config.mjs`. **CI never ran it**, so nothing silently regressed — but `npm run build` is the only frontend gate. |
| No frontend test runner | There is no Jest/Vitest/Playwright. `npm run build` (which type-checks) is the whole gate. |
| Dead six-tab code | `ResultTab` / `TOOL_TABS` / `resultTab` — see §4. |
| Two `StyleId` definitions | `src/lib/api.ts` and `src/context/ImageContext.tsx` define structurally identical but unrelated types; `lib/design/*` imports the `ImageContext` one. |

---

Related: [09_BUILD_MODE_THREEJS.md](09_BUILD_MODE_THREEJS.md) ·
[14_EXPLAINABILITY.md](14_EXPLAINABILITY.md) ·
[18_API_ENDPOINT_MAP.md](18_API_ENDPOINT_MAP.md)
