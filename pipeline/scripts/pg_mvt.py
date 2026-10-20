"""PostGIS ST_AsMVT로 z/x/y.pbf 정적 벡터타일을 굽는다.

실서버(martin, pg_tileserv)는 요청이 올 때마다 같은 SQL을 실행하지만,
정적 사이트라서 범위 안의 타일을 미리 돌며 파일로 저장한다.

사용: python pg_mvt.py <table> <layer> <out_dir> <minzoom> <maxzoom> <west> <south> <east> <north>
테이블의 도형 열은 geom(EPSG:3857)이어야 한다. 접속 정보는 PGHOST 등 환경변수로 받는다.
"""
import math
import os
import sys

import psycopg


def tile(lon, lat, z):
    n = 2 ** z
    x = int((lon + 180) / 360 * n)
    y = int((1 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2 * n)
    return x, y


def main():
    table, layer, out, minz, maxz = sys.argv[1:6]
    west, south, east, north = map(float, sys.argv[6:10])
    written = 0
    with psycopg.connect() as conn:
        cols = [r[0] for r in conn.execute(
            "SELECT column_name FROM information_schema.columns WHERE table_name = %s AND column_name <> 'geom'", (table,))]
        props = ''.join(f'"{c}", ' for c in cols)
        sql = f"""
          SELECT ST_AsMVT(q, %(layer)s, 4096, 'geom') FROM (
            SELECT {props}ST_AsMVTGeom(geom, ST_TileEnvelope(%(z)s, %(x)s, %(y)s), 4096, 64, true) AS geom
            FROM {table}
            WHERE geom && ST_TileEnvelope(%(z)s, %(x)s, %(y)s, margin => 64.0 / 4096)
          ) q"""
        for z in range(int(minz), int(maxz) + 1):
            x0, y0 = tile(west, north, z)
            x1, y1 = tile(east, south, z)
            for x in range(x0, x1 + 1):
                for y in range(y0, y1 + 1):
                    mvt = conn.execute(sql, {'layer': layer, 'z': z, 'x': x, 'y': y}).fetchone()[0]
                    if not mvt:
                        continue
                    os.makedirs(os.path.join(out, str(z), str(x)), exist_ok=True)
                    with open(os.path.join(out, str(z), str(x), f'{y}.pbf'), 'wb') as f:
                        f.write(mvt)
                    written += 1
    print(f'타일 {written}개를 {out}에 썼어요')


if __name__ == '__main__':
    main()
