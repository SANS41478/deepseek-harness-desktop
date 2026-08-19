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
} from '@deepseek-ai/dsh-client-connection/wire'

const bridge: DshApiBridge = {
  fetch(request: DshFetchRequest): Promise<DshFetchResponse> {
    return ipcRenderer.invoke('dsh:fetch', request) as Promise<DshFetchResponse>
  },

  abort(requestId: string): void {
    ipcRenderer.send('dsh:fetch:abort', requestId)
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
contextBridge.exposeInMainWorld('__DSH_TRANSPORT__', process.env.DSH_DESKTOP_TRANSPORT === 'ipc' ? 'ipc' : 'loopback')
// Shell-chrome bridge: the injected in-window title bar's hamburger opens the
// application menu as a native popup in the main process. Minimal, one
// direction, no data crosses the boundary.
contextBridge.exposeInMainWorld('dshShellMenu', {
  open: () => { ipcRenderer.send('dsh:shell-menu:open') },
})
