"""#90: the plan on screen, and a revert to an earlier plan, reach the agent through the server context.

The screen sends `base_plan_id` (the plan it shows) with every request. The server already plans from that plan's
constraints; now it also tells the model, in one Korean line, which plan that is, and when newer plans of the case
exist, that the dentist went back to it. No new endpoint, no screen change."""
import json

from cualign.core import store as store_mod
from cualign.server import api
from cualign.server.plan_events import ChatContext, base_plan_ko, open_run


def _store(monkeypatch, tmp_path):
    monkeypatch.setattr(store_mod, "OUT_DIR", tmp_path)
    monkeypatch.setattr(api, "OUT_DIR", tmp_path)
    st = store_mod.Store()
    monkeypatch.setattr(api, "STORE", st)
    return st


def _context(st, ctx):
    _, msg = open_run(ctx, store=st)
    return json.loads(msg["content"].removeprefix("cuAlign server context: "))


def test_without_a_base_plan_the_context_is_unchanged(monkeypatch, tmp_path):
    st = _store(monkeypatch, tmp_path)
    ctx = _context(st, ChatContext(case_id="moderate"))
    assert "base_plan_ko" not in ctx and ctx["base_plan_id"] is None


def test_the_plan_on_screen_is_named_and_a_revert_is_said(monkeypatch, tmp_path):
    st = _store(monkeypatch, tmp_path)
    first = api.rule_based_plan("moderate")["tried"][0]["plan_id"]
    second = api.rule_based_plan("moderate", stage_cap=40, parent_plan_id=first)["tried"][-1]["plan_id"]   # the latest
    p1, p2 = st._record(first), st._record(second)
    ids = st.plan_ids_for("moderate")
    n_later = len(ids) - ids.index(first) - 1
    # the latest plan on screen: named, no revert
    line = _context(st, ChatContext(case_id="moderate", base_plan_id=second))["base_plan_ko"]
    assert line.startswith("화면에 보이는 계획: ") and "되돌렸다" not in line
    assert f"{p2['info']['n_stages']}단계(약 {p2['info']['months']}개월)" in line
    # the dentist went back to the first plan («이전 안으로 되돌리기»): the second is a dropped plan, not 이전 안
    line = _context(st, ChatContext(case_id="moderate", base_plan_id=first))["base_plan_ko"]
    assert line.startswith("의사가 화면에서 이 계획(") and "되돌렸다" in line and f"계획 {n_later}개는 버렸다" in line
    assert f"{p1['info']['n_stages']}단계(약 {p1['info']['months']}개월)" in line
    assert ("규칙 통과" in line) == (not p1["violations"])


def test_the_line_uses_the_dentists_words_for_every_strategy(monkeypatch, tmp_path):
    st = _store(monkeypatch, tmp_path)
    for t in api.rule_based_plan("moderate")["tried"]:
        line = base_plan_ko(st, "moderate", t["plan_id"])
        assert any(k in line for k in ("확장 전략", "IPR 전략", "확장 + IPR 전략", "발치 전략")), line
        assert "expansion" not in line and "extraction" not in line
