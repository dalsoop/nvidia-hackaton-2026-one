# 개발 안내

## 시작과 검증

Python 3.12·uv를 사용하고 저장소 루트에서 실행한다.

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

## 변경 원칙

- 제품 범위는 `docs/PRD.md`, 기술 계약과 한계는 `docs/TRD.md`를 따른다. 미결정 정책은 합의 전 임의 구현하지 않는다.
- 계산 로직은 `src/cualign/core/`에 두고 LLM 없이 테스트할 수 있게 유지한다.
- NAT 도구는 모듈 최상위 Pydantic 입력 모델 하나를 받는 async 함수와 반환 타입 주석을 유지한다.
- 충돌 계산 실패를 0으로 숨기지 않는다. 규칙 통과와 임상적 적합성·의사 승인을 혼동하지 않는다.
- 계산 상수 변경에는 적용 범위·출처·테스트를 함께 남긴다. 문헌값을 모든 환자의 기준으로 취급하지 않는다.
- 소스·자산·설정이 함께 필요한 변경은 빌드와 실행도 확인한다. 정적 UI와 치아 템플릿의 패키지 누락을 검사한다.
- 형상 자산의 `ATTRIBUTION.md`와 라이선스를 유지한다.
- 다른 작업자의 변경을 보존하고 요청 밖 리팩터링·삭제를 하지 않는다.

## PR에 남길 정보

변경 이유·범위, 실행한 검증과 결과, 실행하지 못한 검증, 알려진 한계를 적는다.
동작을 바꾸면 해당 명세·테스트도 갱신한다. 성공 결과만이 아니라 오류 경로도 검사한다.
사람과 코딩 에이전트 모두 이 규칙을 따른다. 개인 전용 스킬·기기·다른 레포는 개발 전제조건이 아니다.

## 데이터·보안

실제 `.env`, API 키, 환자 정보·스캔, 배포 권한이 없는 데이터를 커밋하거나 로그에 출력하지 않는다.
인증·사용자 격리가 없는 로컬 PoC를 그대로 공개 서비스로 배포하지 않는다. 자세한 범위는 `SECURITY.md`를 따른다.
