# `@deepseek-ai/dsh-desktop`

[English](README.md) | 中文

> **快照** — 本仓库持有从 [deepseek-harness](https://github.com/deepseek-ai/deepseek-harness) 单仓提取的 `apps/desktop` 骨架，提取自提交 `47f943859bef60e4160492346772ded9b24f765a`。该应用是其中的 workspace 成员，并导入 `@deepseek-ai/dsh-*` workspace 包，因此这份快照是参考副本、并非独立构建：把它应用到 deepseek-harness checkout（`apps/desktop/`）里即可构建并运行。

一个架在 DeepSeek Harness web 组合之上的 Electron 桌面壳。它在 **Electron 主进程内部**启动标准的 `web` profile（无独立服务进程，仅 loopback），并把现有 `dsh-web-frontend` UI 渲染进窗口。整套前端栈——约 30 个 `dsh-client-ui-*` 插件、session 投影层、工具调用树、审批、工作区、设置——原样复用；桌面端只改变渲染进程与宿主之间的*载体*。

两种传输，由 `DSH_DESKTOP_TRANSPORT` 切换：`loopback`（默认）与 `ipc`。两者今天都是端到端通路；IPC 模式是 Electron 原生方向，loopback 模式则是浏览器等价基线。

## 架构

仓库的分层笔记（`.agents/notes/implemented/architecture/2026-07-19-gui-layering-and-rpc-protocol.md`）为 Electron 壳保留了一个 `AbstractApiClient` 的 "IPC bridge subclass"：只有 `doFetch` 传输面变化，四象限 RPC 契约与基类保持不动。本应用遵循该保留。

两种传输，由 `DSH_DESKTOP_TRANSPORT` 切换：

| 传输 | 渲染进程 | 载体 | 状态 |
|---|---|---|---|
| `loopback`（默认） | 通过 `http://127.0.0.1:<port>` 提供现成 `dsh-web-frontend` dist | 不变的浏览器传输：HTTP `/api` + WebSocket 下行 | 今天可用 |
| `ipc` | 通过 `dsh://` 自定义协议提供 dist | `ElectronApiClient`（`AbstractApiClient` 子类）经由 preload `dshApi` bridge | 端到端 |

渲染进程的载体选择位于 `dsh-client-connection`：它的浏览器 apply 读取壳发布的启动时传输事实（`window.__DSH_TRANSPORT__ === 'ipc'` 加 preload `dshApi` bridge）并选择 `ElectronApiClient` + IPC 通用 RPC 调用方，其余页面仍用 `WebApiClient`。跨进程 wire 契约位于 `@deepseek-ai/dsh-client-connection/wire`，两半只做类型导入。

两者都启动同一 harness 树（`src/main/startHost.ts`），镜像 `apps/cli` 的 profile 启动：相同的 profile 层、用户 patch 层、fail-loud 守卫，以及 HMR 监视的 `cordis.patch.yml`。loopback 服务绑定 `--port 0`（OS 分配）且只为窗口服务；IPC 传输完全禁用 webserver 行（该树以无载体方式挂载），并通过 `ClientModuleRegistry.serveBundleFetch` 经 `dsh://` 提供 dist、manifest 与 bundles——正是 HTTP 载体包装的那个 fetch 形 handler。由于 IPC 树中不再存在 webserver 绑定宿主，目录选择器的自动行（以它为键）在那里被禁用，并改为直接固定原生交互。

## 文件地图

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

### Shell 主题

桌面壳只重排它注入的 chrome（标题栏、滚动条、托盘）——绝不改动共享 web 前端——并提供可切换主题：
- `deepseek`（默认）——标题栏与滚动条跟随页面 `--dsw-*` token。
- `claude`——温暖、编辑风格的陶土色处理：Newsreader 字标、Poppins 标签、Geist Mono 注释、纸张表面、陶土色滚动条滑块，字体自托管为 base64 data URI（无 CDN）。

可在启动时以 `DSH_DESKTOP_SHELL_THEME=claude` 选择（其他值均为 `deepseek`），也可从窗口内标题栏的 **hamburger（☰）菜单 → Shell Theme** 实时切换（同时替换托盘字形）。OS 菜单栏被隐藏；hamburger 以原生弹窗打开应用菜单。Claude CSS 限定在 `html[data-shell-theme='claude']` 并按次注入，因此 web 内容不被触碰。

渲染进程载体（`ElectronApiClient`、IPC 通用 RPC 调用方，以及 `./wire` 跨进程契约）已毕业进入 `@deepseek-ai/dsh-client-connection`；连接 apply 从 preload 发布的传输事实中选择它。

## 运行

```sh
pnpm install                       # workspace member via apps/* glob
pnpm --filter @deepseek-ai/dsh-desktop dev        # loopback mode
DSH_DESKTOP_TRANSPORT=ipc pnpm --filter @deepseek-ai/dsh-desktop dev   # IPC mode
```

两种模式都需要 `DEEPSEEK_API_KEY`（或在 `$DSH_HOME/settings.yaml` 中配置你选择的模型），与 `dsh web` 完全一致。`dev` 脚本在启动前重建 web 前端 dist；harness 读取与 CLI 相同的 `$DSH_HOME` 状态，因此会话、设置与 profile 都与 `dsh` 共享。

## 何为真实、何为脚手架

- **真实**：`startHost` 启动；loopback 窗口；IPC `dsh:fetch` handler 与两条流泵（`toFetchHandler` 与浏览器 HTTP bridge 使用的 handler 相同）；经 IPC 的渲染进程中止（每请求 `requestId`、主进程侧 `AbortController`，以及取消在途请求的 `abort` bridge 通道）；`dsh://` 协议提供 dist、manifest、bundles 与 `/api/*`（含分块 `session.export` 响应，经由 `toFetchHandler` 以协议层中止信号流式传输）；preload bridge；渲染进程的 `ElectronApiClient` 选择（已毕业进入 `dsh-client-connection`）；无载体 IPC 树（webserver 行被禁用，目录选择器是 Electron 对话框后端 `src/main/directory-picker.ts`，以原生客户端面固定）；应用菜单与托盘（隐藏到托盘的关闭、显示窗口、检查更新）；electron-builder 打包流程（`pnpm package` / `pnpm package:win`），含 NSIS/dmg 安装器目标、图标与 `electron-updater`；生命周期/拆除。
- **延期（见后续）**：在 CI 机器上用 `CSC_*` 环境做代码签名（本地 `package:win` 按设计不做签名，`--config.win.signAndEditExecutable=false`）。

## 已知缺口（IPC 模式）

今天没有。渲染进程 `AbortSignal` 经 `requestId`/`abort` 跨过 IPC，`/api/*`（含 `session.export`）经 `dsh://` 协议路由到 `toFetchHandler`，以协议层中止信号流式传输响应体。

## 后续（本应用暂不改动代码库）

1. **打包**：自动更新、安装器目标（NSIS/dmg）、图标与 electron-updater 发布配置都已就位；代码签名在设置 `CSC_*` 时激活（CI）。本地 `pnpm package:win` 产出的未打包 win 目录不做签名。原生模块（`node-pty`、`koffi`）从 asar 解包（`asarUnpack`）。

IPC 树完全去掉 HTTP 载体：webserver 行被禁用，客户端模块图与 bundles 经 `serveBundleFetch` 提供（与 HTTP 载体包装的 fetch 形 handler 相同）。目录选择器是 Electron 对话框后端（`dialog.showOpenDialog`），固定以替代自动行。见 [Agent Note](../../.agents/notes/implemented/feature/2026-08-16-electron-ipc-transport-seam.md)。

## 仓库门禁

本应用的真实 PR 还必须把项目登记到相应的 tsconfig aggregate（宿主侧，按 two-aggregate 规则），若应用被当作 package 处理则接通 `verify-package-invariants`，并通过 `pnpm run typecheck && pnpm run lint` 及相关 `test:gui`/`test:web` 车道。
