# dsh-app-manager 测试用例规格

版本：v7（对应插件 0.8.0 · dsh 0.1.5-rc.1 / 0.2.0-rc.2）
状态基线：用例先于脚本编写；执行结果见 `reports/`。

> **v7 相对 v6 的变化**：**报告必须写明本轮测的是哪些 app**。
> 抽样随机化之后，「这份报告全绿」离开了样本就没有意义 —— 换一批样本可能就红，
> 而报告里没写样本等于无法复现。故 ① `run-tests.mjs` 生成的 `reports/run-*.md`
> 新增「本次测试用到的应用」表（用途 / 应用 / 来源 / 首命令 / 抽样方式）+ 禁用名单；
> ② `actions.test.mjs` 新增落盘报告 `reports/actions-*.md`，含独立抽样表与收尾结论；
> ③ 新增 `describeApp()` / `excludedPatterns()` 两个导出供两份报告共用。

> **v6 相对 v5 的变化**：新增「已卸载清除 + 残留检测与可逆修复」，
> 故 ① TC-C01 路由数 9 → **11**（新增 `/api/health`、`/api/leftover/fix`）；
> ② K 组新增 6e（健康：已卸载与残留）一节；
> ③ **被测应用改为每次运行随机抽样 4~6 个**（原来是 `apps.find()` 永远钉死第一个），
>    K 组断言数因此随抽样结果浮动。

> **v5 相对 v4 的变化**：页面新增「版本补齐 / 刷新 / 自动刷新 / PowerShell 默认」，
> 故 ① TC-C01 路由数 7 → **9**（新增 `/api/versions`、`/api/refresh`）；
> ② K 组新增 6b（版本补齐）、6c（刷新）、6d（shell 白名单）三节，共 +21 条断言；
> ③ win32 终端形态断言由 cmd 改为 **PowerShell 默认 + cmd 可选**。

> **v4 相对 v3 的变化**：新增 **L 组**（`dsh-compat.test.mjs`，16 条）守住宿主兼容性声明。
> 背景：插件能否在某个 dsh 上**加载**，取决于 `package.json` 的 peer 范围 ——
> dsh 0.2.0 的 app-boot 会做 `semver.satisfies(runtime, range, {includePrerelease:true})`
> 校验，不满足即抛错跳过该 bundle。0.5.3 的 `^0.1.5-rc.1` 因此**无法在 0.2.0-rc.2 上加载**。

**通用前置**
- 插件已构建（`lib/` 存在），版本 0.5.3
- 托管 Node 22.22.2 可用
- 网络扩展用例（标注 ◆）依赖 npm registry 可达

> **v3 相对 v2 的变化**：
> ① **跳过即失败**（见末节「元规则」）：新增 TC-Z01 元断言，`run-tests.mjs` 的退出码
> 把 SKIP 计入失败；拖拽组缺 jsdom 由 `exit(0)` 改为 `exit(3)`；动作组的条件分支
> 同样记为失败。
> ② H 组新增 3 条 **argv 引用**用例（H13–H15），锁住 `execAsync` 对含空格
> 命令路径与参数的引用行为 —— 该缺陷曾让 H11/H12 在标准 Windows 安装下**假失败**。
>
> **v2 相对 v1 的变化**：0.5.3 新增三条动作路由（`/api/open`、`/api/updates`、
> `/api/update`）与规范化退出机制，故
> ① TC-C01 的路由数由 4 改为 **7**；
> ② 新增 **K 组**（`actions.test.mjs`，44 条）覆盖三个动作路由的行为与卸载语义 ——
> 这些是「会改机器」的接口，光断言注册面不够。

**判定规则**
- PASS：全部断言命中
- FAIL：任一断言未命中（附实际值证据）
- SKIP(ENV)：环境不满足（网络/平台），附原因

---

## A 组 — CLI 命令（子进程实测）

| ID | 用例 | 步骤 | 预期 |
|----|------|------|------|
| TC-A01 | list 基本输出 | `list` | 退出码 0；含 `Managed:`、`Unmanaged`、`CLI applications in`、`By source:` |
| TC-A02 | list 来源过滤 npm | `list -s npm` | 退出码 0；`By source:` 段含 `npm:` 且不含 `path:` |
| TC-A03 | list 来源过滤 path | `list -s path` | 退出码 0；含 `path:` 且不含 `npm:` |
| TC-A04 | info 已装应用 | `info dsh` | 退出码 0；含 `Version:`、`Source:`、`Commands:` |
| TC-A05 | info 未装应用 | `info not-exist-xyz` | 退出码 0；含 `No application found matching` |
| TC-A06 | unmanaged 输出 | `unmanaged` | 退出码 0；含 `Add/Remove-Programs baseline`、`unmanaged program(s)` |
| TC-A07 | portable 别名等价 | `portable` | 与 TC-A06 同构（含 `unmanaged program(s)`） |
| TC-A08 | method 方法论报告 | `method` | 退出码 0；含 `Techniques used`、`managed`、`unmanaged` |
| TC-A09 | export 注册表 JSON | `export` | stdout 为合法 JSON；含 `totalApps/managedCount/unmanagedCount/apps`；`totalApps === apps.length` |
| TC-A10 | doctor 健康检查 | `doctor` | 退出码 0；含 `Running health check` 与（`All applications are healthy` 或 `issue(s)`） |
| TC-A11 | monitor 进程监视 | `monitor` | 退出码 0；含 `Monitoring running processes` |
| TC-A12 | search 搜索 | `search dsh` | 退出码 0；含（`Found` 且 `dsh`）或 `No apps found` |
| TC-A13 | help 帮助 | `help` | 退出码 0；含 `Commands:`、`unmanaged`、`method` |
| TC-A14 | update 守卫·不存在 | `update not-exist-xyz` | 退出码 0；含 `No application found matching`；**不含** `Updating`（证明无真实更新） |
| TC-A15 | update 守卫·不支持来源 | `update <path来源应用>` | 退出码 0；含 `Auto-update not supported`；**不含** `updated successfully` |
| TC-A16 | 未知命令回退 | `foobar` | 含 `Unknown command: foobar` 与 `Commands:`（帮助回退） |
| TC-A17 | info 缺参数 | `info` | 退出码 **1**；stderr 含 `App name required` |
| TC-A18 | ◆ check 更新检查 | `check` | 退出码 0；含 `up to date` 或 `update(s) available` 或 `unable to check` |

> TC-A14/A15 是**安全守卫用例**：只验证拒绝路径，绝不触发真实安装。
> TC-A15 的 `<path来源应用>` 从当次扫描结果中动态选取 source 为 `path` 的应用。

## B 组 — 插件加载与 DSH 工具契约（进程内）

| ID | 用例 | 步骤 | 预期 |
|----|------|------|------|
| TC-B01 | 模块导出契约 | import `lib/src/index.js` | `apply` 为函数；`name === "dsh-app-manager"`；`inject === ["tools","webServer"]` |
| TC-B02 | apply 注册工具数 | 伪上下文 apply | 注册工具数 === **7** |
| TC-B03 | 工具命名 | 遍历注册结果 | 名称唯一且全部 `app_manager_` 前缀 |
| TC-B04 | 0.1.5 契约·字段 | 遍历注册结果 | 每个工具 `output.schema` 存在、`output.render` 为函数（新版必填项） |
| TC-B05 | 0.1.5 契约·返回 | `render({}, "x")` | 返回数组且首元素 `{type:"text", text:"x"}`（ContentBlock[]） |
| TC-B06 | 工具·list | `app_manager_list.execute({})` | 字符串含 `apps (` 计数行与表头 `\| Name \|` |
| TC-B07 | 工具·list 过滤 | `execute({source:"npm"})` | 计数 ≤ 全量；内容含 `npm` |
| TC-B08 | 工具·info | `execute({name:"dsh"})` | 含 `Version:` 与 `dsh` |
| TC-B09 | 工具·info 未命中 | `execute({name:"not-exist-xyz"})` | 含 `No application found` |
| TC-B10 | 工具·doctor | `execute({})` | 含 `healthy` 或 `Issues` |
| TC-B11 | 工具·unmanaged | `execute({})` | 含 `unmanaged` |
| TC-B12 | 工具·scan_method | `execute({})` | 含 `Scan methodology` 与 `\| Source \|` |
| TC-B13 | 工具·update 守卫·不存在 | `execute({name:"not-exist-xyz"})` | 含 `No application found`（无副作用） |
| TC-B14 | 工具·update 守卫·来源 | `execute({name:<path应用>})` | 含 `Cannot auto-update`（无副作用） |
| TC-B15 | ◆ 工具·check_updates | `execute({})` | 返回字符串（`up to date` 或更新表或空表提示） |
| TC-B16 | dispose 生命周期 | 调用 apply 返回值 | 函数且调用不抛错 |

## C 组 — Web 路由与 JSON API（进程内伪 HTTP）

| ID | 用例 | 步骤 | 预期 |
|----|------|------|------|
| TC-C01 | 路由注册面 | 遍历注册结果 | 恰好 **11** 条 `exact` 路由；路径集合 = 4 只读 + 3 动作 + 2 刷新 + 2 健康（`/app-manager`、`/api/apps`、`/api/unmanaged`、`/api/method`、`/api/open`、`/api/updates`、`/api/update`、`/api/versions`、`/api/refresh`、`/api/health`、`/api/leftover/fix`） |
| TC-C02 | 页面响应 | GET `/app-manager` | 200；`content-type: text/html`；body 含 `<style>`、`<script>`、`<title>` |
| TC-C03 | apps API | GET `/app-manager/api/apps` | 200；合法 JSON；`total>0`；`total===apps.length`；`managedCount+unmanagedCount===total`；每项含 `name/version/commands/source/managed/installKind/inPath` |
| TC-C04 | unmanaged API | GET `/app-manager/api/unmanaged` | 200；合法 JSON；每项 `installKind !== "managed"` |
| TC-C05 | method API | GET `/app-manager/api/method` | 200；合法 JSON；含 `platform/durationMs/totalApps/managedCount/unmanagedCount/sources[]` |

## D 组 — UI 需求断言（基于 TC-C02 的真实 HTML）

| ID | 用例 | 断言 |
|----|------|------|
| TC-D01 | REQ1 统一字体字号 | CSS 定义 `--font-ui/--font-mono/--fs-*`；**所有** `font-family` 均为 `var(--font-*)`；**所有** `font-size` 均为 `var(--fs-*)`（不允许硬编码字号） |
| TC-D02 | REQ2 统一列表格式 | 每个 `<table>` 均含 `<colgroup>`；**分类区块内的应用列表表** colgroup 内容完全一致（统一列宽）。*注：方法论参考表列结构语义不同，豁免一致性约束，但仍须带 colgroup* |
| TC-D03 | REQ3 分类可折叠 | `<details class="category">` 数 === 分类数（≥1）；每个 details 均有 `<summary class="cat-head">` 且内含 `<table>` |
| TC-D04 | REQ4 统计可点击 | `data-jump` 集合 = `{all,managed,unmanaged,inpath}`；脚本定义 `jumpTo`；存在 `data-filter-source` 芯片 |
| TC-D05 | 统计数字一致性 | 页面四个统计值 === apps API 的 total/managedCount/unmanagedCount/inPath 计数 |

## E 组 — 数据一致性（基于 C 组 JSON 交叉验证）

| ID | 用例 | 断言 |
|----|------|------|
| TC-E01 | 计数守恒 | `managedCount + unmanagedCount === total` |
| TC-E02 | installKind 枚举 | 每项 ∈ `{managed, portable, path-shim, unknown}` |
| TC-E03 | managed 语义自洽 | `managed===true ⟺ installKind==="managed"` |
| TC-E04 | unmanaged 口径一致 | unmanaged API `total` === apps 中 `managed===false` 的数量 |
| TC-E05 | 无重复键 | `(name, source)` 二元组无重复 |
| TC-E06 | commands 非空 | 每项 `commands` 为非空数组 |
| TC-E07 | 跨端点总数一致 | method API `totalApps` === apps API `total`（容差 ±2，超出记 FAIL 排查环境波动） |

---

**合计**：A 组 18 · B 组 16 · C 组 5 · D 组 5 · E 组 7 = **51 条**
（其中 ◆ 网络扩展 2 条，`--quick` 模式跳过）

**独立行为/性能组**（不在 `run-tests.mjs` 计数内，各自单独运行）：
- G 组 13 条 · 拖拽交互行为（`node tests/drag-behavior.test.mjs`）
- H 组 15 条 · 性能守卫（`node tests/perf-guard.test.mjs`）
- I 组 15 条 · 跨平台全局路径（`node tests/crossplatform-paths.test.mjs`）
- J 组 11 条 · 审批门槛（`node tests/approval-gate.test.mjs`）
- K 组 · 页面动作与退出机制（`node tests/actions.test.mjs`）—— 断言数随随机抽样（4~6 个 app）浮动
- L 组 16 条 · 宿主兼容性声明（`node tests/dsh-compat.test.mjs`）

---

## G 组 — 拖拽交互行为（`drag-behavior.test.mjs`，jsdom 真实事件）

> 与 D 组的关键区别：D 组是**静态断言**（HTML 里有没有某个 class），
> G 组是**行为验证**（真实派发 PointerEvent，断言 DOM 结果与持久化）。
> 交互功能的唯一可信证据在 G 组——D 组全绿时 Q6/Q7 依然可能是坏的。

| ID | 用例 | 断言 |
|----|------|------|
| TC-G01 | 分类区块数量 | 页面渲染出 ≥2 个 `details.category` |
| TC-G02 | 分类手柄覆盖 | 每个分类头均有 `.drag-grip` |
| TC-G03 | AI 默认置顶 | 首个分类为 `ai` |
| TC-G04 | 手柄不触发折叠 | 在手柄上 pointerdown+pointerup 后 `details.open` 不变 |
| TC-G05 | 分类拖拽换序 | 拖 A 到 B 下半区释放 → DOM 中 A 排在 B 之后 |
| TC-G06 | 顺序持久化 | `localStorage:catorder` 已写入，且与当前 DOM 顺序一致 |
| TC-G07 | 恢复路径存在 | 页面脚本含 `applySavedOrder` 且引用 `ORDER_KEY` |
| TC-G08 | 行进不再用原生 draggable | `tr[draggable="true"]` 数为 0 |
| TC-G09 | 行手柄覆盖 | 每个数据行名字单元格含 `.row-grip` |
| TC-G10 | 跨分类移行 | 拖动行到另一分类释放 → `row.parentElement === 目标 tbody` |
| TC-G11 | 移行持久化 | `localStorage:moves` 记录的分类与 DOM 实际归属一致 |
| TC-G12 | 计数徽章刷新 | 每个分类 `.cat-count` === 该分类实际 `tbody tr` 数 |
| TC-G13 | 点击阈值生效 | 无位移的 pointerdown+pointerup 不移动任何行 |

**回归能力**：旧实现（原生 DnD + pointerdown preventDefault）对本组得
7 PASS / 6 FAIL，新实现 13/13 PASS —— 该组能真正拦住「标记齐全但拖不动」。

---

## H 组 — 性能守卫（`perf-guard.test.mjs`）

> 性能退化**不会**让任何功能断言失败——页面照样渲染正确，只是慢。
> 所以耗时必须有独立的守卫，且守卫本身要能挡住「改回慢实现」。
>
> 背景：`/app-manager` 曾出现热渲染 **9.6 秒**。根因不是 `discoverAll`（缓存后
> 0ms），而是每个 `discoverXxx()` 里的包管理器子进程**每次请求都重跑**
> （`pnpm list -g` 2.2s、`pip list` 3.4s、`uv tool list` 0.8s…），因为
> `buildScanReport()` / `doctor` 直接调用各 discoverer，绕过了 `allCache`。

| ID | 用例 | 预算 | 断言 |
|----|------|------|------|
| TC-H01 | `pathIndexHas` 批量检查 66+ 命令 | < 500ms | 走缓存 PATH 索引，不 spawn `where` |
| TC-H02 | `pathIndexHas` 与 `commandExists` 结论一致（抽样 12） | — | 缓存索引**不遗漏**权威检查能找到的命令 |
| TC-H03 | `discoverAll` 冷扫描 | < 20s | 总量级回归（正常 ~4.5s，旧版 35s+） |
| TC-H04 | `discoverAll` 二次调用 | < 50ms | `allCache` 生效 |
| TC-H05 | 生成 `/app-manager` 页面（缓存已热） | < 300ms | 渲染路径不得有未缓存的子进程；必须先 `discoverAll()` 模拟真实服务的预热态 |
| TC-H06 | 二次调用各 `discoverXxx()` | < 50ms | 10 个源全部命中 per-source memo |
| TC-H07 | `buildScanReport` 二次调用 | < 300ms | 直接调用路径同样受益于 memo |
| TC-H08 | commands 不含启动器扩展名 | — | 无 `.exe/.cmd/.js` 等后缀 |
| TC-H09 | commands 不含内部入口点 | — | 无 `node-gyp-bin`/`npm-cli`/`npm-prefix`/`npx-cli` |
| TC-H10 | 发现的命令绝大多数在 PATH 可解析 | 缺失率 < 20% | 命令提取未退化 |
| TC-H11 | `execAsync` 遵守 timeout | ≥ timeout 且 < 8s | 挂起子进程必须被超时切断；**断言耗时 ≥ timeout**，防止子进程因参数被空格拆散而秒退、伪装成超时成功 |
| TC-H12 | `execAsync` 正常命令仍返回 stdout | — | 加超时后未破坏正常路径 |
| TC-H13 | `execAsync` 引用**含空格的命令路径** | — | 路径原样传入即能跑通（不得要求调用方自己加引号）；宿主路径无空格时说明由 TC-H15 覆盖逻辑 |
| TC-H14 | `execAsync` 引用**含空格的参数** | — | 含空格的 argv 原样到达子进程（任何机器上都可验证） |
| TC-H15 | 引用函数规则（纯函数） | — | 含空格→加引号（win32 双引号 / POSIX 单引号）；无空格→不动；已加引号→不二次包裹 |

**回归能力（已实测）**：把 `SCAN_TTL_MS` 置 0 后本组得 3 PASS / 4 FAIL，
页面渲染断言实测 **7547ms**（预算 300ms）。回退命令名归一化会让 TC-H09 失败。
TC-H11 的断言曾抓到自己的假阳性（`-e` 脚本被 cmd.exe 按空格拆散 → 秒退 → 误判通过）。

**为何 TC-H05 要先调 `discoverAll()`**：首次渲染确实要付冷扫描成本，那是
TC-H03 的职责。真实 dsh 服务在插件 `apply()` 时有后台预热（`setTimeout(...,0)`
调用 `discoverAll()` + `buildScanReport()`），所以用户看到的第一次请求
本就应该命中缓存。TC-H05 测的是这个稳态，TC-H03 测的是最坏情况。

---

## I 组 — 跨平台全局路径推导（`crossplatform-paths.test.mjs`，15 条）

> 缺陷背景：`discoverNpmGlobal()` 硬编码 `appDataDir()/npm/node_modules`，
> 而 `appDataDir()` 在非 Windows 上回退到 `$HOME/AppData/Roaming`（不存在）
> → **macOS/Linux 上 npm 全局发现静默返回 0 条**，而 `dsh`/`claude`/`codex`
> 正是从那里发现的。失败方式是最糟的一类：不报错、不崩溃，只是安静地少显示。
>
> 测试手法：把 `platform` / `execPath` 作为**参数注入**，于是可以在任意机器上
> 断言 nvm / Homebrew / 系统 node 的推导结果 —— 静态断言永远抓不到这类 bug。

| ID | 用例 | 断言 |
|----|------|------|
| TC-I01 | Windows | 首候选为 `%APPDATA%\npm\node_modules`；不混入 POSIX 路径 |
| TC-I02 | Linux 系统 node | `/usr/bin/node` → `/usr/lib/node_modules` 优先 |
| TC-I03 | Linux 用户级 node | `/usr/local/bin/node` → `/usr/local/lib/node_modules` 优先 |
| TC-I04 | nvm | 推导出 `~/.nvm/versions/node/vX/lib/node_modules` |
| TC-I05 | Homebrew (arm64) | 推导出 `/opt/homebrew/lib/node_modules`，**且不含 `Cellar`** |
| TC-I06 | macOS 系统 node | `/usr/local/lib/node_modules` 优先 |
| TC-I07 | 用户级回退 | 候选表含 `~/.npm-global`、`~/.local` |
| TC-I08 | **缺陷本身** | 任何 POSIX 候选列表都**不含 `AppData`** |
| TC-I09 | Windows npx | `%LOCALAPPDATA%\npm-cache\_npx` |
| TC-I10 | macOS/Linux npx | 含 `~/.npm/_npx` |
| TC-I11 | npx 覆盖 | 尊重 `npm_config_cache` |
| TC-I12 | pnpm Linux | 含 `~/.local/share/pnpm/global`；`XDG_DATA_HOME` 优先 |
| TC-I13 | pnpm macOS | 含 `~/Library/pnpm/global` |
| TC-I14 | 真实自检 | 当前平台候选表非空且无空串 |
| TC-I15 | 真实自检 | `npmGlobalRoot()` 解析到的目录形如 `node_modules` |

---

## J 组 — 变更类工具的审批门槛（`approval-gate.test.mjs`，11 条）

> `app_manager_update` 会执行 `npm install -g <pkg>@latest`，是**不可逆**改动。
> 对外发布后，第三方插件无声改动用户全局环境不可接受。
> J 组**真实调用**工具的 `execute`，不是检查「代码里有没有 requireApproval」——
> 那正是 Q6/Q7 栽过的坑。

| ID | 用例 | 断言 |
|----|------|------|
| TC-J01 | 只读工具不受影响 | 无审批服务时 7 个工具**仍全部注册** |
| TC-J02 | 工具数不变 | 有审批服务时仍 7 个 |
| TC-J03 | fail closed | 无审批服务 → 拒绝，且 **0 次 spawn** |
| TC-J04 | 可操作的拒绝信息 | 含 `app-manager update` 与 `APP_MANAGER_ALLOW_UNATTENDED_UPDATE=1` |
| TC-J05 | rejected | 不执行、0 spawn |
| TC-J06 | cancelled | 不执行、0 spawn |
| TC-J07 | unavailable | 不执行、0 spawn |
| TC-J08 | 未知词表值 | 不执行、0 spawn |
| TC-J09 | 审批器抛错 | 拒绝（**不是放行**）、0 spawn |
| TC-J10 | allowed-once | 放行；spawn 参数含 `-g`；请求带齐 `toolName`/`callId`/`agent`/`reason` |
| TC-J11 | 逃生口 | 子进程实测 `APP_MANAGER_ALLOW_UNATTENDED_UPDATE=1` 无需审批直接放行 |

### ⚠️ 维护者必读：为什么 spawn 桩必须在 import 插件**之前**打

`node:child_process` 的 **ESM 命名空间在首次 import 时固定绑定值**。若先
`import` 插件（其 `utils.js` 静态 import 了 `child_process`），再 patch `spawn`，
插件里 `await import("node:child_process")` 拿到的仍是**真实 spawn** ——
桩失效，TC-J10 会**真的执行 `npm install -g`**。

本文件因此：
1. 不静态 `import` `node:child_process`（否则提前固定绑定）；
2. 用 `createRequire` 拿 CJS 对象，**在任何 ESM import 之前**打桩；
3. 打桩后立刻用动态 import 验证桩可见，**不可见就 `exit(3)` 中止套件**。

（此坑已在开发中真实触发过一次：真实执行了 `npm install -g 9router@latest`。
经全盘扫描确认 npm 前缀下 90 分钟内 0 个条目被改动 —— 该包本就已是最新版，
未产生实际变更。教训已写入本节。）

---

## K 组 — 页面动作与退出机制（`actions.test.mjs`，断言数随抽样浮动）

> 0.5.3 让页面不再只读：点击名字开终端、查更新、单个升级。这三个动作
> **会改动真实机器**（弹终端窗口、执行全局安装），所以本组**真实调用插件注册的
> handler**，并断言行为而不是"代码里有没有某个函数"。
>
> ⚠️ **安全设计（别改坏）**：三个动作全部经 `_setActionHooks` 接缝换成桩，
> 且启动后**先验证桩确实生效**（返回值里的哨兵字符串
> `STUB-TERMINAL-DO-NOT-SPAWN`），不生效立即 `exit(2)` 中止整个套件 ——
> 否则测试会真的弹窗、真的 `npm install -g`。

| ID | 用例 | 断言 |
|----|------|------|
| TC-K01 | 路由齐全 | 7 条路由全部注册（含 3 条动作路由） |
| TC-K02 | **桩有效性哨兵** | 终端桩返回哨兵值，否则中止套件（防止测试真开窗口/真装包） |
| TC-K03 | 开终端·GET 拒绝 | `GET /api/open` → 405（链接、浏览器预取都是 GET） |
| TC-K04 | 开终端·未知应用 | → 404 |
| TC-K05 | 开终端·缺参数 | → 404 |
| TC-K06 | 开终端·已知应用 | → 200，且**确实调用了桩** |
| TC-K07 | 命令来自 discovery | 跑的是该应用的第一个命令（实测取到 `9router`），不是请求里塞的 |
| TC-K08 | cwd 非空 | 应用目录或主目录 |
| TC-K09–K11 | win32 终端形态（**默认 PowerShell**） | 解释器 `cmd.exe`（借 `start` 开新窗口）；参数含**空标题**（否则命令会被当成窗口标题）；第三个参数为 `pwsh.exe` 或 `powershell.exe`；含 `-NoExit`（保持窗口）与 `-Command`；命令在末位 |
| TC-K11b–K11d | win32 · cmd 模式 | 显式 `shell=cmd` 时回落到旧形态：`cmd.exe` + `/k` |
| TC-K12–K14 | darwin 终端形态 | 走 `open`；含 `Terminal`；命令带 cwd |
| TC-K15–K16 | linux 终端形态 | 走 `x-terminal-emulator`；命令带 cwd |
| TC-K17–K19 | 更新检查 | 200；返回体含 `updates`；首次采集调用桩一次 |
| TC-K20 | 缓存 | 二次请求命中缓存（不再采集） |
| TC-K21 | 强制重查 | `?refresh=1` 触发再采集 |
| TC-K22 | 升级·GET 拒绝 | `GET /api/update` → 405（链接/预取不能装包） |
| TC-K23 | 升级·未知应用 | → 404 |
| TC-K24–K26 | **并发保护** | 同一应用两个并发请求：一个 200、另一个 **409**，且实际只执行一次 |
| TC-K27 | 锁释放 | 串行再请求又能成功（锁在 `finally` 释放） |
| TC-K28 | 缓存重置幂等 | `_resetScanCache()` 连调两次不抛错（dispose 可能调用两次） |
| TC-K29 | 卸载·路由清空 | dispose 后宿主路由表为 0 |
| TC-K30–K35 | **卸载·fail closed** | 扣住卸载前的旧 handler 直调：三条动作路由全部 404 且带 `no-store` |
| TC-K36 | 重复卸载 | 不抛错（幂等） |
| TC-K37–K41 | **版本补齐** | 200；返回体含 `resolved`/`unresolved`；确实探测过且 resolved 非空；二次请求命中缓存（不再探测）；`?refresh=1` 重新探测且带 `refresh` 标记 |
| TC-K42–K48 | **刷新接口** | `GET` → 405（刷新必须 POST）；`POST` → 200 且返回 `apps` + `refreshedAt`；**确实重置了扫描缓存**（否则读到旧数据）；未指定 `versions` 时**不**做版本探测（自动刷新要便宜）；`versions=1` 时探测结果并入 app 清单 |
| TC-K49–K51 | **shell 白名单** | `shell=cmd` 透传到终端；未指定时默认 `powershell`；`shell=evil;rm -rf` 这类非法值**回退默认**（白名单，不可能是任意 shell） |
| TC-K52–K56 | **健康扫描** | `GET /api/health` → 200 且返回 `generatedAt` + `uninstalled` + `leftovers`；已卸载项**不出现在** `/api/apps` 里；`hiddenUninstalled` 计数已返回；`?refresh=1` 触发重新探测；二次请求命中缓存 |
| TC-K57–K58 | **残留判定** | 命令跑不起来**且** PATH 上有 shim → 报为残留并带上文件清单；跑不起来但**无 shim**（是没有 bin 的库 / bin 名与包名不同，如 `ripgrep` 的可执行文件叫 `rg`）→ **不算**残留 |
| TC-K59–K65 | **可逆修复** | `GET` → 405（移动文件必须 POST）；未知应用 404；`POST` → 200 且 `ok=true`，移动方式是**改名**（`.MOVED-STUB`）而非删除；磁盘未被真动（改名走桩）；修复后重置扫描缓存；复检发现已修好 → **409 `not_broken`**（拒绝动手）；无 shim 可移 → **409 `no_files`** |
| TC-K66–K68 | **收尾·关闭打开的应用** | 启动动作全部走桩（无需要登记关闭的进程）；测试期间打开的应用**全部关闭成功**；收尾后**无遗留**应用进程（进程快照差集，只比对本次抽样接触过的命令，避免把用户自己开的程序算进去） |

### 随机抽样：被测应用不再是固定的那几个

`tests/sample-apps.mjs` 提供 `sampleApps(pool, {min:4, max:6})` 与 `pickOne(pool)`。

- **K 组**：从「带命令的应用」里随机抽 4~6 个跑终端 / shell 白名单 / 残留修复断言；
  从「npm 来源应用」里随机抽 4~6 个跑升级并发保护。
- **主套件**：`info` / `search` 的目标应用（`TC-B08`、`TC-A04`、`TC-A12`）每次随机抽 1 个。
- 抽到的名字会打印出来（`· 随机抽样 …`），便于复现失败的那一次。
- **为什么**：`apps.find()` 永远返回同一个应用，而那个应用往往恰好是名字干净、命令规范、
  路径正常的那个 —— 名字带空格、命令名与包名不同、路径特殊的应用可能一次都没被测过。
- **副作用**：断言总数随抽样规模（4~6）浮动，不再是固定值。
- **黑名单**：Fiddler 全家永不被抽中（`tests/sample-apps.mjs` 的 `EXCLUDED`，按
  名称 / 安装路径 / 命令匹配）。实测排除项：`ExecAction`、`Fiddler`、`EnableLoopback`、
  `TrustCert`、`ForceCPU`、`SFXWiz32`、`SFXWiz32-gcc`、`uninst`。
  原因：跑 `ExecAction` 会**启动 Fiddler**，而 Fiddler 启动即把 Windows 系统代理开关
  打到 `127.0.0.1:8888` —— 一个会偷偷改机器网络的"测试"不是测试。

### 收尾：关闭测试打开的应用（`tests/close-apps.mjs`）

- `snapshot()` 取进程快照（`tasklist /FO CSV`），`discoverLeaks(before, after, commands)`
  做差集，只认**本次抽样接触过的命令**对应的进程。
- `closeAll()` 先关登记的 PID（`registerOpened`），再关差集发现的遗留。
- ⚠️ **必须用异步 `spawn`，不能用 `spawnSync`**：本机 `spawnSync` 对**任何**目标都返回
  EBUSY，用了它快照就是空的、差集永远为 0，整个检查会退化成**永远通过的空检查**。
  因此 `available()` 显式校验 `tasklist` 可用，不可用则按"跳过即失败"处理。
- 关闭路径本身**实测过**：起一个无害的 `PING.EXE` → `killPid` → 进程表中确认消失。
  否则"关闭"只是一段从没被执行过的代码 —— 空集合通过和坏掉的关闭长得一模一样。

**为什么必须扣住旧 handler 直调**：卸载后路由已从宿主表摘除，若只对宿主路由表
断言"404"，测的是宿主而非插件 —— 那正是"看起来通过、实际没测到"的坑。

---

## 元规则：跳过即失败（v3 起）

**未验证 ≠ 通过。** 任何被跳过的用例都必须让套件以非 0 退出 —— 一份含未验证项的
报告不能用来放行。

| 位置 | 行为 |
|---|---|
| `run-tests.mjs` TC-Z01 | 元断言：SKIP 数必须为 0，否则该条失败 |
| `run-tests.mjs` 退出码 | `fail + err + skipped > 0` → 退出码 1（原先只看 `fail + err`） |
| `drag-behavior.test.mjs` | 缺 jsdom 时 `exit(3)`（原先 `exit(0)`，即"静默全绿"） |
| `actions.test.mjs` | 环境不满足而无法验证的分支记为 FAIL（`skipAsFailure`） |

**为什么定这条规矩**：本仓库真被坑过一次 —— 0.5.1 之前拖拽组硬编码了某台机器的
jsdom 路径，缺依赖时打印一行 SKIP 后以 0 退出，CI 全绿而**拖拽覆盖为零**
（见 CHANGELOG 0.5.1）。本轮全量测试又原样复现了一次：本机 `node_modules/jsdom`
是空目录，拖拽组静默跳过。

代价：**离线时 ◆ 网络用例会让套件失败**。这是刻意的 —— 离线跑出来的报告本就不该
被当作通过，请在有网络的环境重跑。

---

## H13–H15 的由来：一个「假失败」暴露出的真实缺陷

TC-H11/H12 用 `process.execPath` 起子进程验证超时，而它**只在 Node 路径不含空格时
才通过**：Node 装在 `C:\Program Files\nodejs\`（Windows 标准位置）时本组得 10/12，
装在无空格路径时得 12/12。

根因既不是沙箱也不是超时逻辑，而是 `execAsync` 把 command / argv **原样交给 shell**，
而 Node 不为 cmd.exe 转义 —— 含空格的路径被空格拆开，子进程以
`'D:\Program' 不是内部或外部命令` **秒退**，于是「挂起子进程被超时切断」这条根本没被
验证，表现为假失败。

修复（生产侧 `src/utils.ts`）：

- `quoteForShell()` —— 只处理含空格的 token；无空格不动，已加引号的不二次包裹；
- `shellCommand()` —— **仅在字符串确实指向一个已存在的文件时**才加引号。
  这个判据是必需的：`monitorProcesses` 会把整条命令*行*
  （`pwsh -Command "… | …"`）当 `command` 传进来，给它加引号会去找一个
  名叫 `pwsh -Command "…"` 的文件；
- 测试侧 TC-H13 直接传**原始含空格路径**（不再由测试自己加引号）——
  一旦有人把引用逻辑改回去，本组立刻失败。

---

## L 组 — 宿主兼容性声明（`dsh-compat.test.mjs`，16 条）

> 插件**能否在某个 dsh 上加载**，不取决于代码，而取决于 `package.json` 的 peer 范围。
> dsh 0.2.0 的 `dsh-app-boot` 在加载 bundle 前执行
> `semver.satisfies(runtimeVersion, range, { includePrerelease: true })`，
> **不满足即抛错并跳过该 bundle**（报错建议用 `dsh plugin allow-version` 做精确版本豁免）。
>
> 0.5.3 就是这样被挡住的：`^0.1.5-rc.1` 不匹配 `0.2.0-rc.2`（实测，用 dsh 依赖树里的
> `semver`）。代码全对、声明写窄了，插件照样装不上。

| ID | 用例 | 断言 |
|----|------|------|
| TC-L01–L05 | peer 覆盖每条声称支持的线 | 每条线各有一条子句；子句数 === 声称的线数；多线必须 `\|\|` 并列 |
| TC-L06–L07 | 范围书写整洁 | 无前后空白、无空子句 |
| TC-L08–L12 | bundle 声明可用 | 声明了 `dsh.bundle.patch`；文件真实存在；含 `insert` 段；插入的是本包 |
| TC-L13–L16 | 包身份 | version 是合法 semver；包名正确；运行时依赖保持为空 |

**回归能力（已实测）**：把 peer 改回单线 `^0.1.5-rc.1` → 本组 3 项失败、退出码 1。

⚠️ **本组的边界（不要误读）**：它**不重实现 semver**，只防「声明与自称支持范围不一致」。
范围与运行时版本之间的**语义判定**由宿主在加载时执行 —— 手写一个评估器，
风险是把错的规则固化成"守卫"，比没有守卫更糟。
实测参考（`includePrerelease: true`）：

```
satisfies("0.2.0-rc.2",  "^0.1.5-rc.1")                  = false   ← 0.5.3 被拒的原因
satisfies("0.2.0-rc.2",  "^0.2.0-rc.2")                  = true
satisfies("0.1.5-rc.3",  "^0.1.5-rc.1 || ^0.2.0-rc.2")    = true
satisfies("0.2.0-rc.2",  "^0.1.5-rc.1 || ^0.2.0-rc.2")    = true
satisfies("0.3.0",       "^0.1.5-rc.1 || ^0.2.0-rc.2")    = false
satisfies("0.1.7-rc.2",  "^0.1.5-rc.1")                  = true    ← 注意：与 0.2.0-rc.2 不同
```

最后一行正是「不能手写评估器」的证据：同为预发布版本，`0.1.7-rc.2` 落在
`^0.1.5-rc.1` 的范围内，而 `0.2.0-rc.2` 不落 —— 规则比"同 tuple 才允许预发布"更微妙。

