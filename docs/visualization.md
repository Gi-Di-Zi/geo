# 시각화 개발·운영 상세

[프로젝트 소개와 대표 사례로 돌아가기](../README.md)

기존 README의 상세 기술 기록입니다. 대표 사례의 측정값과 이번 제출 정비의 검증 범위는 [README](../README.md#validation)를 기준으로 구분합니다.

## 구성

| 경로 | 내용 |
|---|---|
| `app/pages/index.vue`, `app/utils/projects.ts` | 첫 화면(`/`): 시각화 소개·대표 예시·탐색 경로, 맨 아래 개발 중인 확장 기능. `/viz`는 시각화, `/link`는 개발 중 표시. 헤더는 프로젝트 이름들(예시 화면 안에서만 유형·확장자·단계), 오른쪽에 AI 연결 + 소개로 가는 화살표. MCP(`/mcp`)·API(`/api`)·서버 프록시(`/svc`)는 사이트에 하나로 함께 씀 |
| `app/pages/viz/index.vue` | 공간 데이터 시각화 도구 홈(`/viz`): 바로 가기 버튼, 대표 예시 3개, 노선도(수집 → 전처리 → 웹 형태 변환(파일·서버 가지) → 시각화·렌더링), 유형 카드, 확장자 선택 창 |
| `app/pages/viz/[category]/[format]/[[step]].vue` | 확장자 4단계: 수집(`/viz/유형/확장자`), 전처리(`/preprocess`), 웹 형태 변환(`/convert`), 시각화·렌더링(`/view`) |
| `app/pages/viz/sources.vue` | 데이터 받는 곳: 국내·해외·개인·커뮤니티 다운로드 사이트 모음 |
| `app/pages/viz/tools`, `status`, `concepts` | 뷰어·도구, 현황, 개념 |
| `app/pages/viz/why.vue`, `app/assets/why-data.json` | 처음이라면: 왜 전처리·변환이 필요한지 장면 6개(SVG·CSS 애니메이션, 화면에 들어오면 재생). 그림 좌표는 .fgb 샘플의 한국 윤곽 + 버스정류장 원본에서 뽑은 점 |
| `app/pages/ai.vue` | AI 연결(MCP) 안내(사이트 공용, 헤더 오른쪽 버튼): 연결 주소, 클라이언트별 설정(이 화면을 연 주소 기준), 도구, 한계 (아래 "MCP") |
| `app/components/viewers/` | 웹 렌더러 4종. 결과물 종류(`OutputKind`)별 로딩 코드 |
| `shared/catalog/<유형>/<확장자>.ts` | 확장자 spec 하나 = 확장자 하나 (`_`로 시작하는 파일은 spec 만드는 도우미) |
| `shared/catalog/sources.ts`, `tools.ts`, `origins.ts`, `terms.ts` | 수급처(`scope`: 국내·해외·개인), 도구, 확장자 출신(표준/회사), 용어 |
| `shared/viewers.ts` | 웹 렌더러 4종, 엔진(`engine`: Cesium for Unreal)과 엔진이 읽는 결과물 |
| `scripts/setup.ts`, `setup.ps1` | 처음 설치·준비 ([실행 안내](../README.md#run) 참고) |
| `scripts/pipeline.ts` | 수집·전처리·변환 실행기. spec의 `run` 명령을 도구 이미지 안에서 그대로 실행하고 기록(report.json) 작성 |
| `scripts/unreal.ts`, `pipeline/unreal/GeoRender/` | 엔진 렌더러: 3D Tiles·지형 결과를 Cesium for Unreal로 그려 `unreal.png`·`unreal.json`, 실시간 보기(`stream`) |
| `scripts/check.ts` | 카탈로그·기록 검사 |
| `scripts/thumbs.ts`, `public/thumbs/` | 홈 유형 카드 그림: 확장자마다 시각화 화면을 화면 없는 Chrome으로 찍은 WebP (배경 OSM) |
| `pipeline/Dockerfile`, `pipeline/scripts/` | 로컬 도구 이미지(geo-web/tools), 단계용 보조 스크립트 |
| `pipeline/raw/` | 받은 원본 (git 제외, `npm run setup`으로 생성) |
| `public/data/` | 변환 결과·기록: `collect.json`, `<레시피>/report.json`·`unreal.json`, `status.json`, 내려받기용 `raw/`·`raw.zip` (git 제외) |
| `app/pages/viz/upload.vue`, `shared/sniff.ts`, `app/components/JobProgress.vue` | 내 파일 업로드 화면(파일 → 형식 → 방식·도구 → 변환), 형식 판별, 변환 진행 화면 (아래 "내 파일 업로드") |
| `shared/catalog/delivery.ts` | 방식(파일·서버·엔진) 고르기 안내, 도구별 고르는 기준·장단점, 결과 내려받기 규칙 |
| `server/api/` | 업로드 작업(`/api/jobs` → `pipeline.ts --job`, 결과 파일·내려받기), 맡기기·판별(`/api/stage`) |
| `server/routes/mcp.ts`, `server/assets/mcp-app.html`, `server/utils/` | MCP 서버(`/mcp`)와 대화 안 화면, 작업·맡긴 파일·형식 설명·엔진 실시간 보기 (아래 "MCP") |
| `compose.yaml`, `pipeline/martin.yaml` | 서비스 레시피용 상시 서버: PostGIS, GeoServer(+ OGC API Features 정식 확장, 컨테이너를 만들 때 내려받음 → 인터넷 필요), martin. 사이트가 `/svc/<서버>/**`로 프록시 |

## 실행

```sh
npm run pipeline -- <유형>/<확장자> [--recollect] [--missing]   # 수집(--recollect 시 다시 받기) + 모든 레시피 (--missing: 최신 성공 기록은 건너뜀)
npm run pipeline -- <유형>/<확장자>/<레시피>        # 레시피 하나만
npm run pipeline -- all                       # 전부 (하나 실패하면 멈춤 — 끝까지는 npm run setup -- data)
npm run pipeline -- --status                  # status.json만 다시 쓰기
npm run unreal -- setup                       # 엔진: 플러그인 받기 + 빌드
npm run unreal -- <유형>/<확장자>[/<레시피>] | all [--missing]   # 엔진 렌더링 (--missing: 성공 기록은 건너뜀)
npm run unreal -- stream <유형>/<확장자>[/<레시피>]   # 엔진 실시간 보기 (Pixel Streaming, Ctrl+C로 종료)
npm run unreal -- stream --job .data/jobs/<작업 id>   # 업로드 작업 결과 실시간 보기 (보통 MCP geo_engine이 띄움)
npm run check                                 # 검사
npm run thumbs [-- <유형>/<확장자> …]          # 홈 카드 그림 다시 찍기 (개발 서버가 떠 있을 때, Chrome 필요)
npm run services                              # 서버 띄우기 (서비스 레시피 실행 시 pipeline이 자동으로도 띄움)
```

- `local:tools` 이미지는 처음 쓸 때 자동 빌드, 나머지는 공개 이미지(`shared/catalog/tools.ts`의 `image`, 버전 고정).
- 레시피 두 종류: **파일**(결과를 파일로 구워 `public/data`에 둠)과 **서버**(변환 단계에 `type: 'server'` 도구. 벡터는 상시 PostGIS에 적재, 래스터는 `pipeline/serve`(단계·GeoServer 모두 `/serve`)에 COG로 두고 서버에 발행. 결과물 경로는 `/svc/<서버 id>/…`). 서버 레시피는 `shared/catalog/_server.ts`의 `serverRecipes`(벡터: GeoServer + martin)·`geoserverRaster`로 만든다. 서버 레이어 이름(DB 표 이름)은 확장자끼리 겹치면 안 됨(검사). 서버 화면은 `npm run services` + 개발 서버가 함께 떠 있어야 보임.
- 정확도·측정 기록:
  - 벡터타일 레시피 끝에 `tileCount`(`shared/catalog/vector-2d/_vector.ts`) 단계 — 줌별로 타일에 남은 피처 수를 변환 전과 비교. `key` = 피처를 가르는 속성(식). 변환 전 수를 못 읽으면 단계 실패.
  - `report.json`의 `env`: CPU, Docker 자원(코어·메모리), OS. 서버 출력은 `ms`(첫 요청)와 `cachedMs`(같은 요청 다시).
  - 처리 수준(직접 처리 / 변환 후 처리 / 일부 기능만 / 미검증 / 미지원): 웹 렌더러는 `supportOf`(`app/utils/catalog.ts`)가 레시피·실행 기록에서 계산. 엔진은 `unreal.json`이 있으면 "엔진 확인", 없으면 "미확인".
- 서버 포트는 127.0.0.1에만 열림. GeoServer는 작업공간 `geo` 아래(WMS·WFS·WMTS·OGC API Features `/geo/ogc/features/v1`)만 프록시, 관리 화면·REST는 사이트로 노출 안 함. 업로드 레시피는 DB 도구(임시 PostGIS 컨테이너) 사용 불가.
- `shared/catalog`에 파일을 추가·삭제하면 개발 서버가 스스로 다시 시작해 확장자 목록을 새로 만듦 (앱 `#build/catalog-formats`, 서버 `#catalog-formats`).

## 엔진 렌더러 (Cesium for Unreal)

- 스크린샷: 3D Tiles·quantized-mesh 지형 결과가 있는 레시피마다 언리얼을 `-game`(에디터 실행 파일, 패키징 없음)으로 띄워 `file:///` 주소로 결과를 읽고, 타일 로드 100% + 셰이더 컴파일 끝 → 스크린샷 → 기록 → 종료.
- 실시간 보기(`npm run unreal -- stream <유형>/<확장자>`): Pixel Streaming 2. 언리얼을 창 없이 대화형(`-Shot` 없음 → 조작 폰, 마우스 시점·WASD·QE 이동)으로 띄우고, 화면을 영상(WebRTC)으로 브라우저에 보냄. 플러그인은 이때만 명령줄(`-EnablePlugins=PixelStreaming2`)로 켬 → 스크린샷 렌더링은 그대로.
  - 시그널링 서버·웹 플레이어: Epic `PixelStreamingInfrastructure` 릴리스(`UE5.8-0.1.0`)를 `pipeline/unreal/PixelStreaming`에 받아 빌드 (`setup` 또는 첫 `stream` 때, git 제외). 웹 `http://localhost:8700`, 언리얼 연결 `127.0.0.1:8888`, 상태 API `/api/streamers`·`/api/players` (`--rest_api`).
  - 사이트: 시각화·렌더링 → Cesium for Unreal 카드 → 서버가 떠 있으면 "실시간 보기" (뷰어 자리에 플레이어 iframe, 스트리머 ID = `<유형>/<확장자>/<레시피>`). 사이트 업로드 화면에는 없음.
  - 업로드 결과(MCP `geo_engine`, `server/utils/engine.ts`): `stream --job <작업 폴더>`를 서버가 띄움. 스트리머 ID `job-<작업 id 앞 8자>`, 한 번에 하나(다른 작업을 띄우면 앞의 것을 끔), 플레이어가 `ENGINE_IDLE_MIN`(10)분 동안 하나도 없으면 스스로 종료. 기록 `.data/jobs/<id>/engine.log`.
  - 같은 PC·내부망용 (STUN/TURN 없음). 보는 동안 언리얼이 계속 GPU를 씀. 사이트가 HTTPS면 HTTP 플레이어 iframe은 막힘.
- 프로젝트(`pipeline/unreal/GeoRender`)는 텍스트 파일만: `.uproject`, 설정, C++ 게임 모드(`GeoRenderGameMode`). 지도 에셋 없이 엔진 기본 빈 지도로 시작해 Cesium 원점·타일셋·조명·카메라를 코드로 배치. 카메라는 웹 시점(중심·줌·기울기·방위)에서 계산.
- 플러그인은 GitHub 릴리스의 엔진 버전별 빌드본(`CesiumForUnreal-<버전>-v2.30.0.zip`)을 `Plugins/`에 풀어 씀. 빌드 결과·플러그인·캐시는 git 제외 → `npm run unreal -- setup`으로 다시 만든다.
- 첫 렌더링은 Cesium 재질 셰이더 컴파일로 수 분 걸림(이후 캐시). 저사양 GPU 기준으로 Lumen·가상 그림자 맵 끔(`Config/DefaultEngine.ini`).

## 샘플 기준

- **순서: 국내 공공 → 해외 → 기타.** 국내 기관이 그 형식 그대로 배포하는 원본이 우선. 없으면 해외 기관·플랫폼 원본(spec `noDomestic`에 국내 원본을 못 쓴 이유). 그것도 없으면 기타: 다른 형식 원본을 바꾼 샘플(`collect.converted`)이나 개인·커뮤니티 자료.
- **그 형식 그대로.** 같은 형식 안에서 범위 자르기·점 솎기는 허용(`collect.derived`). 변환 샘플은 기타로만.
- **자동 수집 가능.** 로그인·신청서 없이 스크립트로 다운로드.
- **재배포 허용.** 이용허락범위 제한 없음, 공공누리 1유형, CC BY 등. 공공누리 3·4유형, VWorld 데이터, AI Hub, GADM은 제외.
- 어디에도 없으면 spec에 `closed: '이유'` → 화면 "샘플 없음", 파이프라인 건너뜀.

## 현재 샘플

| 분류 | 확장자 | 원본 |
|---|---|---|
| 국내 | 2D `.shp` | 서울시 상권분석서비스 영역 (서울 열린데이터광장 OA-15560) |
| 국내 | 2D `.geojson` | 소상공인시장진흥공단 회식상권 (공공데이터포털 15167536) |
| 국내 | 2D `.gpkg` | 한국산업인력공단 국가기술자격 시험장 (공공데이터포털 15150897) |
| 국내 | 2.5D `.shp` | 경기도 과천시 새주소건물 (공공데이터포털 15146680) |
| 국내 | 래스터 `.tif` | 산림청 산사태위험지도 제주시 (공공데이터포털 15074817) |
| 국내 | 지형 `.tif` | 국립공원공단 북한산 DEM (공공데이터포털 15003715) |
| 국내 | 점군 `.las` | 국립공원공단 치악산 둘레길 실측 (공공데이터포털 15095240) |
| 국내 | 속성 `.csv` | 국토교통부 전국 버스정류장 위치정보 (공공데이터포털 15067528) |
| 해외 | 2D `.fgb` | FlatGeobuf 테스트 데이터 세계 국가 경계 |
| 해외 | 2D `.gml` | PDOK 네덜란드 주 경계 WFS (GML 3.2) |
| 해외 | 2D `.mvt` | VersaTiles OSM 벡터타일, 서울시청 일대 |
| 해외 | 2D `.pmtiles` | Protomaps 배경지도 빌드 2026-08-11, 서울시청 일대 추출 |
| 해외 | 2.5D `.geojson` | DataSF 샌프란시스코 건물 바닥면·높이 |
| 해외 | 래스터 COG | Sentinel-2 L2A 트루컬러, 서울 중심부 (Copernicus) |
| 해외 | 래스터 `.jpg` `.png` | 함부르크 정사영상 DOP20, 지형도 DTK50 (월드파일 포함) |
| 해외 | 지형 `.img` | USGS NED 1/9 arc-second, 금문교 일대 |
| 해외 | 지형 `.terrain` | swisstopo quantized-mesh, 마터호른 일대 |
| 해외 | 점군 `.laz` `.pnts` | USGS 3DEP 샌프란시스코, G空間情報センター 야마나시 MMS 3D Tiles |
| 해외 | 3D CityGML `.glb` `.gltf` `.i3dm` | PLATEAU 도쿄역 일대, Khronos Lantern, swisstopo 3D 식생 |
| 해외 | BIM `.ifc` | buildingSMART Certification-datasets |
| 기타 | 래스터 `.webp` | 국내 산사태위험지도 GeoTIFF → 무손실 WebP + 월드파일 (좌표 붙은 WebP 배포처 없음) |

## 확장자 추가·바꾸기

1. `shared/catalog/<유형>/<확장자>.ts`: `collect`(출처·수집 단계), `recipes`(전처리·변환 단계, 출력, 뷰어별 사용), `upload`, `view`. 국내 원본이 아니면 `noDomestic`에 이유, 변환 샘플이면 `collect.converted`.
2. 수급처가 새로우면 `sources.ts`에 추가 (`scope`: `domestic`·`abroad`·`personal`). 다른 경로는 spec의 `otherSources`에 데이터셋과 함께 → 수집 단계 "데이터 받는 곳"과 `/viz/sources`에 나옴.
3. 새 확장자면 `origins.ts`에 출신(표준/회사) 추가.
4. `npm run pipeline -- <유형>/<확장자> --recollect` (3D Tiles·지형 결과가 있으면 `npm run unreal -- <유형>/<확장자>`도)
5. `npm run check`

설명 문구: 단어로 끝내기(~요·~니다 금지), 필요한 말만. 단계 `why`는 옵션별 로직(`옵션: 효과`), 검사 단계 제목은 `무결성 확인`.

## 내 파일 업로드

흐름: 홈(또는 수집 단계)의 "파일 올리러 가기" → `/viz/upload`(`app/pages/viz/upload.vue`) ① 파일 넣기·형식 판별(`shared/sniff.ts`, 브라우저에서 파일 조각만 읽음) ② 형식 고르기(후보가 여럿이면 설명과 함께) ③ 방식·도구 고르기(`DeliveryGuide`, 샘플과 같은 설명) ④ 좌표계(필요할 때)·변환 시작 → `/api/jobs` → `pipeline.ts --job`(고른 업로드 레시피) → 진행 화면(`JobProgress`, 1초마다 `live.log` 끝부분) → 지도.

- 방식·도구: spec의 `upload.recipes` (첫 번째가 기본값). id는 같은 일을 하는 샘플 레시피 id와 같아 `delivery.ts` 설명을 같이 씀 (검사가 확인).

  | 유형 | 파일 방식 | 서버 방식 |
  |---|---|---|
  | 2D 벡터·CSV | GDAL(GeoJSON + MVT), tippecanoe(GeoJSON + PMTiles) | GeoServer(WMS·WMTS·WFS·OGC API Features), martin(MVT) |
  | 2.5D 벡터 | GDAL(돌출 GeoJSON), mago(3D Tiles) | GeoServer, martin |
  | 영상 tif·COG / jpg·png·webp | GDAL(COG + XYZ) / GDAL(한 장), XYZ 타일 | GeoServer |
  | DEM | GDAL + mago(Terrain-RGB + quantized-mesh) | GeoServer(회색 음영기복) |
  | 점군 las·laz | mago, py3dtiles | — |
  | glb·gltf / IFC | 3d-tiles-tools, mago / IfcConvert, mago(IFC2x3만, IFC4면 확인 단계에서 중단) | — |
  | CityGML, pnts·i3dm·terrain 묶음, PMTiles | 하나씩 (mago, 그대로 올리기, go-pmtiles + GDAL) | — |

  업로드에 없는 샘플 레시피: DB를 따로 띄우는 것(PostGIS 파일 방식·pg2b3dm·3DCityDB — 임시 DB 컨테이너 이름이 하나라 작업끼리 충돌), 샘플 전용 분석(GeoPandas·rio-cogeo·cjio·i3dm 1.1 올리기).
- 서버 방식: 레이어 이름 자리(`UPLOAD_LAYER` = `up_job`)를 작업마다 `up_<작업 id 앞 8자>`로 바꿔 돌림 → 작업끼리 겹치지 않음. 단계 컨테이너만 서버 네트워크(`geo-svc`)에 붙음(파일 방식은 네트워크 차단). 서버가 꺼져 있으면 파이프라인이 띄움. 범위는 전처리가 남긴 `bounds.json` → 확인 요청·처음 시점. 24시간 지난 작업을 지울 때 `pipeline.ts --drop`이 DB 표·GeoServer 레이어·`pipeline/serve/upload`의 COG도 지움.

- 판별: 확장자 → 후보, 겹치면 내용으로. `.tif` 밴드·비트(DEM)·타일+축소판(COG)·좌표 태그, `.geojson`·SHP 면 + 높이 열(2.5D), `.gml` CityGML 이름공간, `.zip` 목차(SHP·타일셋·glTF·영상+월드파일), `.csv` 좌표 열·값, `.pmtiles` 타일 종류, 머리글(확장자만 바뀐 파일).
- 좌표계 선택: 파일에 좌표계가 없을 때(SHP `.prj` 없음, 미터 값 CSV, `crs` 없는 미터 좌표 GeoJSON, 월드파일만 있는 그림, GeoKey 없는 GeoTIFF). 고른 값은 작업의 `srs` → 단계 컨테이너 `SRS` 환경 변수 → 벡터 `-s_srs`(`SRC_SRS`), 영상 `to_rgb.py`.
- SHP: `shp_unpack.py`가 zip 안 어느 폴더든 가장 큰 `.shp` 한 벌을 `data.*`로 꺼냄. `.cpg` 없으면 `.dbf` 내용으로 UTF-8/CP949 결정.
- 벡터 공통 `무결성 확인 (도형 수·좌표 범위)`(`check_extent.py`): 도형 0건·좌표가 모두 위경도 범위 밖이면 그 자리에서 중단(이유 표시), 일부만 밖이면 제외. PMTiles 최대 줌 하한도 범위 폭으로 정함.
- 제한: 200MB, 한 번에 한 작업(대기열 없음 → 429), 메모리 4GB·CPU 2, 단계당 20분, 결과 24시간 뒤 삭제.
- 테스트 파일: `.data/testdata` (README.txt에 파일별 예상 결과). 업로드 조건이 까다로운 파일은 26~33, 막혀야 하는 파일은 91~97.

### 알려진 한계

| 한계 | 원인 | 개선 방향 |
|---|---|---|
| mago로 점군 약 1,000만 점 넘으면 시간 제한에 걸림 | mago 3D Tiles 변환이 CPU 2·4GB에서 720만 점 885초, 단계당 20분 | py3dtiles 고르기 (치악산 67만 점: mago 90초, py3dtiles 18초). 그 이상은 점 솎기 |
| 업로드한 3D Tiles가 너무 멀리서 열림 (예: 스위스 식생 i3dm → 유럽 전체) | 시점을 최상위 범위로 잡음, 높이 미반영 | 콘텐츠 있는 자식 범위 + region 높이로 시점 |
| b3dm·glb 3D Tiles 업로드 불가 | 받는 형식이 pnts·i3dm 타일셋뿐 (판별에서 막음) | 3D Tiles 일반 업로드 레시피 |
| IFC·glb·glTF는 항상 서울시청·서울광장 배치 | IFC의 IfcSite 위경도 미사용, glTF는 위치 정보 없음 | IfcSite 읽기, 위치 입력 칸 |
| 2.5D 업로드 결과는 GeoJSON 하나 | 업로드 레시피에 3D Tiles 없음 → 수십만 동이면 브라우저 부담 | 큰 파일은 mago 3D Tiles |
| 좌표가 `.tfw` 등 별도 파일에만 있는 GeoTIFF는 서울시청 앞 배치 | tif는 파일 하나만 받음 (판별에서 주의 표시) | tif + 월드파일 zip 받기 |
| 8비트 아닌 영상이 어둡거나 하얗게 | `to_rgb.py`가 최소~최대값을 그대로 0~255로 → 이상값에 끌려감 | 2~98% 백분위 맞춤 |
| 큰 jpg·png·webp를 "한 장"으로 올리면 일부 뷰어에서 안 보일 수 있음 | 결과가 그림 한 장 → GPU 텍스처 한도(보통 8192·16384px) | "XYZ 타일" 도구 고르기 |
| 서버 방식 업로드가 남긴 표·레이어가 남을 수 있음 | 지우기는 24시간 지난 작업을 다음 업로드 때 정리하며 실행, 그때 서버가 꺼져 있으면 실패(이름은 다시 안 쓰므로 충돌 없음) | 서버 기동 때 `up_` 표·레이어 일괄 정리 |
| martin 서버 방식은 업로드마다 martin 재시작 | martin 1.16은 시작할 때만 표 탐색 → 재시작 동안 다른 MVT 요청 잠깐 실패 | 함수 소스나 새 버전의 재탐색 |
| 서버 방식 업로드의 DEM은 회색 음영만 | 올린 파일의 높이 범위를 몰라 고도 색 구간(ColorMap) 미지정 | 무결성 확인의 최저·최고 높이로 SLD 생성 |
| 큰 벡터는 작업이 죽을 수 있음 | 결과 GeoJSON을 통째로 `JSON.parse`(출력 검사·시점) → 수백 MB면 메모리·문자열 한도(약 512MB). CesiumJS도 통째로 읽음 | 범위·개수는 OGR로, Cesium용 GeoJSON 크기 상한 |
| 산지 DEM 가장자리 절벽 | NoData·범위 밖을 0m로 채움 | 가장자리 값으로 채우기 |
| 좌표계 자동 추정 없음 | 국내 미터 좌표계끼리 값 범위가 겹침(원점 북 500·600km 등) → 사용자가 고름. 틀리면 엉뚱한 곳(위경도 범위 밖이면 중단) | 고른 좌표계로 변환한 중심점을 판별 화면에 미리 표시 |
| 좌표계 없는 DEM 실패 | 좌표계 선택은 벡터·영상만 지원 | DEM 레시피에도 `SRS` |
| SHP 여러 벌이면 가장 큰 1벌만 | 레이어마다 도형·속성이 달라 합치지 않음 (판별에서 주의 표시) | 벌 고르기 |
| 래스터 PMTiles·카탈로그 밖 형식(KML/KMZ·DXF·GPX·MBTiles·ASC·OBJ/FBX·E57 …) 거절 | 업로드 레시피 없음 | 형식 추가 |

## MCP (AI 연결)

AI(Claude 등)가 공간 데이터 파일을 받아 판별 → 형식·방식 고르기 → 변환 → 결과 주소까지 처리. 사이트 서버의 `/mcp`(Streamable HTTP, 요청마다 새 서버 = 상태 없음, `server/routes/mcp.ts`).

| 도구 | 하는 일 |
|---|---|
| `geo_identify` | 파일을 맡기고 판별. `url`(서버가 받음) 또는 `path`(이 PC 파일, 로컬 연결만), `stage`(맡긴 파일·이전 작업 id → 선택지 다시). 셋 다 없으면 대화 안에 업로드 화면 |
| `geo_convert` | 맡긴 파일(`stage`)을 고른 형식·방식으로 변환 시작 → 작업 id (도구 호출 시간 제한 때문에 바로 돌려줌). `stage`에 이전 작업 id를 주면 그 작업의 원본으로 다시 변환 |
| `geo_status` | 진행·실패 이유, 끝나면 지도 화면·결과 파일(지도용 주소 + 내려받기)·서비스 주소 |
| `geo_engine` | 3D Tiles·지형 결과를 이 PC의 언리얼(Cesium for Unreal)로 띄우고 Pixel Streaming 플레이어 주소 (`stop`: 끄기). 이 PC·사내망 브라우저에서만, 첫 실행은 셰이더 컴파일로 수 분 |
| `geo_formats` | 받는 형식 전체와 형식별 방식·도구 |
| `geo_stage_chunk` | 업로드 화면 전용 (모델에게 안 보임): 조각 올리기 |

- 대화 안 화면 (MCP App, `server/assets/mcp-app.html`, `ui://geo/app.html`): 업로드 → 형식·방식·도구 카드(설명·장단점은 업로드 화면과 같은 데이터, `server/utils/catalog.ts`) → 진행 → 결과 지도(사이트 화면 `?embed=1`) + 출력마다 내려받기·주소 복사 버튼, 3D Tiles·지형이면 언리얼 실시간 보기 카드, "다른 방식으로 다시"(같은 파일, 좌표계 이어받음)·"다른 파일 올리기". 고른 내용·결과는 `updateModelContext`로 모델에게 전달.
  - MCP Apps SDK(`app-with-deps.js`)는 서버가 HTML 안에 통째로 넣음 (nuxt.config `serverAssets` `mcp-sdk`, 설치된 판 그대로) → 외부 스크립트 없음.
- 파일 받는 길:
  - URL: http·https만, 내부망·이 PC 주소 차단, 리다이렉트마다 다시 확인, 200MB (`server/utils/stage.ts`)
  - path: 개발 서버(또는 `MCP_LOCAL_PATHS=1`)이고 요청 주소가 localhost일 때만
  - 업로드 화면: `/api/stage`로 바로(CORS·`Access-Control-Allow-Private-Network`), 막히면 `geo_stage_chunk` 도구로 512KB씩
- 결과:
  - 내려받기 `/api/jobs/<작업>/download/<출력 id>`: 파일 하나는 그대로(`attachment`, GeoJSON은 `.geojson`), 타일 `{z}/{x}/{y}`·3D Tiles·지형은 폴더째 zip으로 흘려 보냄(archiver, ZIP64). 규칙은 `shared/catalog/delivery.ts`의 `downloadOf`
  - 결과 파일은 운영자가 정리할 때까지 보관(기간 보장 없음). 서비스(GeoServer·martin 레이어, DB 표)는 발행 완료 후 48시간 → `/svc` 요청마다 만료 검사(410), 정리 작업이 레이어·표 삭제. 결과 화면과 `geo_status` 글에 만료 시각 표시
  - 엔진 실시간 보기(`geo_engine`): 위 "엔진 렌더러"
- 연결 (사이트 `/ai`에 같은 안내, 헤더 오른쪽 "AI 연결", 주소는 그 화면을 연 주소 기준). 터미널 = 같은 PC에서 지금, 글만 / 웹 = 공개 https 배포 후, 대화 안 화면. 직접 확인: Claude Desktop(대화 안 화면)·Claude Code, 나머지 미검증
  - Claude Code: `claude mcp add --transport http geo-web-bridge http://localhost:3000/mcp`
  - Codex CLI: `codex mcp add geo-web-bridge --url http://localhost:3000/mcp` (`~/.codex/config.toml`의 `[mcp_servers.geo-web-bridge]`)
  - claude.ai: Customize > Connectors > Add custom connector, Authentication "No sign in". Anthropic 클라우드에서 접속
  - ChatGPT: chatgpt.com/plugins > Add custom MCP server (공개 https, 또는 Secure MCP Tunnel)
  - Claude Desktop (확인용): `claude_desktop_config.json`에 `{ "mcpServers": { "geo-web-bridge": { "command": "cmd", "args": ["/c", "npx", "-y", "mcp-remote@0.15.2", "http://localhost:3000/mcp"] } } }` → 트레이에서 완전히 종료 후 다시 시작. Windows는 `npx`가 `.cmd`라 `cmd /c`
- Claude Desktop 대화 화면 규칙 (로그 `%LOCALAPPDATA%\Claude\Logs\claude.ai-web.log`로 확인):
  - frame(결과 지도)·링크 열기는 https 공개 주소만 (`http://localhost`, IP, 점 없는 이름, `.internal` 같은 내부망 이름 거절) → localhost에서는 지도 자리에 안내, 링크 버튼은 주소 복사로 대신
  - 서버로 바로 올리기·받기(connect)는 `http://localhost`도 됨 → 내려받기는 화면이 받아 호스트의 `downloadFile`로 넘김 (100MB 넘으면 호스트가 직접 받게)
- 환경 변수 (`.env.example`): `PUBLIC_URL`(결과 주소에 쓰는 바깥 주소, 터널·프록시 뒤 — https 공개 주소면 대화 안 지도도 뜸), `MCP_LOCAL_PATHS`, `ENGINE_IDLE_MIN`.
- 한계: 인증 없음(같은 PC 전제 → 외부 공개 전 필수). 한 번에 한 작업. localhost에서는 대화 안 지도 없음.

## 검사 (`npm run check`)

- 카탈로그: 유형·수급처·도구·출신 존재, 뷰어가 결과물 종류 지원, 업로드 레시피가 `$INPUT`만 읽고 DB 도구 미사용, 서버 레이어 이름 겹침
- 업로드 판별: 그대로 올릴 수 있는 원본 샘플(받는 확장자)은 자기 확장자로 판별 (`shared/sniff.ts`)
- 내려받기: 모든 파일 출력이 폴더 zip 또는 확장자 있는 파일 하나로 나뉨 (`downloadOf`)
- 열린 확장자: 재배포 가능 출처, 국내 수급처가 있는데 해외·기타 샘플이면 `noDomestic` 필요, 수집 기록 = 원본 폴더, 원본 내려받기 가능
- 레시피: 기록이 지금 명령과 같음(명령을 고치면 다시 실행), 모든 단계 성공, 출력 파일 존재
- 엔진 기록(`unreal.json`)이 있으면: 성공, 스크린샷 존재 (언리얼이 없는 PC에서는 기록이 없어도 통과)
- 문자열: 백슬래시 하나(`\(` 등) 사라짐 방지, 설명 문구 말투

## 참고

- 원본 50MB 이하만 사이트에 게시, 파일 7개 이상이면 `raw.zip` 하나로.
- 중간 파일(`pipeline/work`)은 레시피가 성공하면 삭제, 실패하면 남김(원인 확인용).
- 시행착오 기록: 각 단계 `why`, 그리고 `scripts/check.ts` 주석.

## 라이선스

코드는 [MIT](../LICENSE). 샘플 원본·변환 결과는 저장소에 없음(`npm run setup`으로 받음), 각 출처 라이선스를 따름 — 확장자별 수집 단계와 `/viz/sources`.
