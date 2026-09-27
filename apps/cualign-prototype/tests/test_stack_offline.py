"""Offline checks of the NVIDIA stack wiring: NAT config validates, plugin registers, Guardrails config parses."""
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def test_nat_validate():
    r = subprocess.run([sys.executable, "-X", "utf8", "-m", "nat.cli.main", "validate", "--config_file", str(ROOT / "configs" / "workflow.yml")],
                       capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=300)
    assert r.returncode == 0, r.stdout[-2000:] + r.stderr[-2000:]


def test_plugin_registers_all_tools():
    from nat.runtime.loader import PluginTypes, discover_and_register_plugins
    from nat.cli.type_registry import GlobalTypeRegistry
    discover_and_register_plugins(PluginTypes.COMPONENT)
    reg = GlobalTypeRegistry.get()
    names = {c.local_name for c in reg.get_registered_function_groups()}
    assert "cualign" in names


def test_guardrails_config_parses():
    from nemoguardrails import RailsConfig
    cfg = RailsConfig.from_path(str(ROOT / "guardrails"))
    assert [m.type for m in cfg.models] == ["main", "content_safety"]
    assert "self check input" in cfg.rails.input.flows
    assert "self check output" in cfg.rails.output.flows


def test_react_prompt_has_no_stray_template_variables():
    """A literal brace in additional_instructions becomes a LangChain variable and kills the agent at runtime.

    `nat validate` does not build the prompt, so this is the only offline check that catches it.
    """
    import yaml
    from nat.plugins.langchain.agent.react_agent.agent import create_react_agent_prompt
    from nat.plugins.langchain.agent.react_agent.register import ReActAgentWorkflowConfig

    cfg = yaml.safe_load((ROOT / "configs" / "workflow.yml").read_text(encoding="utf-8"))["workflow"]
    cfg.pop("_type")
    prompt = create_react_agent_prompt(ReActAgentWorkflowConfig(**cfg))
    assert set(prompt.input_variables) <= {"question", "chat_history", "agent_scratchpad", "tools", "tool_names"}, \
        f"unescaped braces in additional_instructions: {sorted(set(prompt.input_variables))}"


def test_content_safety_custom_policy_matches_policy_file():
    """The custom policy sent to the content-safety model (config.yml) must carry the categories of the policy the
    NVIDIA skill generated (guardrails/policy, #37), so the two cannot drift apart silently."""
    import json
    from nemoguardrails import RailsConfig

    policy_dir = ROOT / "guardrails" / "policy"
    md = (policy_dir / "cualign_clinical_scope_v1.0.0.md").read_text(encoding="utf-8")
    assert "nemotron-policy-generator" in md and "github.com/NVIDIA/skills" in md, "attribution missing"
    policy = json.loads((policy_dir / "cualign_clinical_scope_v1.0.0.json").read_text(encoding="utf-8"))
    cs = next(m for m in RailsConfig.from_path(str(ROOT / "guardrails")).models if m.type == "content_safety")
    text = cs.parameters["chat_template_kwargs"]["custom_policy"]
    assert policy["version"] in text
    deployed = [c["display_name"] for c in policy["categories"] if c["severity"] != "S1"]  # S1 stays with the scope rail
    assert deployed and all(name in text for name in deployed), [n for n in deployed if n not in text]


def test_planner_instructions_convert_fdi_to_universal():
    """#113: the dentist speaks FDI (14, 24), the tools take Universal (5, 12). The planner's instructions carry the
    conversion table and the extraction example in FDI, and the skill text (preloaded into the same context) agrees."""
    import re
    import yaml
    text = yaml.safe_load((ROOT / "configs" / "workflow.yml").read_text(encoding="utf-8"))["workflow"]["additional_instructions"]
    flat = " ".join(text.split())
    assert "FDI 18 17 16 15 14 13 12 11 -> Universal 1 2 3 4 5 6 7 8" in flat
    assert "FDI 21 22 23 24 25 26 27 28 -> Universal 9 10 11 12 13 14 15 16" in flat
    assert '"14번과 24번 발치" -> [5, 12]' in flat and "Never write a Universal number to the dentist" in flat
    for fdi, u in ((18, 1), (11, 8), (21, 9), (28, 16), (14, 5), (15, 4), (24, 12), (25, 13)):   # the stated formula
        assert (19 - fdi if fdi < 20 else fdi - 12) == u
    skill = (ROOT / "skills" / "cualign-clinical-rules" / "SKILL.md").read_text(encoding="utf-8")
    assert "14번과 24번 발치" in skill and re.search(r"5번과 12번 발치", skill) is None
