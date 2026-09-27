# cuAlign agent workspace

This folder is the one source of the cuAlign agent definitions. Its layout follows the `.openclaw/workspace/` convention of the NVIDIA DLI NemoClaw course 03b (OpenClaw). Two agents read it, and each agent reads different files.

The English files are the originals. [README.ko.md](README.ko.md) is the Korean translation of this file.

## Readers

| Document | Reader | Reader task | Reader test |
|---|---|---|---|
| `AGENTS.md` | NAT planner in the cuAlign server | Make a draft plan from the conditions of this request, and report it in the answer format | Golden set #73 on these bytes |
| `skills/cualign-clinical-rules/` | NAT planner | Apply the clinical limits and the strategy rules in the tool sequence | Golden set #73 |
| `SOUL.md` | OpenClaw desk (`cualign-desk`) | Answer an approval request in text, use the planner skill for other requests, and keep the persona file unchanged | Pass, 2026-09-27: the approval request got no `cualign_*` call and no new plan in 3 of 3 runs. Without rule 1, 3 of 3 runs called `cualign_*` tools |
| `IDENTITY.md` | OpenClaw desk | Name itself as the cuAlign front desk | Not done: no test prompt asks for the name |
| `USER.md` | OpenClaw desk | Pass the conditions of the dentist as decisions, and accept tooth numbers and case ids | Not done: no test prompt gives conditions |
| `TOOLS.md` | OpenClaw desk | Find the skill that tells when to call each tool | Pass, 2026-09-27: the case list request got 1 `cualign_list_cases` call in 3 of 3 runs |
| `HEARTBEAT.md` | OpenClaw heartbeat | Skip the scheduled model call | No run. `tests/test_workspace.py` checks that the bytes are the OpenClaw default, which has comments only |
| `MEMORY.md` | OpenClaw desk | Keep no memory, and write no patient identifier | Partly, 2026-09-27: after 15 runs, no `memory/` folder and no change to `MEMORY.md`. No run gave a patient identifier |
| `skills/cualign-planner/` | OpenClaw desk | Call `cualign_plan` once for each request, and report the result in Korean | Pass, 2026-09-27: the plan request got 1 `cualign_plan` call with `ui_url` in 3 of 3 runs. One question for the conditions, then that call after the reply, also passes |
| `README.md` | Maintainer | Find which agent reads a file, find the source of a tool or a boundary, and install the desk files | Not done: no maintainer session yet |

A reader test uses a new session with no other context, and it runs more than once. `docs/nemoclaw.md` records the prompts and each run. Source: R-004 and `guides/new-project.md` §1 in https://github.com/dalsoop/stable-agent-documentation-guidebook.

## `AGENTS.md` is a pinned prompt

`AGENTS.md` is the NAT planner prompt, and its bytes are pinned. It is not a template for a repository context file. The context file for coding agents is the repository root `AGENTS.md`.

- `configs/workflow.yml` reads it with `additional_instructions: file://../workspace/AGENTS.md`.
- `tests/test_workspace.py` checks its sha256 against the text before the move. The golden set (#73) is tuned to this text.
- A rewrite in Simplified Technical English goes together with a new golden-set run (#96).
- The clinical-rules skill body (`skills/cualign-clinical-rules/SKILL.md`) also waits for #96. It has Korean text in English sentences and negative rules. The planner reads this skill in its context, so the golden set is tied to it. The desk skill (`skills/cualign-planner/SKILL.md`) does not wait. Its only Korean text is quoted terms and output text.

## Connections

- **Skills:** `src/cualign/core/skills.py` reads `workspace/skills/<name>/SKILL.md`, for the `load_skill` tool and the server context preload.
- **Skill allowlists:** each agent has a list of the skills that it can use. The rules are the same as "Agent allowlists" in OpenClaw `tools/skills.md`.

  | Agent | Skills | Setting |
  |---|---|---|
  | NAT planner | `cualign-clinical-rules` | `function_groups.cualign.skills` in `configs/workflow.yml` |
  | OpenClaw desk (`cualign-desk`) | `cualign-planner` | `agents.list[].skills` in the OpenClaw settings |

  The planner refuses a `load_skill` request for a skill outside its list. The server does not start when the preloaded skill is outside the list. The allowlist is not a security boundary. Guardrails and OpenShell block tools and network access.
- **Images:** `Dockerfile` and `Dockerfile.openshell` copy `workspace/` to `/app/workspace`.
- **OpenClaw templates:** `HEARTBEAT.md` is a copy of an OpenClaw template. `nemoclaw/openclaw-2026.7.1/README.md` records the version and the hashes.

## Sources for the maintainer

The desk files point only to files in the desk workspace. These sources are outside it.

| Subject | Source |
|---|---|
| Descriptions of the desk tools | Docstrings in `src/cualign/server/mcp_server.py` |
| Descriptions of the planner tools | Docstrings in `src/cualign/agent/register.py`. The reviewer is `functions.reviewer` in `configs/workflow.yml` |
| Planner tool order and example arguments | Section "Tool sequence" in `skills/cualign-clinical-rules/SKILL.md` |
| Input scope check and output check prompts | `guardrails/prompts.yml` |
| Content safety policy: categories, allow-list, severity | `guardrails/policy/cualign_clinical_scope_v1.0.0.md`. The deployed text is in `guardrails/config.yml` |
| Sandbox file and network limits | `openshell/policy.yaml`, `openshell/server-policy.yaml` |
| Block of the approval and export tools at the desk | `--deny-tool` in `docs/nemoclaw.md` §4 |

## Install in the OpenClaw sandbox

OpenClaw puts the files in `.openclaw/workspace/` of the sandbox into the conversation context. Do these steps for the desk sandbox `cualign-desk` in `docs/nemoclaw.md`.

1. Install the skill: `nemoclaw cualign-desk skill install workspace/skills/cualign-planner` (`docs/nemoclaw.md` §4).
2. Copy `SOUL.md`, `IDENTITY.md`, `USER.md`, `TOOLS.md`, `HEARTBEAT.md` and `MEMORY.md` to `.openclaw/workspace/` in the sandbox. Do the copy from the operator terminal, outside the sandbox.
3. Change `SOUL.md` only in this repository, and copy it again. `docs/nemoclaw.md` records if the sandbox can lock the file.
4. Keep `AGENTS.md` and `skills/cualign-clinical-rules` out of the desk. They belong to the NAT planner, and the desk has no `cualign__` tools.

`docs/nemoclaw.md` records the verification status of these steps.

## Differences from the course convention

| Course convention | Here | Reason |
|---|---|---|
| Daily notes in `memory/`, summary in `MEMORY.md` | No memory, no `memory/` folder | See `MEMORY.md` |
| Periodic tasks in `HEARTBEAT.md` | The OpenClaw default, with comments only | cuAlign acts only on a request. See the comment in `HEARTBEAT.md` |
| One agent reads the workspace | The NAT planner and the OpenClaw desk read different files | The planning and the rule checks stay in the tested NAT agent. The desk asks it through MCP |
| `AGENTS.md` holds operating rules that change freely | A pinned NAT prompt | The golden set (#73) is tuned to its text |
| Boundaries in `SOUL.md` | `SOUL.md` points to the planner skill, except for approval and export requests | See rules 1 and 2 in `SOUL.md`. The runtime sources are in the table above |
| An emoji in `IDENTITY.md` | Not set | No source gives one |
