# DeepSeek Harness Desktop — Community Release

English | [中文](README.publish.zh.md)

**DeepSeek Harness Desktop** is an [Electron](https://www.electronjs.org/) desktop shell for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (`dsh`), the open-source agent harness by DeepSeek AI. It wraps the full `dsh web` experience — the complete browser UI, the session projection layer, the tool-call tree, approvals, workspaces, and settings — into a native desktop window, with no separate server process to manage.

This is a **community-maintained** companion to the official project. It is not an official DeepSeek AI product.

## Why a desktop app?

The official project ships a web UI (`dsh web`) and a terminal UI (`dsh`). A desktop shell adds:

- **One-click launch** — a native app icon, window, and installer (NSIS / DMG), no terminal and no manually started server.
- **Native integration** — system tray, application menu, OS file dialogs for the directory picker, in-window title bar, and auto-update via `electron-updater`.
- **Shared state** — the app reads the same `$DSH_HOME` as the CLI, so sessions, settings, and profiles are shared with `dsh` out of the box.
- **The entire web frontend, unchanged** — roughly 30 `dsh-client-ui-*` plugins, the session projection layer, tool views, approvals, and workspace flows all work as in the browser. The desktop only changes the *carrier* between the renderer and the harness.

## Features

- Full DeepSeek Harness web UI in a native window.
- Two transports, selectable per launch:
  - `loopback` (default) — reuses the browser HTTP + WebSocket transport unchanged, for maximum parity.
  - `ipc` — an Electron-native `dsh://` protocol with a preload bridge (`ElectronApiClient`), for the tighter integration direction.
- System tray with show/quit; in-window title bar with hamburger menu (Show Window, Shell Theme, updates, Quit).
- Switchable shell theme: `deepseek` (default, follows the page's `--dsw-*` tokens) or `claude` (warm editorial terra-cotta treatment with self-hosted fonts).
- Native directory picker via the OS file dialog in IPC mode.
- Auto-update in packaged builds (`electron-updater`).
- Installers for Windows (NSIS) and macOS (DMG + ZIP), built with `electron-builder`.

## Install

### Download a release (recommended)

Grab the latest installer from the **Releases** page of this repository:

- Windows: `DeepSeek Harness Desktop-<version>-win-x64.exe` (NSIS installer)
- macOS: `DeepSeek Harness Desktop-<version>-mac-x64.dmg` / `.zip`

You need a DeepSeek API key (or your own model configuration in `$DSH_HOME/settings.yaml`), exactly like `dsh web`.

> **Note on unsigned builds.** Locally packaged Windows builds are unsigned by design (`--config.win.signAndEditExecutable=false`); releases signed with a `CSC_*` certificate are signed normally. Treat the "unknown publisher" warning accordingly until a signed release exists.

### Run from source

Requires `Node.js` and `pnpm`:

```sh
git clone https://github.com/SANS41478/deepseek-harness-desktop.git
cd deepseek-harness-desktop
pnpm install
pnpm --filter @deepseek-ai/dsh-desktop dev                       # loopback transport (default)
DSH_DESKTOP_TRANSPORT=ipc pnpm --filter @deepseek-ai/dsh-desktop dev   # IPC transport
```

## How it works

| Transport | Renderer | Carrier | Status |
|---|---|---|---|
| `loopback` (default) | stock `dsh-web-frontend` dist over `http://127.0.0.1:<port>` | unchanged browser transport: HTTP `/api` + WebSocket downlinks | works today |
| `ipc` | dist over the `dsh://` custom protocol | `ElectronApiClient` (an `AbstractApiClient` subclass) over the preload `dshApi` bridge | end-to-end |

Both modes boot the identical harness tree inside the Electron main process — the same profile layers, user patch layers, and fail-loud guards as `apps/cli` — so no separate server process runs. The full technical architecture is documented in [`apps/desktop/README.md`](README.md).

## Relationship to the official project

- This repository is a fork of [deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness) that adds `apps/desktop/`. Everything else — the plugin harness, `packages/`, and docs — tracks upstream.
- The desktop app is not affiliated with or endorsed by DeepSeek AI. The official project remains the source of truth for the harness itself.
- If the upstream project ships an official desktop app, this one will be reconciled (or retired) accordingly.
- Seam-level pieces that are genuinely reusable — the `ElectronApiClient` IPC carrier and the native directory-picker backend — are candidates for upstream contribution.

## Roadmap and known gaps

- **Code signing** — signing activates when `CSC_*` is set; a signed, auto-update-enabled release channel is the next packaging milestone.
- **More transports** — the transport seam is designed for future carriers beyond loopback/IPC.
- **Platform coverage** — Windows and macOS installers exist today; Linux packaging is not yet configured.

## Community and support

- Report issues and request features on the **Issues** page of this repository.
- Upstream feedback and discussion: [deepseek-ai/deepseek-harness Discussions](https://github.com/deepseek-ai/deepseek-harness/discussions) and the [DeepSeek Harness Discord](https://discord.gg/Ycq5dCaS4).
- Plugin authors: add the [`dsh-plugin`](https://github.com/topics/dsh-plugin) topic to your plugin repository for discoverability.

## License

[MIT](https://github.com/SANS41478/deepseek-harness-desktop/blob/main/LICENSE) — same as the upstream project.
