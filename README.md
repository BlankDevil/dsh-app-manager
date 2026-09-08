# DSH App Manager

一个用于**发现、监控和管理**已安装 CLI 应用程序的统一工具。

## ✨ 功能特性

- 🔍 **自动发现** - 扫描 npm、pnpm、npx-cache、scoop、choco、cargo、pipx 等来源的 CLI 工具
- 📊 **统一视图** - 在一个界面查看所有 CLI 应用的版本、来源、状态
- ⬆️ **更新检查** - 一键检查所有应用是否有新版本
- 🏥 **健康检查** - 验证应用是否正常工作、命令是否在 PATH 中
- 📈 **进程监控** - 查看哪些 CLI 工具正在运行
- 🔎 **快速搜索** - 按名称、分类或命令搜索应用
- 📤 **导出注册表** - 导出 JSON 格式的应用清单

## 📦 安装

### 作为独立 CLI 工具使用

```bash
# 进入插件目录
cd dsh-app-manager

# 直接运行（无需安装）
node bin/cli-app-manager.js list

# 或链接为全局命令
npm link
# 然后可以直接使用
app-manager list
```

### 作为 DSH 插件安装

```bash
# 安装到 web profile
dsh plugin --profile web add ./dsh-app-manager

# 或安装到 headless profile
dsh plugin --profile headless add ./dsh-app-manager
```

## 🚀 使用方法

### 列出所有已安装的 CLI 应用

```bash
app-manager list
# 或简写
app-manager ls
```

输出示例：
```
🤖 AI (3)
Name                          Version     Commands           Source       Update
───────────────────────────────────────────────────────────────────────────────
@anthropic-ai/claude-code     2.1.263     claude             npm
@deepseek-ai/dsh              0.1.2-rc.1  dsh                npm
@openai/codex                 0.153.4     codex              npm

📦 PACKAGE-MANAGER (2)
Name                          Version     Commands           Source       Update
───────────────────────────────────────────────────────────────────────────────
npm                           11.5.2      npm, npx           npm
pnpm                          12.3.4      pnpm               npm

✅ Found 10 CLI applications in 1.2s
```

### 检查更新

```bash
app-manager check
```

### 查看应用详情

```bash
app-manager info claude
app-manager info dsh
app-manager info codex
```

### 更新应用

```bash
# 更新单个应用
app-manager update dsh

# 更新所有有更新的应用
app-manager update-all
```

### 健康检查

```bash
app-manager doctor
```

检查所有应用：
- ✅ 命令是否在 PATH 中
- ✅ 包目录是否存在
- ✅ 命令是否能正常返回版本

### 监控运行中的进程

```bash
app-manager monitor
```

### 搜索应用

```bash
app-manager search ai
app-manager search package
```

### 导出注册表

```bash
app-manager export --output my-apps.json
```

## 📋 支持的来源

| 来源 | 说明 | 支持操作 |
|------|------|----------|
| npm | 全局 npm 包 | 发现、检查更新、更新 |
| pnpm | 全局 pnpm 包 | 发现、检查更新、更新 |
| npx-cache | npx 缓存的包 | 发现 |
| scoop | Scoop 安装的包 | 发现、更新 |
| choco | Chocolatey 包 | 发现、更新 |
| cargo | Rust cargo 包 | 发现 |
| pipx | Python pipx 包 | 发现 |

## 🏗️ 作为 DSH Bundle 使用

本插件已配置为 DSH bundle，在 `package.json` 中声明了：

```json
{
  "dsh": {
    "bundle": {
      "patch": "./patch.yml"
    }
  }
}
```

安装到 DSH profile 后，会自动注册应用管理服务。

## 📁 项目结构

```
dsh-app-manager/
├── package.json          # 包配置和 DSH bundle 声明
├── patch.yml             # DSH 层叠配置补丁
├── README.md             # 本文档
├── bin/
│   └── cli-app-manager.js    # CLI 入口
└── src/
    ├── index.js          # DSH 插件入口
    ├── discovery.js      # 应用发现逻辑
    ├── commands.js       # 命令处理
    └── utils.js          # 工具函数
```

## 🔧 开发

```bash
# 运行测试
node bin/cli-app-manager.js list
node bin/cli-app-manager.js check
node bin/cli-app-manager.js doctor

# 调试模式
set DEBUG=1
node bin/cli-app-manager.js list
```

## 📝 已知限制

- Windows 上进程监控依赖 PowerShell 或 tasklist
- npm view 查询可能在网络不佳时超时
- 某些包的版本检查可能失败（私有包、scoped 包等）

## 📄 License

MIT
