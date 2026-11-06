# 서버 공개 배포

원본: https://github.com/Gi-Di-Zi/geo

Node 24.19.0에서 npm ci와 npm run build로 만든 .output만 실행 이미지에 복사한다. public/data는 읽기 전용 bind로 제공하며 데이터 생성과 서비스 DB는 /srv/storage/sda/apps/geo의 별도 rootless Docker 엔진에 보관한다. 런타임에는 Docker 소켓이나 Unreal을 마운트하지 않는다. Cesium for Unreal 버튼은 비활성화하며 웹 CesiumJS는 유지한다.

외부에는 웹 탐색·뷰어·예시 서비스의 읽기와 MCP Apps·업로드 변환을 제공한다. /mcp, /api/stage, /api/jobs, /api/jobs/capabilities(GET) 및 해당 UUID 결과 경로만 전용 작업자로 전달하고 나머지 /api와 GeoServer 관리 경로는 403이다. GeoServer/Martin은 localhost와 프로젝트 전용 Docker bridge(10.242.18.1)의 18600/18601로만 연결한다. 원본과 수집·변환 실행 기록을 생성한 뒤 scripts/check.ts로 전체 26개 형식·71개 경로를 검사한다. Unreal은 설치·실행하지 않는다.

geo-data-docker.service는 /srv/storage/sda/apps/geo/docker-data를 사용한다. 수집 명령은 PATH=/srv/storage/sda/apps/geo/bin:$PATH, DOCKER_HOST=unix:///run/user/1000/geo-docker.sock 환경에서 실행한다. 프로젝트 Docker wrapper는 수집·변환 컨테이너를 rootless 엔진 안의 UID 0(호스트의 strop)으로 실행해 이미지별 기본 사용자에 따른 Linux bind 쓰기 오류를 해결하며 다른 엔진을 변경하지 않는다. .env는 gitignore와 mode 600을 유지한다.

흐름도는 Windows·OS의 움직임 줄이기 설정과 관계없이 기본 재생한다. 노선·과정 칩·알갱이는 처음부터 표시하고, 꼬리 애니메이션은 공통 움직임 줄이기 CSS가 중단하지 않도록 한다. 사용자가 직접 끄기를 선택할 수 있다. MCP·업로드 변경 범위에는 npm run lint를 연결했으며 dev·build·generate·setup·pipeline·check·test:viz·test:mcp-app의 선행 hook이 검사 실패를 차단한다. 일반 anti-slop 규칙18개와 native companion을 error로 적용하고 기존 저장소 전체 이전으로 주장하지 않는다. 기존 quality workflow 원문은 `.ci/contracts/quality.yml`에 보존한다. GitHub는 Git 소스 보관에만 사용하며 Actions를 CI/CD로 실행하지 않는다. 실제 서버 CI는 `deploy/selfhost-ci.json`의 필수 10단계와 rootless 격리 증거를 사용하며, CI 통과와 실제 서버 배포 완료는 별도로 확인한다. npm run test:viz·test:mcp-app과 npm run check의 실제 데이터 검증을 완료 조건으로 유지한다.

복구에는 Git 소스/배포 설정과 함께 public/data, pipeline/raw·serve, 공간 DB의 일관된 snapshot과 GeoServer 설정을 보호해야 한다. 공용 파일 백업만으로 실행 중인 공간 DB/볼륨 복구를 대체하지 않는다.

## 업로드 작업자

웹 컨테이너에는 Docker 소켓을 붙이지 않는다. geo-conversion-worker.service는 검증한 source/release에서 Node24 Nitro를 실행하며 10.242.18.1:18770에만 바인딩한다. 프록시가 주입하는 전용 키는 Git 밖 worker-config에 보관하고 GEO_PUBLIC_CONVERSIONS=1로 파일 방식만 허용한다. PUBLIC_URL은 https://geospatial.kro.kr, MCP_LOCAL_PATHS=0, GEO_ENGINE_ENABLED=0이다.

원본·작업 결과는 /srv/storage/sda/apps/geo/runtime-data에 보존하며 자동 삭제하지 않는다. 입력200MiB, 접속자(X-Real-IP)별 하루 업로드1GiB(작업자 메모리 기록, 재시작 시 초기화), 동시변환1개, ZIP해제2GiB/50000항목, 작업공간4GiB감시(파일시스템 hard quota 아님), 전체저장공간/디스크여유입장검사를 적용한다. 런타임도2CPU/3GiB로 제한하고 각 변환 컨테이너는 별도rootless엔진에서메모리/CPU/시간을 제한한다. 커널잠금과상속FD가재시작중중복변환을막고, UUID라벨/원본마운트로소유가확인된중단리소스만정리한다.

nginx는 Geo 전용 Docker DNS 이름 `coolify-proxy`로 해석되는 앞단 프록시만 신뢰해 X-Forwarded-For에서 접속자 IP를 복원하고 IP별 MCP 요청·동시 업로드 제한과 작업자의 X-Real-IP에 쓴다. 같은 네트워크의 앱이나 호스트가 직접 보낸 X-Forwarded-For는 신뢰하지 않는다. 프록시 이름은 nginx 기동 시 해석하며 이름을 해석할 수 없으면 기동에 실패한다. 프록시 컨테이너 재생성으로 주소가 바뀌면 DNS 결과를 확인하고 nginx를 다시 기동해 신뢰 주소를 갱신해야 한다. 이 설정은 Coolify 배포용이며 로컬 Nuxt 개발에는 쓰이지 않는다. nginx의 request/response buffering을 끄고201MiB요청한도를설정하므로200MiB입력을읽기전용컨테이너의32MiB임시공간에spool하지않는다. MCP요청은앱SDK리소스/프로토콜검증, 실제업로드는공식브리지·웹UI·파일결과로따로확인한다. 실제Claude/ChatGPT계정호스트연결은별도범위다.

사용자 systemd의 PrivateTmp는 이 Ubuntu 호스트에서 별도 사용자 네임스페이스/AppArmor 경계로 rootless Docker 소켓 연결을 막으므로 사용하지 않는다. 대신 mode700의 전용 runtime-data/tmp를 TMPDIR로 지정하고 NoNewPrivileges·작업자 인증·비공개 바인딩·자원 제한은 유지한다.

## 주소·코드 연계 (작업자)

nginx는 `/api/link/`의 즉시 변환·조회·경계 경로(resolve·boundary·references/update는 POST, capabilities·regions·references는 GET)만 작업자로 넘기고 접속자별 초당 5건(버스트 20)으로 제한한다. 작업자 미들웨어도 같은 목록만 받는다. CSV·XLSX 업로드·일괄 작업 경로는 공개하지 않는다(MCP도 공개 모드에서는 일괄 작업·파일 도구를 등록하지 않는다).

작업자에 필요한 것:
- 기준 사전: `GEO_DATA_DIR`(업로드와 같은 데이터 폴더) 아래 `reference/link`. `LINK_REFERENCE_DIR`·`LINK_ADMINISTRATIVE_DIR`·`LINK_DATA_DIR`가 있으면 그쪽. 작업자가 뜰 때 사전이 없으면 공개 원천(행정표준코드관리시스템·행정안전부, 키 없음)에서 자동으로 받는다(server/plugins/link-reference.ts, 빈 폴더에서 약 2초). 끄려면 `LINK_REFERENCE_AUTOSTART=0`, 작업자 키 없는 단일 서버는 `=1`. 이후 갱신은 /link/reference 화면의 업데이트(한국 날짜 하루 한 번, 같은 날 요청은 공유).
- VWorld 키: 작업자 환경변수 `VWORLD_KEY`(지오코더·검색 API). 경계 SHP(2D 데이터 API)는 키에 등록한 서비스 URL을 `VWORLD_DOMAIN`에 글자 그대로 넣는다. 키가 없으면 위치·우편번호·경계는 설정 필요로 표시되고 코드·지번주소 변환은 그대로 된다.
- 외부 원천을 부르는 조회(위치·우편번호·경계, 도로명주소)는 접속자(X-Real-IP)별 하루 2,000줄(작업자 메모리 기록, 재시작 시 초기화). 사전만 쓰는 변환은 세지 않는다.

## 공간 서비스 주소 (GeoServer)

GeoServer는 능력 문서(GetCapabilities)와 OGC API 링크에 내부 경로(`http://<host>/geoserver/geo/…`)를 적는다. nginx가 이 응답의 주소를 공개 경로(`https://<host>/svc/geoserver/…`)로 바꿔 내보내고(sub_filter, 압축 없이 받음), OGC API Features의 시작 페이지·적합성·컬렉션 경로도 연다. 이것이 없으면 QGIS 같은 표준 클라이언트가 이어지는 요청(GetMap·GetFeature·GetTile)을 보내지 못한다. 사이트의 웹 뷰어는 주소를 직접 만들어 영향이 없다. 앱 앞단 경로는 `X-Forwarded-Proto: https`로 넘겨 앱이 만드는 절대 주소(QGIS plugins.xml 내려받기 등)가 https가 되게 한다.

## 검증된 프록시 설정의 배포 경로

Coolify compose의 두 Nginx 설정 bind는 파일별 공개 환경변수 `GEO_PUBLIC_NGINX_CONF`와 `GEO_WORKER_PROXY_CONF`를 사용한다. 미설정·빈 값은 각각 기존 canonical deploy 디렉터리의 원래 파일을 사용한다. 데이터와 비공개 작업자 키의 읽기 전용 bind는 그대로이며, 소스·데이터를 덮어쓰지 않는다.

현재 Coolify v5 parser는 `${VAR:-기본디렉터리}/파일명` 형식의 짧은 bind를 잘못 분해한다. 파일명까지 포함한 기본값과 명시적인 long syntax `type: bind`, `target`, `read_only: true`를 사용하고, 기존 데이터·키의 RO bind를 앞에 유지한다. 검증된 v5 volume 단계의 결과와 Docker Compose에서 기본값·빈 값·release 파일 경로의 실제 두 RO source/target을 함께 검사한다. 일반 Compose config 통과만으로 Coolify 호환을 주장하지 않는다.

자동 배포기는 실제 CI source archive를 immutable release로 복원하고 두 파일 SHA를 검증한 뒤, 이 두 key에 release의 파일 경로만 설정한다. v2 key별 소유 ledger로 UUID·flags·갱신시각과 실제 이전 web bind를 확인한다. 이전 `GEO_RUNTIME_CONFIG_ROOT` key와 실패 operation·ledger는 삭제하거나 다시 실행하지 않는다. 기존 checkout·작업 데이터는 변경하지 않는다.

원래 단일 배포 POST와 응답 유실 시 재호출 금지 계약을 유지한다. 완료 판정은 앱·작업자·공개 동작·데이터 보존과 함께 실제 web의 두 RO bind source 및 파일 SHA를 확인해야 한다. 이 소스 후보만으로 운영에 적용되지 않으며, adapter와 config/factory/issuer/task-CI의 검토된 pin을 먼저 반영하고 새 main revision을 게시한 뒤 기존 자체 CI·배포로 검증한다.
