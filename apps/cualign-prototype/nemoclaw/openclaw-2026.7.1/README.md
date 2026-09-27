# OpenClaw 2026.7.1 templates

These files are copies of the OpenClaw workspace templates. The copies are the base of the desk workspace files. The table is the one record of their version and hash.

- OpenClaw version: 2026.7.1, the `openclaw` package in the NemoClaw desk image.
- Package root: `/usr/local/lib/nemoclaw/openclaw-runtime/node_modules/openclaw`.

| Copy | Path in the package | sha256 | Used by |
|---|---|---|---|
| `templates/HEARTBEAT.md` | `src/agents/templates/HEARTBEAT.md` | `ecce558615751a35aa173731e892ff3993f44bb4f5a1219c0a02994790c85528` | `workspace/HEARTBEAT.md`, same bytes |
| `templates/AGENTS.md` | `docs/reference/templates/AGENTS.md` | `7d340e13e845b8bf7c69c60f5dbcc7b5b0e03b1401496d2a091af7223499bbfc` | Base of the desk `AGENTS.md` |

Keep the copies unchanged. To update them, copy the files from a new OpenClaw version into a new folder, and record the version and the hashes here. `tests/test_workspace.py` checks the hashes.
