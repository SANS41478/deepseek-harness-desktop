/**
 * Electron directory-picker backend: registers `ctx.directoryPicker` with the
 * `native` capability, opening one system folder dialog per pick through
 * Electron's own `dialog.showOpenDialog`. Replaces the koffi/osascript/zenity
 * backends inside the desktop shell, where the Electron APIs are the native
 * ones. The capability object is stable for the service lifetime.
 *
 * The dialog opens without a parent window (Electron allows a window-less
 * modal on every platform); abort resolves the pending pick as a cancellation.
 * The `electron` module is resolved lazily so the module loads in plain-Node
 * harnesses too (electron is CommonJS and rejects ESM named imports outside
 * the Electron runtime); only invoking `pick` requires the shell.
 *
 * @module @deepseek-ai/dsh-desktop/main/directory-picker
 */

import { createRequire } from 'node:module'
import { DirectoryPicker } from '@deepseek-ai/dsh-host-directory-picker'
import type {
  DirectoryPickerCapability,
  DirectoryPickerNativeCapability,
} from '@deepseek-ai/dsh-host-directory-picker'

/** Electron's dialog surface, resolved lazily (plain-Node harnesses never invoke pick). */
type ElectronDialog = typeof import('electron').dialog

/**
 * The Electron native interaction: one system folder chooser on the host
 * display. Abort resolves the pending pick as a cancellation (a modal dialog
 * cannot be force-closed; the caller's abort races the dialog's own
 * cancellation).
 */
export default class ElectronDirectoryPicker extends DirectoryPicker {
  private readonly nativeCapability: DirectoryPickerNativeCapability = {
    kind: 'native',
    pick: (signal: AbortSignal) => this.pick(signal),
  }

  /** Open one dialog and resolve with the chosen directory (null on cancel). */
  private async pick(signal: AbortSignal): Promise<string | null> {
    if (signal.aborted) return null
    const electron = createRequire(import.meta.url)('electron') as { dialog: ElectronDialog }
    const dialog = electron.dialog
    try {
      const result = await dialog.showOpenDialog({
        title: 'Select Workspace Directory',
        properties: ['openDirectory', 'createDirectory'],
      })
      const first = result.filePaths[0]
      return result.canceled || first === undefined ? null : first
    } catch {
      // A dialog error (app shutting down mid-pick) is a cancellation.
      return null
    }
  }

  /**
   * The native interaction capability.
   * @returns the stable `native` capability object.
   */
  capability(): DirectoryPickerCapability {
    return this.nativeCapability
  }
}
