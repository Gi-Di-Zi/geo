export type Basemap = 'vworld' | 'satellite' | 'osm'

export const basemapLabels: Record<Basemap, string> = { vworld: 'VWorld', satellite: '위성', osm: 'OSM' }

export function basemapTiles(kind: Basemap, key: string) {
  if (kind === 'osm' || !key) {
    return { url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png', minzoom: 0, maxzoom: 19, attribution: '© OpenStreetMap contributors' }
  }
  const layer = kind === 'satellite' ? 'Satellite/{z}/{y}/{x}.jpeg' : 'Base/{z}/{y}/{x}.png'
  return { url: `https://api.vworld.kr/req/wmts/1.0.0/${key}/${layer}`, minzoom: 6, maxzoom: 19, attribution: '© VWorld' }
}

/** 페이지 전체가 같이 쓰는 배경지도 선택. 키가 없으면 OSM으로 시작한다 */
export function useBasemap() {
  const key = useRuntimeConfig().public.vworldKey as string
  const basemap = useState<Basemap>('basemap', () => (key ? 'vworld' : 'osm'))
  const tiles = computed(() => basemapTiles(basemap.value, key))
  return { basemap, tiles, hasKey: !!key }
}
