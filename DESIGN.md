# DSH App Manager — 未来功能设计

> 主题：从 app-manager 界面直接**启动服务**或**打开 CLI**

---

## 1. 目标

当前 `/app-manager` 页面只能**查看**应用清单（只读）。未来要支持从界面直接：

1. **启动服务**：一键启动 dev server / 数据库 / 守护进程等
2. **打开 CLI**：在终端中打开交互式 CLI（如 `claude`、`dsh`、`codex`）
3. **进程管理**：查看已启动进程、停止进程

---

## 2. 功能设计

### 2.1 启动服务（Launch Service）

**场景**：用户在页面上看到 `vite` 或某个 dev server 应用，点「启动」按钮，后台运行并返回状态。

```
[启动按钮] → POST /app-manager/api/start
  参数：{ app: "vite", args: ["--port", "5173"], cwd: "..." }
  返回：{ pid, command, startedAt, status }
```

**技术要点**：
- 服务端用 `child_process.spawn` 启动子进程
- 维护一个进程注册表（Map<uuid, ChildProcess>）
- 捕获 stdout/stderr 输出到日志 buffer
- 通过 API 轮询或 WebSocket 推送状态

### 2.2 打开 CLI（Open CLI Terminal）

**场景**：点击 `claude` 应用，在 DSH 侧边栏终端中打开交互式 CLI。

**两种实现路径**：

#### 路径 A：复用 `dsh-better-sidebar` 终端
若已安装 `dsh-better-sidebar`，其提供 `terminal_create` 工具，可打开持久终端。

```
POST /app-manager/api/open-cli
  → 调用 better-sidebar 的 pty 能力
  → 在侧边栏新建终端 tab，运行 claude/dsh/codex
```

#### 路径 B：独立 Web 终端（xterm.js）
插件自己实现 WebSocket + pty 终端。

**推荐路径 A**（复用已有能力，避免重复造轮子）。

### 2.3 进程监控与管理

```
GET  /app-manager/api/processes     # 列出插件启动的进程
POST /app-manager/api/stop/:uuid     # 停止某进程
GET  /app-manager/api/process/:uuid/log  # 读取进程日志
```

---

## 3. 交互 UI 设计（客户端侧边栏）

当前页面是**服务端渲染 HTML**，无交互。要支持点击启动/打开 CLI，需要**客户端插件**（React）。

### 3.1 客户端入口结构

```
src/
├── client/
│   ├── index.tsx          # 客户端入口，注册 slot
│   ├── AppManagerView.tsx # 主视图组件
│   ├── AppRow.tsx         # 单行应用（含启动/打开按钮）
│   └── api.ts             # 调用服务端 API
```

### 3.2 package.json 客户端声明

```json
{
  "dsh": {
    "bundle": { "patch": "./patch.yml" },
    "client": {
      "inject": [
        "@deepseek-ai/dsh-client-locale",
        "@deepseek-ai/dsh-client-ui-slots",
        "@deepseek-ai/dsh-client-ui-conversation",
        "@deepseek-ai/dsh-client-modules"
      ],
      "platform": "web"
    }
  }
}
```

### 3.3 客户端构建

需要 bundler（Rolldown 或 Vite）打包客户端 JS：

```
# 参考 dsh-better-sidebar 用 tsdown/rolldown 生成 lib/client.js
```

客户端产物 `lib/client.js` 通过 `window.__ModuleLoader__.load()` 加载。

---

## 4. 数据流

```
┌─────────────┐  React 组件   ┌──────────────┐  HTTP API   ┌─────────────┐
│  浏览器 UI   │ ───────────→ │  服务端插件   │ ──────────→ │ 子进程/spawn │
│ (client.tsx)│ ←─────────── │ (index.ts)   │ ←────────── │  进程注册表  │
└─────────────┘   JSON 响应   └──────────────┘  状态轮询   └─────────────┘
```

---

## 5. 关键 API 设计（服务端）

### 5.1 启动服务

```typescript
POST /app-manager/api/start
Body: {
  name: "vite",           // 应用名/命令
  args?: string[],        // 额外参数
  cwd?: string,           // 工作目录
  detached?: boolean      // 是否脱离父进程
}
Response: {
  uuid: string,
  pid: number,
  command: string,
  status: "running"
}
```

### 5.2 停止服务

```typescript
POST /app-manager/api/stop/:uuid
Response: { uuid, status: "stopped", exitCode }
```

### 5.3 进程列表

```typescript
GET /app-manager/api/processes
Response: {
  processes: [{ uuid, command, pid, startedAt, status }]
}
```

### 5.4 打开 CLI（复用 better-sidebar 终端）

```typescript
POST /app-manager/api/open-cli
Body: { name: "claude", args?: string[] }
→ 调用 better-sidebar 的终端服务，创建终端 tab
```

---

## 6. 安全考虑

| 风险 | 缓解措施 |
|------|----------|
| 任意命令执行 | 限制只能启动「已发现」的应用，不接受任意命令字符串 |
| 路径穿越 | 校验 cwd 在 workspace 内 |
| 进程泄漏 | 插件 dispose 时清理所有子进程 |
| 输出注入 | 日志渲染时 HTML 转义 |
| 越权访问 | 复用 DSH 的 token/auth fence |

---

## 7. 实现优先级

| 功能 | 复杂度 | 优先级 | 说明 |
|------|--------|--------|------|
| 启动服务 API（服务端） | 中 | P0 | 纯服务端，可先做 |
| 进程列表/停止 API | 中 | P0 | 纯服务端 |
| 客户端侧边栏入口 | 高 | P1 | 需 React + bundler |
| 启动/打开按钮交互 | 高 | P1 | 依赖客户端 |
| 复用 better-sidebar 终端 | 中 | P2 | 需调研其 API |
| WebSocket 实时日志 | 高 | P2 | 可选 |

---

## 8. 依赖调研清单（待确认）

> ⚠️ 本节任何一项若最终引入依赖，都必须遵守「10. 工程与协作约束」第 1 条：
> 只引用和下载**本插件自身需要的依赖**，不牵扯其他插件的依赖。
> 例如「参考 dsh-better-sidebar 的做法」≠ 引入它的依赖 —— 复用思路，
> 不复用包。

- [ ] `dsh-better-sidebar` 是否暴露「创建终端」的公开 API（可从其他插件调用）
- [ ] DSH client 打包规范（Rolldown 配置、`window.__ModuleLoader__` 协议）
- [ ] `dsh-client-ui-slots` 注册侧边栏 tab 的确切 API
- [ ] DSH token/auth fence 如何接入自定义 API 路由

---

## 9. 最小可行方案（MVP）

**先做纯服务端**，不引入客户端 bundler：

1. 服务端注册进程管理 API（start/stop/list）
2. `/app-manager` 页面加简单表单 + 原生 `<form>`/`fetch` 调用（纯 JS，无需 React）
3. 用 `XMLHttpRequest`/`fetch` 在 HTML 里实现按钮点击

这样能用最少的改动，先实现「从界面启动服务」，无需客户端插件复杂度。

---

## 10. 工程与协作约束（硬性）

本文件描述的所有未来功能，在设计、实现、评审时都受以下三条**硬性约束**
（完整规范见 `CONTRIBUTING.md`）：

1. **依赖自包含** —— 只引用和下载 dsh-app-manager **自身需要的依赖**，
   **不牵扯其他插件的依赖**。客户端打包（3.3 节）即使引入 bundler，
   产物也必须自包含；宿主能力（UI slots、locale、模块注册）一律走
   `dsh.client.inject` 由 DSH 提供，不把它们加进 `dependencies`。

2. **「统一署名」只约束维护者本人** —— 统一署名 `BlankDevil` 仅适用于
   仓库维护者 `@BlankDevil`（仓库级配置）。

3. **外部贡献者一律用他们自己的身份，不要求改配置**；**不要随意创建新的
   branch** —— 只用 `feat` / `bugfix` / `docs` / `chore` 四个既有分支，
   不另造衍生名或斜杠名，PR 合并后复用。
