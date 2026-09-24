---
name: cualign-clinical-rules
description: Validate and stage clear-aligner (투명교정) treatment plans against published clinical limits using the cuAlign tool set. Use when an agent or developer must check per-aligner movement, IPR, arch expansion, stage count, or tooth-collision constraints; choose or switch a space-gaining strategy (expansion, IPR, extraction); or turn a natural-language constraint like "no extraction, within 12 months" into stage caps. Draft-only — never diagnose or prescribe.
---

# cuAlign Clinical Rules

## Scope and safety boundary

- This skill produces **draft staging plans** and **rule-violation reports**. The dentist makes every clinical decision.
- Never state a diagnosis, never prescribe wear time or treatment, never claim a plan is final. Output wording: "규칙 통과 (의사 검토 전 초안)".
- Do not invent clinical numbers. Use only the table below. If a constraint is not in the table, say so and ask the dentist.
- Do not send patient scan data (STL/PLY meshes) to any endpoint other than the configured NVIDIA NIM inference URL. Meshes stay local.

## Clinical limits (sources: MDPI Applied Sciences 2024 staging review · Nature IJOS 2025 expert consensus · Align Technology 2016 press release)

| Constraint | Value | Note |
|---|---|---|
| Linear movement per aligner | 0.25 mm | hard limit for `plan_stages` |
| Angular / rotational movement per aligner | 1° / 2° | not enforced in MVP |
| Wear period per aligner | 7 days | months = n_stages * 7 / 30.4 |
| IPR per surface | 0.25 mm (incisors 0.3, canines/premolars 0.5) | stay within 50% of enamel thickness |
| Unilateral arch expansion | max 2 mm | stage the expansion if over 1 mm |
| Extraction threshold | space deficit over 8 mm | consider only if the user allows extraction |

## Strategy rules

1. Allowed strategies: `expansion`, `ipr`, `expansion_ipr` (both together — the usual clinical combination), `extraction`.
2. If the request forbids extraction ("발치 없이", "발치는 절대 안 돼"), never call `propose_target` with `extraction`.
3. Default order when nothing is specified: `expansion` → `ipr` → `expansion_ipr` → `extraction`. Each strategy gains a different amount of space; if the gain does not cover the crowding, `validate` reports `space_deficit` and you move to the next strategy.
4. Convert time limits to a stage cap before planning: `stage_cap = round(months * 30.4 / 7)`. "12개월" → 52, "10개월" → 43, "8개월" → 34.
5. After `validate` fails, switch to the next allowed strategy and rerun `propose_target → plan_stages → validate`. Stop when `passed` is true or all allowed strategies are exhausted.
6. When every allowed strategy fails, report the plan with the fewest violations and state plainly which constraint would have to be relaxed (e.g. "발치 없이는 8개월이 안 됩니다. 10개월이면 IPR 42장으로 됩니다"). Do not soften this.

## Tool sequence (NeMo Agent Toolkit function group `cualign`)

```
cualign__clinical_limits     {"unused": ""}                                   (once)
cualign__load_case           {"case_id": "moderate"}                           -> crowding_mm, teeth
cualign__propose_target      {"strategy": "...", "ipr_exclude": [..], "lock": [..]} -> target_id, space_deficit_mm
cualign__plan_stages         {"target_id": "...", "order": "simultaneous|anterior_first|sequential"} -> plan_id, n_stages, months
cualign__validate            {"plan_id": "...", "stage_cap": <int|null>}      -> passed, violations, by_type, sample
cualign__compare_strategies  {"allowed": [...], "stage_cap": <int|null>}      -> one plan per strategy (for "compare both")
cualign__export_stl          {"plan_id": "..."}                                -> download_url (zip of per-stage STL)
```

Tool names carry the `cualign__` prefix exactly. Ask ONE question first if extraction allowance or the time limit is missing.

## Reading a violation report

| `type` | Meaning | Usual fix |
|---|---|---|
| `move_limit` | a tooth moves more than 0.25 mm between consecutive stages | more stages (only if the cap allows) or a strategy with smaller total movement |
| `collision` | convex-hull overlap between two teeth exceeds baseline contact | strategy that creates space first (IPR/expansion), or reorder staging |
| `stage_cap` | n_stages exceeds the allowed cap | strategy with less total movement, `simultaneous` order, or ask the dentist to relax the time limit |
| `space_deficit` | the strategy cannot gain enough space for the crowding | next strategy in the ladder; if extraction is forbidden and nothing passes, say how many mm are missing |

## Final answer format (Korean)

Language justification: the users are Korean dentists and the hackathon submission is reviewed in Korean; the UI is Korean-only. If a request arrives in another language, answer in that language instead.

전략 · 총 장수 · 예상 기간(개월) · 위반 건수(종류별) · 호출한 도구 순서. End with the sentence: "이 계획은 초안입니다. 최종 판단은 의사가 합니다."
