"""A plan's export zip, built in the background from the moment it is approved (answer-polish (9)).

«확정하고 내려받기» used to build the whole zip when stl.zip was requested: the per-tooth stage files are cheap (about
0.06 s per stage) but the print models (gum skin, sockets filled, solid base) cost 0.5-0.7 s per stage here and far
more on a slower machine (22-106 s measured on the demo laptop). Now approval starts the build in a thread, the print
models are built per stage on a small thread pool, the result is cached by plan id (a plan is immutable once approved:
the approval's fingerprint is the cache key), GET /api/plans/{id}/export-status reports «N/20 단계», and stl.zip serves
the cache at once or waits for the running build (as before, off the event loop).
"""
from __future__ import annotations

import os
import threading
import uuid
import zipfile
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from cualign.core import planner
from cualign.core.print_model import GumRig, PrintModelError, build_model, model_name, readme

WORKERS = 4   # print-model threads per build; numpy and manifold release the GIL for most of the work


class ExportJob:
    def __init__(self, plan_id: str, fingerprint: str | None, total: int, path: Path):
        self.plan_id, self.fingerprint, self.total, self.path = plan_id, fingerprint, total, path
        self.done = 0
        self.ready = False
        self.error: str | None = None
        self.report: dict = {}
        self.finished = threading.Event()
        self.thread: threading.Thread | None = None

    def tick(self) -> None:
        self.done += 1

    @property
    def building(self) -> bool:
        return not self.finished.is_set()

    def status(self) -> dict:
        return {"building": self.building, "done": self.done, "total": self.total, "ready": self.ready,
                **({"error": self.error} if self.error else {})}

    def wait(self) -> "ExportJob":
        self.finished.wait()
        return self


JOBS: dict[str, ExportJob] = {}
_LOCK = threading.Lock()


def status(plan_id: str, total: int) -> dict:
    job = JOBS.get(plan_id)
    return job.status() if job else {"building": False, "done": 0, "total": total, "ready": False}


def start(plan_id: str, case, stages: list[dict], case_id: str, path: Path, fingerprint: str | None) -> ExportJob:
    """The job building `path` for this approved snapshot: the running or finished one when its fingerprint matches
    and its file is still there, else a new one started now."""
    with _LOCK:
        job = JOBS.get(plan_id)
        if job and job.fingerprint == fingerprint and (job.building or (job.ready and path.exists())):
            return job
        job = ExportJob(plan_id, fingerprint, len(stages), path)
        JOBS[plan_id] = job
        job.thread = threading.Thread(target=_run, args=(job, case, stages, case_id), daemon=True, name=f"export-{plan_id}")
        job.thread.start()
    return job


def forget(plan_id: str) -> None:
    with _LOCK:
        JOBS.pop(plan_id, None)


def _run(job: ExportJob, case, stages: list[dict], case_id: str) -> None:
    try:
        job.report = build_zip(case, stages, case_id, job.path, progress=job.tick)
        job.ready = True
    except Exception as e:   # noqa: BLE001 - the download reports it; the screen's status shows it
        job.error = f"{type(e).__name__}: {e}"
    finally:
        job.finished.set()


def build_zip(case, stages: list[dict], case_id: str, path: Path, progress=None, workers: int = WORKERS) -> dict:
    """The stage files (planner.export_zip) and the print models (one per stage, built on `workers` threads, `progress()`
    called as each finishes) into `path`, under a temporary name moved into place. Returns the print-model report."""
    tmp = path.with_name(f"{path.name}.{uuid.uuid4().hex}.tmp")
    try:
        planner.export_zip(case, stages, str(tmp))
        files, report = print_models(case, stages, case_id, progress=progress, workers=workers)
        with zipfile.ZipFile(tmp, "a", zipfile.ZIP_DEFLATED) as z:
            for name, data in files.items():
                z.writestr(f"print_models/{name}", data)
            z.writestr("print_models/README.txt", readme(report))
        os.makedirs(path.parent, exist_ok=True)
        os.replace(tmp, path)
    finally:
        tmp.unlink(missing_ok=True)
    return report


def print_models(case, stages: list[dict], case_id: str, progress=None, workers: int = WORKERS) -> tuple[dict[str, bytes], dict]:
    """print_model.print_models with the stages built in parallel and a progress callback; the same report shape."""
    tick = progress or (lambda: None)
    try:
        rig = GumRig(case)
    except PrintModelError as e:
        for _ in stages:
            tick()
        return {}, {"status": "skipped", "n_files": 0, "reason": str(e),
                    "reason_ko": "잇몸 스캔(gingiva.stl)이 없어 단계별 프린트용 모형을 만들지 않았습니다."}

    def one(item):
        si, disp = item
        try:
            m = build_model(case, disp, rig)
            out = (si, model_name(case_id, si), m.export(file_type="stl"), len(m.faces), None)
        except PrintModelError as e:
            out = (si, None, None, 0, str(e))
        tick()
        return out

    with ThreadPoolExecutor(max_workers=max(1, workers)) as ex:
        results = list(ex.map(one, enumerate(stages, 1)))
    files = {name: data for _, name, data, _, err in results if err is None}
    failed = [{"stage": si, "reason": err} for si, _, _, _, err in results if err is not None]
    faces = [n for _, _, _, n, err in results if err is None]
    report = {"status": "ok" if not failed else ("partial" if files else "failed"), "n_files": len(files),
              "n_stages": len(stages), "failed": failed, "max_faces": max(faces, default=0)}
    return files, report
