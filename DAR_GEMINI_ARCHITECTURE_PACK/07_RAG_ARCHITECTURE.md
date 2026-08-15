# 07 — RAG Architecture

> **Verdict, stated first and plainly:**
>
> # RAG IS NOT CURRENTLY IMPLEMENTED IN THIS REPOSITORY
>
> There is no retrieval step, no embedding model, no vector store, no chunking
> pipeline, and no similarity search over cultural knowledge anywhere in DAR.
>
> **Gemini: do NOT draw a "RAG" box, a "vector database", an "embedding" node, or a
> "retriever" arrow in any DAR diagram.** Doing so would put a component in front of
> a jury that does not exist in the code.

---

## 1. How this was verified

A repository-wide search was run across all Python, TypeScript, TSX, JSON and Markdown
files (excluding `node_modules/`, `.venv/`, `.next/`) for every standard marker of a
retrieval system:

| Searched for | Result in DAR source |
|---|---|
| `rag` (word-boundary) | 1 hit — a **comment** in `backend/guardrails.py` (see §3) |
| `embedding` / `embeddings` | Only in **LoRA training** context (`scripts/train_lora.py` caches SDXL *text encoder* embeddings) — unrelated to retrieval |
| `vector store` / `vectorstore` | 0 hits |
| `faiss` | 0 hits |
| `chroma` / `chromadb` | 0 hits |
| `sentence-transformers` | 0 hits |
| `retriev*` (retrieve/retriever/retrieval) | 0 hits in executable code |
| `top_k` / `topk` | 0 hits |
| `cosine` / `cosine_similarity` | 0 hits |
| `knowledge base` | 1 hit — prose in `docs/zainab-onboarding.md` describing `ontology.json` informally |

**Dependency evidence.** Neither `backend/requirements.txt` nor
`backend/requirements-light.txt` contains a single retrieval, embedding or vector-store
package. The full requirements file is the *heavier* of the two (it carries torch,
diffusers, transformers, LoRA training and metrics deps) and still has none.

**The only `similarity` in the codebase is image–text CLIP similarity used for
evaluation scoring** (`backend/quality.py`, `backend/db.py` — see
[16_EVALUATION.md](16_EVALUATION.md)). That is a *measurement* of a finished render, not
a retrieval step that feeds a prompt. It runs **after** generation, never before.

---

## 2. The one thing that looks like RAG and is not

`backend/guardrails.py` defines a function `filter_chunk(text)` whose module docstring
says:

```
2. filter_chunk(text)  — RAG/ontology chunks retrieved before
   prompt assembly. Drops lines that look like instructions to the model
   (prompt-injection) instead of design content.
```

This is the single mention of "RAG" in the repository, and it is **aspirational naming in
a comment**, not an implementation.

**What `filter_chunk` actually does:** it takes a string, splits it into lines, drops any
line matching a prompt-injection regex (`ignore all previous`, `system:`, `<|...|>`,
`jailbreak`, ` ``` `, etc.), and returns the surviving text truncated to 1200 chars.

**Where it is actually called:** exactly one place in production code —
`backend/prompt_builder.py` (~line 137):

```python
en = sanitize_prompt_fragment(filter_chunk(str(p.get("en", ""))))
ar = sanitize_prompt_fragment(filter_chunk(str(p.get("ar", ""))))
```

`p` here is a **static entry read directly out of `ontology/ontology.json`** — not a
retrieved chunk. So `filter_chunk` is a *defensive sanitiser applied to a hand-authored
JSON file*, protecting against the case where an ontology entry (which a non-developer
collaborator edits) contains text that would hijack the SD prompt.

> **Honest framing for the defense:** DAR treats its own cultural knowledge file as
> untrusted input and sanitises it before it reaches a model. That is a genuine and
> defensible security property. It is **not** retrieval-augmented generation.

---

## 3. What DAR has *instead* of RAG — and why it is arguably stronger here

DAR's cultural grounding is a **curated, closed, deterministic ontology lookup**. There
is no retrieval because there is nothing to retrieve *from* — the knowledge base is small
enough to be indexed by a dictionary key.

```
ontology/ontology.json                     ontology/furniture.json
  cultures[<culture>]                        items[] (27 pieces)
    architectural[]                            ↓
    materials[]                          catalogue_projection(culture)
    color_palette[]                            ↓  (ids + real dimensions only)
    lighting[]                           JSON-Schema `enum` of catalogue ids
    furniture[]                                ↓
    textiles[]                           LLM may ONLY emit ids in that enum
    ornamentation[]
        ↓  direct dict index by culture key — O(1), no search
  prompt_builder.build_prompts(culture, room, seed, per_category, strict)
        ↓
  positive_en / positive_ar / negative_en / negative_ar / trigger_en / trigger_ar
        ↓
  SDXL prompt
```

### Why this is not a weaker choice

| Property | Retrieval (RAG) | DAR's closed ontology |
|---|---|---|
| Can surface an irrelevant/wrong passage | Yes — depends on embedding quality | **No** — the culture key selects the whole vocabulary |
| Can the model cite something that does not exist | Yes, if retrieval misses | **No** — `catalogId` is a JSON-Schema `enum`; an invented id is *unrepresentable* |
| Requires an embedding model at runtime | Yes | **No** |
| Auditable by a domain expert | Hard (opaque vectors) | **Yes** — a reviewer opens one JSON file and reads every term |
| Scales to a large corpus | Yes | No — but DAR's corpus is ~30 terms × 4 cultures |

The corpus is **113 ontology terms in total** (30 Lebanese, 30 Khaleeji, 30 Moroccan, 23
Persian) plus **27 furniture items**. Retrieval over ~140 records would be strictly worse
than indexing them: it would add latency, a model dependency, and a new failure mode
(retrieving the wrong culture's terms) in exchange for nothing.

### The sampling that *does* happen

`prompt_builder._weighted_sample(items, k, rng, strict)` picks up to `per_category`
(default 2) items per category, **biased by each entry's `weight` field**, seeded by an
optional `seed` for reproducibility. This is *stratified weighted sampling from a known
list*, not similarity search. Same culture + same seed = same prompt, every time.

---

## 4. Where a jury might expect RAG, and what to say instead

| Jury question | Truthful answer |
|---|---|
| "Do you use RAG?" | No. Cultural grounding is a curated ontology indexed by culture key, plus a closed catalogue enforced as a JSON-Schema enum on the LLM's output. |
| "How does the LLM know about Khaleeji design?" | It is *told*, not asked to recall. The catalogue projection (ids + real dimensions) is placed in the prompt, and the schema physically prevents it from naming anything outside that list. See [06_LLM_DESIGN_PLANNER.md](06_LLM_DESIGN_PLANNER.md). |
| "How do you stop hallucinated furniture?" | Structured outputs with an `enum` of exactly the catalogue's ids, plus backend `validate_items()` and client `gatePlan()`. Not retrieval. See [08_SPATIAL_VALIDATION.md](08_SPATIAL_VALIDATION.md). |
| "Would RAG help?" | Only if the cultural corpus grew past what fits in a prompt — e.g. if Zainab's sourced material became hundreds of documents rather than a curated term list. It is a reasonable *future* direction, not current work. |

---

## 5. If RAG is added later — where it would attach

**This section is speculative and is labelled as such. It describes nothing that exists.**

The natural insertion point is between `ontology/` and `prompt_builder.build_prompts()` /
`design_planner.build_user_message()`. `filter_chunk()` is already positioned to be the
sanitiser on that path, which is presumably why it was named for it. Nothing else in the
architecture would need to move.

> **Gemini: if you illustrate this at all, it must be drawn in a clearly-marked
> "PLANNED / NOT IMPLEMENTED" zone with a dashed outline, visually separated from the
> implemented system, and it must not appear in the hero diagram at all.**

---

## Primary sources

- `backend/guardrails.py` — `filter_chunk`, `sanitize_prompt_fragment`, injection regex list
- `backend/prompt_builder.py` — the only caller; `_weighted_sample`, `build_prompts`
- `backend/design_planner.py` — `catalogue_projection`, `plan_schema`, `allowed_ids`
- `ontology/ontology.json`, `ontology/furniture.json` — the corpus itself
- `backend/requirements.txt`, `backend/requirements-light.txt` — dependency evidence
- `tests/test_kit.py` — tests for `filter_chunk` behaviour

Related: [05_CULTURAL_ONTOLOGY.md](05_CULTURAL_ONTOLOGY.md) ·
[06_LLM_DESIGN_PLANNER.md](06_LLM_DESIGN_PLANNER.md) ·
[25_IMPLEMENTED_VS_PLANNED.md](25_IMPLEMENTED_VS_PLANNED.md)
