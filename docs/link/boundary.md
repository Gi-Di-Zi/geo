# 법정구역 경계 SHP 출력

경계는 출력에서만 선택한다. PNU·주소·행정동·위치 입력은 기존 공통 변환에서 **법정구역 코드가 확정된 뒤** 그 코드로 조회한다. 복수 후보는 먼저 선택해야 한다. 법정구역 경계는 개별 필지 경계나 주민센터 관할 행정동 경계와 다르다.

## 구현 범위

`POST /api/link/boundary`에 `{ "codes": ["1111010100"], "crs": "EPSG:4326" }`를 보내면 ZIP을 반환한다. 서버 내부 함수는 `exportLegalBoundary(codes, crs?, referenceSnapshot?)`이며 마지막 인자는 작업의 기준 버전 고정과 테스트 fixture 주입에 사용한다. HTTP 요청은 임의 사전·파일 경로·원격 URL을 받지 않는다.

현재 출력 좌표계는 EPSG:4326 경도·위도다. ZIP에는 `.shp`, `.shx`, `.dbf`, `.prj`, `.cpg`, `metadata.json`이 들어간다. DBF의 `legal_cd`·`area_code`·`source_id`는 문자 필드로 기록한다. 한글 명칭은 UTF-8 JSON에 보존한다. Polygon·MultiPolygon의 외곽과 구멍을 SHP 링 방향에 맞춰 보존한다.

| 등록 법정구역 단계 | 원천 레이어 | 원천 코드 속성 |
| --- | --- | --- |
| 시도 | `LT_C_ADSIDO_INFO` | `ctprvn_cd` 2자리 |
| 시군구 | `LT_C_ADSIGG_INFO` | `sig_cd` 5자리 |
| 읍면동 | `LT_C_ADEMD_INFO` | `emd_cd` 8자리 |
| 리 | `LT_C_ADRI_INFO` | `li_cd` 10자리 |

법정구역 사전의 활성 코드와 계층을 먼저 확인한다. 등록된 10자리 읍면동 전체 코드는 읍면동 레이어의 8자리 코드로 조회한다. 뒤의 `00`을 리로 취급하지 않는다. 2·5·8자리 입력도 해당 단계의 등록 코드가 있어야 하며, 0을 덧붙였다는 이유만으로 공식 코드로 인정하지 않는다. 폐지 코드와 미등록 코드를 구분한다.

## 원천과 현재 확보 상태

공식 원천은 [VWorld 2D 데이터 읍면동 안내](https://www.vworld.kr/dev/v4dv_2ddataguide2_s002.do?svcIde=ademd)와 [VWorld 공식 API 샘플 저장소](https://github.com/V-world/V-world_API_sample)다. 2026-10-30 공식 안내 HTTP 200 및 `emd_cd` 속성·도메인 전달 요건을 확인했다. 소스는 고정된 `https://api.vworld.kr/req/data`의 `GetFeature`만 호출한다. WFS SHAPE-ZIP은 기존 키로 권한이 확인되지 않아 의존하지 않는다.

**2026-11-02 실제 조회 확인:** 이전의 `INCORRECT_KEY`는 키 권한이 아니라 `domain` 값 불일치였다. 현재 키는 `domain=http://localhost`일 때 정상 응답하고, `domain`이 없거나 `http://localhost:3000`이면 `INCORRECT_KEY`다. `VWORLD_DOMAIN=http://localhost`로 읍면동(청운동 1111010100)·시군구(종로구 11110)·리(여수시 돌산읍 군내리 1213025021) 경계 SHP ZIP을 실제로 만들었다. 키를 다른 URL로 다시 등록하면 그 URL을 글자 그대로 넣는다.

서버 환경변수 `VWORLD_KEY`(기존 `NUXT_PUBLIC_VWORLD_KEY` 대체 읽기 지원)와 키에 등록한 서비스 URL `VWORLD_DOMAIN`을 설정해야 한다. `PUBLIC_URL`도 기존 서버 URL 설정으로 읽는다. 새 서버 키는 공개 접두어가 없는 `VWORLD_KEY`에 둔다. 데이터 API 사용 권한·일일 호출량·서비스 URL은 VWorld 신청 설정에서 확인한다. 키·요청 URL·원천 오류 본문은 응답·로그·ZIP에 남기지 않는다.

`boundaryCapabilities()`는 설정 존재(`configured`)와 실제 조회 상태(`sourceAccess`)를 구분한다. 조회 전은 `not_checked`, 성공은 `available`, 인증 거절은 `source_unavailable`이며 미설정은 `setup_required`다. 조회 정상 미일치는 `BOUNDARY_NO_MATCH`, 원천 미설정은 `BOUNDARY_SETUP_REQUIRED`, 통신 장애는 `BOUNDARY_SOURCE_UNAVAILABLE`다.

원천이 자료 기준일을 제공하지 않아 `sourceDate: null`로 보존한다. ZIP의 `checkedAt`은 실제 조회·출력 확인 시각이며 자료 유효일을 뜻하지 않는다. 지역 명칭은 작업 시작 시 고정한 법정구역 사전의 버전과 확보 범위를 함께 기록한다. 경계 데이터의 재배포·상용 이용 조건은 해당 VWorld 데이터의 이용약관·저작권정책을 별도로 확인해야 하며 이 구현으로 이용권을 부여하지 않는다.

ZIP 파일 이름은 단계 코드 규칙을 따른다: 시도 2·시군구 5자리, 읍면동·리 10자리(예: `legal-boundary-11110.zip`, `legal-boundary-1111010100.zip`). DBF의 `area_code`는 VWorld 레이어 키(시도 2·시군구 5·읍면동 8·리 10자리)이고 `legal_cd`가 10자리 법정동코드다.

## 제한과 재현

요청당 법정코드 20개, 결과 도형 20개, 좌표점 10만 개, 원천 응답 8 MiB, ZIP 20 MiB를 한도로 둔다. 원천 요청 제한 시간은 10초이며 전체 요청은 60초가 지나면 다음 조회를 시작하지 않는다. 동시 원천 요청은 서버 프로세스당 2개이며, 같은 코드·설정의 동시 조회와 5분 내 재조회는 합친다. 리디렉션·사용자 지정 원격 URL·로컬 파일 경로·임의 필터는 허용하지 않는다. 부분 결과나 다른 코드의 도형을 완전한 경계처럼 출력하지 않는다.

```sh
node --test tests/link/boundary.test.ts
```

2026-10-30 Windows, Node v22.19.0 환경에서 18건을 약 0.69초에 통과했다. 이 검사는 명시적인 `coverage: fixture` 사전과 모의 원천을 사용한다. 생성된 ZIP의 중앙 디렉터리·deflate 데이터, SHP/SHX의 기록 길이·오프셋·좌표·링 방향, DBF 문자 필드를 생성기와 독립적으로 해독했다. Polygon·MultiPolygon·구멍, 코드 단계, 리 없음, 폐지·미등록, 동시 중복, 기준 버전 고정, CRS 제한, 잘못된 도형, 응답·도형·점 수 한도, 불명확한 전체 건수, 미일치·인증·통신 오류 및 키 비노출을 검증했다. 이 결과는 실원천 권한 확인이나 실제 전국 도형 검증을 대체하지 않는다.

SHP 생성에는 `@mapbox/shp-write@0.4.3`, ZIP에는 기존 `archiver@7`을 사용한다. npm 메타데이터는 BSD-2-Clause를 표시하지만 설치된 `LICENSE`와 공식 저장소는 BSD-3-Clause 문구이므로 실제 배포 시 설치 LICENSE를 기준으로 고지한다. 오래된 패키지의 직접 ZIP 함수 대신 Polygon 레코드 작성만 사용하며 위 바이너리 검증으로 다중 폴리곤·구멍 보존을 확인했다.
