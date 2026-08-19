/**
 * Tray icon: the context menu carries Show/Quit wired to the app callbacks,
 * and a left click brings the window back.
 */
import { describe, expect, it, vi } from 'vitest'
import { installTray } from '../src/main/tray.ts'
import type { MenuItemConstructorOptions } from 'electron'

const electronModule = vi.hoisted(() => {
  const instances: Tray[] = []
  class Tray {
    setToolTip = vi.fn()
    setContextMenu = vi.fn()
    setImage = vi.fn()
    on = vi.fn()
    destroy = vi.fn()
    constructor() {
      instances.push(this)
    }
  }
  return {
    nativeImage: { createFromPath: vi.fn(() => ({})) },
    Menu: { buildFromTemplate: vi.fn((template: MenuItemConstructorOptions[]) => template) },
    Tray,
    trayInstances: instances,
  }
})

vi.mock('electron', () => electronModule)

/** The most recently created tray. */
function latestTray() {
  return electronModule.trayInstances.at(-1)!
}

describe('installTray', () => {
  it('creates the tray with the app tooltip and a Show/Quit menu', () => {
    const options = { showWindow: vi.fn(), quit: vi.fn() }
    const controller = installTray(options)
    expect(electronModule.nativeImage.createFromPath).toHaveBeenCalled()
    const tray = latestTray()
    expect(tray.setToolTip).toHaveBeenCalledWith('DeepSeek Harness')
    const template = electronModule.Menu.buildFromTemplate.mock.calls.at(-1)![0]
    const labels = template.map(item => item.label).filter(Boolean)
    expect(labels).toEqual(['Show DeepSeek Harness', 'Quit'])
    expect(tray.setContextMenu).toHaveBeenCalledWith(template)
    controller.dispose()
    expect(tray.destroy).toHaveBeenCalled()
  })

  it('swaps the glyph to the Claude terra-cotta variant and back on setTheme', () => {
    const options = { showWindow: vi.fn(), quit: vi.fn() }
    const controller = installTray(options)
    const before = electronModule.nativeImage.createFromPath.mock.calls.length
    controller.setTheme('claude')
    controller.setTheme('deepseek')
    const calls = electronModule.nativeImage.createFromPath.mock.calls.slice(before)
    const paths = calls.map(call => String(call[0]))
    expect(paths.some(p => p.endsWith('tray-claude.png'))).toBe(true)
    expect(paths.some(p => p.endsWith('tray.png'))).toBe(true)
    const tray = latestTray()
    expect(tray.setImage).toHaveBeenCalledTimes(2)
  })

  it('wires the menu items to the app callbacks and brings the window back on click', () => {
    const options = { showWindow: vi.fn(), quit: vi.fn() }
    installTray(options)
    const template = electronModule.Menu.buildFromTemplate.mock.calls.at(-1)![0]
    const labelled = template.filter(item => item.type !== 'separator')
    labelled[0].click?.()
    expect(options.showWindow).toHaveBeenCalledTimes(1)
    labelled[1].click?.()
    expect(options.quit).toHaveBeenCalledTimes(1)
  })
})
