# 아키텍처

이 저장소는 NVIDIA 해커톤 2026 팀 one이 만드는 앱을 모으는 모노레포다. 앱은 모두 `apps/` 아래에 폴더 하나씩 두고, 각 앱은 자기 폴더 안에서 빌드, 테스트, 실행이 끝난다.

## 폴더 구조

```
apps/       앱. 폴더 하나가 앱 하나다
.github/    기여 안내, PR 양식, CI
```

앱 목록은 `apps/` 폴더를 본다. 이 문서에는 적지 않는다.

## 경계

- 앱은 다른 앱의 코드를 가져다 쓰지 않는다. 연결이 필요하면 HTTP API나 CLI를 쓴다.
- 앱의 문서와 설정은 그 앱 폴더 안에 둔다.
- 루트에는 이 문서, README, AGENTS.md 외의 md를 두지 않는다. md를 둘 수 있는 곳은 루트의 이 세 파일, `.github/CONTRIBUTING.md`, `.github/pull_request_template.md`, 앱 폴더 안이다. CI가 이 자리 밖의 md를 실패로 처리한다.

## 새 앱을 만들 때

1. `apps/<app>/`을 만든다. 이름은 기능이 드러나는 kebab-case로 짓는다.
2. `README.md`에 책임 경계와 실행 방법을 쓴다. README가 없는 앱 폴더는 CI가 실패로 처리한다.
3. 빌드 설정(`package.json` 또는 `pyproject.toml`)을 앱 폴더 안에 둔다.

## 변경할 때

- 이 문서에는 목적, 폴더 역할, 경계처럼 잘 바뀌지 않는 것만 쓴다. 명령 옵션, 앱 목록, 수치는 쓰지 않는다.
- 기능을 고칠 때 이 문서에 문장을 덧붙이지 않는다. 동작 설명은 앱 README나 CLI 도움말에, 결정의 이유는 PR 본문에 쓴다.
- 참고: matklad, "ARCHITECTURE.md" (2021). https://matklad.github.io/2021/02/06/ARCHITECTURE.md.html
