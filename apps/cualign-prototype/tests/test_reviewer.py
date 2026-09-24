"""No paid calls: inject empty replies, 503, malformed responses and timeouts."""
import asyncio
from types import SimpleNamespace

import pytest
from cualign.agent.context import CURRENT_RUN, PlanRun
from cualign.agent.reviewer import review_plan
from cualign.core.constraints import Constraints
from cualign.core.service import PlanningService
from cualign.core import store as store_module


@pytest.mark.parametrize("failure,error", [("", "empty_response"), (RuntimeError("503 overloaded"), "upstream_503"),
                                          ("Thought: unfinished", "invalid_response")])
def test_review_budget_and_cached_failure(tmp_path, monkeypatch, failure, error):
    monkeypatch.setattr(store_module, "OUT_DIR", tmp_path)
    s = store_module.Store()
    svc = PlanningService(s)
    pid = svc.stages(svc.target("moderate", "expansion_ipr", Constraints()))
    class Fake:
        calls = 0
        async def ainvoke(self, messages):
            self.calls += 1
            if isinstance(failure, Exception):
                raise failure
            return SimpleNamespace(content=failure)
    async def run():
        fake = Fake()
        context = PlanRun("review-run", "moderate", None, Constraints(), selected_plan_id=pid)
        token = CURRENT_RUN.set(context)
        try:
            first = await review_plan(pid, fake, store=s)
            second = await review_plan(pid, fake, store=s)
            assert first == second
            assert fake.calls == context.review_attempts == 2
            assert first["status"] == "failed" and first["error"] == error
            with pytest.raises(ValueError):
                s.approve(pid)
        finally:
            CURRENT_RUN.reset(token)
    asyncio.run(run())


def test_timeout_and_recovery(tmp_path, monkeypatch):
    monkeypatch.setattr(store_module, "OUT_DIR", tmp_path)
    s = store_module.Store()
    svc = PlanningService(s)
    class Slow:
        async def ainvoke(self, messages):
            await asyncio.sleep(1)
    class Recovers:
        calls = 0
        async def ainvoke(self, messages):
            self.calls += 1
            return SimpleNamespace(content="" if self.calls == 1 else "검토 메모 초안")
    async def run():
        for llm, expected in ((Slow(), "failed"), (Recovers(), "passed")):
            pid = svc.stages(svc.target("moderate", "expansion_ipr", Constraints()))
            result = await review_plan(pid, llm, store=s, timeout_seconds=0.01, total_seconds=0.03)
            assert result["status"] == expected
            assert result["attempts"] <= 2
            if expected == "failed":
                assert result["error"] == "timeout"
    asyncio.run(run())

def test_registered_reviewer_function_schema(tmp_path, monkeypatch):
    from cualign.agent import reviewer
    from nat.builder.function import LambdaFunction
    monkeypatch.setattr(store_module, "OUT_DIR", tmp_path)
    # Default STORE is the same object captured by the registered function.
    s = store_module.STORE
    svc = PlanningService(s)
    pid = svc.stages(svc.target("moderate", "expansion_ipr", Constraints()))
    class Builder:
        async def get_llm(self, name, wrapper_type):
            assert str(name) == "nim_review"
            class LLM:
                async def ainvoke(self, messages):
                    return SimpleNamespace(content="계획 데이터 기반 검토 메모 초안")
            return LLM()
    async def run():
        cfg = reviewer.BoundedReviewerConfig(llm_name="nim_review")
        async with reviewer.bounded_reviewer(cfg, Builder()) as info:
            fn = LambdaFunction.from_info(config=cfg, info=info)
            result = await fn.ainvoke(reviewer.ReviewInput(plan_id=pid))
            assert result["status"] == "passed"
    asyncio.run(run())
