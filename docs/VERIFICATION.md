# 재현 검증 기록

> 2026-09-24 · macOS arm64 · Python 3.12.13 · 새 가상환경, 개인 `.env` 없이 수행.
> 기반 코드: `lumatic2/cualign`의 `87f4a221569ac9307d6ca2d9a082f4c95be0067a`와 패키징·검증 보완 변경.

## 확인한 항목

| 검사 | 명령·방법 | 결과 |
|---|---|---|
| 새 환경 설치 | `uv sync --frozen --extra dev` | 잠금 파일 그대로 설치 성공 |
| 자동 검사 | `uv run --frozen pytest -q -p no:warnings` | 22개 통과. 기존 18개 + 패키징 2개 + API 2개 |
| NAT 구성 | 자동 검사에서 `nat validate --config_file configs/workflow.yml` 실행 | 통과. 원격 모델 호출 검증은 아님 |
| 규칙 CLI | `cualign plan "발치 없이 12개월 안에, 앞니 먼저" --case moderate` | 확장·IPR 실패 후 병행안 통과. 14단계, 계획상 3.2개월 |
| wheel 빌드 | `uv build --wheel` | 성공 |
| wheel 자산 | `python scripts/check_wheel.py <wheel>` | 치아 STL 14개·출처 1개·UI 3개 포함·비어 있지 않음 |
| 설치된 wheel | 소스 밖 별도 설치 경로에서 import·합성 케이스 생성 | 14개 치아와 정적 UI 확인. 전체 CLI 독립 설치 보장은 아님 |
| HTTP 경로 | 실제 로컬 Uvicorn 서버의 `/ui/`, `/ui/app.js`, `/api/cases` 요청 | HTTP 200 |
| 계획→파일 | `/api/plan` 규칙 폴백→선택 계획 ZIP 다운로드 | 동시 이동 기본값에서 7단계·STL 98개 확인 |
| 오류 경로 | 없는 계획의 조회·다운로드 | HTTP 404. 테스트에서도 확인 |
| 누락 회귀 | 누락·빈 자산으로 wheel 검사기 호출 | 실패를 감지하는 테스트 통과 |

## 이번에 확인하지 않은 항목

- NIM 실호출·Guardrails 원격 판정: 기존 `docs/demo/` 기록과 구별한다. 이번에는 재호출하지 않았다.
- NAT 서버의 전체 대화 흐름과 실제 브라우저의 3D 렌더링: HTTP 정적 파일·계산 API 검사로 대체할 수 없다.
- Docker 이미지 실행: 검증 기기에 Docker 명령이 없어 실행하지 못했다. Dockerfile은 잠금 파일을 복사하고 `uv sync --frozen --no-dev`를 사용하도록 수정했다.
- 세그먼테이션 모델 추론·OpenShell 서버 통합·장치 셸 생성·임상 유효성: 검증 범위가 아니다.

## 재현 범위

현재 지원 경로는 **저장소 체크아웃에서 설치·실행**이다. 서버와 벤치마크는 패키지 밖 `configs/`, `guardrails/`, `bench/`도 사용한다.
정적 자산이 wheel에 포함됐다는 사실만으로 wheel 단독 서비스 배포가 지원된다고 해석하지 않는다.
