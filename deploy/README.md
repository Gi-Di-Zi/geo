# 서버 공개 배포

원본: https://github.com/Gi-Di-Zi/geo

Node 24.19.0에서 npm ci와 npm run build로 만든 .output만 실행 이미지에 복사한다. public/data는 읽기 전용 bind로 제공하며 데이터 생성과 서비스 DB는 /srv/storage/sda/apps/geo의 별도 rootless Docker 엔진에 보관한다. 런타임에는 Docker 소켓이나 Unreal을 마운트하지 않는다. Cesium for Unreal 버튼은 비활성화하며 웹 CesiumJS는 유지한다.

외부에는 웹 탐색·설명·뷰어·변환 결과와 지도 서비스의 GET/HEAD 조회만 제공한다. /mcp, /api, GeoServer 관리 경로와 변경 요청은 403이다. GeoServer/Martin은 localhost와 프로젝트 전용 Docker bridge(10.242.18.1)의 18600/18601로만 연결한다. 원본과 수집·변환 실행 기록을 생성한 뒤 scripts/check.ts로 전체 26개 형식·71개 경로를 검사한다. Unreal은 설치·실행하지 않는다.

geo-data-docker.service는 /srv/storage/sda/apps/geo/docker-data를 사용한다. 수집 명령은 PATH=/srv/storage/sda/apps/geo/bin:$PATH, DOCKER_HOST=unix:///run/user/1000/geo-docker.sock 환경에서 실행한다. 프로젝트 Docker wrapper는 수집·변환 컨테이너를 rootless 엔진 안의 UID 0(호스트의 strop)으로 실행해 이미지별 기본 사용자에 따른 Linux bind 쓰기 오류를 해결하며 다른 엔진을 변경하지 않는다. .env는 gitignore와 mode 600을 유지한다.

흐름도는 시스템의 움직임 줄이기 설정을 기본으로 따르며 사용자가 재생·끄기를 선택할 수 있다. 이번 UI 변경은 template/CSS이며 SFC script는 유지한다. 기존 lint 명령·CI는 없다. npm run build와 npm run test:viz를 실제 실행하고 npm run check의 실제 데이터 검증을 완료 조건으로 유지한다.

복구에는 Git 소스/배포 설정과 함께 public/data, pipeline/raw·serve, 공간 DB의 일관된 snapshot과 GeoServer 설정을 보호해야 한다. 공용 파일 백업만으로 실행 중인 공간 DB/볼륨 복구를 대체하지 않는다.
