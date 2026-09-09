# DSH App Manager — 插件市场发布指南

> 调研结果：把 `dsh-app-manager` 发布为可供其他用户安装使用的插件，所需信息与步骤。

---

## 1. 发布前置：DSH 插件是什么

DSH 插件本质是 **一个带 `dsh` 字段声明的 npm 包**。安装时通过：

```bash
dsh plugin --profile <name> add <package-name>
```

DSH 会：
1. 在 profile 目录用 pnpm 安装该包
2. 读取其 `package.json` 的 `dsh.bundle.patch`
3. 若声明了 patch，自动把包名加入 `dsh.profile.bundles`
4. 启动时合并 patch，加载插件

**关键**：只要包在 npm registry（或可访问的 git/文件源）上，就能被 `dsh plugin add` 安装。

---

## 2. 发布所需信息清单

### 2.1 package.json 必备字段

| 字段 | 当前值 | 说明 |
|------|--------|------|
| `name` | `dsh-app-manager` | 必须是 npm 上唯一的名字 |
| `version` | `0.2.0` | 语义化版本 |
| `main` | `lib/src/index.js` | 插件入口（Cordis apply） |
| `types` | `lib/src/index.d.ts` | 类型声明 |
| `files` | `["lib", "patch.yml", "README.md"]` | 发布时打包的文件 |
| `dsh.bundle.patch` | `./patch.yml` | **关键**：让 DSH 识别为 bundle |
| `dsh.client` | （待加） | 客户端 UI 注入声明（可选） |
| `peerDependencies` | `@deepseek-ai/dsh-tools` | 声明依赖，标记 optional |

### 2.2 命名规范

- npm 上发布的包名建议带 scope 或前缀，避免冲突：
  - `dsh-app-manager`（当前，未 scope）
  - `@yourname/dsh-app-manager`（推荐，避免占用全局名）
- 查询是否被占用：`npm search dsh-app-manager`

### 2.3 许可证与元信息

- `license`: MIT（当前）
- `author`: 需要改成真实作者信息
- `description`: 一句话说明
- `keywords`: 加 `dsh-plugin`、`dsh` 等标签便于搜索

### 2.4 可选：DSH 客户端声明

如果要支持 DSH UI 内入口（侧边栏/菜单），需要补 `dsh.client`：

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

（参考 `dsh-better-sidebar` 的 `dsh.client` 结构。）

---

## 3. 发布步骤

### 步骤 1：完善包元信息

```bash
cd dsh-app-manager
# 修改 package.json 的 author / description / repository 等
```

### 步骤 2：确保构建产物最新

```bash
pnpm run build          # 生成 lib/
node lib/bin/cli-app-manager.js list   # 冒烟测试
```

### 步骤 3：登录 npm

```bash
npm login
```

### 步骤 4：发布

```bash
npm publish --access public
```

> 若用 scoped 名（`@scope/name`），公开包必须加 `--access public`；非 scoped 名默认公开。

### 步骤 5：验证安装

```bash
# 在另一台机器 / 全新 profile 测试
dsh plugin --profile web add dsh-app-manager
dsh web --port 3080 --no-open
# 访问 http://127.0.0.1:3080/app-manager
```

---

## 4. 发布到「DSH 插件市场」的额外要求

从 DSH 已有插件（`dsh-better-sidebar`、`dshmarket`）推断，官方插件市场可能有以下要求：

| 要求 | 说明 | 当前状态 |
|------|------|----------|
| 发布到 npm | 基础要求 | 待发布 |
| `dsh.bundle.patch` 声明 | 必须 | ✅ 已有 |
| `files` 白名单 | 控制包体积 | ✅ 已有 |
| README 双语 | 中英文文档 | ⚠️ 需补英文 |
| 类型声明 `.d.ts` | 便于其他插件依赖 | ✅ 已有（`types`） |
| 版本遵循 semver | 便于升级 | ✅ 已有 |
| 与 DSH 版本兼容性 | `peerDependencies` 声明 | ⚠️ 需确认版本范围 |

### 尚未确认的官方流程

以下需进一步调研（当前环境无法联网确认）：
1. DSH 是否有独立的插件审核/上架平台（类似 VS Code Marketplace）？
2. 是否需要向 DSH 官方提交注册申请？
3. 是否有插件质量门槛（安全审计、签名）？

**建议**：查阅 DSH 官方文档或联系 DeepSeek 团队，确认是否有专门的 marketplace 上架流程；仅发布到 npm 已能满足 `dsh plugin add <name>` 的安装需求。

---

## 5. 发布前代码改进清单

| 改进项 | 优先级 | 原因 |
|--------|--------|------|
| 补英文 README | 高 | 扩大受众 |
| 完善 `author`/`repository` | 高 | 专业形象 + 问题追踪 |
| 补 `dsh.client` 声明 | 中 | 支持 UI 入口 |
| 单元测试（discovery/utils） | 中 | 提高可靠性 |
| 版本号检查（`npm view` 超时兜底） | 低 | 网络环境鲁棒性 |
| 处理非 Windows 平台 | 低 | 当前偏 Windows |

---

## 6. 快速发布命令汇总

```bash
cd dsh-app-manager
pnpm run build
npm login
npm publish --access public
```

发布后，任何用户只需：

```bash
dsh plugin --profile web add dsh-app-manager
```

即可安装使用。
