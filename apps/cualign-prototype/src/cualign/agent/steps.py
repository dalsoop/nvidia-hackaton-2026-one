"""The agent pushes the plan one step per turn (.report/15-step-flow.md).

A turn names its step: `setup` reads the prescription into conditions (set_constraints and nothing more), `target`
makes the target arrangement (propose_target and nothing more), `stages` splits it into stages, validates, selects
and reviews (the turn as it always was; a re-plan under a cap or a comparison is a stages turn too). The model does
not stop where the instructions say, so the server exposes the tools only up to the step: a tool past the step
answers with a refusal the model reads as a normal result. What a step leaves is kept per case (Store.flow) so the
screen can restore a case that was only set up or only targeted.
"""
from __future__ import annotations

import re

from cualign.core.fdi import to_fdi

STEPS = ("setup", "target", "stages")
DEFAULT_STEP = "stages"
STEP_KO = {"setup": "셋업", "target": "목표 배열", "stages": "단계"}
# read-only tools every step may use
READ_TOOLS = frozenset({"clinical_limits", "list_cases", "load_case", "get_constraints", "get_plan", "load_skill"})
ALLOWED = {"setup": READ_TOOLS | {"set_constraints"},
           "target": READ_TOOLS | {"set_constraints", "propose_target"},
           "stages": None}   # None: every tool
REFUSED = "이 단계에서는 쓸 수 없는 도구"
# A free sentence names its step by these words (turn_step); a chip names it outright. Checked in this order: a
# sentence about stages that mentions the target ("이 목표로 단계를") is a stages turn, and a target sentence that
# changes a condition ("발치로 목표 배열을 다시") a target turn — only the condition words alone make a setup turn.
INTENT_WORDS = (
    ("stages", re.compile(r"단계|장수|\d+\s*개월\s*안에|비교")),
    ("target", re.compile(r"목표|배열\s*을?\s*다시|target", re.I)),
    ("setup", re.compile(r"조건|처방|발치|IPR\s*한도|셋업", re.I)),
)


def intent(text: str) -> str | None:
    """The step a free sentence asks for by its words (INTENT_WORDS), or None when no word matches."""
    return next((step for step, words in INTENT_WORDS if words.search(text or "")), None)


def turn_step(text: str, sent: str | None, chip: bool = False) -> str:
    """The step a turn runs: the one the chip names (`chip`), else the sentence's (intent), else the one sent — the
    screen sends the step after its progress for a free sentence too, so a 「목표배열 다시 만들어줘」 typed with a target
    on screen came as `stages` (step-intent)."""
    sent = sent if sent in STEPS else DEFAULT_STEP
    return sent if chip else intent(text) or sent


def allowed(step: str | None, tool: str) -> bool:
    """Whether `tool` (name without the cualign__ prefix) may run in `step`; a turn without a step allows everything."""
    if step is None or step not in ALLOWED or ALLOWED[step] is None:
        return True
    return tool in ALLOWED[step]


def refusal(step: str, tool: str) -> dict:
    """The tool result the model gets for a tool past its step: a normal result, so it stops and asks the dentist."""
    return {"rejected": tool, "step": step,
            "note": f"{REFUSED}: {tool}. 지금 턴은 {STEP_KO[step]} 단계까지만 합니다. 여기까지 한 것을 한 문장으로 요약하고 "
                    f"다음 단계로 갈지 의사에게 되물으세요."}


def target_summary(info: dict) -> dict:
    """What the screen shows when a target arrangement is done (step_done target): crowding, the space the strategy
    makes, the strategy, the extracted teeth (FDI) and the IPR contacts [[a, b, mm], ...] (FDI, adjacent teeth that
    both take IPR, at the per-surface amount)."""
    applied = sorted(info.get("ipr_applied_teeth") or [])
    mm = float(info.get("ipr_mm_per_surface") or 0.0)
    ipr = [[to_fdi(a), to_fdi(b), mm] for a, b in zip(applied, applied[1:]) if b == a + 1] if mm > 0 else []
    return {"crowding_mm": info.get("crowding_mm"), "space_mm": info.get("space_gain_mm"),
            "space_deficit_mm": info.get("space_deficit_mm"), "strategy": info.get("strategy"),
            "extraction": [to_fdi(t) for t in info.get("extraction") or []], "ipr": ipr,
            "expansion_mm_per_side": info.get("expansion_mm_per_side")}
