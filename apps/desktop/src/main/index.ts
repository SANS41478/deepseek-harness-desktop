/**
 * Electron main process entry. Owns the window, the app lifecycle, and the
 * host tree teardown; the harness boot itself is Electron-free
 * ({@link startHost}) so it stays testable without a window.
 *
 * Two transports, switched by `DSH_DESKTOP_TRANSPORT`:
 * - `loopback` (default): the renderer is the stock browser client talking to
 *   the in-process loopback web server — zero protocol changes, works today.
 * - `ipc`: the documented Electron direction — the renderer loads the dist
 *   over the `dsh://` protocol and drives the same RPC surface through the
 *   preload bridge (`dshApi`) instead of HTTP/WebSocket.
 *
 * @module @deepseek-ai/dsh-desktop/main
 */

import { app, BrowserWindow, shell } from 'electron'
import { fileURLToPath } from 'node:url'
import { startHost, type DesktopHost } from './startHost.ts'
import { installIpcBridge } from './ipc-bridge.ts'
import { registerDshProtocol, registerDshScheme } from './protocol.ts'

/** The desktop transport: 'loopback' (stock browser client) or 'ipc' (IPC carrier). */
type DesktopTransport = 'loopback' | 'ipc'

/** Resolve the transport from the environment; anything other than 'ipc' is loopback. */
function desktopTransport(): DesktopTransport {
  return process.env.DSH_DESKTOP_TRANSPORT === 'ipc' ? 'ipc' : 'loopback'
}

const TRANSPORT = desktopTransport()

// Scheme privileges must be declared before the app is ready; harmless in
// loopback mode where the protocol handler is never installed.
registerDshScheme()

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  let host: DesktopHost | undefined
  let mainWindow: BrowserWindow | undefined
  let disposed = false

  /** Dispose the harness tree exactly once, then quit the app. */
  async function shutdown(): Promise<void> {
    if (disposed) return
    disposed = true
    try {
      await host?.dispose()
    } finally {
      app.quit()
    }
  }

  function createWindow(): BrowserWindow {
    const win = new BrowserWindow({
      width: 1280,
      height: 860,
      show: false,
      webPreferences: {
        // The preload uses contextBridge only; sandbox is off because the
        // preload is an ESM module (Electron requires unsandboxed ESM preload).
        preload: fileURLToPath(new URL('../preload/index.js', import.meta.url)),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
      },
    })
    win.once('ready-to-show', () => { win.show() })
    // No child windows: external links leave the app.
    win.webContents.setWindowOpenHandler(({ url }) => {
      void shell.openExternal(url)
      return { action: 'deny' }
    })
    win.webContents.on('will-navigate', (event, url) => {
      // Loopback mode: keep navigation inside the app origin (in-page routing
      // never triggers this; only a real navigation to another URL does).
      if (TRANSPORT === 'ipc' && !url.startsWith('dsh://app/')) {
        event.preventDefault()
        void shell.openExternal(url)
      }
    })
    win.on('closed', () => { mainWindow = undefined })
    return win
  }

  app.on('second-instance', () => {
    if (mainWindow !== undefined) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })

  void app.whenReady().then(async () => {
    mainWindow = createWindow()
    const webContents = mainWindow.webContents
    try {
      // The desktop owns no command line: the web-startup provider parses
      // --port 0 so the in-process server binds an OS-assigned loopback port.
      host = await startHost({
        args: ['--port', '0'],
        onExit: () => { void shutdown() },
      })
      if (TRANSPORT === 'ipc') {
        registerDshProtocol(host.ctx)
        installIpcBridge(host.ctx, webContents)
        await mainWindow.loadURL('dsh://app/')
      } else {
        await mainWindow.loadURL(host.webUrl)
      }
    } catch (error) {
      console.error('dsh-desktop: host boot failed:', error)
      await shutdown()
    }
  }).catch((error: unknown) => {
    console.error('dsh-desktop: unexpected failure:', error)
  })

  app.on('window-all-closed', () => {
    void shutdown()
  })

  app.on('before-quit', () => {
    void shutdown()
  })
}
