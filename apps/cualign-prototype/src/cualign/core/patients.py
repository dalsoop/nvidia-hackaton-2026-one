"""Patients and their scans, kept on this machine only (CUALIGN_OUT/patients, git-ignored with out/).

The workflow starts from a patient, not from a sample: pick or register a patient, upload that patient's scan, check
what was read from it, then plan. A patient has a pseudonymous id (P0001) and an alias the dentist chooses; the alias
is refused if it looks like a resident number, phone number or e-mail (rail_patterns.PII), and it is never sent to the
model — tools and the chat see only the case id "P0001-S1".

Layout: patients/<P0001>/patient.json and patients/<P0001>/scans/<S1>/{<tooth>.stl, gingiva.stl}.
"""
from __future__ import annotations

import json
import re
import shutil
from datetime import datetime, timezone
from pathlib import Path

from .intake import mirror_numbers, orient_scan
from .rail_patterns import PII

ALIAS_MAX = 40
MEMO_MAX = 200
_CASE_RE = re.compile(r"^(P\d{4})-(S\d+)$")


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


def _read(pid: str) -> dict:
    f = _root() / pid / "patient.json"
    if not f.exists():
        raise KeyError(f"unknown patient {pid}")
    return json.loads(f.read_text(encoding="utf-8"))


def _write(p: dict) -> None:
    d = _root() / p["patient_id"]
    d.mkdir(parents=True, exist_ok=True)
    (d / "patient.json").write_text(json.dumps(p, ensure_ascii=False, indent=1), encoding="utf-8")


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
    n = max((int(p["patient_id"][1:]) for p in list_patients()), default=0) + 1
    p = {"patient_id": f"P{n:04d}", "alias": alias, "memo": memo, "created_at": _now(), "scans": []}
    _write(p)
    return p


def get_patient(pid: str) -> dict:
    return _read(pid)


def add_scan(pid: str, files: dict[str, bytes]) -> dict:
    """Save one upper-arch scan (per-tooth <n>.stl plus optional gingiva.stl) and register it on the patient.
    The caller validates that the folder loads as a Case; on failure it calls remove_scan."""
    p = _read(pid)
    teeth = [n for n in files if Path(n).stem.isdigit()]
    if not teeth:
        raise ValueError("치아별 STL(<치아번호>.stl, Universal 상악 2~15)을 한 개 이상 올려 주세요. 잇몸 파일만으로는 계획할 수 없습니다.")
    sid = f"S{len(p['scans']) + 1}"
    folder = _root() / pid / "scans" / sid
    folder.mkdir(parents=True, exist_ok=True)
    for name, data in files.items():
        (folder / name).write_bytes(data)
    try:
        orientation = orient_scan(folder)
    except Exception:
        shutil.rmtree(folder, ignore_errors=True)
        raise
    scan = {"scan_id": sid, "case_id": f"{pid}-{sid}", "arch": "upper", "uploaded_at": _now(),
            "teeth": sorted(int(Path(n).stem) for n in teeth), "gingiva": "gingiva.stl" in files,
            "orientation": orientation, "confirmed_at": None}
    p["scans"].append(scan)
    _write(p)
    return scan


def _scan(p: dict, sid: str) -> dict:
    for s in p["scans"]:
        if s["scan_id"] == sid:
            return s
    raise KeyError(f"unknown scan {sid}")


def confirm_scan(pid: str, sid: str) -> dict:
    """The dentist checked the tooth numbers and the orientation on the input-check screen."""
    p = _read(pid)
    s = _scan(p, sid)
    s["confirmed_at"] = _now()
    _write(p)
    return s


def mirror_scan_numbers(pid: str, sid: str) -> dict:
    """Renumber u -> 17 - u after the dentist saw the numbers running the other way; confirmation is cleared."""
    p = _read(pid)
    s = _scan(p, sid)
    s["teeth"] = mirror_numbers(_root() / pid / "scans" / sid)
    s["orientation"] = {**(s.get("orientation") or {}), "side": "ok" if (s.get("orientation") or {}).get("side") == "reversed" else "reversed",
                        "renumbered": not (s.get("orientation") or {}).get("renumbered", False)}
    s["confirmed_at"] = None
    _write(p)
    return s


def is_confirmed(case_id: str) -> bool | None:
    """True/False for a patient scan case id, None when the id is not a patient scan (samples, uploads)."""
    m = _CASE_RE.match(case_id or "")
    if not m or case_folder(case_id) is None:
        return None
    return bool(_scan(_read(m.group(1)), m.group(2)).get("confirmed_at"))


def delete_patient(pid: str) -> None:
    _read(pid)
    shutil.rmtree(_root() / pid, ignore_errors=True)


def remove_scan(pid: str, sid: str) -> None:
    p = _read(pid)
    _scan(p, sid)
    p["scans"] = [s for s in p["scans"] if s["scan_id"] != sid]
    _write(p)
    shutil.rmtree(_root() / pid / "scans" / sid, ignore_errors=True)


def case_folder(case_id: str) -> Path | None:
    """Folder of a patient scan case id ("P0001-S1"), or None when the id is not a registered patient scan."""
    m = _CASE_RE.match(case_id or "")
    if not m:
        return None
    folder = _root() / m.group(1) / "scans" / m.group(2)
    return folder if folder.is_dir() else None
