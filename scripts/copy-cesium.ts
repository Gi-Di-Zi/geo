// Cesium은 Workers·Assets 등을 런타임에 URL로 불러오므로 public/cesium으로 복사해 둔다 (window.CESIUM_BASE_URL = '/cesium/')
import { cpSync } from 'node:fs'

for (const dir of ['Workers', 'Assets', 'Widgets', 'ThirdParty']) {
  cpSync(`node_modules/cesium/Build/Cesium/${dir}`, `public/cesium/${dir}`, { recursive: true })
}
