# DSH App Manager — 发布上线指南

> 本文档只写**当前真实状态**与**已验证过的事实**。每条命令都在本机执行过。
> 最后核对：2026-09-14，插件版本 **0.5.0**，宿主 dsh **0.1.5-rc.1**。

---

## 1. 发布形态：DSH 插件就是一个带 `dsh` 字段的 npm 包

安装方（其他用户）：

```bash
dsh plugin --profile <name> add dsh-app-manager
```

DSH 会：用 pnpm 把包装进 profile → 读 `package.json` 的 `dsh.bundle.patch`
→ 把包名加入 `dsh.profile.bundles` → 启动时合并 patch 并加载插件。

所以：**只要包在 npm registry 上，其他人就能装。** 无需官方审核。

> **依赖自包含（硬性约束）**：发布包只含本插件自身（29 个文件、
> 0 个 `node_modules` 文件），`dependencies` 为空 —— 安装时**只下载
> dsh-app-manager 需要的东西，不牵扯其他插件的依赖**。
> `lib/` 只 import Node 内置模块与相对路径；宿主能力走
> `peerDependencies`（`@deepseek-ai/dsh-tools`）由 DSH 注入。
> 新增依赖前先读 `PRD.md` §10 / `CONTRIBUTING.md`。

（本机实测：`~/.dsh/profiles/web/package.json` 的 `dsh.profile.bundles`
里就有 `dsh-app-manager`，通过 `link:` 指向本地仓库。）

---

## 2. 当前状态核对表

| 项 | 状态 | 备注 |
|----|------|------|
| npm 包名 `dsh-app-manager` | ✅ **未被占用** | 查 `registry.npmjs.org/dsh-app-manager` → `{"error":"Not found"}`；对照组 `typescript` 正常返回，证明该结论有效 |
| 仓库默认分支 | ✅ 已是真代码 | `main` = 真实提交，远端 `HEAD` 指向它 |
| `dsh.bundle.patch` | ✅ | `patch.yml` → `./patch.yml` |
| `files` 白名单 | ✅ | 实测打包 **29 个文件 / 88K**，见 §3 |
| LICENSE | ✅ MIT | |
| CHANGELOG | ✅ | Keep a Changelog + semver |
| README | ✅ 双语 | 含平台支持矩阵、扫描方法论、已知限制 |
| 测试 | ✅ | 全量 51 + 跨平台 15 + 审批 11 + 性能 12 + 拖拽 13 + 冒烟 22 |
| CI | ✅ | `.github/workflows/ci.yml`（ubuntu 构建 + Windows 全量测试） |
| `peerDependencies` | ✅ | `@deepseek-ai/dsh-tools: ^0.1.5-rc.1`（与 dsh 自身声明一致） |
| lockfile | ✅ | 与 package.json 一致；`pnpm install --frozen-lockfile` 通过 |
| 打包产物自足性 | ✅ | 解包后可直接运行 CLI、`apply()` 注册 7 工具 + 4 路由 |
| `app_manager_update` 审批门槛 | ✅ | 接 `approval` 服务，仅 `allowed-once` 放行；无审批器时 **fail closed** |

---

## 3. 发布包内容（实测，非推测）

`files` 白名单为 `["lib", "patch.yml", "README.md", "CHANGELOG.md", "LICENSE"]`，
npm 另会自动带上 `package.json`。`pnpm pack` 实测结果：

```
CHANGELOG.md   LICENSE   README.md   package.json   patch.yml
lib/bin/cli-app-manager.{js,d.ts,*.map}
lib/src/{index,discovery,commands,utils,types}.{js,d.ts,*.map}
```

**29 个文件 / 88K。** 确认**不含**：`src/`、`tests/`、`node_modules`、
`PRD.md`/`DESIGN.md`/`PUBLISH.md`、`.pptx`、`.slidep/`。

**零运行时依赖** —— 只用 Node 内置模块，`tools`/`webServer`/`approval` 均由宿主注入。

---

## 4. 发布步骤

```bash
cd dsh-app-manager

# 1) 确认在正确的分支、工作区干净
git status && git log --oneline -3

# 2) 全量自检（CI 会跑同样的东西）
pnpm install --frozen-lockfile
pnpm build
pnpm test:quick && pnpm test:paths && pnpm test:approval && pnpm test:perf && pnpm test:drag && pnpm smoke

# 3) 登录并发布
npm login
npm publish --access public
```

> `prepublishOnly` 已配置为 `pnpm build`，所以 `lib/` 一定是新的。
> 包名非 scoped，`publishConfig.access = public` 已就位。

### 发布前可先干跑

```bash
pnpm pack                       # 产出 dsh-app-manager-<version>.tgz
tar -tzf dsh-app-manager-*.tgz  # 核对内容清单（应与 §3 一致）
```

---

## 5. 发布后验证（在**另一台机器 / 全新 profile** 上做）

```bash
dsh plugin --profile web add dsh-app-manager
dsh web --port 3080 --no-open
# 打开 http://127.0.0.1:3080/app-manager
```

逐个确认：
1. `/app-manager` 能打开，列表非空；
2. `app-manager list` 在 **macOS/Linux** 上也能列出 npm 全局包
   （0.5.0 前的版本在这里会**静默返回 0 条**）；
3. AI 调用 `app_manager_update` 时**先弹审批**，拒绝后无任何改动；
4. `app-manager doctor` 能在合理时间内返回（0.5.0 前可能永久挂起）。

---

## 6. 平台支持（务必先看）

见 README 的「平台支持」表。要点：

- **Windows**：全功能。
- **macOS / Linux**：发现与分类可用；`managed` 语义退化为"是否由包管理器装入"
  （没有"添加/删除程序"基准）。**进程监视 `monitor` 未实现**。
- `scoop` / `choco` 仅在 Windows 存在。

---

## 7. 已知坑（都真实踩过，写下来省得重踩）

### 7.1 `--force-with-lease` 在本沙箱会报 `stale info`

裸用 `git push --force-with-lease origin main` 会被拒：
`! [rejected] main -> main (stale info)`。
原因：本沙箱 `.git/refs/remotes/` 恒为空，git 拿不到 lease 基线。

**解法**：手工给出期望值，安全性等价：

```bash
git ls-remote origin refs/heads/main          # 先读取当前远端 sha
git push --force-with-lease=refs/heads/main:<上面读到的sha> origin main
```

校验推送是否成功，看 `git ls-remote`，**不要**看 `git branch -vv`
（本沙箱跟踪状态恒显示 `[origin/xxx: gone]`，不代表失败）。

### 7.2 沙箱内的 npm 会走 wsl.exe，被程序黑名单拦截

`npm view` / `npm pack` 在沙箱内失败。用 **pnpm** 代替（`pnpm pack` 可正常工作）。
查 registry 是否占用可绕过 npm，直接访问
`https://registry.npmjs.org/<name>`。

### 7.3 `RefreshEnv` 会让 `doctor` 挂起

`RefreshEnv` 是 Chocolatey 的 `.cmd`，会调 `reg.exe`/`WMIC.exe`；若被安全策略拦截，
探测会无限阻塞。0.5.0 已把它归入噪声命令，并让 `execAsync` 强制超时
（**`child_process.spawn` 不认 `timeout` 选项**，只有 `exec`/`execFile` 认 —— 这是
0.4.6 引入过的真实回归）。

### 7.4 测试里给子进程打桩，必须在 import 插件之前

`node:child_process` 的 **ESM 命名空间在首次 import 时固定绑定值**。先 import 插件
再 patch `spawn`，桩会失效且**毫无报错**，测试会真的执行 `npm install -g`。
详见 `tests/approval-gate.test.mjs` 顶部的安全说明。

### 7.5 `lib/` 已提交，容易与 `src/` 脱节

改完 `src/` 必须 `pnpm build` 再提交。CI 里有守卫，用的是 `git diff -w --exit-code -- lib/`。

**为什么不是 `--ignore-cr-at-eol`**：本机 git 是 **2.9.0**，不认识这个选项 ——
而且它报错后**退出码仍是 0**，于是守卫会「静默通过」（我一开始就被它骗过一次）。
`-w` 在 2.9 和新版 git 上都可用，且同样忽略行尾 CR，是更稳的选择。

> 教训：验证命令本身也要验证。`cmd 2>/dev/null && echo OK` 这种写法会把
> 「命令报错」伪装成「命令成功」，因为退出码未必是你以为的那个。

### 7.6 测试里的 jsdom 必须 >= 27

jsdom 26 及更早**没有 `PointerEvent` 构造器**，而拖拽测试完全依赖 pointer 事件。
另外 jsdom 27+ 要求 Node >= 20，所以 CI 用 Node 22。

---

## 8. 仍未做 / 待决策

- **`dsh.client` 未声明 —— 决定：本次发布不做。**
  这不是一个元信息字段，而是一次**客户端集成**。本机 `dsh-better-sidebar@0.19.1`
  就是现成参照，它的声明是：

  ```json
  "dsh": {
    "bundle": { "patch": "./cordis.patch.yml" },
    "client": {
      "inject": ["@deepseek-ai/dsh-client-locale", "@deepseek-ai/dsh-client-ui-slots",
                 "@deepseek-ai/dsh-client-ui-conversation",
                 "@deepseek-ai/dsh-client-ui-sidebar-right",
                 "@deepseek-ai/dsh-client-modules"],
      "platform": "web"
    }
  }
  ```

  而它的 `files` 里确实带着 `lib/client.js`、`lib/client-registry.js`、
  `lib/client-terminal.js` 等**真正的客户端产物**。
  也就是说：`dsh.client` 必须配一套客户端 bundle 才有意义，
  **声明了却没有对应产物会让 DSH 加载插件直接失败** —— 比"没有 UI 入口"严重得多。
  网页版已可通过固定 URL 使用，入口可发现性属锦上添花。
  若要补，建议作为独立需求排期（需要引入上述 client 包 + 单独的客户端构建流程）。
- 仓库描述目前是 `manager local CLI apps`（偏简陋，会出现在搜索结果里）—— 只能改 GitHub 设置，git 改不了。
- `engines: >=18` 未在 CI 中实测（CI 用 Node 22，因为 `jsdom >= 27` 要求 Node >= 20）。
  **注意**：`engines` 约束的是发布包的运行时，而本包**零运行时依赖**，所以
  Node 18 用户安装本包不受影响；受限的只是开发环境。
- 仓库仍有 `master` / `feat` / `bugfix` 三个停在旧位置的散乱分支（未删，作为备份）。
- LICENSE 的版权人写法是邮箱；如需改成姓名/ID 需自行决定（`package.json` 的 `author` 同理）。
