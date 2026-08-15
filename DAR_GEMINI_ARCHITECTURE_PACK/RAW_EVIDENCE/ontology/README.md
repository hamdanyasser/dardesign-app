# Ontology

Single source of truth for the design vocabulary the prompt builder injects
into Stable Diffusion.

## Schema

```jsonc
{
  "version": "0.1.0",
  "trigger": {
    "<culture>": { "en": "...", "ar": "..." }   // unique LoRA-training token
  },
  "negative_universal": ["..."],                 // applied to every culture
  "cultures": {
    "<culture>": {
      "negative_specific": ["..."],              // additional culture-specific negatives
      "architectural":   [ <Term>, ... ],
      "materials":       [ <Term>, ... ],
      "color_palette":   [ <ColorTerm>, ... ],
      "lighting":        [ <Term>, ... ],
      "furniture":       [ <Term>, ... ],
      "textiles":        [ <Term>, ... ],
      "ornamentation":   [ <Term>, ... ]
    }
  }
}

// <Term>
{
  "en": "string",
  "ar": "string",
  "weight": 1.0,             // 0.5–1.5; consumed by prompt_builder weighting
  "verified": false,          // flip to true after Zainab's review
  "note": "optional"
}

// <ColorTerm> = <Term> + "hex": "#rrggbb"
```

## How Zainab edits / verifies

1. Open `ontology.json`.
2. For each entry:
   - confirm spelling (especially Arabic),
   - check that the EN/AR pair refers to the same thing,
   - flip `"verified": false` → `"verified": true` if accurate,
   - delete the entry if wrong, OR add a `"replacement": "..."` field if the term needs to change,
   - add new entries freely (just keep the schema).
3. Don't touch `version`, `trigger`, or `negative_universal` without flagging it.

The prompt builder reads this file at request time — no rebuild needed.

## Sourcing

See [sources.md](./sources.md) for the public-source provenance of each seed term.
