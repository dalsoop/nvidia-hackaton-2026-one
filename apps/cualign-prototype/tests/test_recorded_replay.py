"""Recorded agent answers for the samples and their replay (core/recorded.py, POST /api/cases/{id}/replay).

The screen's «건너뛰기» replays a recorded answer when the NIM is down; the plans are recomputed by the rule engine
under the recorded constraints, the answer's stage counts follow the computation, and the side effects are the agent
turn's. The screen marks the answer as recorded; the server never pretends it was the model."""
import json

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from cualign.core import recorded, samples
from cualign.core import store as store_mod
from cualign.server import api
from cualign.server.plan_events import ChatContext, open_run

REVIEW = {"status": "passed", "attempts": 1, "message": "전략: 발치\n단계 수: 20\n검토 메모도 초안입니다. 최종 판단은 의사가 합니다.",
          "error": None, "rails": "passed"}
PLAN_ANSWER = ("**발치 전략으로 99단계(약 9.9개월) 계획을 만들었습니다.** 규칙 위반은 없습니다.\n\n"
               "- 조건: 발치 치아 14, 24번 · 고정 치아 없음 · IPR 제외 치아 없음 · IPR 한도 면당 0.25mm · 단계 상한 없음 · 이동 순서 동시\n"
               "- 검토: 통과, 단계당 이동량 0.245mm\n\n이 계획은 초안입니다. 최종 판단은 의사가 합니다.")
CAP_ANSWER = ("**발치 전략으로 99단계(약 9.9개월) 계획을 만들었습니다.** 규칙 위반은 없습니다.\n\n"
              "- 조건: 발치 치아 14, 24번 · 고정 치아 없음 · IPR 제외 치아 없음 · IPR 한도 면당 0.25mm · 단계 상한 35단계(약 8.1개월) · 이동 순서 동시\n"
              "- 검토: 통과\n\n이 계획은 초안입니다. 최종 판단은 의사가 합니다.")


def _record(case_id, step, answer, constraints, review=REVIEW):
    return recorded.save(case_id, step, {"step": step, "request": "x", "constraints": constraints, "answer_md": answer,
                                         "review": review, "recorded_at": "2026-09-28T00:00:00+00:00", "model": "fake"})


@pytest.fixture
def client(monkeypatch, tmp_path):
    monkeypatch.setattr(recorded, "RECORDED_DIR", tmp_path / "recorded")
    monkeypatch.setattr(store_mod, "OUT_DIR", tmp_path)
    monkeypatch.setattr(api, "OUT_DIR", tmp_path)
    monkeypatch.setattr(api, "STORE", store_mod.Store())
    app = FastAPI()
    api.add_api_routes(app)
    return TestClient(app)


def test_recording_schema_is_checked(tmp_path, monkeypatch):
    monkeypatch.setattr(recorded, "RECORDED_DIR", tmp_path)
    with pytest.raises(ValueError, match="lacks"):
        recorded.save("poseidon-000097", "plan", {"step": "plan"})
    with pytest.raises(ValueError, match="bad step"):
        _record("poseidon-000097", "plan", "", {})
    assert recorded.load("poseidon-000097", "plan") is None          # not recorded yet
    assert recorded.load("poseidon-000097", "export") is None        # not a step
    _record("poseidon-000097", "plan", PLAN_ANSWER, {"extraction": [5, 12]})
    assert recorded.load("poseidon-000097", "plan")["answer_md"] == PLAN_ANSWER


def test_numbers_follow_the_recomputed_plans():
    plans = {"extraction": {"n_stages": 20, "months": 4.6}, "expansion": {"n_stages": 9, "months": 2.1}}
    out = recorded.substitute(PLAN_ANSWER, plans, plans["extraction"])
    assert out.startswith("**발치 전략으로 20단계(약 4.6개월) 계획을 만들었습니다.**")
    out = recorded.substitute(CAP_ANSWER, plans, plans["extraction"])
    assert "20단계(약 4.6개월) 계획" in out and "단계 상한 35단계(약 8.1개월)" in out   # the dentist's cap is not a plan figure
    compare = "**확장 전략: 99단계(약 9.9개월) · 통과**\n**발치 전략: 99단계(약 9.9개월) · 통과**\n- 비발치 조건은 그대로입니다."
    out = recorded.substitute(compare, plans, plans["extraction"])
    assert out.splitlines()[0] == "**확장 전략: 9단계(약 2.1개월) · 통과**" and out.splitlines()[1] == "**발치 전략: 20단계(약 4.6개월) · 통과**"
    assert recorded.strategy_in("비발치로 12단계") is None and recorded.strategy_in("확장 + IPR 전략") == "expansion_ipr"


def test_replay_matches_plans_and_activate_and_tells_the_next_turn(client):
    cid = "poseidon-000097"
    _record(cid, "plan", PLAN_ANSWER, {"extraction": [5, 12]})
    _record(cid, "cap", CAP_ANSWER, {"stage_cap": 35})
    opened = client.post(f"/api/cases/{cid}/activate").json()
    shown = client.get(f"/api/plans?case_id={cid}").json()["plans"][0]
    r = client.post(f"/api/cases/{cid}/replay", json={"step": "plan", "base_plan_id": shown["plan_id"]})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["recorded"] is True and body["recorded_at"] == "2026-09-28T00:00:00+00:00"
    sel = body["plan_selected"]
    listed = {p["plan_id"]: p for p in client.get(f"/api/plans?case_id={cid}").json()["plans"]}
    assert sel["plan_id"] in listed and sel["parent_plan_id"] == shown["plan_id"] and sel["review"] == REVIEW
    detail = client.get(f"/api/plans/{sel['plan_id']}").json()
    assert detail["strategy"] == "extraction" and detail["constraints"]["extraction"] == [5, 12] and detail["review"] == REVIEW
    assert body["answer_md"].startswith(f"**발치 전략으로 {detail['info']['n_stages']}단계(약 {detail['info']['months']}개월)")   # 99 rewritten
    assert all(p == listed[p["plan_id"]] for p in body["plans"])                                     # GET /api/plans shape
    assert client.post(f"/api/cases/{cid}/activate").json()["constraints"] == detail["constraints"]   # the case's conditions
    # the next agent turn from that plan hears it was a replay
    ctx = ChatContext(case_id=cid, base_plan_id=sel["plan_id"])
    _, msg = open_run(ctx, store=api.STORE)
    context = json.loads(msg["content"].removeprefix("cuAlign server context: "))
    assert context["replayed_ko"].startswith("[녹화된 답 재생]") and "계획" in context["replayed_ko"]
    assert "replayed_ko" not in json.loads(open_run(ChatContext(case_id=cid, base_plan_id=shown["plan_id"]), store=api.STORE)[1]["content"]
                                          .removeprefix("cuAlign server context: "))
    # the cap step on top of the replayed plan: the cap applies and the plan chains
    r = client.post(f"/api/cases/{cid}/replay", json={"step": "cap", "base_plan_id": sel["plan_id"]})
    assert r.status_code == 200
    cap = client.get(f"/api/plans/{r.json()['plan_selected']['plan_id']}").json()
    assert cap["constraints"]["stage_cap"] == 35 and cap["parent_plan_id"] == sel["plan_id"] and cap["constraints"]["extraction"] == [5, 12]
    assert "단계 상한 35단계(약 8.1개월)" in r.json()["answer_md"]
    assert opened["case_id"] == cid


def test_a_recorded_question_makes_no_plan(client):
    cid = "poseidon-000097"
    _record(cid, "compare", "발치 처방(14·24)이 있어 비발치 전략은 비교할 수 없습니다. 발치 없이 비교할까요?", {}, review=None)
    client.post(f"/api/cases/{cid}/activate")
    before = client.get(f"/api/plans?case_id={cid}").json()["plans"]
    r = client.post(f"/api/cases/{cid}/replay", json={"step": "compare", "base_plan_id": before[0]["plan_id"]})
    assert r.status_code == 200 and r.json()["plan_selected"] is None and r.json()["plans"] == []
    assert r.json()["answer_md"].endswith("비교할까요?")
    assert client.get(f"/api/plans?case_id={cid}").json()["plans"] == before


def test_no_recording_or_not_a_sample_is_404(client):
    assert client.post("/api/cases/poseidon-000097/replay", json={"step": "plan"}).json() == {"detail": recorded.NO_RECORDING}
    _record("moderate", "plan", PLAN_ANSWER, {})                     # a recording for a non-sample case is not served
    r = client.post("/api/cases/moderate/replay", json={"step": "plan"})
    assert r.status_code == 404 and r.json()["detail"] == recorded.NO_RECORDING
    assert client.post("/api/cases/poseidon-000097/replay", json={"step": "export"}).status_code == 422


@pytest.mark.parametrize("case_id", [s.case_id for s in samples.SAMPLES.values()])
def test_shipped_recordings_are_valid(case_id):
    """Whatever tests/nim_record_samples.py saved must load, and its constraints must be a patch the app accepts."""
    from cualign.core.constraints import ConstraintPatch
    for step in recorded.STEPS:
        rec = recorded.load(case_id, step)
        if rec is None:
            continue
        ConstraintPatch.model_validate(rec["constraints"])
        assert "이 계획은 초안입니다" in rec["answer_md"] or rec["review"] is None
        assert not rec["answer_md"].startswith("Final Answer")


def test_reopening_a_case_starts_from_the_prescription_and_names_the_active_plan(client):
    """Answer-polish (8): a replayed (or planned) stage cap stayed at the case level, so opening the case again showed
    «조건이 처방과 다릅니다» and a 35-stage cap on the 조건 tab. Rule: the case keeps the prescription only (extraction,
    lock, IPR exclusions, IPR limit); a stage cap and the move order belong to the plan they were made for and reach the
    next turn through base_plan_id. Opening reports the prescription as `constraints` and the newest plan's own
    conditions as `active_plan`, and makes no new plan."""
    from cualign.core.samples import SAMPLES
    cid = "poseidon-000097"
    prescription = SAMPLES[cid].initial_constraints().model_dump(mode="json")
    _record(cid, "plan", PLAN_ANSWER, {"extraction": [5, 12]})
    _record(cid, "cap", CAP_ANSWER, {"stage_cap": 35})
    client.post(f"/api/cases/{cid}/activate")
    n_plans = len(client.get(f"/api/plans?case_id={cid}").json()["plans"])
    plan = client.post(f"/api/cases/{cid}/replay", json={"step": "plan"}).json()["plan_selected"]["plan_id"]
    cap = client.post(f"/api/cases/{cid}/replay", json={"step": "cap", "base_plan_id": plan}).json()["plan_selected"]["plan_id"]
    assert client.get(f"/api/plans/{cap}").json()["constraints"]["stage_cap"] == 35     # the cap is on the plan
    opened = client.post(f"/api/cases/{cid}/activate").json()
    assert opened["constraints"] == prescription                                        # the case shows its prescription: no warning
    assert opened["active_plan"] == {"plan_id": cap, "constraints": client.get(f"/api/plans/{cap}").json()["constraints"]}
    assert len(client.get(f"/api/plans?case_id={cid}").json()["plans"]) == n_plans + 2  # no twin preview
    # the next turn from the capped plan still carries the cap; a turn from the case does not
    assert api.STORE.constraints_for(cid, cap).stage_cap == 35 and api.STORE.constraints_for(cid).stage_cap is None
    # a rule plan under a cap (POST /api/plan) leaves the same trace, and opening clears it the same way
    r = client.post("/api/plan", json={"case_id": cid, "stage_cap": 30, "parent_plan_id": cap})
    assert r.status_code == 200 and api.STORE.constraints_for(cid).stage_cap == 30
    assert client.post(f"/api/cases/{cid}/activate").json()["constraints"] == prescription
    # a changed prescription is still reported as such
    api.STORE.case_constraints[cid] = api.STORE.constraints_for(cid).patched({"lock": [3]})
    assert client.post(f"/api/cases/{cid}/activate").json()["constraints"]["lock"] == [3]
