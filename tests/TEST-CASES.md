# dsh-app-manager 测试用例规格

版本：v1（对应插件 0.4.1 · dsh 0.1.5-rc.1）
状态基线：用例先于脚本编写；执行结果见 `reports/`。

**通用前置**
- 插件已构建（`lib/` 存在），版本 0.4.1
- 托管 Node 22.22.2 可用
- 网络扩展用例（标注 ◆）依赖 npm registry 可达，失败按 SKIP(ENV) 记录，不计 FAIL

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
| TC-C01 | 路由注册面 | 遍历注册结果 | 恰好 4 条 `exact` 路由；路径集合 = 预期四路径 |
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
