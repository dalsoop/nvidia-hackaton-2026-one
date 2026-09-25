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
                                          (Exception("[429] Too Many Requests"), "upstream_429"),
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


def test_manual_review_recovers_unreviewed_and_failed_plans(tmp_path, monkeypatch):
    monkeypatch.setattr(store_module, "OUT_DIR", tmp_path)
    s = store_module.Store()
    svc = PlanningService(s)
    class Reply:
        def __init__(self, text):
            self.text, self.calls = text, 0
        async def ainvoke(self, messages):
            self.calls += 1
            return SimpleNamespace(content=self.text)
    async def run():
        # The agent skipped the reviewer: the plan stays not_requested until the dentist asks.
        skipped = svc.stages(svc.target("moderate", "expansion_ipr", Constraints()))
        assert (await review_plan(skipped, Reply("검토 메모 초안"), store=s, manual=True))["status"] == "passed"
        # The agent path keeps the stored failure; the dentist's request reviews again with a fresh budget.
        failed = svc.stages(svc.target("moderate", "expansion_ipr", Constraints()))
        context = PlanRun("review-run", "moderate", None, Constraints(), selected_plan_id=failed)
        token = CURRENT_RUN.set(context)
        try:
            assert (await review_plan(failed, Reply(""), store=s))["status"] == "failed"
            again = Reply("검토 메모 초안")
            assert (await review_plan(failed, again, store=s))["status"] == "failed" and again.calls == 0
            # A closed or unrelated request context does not block the dentist's request.
            context.closed = True
            result = await review_plan(failed, again, store=s, manual=True)
        finally:
            CURRENT_RUN.reset(token)
        assert result["status"] == "passed" and again.calls == 1
        s.approve(failed)
        # Finished reviews are not run again.
        after = Reply("다른 메모")
        assert (await review_plan(failed, after, store=s, manual=True))["message"] == "검토 메모 초안"
        assert after.calls == 0
    asyncio.run(run())


def test_worker_manual_review_uses_workflow_reviewer(tmp_path, monkeypatch):
    from cualign.server.worker import manual_review
    monkeypatch.setattr(store_module, "OUT_DIR", tmp_path)
    svc = PlanningService(store_module.STORE)
    pid = svc.stages(svc.target("moderate", "expansion_ipr", Constraints()))
    class Builder:
        def get_function_config(self, name):
            from cualign.agent.reviewer import BoundedReviewerConfig
            assert name == "reviewer"
            return BoundedReviewerConfig(llm_name="nim_review", max_attempts=1)
        async def get_llm(self, name, wrapper_type):
            assert str(name) == "nim_review"
            class LLM:
                calls = 0
                async def ainvoke(self, messages):
                    LLM.calls += 1
                    return SimpleNamespace(content="")
            return LLM()
    async def run():
        review = await manual_review(Builder())
        result = await review(pid)
        assert result["status"] == "failed" and result["attempts"] == 1  # the workflow's max_attempts, not the default
    asyncio.run(run())


@pytest.mark.parametrize("exc,label", [(Exception("[429] Too Many Requests"), "upstream_429"),
                                       (Exception("[502] Bad Gateway"), "upstream_502"),
                                       (Exception("[400] Bad Request"), "model_error"),
                                       (RuntimeError("503 overloaded"), "upstream_503"),
                                       (ValueError("parse failed"), "model_error")])
def test_upstream_error_labels(exc, label):
    from cualign.agent.reviewer import upstream_error
    assert upstream_error(exc) == label
