# 평가 대상 에이전트 목록 (Evaluation Candidate Agents)

> `evals/agents/`는 벤치마크 및 정량 평가(`evals/runs/`)에서 평가 대상이 되는 다양한 방면의 에이전트 후보군을 정의합니다.

## 1. 목적과 다방면 구성

단일 에이전트만을 측정하는 것이 아니라, 특정 병목(되묻기 누락, 도구 무한 루프, 프롬프트 회귀 등)을 해결하기 위한
다양한 에이전트 아키텍처를 독립적으로 배치하여 비교 평가합니다.

| 에이전트 식별자 | 파일 | 특징 및 평가 목적 |
|---|---|---|
| `production_react` | `production_react.py` | `configs/workflow.yml` 기반 실제 NeMo Agent Toolkit (NAT) ReAct 에이전트 (NIM Nemotron 연동). 실제 배포본 평가 |
| `reference_rule` | `reference_rule.py` | LLM 없이 정석 규칙으로 제약조건 파싱과 도구 호출을 수행하는 결정적 기준선 에이전트 (이론적 상한선) |
| `clarification_first` | `clarification_first.py` | **P1-2 특화**: 비발치 여부 및 치료 기간 등 필수 조건이 모호할 때 무조건 사전 되묻기를 강제 집행하는 에이전트 |
| `loop_guarded` | `loop_guarded.py` | **P1-4 특화**: 동일 인자 도구 호출이 2회 이상 연속 발생하면 이를 감지하고 루프를 차단하는 에이전트 |
| `baseline_silent` | `baselines.py` | 항상 침묵/모르겠습니다를 반환하는 기준선 (평가기가 무응답을 감지하는지 검증) |
| `baseline_always_ask` | `baselines.py` | 조건이 충분해도 항상 되묻기만 반복하는 기준선 (평가기가 지연/스톨링을 감지하는지 검증) |
| `baseline_yes_man` | `baselines.py` | 도구 호출 없이 통과된 계획처럼 그럴듯하게 답하는 기준선 (평가기가 도구 없는 환각을 감지하는지 검증) |

## 2. 사용 방법

```python
from evals.agents import AVAILABLE_AGENTS

# 원하는 에이전트 선택
agent_cls = AVAILABLE_AGENTS["clarification_first"]
agent = agent_cls()

# 턴 실행
turn = agent.run_turn("발치 없이 앞니 먼저")
print(turn.answer)
print(turn.tool_calls)
```
