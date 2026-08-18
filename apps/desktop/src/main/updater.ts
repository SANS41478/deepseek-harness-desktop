/**
 * Auto-update wiring for packaged builds. Runs only when `isPackaged` — dev
 * builds have no release channel to check. The updater instance is injected
 * so the two branches (packaged vs dev) are testable with a stub.
 *
 * @module @deepseek-ai/dsh-desktop/main/updater
 */

import type { AppUpdater } from 'electron-updater'

/** The updater surface the main process consumes. */
export interface UpdaterController {
  /** Check for a release and download it when found; resolves with a status line. */
  checkForUpdates(): Promise<string>
  /** Detach the error listener. */
  dispose(): void
}

/**
 * Install the auto-update flow.
 * @param updater - the electron-updater instance (`autoUpdater`).
 * @param isPackaged - whether the app runs packaged (dev builds skip the channel).
 * @returns the controller.
 */
export function installUpdater(updater: AppUpdater, isPackaged: boolean): UpdaterController {
  if (!isPackaged) {
    return {
      checkForUpdates: () => Promise.resolve('auto-update is disabled outside packaged builds'),
      dispose: () => {},
    }
  }
  updater.autoDownload = true
  updater.autoInstallOnAppQuit = true
  const onError = (error: unknown): void => {
    console.error('dsh-desktop: update check failed:', error)
  }
  updater.on('error', onError)
  return {
    async checkForUpdates() {
      const result = await updater.checkForUpdates()
      if (result === null) return 'no update available'
      return `update ${result.updateInfo.version} downloaded; installs on quit`
    },
    dispose() {
      updater.removeListener('error', onError)
    },
  }
}
