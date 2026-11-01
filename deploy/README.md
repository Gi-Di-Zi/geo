# 서버 공개 배포

원본 저장소: https://github.com/Gi-Di-Zi/geo

Node 24.19.0에서 npm ci와 npm run build로 만든 .output만 실행 이미지에 복사한다. 런타임에는 Docker 소켓, 원본 파일, 개발 도구, Unreal을 마운트하지 않는다. Cesium for Unreal 버튼은 비활성화하며 웹 CesiumJS는 유지한다.

공개 경로는 탐색·설명·웹 뷰어용이다. 인증 없는 로컬 사용을 전제로 한 /mcp, /api/, /svc/와 변경 요청은 공개 프록시에서 403으로 차단한다. 원본과 변환 데이터가 Git에 없으므로 전체 파이프라인·실제 지도 데이터는 별도 준비가 필요하다. 엔진 및 전체 데이터 검사는 배포 성공으로 주장하지 않는다.

기존 lint 명령·CI 구성은 없다. 이번 소스 변경은 CompareStage.vue의 Unreal 버튼 template에 한정하며 script는 유지한다. 기존 npm run build와 npm run test:viz를 실제 실행하고 npm run check의 데이터 준비 상태를 별도로 기록한다. anti-slop의 script 변경 범위를 넓히는 전량 리팩터링은 수행하지 않는다.
