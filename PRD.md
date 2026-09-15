# DSH App Manager — 产品需求文档 (PRD)

> 版本：v0.4.0 · 状态：已实现 · 用途：作为后续更新/重建的完整功能基线

---

## 1. 产品概述

**DSH App Manager** 是一个 DeepSeek Harness（DSH）插件，用于统一**发现、监控和管理**用户机器上已安装的命令行工具（CLI 应用）。

这类工具通常通过 npm、pnpm、scoop、choco 等包管理器安装，**不会出现在 Windows「应用程序」管理器中**，导致用户无法统一查看版本、状态、更新。本插件解决这个问题。

### 核心价值
- 一处查看所有 CLI 工具（跨包管理器 + PATH）
- **区分「托管」与「非托管（便携）」程序**
- 统一检查更新、健康状态
- 同时提供 **CLI 命令**、**DSH AI 工具**、**Web 页面** 三种使用入口

---

## 2. 目标用户与场景

| 用户 | 场景 |
|------|------|
| 开发者 | 装了 claude、codex、dsh、pnpm 等多个 CLI 工具，想统一管理 |
| AI 助手（DSH） | 通过 tool 调用，帮用户查询/更新已安装工具 |
| 运维 | 通过 Web 页面快速浏览机器上的 CLI 工具清单，找出非托管程序 |

---

## 3. 功能清单

### 3.1 应用发现（Discovery）

**采用多源交叉比对策略**，扫描以下来源：

| 来源 | 扫描方式 | 支持操作 |
|------|----------|----------|
| npm 全局 | 读 `%APPDATA%\npm\node_modules`（含 scoped 包） | 发现、检查更新、更新 |
| pnpm 全局 | `pnpm list -g --json` | 发现、检查更新、更新 |
| npx 缓存 | 读 `%LOCALAPPDATA%\npm-cache\_npx` | 发现 |
| scoop | 读 `~/scoop/apps` | 发现、更新 |
| choco | `choco list --local-only` | 发现、更新 |
| cargo | `cargo install --list` | 发现 |
| pipx | `pipx list --json` | 发现 |
| pip 全局 | `pip list --format=json`（仅保留有 PATH 命令的） | 发现 |
| uv | `uv tool list` | 发现 |
| **PATH 枚举** | 遍历 PATH 每个目录，匹配可执行扩展名 | **发现（便携/手动）** |
| **_ARP 注册表_** | _读 `HKLM\|HKCU` 的 `Uninstall` 键_ | _交叉比对基准_ |

**识别规则**：
- 包管理器来源：包 `package.json` 有 `bin` 字段，或包目录有 `bin/` 子目录。
- PATH 来源：目录下扩展名属于 `.exe/.cmd/.bat/.com/.ps1`（Windows）或无扩展名（*nix）的文件。
- 已知分类映射：内置 90+ 常用包/命令的 `命令 → 分类 → 描述` 映射表。

### 3.2 托管 / 非托管判定

每个发现的应用都带 `managed: boolean` 与 `installKind`：

| installKind | 含义 |
|-------------|------|
| `managed` | 被 Windows 安装器（ARP）或包管理器托管 |
| `portable` | 便携 / 手动解压程序 |
| `path-shim` | 在 PATH 上但无法归属任何包管理器的 shim |

**判定逻辑**：
1. 包管理器来源 → `managed`。
2. 可执行文件路径位于某个 ARP 记录的 `InstallLocation` 之下 → `managed`
   （捕获 `idea64`、`pycharm64` 这类命令名与产品名不一致的启动器）。
3. ARP 显示名与命令名规范化后互相包含 → `managed`。
4. 否则 → `portable` / `path-shim`（**非托管**）。

**噪声过滤**：排除系统目录（`System32`）、打包运行时（PortableGit `usr/bin`、
JetBrains/DevEco 自带运行时、`node_modules/.bin`）及命令变体
（`python_d`、`pip3.13`、`git-*` plumbing）。

### 3.3 CLI 命令

| 命令 | 别名 | 功能 |
|------|------|------|
| `list` | `ls` | 列出所有发现的 CLI 应用（按分类分组，含托管状态） |
| `unmanaged` | `portable` | **列出非托管（便携/手动放置）程序** |
| `method` | `how`, `scan` | **输出扫描方法论报告**（来源、技术、可用性、贡献数） |
| `check` | `outdated` | 检查 npm/pnpm 应用是否有更新 |
| `info <app>` | `show` | 查看单个应用详情 |
| `update <app>` | `upgrade` | 更新单个应用 |
| `update-all` | `upgrade-all` | 更新所有有更新的应用 |
| `doctor` | `health` | 健康检查（PATH 状态、目录、版本命令） |
| `monitor` | `status` | 监控运行中的进程 |
| `search <query>` | `find` | 按名称/分类/命令搜索 |
| `export` | — | 导出 JSON 注册表（含托管统计） |
| `help` | `-h` | 帮助 |

**全局选项**：`--output/-o <file>`、`--category/-c <cat>`、`--source/-s <src>`、`--json`。

### 3.4 DSH AI 工具（Tools）

| Tool 名称 | 功能 | 参数 |
|-----------|------|------|
| `app_manager_list` | 列出应用（markdown 表格，含 Install 列） | `source?`, `category?` |
| `app_manager_info` | 查看应用详情 | `name` |
| `app_manager_check_updates` | 检查更新 | 无 |
| `app_manager_update` | 更新应用 | `name` |
| `app_manager_doctor` | 健康检查 | 无 |
| `app_manager_unmanaged` | **列出非托管程序** | 无 |
| `app_manager_scan_method` | **说明扫描方法论** | 无 |

### 3.5 Web 页面

| 路由 | 功能 |
|------|------|
| `GET /app-manager` | 服务端渲染 HTML（含扫描方法论表、托管徽章、Install 列） |
| `GET /app-manager/api/apps` | JSON API，返回应用清单 + 托管统计 |
| `GET /app-manager/api/unmanaged` | JSON API，仅返回非托管程序 |
| `GET /app-manager/api/method` | JSON API，返回扫描方法论报告 |
| `POST /app-manager/api/open?name=<包名>` | **打开终端并执行该应用自己的命令** |
| `GET /app-manager/api/updates` | JSON API，返回有新版本的应用（`?refresh=1` 强制重查） |
| `POST /app-manager/api/update?name=<包名>` | **升级该应用到最新版**（执行的是服务端从发现结果推导出的命令） |

页面展示：分类分组表格，含名称、版本、命令、来源、**安装形态**、路径、`On PATH` 状态；
顶部含 Total / Managed / Unmanaged 统计徽章。

页面交互（三个动作）：

1. **点击 NAME 打开终端** —— 名称是一个按钮，点击后在宿主机打开一个终端窗口并执行
   该应用自己的命令。一个机制同时覆盖两类应用：CLI 工具打开自己的交互提示
   （`claude` → Claude Code），服务类当场启动（`9router` → 启动 9Router 服务）。
   终端窗口 `detached`，属于用户，不随插件卸载而关闭。
2. **VERSION 列的升级徽章** —— 页面异步拉取 `/api/updates`，有新版本的应用在版本号
   旁显示 `⬆ <最新版>`；点击后弹出**包含确切命令的确认框**，确认才执行升级。
3. **确认后才升级** —— 升级会改写全局安装的包且不可撤销，因此必须显式确认。

---

## 4. 技术架构

### 4.1 技术栈
- **语言**：TypeScript（编译到 `lib/`）
- **运行时**：Node.js >= 18（ESM）
- **DSH 集成**：Cordis 插件（`apply` 函数 + `ctx.inject`）
- **构建**：`tsc`（无 bundler，服务端纯 TS）
- **依赖**：**零运行时依赖**（`dependencies: {}`）。只引用和下载本插件自身需要的依赖（当前仅 Node 内置模块），**不牵扯其他插件的依赖**；宿主能力走 `peerDependencies` 由 DSH 提供（详见「10. 工程与协作约束」）

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
type AppSource =
  | "npm" | "pnpm" | "npx-cache" | "scoop" | "choco" | "cargo"
  | "pipx" | "pip" | "uv" | "path" | "winget" | "arp" | "other";

type InstallKind = "managed" | "portable" | "path-shim" | "unknown";

interface CliApp {
  name: string;           // 包名或命令名，如 "@deepseek-ai/dsh"
  version: string;        // 版本，如 "0.1.2-rc.1"
  commands: string[];     // 命令名，如 ["dsh"]
  category: AppCategory;  // ai/package-manager/dev/...
  description: string;
  source: AppSource;      // 发现来源
  path: string;           // 安装路径
  hasUpdate: boolean;
  latestVersion: string | null;
  managed: boolean;       // 是否被 Windows 安装器/包管理器托管
  installKind: InstallKind;
}

interface ManagedApp {    // ARP 基准条目
  name: string;
  version: string;
  publisher: string;
  installLocation: string;
}

interface PathExecutable { // PATH 枚举条目
  command: string;
  path: string;
  dir: string;
  ext: string;
}
```

### 4.4 关键工具函数（`utils.ts`）

| 函数 | 用途 |
|------|------|
| `getPathDirs()` | 拆分 PATH 为去重的目录列表（跳过未解析的 `%VAR%`） |
| `enumPathExecutables()` | 列出每个 PATH 目录中的可执行文件 |
| `readArpEntries()` | 读 Windows ARP 注册表（写临时 `.ps1` + `-File` 执行，强制 UTF-8） |
| `pathIndexHas()` | 缓存的 PATH 索引查询（替代逐次 `where`，大幅提速） |
| `namesLikelyMatch()` | 规范化名称模糊匹配（去 scope / 标点 / 大小写） |
| `appDataDir()` / `localAppDataDir()` / `homeDir()` | 环境变量缺失时的容错路径解析 |

### 4.5 DSH 集成方式

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
| **PATH 枚举 + ARP 交叉比对** | 单看包管理器会漏掉便携程序；ARP 提供「托管」基准 |
| **ARP 查询写临时 `.ps1` 后用 `-File` 执行** | 复杂脚本经 `-Command` 传递会被引号转义破坏，返回空 |
| **`-File` 执行时强制 `[Console]::OutputEncoding = UTF8`** | 避免中文产品名乱码 |
| **缓存 PATH 索引（`pathIndexHas`）** | 逐次 `where` 每包一次子进程，390+ 项时耗时 50s；索引后降到 ~9s |
| **优先路径归属匹配而非仅名称匹配** | `idea64`/`pycharm64` 与 ARP 显示名不一致，只能靠 `InstallLocation` 判定 |
| **PATH shim 与包管理器命令去重** | `npm`/`npx`/`pip` 会同时出现在两者，避免重复上报 |
| **「打开终端」一个机制覆盖 CLI 与服务** | 两者差别只在跑什么命令，而命令来自发现结果 —— 不必新造「服务类」分类去区分 |
| **绝不接受调用方给的命令字符串** | 只接受 `?name=`，命令由服务端从发现结果重新推导，并用 `/^[A-Za-z0-9._-]+$/` 复检；空格、引号、`&&`、重定向一律拒绝 |
| **动作接口只收 POST** | GET 可能被链接、预取、图片标签触发；启动进程与装包都不能由此发生 |
| **升级前必须确认（含确切命令）** | 全局装包不可撤销，确认框把将执行的命令行原样展示（与 CLI 共用同一命令来源） |
| **`On PATH` 而非 `Status` 作表头** | 该列内容一直是 `✅/❌ PATH`（命令能否解析），表头写 Status 名不副实；Path 列已被占用，故用 `On PATH` |
| **更新检查异步 + 5 分钟缓存** | 每个 npm 包一次网络查询，40 个应用串行会拖住首屏；页面先渲染，查到再给版本加徽章 |

---

## 6. 测试清单

- [x] `app-manager list` 发现应用并按分类分组，显示托管统计
- [x] `app-manager unmanaged` 正确列出非托管程序（本机 17 项）
- [x] `app-manager method` 输出方法论报告，ARP 读取 87 条基准
- [x] `app-manager info dsh` 显示完整详情（npm 全局发现恢复正常）
- [x] `app-manager search ai` 正确过滤
- [x] `app-manager export --output` JSON 含 `managed`/`installKind`
- [x] ARP 注册表读取（临时 `.ps1` + `-File`）返回 87 条，中文名不乱码
- [x] 交叉比对：JetBrains `idea64`/`pycharm64` 经 `InstallLocation` 正确判为 managed
- [x] 噪声过滤：`System32`、PortableGit `usr/bin`、Python 变体被排除
- [x] DSH web profile 加载无报错（dump-config 无 stderr）
- [x] headless profile boot 无 inject 报错
- [x] `/app-manager` 页面返回 HTML（含方法论表）
- [x] `/app-manager/api/apps`、`/api/unmanaged`、`/api/method` 返回 JSON

---

## 7. 已知限制

- Windows 进程监控依赖 PowerShell 或 tasklist
- `npm view` 查更新可能超时（私有包/scoped 包）
- scoop/cargo/pipx 仅发现，自动更新覆盖不全
- 页面无客户端交互（纯服务端渲染），暂无「点击启动」按钮
- PATH 枚举为非递归：仅扫描 PATH 目录直接子文件，不递归子目录
- ARP 判定依赖 `DisplayName`/`InstallLocation`，字段缺失的安装可能误判为非托管

---

## 8. 版本历史

| 版本 | 变更 |
|------|------|
| 0.1.0 | 初版（JS）：发现 + CLI 命令 |
| 0.2.0 | TypeScript 重写 + DSH tools + 页面 |
| 0.3.0 | Web Dashboard + 双语 README + 发布文档 |
| 0.4.0 | PATH 枚举 + ARP 交叉比对 + 托管判定 + `unmanaged`/`method` 命令/tools/API |

---

## 9. 未来路线

见 `DESIGN.md`（从界面启动服务/打开 CLI、客户端侧边栏入口等）。

---

## 10. 工程与协作约束（硬性）

以下三条是**硬性约束**，任何改动、任何贡献者都不得违反（完整规范见 `CONTRIBUTING.md`）：

1. **依赖自包含** —— 只引用和下载 dsh-app-manager **自身需要的依赖**，
   **不牵扯其他插件的依赖**。运行时 `dependencies` 保持为空，宿主能力一律走
   `peerDependencies` 由 DSH 注入；新增任何第三方依赖必须在 PR 里说明理由，
   并证明没有内置模块或既有依赖可替代。
   （发布包自包含：29 个文件、0 个 `node_modules` 文件、`lib/` 只 import
   `node:` 内置模块与相对路径。）

2. **「统一署名」只约束维护者本人** —— 统一署名 `BlankDevil`
   （LICENSE 版权人 / `package.json` author / git 提交身份）仅适用于
   仓库维护者 `@BlankDevil`，配置为仓库级。

3. **外部贡献者一律用他们自己的身份，不要求改配置**；分支名用
   **`<类型>/<主题>`** —— `feat/plugin-teardown`、`docs/branch-naming`、
   `chore/release-0.5.2`，一次 PR 只做一类事。⚠️ 不要同时存在裸
   `feat` / `bugfix` / `docs` / `chore` 分支：git 的分支名是 ref，而 ref
   不能既是文件又是目录 —— 裸分支在，`<类型>/<主题>` 就建不出来
   （`cannot lock ref ... 'refs/heads/chore' exists`）。
