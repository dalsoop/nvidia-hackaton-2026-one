# cuAlign 프로젝트 안내

투명교정 스테이징 초안을 자연어 조건으로 계획·검증·수정하는 NVIDIA 에이전트 PoC다.
전체 목표에는 장치 출력까지 포함하지만 예선의 중심은 스테이징이며, 현재 STL은 치아 형상이다.
진단·처방과 최종 판단은 의사의 몫이다.

## 읽는 순서

1. `README.md`: 실행 방법과 현재 범위
2. `CONTRIBUTING.md`: 공통 개발·검증 규칙
3. `docs/prd.md` · `docs/trd.md`: 제품 요구사항과 현재 기술 구조·필요한 계약
4. `docs/code-map.md` · `docs/nvidia-stack.md`: 파일 위치와 NVIDIA 통합 수준
5. `docs/development.md` · `docs/known-issues.md`: 작업 후보와 인수 시 알려진 문제

## 기술 개요

Python 3.12·uv, NeMo Agent Toolkit, Nemotron/NIM, NeMo Guardrails를 사용한다.
계산은 numpy/scipy·trimesh·manifold3d, 화면은 정적 HTML/JS/CSS·three.js다.
계산 코어는 LLM과 분리되어 있고 API·에이전트가 같은 프로세스의 저장소를 사용한다.

개인 기기의 절대경로·전용 스킬·다른 레포 접근을 요구하지 않는다.
세션 시작 시 서버나 유료 모델 호출을 자동 실행하지 않는다. 필요한 검증만 실행하며 명령은 `CONTRIBUTING.md`를 따른다.
미확정 제품 동작은 확정 요구사항으로 취급하지 않는다. 가정을 명시한 실험은 가능하며, 제품 정책 확정은 관련 담당과 논의한다.
현재 스택과 파일 구조는 팀이 변경할 수 있다. 기존 변경을 보존하고 요청 범위 밖 변경·공개 배포·파괴적 동작은 사전 확인한다.
