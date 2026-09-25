# 정책 파일의 출처

이 폴더의 정책은 NVIDIA 스킬 카탈로그(build.nvidia.com/skills = github.com/NVIDIA/skills)의
**`nemotron-policy-generator` v0.1.0**(커밋 `d8519c5`, 2026-09-24)으로 만들었다([#37](https://github.com/dalsoop/nvidia-hackaton-2026-one/issues/37)).
스킬은 코딩 에이전트(Claude Code)가 읽는 절차서라 2026-09-25 에 오프라인으로 실행했고 모델 호출은 없었다.
입력은 `guardrails/prompts.yml` 의 범위 문장, `src/cualign/core/rail_patterns.py` 의 정규식 목록, 팀 범위 문서의 «판단의 경계»,
2026-09-23 오탐 조사(한국어 계획 문장 2/7 이 «Criminal Planning»)다.

| 파일 | 스킬의 산출물 | 비고 |
|---|---|---|
| `cualign_clinical_scope_v1.0.0.md` | 정책 원문(`assets/policy_md_template.md` 형식) | 사람이 읽는 정본. 다른 파일은 여기서 나온다 |
| `cualign_clinical_scope_v1.0.0.json` | 분류 체계(`assets/policy_json_schema.json` 준수) | 심각도 S0–S4 는 런타임 메타데이터 |
| `cualign_clinical_scope_v1.0.0_system_prompt.txt` | 추론 프롬프트(템플릿 Pattern E) | 스킬이 겨냥한 Nemotron-3 를 Transformers/vLLM 로 띄울 때의 형식. 앱은 쓰지 않는다 |
| `../config.yml` 의 `custom_policy` | (스킬 밖) | 앱이 실제로 보내는 글. 호스팅 `nemotron-3.5-content-safety` 는 정책을 chat template kwarg `custom_policy` 로 받고, 모델 카드의 «### Policy / Disallowed / Allowed» 형식을 기대한다. 위 md 의 Categories·Allow-list 를 그 형식으로 옮겼다 |

스킬의 문서·참고 파일은 CC-BY-4.0, 스크립트는 Apache-2.0 이다(SKILL.md 머리말). 스킬 파일 자체는 레포에 두지 않았다.
스킬이 겨냥한 모델은 `nvidia/Nemotron-3-Content-Safety` 이고 앱이 쓰는 API 모델은 `nvidia/nemotron-3.5-content-safety` 다.
3.5 모델 카드는 `custom_policy` kwarg 와 한국어를 지원한다고 적고 있으나, 호스팅 엔드포인트가 실제로 받는지는 실호출로 확인한다(#37).
