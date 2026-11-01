import { AppBridge, PostMessageTransport } from '@modelcontextprotocol/ext-apps/app-bridge'
import type { CallToolRequest, CallToolResult } from '@modelcontextprotocol/sdk/types.js'

export interface HostObservation {
  initialized: boolean
  contextUpdates: number
  toolCalls: string[]
  downloads: { uri: string; bytes: number; mimeType: string }[]
  openedLinks: string[]
}

declare global {
  interface Window {
    geoMcpCallTool: (params: CallToolRequest['params']) => Promise<CallToolResult>
    geoMcpHost: {
      observation: HostObservation
      mount: (html: string, initialResult: CallToolResult) => Promise<void>
    }
  }
}

const observation: HostObservation = {
  initialized: false,
  contextUpdates: 0,
  toolCalls: [],
  downloads: [],
  openedLinks: [],
}

const frame = document.createElement('iframe')

frame.id = 'geo-mcp-app'

frame.title = 'Geo MCP App'

frame.style.cssText = 'width:100%;height:1400px;border:0'

frame.setAttribute('sandbox', 'allow-scripts allow-same-origin')

document.body.append(frame)

window.geoMcpHost = {
  observation,
  async mount(html, initialResult) {
    const target = frame.contentWindow

    if (!target) throw new Error('MCP App iframe window is missing')

    const bridge = new AppBridge(null, { name: 'geo-sdk-bridge-test', version: '1.0.0' }, {
      serverTools: {},
      openLinks: {},
      downloadFile: {},
      updateModelContext: { text: {} },
    }, { hostContext: { theme: 'light', displayMode: 'inline' } })

    bridge.oncalltool = params => {
      observation.toolCalls.push(params.name)

      return window.geoMcpCallTool(params)
    }

    bridge.onupdatemodelcontext = async () => {
      observation.contextUpdates += 1

      return {}
    }

    bridge.onopenlink = async ({ url }) => {
      observation.openedLinks.push(url)

      return {}
    }

    bridge.ondownloadfile = async ({ contents }) => {
      const content = contents[0]

      if (!content || content.type !== 'resource' || !('blob' in content.resource)) {
        throw new Error('Expected a real inline result-file download')
      }

      const resource = content.resource
      const bytes = Uint8Array.from(atob(resource.blob), char => char.charCodeAt(0))
      const mimeType = resource.mimeType ?? 'application/octet-stream'
      observation.downloads.push({ uri: resource.uri, bytes: bytes.length, mimeType })

      const link = document.createElement('a')
      link.href = URL.createObjectURL(new Blob([bytes], { type: mimeType }))
      link.download = new URL(resource.uri).pathname.split('/').at(-1) || 'geo-result'
      document.body.append(link)
      link.click()
      link.remove()
      setTimeout(() => URL.revokeObjectURL(link.href), 1000)

      return {}
    }

    const ready = new Promise<void>(resolve => {
      bridge.oninitialized = () => {
        observation.initialized = true
        resolve()
      }
    })

    await bridge.connect(new PostMessageTransport(target, target))
    frame.srcdoc = html
    await ready
    await bridge.sendToolInput({ arguments: {} })
    await bridge.sendToolResult(initialResult)
  },
}
