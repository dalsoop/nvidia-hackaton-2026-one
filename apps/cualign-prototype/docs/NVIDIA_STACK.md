# NVIDIA 활용·대회 대응 지도

> 2026-09-24 · NVIDIA 기술별 실행 경로·설정·검증 수준.

## 1. 기술별 역할

| 기술 | 연결 파일 | 현재 역할과 근거 | 제한 |
|---|---|---|---|
| NeMo Agent Toolkit | `configs/workflow.yml`, `src/cualign/agent/`, `src/cualign/server/worker.py` | 계획 에이전트, 제한된 읽기 전용 검토 함수, 계산 도구, 대화 서버·계획 이벤트. 구성/오프라인 검사와 과거 실호출 기록 | 현재 모델·설정의 전체 대화 재검증 필요 |
| Nemotron / NIM | `configs/workflow.yml`, `.env.example`, `docs/model-swap.md` | 대화·도구 선택과 모델별 실호출 비교 | 키·모델 가용성 필요. 키 없는 폴백은 NIM 활용 증거가 아님 |
| NeMo Guardrails | `guardrails/`, `src/cualign/server/rails.py`, `src/cualign/server/rails_middleware.py`, `scripts/run_guardrails.py`, `docs/demo/guardrails*.md` | NAT 워크플로 미들웨어로 에이전트 호출마다 입력 범위 검사와, 답을 판정까지 쥐는 출력 검사. 그 앞에서 같은 미들웨어가 표준 라이브러리 정규식으로 식별정보·처방 문구를 봄(NeMo Guardrails 기능은 아님) | 진행 표시·`/full`·`/atif` 원 단계는 쥐지 않음. 타임아웃·오류 시 ERROR 로그 후 진행(`CUALIGN_RAILS_FAIL_CLOSED=1`이면 거절), 계산 API는 별도 |
| OpenShell | `openshell/policy.yaml`, `docs/openshell.md` | 파일·네트워크 접근 경계의 정책 실험 | 서버 전체를 감싼 운영 샌드박스가 아님. 현 정책은 NIM·출력 경로에 맞춘 완성 정책이 아님 |
| Agent Skill | `skills/cualign-clinical-rules/SKILL.md`, `skills/cualign-clinical-rules/skill-card.md` | 도메인 규칙·도구 사용 절차를 전달하는 자산. 거버넌스 카드는 카탈로그 스킬 `skill-card-generator`(github.com/NVIDIA/skills, d8519c5)로 오프라인 생성하고 팀이 검토함(#39) | 파일 존재를 NAT의 자동 로딩·실행 증거로 해석하지 않음. 카드는 초안이며 서명·카탈로그 제출은 하지 않음 |
| NVIDIA 스킬 카탈로그 (`nemotron-policy-generator` v0.1.0) | `guardrails/policy/`, `guardrails/config.yml` | build.nvidia.com/skills 의 스킬로 cuAlign 안전 정책(md·json·프롬프트)을 오프라인 생성하고, 그 Categories·Allow-list 를 content-safety 모델의 `custom_policy` 로 보냄(#37) | 스킬은 코딩 에이전트가 읽는 절차서라 실행 자체는 모델 호출이 아님. 호스팅 3.5 모델이 `custom_policy` 를 받는지는 실호출로 확인 |
| SkillSpector | `scripts/scan_skill.py`, `skills/skillspector-report*.md` | 위 Skill의 과거 정적·의미 검사 결과와 재실행 방법 | 현재 Skill은 당시 스냅샷과 다를 수 있음. 서버·제품 전체 보안 인증 아님 |

의미 검사 보고서 본문에는 0/100이 기록되어 있다. 이 점수는 검사 당시 Skill에 대한 결과이며,
현재 파일이나 서비스 전체의 안전성을 증명하지 않는다.

## 2. 대회 요건과 레포 구조

2026-09-24 [공식 대회 페이지](https://fastcampus.co.kr/NVIDIA_hackathon)의
[예선 안내 이미지](https://cdn.day1company.io/prod/uploads/202609/153942-1931/%E1%84%80%E1%85%A2%E1%84%8B%E1%85%AD-01.webp)를 확인했다.
공개 예선 안내에는 미션 확인 후 Build NVIDIA의 Skill API를 활용한 에이전트 데모를 제출한다고 적혀 있다.
이 문구만으로 **현재 NIM 연동이 그 요건을 충족한다거나, Skill Markdown 파일을 갖추면 충족한다고 단정하지 않는다.**
NVIDIA 공식 문서에서 [Agent Skills](https://docs.nvidia.com/skills/)는 에이전트가 읽는 지시·자료 묶음이다(접근 2026-09-24).
NIM 추론 API와 같은 개념이 아니다. 현재 레포는 자체 Skill과 검사 결과를 포함하지만,
공고의 ‘Skill API’ 표현이 인정하는 구체적인 활용 범위는 공개 문언만으로 확정하기 어렵다.

확인한 공개 안내에서는 특정 디렉터리 트리나 `AGENTS.md`·`CLAUDE.md`를 필수로 지정한 근거를 찾지 못했다.
현재 `src/`, `configs/`, `guardrails/`, `skills/`, `openshell/`, `tests/`, `docs/` 구조는
기존 구현을 유지하고 역할을 구분하기 위한 팀 구성이다. NVIDIA 예제의 관례를 대회 의무 사항으로 표기하지 않는다.

| 항목 | 현재 판단 | 후속 확인 |
|---|---|---|
| 에이전트 데모 | 기존 실행 흐름과 다섯 시나리오가 출발점 | 최신 코드로 팀 재현 |
| Build NVIDIA Skill API 활용 | 자체 Skill·검사 자산에 더해 카탈로그 스킬 `nemotron-policy-generator` 로 만든 정책이 가드레일에 들어감(#37). NIM과 구별 | 공고 문언의 구체적 인정 범위는 미확정 |
| 필수 레포 구조·파일 | 확인한 공개 안내에서 지정 근거 미발견 | 기존 구조는 개발·재현을 위한 구성 |

## 3. 검증 자료 읽기

- `docs/demo/`의 실호출 로그는 당시 모델·설정의 실행 결과다. 현재 코드의 재실행 결과와는 구별된다.
- `tests/test_stack_offline.py`는 구성과 등록을 확인하며 원격 모델 호출 성공을 검증하지 않는다.
- OpenShell 정책 실험은 해당 정책·명령의 관측이며 서버 전체의 격리 검증이 아니다.
- `scripts/run_scenarios.py`, `scripts/run_guardrails.py`, `scripts/scan_skill.py`는 원격 호출과 기존 결과 파일 갱신을 수반할 수 있다.
