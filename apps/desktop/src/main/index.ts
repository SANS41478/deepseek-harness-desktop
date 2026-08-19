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
 * Window UI: the close button hides the window to the tray (the harness keeps
 * running), the application menu provides the standard roles and shortcuts,
 * and the tray offers Show/Quit. Quit (menu, tray, or Cmd+Q) exits for real.
 *
 * @module @deepseek-ai/dsh-desktop/main
 */

import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { startHost, type DesktopHost } from './startHost.ts'
import { installIpcBridge } from './ipc-bridge.ts'
import { registerDshProtocol, registerDshScheme } from './protocol.ts'
import { installApplicationMenu, buildHamburgerMenu, type ApplicationMenuOptions } from './menu.ts'
import { installTray } from './tray.ts'
import { installUpdater } from './updater.ts'
import { installTitleBar } from './title-bar.ts'
import { installDesktopAdapt } from './desktop-adapt.ts'
import { installShellTheme, resolveShellTheme, type ShellTheme } from './shell-theme.ts'
import type { TrayController } from './tray.ts'

// electron-updater is a CommonJS module whose named exports come through a
// star re-export, so Electron's ESM loader cannot detect `autoUpdater`;
// createRequire is the repo's CJS interop pattern (web-app, client-modules).
const { autoUpdater } = createRequire(import.meta.url)('electron-updater') as typeof import('electron-updater')

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
  let tray: TrayController | undefined
  let disposed = false
  let quitting = false

  /** Show and focus the main window, recreating it if the last one closed. */
  function showWindow(): void {
    if (mainWindow === undefined) {
      mainWindow = createWindow()
      const url = TRANSPORT === 'ipc' ? 'dsh://app/' : host?.webUrl
      if (url !== undefined) void mainWindow.loadURL(url)
      return
    }
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.show()
    mainWindow.focus()
  }

  /** Dispose the harness tree exactly once, then quit the app. */
  async function shutdown(): Promise<void> {
    if (disposed) return
    disposed = true
    quitting = true
    try {
      tray?.dispose()
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
      // The OS menu bar stays hidden; the in-window title bar's hamburger
      // opens the app menu as a popup (Alt still reveals the bar for the
      // role accelerators — reload, devtools, zoom).
      autoHideMenuBar: true,
      // In-window title bar: the system bar is hidden and the shell injects
      // its own draggable bar (title-bar.ts). Windows keeps the native window
      // buttons as a floating overlay at the top-right; the overlay height
      // matches the injected bar so the two read as one strip.
      titleBarStyle: 'hidden',
      ...process.platform === 'win32' ? {
        titleBarOverlay: {
          color: '#00000000',
          symbolColor: '#9aa0a6',
          height: 36,
        },
      } : {},
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
    // The close button hides to the tray (the harness keeps running); Quit
    // (menu/tray/Cmd+Q) sets `quitting` and exits for real.
    win.on('close', (event) => {
      if (!quitting) {
        event.preventDefault()
        win.hide()
      }
    })
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
    showWindow()
  })

  void app.whenReady().then(async () => {
    mainWindow = createWindow()
    const webContents = mainWindow.webContents
    installTitleBar(mainWindow)
    installDesktopAdapt(mainWindow)

    const updater = installUpdater(autoUpdater, app.isPackaged)
    let shellTheme = resolveShellTheme()
    const menuOptions = (theme: ShellTheme): ApplicationMenuOptions => ({
      showWindow,
      quit: () => { void shutdown() },
      checkForUpdates: () => updater.checkForUpdates(),
      notify: (text) => {
        if (mainWindow !== undefined && !mainWindow.isDestroyed()) {
          void dialog.showMessageBox(mainWindow, { message: text })
        } else {
          console.log(`dsh-desktop: ${text}`)
        }
      },
      shellTheme: theme,
      setShellTheme: (next) => { shellThemeController.setTheme(next) },
    })
    const rebuildMenu = (theme: ShellTheme): void => {
      installApplicationMenu(menuOptions(theme))
    }
    const theTray = installTray({ showWindow, quit: () => { void shutdown() } })
    tray = theTray
    const shellThemeController = installShellTheme(mainWindow, shellTheme, (theme) => {
      shellTheme = theme
      rebuildMenu(theme)
      theTray.setTheme(theme)
    })
    rebuildMenu(shellTheme)
    // The in-window title bar's hamburger opens the app menu as a native
    // popup; rebuilt on each open so the Shell Theme radios reflect the
    // current theme.
    ipcMain.on('dsh:shell-menu:open', () => {
      if (mainWindow === undefined) return
      buildHamburgerMenu(menuOptions(shellTheme)).popup({ window: mainWindow, x: 12, y: 40 })
    })
    // One background update check per launch; the menu entry checks on demand.
    if (app.isPackaged) {
      updater.checkForUpdates().catch((error: unknown) => {
        console.error('dsh-desktop: update check failed:', error)
      })
    }

    try {
      // The desktop owns no command line: the web-startup provider parses
      // --port 0 so the in-process server binds an OS-assigned loopback port
      // (loopback transport only; the IPC transport serves over dsh:// and
      // disables the webserver row instead).
      host = await startHost({
        args: TRANSPORT === 'loopback' ? ['--port', '0'] : [],
        webServerRequired: TRANSPORT === 'loopback',
        onExit: () => { void shutdown() },
      })
      if (TRANSPORT === 'ipc') {
        registerDshProtocol(host.ctx)
        installIpcBridge(host.ctx, webContents)
        await mainWindow.loadURL('dsh://app/')
      } else {
        await mainWindow.loadURL(host.webUrl as string)
      }
    } catch (error) {
      console.error('dsh-desktop: host boot failed:', error)
      await shutdown()
    }
  }).catch((error: unknown) => {
    console.error('dsh-desktop: unexpected failure:', error)
  })

  app.on('activate', () => {
    // macOS dock click brings the window back.
    showWindow()
  })

  app.on('window-all-closed', () => {
    void shutdown()
  })

  app.on('before-quit', () => {
    quitting = true
    void shutdown()
  })
}
