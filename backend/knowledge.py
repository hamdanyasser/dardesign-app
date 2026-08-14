"""The cultural knowledge base — what DAR knows about Arab interiors, as evidence.

This is the K in RAG. It answers "what is culturally true here?", and nothing
else: it never names a catalogue id, never states a dimension, and never decides
where anything stands. Those belong to `furniture.json`, the planner and the
placement engine respectively, and keeping the boundary sharp is what stops a
knowledge base from quietly becoming a second, ungoverned designer.

**A chunk is assembled, not stored.** Three files each own one layer, and this
module joins them at load time rather than copying any of them:

  ontology/ontology.json    the canonical bilingual vocabulary — the term itself,
                            its Arabic, its weight, its `verified` flag, its hex.
  ontology/sources.md       public-source citations, for the minority of terms
                            that have one.
  ontology/knowledge/*.json the editorial layer — how to USE the element, how it
                            is typically misused, which rooms it suits, and the
                            alternative words a person might type when they mean it.

That split is deliberate. CLAUDE.md already records the pain of `ontology.json`
existing in two places; a knowledge base that re-stated the terms would be a
third copy and would drift the same way. Because the vocabulary is joined rather
than duplicated, the day Zainab flips Lebanese to `verified: true` the evidence
this module emits becomes verified too, with no edit here.

**Three evidence states, and they are not collapsed.** A chunk is
  * verified with a citation  — signed off AND traceable to a public source,
  * verified without one      — signed off, no page-level reference recorded,
  * unverified                — seed vocabulary awaiting review.
As of writing, Khaleeji and Moroccan are 30/30 verified and Lebanese is 0/30,
which is a real asymmetry in the project, not an error here. Only 6 terms per
culture carry a citation. The UI is expected to say which state it is showing;
this module's job is to never lose the distinction.

**Loading never raises.** A missing directory, a malformed JSON file or a term
that no longer exists yields a smaller corpus, not an exception — retrieval that
fails must cost evidence, never the plan. See `backend/retrieval.py`.
"""
from __future__ import annotations

import difflib
import json
import logging
import re
import unicodedata
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

logger = logging.getLogger("dardesign.knowledge")

ROOT = Path(__file__).resolve().parent.parent
ONTOLOGY_PATH = ROOT / "ontology" / "ontology.json"
SOURCES_PATH = ROOT / "ontology" / "sources.md"
KNOWLEDGE_DIR = ROOT / "ontology" / "knowledge"

# The cultures the knowledge base speaks for. Persian is deliberately absent:
# it is a prompt-only 4th culture with 0/23 verified terms and no LoRA, so
# presenting it as retrievable cultural evidence would overstate what DAR has.
KB_CULTURES = ("lebanese", "khaleeji", "moroccan")

# Ontology categories that become evidence. `negative_specific` is excluded on
# purpose — it is prompt-negative steering for the renderer, not knowledge about
# a culture, and feeding "no Moroccan zellige walls" to a planner reads as a fact
# about Moroccan design rather than an instruction to the image model.
KB_CATEGORIES = (
    "architectural", "materials", "color_palette",
    "lighting", "furniture", "textiles", "ornamentation",
)

# How close a sources.md row has to be to an ontology term to be treated as its
# citation. The two lists were written by hand and disagree in ways that are
# obvious to a reader and invisible to `==`: "Mashrabiya screens" vs "mashrabiya
# carved screens", "Mouqarnas" vs "carved plaster muqarnas". Containment catches
# the first kind, the ratio catches the spelling drift in the second. Anything
# below both thresholds gets NO citation, because inventing the link would be
# exactly the dishonesty this module exists to prevent.
_CITATION_RATIO = 0.72


# --------------------------------------------------------------------------
# text normalisation — shared with retrieval so the index and the query agree
# --------------------------------------------------------------------------

_TATWEEL = "ـ"
_DIACRITICS = re.compile(r"[ً-ٰٟ]")
_ALEF = re.compile(r"[آأإٱ]")   # آ أ إ ٱ  ->  ا
_NON_WORD = re.compile(r"[^\w؀-ۿ]+", re.UNICODE)


def normalise(text: str) -> str:
    """Fold Arabic orthography and case so a query can match a stored term.

    Arabic is written with several spellings of the same word: the hamza on an
    alef is routinely dropped when typing, ta marbuta and ha are interchanged,
    and diacritics are usually absent entirely. A user typing "مجلس خليجي" must
    reach a chunk stored as "مَجلس خليجى". This is the standard fold — unicode
    NFKC, strip diacritics and tatweel, unify alef forms, ta marbuta to ha,
    alef maqsura to ya — and it is applied identically to documents and queries,
    which is the only property that actually matters.
    """
    text = unicodedata.normalize("NFKC", text or "").lower()
    text = text.replace(_TATWEEL, "")
    text = _DIACRITICS.sub("", text)
    text = _ALEF.sub("ا", text)
    text = text.replace("ة", "ه")   # ة -> ه
    text = text.replace("ى", "ي")   # ى -> ي
    return text


# Arabic writes its prepositions, conjunctions and definite article as prefixes
# joined to the word, so a brief asking for zellige says "بزليج" — بـ + زليج —
# and a bare token match finds nothing. This is the standard light-stemming fix:
# strip the clitic, longest first. Suffixes are deliberately left alone; the
# prefixes are where nearly all the loss is on a noun-phrase corpus like this.
_PROCLITICS = ("وال", "فال", "بال", "كال", "لل", "ال", "و", "ف", "ب", "ل", "ك")

# Below this a "stem" is debris, not a word. The guard is what keeps بيت (house)
# from being shredded into يت.
_MIN_STEM = 3


def _strip_clitics(token: str) -> str:
    """Fold Arabic proclitics off a token.

    Applied identically to documents and queries, which is the property that
    matters: normalisation may legitimately over-strip — "ألوان" (colours)
    normalises to "الوان" and then looks like ال + وان — and that is harmless
    precisely because the stored side is folded the same way. An asymmetric
    stemmer is the bug; a consistent one is just a coarser alphabet.
    """
    for clitic in _PROCLITICS:
        if token.startswith(clitic) and len(token) - len(clitic) >= _MIN_STEM:
            return token[len(clitic):]
    return token


def tokenise(text: str) -> list[str]:
    """Normalised word tokens. Latin and Arabic in one pass.

    English is not stemmed on purpose: the corpus is a closed vocabulary of
    proper nouns and craft terms — zellige, sadu, mashrabiya, liwan — where a
    Porter stemmer does nothing useful, and the editorial alias lists carry the
    variation that matters, inspectably. Arabic gets clitic stripping only,
    because without it the language's own orthography hides the words.
    """
    return [_strip_clitics(t) for t in _NON_WORD.split(normalise(text)) if t]


# --------------------------------------------------------------------------
# the chunk
# --------------------------------------------------------------------------

@dataclass(frozen=True)
class Chunk:
    """One retrievable piece of cultural knowledge.

    `text_en`/`text_ar` are the retrieval surface — everything a query might
    match against, flattened. The display fields are kept separate so the UI
    shows the element and its guidance, not the alias soup that found it.
    """
    id: str
    culture: str
    category: str
    element_en: str
    element_ar: str
    guidance_en: str
    guidance_ar: str
    avoid_en: str
    avoid_ar: str
    rooms: tuple[str, ...]
    materials: tuple[str, ...]
    colors: tuple[str, ...]
    # From ontology.json — how strongly the term signals its culture (0.8..1.4).
    weight: float
    # From ontology.json. False is honest, not a defect: Lebanese is 0/30.
    verified: bool
    # From sources.md, or None. Never fabricated.
    source: str | None
    text_en: str = field(repr=False, default="")
    text_ar: str = field(repr=False, default="")

    @property
    def evidence_state(self) -> str:
        """`verified-cited` | `verified` | `unverified` — never collapsed to a bool."""
        if self.verified and self.source:
            return "verified-cited"
        return "verified" if self.verified else "unverified"

    def to_evidence(self, score: float | None = None) -> dict[str, Any]:
        """The shape that crosses the API to the planner panel.

        Deliberately small. The prompt gets the guidance; the UI gets the label,
        the provenance and enough metadata to be inspected during the defence.
        """
        out: dict[str, Any] = {
            "id": self.id,
            "culture": self.culture,
            "category": self.category,
            "elementEn": self.element_en,
            "elementAr": self.element_ar,
            "guidanceEn": self.guidance_en,
            "guidanceAr": self.guidance_ar,
            "verified": self.verified,
            "evidenceState": self.evidence_state,
            "source": self.source,
        }
        if score is not None:
            out["score"] = round(float(score), 4)
        return out


# --------------------------------------------------------------------------
# citations
# --------------------------------------------------------------------------

_H2 = re.compile(r"^##\s+(.+?)\s*$")
_ROW = re.compile(r"^\|\s*(.+?)\s*\|\s*(.+?)\s*\|\s*$")


def parse_sources(text: str) -> dict[str, dict[str, str]]:
    """`sources.md` -> {culture: {term: citation}}. Tolerant of formatting drift."""
    out: dict[str, dict[str, str]] = {}
    culture: str | None = None
    for line in (text or "").splitlines():
        heading = _H2.match(line)
        if heading:
            culture = heading.group(1).strip().lower()
            out.setdefault(culture, {})
            continue
        row = _ROW.match(line)
        if not row or culture is None:
            continue
        term, citation = row.group(1).strip(), row.group(2).strip()
        # Skip the header row and the |---|---| separator.
        if not term or term.lower() == "term" or set(term) <= {"-", ":"}:
            continue
        out[culture][term] = citation
    return out


def _citation_for(term_en: str, citations: dict[str, str]) -> str | None:
    """The public source for one ontology term, or None.

    Matching is deliberately conservative. A wrong citation is worse than none:
    it would put a real book's name behind a claim the book does not make.
    """
    term_tokens = set(tokenise(term_en))
    if not term_tokens:
        return None

    best: tuple[float, str | None] = (0.0, None)
    for cited_term, citation in citations.items():
        cited_tokens = set(tokenise(cited_term))
        if not cited_tokens:
            continue
        # Containment: every significant word of the shorter citation label
        # appears in the term. "Mashrabiya screens" is inside "mashrabiya
        # carved screens"; "Zellige tile" is inside "zellige geometric tile".
        if cited_tokens <= term_tokens or term_tokens <= cited_tokens:
            return citation
        ratio = difflib.SequenceMatcher(
            None, normalise(cited_term), normalise(term_en)
        ).ratio()
        if ratio > best[0]:
            best = (ratio, citation)

    return best[1] if best[0] >= _CITATION_RATIO else None


# --------------------------------------------------------------------------
# loading
# --------------------------------------------------------------------------

def _read_json(path: Path) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        logger.info("[kb] %s not present", path.name)
    except Exception:  # noqa: BLE001 — a broken KB costs evidence, never the plan
        logger.exception("[kb] could not read %s", path)
    return None


def _slug(text: str) -> str:
    s = re.sub(r"[^a-z0-9]+", "-", normalise(text)).strip("-")
    return s[:48] or "term"


def _clean_list(raw: Any, allowed: tuple[str, ...] | None = None) -> tuple[str, ...]:
    """Keep only strings, and only ones in the allowed vocabulary when given.

    The editorial layer is hand-written, so a room type or material key that is
    not one DAR can act on has to be dropped here rather than travel into a
    prompt as if it meant something.
    """
    if not isinstance(raw, list):
        return ()
    out = []
    for v in raw:
        if isinstance(v, str) and v.strip():
            v = v.strip()
            if allowed is None or v in allowed:
                out.append(v)
    return tuple(dict.fromkeys(out))


def _surface(element: str, guidance: str, avoid: str, aliases: tuple[str, ...],
             extra: tuple[str, ...] = ()) -> str:
    """Everything a query may legitimately match, in one string."""
    return " ".join(p for p in (element, *aliases, guidance, avoid, *extra) if p)


def load_chunks(
    cultures: tuple[str, ...] = KB_CULTURES,
    *,
    ontology_path: Path | None = None,
    sources_path: Path | None = None,
    knowledge_dir: Path | None = None,
) -> list[Chunk]:
    """Assemble the corpus. Returns [] rather than raising if anything is missing.

    Paths are injectable so the tests can build a corpus from fixtures without
    reaching the real ontology.
    """
    ontology = _read_json(ontology_path or ONTOLOGY_PATH)
    if not isinstance(ontology, dict) or "cultures" not in ontology:
        logger.warning("[kb] no usable ontology — cultural evidence is disabled")
        return []

    try:
        sources_text = (sources_path or SOURCES_PATH).read_text(encoding="utf-8")
    except Exception:  # noqa: BLE001
        sources_text = ""
    all_citations = parse_sources(sources_text)

    kdir = knowledge_dir or KNOWLEDGE_DIR
    chunks: list[Chunk] = []

    for culture in cultures:
        onto_culture = ontology.get("cultures", {}).get(culture)
        if not isinstance(onto_culture, dict):
            continue

        editorial = _read_json(kdir / f"{culture}.json")
        entries: dict[str, dict] = {}
        conventions: list[dict] = []
        if isinstance(editorial, dict):
            for e in editorial.get("entries", []) or []:
                if isinstance(e, dict) and isinstance(e.get("term_en"), str):
                    # Join key: the ontology's own spelling, normalised so a
                    # stray capital in the editorial file does not orphan it.
                    entries[normalise(e["term_en"])] = e
            conventions = [c for c in (editorial.get("conventions") or []) if isinstance(c, dict)]

        citations = all_citations.get(culture, {})

        for category in KB_CATEGORIES:
            terms = onto_culture.get(category)
            if not isinstance(terms, list):
                continue
            for term in terms:
                if not isinstance(term, dict) or not isinstance(term.get("en"), str):
                    continue
                en = term["en"]
                ed = entries.get(normalise(en), {})

                aliases_en = _clean_list(ed.get("aliasesEn"))
                aliases_ar = _clean_list(ed.get("aliasesAr"))
                guidance_en = str(ed.get("guidanceEn") or "").strip()
                guidance_ar = str(ed.get("guidanceAr") or "").strip()
                avoid_en = str(ed.get("avoidEn") or "").strip()
                avoid_ar = str(ed.get("avoidAr") or "").strip()
                ar = str(term.get("ar") or "").strip()
                hex_colour = term.get("hex")

                try:
                    weight = float(term.get("weight") or 1.0)
                except (TypeError, ValueError):
                    weight = 1.0

                chunks.append(Chunk(
                    id=f"{culture[:3]}-{category[:4]}-{_slug(en)}",
                    culture=culture,
                    category=category,
                    element_en=en,
                    element_ar=ar,
                    guidance_en=guidance_en,
                    guidance_ar=guidance_ar,
                    avoid_en=avoid_en,
                    avoid_ar=avoid_ar,
                    rooms=_clean_list(ed.get("rooms")),
                    materials=_clean_list(ed.get("materials")),
                    colors=(hex_colour,) if isinstance(hex_colour, str) else (),
                    weight=weight,
                    verified=bool(term.get("verified")),
                    source=_citation_for(en, citations),
                    text_en=_surface(en, guidance_en, avoid_en, aliases_en, (category,)),
                    text_ar=_surface(ar, guidance_ar, avoid_ar, aliases_ar),
                ))

        # Conventions are editorial-only: they describe how a room is used, which
        # no single ontology term states. They carry no citation and are never
        # marked verified, because nothing signed them off.
        for c in conventions:
            title_en = str(c.get("titleEn") or "").strip()
            if not title_en:
                continue
            title_ar = str(c.get("titleAr") or "").strip()
            guidance_en = str(c.get("guidanceEn") or "").strip()
            guidance_ar = str(c.get("guidanceAr") or "").strip()
            avoid_en = str(c.get("avoidEn") or "").strip()
            avoid_ar = str(c.get("avoidAr") or "").strip()
            aliases_en = _clean_list(c.get("aliasesEn"))
            aliases_ar = _clean_list(c.get("aliasesAr"))
            cid = str(c.get("id") or "").strip() or f"{culture}-{_slug(title_en)}"

            chunks.append(Chunk(
                id=cid,
                culture=culture,
                category="spatial_convention",
                element_en=title_en,
                element_ar=title_ar,
                guidance_en=guidance_en,
                guidance_ar=guidance_ar,
                avoid_en=avoid_en,
                avoid_ar=avoid_ar,
                rooms=_clean_list(c.get("rooms")),
                materials=_clean_list(c.get("materials")),
                colors=(),
                weight=1.0,
                verified=False,
                source=None,
                text_en=_surface(title_en, guidance_en, avoid_en, aliases_en),
                text_ar=_surface(title_ar, guidance_ar, avoid_ar, aliases_ar),
            ))

    logger.info(
        "[kb] %d chunks over %s (%d verified, %d cited)",
        len(chunks), ",".join(cultures),
        sum(1 for c in chunks if c.verified),
        sum(1 for c in chunks if c.source),
    )
    return chunks


_CORPUS: list[Chunk] | None = None


def corpus() -> list[Chunk]:
    """The process-wide corpus, built once. Cheap enough that this is only tidiness."""
    global _CORPUS
    if _CORPUS is None:
        _CORPUS = load_chunks()
    return _CORPUS


def reset_cache() -> None:
    """Drop the memoised corpus — used by the tests."""
    global _CORPUS
    _CORPUS = None
