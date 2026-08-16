/**
 * Preload bridge: the only surface the renderer can reach into the main
 * process with. Exposes a minimal `dshApi` (fetch + stream subscription) over
 * `contextBridge` — no raw ipcRenderer, no Node, no filesystem.
 *
 * @module @deepseek-ai/dsh-desktop/preload
 */

import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import type {
  DshApiBridge,
  DshFetchRequest,
  DshFetchResponse,
  DshStreamChannel,
  DshStreamMessage,
} from '../shared/dsh-api.ts'

const bridge: DshApiBridge = {
  fetch(request: DshFetchRequest): Promise<DshFetchResponse> {
    // The renderer's AbortSignal does not cross IPC; the main side owns
    // request lifetime (documented gap, see the README).
    return ipcRenderer.invoke('dsh:fetch', request) as Promise<DshFetchResponse>
  },

  subscribe(channel: DshStreamChannel, onMessage: (message: DshStreamMessage) => void): () => void {
    const handler = (_event: IpcRendererEvent, message: DshStreamMessage): void => {
      onMessage(message)
    }
    ipcRenderer.on(`dsh:stream:${channel}`, handler)
    return () => {
      ipcRenderer.removeListener(`dsh:stream:${channel}`, handler)
      ipcRenderer.send('dsh:stream:close', channel)
    }
  },
}

contextBridge.exposeInMainWorld('dshApi', bridge)
