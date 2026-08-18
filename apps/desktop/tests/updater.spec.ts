/**
 * Auto-update wiring: dev builds skip the channel, packaged builds download
 * on check, and errors surface through the listener the controller owns.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { installUpdater } from '../src/main/updater.ts'
import type { AppUpdater } from 'electron-updater'

/** A stub AppUpdater: records options, emits events, drives check results. */
class StubUpdater {
  readonly listeners = new Map<string, ((...args: never[]) => void)[]>()
  autoDownload = false
  autoInstallOnAppQuit = false
  checkResult: unknown = null
  checkError: unknown = undefined
  on(event: string, listener: (...args: never[]) => void): this {
    const list = this.listeners.get(event) ?? []
    list.push(listener)
    this.listeners.set(event, list)
    return this
  }
  removeListener(event: string, listener: (...args: never[]) => void): this {
    const list = this.listeners.get(event) ?? []
    this.listeners.set(event, list.filter(l => l !== listener))
    return this
  }
  emit(event: string, ...args: never[]): void {
    for (const listener of this.listeners.get(event) ?? []) listener(...args)
  }
  async checkForUpdates() {
    if (this.checkError !== undefined) throw this.checkError
    return this.checkResult
  }
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('installUpdater', () => {
  it('disables the channel in dev builds', async () => {
    const updater = new StubUpdater()
    const controller = installUpdater(updater as unknown as AppUpdater, false)
    await expect(controller.checkForUpdates()).resolves.toBe('auto-update is disabled outside packaged builds')
    expect(updater.autoDownload).toBe(false)
    expect(updater.listeners.has('error')).toBe(false)
    expect(() => { controller.dispose() }).not.toThrow()
  })

  it('downloads an available update and reports it installs on quit', async () => {
    const updater = new StubUpdater()
    updater.checkResult = { updateInfo: { version: '0.2.0' } }
    const controller = installUpdater(updater as unknown as AppUpdater, true)
    await expect(controller.checkForUpdates()).resolves.toBe('update 0.2.0 downloaded; installs on quit')
    expect(updater.autoDownload).toBe(true)
    expect(updater.autoInstallOnAppQuit).toBe(true)
  })

  it('reports no update for an empty check result', async () => {
    const updater = new StubUpdater()
    const controller = installUpdater(updater as unknown as AppUpdater, true)
    await expect(controller.checkForUpdates()).resolves.toBe('no update available')
  })

  it('propagates a failed check for the caller to surface', async () => {
    const updater = new StubUpdater()
    updater.checkError = new Error('channel down')
    const controller = installUpdater(updater as unknown as AppUpdater, true)
    await expect(controller.checkForUpdates()).rejects.toThrow('channel down')
  })

  it('logs updater errors through the owned listener and detaches on dispose', () => {
    const updater = new StubUpdater()
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const controller = installUpdater(updater as unknown as AppUpdater, true)
    updater.emit('error', new Error('signature mismatch'))
    expect(log).toHaveBeenCalledTimes(1)
    controller.dispose()
    updater.emit('error', new Error('again'))
    expect(log).toHaveBeenCalledTimes(1)
    log.mockRestore()
  })
})
