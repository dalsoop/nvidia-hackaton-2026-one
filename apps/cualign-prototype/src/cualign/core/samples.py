"""Sample cases for the start screen: real upper-arch scans with the dentist's prescription (#46).

Three Poseidon3D scans (Kubik & Spanel 2024, CC-BY-4.0, see samples/ATTRIBUTION.md), picked and read by a dentist
(evals/real_scans/dentist_labels.yaml, #60). They ship with the package so that the start screen works right after
install; they were made with scripts/import_poseidon.py (per-tooth crowns and the trimmed gingiva, without
gingiva_raw.stl). The dentist writes tooth numbers in FDI, so the texts here do too; the planner uses Universal.

A sample opens with its prescription already in the planning constraints: the app starts where diagnosis and
prescription end, and plans inside them. The prescriptions are written in FDI only (#113); the constraint fields
and the agent still use Universal internally, converted at the screen boundary (app.js fdi()/universal()).

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
    summary: str = ""            # the prescription in plain words, for the card (#90)
    badges: tuple[str, ...] = () # short facts on the card: crowding, extraction or not, strategy
    constraints: dict = field(default_factory=dict)
    note: str = ""               # where the app's constraints differ from the prescription ("" since #57)
    reason: str = ""             # why this prescription, in arch-space terms: one sentence under 처방 on the detail card

    @property
    def folder(self) -> Path:
        return SAMPLE_DIR / self.case_id

    @property
    def available(self) -> bool:
        return (self.folder / "8.stl").exists()

    def initial_constraints(self) -> Constraints:
        return Constraints(**self.constraints)


SAMPLES: dict[str, Sample] = {s.case_id: s for s in (
    Sample("poseidon-000097", "심한 덧니, 발치 필요",
           "제1소구치 14·24 발치",
           "처방은 제1소구치 14·24 발치입니다. 이 처방으로 단계 계획을 짜 주세요.",
           summary="작은어금니 두 개(14·24)를 빼서 자리를 만들고 정렬",
           badges=("총생 7.9 mm", "발치"),
           reason="총생 7.9 mm 는 IPR 과 확장으로 얻는 약 3 mm 를 훌쩍 넘어, 작은어금니 14·24 를 빼서 자리를 만듭니다.",
           constraints={"extraction": [5, 12]}),
    Sample("poseidon-000001", "중간 덧니, IPR 필요",
           "비발치 · 14-15·24-25부터 앞쪽으로 IPR 총 3.6mm + 악궁 확장",
           "처방은 비발치, 14-15·24-25 접촉면부터 앞쪽으로 IPR 총 3.6mm와 악궁 확장입니다. "
           "이 처방으로 단계 계획을 짜 주세요.",
           summary="어금니 앞쪽 치아 사이를 갈고(총 3.6 mm) 치열 폭을 넓혀 정렬",
           badges=("총생 4.2 mm", "비발치", "IPR + 확장"),
           reason="총생 4.2 mm 는 IPR 3.6 mm 와 악궁 확장으로 얻는 공간 안에 들어와, 치아를 빼지 않고 정렬합니다.",
           # the prescription as contacts (#57): 14-15 and 24-25 forward to 11-21 = 9 contacts, 3.6 mm evenly
           constraints={"extraction": [], "ipr_surfaces": [[a, a + 1, 0.4] for a in range(4, 13)]}),
    Sample("poseidon-000131", "가벼운 덧니, IPR 필요",
           "비발치 · IPR 11-21·11-12·21-22 각 0.4mm",
           "처방은 비발치, IPR 11-21·11-12·21-22 접촉면에 각 0.4mm입니다. "
           "이 처방으로 단계 계획을 짜 주세요.",
           summary="앞니 사이를 조금씩(0.4 mm) 갈아 자리를 만들고 정렬",
           badges=("총생 1.6 mm", "비발치", "IPR"),
           reason="총생 1.6 mm 는 앞니 접촉면 IPR 1.2 mm 로 거의 다 풀려, 어금니와 작은어금니는 건드리지 않습니다.",
           # the prescription as contacts (#57): 11-21, 11-12, 21-22 (Universal 8-9, 7-8, 9-10) 0.4 mm each
           constraints={"extraction": [], "ipr_surfaces": [[7, 8, 0.4], [8, 9, 0.4], [9, 10, 0.4]]}),
)}


def get(case_id: str) -> Sample | None:
    return SAMPLES.get(case_id)
