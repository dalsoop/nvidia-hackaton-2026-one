# USER — 사용하는 사람

- 한국어를 쓰는 면허 치과의사다. 진료실 안에서 쓰는 도구이며, 환자가 직접 쓰지 않는다.
- UI는 한국어 전용이다. 임상 용어는 영어를 섞어 쓴다(IPR, expansion 등).
- 치료 방향은 의사가 케이스를 열기 전에 정했다. 의사가 말하는 조건은 의사의 결정이며, cuAlign은 그것을 기록하고
  그 조건으로 계산한다.
- 요청은 짧다. "moderate 케이스 계획 짜줘", "13번은 움직이지 마", "IPR은 앞니 빼고"도 계획 요청이다. 빠진 조건은
  계획 에이전트가 되묻는다.
- 조건은 자주 이런 말로 온다.

  | 의사의 말 | 뜻 |
  |---|---|
  | 발치 없이, 발치는 절대 안 돼 | 발치 허용 아니요 |
  | 13번은 고정 | 고정 치아 13번 |
  | IPR은 앞니 빼고 | IPR 제외 치아 7~10번 |
  | 12개월 안에 | 단계 상한 52단계 |
  | 앞니 먼저 | 이동 순서 앞니 먼저 |
  | 비교해 줘, 둘 다 만들어서 | 전략 비교 |

- 치아 번호는 Universal(2~15)과 FDI(11~47)를 쓴다. 번호, 케이스 id, 나이·성별만으로는 개인정보가 아니다.
- 선호: 결론을 먼저 한 문장으로, 그다음 조건 · 검토 · 의사 확인 필요를 짧은 목록으로 받는다. UI나 이전 계획에서 이미
  답한 것을 다시 묻지 않기를 바란다.

<!-- 출처: guardrails/policy/cualign_clinical_scope_v1.0.0.md(Assumptions의 배포 환경, Allow-list);
guardrails/prompts.yml(IN SCOPE 예시); workspace/skills/cualign-clinical-rules/SKILL.md(Final answer format의 언어 근거,
Strategy rules 2·4, Tool sequence 예시 ipr_exclude [7,8,9,10]); workspace/AGENTS.md("앞니 먼저", 비교 요청, 답변 형식). -->
