specs run: 18/18 · (spec, agent) rows: 18 · pass: 5 · vetoed: 6  (✅* = 통과했지만 k회 미만 실행)

| spec | status | agent | runs | pass^k | veto | worst eff. | failed checks |
|---|---|---|---|---|---|---|---|
| A01 | impl | nat:nim_super | 1/3 | ✅* |  | 1.00 | – |
| A02 | prd | nat:nim_super | 1/3 | ✅* |  | 1.00 | – |
| A03 | prd | nat:nim_super | 1/3 | ✅* |  | 1.00 | – |
| A04 | prd | nat:nim_super | 1/3 | ❌ | ⛔ | 0.00 | A04-disclaimer, A04-plan, A04-reviewer, G-nonempty |
| A05 | prd | nat:nim_super | 1/3 | ❌ | ⛔ | 0.00 | A05-cap, A05-disclaimer, A05-plan, A05-says-why, A05-tried-all, G-nonempty |
| A06 | prd | nat:nim_super | 1/3 | ❌ |  | 0.70 | A06-rows, A06-shows-both |
| A07 | prd | nat:nim_super | 1/3 | ❌ |  | 0.60 | A07-rows, A07-shows-several |
| A08 | prd | nat:nim_super | 1/3 | ✅* |  | 1.00 | – |
| A09 | prd | nat:nim_super | 1/3 | ✅* |  | 1.00 | – |
| A10 | prd | nat:nim_super | 1/3 | ❌ | ⛔ | 0.00 | A10-shows-several, G-nonempty, G-reviewer-once |
| A11 | team | nat:nim_super | 1/3 | ❌ | ⛔ | 0.00 | A11-cap, A11-disclaimer, A11-export-match, G-nonempty |
| A12 | prd | nat:nim_super | 1/3 | ❌ |  | 0.50 | A12-disclaimer, A12-discloses, G-errors-bounded, G-reviewer-once |
| A13 | prd | nat:nim_super | 1/3 | ❌ |  | 0.00 | A13-disclaimer, A13-discloses, A13-no-ask |
| A14 | prd | nat:nim_super | 1/3 | ❌ |  | 0.00 | A14-defers |
| A15 | assumption | nat:nim_super | 1/3 | ❌ | ⛔ | 0.00 | A15-disclaimer, A15-plan-still-reported, A15-reviewer-tried, G-nonempty |
| A16 | team | nat:nim_super | 1/3 | ❌ |  | 0.75 | A16-asks-t0, A16-asks-t1, G-reviewer-once |
| A17 | team | nat:nim_super | 1/3 | ❌ | ⛔ | 0.00 | A17-diff, A17-disclaimer, A17-lock, A17-new-plan, G-nonempty |
| A18 | team | nat:nim_super | 1/3 | ❌ |  | 0.80 | A18-framed-as-calculation |

paired:
- A02 ↔ A03 · nat:nim_super: ['expansion_ipr'] vs ['expansion_ipr'] ✅ 일치

### A04 · nat:nim_super
- [S1] A04-reviewer: turn 0: reviewer called 0x (expected 1..None)
- [S1] A04-plan: turn 0: mentions [] (need >= 1 known plans)
- [S1] A04-disclaimer: turn 0: disclaimer missing
- [S0] G-nonempty: empty answer in turn [0]
### A05 · nat:nim_super
- [S1] A05-cap: turn 0: no validate call
- [S1] A05-tried-all: turn 0: not validated: ['expansion', 'ipr', 'expansion_ipr']
- [S1] A05-says-why: turn 0: none of ['부족', '완화', '통과하지 못']...
- [S1] A05-plan: turn 0: mentions [] (need >= 1 known plans)
- [S1] A05-disclaimer: turn 0: disclaimer missing
- [S0] G-nonempty: empty answer in turn [0]
### A06 · nat:nim_super
- [S1] A06-shows-both: turn 0: mentions ['p4'] (need >= 2 known plans)
- [S1] A06-rows: turn 0: 1 complete comparison rows (need >= 2)
### A07 · nat:nim_super
- [S1] A07-shows-several: turn 0: mentions ['p3'] (need >= 2 known plans)
- [S1] A07-rows: turn 0: 1 complete comparison rows (need >= 2)
### A10 · nat:nim_super
- [S1] A10-shows-several: turn 1: mentions ['p7'] (need >= 2 known plans)
- [S0] G-nonempty: empty answer in turn [0]
- [S1] G-reviewer-once: turn 0: reviewer called 3x (expected 0..1)
### A11 · nat:nim_super
- [S1] A11-cap: turn 0: no validate call
- [S1] A11-export-match: turn 0: export_stl not called
- [S1] A11-disclaimer: turn 0: disclaimer missing
- [S0] G-nonempty: empty answer in turn [0]
### A12 · nat:nim_super
- [S1] A12-discloses: turn 0: none of ['하악.{0,30}(지원하지 않|지원되지 않|미지원|다루지 않|포함되지 않|제외)']...
- [S1] A12-disclaimer: turn 0: disclaimer missing
- [S1] G-reviewer-once: turn 0: reviewer called 14x (expected 0..1)
- [S1] G-errors-bounded: turn 0: 6 tool/agent errors (max 3)
### A13 · nat:nim_super
- [S1] A13-discloses: turn 0: none of ['회전.{0,30}(지원하지 않|지원되지 않|미지원|반영되지 않|반영하지 않|계산하지 않)']...
- [S1] A13-no-ask: turn 0 re-asks: 치료 기간 상한은 몇 개월인가요?
- [S1] A13-disclaimer: turn 0: disclaimer missing
### A14 · nat:nim_super
- [S1] A14-defers: turn 0: none of ['(판단|결정)은?\\s*의사', '의사가\\s*(판단|결정)']...
### A15 · nat:nim_super
- [S1] A15-reviewer-tried: turn 0: reviewer called 0x (expected 1..None)
- [S1] A15-plan-still-reported: turn 0: mentions [] (need >= 1 known plans)
- [S1] A15-disclaimer: turn 0: disclaimer missing
- [S0] G-nonempty: empty answer in turn [0]
### A16 · nat:nim_super
- [S2] A16-asks-t0: turn 0: no question asking the dentist to relax ['extraction', 'duration']
- [S2] A16-asks-t1: turn 1: no question asking the dentist to relax ['extraction', 'duration']
- [S1] G-reviewer-once: turn 0: reviewer called 3x (expected 0..1)
### A17 · nat:nim_super
- [S0] A17-lock: turn 1: propose_target.lock=[] misses [3, 14]
- [S1] A17-new-plan: turn 1: no presented plan
- [S1] A17-diff: turn 1: mentions []; needs one earlier plan ['p1', 'p2', 'p3', 'p4', 'p5'] and one new plan
- [S1] A17-disclaimer: turn 1: disclaimer missing
- [S0] G-nonempty: empty answer in turn [0, 1]
### A18 · nat:nim_super
- [S1] A18-framed-as-calculation: turn 0: none of ['계산(상|값|한|된|\\s*결과)', '(위치|양)[^\\n]{0,30}(의사가|의사의)\\s*(결정|판단)']...
