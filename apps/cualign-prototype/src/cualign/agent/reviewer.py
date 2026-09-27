"""Read-only NIM review with explicit, shared retry and elapsed-time budgets."""
import asyncio
import json
import re
import time

from pydantic import Field
from nat.builder.framework_enum import LLMFrameworkEnum
from nat.builder.function_info import FunctionInfo
from nat.cli.register_workflow import register_function
from nat.data_models.function import FunctionBaseConfig
from nat.data_models.component_ref import LLMRef
from pydantic import BaseModel

from cualign.core import limits as L
from cualign.core.store import STORE
from .context import CURRENT_RUN


class ReviewInput(BaseModel):
    plan_id: str


class BoundedReviewerConfig(FunctionBaseConfig, name="cualign_reviewer"):
    llm_name: LLMRef
    max_attempts: int = Field(default=2, ge=1, le=2)
    timeout_seconds: float = Field(default=20, gt=0, le=30)
    total_seconds: float = Field(default=40, gt=0, le=60)
    instructions: str = Field(default="", description="the reviewer's system prompt; empty keeps REVIEW_INSTRUCTIONS")


def response_text(response):
    content = getattr(response, "content", response)
    if isinstance(content, str):
        return content.strip()
    if isinstance(content, list):
        return "".join(part.get("text", "") for part in content if isinstance(part, dict) and part.get("type") == "text").strip()
    return ""


# Set by the rails middleware while the workflow is built: async memo -> (rail state, refuse). None: no workflow rails.
MEMO_CHECK = None
# A dentist may ask again for a plan the agent never reviewed or whose review failed; finished ones stay as stored.
MANUAL_RETRY = ("not_requested", "failed")


def upstream_error(exc: Exception) -> str:
    """The NVIDIA client raises "[<status>] ..."; a rate limit (429) or server error is the API's, not the model's.
    A bare "503" in the text keeps its old label."""
    text = str(exc)
    status = re.match(r"^\[(\d{3})\]", text)
    if status and (status.group(1) == "429" or status.group(1).startswith("5")):
        return "upstream_" + status.group(1)
    return "upstream_503" if "503" in text else "model_error"


# The plan data names several totals and per-aligner values alike (a live memo called the 4.35 mm total movement of one
# tooth "per stage", and the 99.5 mm sum of tooth widths a space need). The reviewer gets what each number means;
# the stored plan and the API keep their field names.
FIELD_NOTES = {
    "n_stages": "number of aligners (stages) in the plan",
    "months": f"n_stages x {L.WEAR_DAYS} days per aligner, in months",
    "max_move_mm": "largest TOTAL movement of one tooth from start to the end of the plan, not per aligner",
    "mean_move_mm": "mean TOTAL movement of the moving teeth from start to the end of the plan, not per aligner",
    "per_stage_mm": f"largest movement of one tooth in one aligner; the rule limit is {L.MAX_LINEAR_PER_ALIGNER} mm",
    "stages_per_group": "aligners per movement group; with anterior_first or sequential the groups move one after another",
    "needed_mm": "sum of the tooth widths along the arch (arch length the teeth take up), not a space shortage",
    "crowding_mm": "crowding of the case before treatment",
    "space_gain_mm": "space the strategy creates",
    "space_deficit_mm": f"space still missing after the strategy; the plan fails the rule above {L.SPACE_DEFICIT_TOLERANCE_MM} mm",
    "expansion_mm_per_side": f"arch expansion per side; the limit is {L.MAX_EXPANSION_PER_SIDE} mm",
    "ipr_mm_per_surface": f"IPR per tooth surface; the limit is {L.IPR_PER_SURFACE} mm",
}


# The workflow's `functions.reviewer.instructions` replaces this; it stays the default for callers without a config.
REVIEW_INSTRUCTIONS = "You are cuAlign's read-only reviewer. Given computed plan data, write a short Korean review memo: strategy, rule violations, locked teeth and IPR exclusions, and questions for the dentist. Each number means what field_notes says: never call a total movement a per-aligner value or a tooth-width sum a space shortage. Do not call tools, diagnose or prescribe. Rule validation is not clinical approval. End with: 검토 메모도 초안입니다. 최종 판단은 의사가 합니다."


def truncated(response) -> bool:
    """NIM returns the cut-off reasoning as content when a thinking model hits max_tokens (#74): not a memo."""
    meta = getattr(response, "response_metadata", None) or {}
    return meta.get("finish_reason") == "length"


def review_messages(snapshot: dict, instructions: str = "") -> list[dict]:
    return [
        {"role": "system", "content": instructions.strip() or REVIEW_INSTRUCTIONS},
        {"role": "user", "content": json.dumps({"plan": snapshot, "field_notes": FIELD_NOTES}, ensure_ascii=False)},
    ]


async def review_plan(plan_id, llm, *, store=None, max_attempts=2, timeout_seconds=20, total_seconds=40,
                      manual=False, instructions=""):
    """`manual` is the dentist's explicit request from the UI (no request context): it reviews a `failed` plan again
    with a fresh budget. The agent path keeps returning the stored failure so it cannot loop on the model."""
    store = store or STORE
    p = store.plans[plan_id]
    run = None if manual else CURRENT_RUN.get()
    if run and (run.closed or run.case_id != p["case_id"] or run.selected_plan_id != plan_id):
        raise ValueError("review only the selected plan in this request")
    if p["review"]["status"] in (("passed", "skipped") if manual else ("passed", "failed", "skipped")):
        return dict(p["review"])
    if p["review"]["status"] == "running" or (run and run.review_busy):
        return {"status": "running", "attempts": p["review"]["attempts"], "message": "검토 진행 중", "error": None}
    started = time.monotonic()
    if run:
        run.review_busy = True
        if run.review_started is None:
            run.review_started = started
        started = run.review_started
    attempts = 0
    error = "attempt_limit"
    rails = None
    snapshot = store.plan_json(plan_id)
    snapshot.pop("stages")
    snapshot.pop("approval")
    messages = review_messages(snapshot, instructions)
    try:
        while attempts < max_attempts and (not run or run.review_attempts < max_attempts):
            remaining = total_seconds - (time.monotonic() - started)
            if remaining <= 0:
                error = "timeout"
                break
            attempts += 1
            if run:
                run.review_attempts += 1
            store.set_review(plan_id, {"status": "running", "attempts": attempts, "message": "", "error": None})
            try:
                response = await asyncio.wait_for(llm.ainvoke(messages), timeout=min(timeout_seconds, remaining))
                text = response_text(response)
                if not text:
                    error = "empty_response"
                    continue
                if getattr(response, "tool_calls", None) or text.startswith(("Thought:", "Action:")) or truncated(response):
                    error = "invalid_response"
                    continue
                rails, refuse = await MEMO_CHECK(text) if MEMO_CHECK else ("off", False)
                if refuse:  # the memo is not stored; another attempt may write one that passes
                    error = "rail_blocked" if rails == "blocked" else "rail_error"
                    continue
                return store.set_review(plan_id, {"status": "passed", "attempts": attempts, "message": text,
                                                  "error": None, "rails": rails})
            except asyncio.TimeoutError:
                error = "timeout"
            except Exception as exc:
                error = upstream_error(exc)
        return store.set_review(plan_id, {"status": "failed", "attempts": attempts, "message": "검토 실패 — 계획을 승인할 수 없습니다.",
                                          "error": error, "rails": rails})
    except asyncio.CancelledError:
        store.set_review(plan_id, {"status": "failed", "attempts": attempts, "message": "검토가 중단됐습니다.", "error": "cancelled"})
        raise
    finally:
        if run:
            run.review_busy = False


@register_function(config_type=BoundedReviewerConfig, framework_wrappers=[LLMFrameworkEnum.LANGCHAIN])
async def bounded_reviewer(config: BoundedReviewerConfig, builder):
    llm = await builder.get_llm(config.llm_name, wrapper_type=LLMFrameworkEnum.LANGCHAIN)

    async def run_review(inp: ReviewInput) -> dict:
        """선택한 계획의 검토 메모를 생성한다. 최대 2회/40초이며 실패도 명시적으로 반환한다. 재호출은 저장된 결과를 반환한다."""
        return await review_plan(inp.plan_id, llm, max_attempts=config.max_attempts,
                                 timeout_seconds=config.timeout_seconds, total_seconds=config.total_seconds,
                                 instructions=config.instructions)

    yield FunctionInfo.from_fn(run_review, description=run_review.__doc__)
