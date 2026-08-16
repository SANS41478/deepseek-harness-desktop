# `@deepseek-ai/dsh-desktop`

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

Both boot the identical harness tree (`src/main/startHost.ts`), which mirrors `apps/cli`'s profile boot: same profile layers, user patch layers, fail-loud guards, and HMR-watched `cordis.patch.yml`. The loopback server binds `--port 0` (OS-assigned) and serves only the window; the IPC mode additionally keeps it as the activation anchor for the `client-modules` node half (which today injects `webServer` — see Follow-ups).

## File map

```
src/main/startHost.ts        harness boot glue (Electron-free, testable)
src/main/index.ts            Electron lifecycle, window, transport switch
src/main/ipc-bridge.ts       IPC mode: toFetchHandler(apiProxy) + stream pumps
src/main/protocol.ts         IPC mode: dsh:// protocol (dist + manifest + bundles)
src/preload/index.ts         contextBridge: bridge + __DSH_TRANSPORT__ fact
```

The renderer carrier (`ElectronApiClient`, the IPC generic-RPC caller, and the `./wire` cross-process contract) graduated into `@deepseek-ai/dsh-client-connection`; the connection apply selects it from the preload-published transport fact.

## Run

```sh
pnpm install                       # workspace member via apps/* glob
pnpm --filter @deepseek-ai/dsh-desktop dev        # loopback mode
DSH_DESKTOP_TRANSPORT=ipc pnpm --filter @deepseek-ai/dsh-desktop dev   # IPC mode
```

Both modes need `DEEPSEEK_API_KEY` (or the model config of your choice in `$DSH_HOME/settings.yaml`) exactly like `dsh web`. The `dev` script rebuilds the web frontend dist before launching; the harness reads the same `$DSH_HOME` state as the CLI, so sessions, settings, and profiles are shared with `dsh`.

## What is real vs scaffold

- **Real**: `startHost` boot; the loopback window; the IPC `dsh:fetch` handler and both stream pumps (`toFetchHandler` is the same handler the browser HTTP bridge uses); the `dsh://` protocol serving dist, manifest, and bundles; the preload bridge; the renderer's `ElectronApiClient` selection (graduated into `dsh-client-connection`); lifecycle/teardown.
- **Deferred (see follow-ups)**: dropping the loopback HTTP server in IPC mode, chunked export over IPC, and native dialogs.

## Known gaps (IPC mode)

- **Renderer AbortSignal does not cross IPC**: unary cancellation degrades to main-side completion; stream cancellation works (the close channel aborts the pump).
- **`/api/session.export` is not chunked over IPC**: the bridge buffers the whole response body, which is fine for unary RPC but wrong for large exports; a chunked transfer channel is the follow-up.
- **Loopback mode keeps the HTTP server alive** even though only the window talks to it; the clean end-state (below) removes it.

## Follow-ups (codebase changes this app does not make yet)

1. **Relax `ClientModuleRegistry.inject`** (`packages/client/modules`): make `webServer` optional and expose the manifest/bundle serving through a plain fetch handler, so the IPC mode can drop the HTTP carrier entirely (the documented "Electron does not reuse it" end-state).
2. **Native dialogs**: an Electron backend for the directory-picker seam (`dialog.showOpenDialog`) and native openers, replacing `dsh-host-directory-picker-native` where Electron's own APIs fit.
3. **Packaging**: electron-builder targets, native-module unpacking (`node-pty`, `koffi`), code signing, auto-update; the `build` field in `package.json` is the starting point.

The renderer transport seam (selecting `ElectronApiClient` from a boot-time transport fact) shipped; see the [Agent Note](../../.agents/notes/implemented/feature/2026-08-16-electron-ipc-transport-seam.md).

## Repository gates

A real PR for this app must also register the project in the appropriate tsconfig aggregate (host side, per the two-aggregate rule), wire `verify-package-invariants` if the app is treated as a package, and pass `pnpm run typecheck && pnpm run lint` plus the relevant `test:gui`/`test:web` lanes.
