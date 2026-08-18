/**
 * Electron directory-picker backend: the native capability opens one system
 * dialog through Electron's dialog module (resolved lazily), resolves with the
 * chosen path, and reports cancellation for cancel, empty selection, and
 * dialog errors. Abort before open resolves as cancellation without touching
 * Electron.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { DirectoryPickerNativeCapability } from '@deepseek-ai/dsh-host-directory-picker'
import ElectronDirectoryPicker from '../src/main/directory-picker.ts'

type OpenDialogResult = { canceled: boolean; filePaths: string[] }

const electronModule = vi.hoisted(() => ({
  dialog: {
    showOpenDialog: vi.fn<(options: unknown) => Promise<OpenDialogResult>>(),
  },
}))

// The picker resolves electron lazily via createRequire; mock the resolver so
// the dialog surface is test-driven without an Electron runtime.
vi.mock('node:module', async (importOriginal) => {
  const original = await importOriginal<typeof import('node:module')>()
  return {
    createRequire: () => (specifier: string) => {
      if (specifier === 'electron') return electronModule
      throw new Error(`unexpected require in test: ${specifier}`)
    },
    default: original,
  }
})

afterEach(() => {
  vi.clearAllMocks()
})

/** Mount the backend as a plugin and resolve its registered capability. */
async function mount(): Promise<ElectronDirectoryPicker> {
  const ctx = new Context()
  const fiber = ctx.plugin(ElectronDirectoryPicker)
  await fiber.await()
  return ctx.get('directoryPicker') as ElectronDirectoryPicker
}

/** The native capability (the only kind this backend provides). */
function nativeCapability(picker: ElectronDirectoryPicker): DirectoryPickerNativeCapability {
  const capability = picker.capability()
  if (capability.kind !== 'native') throw new Error(`expected native capability, got ${capability.kind}`)
  return capability
}

describe('ElectronDirectoryPicker', () => {
  it('registers ctx.directoryPicker with a stable native capability', async () => {
    const picker = await mount()
    expect(picker).toBeInstanceOf(ElectronDirectoryPicker)
    expect(picker.capability().kind).toBe('native')
    expect(picker.capability()).toBe(picker.capability())
  })

  it('opens the dialog and resolves with the chosen path', async () => {
    electronModule.dialog.showOpenDialog.mockResolvedValueOnce({
      canceled: false,
      filePaths: ['C:\\work\\project'],
    })
    const picker = await mount()
    const abort = new AbortController()
    await expect(nativeCapability(picker).pick(abort.signal)).resolves.toBe('C:\\work\\project')
    expect(electronModule.dialog.showOpenDialog).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Select Workspace Directory',
      properties: ['openDirectory', 'createDirectory'],
    }))
  })

  it('resolves null on dialog cancel and on an empty selection', async () => {
    const picker = await mount()
    const abort = new AbortController()
    electronModule.dialog.showOpenDialog.mockResolvedValueOnce({ canceled: true, filePaths: [] })
    await expect(nativeCapability(picker).pick(abort.signal)).resolves.toBeNull()
    electronModule.dialog.showOpenDialog.mockResolvedValueOnce({ canceled: false, filePaths: [] })
    await expect(nativeCapability(picker).pick(abort.signal)).resolves.toBeNull()
  })

  it('resolves null when the dialog throws (shutdown mid-pick)', async () => {
    electronModule.dialog.showOpenDialog.mockRejectedValueOnce(new Error('window destroyed'))
    const picker = await mount()
    const abort = new AbortController()
    await expect(nativeCapability(picker).pick(abort.signal)).resolves.toBeNull()
  })

  it('resolves null immediately when the signal is already aborted', async () => {
    const picker = await mount()
    const abort = new AbortController()
    abort.abort()
    await expect(nativeCapability(picker).pick(abort.signal)).resolves.toBeNull()
    expect(electronModule.dialog.showOpenDialog).not.toHaveBeenCalled()
  })
})
