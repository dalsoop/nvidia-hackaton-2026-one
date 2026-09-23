# 모델 × 하네스 모드 실측 (NIM, build.nvidia.com)

같은 입력 "발치 없이 12개월 안에 끝나는 계획 짜줘. 앞니 총생부터 풀고." · 도구 4개 루프 · 2026-09-23 (스파이크 `contests/nvidia-agentic-hackathon/spike/stack`, 이 레포의 전신).

| 모델 | 하네스 모드 | 결과 | 소요 | 비고 |
|---|---|---|---|---|
| `nemotron-3.5-lightning-30b-a3b` | ReAct 텍스트 | 4도구 완주, 첫 전략 expansion, Final Answer **빈 문자열** | 29s | 1회 도구명 접두사 누락, 2/6회 NIM 소켓 60s 타임아웃 |
| `nemotron-3.5-lightning-30b-a3b` | 네이티브 tool calling | propose_target 뒤 **중단** ("Calling plan_stages" 를 텍스트로) | 19~137s | 작은 모델은 네이티브에서 더 나빠짐 |
| `nemotron-3-super-120b-a12b` | ReAct 텍스트 | 도구 2개 뒤 포맷 파싱 실패 반복 | — | clinical_limits 생략, 첫 전략 ipr |
| `nemotron-3-super-120b-a12b` | 네이티브 tool calling | **4도구 완주 + 한국어 요약** (ipr · 42장 · 9.7개월 · 위반 0) | **13.9s** | 기본값 |

전략 전환 실호출: "발치는 절대 안 돼. 8개월 안에" → super 가 expansion(48장) → stage_cap 위반 → **ipr 로 전환** → 다시 위반 → 발치 금지라 정직 실패 보고. 도구 7회 · 51.7s.

**읽는 법**: "모델 스왑 = config 한 줄" 은 사실이지만 **모델마다 맞는 하네스 모드가 다르다**(작은 모델 = ReAct 텍스트, 큰 모델 = 네이티브). 이 레포 기본값은 super + 네이티브. `configs/workflow.yml` 의 `llm_name` 또는 `--override workflow.llm_name nim_lightning` 으로 바꾼다(lightning 은 `use_native_tool_calling: false` 도 함께 바꿔야 한다).

## 이 레포(도구 8개) 재실측 — 2026-09-23

`python scripts/run_scenarios.py --llm <model> --native <true|false>` · 로그 `docs/demo/scenario-*-<model>-<mode>.log`

| 모델 | 모드 | 시나리오 | 결과 | 소요 |
|---|---|---|---|---|
| `nemotron-3-super-120b-a12b` | 네이티브 | 1 통과형 | 3전략 사다리 완주, 한국어 요약, plan_id 보고 | 32.6s · 41 호출줄 |
| `nemotron-3-super-120b-a12b` | 네이티브 | 2 정직 실패 | 3전략 시도 후 "1.19mm 부족" 보고 | 51.8s |
| `nemotron-3-super-120b-a12b` | 네이티브 | 3 비교 · 4 되묻기 · 5 수정 | 전부 의도대로 (compare 1회 호출 / 한 문장 질문 / lock·ipr_exclude 전달) | 14.8 · 8.6 · 59.2s |
| `nemotron-3.5-lightning-30b-a3b` | ReAct 텍스트 | 1 통과형 | 도구 4개 호출은 했지만 **최종 답이 러시아어 템플릿 문장** — 실사용 불가 | 30.2s |
| `nemotron-3.5-lightning-30b-a3b` | ReAct 텍스트 | 2 정직 실패 | **문자 깨진 출력**(비문) | 99.9s |
| `nemotron-3.5-lightning-30b-a3b` | 네이티브 | 1 통과형 | load_case 뒤 **중단**("Calling cualign__load_case" 텍스트) | 4.7s |

**읽는 법 (갱신)**: 도구가 4개에서 8개로 늘고 지시문이 길어지자 30B 는 두 모드 모두에서 무너졌다. 스파이크(4도구)에서는 ReAct 텍스트 모드로 완주했던 모델이다. 즉 "config 한 줄 스왑"은 배선 사실이지만 **이 작업 크기에서는 120B 가 필요하다**는 것이 실측 결론이고, 이것이 우리가 심사에 내는 정량 문장이다. 30B 는 제약 파싱처럼 도구가 1~2개인 작은 하위 작업에 라우팅할 후보로 남긴다(본선).
