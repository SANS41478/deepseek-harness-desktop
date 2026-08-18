# Agent Note: Electron IPC transport seam in dsh-client-connection

Status: implemented

English | [中文](2026-08-16-electron-ipc-transport-seam.zh.md)

## Problem

The desktop shell (`apps/desktop`) ships two transports switched by `DSH_DESKTOP_TRANSPORT`. Loopback mode reuses the browser carrier unchanged and works. IPC mode was scaffolded end to end — `dsh://` protocol, preload `dshApi` bridge, `ElectronApiClient`, main-process fetch handler and stream pumps — except for the single wire decision: the renderer loads the stock `dsh-web-frontend` dist and its client bundles, and `dsh-client-connection`'s browser apply pinned `new WebApiClient()` at boot. The `ElectronApiClient` subclass and the `DshApiBridge` wire contract lived in the shell's own `src/renderer/` and `src/shared/`, where no renderer code ever imports them. IPC mode therefore loaded the UI but its wire layer still required the browser HTTP transport, and the documented "IPC carrier" was an incomplete end-to-end path.

## Decision

The IPC carrier graduates into `dsh-client-connection`, the package whose browser bundle the renderer actually runs:

- **`src/wire.ts`** — the cross-process wire contract (`DshApiBridge`, `DshFetchRequest`/`Response`, `DshStreamChannel`/`Message`) moves from `apps/desktop/src/shared/dsh-api.ts` into the connection package. It stays plain JSON types with zero electron/DOM imports, so the browser bundle can inline it (client-bundle purity gate passes) and the shell's Node half imports type-only from the same module. Exported as a new `./wire` subpath (`package.json` exports + tsdown lib entry + both tsconfig aggregates).
- **`src/client/electron-api-client.ts`** — the `AbstractApiClient` subclass moves from the shell; its `doFetch` serializes into `bridge.fetch` and mux/host openers consume the pushed stream channels with the shared frame schemas. Imports stay within the package (`./api.ts` re-exports the base class).
- **`src/client/ipc-rpc.ts`** — `createIpcConnectionRpc(bridge)`, the generic-RPC mirror of `createWebConnectionRpc` that rides the bridge instead of `globalThis.fetch`, so goal remotes and every generic channel reach the main process on `dsh://` pages.
- **`src/client/index.ts`** — the transport seam: `apply` reads a boot-time transport fact from the shell (`window.__DSH_TRANSPORT__ === 'ipc'` published by the preload alongside `window.dshApi`). A fixture page still wins; an IPC page with the bridge constructs `ElectronApiClient` and the IPC rpc; everything else stays on `WebApiClient`.

The shell keeps only its carrier-integrating glue: preload (bridge + transport fact), main-process `dsh:fetch` handler, stream pumps, and the `dsh://` protocol handler, all importing the wire types from `@deepseek-ai/dsh-client-connection/wire`. The shell's old `src/renderer/` and `src/shared/` files are deleted; the knip entry for the deleted proposal file goes with them. The desktop tsconfig references the connection package's host aggregate (host-side types only — the two-aggregate rule is untouched).

## Alternatives considered

### Keep the subclass and bridge contract in the shell

The shell's renderer directory never reaches the running code: the renderer executes the stock dist's client bundles, not shell sources. Keeping the carrier in the shell would leave the wire decision permanently broken; graduating into the connection package is the only place the browser bundle can select it. Rejected as a non-solution.

### A connection-Config transport option instead of a boot-time window fact

The connection plugin already has a Config surface. A `transport: 'ipc'` config row would work, but the desktop composition would have to carry the option through the profile patch tree into a plugin whose client half reads its config at bundle boot, and the bridge itself still needs a typed handoff. The window fact (`__DSH_TRANSPORT__` + `dshApi`) is the preload's existing surface, keeps the selection in the browser apply next to the fixture/real decision, and needs no config plumbing. Chosen.

### Inlining the bridge contract into the shell's preload types

Keeping `DshApiBridge` in the shell and importing shell types from the connection package would invert the dependency (client bundle must not depend on the shell) or duplicate the contract. Moving the wire contract into the connection package with a dedicated `./wire` subpath keeps one source of truth for both halves. Chosen.

## Consequences

- `DSH_DESKTOP_TRANSPORT=ipc` is now an end-to-end path: the renderer's `dsh-client-connection` bundle selects the IPC carrier over the preload bridge, unary/respond and generic RPC ride `dsh:fetch`, and mux/host frames arrive through the stream pumps.
- The wire contract has one home. Loopback mode is untouched (no transport fact, no bridge in the page context the selection reads — the preload still exposes the bridge, but `__DSH_TRANSPORT__` stays `'loopback'`, so the apply stays on `WebApiClient`).
- The IPC tree drops the HTTP carrier entirely: `startHost` disables the `webserver` row (and the `directory-picker` auto row, which keys off the webserver bind host), `ClientModuleRegistry` makes `webServer` optional and exposes `serveBundleFetch` (the same fetch-shaped handler the HTTP carrier wraps, driven by the `dsh://` protocol), and `dsh-web-app`, `dsh-client-connection`, and `dsh-client-hmr` all tolerate a missing `webServer`. Verified by a keyless boot smoke: `webServer` absent, `clientModules` present with the full graph, bundle fetch answering 404 for unknown ids.
- The IPC tree pins the **Electron dialog backend** (`apps/desktop/src/main/directory-picker.ts`) in place of the auto row: a `DirectoryPicker` subclass whose `native` capability opens `dialog.showOpenDialog` (electron resolved lazily so plain-Node harnesses can load the module), paired with the native client surface. The koffi/osascript/zenity backends remain for `dsh web`.
- **Packaging** ships as `pnpm package` / `pnpm package:win`: `scripts/stage-app.mjs` deploys the dependency tree to a temp directory outside the pnpm workspace (`pnpm deploy --legacy`), flattens the workspace junctions that point back into the repository (pnpm keeps `link:` overrides like cosmokit/schemastery as junctions), rewrites `workspace:^` ranges to concrete versions, and copies the built `lib/`; `scripts/package-app.mjs` then runs electron-builder against that staging tree. Windows without an elevated shell cannot extract winCodeSign's symlinks, so `package:win` disables signing/editing (`signAndEditExecutable=false`, dir target); the unpacked `DeepSeek Harness.exe` plus the 4600-entry asar (main/preload/protocol entries, `dsh-web-frontend/dist`, and the full dependency closure, with `node-pty`/`koffi` unpacked) are the verified artifact.
- The IPC-known gaps (renderer AbortSignal not crossing IPC, `/api/session.export` not chunked over IPC) are closed by [electron-ipc-abort-and-chunked-api-routing](2026-08-18-electron-ipc-abort-and-chunked-api-routing.md): abort rides a request-id `abort` bridge channel and `/api/*` streams through the `dsh://` protocol to `toFetchHandler`.
- New connection-package surface (`./wire` export, `ElectronApiClient`, `createIpcConnectionRpc`) carries the client package discipline: 100% per-file coverage in `pnpm run test:coverage` (new specs cover unary/respond/stream frames/abort/malformed frames and the rpc correlation, mismatch, and target fence), bundle purity (no electron or shell imports), and the dual-aggregate type split.

## Testing

`pnpm run test:gui` green. New client specs: `tests/electron-api-client.client.spec.ts` (bridge unary/respond/streams/abort/malformed/stream-end, doFetch field serialization), `tests/ipc-rpc.client.spec.ts` (correlation, mismatch, transport failure, target fence, un-serialized signal), and `tests/client-apply.client.spec.ts` IPC scenarios (transport fact + bridge selects `ElectronApiClient`, partial facts stay on `WebApiClient`, fixture wins). Connection package coverage: 100% statements/branches/functions/lines across `src/`. `client-modules` gains `serveBundleFetch` specs (fetch-only construction without `webServer`, 404/405/400 arms). `web-app` gains a no-`webServer` spec (no dist serving, no URL, `webRuntime` still provided). The Electron dialog backend has `apps/desktop/tests/directory-picker.spec.ts` (chosen path, cancel, empty selection, dialog error, pre-aborted signal; the electron module is mocked). The carrier-free IPC tree is verified by a keyless `startHost({ webServerRequired: false })` boot smoke asserting no `webServer` service, the Electron `directoryPicker` mounted with the `native` capability, a mounted `clientModules` with the composed graph, and the fetch handler answering.
