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
    assert "cualign__load_skill" in text
    assert "cualign-clinical-rules" in text
    assert "cualign-clinical-rules" in S.installed()
