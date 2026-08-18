/**
 * Tray icon for the desktop shell: a Show/Quit context menu plus a left-click
 * that brings the window back. The window's close button hides to the tray
 * (see the main entry), so the tray is the visible anchor while the harness
 * keeps running in the background.
 *
 * @module @deepseek-ai/dsh-desktop/main/tray
 */

import { Menu, Tray, nativeImage } from 'electron'
import { fileURLToPath } from 'node:url'

/** The tray's app-level callbacks (wired by the main entry). */
export interface TrayOptions {
  /** Show and focus the main window. */
  showWindow(): void
  /** Quit the app for real. */
  quit(): void
}

/**
 * Install the tray icon. Tray must run after the app is ready.
 * @param options - the app-level callbacks the tray menu invokes.
 * @returns the disposer that destroys the tray.
 */
export function installTray(options: TrayOptions): () => void {
  const icon = nativeImage.createFromPath(fileURLToPath(new URL('../../build/tray.png', import.meta.url)))
  const tray = new Tray(icon)
  tray.setToolTip('DeepSeek Harness')
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Show DeepSeek Harness', click: () => { options.showWindow() } },
    { type: 'separator' },
    { label: 'Quit', click: () => { options.quit() } },
  ]))
  tray.on('click', () => { options.showWindow() })
  return () => { tray.destroy() }
}
