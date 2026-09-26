"""Sample cases for the start screen: real upper-arch scans with the dentist's prescription (#46).

Three Poseidon3D scans (Kubik & Spanel 2024, CC-BY-4.0, see samples/ATTRIBUTION.md), picked and read by a dentist
(evals/real_scans/dentist_labels.yaml, #60). They ship with the package so that the start screen works right after
install; they were made with scripts/import_poseidon.py (per-tooth crowns and the trimmed gingiva, without
gingiva_raw.stl). The dentist writes tooth numbers in FDI, so the texts here do too; the planner uses Universal.

A sample opens with its prescription already in the planning constraints: the app starts where diagnosis and
prescription end, and plans inside them. The prescriptions are written in FDI with the app's (Universal) numbers
beside them, because the constraint fields and the agent use Universal.

The constraint model cannot state every prescription exactly: IPR is per tooth (both surfaces of an allowed tooth,
so the contacts at the ends of an allowed run get half) and at most IPR_PER_SURFACE, of which the core takes half
per surface — 0.25 mm per contact. Where the app computes less IPR than prescribed, `note` says so with the app's
total (tests/test_samples.py checks the number against the core); the rest has to come from what the dentist adds.
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
    note: str = ""               # where the app's constraints differ from the prescription
    ipr_total_mm: float = 0.0    # IPR the app computes with these constraints (checked against the core)

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
           "제1소구치 14·24 발치 (FDI · 앱 번호 5·12)",
           "처방은 제1소구치 14·24(앱 번호 5·12) 발치입니다. 이 처방으로 단계 계획을 짜 주세요.",
           {"allow_extraction": True}),
    Sample("poseidon-000131", "경도 부족 — 앞니 IPR 케이스",
           "비발치 · IPR 11-21·11-12·21-22 각 0.4mm (FDI · 앱 번호 8-9·7-8·9-10)",
           "처방은 비발치, IPR 11-21·11-12·21-22(앱 번호 8-9·7-8·9-10) 접촉면에 각 0.4mm입니다. "
           "이 처방으로 단계 계획을 짜 주세요.",
           # IPR on 12..22 (Universal 7..10) only, at the most the core allows
           {"allow_extraction": False, "ipr_exclude": [2, 3, 4, 5, 6, 11, 12, 13, 14, 15], "ipr_limit_mm": 0.25},
           note="앱의 IPR은 치아 단위로 접촉면당 최대 0.25mm라서, 12~22번에 IPR을 허용해 총 1.0mm로 계산합니다"
                "(처방 1.2mm, 13-12·22-23 접촉면에도 일부 들어감).",
           ipr_total_mm=1.0),
    Sample("poseidon-000001", "공간 부족 — IPR과 악궁 확장 케이스",
           "비발치 · 14-15·24-25부터 앞쪽으로 IPR 총 3.6mm + 악궁 확장 (FDI · 앱 번호 4-5·12-13부터)",
           "처방은 비발치, 14-15·24-25(앱 번호 4-5·12-13) 접촉면부터 앞쪽으로 IPR 총 3.6mm와 악궁 확장입니다. "
           "이 처방으로 단계 계획을 짜 주세요.",
           # IPR from the premolars forward, not on the molars, at the most the core allows
           {"allow_extraction": False, "ipr_exclude": [2, 3, 14, 15], "ipr_limit_mm": 0.25},
           note="앱의 IPR은 치아 단위로 접촉면당 최대 0.25mm라서, 대구치를 뺀 치아에 IPR을 허용해 총 2.5mm로 "
                "계산합니다(처방 3.6mm).",
           ipr_total_mm=2.5),
)}


def get(case_id: str) -> Sample | None:
    return SAMPLES.get(case_id)
