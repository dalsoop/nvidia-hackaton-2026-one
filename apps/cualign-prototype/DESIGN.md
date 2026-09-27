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
시작 화면: 샘플 카드 / 환자 목록 ─디자인 시작하기→ 작업 화면 (왼쪽 대화 / 오른쪽 3D)
  진행 표시 4칸 [현재, #15]: 초기 → 셋업 → 목표 → 단계 (누르면 그 상태로, 주소 &step= 에 남음)
    초기  스캔 그대로(치아 전부·잇몸, 표시 없음, 슬라이더 없음) · 왼쪽: 처방 한 줄 + 「셋업 보기」
    셋업  처방이 하는 일을 3D 에: 발치 치아 빨간 강조(아직 있음) · IPR 접촉면 노란 점 · 확장이면 좌우 화살표 · 왼쪽: 총생→확보 한 줄 + 「목표 배열 보기」
    목표  목표 배열(마지막 단계, 발치 치아 사라짐) · 「단계 만들기」
    단계  슬라이더·단계 표·계획 카드 (첫 진입은 치료 전 0)
  서버 계산은 케이스를 열 때 한 번(규칙 미리보기); 화면만 단계적으로 드러낸다
  에이전트 대화·칩은 어느 상태에서든 → 계획이 오면 「단계」로 · 샘플 케이스는 8초 지난 턴·실패한 턴에 「건너뛰기」(지금 계획 채택)
  → 승인하고 내보내기 (단계별 프린트용 모형 STL)
```

- **시작 상태** [목표, #46·#90]: 모달 없이 작업 화면에서 시작한다. 왼쪽 대화 패널 자리에 서비스가 무엇인지 한 문단으로 설명하고, 오른쪽 3D 자리에 샘플 케이스 카드를 둔다. 처방 폼·칩·범례·결과는 케이스를 연 뒤에 보인다. 케이스 카드마다 교합면 썸네일, 케이스 번호, 한 줄 설명, 진단 처방 요약. 작은 링크 "내 스캔 올리기". [현재] 그렇게 한다(#95). 소개는 악궁 라인아트 + 한 줄 + 「샘플 케이스 고르기」이고, 케이스를 열면 패널 맨 위에 케이스 머리(제목·바꾸기 — 소견·처방은 「조건」 탭), 그 아래 이 케이스의 계획 카드 목록이 온다(#111, #13 polish). 조건은 오른쪽 사이드바의 「조건」 탭이다.
- **입력 확인 화면은 없앤다** [목표, #53]: 3D 위 치아 번호와 `status-check` 라벨이 대신한다.
- **목표 배열과 단계를 나눈다**: [현재] 화면이 초기·셋업·목표·단계로 나눠 드러낸다(#15). 에이전트 도구는 나뉘어 있지만(`propose_target`, `plan_stages`) 한 요청에서 이어서 부른다.
- **화면 전환** [현재, #15]: 시작 → 디자인은 격자 열 폭이 한 번에 바뀌고 렌더러를 같은 작업에서 리사이즈한다(가로 흔들림 없음); 시작 패널은 케이스가 뜰 때까지 흐려진 채 남고 새 패널은 불투명도만으로 나타난다. 새로고침은 `<head>` 인라인 스크립트가 주소를 읽어 `html.booting.h-case|h-check` 를 붙이고 라우터가 그 화면을 열 때까지 `.layout` 을 숨긴다.
- **3D 회전** [현재, #15]: OrbitControls, 위 축은 치근 쪽(−z) 고정 — 끌어도 기울지 않는다. 시점 버튼은 카메라 위치·목표만 맞춘다. 더블클릭 = 교합면 시점.
- **승인과 내보내기는 한 버튼** [목표, #53]: [현재] 「내보내기」 하나이고 왼쪽 레일에만 있다(승인 전 흐리게, 잠긴 이유는 툴팁). 팝오버에서 확정하면 승인 뒤 단계별 STL(zip)을 내려받고, 승인 취소는 계획 목록 아래 「계획 N · 아직 검토 전 …」 접이식 줄 안에 있다(#90, #111, #13 polish).

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

칩은 고정 목록이 아니라 지금 상황에서 할 만한 지시를 보여준다 [목표]. [현재] 고정 칩 5개는 입력창 왼쪽 + 메뉴의 「예시 문장」으로 들어갔고, 상황에 맞는 지시는 **질문 카드**가 맡는다: 케이스를 열면 고정 카드(처방대로 계획 · 기간 상한 정하기 · 확장안·IPR안 비교), 그 뒤로는 매 턴이 끝날 때 다음에 할 만한 지시 2~3개가 **입력창 위 칩**으로 바뀐다(데모 경로는 대본 `SCRIPT`, 그 밖은 `nim_lightning` `/api/followup`, 실패하면 기본 칩). 질문 카드는 케이스를 열 때처럼 의사가 의도를 정해야 할 때만, 칩은 다음 문장을 빌릴 때다 — 한 턴에 카드와 칩이 같이 뜨지 않는다.

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
| 레일 | `#rail button[data-go=start|case|export]` = 환자 · 디자인 · 내보내기(3개, #13 polish). 켜진 것 `.on`(시작·`#patients`·`#check=` 는 환자, 그 밖은 디자인) · 갈 수 없으면 `disabled`(라벨만, 부제 없음) · 내보내기는 `#exportBtn` 상태를 따르고 `title` 에 잠긴 이유 · `.done`. `data-go=patients|check` 라우팅은 코드에 남아 있으나 레일 버튼은 없다 |
| 화면 뼈대 | `.layout` 그리드 = 레일 64px · 대화 `var(--chat-w, 380px)` · 경계 6px(`#splitter`) · 3D `1fr`(최소 420) · 경계 6px(`#sideSplitter`) · 사이드바 `var(--side-w, 400px)`(320~640, localStorage, 두 번 눌러 초기화). 두 경계 모두 가운데 점 3개 손잡이, hover 초록; 대화 경계는 시작 화면에서도 끌리고 같은 `--chat-w`·저장값을 쓴다 (980px 미만은 한 열) |
| 시작 상태 | `body.start` · 왼쪽 `#intro` `#introPick` · 오른쪽 `#screenStart .start-body`(가운데 정렬, 최대 1100px): 「케이스」 제목 + `#toPatients`(새 환자) · 샘플 `#sampleCards .case-card[data-id]`(`.thumb` 카드 폭 썸네일 · `.cid` · `.rx` 소견 · `.meta` 「총생 7.9 mm · 발치」 한 줄, 상태·계획 수 없음, 선택 `.on` = 아래 초록 선) · 「환자 목록」 표 `#clRows .case-row[data-id]`(상태 점 유지, 비면 `.empty`) · 상세 `#clDetail`(누른 카드/행 바로 아래로 옮겨짐, 카드면 `.in-cards`; 머리 없이 `#dClose` 만 오른쪽 · `#dArch` 치아 배열(발치 빨간 테두리 · IPR 제외 `.ipr-dot` 회색 점) · `#dFacts` 「치아 14개 · 총생 1.6 mm」 한 줄 · `#dRx` 처방 문장 · `#dChips` 처방과 다른 조건만 · `#dOpen` 디자인 시작하기/입력 확인 열기) · 한 번 누름 = 펼침/접힘, 두 번 = 바로 열기 · 입력창은 잠김 |
| 디자인 흐름 | `#flow button[data-step=initial|setup|target|stages]`(`.on` 현재, `.done` 지난 것) · `#stepPane` `#stepLine`(초기: 처방 / 셋업: 총생→확보·전략·발치·확장 / 목표: 단계 수·개월) `#stepNext`(셋업 보기 / 목표 배열 보기 / 단계 만들기; 단계에선 숨김) · `body.step-*` · 주소 `#case=<id>[&plan=…][&step=setup|target|stages]` · 셋업 3D 표시 `.ipr-mark`(노란 점) `.exp-arrow` · 초기·셋업엔 슬라이더·범례·mm 라벨 없음, 사이드바 단계 표·규칙 탭 흐림 |
| 케이스 머리 | `#caseCard` `#caseName`(제목 한 줄, `title` 에 처방) `#caseBtn`(다른 케이스) `#casePop` `#popCases .item[data-id]` `#popPatients` |
| 계획 목록 | `#plans`(케이스에 계획이 있거나 계획 생성이 실패했으면 보임) (머리 옆 숫자 없음 — 지난 계획은 접힘 안에서만) · `#planFail`(계획 0개 + 실패: `#planFailMsg` 서버 문구 그대로 · `#planFailCond .tag` 조건 · `#planFailRetry` 이 조건으로 다시 계산 — 에이전트 없이) · `#planList .plan-row[data-plan]`(`.n` 계획 N · `.what` 전략·장수·개월 · `.pill.fail/pass/ok/warn` = 글자만: 「위반 n건 · 검토 전」/「규칙 통과 · 검토 완료」/승인됨/이전 스캔 기준 — 규칙과 검토 상태를 한 줄에 · 보는 계획은 `.current` + `.viewing`, 나머지는 `button[data-act=view]` 보기) · `#oldPlans`(접힌 지난 계획, `#oldPlansN` `#oldPlanList`) · `#planReview`(details, 검토 결과가 온 뒤(완료·실패)나 승인된 뒤에만 보임 — 미검토 계획엔 없음) `#reviewLine`(검토 메모/검토) `#reviewMemo` `#reviewBtn`(검토 다시 요청) `#revokeBtn`(승인 취소) · 계획 id 는 카드 `title` 과 주소에만 |
| 대화 | `#transcript` · `.msg.user/.assistant/.error/.system`(답변 안 `.row`·`details.fold`·`.note`) · `.trace`(접힌 도구 진행) · `.question`(후속 질문 카드, `.opts button[data-message|data-fill|data-action]`, 선택지에 `small` 힌트가 있으면 `.opts.stack`; 케이스를 연 첫 안내는 카드가 아니라 말풍선 + 칩 3개) · 「검토 질문」 블록 · `.decision [data-act=revert]`(새 안이 3D를 대체했다는 한 줄 + 되돌리기) · `.done`(내려받기 완료) · `#planNotice`(재계획 중·실패 한 줄, 입력창 위) · `#retryBar` `#resendBtn` `#retryFallback`(에이전트 없이 계산, #75 — 환자 케이스) `#skipBtn`(건너뛰기 — 샘플 케이스; 스트리밍 8초 뒤엔 답 아래 `.skip-row` 에도) → 스트림 중단 후 `POST /api/cases/{id}/replay` {step: plan|cap|compare(칩·문장에서 「개월·기간」→cap, 「비교·둘 다」→compare), base_plan_id}: 200 이면 `.msg.assistant.recorded` + `.recorded-tag` 「녹화된 답 · 날짜」(툴팁에 recorded_at) 와 `plan_selected` 를 에이전트 턴처럼(null 이면 말풍선만), 404 면 지금 규칙 계획 채택(카드 「건너뜀」) |
| 입력 | `#chips .chip[data-message|data-fill]` · `#selChips` · `#chatForm` = 둥근 상자 하나: `#chatInput`(placeholder 에 Enter 안내) 안 오른쪽 끝 `#sendBtn.send`(아이콘만, 배경·테두리 없음, 흐림 → hover 밝게, 비활성 더 흐림) |
| 3D | `#canvasWrap` `#viewCanvas` `#labels` `#tip` `#workNote`(계산 중 알약, `body.streaming`) · `.view-head`(왼쪽 `#checkBar`) · 세로 아이콘 막대 `.view-rail button[data-view=occlusal|frontal|left|right]` `#overlayBtn` `#focusBtn`(테두리 없이 아이콘만: `span.vic` 가 `icons/view-*.png` 를 mask 로 써서 글자색을 따름, 보는 시점은 `aria-pressed=true` 초록; 크게는 Lucide maximize; 라벨은 `aria-label` → hover/focus 시 왼쪽 툴팁) · `#pickHint`(치아에 처음 올렸을 때 한 번, localStorage) · 치아 위 커서 pointer · `.legend [data-key=collision|move_limit|locked|removed|ipr]`(지금 계획에 있는 것만) `#overlayLegend` `#pickedLegend`(치아를 처음 누른 뒤) |
| 사이드바 | `#side` · 탭 `.side-tab[data-tab=stages|rules|cond]`(`#tabStages` `#tabRules` `#tabCond`, `aria-selected`) · 패널 `#paneStages` `#paneRules` `#paneCond` · 시작·입력 확인 상태와 `body.focus3d` 에서는 숨김 |
| 단계 표 | `#stageFacts`(두 줄 `.l1` 「확장 · 9단계 · 약 2.1개월」 · `.l2` 「총생 1.6 mm → 확보 2.1 mm」) · `#stageGrid .row[data-stage]`(현재 단계 `.cur`, 칸 `.c.move/vert/rot/mixed`, 위반 칸 `.coll/.warn`, 이동 없는 치아 열은 `.nil` 빈 칸) · `.grid-legend [data-kind]`(이 계획에 있는 색만) |
| 규칙 | `#rulesFor` `#ruleNotes`(계획 이동 메모 — 서버 문장 그대로, `[5, 12]` 같은 Universal 목록만 화면에서 FDI 로) · `#ruleCards .rule`(충돌 · 장당 이동 한계 · 장수 상한 · 공간 부족: 위반만 `.pill.fail` 빨간 배지, 통과는 `.mark.ok` 회색 체크 + `.passed`, 해당 없음은 `.mark.na` 글자) · `#violGroups .vg`(치아 쌍별 묶음, `.stages button[data-stage]` 로 단계 이동) |
| 조건 | `#condFor` · `#condRx` `#condRxNote`(처방 원문) · `#constraints` `#cExtract` `#cLock` `#cExclude` `#cIpr` `#cCap` `#cMonths`(기간 개월 ↔ 단계 상한 양방향, round(개월×30.4/7); 서버엔 stage_cap 만) `#cOrder` — 설명은 placeholder 로 · `#condState`(보고 있는 계획의 조건과 같음 / `.changed` 조건이 바뀜) · `#fallbackBtn`(에이전트 없이 계산 — 회색 보조 버튼, 주 동작은 대화) |
| 입력 확인 | `body.checking` · `#checkBar`(막히면 `.fail`) `#checkTitle`(「계획할 수 없는 스캔입니다」·「방향을 정하지 못했습니다」, 그 밖엔 숨김) `#checkFacts`(`.warn` 방향 문구는 서버 `orientation.note` 그대로, 없으면 같은 문장) `#mirrorBtn` `#startPlan`(방향 불가면 「번호 확인 — 계획 시작」, 막힌 스캔이면 숨김) `#deleteScan` `#deleteScanPop` `#deleteScanGo` `#deleteScanCancel` `#otherScan` |
| 내보내기 | 레일 `#rail button[data-go=export]` 가 보이는 버튼 · `#exportBtn`(숨긴 상태 기준, 레일이 click 한다) `#exportWhy`(숨김 — 레일 `title` 로 감) `#exportPop`(레일 옆에 고정 위치) `#exportGo` `#exportCancel` `#stlLink`(숨김 앵커) |
| 단계 | `body.has-plan` · `.stage-bar` = `#playBtn` · `#firstBtn`(아이콘) `#stageTip`(썸 위 「단계 k」/「치료 전」) `#stageMarks .stage-mark[data-tip]`(hover 「단계 k · 충돌 N건」) `#stageSlider` `#lastBtn`(아이콘) · `#stageLabel` 「20단계 · 4.6개월」 |
| 내 스캔 | `#caseGate` `#gateClose` `#screenPatients` `#patientForm` `#pAlias` `#pMemo` `#pScans` `#pScansName` `#patientCards` `#patientBody` `#scanList` `#dropZone` `#scanInput` `#uploadStatus`(진행 한 줄 · 거절되면 `.upload-fail` 안 `.files` 「올린 파일 · N개」 `.why` 서버 문구 그대로 `[data-act=repick]` 다시 고르기) `#deletePatient` |
| 기타 상태 | `body.focus3d`(3D 크게) `body.leaving`(카드 선택 전환, 시작 패널 흐림) `body.resizing`(경계 끌기) `body.step-initial|setup|target|stages` · `html.booting.h-case|h-check`(첫 페인트~라우터) · 주소 `#start` `#case=<id>[&plan=…][&step=…]` `#patients` `#patient=<id>` `#check=<case>` |

브라우저 검증은 `tests/browser_flow.py`(가짜 모델, 자체 서버)에 단계를 더해 쓴다. 묶음마다 새 스크립트를 만들지 않는다.

화면 번호는 FDI, 내부(core·planner·API)는 Universal, 변환은 `app.js`의 `fdi()`/`universal()`(#113).

## 출처

- 디자인 언어: VoltAgent/awesome-design-md의 NVIDIA 분석 `design-md/nvidia/DESIGN.md`(MIT), https://github.com/VoltAgent/awesome-design-md , 접근일 2026-09-26. 색 값·2px 모서리·모서리 사각형·위계 원칙을 가져와 어두운 작업 화면에 맞게 바꿨다.
- 형식: Google Labs DESIGN.md 명세, https://github.com/google-labs-code/design.md , 접근일 2026-09-26.
- 글꼴: Pretendard(SIL OFL 1.1), https://github.com/orioncactus/pretendard , 접근일 2026-09-26.
- 3D: 치아·잇몸 재질은 FrontSide(안쪽 검은 면 없음), 발치 치아는 흰 실루엣 opacity 0.45 + 4% 부풀린 뒷면 껍질의 흰 윤곽선(opacity 0.6), 잇몸은 서버 `gum_filled`(메운 잇몸, 계약 server-policy `.report/11-gum-server.md`) 우선 · 없으면 `gum`; `deformGum` 은 회전(yaw)까지 따르고 제거된 크라운은 이웃에서 뺀다.
- 3D 보기 아이콘 5개: `static/icons/view-{occlusal,front,left,right,overlay}.png` — 자체 제작(2026-09-28), 96px RGBA, 회색 #D9D9D9 글리프 + 투명 배경, 26px 표시.
- 아이콘: Lucide(ISC, 여기 쓴 것: users · layout-panel-left · download · table-2 · shield-check · sliders-horizontal · layers · maximize-2 · minimize-2 · play · pause · skip-back · skip-forward · x · user-plus · arrow-right · trash-2 · check · send-horizontal), https://lucide.dev , lucide-static v1.48.0 에서 쓰는 아이콘만 `index.html` 맨 위 `<symbol id="i-…">` 스프라이트로 복사(외부 요청 없음), 접근일 2026-09-27. 크기 18~20px, `stroke: currentColor`.
