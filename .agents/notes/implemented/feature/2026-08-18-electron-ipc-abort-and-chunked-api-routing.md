# Agent Note: Electron IPC abort and chunked /api routing, with shell polish

Status: implemented

English | [中文](2026-08-18-electron-ipc-abort-and-chunked-api-routing.zh.md)

## Problem

The IPC transport note ([electron-ipc-transport-seam](2026-08-16-electron-ipc-transport-seam.md)) shipped `DSH_DESKTOP_TRANSPORT=ipc` end to end but documented two open gaps. First, the renderer's `AbortSignal` never crossed IPC: `ElectronApiClient.doFetch` and the generic RPC caller dropped the signal, so unary cancellation degraded to main-side completion (the fetch kept running to completion on the main process). Second, `/api/session.export` was not chunked over IPC: the bridge serialized the whole response body into one reply, buffering large exports in the renderer. The desktop shell also had no packaging beyond the unpacked directory and no window-chrome UX: no installer targets, no auto-update, no application menu or tray, and closing the window killed the app instead of hiding it.

## Decision

The two IPC gaps close in the connection package and the shell, and the shell gains the packaging and window UX.

- **Renderer abort crosses IPC by request id.** `src/wire.ts` adds a required `requestId` to `DshFetchRequest` and an `abort(requestId: string): void` method to `DshApiBridge`. New `src/client/bridge-fetch.ts` exports `bridgeFetch(bridge, request, signal?)` — a `fetch`-shaped helper that serializes into `bridge.fetch` (with the request id), forwards renderer-side `AbortSignal` events by calling `bridge.abort(requestId)`, and rejects with `abortError(signal)` when aborted. `ElectronApiClient.doFetch` and `createIpcConnectionRpc` use it, so unary cancellation now propagates to the main process instead of degrading to completion. The preload exposes `abort` as `ipcRenderer.send('dsh:fetch:abort', requestId)`; the main-process `dsh:fetch` handler keys an inflight `Map<requestId, AbortController>`, passes `controller.signal` into `new Request(...)`, and the `dsh:fetch:abort` listener aborts the matching controller. Dispose aborts every inflight controller.
- **Chunked /api responses ride the `dsh://` protocol.** `src/main/protocol.ts` extracts a pure, Electron-free `routeDshRequest(request, deps)` with a `DshProtocolDeps` (dist root, modules, api handler); `registerDshProtocol` assembles the deps and `protocol.handle`s it. A GET or HEAD under `/api/*` rebuilds the request (`new Request(new URL(request.url), { method, headers, signal: request.signal })`) and hands it to `toFetchHandler(api)`, so `/api/session.export` streams through the same fetch-shaped handler the browser HTTP carrier wraps, body included, with the protocol-layer abort signal live. The 403 traversal guard remains as defense in depth: `new URL()` normalizes encoded dots, so the encoded-dot attempt 404s before the guard is reachable.
- **Packaging.** `scripts/gen-icons.mjs` renders `build/icon.png` and `build/tray.png` (pure Node PNG encoder, no binary assets). `package.json` adds `electron-updater`, installer targets (`win.target ['dir','nsis']` with oneClick-off installer options, `mac.target ['dmg','zip']` with hardened runtime), a GitHub `publish` provider, and `directories.buildResources 'build'`. `package-app.mjs` runs electron-builder with `--publish never` (the `publish` config feeds the embedded `app-update.yml` for electron-updater but must not make a local build demand `GH_TOKEN`; a CI release runs its own publish invocation with the token) and keeps `signAndEditExecutable=false` on `--win` (unsigned locally, `CSC_*` activates signing on CI). `scripts/flatten-junctions.mjs` detects junctions with Node's directory entries (`Dirent.isSymbolicLink` + `realpathSync`) instead of shelling out to PowerShell — PowerShell 5.1 mangles non-ASCII junction targets through the OEM code page, so `cpSync` hit `ENOENT` for the vendored `cosmokit`/`schemastery` links on Chinese paths. `src/main/updater.ts` provides `installUpdater(updater, isPackaged)` returning `{ checkForUpdates, dispose }`; dev builds resolve to "auto-update is disabled outside packaged builds" so the app runs without a network or a dist. The main entry checks once on startup in packaged builds and exposes Check for Updates in the Help menu. `electron-updater`'s named export `autoUpdater` is not statically detectable by Electron's ESM loader (its CJS `out/main.js` star-re-exports `./types`), so `src/main/index.ts` resolves it through `createRequire(import.meta.url)('electron-updater')` — the repo's established CJS interop pattern (web-app, client-modules) — instead of a named `import` that fails at runtime.
- **Window UI.** `src/main/menu.ts` installs the application menu (edit/view/window roles, Show Window `CmdOrCtrl+Shift+W`, Check for Updates); `src/main/tray.ts` installs the tray icon with Show/Quit menu and a click that brings the window back. Closing the window hides it (a `quitting` flag lets real shutdown bypass the close handler), and `second-instance`/`activate`/tray restore the window. Shutdown disposes the tray, the host tree, and quits.

## Alternatives considered

### A dedicated abort channel on the stream wire instead of a request-id abort method

The bridge already carries pushed stream channels whose close aborts stream pumps, so a generic "cancel this request" frame could have piggybacked on the stream wire. But the renderer's `AbortSignal` is the caller's cancellation surface and the request id is already serialized in `DshFetchRequest`; a separate `abort(requestId)` bridge method keeps the abort keyed to the fetch the renderer actually issued and needs no correlation machinery. Chosen.

### A chunked transfer frame on `DshStreamChannel` instead of `/api` protocol routing

A new stream-frame kind (e.g. a body chunk frame) would be a third fetch transport with its own framing, sequence, and error semantics, duplicating `toFetchHandler`. Routing `/api/*` through the existing `dsh://` protocol reuses the exact handler the HTTP carrier wraps — streaming, status/headers, and error mapping come for free — and the protocol-layer `request.signal` carries the abort. Chosen.

### Keep the window close quits and menu/tray as scaffold

Closing to the tray and a menu/tray were listed follow-ups, but the tray is the shell's primary lifecycle surface on Windows/macOS (dock/alt-tab parity); shipping the IPC completion without it would leave the window kill-only. Implemented now.

## Consequences

- Unary IPC cancellation now behaves like the browser carrier: aborting the renderer request aborts the main-process fetch. Stream cancellation still works through the existing close channel; both paths converge on `AbortController`.
- `/api/session.export` and every other `/api/*` GET/HEAD stream over `dsh://` instead of being buffered. POST remains unmounted (only GET/HEAD route), so the four-quadrant RPC contract keeps its `bridge.fetch` path unchanged.
- The old note's two IPC-known gaps are closed; its consequence bullet is updated to point here.
- Connection-package surface stays under the client discipline: `bridge-fetch.ts` is a plain module (no electron/DOM imports) with 100% per-file coverage; the wire additions (`requestId`, `abort`) are validated by the client-bundle purity gate and the existing wire contract tests.
- The shell keeps only carrier glue and adds Electron-only modules (menu/tray/updater) that are unit-tested with a mocked `electron` module; the desktop app is outside the per-file coverage gate.
- Packaging: NSIS/dmg targets, icons, and `electron-updater` are wired; local `package:win` is unsigned by design, and auto-update activates only in packaged builds (dev is a no-op string, so keyless development needs no dist server).
- Menu role `helpMenu` is not in this Electron version's role union; the Help menu uses a plain label instead.

## Testing

`pnpm vitest run packages/client/connection/tests apps/desktop/tests` green. New/updated connection specs (`tests/electron-api-client.client.spec.ts`, `tests/ipc-rpc.client.spec.ts`) cover abort mid-flight, pre-aborted signals, bridge rejection, and `abortError` branches, replacing the "signal dropped" expectations; connection coverage stays 100% per file. New `apps/desktop/tests/protocol.spec.ts` (12 cases) drives `routeDshRequest` without Electron: GET/HEAD streamed body, HEAD preflight, POST not routed, missing `apiHandler` 404, bad encoding 400, asset 404, and the normalized encoded-dot 404. `apps/desktop/tests/updater.spec.ts`, `menu.spec.ts`, and `tray.spec.ts` mock `electron` (latest template call, instance-method assertions) for the packaged/dev behaviors and the menu/tray wiring. `pnpm --filter @deepseek-ai/dsh-desktop build` passes after rebuilding the connection host lib (`pnpm exec tsc -b packages/client/connection/tsconfig.host.json`), because the wire types must refresh before the desktop package consumes them.