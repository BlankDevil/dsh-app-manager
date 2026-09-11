# dsh-app-manager 测试报告

- **日期**：2026-09-11
- **被测版本**：dsh-app-manager v0.4.1（`E:\Workspace\dsh-playground\dsh-app-manager`）
- **宿主环境**：dsh 0.1.5-rc.1（内置 @deepseek-ai/dsh-tools 0.1.5-rc.2）· Node v22.22.2 · win32 x64
- **测试性质**：**只读测试** —— 全程未修改插件任何源码；`update` 类命令仅验证拒绝路径（守卫用例），未触发任何真实安装/升级
- **机器报告**：`reports/run-2026-09-11_161153.md`（运行器自动生成，含 51 条明细与证据）
- **用例规格**：`TEST-CASES.md` · **运行器**：`run-tests.mjs`（复跑命令见文末）

---

## 一、结论

| 指标 | 数值 |
|---|---|
| 用例总数 | 51（A组18 · B组16 · C组5 · D组5 · E组7） |
| 通过 | **49 PASS** |
| 失败 | **2 FAIL**（均为 UI 需求未完全落地，见缺陷 D1/D2） |
| 错误 / 跳过 | 0 ERROR · 0 SKIP |
| 总耗时 | 867s（全量模式，含网络用例） |

**总体判断**：功能与数据层全部合格 —— CLI 全命令面、7 个 DSH 工具（含 0.1.5 新契约）、4 条 Web 路由、7 项数据一致性全部通过；**两条失败集中在「UI 需求实现不彻底」**，属于上轮 UI 改造的遗留收尾问题，不影响功能正确性。

## 二、分组结果

| 组 | 范围 | 结果 | 要点 |
|---|---|---|---|
| A（18） | CLI 命令 | 18/18 ✅ | 含别名（portable/how 等）、未知命令回退、缺参报错（退出码1）、update 双守卫 |
| B（16） | 插件与工具契约 | 16/16 ✅ | 7 工具全部满足 0.1.5 必填契约：`output.schema` + `output.render` 返回 `ContentBlock[]` |
| C（5） | Web 路由与 API | 5/5 ✅ | 4 条 exact 路由、JSON 结构与计数守恒全部正确 |
| D（5） | UI 需求断言 | 3/5 ❌ | REQ3 可折叠 ✅ · REQ4 可点击统计 ✅ · REQ1 统一字体 ❌ · REQ2 统一列表 ❌ |
| E（7） | 数据一致性 | 7/7 ✅ | 计数守恒、枚举合法、managed 语义自洽、跨端点口径一致、无重复键 |

**安全验证**：TC-A14/A15、TC-B13/B14 四条守卫用例确认 `update` 对「不存在的应用」与「不支持的来源」均正确拒绝，输出中无任何 `Updating` / `updated successfully` 字样 —— **零副作用达成**。

## 三、缺陷清单（本轮发现，未修复）

### D1 · REQ1 统一字体字号未全覆盖（TC-D01 FAIL）

- **证据**：页面 CSS 中存在硬编码字号
  - `src/index.ts:490` → `.stat-value { font-size: 1.35rem; font-weight: 650; line-height: 1.1; }`
  - 其余 18 处 `font-size` 与 2 处 `font-family` 均已走 `var(--fs-*)` / `var(--font-*)`，仅此 1 处例外
- **影响**：顶部统计卡片数字字号脱离统一字号体系；若日后调整 `--fs-*` 标尺，该值不会跟随
- **建议修复**（见建议 S1）

### D2 · REQ2 统一列表格式未落地（TC-D02 FAIL）

- **证据**：页面共 **6 个 `<table>`，仅 1 个带 `<colgroup>`**
  - 方法论表（`src/index.ts:733-736`）有 colgroup，但用**内联宽度** `14%/58%/14%/14%`
  - **5 个分类表**（`src/index.ts:372` 模板）**完全没有 colgroup**，列宽不受控
  - CSS 中 `src/index.ts:633-639` 的 7 条 `col.c-name { width:22% } …` 规则是**死代码**——HTML 中不存在任何 `<col class="c-*">` 元素引用它们
- **影响**：各分类表列宽由浏览器自动分配，长命令/长路径会挤压其他列，且与「统一列宽」的设计意图相悖；响应式规则 `col.c-path { width:0 }`（`:687`）同样失效
- **建议修复**（见建议 S2）

## 四、修改建议（按优先级，供开发流程排期）

| # | 优先级 | 建议 | 对应问题 |
|---|---|---|---|
| S1 | **P0** | 在 `:root` 增加统计字号变量 `--fs-stat: 1.35rem;`，并将 `src/index.ts:490` 改为 `font-size: var(--fs-stat);` | D1 |
| S2 | **P0** | 在分类表模板（`src/index.ts:372` 的 `<table>` 后）插入 `<colgroup><col class="c-name"><col class="c-version">…<col class="c-status"></colgroup>`，激活 `:633-639` 现有 CSS；方法论表的 4 列内联宽度也建议改为 class 化（如 `col.m-*`），实现全页面列宽机制统一 | D2 |
| S3 | **P1** | **扫描结果缓存**：本轮实测每次工具调用/CLI 命令/API 请求都重新全量扫描（单次 10~30s；页面渲染 80s）。建议在 discovery 层加 TTL 缓存（如 60s 内复用），PATH 索引已有缓存，ARP/包管理器查询同样可缓存 | 性能（见下表） |
| S4 | **P1** | **doctor 并行化**：逐应用串行跑 `cmd --version`（5s 超时），实测 128~151s。建议用并发池（如 4~8 并发）或对「命令存在即视为健康」降级，可缩至 ~30s | 性能 |
| S5 | **P1** | **check_updates 并发查询**：串行 `npm view` 实测 34~42s，建议并发（限流 5）后 ~10s 内 | 性能 |
| S6 | **P2** | **死代码清理**：`src/index.ts:9,11` 导入并 cast 了 `defineTool` 但从未调用（工具以裸对象注册）。要么真正用 `defineTool()` 构造定义以获得 schema 校验与向前兼容保障，要么删除该导入 | 代码卫生 |
| S7 | **P2** | CLI `list` 表格固定列宽（22/12/18/11/11/12）遇到长包名（如 `@anthropic-ai/claude-code`）时错位。建议按当批数据动态计算列宽 | 体验 |
| S8 | **P2** | `package.json` 的 `test` 脚本指向不存在的 `lib/**/*.test.js`（空跑）。建议改为提示指向外部测试区（本目录）或在 README 说明 | 代码卫生 |
| S9 | **P3** | 页面为固定深色主题；如需跟随宿主 dsh 的亮/暗主题可后续引入 `prefers-color-scheme` 双套变量 | 体验 |

## 五、性能观测（全量模式实测）

| 操作 | 实测耗时 | 说明 |
|---|---|---|
| 单次全量扫描（工具/CLI 内） | 10~30s | 每次调用均重新扫描（建议 S3） |
| 页面渲染 `/app-manager` | 79.7s | 扫描 + ARP 基线双跑 |
| doctor（工具 / CLI） | 128s / 151s | 串行 `--version`（建议 S4） |
| check / check_updates | 33.7s / 41.6s | 串行 `npm view`（建议 S5） |
| 纯断言类用例（D/E 组） | ≤1ms | 无 I/O |

## 六、环境备注

- 运行期间沙箱拦截了 `WMIC.exe` / `reg.exe`（黑名单策略）。**所有用例仍全部通过**，证明插件扫描链路（PowerShell + PATH 枚举）不依赖这两个二进制，此为加分项
- 网络用例（TC-A18 / TC-B15）真实访问 npm registry，均按预期完成
- 跨端点一致性（TC-E07）：method API 与 apps API 的 totalApps 完全一致，无环境波动

## 七、测试资产与复跑方式

| 资产 | 位置 |
|---|---|
| 用例规格（51 条） | `tests/TEST-CASES.md` |
| 自动化运行器 | `tests/run-tests.mjs` |
| 机器报告（本轮） | `tests/reports/run-2026-09-11_161153.md` |
| 本报告 | `tests/reports/TEST-REPORT-2026-09-11.md` |
| 流程说明（与开发分离约定） | `tests/README.md` |
| 早期探针（留档） | `tests/probe-plugin-runtime.mjs` · `tests/probe-ui.mjs` |

```bash
# 全量复跑（约 15 分钟）
"C:/Users/Blank/.workbuddy/binaries/node/versions/22.22.2-2/node.exe" \
  "E:/Workspace/dsh-playground/tests/run-tests.mjs"

# 快速回归（跳过 2 条网络用例，约 13 分钟）
# 追加参数 --quick
```

---

**报告完** · 本报告遵循「测试与开发分离」约定：只记录、只建议，不改动。S1/S2 为下轮开发最小修复集（合计约 10 行改动），修复后复跑 D 组即可闭环。
