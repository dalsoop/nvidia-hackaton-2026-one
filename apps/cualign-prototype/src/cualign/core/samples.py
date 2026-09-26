"""Sample cases for the start screen: real upper-arch scans with the dentist's prescription (#46).

Three Poseidon3D scans (Kubik & Spanel 2024, CC-BY-4.0, see samples/ATTRIBUTION.md), picked and read by a dentist
(evals/real_scans/dentist_labels.yaml, #60). They ship with the package so that the start screen works right after
install; they were made with scripts/import_poseidon.py (per-tooth crowns and the trimmed gingiva, without
gingiva_raw.stl). The dentist writes tooth numbers in FDI, so the texts here do too; the planner uses Universal.

A sample opens with its prescription already in the planning constraints: the app starts where diagnosis and
prescription end, and plans inside them. The constraint model is per tooth, so an IPR prescription on contacts
becomes "IPR only on these teeth" at the prescribed amount per surface.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path

from .constraints import Constraints

SAMPLE_DIR = Path(__file__).resolve().parent / "samples"


@dataclass(frozen=True)
class Sample:
    case_id: str
    title: str                   # one line: what the dentist found
    prescription: str            # the dentist's prescription, FDI numbers
    request: str                 # the prescription as a sentence to send the agent (the first chip)
    constraints: dict = field(default_factory=dict)

    @property
    def folder(self) -> Path:
        return SAMPLE_DIR / self.case_id

    @property
    def available(self) -> bool:
        return (self.folder / "8.stl").exists()

    def initial_constraints(self) -> Constraints:
        return Constraints(**self.constraints)


SAMPLES: dict[str, Sample] = {s.case_id: s for s in (
    Sample("poseidon-000097", "공간 부족 — 발치 케이스",
           "제1소구치 14·24 발치",
           "처방은 14·24 발치입니다. 이 처방으로 단계 계획을 짜 주세요.",
           {"allow_extraction": True}),
    Sample("poseidon-000131", "경도 부족 — 앞니 IPR 케이스",
           "비발치 · IPR 11-21·11-12·21-22 각 0.4mm",
           "처방은 비발치, IPR 11-21·11-12·21-22 접촉면에 각 0.4mm입니다. 이 처방으로 단계 계획을 짜 주세요.",
           # IPR on 12..22 (Universal 7..10) only, 0.2 mm per surface = 0.4 mm per contact
           {"allow_extraction": False, "ipr_exclude": [2, 3, 4, 5, 6, 11, 12, 13, 14, 15], "ipr_limit_mm": 0.2}),
    Sample("poseidon-000001", "공간 부족 — IPR과 악궁 확장 케이스",
           "비발치 · 14-15·24-25부터 앞쪽으로 IPR 총 3.6mm + 악궁 확장",
           "처방은 비발치, 14-15·24-25 접촉면부터 앞쪽으로 IPR 총 3.6mm와 악궁 확장입니다. 이 처방으로 단계 계획을 짜 주세요.",
           # IPR from the first premolars forward: not on the molars; 3.6 mm over 9 contacts = 0.2 mm per surface
           {"allow_extraction": False, "ipr_exclude": [2, 3, 14, 15], "ipr_limit_mm": 0.2}),
)}


def get(case_id: str) -> Sample | None:
    return SAMPLES.get(case_id)
