// 이미 웹 형태인 타일셋(3D Tiles, quantized-mesh)은 타일 한 장으로는 위치·구조를 알 수 없어서 묶음(zip)으로 받아 그대로 올린다
import type { Recipe, Upload } from '../types.ts'

/** id = 같은 일을 하는 샘플 레시피 id (그대로 올리기: 'tiles'·'cesium') → 방식·도구 고르기 설명 공유 */
export function bundleUpload(u: { id: string; marker: string; dest: string; note: string; outputs: Recipe['outputs']; viewers: Recipe['viewers'] }): Upload {
  return {
    accept: ['.zip'],
    note: u.note,
    recipes: [{
      id: u.id,
      title: '그대로 올리기',
      preprocess: [
        {
          title: '무결성 확인',
          why: `zip 내 ${u.marker}·타일 파일 유무 확인.`,
          tool: 'python',
          run: 'python -m zipfile -l $INPUT | head -40',
        },
      ],
      convert: [
        {
          title: '타일셋 추출',
          why: `이미 웹 형태 → 최상위 ${u.marker} 폴더 그대로 추출, 변환 없음. gzip 타일: 압축 해제(정적 서버 직접 읽기).`,
          tool: 'python',
          run: `python /scripts/unpack.py $INPUT ${u.marker} /out/${u.dest}`,
        },
      ],
      outputs: u.outputs,
      viewers: u.viewers,
    }],
  }
}
