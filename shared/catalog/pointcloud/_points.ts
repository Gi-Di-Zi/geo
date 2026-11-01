// LAS·LAZ는 압축 여부만 다르고 처리 흐름이 같다. 확장자마다 그 형식 그대로 배포되는 샘플을 받아 웹 메르카토르로 맞춘 뒤 같은 도구로 3D Tiles를 만든다.
import type { FormatSpec, Step } from '../../types.ts'

interface PointFormat {
  id: string
  name: string
  ext: string
  summary: string
  description: string
  anatomy: FormatSpec['anatomy']
  collect: FormatSpec['collect']
  /** 전처리가 읽을 점군 경로. 받은 zip을 푸는 단계가 있으면 그 결과 */
  input: string
  unpack?: Step
  /** 살펴보기 단계의 설명 (파일마다 좌표계·색 사정이 다르다) */
  inspect: string
  /** 파일에 좌표계가 없을 때 붙일 좌표계 */
  srs?: string
  /** 색이 없으면 높이로 칠한다 */
  colorize: boolean
  /** n개 중 하나만 남겨 솎는다 */
  decimate?: number
  view: FormatSpec['view']
}

// 점 높이는 해발고도(수백 m)인데 세 뷰어 모두 지형 없이 높이 0인 바닥지도 위에 그린다 → 그대로면 바닥 위 공중에 떠서, 비스듬히 보면 엉뚱한 자리에 있는 것처럼 보인다
const lower: Step = {
  title: '높이 0으로 내리기',
  why: '점 높이: 해발고도(수백 m). 뷰어 바닥지도: 지형 없이 높이 0 → 그대로면 공중에 뜸. 가장 낮은 점(노이즈 제외 후)을 0으로 맞춰 바닥에 앉힘. 상대 높이는 유지.',
  tool: 'pdal',
  run: `Z0=$(pdal info --summary /work/reproj.las | grep -oE '"minz": [-0-9.e+]+' | head -1 | cut -d' ' -f2) && echo "Z - $Z0" && pdal translate /work/reproj.las /work/clean.las assign --filters.assign.value="Z = Z - $Z0"`,
}

export function pointSpec(f: PointFormat): FormatSpec {
  const filters = ['reprojection', 'range', ...(f.colorize ? ['colorinterp', 'assign'] : []), ...(f.decimate ? ['decimation'] : [])]
  const options = [
    ...(f.srs ? [`--readers.las.spatialreference=${f.srs}`] : []),
    '--filters.reprojection.out_srs=EPSG:3857',
    '--filters.range.limits="Classification![7:7],Classification![18:18]"',
    ...(f.colorize ? ['--filters.colorinterp.dimension=Z', '--filters.colorinterp.ramp=pestel_shades', ...['Red', 'Green', 'Blue'].map(c => `--filters.assign.value="${c} = ${c} * 256"`)] : []),
    ...(f.decimate ? [`--filters.decimation.step=${f.decimate}`] : []),
  ]
  const preprocess: Step[] = [
    ...(f.unpack ? [f.unpack] : []),
    {
      title: '무결성 확인',
      why: f.inspect,
      tool: 'pdal',
      run: `pdal info --summary ${f.input} | grep -E '"num_points"|"min[xyz]"|"max[xyz]"|"dimensions"' | cut -c1-200`,
    },
    {
      title: f.colorize ? '웹 메르카토르 변환 + 높이별 색' : '좌표계 지정 + 웹 메르카토르 변환',
      why: [
        f.srs ? `readers.las.spatialreference=${f.srs}: 원본 CRS 메타데이터 사용 불가 → 샘플 검사에서 판단한 좌표계 지정.` : '좌표계: 파일 내장값 사용.',
        'reprojection: EPSG:3857로 통일 (두 변환 도구 공통 입력). range: 분류 7·18(노이즈) 제외.',
        f.colorize ? 'colorinterp: RGB 없음 → 높이(Z)별 색. assign: 0~255 → LAS 규격 16비트(0~65535), 미적용 시 매우 어둡게 표시.' : 'RGB: 원본값 유지.',
        f.decimate ? `decimation: 점 과다 → ${f.decimate}개 중 1개만 유지.` : '',
      ].join(' ').trim(),
      tool: 'pdal',
      run: `pdal translate ${f.input} /work/reproj.las ${filters.join(' ')} ${options.join(' ')}`,
    },
    lower,
  ]
  const tilesOutput = { id: 'tiles', kind: '3dtiles' as const, path: 'tiles/tileset.json', label: '3D Tiles (pnts)', why: 'tileset.json(타일 트리) + .pnts(점 묶음). Deck.gl·Cesium 3D 점군.' }
  const noOl = { unsupported: '2D 지도 — 3D 점군 미지원.' }
  const noMaplibre = { unsupported: '점군·3D Tiles 레이어 없음.' }
  return {
    id: f.id,
    category: 'pointcloud',
    name: f.name,
    extensions: [f.ext],
    summary: f.summary,
    description: f.description,
    anatomy: f.anatomy,
    convertible: true,
    collect: f.collect,
    otherSources: [
      { source: 'aihub', dataset: '한국 도시 3차원 영상 (광주·전주 LAS)', note: '승인 필요, AI 학습 외 사용·제3자 제공 금지 → 게시 불가.' },
      { source: 'ngii', dataset: '항공 라이다', note: '공개 여부 미확인.' },
      { source: 'tokyo-pointcloud', dataset: '도쿄 23구 LP 점군', note: '2차 이용 가능 아시아 도시 점군.' },
    ],
    recipes: [
      {
        id: 'mago',
        title: 'PDAL + mago 3DTiler',
        preprocess,
        convert: [
          {
            title: '3D Tiles(pnts) 분할',
            why: '-i: 폴더 단위 입력 → 정리한 LAS를 폴더에 복사. -c 3857: 입력 좌표계. 타일 범위: 위경도 상자(region) → 뷰어 위치 계산 단순. 좌표: 16비트 정수 양자화 → 용량 축소.',
            tool: 'mago-3d-tiler',
            run: 'mkdir -p /work/in && cp /work/clean.las /work/in/ && mago-3d-tiler -i /work/in -o /out/tiles -it las -c 3857 -tv 1.0 -q',
          },
        ],
        outputs: [tilesOutput],
        viewers: {
          ol: noOl,
          maplibre: noMaplibre,
          deck: { output: 'tiles' },
          cesium: { output: 'tiles' },
        },
      },
      {
        id: 'py3dtiles',
        title: 'PDAL + py3dtiles',
        preprocess,
        convert: py3dConvert,
        outputs: [tilesOutput],
        viewers: {
          ol: noOl,
          maplibre: noMaplibre,
          deck: { output: 'tiles' },
          cesium: { output: 'tiles' },
        },
      },
    ],
    alternatives: [],
    upload: {
      accept: [f.ext],
      note: `좌표계 포함 ${f.ext} 파일. 점이 많으면 수 분 소요 (py3dtiles가 mago보다 빠름).`,
      recipes: [{
        id: 'mago',
        title: 'PDAL + mago 3DTiler',
        preprocess: uploadPreprocess,
        convert: [
          {
            title: '3D Tiles(pnts) 분할',
            why: '샘플 mago 레시피와 동일. -c 3857: 앞 단계에서 맞춘 좌표계. -q 없음: 진행 로그를 실시간 출력으로 (점이 많으면 수 분).',
            tool: 'mago-3d-tiler',
            run: 'mkdir -p /work/in && cp /work/clean.las /work/in/ && mago-3d-tiler -i /work/in -o /out/tiles -it las -c 3857 -tv 1.0',
          },
        ],
        outputs: [tilesOutput],
        viewers: { ol: noOl, maplibre: noMaplibre, deck: { output: 'tiles' }, cesium: { output: 'tiles' } },
      }, {
        id: 'py3dtiles',
        title: 'PDAL + py3dtiles',
        preprocess: uploadPreprocess,
        convert: py3dConvert,
        outputs: [tilesOutput],
        viewers: { ol: noOl, maplibre: noMaplibre, deck: { output: 'tiles' }, cesium: { output: 'tiles' } },
      }],
    },
    view: f.view,
  }
}

/** 올린 점군: 좌표계 확인 → 웹 메르카토르 + 높이별 색 → 높이 0 정렬(/work/clean.las). mago·py3dtiles가 같이 쓴다 */
const uploadPreprocess: Step[] = [
  {
    title: '무결성 확인',
    why: '점 수·범위·좌표계. 좌표계 없음(LOCAL_CS·빈 값)이면 여기서 중단: 지도 배치 불가, PDAL 재투영은 실패해도 종료 코드 0 + 빈 파일.',
    tool: 'pdal',
    run: `pdal info --summary $INPUT > /work/info.json && grep -E '"num_points"|"min[xyz]"|"max[xyz]"|"dimensions"|"horizontal"' /work/info.json | cut -c1-200 && grep -qE '"horizontal": "(PROJCS|GEOGCS|PROJCRS|GEOGCRS)' /work/info.json || { echo '좌표계 없음 → 지도 위치 불명. 좌표계를 넣은 파일로 다시'; exit 1; }`,
  },
  {
    title: '웹 메르카토르 변환 + 높이별 색',
    why: 'reprojection: EPSG:3857. range: 노이즈 분류 7·18 제외. colorinterp: 높이(Z)별 색, 원본 RGB도 덮어씀 → 샘플과 같은 표현. assign: 0~255 → 16비트(0~65535).',
    tool: 'pdal',
    run: 'pdal translate $INPUT /work/reproj.las reprojection range colorinterp assign --filters.reprojection.out_srs=EPSG:3857 --filters.range.limits="Classification![7:7],Classification![18:18]" --filters.colorinterp.dimension=Z --filters.colorinterp.ramp=pestel_shades --filters.assign.value="Red = Red * 256" --filters.assign.value="Green = Green * 256" --filters.assign.value="Blue = Blue * 256"',
  },
  lower,
]

/** py3dtiles 변환: 샘플·업로드 공통 (/work/clean.las → /out/tiles) */
const py3dConvert: Step[] = [
  {
    title: '3D Tiles(pnts) 분할',
    why: '옥트리 분할 → 가까울수록 촘촘한 타일. --srs_in 3857 → --srs_out 4978: 지구 중심 좌표계(ECEF).',
    tool: 'py3dtiles',
    run: 'py3dtiles convert /work/clean.las --out /out/tiles --srs_in 3857 --srs_out 4978 --overwrite --disable-processpool',
  },
  {
    title: 'refine 값 수정',
    why: '노드별 점 비중복 → 부모 + 자식(ADD)이 맞는 방식. 루트 노드만 REPLACE로 출력 → Deck.gl: 하위 타일 미요청, Cesium: 최하위에서 루트 점 숨김. 이 값만 ADD로 수정.',
    tool: 'python',
    run: 'python /scripts/fix_refine.py /out/tiles/tileset.json',
  },
]
