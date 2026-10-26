"""올린 zip에서 SHP 한 벌을 꺼내 data.*로 두고, .dbf 글자 인코딩을 정한다.

사용: python3 shp_unpack.py <zip> <대상 폴더> <열기 옵션 파일>
- .shp는 zip 안 어느 폴더에 있어도 찾는다 (폴더째 압축한 zip). 여러 벌이면 가장 큰 .shp 한 벌만
- 같은 이름의 .shx·.dbf·.prj·.cpg를 data.*로 꺼낸다 (zip 안 한글 이름·공백과 무관하게 연다)
- .cpg가 없으면 .dbf 내용으로 인코딩 결정: UTF-8로 깨짐 없이 읽히면 UTF-8, 아니면 국내 SHP에 흔한 CP949
"""
import os
import struct
import sys
import zipfile

src, dest, options = sys.argv[1:4]
z = zipfile.ZipFile(src)
files = [i for i in z.infolist() if not i.is_dir()]
stem = lambda i: os.path.splitext(i.filename)[0].lower()
ext = lambda i: os.path.splitext(i.filename)[1].lower()

shps = sorted((i for i in files if ext(i) == '.shp'), key=lambda i: -i.file_size)
if not shps:
    sys.exit('zip 안에 .shp가 없음.')
shp = shps[0]
if len(shps) > 1:
    print(f'.shp {len(shps)}개 → 가장 큰 1벌만: ' + ', '.join(os.path.basename(i.filename) for i in shps))
parts = {ext(i): i for i in files if stem(i) == stem(shp) and ext(i) in ('.shp', '.shx', '.dbf', '.prj', '.cpg')}
os.makedirs(dest, exist_ok=True)
for e, i in parts.items():
    with open(os.path.join(dest, 'data' + e), 'wb') as f:
        f.write(z.read(i))
print('꺼낸 파일: ' + ' '.join(sorted(parts)) + ('' if '.prj' in parts else ' (.prj 없음 → 좌표계는 판별 화면에서 고른 값)'))


def encoding(dbf):
    """열 이름 + 앞 레코드(최대 1MB)의 비ASCII 바이트를 UTF-8로 읽어 본다.
    열 정의의 예약 바이트는 쓰는 프로그램마다 아무 값이라 보지 않는다. 필드 폭에서 잘린 글자 몇 개는 봐준다(오류 1% 이하면 UTF-8).
    CP949 한글은 UTF-8로 읽으면 거의 모든 글자가 오류 → 구분된다 (반대로 UTF-8을 CP949로 읽으면 한자처럼 읽혀 오류가 적어 이 방향만 본다)"""
    with open(dbf, 'rb') as f:
        head = f.read(32)
        size, rec = struct.unpack('<HH', head[8:12])
        desc = f.read(size - 32)
        data = f.read(min(rec * 2000, 1 << 20))
    names = b' '.join(desc[i:i + 11].split(b'\0')[0] for i in range(0, len(desc) - 31, 32))
    sample = names + b' ' + data
    high = sum(b >= 0x80 for b in sample)
    if not high:
        return None
    errors = sample.decode('utf-8', 'replace').count('\ufffd')
    return 'UTF-8' if errors <= high * 0.01 else 'CP949'


opts = ''
if '.cpg' in parts:
    print('인코딩: .cpg 따름')
elif '.dbf' in parts:
    enc = encoding(os.path.join(dest, 'data.dbf'))
    print(f'인코딩: {enc or "영문·숫자만 (상관없음)"} (.cpg 없음 → 내용으로 판별)')
    opts = f'-oo ENCODING={enc}' if enc else ''
open(options, 'w').write(opts)
