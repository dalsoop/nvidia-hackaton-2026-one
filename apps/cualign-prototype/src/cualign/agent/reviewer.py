"""Read-only NIM review with explicit, shared retry and elapsed-time budgets."""
import asyncio
import json
import time

from pydantic import Field
from nat.builder.framework_enum import LLMFrameworkEnum
from nat.builder.function_info import FunctionInfo
from nat.cli.register_workflow import register_function
from nat.data_models.function import FunctionBaseConfig
from nat.data_models.component_ref import LLMRef
from pydantic import BaseModel

from cualign.core.store import STORE
from .context import CURRENT_RUN


class ReviewInput(BaseModel):
    plan_id: str


class BoundedReviewerConfig(FunctionBaseConfig, name="cualign_reviewer"):
    llm_name: LLMRef
    max_attempts: int = Field(default=2, ge=1, le=2)
    timeout_seconds: float = Field(default=20, gt=0, le=30)
    total_seconds: float = Field(default=40, gt=0, le=60)


def response_text(response):
    content = getattr(response, "content", response)
    if isinstance(content, str):
        return content.strip()
    if isinstance(content, list):
        return "".join(part.get("text", "") for part in content if isinstance(part, dict) and part.get("type") == "text").strip()
    return ""


async def review_plan(plan_id, llm, *, store=STORE, max_attempts=2, timeout_seconds=20, total_seconds=40):
    p = store.plans[plan_id]
    run = CURRENT_RUN.get()
    if run and (run.closed or run.case_id != p["case_id"] or run.selected_plan_id != plan_id):
        raise ValueError("review only the selected plan in this request")
    if p["review"]["status"] in ("passed", "failed", "skipped"):
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
    snapshot = store.plan_json(plan_id)
    snapshot.pop("stages")
    snapshot.pop("approval")
    messages = [
        {"role": "system", "content": "You are cuAlign's read-only reviewer. Given computed plan data, write a short Korean review memo: strategy, rule violations, locked teeth and IPR exclusions, and questions for the dentist. Do not call tools, diagnose or prescribe. Rule validation is not clinical approval. End with: 검토 메모도 초안입니다. 최종 판단은 의사가 합니다."},
        {"role": "user", "content": json.dumps(snapshot, ensure_ascii=False)}
    ]
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
                if getattr(response, "tool_calls", None) or text.startswith(("Thought:", "Action:")):
                    error = "invalid_response"
                    continue
                return store.set_review(plan_id, {"status": "passed", "attempts": attempts, "message": text, "error": None})
            except asyncio.TimeoutError:
                error = "timeout"
            except Exception as exc:
                error = "upstream_503" if "503" in str(exc) else "model_error"
        return store.set_review(plan_id, {"status": "failed", "attempts": attempts, "message": "검토 실패 — 계획을 승인할 수 없습니다.", "error": error})
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
                                 timeout_seconds=config.timeout_seconds, total_seconds=config.total_seconds)

    yield FunctionInfo.from_fn(run_review, description=run_review.__doc__)
