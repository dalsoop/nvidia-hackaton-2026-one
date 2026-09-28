# 투명교정 스테이징 데모 — 시각 연출 레퍼런스

인입 노드: 없음
선조회: 정상(5축 회수 완료 — kg/ts/sb/session/design 모두 직접 관련 자료 없음, 일반 UI 용어집·three.js 레시피 노드만 걸림. `askc data recall` 로 확인, 2026-09-28)

조사 방법: WebSearch 로 각 제품 공식 페이지·보도자료·리뷰 매체 검색. 개별 페이지 본문을 축자 인용하지 않았으므로 함정 3(축자 인용 원문 확보 의무)은 이 문서에 해당 없음 — 전부 검색 스니펫 기반 요약이며 원문 대조가 필요하면 URL을 직접 열어야 한다. 상용 제품 데모 영상은 로그인/설치가 필요한 경우가 많아 영상 자체를 재생 확인하지 못했다(공개 페이지 링크만 확보).

---

## 1. 상용 제품의 화면 연출

### Align Technology — ClinCheck Pro / ClinCheck In-Face
- (a) 스캔 로딩·세그멘테이션: 공식 페이지에서 세그멘테이션 애니메이션 세부 묘사는 확인 못함 — 3D Controls 페이지가 "치아별 조정·치열궁 형태·최적화된 부착물" 조작을 짧은 영상으로 보여준다고만 명시. — [3D Controls in ClinCheck Pro](https://www.invisalign.com/provider/align-digital-platform/clincheck/3d-controls) (접근 2026-09-28)
- (b) 치아 이동: ClinCheck Smile Video가 3D 애니메이션 시뮬레이션으로 시작~종료 단계 전체 이동을 재생하는 방식(단계 슬라이더가 아니라 연속 재생 동영상에 가까움). — [ClinCheck Smile Video 설명(DentMax)](https://www.dentmax.com.tr/en/treatments/clincheck-smile-video) (접근 2026-09-28), [What is ClinCheck Video 3D Simulation](https://www.bayswaterdental.co.uk/invisalign-london-braces/what-is-a-clincheck-video) (접근 2026-09-28)
- (b') In-Face 연출: 환자 정면 사진에 치아 3D 모델을 합성해 "치료 후 얼굴에서 어떻게 보일지"를 보여주는 방식 — 순수 구강 내 뷰가 아니라 실사 합성. — [Align 보도자료: ClinCheck In-Face 출시](https://www.globenewswire.com/news-release/2020/02/20/1987866/0/en/Align-Technology-Launches-ClinCheck-In-Face-Visualization-Tool-for-the-Invisalign-Go-System.html) (접근 2026-09-28), [Orthodontic Products 기사](https://orthodonticproductsonline.com/practice-products/software/treatment-planning/align-technology-offers-clincheck-in-face-visualization-tool-for-invisalign-go-system/) (접근 2026-09-28)
- (c) 계획 수립: 사용자 가이드 PDF에 조작 UI 상세가 있을 가능성 — 열람은 못함(원문 미확보, 87페이지 PDF). — [ClinCheck Pro 6 User Guide PDF](https://assets.ctfassets.net/vh25xg5i1h5l/qwpf6aq8qtSj0keD5bJzB/71bf896a5584a0a6311f52d03bce4581/MKT-0003721_Rev_J_User_Guide_ClinCheck_Pro_6-87-.pdf) (접근 2026-09-28)

### 3Shape Clear Aligner Studio
- (a)(b)(c) 공식 YouTube 데모 3건 — "Setup and Staging Assistance", "Timeline", "Virtual Sub-setup" 이라는 제목으로 보아 **타임라인 형태의 단계 탐색 UI**를 쓰는 것으로 추정(영상 재생은 못함, 제목 기반 추정). — [3Shape Clear Aligner Studio Demo](https://www.youtube.com/watch?v=HQVurPVzuKA) (접근 2026-09-28), [Setup and Staging — Timeline](https://www.youtube.com/watch?v=X6b1Hf27GaE) (접근 2026-09-28), [Virtual Sub-setup Demo](https://www.youtube.com/watch?v=_GJyq2a-Wu0) (접근 2026-09-28)
- 기능 설명: "이상적 셋업을 서브셋업(개별 트레이)으로 분할하고 전체 과정의 애니메이션을 생성" — 스테이징 표 + 애니메이션 재생 조합으로 추정. — [3Shape Clear Aligner Studio 제품 페이지](https://www.3shape.com/en/software/clear-aligner-studio) (접근 2026-09-28)

### uLab uDesign
- (b)(c) "Auto Staging" 기능이 AI로 이동 순서를 최적화하고 충돌을 회피 — **충돌 회피 로직이 명시적으로 존재**하나 그것을 화면에 어떻게 시각화하는지(붉은 하이라이트 여부)는 원문에서 확인 못함. — [uDesign AI Software](https://www.ulabsystems.com/udesign/) (접근 2026-09-28), [uDesign 7.0 보도자료 — AI 스테이징](https://www.prnewswire.com/news-releases/ulab-shortens-treatment-planning-time-for-all-case-complexities-with-udesign-7-0-now-with-ai-assisted-staging-and-a-concierge-planning-assistance-service-301539215.html) (접근 2026-09-28)
- Cloud 2.0은 브라우저 기반 워크스페이스 — 웹 3D 렌더링 구조라는 점에서 참고 가치. — [uDesign Cloud 2.0 발표](https://www.ulabsystems.com/ulab-systems-launches-udesign-cloud-2-0-bringing-segmentation-self-planning-and-cloud-based-printing-together-in-one-flexible-aligner-platform/) (접근 2026-09-28)
- 관련 논문(치아 이동 스테이징 알고리즘, uLab과 직접 연관은 미확인): [Force-Driven Model for Automated Clear Aligner Staging Design](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC11852307/) (접근 2026-09-28)

### SoftSmile VISION
- (a) AI 자동 세그멘테이션 + AI 자동 셋업(치아를 이상적 치열궁 위치로 즉시 배치) — "instantly positioning teeth" 표현으로 보아 **점진적 애니메이션이 아니라 즉시 스냅 방식**일 가능성. — [AI-driven orthodontic treatment planning software](https://softsmile.com/blog/ai-driven-orthodontic-treatment-planning-software/) (접근 2026-09-28)
- (c) **Vision Concierge**: 대화형 AI 에이전트가 "환자 요약 조회·기록 번역·양식 자동 채움·3D 치료 편집기 열기" 등을 텍스트 명령으로 실행 — 이번 조사에서 가장 근접한 "에이전트가 도구를 부르는 장면"의 실제 상용 사례. 차기 버전(Vision AI)은 "케이스 분석→진단→초기 포지셔닝→부착물 배치→최종 단계까지 전 과정을 자율 실행하되 의사가 각 단계를 통제"하는 방향으로 개발 중이라고 발표됨. — [SoftSmile Vision Concierge 출시 기사](https://orthodonticproductsonline.com/practice-products/software/treatment-planning/softsmile-launches-vision-concierge-ai-for-orthodontic-software/) (접근 2026-09-28), [DrBicuspid 보도](https://www.drbicuspid.com/dental-specialties/orthodontics/article/15829198/softsmile-launches-vision-concierge-conversational-ai-agent) (접근 2026-09-28), [Orthopractice US 보도](https://orthopracticeus.com/industry-news/softsmile-launches-vision-concierge-an-ai-agent-that-actson-clinical-commands-inside-orthodontic-software/) (접근 2026-09-28)
- 데모 예약 페이지(영상 자체는 미확보): [SoftSmile Demo](https://softsmile.com/demo/) (접근 2026-09-28)

### Dentsply Sirona SureSmile
- (a)(b) **SureSmile Simulator** (DS Core 내 앱): 스캔 후 5분 이내 AI 기반 자동 모델링·세그멘테이션으로 치료 후 미소를 3D 시각화. 환자 상담용으로 설계되어 "치료 전후 비교"에 특화. — [SureSmile Simulator 출시 기사](https://orthodonticproductsonline.com/practice-products/software/treatment-planning/dentsply-sirona-launches-suresmile-simulator/) (접근 2026-09-28), [PR Newswire 보도자료](https://www.prnewswire.com/news-releases/suresmile-simulator-powered-by-ds-core-enhances-treatment-acceptance-through-digital-visualization-301964393.html) (접근 2026-09-28)
- (b') "치아 이동" 아이콘을 누르면 변위·탄성체·측정값 탭이 있는 플로팅 창이 열림 — **수치 패널 형태**(그래픽 벡터 화살표 여부는 원문에서 확인 못함). — [SureSmile Aligner Software 사용자 개선사항](https://www.dentsplysirona.com/en-us/discover/discover-by-brand/suresmile-aligners/suresmile-aligner-software-user-enhancements.html) (접근 2026-09-28)

### Angel Align iOrtho — Make it™
- (a)(b) "Make it™"은 랩 셋업을 기다리지 않고 즉석에서 시뮬레이션된 치료 결과를 거의 즉시 생성 — 초기 상담 단계의 **빠른 프리뷰 연출**에 특화된 기능. 주요 스캐너와 원클릭 연동. — [Angel Align Make it 소개](https://www.angelaligner.com/en-us/innovation-software-make-it/) (접근 2026-09-28)
- 워크플로우 튜토리얼 영상 재생목록(개별 영상 재생 확인 못함): [iOrtho Workflow Tutorials 재생목록](https://www.youtube.com/playlist?list=PLLUgMNBpefobX2KDXibzZrzTmGSPAPqpQ) (접근 2026-09-28)

### ArchForm
- (b)(c) 웹 에디터가 **실시간 3D 시각화 + 직관적 치아 이동 컨트롤**을 제공한다고 명시 — 클릭 한 번으로 스테이징·부착물·IPR 조정. 브라우저 기반이라는 점에서 이번 데모(웹 3D)와 구조적으로 가장 가까운 참고 사례. — [ArchForm 공식 사이트](https://www.archform.com/) (접근 2026-09-28), [ArchForm 소프트웨어 설명(formaligners)](https://www.formaligners.com/software) (접근 2026-09-28)
- 데모 영상: [ArchForm Aligner Design Software — YouTube](https://www.youtube.com/watch?v=0dF9y3gw77o) (접근 2026-09-28)
- 5개 제품 비교 글(직접 열람은 못함, 제목만 확인): [Decoding the Digital Smile — 5개 소프트웨어 비교](https://www.clear-forward.com/blog/decoding-the-digital-smile-a-comparative-look-at-5-clear-aligner-treatment-planning-software) (접근 2026-09-28)

---

## 2. Three.js 구현 기법 레퍼런스

| 기법 | 참고 |
|---|---|
| 스캔라인/셰이더 리빌 | [Shader Reveal with R3F & GLSL (Codrops)](https://tympanus.net/codrops/2024/12/02/how-to-code-a-shader-based-reveal-effect-with-react-three-fiber-glsl/) (접근 2026-09-28) · [WebGPU Scanning Effect with Depth Maps (Codrops)](https://tympanus.net/codrops/2025/03/31/webgpu-scanning-effect-with-depth-maps/) (접근 2026-09-28) — smoothstep/mod로 스캔 라인 위치를 계산해 그 위치 기준으로 영역을 드러냄. 개념 직접 이식 가능. |
| X-ray/듀얼 씬 리빌 | [Fluid X-Ray Reveal Effect in Three.js (Codrops)](https://tympanus.net/codrops/2026/03/23/building-a-dual-scene-fluid-x-ray-reveal-effect-in-three-js/) (접근 2026-09-28) — 스캔 전/후 두 장면을 유체 형태 마스크로 전환. 「스캔 중」연출에 직접 활용 가능. |
| 반투명 고스트 오버레이 + 트윈 | [three.js Transparency 공식 가이드](https://threejs.org/manual/en/transparency.html) (접근 2026-09-28) — `MeshBasicMaterial({transparent:true, opacity:0.x, depthTest:false, depthWrite:false})` 로 원위치 고스트 구현. [tween.js user guide](https://tweenjs.github.io/tween.js/docs/user_guide.html) (접근 2026-09-28)로 목표 위치까지 보간. 원위치 고스트+목표 위치 실체 조합은 직접 코드는 못 찾았으나 두 문서 조합으로 자명하게 구현 가능(추정). |
| InstancedMesh 위치 트윈 | [Tween InstancedMesh positions (three.js forum)](https://discourse.threejs.org/t/tween-instancedmesh-positions/17778) (접근 2026-09-28) — 다수 치아를 한 드로우콜로 이동시킬 때 유용. |
| 이동 경로 트레일 | [TrailRendererJS](https://github.com/mkkellogg/TrailRendererJS) (접근 2026-09-28) — 임의 3D 오브젝트에 트레일을 붙이는 라이브러리, 가장 즉시 적용 가능. [Three.js FBO motion trails (CodePen)](https://codepen.io/brunoimbrizi/pen/MoRJaN) (접근 2026-09-28) — 프레임버퍼 기반, 구현 난도 높음. |
| 충돌/접촉 하이라이트 | [three-mesh-bvh 활용 제안 (three.js forum)](https://discourse.threejs.org/t/how-to-show-heat-map-on-collision-real-time/52161) (접근 2026-09-28) — BVH로 교차 깊이를 구해 커스텀 셰이더로 색상화. 기본 제공 기능은 아니고 조합 구현 필요(원문에 완성 예제 없음, 방법론만 언급). |
| 카메라 오토 오빗 | [OrbitControls 공식 문서](https://threejs.org/docs/pages/OrbitControls.html) (접근 2026-09-28) — `autoRotate` + `autoRotateSpeed`, `update()`를 애니메이션 루프에서 호출. 가장 구현이 쉬운 항목. [OrbitControls 인터랙티브 데모](https://threejsdemos.com/demos/camera/orbit) (접근 2026-09-28) |
| 단계 스크러빙(슬라이더로 stage 넘기기) | 전용 예제는 찾지 못함(추정) — [three.js Animation System 공식 문서](https://discoverthreejs.com/book/first-steps/animation-system/) (접근 2026-09-28)의 키프레임/트위닝 개념을 슬라이더 값 → 보간 비율(t)로 직접 매핑하면 구현 가능. |

---

## 3. 에이전트가 "일하는 장면"을 보여주는 UI 패턴 (참고 공개 데모)

1. **Agent Flow** — Claude Code 훅 서버에서 실시간 이벤트를 받아 인터랙티브 노드 그래프로 에이전트의 도구 호출·분기·리턴 흐름을 시각화. 이번 조사에서 가장 구조가 명확한 참고 사례. — [Agent Flow (GitHub, patoles fork)](https://github.com/patoles/agent-flow) (접근 2026-09-28), [Agent Flow 소개 페이지](https://www.pitchhut.com/project/agent-flow-visualization) (접근 2026-09-28)
2. **agentglass** — "mission control" 형태로 여러 AI 코딩 에이전트 세션을 한 화면에서 모니터링, 위험한 호출은 사람이 승인할 때까지 보류하는 게이트 UI. — [agentglass](https://sirallap.github.io/agentglass/) (접근 2026-09-28)
3. **AgentStreamDeck / Codeman** — 여러 에이전트 세션의 라이브 상태를 물리 컨트롤러/웹 대시보드에 배지(초록=활성, 노랑=대기, 파랑=완료)로 표시. — [AgentStreamDeck](https://github.com/darkmatter2222/AgentStreamDeck) (접근 2026-09-28), [Codeman](https://github.com/JDProfresh/Codeman) (접근 2026-09-28)
4. **codeinchrome PR #76 "Live agent activity and streaming terminal output"** — 플로팅 터미널 창에 모든 도구 호출·파일 읽기·진행 업데이트를 실시간으로 기록하는 패턴. 각 호출이 "started → done/failed"로 상태 전환되며 종료 코드·소요 시간을 함께 표시. — [PR #76](https://github.com/deltacontractingsupplies/codeinchrome/pull/76) (접근 2026-09-28)
5. **Claude Agent SDK — Partial message streaming** — `include_partial_messages` 옵션으로 텍스트·도구 호출을 토큰 단위로 스트리밍해 화면에 실시간 렌더링하는 공식 지원 기능. 자체 데모를 만들 때 기반 API로 직접 활용 가능. — [Claude Code Docs — Stream responses in real-time](https://code.claude.com/docs/en/agent-sdk/streaming-output) (접근 2026-09-28)

공통 패턴: (1) 도구 호출 하나하나를 "started → done/failed" 상태 전환 카드/배지로 표시, (2) 위험하거나 검증이 필요한 동작은 별도 하이라이트, (3) 여러 병렬 작업을 노드 그래프나 탭으로 동시에 보여줌.

---

## 해커톤 시연 3시간 안에 붙일 수 있는 것 5개 (순위 · 난이도)

1. **카메라 오토 오빗 (낮음)** — `OrbitControls.autoRotate = true` 한 줄. 데모 전체를 "가만히 있지 않는 화면"으로 만드는 가장 저비용 고효율 연출. [문서](https://threejs.org/docs/pages/OrbitControls.html)
2. **반투명 고스트 원위치 오버레이 (낮음)** — 치아 이동 전 위치를 `opacity:0.3, depthTest:false`로 복제해 두고, 실제 치아는 목표 위치로 tween. "이만큼 움직였다"가 한눈에 보임. [Transparency 가이드](https://threejs.org/manual/en/transparency.html) · [tween.js](https://tweenjs.github.io/tween.js/docs/user_guide.html)
3. **단계 스크러빙 슬라이더 (낮음)** — 이미 위치 데이터(단계별 좌표)가 있다면 슬라이더 값을 보간 비율에 매핑하는 것은 30분 내 구현. ClinCheck·3Shape 모두 이 패턴을 쓰는 것으로 추정되는 검증된 UX.
4. **도구 호출 로그 스트리밍 패널 (중간)** — Agent Flow류처럼 "스캔 중 → 세그멘테이션 중 → 이동 계산 중 → 검증 중"을 카드로 순차 전환하며 상태 배지(초록/노랑/빨강)를 뒤집는 연출. LLM 에이전트가 실제로 도구를 부르는 순서에 맞춰 이벤트만 쏘면 되므로 프론트 로직은 단순하지만 백엔드 이벤트 배선이 필요해 중간 난이도.
5. **치아별 색 분리 세그멘테이션 애니메이션 (중간)** — 초기 로딩 시 치아 메시들을 순차적으로 다른 색으로 페이드인시키며 "스캔·인식 중"을 연출. 셰이더 스캔라인(Codrops 예제)까지 가면 시간이 부족할 수 있으므로, 단순 버전은 각 메시의 opacity/emissive를 순서대로 `setTimeout` 체인으로 올리는 정도로 축소 구현 권장.

미확보 항목: ClinCheck Pro 3D Controls·SureSmile 변위 패널의 실제 UI 스크린샷/영상 재생 확인(공식 페이지는 텍스트 설명만 확인, 임베드 영상은 재생 시도 안 함 — 시간 제약), 충돌 히트맵의 완성된 three.js 코드 예제(개념만 확인, 완전한 구현 예제는 못 찾음 — 표면 사다리: WebSearch 3회, 없으면 개별 구현 필요).
