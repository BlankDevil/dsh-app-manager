# DSH App Manager

> 🇨🇳 一个用于**发现、监控和管理**已安装 CLI 应用程序的统一工具。
> 🇺🇸 A unified tool for **discovering, monitoring, and managing** installed CLI applications.

---

## ✨ Features / 功能特性

| Feature | 中文说明 |
|---------|----------|
| 🔍 Auto Discovery | 扫描 npm、pnpm、npx-cache、scoop、choco、cargo、pipx、pip、uv 等来源的 CLI 工具 |
| 🧭 PATH Enumeration | 遍历 PATH 每个目录，发现**便携版 / 手动放置**的可执行文件 |
| 🏷️ Managed vs Unmanaged | 交叉比对 Windows「添加/删除程序」注册表，标出**非托管**程序 |
| 📊 Unified View | 在一个界面查看所有 CLI 应用的版本、来源、托管状态 |
| ⬆️ Update Check | 一键检查所有应用是否有新版本 |
| 🏥 Health Check | 验证应用是否正常工作、命令是否在 PATH 中 |
| 📈 Process Monitor | 查看哪些 CLI 工具正在运行 |
| 🔎 Quick Search | 按名称、分类或命令搜索应用 |
| 📤 Export Registry | 导出 JSON 格式的应用清单 |
| 🤖 DSH AI Tools | 注册 AI-callable tools，让 DSH 帮你查询和更新 |
| 🌐 Web Dashboard | 在浏览器访问 `/app-manager` 管理页面 |

---

## 🧭 How It Scans / 扫描方法

扫描采用**多源交叉比对**，确保既不漏掉包管理器安装的工具，也能发现散落的便携程序：

| # | 数据源 | 方法 | 捕获内容 |
|---|--------|------|----------|
| 1 | 包管理器 | `npm`(读目录) / `pnpm list -g --json` / `npx-cache`(读目录) / `choco list` / `cargo install --list` / `pipx list --json` / `pip list --format=json` / `uv tool list` | 各包管理器托管的工具 |
| 2 | **PATH 枚举** | 遍历 `PATH` 每个目录，匹配可执行扩展名（`.exe/.cmd/.bat/.com/.ps1`） | **便携 / 手动放置**的可执行文件 |
| 3 | **ARP 注册表** | 读取 `HKLM\|HKCU` 下的 `Uninstall` 键 | Windows 安装器托管程序（基准） |
| 4 | **交叉比对** | PATH 结果 ∩ ARP 基准 | 在 PATH 上但不在 ARP 中 = **非托管程序** |

判定「托管」的两条路径：
- **名称匹配**：ARP 显示名与命令名规范化后互相包含（如 `7-Zip` ↔ `7z`）；
- **路径归属**：可执行文件位于某个 ARP 记录的 `InstallLocation` 之下（可捕获 `idea64`、`pycharm64` 这类与产品名不一致的启动器）。

用 `app-manager method` 可以导出当前机器的实际扫描报告（哪些来源可用、各贡献多少条）。

---

## 📦 Installation / 安装

### From npm / 从 npm 安装

```bash
# Install globally as CLI tool
npm install -g dsh-app-manager

# Or install as DSH plugin
dsh plugin --profile web add dsh-app-manager
```

### From source / 从源码安装

```bash
# Clone
git clone https://github.com/BlankDevil/dsh-app-manager.git
cd dsh-app-manager

# Build
pnpm install
pnpm run build

# Link as global CLI
npm link

# Or install as DSH plugin
dsh plugin --profile web add ./dsh-app-manager
```

---

## 🚀 Usage / 使用方法

### CLI Commands / CLI 命令

```bash
# List all installed CLI apps
app-manager list
app-manager ls

# List programs NOT managed by a Windows installer (portable / manual)
app-manager unmanaged
app-manager portable

# Show how the scan works (sources + techniques)
app-manager method
app-manager method --output scan.json

# Filter list by source / category
app-manager list --source npm
app-manager list --category ai

# Check for updates
app-manager check
app-manager outdated

# Show app details
app-manager info claude
app-manager info dsh

# Update an app
app-manager update dsh
app-manager upgrade dsh

# Update all outdated apps
app-manager update-all

# Health check
app-manager doctor

# Monitor running processes
app-manager monitor

# Search apps
app-manager search ai

# Export registry to JSON
app-manager export --output my-apps.json
```

### DSH AI Tools / DSH AI 工具

Install into DSH profile to register AI-callable tools:

```bash
dsh plugin --profile web add dsh-app-manager
```

Registered tools:
- `app_manager_list` — List all CLI apps (markdown table)
- `app_manager_info` — Show details of one app
- `app_manager_check_updates` — Check for available updates
- `app_manager_update` — Update a specific app ⚠️ **requires approval**
- `app_manager_doctor` — Run health check
- `app_manager_unmanaged` — List programs not managed by a Windows installer
- `app_manager_scan_method` — Explain the scan sources & techniques

#### `app_manager_update` needs approval / 更新工具需要审批

This is the only tool that **changes your machine** — it runs
`npm install -g <pkg>@latest`. It asks DSH's approval service first and proceeds
only on an `allowed-once` grant.

**It fails closed.** If the deployment composes no approval answerer (headless,
CI, older hosts) the call is *refused* rather than silently allowed, because
"nobody to ask" must not mean "yes". The refusal message tells you both ways
forward:

```bash
app-manager update <pkg>                      # do it yourself
APP_MANAGER_ALLOW_UNATTENDED_UPDATE=1 ...     # opt out of the prompt (CI)
```

Only the *AI-callable tool* is gated. The `app-manager update` CLI you run
yourself is not — you are already the approver.

### Web Dashboard / 网页管理台

After installing into DSH web profile, visit:

```
http://127.0.0.1:3080/app-manager
```

Or access the JSON APIs:

```
http://127.0.0.1:3080/app-manager/api/apps        # all apps (+ managed flags)
http://127.0.0.1:3080/app-manager/api/unmanaged   # unmanaged only
http://127.0.0.1:3080/app-manager/api/method      # scan methodology report
```

---

## 🖥️ Platform Support / 平台支持

| Capability | Windows | macOS / Linux |
|------------|---------|---------------|
| npm / pnpm / npx-cache discovery | ✅ | ✅ (v0.5.0+) |
| cargo / pipx / pip / uv discovery | ✅ | ✅ |
| PATH enumeration (portable tools) | ✅ | ✅ |
| managed / unmanaged classification | ✅ via Add/Remove-Programs registry | ✅ package-manager provenance only¹ |
| scoop / choco discovery | ✅ | n/a (not installed) |
| Process monitor (`app-manager monitor`) | ✅ PowerShell / tasklist | ❌ not implemented |

¹ Off Windows there is no "Add/Remove Programs" baseline, so a package-manager
install is `managed` and anything found by PATH enumeration is `unmanaged` — i.e.
"not owned by a package manager". The label keeps its meaning; only the source
of truth changes.

---

## 📋 Supported Sources / 支持的来源

| Source | Description | Operations |
|--------|-------------|------------|
| npm | Global npm packages | Discover, check updates, update |
| pnpm | Global pnpm packages | Discover, check updates, update |
| npx-cache | Cached npx packages | Discover |
| scoop | Scoop packages (Windows) | Discover, update |
| choco | Chocolatey packages (Windows) | Discover, update |
| cargo | Rust cargo packages | Discover |
| pipx | Python pipx packages | Discover |
| pip | Global pip packages with a PATH entry | Discover |
| uv | uv-managed tools | Discover |
| **path** | **PATH-enumerated executables (portable / manual)** | **Discover** |
| _arp_ | _Windows Add/Remove registry — baseline for managed/unmanaged_ | _Cross-reference only_ |

---

## 🏗️ Architecture / 架构

### Repository layout / 仓库结构

```
dsh-app-manager/
├── package.json          # Package config + DSH bundle declaration
├── patch.yml             # DSH bundle patch (Cordis entry)
├── tsconfig.json         # TypeScript config
├── LICENSE               # MIT License
├── CHANGELOG.md          # Version history
├── README.md             # This document
├── src/                  # TypeScript sources
│   ├── index.ts          # DSH plugin entry (apply + inject)
│   ├── discovery.ts      # App discovery + managed/unmanaged cross-reference
│   ├── commands.ts       # CLI command handlers
│   ├── utils.ts          # Utilities (exec, PATH enumeration, global roots, ARP)
│   └── types.ts          # Shared TypeScript types
├── bin/
│   └── cli-app-manager.ts    # CLI entry point
├── lib/                  # ✨ build output — committed, so local installs work
├── tests/                # Test suite + specs (not published)
├── .github/workflows/    # CI
├── PRD.md                # Product Requirements Document (not published)
├── DESIGN.md             # Future feature design (not published)
└── PUBLISH.md            # Release guide (not published)
```

### What the npm package contains / 发布包内容

Only these ship (the `files` whitelist in `package.json`) — everything else in
the tree above exists for development:

```
lib/            # compiled JS + .d.ts (including lib/bin/cli-app-manager.js)
patch.yml       # DSH bundle patch
README.md
CHANGELOG.md
LICENSE
package.json    # always included by npm
```

There are **no runtime dependencies** — the plugin uses only Node built-ins and
receives `tools` / `webServer` / `approval` from the DSH host at runtime.

### DSH Integration / DSH 集成

This plugin registers as a DSH bundle via `patch.yml`:

```yaml
- insert:
    - id: app-manager
      name: 'dsh-app-manager'
```

The plugin uses `ctx.inject()` to dynamically inject `tools` and `webServer` services:

```typescript
export function apply(ctx: CordisContext): () => void {
  ctx.inject(["tools"], (c) => registerTools(c.tools));
  ctx.inject(["webServer"], (c) => registerWebRoutes(c.webServer));
}
```

---

## 🔧 Development / 开发

```bash
# Install dependencies
pnpm install

# Build TypeScript
pnpm run build

# Run CLI locally
node lib/bin/cli-app-manager.js list

# Test with DSH web profile
dsh --profile web --dump-default-config
```

---

## 📝 Known Limitations / 已知限制

- Process monitoring is Windows-only (PowerShell / tasklist)
- `npm view` queries may timeout on poor network connections
- Version checks may fail for private/scoped packages
- Some sources (scoop, cargo, pipx) are discover-only (no auto-update yet)
- Global-package discovery reads the filesystem, so it reports what is
  *installed*, not what is currently on `PATH` — a tool can show up here and
  still fail `app-manager doctor` if its `bin` directory is missing from `PATH`

---

## 🧪 Tests / 测试

```bash
npm test              # 全量套件（51 用例）
npm run test:quick    # 跳过网络用例
npm run test:ui       # 只跑 UI 相关组
npm run test:paths    # 跨平台全局路径推导（15）
npm run test:approval # 审批门槛（11）
npm run test:perf     # 性能守卫 + 子进程超时健壮性（12）
npm run test:drag     # 拖拽交互行为（13）
npm run smoke         # 特性冒烟（22）
```

`test:approval` **stubs `child_process.spawn`, so it never installs anything** —
but please read the safety note at the top of the file before editing it.

`test:drag` needs **jsdom >= 27** (a devDependency; jsdom 26 and earlier have no
`PointerEvent`, which the drag handling is built on).

CI (`.github/workflows/ci.yml`) runs a Linux build + smoke job and the full suite
on Windows. Both use Node 22.

---

## 📄 License / 许可证

MIT

---

## 🤝 Contributing / 贡献

Issues and PRs are welcome at [GitHub Issues](https://github.com/BlankDevil/dsh-app-manager/issues).
