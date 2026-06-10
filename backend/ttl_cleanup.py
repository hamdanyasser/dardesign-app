"""
DarDesign — privacy auto-delete, 24h TTL (Week 2 Wed task).

Deletes user uploads + generated outputs older than TTL_HOURS unless the
file sits inside a protected subfolder (e.g. "saved/") or has a sibling
".keep" marker. Pure stdlib; runs as a background thread inside FastAPI.

Wire-up (FastAPI lifespan):
    from backend.ttl_cleanup import start_background_sweeper, PRIVACY_NOTICE

    @asynccontextmanager
    async def lifespan(app):
        stop = start_background_sweeper(
            [UPLOAD_DIR, OUTPUT_DIR], ttl_hours=24, interval_min=60
        )
        yield
        stop()

Expose PRIVACY_NOTICE on the landing/transform pages (bilingual string).
"""

from __future__ import annotations

import logging
import threading
import time
from pathlib import Path

log = logging.getLogger("dardesign.ttl")

PRIVACY_NOTICE = (
    "صورك تُحذف تلقائيًا بعد ٢٤ ساعة ما لم تحفظها. | "
    "Your photos are automatically deleted after 24 hours unless you save them."
)

DEFAULT_TTL_HOURS = 24
PROTECTED_DIR_NAMES = {"saved", "hero", "finals"}


def _is_protected(path: Path) -> bool:
    if any(part.lower() in PROTECTED_DIR_NAMES for part in path.parts):
        return True
    return path.with_suffix(path.suffix + ".keep").exists()


def sweep(
    root: str | Path,
    ttl_hours: float = DEFAULT_TTL_HOURS,
    *,
    now: float | None = None,
    dry_run: bool = False,
) -> dict:
    """Delete expired files under root. Returns a small report dict."""
    root = Path(root)
    report = {"root": str(root), "deleted": [], "kept": 0, "errors": []}
    if not root.exists():
        return report

    cutoff = (now if now is not None else time.time()) - ttl_hours * 3600

    for p in root.rglob("*"):
        # Dotfiles (.gitkeep etc.) are repo plumbing, never user data — skip.
        if not p.is_file() or p.suffix == ".keep" or p.name.startswith("."):
            continue
        try:
            if _is_protected(p):
                report["kept"] += 1
                continue
            if p.stat().st_mtime < cutoff:
                if not dry_run:
                    p.unlink()
                # as_posix() so report paths are stable across Windows/Linux
                report["deleted"].append(p.relative_to(root).as_posix())
            else:
                report["kept"] += 1
        except OSError as e:  # pragma: no cover
            report["errors"].append(f"{p}: {e}")

    # Prune now-empty directories (best effort, never the root itself).
    if not dry_run:
        for d in sorted((d for d in root.rglob("*") if d.is_dir()),
                        key=lambda d: len(d.parts), reverse=True):
            try:
                d.rmdir()
            except OSError:
                pass

    if report["deleted"]:
        log.info("TTL sweep %s: deleted %d, kept %d",
                 root, len(report["deleted"]), report["kept"])
    return report


def start_background_sweeper(
    roots: list[str | Path],
    ttl_hours: float = DEFAULT_TTL_HOURS,
    interval_min: float = 60,
):
    """Start a daemon thread sweeping `roots` every interval. Returns stop()."""
    stop_event = threading.Event()

    def _loop() -> None:
        while not stop_event.is_set():
            for r in roots:
                try:
                    sweep(r, ttl_hours)
                except Exception:  # pragma: no cover
                    log.exception("TTL sweep failed for %s", r)
            stop_event.wait(interval_min * 60)

    t = threading.Thread(target=_loop, name="dardesign-ttl", daemon=True)
    t.start()
    return stop_event.set
