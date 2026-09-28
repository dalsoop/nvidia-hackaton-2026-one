# 개발 안내

## 시작과 검증

Python 3.12·uv를 사용하고 앱 폴더(`apps/cualign-prototype/`)에서 실행한다.

```sh
uv sync --frozen --extra dev
uv run pytest -q -p no:warnings
uv run nat validate --config_file configs/workflow.yml
uv run cualign plan "발치 없이 12개월 안에" --case moderate
uv build --wheel
uv run python scripts/check_wheel.py dist/cualign-0.1.0-py3-none-any.whl
```

로컬 UI는 `uv run cualign serve --host 127.0.0.1`로 실행한다. 대화에는 NVIDIA 키가 필요하다.
`scripts/run_scenarios.py`·`run_guardrails.py`·`scan_skill.py`는 원격 호출과 기존 기록 갱신을 수반한다.
오프라인 검사와 실호출 검증을 구분하고 기존 증거를 무심코 덮어쓰지 않는다.

## 요구사항과 구현 선택

- [PRD](docs/PRD.md)는 제품 목표·수용 기준이다. 미결정 사용자 동작을 확정 기능으로 바꾸기 전에는 기획·UI/UX 담당과 논의한다. 가정을 명시한 실험·프로토타입까지 금지하는 것은 아니다.
- [TRD](docs/TRD.md)는 현재 PoC 구조와 필요한 동작을 구분한다. 현재 폴더·스택·API를 영구 고정하는 문서가 아니다.
- 프레임워크, 모듈 분리, 저장 방식, 테스트 도구, 브랜치·리뷰 방식은 팀이 선택한다. 기존 자산을 재사용하되 필요하면 근거와 영향 범위를 설명하고 리팩터링·교체할 수 있다.
- 모든 구현 세부사항에 기획자의 승인을 요구하지 않는다. 제품 범위·사용자 경험·안전 경계에 영향을 주는 변경은 관련 담당과 함께 결정한다.

현재 계산 코드는 `src/cualign/core/`에 모여 있고 LLM 없이 검증할 수 있다. 이 테스트 가능성은 유지할 가치가 있지만 폴더 위치 자체가 요구사항은 아니다.
현재 NAT 도구는 모듈 최상위 Pydantic 입력 모델 하나를 받는 async 함수와 반환 타입 주석을 사용한다.
이는 현 버전의 등록 방식에 관한 주의사항이다. SDK·구조를 바꿀 때는 공식 문서와 구성·도구 실행 검증으로 호환성을 확인한다.

## 변경 시 확인할 것

- 충돌 계산 실패를 0으로 숨기지 않는다. 규칙 통과와 임상적 적합성·의사 승인을 혼동하지 않는다.
- 계산 상수 변경에는 적용 범위·출처·테스트를 함께 남긴다. 문헌값을 모든 환자의 기준으로 취급하지 않는다.
- 소스·자산·설정이 함께 필요한 변경은 빌드와 실행도 확인한다. 정적 UI와 치아 템플릿의 패키지 누락을 검사한다.
- 형상 자산의 `ATTRIBUTION.md`와 라이선스를 유지한다.
- 다른 작업자의 변경을 보존하고 합의한 작업 범위 밖 변경은 섞지 않는다.

## 화면·이벤트 회귀 검사

`node --test tests/plan-stream.test.mjs`로 스트림 조립·요청 식별을 검사한다.
`uv run --frozen --with playwright python tests/browser_flow.py`는 설치된 Chrome으로 합성 계획·가짜 검토 응답을 사용한다.
다른 환경에서는 PLAYWRIGHT_CHROMIUM_EXECUTABLE로 Chromium 실행 경로를 지정한다.
UI의 three.js CDN 접근이 필요하며 NVIDIA 모델 호출은 하지 않는다. 결과는 out/browser-acceptance/에 기록한다.
Windows에서 CLI 출력 인코딩 문제가 나면 PYTHONUTF8=1 환경에서 실행한다.

`tests/nim_live_check.py`는 실제 `nat serve`와 NIM으로 `/chat/stream` 2턴을 돌려
계획 선택 이벤트·조건 유지·검토 결과·승인 게이트를 확인한다. `.env`의 키와 원격 사용량이 필요하고
Guardrails 원격 판정도 함께 실행된다. 결과는 out/nim-live/에 남으며 키는 출력하지 않는다.
`tests/nim_review_live_check.py`는 같은 워크플로를 프로세스 안에서 띄워 미실행·실패 계획의 «검토 다시 요청»을
실제 NIM 검토와 메모 출력 레일로 확인한다. 결과는 out/nim-live/review-recovery.json에 남는다.
`tests/nim_manual_live_check.py`는 실행 중인 서버에서 샘플의 녹화된 셋업·목표 턴 뒤 치아 하나를 직접 이동하고,
실제 NIM 단계 턴 한 번이 그 목표를 새로 만들지 않고 그대로 단계로 나누는지 확인한다. 결과는 out/nim-live/manual-stages.json에 남는다. `--from-scan`은 셋업 뒤 「처음부터 수동 배치」에서 시작한다(manual-stages-scan.json).
오프라인 검사에 섞지 말고 실행 결과를 VERIFICATION에 날짜와 함께 남긴다.

## PR에 남길 정보

변경 이유·범위, 실행한 검증과 결과, 실행하지 못한 검증, 알려진 한계를 적는다.
동작을 바꾸면 해당 명세·테스트도 갱신한다. 성공 결과만이 아니라 오류 경로도 검사한다.
개인 전용 스킬·기기·다른 레포·하네스·커밋 의식은 개발 전제조건이 아니다.
작업 후보와 인수 시 주의점은 [개발 시작 안내](docs/DEVELOPMENT.md)와 [알려진 문제](docs/KNOWN_ISSUES.md)를 참고한다.

## 데이터·보안

실제 `.env`, API 키, 환자 정보·스캔, 배포 권한이 없는 데이터를 커밋하거나 로그에 출력하지 않는다.
인증·사용자 격리가 없는 로컬 PoC를 그대로 공개 서비스로 배포하지 않는다. 자세한 범위는 `SECURITY.md`를 따른다.
