"""Offline checks of the NVIDIA stack wiring: NAT config validates, plugin registers, Guardrails config parses."""
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def test_nat_validate():
    r = subprocess.run([sys.executable, "-m", "nat.cli.main", "validate", "--config_file", str(ROOT / "configs" / "workflow.yml")],
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
