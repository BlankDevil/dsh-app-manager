# DSH App Manager — 产品需求文档 (PRD)

> 版本：v0.2.0 · 状态：已实现 · 用途：作为后续更新/重建的完整功能基线

---

## 1. 产品概述

**DSH App Manager** 是一个 DeepSeek Harness（DSH）插件，用于统一**发现、监控和管理**用户机器上已安装的命令行工具（CLI 应用）。

这类工具通常通过 npm、pnpm、scoop、choco 等包管理器安装，**不会出现在 Windows「应用程序」管理器中**，导致用户无法统一查看版本、状态、更新。本插件解决这个问题。

### 核心价值
- 一处查看所有 CLI 工具（跨包管理器）
- 统一检查更新、健康状态
- 同时提供 **CLI 命令**、**DSH AI 工具**、**Web 页面** 三种使用入口

---

## 2. 目标用户与场景

| 用户 | 场景 |
|------|------|
| 开发者 | 装了 claude、codex、dsh、pnpm 等多个 CLI 工具，想统一管理 |
| AI 助手（DSH） | 通过 tool 调用，帮用户查询/更新已安装工具 |
| 运维 | 通过 Web 页面快速浏览机器上的 CLI 工具清单 |

---

## 3. 功能清单

### 3.1 应用发现（Discovery）

扫描以下来源，识别带 CLI 入口的包：

| 来源 | 扫描方式 | 支持操作 |
|------|----------|----------|
| npm 全局 | 读 `%APPDATA%\npm\node_modules`（含 scoped 包） | 发现、检查更新、更新 |
| pnpm 全局 | `pnpm list -g --json` | 发现、检查更新、更新 |
| npx 缓存 | 读 `%LOCALAPPDATA%\npm-cache\_npx` | 发现 |
| scoop | 读 `~/scoop/apps` | 发现、更新 |
| choco | `choco list --local-only` | 发现、更新 |
| cargo | `cargo install --list` | 发现 |
| pipx | `pipx list --json` | 发现 |

**识别规则**：包 `package.json` 有 `bin` 字段，或包目录有 `bin/` 子目录。

**已知分类映射**：内置 60+ 常用包的 `命令 → 分类 → 描述` 映射表（`KNOWN_CLI_PACKAGES`）。

### 3.2 CLI 命令

| 命令 | 别名 | 功能 |
|------|------|------|
| `list` | `ls` | 列出所有发现的 CLI 应用（按分类分组） |
| `check` | `outdated` | 检查 npm/pnpm 应用是否有更新 |
| `info <app>` | `show` | 查看单个应用详情 |
| `update <app>` | `upgrade` | 更新单个应用 |
| `update-all` | `upgrade-all` | 更新所有有更新的应用 |
| `doctor` | `health` | 健康检查（PATH 状态、目录、版本命令） |
| `monitor` | `status` | 监控运行中的进程 |
| `search <query>` | `find` | 按名称/分类/命令搜索 |
| `export` | — | 导出 JSON 注册表 |
| `help` | `-h` | 帮助 |

### 3.3 DSH AI 工具（Tools）

| Tool 名称 | 功能 | 参数 |
|-----------|------|------|
| `app_manager_list` | 列出应用（markdown 表格） | `source?`, `category?` |
| `app_manager_info` | 查看应用详情 | `name` |
| `app_manager_check_updates` | 检查更新 | 无 |
| `app_manager_update` | 更新应用 | `name` |
| `app_manager_doctor` | 健康检查 | 无 |

### 3.4 Web 页面

| 路由 | 功能 |
|------|------|
| `GET /app-manager` | 服务端渲染 HTML 管理页面 |
| `GET /app-manager/api/apps` | JSON API，返回应用清单 |

页面展示：分类分组表格，含名称、版本、命令、来源、路径、PATH 状态。

---

## 4. 技术架构

### 4.1 技术栈
- **语言**：TypeScript（编译到 `lib/`）
- **运行时**：Node.js >= 18（ESM）
- **DSH 集成**：Cordis 插件（`apply` 函数 + `ctx.inject`）
- **构建**：`tsc`（无 bundler，服务端纯 TS）

### 4.2 目录结构

```
dsh-app-manager/
├── package.json          # 包配置 + DSH bundle/client 声明
├── patch.yml             # DSH bundle patch（insert 插件 entry）
├── tsconfig.json         # TS 编译配置
├── PRD.md                # 本文档
├── PUBLISH.md            # 发布指南
├── DESIGN.md             # 未来功能设计
├── README.md             # 用户文档
├── bin/
│   └── cli-app-manager.ts    # CLI 入口
├── src/
│   ├── index.ts          # DSH 插件入口（apply/inject/tools/webServer）
│   ├── discovery.ts      # 应用发现逻辑
│   ├── commands.ts       # CLI 命令处理
│   ├── utils.ts          # 工具函数（exec/version/colorize）
│   └── types.ts          # 共享类型定义
└── lib/                  # 编译输出（已提交）
```

### 4.3 数据模型

```typescript
interface CliApp {
  name: string;          // 包名，如 "@deepseek-ai/dsh"
  version: string;       // 版本，如 "0.1.2-rc.1"
  commands: string[];    // 命令名，如 ["dsh"]
  category: AppCategory; // ai/package-manager/dev/...
  description: string;
  source: AppSource;     // npm/pnpm/npx-cache/scoop/...
  path: string;          // 安装路径
  hasUpdate: boolean;
  latestVersion: string | null;
}
```

### 4.4 DSH 集成方式

**patch.yml**（bundle patch）：
```yaml
- insert:
    - id: app-manager
      name: 'dsh-app-manager'
```

**package.json** 声明：
```json
{
  "dsh": {
    "bundle": { "patch": "./patch.yml" }
  }
}
```

**插件入口**（`src/index.ts`）：
```typescript
export function apply(ctx: CordisContext): () => void {
  // 用 ctx.inject 动态注入 tools 和 webServer 服务
  ctx.inject(["tools"], (c) => registerTools(c.tools));
  ctx.inject(["webServer"], (c) => registerWebRoutes(c.webServer));
}
```

**关键约束**：访问 Cordis 服务必须用 `ctx.inject(["service"], cb)`，不能只靠 `export const inject = [...]`（会报 `cannot get property "tools" without inject`）。

---

## 5. 关键实现决策

| 决策 | 理由 |
|------|------|
| npm 发现走文件系统而非 `npm list` | 沙箱/权限环境 `execSync` 会 EPERM，直接读目录更稳 |
| 用 `ctx.inject` 而非 `export inject` | DSH loader 对 ESM `inject` 导出识别不稳定 |
| 服务端渲染 HTML（非 React client） | 避免 bundler 复杂度，快速交付页面 |
| peerDependencies 标记 optional | 插件可在无 `dsh-tools` 时仍作为 CLI 独立运行 |

---

## 6. 测试清单

- [x] `app-manager list` 发现 13 个应用（AI 3 + 包管理器 2 + 其他 8）
- [x] `app-manager info dsh` 显示完整详情
- [x] `app-manager search ai` 正确过滤
- [x] DSH web profile 加载无报错（dump-config 无 stderr）
- [x] headless profile boot 无 inject 报错
- [x] `/app-manager` 页面返回 HTML（在 3081 端口验证）
- [x] `/app-manager/api/apps` 返回 JSON

---

## 7. 已知限制

- Windows 进程监控依赖 PowerShell 或 tasklist
- `npm view` 查更新可能超时（私有包/scoped 包）
- scoop/cargo/pipx 仅发现，自动更新覆盖不全
- 页面无客户端交互（纯服务端渲染），暂无「点击启动」按钮

---

## 8. 版本历史

| 版本 | 变更 |
|------|------|
| 0.1.0 | 初版（JS）：发现 + CLI 命令 |
| 0.2.0 | TypeScript 重写 + DSH tools + /app-manager 页面 |

---

## 9. 未来路线

见 `DESIGN.md`（从界面启动服务/打开 CLI、客户端侧边栏入口等）。
