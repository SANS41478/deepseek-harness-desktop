# DeepSeek Harness Desktop — 社区发布

[English](README.publish.md) | 中文

**DeepSeek Harness Desktop** 是 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（`dsh`，DeepSeek AI 出品的开源 agent harness）的 [Electron](https://www.electronjs.org/) 桌面壳。它把完整的 `dsh web` 体验——完整的浏览器 UI、会话投影层、工具调用树、审批、工作区与设置——装进一个原生桌面窗口，无需单独管理服务进程。

本项目是**社区维护**的上游伴生项目，不是 DeepSeek AI 官方产品。

## 为什么需要一个桌面应用？

官方项目提供 Web UI（`dsh web`）和终端 UI（`dsh`）。桌面壳带来：

- **一键启动**——原生应用图标、窗口与安装器（NSIS / DMG），无需终端，也无需手动起服务。
- **原生集成**——系统托盘、应用菜单、目录选择器走系统文件对话框、窗口内标题栏，以及基于 `electron-updater` 的自动更新。
- **共享状态**——应用读取与 CLI 相同的 `$DSH_HOME`，会话、设置与 profile 天然互通。
- **完整复用 Web 前端**——约 30 个 `dsh-client-ui-*` 插件、会话投影层、工具视图、审批与工作区流程全部原样工作。桌面端只改变渲染层与 harness 之间的*载体*。

## 功能

- 原生窗口中运行完整的 DeepSeek Harness Web UI。
- 两种传输方式，可按次启动选择：
  - `loopback`（默认）——原样复用浏览器传输；渲染层即标准浏览器客户端，连接应用内回退 Web 服务，协议零改动，今天就能用。
  - `ipc`——文档中明确的 Electron 方向：渲染层经 `dsh://` 协议加载 dist，通过 preload 桥（`dshApi`）驱动同一套 RPC 面，目前位于 `DSH_DESKTOP_TRANSPORT=ipc` 开关之后。
- 带显示/退出的系统托盘（harness 持续运行）；窗口内标题栏 + 汉堡菜单（Show Window、Shell Theme、更新、Quit）。
- 可切换壳主题：`deepseek`（默认，跟随页面 `--dsw-*` 令牌）与 `claude`（暖色编辑风、自托管字体）。
- IPC 模式下经系统文件对话框的原生目录选择器。
- 打包版本支持自动更新（`electron-updater`）。
- 由 `electron-builder` 构建的 Windows（NSIS）与 macOS（DMG + ZIP）安装器。

## 安装

### 下载 Release（推荐）

从本仓库的 **Releases** 页面获取最新安装器：

- Windows：`DeepSeek-Harness-Desktop-<version>-win-x64.exe`（NSIS 安装器）
- macOS：`DeepSeek-Harness-Desktop-<version>-mac-x64.dmg` / `.zip`

你需要一个 DeepSeek API Key（或在 `$DSH_HOME/settings.yaml` 中配置自己的模型），与 `dsh web` 完全一致。

> **关于未签名构建的说明。** 本地打包的 Windows 构建**有意**保持未签名（`--config.win.signAndEditExecutable=false`）；配置了 `CSC_*` 证书的发布版本会正常签名。在签名版本出现之前，请自行斟酌"未知发布者"警告。

### 从源码运行

需要 `Node.js` 与 `pnpm`：

```sh
git clone https://github.com/SANS41478/deepseek-harness-desktop.git
cd deepseek-harness-desktop
pnpm install
pnpm --filter @deepseek-ai/dsh-desktop dev                       # loopback 传输（默认）
DSH_DESKTOP_TRANSPORT=ipc pnpm --filter @deepseek-ai/dsh-desktop dev   # ipc 传输
```

## 工作原理

| 传输方式 | 渲染层 | 载体 | 状态 |
|---|---|---|---|
| `loopback` | 经 `http://127.0.0.1:<port>` 加载标准 dist | 与浏览器一致的传输：HTTP `/api` + WebSocket | 今天可用 |
| `ipc` | 经 `dsh://` 协议加载 dist | preload 桥上的 `ElectronApiClient`（`AbstractApiClient` 子类） | 端到端 |

两种模式都在 Electron 主进程内启动完全相同的 harness 树——与 CLI 相同的 profile 分层、用户补丁层与 fail-loud 守卫——因此不需要任何独立服务进程。完整技术架构见 [`apps/desktop/README.zh.md`](README.zh.md)。

## 与官方项目的关系

- 本仓库是 [deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness) 的 fork，新增 `apps/desktop/`。其余部分——插件 harness、`packages/` 与文档——跟随上游。
- 该桌面应用与 DeepSeek AI 无隶属关系，也未获其背书。官方项目仍是 harness 本身的权威来源。
- 如果上游项目发布官方桌面应用，本项目将相应合并（或退役）。
- 缝隙层中真正可复用的部分——`ElectronApiClient` IPC 载体与原生目录选择器后端——是值得向上游贡献的候选。

## 路线图与已知缺口

- **代码签名**——设置 `CSC_*` 后签名即生效；带签名的自动更新发布渠道是下一个打包里程碑。
- **更多传输方式**——传输缝隙为未来载体而设计（不限于 loopback/IPC）。
- **平台覆盖**——今天已有 Windows 与 macOS 安装器；Linux 打包尚未配置。

## 社区与支持

- 请在本仓库的 **Issues** 页面反馈问题与功能建议。
- 上游反馈与讨论：[deepseek-ai/deepseek-harness Discussions](https://github.com/deepseek-ai/deepseek-harness/discussions) 与 [DeepSeek Harness Discord 社区](https://discord.gg/Ycq5dCaS4)。
- 插件作者：请给你的插件仓库加上 [`dsh-plugin`](https://github.com/topics/dsh-plugin) topic 以便被发现。

## 许可证

[MIT](../../LICENSE)——与上游项目一致。
