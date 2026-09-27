"""Agent Skills bundled with the repo (workspace/skills/<name>/SKILL.md), read on demand by the agent.

The planner calls the `load_skill` tool with a skill name; this module resolves the name to a
SKILL.md file, splits the frontmatter (name, description) from the instructions, and returns both.
"""
from __future__ import annotations

import re
from pathlib import Path

SKILLS_DIR = Path(__file__).resolve().parents[3] / "workspace" / "skills"
_NAME = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")


def installed(root: Path = SKILLS_DIR) -> list[str]:
    return sorted(p.parent.name for p in root.glob("*/SKILL.md"))


def read_skill(name: str, root: Path = SKILLS_DIR, allowed: list[str] | None = None) -> dict:
    """`allowed` is the agent's skill allowlist, with OpenClaw's rules (tools/skills.md, "Agent allowlists"):
    None leaves every installed skill visible, [] exposes none, and a non-empty list is the final set."""
    if not isinstance(name, str) or not _NAME.match(name):
        raise ValueError(f"invalid skill name {name!r}; use lowercase letters, digits and hyphens")
    if allowed is not None and name not in allowed:
        raise ValueError(f"skill {name!r} is not allowed for this agent; allowed: {', '.join(allowed) or 'none'}")
    path = root / name / "SKILL.md"
    if not path.is_file():
        raise ValueError(f"unknown skill {name!r}; installed: {', '.join(installed(root)) or 'none'}")
    text = path.read_text(encoding="utf-8")
    if not text.startswith("---\n") or "\n---\n" not in text[4:]:
        raise ValueError(f"{path} has no YAML frontmatter")
    header, body = text[4:].split("\n---\n", 1)
    meta = {k.strip(): v.strip() for k, v in (line.split(":", 1) for line in header.splitlines() if ":" in line)}
    return {"name": meta.get("name", ""), "description": meta.get("description", ""), "instructions": body.strip()}
