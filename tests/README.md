# dsh-app-manager 测试区

本目录是 **dsh-app-manager 插件的专属测试区**，随插件仓库一同维护（`dsh-app-manager/tests/`）。

> **开发与测试分离**：开发只负责改代码 + 基本 debug/冒烟；本目录承载**独立、可复跑的自动化测试流程**。
> 日常开发**不跑**本套件（见下方「触发时机」）。

## 边界约定（与开发分离）

| 规则 | 说明 |
|------|------|
| 只读测试 | 测试过程**不修改**插件源码（`src/`、`lib/`、`package.json` 等一律只读） |
| 零副作用 | 涉及写操作的命令（`update` / `update-all`）**只测守卫路径**（不存在的应用名、不支持的来源），绝不触发真实安装/升级 |
| 独立归档 | 测试脚本、用例、报告全部落在本目录，按时间戳累积，不覆盖 |
| 报告先行 | 发现的问题**只记录、只给修改建议**，修复由开发流程另行排期 |

## 触发时机

| 场景 | 是否跑测试 |
|------|-----------|
| 新增功能 / 写代码 / 重构 | 否（仅基本 debug + 冒烟） |
| 修复 bug | 只跑**相关模块的回顾测试**（如 UI 改动跑 `smoke-features.mjs`） |
| 用户显式要求「跑测试 / 出测试报告」 | 跑**全量** `run-tests.mjs` |

## 目录结构

```
tests/
├── README.md            ← 本文件：测试流程说明
├── TEST-CASES.md        ← 测试用例规格（编号 / 前置 / 步骤 / 预期）
├── run-tests.mjs        ← 全量测试入口（51 用例自动化运行器）
├── smoke-features.mjs   ← 冒烟集（S6/S7/S9/Q6/Q7 等新特性快速回归，19 检查）
├── drag-behavior.test.mjs ← **拖拽交互行为测试**（jsdom 真实派发 PointerEvent，13 检查）
├── verify-fixes.mjs     ← 历史修复验证（D1/D2/source-chip 等，8 检查）
├── reports/             ← 测试报告归档（机器生成 run-*.md + 人工结论 TEST-REPORT-*.md）
├── probe-plugin-runtime.mjs   ← 早期探针（已被 run-tests.mjs 取代，留档）
├── probe-ui.mjs               ← 早期探针（已被 run-tests.mjs 取代，留档）
└── last-page.html             ← 探针时期的页面快照（留档，git 忽略）
```

所有脚本路径均由 `import.meta.url` 推导（`PLUGIN_DIR = tests/..`），**可从任意工作目录执行**。

## 测试流程（标准五步）

1. **编写用例** → 更新 `TEST-CASES.md`（用例先行，评审后再写脚本）
2. **编写脚本** → 在 `run-tests.mjs` 中实现用例（用例 ID 与脚本一一对应）
3. **执行测试** → 运行下方命令（全量跑，含网络扩展用例）
4. **输出报告** → 运行器自动在 `reports/` 落一份带证据的机器报告；测试负责人再产出含**修改建议**的 `TEST-REPORT-<日期>.md`
5. **归档** → 脚本与报告原地保留，不清理、不覆盖（按时间戳累积）

## 如何执行

在插件根目录 `dsh-app-manager/` 下：

```bash
npm test            # 全量（= node tests/run-tests.mjs）
npm run test:quick  # 快速回归（跳过网络扩展用例 TC-A18 / TC-B15）
npm run test:ui     # UI 相关组（= --group B,C,D）
npm run test:drag   # 拖拽交互行为测试（需 jsdom）
npm run smoke       # 冒烟集（= node tests/smoke-features.mjs）

# 只跑指定组（用于「修 bug 只跑相关模块」）
node tests/run-tests.mjs --group B,C,D     # UI 改动 → 必带 B,C（见下方依赖链）

# 也可直接指定托管版 Node（与插件运行环境一致）
"C:/Users/Blank/.workbuddy/binaries/node/versions/22.22.2-2/node.exe" tests/run-tests.mjs
```

**组间依赖链**：`B`（加载插件，产出伪上下文）→ `C`（调路由，产出 HTML + JSON 夹具）→ `D`/`E`/`A 组后半`。
因此用 `--group` 裁剪时，**必须把上游组一起带上**：测 UI 用 `--group B,C,D`，不要只写 `--group D`。

退出码：`0` = 无 FAIL；`1` = 存在 FAIL（SKIP 不影响）。

## 用例分组

| 组 | 范围 | 方式 |
|----|------|------|
| A | CLI 命令（`bin/cli-app-manager.js` 全命令面） | 子进程实测，校验退出码 + stdout/stderr |
| B | DSH 插件加载与工具契约（0.1.5 API 兼容） | 进程内加载 `lib/src/index.js`，伪 Cordis 上下文 |
| C | Web 路由与 JSON API | 进程内伪 HTTP 调用 |
| D | UI 需求断言（统一字体 / 统一列表 / 可折叠 / 可点击统计） | 基于真实生成的 HTML 做结构断言 |
| E | 数据一致性（计数守恒 / 枚举合法 / 无重复） | 基于 C 组 JSON 交叉验证 |

## 静态断言 ≠ 行为验证（重要教训）

`run-tests.mjs` / `smoke-features.mjs` 属于**静态标记断言**：它们从生成的 HTML 里
检查 `drag-grip` 这个 class 存不存在、脚本里有没有 `persistOrder` 这个函数名。

问题是：**交互功能光有标记不代表能用。** 2026-09-11 的实际翻车案例——Q6/Q7 首版用
原生 HTML5 拖放实现，在拖拽柄的 `pointerdown` 上调用 `e.preventDefault()`（本意是
阻止 `<summary>` 折叠），副作用是把浏览器的拖拽启动也一并取消了，`dragstart`
永不触发，**功能完全是死的**，但当时静态断言 19/19 全绿。

因此凡是**交互行为**（拖拽、拖放、列宽调整、筛选跳转等），必须用
`drag-behavior.test.mjs` 这类**行为测试**来验证：真实 DOM、真实事件、真实断言
最终状态与持久化结果。

- 依赖 `jsdom`（装在本机隔离工作区，非插件运行时依赖）；未安装时该测试**优雅跳过**（exit 0），不会误判为失败。
- 该测试具备**回归能力**：用旧实现跑会稳定 FAIL（已反向验证：旧代码 7 PASS / 6 FAIL，
  新代码 13/13 PASS），因此它能真正拦住「标记齐全但交互失效」的回归。

## 环境基线（首次归档时）

- 被测插件：dsh-app-manager 0.4.3（`dsh-app-manager/`）
- 宿主 dsh：0.1.5-rc.1（内置 @deepseek-ai/dsh-tools 0.1.5-rc.2）
- 运行时：Node 22.22.2（managed）
- 平台：Windows 10 (win32)
