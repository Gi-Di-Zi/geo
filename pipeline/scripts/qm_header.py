"""quantized-mesh 타일(.terrain) 하나의 헤더를 풀어 보여준다.

구조: 헤더 88바이트(중심, 최저·최고 높이, 경계 구, 지평선 가림점) → 정점 수 → u, v, 높이 배열(zigzag 인코딩)
      → 삼각형 수 → 인덱스(high-water mark 인코딩) → 확장(법선, 물 마스크 등)

사용: python qm_header.py <tile.terrain>
"""
import gzip
import math
import struct
import sys

path = sys.argv[1]
data = open(path, 'rb').read()
if data[:2] == b'\x1f\x8b':
    data = gzip.decompress(data)
    print('(gzip으로 압축된 타일이라 풀어서 읽어요)')

cx, cy, cz, hmin, hmax, sx, sy, sz, sr, ox, oy, oz = struct.unpack_from('<3d2f4d3d', data, 0)
vertex_count = struct.unpack_from('<I', data, 88)[0]
offset = 92 + vertex_count * 2 * 3
index_size = 4 if vertex_count > 65536 else 2
offset += (-offset) % index_size
triangle_count = struct.unpack_from('<I', data, offset)[0]

# 지구 중심 좌표(ECEF) → 위경도 (WGS84, 근사)
a, e2 = 6378137.0, 6.69437999014e-3
lon = math.degrees(math.atan2(cy, cx))
p = math.hypot(cx, cy)
lat = math.atan2(cz, p * (1 - e2))
for _ in range(5):
    n = a / math.sqrt(1 - e2 * math.sin(lat) ** 2)
    lat = math.atan2(cz + e2 * n * math.sin(lat), p)

print(f'파일: {path}  ({len(data):,}바이트)')
print(f'타일 중심: 경도 {lon:.5f}, 위도 {math.degrees(lat):.5f}')
print(f'높이 범위: {hmin:.1f} ~ {hmax:.1f} m (타원체 기준)')
print(f'경계 구 반지름: {sr:.1f} m')
print(f'정점 {vertex_count:,}개, 삼각형 {triangle_count:,}개')
