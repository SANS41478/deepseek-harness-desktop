# Agent Note: Electron IPC 中止与 /api 分块路由，以及壳的完善

Status: implemented

[English](2026-08-18-electron-ipc-abort-and-chunked-api-routing.md) | 中文

## Problem

IPC 传输笔记（[electron-ipc-transport-seam](2026-08-16-electron-ipc-transport-seam.md)）交付了端到端的 `DSH_DESKTOP_TRANSPORT=ipc`，但记录了两个开放缺口。其一，渲染器的 `AbortSignal` 从不跨 IPC：`ElectronApiClient.doFetch` 与泛型 RPC 调用方丢弃了 signal，unary 取消退化为「主进程侧完成」（主进程上的 fetch 一直跑到结束）。其二，`/api/session.export` 未在 IPC 上分块：桥把整个响应体序列化进单条回复，在渲染器里缓冲大导出。桌面壳在解包目录之外也没有任何打包能力、没有窗口外壳 UX：没有安装器目标、没有自动更新、没有应用菜单或托盘，关闭窗口直接杀掉应用而不是隐藏它。

## Decision

两个 IPC 缺口在 connection 包与壳中闭合，壳同时获得打包与窗口 UX。

- **渲染器按请求 id 跨 IPC 中止。** `src/wire.ts` 为 `DshFetchRequest` 增加必填 `requestId`，为 `DshApiBridge` 增加 `abort(requestId: string): void`。新 `src/client/bridge-fetch.ts` 导出 `bridgeFetch(bridge, request, signal?)`——一个 `fetch` 形状的助手：序列化进 `bridge.fetch`（携带 request id），在渲染器侧 `AbortSignal` 事件时调用 `bridge.abort(requestId)`，被中止时以 `abortError(signal)` 拒绝。`ElectronApiClient.doFetch` 与 `createIpcConnectionRpc` 使用它，因此 unary 取消现在传播到主进程，而非退化为完成。preload 以 `ipcRenderer.send('dsh:fetch:abort', requestId)` 暴露 `abort`；主进程 `dsh:fetch` 处理器维护 `Map<requestId, AbortController>` 进行中表，把 `controller.signal` 传入 `new Request(...)`，`dsh:fetch:abort` 监听器中止匹配的 controller。dispose 中止所有进行中的 controller。
- **分块的 /api 响应乘坐 `dsh://` 协议。** `src/main/protocol.ts` 抽出纯的、无 Electron 的 `routeDshRequest(request, deps)`，携带 `DshProtocolDeps`（dist 根、modules、api 处理器）；`registerDshProtocol` 组装 deps 并 `protocol.handle`。`/api/*` 下的 GET 或 HEAD 重建请求（`new Request(new URL(request.url), { method, headers, signal: request.signal })`）交给 `toFetchHandler(api)`，因此 `/api/session.export` 经浏览器 HTTP 载体包装的同一个 fetch 形状处理器流式输出，含响应体，且协议层中止 signal 全程生效。403 穿越守卫保留为纵深防御：`new URL()` 归一化编码的点，编码点尝试在守卫可达之前就 404。
- **打包。** `scripts/gen-icons.mjs` 渲染 `build/icon.png` 与 `build/tray.png`（纯 Node PNG 编码器，无二进制资产）。`package.json` 增加 `electron-updater`、安装器目标（`win.target ['dir','nsis']` 带 oneClick-off 安装器选项、`mac.target ['dmg','zip']` 带 hardened runtime）、GitHub `publish` provider、`directories.buildResources 'build'`。`package-app.mjs` 以 `--publish never` 运行 electron-builder（`publish` 配置为 electron-updater 内嵌 `app-update.yml`，但本地构建不得因此索要 `GH_TOKEN`；CI 发布用自己的发布调用并携带 token），并在 `--win` 保持 `signAndEditExecutable=false`（本地不签名，`CSC_*` 在 CI 激活签名）。`scripts/flatten-junctions.mjs` 改用 Node 目录项检测 junction（`Dirent.isSymbolicLink` + `realpathSync`）而非调用 PowerShell——PowerShell 5.1 会经 OEM 代码页破坏非 ASCII junction 目标，导致 `cpSync` 对中文路径下的 vendored `cosmokit`/`schemastery` 链接报 `ENOENT`。`src/main/updater.ts` 提供 `installUpdater(updater, isPackaged)` 返回 `{ checkForUpdates, dispose }`；dev 构建解析为 "auto-update is disabled outside packaged builds"，应用无需网络或 dist 即可运行。主入口在打包构建启动时检查一次，并在 Help 菜单暴露 Check for Updates。`electron-updater` 的命名导出 `autoUpdater` 无法被 Electron 的 ESM 加载器静态探测（其 CJS `out/main.js` 通过 star 重导出 `./types`），因此 `src/main/index.ts` 经 `createRequire(import.meta.url)('electron-updater')` 解析——即仓库既有的 CJS 互操作模式（web-app、client-modules）——而非会在运行时失败的命名 `import`。
- **窗口 UI。** `src/main/menu.ts` 安装应用菜单（edit/view/window roles、Show Window `CmdOrCtrl+Shift+W`、Check for Updates）；`src/main/tray.ts` 安装托盘图标，带 Show/Quit 菜单与点击唤起窗口。关闭窗口隐藏它（`quitting` 标志让真正的关闭绕过 close 处理器），`second-instance`/`activate`/托盘恢复窗口。关闭时 dispose 托盘、host 树并退出。

## Alternatives considered

### 用流线缆上的专用中止通道替代 request-id 中止方法

桥已携带推送流通道，其 close 会中止流泵，因此「取消该请求」帧本可搭流线缆的便车。但渲染器的 `AbortSignal` 是调用方的取消面，且 request id 已序列化在 `DshFetchRequest` 中；独立的 `abort(requestId)` 桥方法让中止与渲染器实际发出的 fetch 按 id 对应，无需关联机制。被采用。

### 用 `DshStreamChannel` 上的分块帧替代 /api 协议路由

新流帧类型（如 body chunk 帧）会成为第三种 fetch 传输，自带帧、序列与错误语义，重复 `toFetchHandler`。`/api/*` 走既有 `dsh://` 协议则复用 HTTP 载体包装的同一个处理器——流式、status/headers、错误映射免费获得——协议层 `request.signal` 携带中止。被采用。

### 保留关闭即退出与 menu/tray 为脚手架

关闭到托盘以及 menu/tray 本是后续项，但托盘是 Windows/macOS 上壳的主要生命周期面（dock/alt-tab 对等）；只交付 IPC 完成而缺少它会留下只能杀掉的窗口。现在实现。

## Consequences

- Unary IPC 取消现在与浏览器载体行为一致：中止渲染器请求即中止主进程 fetch。流取消仍走既有 close 通道；两条路径都汇聚于 `AbortController`。
- `/api/session.export` 与其余每个 `/api/*` GET/HEAD 经 `dsh://` 流式输出，而非被缓冲。POST 保持未挂载（仅 GET/HEAD 路由），四象限 RPC 契约的 `bridge.fetch` 路径不变。
- 旧笔记的两个 IPC 已知缺口已闭合；其 consequence 条目已更新并指向本笔记。
- connection 包新增面维持 client 纪律：`bridge-fetch.ts` 是纯模块（无 electron/DOM import）且每文件 100% 覆盖；wire 新增（`requestId`、`abort`）由 client bundle 纯度门禁与既有 wire 契约测试验证。
- 壳只保留载体胶水，并新增仅 Electron 模块（menu/tray/updater），以 mock 的 `electron` 模块做单测；desktop 应用在逐文件覆盖门禁之外。
- 打包：NSIS/dmg 目标、图标、`electron-updater` 已接线；本地 `package:win` 按设计不签名，自动更新只在打包构建激活（dev 为 no-op 字符串，无 key 开发无需 dist 服务器）。
- 菜单 role `helpMenu` 不在本 Electron 版本的 role 联合类型中；Help 菜单改用普通 label。

## Testing

`pnpm vitest run packages/client/connection/tests apps/desktop/tests` 全绿。新增/更新的 connection specs（`tests/electron-api-client.client.spec.ts`、`tests/ipc-rpc.client.spec.ts`）覆盖进行中止、预中止 signal、桥拒绝、`abortError` 分支，替换了「signal 被丢弃」的期望；connection 覆盖率维持每文件 100%。新增 `apps/desktop/tests/protocol.spec.ts`（12 用例）在无 Electron 下驱动 `routeDshRequest`：GET/HEAD 流式响应体、HEAD 预检、POST 不路由、缺 `apiHandler` 404、坏编码 400、资产 404、归一化编码点 404。`apps/desktop/tests/updater.spec.ts`、`menu.spec.ts`、`tray.spec.ts` mock `electron`（取最新 template 调用、实例方法断言）覆盖打包/dev 行为与 menu/tray 接线。`pnpm --filter @deepseek-ai/dsh-desktop build` 在重建 connection host lib（`pnpm exec tsc -b packages/client/connection/tsconfig.host.json`）后通过——wire 类型必须刷新后才能被 desktop 包消费。