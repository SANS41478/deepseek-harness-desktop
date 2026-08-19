# `@deepseek-ai/dsh-desktop`

English | [中文](README.zh.md)

> **Snapshot** — this repository holds the `apps/desktop` skeleton extracted from the
> [deepseek-harness](https://github.com/deepseek-ai/deepseek-harness) monorepo at commit
> `47f943859bef60e4160492346772ded9b24f765a`. The app is a workspace member there and
> imports `@deepseek-ai/dsh-*` workspace packages, so this snapshot is a reference copy,
> not a standalone build: apply it into a deepseek-harness checkout (`apps/desktop/`) to
> build and run it.

An Electron desktop shell over the DeepSeek Harness web composition. It boots the standard `web` profile **inside the Electron main process** (no separate server process, loopback only) and renders the existing `dsh-web-frontend` UI in a window. The entire frontend stack — the ~30 `dsh-client-ui-*` plugins, the session projection layer, the tool-call tree, approvals, workspaces, settings — is reused unchanged; the desktop only changes the *carrier* between the renderer and the host.

Two transports, switched by `DSH_DESKTOP_TRANSPORT`: `loopback` (default) and `ipc`. Both are end-to-end paths today; the IPC mode is the Electron-native direction and the loopback mode remains the browser-parity baseline.

## Architecture

The repo's layering note (`.agents/notes/implemented/architecture/2026-07-19-gui-layering-and-rpc-protocol.md`) reserves an "IPC bridge subclass" of `AbstractApiClient` for an Electron shell: only the `doFetch` transport aspect changes, the four-quadrant RPC contract and the base class stay untouched. This app follows that reservation.

Two transports, switched by `DSH_DESKTOP_TRANSPORT`:

| Transport | Renderer | Carrier | Status |
|---|---|---|---|
| `loopback` (default) | stock `dsh-web-frontend` dist over `http://127.0.0.1:<port>` | unchanged browser transport: HTTP `/api` + WebSocket downlinks | works today |
| `ipc` | dist over the `dsh://` custom protocol | `ElectronApiClient` (a `AbstractApiClient` subclass) over the preload `dshApi` bridge | end-to-end |

The renderer's carrier selection lives in `dsh-client-connection`: its browser apply reads the shell-published boot-time transport fact (`window.__DSH_TRANSPORT__ === 'ipc'` plus the preload `dshApi` bridge) and picks `ElectronApiClient` + the IPC generic-RPC caller, staying on `WebApiClient` for every other page. The cross-process wire contract lives in `@deepseek-ai/dsh-client-connection/wire`, imported type-only by both halves.

Both boot the identical harness tree (`src/main/startHost.ts`), which mirrors `apps/cli`'s profile boot: same profile layers, user patch layers, fail-loud guards, and HMR-watched `cordis.patch.yml`. The loopback server binds `--port 0` (OS-assigned) and serves only the window; the IPC transport disables the webserver row entirely (the tree mounts carrier-free) and serves dist, manifest, and bundles over `dsh://` through `ClientModuleRegistry.serveBundleFetch` — the same fetch-shaped handler the HTTP carrier wraps. Because the webserver bind host no longer exists in the IPC tree, the directory-picker auto row (which keys off it) is disabled there and the native interaction is pinned directly instead.

## File map

```
src/main/startHost.ts        harness boot glue (Electron-free, testable)
src/main/index.ts            Electron lifecycle, window, transport switch
src/main/ipc-bridge.ts       IPC mode: toFetchHandler(apiProxy) + stream pumps + abort
src/main/protocol.ts         IPC mode: dsh:// protocol (dist + manifest + bundles + /api/* routing)
src/main/directory-picker.ts Electron dialog backend for the directory-picker seam
src/main/updater.ts          electron-updater wiring (packaged builds only)
src/main/menu.ts             application menu (hamburger popup: Show Window, Shell Theme, updates, Quit)
src/main/tray.ts             tray icon with Show/Quit menu
src/main/title-bar.ts        in-window draggable title bar (native window controls)
src/main/desktop-adapt.ts    Electron-only chrome: fixed app frame + slim scrollbars
src/main/shell-theme.ts      switchable shell theme (deepseek / claude) + injected Claude chrome
src/main/shell-fonts.css.ts  generated self-hosted Claude fonts (@font-face data URIs)
src/preload/index.ts         contextBridge: bridge + __DSH_TRANSPORT__ fact
config/agent-presets/        shipped agent-preset roster (standard/code/minimal/cordis)
scripts/gen-icons.mjs        icon/tray PNGs (brand blue + claude terra-cotta tray)
scripts/gen-shell-fonts.mjs  regenerate shell-fonts.css.ts from @fontsource
```

### Shell theme

The desktop shell restyles only its injected chrome (title bar, scrollbars, tray) — never the shared web frontend — with a switchable theme:
- `deepseek` (default) — the title bar and scrollbars follow the page's `--dsw-*` tokens.
- `claude` — a warm, editorial, terra-cotta treatment: Newsreader wordmark, Poppins labels, Geist Mono annotation, paper surfaces, and a terra-cotta scrollbar thumb, with fonts self-hosted as base64 data URIs (no CDN).

Choose it at launch with `DSH_DESKTOP_SHELL_THEME=claude` (anything else is `deepseek`), or switch live from the in-window title bar's **hamburger (☰) menu → Shell Theme** (which also swaps the tray glyph). The OS menu bar is hidden; the hamburger opens the app menu as a native popup. The Claude CSS is scoped to `html[data-shell-theme='claude']` and injected per load, so the web content is untouched.

The renderer carrier (`ElectronApiClient`, the IPC generic-RPC caller, and the `./wire` cross-process contract) graduated into `@deepseek-ai/dsh-client-connection`; the connection apply selects it from the preload-published transport fact.

## Run

```sh
pnpm install                       # workspace member via apps/* glob
pnpm --filter @deepseek-ai/dsh-desktop dev        # loopback mode
DSH_DESKTOP_TRANSPORT=ipc pnpm --filter @deepseek-ai/dsh-desktop dev   # IPC mode
```

Both modes need `DEEPSEEK_API_KEY` (or the model config of your choice in `$DSH_HOME/settings.yaml`) exactly like `dsh web`. The `dev` script rebuilds the web frontend dist before launching; the harness reads the same `$DSH_HOME` state as the CLI, so sessions, settings, and profiles are shared with `dsh`.

## What is real vs scaffold

- **Real**: `startHost` boot; the loopback window; the IPC `dsh:fetch` handler and both stream pumps (`toFetchHandler` is the same handler the browser HTTP bridge uses); renderer abort over IPC (per-request `requestId`, main-side `AbortController`, and an `abort` bridge channel that cancels in flight); the `dsh://` protocol serving dist, manifest, bundles, and `/api/*` (including chunked `session.export` responses, streamed through `toFetchHandler` with the protocol-layer abort signal); the preload bridge; the renderer's `ElectronApiClient` selection (graduated into `dsh-client-connection`); the carrier-free IPC tree (the webserver row is disabled and the directory picker is the Electron dialog backend, `src/main/directory-picker.ts`, pinned with the native client surface); the application menu and tray (hide-to-tray close, Show Window, Check for Updates); the electron-builder packaging flow (`pnpm package` / `pnpm package:win`) with NSIS/dmg installer targets, icons, and `electron-updater`; lifecycle/teardown.
- **Deferred (see follow-ups)**: code signing on a CI machine with the `CSC_*` environment (local `package:win` runs unsigned by design, `--config.win.signAndEditExecutable=false`).

## Known gaps (IPC mode)

None today. Renderer `AbortSignal` crosses IPC via `requestId`/`abort`, and `/api/*` (including `session.export`) is routed through the `dsh://` protocol to `toFetchHandler`, which streams the response body with the protocol-layer abort signal.

## Follow-ups (codebase changes this app does not make yet)

1. **Packaging**: auto-update, installer targets (NSIS/dmg), icons, and the electron-updater publish config are in place; code signing activates when `CSC_*` is set (CI). The unpacked win directory from `pnpm package:win` is unsigned locally. Native modules (`node-pty`, `koffi`) are unpacked from the asar (`asarUnpack`).

The IPC tree drops the HTTP carrier entirely: the webserver row is disabled, and the client-modules graph and bundles are served through `serveBundleFetch` (the same fetch-shaped handler the HTTP carrier wraps). The directory picker is the Electron dialog backend (`dialog.showOpenDialog`), pinned in place of the auto row. See the [Agent Note](../../.agents/notes/implemented/feature/2026-08-16-electron-ipc-transport-seam.md).

## Repository gates

A real PR for this app must also register the project in the appropriate tsconfig aggregate (host side, per the two-aggregate rule), wire `verify-package-invariants` if the app is treated as a package, and pass `pnpm run typecheck && pnpm run lint` plus the relevant `test:gui`/`test:web` lanes.
