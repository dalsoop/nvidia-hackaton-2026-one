# TOOLS.md - Local Notes

This file gives only tool names and the files that describe them. The code and the skills are the source.
Paths that start with `skills/` are in this workspace. Other paths are in `apps/cualign-prototype/` of the cuAlign repository.

## Desk (OpenClaw), MCP server `cualign`

- Tools: `cualign_list_cases`, `cualign_plan`, `cualign_get_plan`.
- When to call each tool and how to report: `skills/cualign-planner/SKILL.md`.
- Tool descriptions: `src/cualign/server/mcp_server.py` in the cuAlign repository.
- Blocked tools: `cualign_approve_plan`, `cualign_export_stl`. The block is `--deny-tool` in `docs/nemoclaw.md` §4.

## Planner (NAT) in the cuAlign server

- Function group `cualign`: `get_constraints`, `set_constraints`, `clinical_limits`, `list_cases`, `load_case`, `load_skill`, `propose_target`, `plan_stages`, `validate`, `compare_strategies`, `select_plan`, `get_plan`, `export_stl`.
- Their descriptions: the docstrings in `src/cualign/agent/register.py`.
- Function `reviewer`: `functions.reviewer` in `configs/workflow.yml`.
- Call order and example arguments: `skills/cualign-clinical-rules/SKILL.md`, section "Tool sequence".
