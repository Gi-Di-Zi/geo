# 파이프라인용 도구 모음 이미지 (geo-web/tools). scripts/pipeline.ts가 'local:tools' 도구를 처음 쓸 때 자동으로 빌드한다.
FROM node:22-bookworm-slim

RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 python3-venv curl unzip ca-certificates \
 && rm -rf /var/lib/apt/lists/*

# Python 도구: COG, GeoPandas, PostGIS 드라이버, CityJSON, Overture CLI
RUN python3 -m venv /opt/py \
 && /opt/py/bin/pip install --no-cache-dir rio-cogeo==7.0.4 geopandas==1.2.0 "psycopg[binary]==3.3.6" "cjio[export]==0.10.1" overturemaps
ENV PATH=/opt/py/bin:$PATH

# Node 도구: 3D Tiles, glTF
RUN npm install -g 3d-tiles-tools@0.5.4 @gltf-transform/cli@4.5.1

# IfcConvert (IfcOpenShell), go-pmtiles
RUN curl -sSL -o /tmp/ic.zip https://github.com/IfcOpenShell/IfcOpenShell/releases/download/ifcconvert-0.9.0/ifcconvert-0.9.0-linux64.zip \
 && unzip -o /tmp/ic.zip -d /usr/local/bin && chmod +x /usr/local/bin/IfcConvert && rm /tmp/ic.zip \
 && curl -sSL https://github.com/protomaps/go-pmtiles/releases/download/v1.31.2/go-pmtiles_1.31.2_Linux_x86_64.tar.gz | tar -xz -C /usr/local/bin pmtiles

WORKDIR /work
