// PNG·JPG·WebP는 "좌표 없는 그림 + 월드파일"이라 처리 흐름이 같다. 포맷별 샘플과 좌표계만 받아 spec을 만든다.
import type { FormatSpec, Step } from '../../types.ts'
import { geoserverRaster } from '../_server.ts'

type Bounds = [number, number, number, number]

interface ImageFormat {
  id: string
  name: string
  ext: string
  worldExt: string
  gdalFormat: string
  options: string
  summary: string
  description: string
  traits: string
  /** 받은 그림 파일 이름(확장자 뺀 것). /raw/<base><ext> + /raw/<base><worldExt> */
  base: string
  /** 원본 좌표계. 월드파일에는 없어서 따로 알려 줘야 한다 */
  srs: { epsg: string; label: string }
  /** 웹에 놓을 범위 [서, 남, 동, 북]. 원본 안쪽에 맞춘 위경도 사각형 */
  bounds: Bounds
  /** 내보낼 그림 가로 픽셀 수. 원본이 커서 한 장으로 쓰기 좋게 줄인다 */
  width: number
  /** 색상표(팔레트) 그림이면 펴기 전에 RGB로 펼친다 (팔레트 번호를 섞으면 엉뚱한 색이 된다) */
  palette?: boolean
  collect: FormatSpec['collect']
  otherSources: FormatSpec['otherSources']
  view: FormatSpec['view']
  noDomestic?: string
}

export function imageSpec(f: ImageFormat): FormatSpec {
  const raw = `/raw/${f.base}${f.ext}`
  const input = f.palette ? '/work/rgb.vrt' : raw
  const inspect: Step = {
    title: '무결성 확인 (월드파일)',
    why: `1줄: 픽셀 가로 크기(m), 2·3줄: 회전, 4줄: 픽셀 세로 크기(음수), 5·6줄: 왼쪽 위 픽셀 좌표. 단위 m → 원래 좌표계(${f.srs.label}) 필요.`,
    tool: 'shell',
    run: `cat /raw/${f.base}${f.worldExt}`,
  }
  const served = `/serve/raster/${f.id}/image_${f.id}.tif`
  return {
    id: f.id,
    category: 'raster',
    name: f.name,
    extensions: [f.ext, f.worldExt],
    summary: f.summary,
    description: f.description,
    anatomy: [
      { name: f.ext, role: `그림 자체. ${f.traits}` },
      { name: f.worldExt, role: '월드파일. 숫자 6줄: 픽셀 크기·왼쪽 위 좌표. 좌표계 없음' },
    ],
    convertible: true,
    collect: f.collect,
    otherSources: f.otherSources,
    recipes: [
      {
        id: 'gdal',
        title: 'GDAL',
        preprocess: [
          inspect,
          ...(f.palette ? [{
            title: '색상표 → RGB 펼치기',
            why: '-expand rgb: 색 번호(0~255) → R·G·B 세 밴드. 번호끼리 보간하면 엉뚱한 색. -of VRT: 새 파일 없이 가상 래스터.',
            tool: 'gdal',
            run: `gdal_translate -of VRT -expand rgb ${raw} /work/rgb.vrt`,
          }] : []),
          {
            title: '좌표계 지정·웹 메르카토르 재투영',
            why: `-s_srs ${f.srs.epsg}: 월드파일에 없는 좌표계 지정. -t_srs EPSG:3857: 웹 지도 격자. -te … -te_srs EPSG:4326: 위경도 사각형 범위 → 네 모서리 좌표로 배치. -ts ${f.width} 0: 가로 ${f.width}px로 축소.`,
            tool: 'gdal',
            run: `gdalwarp -s_srs ${f.srs.epsg} -t_srs EPSG:3857 -te ${f.bounds.join(' ')} -te_srs EPSG:4326 -ts ${f.width} 0 -r bilinear ${input} /work/web_3857.tif`,
          },
        ],
        convert: [
          ...(f.palette ? [{
            title: '256색 색상표 재생성',
            why: 'rgb-to-palette: 재투영으로 섞인 색 → 256색 색상표. 색 적은 지도는 RGB 대비 몇 배 작음.',
            tool: 'gdal',
            run: 'gdal raster rgb-to-palette /work/web_3857.tif /work/palette.tif',
          }] : []),
          {
            title: `${f.name} 한 장 내보내기`,
            why: `원본도 ${f.name} — EPSG:3857 재투영·축소본으로 다시 저장. 이 크기는 타일 분할 불필요: 그림 한 장 + 네 모서리 좌표로 모든 뷰어 표시.`,
            tool: 'gdal',
            run: `gdal_translate -of ${f.gdalFormat} ${f.options} /work/${f.palette ? 'palette' : 'web_3857'}.tif /out/image${f.ext}`,
          },
        ],
        outputs: [
          { id: 'image', kind: 'image', path: `image${f.ext}`, bounds: f.bounds, label: `${f.name} 한 장`, why: `원본도 ${f.name} — 웹 메르카토르 재투영·축소본. 네 모서리 위경도(${f.bounds.join(', ')})와 함께 이미지 오버레이로 사용.` },
        ],
        viewers: {
          ol: { output: 'image' },
          maplibre: { output: 'image' },
          deck: { output: 'image' },
          cesium: { output: 'image' },
        },
      },
      geoserverRaster({
        name: `image_${f.id}`,
        preprocess: [inspect],
        file: served,
        prepare: {
          title: '서버용 COG 만들기 (월드파일 + 좌표계)',
          why: `위치: 월드파일(GDAL 자동 인식). -a_srs ${f.srs.epsg}: 월드파일에 없는 좌표계 지정. -of COG: 내부 블록·축소본 → 서버가 화면 범위·축척 블록만 읽음. 재투영은 서버가 요청마다.${f.palette ? ' 색상표 그대로(축소본은 NEAREST).' : ''} GeoServer 그림+월드파일 저장소(WorldImage)는 WebP 미지원 → 세 형식 모두 GeoTIFF로.`,
          tool: 'gdal',
          run: `mkdir -p /serve/raster/${f.id} && gdal_translate -a_srs ${f.srs.epsg} -of COG -co COMPRESS=DEFLATE ${raw} ${served}`,
        },
        symbolizer: '      <Opacity>1.0</Opacity>',
        styleWhy: `그림 색 그대로${f.palette ? '(색상표)' : ''}. 서버는 요청 범위만 잘라 웹 메르카토르로 재투영.`,
        bounds: f.bounds,
        maxzoom: 18,
      }),
    ],
    alternatives: [
      { tool: 'gdal', cmd: `gdal raster tile --min-zoom 12 --max-zoom 18 web_3857.tif tiles`, note: '큰 그림: 한 장 대신 XYZ 타일 분할 (COG 페이지 참고).' },
    ],
    upload: {
      accept: [f.ext, '.zip'],
      note: `그림만: 좌표 없음 → 서울시청 앞, 1픽셀 = 1m 배치. 제자리 배치: 그림 + 월드파일(${f.worldExt}) + 좌표계(.prj) zip 하나.`,
      recipe: {
        id: 'upload',
        title: '내 파일',
        preprocess: [
          {
            title: '좌표 지정·8비트 RGB 변환',
            why: '좌표: 월드파일, 없으면 서울시청 앞 임시 좌표. 좌표계: .prj (월드파일에 없음). 밴드: 8비트 RGB로 통일.',
            tool: 'gdal',
            run: 'python3 /scripts/to_rgb.py $INPUT /work/rgb.vrt',
          },
          {
            title: '웹 메르카토르 재투영',
            why: '-t_srs EPSG:3857: 웹 지도 격자. -dstalpha: 기울어진 바깥 투명.',
            tool: 'gdal',
            run: 'gdalwarp -t_srs EPSG:3857 -r bilinear -dstalpha /work/rgb.vrt /work/web_3857.tif',
          },
        ],
        convert: [
          {
            title: `${f.name} 한 장 내보내기`,
            why: f.ext === '.jpg' ? '원본과 같은 형식 — EPSG:3857 재투영본으로 다시 저장. -b 1 -b 2 -b 3: JPEG 투명도 미지원 → 색 밴드 3개만, 바깥은 검정.' : '원본과 같은 형식 — EPSG:3857 재투영본으로 다시 저장. 투명도 밴드 포함.',
            tool: 'gdal',
            run: `gdal_translate -of ${f.gdalFormat} ${f.options}${f.ext === '.jpg' ? ' -b 1 -b 2 -b 3' : ''} /work/web_3857.tif /out/image${f.ext}`,
          },
          {
            title: '네 모서리 위경도 기록',
            why: '그림 파일에 위치 없음 → 뷰어용 범위를 bounds.json에 따로 기록.',
            tool: 'gdal',
            run: `gdalinfo -json /work/web_3857.tif | python3 -c "import json, sys; c = json.load(sys.stdin)['wgs84Extent']['coordinates'][0]; x = [p[0] for p in c]; y = [p[1] for p in c]; print(json.dumps([min(x), min(y), max(x), max(y)]))" > /out/bounds.json && cat /out/bounds.json`,
          },
        ],
        outputs: [
          { id: 'image', kind: 'image', path: `image${f.ext}`, label: `${f.name} 한 장`, why: '원본과 같은 형식 — EPSG:3857 재투영본. bounds.json 네 모서리 위경도와 함께 이미지 오버레이로 사용.' },
        ],
        viewers: {
          ol: { output: 'image' },
          maplibre: { output: 'image' },
          deck: { output: 'image' },
          cesium: { output: 'image' },
        },
      },
    },
    view: f.view,
    ...(f.noDomestic && { noDomestic: f.noDomestic }),
  }
}

/** 함부르크 오픈데이터: 그림 + 월드파일로 배포한다 (ETRS89 / UTM 32N) */
export const HAMBURG_SRS = { epsg: 'EPSG:25832', label: 'ETRS89 / UTM 32N, EPSG:25832' }
export const imageOthers: FormatSpec['otherSources'] = [
  { source: 'ngii', dataset: '정사영상 51cm TIF', note: '국내 항공사진. 로그인 후 TIF 다운로드 → 그림 파일로 내보내기 가능.' },
  { source: 'vworld', dataset: 'WMS GetMap 이미지', note: '범위 지정 → 그림 한 장. 약관상 재배포 제한.' },
]
