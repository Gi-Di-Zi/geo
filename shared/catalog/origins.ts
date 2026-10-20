// 확장자(spec id)별 출신: 표준 기구가 정한 것인지, 회사가 만든 것인지. 같은 id는 유형이 달라도 같은 포맷이다 (예: shp, tif)
export type OriginKind = 'standard' | 'vendor' | 'community'

export const originLabels: Record<OriginKind, string> = { standard: '표준', vendor: '회사 사양', community: '커뮤니티 사양' }

export const origins: Record<string, { kind: OriginKind; by: string; note: string }> = {
  shp: { kind: 'vendor', by: 'Esri', note: '1990년대 초 ArcView용 자체 포맷. 1998년 기술 문서 공개 후 사실상 표준.' },
  geojson: { kind: 'standard', by: 'IETF RFC 7946', note: '2008년 커뮤니티 사양으로 시작, 2016년 IETF 표준.' },
  gml: { kind: 'standard', by: 'OGC · ISO 19136', note: 'OGC의 XML 지리 데이터 언어. ISO 국제 표준.' },
  gpkg: { kind: 'standard', by: 'OGC', note: '2014년 OGC 표준. SHP를 대신할 파일 포맷.' },
  fgb: { kind: 'community', by: 'FlatGeobuf 오픈소스 프로젝트', note: 'Björn Harrtell이 시작한 공개 사양. 표준 기구 승인 없음, GDAL·QGIS 기본 지원.' },
  mvt: { kind: 'vendor', by: 'Mapbox', note: 'Mapbox가 공개한 사양. 공식 표준은 아니지만 벡터타일의 사실상 표준.' },
  pmtiles: { kind: 'vendor', by: 'Protomaps', note: 'Protomaps(Brandon Liu)의 공개 사양. 표준 기구 승인 없음.' },
  tif: { kind: 'standard', by: 'OGC GeoTIFF 1.1', note: 'TIFF는 Aldus(현 Adobe), 좌표 태그는 NASA JPL 커뮤니티 사양(1995). 2019년 OGC 표준.' },
  cog: { kind: 'standard', by: 'OGC', note: 'GDAL·Planet 등이 쓰던 관례를 2023년 OGC가 표준으로 승인.' },
  jpg: { kind: 'standard', by: 'ISO/IEC 10918', note: 'JPEG 위원회의 국제 표준.' },
  png: { kind: 'standard', by: 'W3C · ISO/IEC 15948', note: 'GIF 특허를 피하려 만든 공개 포맷. W3C 권고안이자 ISO 표준.' },
  webp: { kind: 'vendor', by: 'Google', note: '2010년 Google 개발. 2024년 IETF RFC 9649로 문서화(정보 제공용).' },
  img: { kind: 'vendor', by: 'ERDAS (현 Hexagon)', note: '원격탐사 프로그램 ERDAS IMAGINE의 자체 형식.' },
  terrain: { kind: 'vendor', by: 'Cesium', note: 'Cesium이 공개한 지형 타일 사양. 표준 기구 승인 없음.' },
  las: { kind: 'standard', by: 'ASPRS', note: '미국 사진측량·원격탐사학회 표준. LAS 1.4는 OGC 커뮤니티 표준.' },
  laz: { kind: 'vendor', by: 'rapidlasso', note: 'rapidlasso(Martin Isenburg)의 LAS 압축 형식. 오픈소스(LASzip)라 사실상 표준.' },
  pnts: { kind: 'standard', by: 'OGC 커뮤니티 표준 (3D Tiles)', note: 'Cesium이 만든 3D Tiles 1.0의 점군 타일. 1.1부터 glTF로 대체.' },
  citygml: { kind: 'standard', by: 'OGC', note: 'OGC 표준. 일본 PLATEAU 등 국가 3D 도시모델이 이 형식.' },
  glb: { kind: 'standard', by: 'Khronos Group · ISO/IEC 12113', note: 'OpenGL을 만든 Khronos Group의 표준. glTF를 파일 하나로 묶은 형태.' },
  gltf: { kind: 'standard', by: 'Khronos Group · ISO/IEC 12113', note: 'OpenGL을 만든 Khronos Group의 표준.' },
  i3dm: { kind: 'standard', by: 'OGC 커뮤니티 표준 (3D Tiles)', note: 'Cesium이 만든 3D Tiles 1.0의 인스턴스 타일. 1.1부터 glTF 확장으로 대체.' },
  ifc: { kind: 'standard', by: 'buildingSMART · ISO 16739', note: '건설 업계 단체 buildingSMART International의 BIM 표준.' },
  csv: { kind: 'community', by: 'IETF RFC 4180 (정보 문서)', note: '1970년대부터 쓰던 관례를 2005년 RFC 4180으로 정리. 정식 표준 아님 → 구분자·인코딩·좌표 열 이름이 데이터마다 다름.' },
}
