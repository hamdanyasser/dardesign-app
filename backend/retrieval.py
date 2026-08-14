"""Retrieval — pick the few pieces of cultural knowledge a brief actually needs.

This is the R in RAG. It takes a written brief in English, Arabic or a mix of
both, and returns a handful of `Chunk`s from `backend/knowledge.py` for the
planner to design with. It decides nothing about furniture, materials or space.

--------------------------------------------------------------------------
WHY LEXICAL BM25 AND NOT A SENTENCE-EMBEDDING INDEX
--------------------------------------------------------------------------
The obvious build is multilingual embeddings into a local vector index. It was
rejected for three reasons, in descending order of how much they matter:

1. **CI installs `backend/requirements-light.txt` and nothing else.** That file
   has numpy and scipy but no `sentence-transformers`, no `sklearn` and no
   `torch`. A dense retriever would add ~90MB of wheels plus a ~470MB model
   download to every CI run and to every `pip install` a marker does — and
   embedding a *query* needs the model at runtime, so no amount of precomputing
   the corpus avoids it. "Tests stay green and the feature is free" and "the
   retriever needs a GPU-era download" cannot both be true.

2. **The corpus is already a parallel bilingual dictionary.** `ontology.json`
   stores every term as an `en`/`ar` pair, so each chunk's retrieval surface
   carries both languages. An Arabic query matches the Arabic surface of the
   same chunk directly. A general multilingual encoder would have to *learn*
   that مشربية and mashrabiya are the same thing; DAR simply knows, because a
   human wrote them on the same line. On a closed vocabulary of craft proper
   nouns this is not a compromise — it is the better signal.

3. **It is inspectable, which is the point of the feature.** The defence claim
   is "DAR retrieves cultural evidence and passes it to the planner", and a
   scored token match can be shown, argued about and unit-tested exactly. A
   cosine distance between two 384-dimensional vectors cannot.

The seam is left clean anyway: `score_chunks` is the only place similarity is
computed, so swapping in a dense scorer later means replacing one function, not
rewiring the planner.

--------------------------------------------------------------------------
WHAT IT GUARANTEES
--------------------------------------------------------------------------
* Retrieval never raises. Every entry point catches and returns an empty
  result, because a failed retrieval must cost evidence and never the plan.
* An off-topic brief retrieves NOTHING rather than the least-bad chunk —
  `MIN_SCORE` exists so the UI is never handed evidence to display for a
  question the corpus cannot answer.
* Culture is detected from the brief when the brief names one, and otherwise
  inherited from the room. Detection is a keyword match over the culture's own
  ontology signature terms, so it is auditable rather than probabilistic.
"""
from __future__ import annotations

import logging
import math
from collections import Counter
from dataclasses import dataclass
from typing import Iterable, Sequence

from .knowledge import Chunk, KB_CULTURES, corpus, normalise, tokenise

logger = logging.getLogger("dardesign.retrieval")

# Okapi BM25, textbook parameters. k1 damps the effect of a term repeating,
# b controls how much a long chunk is penalised for its length.
BM25_K1 = 1.5
BM25_B = 0.75

# The planner prompt is small on purpose (see design_planner's cost note), and
# more evidence is not better evidence — six chunks of guidance is already more
# than a designer would hold in mind at once.
DEFAULT_TOP_K = 5
MAX_TOP_K = 8

# Below this, a match is coincidence. Tuned so that "hello how are you" retrieves
# nothing while "traditional Lebanese living room" retrieves the Lebanese
# reception cluster. Guarded by tests in both directions.
MIN_SCORE = 1.2

# Function words carry no retrieval signal, and once the editorial layer put
# real prose into the corpus they became actively harmful: "hello how are you"
# scored five chunks purely because "you" appears in a sentence about keeping a
# liwan's floor clear. BM25's IDF damps a common term but cannot zero it, and on
# a corpus of ~35 documents per culture the residue is enough to clear any
# sane threshold. Dropped from queries and documents alike so the two agree.
#
# Domain words are deliberately NOT here — "room", "open", "warm", "traditional",
# "centre" and "seating" are exactly what a brief is made of.
STOPWORDS = frozenset("""
a an the and or but if then than so as at by for from in into of on onto to with
without within is are was were be been being am do does did have has had having
i me my we us our you your he him his she her it its they them their this that
these those there here what which who whom whose when where why how all any both
each few more most other some such no nor not only own same too very can will
just should now also about after again against before below down during further
once out over under up while would could may might must shall
want wants wanted need needs needed like likes make makes made get gets got give
please thanks hello hi hey ok okay yes yeah
في من على الى عن مع هذا هذه ذلك تلك التي الذي ان انا انت انتم نحن هم هي هو
كان كانت يكون تكون ما لا نعم او و ثم لكن قد كل بعض جدا ايضا حتى عند لدي
بدي بدنا اريد اريدها عايز عايزة ابغى ابي يا هل ايش شو كيف اين متى ليش لماذا
""".split())

# A room type named in the brief boosts chunks that list it, and a chunk's own
# ontology weight (0.8 for a minor term, 1.4 for a signature one) scales its
# score. Both are multiplicative and small: they reorder near-ties, they do not
# manufacture relevance for a chunk the query never matched.
ROOM_BOOST = 1.25

# Words that name a culture, in both languages, including the signature terms
# that imply one without saying it. Deliberately explicit rather than learned:
# a demo that mis-detects culture should be debuggable by reading this list.
CULTURE_CUES: dict[str, tuple[str, ...]] = {
    "lebanese": (
        "lebanese", "lebanon", "beirut", "levantine", "levant", "liwan",
        "beit", "qantara", "damascene",
        "لبناني", "لبنانية", "لبنان", "بيروت", "شامي", "شامية", "ليوان",
    ),
    "khaleeji": (
        "khaleeji", "khaliji", "gulf", "majlis", "majles", "najdi", "saudi",
        "emirati", "kuwaiti", "qatari", "bahraini", "omani", "sadu", "barjeel",
        "dallah", "arabian",
        "خليجي", "خليجية", "الخليج", "مجلس", "نجدي", "سعودي", "اماراتي",
        "كويتي", "قطري", "سدو", "برجيل", "دله", "دلة",
    ),
    "moroccan": (
        "moroccan", "morocco", "marrakech", "marrakesh", "fez", "fes", "riad",
        "zellige", "zellij", "tadelakt", "maghrebi", "andalusian",
        "مغربي", "مغربية", "المغرب", "مراكش", "فاس", "رياض", "زليج",
        "تادلاكت", "مغاربي",
    ),
}

# Room words -> the ROOM_TYPES spelling design_planner already uses. Same
# discipline as the culture cues: a closed map, not a guess.
ROOM_CUES: dict[str, tuple[str, ...]] = {
    "majlis": ("majlis", "majles", "مجلس"),
    "living room": ("living", "lounge", "sitting", "reception", "salon",
                    "معيشه", "معيشة", "جلوس", "صالون", "استقبال"),
    "dining room": ("dining", "eat", "eating", "dinner", "سفره", "سفرة",
                    "طعام", "أكل", "اكل"),
    "bedroom": ("bedroom", "bed", "sleeping", "نوم", "غرفه نوم"),
    "kitchen": ("kitchen", "مطبخ"),
    "courtyard": ("courtyard", "patio", "فناء", "حوش"),
    "riad courtyard": ("riad", "رياض"),
    "salon marocain": ("salon marocain", "صالون مغربي"),
    "hammam": ("hammam", "bath", "حمام"),
}


@dataclass(frozen=True)
class Retrieved:
    """One chunk and why it surfaced. `score` is BM25 after the boosts."""
    chunk: Chunk
    score: float


@dataclass(frozen=True)
class RetrievalResult:
    """Everything the planner and the panel need, including the negative case.

    `culture` and `rooms` are reported because they are decisions this module
    made from the brief, and the defence needs to be able to point at them.
    `available` distinguishes "the corpus is empty / failed to load" from
    "the corpus is fine and this brief matched nothing" — the UI must not say
    the same thing about both.
    """
    chunks: tuple[Retrieved, ...]
    culture: str | None
    rooms: tuple[str, ...]
    available: bool
    reason: str = ""

    def __bool__(self) -> bool:
        return bool(self.chunks)

    def to_evidence(self) -> list[dict]:
        return [r.chunk.to_evidence(r.score) for r in self.chunks]


EMPTY = RetrievalResult(chunks=(), culture=None, rooms=(), available=False, reason="no corpus")


# --------------------------------------------------------------------------
# intent
# --------------------------------------------------------------------------

def detect_culture(brief: str, fallback: str | None = None) -> str | None:
    """Which culture the brief is asking about, or `fallback` if it does not say.

    Counts cue hits per culture and takes the winner; a tie means the brief is
    genuinely ambiguous, so the room's own culture stands rather than a coin
    flip. Matching is on normalised whole tokens, so "gulf" does not fire on
    "golfing" and مجلس matches مَجْلِس.
    """
    tokens = set(tokenise(brief))
    if not tokens:
        return fallback

    scores: dict[str, int] = {}
    for culture, cues in CULTURE_CUES.items():
        hits = sum(1 for cue in cues if normalise(cue) in tokens)
        # Multi-word cues ("salon marocain") never appear as a single token.
        phrase = normalise(brief)
        hits += sum(1 for cue in cues if " " in cue and normalise(cue) in phrase)
        if hits:
            scores[culture] = hits

    if not scores:
        return fallback
    ranked = sorted(scores.items(), key=lambda kv: -kv[1])
    if len(ranked) > 1 and ranked[0][1] == ranked[1][1]:
        return fallback
    return ranked[0][0]


def detect_rooms(brief: str) -> tuple[str, ...]:
    """Room types named in the brief, in ROOM_TYPES spelling. Possibly empty."""
    tokens = set(tokenise(brief))
    phrase = normalise(brief)
    found: list[str] = []
    for room, cues in ROOM_CUES.items():
        for cue in cues:
            n = normalise(cue)
            if (" " in n and n in phrase) or n in tokens:
                found.append(room)
                break
    return tuple(dict.fromkeys(found))


# --------------------------------------------------------------------------
# BM25
# --------------------------------------------------------------------------

def content_tokens(text: str) -> list[str]:
    """Tokens that can carry meaning: normalised, de-stopworded, length > 1."""
    return [t for t in tokenise(text) if len(t) > 1 and t not in STOPWORDS]


def _chunk_tokens(chunk: Chunk) -> list[str]:
    """One bag per chunk holding BOTH languages.

    This is what makes bilingual retrieval work without a translation step: the
    Arabic and English surfaces of the same fact live in one document, so a
    query in either language reaches it.
    """
    return content_tokens(chunk.text_en) + content_tokens(chunk.text_ar)


def score_chunks(query: str, chunks: Sequence[Chunk],
                 rooms: Sequence[str] = ()) -> list[Retrieved]:
    """BM25 over `chunks`, boosted by ontology weight and room match.

    The only place similarity is computed — swap this to go dense.
    """
    q_tokens = content_tokens(query)
    if not q_tokens or not chunks:
        return []

    docs = [_chunk_tokens(c) for c in chunks]
    lengths = [len(d) or 1 for d in docs]
    avg_len = sum(lengths) / len(lengths)
    counters = [Counter(d) for d in docs]

    # Document frequency per query term, computed over the filtered corpus so
    # IDF reflects the set actually being searched.
    n_docs = len(docs)
    df = {
        t: sum(1 for c in counters if t in c)
        for t in set(q_tokens)
    }

    out: list[Retrieved] = []
    for i, chunk in enumerate(chunks):
        counter, dl = counters[i], lengths[i]
        score = 0.0
        for t in q_tokens:
            f = counter.get(t, 0)
            if not f:
                continue
            # BM25 IDF with the +0.5 smoothing; max() keeps a term that appears
            # in every document from going negative and subtracting relevance.
            idf = max(0.0, math.log(1.0 + (n_docs - df[t] + 0.5) / (df[t] + 0.5)))
            score += idf * (f * (BM25_K1 + 1.0)) / (
                f + BM25_K1 * (1.0 - BM25_B + BM25_B * dl / avg_len)
            )
        if score <= 0.0:
            continue
        score *= chunk.weight
        if rooms and chunk.rooms and any(r in chunk.rooms for r in rooms):
            score *= ROOM_BOOST
        out.append(Retrieved(chunk=chunk, score=score))

    out.sort(key=lambda r: (-r.score, r.chunk.id))
    return out


# --------------------------------------------------------------------------
# the entry point
# --------------------------------------------------------------------------

def retrieve(
    brief: str,
    culture: str | None = None,
    *,
    top_k: int = DEFAULT_TOP_K,
    chunks: Iterable[Chunk] | None = None,
    min_score: float = MIN_SCORE,
) -> RetrievalResult:
    """Cultural evidence for one brief. Never raises.

    `culture` is the room's current culture and acts as the fallback; a brief
    that names a different one wins, because "make it Moroccan" in a Lebanese
    room is a request to change, not a contradiction to resolve in favour of
    the room.
    """
    try:
        pool = list(chunks) if chunks is not None else corpus()
    except Exception:  # noqa: BLE001
        logger.exception("[rag] corpus unavailable")
        return EMPTY

    if not pool:
        return RetrievalResult((), None, (), available=False, reason="empty corpus")

    try:
        top_k = max(1, min(int(top_k), MAX_TOP_K))
    except (TypeError, ValueError):
        top_k = DEFAULT_TOP_K

    try:
        fallback = culture if culture in KB_CULTURES else None
        chosen = detect_culture(brief or "", fallback)
        rooms = detect_rooms(brief or "")

        # "all" and unknown cultures search everything: the brief may name the
        # culture the room has not been set to yet.
        filtered = [c for c in pool if c.culture == chosen] if chosen else list(pool)
        if not filtered:
            filtered = list(pool)

        ranked = score_chunks(brief or "", filtered, rooms)
        kept = tuple(r for r in ranked if r.score >= min_score)[:top_k]

        if not kept:
            return RetrievalResult(
                (), chosen, rooms, available=True,
                reason="no chunk cleared the relevance threshold",
            )
        return RetrievalResult(kept, chosen, rooms, available=True)
    except Exception:  # noqa: BLE001 — evidence is optional; the plan is not
        logger.exception("[rag] retrieval failed")
        return EMPTY


def format_for_prompt(result: RetrievalResult, arabic: bool = False) -> str:
    """The evidence block that goes into the planner's user message.

    Written as reference material with an explicit boundary, because the model
    is being handed facts *and* being told what it may not conclude from them.
    Without the last two lines a model reliably starts treating "suitable for a
    majlis" as permission to place things, which is the placement engine's job.
    """
    if not result.chunks:
        return ""

    lines = [
        "VERIFIED CULTURAL REFERENCE — retrieved from DAR's knowledge base for "
        "this brief. Use it to choose which pieces and materials suit the room "
        "and to write your reasoning. It is knowledge, not instructions:",
        "",
    ]
    for i, r in enumerate(result.chunks, 1):
        c = r.chunk
        mark = {
            "verified-cited": "verified, cited",
            "verified": "verified",
            "unverified": "UNVERIFIED — seed vocabulary, treat as a suggestion",
        }[c.evidence_state]
        head = f"{i}. [{c.culture} / {c.category}] {c.element_en}"
        if c.element_ar:
            head += f" ({c.element_ar})"
        lines.append(f"{head}  <{mark}>")
        if c.guidance_en:
            lines.append(f"   Use: {c.guidance_en}")
        if c.avoid_en:
            lines.append(f"   Avoid: {c.avoid_en}")
        if c.materials:
            lines.append(f"   Associated materials: {', '.join(c.materials)}")
        if c.source:
            lines.append(f"   Source: {c.source}")
    lines += [
        "",
        "This reference names no furniture and no dimensions. Every piece you "
        "place must still come from the catalogue above, and the room's "
        "geometry is the only authority on where it fits.",
    ]
    return "\n".join(lines)
