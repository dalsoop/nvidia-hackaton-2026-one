"""직접 이동 (core/manual.py): the dentist moves crowns of a target by hand; the result is a new target that is staged
and validated like any other. Frames, edit rules, the drag check, and the API that stores and stages the edit."""
import json

import numpy as np
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from cualign.core import manual, planner, store
from cualign.core.service import PlanningService
from cualign.core.store import Store
from cualign.server import api
from cualign.server.plan_events import ChatContext, open_run


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setattr(api, "OUT_DIR", tmp_path)
    monkeypatch.setattr(store, "OUT_DIR", tmp_path)
    monkeypatch.setattr(store, "STORE", Store())
    monkeypatch.setattr(api, "STORE", store.STORE)
    app = FastAPI()
    api.add_api_routes(app)
    with TestClient(app) as c:
        yield c


def _target(s, case_id="moderate", strategy="expansion", **patch):
    cid, case = s.load_case(case_id)
    c = s.constraints_for(cid).patched(patch)
    tid = PlanningService(s).target(cid, strategy, c)
    s.set_flow(cid, "target", constraints=c, target_id=tid, plan_id=None)
    return cid, case, tid


def test_frames_point_mesial_buccal_and_occlusal():
    s = Store()
    _, case = s.load_case("moderate")
    f = manual.frames(case)
    assert set(f) == set(case.ids)
    centre = np.mean([case.pos0[i] for i in case.ids], axis=0)
    for i, ax in f.items():
        m, b, o = (np.asarray(ax[k]) for k in ("mesial", "buccal", "occlusal"))
        assert np.isclose(np.linalg.norm(m), 1, atol=1e-3) and np.isclose(np.linalg.norm(b), 1, atol=1e-3)
        assert abs(m @ b) < 1e-3 and o.tolist() == [0, 0, 1]
        assert b[:2] @ (case.pos0[i] - centre)[:2] > 0            # buccal points out of the arch
    for i, nb in ((7, 8), (10, 9), (5, 6), (12, 11)):             # mesial points toward the midline neighbour
        assert np.asarray(f[i]["mesial"])[:2] @ (case.pos0[nb] - case.pos0[i])[:2] > 0


def test_apply_edits_moves_only_the_edited_crowns_and_refuses_locked_extracted_and_far():
    s = Store()
    cid, _, tid = _target(s, "poseidon-000097", "extraction", extraction=[5, 12], lock=[2])
    t = s.targets[tid]
    base, c = t["target"], t["constraints"]
    same, changed = manual.apply_edits(base, {7: {"d": base[7].tolist(), "yaw": planner.yaw_of(base, 7)}}, c)
    assert changed == [] and all((same[i] is None) == (base[i] is None) for i in base)
    d = base[7] + np.array([0.3, 0.0, -0.2])
    new, changed = manual.apply_edits(base, {7: {"d": d.tolist(), "yaw": 3.0}}, c)
    assert changed == [7] and np.allclose(new[7], d) and new.yaw[7] == 3.0
    assert np.allclose(new[8], base[8]) and planner.yaw_of(new, 8) == planner.yaw_of(base, 8)
    assert np.allclose(base[7], t["target"][7])                    # the base target is not touched
    with pytest.raises(ValueError, match="고정 치아 17번"):
        manual.apply_edits(base, {2: {"d": [0.5, 0, 0]}}, c)
    with pytest.raises(ValueError, match="발치하는 14번"):
        manual.apply_edits(base, {5: {"d": [0.5, 0, 0]}}, c)
    with pytest.raises(ValueError, match="범위"):
        manual.apply_edits(base, {7: {"d": [manual.MAX_EDIT_MM + 1, 0, 0]}}, c)
    with pytest.raises(ValueError, match="범위"):
        manual.apply_edits(base, {7: {"d": base[7].tolist(), "yaw": 90}}, c)
    with pytest.raises(ValueError, match="올바르지"):
        manual.apply_edits(base, {7: {"d": [float("nan"), 0, 0]}}, c)


def test_check_reports_the_overlap_a_push_into_the_neighbour_makes():
    s = Store()
    _, case, tid = _target(s)
    t = s.targets[tid]
    before = manual.check(case, t["target"], t["info"])
    assert before["min_stages"] >= 1 and before["min_months"] > 0
    m = np.asarray(manual.frames(case)[8]["mesial"])
    new, _ = manual.apply_edits(t["target"], {8: {"d": (t["target"][8] + 2.0 * m).tolist()}}, t["constraints"])
    after = manual.check(case, new, t["info"])
    pairs = {tuple(o["teeth"]) for o in after["overlaps"]}
    assert (8, 9) in pairs and (8, 9) not in {tuple(o["teeth"]) for o in before["overlaps"]}
    assert all(o["overlap_mm3"] > planner.NEW_OVERLAP_MM3 for o in after["overlaps"])


def test_api_check_save_and_stage_a_hand_edited_target(client):
    s = store.STORE
    cid, case, tid = _target(s)
    view = client.get(f"/api/cases/{cid}/targets/{tid}").json()
    assert set(view["frames"]) == {str(i) for i in case.ids} and view["info"].get("source") is None
    d = (np.asarray(view["stages"][0]["8"]) + 0.5 * np.asarray(view["frames"]["8"]["buccal"])).tolist()
    body = {"teeth": {"8": {"d": d, "yaw": 2.5}}}

    chk = client.post(f"/api/cases/{cid}/targets/{tid}/check", json=body).json()
    assert chk["changed"] == [8] and {"max_move_mm", "min_stages", "min_months", "overlaps"} <= set(chk)
    assert list(s.targets) == [tid]                                 # a check stores nothing

    saved = client.post(f"/api/cases/{cid}/targets/{tid}/manual", json=body).json()
    new = saved["target_id"]
    assert new != tid and saved["info"]["source"] == "manual" and saved["info"]["parent_target_id"] == tid
    assert saved["info"]["manual_teeth"] == [8] and saved["strategy"] == view["strategy"]
    assert np.allclose(saved["stages"][0]["8"], d, atol=1e-4) and saved["rotations"][0]["8"] == 2.5
    assert s.flow[cid]["target_id"] == new and s.flow[cid]["step"] == "target"
    # an edit of the edited target keeps the teeth moved before
    again = client.post(f"/api/cases/{cid}/targets/{new}/manual",
                        json={"teeth": {"9": {"d": view["stages"][0]["9"], "yaw": 1.0}}}).json()
    assert again["info"]["manual_teeth"] == [8, 9] and again["info"]["parent_target_id"] == new

    plan = client.post(f"/api/cases/{cid}/targets/{new}/stages", json={}).json()
    p = s.plans[plan["plan_id"]]
    assert p["target_id"] == new and plan["review"]["status"] == "skipped" and plan["manual"] is True
    assert np.allclose(p["stages"][-1][8], d, atol=1e-6) and planner.yaw_of(p["stages"][-1], 8) == pytest.approx(2.5)
    assert s.flow[cid] == {"step": "stages", "constraints": s.flow[cid]["constraints"], "target_id": new, "plan_id": plan["plan_id"]}
    rows = {r["plan_id"]: r for r in client.get(f"/api/plans?case_id={cid}").json()["plans"]}
    assert rows[plan["plan_id"]]["manual"] is True


def test_api_refuses_bad_edits(client):
    s = store.STORE
    cid, _, tid = _target(s, lock=[8])
    base = client.get(f"/api/cases/{cid}/targets/{tid}").json()["stages"][0]
    unchanged = {"teeth": {"7": {"d": base["7"], "yaw": s.targets[tid]["target"].yaw.get(7, 0.0)}}}
    r = client.post(f"/api/cases/{cid}/targets/{tid}/manual", json=unchanged)
    assert r.status_code == 400 and "옮긴 치아가 없습니다" in r.json()["detail"]
    r = client.post(f"/api/cases/{cid}/targets/{tid}/manual", json={"teeth": {"8": {"d": [0.4, 0, 0]}}})
    assert r.status_code == 400 and "고정 치아 11번" in r.json()["detail"]
    assert client.post(f"/api/cases/{cid}/targets/{tid}/check", json={"teeth": {"8": {"d": [0, 0]}}}).status_code == 422
    assert client.post(f"/api/cases/mild/targets/{tid}/manual", json={"teeth": {}}).status_code == 404
    assert client.post(f"/api/cases/{cid}/targets/t0/stages", json={}).status_code == 404
    assert list(s.targets) == [tid]


def test_stages_turn_is_told_the_target_was_moved_by_hand():
    s = Store()
    cid, case, tid = _target(s)
    t = s.targets[tid]
    new, changed = manual.apply_edits(t["target"], {8: {"d": (t["target"][8] + [0.2, 0, 0]).tolist()}}, t["constraints"])
    mid = s.put_target(cid, new, manual.manual_info(t["info"], tid, changed), t["constraints"])
    s.set_flow(cid, "target", constraints=t["constraints"], target_id=mid, plan_id=None)
    run, msg = open_run(ChatContext(case_id=cid, step="stages"), store=s)
    context = json.loads(msg["content"].removeprefix("cuAlign server context: "))
    assert context["target_id"] == mid == run.inherited_target_id
    assert "직접 옮긴" in context["target_manual_ko"] and "11번" in context["target_manual_ko"]
    s.set_flow(cid, "target", constraints=t["constraints"], target_id=tid, plan_id=None)   # the agent's own target
    _, msg = open_run(ChatContext(case_id=cid, step="stages"), store=s)
    assert "target_manual_ko" not in json.loads(msg["content"].removeprefix("cuAlign server context: "))
