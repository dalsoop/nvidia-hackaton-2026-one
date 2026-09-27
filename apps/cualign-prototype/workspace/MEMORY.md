# MEMORY.md

This workspace keeps no long-term memory and no `memory/` folder. (Reason: the cuAlign server stores the confirmed conditions, the plans, the review state and the approval state. A condition from chat memory can differ from the confirmed one and change a plan without notice.)

## Rule

1. **Keep patient identifiers out of each file that you write:** this includes this file. Identifiers are names, contact details, resident registration numbers, birth dates, addresses and chart numbers with a name. (Reason: they are personal information under the Korean Personal Information Protection Act.)

The other boundaries are in `skills/cualign-planner/SKILL.md`.

<!-- Sources: src/cualign/agent/context.py (PlanRun, request-local state); workspace/AGENTS.md (server context);
guardrails/policy/cualign_clinical_scope_v1.0.0.md (PII/Privacy category; Jurisdiction / locale notes). -->
