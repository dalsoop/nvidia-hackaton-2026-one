"""Agent Skill wiring: the planner reads skills/<name>/SKILL.md through the load_skill tool."""
from pathlib import Path

import pytest
import yaml

from cualign.core import skills as S

ROOT = Path(__file__).resolve().parents[1]


def _workflow() -> dict:
    return yaml.safe_load((ROOT / "configs" / "workflow.yml").read_text(encoding="utf-8"))


def test_bundled_skill_is_readable():
    skill = S.read_skill("cualign-clinical-rules")
    assert skill["name"] == "cualign-clinical-rules"
    assert skill["description"]
    assert "Clinical limits" in skill["instructions"]
    assert not skill["instructions"].startswith("---")


@pytest.mark.parametrize("name", ["../cualign-clinical-rules", "Cualign-Clinical-Rules", "", "a/b", "rules/../../etc"])
def test_invalid_names_are_rejected(name):
    with pytest.raises(ValueError, match="invalid skill name"):
        S.read_skill(name)


def test_unknown_skill_error_lists_installed_skills():
    with pytest.raises(ValueError, match="cualign-clinical-rules"):
        S.read_skill("no-such-skill")


def test_planner_gets_the_tool_and_reviewer_does_not():
    from cualign.agent.register import CuAlignToolConfig

    assert "load_skill" in CuAlignToolConfig().include
    groups = _workflow()["function_groups"]
    assert "include" not in groups["cualign"]  # planner uses the default list
    assert "load_skill" not in groups["cualign_ro"]["include"]


def test_planner_instructions_point_to_an_installed_skill():
    text = _workflow()["workflow"]["additional_instructions"]
    assert "cualign__ prefix" in text  # instructions name tools without the prefix once it is stated
    assert "call load_skill" in text   # the fallback when the server context does not carry the skill
    assert "do not call load_skill" in text   # #48: the preloaded skill is not read again
    assert "cualign-clinical-rules" in text
    assert "cualign-clinical-rules" in S.installed()


def test_planner_instructions_fix_the_call_order():
    """#48 2026-09-27 실측: 문맥을 미리 주자 모델이 set_constraints 전에 propose_target 을 부르거나(A03-cap) 비교 요청이
    아닌데 compare_strategies 를 불렀다(A08-no-compare). 지시문이 그 둘을 막는다."""
    text = _workflow()["workflow"]["additional_instructions"]
    assert "FIRST set_constraints" in text and "Never call propose_target before" in text
    assert "compare_strategies ONLY when the user asks to compare" in text


def test_preloaded_skill_is_the_installed_one():
    """workflow.yml preloads a skill into the server context (#48); it must be an installed skill and the tool's default."""
    from cualign.agent.register import ContextPreload, CuAlignToolConfig

    pre = ContextPreload.model_validate(_workflow()["function_groups"]["cualign"]["context_preload"])
    assert pre.case and pre.limits and pre.skill in S.installed()
    assert CuAlignToolConfig().context_preload == ContextPreload()   # absent block: nothing extra
