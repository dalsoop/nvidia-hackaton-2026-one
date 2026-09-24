"""No paid calls: inject empty replies, 503, malformed responses and timeouts."""
import asyncio
import json
from types import SimpleNamespace

import pytest
from cualign.agent.context import CURRENT_RUN, PlanRun
from cualign.agent.reviewer import crosses_boundary, review_plan
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


# Must cross the boundary, and nothing else: not empty, not "Thought:"/"Action:" (reviewer.py's other checks).
CROSSING = "이 환자는 발치해야 합니다. 검토 메모도 초안입니다. 최종 판단은 의사가 합니다."
# The seven sentences handing the decision to the dentist that the list caught before three of its patterns were
# narrowed (tests/test_rail_patterns.py), as one normal memo.
DEFERRING = " ".join([
    "최종 계획 선택은 의사의 판단입니다.", "발치 여부는 진단 결과를 보고 의사가 정합니다.",
    "이 안은 최종 계획이 아니라 초안입니다.", "확정된 계획이 아닙니다.", "최종 확정은 의사가 합니다.",
    "확정된 계획 조건을 그대로 유지했습니다.", "최종 확정된 조건으로 계획을 마쳤습니다.",
])


class Memos:
    """Returns the given memos in turn, the last one again once they run out."""
    def __init__(self, *memos):
        self.memos, self.calls = memos, 0

    async def ainvoke(self, messages):
        self.calls += 1
        return SimpleNamespace(content=self.memos[min(self.calls, len(self.memos)) - 1])


def clean_plan(s):
    svc = PlanningService(s)
    pid = svc.stages(svc.target("moderate", "expansion_ipr", Constraints()))
    assert not s.plans[pid]["violations"]  # a violation alone makes the approval 409
    return pid


def test_review_boundary_blocks_memo(tmp_path, monkeypatch):
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from cualign.server import api
    monkeypatch.setattr(store_module, "OUT_DIR", tmp_path)
    monkeypatch.setattr(api, "OUT_DIR", tmp_path)
    s = store_module.STORE  # the approval API reads this one
    pid = clean_plan(s)
    result = asyncio.run(review_plan(pid, Memos(CROSSING), store=s, boundary=crosses_boundary))
    assert result["status"] == "failed" and result["error"] == "boundary"
    stored = json.dumps(s.plan_json(pid), ensure_ascii=False) + (tmp_path / "plans" / f"{pid}.json").read_text("utf-8")
    assert "발치해야" not in stored
    app = FastAPI()
    api.add_api_routes(app)
    with TestClient(app) as client:
        r = client.post(f"/api/plans/{pid}/approval", json={"confirmed": True})
    assert r.status_code == 409 and r.json()["detail"].startswith("검토가 완료되지 않았습니다")


def test_registered_review_uses_boundary(tmp_path, monkeypatch):
    """The NAT function passes no boundary, so the default is what the app runs."""
    from cualign.agent import reviewer
    from nat.builder.function import LambdaFunction
    monkeypatch.setattr(store_module, "OUT_DIR", tmp_path)
    s = store_module.STORE
    pid = clean_plan(s)
    class Builder:
        async def get_llm(self, name, wrapper_type):
            return Memos(CROSSING)
    async def run():
        cfg = reviewer.BoundedReviewerConfig(llm_name="nim_review")
        async with reviewer.bounded_reviewer(cfg, Builder()) as info:
            return await LambdaFunction.from_info(config=cfg, info=info).ainvoke(reviewer.ReviewInput(plan_id=pid))
    result = asyncio.run(run())
    assert result["status"] == "failed" and result["error"] == "boundary"
    assert "발치해야" not in s.plans[pid]["review"]["message"]


def test_review_boundary_retry_passes(tmp_path, monkeypatch):
    """A crossing memo is one failed attempt; the second, deferring memo passes."""
    monkeypatch.setattr(store_module, "OUT_DIR", tmp_path)
    s = store_module.Store()
    pid = clean_plan(s)
    llm = Memos(CROSSING, DEFERRING)
    result = asyncio.run(review_plan(pid, llm, store=s, boundary=crosses_boundary))
    assert result["status"] == "passed" and result["message"] == DEFERRING and llm.calls == 2
