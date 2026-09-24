# UI·형상 선택의 참고 자료

## UI 설계에 이어받을 관찰

기존 2026-09-23 화면 조사에서 얻은 설계 참고다. 외부 제품 기능의 최신 비교표나 cuAlign의 구현 완료 목록은 아니다.

- 계획 진행 단계와 현재 편집 대상을 구분한다.
- 3D 뷰어 옆에서 이동량·IPR·위반 내용을 함께 확인할 수 있게 한다.
- 초기 상태·선택 단계·목표 상태의 차이를 읽을 수 있게 한다.
- 수정 후 새 계획이 만들어졌음을 명확히 표시한다.
- 색뿐 아니라 텍스트·숫자로 상태를 설명한다.

cuAlign의 기능 요구사항은 [PRD](PRD.md)가 기준이다. 직접 3D 조작은 예선 필수가 아니며, 외부 제품의 화면을 그대로 복제하지 않는다.

| 참고 자료 | 조사 당시 확인한 대상 | 출처·기존 접근일 |
|---|---|---|
| Blue Sky Plan | 단계형 작업 흐름·교정 패널 | [공식 매뉴얼](https://blueskybio.com/caffeine/uploads/files/documents/BS-LS-0161_Blue-Sky-Plan-User-Manual-Rev1-2019-12.pdf), 2026-09-23 |
| 3Shape Clear Aligner Studio | 입력→설정→단계 계획→출력 흐름 | [핸드북](https://esmdigitalsolutions.com/wp-content/uploads/2021/03/3Shape-Clear-Aligner-Studio-End-User-Handbook.pdf), 2026-09-23 |
| uLab uDesign | 치아 선택·단계·IPR 표시 | [Feature Guide](https://www.ulabsystems.com/wp-content/uploads/2022/05/FeatureGuide.pdf), 2026-09-23 |
| ArchForm | 기능별 조작 화면 | [제품 소개](https://www.archform.com/software), 2026-09-23 |
| SoftSmile VISION | 3D 작업 영역·전처리→검토 흐름 | [제품 소개](https://softsmile.com/vision/), 2026-09-23 |

## 치아 형상 선택

현재 데모는 Lydran96의 Dental arches에서 준비한 크라운 템플릿 14개를 합성 배치한다.
형상·단위 변환·저작자 표시·라이선스는 [ATTRIBUTION](../src/cualign/core/templates/ATTRIBUTION.md)이 기준이고,
변환 과정은 `scripts/import_tooth_templates.py`에 남아 있다.

이전 후보 조사에서 라이선스·접근 조건이 불분명했던 데이터와 치아가 분리되지 않은 원본은 런타임 자산으로 포함하지 않는다.
외부 제품 스크린샷은 이 문서에 복제하지 않고 원 출처를 연결한다. 디자인 방향의 근거와 재배포 가능한 실행 자산을 구별한다.
