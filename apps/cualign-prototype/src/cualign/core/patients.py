"""Patients and their scans, kept on this machine only (CUALIGN_OUT/patients, git-ignored with out/).

The workflow starts from a patient, not from a sample: pick or register a patient, upload that patient's scan, check
what was read from it, then plan. A patient has a pseudonymous id (P0001) and an alias the dentist chooses; the alias
is refused if it looks like a resident number, phone number or e-mail (rail_patterns.PII), and it is never sent to the
model — tools and the chat see only the case id "P0001-S1".

Identity rules (PR #36 review): patient and scan ids are never reused, even after deletion (counters persist), so a
new patient or scan can never inherit an old one's files, plans or confirmation. Every scan has a revision; changing
its tooth numbers bumps it, and the dentist's confirmation is tied to the revision it was given for.

Layout: patients/_ids.json, patients/<P0001>/patient.json, patients/<P0001>/scans/<S1>/{<tooth>.stl, gingiva.stl,
original/}.
"""
from __future__ import annotations

import json
import re
import shutil
import uuid
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import trimesh

from .intake import mirror_numbers, orient_scan
from cualign.server.rail_patterns import PII   # the regex rail list lives with the harness (#79)

ALIAS_MAX = 40
MEMO_MAX = 200
_PID = re.compile(r"P\d{4,}")
_SID = re.compile(r"S\d+")
_CASE_RE = re.compile(r"^(P\d{4,})-(S\d+)$")


def _root() -> Path:
    from . import store   # read at call time: tests and the server point CUALIGN_OUT elsewhere
    return Path(store.OUT_DIR) / "patients"


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _check_text(label: str, text: str, limit: int) -> str:
    text = (text or "").strip()
    if len(text) > limit:
        raise ValueError(f"{label}은(는) {limit}자 이하로 적어 주세요.")
    if any(re.search(p, text) for p in PII):
        raise ValueError(f"{label}에 주민번호·전화번호·이메일 같은 식별정보를 넣지 마세요. 가명만 사용합니다.")
    return text


def _pdir(pid: str) -> Path:
    """Patient folder; ids that are not exactly P<digits> are unknown (no path is ever built from them)."""
    if not isinstance(pid, str) or not _PID.fullmatch(pid):
        raise KeyError(f"unknown patient {pid}")
    root = _root().resolve()
    d = (root / pid).resolve()
    if d.parent != root:
        raise KeyError(f"unknown patient {pid}")
    return d


def _read(pid: str) -> dict:
    f = _pdir(pid) / "patient.json"
    if not f.exists():
        raise KeyError(f"unknown patient {pid}")
    return json.loads(f.read_text(encoding="utf-8"))


def _write(p: dict) -> None:
    d = _pdir(p["patient_id"])
    d.mkdir(parents=True, exist_ok=True)
    tmp = d / f".patient.{uuid.uuid4().hex}.json"
    tmp.write_text(json.dumps(p, ensure_ascii=False, indent=1), encoding="utf-8")
    tmp.replace(d / "patient.json")


def _next_patient_number() -> int:
    """Monotonic across deletions: the counter file only ever grows."""
    root = _root()
    root.mkdir(parents=True, exist_ok=True)
    f = root / "_ids.json"
    last = json.loads(f.read_text(encoding="utf-8"))["last_patient"] if f.exists() else 0
    existing = max((int(d.name[1:]) for d in root.glob("P*") if _PID.fullmatch(d.name)), default=0)
    n = max(last, existing) + 1
    f.write_text(json.dumps({"last_patient": n}), encoding="utf-8")
    return n


def list_patients() -> list[dict]:
    root = _root()
    if not root.exists():
        return []
    rows = [json.loads(f.read_text(encoding="utf-8")) for f in sorted(root.glob("P*/patient.json"))]
    return sorted(rows, key=lambda p: p["patient_id"])


def create_patient(alias: str, memo: str = "") -> dict:
    alias = _check_text("별칭", alias, ALIAS_MAX)
    memo = _check_text("메모", memo, MEMO_MAX)
    if not alias:
        raise ValueError("별칭을 입력하세요.")
    p = {"patient_id": f"P{_next_patient_number():04d}", "alias": alias, "memo": memo, "created_at": _now(),
         "scans": [], "last_scan": 0}
    _write(p)
    return p


def get_patient(pid: str) -> dict:
    return _read(pid)


def _scan(p: dict, sid: str) -> dict:
    if isinstance(sid, str) and _SID.fullmatch(sid):
        for s in p["scans"]:
            if s["scan_id"] == sid:
                return s
    raise KeyError(f"unknown scan {sid}")


def _check_meshes(folder: Path) -> None:
    """Every uploaded STL must be a readable, non-empty surface with finite coordinates."""
    for f in sorted(folder.glob("*.stl")):
        try:
            m = trimesh.load(f, process=False, force="mesh")
        except Exception as e:
            raise ValueError(f"스캔을 읽지 못했습니다: {type(e).__name__} ({f.name})") from None   # v2 board 08 wording (#112)
        if len(m.faces) == 0 or not np.isfinite(m.vertices).all() or float(m.area) <= 0.0:
            raise ValueError(f"스캔을 읽지 못했습니다: 면이 없거나 넓이가 0인 메시 ({f.name})")


def add_scan(pid: str, files: dict[str, bytes]) -> dict:
    """Validate and align the upload in a fresh folder, then register it under a never-used scan id."""
    p = _read(pid)
    teeth = [n for n in files if Path(n).stem.isdigit()]
    if not teeth:
        raise ValueError("치아별 STL(<치아번호>.stl, FDI 11~17·21~27)을 한 개 이상 올려 주세요. 잇몸 파일만으로는 계획할 수 없습니다.")
    scans = _pdir(pid) / "scans"
    scans.mkdir(parents=True, exist_ok=True)
    incoming = scans / f".incoming-{uuid.uuid4().hex}"
    incoming.mkdir()
    try:
        for name, data in files.items():
            (incoming / name).write_bytes(data)
        _check_meshes(incoming)
        try:
            orientation = orient_scan(incoming)
        except Exception as e:
            raise ValueError(f"방향 정렬에 실패했습니다 ({type(e).__name__}). 치아 파일이 한 악궁의 것인지 확인하세요.") from None
        p = _read(pid)                                       # re-read: another upload may have registered meanwhile
        n = max(p.get("last_scan", 0), max((int(s["scan_id"][1:]) for s in p["scans"]), default=0)) + 1
        sid = f"S{n}"
        incoming.rename(scans / sid)                         # fails instead of merging if the folder exists
    except Exception:
        shutil.rmtree(incoming, ignore_errors=True)
        raise
    scan = {"scan_id": sid, "case_id": f"{pid}-{sid}", "arch": "upper", "uploaded_at": _now(),
            "teeth": sorted(int(Path(t).stem) for t in teeth), "gingiva": "gingiva.stl" in files,
            "orientation": orientation, "revision": 1, "confirmed_revision": None, "confirmed_at": None}
    p["scans"].append(scan)
    p["last_scan"] = n
    _write(p)
    return scan


def confirm_scan(pid: str, sid: str, revision: int | None = None) -> dict:
    """The dentist checked the tooth numbers and the orientation of this revision on the input-check screen."""
    p = _read(pid)
    s = _scan(p, sid)
    if revision is not None and int(revision) != s.get("revision", 1):
        raise ValueError("화면의 스캔이 최신이 아닙니다(번호가 바뀌었습니다). 입력 확인 화면을 다시 열어 확인하세요.")
    s["confirmed_revision"] = s.get("revision", 1)
    s["confirmed_at"] = _now()
    _write(p)
    return s


def mirror_scan_numbers(pid: str, sid: str) -> dict:
    """Renumber u -> 17 - u; a new revision, so the confirmation and every plan of the old numbering lapse."""
    p = _read(pid)
    s = _scan(p, sid)
    s["teeth"] = mirror_numbers(_pdir(pid) / "scans" / sid)
    o = dict(s.get("orientation") or {})
    o["side"] = {"reversed": "ok", "ok": "reversed"}.get(o.get("side"), o.get("side"))
    o["renumbered"] = not o.get("renumbered", False)
    s["orientation"] = o
    s["revision"] = s.get("revision", 1) + 1
    s["confirmed_revision"] = None
    s["confirmed_at"] = None
    _write(p)
    return s


def input_state(case_id: str) -> dict | None:
    """{"revision", "confirmed"} for a patient scan case id; None for anything else (samples, anonymous uploads)."""
    m = _CASE_RE.match(case_id or "")
    if not m:
        return None
    try:
        s = _scan(_read(m.group(1)), m.group(2))
    except KeyError:
        return {"revision": None, "confirmed": False, "deleted": True}
    rev = s.get("revision", 1)
    return {"revision": rev, "confirmed": s.get("confirmed_revision") == rev}


def is_confirmed(case_id: str) -> bool | None:
    st = input_state(case_id)
    return None if st is None else st["confirmed"]


def remove_scan(pid: str, sid: str) -> str:
    p = _read(pid)
    s = _scan(p, sid)
    p["scans"] = [x for x in p["scans"] if x["scan_id"] != sid]
    _write(p)
    shutil.rmtree(_pdir(pid) / "scans" / sid, ignore_errors=True)
    return s["case_id"]


def delete_patient(pid: str) -> list[str]:
    p = _read(pid)
    shutil.rmtree(_pdir(pid), ignore_errors=True)
    return [s["case_id"] for s in p["scans"]]


def case_folder(case_id: str) -> Path | None:
    """Folder of a patient scan case id ("P0001-S1"), or None when the id is not a registered patient scan."""
    m = _CASE_RE.match(case_id or "")
    if not m:
        return None
    try:
        _scan(_read(m.group(1)), m.group(2))
    except KeyError:
        return None
    folder = _pdir(m.group(1)) / "scans" / m.group(2)
    return folder if folder.is_dir() else None
