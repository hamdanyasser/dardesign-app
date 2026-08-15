# 05 — Cultural Ontology

*DAR's cultural knowledge base: what it contains, how it is consumed, and exactly how much
of it has been expert-verified.*

---

## 1. Two files, one canonical location

| File | Version | Contents |
|---|---|---|
| **`ontology/ontology.json`** | `0.1.0` | The cultural design vocabulary — 4 cultures × 7 categories |
| **`ontology/furniture.json`** | `0.2.0` | 27 furniture items with real centimetre dimensions and placement rules |
| `ontology/sources.md`, `ontology/README.md` | — | Provenance notes for the terms |

> **⚠ There is a second copy.** `src/data/ontology.json` is read by `RoomReport` and
> `CulturalElementHighlighter`, while `src/components/story/cultureData.ts` reads the
> **canonical root** `ontology/ontology.json`. **Two copies — they must be kept in step**
> until they share one import. This is a known, documented duplication.

---

## 2. `ontology.json` structure

```json
{
  "version": "0.1.0",
  "_note": "Every entry has \"verified\": false until Zainab signs off. The prompt
            builder skips unverified terms only if --strict is passed; default
            behaviour is to use them and log a warning.",
  "trigger":  { "lebanese": {"en":…, "ar":…}, "khaleeji": …, "moroccan": …, "persian": … },
  "negative_universal": [ … ],
  "cultures": {
    "lebanese":  { "negative_specific": [...], "architectural": [...], "materials": [...],
                   "color_palette": [...], "lighting": [...], "furniture": [...],
                   "textiles": [...], "ornamentation": [...] },
    "khaleeji":  { … same 8 keys … },
    "moroccan":  { … },
    "persian":   { … }
  }
}
```

**The seven sampled categories** (`prompt_builder.CATEGORIES`):
`architectural` · `materials` · `color_palette` · `lighting` · `furniture` · `textiles` ·
`ornamentation`.
(`negative_specific` is an eighth key but is used for the negative prompt, not sampled.)

**Each term carries:** `en`, `ar`, a `weight` (sampling bias), and a **`verified`** boolean.

---

## 3. ⚠ Cultural verification status — the most important table in this document

Counted directly from `ontology/ontology.json`:

| Culture | Terms | `verified: true` | `verified: false` | Status |
|---|---|---|---|---|
| **Lebanese** | 30 | **0** | **30** | ❌ **NOT VERIFIED** |
| **Khaleeji** | 30 | **30** | 0 | ✅ Verified |
| **Moroccan** | 30 | **30** | 0 | ✅ Verified |
| **Persian** | 23 | **0** | **23** | ❌ NOT VERIFIED |
| *Total* | *113* | *60* | *53* | |

Per-category breakdown (identical shape for all three core cultures):
`architectural` 6 · `materials` 5 · `color_palette` 5 · `lighting` 3 · `furniture` 4 ·
`textiles` 3 · `ornamentation` 4 = **30**.
Persian: 4 · 4 · 4 · 2 · 3 · 3 · 3 = **23**.

> ### This corrects the project's own documentation.
>
> `CLAUDE.md` and `README.md` mention `verified: false` **only in connection with
> Persian**. In fact **the entire Lebanese vocabulary is unverified — and Lebanese is the
> hero culture**, the one with the most training images (19) and the one shown first in
> the landing page and Studio.
>
> **This must be stated honestly at the defense.** It is not a code defect; it is a
> pending expert sign-off from the project's cultural collaborator.

### And the `strict` flag is never enabled

```python
def build_prompts(culture, room=None, *, ontology_path=None, seed=None,
                  per_category=2, strict=False) -> Prompts
```

`_weighted_sample` filters to `item["verified"]` **only when `strict=True`**, and falls
back to the full pool with a warning if that leaves nothing.

**A repository-wide grep confirms `strict=True` is passed by no production caller.** It is
exposed only as a `--strict` flag on `prompt_builder`'s CLI (`_cli()`). Therefore:

> **Unverified Lebanese and Persian terms DO reach the generation prompt today.**
> The mechanism to exclude them exists and is one keyword argument away; it is not
> switched on.

---

## 4. How the ontology becomes a prompt

`backend/prompt_builder.py` → `build_prompts(culture, room, seed, per_category, strict)`:

```
ontology.json
    │  plain json.load — no retrieval, no embedding, no search
    ▼
trigger[culture]                          → the LoRA trigger phrase (EN + AR)
cultures[culture][category] for 7 cats
    │
    ▼  _weighted_sample(items, k=per_category(2), rng=Random(seed), strict)
    │      random.choices weighted by max(0.1, item["weight"])
    │      dedup by id(obj), attempts capped at k*8
    ▼
each term → sanitize_prompt_fragment(filter_chunk(term))   ← injection guardrail
    ▼
positive_en = f"a {room_en} in the {trigger.en}, photorealistic interior photography,
               natural daylight, magazine-quality, 8k, intricate detail, {terms}"
negative_en = negative_universal + culture.negative_specific
negative_ar = a fixed 16-term list (NOT derived from the ontology)
    ▼
Prompts(positive_en, positive_ar, negative_en, negative_ar,
        trigger_en, trigger_ar, culture)
```

**Seeding is real reproducibility.** `rng = random.Random(seed)`, and `transform_room`
passes the *generation* seed straight through — so prompt term selection and the diffusion
generator share one seed. Same culture + same seed ⇒ same prompt, every time.

**`room_ar_map`** — the room-type vocabulary, quoted verbatim from `prompt_builder.py`:
```python
{"living room":"غرفة جلوس", "majlis":"مجلس", "dining room":"غرفة طعام",
 "bedroom":"غرفة نوم", "kitchen":"مطبخ", "courtyard":"فناء",
 "riad courtyard":"فناء رياض", "salon marocain":"صالون مغربي",
 "hammam":"حمّام", "interior":"تصميم داخلي"}
```
> **These exact keys are reused as the LLM planner's `roomType` enum**, so a room type the
> model picks always arrives at the prompt builder with a real Arabic translation. The
> vocabulary is shared, not duplicated. See [06](06_LLM_DESIGN_PLANNER.md).

---

## 5. The trigger phrase — and prompt-only cultures

Every culture has a trigger phrase (e.g. `"dardesign-lebanese style"`) that is **always
injected, whether or not a LoRA file exists on disk**. `_attach_lora` falls back to
prompt-only when the file is missing.

**This is the scalability claim, and it is implemented:** adding culture N costs one
ontology entry (trigger + 7 categories) and no retraining. `docs/add_a_culture.md`
documents the procedure. **Persian is the live proof** — it has ontology terms, a trigger,
and no LoRA.

---

## 6. Culture support matrix — what each culture can actually do

| Capability | Lebanese | Khaleeji | Moroccan | Persian |
|---|---|---|---|---|
| Ontology terms | 30 | 30 | 30 | 23 |
| Trained LoRA on disk | ✅ 93,076,472 B | ✅ 93,076,472 B | ✅ 93,076,472 B | ❌ **none** |
| Training images | 19 | 14 | 12 | 0 |
| In `CORE_STYLES` (`/redesign`) | ✅ | ✅ | ✅ | ❌ |
| In `StylePack` (`/restyle`, intensity slider) | ✅ | ✅ | ✅ | ✅ |
| Furniture catalogue items | 9 | 9 | 9 | ❌ **0** |
| Build Mode culture | ✅ | ✅ | ✅ | ❌ |
| LLM planner culture | ✅ | ✅ | ✅ | ❌ |
| Expert-verified terms | ❌ | ✅ | ✅ | ❌ |

> **Persian is prompt-only and restyle-only.** It is reachable through `/restyle` and the
> Style Intensity Slider and nowhere else. `furniture.CULTURES` is
> `("lebanese", "khaleeji", "moroccan")` — no Persian. `design_planner.PLAN_CULTURES` is
> `("lebanese","khaleeji","moroccan","all")` — no Persian.
>
> **Do not present Persian as a fourth supported culture.**

---

## 7. Colours — the ontology drives the 3D materials too

`src/lib/design/materials.ts` defines **22 material keys** (limestone, tadelakt, gypsum,
sand, marble, encaustic, cedar, walnut, boneInlay, brass, agedBrass, iron, linen, velvet,
leather, wool, zellige, saffron, glass, lamplight, found).

**Every hex value is sourced from `ontology.json`'s own `color_palette`**, and each
`MaterialSpec` carries a `source` string that is surfaced in the Build Mode inspector. So
the 3D scene's palette and the generation prompt's palette come from one authority.

Per-culture shell defaults (`SHELL_MATERIALS`):

| Culture | Floor | Wall |
|---|---|---|
| lebanese | `encaustic` | `limestone` |
| khaleeji | `sand` | `gypsum` |
| moroccan | `zellige` | `tadelakt` |
| all | `cedar` | `gypsum` |

*Floor and wall are always different materials per culture — a shared colour destroys the
horizon line in the 3D view.*

User-selectable: `WALL_CHOICES = [limestone, gypsum, tadelakt, sand]`,
`FLOOR_CHOICES = [limestone, encaustic, tadelakt, sand, cedar, zellige, marble]`. These
same two lists are the LLM planner's `wallMaterialKey` / `floorMaterialKey` enums.

---

## 8. Motifs — the flag replacement

National flag emoji were removed entirely (2026-08-10). Cultures are now represented by
`MotifTiles` (`src/components/cinema/svg/MotifTiles.tsx`):

| Culture | Motif key | Form |
|---|---|---|
| lebanese | `qanater` | Triple arch — limestone / cedar |
| khaleeji | `majlis` | Brass lamp, deep-shadow bench |
| moroccan | `zellige` | Square + the same square rotated 45° → an 8-pointed geometric lattice, **outline only** |

*The Moroccan tile was itself rebuilt: it began as a literal 5-pointed star, which reads as
a flag emblem rather than tessellation.*

---

## 9. Ontology consumers — the full list

| Consumer | Reads | For |
|---|---|---|
| `backend/prompt_builder.py` | `ontology/ontology.json` | Generation prompts |
| `backend/furniture.py` | `ontology/furniture.json` | Recommendation ranking, catalogue API |
| `backend/design_planner.py` | via `furniture.items_for_culture` | The catalogue projection given to the LLM |
| `src/lib/design/catalog.ts` | `ontology/furniture.json` **directly** | Build Mode catalogue — no duplicated dimensions |
| `src/lib/design/materials.ts` | `ontology.json` colour palettes | 3D material colours |
| `src/components/story/cultureData.ts` | **canonical** `ontology/ontology.json` | Culture DNA panel |
| `src/components/CulturalElementHighlighter.tsx` | **`src/data/ontology.json`** ⚠ | Arabic term + note on click |
| `src/components/RoomReport.tsx` | **`src/data/ontology.json`** ⚠ | Report element list |

---

## 10. What must never be claimed

- ❌ "The cultural vocabulary has been verified by a domain expert."
  → **Only Khaleeji and Moroccan. Lebanese and Persian are `verified: false`.**
- ❌ "Unverified terms are excluded from generation."
  → The `strict` mechanism exists but **is not enabled by any production caller**.
- ❌ "DAR supports four cultures."
  → Three. Persian is a prompt-only scalability demonstration.
- ❌ "Cultural accuracy has been measured."
  → The rating dimension exists in `feedback.CulturalAccuracy`, but the corpus currently
  holds **2 feedback rows**. See [16_EVALUATION.md](16_EVALUATION.md).

Related: [07_RAG_ARCHITECTURE.md](07_RAG_ARCHITECTURE.md) ·
[10_FURNITURE_AND_ASSETS.md](10_FURNITURE_AND_ASSETS.md) ·
[13_SDXL_CONTROLNET_LORA.md](13_SDXL_CONTROLNET_LORA.md)
