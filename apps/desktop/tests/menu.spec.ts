/**
 * Application menu: the standard role set installs as the app menu, the File
 * menu carries Show Window/Quit for the tray lifecycle, and Check for Updates
 * surfaces the update status through the notify callback.
 */
import { describe, expect, it, vi } from 'vitest'
import { buildHamburgerMenu, installApplicationMenu } from '../src/main/menu.ts'
import type { MenuItemConstructorOptions } from 'electron'

const electronModule = vi.hoisted(() => ({
  Menu: {
    setApplicationMenu: vi.fn(),
    buildFromTemplate: vi.fn((template: MenuItemConstructorOptions[]) => template),
  },
}))

vi.mock('electron', () => electronModule)

/** Walk a template tree to find the item whose label matches (or has the click). */
function findItem(template: MenuItemConstructorOptions[], label: string): MenuItemConstructorOptions | undefined {
  for (const item of template) {
    if (item.label === label) return item
    const submenu = item.submenu as MenuItemConstructorOptions[] | undefined
    if (submenu !== undefined) {
      const nested = findItem(submenu, label)
      if (nested !== undefined) return nested
    }
  }
  return undefined
}

function mount() {
  const options = {
    showWindow: vi.fn(),
    quit: vi.fn(),
    checkForUpdates: vi.fn(),
    notify: vi.fn(),
    shellTheme: 'deepseek' as const,
    setShellTheme: vi.fn(),
  }
  installApplicationMenu(options)
  const template = electronModule.Menu.buildFromTemplate.mock.calls.at(-1)![0]
  return { options, template }
}

describe('installApplicationMenu', () => {
  it('installs a template with edit, view, and window roles', () => {
    const { template } = mount()
    expect(electronModule.Menu.setApplicationMenu).toHaveBeenCalledWith(template)
    const roles = template.map(item => (item.role as string | undefined) ?? item.label)
    expect(roles).toContain('editMenu')
    expect(roles).toContain('windowMenu')
    const view = template.find(item => item.label === 'View') as { submenu: MenuItemConstructorOptions[] }
    const viewRoles = view.submenu.map(item => item.role)
    expect(viewRoles).toEqual(expect.arrayContaining(['reload', 'forceReload', 'toggleDevTools', 'resetZoom', 'zoomIn', 'zoomOut']))
  })

  it('wires Show Window and Quit to the tray lifecycle callbacks', () => {
    const { options, template } = mount()
    const show = findItem(template, 'Show Window')!
    show.click?.({}, {} as never, {})
    expect(options.showWindow).toHaveBeenCalledTimes(1)
    const quit = findItem(template, 'Quit')!
    quit.click?.({}, {} as never, {})
    expect(options.quit).toHaveBeenCalledTimes(1)
  })

  it('surfaces a successful update check through notify', async () => {
    const { options, template } = mount()
    options.checkForUpdates.mockResolvedValue('update 0.2.0 downloaded; installs on quit')
    const check = findItem(template, 'Check for Updates…')!
    check.click?.({}, {} as never, {})
    await vi.waitFor(() => { expect(options.notify).toHaveBeenCalledWith('update 0.2.0 downloaded; installs on quit') })
  })

  it('surfaces a failed update check through notify', async () => {
    const { options, template } = mount()
    options.checkForUpdates.mockRejectedValue(new Error('channel down'))
    const check = findItem(template, 'Check for Updates…')!
    check.click?.({}, {} as never, {})
    await vi.waitFor(() => { expect(options.notify).toHaveBeenCalledWith('update check failed: channel down') })
  })

  it('wires the Shell Theme radios to the setter with the current theme checked', () => {
    const { options, template } = mount()
    const deepseek = findItem(template, 'DeepSeek')!
    const claude = findItem(template, 'Claude')!
    expect(deepseek.type).toBe('radio')
    expect(deepseek.checked).toBe(true)
    expect(claude.type).toBe('radio')
    expect(claude.checked).toBe(false)
    deepseek.click?.({}, {} as never, {})
    expect(options.setShellTheme).toHaveBeenCalledWith('deepseek')
    claude.click?.({}, {} as never, {})
    expect(options.setShellTheme).toHaveBeenCalledWith('claude')
  })

  it('builds the hamburger popup with the app actions and the current theme checked', () => {
    const options = {
      showWindow: vi.fn(),
      quit: vi.fn(),
      checkForUpdates: vi.fn(),
      notify: vi.fn(),
      shellTheme: 'claude' as const,
      setShellTheme: vi.fn(),
    }
    const menu = buildHamburgerMenu(options)
    // buildHamburgerMenu calls Menu.buildFromTemplate; inspect its latest call.
    const template = electronModule.Menu.buildFromTemplate.mock.calls.at(-1)![0]
    const labels = template.map(item => item.label).filter(Boolean)
    expect(labels).toEqual(['Show Window', 'Shell Theme', 'Check for Updates…', 'Quit'])
    const show = findItem(template, 'Show Window')!
    show.click?.({}, {} as never, {})
    expect(options.showWindow).toHaveBeenCalledTimes(1)
    const claude = findItem(template, 'Claude')!
    expect(claude.checked).toBe(true)
    const deepseek = findItem(template, 'DeepSeek')!
    deepseek.click?.({}, {} as never, {})
    expect(options.setShellTheme).toHaveBeenCalledWith('deepseek')
    expect(menu).toBeDefined()
  })
})
