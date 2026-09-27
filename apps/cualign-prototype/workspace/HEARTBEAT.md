# HEARTBEAT

주기적으로 스스로 하는 작업은 없다. 하트비트가 돌면 아무 도구도 부르지 않고 `HEARTBEAT_OK`로 끝낸다.

## 왜 없는가

- cuAlign은 의사의 요청이 있을 때만 움직인다. 요청 한 건은 한 번의 제한된 실행이다. 계획 에이전트는 최대 26번
  반복하고, 검토는 최대 2회 시도하며 40초 안에 끝난다.
- 스스로 할 만한 다음 행동인 승인과 내보내기는 의사가 화면에서 하는 일이다. 에이전트가 먼저 하지 않는다.
- 창구도 요청당 `cualign_plan`을 한 번만 부르고, 반복해서 다시 부르지 않는다.
- 계획, 조건, 검토, 승인 상태는 cuAlign 서버가 저장한다. 에이전트가 주기적으로 정리하거나 동기화할 상태가 없다.

<!-- 출처: configs/workflow.yml(max_iterations: 26, functions.reviewer max_attempts·total_seconds);
workspace/AGENTS.md(승인·내보내기); workspace/skills/cualign-planner/SKILL.md(Procedure 3). -->
