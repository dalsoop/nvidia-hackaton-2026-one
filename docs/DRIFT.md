# Drift 측정 설계

> 설계 제안이다. 코드·CI·기존 검증 명령은 바꾸지 않는다. 채택 여부와 도구 선택은 팀이 정한다.
> 기존 구조는 [TRD](TRD.md), 파일 위치는 [코드 안내](CODE_MAP.md), 현재 검증 결과는 [재현 검증 기록](VERIFICATION.md)을 참조한다.

## 1. 목적

코드가 바뀌는 동안 성능, 문서, 저장소 구조가 조용히 어긋나는 현상을 drift라고 부른다.
이 설계의 목적은 drift를 커밋 단위로 측정하고, 기록으로 쌓고, 의도하지 않은 변화만 드러내는 것이다.

현재 저장소에서 drift가 생기는 지점은 다음과 같다.

| 대상 | 현재 상태 | drift가 생기는 방식 |
|---|---|---|
| 성능 | `cualign bench`가 실행할 때마다 `bench/results.md`를 덮어쓴다 | 이전 결과와 비교할 기록이 남지 않는다. 단계 수·전략·위반 수가 바뀌어도 알아차리기 어렵다 |
| 에이전트 실호출 | reviewer 빈 응답·파싱 오류·재시도가 [알려진 문제](KNOWN_ISSUES.md)에 사람이 적은 기록으로만 있다 | 모델·설정을 바꿔도 같은 조건의 수치 비교가 없다 |
| 문서 | [코드 안내](CODE_MAP.md)가 파일 목록을 손으로 유지한다 | 파일이 추가·이동되면 목록이 낡는다. 지금은 일치하지만 이를 확인하는 검사가 없다 |
| 구조 | "계산 코어는 LLM과 분리한다"는 원칙이 문서에만 있다 | 현재 `core/`는 에이전트·서버·LLM 라이브러리를 참조하지 않지만, 이를 막는 검사가 없다 |

## 2. 적용 범위

- **재는 것**: 합성 케이스의 결정적 계산 결과, 실행 시간, 선택 시 에이전트 실호출 지표, 문서와 코드의 일치, 저장소 구조 규칙
- **재지 않는 것**: 임상 유효성, 실제 치료 기간, 환자 데이터. 규칙 통과를 임상 판단으로 해석하지 않는 기존 원칙을 그대로 따른다
- **기본 경로는 오프라인이다.** 원격 모델 호출은 비용과 키가 필요하므로 명시적으로 요청할 때만 측정한다

## 3. 추상화

drift 측정을 언어와 저장소에 묶이지 않는 다섯 요소로 나눈다. 새 규칙은 매니페스트에 한 줄을 더하는 방식으로 쌓이고, 새 종류의 검사가 필요할 때만 정책 코드를 더한다.

| 요소 | 역할 | 이 저장소에서의 형태 (제안) |
|---|---|---|
| 매니페스트 | 무엇을 재고 어떤 규칙을 지킬지 선언한다. 목록의 정본이다 | 루트 `drift.toml` |
| 수집기 | 특정 커밋의 저장소에서 측정값을 뽑아 레코드로 만든다. 언어·도구마다 따로 둔다 | 벤치 수집기, 문서 수집기, import 수집기 |
| 정책 | 레코드·기준선·매니페스트를 받아 판정을 돌려주는 순수 함수다. 단위 테스트 대상이다 | 규칙 종류마다 함수 하나 |
| 기록 | 커밋별 측정 결과를 추가만 하는 방식으로 쌓는다. 기준선은 그중 하나를 가리킨다 | `drift/records/`, `drift/baseline.json` |
| 진입점 | 위 요소를 하나의 명령으로 묶는다 | `drift status`, `drift record`, `drift check`, `drift compare` |

### 규칙 종류

매니페스트의 규칙은 아래 종류 중 하나다. 종류가 언어에 독립적이므로 다른 저장소는 수집기만 바꿔 같은 매니페스트 형식을 쓸 수 있다.

| 종류 | 판정 | 예시 |
|---|---|---|
| `metric-exact` | 결정적 지표가 기준선과 같아야 한다 | 프리셋별 선택 전략, 단계 수, 위반 수 |
| `metric-tolerance` | 기준선 대비 허용 범위 안이어야 한다. 넘으면 경고한다 | 실행 시간 중앙값 |
| `import-forbidden` | 한 영역이 다른 영역을 참조하지 않아야 한다 | `cualign.core`가 `cualign.agent`, `cualign.server`, `nat`, `langchain`, `nemoguardrails`를 참조하지 않는다 |
| `listed-in` | 대상 파일이 모두 문서에 나와야 하고, 문서의 경로가 모두 실재해야 한다 | `src/`, `scripts/`, `tests/`의 파일이 `docs/CODE_MAP.md`에 나온다 |
| `generated-matches` | 생성 파일이 생성 결과와 같아야 한다 | `bench/results.md`가 기록된 벤치 레코드에서 생성한 결과와 같다 |
| `path-allowed` | 특정 파일이 허용된 위치에만 있어야 한다 | 에이전트 지시 파일은 저장소 루트에만 둔다 |

### 매니페스트 예시

```toml
[performance]
presets = ["aligned", "mild", "moderate", "severe", "extraction"]
repeat = 5                          # 시간 지표는 반복 실행 후 중앙값

[[performance.metric]]
id = "ladder-result"
kind = "metric-exact"
fields = ["strategy", "n_stages", "months", "tried", "caught"]

[[performance.metric]]
id = "ladder-time"
kind = "metric-tolerance"
field = "seconds_median"
tolerance = 0.25                    # 기준선 대비 25% 초과 시 경고

[[structure.rule]]
id = "core-isolated-from-llm"
kind = "import-forbidden"
from = "cualign.core"
to = ["cualign.agent", "cualign.server", "nat", "langchain", "nemoguardrails"]
reason = "계산 코어를 LLM 없이 검증할 수 있게 유지한다"

[[documentation.rule]]
id = "code-map-covers-sources"
kind = "listed-in"
document = "docs/CODE_MAP.md"
paths = ["src/**/*.py", "scripts/*.py", "tests/*.py", "bench/*.py"]
```

규칙마다 `reason`을 한 줄 적는다. 이유가 남아 있어야 나중에 규칙을 지워도 되는지 판단할 수 있다.

## 4. 성능 drift

### 지표

| 층 | 지표 | 결정성 | 판정 |
|---|---|---|---|
| 계산 | 프리셋별 혼잡도, 선택 전략, 단계 수, 계획상 기간, 시도한 전략 수, 잡아낸 위반 수, 비교 기준안의 단계·위반 수 | 결정적 | `metric-exact`. 달라지면 실패 |
| 계산 | 프리셋별 실행 시간 | 비결정적 | `metric-tolerance`. 반복 중앙값을 기준선과 비교하고 넘으면 경고만 한다 |
| 에이전트 실호출 (선택) | 응답 시간, 도구 호출 수, 재시도 수, 빈 응답·파싱 오류 수, 최종 규칙 통과 여부 | 비결정적 | 같은 모델·설정의 기록끼리만 비교한다. CI에서 실행하지 않는다 |

결정적 지표는 현재 `bench/bench.py`가 이미 계산한다. 수집기는 이 값을 Markdown 표 대신 레코드로 내보내고, `bench/results.md`는 레코드에서 생성한다.

### 의도한 변화와 의도하지 않은 변화

계산 로직을 바꾸면 결정적 지표가 바뀌는 것은 정상이다. 이때는 같은 PR에서 `drift/baseline.json`을 갱신하고 PR 설명에 이유를 적는다.
리뷰어는 기준선의 diff로 어떤 프리셋의 무엇이 바뀌었는지 확인한다. 기준선을 갱신하지 않았는데 지표가 바뀌면 의도하지 않은 변화로 보고 실패시킨다.

### 시간 지표의 잡음

CI 실행기의 성능은 실행마다 다르다. 그래서 시간 지표는 실패 조건으로 쓰지 않고 경고로만 쓴다.
기준선과 비교할 때는 같은 환경(로컬 기기 또는 같은 종류의 실행기)에서 기록한 값끼리 비교한다. 레코드에 환경 정보를 함께 남긴다.

## 5. 문서 drift와 구조 drift

- **문서 목록**: `listed-in` 규칙으로 `docs/CODE_MAP.md`와 실제 파일을 양방향으로 대조한다. 묶음 표현(`패키지별 __init__.py`, `docs/demo/`)은 매니페스트에 예외로 선언한다.
- **생성 문서**: `bench/results.md`처럼 코드가 만드는 문서는 `generated-matches`로 검사한다. 손으로 고친 생성 문서를 막는다.
- **구조 규칙**: `import-forbidden`으로 계산 코어의 분리를 검사한다. 현재 이 규칙은 지켜지고 있으므로 첫 규칙으로 도입해도 기존 코드를 고칠 필요가 없다.
- **문서에 적힌 날짜와 수치**: [재현 검증 기록](VERIFICATION.md)처럼 기록 당시의 수치를 담는 문서는 drift 검사 대상에서 제외한다. 기록 문서는 당시의 사실이고, 최신 값은 `drift/records/`가 가진다.

## 6. 기록 형식

레코드 하나는 한 커밋에서 한 번 측정한 결과다.

```json
{
  "schema": "drift-record/v1",
  "commit": "c2d80a8",
  "recorded_at": "2026-09-24T00:00:00Z",
  "environment": {"os": "macOS", "arch": "arm64", "python": "3.12.13"},
  "performance": {
    "moderate": {"strategy": "expansion_ipr", "n_stages": 7, "months": 1.6, "tried": 3, "caught": 2,
                 "seconds_median": 1.2, "seconds_runs": [1.2, 1.1, 1.3, 1.2, 1.2]}
  },
  "structure": {"core-isolated-from-llm": {"passed": true}},
  "documentation": {"code-map-covers-sources": {"missing": [], "stale": []}}
}
```

- `drift/records/`에는 추가만 한다. 기존 레코드를 고치지 않는다.
- `drift/baseline.json`은 비교 기준이 되는 레코드 하나를 가리킨다. 기준선 변경은 PR diff로 리뷰한다.
- 에이전트 실호출 레코드는 모델 이름과 설정 파일 해시를 함께 남긴다. 비용이 드는 측정이므로 실행한 사람과 이유도 적는다.

## 7. 도구 선택

새 도구를 만들기 전에 기존 도구로 채울 수 있는지 먼저 본다. 아래는 후보이며, 팀이 고른다.

| 필요 | 기존 도구 후보 | 이 저장소에 맞는 점과 한계 |
|---|---|---|
| 커밋별 성능 추적 | [asv](https://asv.readthedocs.io/), [pytest-benchmark](https://pytest-benchmark.readthedocs.io/) | 시간 측정과 비교는 잘 하지만, 단계 수·전략 같은 도메인 지표의 정확 일치 비교는 직접 다뤄야 한다 |
| 생성 문서 일치 | [cog](https://nedbatchelder.com/code/cog/) `--check` | Python 도구이고 `bench/results.md` 같은 생성 구간에 바로 쓸 수 있다 |
| import 경계 | [import-linter](https://import-linter.readthedocs.io/) | `forbidden`·`layers` 계약이 `import-forbidden` 규칙과 같다. 의존성 하나가 늘어난다 |
| 문서의 낡은 코드 참조 | [DOCER](https://github.com/wesleytanws/DOCER_tool) | 오탐이 많다고 보고되었다. 쓴다면 실패가 아닌 경고로 둔다 |

기존 도구를 쓰지 않는 규칙은 표준 라이브러리(`tomllib`, `ast`, `json`, `subprocess`)만으로 구현할 수 있는 크기다. 개인 도구나 다른 저장소를 전제하지 않는다.

## 8. 단계별 도입

| 단계 | 내용 | 기존 동작에 미치는 영향 |
|---|---|---|
| 1 | 이 설계 문서 | 없음 |
| 2 | 벤치 수집기가 레코드를 내보내고, 첫 기준선을 기록한다 | `cualign bench`의 출력은 유지한다 |
| 3 | `drift check`로 결정적 지표와 `import-forbidden`을 검사한다 | 로컬 명령만 추가한다 |
| 4 | `listed-in`, `generated-matches`를 추가한다 | 문서 예외를 매니페스트에 선언한다 |
| 5 | CI에 `drift check`를 추가한다. 결정적 지표는 실패, 시간은 경고 | CI 시간이 반복 실행 횟수만큼 늘어난다 |
| 6 | 선택: 에이전트 실호출 레코드 | 키와 비용이 필요하다. 수동 실행만 한다 |

각 단계는 별도 PR로 올리고, 앞 단계를 되돌리지 않아도 멈출 수 있게 한다.

## 9. 결정이 필요한 것

| 항목 | 선택지 | 제안 |
|---|---|---|
| 진입점 위치 | `cualign drift` 하위 명령 / 별도 `tools/drift/` 모듈 | 별도 모듈. 제품 CLI와 개발 도구를 분리하고, 다른 저장소로 옮기기 쉽다 |
| 기록 저장 위치 | 저장소 안 `drift/records/` / CI 아티팩트 / 별도 브랜치 | 저장소 안. 기준선 변경을 PR에서 리뷰할 수 있다 |
| 기록 시점 | main 머지마다 / 필요할 때 수동 | 해커톤 기간에는 수동. 기준선 갱신이 필요한 PR에서 함께 기록한다 |
| 시간 허용 오차 | 10%·25%·50% | 반복 실행으로 잡음을 먼저 재고 정한다 |
| 에이전트 실호출 지표 | 포함 / 제외 | 레코드 형식만 정해 두고 측정은 수동으로 한다 |
| 도구 | 7절 후보 / 표준 라이브러리만 | 첫 단계는 표준 라이브러리만. 필요해지면 도구를 추가한다 |
