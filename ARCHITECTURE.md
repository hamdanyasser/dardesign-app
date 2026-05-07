# DarDesign — architecture

```mermaid
flowchart TB
    subgraph Browser
        UZ[upload-zone.tsx<br/>≤10MB · ≥256px]
        SS[style-selector.tsx<br/>3 cultures]
        TP[/transform/page.tsx/]
        RP[/result/page.tsx/]
        BAS[before-after-slider.tsx]
        SD[share-dialog.tsx]
    end

    subgraph FastAPI ["FastAPI (backend/main.py)"]
        UP[/POST /upload/] --> JR[(jobs registry<br/>backend/jobs.py)]
        XF[/POST /transform/] --> JR
        ST[/GET /status/{id}/]
        RES[/GET /result/{id}/]
        SHT[/GET /share-token/{id}/]
        SHARE[/GET /share/{token}/]
        VAL[validators.py] --> UP
        ERR[errors.py<br/>bilingual codes]
    end

    subgraph Pipeline ["backend/transform.py"]
        PB[prompt_builder.py] --> PROMPT
        ONT[(ontology/ontology.json<br/>~25 terms × 3 cultures)] --> PB
        PROMPT([positive + negative<br/>EN + AR])

        IN[input PNG] --> DA[Depth Anything V2]
        IN --> OF[OneFormer ADE20K]
        DA --> CN1[ControlNet depth]
        OF --> CN2[ControlNet seg]

        PROMPT --> SDXL
        CN1 --> SDXL
        CN2 --> SDXL
        LORA[(per-culture LoRA<br/>models/loras/<culture>/)] -.lazy load.-> SDXL
        SDXL[SDXL base 1.0<br/>fp16 · enable_model_cpu_offload]

        SDXL -- OOM --> SD15[SD 1.5 + ControlNet 1.1<br/>fallback at 768²]
        SDXL --> OUT[output PNG]
        SD15 --> OUT
    end

    subgraph Scripts ["scripts/ (Kaggle T4)"]
        TRAIN[train_lora.py<br/>DreamBooth-LoRA · rank 16 · 1.5k steps]
        SWEEP[controlnet_sweep.py<br/>5 rooms × 4 weights × 3 cultures]
        FIN[generate_finals.py<br/>15 × 3 = 45]
        ABL[ablate.py<br/>--no-lora / --no-seg / --no-ontology]
        BL[baseline_grid.py<br/>Decor8 / RoomGPT slots → PDF]
        MET[metrics.py<br/>SSIM + LPIPS → CSV]
    end

    subgraph Data
        DS[(datasets/<culture>/<br/>images + captions.jsonl<br/>**Zainab handoff**)]
    end

    UZ -- File --> TP
    SS -- StyleId --> TP
    TP -- POST --> UP
    UP -- {job_id} --> TP
    TP -- POST --> XF
    XF -- async --> Pipeline
    TP -- nav --> RP
    RP -- poll 1.5s --> ST
    RP -- when done --> RES
    RP --> SD
    SD -- POST --> SHT
    SHARE --> Browser
    BAS --> RP

    DS -.curated by Zainab.-> TRAIN
    TRAIN -.safetensors.-> LORA
    SWEEP -.contact sheets.-> Reviewer[/picks winners/]
    Reviewer -- writes --> WIN[(configs/sweep_winners.json)]
    WIN --> FIN
    FIN --> Outputs[(outputs/finals/<br/>45 PNGs)]
    Outputs --> MET
    Outputs --> BL
```

## Module responsibilities

### `backend/`

| file | role |
|---|---|
| `main.py` | FastAPI surface; JobIdResponse / StatusResponse / ShareTokenResponse |
| `transform.py` | SDXL + dual ControlNet pipeline, lazy LoRA, OOM→SD1.5 fallback |
| `prompt_builder.py` | ontology → bilingual (positive, negative); seedable; weighted sampling |
| `validators.py` | mime allowlist, 10 MB cap, 256 px min-dim, PIL.verify |
| `errors.py` | every HTTPException carries `{code, message_en, message_ar}` |
| `jobs.py` | thread-safe registry; pending → queued → running → done/error |
| `share.py` | stateless HMAC token; `DARDESIGN_SHARE_SECRET`; 7-day TTL |

### `ontology/`

`ontology.json` is the single source of truth for the design vocabulary.
Schema: `{trigger, negative_universal, cultures.<culture>.{architectural,
materials, color_palette, lighting, furniture, textiles, ornamentation}}`.
Every entry carries a `verified: false` flag flipped to `true` after Zainab's
review pass.

### `scripts/`

Each script is import-clean on Windows (heavy ML imports are inside functions),
runs end-to-end on Kaggle T4, and reads `configs/pipeline.yaml` +
`configs/sweep_winners.json` so weights are tunable without code edits.

### Frontend (`src/`)

| file | role |
|---|---|
| `lib/api.ts` | typed client; `ApiError` with bilingual messages |
| `context/ImageContext.tsx` | image file, preview URL, jobId, result URL |
| `context/ThemeLanguageContext.tsx` | language (EN/AR), theme, all translations |
| `app/transform/page.tsx` | two-phase POST (upload → transform), redirect to /result?jobId= |
| `app/result/page.tsx` | poll /status, render before/after, download / share / try-another-style / start-over |
| `components/loading-screen.tsx` | progress prop drives the bar from real status; fallback to 8s timer |
| `components/error-banner.tsx` | bilingual error surface with optional retry CTA |
| `components/share-dialog.tsx` | copy-to-clipboard share modal (HMAC token URL) |

## Key design decisions

1. **One inference module, two modes.** `backend/transform.py` is canonical: it
   runs the real SDXL pipeline on Kaggle T4 and a placeholder branch
   (`DARDESIGN_LIGHT=1`) on a laptop, so FastAPI is testable end-to-end without a
   GPU. No mocks elsewhere.
2. **Lazy LoRA, prompt-only fallback.** If
   `models/loras/<culture>/dardesign-<culture>-lora.safetensors` is missing the
   pipeline logs a warning and continues prompt-only. Lets the rest of the
   system ship before training is done.
3. **Bilingual errors at the data layer.** Every `HTTPException` carries
   `{code, message_en, message_ar}`. The frontend renders whichever the user's
   language is — no client-side error mapping table.
4. **Stateless share tokens.** HMAC over `(job_id, exp)` keyed by
   `DARDESIGN_SHARE_SECRET`. No DB. Trade-off: tokens don't survive a backend
   restart unless you fix the env var; for a demo that's fine.
5. **Progress is real.** `/status` exposes `progress: 0.0–1.0`, the loading
   screen rides it. The 8-second floor is gone (it was a mock).
6. **Image quality > features.** Free T4 only, dual ControlNet stays. We
   accept a slower path (60s/image) before downgrading aesthetic.
