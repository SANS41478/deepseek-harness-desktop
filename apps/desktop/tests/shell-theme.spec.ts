/**
 * Shell theme: the env resolves the initial theme, the controller injects the
 * Claude CSS scoped to the data attribute, and setTheme toggles the attribute
 * and notifies the caller (menu/tray) exactly once per real change.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { installShellTheme, resolveShellTheme } from '../src/main/shell-theme.ts'

/** A minimal fake webContents: records listeners and executeJavaScript calls. */
function fakeWin() {
  const listeners: Record<string, (() => void)[]> = {}
  const exec = vi.fn((_script: string) => Promise.resolve(undefined))
  const webContents = {
    on: vi.fn((event: string, cb: () => void) => {
      (listeners[event] ??= []).push(cb)
    }),
    executeJavaScript: exec,
  }
  return {
    webContents,
    exec,
    fire: (event: string) => { for (const cb of listeners[event] ?? []) cb() },
  }
}

describe('resolveShellTheme', () => {
  const previous = process.env.DSH_DESKTOP_SHELL_THEME
  afterEach(() => {
    if (previous === undefined) delete process.env.DSH_DESKTOP_SHELL_THEME
    else process.env.DSH_DESKTOP_SHELL_THEME = previous
  })
  it('defaults to deepseek when unset', () => {
    delete process.env.DSH_DESKTOP_SHELL_THEME
    expect(resolveShellTheme()).toBe('deepseek')
  })
  it('resolves claude when requested', () => {
    process.env.DSH_DESKTOP_SHELL_THEME = 'claude'
    expect(resolveShellTheme()).toBe('claude')
  })
})

describe('installShellTheme', () => {
  it('applies the theme on load and toggles it on setTheme, notifying once per change', () => {
    const { webContents, exec, fire } = fakeWin()
    const onSwitch = vi.fn()
    const controller = installShellTheme({ webContents } as never, 'deepseek', onSwitch)

    fire('did-finish-load')
    expect(exec).toHaveBeenCalledTimes(1)
    const applied = exec.mock.calls[0][0]
    expect(applied).toContain('dsh-shell-claude')
    expect(applied).toContain("removeAttribute('data-shell-theme')")

    controller.setTheme('claude')
    expect(onSwitch).toHaveBeenCalledTimes(1)
    expect(onSwitch).toHaveBeenCalledWith('claude')
    expect(exec).toHaveBeenCalledTimes(2)
    const switched = exec.mock.calls[1][0]
    expect(switched).toContain("setAttribute('data-shell-theme', 'claude')")

    controller.setTheme('claude')
    expect(onSwitch).toHaveBeenCalledTimes(1)
    expect(exec).toHaveBeenCalledTimes(2)

    controller.setTheme('deepseek')
    expect(onSwitch).toHaveBeenCalledTimes(2)
    expect(onSwitch).toHaveBeenCalledWith('deepseek')
    const back = exec.mock.calls[2][0]
    expect(back).toContain("removeAttribute('data-shell-theme')")
  })
})
