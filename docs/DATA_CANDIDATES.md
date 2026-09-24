# 공개 치과 데이터 후보

> 2026-09-24 팀 개발 채널에서 제안된 자료를 원본 기록과 대조했다. 아래 자료는 **검토 후보**이며 현재 저장소의 실행 자산·학습 데이터·임상 검증 결과가 아니다. 다운로드·전처리·재배포를 시작하기 전 파일 구성과 표시 의무를 다시 확인한다.

| 자료 | 원본에서 확인한 내용 | cuAlign에서 검토할 용도 | 주의점 |
|---|---|---|---|
| [Poseidon3D](https://zenodo.org/records/15608906) | 교정 구강 스캔의 치아 분할용 데이터, ZIP 1.0 GB, CC BY 4.0. [원 논문](https://pmc.ncbi.nlm.nih.gov/articles/PMC11505287/)에는 200개 메시가 기록됨 | 한 덩어리 구강 스캔의 치아 분할 평가 후보 | 현재 예선 기본 입력은 이미 분리된 치아다. 분할 성능이 단계 계획의 타당성을 입증하지는 않음 |
| [DentVoxel](https://figshare.com/articles/dataset/31239889) | CBCT 100건·38개 해부학 구조 라벨, 다운로드 파일 약 8.8 GB, CC BY 4.0 | 향후 CBCT 기반 3D 해부학 분석 연구 후보 | 구강 표면 스캔 STL과 다른 영상·라벨 형식이다. 현 스테이징 PoC에 바로 연결되는 데이터로 취급하지 않음 |
| [하악 치아·치주인대·뼈 모델](https://data.mendeley.com/datasets/xjsx7nfhj8/1) | 14개 치아와 치주인대·뼈 구조의 STL/IGES 등, CC BY 4.0 | 뷰어·유한요소 해석 아이디어를 살필 때의 형상 후보 | 모델을 가져오는 것만으로 힘·조직 반응 계산이나 임상적 검증이 되는 것은 아님 |

팀 메시지의 **세 번째 URL은 두 번째 DentVoxel URL과 동일**했다. 위 표에는 설명과 일치하는 Mendeley 원본을 찾아 연결했다. Mendeley에 비슷한 제목의 버전·기록이 있으므로 실제 활용할 파일과 DOI는 다운로드 전에 다시 고른다.

현재 데모에 포함된 형상과 라이선스는 [기존 템플릿의 출처 문서](../src/cualign/core/templates/ATTRIBUTION.md)가 정본이다. 위 후보를 가져오면 파일 단위 출처·변환 과정·저작자 표시를 별도로 남겨야 한다. 실제 환자 스캔이나 식별 정보는 저장소에 넣지 않는다.

원본 기록·라이선스 접근일: [Poseidon3D Zenodo](https://zenodo.org/records/15608906), [Poseidon3D 논문](https://pmc.ncbi.nlm.nih.gov/articles/PMC11505287/), [DentVoxel figshare](https://figshare.com/articles/dataset/31239889), [하악 모델 Mendeley](https://data.mendeley.com/datasets/xjsx7nfhj8/1) — 모두 2026-09-24.
