# Contributing / 贡献指南

## 分支策略

| 分支 | 职责 | 合入 `main` 的条件 |
|------|------|--------------------|
| `main` | **主分支**。所有代码最终合入这里；发布版本从 main 拉出 | — |
| `feat` | **新功能分支**。新需求先提交到这里 | 必须先 **PR + code review / verify** |
| `bugfix` | **bug 修复分支** | 必须先 **PR + code review / verify** |
| `docs` | **文档变更分支**（README / CHANGELOG / PUBLISH / CONTRIBUTING 等） | 必须先 **PR + code review / verify** |
| `chore` | **杂项分支**：构建、依赖、元信息（`package.json` 字段、LICENSE、CI 配置等） | 必须先 **PR + code review / verify** |
| `rel-{版本号}` | **发布分支**。每个版本阶段性成功后正式发布上线 | 仅在明确「发布新版本」后从 `main` 拉出；完成 code review / verify / 上线测试后才能正式发布 |

### 怎么选分支

| 改动内容 | 分支 |
|---|---|
| 新增/修改功能、行为 | `feat` |
| 修 bug | `bugfix` |
| 纯文档（含 CHANGELOG、本文件） | `docs` |
| 构建脚本、依赖版本、CI、`package.json` 字段、LICENSE、`.gitattributes` | `chore` |
| 阶段性发布上线 | `rel-{版本号}` |

一句话：**一次 PR 只做一类事**。若一个改动同时包含代码和文档，代码走自己的分支，
文档改动随该 PR 一起提（同一 PR 内允许附带相关文档），不要为了文档另开一个分支再拆散上下文。

### 规则

1. **不要直接向 `main` 提交或推送。** `main` 只接受经 PR + review / verify 的合入。
   （本条对维护者同样适用。）
2. **不要自行创建 `rel-*` 分支。** 只有明确要「发布新版本」时才从 `main` 拉。
3. **不要自行打发布 tag。** 发布动作是独立步骤，由维护者发起。
4. 按「怎么选分支」表选择分支，**不要混用**（例如别把文档改动提进 `bugfix`）。
5. **不要另造分支名。** 只用 `feat` / `bugfix` / `docs` / `chore` 四个既有分支，
   也不要写 `chore/<主题>` 这种斜杠形式 —— 详见下方「分支命名」。

### 分支命名

**直接用既有的四个分支，不要另造名字：**

| 用途 | 分支 |
|------|------|
| 新功能 | `feat` |
| 修 bug | `bugfix` |
| 文档 | `docs` |
| 杂项 / 构建 / 元信息 | `chore` |

- ❌ **不要新建 `chore-<主题>` / `docs-<主题>` 这类衍生分支名。**
  一个类型只需要一个分支，需要新工作时复用它。
- ❌ **也不要写 `chore/<主题>`（斜杠形式）。** Git 的 ref 就是文件路径：
  `refs/heads/chore` 已经是一个**文件**，就再也建不出 `refs/heads/chore/` 这个**目录**，
  `git switch -c chore/xxx` 会直接报
  `cannot lock ref ... 'refs/heads/chore' exists`。
- ✅ 一个分支的 PR 合并后，把它**快进回 `main`** 即可继续复用：
  ```bash
  git switch chore && git merge --ff-only main
  ```

### 典型流程

```
# 新功能
git switch feat
# ... 开发、提交 ...
# 开 PR: feat -> main，等 review / verify 通过后合入

# 修 bug
git switch bugfix
# ... 修复、提交 ...
# 开 PR: bugfix -> main

# 文档
git switch docs
# 开 PR: docs -> main

# 杂项 / 构建 / 元信息
git switch chore
# 开 PR: chore -> main

# 发布（仅在明确要发版时）
git switch main && git pull
git switch -c rel-0.6.0
# ... code review / verify / 上线测试 ...
# 通过后才正式发布
```

---

## 提交身份

本仓库使用统一署名 **`BlankDevil`**（与 `LICENSE` 的版权人、`package.json` 的 `author` 一致）。
配置为**仓库级**，不要改全局：

```bash
git config user.name  "BlankDevil"
git config user.email "26699405+BlankDevil@users.noreply.github.com"
```

邮箱用 GitHub 的 noreply 形式（`<ID>+<login>@users.noreply.github.com`）：
既能让 GitHub 把提交正确归属到 `BlankDevil` 账号，又不会把个人邮箱写进每一条提交的元数据。
`package.json` 的 `author` 保留邮箱是为了给使用者一个联系渠道 —— 两处用途不同，不冲突。

> 注意：此前的提交（截至 `101f2dc`）使用的是占位身份 `DSH User <user@example.com>`，
> 历史保留不改写。

## 开发约定

### 构建产物 `lib/` 是提交进仓库的

改完 `src/` **必须** `pnpm build` 再提交 —— `lib/` 入库是为了让本地 `link:` 安装可用。
CI 里有守卫会检查两者是否同步（用 `git diff -w`，见下）。

### 提交前自检

```bash
pnpm install --frozen-lockfile
pnpm build
pnpm test:quick        # 全量套件（--quick 跳网络用例）
pnpm test:paths        # 跨平台全局路径推导
pnpm test:approval     # 变更类工具的审批门槛
pnpm test:perf         # 性能 + 子进程超时健壮性
pnpm test:drag         # 拖拽交互行为（需 jsdom >= 27）
pnpm smoke             # 特性冒烟
```

### 测试要求

- **交互行为**（拖拽、列宽、筛选跳转）必须写**行为测试**（真实 DOM + 真实事件 +
  断言最终状态）。静态标记断言**不能**作为交互可用的证据。
- 性能退化没有功能症状，靠 `perf-guard` 兜。
- 新增/修改测试时，请先证明**拦截器真的生效**再执行被测逻辑
  （`child_process` 的 ESM 绑定在首次 import 时固定，打桩顺序写错会静默失效 ——
  详见 `tests/approval-gate.test.mjs` 顶部）。

### 平台约定

- 测试套件**跑在 Windows** 上（`monitor`、ARP 基准是 Windows 专有）。
  Linux 侧在 CI 里只做构建 + 冒烟。
- 涉及平台差异的路径逻辑（如全局包根目录）请写成**可注入 platform/execPath** 的纯函数，
  这样才能在任意机器上断言 —— 见 `src/utils.ts` 的 `npmGlobalCandidates()`。

### 文档同步

改了发布相关内容（`files` 白名单、peer 依赖、平台支持范围）时，
请同步更新 `README.md` 与 `PUBLISH.md` —— 这两处曾因滞后而误导读者。
