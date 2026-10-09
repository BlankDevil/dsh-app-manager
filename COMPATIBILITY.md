# dsh 版本兼容性

> 本文记录 dsh-app-manager 与各 dsh 宿主版本之间**逐项契约**的对照结果，
> 以及每次适配的结论。核对方式是**下载真实发布包读接口与实现**，不是查文档。

**当前状态**：支持 **dsh 0.1.5-rc.x** 与 **dsh 0.2.0-rc.2** 两条线（同一份产物）。

---

## 1. 结论摘要（0.5.3 → 0.6.0）

| 判定 | 项 |
|---|---|
| ❌ **会被拒绝加载** | `peerDependencies` 声明 `@deepseek-ai/dsh-tools: ^0.1.5-rc.1` |
| ✅ 无需改动 | 工具注册契约、webServer 路由契约、审批服务契约、bundle patch 解析、默认端口、cordis 版本 |
| ⚠️ 行为变化 | 审批闸门在 0.2.0 上**从「永远拒绝」变为可真正批准**（该服务 0.2.0 才出现） |

**净结果：为兼容性不需要改任何运行时代码，只需改 manifest 的 peer 范围。**
破坏点不在 API，而在加载前的兼容性校验。

> 例外（与本任务无关，但顺手修了）：适配过程中发现 `execAsync` 的超时路径不释放
> 子进程句柄，会让 `doctor` 在特定环境下卡住不退出 —— 详见 §6 末尾。

---

## 2. 核对方法

| 手段 | 具体做法 |
|---|---|
| 取真包 | `npm pack` 拉取具体版本 tarball 并解包（`@deepseek-ai/dsh-tools`、`dsh-llm`、`dsh-host-webserver`、`dsh-user-approval`、`dsh`、`cordis`），逐个比对 `lib/types/*.d.ts` 与实现 |
| 完整依赖树 | 把 `@deepseek-ai/dsh@0.2.0-rc.2` 装进隔离目录（288 个包），在其中搜索校验器/解析器的真实实现 |
| semver 实测 | 用 **dsh 依赖树里的 `semver` 本体**跑判定，而不是手推 |
| 字节级 diff | 对同名文件做 `diff`，区分「逐字相同」「行号位移」「真实增量」 |

> 未做：在真实 0.2.0 宿主里跑一次完整启动（该 dsh 安装含原生模块 `koffi`，
> 本机无 CMake，`--ignore-scripts` 下无法完成构建）。因此**加载校验的结论来自
> 读取 app-boot 的实现 + 用它的 semver 实测**，而非一次真实启动。见 §7。

---

## 3. 逐项契约对照

### 3.1 工具注册（`@deepseek-ai/dsh-tools`）

| 契约 | 0.1.5-rc.2 | 0.2.0-rc.2 | 判定 |
|---|---|---|---|
| `ToolRegistry.register(definition: ToolDefinition): () => void` | 同 | 同 | ✅ 不变 |
| `ToolDefinition extends ToolSchema` + `output: ToolOutputDefinition` | 同 | 同 | ✅ |
| `ToolOutputDefinition`（`schema` + `render(args, value) → ContentBlock[]` + 可选 `presentationMeta`） | 同 | 同 | ✅ **逐字相同** |
| `ToolExecution` / `ToolDispatchExecution` | 同 | 同 | ✅ **逐字相同** |
| `ToolSchema`（来自 `@deepseek-ai/dsh-llm`） | `name` / `description` / `parameters` | 同上 **+ 新增可选 `deferLoading?: true`** | ✅ 增量，兼容 |

真实增量（不影响本插件）：新增 `tools/post-execute` 前置钩子 `projectContent`、
策略决策新增 `cancel` 词、结果新增结构化 `error?: {name, code, reason}`、
`MessageSourceMap` 新增 `'tool-registry'`。

本插件用到的字段（`name`/`description`/`parameters`/`output.schema`/`output.render`/`execute`）
在两版之间**没有任何变化**。

### 3.2 网页路由（`@deepseek-ai/dsh-host-webserver`）

| 契约 | 0.0.1-rc.5 | 0.2.0-rc.2 | 判定 |
|---|---|---|---|
| `register(route: WebRoute): () => void` | 同 | 同 | ✅ 不变 |
| `WebRoute` = `{ kind: 'exact'\|'prefix'; path: string; handler(req: IncomingMessage, res: ServerResponse) }` | 同 | 同 | ✅ **逐字相同** |

插件注册的 7 条路由（`kind: "exact"` + `path` + `handler`）与两版签名一致；
handler 收到的是 Node 原生 `IncomingMessage`/`ServerResponse`，插件只用到
`req.url` / `req.method` / `req.headers` 与 `res.writeHead` / `res.end` —— 两版都成立。

新增能力（不影响本插件）：`registerUpgrade` / `registerFallback` / `tapIndex`。

### 3.3 审批服务（`@deepseek-ai/dsh-user-approval`）

| 契约 | 0.1.5 线 | 0.2.0-rc.2 | 判定 |
|---|---|---|---|
| 服务是否存在 | **不存在该包** | 存在，`Context.approval: ApprovalService` | ⚠️ 见 §4 |
| 方法 | — | `request(req: ApprovalRequest): Promise<ApprovalOutcome>` | ✅ 与插件假设一致 |
| 请求字段 | — | `agent` / `toolName` / `callId?` / `reason?` / `signal?` | ✅ 与插件传入一致 |
| 结果词表 | — | `'allowed-once' \| 'rejected' \| 'cancelled' \| 'unavailable'`，文档明确「`'allowed-once'` 是唯一许可」 | ✅ 与插件词表**逐字相同** |

插件自 0.5.0 起就把审批做成**可选注入 + fail closed**，且请求/结果形状与 0.2.0 公开的
契约完全吻合 —— 无需改动。

### 3.4 bundle 加载与 patch

| 契约 | 判定 |
|---|---|
| `package.json` 的 `dsh.bundle.patch` | ✅ 仍是 bundle 声明字段（`dsh-base` 亦如此声明） |
| 解析方式 | ✅ `bundlePatchFiles()` **按声明值取**：字符串取一个文件、数组按序取多个 —— 因此插件的 `"./patch.yml"` 无需改名 |
| patch 内容格式 | ✅ `- insert: [{ id, name }]` 与 `dsh-base/cordis.patch.yml` 自身用法一致 |
| 模块解析 | 两锚点（dsh 安装 + profile 目录）；插件不依赖此细节 |

### 3.5 其它

| 项 | 0.1.5 线 | 0.2.0-rc.2 | 判定 |
|---|---|---|---|
| 默认 Web 端口 | `ctx.webStartup.port ?? 3080` | 同（`dsh-web-app/cordis.patch.yml`） | ✅ 不变 |
| cordis | `^4.0.2` | `~4.0.4` | ✅ 差异仅 `Fiber.update()`/`internal/update` 的返回语义，插件未使用 |
| `ctx.inject` / `ctx.on` / `ctx.logger` | — | 签名不变 | ✅ |
| dsh 侧 `engines` | — | 未声明 | — 插件维持 `node >=18` |

---

## 4. 破坏点：peer 范围会被加载器拒绝

### 现象（若不修）

dsh 0.2.0 在加载 profile bundle 前做兼容性校验
（`@deepseek-ai/dsh-app-boot/lib/index.js`）：

```js
const issue = evaluatePluginCompatibility(bundleManifest, exemptions);
if (issue !== void 0 && !issue.exempted) throw new Error(pluginCompatibilityWarning(issue));
```

校验规则（同一文件）：对每个 `@deepseek-ai/dsh` / `@deepseek-ai/dsh-*` peer，
用 `semver.satisfies(runtimeVersion, range, { includePrerelease: true })` 判定；
**不满足即抛错**，该 bundle 被跳过（记入 `skippedBundles`）。报错原文：

```
Plugin dsh-app-manager@0.5.3 is incompatible with dsh 0.2.0-rc.2:
peerDependencies {"@deepseek-ai/dsh-tools":"^0.1.5-rc.1"}.
Running it may cause crashes or data loss. Update the plugin or install a plugin
version compatible with this dsh runtime. To accept this risk explicitly, grant
the exact-version exemption for dsh-app-manager@0.5.3 on dsh 0.2.0-rc.2 with
`dsh plugin allow-version` or the plugin manager, then retry …
```

### 实测（用 dsh 依赖树里的 semver）

| peer 范围 | 对运行时 `0.2.0-rc.2` |
|---|---|
| `^0.1.5-rc.1`（原声明） | ❌ **不匹配** |
| `^0.2.0-rc.2` | ✅ 匹配 |
| `^0.1.5-rc.1 \|\| ^0.2.0-rc.2`（本次采用） | ✅ 匹配 |
| `>=0.1.5-rc.1 <0.3.0` | ✅ 匹配 |

### 处置

- peer 范围改为 **`^0.1.5-rc.1 || ^0.2.0-rc.2`**：两条线都实测契约兼容，故同一份产物服务两者。
- 已经在 0.2.0-rc.2 上装了 0.5.3 的用户，临时解法是
  `dsh plugin allow-version`（写入 profile 的 `compatibility.json`，**精确版本**豁免）；
  正确解法是升级到本版本。
- **不**为 `dsh-host-webserver` / `dsh-user-approval` 增加 peer：这两者是通过**可选注入**消费的，
  声明成 peer 会把「可选服务」变成「加载阻断条件」。

---

## 5. 行为变化：审批闸门从「恒拒绝」变为可用

0.2.0 的 `dsh-base`（每个 base 型 profile 的核心 bundle）**依赖 `@deepseek-ai/dsh-user-approval`**，
且 web profile 组合了 UI 应答器（`ui-approval` / `@deepseek-ai/dsh-client-ui-approval`）。

因此 `app_manager_update` 的闸门在 0.2.0 上：

| 宿主 | 行为 |
|---|---|
| 0.1.5 线（无该服务） | 恒 fail closed → 拒绝执行，提示 `app-manager update` 或 `APP_MANAGER_ALLOW_UNATTENDED_UPDATE=1` |
| 0.2.0-rc.2 web | **会真正弹出审批**，`allowed-once` 放行后可执行 |

这是插件**已有设计的自然结果**（可选注入 + fail closed），无需改代码；但用户可感知，
故在此记录。

---

## 6. 本次变更清单

| 文件 | 改动 | 为什么 |
|---|---|---|
| `package.json` | peer 范围 `^0.1.5-rc.1` → `^0.1.5-rc.1 \|\| ^0.2.0-rc.2`；版本 0.5.3 → 0.6.0 | §4 的破坏点 |
| `src/utils.ts`（+ `lib/**`） | **超时路径释放子进程句柄**：`killProcessTree` 之后 destroy stdio 并 `unref()` | 见下方「顺带修掉的真实缺陷」 |
| `CHANGELOG.md` | 新增 [0.6.0] 条目 | 记录破坏点与依据 |
| `README.md` | 宿主兼容性小节（两条线 + 加载校验说明 + 审批闸门行为差异） | 用户可感知 |
| `PUBLISH.md` / `tests/README.md` / `tests/TEST-CASES.md` | 宿主版本基线更新；TEST-CASES 升 v4 | 文档与实际一致 |
| `COMPATIBILITY.md`（新增） | 本文 | 兼容性报告 |
| `tests/dsh-compat.test.mjs`（新增） | 守住 peer 声明与 bundle 声明 | 防声明漂移 |
| `tests/run-tests.mjs` | `runCli` 由 `spawnSync` 改为**异步 spawn**；结算以 `exit` 为准 | 本机 `spawnSync` 对任何目标都报 EBUSY（§7） |
| `tests/approval-gate.test.mjs` | 逃生口用例同样改异步 spawn；目标应用由写死 `dsh` 改为**动态挑 npm 来源应用** | 写死名字会随机器状态失效 |

### 顺带修掉的真实缺陷：超时子进程把父进程钉住

适配过程中发现 `execAsync` 的超时路径只做 `killProcessTree(child)`，**不释放句柄**。
若 `close` 事件始终不来（常见原因：孙进程继承了 stdio 管道），那个 `ChildProcess`
仍持有活动句柄 → node 不退出 → 调用方表现为「活儿早干完了，进程却挂在那儿」。

实测：`doctor` 打印完汇总后一直不退，直到测试侧 300s 上限才被强杀。
修复后 **19.5s 正常退出（code=0）**。

这个缺陷在正常环境下不可见（子进程秒退、`close` 必到），是被本机环境（`spawnSync`
不可用、探测子进程有孤儿）暴露出来的 —— 但它对任何「子进程清理不干净」的宿主都成立。

---

## 7. 未验证项（如实列出）

1. **未在真实 0.2.0 宿主里完成一次启动**：该 dsh 安装含原生模块 `koffi`，本机无 CMake，
   `--ignore-scripts` 下装不全。加载校验的结论来自**读取 app-boot 实现 + 用它自带的
   semver 实测**，不是一次真实 boot。
2. **页面动作在 0.2.0 上的端到端未跑**：`/api/open` 的终端弹出、`/api/update` 的真实安装，
   在 0.2.0 宿主下未实测（本地测试用伪宿主，与宿主版本无关）。
3. **peer 校验的豁免路径**（`dsh plugin allow-version` → `compatibility.json`）只读了实现，
   未实操。
4. 0.2.1-alpha.1 已存在于 npm，本文未覆盖（用户目标是 0.2.0-rc.2）。

---

## 8. 维护者备忘

- **上游还会动**：0.2.0 系列的策略词表、`deferLoading`、`projectContent` 都是活跃增量。
  每次 dsh 升版，按本文 §2 的方法重跑一遍对照即可（拉包 → diff 接口 → 语义实测）。
- **何时收窄范围**：当 0.1.5 线不再被支持/不再有人用时，可把范围收成 `^0.2.0-rc.2`，
  并同步删除本文的双线表述。
- **`npm run test:compat` 的边界**：它守的是「声明与自称支持范围一致」，
  不替代真实宿主启动；后者目前只能人工在有构建工具链的机器上做。
