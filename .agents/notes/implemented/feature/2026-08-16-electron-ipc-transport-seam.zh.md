# Agent Note: dsh-client-connection 中的 Electron IPC 传输接缝

Status: implemented

[English](2026-08-16-electron-ipc-transport-seam.md) | 中文

## Problem

桌面壳（`apps/desktop`）提供两种由 `DSH_DESKTOP_TRANSPORT` 切换的传输。Loopback 模式原样复用浏览器载体，正常工作。IPC 模式已端到端脚手架完毕——`dsh://` 协议、preload `dshApi` 桥、`ElectronApiClient`、主进程 fetch 处理器与流泵——唯独缺少单一线缆决策：渲染器加载的是出厂 `dsh-web-frontend` dist 及其 client bundles，而 `dsh-client-connection` 的浏览器 apply 在启动时固定 `new WebApiClient()`。`ElectronApiClient` 子类与 `DshApiBridge` 线缆契约存放在壳自身的 `src/renderer/` 与 `src/shared/` 中，任何渲染器代码都不会 import 它们。因此 IPC 模式加载了 UI，但其线缆层仍依赖浏览器 HTTP 传输，文档所称的「IPC 载体」是一条不完整的端到端路径。

## Decision

IPC 载体迁入 `dsh-client-connection`——渲染器实际运行其浏览器 bundle 的包：

- **`src/wire.ts`** —— 跨进程线缆契约（`DshApiBridge`、`DshFetchRequest`/`Response`、`DshStreamChannel`/`Message`）从 `apps/desktop/src/shared/dsh-api.ts` 迁入 connection 包。保持纯 JSON 类型、零 electron/DOM import，浏览器 bundle 可内联（client bundle 纯度门禁通过），壳的 Node 半边也从同一模块仅做类型导入。以新的 `./wire` 子路径导出（`package.json` exports + tsdown lib 入口 + 两个 tsconfig 聚合）。
- **`src/client/electron-api-client.ts`** —— `AbstractApiClient` 子类从壳迁入；其 `doFetch` 序列化进 `bridge.fetch`，mux/host 开启器消费推送流通道并用共享 frame schema 解析。import 保持在包内（`./api.ts` 重新导出基类）。
- **`src/client/ipc-rpc.ts`** —— `createIpcConnectionRpc(bridge)`，`createWebConnectionRpc` 的泛型 RPC 镜像，改走桥而非 `globalThis.fetch`，使 goal remotes 与每个泛型通道在 `dsh://` 页面上都能到达主进程。
- **`src/client/index.ts`** —— 传输接缝：`apply` 读取壳发布的启动时传输事实（`window.__DSH_TRANSPORT__ === 'ipc'`，由 preload 与 `window.dshApi` 一起发布）。fixture 页面仍然优先；带桥的 IPC 页面构造 `ElectronApiClient` 与 IPC rpc；其余页面维持 `WebApiClient`。

壳仅保留载体集成的胶水：preload（桥 + 传输事实）、主进程 `dsh:fetch` 处理器、流泵、`dsh://` 协议处理器，全部从 `@deepseek-ai/dsh-client-connection/wire` 导入线缆类型。壳的旧 `src/renderer/` 与 `src/shared/` 文件删除；被删提案文件的 knip 入口一并移除。desktop tsconfig 引用 connection 包的 host 聚合（仅 host 侧类型——双聚合规则不受影响）。

## Alternatives considered

### 子类与桥契约保留在壳内

壳的 renderer 目录永远不会进入运行时代码：渲染器执行的是出厂 dist 的 client bundles，而非壳源码。载体留在壳内会让线缆决策永久失效；迁入 connection 包是浏览器 bundle 能选择它的唯一位置。作为非方案被否决。

### 用 connection-Config 传输选项替代启动时 window 事实

connection 插件已有 Config 面。`transport: 'ipc'` 配置行可行，但桌面组合要把该选项经由 profile patch 树带进一个客户端半在 bundle 启动时读取配置的插件，且桥本身仍需类型化交接。window 事实（`__DSH_TRANSPORT__` + `dshApi`）是 preload 的既有面，把选择留在浏览器 apply 中与 fixture/real 决策并列，无需配置管道。被采用。

### 将桥契约内联进壳的 preload 类型

把 `DshApiBridge` 留在壳内并从 connection 包导入壳类型会反转依赖（client bundle 不得依赖壳），或导致契约重复。将线缆契约迁入 connection 包并以专用 `./wire` 子路径导出，使两个半边共享单一事实源。被采用。

## Consequences

- `DSH_DESKTOP_TRANSPORT=ipc` 现为完整端到端路径：渲染器的 `dsh-client-connection` bundle 选择 IPC 载体走 preload 桥，unary/respond 与泛型 RPC 乘坐 `dsh:fetch`，mux/host 帧经流泵到达。
- 线缆契约只有一处归宿。Loopback 模式不受影响（无传输事实；preload 仍暴露桥，但 `__DSH_TRANSPORT__` 保持 `'loopback'`，apply 维持 `WebApiClient`）。
- 已记录的 IPC 缺口不变：渲染器 AbortSignal 不跨 IPC（unary 取消退化为主进程侧完成）、`/api/session.export` 未在 IPC 上分块、loopback 模式仍保留 HTTP server。
- connection 包新增面（`./wire` 导出、`ElectronApiClient`、`createIpcConnectionRpc`）承担 client 包纪律：`pnpm run test:coverage` 中每文件 100% 覆盖率（新 spec 覆盖 unary/respond/流帧/abort/坏帧与 rpc 的关联、mismatch 与目标围栏）、bundle 纯度（无 electron 或壳 import）、双聚合类型分离。

## Testing

`pnpm run test:gui` 全绿（3768 个测试）。新增 client specs：`tests/electron-api-client.client.spec.ts`（桥 unary/respond/流/abort/坏帧/stream-end、doFetch 字段序列化）、`tests/ipc-rpc.client.spec.ts`（关联、mismatch、传输失败、目标围栏、未序列化 signal）、`tests/client-apply.client.spec.ts` 的 IPC 场景（传输事实 + 桥选择 `ElectronApiClient`、部分事实保持 `WebApiClient`、fixture 优先）。connection 包覆盖率：`src/` 全文件 statements/branches/functions/lines 100%。
