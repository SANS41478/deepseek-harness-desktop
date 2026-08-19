/**
 * Desktop-native chrome for the shell: an Electron-only CSS layer injected into
 * the loaded page (like title-bar.ts) that removes the web page's browser-y
 * traces so the UI reads as a native desktop app rather than a browser page.
 *
 * The shared web frontend keeps its own 8px themed scrollbar skin; this layer
 * slims it and makes the thumb semi-transparent for a desktop feel, and keeps
 * the frontend's layout-alignment token (`--dsh-scrollbar-width`, which the
 * overlay-composer seat reads) in step with the slimmer bar. All rules use the
 * frontend's own `--dsw-*` / `--dsh-scrollbar-*` tokens, so the shell adapts to
 * light/dark themes exactly like the title bar.
 *
 * @module @deepseek-ai/dsh-desktop/main/desktop-adapt
 */

import type { BrowserWindow } from 'electron'

const DESKTOP_ADAPT_CSS = `
/* Slim desktop scrollbars: thinner than the web 8px skin and semi-transparent,
   so a scrolling panel reads native instead of browser-y. color-mix keeps the
   frontend's elevation-token rebinds (menu/popover/dialog rebind the thumb
   colour on their own containers) while reducing the visible weight. */
::-webkit-scrollbar {
  width: 6px;
  height: 6px;
}
::-webkit-scrollbar-thumb {
  border-radius: 3px;
  background: color-mix(in srgb, var(--dsh-scrollbar-thumb, var(--dsw-alias-scrollbar-bg-l1)) 60%, transparent);
}
::-webkit-scrollbar-thumb:hover {
  background: var(--dsh-scrollbar-thumb-hover, var(--dsw-alias-scrollbar-hover-l1));
}
/* Keep the frontend's alignment token in step with the slimmer bar. The shared
   web skin declares 8px on body; re-declaring later wins the cascade. */
body {
  --dsh-scrollbar-width: 6px;
}
/* No web page chrome: the app fills the frame edge to edge. The desktop shell
   is a fixed application frame — the document never scrolls as a page, only
   inner panels (the conversation transcript) do. Stating overflow:hidden on
   the root guarantees no whole-page scrollbar in any view, and clips nothing
   the app's own scroll containers do not already handle. */
html, body {
  margin: 0;
  height: 100%;
  overflow: hidden;
}
`

/**
 * Inject the desktop chrome layer into the given window's page. Applied on each
 * finished load (the shell may reload the page), appending a real `<style>`
 * node so later page mutations never drop it.
 * @param win - the main window.
 */
export function installDesktopAdapt(win: BrowserWindow): void {
  win.webContents.on('did-finish-load', () => {
    void win.webContents.executeJavaScript(`
      (() => {
        if (document.getElementById('dsh-desktop-adapt')) return
        const style = document.createElement('style')
        style.id = 'dsh-desktop-adapt'
        style.textContent = ${JSON.stringify(DESKTOP_ADAPT_CSS)}
        document.head.appendChild(style)
      })()
    `, true)
  })
}
