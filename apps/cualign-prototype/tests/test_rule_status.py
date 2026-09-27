"""#91: an answer must not open with "규칙 위반은 없습니다" for a selected plan that failed validation. The rails
middleware checks the opening against the plan, with the rails on or off (golden set A, G-no-false-success).

The text rule on its own, then the real NAT app with a local fake planner (no NVIDIA call): the UI's /chat/stream and
the golden-set runner's in-process turn. A stage cap of 1 makes the moderate expansion + IPR plan fail on that cap only.
"""
import dataclasses
import inspect
import json
import re
from pathlib import Path

import pytest
from nat.utils.io.yaml_tools import yaml_load

from rails_fakes import ComparingLLM, FakeLLM, FakeRails, PlanningLLM
from test_golden_a_runner import _run
from test_rails_middleware import ask, serve, sse_event, store  # noqa: F401  (store is a fixture)
from evals.golden_a.checks import CHECKS
from cualign.core import planner
from cualign.server.rails_middleware import VIOLATION_KO, fix_rule_status, rule_status

ROOT = Path(__file__).resolve().parents[1]

OPENING = "**확장 + IPR 전략으로 12단계(약 2.8개월) 계획을 만들었습니다.**"
# The run9 answer of the issue: three collisions in the plan, "no violation" in the answer.
RUN9 = (f"{OPENING} 규칙 위반은 없습니다.\n"
        "- 조건: 발치 허용 아니요 · 고정 치아 3, 14번 · IPR 제외 치아 7, 8, 9, 10번\n"
        "- 검토: 통과, 단계당 이동량 0.243mm, 공간 부족 0.0mm, 양측 확장 2.0mm, IPR 면당 0.25mm\n"
        "이 계획은 초안입니다. 최종 판단은 의사가 합니다.")
COLLISIONS = [{"stage": s, "type": "collision", "teeth": [9, 10]} for s in (10, 11, 12)]
FAILS_ON_CAP = {"case_id": "moderate", "constraints": {"stage_cap": 1}}
CAP_STATUS = "규칙 위반: 단계 상한 초과 1건."


def answer_of(body: str) -> str:
    """The answer text of a /chat/stream body: the content of every chunk, in order."""
    chunks = [json.loads(line[len("data: "):]) for line in body.splitlines()
              if line.startswith("data: {") and '"choices"' in line]
    return "".join(c["choices"][0]["delta"].get("content") or "" for c in chunks)


def test_run9_opening_states_the_real_status():
    fixed = fix_rule_status(RUN9, COLLISIONS)
    assert fixed == RUN9.replace("규칙 위반은 없습니다.", "규칙 위반: 충돌 3건.")


def test_run1_list_lines_are_kept():
    """run1 had the collisions right in its 검토 line and still opened with "no violation"."""
    run1 = RUN9.replace("양측 확장 2.0mm", "충돌 3건(치아 9-10, 단계 10-12)")
    fixed = fix_rule_status(run1, COLLISIONS)
    assert fixed.split("\n")[0] == f"{OPENING} 규칙 위반: 충돌 3건."
    assert fixed.split("\n")[1:] == run1.split("\n")[1:]


@pytest.mark.parametrize("opening,expected", [
    (f"{OPENING} 규칙 위반이 없습니다.", f"{OPENING} 규칙 위반: 충돌 3건."),
    (f"{OPENING} 위반 사항 없음", f"{OPENING} 규칙 위반: 충돌 3건."),
    (f"{OPENING} 규칙 위반: 없음.", f"{OPENING} 규칙 위반: 충돌 3건."),
    (f"{OPENING} 위반 0건.", f"{OPENING} 규칙 위반: 충돌 3건."),
    (f"{OPENING} 모든 규칙을 통과했습니다.", f"{OPENING} 규칙 위반: 충돌 3건."),
    (f"{OPENING} 규칙 검증을 모두 통과했습니다.", f"{OPENING} 규칙 위반: 충돌 3건."),
    # the status on its own line before the list
    (f"{OPENING}\n규칙 위반은 없습니다.", f"{OPENING}\n규칙 위반: 충돌 3건."),
    # inside the bold sentence, after a comma: the clause before the comma stays
    ("**확장 + IPR 전략으로 12단계(약 2.8개월) 계획을 만들었고, 규칙 위반은 없습니다.**",
     "**확장 + IPR 전략으로 12단계(약 2.8개월) 계획을 만들었고, 규칙 위반: 충돌 3건.**"),
    # two claims make one status; the rest of the opening stays
    (f"{OPENING} 규칙 위반은 없습니다. 모든 규칙을 통과했습니다. 의사 확인이 필요합니다.",
     f"{OPENING} 규칙 위반: 충돌 3건. 의사 확인이 필요합니다."),
])
def test_no_violation_claims_are_replaced(opening, expected):
    assert fix_rule_status(opening + "\n- 검토: 통과", COLLISIONS) == expected + "\n- 검토: 통과"


@pytest.mark.parametrize("answer", [
    f"{OPENING} 규칙 위반: 충돌 3건.",
    f"{OPENING} 규칙 검증을 통과하지 못했습니다.",
    f"{OPENING} 규칙 검증 미통과.",
    f"{OPENING} 검토를 통과했습니다.",                     # the reviewer's status, not the rule check
    "- 확장: 12단계(약 2.8개월) · 통과\n- 규칙 위반은 없습니다",  # list lines only: no opening
    "",
])
def test_other_sentences_are_left_alone(answer):
    assert fix_rule_status(answer, COLLISIONS) == answer


def test_status_names_each_violation_in_plan_order():
    violations = [{"type": "space_deficit"}, *COLLISIONS[:2], {"type": "stage_cap"}, {"type": "new_kind"}]
    assert rule_status(violations) == "규칙 위반: 공간 부족 1건, 충돌 2건, 단계 상한 초과 1건, 기타 1건."


def test_every_planner_violation_has_the_instruction_name():
    """A type core/planner.py emits without a name here would be written «기타» (#98 added two). The planner keeps no
    list of types, so they are read from its source. Each name must be one the planner's instructions use; yaml_load
    reads the instructions whether they sit in workflow.yml or behind a file:// reference."""
    types = set(re.findall(r'"type": "([a-z_]+)"', inspect.getsource(planner)))
    assert types and not types - set(VIOLATION_KO), f"no Korean name for {sorted(types - set(VIOLATION_KO))}"
    text = yaml_load(ROOT / "configs" / "workflow.yml")["workflow"]["additional_instructions"]
    listed = re.sub(r"\s+", " ", text.split("Violations:")[1].split(".")[0])
    names = {n.strip() for n in listed.split(",")}
    assert not set(VIOLATION_KO.values()) - names, f"not in the instructions: {set(VIOLATION_KO.values()) - names}"


@pytest.mark.parametrize("kind,name", [("extraction_mismatch", "처방과 다른 발치"),
                                       ("extraction_space_open", "닫지 못한 발치 공간")])
def test_extraction_violations_get_their_names(kind, name):
    """The first-screen extraction sample (poseidon-000097) can fail on these."""
    answer = "**발치 전략으로 20단계(약 4.7개월) 계획을 만들었습니다.** 규칙 위반은 없습니다.\n- 검토: 통과"
    fixed = fix_rule_status(answer, [{"stage": None, "type": kind, "teeth": [5, 12]}])
    assert fixed == answer.replace("규칙 위반은 없습니다.", f"규칙 위반: {name} 1건.")


@pytest.mark.parametrize("rails", ["on", "off"])
def test_failed_plan_answer_is_corrected(store, tmp_path, monkeypatch, rails):
    """The UI route, streamed. With the rails on the output rail sees the corrected answer; with them off the check
    still runs."""
    if rails == "off":
        monkeypatch.setenv("CUALIGN_GUARDRAILS", "0")
    with PlanningLLM(RUN9) as llm, serve(tmp_path, monkeypatch, llm) as client:
        body = ask(client, "/chat/stream", cualign=FAILS_ON_CAP)
    selected = sse_event(body, "plan_selected")["plan_id"]
    assert [v["type"] for v in store.plans[selected]["violations"]] == ["stage_cap"]
    assert answer_of(body) == RUN9.replace("규칙 위반은 없습니다.", CAP_STATUS)
    assert sse_event(body, "plan_context")["rails"] == ("passed" if rails == "on" else "off")
    if rails == "on":
        assert FakeRails.last.outputs == [answer_of(body)]


def test_passed_plan_answer_is_unchanged(store, tmp_path, monkeypatch):
    with PlanningLLM(RUN9) as llm, serve(tmp_path, monkeypatch, llm) as client:
        body = ask(client, "/chat/stream", cualign={"case_id": "moderate"})
    assert store.plans[sse_event(body, "plan_selected")["plan_id"]]["violations"] == []
    assert answer_of(body) == RUN9


def test_answer_without_a_plan_is_unchanged(store, tmp_path, monkeypatch):
    """A question back selects no plan, so there is nothing to check its words against."""
    question = "기간 상한을 알려 주시겠어요? 규칙 위반이 없는 안을 찾으려면 필요합니다."
    with FakeLLM(question) as llm, serve(tmp_path, monkeypatch, llm) as client:
        body = ask(client, "/chat/stream", cualign={"case_id": "moderate"})
    assert "plan_selected" not in body and answer_of(body) == question


def test_comparison_answer_is_unchanged(store, tmp_path, monkeypatch):
    """A comparison names several plans. Here the selected expansion plan failed and the expansion + IPR plan passed,
    so a "no violation" clause may be true of another plan: the server leaves the model's lines as they are."""
    answer = ("**세 전략을 비교했습니다.** 확장 + IPR 안은 규칙 위반이 없습니다.\n"
              "- 확장: 12단계(약 2.8개월) · 규칙 위반: 공간 부족 1건, 충돌 20건\n"
              "- 확장 + IPR: 12단계(약 2.8개월) · 통과\n"
              "이 계획은 초안입니다. 최종 판단은 의사가 합니다.")
    with ComparingLLM(answer) as llm, serve(tmp_path, monkeypatch, llm) as client:
        body = ask(client, "/chat/stream", cualign={"case_id": "moderate"})
    selected = store.plans[sse_event(body, "plan_selected")["plan_id"]]
    assert selected["strategy"] == "expansion" and selected["violations"]
    assert any(p["strategy"] == "expansion_ipr" and not p["violations"] for p in store.plans.values())
    assert answer_of(body) == answer


def test_golden_runner_turn_is_corrected(tmp_path):
    """The golden-set runner's turn (not streamed, rails off as in every test): G-no-false-success passes on the
    corrected answer and would have failed on the model's."""
    script = [{"tool_calls": [("cualign__set_constraints", {"stage_cap": 1})]},
              {"tool_calls": [("cualign__propose_target", {"strategy": "expansion_ipr"})]},
              {"tool_calls": [("cualign__plan_stages", {"target_id": "$target_id"})]},
              {"tool_calls": [("cualign__select_plan", {"plan_id": "$plan_id"})]},
              {"content": RUN9}]
    tr, _, _ = _run("A08", script, tmp_path)
    assert tr.turns[0].answer == RUN9.replace("규칙 위반은 없습니다.", CAP_STATUS)
    assert CHECKS["no_false_success"](tr)[0] is True
    as_written = dataclasses.replace(tr, turns=[dataclasses.replace(tr.turns[0], answer=RUN9)])
    assert CHECKS["no_false_success"](as_written)[0] is False
