# DeepSeek Harness (Desktop Fork)

English | [中文](README.zh.md)

DeepSeek Harness (`dsh`) is an open-source agent harness developed by [DeepSeek AI](https://deepseek.com).

It uses an architecture where **everything is a plugin**, and is powered by [Cordis](https://github.com/cordiverse/cordis), whose design is described in [_A Programming Paradigm for Spatiotemporal Composability_](https://github.com/cordiverse/paper).

> **Fork with a desktop app.** This repository is a fork of [deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness) that adds an [Electron](https://www.electronjs.org/) desktop shell — `apps/desktop/` — which boots the same `web` composition inside the Electron main process and renders the existing `dsh-web-frontend` UI in a window. Everything else (the plugin harness, `packages/`, and docs) is upstream. See [apps/desktop/README.md](apps/desktop/README.md).

## Developer preview

DeepSeek Harness is currently in _developer preview_ and is iterating rapidly. **THERE WILL BE COMPATIBILITY-BREAKING CHANGES.**

## Run

### Run from `npm`

Install `Node.js`, then run:

```sh
npx @deepseek-ai/dsh web
```

The command starts the Web UI, served at `http://127.0.0.1:3080` by default. See [Web UI guide](docs/user/guide/index.md).

### Run the desktop app

This fork adds an Electron desktop shell over the Web composition:

```sh
git clone https://github.com/SANS41478/deepseek-harness-desktop.git
cd deepseek-harness-desktop
pnpm install
pnpm --filter @deepseek-ai/dsh-desktop dev        # loopback transport (default)
DSH_DESKTOP_TRANSPORT=ipc pnpm --filter @deepseek-ai/dsh-desktop dev   # IPC transport
```

Both modes need `DEEPSEEK_API_KEY` (or the model configuration of your choice in `$DSH_HOME/settings.yaml`). See [apps/desktop/README.md](apps/desktop/README.md).

### Run from source

To run the Web UI from a repository checkout:

```sh
git clone https://github.com/SANS41478/deepseek-harness-desktop.git
cd deepseek-harness-desktop
pnpm install
pnpm run build
pnpm dsh web
```

## Community and support

- Feel free to submit feedback or bug reports through [GitHub Discussions](https://github.com/deepseek-ai/deepseek-harness/discussions).
- Add the [`dsh-plugin`](https://github.com/topics/dsh-plugin) topic to your plugin repository for discoverability.
- Join <a href="https://discord.gg/Ycq5dCaS4">DeepSeek Harness Discord community</a>.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## Development

Start with the [development guide](docs/development.md) and [architecture documentation](docs/architecture.md).

For agents, follow [AGENTS.md](AGENTS.md).

## License

[MIT](LICENSE)

Third-party dependencies and their licenses are disclosed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
