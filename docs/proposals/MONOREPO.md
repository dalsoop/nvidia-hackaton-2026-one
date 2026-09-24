# 모노레포·협업 구조 제안 (초안)

> 상태: **제안. 팀 결정 필요.** 2026-09-24 작성.
> 전제(팀장 공지): TS + Electron 데스크톱 앱, lint, 모노레포, git worktree로 AI 에이전트 병렬 작업.
> 이 문서는 구조를 제안할 뿐 파일을 옮기지 않는다. 화면↔에이전트 데이터 형식은 [CONTRACT.md](CONTRACT.md)를 본다.

## 1. 확인이 필요한 전제

| 전제 | 근거 | 확인할 사람 |
|---|---|---|
| NAT·NeMo Guardrails·계산 코어는 **Python에 남는다** | NAT·Guardrails는 Python 패키지. 코어가 numpy/scipy/trimesh/manifold3d에 의존 | 팀장 |
| Electron main 프로세스가 **Python 사이드카**(`nat serve`, 현재 `CuAlignWorker`)를 localhost에서 띄우고 HTTP/SSE로 통신 | 현재 대화·API·UI가 한 FastAPI 프로세스(`server/worker.py`) | 팀장 |
| 예선 시연 환경은 로컬 데스크톱 1대, 단일 사용자 | SECURITY: 인증·격리 없는 PoC | 팀장·기획 |

위 전제가 틀리면(예: 전부 TS로 재작성) 아래 구조는 다시 잡는다.

## 2. 제안 구조

```
cualign/
  apps/desktop/          Electron + TS
    src/main/            사이드카 실행·종료, 포트 선택, 파일 저장 대화상자
    src/renderer/        화면(대화 패널, 3D 뷰어, 계획·비교 패널)
  services/agent/        Python (현재 src/cualign 전부)
    src/cualign/         core · agent · server
    configs/ guardrails/ openshell/ skills/ bench/ scripts/
    pyproject.toml uv.lock Dockerfile
  packages/contract/     화면↔에이전트 계약의 단일 원본
    schema/*.json        JSON Schema (원본)
    ts/                  생성된 TS 타입
    py/                  생성된 pydantic 모델
  evals/                 골든셋 A(동작) · B(합성) · C(실데이터)
  docs/                  PRD · TRD · proposals · demo
  package.json pnpm-workspace.yaml
  .github/workflows/
```

### 현재 최상위 → 새 위치

| 현재 | 새 위치 | 비고 |
|---|---|---|
| `src/cualign/` | `services/agent/src/cualign/` | import 경로 불변 |
| `src/cualign/server/static/` | 유지 후 `apps/desktop/src/renderer/`로 이전 | 이전 전까지 `/ui` 폴백 |
| `configs/` `guardrails/` `openshell/` `skills/` | `services/agent/` 아래 동일 이름 | `workflow.yml` 상대경로 확인 |
| `bench/` `scripts/` | `services/agent/` 아래 | `scripts/run_scenarios.py`의 `ROOT` 수정 |
| `tests/` | `services/agent/tests/` | `test_golden_a.py`는 `evals/tests/`로 |
| `evals/` | `evals/` (최상위 유지) | 여러 패키지를 판정하므로 |
| `pyproject.toml` `uv.lock` `Dockerfile` | `services/agent/` | Docker `COPY` 경로 수정 |
| `docs/` | `docs/` | |
| `README.md` `CONTRIBUTING.md` `AGENTS.md` `CLAUDE.md` `SECURITY.md` `LICENSE` | 최상위 유지 | 명령 예시만 갱신 |
| `.env.example` `.gitignore` | 최상위 유지 | `.gitignore`에 `node_modules/` `apps/desktop/out/` 추가 |
| `.github/workflows/ci.yml` | 최상위, 패키지별 job으로 분할 | §3 |

## 3. 도구·lint·CI

| 영역 | 도구 | 명령 |
|---|---|---|
| TS 패키지 관리 | pnpm workspaces (npm도 가능) | `pnpm install` |
| TS lint·형식 | ESLint + Prettier, `tsc --noEmit` | `pnpm -r lint` · `pnpm -r typecheck` |
| Python 환경 | uv | `uv sync --frozen --extra dev` (services/agent) |
| Python lint·형식 | ruff, ruff format | `uv run ruff check` · `uv run ruff format --check` |
| 계약 생성 | JSON Schema → TS(`json-schema-to-typescript`), pydantic(`datamodel-code-generator`) | `pnpm contract:gen` |

CI job (PR마다):

| job | 내용 |
|---|---|
| `agent` | 기존 단계 유지: `uv sync --frozen --extra dev` → wheel build·check → pytest → `nat validate` → `cualign plan` → `cualign bench`. 여기에 ruff 추가 |
| `desktop` | lint · typecheck · 단위 테스트 · (선택) Electron 빌드 |
| `contract` | 스키마로 다시 생성한 타입이 커밋본과 같은지(diff 0), 예제 JSON이 스키마를 통과하는지 |
| `golden` | 골든셋 A 오프라인(판정기 검증 + 캐시 로그 채점). NIM 실호출은 수동 워크플로로만 |

## 4. worktree 작업 방식 (사람·AI 공통)

규칙: **이슈 1개 = 브랜치 1개 = worktree 1개 = PR 1개.**

```sh
# 시작: main 최신에서 작업 폴더를 따로 만든다 (저장소 옆 폴더)
git fetch origin
git worktree add ../cualign-desktop-shell -b feat/desktop-shell origin/main
cd ../cualign-desktop-shell        # 이 폴더에서 AI 에이전트를 실행

# 진행 확인
git worktree list

# 끝: PR 병합 후 정리
cd ../cualign
git worktree remove ../cualign-desktop-shell
git branch -d feat/desktop-shell
```

| 항목 | 규칙 |
|---|---|
| 브랜치 이름 | `feat/<영역>-<내용>` · `fix/…` · `eval/…` · `docs/…` (영역: desktop, agent, core, contract, evals) |
| worktree 폴더 | `../cualign-<브랜치 끝부분>` |
| 비밀값 | worktree마다 `.env`를 복사해 쓰고 커밋하지 않는다 |
| Python 환경 | worktree마다 별도 `.venv` (iCloud 폴더면 `.venv.nosync` + 심볼릭 링크) |
| 동시 작업 | 한 패키지를 두 worktree가 동시에 크게 고치지 않는다 |

충돌을 줄이는 소유 규칙:

| 경로 | 주 담당 | 변경 시 리뷰 |
|---|---|---|
| `apps/desktop/` | 화면 담당 | 화면 담당 |
| `services/agent/` | 에이전트 담당 | 에이전트 담당 |
| `packages/contract/` | 공동 | **화면·에이전트 양쪽 승인 필수** |
| `evals/` | 평가 담당 | 평가 담당 + 해당 기능 담당 |
| `docs/PRD.md` | 기획 | 기획 |

사람이 보는 것("눈"): 코드 한 줄씩보다 **PR이 어떤 명세를 만족·변경하는지**. 동작을 바꾸는 PR은 골든셋 명세를 같이 추가·수정한다.

## 5. 이전 단계 (PR 단위, 매 단계 실행 가능 유지)

| # | PR | 끝난 뒤 확인 |
|---|---|---|
| 1 | 루트 `package.json`·`pnpm-workspace.yaml`·ruff 설정 추가. 파일 이동 없음 | 기존 CI 그대로 통과 |
| 2 | `packages/contract` 스키마 v0 + 생성 스크립트 + 예제 JSON | contract job 통과 |
| 3 | Python을 `services/agent/`로 이동 (`git mv`), CI·Dockerfile·스크립트 경로 수정 | `nat validate`·pytest·`cualign plan` 통과 |
| 4 | `apps/desktop` 뼈대: 사이드카 실행 + 기존 `/ui`를 창에 표시 | 로컬에서 앱이 열리고 대화 가능 |
| 5 | 서버에 계약 이벤트 스트림 추가(기존 `/chat/stream`은 유지) | 골든셋이 새 스트림으로 채점 가능 |
| 6 | renderer를 계약 이벤트 기반으로 교체, `/ui` 폴백 제거 | 시나리오 5종 수동 확인 |

### 09-28 예선 마감 전에 하지 않을 것

- 3번 이동과 기능 개발을 한 PR에 섞기
- 계산 코어·에이전트를 TS로 재작성
- 동작 중인 `/ui`를 대체 화면이 준비되기 전에 삭제
- 계약 스키마 없이 화면·에이전트를 각자 구현
- lint 일괄 자동 수정을 기능 PR에 포함 (형식 변경 PR은 따로)

## 6. 팀장에게 물을 것

1. Python 사이드카 전제가 맞는가? 아니면 에이전트까지 TS로 가는가?
2. pnpm과 npm 중 무엇을 쓰는가?
3. 예선 제출물은 Electron 앱인가, 기존 웹 UI로도 되는가? (앱 패키징·서명 필요 여부)
4. 이전(§5-3)은 예선 전인가 후인가?
5. 패키지별 주 담당은 누구인가?
6. AI 에이전트 종류(Claude Code·Codex 등)와 worktree 동시 개수 상한, 비용 한도는?
7. `main` 보호 규칙(리뷰 1명 이상, CI 필수)을 켤 것인가?
