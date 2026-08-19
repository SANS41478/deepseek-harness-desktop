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
import type { ShellTheme } from './shell-theme.ts'

/** The tray's app-level callbacks (wired by the main entry). */
export interface TrayOptions {
  /** Show and focus the main window. */
  showWindow(): void
  /** Quit the app for real. */
  quit(): void
}

/** The tray controller the main entry keeps for theme swaps and teardown. */
export interface TrayController {
  /** Switch the tray glyph to the theme's brand colour. */
  setTheme(theme: ShellTheme): void
  /** Destroy the tray. */
  dispose(): void
}

/**
 * Install the tray icon. Tray must run after the app is ready. The glyph
 * follows the active shell theme (brand blue by default, terra-cotta for the
 * Claude shell theme).
 * @param options - the app-level callbacks the tray menu invokes.
 * @returns the tray controller.
 */
export function installTray(options: TrayOptions): TrayController {
  const iconPath = (theme: ShellTheme): string => fileURLToPath(
    new URL(`../../build/${theme === 'claude' ? 'tray-claude' : 'tray'}.png`, import.meta.url),
  )
  const tray = new Tray(nativeImage.createFromPath(iconPath('deepseek')))
  tray.setToolTip('DeepSeek Harness')
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Show DeepSeek Harness', click: () => { options.showWindow() } },
    { type: 'separator' },
    { label: 'Quit', click: () => { options.quit() } },
  ]))
  tray.on('click', () => { options.showWindow() })
  return {
    setTheme: (theme: ShellTheme) => {
      if (theme === 'claude') tray.setImage(nativeImage.createFromPath(iconPath('claude')))
      else tray.setImage(nativeImage.createFromPath(iconPath('deepseek')))
    },
    dispose: () => { tray.destroy() },
  }
}
