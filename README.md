# cuAlign — 투명교정 스테이징 에이전트

치과의사가 원내에서 투명교정 단계를 직접 설계할 때 쓰는 에이전트입니다.
의사가 처방과 조건을 말하면 에이전트가 목표 배열과 단계 계획을 만들고, 계산 도구로 검증하고, 조건이 바뀌면 3D 계획을 다시 만듭니다.
승인한 계획만 단계별 치아 STL 로 내보냅니다. 발치·IPR 같은 임상 결정과 최종 계획 선택은 의사가 하며, 결과는 초안입니다.

- 앱 소개·실행 방법: [apps/cualign-prototype](apps/cualign-prototype/README.md)
- NVIDIA 기술 활용(NeMo Agent Toolkit · Nemotron NIM · NeMo Guardrails · OpenShell · NVIDIA Skills 카탈로그): [활용 지도](apps/cualign-prototype/docs/NVIDIA_STACK.md)

NVIDIA × 패스트캠퍼스 Korea Agentic AI Hackathon 1팀의 저장소입니다.

## 저장소 구조

여러 앱을 한 저장소에서 개발합니다. 앱은 모두 `apps/` 아래에 폴더 하나씩 있고, 각 앱의 README에 실행 방법이 있습니다.

- 구조: [ARCHITECTURE.md](ARCHITECTURE.md)
- 작업 규칙: [AGENTS.md](AGENTS.md)
- 기여 방법: [CONTRIBUTING](.github/CONTRIBUTING.md)
