English · [한국어](README.ko.md)

# cuAlign: a clear-aligner staging agent

cuAlign takes a dentist's treatment conditions in plain language and drafts a tooth-movement plan for clear aligners. A calculation core checks each draft against geometric rules, and when a draft breaks a rule the agent tries another permitted strategy or asks the dentist a question. You adjust the conditions in a chat and compare the staged results in 3D.

> **Status.** This is a research prototype built for the NVIDIA hackathon, not a finished service and not a medical device. Every plan it produces is a draft, and the dentist makes the final decision. The output is per-stage tooth STL files and, when a gingiva scan is present, per-stage upper-arch models for 3D printing. None of it is a wearable aligner.

## Documentation

- Usage docs (English): <https://cualign.external.kr/docs/>
- Plain-text summary for LLMs: <https://cualign.external.kr/llms.txt>

The design documents in this repository are written in Korean.

| Document | What it covers |
|---|---|
| [Overview](docs/OVERVIEW.md) (Korean) | What staging is and why an agent handles it |
| [PRD](docs/PRD.md) (Korean) | Users, problem, goals, qualifier scope, acceptance criteria |
| [TRD](docs/TRD.md) (Korean) | Architecture, calculation method, data contracts, current limits |
| [Code map](docs/CODE_MAP.md) (Korean) | What each file does and where to make a change |
| [NVIDIA stack](docs/NVIDIA_STACK.md) (Korean) | Roles of NAT, NIM, Guardrails, OpenShell and Skills, and how far each was verified |
| [Agent workspace](workspace/README.md) | Agent definitions (SOUL, AGENTS and the rest) in one place, and how to install them in an OpenClaw sandbox |
| [Verification](docs/VERIFICATION.md) (Korean) | Checks that passed and items not yet confirmed |
| [Development guide](docs/DEVELOPMENT.md) (Korean) | Reading order, candidate tasks, done criteria, open team decisions |
| [Roadmap](docs/ROADMAP.md) (Korean) | Implementation and verification scope of the four features |
| [Known issues](docs/KNOWN_ISSUES.md) (Korean) | Reviewer errors, how to reproduce them, and what to watch for on handover |
| [UI and shape references](docs/DESIGN_REFERENCES.md) (Korean) | Observations and public sources behind the UI and geometry choices |

## What the demo shows

Pick a sample case (a real upper-arch scan with a dentist's prescription) or load separated tooth files. Confirm the prescription in the chat. The agent sets a target arrangement and a stage plan, runs the rule checks, and retries when a check fails. You compare and edit the result, then export the plan files.

The core scenarios are a draft that meets the conditions, a case where every permitted strategy fails, a strategy comparison, a follow-up question when the conditions are incomplete, and a replan after an edit. The full product goal includes aligner shape output, but the qualifier round only requires staging. Automatic segmentation of a single-mesh scan and direct 3D manipulation are optional extensions. Moving teeth by hand (직접 이동) is implemented as a PoC: on the target step it refines the agent's target arrangement, and on the setup step 「처음부터 수동 배치」 starts from the scan (see the limits below).

## Requirements

- Python 3.12 and [uv](https://docs.astral.sh/uv/)
- An NVIDIA API key from build.nvidia.com, only for the agent chat. Planning, tests and the rule-based CLI run without one.
- Network access for the chat (NIM calls) and for the web UI, which loads three.js from a CDN

## Install and run

Run every command below from the app folder, `apps/cualign-prototype/`. The CLI reads configuration and benchmark files from the repository, so installing the wheel by itself does not give you a working service.

These commands need no API key:

```sh
uv sync --frozen --extra dev
uv run pytest -q -p no:warnings          # parallel, skips tests marked slow
uv run pytest -q -p no:warnings --slow   # everything, same as CI
uv run nat validate --config_file configs/workflow.yml
uv run cualign plan "발치 없이 12개월 안에, 앞니 먼저" --case moderate
```

The last command asks for a plan with no extractions, finished within 12 months, front teeth first. `cualign plan` is a rule-based run that parses a limited set of **Korean** phrases. It is not the same mode as the NIM agent, which chooses tools in conversation. An English request runs, but its conditions are not read, so the CLI plans with defaults. The built-in synthetic cases are `aligned`, `mild`, `moderate`, `severe` and `extraction`.

Extractions are prescribed by FDI tooth number, and only premolars 14, 15, 24 and 25 can be named:

```sh
uv run cualign plan "14번과 24번 발치로" --case moderate   # extract 14 and 24
```

If the request says extractions are allowed but gives no tooth numbers, the CLI does not plan and asks for the numbers instead. The app never chooses which teeth to extract.

Plans are saved as JSON under `CUALIGN_OUT` (default `./out`). `uv run cualign bench` runs the rule benchmark and overwrites `bench/results.md`.

### Chat and 3D UI

```sh
cp .env.example .env
# Put your own key in NVIDIA_API_KEY in .env. Never commit a real key.
uv run cualign serve --host 127.0.0.1
```

Open <http://localhost:8000/ui/> in a browser. The server has no user authentication and no per-user data isolation, so treat it as a local demo.

### Docker

With a running Docker engine, this builds from the app folder's tracked files only:

```sh
git archive HEAD:apps/cualign-prototype | docker build -t cualign:local -
docker run --rm -p 127.0.0.1:8000:8000 --env-file .env cualign:local
```

The build leaves out uncommitted changes. To see only the UI and the keyless rule fallback, drop `--env-file .env`. Do not put the key in the Dockerfile or the image. Results stay inside the container and disappear when the `--rm` container stops, so download what you need first. The Docker build was verified on Linux arm64 only.

## How it works

A planning agent built on the NeMo Agent Toolkit (NAT) reads the conditions and calls calculation tools. The core returns a target arrangement, intermediate stages and any rule violations. The agent then tries another permitted strategy or asks the dentist. A read-only reviewer returns a review note or a failure state within at most 2 attempts and 40 seconds.

The web UI links the final plan event to the 3D view, cards and files, and shows the parent plan, conditions, review and approval state. Editing conditions creates a new plan, and only an approved plan exports tooth STL files. If a gingiva scan (`gingiva.stl`) is present, the ZIP also carries per-stage print models under `print_models/`.

A plan with rule violations or a failed review cannot be approved. The keyless rule fallback marks the review as not run, and the dentist can still approve it. Changing conditions in the UI forces a replan and a fresh approval. `cualign plan --export` refuses unapproved output.

### NVIDIA stack

| Component | Role in cuAlign |
|---|---|
| NeMo Agent Toolkit | Planning agent, read-only reviewer, calculation tools, chat server and plan events (`configs/workflow.yml`, `src/cualign/agent/`) |
| Nemotron on NIM | Chat and tool selection. The config uses `nvidia/nemotron-3-super-120b-a12b` and `nvidia/nemotron-3.5-lightning-30b-a3b` |
| NeMo Guardrails | Input and output checks on every agent call (`guardrails/`) |
| OpenShell | Runs the cuAlign server in a sandbox with restricted writes and network (`openshell/`) |
| NemoClaw | Calls cuAlign as an MCP server (`/mcp`) from an OpenClaw sandbox (`nemoclaw/`). Only offline tests pass so far |
| Agent Skill | Clinical-rules skill the planning agent reads before planning (`workspace/skills/cualign-clinical-rules/`) |
| NVIDIA skill catalog | `nemotron-policy-generator` generated the safety policy in `guardrails/policy/` offline |

Offline tests check configuration and registration. They do not prove that remote model calls succeed. [NVIDIA_STACK.md](docs/NVIDIA_STACK.md) (Korean) lists the verification level of each component.

## Repository layout

| Path | Contents |
|---|---|
| `src/cualign/core/` | Target arrangement and stage generation, geometric rule checks, storage and export |
| `src/cualign/agent/`, `configs/workflow.yml` | NAT tools, planning and review agents, Nemotron/NIM wiring |
| `src/cualign/server/` | API, chat-check middleware, static web UI |
| `guardrails/` | NeMo Guardrails config and prompts, plus the safety policy (`policy/`) built with an NVIDIA catalog skill |
| `openshell/` | Sandbox policy experiments |
| `nemoclaw/` | NemoClaw integration |
| `workspace/` | Agent definitions following the OpenClaw workspace convention (SOUL, AGENTS, IDENTITY, USER, TOOLS, HEARTBEAT, MEMORY), the Skill, and past scan reports. See [workspace/README.md](workspace/README.md) |
| `tests/`, `bench/`, `scripts/`, `docs/demo/` | Automated tests, rule benchmark, live-call scripts, earlier run logs |

## Known limits

- The geometry covers upper-arch teeth only: translation, rotation correction of the front teeth (FDI 12, 11, 21, 22), and vertical correction of teeth more than 1 mm above or below their neighbours. Rotation of canines, premolars and molars (outlines do not measure it), torque, the lower arch, occlusion and tissue response are not supported.
- Duration is the stage count times a fixed wear interval. It does not predict real treatment time.
- IPR is cut from the crown meshes with one flat plane per contact, half from each tooth, in a derived copy of the case (`src/cualign/core/ipr_cut.py`). The target, the stages, the collision check and the exported STLs use the cut crowns, and the original scan stays as it is. The collision check does not guarantee zero collisions for every tooth pair.
- Moving teeth by hand edits the target arrangement (final positions) only: mesiodistal, buccolingual and vertical translation and the turn about the long axis. Waypoints between stages, torque and tip are not edited. The edited arrangement is stored as a new target and goes through the same staging, rule checks and approval.
- Passing the rules is not clinical suitability and not dentist approval. Only a plan explicitly approved in the UI can be exported, and an edited plan needs approval again.
- Guardrails check chat input and output on every path that calls the agent. An answer is held until the output check finishes and is replaced by a refusal if blocked. Raw steps on the `/full` and `/atif` paths are not filtered, and a check error is logged at ERROR and the turn continues. With `CUALIGN_RAILS_FAIL_CLOSED=1`, a turn with a check error is refused instead. When the rails are on, requests containing a Korean resident registration number, mobile number or email pattern are refused before reaching the model, and answers matching the list of prescription or confirmation phrases are replaced with a refusal without calling the output rail model. Names, chart numbers and sentences outside that list are not caught.
- Scan segmentation inference, OpenShell isolation of the whole server, and aligner shell generation are not verified features.
- The reviewer can hit upstream 503 errors from NIM. It stops within its limits and blocks approval. See [KNOWN_ISSUES.md](docs/KNOWN_ISSUES.md) (Korean).

## Data, licenses and evidence

The three sample cases on the start screen are real upper-arch scans from the public Poseidon3D dataset (Kubik and Spanel, Bioengineering 11(10):1014, 2024, CC-BY-4.0). The prescriptions shown with them are a dentist's reading of those scans, recorded in `evals/real_scans/dentist_labels.yaml`, and are not part of the dataset. Sources and changes are in [samples/ATTRIBUTION.md](src/cualign/core/samples/ATTRIBUTION.md).

Tests, agent evaluations and the CLI use synthetic cases (`moderate` and the others) that place public tooth-crown shapes. Those shapes come from "Dental arches" by Lydran96 on Sketchfab, licensed CC-BY-4.0. See [templates/ATTRIBUTION.md](src/cualign/core/templates/ATTRIBUTION.md). No identifiable patient data or scans are committed.

The [model comparison](docs/model-swap.md) (Korean), [live-call logs](docs/demo/) and [rule benchmark](bench/results.md) record the code, models and settings at the time they were run. They are not a fresh full rerun and not clinical outcomes.

External shape assets follow the terms in the attribution files above.
