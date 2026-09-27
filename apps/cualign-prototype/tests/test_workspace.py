"""workspace/ is the one source of the agent definitions (OpenClaw workspace convention, DLI NemoClaw 03b).

The planner's instructions moved from configs/workflow.yml into workspace/AGENTS.md. The golden set (#73) is tuned to
that wording, so the string NAT hands the model must stay byte-identical to the one inlined before the move.
"""
import hashlib
import re
from pathlib import Path

from nat.utils.io.yaml_tools import yaml_load

from cualign.core import skills as S

ROOT = Path(__file__).resolve().parents[1]
WS = ROOT / "workspace"
# sha256 of workflow.additional_instructions as inlined in configs/workflow.yml at 4808146 (5585 chars).
INSTRUCTIONS_SHA256 = "9d74b31b783e54dc3597e914da226a91dd6cdec81c5909be76bf0b7a8c53b65b"
# sha256 of src/agents/templates/HEARTBEAT.md in the openclaw 2026.7.1 package of the NemoClaw desk image.
OPENCLAW_HEARTBEAT_SHA256 = "ecce558615751a35aa173731e892ff3993f44bb4f5a1219c0a02994790c85528"
HANGUL = re.compile("[\u1100-\u11ff\u3130-\u318f\uac00-\ud7a3]")


def _instructions() -> str:
    return yaml_load(ROOT / "configs" / "workflow.yml")["workflow"]["additional_instructions"]


def test_nat_reads_the_instructions_from_workspace_agents_md():
    raw = (ROOT / "configs" / "workflow.yml").read_text(encoding="utf-8")
    assert "additional_instructions: file://../workspace/AGENTS.md" in raw
    assert "You are cuAlign, a staging-plan DRAFT assistant" not in raw   # no inline copy of the planner's instructions
    assert _instructions() == (WS / "AGENTS.md").read_text(encoding="utf-8")


def test_instructions_are_byte_identical_to_the_pre_move_snapshot():
    text = _instructions()
    assert len(text) == 5585
    assert hashlib.sha256(text.encode("utf-8")).hexdigest() == INSTRUCTIONS_SHA256
    assert hashlib.sha256((WS / "AGENTS.md").read_bytes()).hexdigest() == INSTRUCTIONS_SHA256


def test_agents_md_carries_the_core_rules():
    text = _instructions()
    assert "Never diagnose or prescribe" in text
    assert "FIRST set_constraints" in text and "Never call propose_target before" in text   # condition order
    assert "Call compare_strategies ONLY when the user asks to compare strategies" in text
    assert "Never silently relax these constraints" in text and "never loosen conditions" in text
    assert "No tool can approve a plan" in text and "the dentist must approve in the UI" in text


def test_convention_files_and_no_memory_folder():
    for name in ("SOUL.md", "AGENTS.md", "IDENTITY.md", "USER.md", "TOOLS.md", "HEARTBEAT.md", "MEMORY.md", "README.md"):
        assert (WS / name).is_file(), name
    assert not (WS / "memory").exists()   # memory is off (MEMORY.md says why)


def _sentences(text: str) -> list[str]:
    text = re.sub(r"<!--.*?-->", "", text, flags=re.S)
    parts = []
    for line in text.splitlines():
        cells = line.strip().strip("|").split("|") if line.lstrip().startswith("|") else [line]
        for cell in cells:
            parts += [s for s in re.split(r"(?<=[.!?])\s+", cell) if re.search(r"\w", s)]
    return parts


def test_english_workspace_files_follow_ste():
    # DESIGN.md §11 of the stable-agent-documentation-guidebook: English originals have no Hangul, and Vale counts
    # words as \S*\w\S* tokens. Context files keep 20 words or fewer. AGENTS.md and the skill bodies
    # are out of scope: their bytes are tied to the golden set (#73, #96).
    for name, limit in (("SOUL.md", 20), ("IDENTITY.md", 20), ("USER.md", 20), ("TOOLS.md", 20), ("MEMORY.md", 20)):
        text = (WS / name).read_text(encoding="utf-8")
        assert not HANGUL.search(text), name
        assert "\u2014" not in text, name
        for s in _sentences(text):
            assert len(re.findall(r"\S*\w\S*", s)) <= limit, (name, s)


def test_rules_have_a_reason_and_do_not_copy_the_planner():
    for name in ("SOUL.md", "USER.md", "MEMORY.md"):
        text = (WS / name).read_text(encoding="utf-8")
        rules = [line for line in text.splitlines() if re.match(r"\d+\. \*\*", line)]
        assert rules, name
        assert all("(Reason: " in line for line in rules), name
        # The boundaries live in AGENTS.md and the skills; the desk files point there instead of copying them.
        for copied in ("Never diagnose", "Never silently relax", "No tool can approve", "이 계획은 초안입니다"):
            assert copied not in text, (name, copied)
    soul = (WS / "SOUL.md").read_text(encoding="utf-8")
    assert "skills/cualign-planner/SKILL.md" in soul and (WS / "skills" / "cualign-planner" / "SKILL.md").is_file()
    # guardrails/ and openshell/ stay the runtime source; SOUL.md points to them instead of copying them.
    for path in ("guardrails/prompts.yml", "guardrails/policy/cualign_clinical_scope_v1.0.0.md",
                 "openshell/policy.yaml", "openshell/server-policy.yaml"):
        assert path in soul and (ROOT / path).is_file()


def test_tools_md_names_tools_and_points_to_their_source():
    text = (WS / "TOOLS.md").read_text(encoding="utf-8")
    for path in ("skills/cualign-planner/SKILL.md", "skills/cualign-clinical-rules/SKILL.md"):
        assert path in text and (WS / path).is_file()
    for path in ("src/cualign/server/mcp_server.py", "src/cualign/agent/register.py", "docs/nemoclaw.md"):
        assert path in text and (ROOT / path).is_file()
    assert "--deny-tool" in text and "null" not in text   # argument meanings stay in the docstrings and the skill


def test_heartbeat_md_is_the_openclaw_default():
    # openclaw 2026.7.1 src/agents/templates/HEARTBEAT.md: comments only, so OpenClaw skips the heartbeat model call.
    assert hashlib.sha256((WS / "HEARTBEAT.md").read_bytes()).hexdigest() == OPENCLAW_HEARTBEAT_SHA256


def test_skills_live_only_in_workspace():
    assert S.SKILLS_DIR == WS / "skills"
    assert {"cualign-clinical-rules", "cualign-planner"} <= set(S.installed())
    assert S.read_skill("cualign-planner")["name"] == "cualign-planner"
    # No copy or redirect left at the old places (an empty folder git no longer tracks does not count).
    for old in (ROOT / "skills", ROOT / "nemoclaw" / "cualign-planner"):
        assert not [p for p in old.rglob("*") if p.is_file()], old
