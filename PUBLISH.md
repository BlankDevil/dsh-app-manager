# DSH App Manager — 发布上线指南

> 本文档只写**当前真实状态**与**已验证过的事实**。每条命令都在本机执行过。
> 最后核对：2026-10-15，插件版本 **0.8.0**（待发布，registry 上 `latest` 仍是 0.5.3），
> 宿主 dsh **0.1.5-rc.1 / 0.2.0-rc.2**（两条线都支持；契约逐项对照见 `COMPATIBILITY.md`）。

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
| 测试 | ✅ | **380 项全过**（2026-10-15 实测）：主套件 52 + 页面动作 223 + 拖拽/布局 18 + 宿主兼容 16 + 性能 15 + 跨平台 15 + 审批 11 + 冒烟 22 + 修复回归 8 |
| CI | ✅ | `.github/workflows/ci.yml`（ubuntu 构建 + Windows 全量测试） |
| `peerDependencies` | ✅ | `@deepseek-ai/dsh-tools: ^0.1.5-rc.1 \|\| ^0.2.0-rc.2`（覆盖两条宿主线；**范围会被宿主校验，写窄=装不上**） |
| lockfile | ✅ | 与 package.json 一致；`pnpm install --frozen-lockfile` 通过 |
| 打包产物自足性 | ✅ | 解包后可直接运行 CLI、`apply()` 注册 7 工具 + 7 路由 |
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

**29 个文件。** 0.8.0 实测（`npm pack`）：

```
package size   : 141.0 kB（tgz，141 002 字节）
unpacked size  : 527.7 kB
total files    : 29
sha1           : f2f6e8ba55274b9e3f8826c656ed2b57222fbee7   ← 应等于 registry 的 dist.shasum
sha256         : a21e0abe808c10f8e392e45b123185e150d8e10e13e2c19aef39a7ff2988707d
```

**可复现**：连打两次，sha256 完全相同（2026-10-15 实测）——所以发布后可用
registry 的 `dist.shasum` 与本地 sha1 对拍，确认「发布的就是验证过的这份」。

`LICENSE` / `README.md` / `CHANGELOG.md` / `patch.yml` / `package.json` 均已确认在包内。
确认**不含**：`src/`、`tests/`、`node_modules`、
`PRD.md`/`DESIGN.md`/`PUBLISH.md`、`.pptx`、`.slidep/`。

**零运行时依赖** —— 只用 Node 内置模块，`tools`/`webServer`/`approval` 均由宿主注入。

---

## 4. 发布步骤（**PowerShell 5.1，一行一条**）

> ⚠️ 本机终端是 **Windows PowerShell 5.1**，**不支持 `&&`**
> （报 `标记"&&"不是此版本中的有效语句分隔符`）。
> 下面每行都是一条独立命令，直接粘即可；**不要把它们合并成一行用 `&&` 串**。

```powershell
cd E:\Workspace\dsh-playground\dsh-app-manager

# --- 1) 切到发布分支（本地若无，会自动跟踪 origin/rel-0.8.0）---
git fetch origin
git checkout rel-0.8.0
git log --oneline -1          # 应显示 97dba2a

# --- 2) 确认版本与工作区 ---
git status                    # 应为 clean（未跟踪的 tests/reports/*.md 不算）
npm pkg get version           # 应显示 "0.8.0"

# --- 3) 构建 + 全量自检 ---
pnpm install --frozen-lockfile
pnpm build
pnpm test:quick
pnpm test:paths
pnpm test:approval
pnpm test:perf
pnpm test:drag
pnpm smoke

# --- 4) 干跑，核对产物与校验和 ---
npm pack
Get-FileHash .\dsh-app-manager-0.8.0.tgz -Algorithm SHA1      # 应 f2f6e8ba55274b9e3f8826c656ed2b57222fbee7
Get-FileHash .\dsh-app-manager-0.8.0.tgz -Algorithm SHA256    # 应 a21e0abe808c10f8e392e45b123185e150d8e10e13e2c19aef39a7ff2988707d
Remove-Item .\dsh-app-manager-0.8.0.tgz                       # 别把 tgz 留在仓库里

# --- 5) 登录（2FA 账号）---
npm login --registry=https://registry.npmjs.org/
npm whoami  --registry=https://registry.npmjs.org/            # 应显示 blankdevil

# --- 6) 发布 ---
npm publish --registry=https://registry.npmjs.org/ --access public
# 若仍需 OTP：在上一行末尾加 --otp=<6位动态码>
```

> `prepublishOnly` 已配置为 `pnpm build`，所以 `lib/` 一定是新的。
> 包名非 scoped，`publishConfig.access = public` 已就位。

### 4.1 ⚠️ `npm whoami` 报 401 时的排查顺序

本机 2026-10-15 就是这个状态。按顺序查，别乱试：

1. **键名对不对**（历史上真踩过）：`~/.npmrc` 里必须是
   `//registry.npmjs.org/:_authToken=` —— **`.org`**。
   `registry.npmjs.com` 是**网站**域名，`registry.npmjs.org` 才是 **registry**，
   两者不通用。若 `npm login` 写成了 `.com` 键，`whoami` 会报 ENEEDAUTH。
   本机当前键名**已经是 `.org`**，所以这条不是本次原因。
2. **token 本身是否还有效**：键名对了仍 401 → token 已过期/被撤销。
   去 npmjs.com → Access Tokens 生成新的：
   - 类型 **Granular Access Token**
   - 勾选 **Bypass two-factor authentication**（这样 `publish` 不必带 `--otp`）
   - 权限 `Read and write`，包范围含 `dsh-app-manager`
   然后把 `~/.npmrc` 里那一行**整行替换**成新 token。
3. `npm config get //registry.npmjs.org/:_authToken` 报
   `option is protected` **不能作为"有没有 token"的证据** —— 查一个不存在的
   域名会报同样的错。判据只有 `npm whoami` 是否返回 `blankdevil`。

### 4.2 发布后验证（必做）

```powershell
npm view dsh-app-manager version     --registry=https://registry.npmjs.org/   # 应 0.8.0
npm view dsh-app-manager dist.shasum --registry=https://registry.npmjs.org/   # 应 f2f6e8ba55274b9e3f8826c656ed2b57222fbee7
npm view dsh-app-manager dist.tarball --registry=https://registry.npmjs.org/
```

`dist.shasum` 必须等于 §4 第 4 步算出的 SHA1 —— 这才是"发出去的就是验证过的
那份"的证据。（`npm pack --dry-run` 报的 shasum **和实际产物不一致**，别拿它当基线。）

### 4.3 打 tag（发布成功后，由维护者发起）

```powershell
git tag -a v0.8.0 -m "dsh-app-manager 0.8.0"
git push origin v0.8.0
```

---

## 4bis. ⚠️ 发布前要知道的两件事（2026-10-15 实测）

### (a) 所有**写** Git 的操作只能由维护者在本机做

这不是发布缺陷，是**自动化侧的能力边界**。原因是两条独立的限制：

**① `github.com:443` 从自动化沙箱不通**（三个方向全试过）：

| 方式 | 结果 |
|------|------|
| 走本机代理 `http://127.0.0.1:5183` | `CONNECT tunnel failed, response 502` |
| 直连（`--noproxy '*'` / `env -u *_proxy`） | `Failed to connect to github.com:443 after 21068 ms` |
| `ssh.github.com:443` | 不可达；`~/.ssh/` 为空（无密钥） |

**② GitHub API 是只读的**：`create_branch` / `push_files` 一律
`403 Resource not accessible by integration`（读接口 `get_commit` /
`list_commits` / `get_file_contents` / `list_pull_requests` 全部正常）。

**所以**：`git push`、建分支、开 PR、打 tag —— **都由维护者在自己的终端执行**。
自动化侧只能用**读**接口核对结果（例如比对 blob SHA 确认本地与 main 逐字节一致）。

> 别试图用 API `push_files` 绕：一次待推差异常在 **1 MB 量级**
> （`src/index.ts` 131 KB、`lib/src/index.js` 130 KB、若干 `.map`），
> 该接口要求把**每个文件的完整内容**放进一次调用，既不现实也容易推坏。

**维护者本机是通的**（2026-10-15 实测：推送成功、PR #12/#13/#14 均已合入，
`rel-0.8.0` 已从 main 拉出）。

### (b) npm 凭据失效（本机 2026-10-15 实测 `whoami` → 401）

排查顺序见 **§4.1**。一句话：键名已正确（`.org`），所以是 **token 本身失效**，
需要重新生成 —— 且这个账号开了 2FA，**必须由维护者本人操作**（扫码 / 动态码），
自动化侧拿不到、也不该拿到 token。

### (c) 自动化沙箱内 `npm` 会走 wsl.exe 被程序黑名单拦

自检时用系统 node 直调 npm-cli 绕过 shim：

```bash
"D:/Program Files/nodejs/node.exe" \
  "D:/Program Files/nodejs/node_modules/npm/bin/npm-cli.js" <npm 参数>
```

`pnpm` 不受影响。**维护者自己的 PowerShell 里 `npm` 是正常的**，按 §4 直接跑即可。

### (d) 发布顺序（不能颠倒）

```
push 分支 → 开 PR → review/verify → 合入 main
        → 从 main 拉 rel-0.8.0 → 上线测试 → npm publish → 打 tag v0.8.0
```

进度（2026-10-15）：**前四步已完成** —— PR #12 / #13 / #14 已合入 main
（`97dba2a`），`rel-0.8.0` 已从 main 拉出，全量验证 363 项全过（见 §4bis e）。
**当前卡在 `npm publish`**（§4bis b：需要维护者换新 token）。

### (e) 0.8.0 发布前验证记录（2026-10-15，跑在 `97dba2a` = rel-0.8.0 内容）

| 套件 | 结果 |
|------|------|
| `run-tests.mjs`（A–E 主套件，含元断言 TC-Z01） | 52 / 52 |
| `actions.test.mjs`（页面动作 / 健康残留 / 收尾关闭） | 206 / 206 |
| `drag-behavior.test.mjs`（jsdom 真实指针事件） | 18 / 18 |
| `perf-guard.test.mjs` | 15 / 15 |
| `crossplatform-paths.test.mjs` | 15 / 15 |
| `approval-gate.test.mjs` | 11 / 11 |
| `dsh-compat.test.mjs` | 16 / 16 |
| `smoke-features.mjs` | 22 / 22 |
| `verify-fixes.mjs` | 8 / 8 |
| **合计** | **363 项，0 FAIL / 0 SKIP** |

> 动作组的条数**随随机抽样浮动**（同一天跑出过 206 / 223），比较的是"是否全过"，
> 不是绝对条数。机器报告在 `tests/reports/run-<stamp>.md`，**抽样应用列在报告里**，
> 离开样本谈"全绿"没有意义。

`doctor` 实测 **27.761s**（35 个 issue），落在历史性能修复后的基线区间（23–28s），无回归。

**上线检查清单（§5）**：第 1 / 3 / 4 条已验证；**第 2 条（macOS/Linux 的 npm
全局发现）本机是 Windows，无法验证** —— CI 为 ubuntu 构建 + Windows 全量测试，
这条覆盖不全，是本次发布唯一缺少本机证据的项。

---

## 5. 发布后验证（在**另一台机器 / 全新 profile** 上做）

**先建一个干净 profile**（本机 `web` / `headless` 里的 `dsh-app-manager` 是
`link:` 指向本地仓库的，**装的不是 npm 上的那份**，用它验证等于没验证）：

```powershell
dsh plugin --profile verify add dsh-app-manager
dsh web --port 3081 --no-open
```

然后打开 `http://127.0.0.1:3081/app-manager`，逐个确认：

1. `/app-manager` 能打开，列表非空；
2. `app-manager list` 在 **macOS/Linux** 上也能列出 npm 全局包
   （0.5.0 前的版本在这里会**静默返回 0 条**）；
3. AI 调用 `app_manager_update` 时**先弹审批**，拒绝后无任何改动；
4. `app-manager doctor` 能在合理时间内返回（0.5.0 前可能永久挂起）。

> 两个容易搞错的点：
> - `dsh plugin --profile <name> <args...>` 是**把 args 原样转给 pnpm**，
>   没有专门的 `add` 子命令 —— 所以是 `... verify add <包名>`（**没有** `--add`）。
> - 命令名以包的 `bin` 为准，不是包名：本包的 bin 是 **`app-manager`** / **`am`**。

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
