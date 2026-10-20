"""래스터 범위를 웹 타일 격자에 맞춘 EPSG:3857 범위로 넓힌다 (첫 값 = 범위가 타일 두세 장에 걸치는 줌).

사용: python3 tile_grid.py <DEM>  →  "<줌> <xmin> <ymin> <xmax> <ymax>"
범위가 가로·세로 타일 두세 장에 걸치는 줌을 고르고, 그 줌의 타일 경계까지 바깥으로 넓힌다.
넓히는 폭은 많아야 한쪽에 타일 한 장이라, 높이 0으로 채운 쓸모없는 타일이 적다.
Terrain-RGB 타일 가장자리에 빈칸(높이 -10000m 절벽)이 생기지 않게 하려는 것이다.
"""
import math
import sys
from osgeo import gdal, osr

gdal.UseExceptions()
WORLD = 20037508.342789244

ds = gdal.Warp('', sys.argv[1], format='VRT', dstSRS='EPSG:3857')
gt = ds.GetGeoTransform()
xmin, ymax = gt[0], gt[3]
xmax, ymin = xmin + gt[1] * ds.RasterXSize, ymax + gt[5] * ds.RasterYSize
span = max(xmax - xmin, ymax - ymin)
z = max(0, min(14, math.floor(math.log2(2 * WORLD / span)) + 1))
size = 2 * WORLD / 2 ** z
snap = lambda v, f: f((v + WORLD) / size) * size - WORLD
print(z, snap(xmin, math.floor), snap(ymin, math.floor), snap(xmax, math.ceil), snap(ymax, math.ceil))
