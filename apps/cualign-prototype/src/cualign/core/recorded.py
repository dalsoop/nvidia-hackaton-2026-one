"""Recorded agent answers for the sample cases: what the screen replays when the NIM is down or slow during a demo.

A recording is one file per sample and step (samples/recorded/<case_id>/<step>.json) holding the sentence that was
sent, the turn's final constraint patch, the answer as the model wrote it and the reviewer's result, and optionally
`reasoning`: the reasoning events the live turn sent before its answer, in order (000097 setup). No plan is stored:
a replay recomputes the plans with the rule engine (deterministic) under the same constraints, and the stage count
and months in the answer are checked against that computation and rewritten where they differ. The screen marks a
replayed answer as recorded; nothing here pretends to be the agent.
"""
from __future__ import annotations

import json
import re
from pathlib import Path

RECORDED_DIR = Path(__file__).resolve().parent / "samples" / "recorded"
# the step flow (agent/steps.py): setup and target turns, then the stages turn and its two re-plans
STEPS = ("setup", "target", "stages", "cap", "compare")
ALIASES = {"plan": "stages"}   # the name before the step flow (.report/12-replay.md)
# setup = the sample card sentence (the prescription); the rest as the screen's chips send them (app.js nextChips)
REQUESTS = {"target": "이 조건으로 목표 배열을 만들어줘.", "stages": "이 목표로 단계를 만들어줘.",
            "cap": "8개월 안에 끝나게 단계를 만들어줘.", "compare": "확장안이랑 IPR안 둘 다 만들어서 비교해줘."}
TURN_STEP = {"setup": "setup", "target": "target", "stages": "stages", "cap": "stages", "compare": "stages"}   # the turn's step field
FIELDS = ("step", "request", "constraints", "answer_md", "review", "recorded_at", "model")
NO_RECORDING = "녹화된 답이 없습니다"
STRATEGY_KO = {"expansion_ipr": "확장 + IPR", "expansion": "확장", "ipr": "IPR", "extraction": "발치"}   # longest first
STEP_KO = {"setup": "셋업", "target": "목표 배열", "stages": "단계", "cap": "기간 상한", "compare": "비교"}
# "20단계(약 4.6개월)" in an answer line; the 조건 line's "단계 상한 35단계(약 8.1개월)" is the dentist's cap, left alone
STAGES_RE = re.compile(r"(?<!상한 )(?<!\d)(\d+)단계\(약 ([\d.]+)개월\)")


def path(case_id: str, step: str) -> Path:
    return RECORDED_DIR / case_id / f"{ALIASES.get(step, step)}.json"


def load(case_id: str, step: str) -> dict | None:
    """The recording, or None when the case is not a sample or the step was never recorded."""
    step = ALIASES.get(step, step)
    if step not in STEPS:
        return None
    p = path(case_id, step)
    if not p.is_file():
        return None
    data = json.loads(p.read_text(encoding="utf-8"))
    check(data)
    return data


def check(data: dict) -> None:
    missing = [k for k in FIELDS if k not in data]
    if missing:
        raise ValueError(f"recording lacks {missing}")
    if data["step"] not in STEPS or not isinstance(data["constraints"], dict) or not str(data["answer_md"]).strip():
        raise ValueError("recording has a bad step, constraints or answer")
    if data["review"] is not None and not isinstance(data["review"], dict):
        raise ValueError("recording's review must be the reviewer's result or null")
    reasoning = data.get("reasoning")
    if reasoning is not None and not (isinstance(reasoning, list) and all(isinstance(x, str) and x.strip() for x in reasoning)):
        raise ValueError("recording's reasoning must be a list of sentences")


def save(case_id: str, step: str, data: dict) -> Path:
    check(data)
    p = path(case_id, step)
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(data, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    return p


def strategy_in(text: str) -> str | None:
    """The strategy a line names (확장 + IPR before 확장 and IPR; 비발치 is not 발치)."""
    for key, ko in STRATEGY_KO.items():
        if re.search(r"(?<!비)" + re.escape(ko) + r"(?!\s*\+)", text) if key != "expansion_ipr" else ko in text:
            return key
    return None


def selected_strategy(answer_md: str) -> str | None:
    """The strategy of the plan the answer settled on: its summary sentence ("IPR 전략으로 9단계(…) 계획을 만들었습니다",
    bold or after 「선택된 안:」), else its bold line, else its first line. A comparison opens with one line per plan, so
    its first line names a compared plan, not the chosen one."""
    lines = answer_md.strip().splitlines()
    head = next((ln for ln in lines if "계획을 만들었습니다" in ln), None) \
        or next((ln for ln in lines if ln.lstrip().startswith("**")), lines[0] if lines else "")
    return strategy_in(head)


def substitute(answer_md: str, plans: dict[str, dict], selected: dict | None) -> str:
    """`answer_md` with every "N단계(약 M개월)" rewritten from the recomputed plans: a line that names a strategy takes
    that strategy's plan, any other line the selected plan. `plans` maps strategy -> plan summary (n_stages, months).
    A line naming a strategy that was not recomputed keeps its recorded figures: the selected plan's would make it false
    (000131: the recorded 「확장 전략: 10단계」 took the IPR plan's 9 and the comparison read as a tie)."""
    out = []
    for line in answer_md.splitlines():
        key = strategy_in(line)
        plan = plans.get(key) if key else selected
        if plan is None:
            out.append(line)
            continue
        out.append(STAGES_RE.sub(f"{plan['n_stages']}단계(약 {plan['months']}개월)", line))
    return "\n".join(out)
