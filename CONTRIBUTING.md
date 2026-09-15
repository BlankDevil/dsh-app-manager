# Contributing / 贡献指南

## 分支策略

| 分支 | 职责 | 合入 `main` 的条件 |
|------|------|--------------------|
| `main` | **主分支**。所有代码最终合入这里；发布版本从 main 拉出 | — |
| `feat/<主题>` | **新功能**。新需求先提交到这里 | 必须先 **PR + code review / verify** |
| `bugfix/<主题>` | **bug 修复** | 必须先 **PR + code review / verify** |
| `docs/<主题>` | **文档变更**（README / CHANGELOG / PUBLISH / CONTRIBUTING 等） | 必须先 **PR + code review / verify** |
| `chore/<主题>` | **杂项**：构建、依赖、元信息（`package.json` 字段、LICENSE、CI 配置等） | 必须先 **PR + code review / verify** |
| `rel-{版本号}` | **发布分支**。每个版本阶段性成功后正式发布上线 | 仅在明确「发布新版本」后从 `main` 拉出；完成 code review / verify / 上线测试后才能正式发布 |

**`<主题>` 用小写连字符**，一眼看出在做什么：`feat/plugin-teardown`、
`docs/branch-naming`、`chore/release-0.5.2`。斜杠只是**分支名**的一部分，
不是在磁盘上建目录 —— 详见下方「分支命名」。

### 怎么选分支

| 改动内容 | 分支 |
|---|---|
| 新增/修改功能、行为 | `feat/<主题>` |
| 修 bug | `bugfix/<主题>` |
| 纯文档（含 CHANGELOG、本文件） | `docs/<主题>` |
| 构建脚本、依赖版本、CI、`package.json` 字段、LICENSE、`.gitattributes` | `chore/<主题>` |
| 阶段性发布上线 | `rel-{版本号}` |

一句话：**一次 PR 只做一类事**。若一个改动同时包含代码和文档，代码走自己的分支，
文档改动随该 PR 一起提（同一 PR 内允许附带相关文档），不要为了文档另开一个分支再拆散上下文。

### 规则

1. **不要直接向 `main` 提交或推送。** `main` 只接受经 PR + review / verify 的合入。
   （本条对维护者同样适用。）
2. **不要自行创建 `rel-*` 分支。** 只有明确要「发布新版本」时才从 `main` 拉。
3. **不要自行打发布 tag。** 发布动作是独立步骤，由维护者发起。
4. 按「怎么选分支」表选择分支，**不要混用**（例如别把文档改动提进 `bugfix`）。
5. 分支名用 **`<类型>/<主题>`**：`feat/`、`bugfix/`、`docs/`、`chore/` 后面接一个
   小写连字符主题（例：`feat/plugin-teardown`）。一次 PR 只做一类事 —— 详见下方
   「分支命名」。

### 分支命名

**按类型选前缀，再接一个主题名：**

| 用途 | 分支 |
|------|------|
| 新功能 | `feat/<主题>` |
| 修 bug | `bugfix/<主题>` |
| 文档 | `docs/<主题>` |
| 杂项 / 构建 / 元信息 | `chore/<主题>` |
| 发布 | `rel-<版本号>`（仅明确发版时） |

主题用小写连字符，能一眼看出在做什么：`feat/plugin-teardown`、`docs/branch-naming`、
`chore/release-0.5.2`。

- ✅ **`<类型>/<主题>` 是分支名，不是在磁盘上建目录。** 斜杠只是名字的一部分。
- ⚠️ **不要同时存在裸 `feat` / `bugfix` / `docs` / `chore` 分支。**
  原因：git 把分支名存成 ref，而 ref **不能既是文件又是目录** ——
  只要 `refs/heads/chore` 这个**文件**还在，`refs/heads/chore/<主题>` 这个**目录**
  就永远建不出来：

  ```
  fatal: cannot lock ref 'refs/heads/chore/plugin-teardown':
         'refs/heads/chore' exists; cannot create 'refs/heads/chore/plugin-teardown'
  ```

  本仓库的四个裸类型分支**已移除**（内容全部合入 `main`，未丢任何提交），
  统一改用 `<类型>/<主题>`。若你在旧克隆里还能看到它们，删掉即可：
  `git branch -d feat bugfix docs chore`（本地）、
  `git push origin --delete feat bugfix docs chore`（远端）。
- ✅ 一次 PR 只做一类事。**合并后分支即可删除**，下一个同类型的工作换个主题名
  重新拉 —— 不需要复用同一个分支：
  ```bash
  git push origin --delete feat/plugin-teardown
  ```

> 命令提示：本仓库维护者的 git 是 2.9.0，没有 `switch` 子命令，示例统一用
> `git checkout -b`。git ≥ 2.23 可用更清晰的 `git switch -c`。

### 典型流程

```
# 新功能
git checkout -b feat/<主题> main
# ... 开发、提交 ...
# 开 PR: feat/<主题> -> main，等 review / verify 通过后合入
# 合并后删掉分支: git push origin --delete feat/<主题>

# 修 bug
git checkout -b bugfix/<主题> main
# ... 修复、提交 ...
# 开 PR: bugfix/<主题> -> main

# 文档
git checkout -b docs/<主题> main
# 开 PR: docs/<主题> -> main

# 杂项 / 构建 / 元信息
git checkout -b chore/<主题> main
# 开 PR: chore/<主题> -> main

# 发布（仅在明确要发版时）
git checkout main && git pull
git checkout -b rel-0.6.0
# ... code review / verify / 上线测试 ...
# 通过后才正式发布
```

---

## 提交身份

### 其他贡献者：用你自己的身份，**不需要改任何配置**

直接用你本地已有的 git 身份提交即可 —— 仓库**不会**要求你改成维护者的名字。
GitHub 会按提交里的邮箱把这个 commit 归属到**你自己的**账号，
你的贡献记录也留在你自己的名下。

> 换句话说：「统一署名 `BlankDevil`」只约束仓库维护者，不是对贡献者的要求。

### 维护者：统一署名 `BlankDevil`

只有仓库所有者（`@BlankDevil`）在本仓库使用统一署名，与 `LICENSE` 的版权人、
`package.json` 的 `author` 保持一致。配置为**仓库级**，不要改全局：

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
