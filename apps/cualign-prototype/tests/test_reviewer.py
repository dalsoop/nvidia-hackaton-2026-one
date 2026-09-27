"""No paid calls: inject empty replies, 503, malformed responses and timeouts."""
import asyncio
import json
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


def test_reviewer_gets_what_each_number_means(tmp_path, monkeypatch):
    """A live memo called the total movement of one tooth "per stage" and the tooth-width sum a space need."""
    from cualign.agent.reviewer import FIELD_NOTES
    from cualign.core import limits
    monkeypatch.setattr(store_module, "OUT_DIR", tmp_path)
    s = store_module.Store()
    svc = PlanningService(s)
    pid = svc.stages(svc.target("severe", "extraction", Constraints(allow_extraction=True)))
    plan = s.plan_json(pid)
    # Every noted field exists in the data the reviewer reads, so a rename cannot leave a note behind.
    assert set(FIELD_NOTES) <= set(plan["info"]) | set(plan["target"])
    assert str(limits.MAX_LINEAR_PER_ALIGNER) in FIELD_NOTES["per_stage_mm"]
    assert "TOTAL" in FIELD_NOTES["max_move_mm"] and "not a space shortage" in FIELD_NOTES["needed_mm"]
    class Capture:
        messages = None
        async def ainvoke(self, messages):
            Capture.messages = messages
            return SimpleNamespace(content="검토 메모 초안")
    assert asyncio.run(review_plan(pid, Capture(), store=s, manual=True))["status"] == "passed"
    system, user = Capture.messages
    assert "field_notes" in system["content"]
    sent = json.loads(user["content"])
    assert sent["field_notes"] == FIELD_NOTES
    assert sent["plan"]["plan_id"] == pid and "stages" not in sent["plan"] and "approval" not in sent["plan"]


def _workflow() -> dict:
    import yaml
    from pathlib import Path
    return yaml.safe_load((Path(__file__).resolve().parents[1] / "configs" / "workflow.yml").read_text(encoding="utf-8"))


def test_workflow_reviewer_instructions_are_the_system_prompt(tmp_path, monkeypatch):
    """#74: the memo named numbers by field (per_stage_mm …) and the planner copied it into the answer."""
    from cualign.agent.reviewer import BoundedReviewerConfig, REVIEW_INSTRUCTIONS
    cfg = BoundedReviewerConfig.model_validate({k: v for k, v in _workflow()["functions"]["reviewer"].items() if k != "_type"})
    assert "never by the field" in cfg.instructions and "앞니 먼저" in cfg.instructions
    # Every number the reviewer is told about has a Korean name; a live memo called needed_mm (95.8 mm) 총생.
    from cualign.agent.reviewer import FIELD_NOTES
    for field in (*FIELD_NOTES, "shape_room_mm"):
        assert f"{field} " in cfg.instructions, field
    assert "needed_mm 치아 폭 합" in cfg.instructions and "crowding_mm 총생" in cfg.instructions
    assert BoundedReviewerConfig(llm_name="nim_review").instructions == ""  # no config: the built-in prompt
    monkeypatch.setattr(store_module, "OUT_DIR", tmp_path)
    s = store_module.Store()
    svc = PlanningService(s)
    class Capture:
        messages = None
        async def ainvoke(self, messages):
            Capture.messages = messages
            return SimpleNamespace(content="검토 메모 초안")
    for instructions, system in ((cfg.instructions, cfg.instructions.strip()), ("", REVIEW_INSTRUCTIONS)):
        pid = svc.stages(svc.target("moderate", "expansion_ipr", Constraints()))
        assert asyncio.run(review_plan(pid, Capture(), store=s, manual=True, instructions=instructions))["status"] == "passed"
        assert Capture.messages[0] == {"role": "system", "content": system}


def test_review_model_does_not_think():
    """#74: a reasoning cut off at max_tokens came back as content and was stored as the memo."""
    llms = _workflow()["llms"]
    assert _workflow()["functions"]["reviewer"]["llm_name"] == "nim_review"
    assert llms["nim_review"]["chat_template_kwargs"]["enable_thinking"] is False


def test_truncated_reply_is_not_stored_as_memo(tmp_path, monkeypatch):
    monkeypatch.setattr(store_module, "OUT_DIR", tmp_path)
    s = store_module.Store()
    svc = PlanningService(s)
    pid = svc.stages(svc.target("moderate", "expansion_ipr", Constraints()))
    class CutOff:
        calls = 0
        async def ainvoke(self, messages):
            self.calls += 1
            return SimpleNamespace(content="We need to produce a short Korean review memo: ...",
                                   response_metadata={"finish_reason": "length"})
    llm = CutOff()
    result = asyncio.run(review_plan(pid, llm, store=s, manual=True))
    assert result["status"] == "failed" and result["error"] == "invalid_response" and llm.calls == 2
    assert "We need" not in result["message"]
