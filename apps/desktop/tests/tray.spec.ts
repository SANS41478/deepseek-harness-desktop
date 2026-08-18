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
    const dispose = installTray(options)
    expect(electronModule.nativeImage.createFromPath).toHaveBeenCalled()
    const tray = latestTray()
    expect(tray.setToolTip).toHaveBeenCalledWith('DeepSeek Harness')
    const template = electronModule.Menu.buildFromTemplate.mock.calls.at(-1)![0]
    const labels = template.map(item => item.label).filter(Boolean)
    expect(labels).toEqual(['Show DeepSeek Harness', 'Quit'])
    expect(tray.setContextMenu).toHaveBeenCalledWith(template)
    dispose()
    expect(tray.destroy).toHaveBeenCalled()
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
