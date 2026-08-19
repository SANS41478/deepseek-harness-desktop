/**
 * In-window title bar for the desktop shell: the window hides the system
 * title bar (`titleBarStyle: 'hidden'` + the Windows `titleBarOverlay` for
 * the native minimize/maximize/close buttons), and this module injects a
 * draggable bar into the loaded page once the UI is up. The bar and the
 * shifted mount root use the frontend's own design tokens, so the shell
 * adapts to light/dark themes.
 *
 * @module @deepseek-ai/dsh-desktop/main/title-bar
 */

import type { BrowserWindow } from 'electron'

/** The in-page title bar height, matching the Windows titleBarOverlay height. */
export const TITLE_BAR_HEIGHT = 36

const TITLE_BAR_CSS = `
#dsh-title-bar {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  height: ${String(TITLE_BAR_HEIGHT)}px;
  z-index: 2147483647;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 0 0 12px;
  box-sizing: border-box;
  -webkit-app-region: drag;
  user-select: none;
  background: var(--dsw-specific-sidebar-fill, var(--dsw-alias-bg-base));
  border-bottom: 1px solid var(--dsw-alias-border-l1);
  font-family: var(--dsw-font-family);
  font-size: 12px;
  color: var(--dsw-alias-label-secondary, var(--dsw-alias-label-primary));
}
#dsh-title-bar .dsh-title-bar-title {
  font-weight: 600;
  letter-spacing: 0.2px;
}
#dsh-title-bar .dsh-title-bar-app {
  opacity: 0.72;
}
#dsh-title-bar .dsh-title-bar-spacer {
  flex: 1;
}
#dsh-hamburger {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  margin-right: 4px;
  padding: 0;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--dsw-alias-label-secondary, inherit);
  font-size: 16px;
  line-height: 1;
  cursor: pointer;
  -webkit-app-region: no-drag;
  transition: background-color 0.15s ease, color 0.15s ease;
}
#dsh-hamburger:hover {
  background: var(--dsw-alias-interactive-bg-hover, rgba(0, 0, 0, 0.06));
}
/* Interactive descendants (none today) must stay clickable. */
#dsh-title-bar button,
#dsh-title-bar a {
  -webkit-app-region: no-drag;
}
`

const TITLE_BAR_HTML = `<div id="dsh-title-bar">
  <button id="dsh-hamburger" type="button" aria-label="Menu">☰</button>
  <span class="dsh-title-bar-title">DeepSeek Harness</span>
  <span class="dsh-title-bar-app">dsh desktop</span>
  <span class="dsh-title-bar-spacer"></span>
</div>`

/**
 * Shift the mount root below the injected bar so the app layout never hides
 * behind it. `#root` is the shell's full-height mount point (html/body/#root
 * all 100%); giving it a top margin and a reduced height keeps the inner
 * 100%-height frames exact.
 */
const ROOT_SHIFT_CSS = `
html, body {
  height: 100%;
}
#root {
  height: calc(100% - ${String(TITLE_BAR_HEIGHT)}px);
  margin-top: ${String(TITLE_BAR_HEIGHT)}px;
}
`

/**
 * Inject the in-window title bar into the given window's page. The styles and
 * the bar element are injected in one executeJavaScript pass (the style is a
 * real <style> node, not webContents.insertCSS, so later page mutations never
 * drop it), on each finished load (the shell may reload the page).
 * @param win - the main window.
 */
export function installTitleBar(win: BrowserWindow): void {
  win.webContents.on('did-finish-load', () => {
    void win.webContents.executeJavaScript(`
      (() => {
        if (document.getElementById('dsh-title-bar')) return
        const style = document.createElement('style')
        style.textContent = ${JSON.stringify(TITLE_BAR_CSS + ROOT_SHIFT_CSS)}
        document.head.appendChild(style)
        const host = document.createElement('div')
        host.innerHTML = ${JSON.stringify(TITLE_BAR_HTML)}
        document.body.appendChild(host.firstElementChild)
        document.getElementById('dsh-hamburger')?.addEventListener('click', () => {
          window.dshShellMenu?.open()
        })
      })()
    `, true)
  })
}
