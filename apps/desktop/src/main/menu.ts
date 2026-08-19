/**
 * Application menu for the desktop shell: the standard role set (edit, view,
 * window, help) gives the usual shortcuts — reload, devtools, zoom, quit —
 * plus a tray-app Show-Window action and the Check for Updates entry.
 *
 * @module @deepseek-ai/dsh-desktop/main/menu
 */

import { Menu, type MenuItemConstructorOptions } from 'electron'
import type { ShellTheme } from './shell-theme.ts'

/** The menu's app-level callbacks (wired by the main entry). */
export interface ApplicationMenuOptions {
  /** Show and focus the main window (bring it back from the tray). */
  showWindow(): void
  /** Quit the app for real (bypasses the hide-to-tray close handler). */
  quit(): void
  /** Resolve to the latest update-check status line. */
  checkForUpdates(): Promise<string>
  /** Surface a status line to the user (dialog, log, ...). */
  notify(text: string): void
  /** The active shell theme (drives the radio checked state). */
  shellTheme: ShellTheme
  /** Switch the desktop shell theme live. */
  setShellTheme(theme: ShellTheme): void
}

/**
 * Install the application menu.
 * @param options - the app-level callbacks the menu items invoke.
 */
export function installApplicationMenu(options: ApplicationMenuOptions): void {
  const isMac = process.platform === 'darwin'
  const appMenu: MenuItemConstructorOptions = { role: 'appMenu' }

  const fileMenu: MenuItemConstructorOptions = {
    label: 'File',
    submenu: [
      {
        label: 'Show Window',
        accelerator: 'CmdOrCtrl+Shift+W',
        click: () => { options.showWindow() },
      },
      isMac ? { role: 'close' } : { label: 'Quit', accelerator: 'Alt+F4', click: () => { options.quit() } },
    ],
  }
  const viewMenu: MenuItemConstructorOptions = {
    label: 'View',
    submenu: [
      { role: 'reload' },
      { role: 'forceReload' },
      { role: 'toggleDevTools' },
      { type: 'separator' },
      { role: 'resetZoom' },
      { role: 'zoomIn' },
      { role: 'zoomOut' },
      { type: 'separator' },
      {
        label: 'Shell Theme',
        submenu: [
          {
            label: 'DeepSeek',
            type: 'radio',
            checked: options.shellTheme === 'deepseek',
            click: () => { options.setShellTheme('deepseek') },
          },
          {
            label: 'Claude',
            type: 'radio',
            checked: options.shellTheme === 'claude',
            click: () => { options.setShellTheme('claude') },
          },
        ],
      },
      { type: 'separator' },
      { role: 'togglefullscreen' },
    ],
  }
  const helpMenu: MenuItemConstructorOptions = {
    label: 'Help',
    submenu: [
      {
        label: 'Check for Updates…',
        click: () => {
          options.checkForUpdates()
            .then((text) => { options.notify(text) })
            .catch((error: unknown) => {
              options.notify(`update check failed: ${error instanceof Error ? error.message : String(error)}`)
            })
        },
      },
    ],
  }

  const template: MenuItemConstructorOptions[] = [
    ...(isMac ? [appMenu] : []),
    fileMenu,
    { role: 'editMenu' },
    viewMenu,
    { role: 'windowMenu' },
    helpMenu,
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

/**
 * Build the hamburger popup menu the in-window title bar opens (the opencode-
 * style "three-bar" dropdown). A curated, flat-ish list of the app's actions —
 * Show Window, Shell Theme, Check for Updates, Quit — rather than the full
 * File/Edit/View/Window/Help hierarchy of the (auto-hidden) application menu.
 * @param options - the app-level callbacks and current theme.
 * @returns the popup menu.
 */
export function buildHamburgerMenu(options: ApplicationMenuOptions): Menu {
  return Menu.buildFromTemplate([
    { label: 'Show Window', click: () => { options.showWindow() } },
    {
      label: 'Shell Theme',
      submenu: [
        {
          label: 'DeepSeek',
          type: 'radio',
          checked: options.shellTheme === 'deepseek',
          click: () => { options.setShellTheme('deepseek') },
        },
        {
          label: 'Claude',
          type: 'radio',
          checked: options.shellTheme === 'claude',
          click: () => { options.setShellTheme('claude') },
        },
      ],
    },
    { type: 'separator' },
    {
      label: 'Check for Updates…',
      click: () => {
        options.checkForUpdates()
          .then((text) => { options.notify(text) })
          .catch((error: unknown) => {
            options.notify(`update check failed: ${error instanceof Error ? error.message : String(error)}`)
          })
      },
    },
    { type: 'separator' },
    { label: 'Quit', accelerator: 'Alt+F4', click: () => { options.quit() } },
  ])
}
