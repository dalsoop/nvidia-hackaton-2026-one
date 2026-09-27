# cuAlign agent workspace

This folder is the one source of the cuAlign agent definitions. Its layout follows the `.openclaw/workspace/` convention of the NVIDIA DLI NemoClaw course 03b (OpenClaw). Two agents read it, and each agent reads different files.

The English files are the originals. [README.ko.md](README.ko.md) is the Korean translation of this file.

## Readers

| Document | Reader | Reader task | Reader test |
|---|---|---|---|
| `AGENTS.md` | NAT planner in the cuAlign server | Make a draft plan from the conditions of this request, and report it in the answer format | Golden set #73 on these bytes |
| `skills/cualign-clinical-rules/` | NAT planner | Apply the clinical limits and the strategy rules in the tool sequence | Golden set #73 |
| `SOUL.md` | OpenClaw desk (`cualign-desk`) | Use the planner skill for each request, and keep the persona file unchanged | Not done |
| `IDENTITY.md` | OpenClaw desk | Name itself as the cuAlign front desk | Not done |
| `USER.md` | OpenClaw desk | Pass the conditions of the dentist as decisions, and accept tooth numbers and case ids | Not done |
| `TOOLS.md` | OpenClaw desk, maintainer | Find the file that describes a tool | Not done |
| `HEARTBEAT.md` | OpenClaw heartbeat | Skip the scheduled model call | Not done |
| `MEMORY.md` | OpenClaw desk | Keep no memory, and write no patient identifier | Not done |
| `skills/cualign-planner/` | OpenClaw desk | Call `cualign_plan` once for each request, and report the result in Korean | Not done |
| `README.md` | Maintainer | Find which agent reads a file, and install the desk files | Not done |

A reader test uses a new session with no other context, and it runs more than once. Source: R-004 and `guides/new-project.md` §1 in https://github.com/dalsoop/stable-agent-documentation-guidebook.

## `AGENTS.md` is a pinned prompt

`AGENTS.md` is the NAT planner prompt, and its bytes are pinned. It is not a template for a repository context file. The context file for coding agents is the repository root `AGENTS.md`.

- `configs/workflow.yml` reads it with `additional_instructions: file://../workspace/AGENTS.md`.
- `tests/test_workspace.py` checks its sha256 against the text before the move. The golden set (#73) is tuned to this text.
- A rewrite in Simplified Technical English goes together with a new golden-set run (#96).

## Connections

- **Skills:** `src/cualign/core/skills.py` reads `workspace/skills/<name>/SKILL.md`, for the `load_skill` tool and the server context preload.
- **Skill allowlists:** each agent has a list of the skills that it can use. The rules are the same as "Agent allowlists" in OpenClaw `tools/skills.md`.

  | Agent | Skills | Setting |
  |---|---|---|
  | NAT planner | `cualign-clinical-rules` | `function_groups.cualign.skills` in `configs/workflow.yml` |
  | OpenClaw desk (`cualign-desk`) | `cualign-planner` | `agents.list[].skills` in the OpenClaw settings |

  The planner refuses a `load_skill` request for a skill outside its list. The server does not start when the preloaded skill is outside the list. The allowlist is not a security boundary. Guardrails and OpenShell block tools and network access.
- **Images:** `Dockerfile` and `Dockerfile.openshell` copy `workspace/` to `/app/workspace`.

## Install in the OpenClaw sandbox

OpenClaw puts the files in `.openclaw/workspace/` of the sandbox into the conversation context. Do these steps for the desk sandbox `cualign-desk` in `docs/nemoclaw.md`.

1. Install the skill: `nemoclaw cualign-desk skill install workspace/skills/cualign-planner` (`docs/nemoclaw.md` §4).
2. Copy `SOUL.md`, `IDENTITY.md`, `USER.md`, `TOOLS.md`, `HEARTBEAT.md` and `MEMORY.md` to `.openclaw/workspace/` in the sandbox. Do the copy from the operator terminal, outside the sandbox.
3. Make `SOUL.md` read-only for the sandbox user. Course 04a names persona tamper as a risk.
4. Keep `AGENTS.md` and `skills/cualign-clinical-rules` out of the desk. They belong to the NAT planner, and the desk has no `cualign__` tools.

Steps 2 and 3 are not yet verified in a real sandbox. `docs/nemoclaw.md` gives the same status.

## Differences from the course convention

| Course convention | Here | Reason |
|---|---|---|
| Daily notes in `memory/`, summary in `MEMORY.md` | No memory, no `memory/` folder | The server stores the conditions and the plan history. A dentist conversation can contain patient data |
| Periodic tasks in `HEARTBEAT.md` | The OpenClaw default, with comments only | cuAlign acts only on a request. OpenClaw skips the heartbeat call when the file has only comments |
| One agent reads the workspace | The NAT planner and the OpenClaw desk read different files | The planning and the rule checks stay in the tested NAT agent. The desk asks it through MCP |
| `AGENTS.md` holds operating rules that change freely | A pinned NAT prompt | The golden set (#73) is tuned to its text |
| Boundaries in `SOUL.md` | `SOUL.md` points to the skill and to the runtime files | A copy of a boundary drifts from its source. Guardrails and OpenShell enforce the boundaries |
| An emoji in `IDENTITY.md` | Not set | No source gives one |
