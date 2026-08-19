/**
 * Switchable desktop-shell theme. The Electron shell injects its own chrome
 * (in-window title bar, slim scrollbars) into the loaded page; a shell theme
 * restyles that injected chrome without touching the shared web frontend.
 *
 * Two themes:
 * - `deepseek` (default) — the title bar and scrollbars follow the page's
 *   own `--dsw-*` tokens.
 * - `claude` — a warm, editorial, terra-cotta treatment (the Claude design
 *   language): Newsreader wordmark, Poppins labels, paper surfaces, and a
 *   terra-cotta scrollbar thumb, self-hosted via `SHELL_FONTS_CSS`.
 *
 * The Claude CSS is scoped to `html[data-shell-theme='claude']`, so the style
 * node can always be present and switching only toggles that attribute. The
 * window's chrome (menu/tray) follows through the caller's `onSwitch`.
 *
 * @module @deepseek-ai/dsh-desktop/main/shell-theme
 */

import type { BrowserWindow } from 'electron'
import { SHELL_FONTS_CSS } from './shell-fonts.css.ts'

/** The desktop shell's switchable visual themes. */
export type ShellTheme = 'deepseek' | 'claude'

/** The style-node id the Claude shell CSS is injected under. */
const CLAUDE_STYLE_ID = 'dsh-shell-claude'

/** The document attribute carrying the active shell theme. */
const THEME_ATTR = 'data-shell-theme'

const CLAUDE_THEME_CSS = `
/* tokens — light (page dark is on body[data-ds-dark-theme]) */
html[data-shell-theme='claude'] {
  --clsh-accent: #c96442;
  --clsh-accent-strong: #b0562f;
  --clsh-bg: #faf9f5;
  --clsh-surface: #f5f4ee;
  --clsh-border: #e3e0d4;
  --clsh-text: #3d3929;
  --clsh-text-muted: #6e6d68;
  --clsh-font-display: 'Newsreader', Georgia, ui-serif, serif;
  --clsh-font-ui: 'Poppins', ui-sans-serif, system-ui, sans-serif;
  --clsh-font-code: 'Geist Mono', ui-monospace, monospace;
}
html[data-shell-theme='claude'] body[data-ds-dark-theme] {
  --clsh-accent: #d97757;
  --clsh-accent-strong: #e08d6f;
  --clsh-bg: #262624;
  --clsh-surface: #2c2c2b;
  --clsh-border: #3e3e38;
  --clsh-text: #f1f1ef;
  --clsh-text-muted: #b7b5a9;
}

/* title bar — editorial wordmark in Newsreader, compact labels in Poppins */
html[data-shell-theme='claude'] #dsh-title-bar {
  background: var(--clsh-bg);
  border-bottom-color: var(--clsh-border);
  color: var(--clsh-text);
  font-family: var(--clsh-font-ui);
}
html[data-shell-theme='claude'] #dsh-title-bar .dsh-title-bar-title {
  font-family: var(--clsh-font-display);
  font-weight: 500;
  letter-spacing: 0.01em;
  color: var(--clsh-accent);
}
html[data-shell-theme='claude'] #dsh-title-bar .dsh-title-bar-app {
  font-family: var(--clsh-font-code);
  font-size: 10px;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--clsh-text-muted);
}
html[data-shell-theme='claude'] #dsh-hamburger {
  color: var(--clsh-text-muted);
}
html[data-shell-theme='claude'] #dsh-hamburger:hover {
  background: var(--clsh-surface);
  color: var(--clsh-text);
}

/* scrollbars — terra-cotta thumb, same slim 6px geometry as the base layer */
html[data-shell-theme='claude'] ::-webkit-scrollbar-thumb {
  background: color-mix(in srgb, var(--clsh-accent) 45%, transparent);
}
html[data-shell-theme='claude'] ::-webkit-scrollbar-thumb:hover {
  background: var(--clsh-accent);
}
`

/**
 * Inject the Claude shell CSS (fonts + scoped overrides) into the window's
 * page if it is not already present, then set the shell-theme attribute.
 * Idempotent: safe to call on every load and on every theme switch.
 * @param win - the main window.
 * @param theme - the theme to apply.
 */
function applyShellTheme(win: BrowserWindow, theme: ShellTheme): void {
  void win.webContents.executeJavaScript(`
    (() => {
      if (!document.getElementById('${CLAUDE_STYLE_ID}')) {
        const style = document.createElement('style')
        style.id = '${CLAUDE_STYLE_ID}'
        style.textContent = ${JSON.stringify(SHELL_FONTS_CSS + '\n' + CLAUDE_THEME_CSS)}
        document.head.appendChild(style)
      }
      const root = document.documentElement
      if ('${theme}' === 'claude') root.setAttribute('${THEME_ATTR}', 'claude')
      else root.removeAttribute('${THEME_ATTR}')
    })()
  `, true)
}

/** Resolve the shell theme from the environment; anything but 'claude' is deepseek. */
export function resolveShellTheme(): ShellTheme {
  return process.env.DSH_DESKTOP_SHELL_THEME === 'claude' ? 'claude' : 'deepseek'
}

/** The controller returned by {@link installShellTheme}. */
export interface ShellThemeController {
  /** The currently active shell theme. */
  current(): ShellTheme
  /** Switch the shell theme live and notify the caller (menu/tray). */
  setTheme(theme: ShellTheme): void
}

/**
 * Install switchable shell-theme support on the main window.
 * @param win - the main window.
 * @param initial - the theme to start with (from the environment).
 * @param onSwitch - invoked after a theme change so the caller can restyle
 *   menu/tray; not called for the initial application.
 * @returns the theme controller.
 */
export function installShellTheme(
  win: BrowserWindow,
  initial: ShellTheme,
  onSwitch: (theme: ShellTheme) => void,
): ShellThemeController {
  let current = initial
  win.webContents.on('did-finish-load', () => { applyShellTheme(win, current) })
  return {
    current: () => current,
    setTheme: (theme: ShellTheme) => {
      if (theme === current) return
      current = theme
      applyShellTheme(win, current)
      onSwitch(theme)
    },
  }
}
