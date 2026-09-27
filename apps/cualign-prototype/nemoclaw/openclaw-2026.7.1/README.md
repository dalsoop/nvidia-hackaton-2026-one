# OpenClaw 2026.7.1 template copy

This folder has a copy of one OpenClaw workspace template. `workspace/HEARTBEAT.md` has the same bytes. The table is the one record of its version and hash.

- OpenClaw version: 2026.7.1, the `openclaw` package in the NemoClaw desk image.
- Package root: `/usr/local/lib/nemoclaw/openclaw-runtime/node_modules/openclaw`.

| Copy | Path in the package | sha256 | Used by |
|---|---|---|---|
| `templates/HEARTBEAT.md` | `src/agents/templates/HEARTBEAT.md` | `ecce558615751a35aa173731e892ff3993f44bb4f5a1219c0a02994790c85528` | `workspace/HEARTBEAT.md`, same bytes |

Keep the bytes of the copy unchanged. To update it, copy the file from a new OpenClaw version into a new folder, and record the version and the hash here. `tests/test_workspace.py` checks the hash.
