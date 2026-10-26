"""올린 영상을 웹 타일용 8비트 RGB(A) VRT로 맞춘다.

사용: python3 to_rgb.py <입력(.tif/.png/.jpg/.webp 또는 그림+월드파일 .zip)> <출력.vrt>
- 밴드: 팔레트는 RGB로 펼치고, 회색 1밴드는 3밴드로 복제하고, 4밴드 이상은 앞 3밴드(+알파)만 쓴다
- 비트 수: 8비트가 아니면 최소·최대값으로 0~255에 맞춘다
- 좌표: 위치만 있고 좌표계가 없으면 zip 안 .prj → 판별 화면에서 고른 좌표계(SRS 환경 변수) → 값이 위경도 범위일 때만 EPSG:4326 순으로 본다.
  좌표가 아예 없으면 서울시청 앞에 1픽셀 = 1m로 놓는다
"""
import math
import os
import sys
import zipfile
from osgeo import gdal, osr

gdal.UseExceptions()
ANCHOR = (126.9783, 37.5659)  # 서울시청 앞
IMAGE_EXT = ('.tif', '.tiff', '.png', '.jpg', '.jpeg', '.webp', '.img')

src, out = sys.argv[1], sys.argv[2]
path, prj = src, None
if src.lower().endswith('.zip'):
    names = zipfile.ZipFile(src).namelist()
    image = next((n for n in names if n.lower().endswith(IMAGE_EXT)), None)
    if not image:
        sys.exit('zip 안에 그림 파일(.png .jpg .webp .tif)이 없어요.')
    path = f'/vsizip/{src}/{image}'
    prj = next((n for n in names if n.lower().endswith('.prj')), None)

ds = gdal.Open(path)
print(f'읽은 파일: {path} ({ds.RasterXSize}×{ds.RasterYSize}, 밴드 {ds.RasterCount}개)')
gt = ds.GetGeoTransform(can_return_null=True)
srs = ds.GetSpatialRef()

opts = {'format': 'VRT'}
if gt is None:
    # 1픽셀 = 1m. 위도에 따른 경도 1도 길이로 환산해 서울시청을 가운데에 둔다
    w = ds.RasterXSize / (111320 * math.cos(math.radians(ANCHOR[1])))
    h = ds.RasterYSize / 110540
    opts['outputBounds'] = [ANCHOR[0] - w / 2, ANCHOR[1] + h / 2, ANCHOR[0] + w / 2, ANCHOR[1] - h / 2]
    opts['outputSRS'] = 'EPSG:4326'
    print('좌표 정보가 없어 서울시청 앞에 1픽셀 = 1m 크기로 놓았어요.')
elif srs is None:
    if prj:
        s = osr.SpatialReference()
        s.SetFromUserInput(zipfile.ZipFile(src).read(prj).decode('utf-8', 'replace'))
        opts['outputSRS'] = s.ExportToWkt()
        print(f'좌표계는 {prj}에서 읽었어요.')
    elif os.environ.get('SRS'):
        opts['outputSRS'] = os.environ['SRS']
        print(f"좌표계는 판별 화면에서 고른 {os.environ['SRS']}.")
    elif -180 <= gt[0] <= 180 and -90 <= gt[3] <= 90 and abs(gt[1]) < 1:
        opts['outputSRS'] = 'EPSG:4326'
        print('좌표계 정보가 없지만 값이 위경도 범위라 EPSG:4326으로 봤어요.')
    else:
        sys.exit('좌표가 어느 좌표계인지 알 수 없음 → .prj를 함께 zip으로 묶거나 판별 화면에서 좌표계 선택.')

b1 = ds.GetRasterBand(1)
if b1.GetColorTable() is not None:
    opts['rgbExpand'] = 'rgba'
else:
    n = ds.RasterCount
    alpha = n >= 4 and ds.GetRasterBand(4).GetColorInterpretation() == gdal.GCI_AlphaBand
    opts['bandList'] = [1, 1, 1] if n < 3 else [1, 2, 3] + ([4] if alpha else [])
    if gdal.GetDataTypeName(b1.DataType) != 'Byte':
        ranges = [ds.GetRasterBand(i).ComputeRasterMinMax(False) for i in set(opts['bandList'])]
        lo, hi = min(r[0] for r in ranges), max(r[1] for r in ranges)
        opts['outputType'] = gdal.GDT_Byte
        opts['scaleParams'] = [[lo, hi, 0, 255]]
        print(f'{gdal.GetDataTypeName(b1.DataType)} 값 {lo:g}~{hi:g}을 0~255로 맞췄어요.')
gdal.Translate(out, ds, **opts)
print(f'→ {out}')
