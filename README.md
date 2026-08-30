# DeepSeek Harness Desktop

English | [中文](README.zh.md)

<div align="center">

[![Release](https://img.shields.io/github/v/release/SANS41478/deepseek-harness-desktop?include_prereleases&label=release&logo=github)](https://github.com/SANS41478/deepseek-harness-desktop/releases/latest)
[![Desktop release](https://github.com/SANS41478/deepseek-harness-desktop/actions/workflows/desktop-release.yml/badge.svg)](https://github.com/SANS41478/deepseek-harness-desktop/actions/workflows/desktop-release.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)

**The full [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) web UI — sessions, tool calls, approvals, workspaces — in a native desktop window. No terminal, no server to manage.**

<img src="assets/desktop/hero.png" width="820" alt="DeepSeek Harness Desktop main window">

**[⬇ Download the latest installer](https://github.com/SANS41478/deepseek-harness-desktop/releases/latest)** · [Report an issue](https://github.com/SANS41478/deepseek-harness-desktop/issues)

</div>

> A **community-maintained** companion to [deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness) — not an official DeepSeek AI product. This repository is a fork of the upstream harness that adds the desktop shell (`apps/desktop/`); everything else tracks upstream.

## Why a desktop app?

- **One-click launch** — an installer, an app icon, a native window. The harness boots inside the app: there is no separate server process to start or manage.
- **Native integration** — system tray, application menu, OS file dialogs, an in-window title bar, and auto-update via `electron-updater`.
- **Shared state with the CLI** — reads the same `$DSH_HOME` as `dsh`, so sessions, settings, and profiles carry over out of the box.
- **The entire web frontend, unchanged** — ~30 UI plugins (session projection, the tool-call tree, approvals, settings) reused as-is; the desktop only swaps the *carrier* between the renderer and the harness:

| Transport | Renderer | Carrier | How to select |
|---|---|---|---|
| `loopback` (default) | stock dist over `http://127.0.0.1:<port>` | unchanged browser transport — HTTP `/api` + WebSocket | nothing to do |
| `ipc` | dist over the `dsh://` protocol | preload bridge (`dshApi`) | `DSH_DESKTOP_TRANSPORT=ipc` |

Both modes boot the identical harness tree inside the Electron main process (same profile layers and fail-loud guards as the CLI). Architecture: [apps/desktop/README.md](apps/desktop/README.md).

## Install

**Windows** — download `DeepSeek-Harness-Desktop-<version>-win-x64.exe` from the [latest release](https://github.com/SANS41478/deepseek-harness-desktop/releases/latest) and run it (per-user NSIS installer).

> Builds are currently **unsigned**: Windows SmartScreen shows an "unknown publisher" warning. "More info → Run anyway" is expected until a signed build ships.

**macOS** — build from source (the DMG/ZIP targets are configured; see the Development section below).

**First launch**: add a DeepSeek API key when prompted (or configure your own models in `$DSH_HOME/settings.yaml`), pick a workspace, and go — exactly like `dsh web`. The [web UI guide](docs/user/guide/index.md) applies unchanged.

| Model providers | Claude shell theme |
|---|---|
| <img src="assets/desktop/settings-models.png" width="400" alt="Model provider settings"> | <img src="assets/desktop/theme-claude.png" width="400" alt="Claude shell theme"> |

## Development

Requires `Node.js` and `pnpm`:

```sh
git clone https://github.com/SANS41478/deepseek-harness-desktop.git
cd deepseek-harness-desktop
pnpm install
pnpm build                                           # host libs + web frontend
pnpm --filter @deepseek-ai/dsh-desktop dev           # loopback transport (default)
DSH_DESKTOP_TRANSPORT=ipc pnpm --filter @deepseek-ai/dsh-desktop dev
pnpm --filter @deepseek-ai/dsh-desktop package:win   # NSIS installer → apps/desktop release dir
```

Publishing doc: [apps/desktop/README.publish.md](apps/desktop/README.publish.md) ([中文](apps/desktop/README.publish.zh.md)). Releases are cut automatically by the [`desktop-release` workflow](.github/workflows/desktop-release.yml) on version tags.

## The harness itself

[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (`dsh`) is an open-source agent harness by [DeepSeek AI](https://deepseek.com) where **everything is a plugin**, powered by [Cordis](https://github.com/cordiverse/cordis). It is in developer preview and iterating rapidly — expect compatibility-breaking changes. To run the plain web UI without the desktop shell: `npx @deepseek-ai/dsh web`. Upstream docs: [development guide](docs/development.md) · [architecture](docs/architecture.md).

## Community

- Desktop app — bugs & feature requests: [Issues](https://github.com/SANS41478/deepseek-harness-desktop/issues) · [Discussions](https://github.com/SANS41478/deepseek-harness-desktop/discussions)
- Upstream harness: [Discussions](https://github.com/deepseek-ai/deepseek-harness/discussions) · [Discord](https://discord.gg/Ycq5dCaS4) · plugin discoverability: add the [`dsh-plugin`](https://github.com/topics/dsh-plugin) topic

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[MIT](LICENSE) — third-party dependencies and their licenses are disclosed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
