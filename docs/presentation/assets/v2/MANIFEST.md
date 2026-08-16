# Defense deck screenshot pack — v2

Captured 2026-08-15/16 with Chrome DevTools MCP driving real Chrome.

**Global settings:** viewport 1920×1080, `deviceScaleFactor: 2` (so viewport shots are
3840×2160 PNG), light theme, `lang="en"`, `fullPage: false`. Next.js dev indicator and all
scrollbars hidden before every capture. Defense Mode (`?demo=1`) was never used — every shot
is live app state. No retouching, upscaling or compositing.

**Backends:** accounts/history/planner on `http://localhost:8000` (`DARDESIGN_LIGHT=1`);
renders on the Colab T4 behind the Cloudflare tunnel, `/healthz` → `light_mode: false`.
Everything GPU-dependent (01, 05, 06, 13, 15) was captured before that tunnel rotated.

**Accounts:** `darwechzainab@gmail.com` (Yasser Hamdan, **Admin**, Pro) for all shots except 12;
`qa-golden@dardesign.local` (Yasser Hamdan 2, User) for 12, because Others' Work never shows
you your own designs. I set a known password on both to sign in; nothing else about them changed.

---

## Shots

| File | px | What it shows | Route / account |
|---|---|---|---|
| `01-three-cultures-lebanese.png` | 1024×1024 | Same source room rendered Lebanese — limestone, cedar, blue upholstery | `POST /redesign`, GPU host |
| `01-three-cultures-khaleeji.png` | 1024×1024 | Same room, Khaleeji | same call |
| `01-three-cultures-moroccan.png` | 1024×1024 | Same room, Moroccan — carved plaster, star lanterns, Berber rug | second call, same source |
| `02-studio-upload.png` | 3840×2160 | Room uploaded, culture picker, **Khaleeji selected** | `/studio`, admin |
| `03-planner-brief.png` | 3840×2160 | Planner box with the exact brief typed | `/design`, admin |
| `04-planner-result.png` | 3840×2160 | Structured plan: culture, room type, capacity, wall colour, counts, cited evidence | `/design`, admin |
| `05-conditioning-triplet-beauty.png` | 1024×768 | Beauty pass — the scene as designed | Build Mode handoff |
| `05-conditioning-triplet-depth.png` | 1024×768 | Depth control image | same scene/framing |
| `05-conditioning-triplet-seg.png` | 1024×768 | ADE20K segmentation control | same scene/framing |
| `06-colour-control.png` | 3840×2160 | Wall picker open, preview applied, Undo/Reset enabled | `/studio`, admin |
| `07-placement-valid.png` | 3840×2160 | Sofa ghost accepted — green "RELEASE TO PLACE" | `/design`, admin |
| `08-placement-invalid.png` | 3840×2160 | Same sofa, same room — red "OVERLAPS A PIECE YOU PLACED" | `/design`, admin |
| `09-build-mode.png` | 3840×2160 | 3D room, Inspector (210/88/82 cm, material, provenance), catalogue rail | `/design`, admin |
| `10-history.png` | 3840×2160 | 4 complete saved designs with ratings | `/history`, admin |
| `11-rating.png` | 3840×2160 | Feedback form open with the submitted rating loaded (5/5/5, Sensible) | `/history`, admin |
| `12-community.png` | 3840×2160 | 3 shared designs with ratings (5.0, 2.0, 3.7) | `/others`, qa-golden |
| `13-room-report.png` | 1240×1345 | Generated Room Report PNG | `/studio` → Room report |
| `14-evaluation-dashboard.png` | 3840×2160 | KPIs, human evaluation, automatic metrics | `/evaluation`, admin |
| `15-top-down-map.png` | 2240×1194 | Highlighter + 2D map, labelled **(live)** | `/studio`, admin |

### Extra (not requested, kept because it's the payoff)

| File | px | What it shows |
|---|---|---|
| `05-conditioning-triplet-render.png` | 1024×768 | The real SDXL render conditioned on that triplet — **33.69 s on the T4**. The two chairs, coffee table and sofa land where they were placed in Build Mode. |

---

## Deviations, and why

**02 — "intensity at 80%" is not capturable there.** The Studio upload screen has no intensity
control; I verified it in the DOM (`input[type=range]` count 0, no "intensity" text). The Style
Intensity slider is `/restyle`-only and lives in the post-result Edit tab. Everything else in
shot 02 is as specified.

**04 — no intensity in the plan.** The brief didn't state one, so `understood.intensity` is
`null` and the panel omits it rather than inventing a value. Culture, room type, capacity, wall
colour and counts (1 of 1 sofa, 3 of 3 chairs, 1 of 1 coffee table) are all present.

**05 — "styled render" read as the beauty pass.** The triplet is the three offscreen passes
`renderConditioning()` captured, taken as PNG bytes from the handoff panel, so "crop to the
images only" is literal. The actual styled SDXL output is the extra file above.

**10 — 4 cards required zooming the page to 0.38.** At natural scale a 1080-high viewport fits
**one** saved design; the cards are full-width before/after images. 0.38 is the largest zoom
where 4 cards are complete with nothing clipped at an edge. The account holds 6. If you'd rather
have readable text than 4 cards, say so and I'll re-shoot at 1:1 with 1 card.

**12 — 3 shared designs, not more.** Only 3 of the 6 are actually shared; I left that alone
rather than sharing more to pad the shot. Meets the "3+" floor.

**14 — panels reading "No data":** LPIPS (n=0) and CLIP cultural similarity (n=0) under
Automatic model evaluation, and Moroccan room-preservation shows N=1. Everything else is real:
4 evaluable designs (6 saved, 2 excluded as edited), 4.25/5 human quality and authenticity,
3m 15s average generation time, SSIM 0.292 (n=3). The LoRA-vs-baseline ablation panel is absent
by design — `eval/results.csv` has not been generated.

**14 — the page is 1968px tall, so the viewport shows the top ~55%** (through Human evaluation
into the top of Automatic model evaluation). Viewport-only capture of a long page cuts at the
fold; framing at scroll 0 keeps the KPI cards and the full human-evaluation panel.

## One thing you should know

Mid-session, `src/components/story/GenerationStory.tsx` was saved in a broken intermediate state
(`Expression expected` at line 615). Next's hot reload remounted `/studio` and discarded a
finished 6-minute render, which is why shots 06/13/15 were generated on a second run. The file
parses fine now — no action needed, but avoid saving mid-edit while a generation is in flight.
