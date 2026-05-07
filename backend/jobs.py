"""Tiny in-memory job store. Single-process, single-worker — fine for the demo."""
from __future__ import annotations

import threading
import time
import uuid
from dataclasses import dataclass, field, asdict
from enum import Enum
from typing import Optional


class JobStatus(str, Enum):
    pending = "pending"      # uploaded, transform not yet requested
    queued = "queued"        # transform requested, waiting for worker
    running = "running"      # actively generating
    done = "done"
    error = "error"


@dataclass
class Job:
    id: str
    status: JobStatus = JobStatus.pending
    input_path: Optional[str] = None
    output_path: Optional[str] = None
    style: Optional[str] = None
    progress: float = 0.0          # 0.0–1.0; updated by worker via Jobs.update_progress
    error_code: Optional[str] = None
    error_message_en: Optional[str] = None
    error_message_ar: Optional[str] = None
    created_at: float = field(default_factory=time.time)
    updated_at: float = field(default_factory=time.time)

    def public(self) -> dict:
        d = asdict(self)
        d["status"] = self.status.value
        # Don't leak filesystem paths over the wire
        d.pop("input_path", None)
        d.pop("output_path", None)
        return d


class Jobs:
    """Threadsafe job registry. Use the module-level `jobs` singleton."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._store: dict[str, Job] = {}

    def create(self, input_path: str) -> Job:
        with self._lock:
            jid = uuid.uuid4().hex
            job = Job(id=jid, status=JobStatus.pending, input_path=input_path)
            self._store[jid] = job
            return job

    def get(self, job_id: str) -> Optional[Job]:
        with self._lock:
            return self._store.get(job_id)

    def list(self) -> list[Job]:
        with self._lock:
            return list(self._store.values())

    def transition(
        self,
        job_id: str,
        status: JobStatus,
        *,
        style: str | None = None,
        output_path: str | None = None,
        error_code: str | None = None,
        error_en: str | None = None,
        error_ar: str | None = None,
    ) -> Optional[Job]:
        with self._lock:
            j = self._store.get(job_id)
            if j is None:
                return None
            j.status = status
            if style is not None:
                j.style = style
            if output_path is not None:
                j.output_path = output_path
            if error_code is not None:
                j.error_code = error_code
                j.error_message_en = error_en
                j.error_message_ar = error_ar
            j.updated_at = time.time()
            return j

    def update_progress(self, job_id: str, progress: float) -> None:
        with self._lock:
            j = self._store.get(job_id)
            if j is None:
                return
            j.progress = max(0.0, min(1.0, progress))
            j.updated_at = time.time()


jobs = Jobs()
