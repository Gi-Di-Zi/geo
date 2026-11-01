# 서버 공개 배포

원본: https://github.com/Gi-Di-Zi/geo

Node 24.19.0에서 npm ci와 npm run build로 만든 .output만 실행 이미지에 복사한다. public/data는 읽기 전용 bind로 제공하며 데이터 생성과 서비스 DB는 /srv/storage/sda/apps/geo의 별도 rootless Docker 엔진에 보관한다. 런타임에는 Docker 소켓이나 Unreal을 마운트하지 않는다. Cesium for Unreal 버튼은 비활성화하며 웹 CesiumJS는 유지한다.

외부에는 웹 탐색·뷰어·예시 서비스의 읽기와 MCP Apps·업로드 변환을 제공한다. /mcp, /api/stage, /api/jobs 및 해당 UUID 결과 경로만 전용 작업자로 전달하고 나머지 /api와 GeoServer 관리 경로는 403이다. GeoServer/Martin은 localhost와 프로젝트 전용 Docker bridge(10.242.18.1)의 18600/18601로만 연결한다. 원본과 수집·변환 실행 기록을 생성한 뒤 scripts/check.ts로 전체 26개 형식·71개 경로를 검사한다. Unreal은 설치·실행하지 않는다.

geo-data-docker.service는 /srv/storage/sda/apps/geo/docker-data를 사용한다. 수집 명령은 PATH=/srv/storage/sda/apps/geo/bin:$PATH, DOCKER_HOST=unix:///run/user/1000/geo-docker.sock 환경에서 실행한다. 프로젝트 Docker wrapper는 수집·변환 컨테이너를 rootless 엔진 안의 UID 0(호스트의 strop)으로 실행해 이미지별 기본 사용자에 따른 Linux bind 쓰기 오류를 해결하며 다른 엔진을 변경하지 않는다. .env는 gitignore와 mode 600을 유지한다.

흐름도는 Windows·OS의 움직임 줄이기 설정과 관계없이 기본 재생한다. 노선·과정 칩·알갱이는 처음부터 표시하고, 꼬리 애니메이션은 공통 움직임 줄이기 CSS가 중단하지 않도록 한다. 사용자가 직접 끄기를 선택할 수 있다. MCP·업로드 변경 범위에는 npm run lint를 연결했으며 dev·build·generate·setup·pipeline·check·test:viz·test:mcp-app의 선행 hook이 검사 실패를 차단한다. 일반 anti-slop 규칙18개와 native companion을 error로 적용하고 기존 저장소 전체 이전으로 주장하지 않는다. .github/workflows/quality.yml은 Node24에서 npm ci → lint → 검사기 회귀 검사 → 사전 갱신 회귀 검사 → build를 실행한다. PR과 main/deploy 브랜치 push에서만 실행하며 자동 배포나 secret 연결은 없다. 실제 GitHub CI 실행 상태와 서버 배포 상태는 별도 확인한다. npm run test:viz·test:mcp-app과 npm run check의 실제 데이터 검증을 완료 조건으로 유지한다.

복구에는 Git 소스/배포 설정과 함께 public/data, pipeline/raw·serve, 공간 DB의 일관된 snapshot과 GeoServer 설정을 보호해야 한다. 공용 파일 백업만으로 실행 중인 공간 DB/볼륨 복구를 대체하지 않는다.

## 업로드 작업자

웹 컨테이너에는 Docker 소켓을 붙이지 않는다. geo-conversion-worker.service는 검증한 source/release에서 Node24 Nitro를 실행하며 10.242.18.1:18770에만 바인딩한다. 프록시가 주입하는 전용 키는 Git 밖 worker-config에 보관하고 GEO_PUBLIC_CONVERSIONS=1로 파일 방식만 허용한다. PUBLIC_URL은 https://geospatial.kro.kr, MCP_LOCAL_PATHS=0, GEO_ENGINE_ENABLED=0이다.

원본·작업 결과는 /srv/storage/sda/apps/geo/runtime-data에 보존하며 자동 삭제하지 않는다. 입력200MiB, 동시변환1개, ZIP해제2GiB/50000항목, 작업공간4GiB감시(파일시스템 hard quota 아님), 전체저장공간/디스크여유입장검사를 적용한다. 런타임도2CPU/3GiB로 제한하고 각 변환 컨테이너는 별도rootless엔진에서메모리/CPU/시간을 제한한다. 커널잠금과상속FD가재시작중중복변환을막고, UUID라벨/원본마운트로소유가확인된중단리소스만정리한다.

nginx의 request/response buffering을 끄고201MiB요청한도를설정하므로200MiB입력을읽기전용컨테이너의32MiB임시공간에spool하지않는다. MCP요청은앱SDK리소스/프로토콜검증, 실제업로드는공식브리지·웹UI·파일결과로따로확인한다. 실제Claude/ChatGPT계정호스트연결은별도범위다.

사용자 systemd의 PrivateTmp는 이 Ubuntu 호스트에서 별도 사용자 네임스페이스/AppArmor 경계로 rootless Docker 소켓 연결을 막으므로 사용하지 않는다. 대신 mode700의 전용 runtime-data/tmp를 TMPDIR로 지정하고 NoNewPrivileges·작업자 인증·비공개 바인딩·자원 제한은 유지한다.
