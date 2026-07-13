# الغرفة المفهومة — The Understood Room
## Build spec: Three.js rebuild inside the DarDesign Next.js app
**For: Claude Code · Owner: Yasser · Status: replaces the Fable/raw-WebGL prototype**

---

## 0. Mission & context

Rebuild DarDesign's cinematic scrollytelling landing ("The Understood Room") as a **Three.js** experience inside the existing Next.js 14 App Router project, replacing the raw-WebGL Fable prototype. The prototype's design, copy, timeline and interactions are final and specified below — the engine is what changes. Reason: the hand-rolled WebGL engine is driver-fragile (confirmed corruption/freezes on Intel Iris Xe); Three.js carries a decade of driver workarounds and must run flawlessly on integrated GPUs, because the FYP jury's laptop is the target hardware.

Mount as a new component (do NOT delete DarCinema until this is accepted):
- `src/components/dar/UnderstoodRoom/` — new module
- Route it at `/v2` first; swap to `/` only after the acceptance checklist passes.

## 1. Hard engineering rules

1. **Three.js from npm** (`three` + `@types/three`), plain Three inside ONE client component (`'use client'`) with a manual rAF loop. No react-three-fiber (keep the render loop fully controlled), no other 3D deps. Fat lines via `three/examples/jsm/lines/{Line2,LineMaterial,LineGeometry}`.
2. **Device budget: Intel Iris Xe at 60fps.** Renderer: `antialias:true, alpha:false, powerPreference:'high-performance'`; `renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5))`. Total draw calls < 80 per frame. No textures — all color is vertex/material color (procedural). Geometry small: reuse geometries, `InstancedMesh` for repeated tiles/arches.
3. **Lifecycle discipline:** cancel rAF + `renderer.dispose()` + dispose geometries/materials on unmount; pause loop on `visibilitychange`; handle `webglcontextlost/restored` (prevent default, re-init on restore).
4. **Keep the debug hook:** `window.__ddT = <0..8.8>` overrides the scroll-derived timeline target (it made remote QA possible — keep it forever). Also keep `?diag=1` (small overlay: fps, draw calls via `renderer.info`, mode, t) and `?mode=day|night`.
5. **Fallbacks:** `prefers-reduced-motion` OR WebGL unavailable → render a static hero section (title + subtitle + CTA + the three portal cards as plain DOM) instead of the film. Never a blank page.
6. TypeScript, no `any` on public surfaces. All copy strings in one `copy.ts` so Zainab can review Arabic in one file.

## 2. File layout

```
src/components/dar/UnderstoodRoom/
  index.tsx        // client component: canvas + DOM overlays + loop
  copy.ts          // ALL AR/EN strings (from §5)
  tokens.ts        // palettes + timeline constants (from §3–§4)
  world.ts         // scene graph builders (rooms, portals, lines, particles, glows)
  camera.ts        // camera path + timeline math
  daynight.ts      // relight system
  StaticHero.tsx   // reduced-motion / no-WebGL fallback
app/v2/page.tsx    // mounts <UnderstoodRoom/>
```

## 3. Design tokens

CSS variables on `html[data-dd-mode="night"|"day"]` drive ALL DOM color; Three colors read the same values from `tokens.ts`.

**Night (default aesthetic):** bg/fog `#0a0a0f` · panel `#12121a` · ink `#f5f0e8` · body `#cfc8bb` · sub `#8a8598` · gold `#d4af37` · goldBright `#f0d78c` · goldDim `#8b7432`.
**Day ("ضحى" — parchment & ink):** bg `#f6ecd4` · world haze `#efe2c4` · panel `#fdf6e3` · ink `#251a0e` · body `#4a3b28` · sub `#8d7a58` · accent terracotta `#b4501a` · bronze `#8a5c14` · bronzeDim `#a4854a`.
Rule of day mode: **light-drawn gold lines become ink-drawn bronze lines on parchment; lanterns yield to sun.**

Fonts (already in the project): display = Noto Kufi / Reem Kufi; body = Tajawal; mono eyebrows = monospace with `letter-spacing:.3em`. Whole page `dir="rtl"`.

## 4. Timeline & camera

- Virtual film time `t ∈ [0, 8.8]`. Scene lengths `LEN=[1.5,1.9,2.4,1.9,1.1]`, `CUM=[0,1.5,3.4,5.8,7.7]`. Scroll spacer `height:max(880vh,11800px)`; `t = scrollY/unit`.
- Smoothing: `tS += (t−tS)·(1−e^(−dt·3.4))`, dt clamped ≤ .05. **Soft docking:** when velocity is low and `|tS−dock|<.35`, ease tS toward the dock. Docks: `[0, 2.45, 4.65, 6.75, 8.45]`.
- Camera: `PerspectiveCamera(55)`, height ~1.55, travels along −Z with gentle pointer parallax (±.4 x, ±.25 y, lerped). World layout (Z axis):

| Element | Z |
|---|---|
| Camera start (title) | +6 → −26 across scene 1 |
| Threshold arch (particles + drawn line) | −14.5 |
| Three portals (Lebanese / Khaleeji / Moroccan) | −48…−50, x = −6/0/+6 |
| Majlis room A (Understanding) | −84 |
| Room B (Transformation, culture morph) | −118 |
| Final door | −144.2 |
| Golden floor thread | y=.035, z +4.6 → −158, dashed |

- Right-edge progress rail: 5 dots + Arabic labels (العتبة، البيوت الثلاثة، الفهم، التحوّل، الدعوة) — clickable (smooth-scroll to dock), `role="button"`, keyboard `↑/↓/PageUp/PageDown/Space` jump between docks (skip when the slider is focused).

## 5. Scenes — copy is FINAL, use verbatim

**Motif everywhere: "يُرسَم أولًا ثم يُسكَن" — drawn first, then inhabited.** Every structure appears first as a glowing line drawing (gold at night / bronze ink by day), then fills with matter (particles or meshes).

### S1 · العتبة (t 0–1.5)
Copy: eyebrow `دار ديزاين · DARDESIGN` · H1 `الغرفة المفهومة` · sub `THE UNDERSTOOD ROOM` · lines `صورة واحدة لغرفتك — وثلاثة أجوبة:` / `كيف تبدو، كيف تُرتَّب، وكيف تُسكَن.` / EN `One photograph. Three answers: how it looks, how it sits, how it feels to live in` · hint `اعبر العتبة · CROSS THE THRESHOLD`.
Visual: starfield dust (Points, ~2500, additive at night / dark bronze motes normal-blend by day). A monumental two-centered pointed arch at z −14.5 (span ~6.1, apex ~7.0): Line2 outline (double line: intrados + extrados offset .45, jambs, threshold bar) draws in over t .05–.35 while particles gather along it; camera flies THROUGH it at t≈.85. Warm horizon glow (billboard sprite-plane, additive) beyond.

### S2 · البيوت الثلاثة (t 1.5–3.4)
Copy: eyebrow `٠٢ · THREE HOUSES` · H2 `البيوت الثلاثة` · sub `بيت لبناني، مجلس خليجي، رياض مغربي — كل تقليدٍ بهندسته الحيّة`. Portal hover/focus labels: `البيت اللبناني — قوس ثلاثي · حجر جبل لبنان` · `المجلس الخليجي — جصّ محفور · أقواس نجدية` · `الرياض المغربي — زليج يتوالد · قوس حذوة الفرس`.
Visual: three arched portals, frames drawn as Line2 first, then interiors build: Lebanese = limestone course rectangles (InstancedMesh, staggered rise); Khaleeji = white gypsum grid + carved niches (instanced boxes); Moroccan = 8-point zellige star tiles (InstancedMesh, palette teal/cobalt/saffron/white, spiral-in build). Each portal: soft additive glow + floor light spill. Hover (desktop) brightens + shows label; on touch, auto-cycle focus.

### S3 · الفهم (t 3.4–5.8) — the thesis
Copy: eyebrow `٠٣ · THE UNDERSTANDING` · H2 `هكذا تُفهَم الغرفة` · sub `الصورة تنشقّ عن طبقاتها — النمط، المخطّط، العمق`. Layer labels (3D-anchored DOM): `٠١ · كيف تبدو — النمط · HOW IT LOOKS` · `٠٢ · كيف تُرتَّب — المخطّط · HOW IT SITS` · `٠٣ · كيف تُسكَن — العمق · HOW IT FEELS`.
Visual: a Lebanese majlis room built from simple box/arch primitives: triple-arch window (lit), kilim rug (striped boxes), red diwan seating, floor cushions, brass lantern (PointLight, warm, subtle flicker). Above it, the SAME room as a **golden top-down plan** — Line2 wall outlines + furniture footprints — lifts and flattens (t .35–.55). At t≈.62 an "explode": photo-room, plan, and a relief panel (gold-graded low blocks) separate vertically with the three labels. Anchored labels project via `Vector3.project()` each frame.

### S4 · التحوّل (t 5.8–7.7)
Copy: eyebrow `٠٤ · THE TRANSFORMATION` · H2 `شاهد التقليد يظهر` · sub `اسحب — فيتكثّف التقليد من الفضاء الكامن`. Scrubber block: `شدّة الثقافة · CULTURE INTENSITY`, value label morphs `ضوء محايد → حجر جيري لبناني → قوس ثلاثي → كليم وديوان → نحاس وقنديل → لوحة خطّ عربي`, endpoints `٠٪ غرفة صامتة` / `١٠٠٪ بيت لبناني`, percent in Arabic-Indic digits.
Visual: neutral grey room ↔ full Lebanese materiality, driven by `culture ∈ [0,1]`: lerp vertex colors / material colors, scale-in of cultural elements (stone courses, kilim stripes, lantern) with a brief "storm" shimmer while dragging. Scrubber: `role="slider"` with `aria-valuenow`, pointer drag + arrow keys (±5). Auto-drift to ~50% until the user grabs it (then `owned`).

### S5 · الدعوة (t 7.7–8.8)
Copy: eyebrow `٠٥ · THE INVITATION` · door card `ادخل / الاستوديو · ENTER THE STUDIO` · closing `دار ديزاين — البيت الذي يفهم نفسه` / `لبناني · خليجي · مغربي`.
Visual: the final door at z −144.2 drawn first as bronze/gold Line2 outline with a warm halo, particles condensing into the doorway; DOM arch-shaped CTA breathing (scale 1↔1.02). Click → 0.9s radial threshold bloom overlay → `router.push('/studio')`.

## 6. Day/Night system (signature feature)

- Toggle pill fixed top-corner: icon shows the TARGET mode (sun at night, crescent by day) + label `نهار · DAY` / `ليل · NIGHT`. `data-dd-mode-toggle` attribute preserved.
- On toggle (≈1.5s eased): scene.background + `scene.fog` (FogExp2 or linear 16→42) lerp night↔`#efe2c4`; ambient/hemisphere light swaps to warm daylight; lanterns fade out, a warm DirectionalLight ("sun through the arches") fades in with visible shaft planes; ALL Line2 materials lerp gold→bronze ink; particle color/blending lerp (additive→normal); DOM flips via `data-dd-mode` CSS vars.
- Persistence: `localStorage['dd-mode']` (try/catch); initial = `?mode=` param → saved → `prefers-color-scheme` → night.

## 7. Acceptance checklist (Yasser verifies by scrolling on HIS laptop)

1. `npm run dev` → `/v2` loads; night by default on his machine; zero console errors.
2. Scroll top→bottom: every beat has visible composition — **no black/empty stretches anywhere**.
3. S1 arch reads as a monumental doorway and you fly through it.
4. Portals: three distinct patterns, hover labels work.
5. S3: room + golden plan + explode with 3 labels tracking in 3D.
6. S4: slider drag AND arrow keys change the room live; label + ٪ update.
7. S5: door CTA blooms and routes to `/studio`.
8. Toggle relights the entire world both directions; choice survives reload.
9. Rail dots click-jump; keyboard jumps scenes; slider focus doesn't break keys.
10. Resize window + toggle Chrome side panels: film keeps running (no freeze).
11. 390px wide mobile viewport: readable, functional, ≥30fps.
12. `?diag=1` shows steady fps ≥55 on the Iris Xe laptop, draw calls < 80.

## 8. Milestones for Claude Code sessions

- **M1:** scaffold, tokens/copy, scroll→timeline+docking, camera path, dust + fog + S1 title/arch (lines only). *Done = checklist 1–3 partially.*
- **M2:** S2 portals with instanced patterns + hover. **M3:** S3 room, plan lift, explode, anchored labels. **M4:** S4 culture morph + scrubber; S5 door + CTA bloom + routing. **M5:** Day/Night relight, rail/keyboard, diag, fallbacks, mobile pass, disposal audit.
- End every session by running the dev server and listing which checklist items to eyeball.

## 9. Kickoff prompt (paste into Claude Code from the repo root)

```
Read UNDERSTOOD_ROOM_THREEJS_SPEC.md fully — it is the single source of truth (design, exact Arabic copy, timeline, palettes, acceptance checklist). Execute Milestone M1 only: install three + @types/three, scaffold src/components/dar/UnderstoodRoom/ per §2, implement tokens/copy/timeline/camera and Scene 1 (title, dust, drawn threshold arch, fly-through), route it at /v2, respect every rule in §1. Do not touch DarCinema. When done, start the dev server and tell me exactly what to look at against checklist items 1–3.
```

## 10. Reference assets
`The_Understood_Room_v2.html` (the finished raw-WebGL prototype — open it for visual reference of every beat), plus the NIGHT/DAY contact sheets. Match the prototype's look; exceed its reliability.
