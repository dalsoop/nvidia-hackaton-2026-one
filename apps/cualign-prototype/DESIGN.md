---
version: alpha
name: cuAlign
description: |
  치과의사가 투명교정 단계 계획을 만드는 어두운 3D 작업 도구. NVIDIA 웹사이트의 디자인 언어(초록 강조색 하나, 2px 모서리, 그림자 없는 가는 선)를 가져와 어두운 작업 화면에 맞게 뒤집었다.

colors:
  primary: "#76b900"
  on-primary: "#000000"
  primary-dark: "#5a8d00"
  canvas: "#000000"
  surface: "#111111"
  surface-elevated: "#1a1a1a"
  surface-hover: "#242424"
  hairline: "#2e2e2e"
  hairline-strong: "#5e5e5e"
  text: "#ffffff"
  text-mute: "#b3b3b3"
  text-faint: "#898989"
  error: "#e52020"
  on-error-surface: "#ffb3b3"
  error-surface: "#2a0b0b"
  warning: "#ef9100"
  on-warning-surface: "#ffd98a"
  warning-surface: "#2b1c00"
  success-surface: "#142600"
  on-success-surface: "#c6f27a"
  locked: "#4f8fd6"
  ipr-cut: "#bff230"
  tooth: "#e9e3d6"
  gum: "#d98b8f"

typography:
  title:
    fontFamily: Pretendard
    fontSize: 20px
    fontWeight: 700
    lineHeight: 1.3
    letterSpacing: 0
  heading:
    fontFamily: Pretendard
    fontSize: 16px
    fontWeight: 700
    lineHeight: 1.4
    letterSpacing: 0
  body:
    fontFamily: Pretendard
    fontSize: 14px
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: 0
  body-strong:
    fontFamily: Pretendard
    fontSize: 14px
    fontWeight: 700
    lineHeight: 1.5
    letterSpacing: 0
  button:
    fontFamily: Pretendard
    fontSize: 14px
    fontWeight: 700
    lineHeight: 1.25
    letterSpacing: 0
  caption:
    fontFamily: Pretendard
    fontSize: 12px
    fontWeight: 400
    lineHeight: 1.4
    letterSpacing: 0
  label:
    fontFamily: Pretendard
    fontSize: 11px
    fontWeight: 700
    lineHeight: 1
    letterSpacing: 0

rounded:
  none: 0px
  sm: 2px
  full: 9999px

spacing:
  xxs: 2px
  xs: 4px
  sm: 8px
  md: 12px
  lg: 16px
  xl: 24px
  xxl: 32px

components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.on-primary}"
    typography: "{typography.button}"
    rounded: "{rounded.sm}"
    padding: 8px 16px
    height: 36px
  button-primary-active:
    backgroundColor: "{colors.primary-dark}"
    textColor: "{colors.on-primary}"
    rounded: "{rounded.sm}"
  button-outline:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    typography: "{typography.button}"
    rounded: "{rounded.sm}"
    padding: 8px 12px
    height: 36px
  button-disabled:
    backgroundColor: "{colors.surface-elevated}"
    textColor: "{colors.text-faint}"
    rounded: "{rounded.sm}"
  segmented:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text-mute}"
    typography: "{typography.button}"
    rounded: "{rounded.sm}"
    padding: 6px 14px
  segmented-active:
    backgroundColor: "{colors.text}"
    textColor: "{colors.canvas}"
    typography: "{typography.button}"
    rounded: "{rounded.sm}"
  chip:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    typography: "{typography.caption}"
    rounded: "{rounded.sm}"
    padding: 6px 10px
  text-input:
    backgroundColor: "{colors.surface-elevated}"
    textColor: "{colors.text}"
    typography: "{typography.body}"
    rounded: "{rounded.sm}"
    padding: 8px 12px
  panel:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    rounded: "{rounded.none}"
  modal:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    typography: "{typography.body}"
    rounded: "{rounded.sm}"
    padding: 24px
  case-card:
    backgroundColor: "{colors.surface-elevated}"
    textColor: "{colors.text}"
    typography: "{typography.body-strong}"
    rounded: "{rounded.sm}"
    padding: 16px
  corner-square:
    backgroundColor: "{colors.primary}"
    rounded: "{rounded.none}"
    size: 10px
  message-doctor:
    backgroundColor: "{colors.surface-hover}"
    textColor: "{colors.text}"
    typography: "{typography.body}"
    rounded: "{rounded.sm}"
    padding: 8px 12px
  message-agent:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    typography: "{typography.body}"
    rounded: "{rounded.sm}"
    padding: 8px 12px
  result-fail:
    backgroundColor: "{colors.error-surface}"
    textColor: "{colors.on-error-surface}"
    typography: "{typography.body}"
    rounded: "{rounded.sm}"
    padding: 12px
  result-pass:
    backgroundColor: "{colors.success-surface}"
    textColor: "{colors.on-success-surface}"
    typography: "{typography.body}"
    rounded: "{rounded.sm}"
    padding: 12px
  status-check:
    backgroundColor: "{colors.warning-surface}"
    textColor: "{colors.on-warning-surface}"
    typography: "{typography.label}"
    rounded: "{rounded.sm}"
    padding: 4px 8px
  popover:
    backgroundColor: "{colors.surface-elevated}"
    textColor: "{colors.text}"
    typography: "{typography.caption}"
    rounded: "{rounded.sm}"
    padding: 6px 10px
  ipr-label:
    backgroundColor: "{colors.ipr-cut}"
    textColor: "{colors.on-primary}"
    typography: "{typography.label}"
    rounded: "{rounded.sm}"
    padding: 2px 4px
  locked-mark:
    backgroundColor: "{colors.locked}"
    textColor: "{colors.on-primary}"
    typography: "{typography.label}"
    rounded: "{rounded.sm}"
  error-mark:
    backgroundColor: "{colors.error}"
    textColor: "{colors.text}"
    typography: "{typography.label}"
  warning-mark:
    backgroundColor: "{colors.warning}"
    textColor: "{colors.on-primary}"
    typography: "{typography.label}"
---

## Overview

cuAlign은 진단을 마친 치과의사가 CAD 작업(디지털 셋업)에서 쓰는 도구다. 화면의 주인공은 3D 치열이고, 나머지는 3D를 방해하지 않도록 물러나 있는다.

디자인 언어는 NVIDIA 웹사이트를 분석한 레퍼런스에서 가져왔다(아래 「출처」). 가져온 원칙은 네 가지다.

- **강조색은 NVIDIA 초록(`{colors.primary}`) 하나.** 한 화면에서 가장 중요한 행동 하나에만 쓴다.
- **모든 모서리는 2px(`{rounded.sm}`).** 둥근 알약 모양을 쓰지 않는다. CAD 소프트웨어처럼 정밀한 느낌을 준다.
- **그림자 대신 1px 가는 선(`{colors.hairline}`)으로 구획을 나눈다.**
- **위계는 글자 굵기(400/700)와 크기로 만든다.** 색으로 글자 위계를 만들지 않는다.

레퍼런스와 다른 점: 레퍼런스는 흰 바탕의 마케팅 사이트이고 cuAlign은 3D 작업 도구다. 그래서 바탕을 검정으로 뒤집고, 임상 상태(실패·확인 필요·통과)를 나타내는 색을 더했다. NVIDIA 로고와 워드마크는 쓰지 않는다. 제품명은 cuAlign이다.

## Colors

### 바탕
- **Canvas** (`{colors.canvas}` `#000000`): 페이지 바탕, 3D 뷰어 바탕.
- **Surface** (`{colors.surface}` `#111111`): 대화 패널, 모달, 버튼 바탕.
- **Surface Elevated** (`{colors.surface-elevated}` `#1a1a1a`): 입력 칸, 케이스 카드, 팝오버.
- **Surface Hover** (`{colors.surface-hover}` `#242424`): 마우스를 올린 상태, 의사 메시지.
- **Hairline** (`{colors.hairline}` `#2e2e2e`): 모든 구획선과 테두리. **Hairline Strong** (`#5e5e5e`)은 선택되지 않은 입력의 테두리처럼 조금 더 보여야 할 때.

### 글자
- **Text** (`#ffffff`) 본문. **Text Mute** (`#b3b3b3`) 보조 설명. **Text Faint** (`#898989`) 비활성·메타데이터.

### 강조
- **Primary** (`{colors.primary}` `#76b900`): 주 행동 버튼, 선택된 카드 테두리, 카드 모서리 사각형, 입력 포커스. 누른 상태는 **Primary Dark** (`#5a8d00`).

### 임상 상태
- **Error** (`#e52020`): 계획 실패, 충돌, 이동 한계 초과. 3D의 문제 위치 표시.
- **Warning** (`#ef9100`): "확인 필요"(결손 치아, 좌우 번호 의심, 공간 부족 경고).
- **Success Surface** (`#142600`)와 글자 `#c6f27a`: 규칙 검사 통과. 초록 강조색과 헷갈리지 않도록 채도를 낮춘 바탕에만 쓴다.
- 상태는 색만으로 전하지 않는다. 항상 글자("실패", "확인 필요")와 숫자를 함께 쓴다.

### 3D 전용
- **Tooth** (`#e9e3d6`), **Gum** (`#d98b8f`): 치아와 잇몸 메시.
- **IPR Cut** (`#bff230`): IPR로 깎인 면과 IPR 양 라벨. 버튼의 초록과 구분되는 연두색이다.
- **Locked** (`#4f8fd6`): 고정 치아. 3D 안에서만 쓰고 버튼이나 글자색으로 쓰지 않는다.

## Typography

- **글꼴:** Pretendard(OFL). Inter를 바탕으로 한글을 더한 글꼴이라 레퍼런스가 권하는 Inter 대체와 맞다. 불러오지 못하면 `-apple-system, "Apple SD Gothic Neo", "Malgun Gothic", sans-serif` 순서로 쓴다.
- **굵기는 400과 700 두 가지만.** 기울임꼴과 고정폭 글꼴은 쓰지 않는다. 숫자는 `font-variant-numeric: tabular-nums`로 자리를 맞춘다.

| 토큰 | 크기 | 굵기 | 쓰임 |
|---|---|---|---|
| `{typography.title}` | 20px | 700 | 모달 제목, 결과 카드 제목 |
| `{typography.heading}` | 16px | 700 | 절 제목, 케이스 번호 |
| `{typography.body}` | 14px | 400 | 대화, 설명 |
| `{typography.body-strong}` | 14px | 700 | 강조, 라벨 |
| `{typography.button}` | 14px | 700 | 버튼, 전환 버튼 |
| `{typography.caption}` | 12px | 400 | 칩, 팝오버, 메타데이터 |
| `{typography.label}` | 11px | 700 | 3D 치아 번호, IPR 양, 상태 라벨 |

## Layout

- **기본 단위 8px.** 간격은 `{spacing.*}` 토큰만 쓴다.
- **작업 화면:** 위 막대(48px) 아래에 왼쪽 대화 패널(너비 약 30%, 최소 340px)과 오른쪽 3D 패널(나머지)을 둔다. 두 패널은 1px 선으로만 나누고 바깥 여백을 두지 않는다. 3D가 화면 끝까지 차야 한다.
- **3D 패널 안:** 왼쪽 위에 Initial/Treatment 전환, 오른쪽 위에 시점 버튼(교합면·정면), 아래에 단계 막대(재생·슬라이더·단계 번호)와 주 행동 버튼을 둔다.
- 화면 너비가 980px보다 좁으면 대화 패널을 3D 아래로 내린다.

## Elevation & Depth

| 단계 | 처리 | 쓰임 |
|---|---|---|
| 0 | 선 없음 | 3D 뷰어, 패널 안 본문 |
| 1 | 1px `{colors.hairline}` | 패널 구획, 카드, 입력 칸, 버튼 |
| 2 | 1px `{colors.hairline}` + 바탕 `rgba(0,0,0,0.7)` 가림막 | 모달 |

카드와 버튼에 그림자를 쓰지 않는다. 깊이는 3D 치열에서만 나온다.

## Shapes

| 토큰 | 값 | 쓰임 |
|---|---|---|
| `{rounded.none}` | 0px | 패널, 위 막대, 3D 뷰어 |
| `{rounded.sm}` | 2px | 버튼, 칩, 카드, 입력, 모달, 팝오버, 라벨 — 사람이 누르거나 읽는 모든 것 |
| `{rounded.full}` | 50% | 재생 버튼, 슬라이더 손잡이, 진행 표시 점 |

## Components

### 버튼
- **`button-primary`:** 한 화면에 하나만 둔다. 화면의 다음 행동("열기", "전송", "승인하고 내보내기").
- **`button-outline`:** 나머지 행동. 테두리 1px `{colors.hairline-strong}`, 마우스를 올리면 테두리가 `{colors.primary}`로 바뀐다.
- **`segmented` / `segmented-active`:** Initial/Treatment 전환, 교합면/정면 시점. 선택된 쪽은 흰 바탕에 검정 글자로 뒤집는다(초록을 쓰지 않는다).

### 칩
- **`chip`:** 대화 입력 위에 놓는 지시 문장. 테두리 1px `{colors.hairline-strong}`, 알약 모양이 아니라 2px 모서리.
- 상황에 따라 바뀐다(아래 「칩」).

### 카드
- **`case-card`:** 진입 모달의 케이스 카드. 왼쪽 위에 `corner-square`(10px 초록 사각형)를 붙인다. 선택되면 테두리가 2px `{colors.primary}`가 된다.
- **`result-fail` / `result-pass`:** 에이전트 답변 중 계획 결과. 왼쪽에 3px 세로 띠(`{colors.error}` / `{colors.primary}`)를 둔다. 결과 카드에는 모서리 사각형을 붙이지 않는다(초록과 빨강이 섞이지 않게).

### 상태
- **`status-check`:** "확인 필요" 라벨. 누르는 버튼이 아니라 상태 표시다. 무엇을 확인할지 한 줄을 같이 쓴다(예: "확인 필요 · 15 결손").
- **`popover`:** 3D 표시에 마우스를 올리면 뜨는 설명. 테두리 1px `{colors.hairline-strong}`.

### 3D 라벨
- **치아 번호:** FDI로 표기한다(예: 11, 21). `{typography.label}`, 글자색 `{colors.text-mute}`.
- **`ipr-label`:** 깎인 접촉면 위의 IPR 양(예: "0.4").

## Do's and Don'ts

### Do
- 한 화면의 초록 버튼은 하나. 두 개가 필요해 보이면 하나를 `button-outline`으로 내린다.
- 모든 상태에 글자와 숫자를 붙인다. "실패"만 쓰지 말고 무엇이·얼마나·어디서를 쓴다.
- 치아 번호는 FDI로 쓴다.
- 3D가 가장 넓은 자리를 차지하게 둔다.

### Don't
- 그림자, 그라데이션, 알약 모양(`border-radius: 999px`)을 쓰지 않는다.
- 초록을 통과(success) 표시에 쓰지 않는다. 초록은 행동을 뜻한다. 통과는 `result-pass`의 낮은 채도 바탕으로 보인다.
- 개발자용 표기(도구 이름, `키=값`, 계획 ID)를 의사 화면에 그대로 보이지 않는다.
- NVIDIA 로고·워드마크·"NVIDIA 제품" 같은 표현을 쓰지 않는다.

## 화면 흐름

> 이 절과 아래 절은 화면 설계다. 표시: **[현재]**는 main에 있는 동작, **[목표]**는 아직 없는 동작과 관련 이슈.

```
진입 모달: 케이스 카드 ─열기→ 작업 화면 (왼쪽 대화 / 오른쪽 3D: Initial)
  → 처방을 말하거나 칩을 누른다 → Treatment 레이어에 반영(IPR 깎기, 발치 치아 제거)
  → 목표 배열 만들기
      ├ 실패 → 무엇이·얼마나·어디서 표시 → 처방 조정(CAD 중 추가 조정) → 다시 만들기
      └ 성공 → Initial ↔ Treatment 전환으로 전후 확인
  → 단계 나누기 → 슬라이더·재생으로 단계 확인
  → 승인하고 내보내기 (단계별 프린트용 모형 STL)
```

- **시작 상태** [목표, #46·#90]: 모달 없이 작업 화면에서 시작한다. 왼쪽 대화 패널 자리에 서비스가 무엇인지 한 문단으로 설명하고, 오른쪽 3D 자리에 샘플 케이스 카드를 둔다. 처방 폼·칩·범례·결과는 케이스를 연 뒤에 보인다. 케이스 카드마다 교합면 썸네일, 케이스 번호, 한 줄 설명, 진단 처방 요약. 작은 링크 "내 스캔 올리기". [현재] 그렇게 한다(#95). 소개는 악궁 라인아트 + 한 줄 + 「샘플 케이스 고르기」이고, 케이스를 열면 패널 맨 위에 케이스 카드(썸네일·소견·처방·바꾸기), 그 아래 접힌 「조건 · …」 줄이 온다.
- **입력 확인 화면은 없앤다** [목표, #53]: 3D 위 치아 번호와 `status-check` 라벨이 대신한다.
- **목표 배열과 단계를 나눈다** [목표]: [현재] 에이전트 도구는 나뉘어 있지만(`propose_target`, `plan_stages`) 한 요청에서 이어서 부르고 화면은 계획만 보여준다.
- **승인과 내보내기는 한 버튼** [목표, #53]: [현재] 「내보내기」 하나다. 팝오버에서 확정하면 승인 뒤 단계별 STL(zip)을 내려받고, 승인 취소는 결과 패널 「자세히」 안에 있다(#90).

## 3D 레이어

- **Initial:** 스캔한 그대로의 현재 치열. 바뀌지 않는다.
- **Treatment:** 처방을 반영한 치열(IPR 접촉면을 실제로 깎음 [목표, #62], 발치 치아 제거 [목표, #56]), 목표 배열, 사이 단계들. 처방 요약도 이 레이어에 둔다.
- 전환은 3D 왼쪽 위 `segmented`. Treatment가 없으면 Treatment 쪽은 비활성이다.

## 실패 표시

목표 배열이나 단계 계산이 실패하면 세 가지를 같이 보여준다.

| 항목 | 예 | 위치 |
|---|---|---|
| 무엇이 | 공간 부족, 한 단계 이동량 초과, 충돌 | 대화의 `result-fail` 카드 제목 |
| 얼마나 | 0.8mm 부족 | 카드 본문 |
| 어디서 | 12-13, 22-23 접촉면 | 카드 본문 + 3D에서 `{colors.error}` 표시 |

3D 표시에 마우스를 올리면 같은 내용이 `popover`로 뜬다. 앱은 처방을 스스로 바꾸지 않는다. 모자란 만큼을 어디서 메울지는 의사가 정한다.

## 칩

칩은 고정 목록이 아니라 지금 상황에서 할 만한 지시를 보여준다 [목표]. [현재] 고정 칩 5개는 입력창 왼쪽 + 메뉴의 「예시 문장」으로 들어갔고, 상황에 맞는 지시는 **질문 카드**가 맡는다: 케이스를 열면 고정 카드(처방대로 계획 · 기간 상한 정하기 · 확장안·IPR안 비교), 그 뒤로는 매 턴이 끝날 때 `nim_lightning`이 다음 질문과 선택지 2~3개를 써서 보인다(`/api/followup`, 실패하면 카드 없음). 질문 카드는 의도를 정할 때, 칩은 문장을 빌릴 때다.

| 시점 | 칩 예시 |
|---|---|
| 케이스를 연 직후 | 이 케이스의 진단 처방 문장 |
| 목표 배열 실패 후 | 모자란 공간을 메우는 처방 추가(예: IPR 접촉면 추가) |
| 목표 배열 성공 후 | 단계 나누기 |
| 단계 계산 후 | 승인하고 내보내기 |

## 진행 표시 문구

에이전트가 일하는 동안 대화에 한 줄씩 보인다. 의사가 읽는 말로 쓴다 [목표, #53]. [현재] 한 턴의 도구 호출은 말풍선 사이 접힌 한 줄이다: 실행 중에는 도구명(「단계 계획 중…」), 끝나면 순서(「도구 4회 · 목표 배열 제안 → 단계 계획 → 계획 선택 → 검토」). 도구명은 `app.js`의 대응표로 바꾸고, 아래 표의 문장형 표시는 아직이다.

| 도구 | 표시 |
|---|---|
| `load_case` | 케이스를 불러오는 중 |
| `set_constraints` | 처방을 반영했습니다: … |
| `propose_target` | 목표 배열을 만드는 중 |
| `plan_stages` | 단계를 나누는 중 |
| `validate` | 규칙 검사 중 (충돌·이동량·공간) |
| `export_stl` | 출력 파일을 만드는 중 |
| 그 밖의 도구 | 표시하지 않음 |

## 화면 요소 지도 (에이전트·테스트용)

`static/index.html`의 id와 `body` 상태 클래스. 화면을 고치거나 브라우저 검증을 쓰기 전에 이 표를 보고, 바꾸면 표도 같이 고친다.

| 영역 | id·클래스 |
|---|---|
| 상단 바 | `#homeBtn`(로고, 처음 화면) |
| 시작 상태 | `body.start` · `#intro` `#introPick` · `#screenStart` `#sampleCards .case-card[data-id]` `#toPatients` · 입력창은 잠김 |
| 케이스 카드 | `#caseCard` `#caseThumb` `#caseName` `#caseKind` `#caseSub` `#caseBadges` `#caseBtn`(바꾸기) `#casePop` `#popCases .item[data-id]` `#popPatients` |
| 대화 | `#transcript` · `.msg.user/.assistant/.error/.system`(답변 안 `.row`·`details.fold`·`.note`) · `.trace`(접힌 도구 진행) · `.question`(질문 카드, `.opts button[data-message|data-fill|data-action]`, `.pending`은 자리 표시) · 「검토 질문」 블록 · `.decision [data-act=keep|revert]` · `.plan-card`(여러 계획이 나온 턴) · `.done`(내려받기 완료) · `#retryBar` `#resendBtn` `#retryFallback` |
| 입력 | `#chips .chip[data-message]` · `#selChips` · `#chatForm` `#chatInput` `#sendBtn` |
| 3D | `#canvasWrap` `#viewCanvas` `#labels` `#tip` `#workNote`(계산 중 알약, `body.streaming`) · `.view-head`(왼쪽 `#condBox`, 오른쪽 `.view-actions`) · `.view-rail button[data-view=occlusal|frontal|left|right|back|base]` `#overlayBtn` `#focusBtn` · `.legend` `#overlayLegend` |
| 조건 | `#condBox`(details) `#condSummary` `#constraints` `#cExtraction` `#cLock` `#cExclude` `#cIpr` `#cCap` `#cOrder` `#fallbackBtn`(규칙 기반 계산) |
| 입력 확인 | `body.checking` · `#checkBar` `#checkFacts` `#mirrorBtn` `#startPlan` `#otherScan` |
| 내보내기 | `#exportBtn` `#exportWhy`(잠긴 이유) `#exportPop` `#exportGo` `#exportCancel` `#stlLink`(숨김 앵커) |
| 단계 | `body.has-plan` · `.stage-bar` `#firstBtn` `#playBtn` `#stageMarks` `#stageSlider` `#lastBtn` `#stageLabel` |
| 결과 | `.result` `#statusBadge` `#planSelect` `#reviewBtn` · `.plan-meta`(자세히) 안 `#planNotice` `#resultCard` `#rStrategy` `#rStages` `#rMonths` `#rViol` `#rApproval` `#rPlan` `#rParent` `#rReview` `#revokeBtn` · `#reviewMemo` `#violTable` |
| 내 스캔 | `#caseGate` `#gateClose` `#screenPatients` `#patientForm` `#pAlias` `#pMemo` `#pScans` `#pScansName` `#patientCards` `#patientBody` `#scanList` `#dropZone` `#scanInput` `#uploadStatus` `#deletePatient` |
| 기타 상태 | `body.focus3d`(3D 크게) `body.leaving`(카드 선택 전환) `body.resizing`(경계 끌기) · 주소 `#start` `#case=<id>` `#patients` `#patient=<id>` `#check=<case>` |

브라우저 검증은 `tests/browser_flow.py`(가짜 모델, 자체 서버)에 단계를 더해 쓴다. 묶음마다 새 스크립트를 만들지 않는다.

## 출처

- 디자인 언어: VoltAgent/awesome-design-md의 NVIDIA 분석 `design-md/nvidia/DESIGN.md`(MIT), https://github.com/VoltAgent/awesome-design-md , 접근일 2026-09-26. 색 값·2px 모서리·모서리 사각형·위계 원칙을 가져와 어두운 작업 화면에 맞게 바꿨다.
- 형식: Google Labs DESIGN.md 명세, https://github.com/google-labs-code/design.md , 접근일 2026-09-26.
- 글꼴: Pretendard(SIL OFL 1.1), https://github.com/orioncactus/pretendard , 접근일 2026-09-26.
