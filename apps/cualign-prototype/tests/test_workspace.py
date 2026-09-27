"""workspace/ is the one source of the agent definitions (OpenClaw workspace convention, DLI NemoClaw 03b).

The planner's instructions moved from configs/workflow.yml into workspace/AGENTS.md. The golden set (#73) is tuned to
that wording, so the string NAT hands the model must stay byte-identical to the one inlined before the move.
"""
import hashlib
from pathlib import Path

from nat.utils.io.yaml_tools import yaml_load

from cualign.core import skills as S

ROOT = Path(__file__).resolve().parents[1]
WS = ROOT / "workspace"
# sha256 of workflow.additional_instructions as inlined in configs/workflow.yml at 4808146 (5585 chars).
INSTRUCTIONS_SHA256 = "9d74b31b783e54dc3597e914da226a91dd6cdec81c5909be76bf0b7a8c53b65b"


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


def test_soul_and_memory_state_the_same_boundaries():
    soul = (WS / "SOUL.md").read_text(encoding="utf-8")
    memory = (WS / "MEMORY.md").read_text(encoding="utf-8")
    for doc in (soul, memory):
        assert "초안" in doc
        assert "진단" in doc and "처방" in doc
        assert "몰래 풀지 않는다" in doc
        assert "cuAlign 화면에서만" in doc
        assert "`memory/`" in doc and "환자를 식별할 수 있는 정보" in doc
    # guardrails/ and openshell/ stay the runtime source; SOUL.md points to them instead of copying them.
    for path in ("guardrails/prompts.yml", "guardrails/policy/cualign_clinical_scope_v1.0.0.md",
                 "openshell/policy.yaml", "openshell/server-policy.yaml"):
        assert path in soul and (ROOT / path).is_file()


def test_convention_files_and_no_memory_folder():
    for name in ("SOUL.md", "AGENTS.md", "IDENTITY.md", "USER.md", "TOOLS.md", "HEARTBEAT.md", "MEMORY.md", "README.md"):
        assert (WS / name).is_file(), name
    assert not (WS / "memory").exists()   # memory is off (MEMORY.md says why)
    assert "주기적으로 스스로 하는 작업은 없다" in (WS / "HEARTBEAT.md").read_text(encoding="utf-8")


def test_skills_live_only_in_workspace():
    assert S.SKILLS_DIR == WS / "skills"
    assert {"cualign-clinical-rules", "cualign-planner"} <= set(S.installed())
    assert S.read_skill("cualign-planner")["name"] == "cualign-planner"
    # No copy or redirect left at the old places (an empty folder git no longer tracks does not count).
    for old in (ROOT / "skills", ROOT / "nemoclaw" / "cualign-planner"):
        assert not [p for p in old.rglob("*") if p.is_file()], old
