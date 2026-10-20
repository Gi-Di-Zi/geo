"""CityGML의 좌표계(srsName)를 읽어 mago 3DTiler에 줄 좌표계 옵션을 만든다.

사용: python citygml_crs.py <CityGML>  →  "-c <EPSG> [-fc]"
- 높이까지 묶인 복합 좌표계(예: EPSG:6697 = JGD2011 + 높이)는 수평 좌표계(EPSG:6668)만 쓴다
  (mago가 쓰는 proj4j는 높이 단위(vunits)를 다루지 못한다. 높이 값은 그대로 쓰인다)
- 북쪽(위도) 축이 먼저 오는 좌표계(EPSG:6668, 4326, 일본 평면직각좌표계 …)는 -fc로 x·y를 바꿔 읽게 한다
"""
import re
import sys
from xml.etree.ElementTree import iterparse

from pyproj import CRS

srs = None
for _, el in iterparse(sys.argv[1], events=('start',)):
    srs = el.get('srsName')
    if srs:
        break
if not srs:
    sys.exit('파일에서 좌표계(srsName)를 찾지 못했어요.')
code = re.search(r'(\d{4,6})\s*$', srs)
if not code:
    sys.exit(f'EPSG 번호를 알 수 없는 좌표계예요: {srs}')

crs = CRS.from_epsg(int(code.group(1)))
if crs.is_compound:
    crs = crs.sub_crs_list[0]
epsg = crs.to_epsg()
lat_first = crs.axis_info[0].direction in ('north', 'south')
print(f'{srs} → EPSG:{epsg} ({crs.name}){", 북쪽(위도) 축이 먼저라 x·y를 바꿔 읽어요" if lat_first else ""}', file=sys.stderr)
print(f'-c {epsg}' + (' -fc' if lat_first else ''))
