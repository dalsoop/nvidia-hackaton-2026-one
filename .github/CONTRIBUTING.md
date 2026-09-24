# 기여 안내

구조와 규칙은 [ARCHITECTURE.md](../ARCHITECTURE.md)와 [AGENTS.md](../AGENTS.md)에 있다.

## 작업 시작

작업 하나마다 저장소 옆 폴더에 worktree를 따로 만든다.

```sh
git fetch origin
git worktree add ../nvidia-hackaton-2026-one-wt-<작업> -b <type>/<작업> origin/main
cd ../nvidia-hackaton-2026-one-wt-<작업>
```

브랜치 이름은 `feat/…`, `fix/…`, `docs/…`, `chore/…` 형식으로 짓는다.

PR이 병합되면 worktree와 브랜치를 정리한다.

```sh
git worktree remove ../nvidia-hackaton-2026-one-wt-<작업>
git branch -d <type>/<작업>
```

## 새 앱

`apps/<app>/`을 만들고 `README.md`에 책임 경계와 실행 방법을 쓴다. 자세한 순서는 ARCHITECTURE.md의 "새 앱을 만들 때"를 따른다.

## PR

- PR 양식의 네 칸을 채운다.
- 한 PR은 앱 하나만 고친다.
- CI가 실패한 PR은 병합하지 않는다.
