# 16 — Evaluation

> ## ⚠ Read this box before anything else
>
> This document separates two things that are constantly confused:
>
> **(A) IMPLEMENTED METRIC CAPABILITY** — the code that computes and aggregates metrics.
> This is substantial, well-designed and genuinely defensible.
>
> **(B) ACTUAL MEASURED RESULTS** — what numbers currently exist in the database.
> **This is almost nothing.**
>
> **Gemini: never present a metric name as a result. Never invent a value.**

---

## 1. (B) FIRST — the actual measured state, 2026-08-14

Read directly from `backend/dardesign.db` and the filesystem.

### `history` table — 4 rows total

| Culture | SSIM | LPIPS | CLIP | PredictedCulture | Duration (s) |
|---|---|---|---|---|---|
| moroccan | 0.2759 | **null** | **null** | **null** | 47.4 |
| khaleeji | 0.3483 | **null** | **null** | **null** | 227.13 |
| lebanese | **null** | **null** | **null** | **null** | 160.28 |
| lebanese | 0.2531 | **null** | **null** | **null** | 344.51 |

### The evaluation corpus

| Artifact | State |
|---|---|
| `eval/results.csv` | **DOES NOT EXIST** |
| `evaluation_results` table | **0 rows** |
| `outputs/finals/`, `outputs/baselines/`, `outputs/ablations/` | **empty** (`.gitkeep` only) |
| `feedback` table | **2 rows** |
| `lpips` Python package | **not installed** |
| `open_clip` Python package | **not installed** |

### What this means, stated plainly

| Metric | Implemented? | Measured? | n |
|---|---|---|---|
| **SSIM** | ✅ Yes | ⚠ **Partially** | **3 designs** (0.2531, 0.2759, 0.3483) |
| **Generation duration** | ✅ Yes | ⚠ **Partially** | **4 designs** (47 s – 345 s) |
| **LPIPS** | ✅ Yes | ❌ **NO** | **0** |
| **CLIP score** | ✅ Yes | ❌ **NO** | **0** |
| **CLIP culture-recognition confusion matrix** | ✅ Yes | ❌ **NO** | **0** |
| **Human ratings** (3 dimensions) | ✅ Yes | ⚠ **Minimally** | **2 feedback rows** |
| **LoRA-vs-baseline ablation** | ✅ Yes | ❌ **NO** | **corpus not generated** |
| Segmentation accuracy (mIoU) | ❌ Not implemented | ❌ No | — |
| Depth accuracy | ❌ Not implemented | ❌ No | — |
| Layout preservation | ❌ Not implemented | ❌ No | — |
| FID / IS / KID | ❌ Not implemented | ❌ No | — |

> **The single most important honesty statement for the defense:**
>
> **DAR has an implemented evaluation *system*. It does not yet have evaluation *results*.**
> `README.md` says it plainly: *"Eval figures (CLIP confusion matrix + SSIM/LPIPS) are one
> T4 run away."* That is still true.

**Three SSIM values around 0.25–0.35 are also not a finding.** SSIM between a photograph
and a *redesigned* room is expected to be low — the point of the system is to change the
room. **Without a baseline arm to compare against, these numbers mean nothing.**

---

## 2. (A) — The implemented capability

### 2a. SSIM — `backend/quality.py`

**Hand-implemented on numpy + `scipy.ndimage.uniform_filter`**, reproducing
`skimage.metrics.structural_similarity` at its defaults **to 1e-9**.

```python
_SIZE = 256          # grayscale working size
_WIN  = 7            # uniform window
_K1, _K2 = 0.01, 0.03
# unbiased covariance n/(n-1); border cropped by (WIN-1)//2
```

> **Why hand-rolled:** `scikit-image` is **not in `requirements-light.txt`**, and SSIM has
> to run *inside the render request* and *inside the LIGHT Docker image*.

`ssim_paths(original, generated)` never raises; returns `None` on failure, rounded to 4 dp.
Computed **at generation time**, outside `_GEN_LOCK`.

### 2b. LPIPS and CLIP — deferred to a background task

```python
metrics_available() = find_spec("lpips") and find_spec("open_clip")
```

| Metric | Model |
|---|---|
| LPIPS | `lpips.LPIPS(net="alex")`, images to 256², normalised `a/127.5 - 1.0` |
| CLIP | `open_clip.create_model_and_transforms("ViT-B-32", pretrained="laion2b_s34b_b79k")` |

**The CLIP class prompts** (identical in `quality.py` and `eval/run_metrics.py` by design):

| Culture | Prompt |
|---|---|
| lebanese | *"a traditional Lebanese living room interior with qanater arches and cedar wood"* |
| khaleeji | *"a Khaleeji Gulf Arab majlis interior with floor cushions and gold accents"* |
| moroccan | *"a Moroccan riad interior with zellige mosaic tiles and brass lanterns"* |

`evaluate_pair(original, generated)` → `{ssim, lpips, clip_score (per-culture dict), predicted}`.

**Dispatch:** `POST /api/history` queues this as a **FastAPI background task after the save
responds**, only when `not edited and not light`. Failures leave the values `null`, and
`scripts/backfill_evaluation.py` can fill them in later — **it never overwrites a
generation-time SSIM**.

> **This is why every LPIPS/CLIP value is currently `null`: neither package is installed on
> the machine that has been serving the data backend.** The design is correct; the
> dependency is absent.

### 2c. Saved designs *are* the evaluation dataset

```
Save a design → SSIM at generation time → LPIPS + CLIP in a background task
                                        ↓
                    scores are COLUMNS ON THE history ROW
                                        ↓
              Culture vs PredictedCulture IS the confusion matrix
```

> **Storing scores as columns is what makes deletion total:** remove a design and it leaves
> every average and the confusion matrix in the same instant, with no side table to keep in
> step.
>
> **The dashboard aggregates ALL users, not the viewer.**

---

## 3. Two populations, both named

This is the strongest piece of statistical hygiene in the project.

| Population | Definition |
|---|---|
| **`roomsGenerated`** | Every saved design in the filters — edits and placeholders included |
| **`evaluableDesigns`** | `IsEdited = 0 AND IsLight = 0` — **the basis of every average** |
| `editedExcluded` / `lightExcluded` | Returned so **the arithmetic closes on screen** |

- `IsEdited = 1` — changed by Colour Control or Furniture Placement. A real design, but no
  longer the pipeline's own output.
- `IsLight = 1` — a `DARDESIGN_LIGHT` placeholder. **Never a timing or model statistic —
  a tint returns in milliseconds.** The *client* reports `light`, because the renderer and
  the accounts backend can be different hosts.

**Per-metric sample sizes are returned separately:** `sampleSize`, `ssimSampleSize`,
`lpipsSampleSize`, `clipSampleSize` — because each metric has its own `n`.

---

## 4. One filter builder — why the panels agree

```python
db._history_filters(culture, since, until, *, pipeline_only=False, alias="")
```

Every dashboard query over `history` is built from this one helper. Clauses:
`Culture = ?`, `CreatedAt >= ?`, `CreatedAt <= ?`, and when `pipeline_only`:
`IsEdited = 0 AND IsLight = 0`. `alias` prefixes columns for joined queries.

> **Every section takes the same `culture` + `since`/`until`, applied IN SQL**, and the page
> renders what comes back rather than narrowing anything itself — **an average cannot be
> filtered after it has been taken.**
>
> The docstring records the bug this fixed: an earlier date-only version let a culture
> filter move the rating panels while leaving history-derived figures global.

**`db.evaluation_coverage`** prints `n/total` for SSIM / LPIPS / CLIP / predicted / timed /
rated over that same corpus — **the denominators behind the averages**, so a reader can see
that an average of 3 is an average of 3.

**`db.culture_confusion`** — grouped by `(Culture, PredictedCulture)` over the same
pipeline-only corpus, with `AND Culture IS NOT NULL AND PredictedCulture IS NOT NULL`.
Cells show count + row %. `accuracy` is **`None` (not 0)** when nothing is classified.
**It is never labelled as human accuracy** — it is CLIP zero-shot recognition.

---

## 5. The ablation — computed, not displayed

`evaluation.automatic_metrics(path, culture)` reads **`eval/results.csv`** via
`csv.DictReader`, and splits rows by their `set` column (`lora` / `baseline`) using
`_row_set`.

> **Pooled, a LoRA row and its own baseline row landed in the same bucket.** Splitting by
> arm is what makes the comparison meaningful.

| Condition | Output |
|---|---|
| Both arms present | Metric-by-metric comparison with **deltas**, plus per-arm recognition and a `sameCorpus` check (sorted room-id sets compared) |
| One arm or no file | **An explicit "Ablation results not generated yet"** — never an invented delta |
| Always | `dateFilterable: false` — **the corpus has no timestamps, so it reports that rather than pretending the date filter applied** |

Arm labels: `lora` → *"DarDesign (LoRA)"*, `baseline` → *"Base SDXL (prompt-only)"*.

### ⚠ The panel is REMOVED from the page

For the FYP demo, the ablation panel was **removed from `/evaluation`**: the corpus has not
been rendered, so its only possible state was an empty "not generated yet" box, **which
reads as unfinished rather than as an honest absence.**

The endpoint still serves `automatic` and the typed shapes are still in `src/lib/api.ts`,
so restoring it is a paste job once `eval/results.csv` exists (the component is in git
history).

---

## 6. How the corpus is *meant* to be built — `eval/CORPUS.md`

**Not yet executed.** The documented procedure:

```
MyDrive/DarDesign/evaluation/
  inputs/       10–15 test room photos
                ⚠ must NOT be from datasets/*/images — measuring on the images a
                  LoRA trained on would flatter the result and an examiner will ask
  finals/<culture>/   raw LoRA output
  baselines/          prompt-only, for the ablation
  results/            results.csv, summary.md, confusion_matrix.png, metrics_bars.png
```

```bash
python scripts/generate_finals.py --rooms-dir $DRIVE/inputs --out $DRIVE/finals --by-culture --limit 15
python scripts/generate_finals.py --rooms-dir $DRIVE/inputs --out $DRIVE/baselines --no-lora --limit 15
# 15 rooms × 3 cultures = 45 images per set
make metrics    # SSIM + LPIPS → eval/results.csv
```

**Current inputs available:** `data/eval_rooms/` holds **1** file.
Corpus generation requires a GPU session.

---

## 7. Presentation rules the dashboard enforces

| Rule | Why |
|---|---|
| **Every unmeasured figure is `null` and renders as "No data", never `0`** | On a 1–5 scale a zero is **unreachable**, so printing one fabricates a result |
| A null score renders `—`, **never a zero-width bar** | `EvaluationChart` |
| "Average overall rating" is **labelled as derived** | It is the mean of the three rated dimensions; there is no Overall column |
| **SSIM / LPIPS / CLIP each carry their reading direction** | **LPIPS ↑ means a bigger change, not a worse model** |
| Charts are plain CSS bars | **No charting dependency** |
| `/admin/analytics` marks figures below `PRELIMINARY_BELOW = 12` as preliminary | Small-n honesty |

---

## 8. Human evaluation instruments (prepared, not run)

`docs/user-study-survey.md` and `docs/survey-kit.md` exist. The in-app instrument is the
three-dimension `FeedbackForm`.

**2 responses currently exist.** No user study has been conducted.

---

## 9. Answers to the questions a jury will actually ask

| Question | Honest answer |
|---|---|
| *"What are your results?"* | **"The evaluation system is implemented; the corpus has not been generated. I have SSIM on 3 designs and 2 human ratings. I can show you exactly how every metric is computed and aggregated, and the dashboard is built so it cannot show a number it does not have."** |
| *"Why is SSIM only 0.25?"* | SSIM between a photo and a *redesign* is expected to be low — changing the room is the goal. Without a baseline arm the absolute value carries no claim. |
| *"Is the LoRA better than prompt-only?"* | **Unmeasured.** The ablation is implemented and `/restyle`'s intensity slider exposes the comparison interactively, but no numbers have been produced. |
| *"How accurate is the segmentation?"* | **Unmeasured.** OneFormer is used as published; DAR has run no evaluation of it on Arab interiors. |
| *"Does Build Mode preserve layout?"* | **Unmeasured.** Verified qualitatively on a handful of GPU renders. A handful of renders is an observation, not a result. |
| *"Why not just report the numbers you have?"* | Because `n = 3` on one metric with no control arm is not a result, and the dashboard is deliberately built to say "No data" rather than fabricate one. |

---

## 10. What must never be claimed

- ❌ Any specific LPIPS, CLIP or confusion-matrix value — **there are none.**
- ❌ "The LoRA outperforms the baseline by X" — **no ablation has been run.**
- ❌ "Users rated DAR N/5" — **n = 2.**
- ❌ "Cultural accuracy is validated" — the *dimension* exists; the *data* does not.
- ❌ Any FID / IS / KID / mIoU figure — **not implemented.**
- ❌ Presenting the confusion matrix as human recognition — it is **CLIP zero-shot**.

---

Related: [13_SDXL_CONTROLNET_LORA.md](13_SDXL_CONTROLNET_LORA.md) ·
[15_ACCOUNTS_DATABASE_ADMIN.md](15_ACCOUNTS_DATABASE_ADMIN.md) ·
[20_DEFENSE_FACTS_AND_LIMITATIONS.md](20_DEFENSE_FACTS_AND_LIMITATIONS.md)
