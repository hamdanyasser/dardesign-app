"""
DarDesign — injection guardrails (Week 2 Fri task).

Four defenses, all dependency-free stdlib + regex:

1. sanitize_prompt_fragment(text)  — user/ontology text that reaches the
   SD prompt or the Conversational Designer. Allowlists Arabic + Latin,
   strips control chars and prompt-syntax abuse, hard length cap.
2. filter_chunk(text)              — RAG/ontology chunks retrieved before
   prompt assembly. Drops lines that look like instructions to the model
   (prompt-injection) instead of design content.
3. validate_upload(filename, data) — extension allowlist + magic-byte check
   + size cap for /redesign images.
4. clamp_params(...)               — server-side bounds for ControlNet
   weights / steps / guidance so the API can't be driven out of the
   quality envelope.

Wire-up (FastAPI):
    from backend.guardrails import (
        sanitize_prompt_fragment, filter_chunk, validate_upload, clamp_params
    )
    ok, reason = validate_upload(file.filename, raw_bytes)
    if not ok:
        raise HTTPException(400, reason)
"""

from __future__ import annotations

import re
import unicodedata

# --------------------------------------------------------------------------
# 1. Prompt-fragment sanitizer
# --------------------------------------------------------------------------
_ALLOWED = re.compile(
    r"[^0-9A-Za-z\u0600-\u06FF\u0750-\u077F\s.,;:!?'\"()\-–—%/&+]"
)
_WS = re.compile(r"\s+")
MAX_FRAGMENT_LEN = 480


def sanitize_prompt_fragment(text: str, max_len: int = MAX_FRAGMENT_LEN) -> str:
    """Make arbitrary text safe to embed in an SD/LLM prompt."""
    if not isinstance(text, str):
        return ""
    # Strip control / format characters (incl. RTL-override attacks U+202E etc.)
    text = "".join(
        ch for ch in text if unicodedata.category(ch)[0] != "C"
    )
    text = _ALLOWED.sub(" ", text)
    text = _WS.sub(" ", text).strip()
    return text[:max_len]


# --------------------------------------------------------------------------
# 2. Retrieved-chunk filter (anti prompt-injection)
# --------------------------------------------------------------------------
_INJECTION_PATTERNS = [
    r"ignore (all|any|previous|prior|above)",
    r"disregard (all|any|previous|prior|above)",
    r"forget (everything|all|previous|prior)",
    r"\bsystem\s*[:>]",
    r"\bassistant\s*[:>]",
    r"you (are|must|should) (now |always |never )?(act|behave|respond|reply|pretend)",
    r"new (instructions?|system prompt|persona)",
    r"\btool[_ ]?(call|use)\b",
    r"<\s*/?\s*(system|prompt|instructions?)\s*>",
    r"<\|.*?\|>",
    r"\bjailbreak\b",
    r"\bAPI[_ ]?key\b",
    r"reveal (your|the) (prompt|instructions|system)",
    r"```",
]
_INJECTION_RE = re.compile("|".join(_INJECTION_PATTERNS), re.IGNORECASE)


def line_is_suspicious(line: str) -> bool:
    return bool(_INJECTION_RE.search(line))


def filter_chunk(chunk: str, max_len: int = 1200) -> str:
    """
    Keep design content, drop instruction-shaped lines.
    Returns "" if the whole chunk is suspicious — caller should skip it.
    """
    if not isinstance(chunk, str):
        return ""
    kept = [
        ln for ln in chunk.splitlines()
        if ln.strip() and not line_is_suspicious(ln)
    ]
    cleaned = "\n".join(kept).strip()
    return cleaned[:max_len]


# --------------------------------------------------------------------------
# 3. Upload validation
# --------------------------------------------------------------------------
ALLOWED_EXT = {".jpg", ".jpeg", ".png", ".webp"}
MAX_UPLOAD_MB = 8

_MAGIC = (
    (b"\xff\xd8\xff", {".jpg", ".jpeg"}),          # JPEG
    (b"\x89PNG\r\n\x1a\n", {".png"}),              # PNG
)


def _ext_of(filename: str) -> str:
    dot = filename.rfind(".")
    return filename[dot:].lower() if dot != -1 else ""


def validate_upload(
    filename: str, data: bytes, max_mb: int = MAX_UPLOAD_MB
) -> tuple[bool, str]:
    """Return (ok, reason). reason is bilingual-friendly and user-safe."""
    ext = _ext_of(filename or "")
    if ext not in ALLOWED_EXT:
        return False, "Unsupported file type — use JPG, PNG or WebP. | نوع الملف غير مدعوم"
    if len(data) > max_mb * 1024 * 1024:
        return False, f"Image larger than {max_mb} MB. | حجم الصورة أكبر من {max_mb} م.ب"
    if len(data) < 64:
        return False, "File is empty or corrupted. | الملف فارغ أو تالف"

    # Magic-byte check: extension must match real content.
    if ext in {".jpg", ".jpeg", ".png"}:
        for magic, exts in _MAGIC:
            if data.startswith(magic):
                if ext in exts:
                    return True, "ok"
                return False, "File content does not match its extension. | محتوى الملف لا يطابق امتداده"
        return False, "Not a valid image file. | الملف ليس صورة صالحة"

    if ext == ".webp":
        if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
            return True, "ok"
        return False, "Not a valid WebP image. | الملف ليس صورة WebP صالحة"

    return False, "Unsupported file type. | نوع الملف غير مدعوم"


# --------------------------------------------------------------------------
# 4. Parameter clamping
# --------------------------------------------------------------------------
ALLOWED_STYLES = {"lebanese", "khaleeji", "moroccan", "persian"}


def validate_style(style: str) -> str:
    s = (style or "").strip().lower()
    if s not in ALLOWED_STYLES:
        raise ValueError(f"Unknown style '{style}'.")
    return s


def clamp_params(
    *,
    cn_depth: float = 0.8,
    cn_seg: float = 0.6,
    steps: int = 30,
    guidance: float = 7.0,
) -> dict:
    """Server-side bounds — keeps the API inside the quality envelope."""
    return {
        "cn_depth": float(min(max(cn_depth, 0.3), 1.3)),
        "cn_seg": float(min(max(cn_seg, 0.2), 1.0)),
        "steps": int(min(max(steps, 15), 45)),
        "guidance": float(min(max(guidance, 3.0), 12.0)),
    }
