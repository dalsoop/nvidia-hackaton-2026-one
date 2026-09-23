# 스캔 → 상악 치아별 메시: 세그멘테이션 어댑터

치아별 라벨이 없는 악궁 표면 메시를 입력받는 경우, 치아별 메시를 사용하는 계산 코어 앞에 분리 단계가 필요하다.
현재 지원 범위는 상악 Universal 2~15이며, 32개 전체 치아를 처리하는 완성 파이프라인이 아니다.

## 붙인 것

`cualign.core.segmentation`

1. `stl_to_obj` — 스캔 STL → OBJ (ToothGroupNetwork 입력 형식)
2. `run_toothgroupnetwork(input_dir, save_dir)` — 외부 체크아웃의 `inference_mid.py --input_path --save_path` 호출. `CUALIGN_TGN_DIR` 필요
3. `split_by_labels(mesh, vertex_labels)` — 정점 라벨(FDI 11~28)로 면을 다수결 분류해 치아별 메시로 자르고 Universal 번호로 매핑
4. `split_scan(obj, json, out_dir)` — 결과 json 을 스캔에 적용해 `<번호>.stl` 로 저장 → 그대로 `cualign` 케이스 폴더

## 검증 상태 (정직하게)

- **3·4 는 테스트했다** — 합성 악궁 14개 + 잇몸 박스를 한 메시로 합치고 라벨을 붙여 분리하면 14개가 그대로 복원된다(`tests/test_segmentation.py`).
- **2 는 이 레포에서 실행하지 않았다.** ToothGroupNetwork 는 torch + CUDA 커널 빌드가 필요하고, 저장소에 명시 라이선스가 없다(저자 확인 필요). 본선(L40S Brev 크레딧)에서 돌릴 후보.
- 세그멘테이션이 없으면 **입력은 치아별로 분리된 메시를 가정한다**. 자동 분리는 예선 필수가 아니다.

## 근거

- ToothGroupNetwork (limhoyeon) — MICCAI 2022 3DTeethSeg 우승, 체크포인트 포함, 추론 명령 README 원문. https://github.com/limhoyeon/ToothGroupNetwork (접근 2026-09-23)
- MeshSegNet (Tai-Hsien) — IEEE TMI 2020, MIT, 상·하악 학습 모델 포함, 입력 VTP. https://github.com/Tai-Hsien/MeshSegNet (접근 2026-09-23)
- 3Shape TRIOS STL export 공식 뉴스(2017) — 스캔 STL 은 TRIOS 고유 메타데이터를 담지 않는다. https://www.3shape.com (접근 2026-09-23)
- Teeth3DS+ 데이터셋은 CC BY-NC-ND 4.0 — 이 레포는 그 데이터를 포함·재배포하지 않는다.
