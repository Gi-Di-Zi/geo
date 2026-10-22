# 공간 데이터 웹 처리

공간 데이터 유형·확장자별 웹 처리 과정 정리 사이트. 확장자마다 실제 공개 원본을 받아 수집 → 전처리 → 웹 형태 변환을 Docker로 돌리고, 결과를 시각화·렌더링 단계에서 웹 렌더러 4종(OpenLayers·MapLibre·MapLibre + Deck.gl·CesiumJS)과 엔진(Cesium for Unreal)으로 확인.

## 처음 설치 (다른 PC에서 받아 돌리기)

Windows 기준. Docker만 있으면 macOS·Linux도 데이터·사이트는 같음 (엔진 렌더러만 Windows 전용).

```powershell
git clone https://github.com/Gi-Di-Zi/geo.git; cd geo
powershell -ExecutionPolicy Bypass -File scripts/setup.ps1           # Git, Node.js LTS, Docker Desktop (winget)
powershell -ExecutionPolicy Bypass -File scripts/setup.ps1 -Unreal   # + Visual Studio 2022(C++ 게임 개발), Epic Games Launcher (엔진 렌더러용, 선택)
```

1. Docker Desktop을 한 번 실행해 WSL2 설정 마치기
2. (엔진 렌더러) Epic Games Launcher 로그인 → 언리얼 엔진 5.8 설치. 대상 플랫폼은 Windows만. Cesium for Unreal 플러그인은 3에서 GitHub 릴리스로 받음 (Fab 설치 불필요)
3. 나머지는 스크립트 하나 (프로그램이 깔려 있으면 여기부터):

```sh
npm install
npm run setup        # 점검 → .env → 서버 → 데이터 수집·변환 → 검사 → 사이트 실행(http://localhost:3000, Ctrl+C로 종료)
npm run unreal -- all --missing   # (선택) 엔진 렌더링. 언리얼을 레시피마다 띄웠다 닫아 기본 흐름에서 뺌
```

- 다시 돌려도 빠름: 받아 둔 원본은 다시 받지 않고, 기록이 지금 명령과 같은 성공 레시피는 건너뜀. 처음부터 전부 다시: `npm run setup -- data --force`.
- `npm run setup -- <단계…>`로 골라서: `doctor`(점검) `env`(.env.example → .env) `services`(PostGIS·GeoServer·martin) `data`(전 확장자 수집·변환, 하나가 실패해도 계속하고 끝에 모아 보고) `unreal`(플러그인 받기·빌드·렌더링) `check` `serve`(개발 서버). 점검·서버가 실패하면 사이트는 띄우지 않음.

- 필요: Node 22.18+ (권장 22.21+ / 24.11+), Docker, 디스크 약 20GB(이미지·원본·결과). 엔진 렌더러는 언리얼 약 60~100GB 추가, DirectX 12 GPU.
- `.env`는 모두 선택. `NUXT_PUBLIC_VWORLD_KEY` 없으면 배경지도 OSM, `GEOSERVER_ADMIN_PASSWORD` 없으면 기본값, `UE_ROOT` 없으면 `C:/Program Files/Epic Games/UE_5.8`.
- 원본 사이트가 바뀌면 그 확장자 수집이 실패할 수 있음 → `data` 단계 끝의 실패 목록을 보고 spec의 수집 명령 수정.

## 구성

| 경로 | 내용 |
|---|---|
| `app/pages/index.vue` | 홈: 노선도(수집 → 전처리 → 웹 형태 변환(파일·서버 가지) → 시각화·렌더링), 유형 카드, 확장자 선택 창 |
| `app/pages/[category]/[format]/[[step]].vue` | 확장자 4단계: 수집(`/유형/확장자`), 전처리(`/preprocess`), 웹 형태 변환(`/convert`), 시각화·렌더링(`/view`) |
| `app/pages/sources.vue` | 데이터 받는 곳: 국내·해외·개인·커뮤니티 다운로드 사이트 모음 |
| `app/pages/tools`, `status`, `concepts` | 뷰어·도구, 현황, 개념 |
| `app/components/viewers/` | 웹 렌더러 4종. 결과물 종류(`OutputKind`)별 로딩 코드 |
| `shared/catalog/<유형>/<확장자>.ts` | 확장자 spec 하나 = 확장자 하나 (`_`로 시작하는 파일은 spec 만드는 도우미) |
| `shared/catalog/sources.ts`, `tools.ts`, `origins.ts`, `terms.ts` | 수급처(`scope`: 국내·해외·개인), 도구, 확장자 출신(표준/회사), 용어 |
| `shared/viewers.ts` | 웹 렌더러 4종, 엔진(`engine`: Cesium for Unreal)과 엔진이 읽는 결과물 |
| `scripts/setup.ts`, `setup.ps1` | 처음 설치·준비 (위 참고) |
| `scripts/pipeline.ts` | 수집·전처리·변환 실행기. spec의 `run` 명령을 도구 이미지 안에서 그대로 실행하고 기록(report.json) 작성 |
| `scripts/unreal.ts`, `pipeline/unreal/GeoRender/` | 엔진 렌더러: 3D Tiles·지형 결과를 Cesium for Unreal로 그려 `unreal.png`·`unreal.json` |
| `scripts/check.ts` | 카탈로그·기록 검사 |
| `pipeline/Dockerfile`, `pipeline/scripts/` | 로컬 도구 이미지(geo-web/tools), 단계용 보조 스크립트 |
| `pipeline/raw/` | 받은 원본 (git 제외, `npm run setup`으로 생성) |
| `public/data/` | 변환 결과·기록: `collect.json`, `<레시피>/report.json`·`unreal.json`, `status.json`, 내려받기용 `raw/`·`raw.zip` (git 제외) |
| `server/` | 내 파일 업로드 작업 API (`/api/jobs` → `pipeline.ts --job`) |
| `compose.yaml`, `pipeline/martin.yaml` | 서비스 레시피용 상시 서버: PostGIS, GeoServer, martin. 사이트가 `/svc/<서버>/**`로 프록시 |

## 실행

```sh
npm run pipeline -- <유형>/<확장자> [--recollect] [--missing]   # 수집(--recollect 시 다시 받기) + 모든 레시피 (--missing: 최신 성공 기록은 건너뜀)
npm run pipeline -- <유형>/<확장자>/<레시피>        # 레시피 하나만
npm run pipeline -- all                       # 전부 (하나 실패하면 멈춤 — 끝까지는 npm run setup -- data)
npm run pipeline -- --status                  # status.json만 다시 쓰기
npm run unreal -- setup                       # 엔진: 플러그인 받기 + 빌드
npm run unreal -- <유형>/<확장자>[/<레시피>] | all [--missing]   # 엔진 렌더링 (--missing: 성공 기록은 건너뜀)
npm run check                                 # 검사
npm run services                              # 서버 띄우기 (서비스 레시피 실행 시 pipeline이 자동으로도 띄움)
```

- `local:tools` 이미지는 처음 쓸 때 자동 빌드, 나머지는 공개 이미지(`shared/catalog/tools.ts`의 `image`, 버전 고정).
- 레시피 두 종류: **파일**(결과를 파일로 구워 `public/data`에 둠)과 **서버**(변환 단계에 `type: 'server'` 도구. 벡터는 상시 PostGIS에 적재, 래스터는 `pipeline/serve`(단계·GeoServer 모두 `/serve`)에 COG로 두고 서버에 발행. 결과물 경로는 `/svc/<서버 id>/…`). 서버 레시피는 `shared/catalog/_server.ts`의 `serverRecipes`(벡터: GeoServer + martin)·`geoserverRaster`로 만든다. 서버 레이어 이름(DB 표 이름)은 확장자끼리 겹치면 안 됨(검사). 서버 화면은 `npm run services` + 개발 서버가 함께 떠 있어야 보임.
- 정확도·측정 기록:
  - 벡터타일 레시피 끝에 `tileCount`(`shared/catalog/vector-2d/_vector.ts`) 단계 — 줌별로 타일에 남은 피처 수를 변환 전과 비교. `key` = 피처를 가르는 속성(식). 변환 전 수를 못 읽으면 단계 실패.
  - `report.json`의 `env`: CPU, Docker 자원(코어·메모리), OS. 서버 출력은 `ms`(첫 요청)와 `cachedMs`(같은 요청 다시).
  - 처리 수준(직접 처리 / 변환 후 처리 / 일부 기능만 / 미검증 / 미지원): 웹 렌더러는 `supportOf`(`app/utils/catalog.ts`)가 레시피·실행 기록에서 계산. 엔진은 `unreal.json`이 있으면 "엔진 확인", 없으면 "미확인".
- 서버 포트는 127.0.0.1에만 열림. GeoServer는 작업공간 `geo` 아래(WMS·WFS·WMTS)만 프록시, 관리 화면·REST는 사이트로 노출 안 함. 업로드 레시피는 서버 도구 사용 불가.
- `shared/catalog`에 파일 추가·삭제 시 개발 서버 재시작 (확장자 목록은 빌드 템플릿 `#build/catalog-formats`).

## 엔진 렌더러 (Cesium for Unreal)

- 실시간 보기 없이 파이프라인의 렌더러로만 사용. 3D Tiles·quantized-mesh 지형 결과가 있는 레시피마다 언리얼을 `-game`(에디터 실행 파일, 패키징 없음)으로 띄워 `file:///` 주소로 결과를 읽고, 타일 로드 100% + 셰이더 컴파일 끝 → 스크린샷 → 기록 → 종료.
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
2. 수급처가 새로우면 `sources.ts`에 추가 (`scope`: `domestic`·`abroad`·`personal`). 다른 경로는 spec의 `otherSources`에 데이터셋과 함께 → 수집 단계 "데이터 받는 곳"과 `/sources`에 나옴.
3. 새 확장자면 `origins.ts`에 출신(표준/회사) 추가.
4. `npm run pipeline -- <유형>/<확장자> --recollect` (3D Tiles·지형 결과가 있으면 `npm run unreal -- <유형>/<확장자>`도)
5. `npm run check`

설명 문구: 단어로 끝내기(~요·~니다 금지), 필요한 말만. 단계 `why`는 옵션별 로직(`옵션: 효과`), 검사 단계 제목은 `무결성 확인`.

## 검사 (`npm run check`)

- 카탈로그: 유형·수급처·도구·출신 존재, 뷰어가 결과물 종류 지원, 업로드 레시피가 `$INPUT`만 읽고 DB 도구 미사용, 서버 레이어 이름 겹침
- 열린 확장자: 재배포 가능 출처, 국내 수급처가 있는데 해외·기타 샘플이면 `noDomestic` 필요, 수집 기록 = 원본 폴더, 원본 내려받기 가능
- 레시피: 기록이 지금 명령과 같음(명령을 고치면 다시 실행), 모든 단계 성공, 출력 파일 존재
- 엔진 기록(`unreal.json`)이 있으면: 성공, 스크린샷 존재 (언리얼이 없는 PC에서는 기록이 없어도 통과)
- 문자열: 백슬래시 하나(`\(` 등) 사라짐 방지, 설명 문구 말투

## 참고

- 원본 50MB 이하만 사이트에 게시, 파일 7개 이상이면 `raw.zip` 하나로.
- 중간 파일(`pipeline/work`)은 레시피가 성공하면 삭제, 실패하면 남김(원인 확인용).
- 업로드 작업: 네트워크 차단 컨테이너, 메모리 4GB·CPU 2, 단계당 20분, 결과는 24시간 뒤 삭제.
- 시행착오 기록: 각 단계 `why`, 그리고 `scripts/check.ts` 주석.
