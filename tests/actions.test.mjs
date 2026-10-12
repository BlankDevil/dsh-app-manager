#!/usr/bin/env node
/**
 * dsh-app-manager — 页面动作（开终端 / 查更新 / 单个升级）与退出机制的回归测试
 *
 * 为什么需要：这三个动作会**改动真实机器** —— 打开终端窗口、执行全局安装。
 * 只断言「接口存在」远远不够：本项目在 Q6/Q7 拖拽上栽过这个坑 ——
 * 静态标记齐全，功能实际是死的。所以本测试**真实调用插件注册的 handler**，
 * 断言的是行为：
 *   - GET 不能触发任何动作（链接、浏览器预取都会发 GET）
 *   - 未知应用 / 缺 name 参数一律拒绝
 *   - 命令与工作目录**来自 discovery**，而不是请求里塞进来的
 *   - 同一应用并发升级只跑一次（第二个请求 409）
 *   - 更新检查有缓存，?refresh=1 能强制重查
 *   - 三个平台的终端调用形态正确（纯函数，逐平台断言）
 *   - _resetScanCache() 幂等（dispose 里可能被调用两次）
 *   - 插件卸载后所有新路由立即失效（404 + no-store）
 *
 * ⚠️ 安全设计（别改坏）：三个「会改机器」的动作全部经 _setActionHooks 接缝
 * 替换成桩。测试启动后会**先验证桩确实生效**（靠返回值里的哨兵字符串），
 * 不生效就立即中止整个套件 —— 否则测试会真的弹出终端窗口、真的装全局包。
 *
 * 运行：node tests/actions.test.mjs
 */

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { apply, _setActionHooks, _terminalInvocationFor } from "../lib/src/index.js";
import { _resetScanCache } from "../lib/src/discovery.js";
import { sampleApps, describeApp, excludedPatterns } from "./sample-apps.mjs";
import { snapshot, available, discoverLeaks, closeAll, openedCount } from "./close-apps.mjs";

const STARTED_AT = new Date();
const TESTS_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPORTS_DIR = path.join(TESTS_DIR, "reports");

/* ------------------------------------------------------------------ 断言 */

let failures = 0;
let checks = 0;

function check(label, actual, expected) {
  checks += 1;
  const ok = Object.is(actual, expected);
  if (!ok) failures += 1;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}: ${JSON.stringify(actual)}${ok ? "" : ` (期望 ${JSON.stringify(expected)})`}`);
}

function assert(label, condition, detail = "") {
  checks += 1;
  if (condition) {
    console.log(`  PASS  ${label}`);
  } else {
    failures += 1;
    console.log(`  FAIL  ${label}${detail ? " — " + detail : ""}`);
  }
}

function abort(message) {
  console.error(`\n❌ 中止：${message}\n`);
  process.exit(2);
}

/**
 * 跳过 = 失败。
 *
 * 本仓库在拖拽组上吃过亏：缺 jsdom 时静默 SKIP 且退出码 0，CI 全绿而覆盖为零。
 * 所以这里没有"SKIP 但不影响结果"的选项 —— 没验证就是没通过。
 */
function skipAsFailure(label, reason) {
  checks += 1;
  failures += 1;
  console.log(`  FAIL  ${label} — 跳过即失败：${reason}`);
}

/* ------------------------------------------------------- 桩（绝不碰真机器） */

const SENTINEL_TERMINAL = "STUB-TERMINAL-DO-NOT-SPAWN";
const calls = { spawn: [], update: [], collect: 0, versionProbes: [], scanResets: 0, healthProbes: [], renames: [] };

/**
 * 健康扫描的可变桩状态。
 * 定位器（findOrphanShims）也桩掉：否则测试会读到**本机真实 PATH**，
 * 换一台机器结果就飘。
 */
const healthStub = { broken: new Set(), shims: new Map() };

_setActionHooks({
  spawnTerminal: (command, cwd, shell) => {
    calls.spawn.push({ command, cwd, shell });
    return { ok: true, detail: SENTINEL_TERMINAL };
  },
  runUpdate: async (app) => {
    calls.update.push(app.name);
    // 故意慢一点：并发保护只有在真正重叠时才看得出来
    await new Promise((r) => setTimeout(r, 150));
    return { ok: true, command: `STUB install -g ${app.name}@latest`, detail: "stubbed" };
  },
  // 版本探测是子进程级的动作，桩掉：测试不去真的问本机工具。
  resolveAppVersion: async (app, options) => {
    calls.versionProbes.push({ name: app.name, refresh: Boolean(options?.refresh) });
    return app.name.startsWith("__none__") ? null : "9.9.9-stub";
  },
  resetScanCache: () => {
    calls.scanResets += 1;
  },
  collectUpdates: async () => {
    calls.collect += 1;
    return {
      checkedAt: new Date().toISOString(),
      updates: { "stub-pkg": { current: "1.0.0", latest: "2.0.0", command: "STUB install -g stub-pkg@latest" } },
      skipped: 0,
    };
  },
  // 「命令还能不能跑」是子进程级的动作，桩掉：坏/好由 healthStub.broken 说了算。
  probeCommandHealth: async (app, options) => {
    calls.healthProbes.push({ name: app.name, refresh: Boolean(options?.refresh) });
    const broken = healthStub.broken.has(app.name);
    return { broken, reason: broken ? "stub: Cannot find module 'x'" : "" };
  },
  // 残留文件定位：桩掉，测试不碰本机 PATH。
  findOrphanShims: (command) => healthStub.shims.get(command) ?? [],
  // 移动文件是**改名**，桩掉：测试绝不能真的动磁盘上的任何文件。
  renameOrphanShim: (file) => {
    calls.renames.push(file);
    return `${file}.MOVED-STUB`;
  },
});

/* ------------------------------------------------------------- 假宿主 ctx */

const routes = new Map();
const ctx = {
  logger: { info: () => {} },
  on: (event, listener) => {
    if (event === "dispose") ctx.__dispose = listener;
    return () => {};
  },
  inject: (_services, callback) => {
    callback({
      tools: { register: () => () => {} },
      webServer: {
        register: (route) => {
          const key = `${route.kind} ${route.path}`;
          routes.set(key, route);
          return () => routes.delete(key);
        },
      },
    });
    return () => {};
  },
};

const teardown = apply(ctx);

/** 调用一条已注册路由，返回 {status, headers, body}。 */
async function call(path, { method = "GET", url = null } = {}) {
  const route = routes.get("exact " + path);
  if (!route) return { status: 404, headers: {}, body: "(route not registered)" };
  const res = { status: 0, headers: {}, raw: "" };
  await route.handler({ method, url: url ?? path, headers: {} }, {
    writeHead: (s, h) => {
      res.status = s;
      res.headers = h || {};
    },
    end: (d) => {
      res.raw = String(d ?? "");
    },
  });
  try {
    res.body = JSON.parse(res.raw);
  } catch {
    res.body = res.raw;
  }
  return res;
}

const API = "/app-manager";

/* -------------------------------------------------------------------- 1 */

console.log("=== 1. 路由注册 ===");
for (const p of [
  "/app-manager",
  "/app-manager/api/apps",
  "/app-manager/api/unmanaged",
  "/app-manager/api/method",
  "/app-manager/api/open",
  "/app-manager/api/updates",
  "/app-manager/api/update",
]) {
  check(`已注册 ${p}`, routes.has("exact " + p), true);
}

const appsRes = await call(`${API}/api/apps`);
const apps = appsRes.body.apps || [];

// 每次运行随机抽 4~6 个（而不是永远钉死在 find() 找到的第一个）：
// 只测一个"干净"的应用会把整类 bug 藏起来 —— 名字带空格、命令名与包名不同、
// 路径含特殊字符的应用可能一次都没被测过。
console.log("=== 本次运行的 app 抽样 ===");
const launchables = sampleApps(
  apps.filter((a) => a.commands && a.commands.length > 0),
  { label: "可启动应用" }
);
const npmApps = sampleApps(
  apps.filter((a) => a.source === "npm"),
  { label: "npm 应用" }
);

// 样本就是「这轮测试打的是谁」。随机抽样之后，脱离样本的结论无法复现，
// 所以既要打在屏幕上，也要落进报告文件。
const sampleRows = [];
for (const a of launchables) sampleRows.push(["可启动应用", a]);
for (const a of npmApps) if (!launchables.includes(a)) sampleRows.push(["npm 应用", a]);
for (const [role, a] of sampleRows) {
  console.log(`  → ${role}: ${describeApp(a)}`);
}
if (sampleRows.length === 0) {
  console.log("  → 本次没有抽到任何应用（池为空）");
}

// 进程快照：收尾时用它证明"本次运行没有留下任何被打开的应用"。
// tasklist 不可用时必须大声失败 —— 否则这个检查会退化成永远通过的空检查。
const procBefore = await snapshot();
if (!(await available())) {
  skipAsFailure("进程快照可用", "tasklist 不可用 —— 收尾关闭检查会变成空检查，拒绝静默放行");
}

/* -------------------------------------------------------------------- 2 */

console.log("\n=== 2. 桩是否真的生效（不生效就中止，否则会真开窗口/真装包）===");
if (launchables.length === 0) {
  skipAsFailure("终端桩有效性", "本机没有带命令的应用，无法验证 —— 跳过即失败");
} else {
  for (const app of launchables) {
    const probe = await call(`${API}/api/open`, {
      method: "POST",
      url: `${API}/api/open?name=${encodeURIComponent(app.name)}`,
    });
    if (probe.body.detail !== SENTINEL_TERMINAL) {
      abort(`终端桩未生效（detail=${JSON.stringify(probe.body.detail)}）—— 拒绝继续，可能真的开了终端`);
    }
    check(`终端桩生效（返回哨兵）· ${app.name}`, probe.body.detail, SENTINEL_TERMINAL);
  }
}

/* -------------------------------------------------------------------- 3 */

console.log("\n=== 3. /api/open 的校验与取数 ===");
check("GET 被拒（链接/预取不能开终端）", (await call(`${API}/api/open`)).status, 405);
check("未知应用 404", (await call(`${API}/api/open`, { method: "POST", url: `${API}/api/open?name=__nope__` })).status, 404);
check("缺 name 参数 404", (await call(`${API}/api/open`, { method: "POST" })).status, 404);
for (const app of launchables) {
  const before = calls.spawn.length;
  const res = await call(`${API}/api/open`, {
    method: "POST",
    url: `${API}/api/open?name=${encodeURIComponent(app.name)}`,
  });
  check(`已知应用 200 · ${app.name}`, res.status, 200);
  check(`确实调用了桩 · ${app.name}`, calls.spawn.length, before + 1);
  check(`跑的是该应用的第一个命令（来自 discovery）· ${app.name}`, calls.spawn.at(-1).command, app.commands[0]);
  assert(`cwd 非空（应用目录或主目录）· ${app.name}`, typeof res.body.cwd === "string" && res.body.cwd.length > 0);
}

/* -------------------------------------------------------------------- 4 */

console.log("\n=== 4. 三平台终端调用形态（纯函数，逐平台断言）===");
// Windows 默认改为 PowerShell（用户要求）：pwsh 优先、否则 Windows PowerShell 5.1。
const win = _terminalInvocationFor("win32", "9router", "C:\\work");
check("win32 解释器", win.cmd, "cmd.exe");
assert("win32 参数含空标题（否则命令会被 start 当成窗口标题）", win.args[2] === "" && win.args[3] !== "");
assert(
  "win32 默认用 PowerShell",
  /^(pwsh|powershell)\.exe$/.test(String(win.args[3])),
  `实际 ${JSON.stringify(win.args[3])}`
);
assert("PowerShell 用 -NoExit 保持窗口", win.args.includes("-NoExit"));
assert("PowerShell 用 -Command 传命令", win.args.includes("-Command"));
check("win32 命令在末位", win.args.at(-1), "9router");

// cmd 仍可选（白名单里的另一个值），形态与旧版一致。
const winCmd = _terminalInvocationFor("win32", "9router", "C:\\work", "cmd");
check("cmd 模式用 cmd.exe", winCmd.args[3], "cmd.exe");
check("cmd 模式 /k 保持窗口", winCmd.args[4], "/k");
check("cmd 模式命令在末位", winCmd.args[5], "9router");

const mac = _terminalInvocationFor("darwin", "9router", "/tmp/x");
check("darwin 走 open", mac.cmd, "open");
assert("darwin 参数含 Terminal", mac.args.includes("Terminal"));
assert("darwin 命令带 cwd", String(mac.args.at(-1)).includes("/tmp/x") && String(mac.args.at(-1)).includes("9router"));
const lin = _terminalInvocationFor("linux", "9router", "/tmp/x");
check("linux 走 x-terminal-emulator", lin.cmd, "x-terminal-emulator");
assert("linux 命令带 cwd", String(lin.args.at(-1)).includes("/tmp/x"));

/* -------------------------------------------------------------------- 4b */

// GUI 感知：有前端界面的程序不该再套一层终端 —— 窗口本身已经是它的界面，
// 多开一个 PowerShell 只会留下一个空壳窗口，且要在 GUI 退出后才回收。
// CLI 则相反：它必须有个终端接住输出，否则一闪而过、错误无从阅读。
console.log("\n=== 4b. GUI 感知分派（CLI 保留终端 / GUI 不建终端）===");

const guiWin = _terminalInvocationFor("win32", "Fiddler", "C:\\work", "powershell", true);
check("GUI·win32 不套 shell，直接 start", guiWin.kind, "direct");
check("GUI·win32 仍是 cmd.exe 转交", guiWin.cmd, "cmd.exe");
assert("GUI·win32 参数含空标题", guiWin.args[2] === "");
check("GUI·win32 命令直接跟在 start 后", guiWin.args.at(-1), "Fiddler");
assert("GUI·win32 不带 -NoExit（不留终端）", !guiWin.args.includes("-NoExit"));
assert("GUI·win32 不出现 cmd.exe /k", !guiWin.args.includes("/k"));

const cliWin = _terminalInvocationFor("win32", "claude", "C:\\work", "powershell", false);
check("CLI·win32 kind 为 terminal", cliWin.kind, "terminal");
assert("CLI·win32 带 -NoExit", cliWin.args.includes("-NoExit"));
check("CLI·win32 命令在末位", cliWin.args.at(-1), "claude");

// hasGui 缺省必须等价于 false（旧调用点不传第 5 参时行为不变）。
check(
  "hasGui 缺省 = false（与显式 false 一致）",
  JSON.stringify(_terminalInvocationFor("win32", "claude", "C:\\work")),
  JSON.stringify(cliWin)
);

const guiMac = _terminalInvocationFor("darwin", "Cursor", "/tmp/x", "powershell", true);
check("GUI·darwin 走 open", guiMac.cmd, "open");
check("GUI·darwin kind 为 direct", guiMac.kind, "direct");
check("GUI·darwin 用 -a 指定应用（不拉起 Terminal）", guiMac.args[0], "-a");
assert("GUI·darwin 参数不含 Terminal", !guiMac.args.includes("Terminal"));

const guiLin = _terminalInvocationFor("linux", "cursor", "/tmp/x", "powershell", true);
check("GUI·linux 直接执行命令", guiLin.cmd, "cursor");
check("GUI·linux kind 为 direct", guiLin.kind, "direct");
check("GUI·linux 不附加终端参数", guiLin.args.length, 0);

/* -------------------------------------------------------------------- 5 */

console.log("\n=== 5. /api/updates 与缓存 ===");
const u1 = await call(`${API}/api/updates`);
check("状态 200", u1.status, 200);
check("collect 调用一次", calls.collect, 1);
assert("返回体含 updates", typeof u1.body.updates === "object");
await call(`${API}/api/updates`);
check("第二次命中缓存（未再采集）", calls.collect, 1);
await call(`${API}/api/updates`, { url: `${API}/api/updates?refresh=1` });
check("?refresh=1 强制重采", calls.collect, 2);

/* -------------------------------------------------------------------- 6 */

console.log("\n=== 6. /api/update 的校验、执行与并发保护 ===");
check("GET 被拒（链接/预取不能装包）", (await call(`${API}/api/update`)).status, 405);
check("未知应用 404", (await call(`${API}/api/update`, { method: "POST", url: `${API}/api/update?name=__nope__` })).status, 404);
if (npmApps.length === 0) {
  skipAsFailure("升级·并发保护", "本机没有 npm 来源的应用 —— 跳过即失败");
} else {
  for (const app of npmApps) {
    const url = `${API}/api/update?name=${encodeURIComponent(app.name)}`;
    // 同时发两个：桩每次 150ms，必然重叠 —— 第二个必须被挡下
    const [a, b] = await Promise.all([
      call(`${API}/api/update`, { method: "POST", url }),
      call(`${API}/api/update`, { method: "POST", url }),
    ]);
    const statuses = [a.status, b.status].sort((x, y) => x - y);
    check(`并发同一应用：一个成功 · ${app.name}`, statuses[0], 200);
    check(`并发同一应用：另一个 409 · ${app.name}`, statuses[1], 409);
    check(`实际只执行了一次 · ${app.name}`, calls.update.filter((n) => n === app.name).length, 1);

    // 串行再跑一次应该又能成功（锁已释放）
    const again = await call(`${API}/api/update`, { method: "POST", url });
    check(`释放后可再次执行 · ${app.name}`, again.status, 200);
  }
}

/* -------------------------------------------------------------------- 6b */

console.log("\n=== 6b. 版本补齐（PATH 应用无包元数据 → 逐个探测）===");
const v1 = await call(`${API}/api/versions`);
check("状态 200", v1.status, 200);
assert(
  "返回体含 resolved 与 unresolved",
  typeof v1.body.resolved === "object" && Array.isArray(v1.body.unresolved)
);
assert(
  "确实探测过且有结果",
  calls.versionProbes.length > 0 && Object.keys(v1.body.resolved).length > 0,
  `探测 ${calls.versionProbes.length} 次，resolved ${Object.keys(v1.body.resolved).length} 个`
);
const probesAfterFirst = calls.versionProbes.length;
await call(`${API}/api/versions`);
check("第二次命中缓存（不再探测）", calls.versionProbes.length, probesAfterFirst);
await call(`${API}/api/versions`, { url: `${API}/api/versions?refresh=1` });
assert("?refresh=1 触发重新探测", calls.versionProbes.length > probesAfterFirst);
check("重新探测带上了 refresh 标记", calls.versionProbes.at(-1).refresh, true);

/* -------------------------------------------------------------------- 6c */

console.log("\n=== 6c. 刷新（手动与自动共用同一接口）===");
check("GET 被拒（刷新必须 POST）", (await call(`${API}/api/refresh`)).status, 405);
const resetsBefore = calls.scanResets;
const r1 = await call(`${API}/api/refresh`, { method: "POST", url: `${API}/api/refresh` });
check("POST 200", r1.status, 200);
assert("返回 app 清单与 refreshedAt", Array.isArray(r1.body.apps) && typeof r1.body.refreshedAt === "string");
check("确实重置了扫描缓存（否则读到的是旧数据）", calls.scanResets, resetsBefore + 1);
check("未指定 versions 时不做版本探测（自动刷新要便宜）", r1.body.versions, undefined);

const r2 = await call(`${API}/api/refresh`, { method: "POST", url: `${API}/api/refresh?versions=1` });
assert("versions=1 时返回探测结果", typeof r2.body.versions?.resolved === "object");
assert(
  "探测到的版本已并入 app 清单",
  r2.body.apps.filter((a) => a.version === "9.9.9-stub").length > 0,
  "清单里没有 9.9.9-stub"
);

/* -------------------------------------------------------------------- 6d */

console.log("\n=== 6d. 点击启动：shell 白名单（默认 PowerShell）===");
if (launchables.length === 0) {
  skipAsFailure("shell 白名单", "本机没有带命令的应用 —— 跳过即失败");
} else {
  for (const app of launchables) {
    const url = `${API}/api/open?name=${encodeURIComponent(app.name)}`;
    await call(`${API}/api/open`, { method: "POST", url: `${url}&shell=cmd` });
    check(`shell=cmd 透传到终端 · ${app.name}`, calls.spawn.at(-1).shell, "cmd");
    await call(`${API}/api/open`, { method: "POST", url });
    check(`未指定时默认 powershell · ${app.name}`, calls.spawn.at(-1).shell, "powershell");
    await call(`${API}/api/open`, { method: "POST", url: `${url}&shell=evil%3Brm+-rf` });
    check(`非法值回退默认（白名单，不可能是任意 shell）· ${app.name}`, calls.spawn.at(-1).shell, "powershell");
  }
}

/* -------------------------------------------------------------------- 6e */

console.log("\n=== 6e. 健康：已卸载与残留（只读扫描 + 可逆修复）===");

const health1 = await call(`${API}/api/health`);
check("GET /api/health 200", health1.status, 200);
assert(
  "返回生成时间与两个清单（已卸载 / 残留）",
  typeof health1.body.generatedAt === "string" &&
    Array.isArray(health1.body.uninstalled) &&
    Array.isArray(health1.body.leftovers)
);

const appsAfterHealth = await call(`${API}/api/apps`);
const listedNames = new Set((appsAfterHealth.body.apps || []).map((a) => a.name));
check(
  "已卸载项已从列表清除（不会泄漏进表格）",
  (health1.body.uninstalled || []).filter((u) => listedNames.has(u.name)).length,
  0
);
check("hiddenUninstalled 计数已返回", typeof appsAfterHealth.body.hiddenUninstalled, "number");

const probesBefore = calls.healthProbes.length;
await call(`${API}/api/health`, { url: `${API}/api/health?refresh=1` });
assert("?refresh=1 触发重新探测", calls.healthProbes.length > probesBefore);
const probesAfter = calls.healthProbes.length;
await call(`${API}/api/health`);
check("第二次命中缓存（不再探测）", calls.healthProbes.length, probesAfter);

check("GET 被拒（移动文件必须 POST）", (await call(`${API}/api/leftover/fix`)).status, 405);
check(
  "未知应用 404",
  (
    await call(`${API}/api/leftover/fix`, {
      method: "POST",
      url: `${API}/api/leftover/fix?name=__nope__`,
    })
  ).status,
  404
);

if (launchables.length === 0) {
  skipAsFailure("残留修复", "本机没有带命令的应用 —— 跳过即失败");
} else {
  for (const app of launchables) {
    const target = encodeURIComponent(app.name);
    healthStub.broken.add(app.name);
    healthStub.shims.set(app.commands[0], ["C:/fake/stub-shim", "C:/fake/stub-shim.cmd"]);

    const health2 = await call(`${API}/api/health`, { url: `${API}/api/health?refresh=1` });
    const leftover = (health2.body.leftovers || []).find((l) => l.name === app.name);
    assert(`跑不起来的命令被报为残留 · ${app.name}`, Boolean(leftover));
    check(`残留带上了 shim 文件清单 · ${app.name}`, leftover.files.length, 2);

    // 命令跑不起来，但 PATH 上什么都没有 → 不是残留（是没有 bin 的库 / bin 名不同），不报
    healthStub.shims.set(app.commands[0], []);
    const health3 = await call(`${API}/api/health`, { url: `${API}/api/health?refresh=1` });
    check(
      `无 shim 的坏命令不算残留（库或 bin 名与包名不同）· ${app.name}`,
      (health3.body.leftovers || []).filter((l) => l.name === app.name).length,
      0
    );
    healthStub.shims.set(app.commands[0], ["C:/fake/stub-shim", "C:/fake/stub-shim.cmd"]);

    const resetsBeforeFix = calls.scanResets;
    const fix = await call(`${API}/api/leftover/fix`, {
      method: "POST",
      url: `${API}/api/leftover/fix?name=${target}`,
    });
    check(`POST 200 · ${app.name}`, fix.status, 200);
    check(`ok=true · ${app.name}`, fix.body.ok, true);
    check(`移动了两个 shim · ${app.name}`, fix.body.moved.length, 2);
    check(`磁盘没被真动（改名用的是桩）· ${app.name}`, calls.renames.length >= 2, true);
    assert(`移动方式是改名而非删除 · ${app.name}`, String(fix.body.moved[0].to).endsWith(".MOVED-STUB"));
    assert(`修复后重置了扫描缓存 · ${app.name}`, calls.scanResets > resetsBeforeFix);

    // 复检刚做完就要动手的工具：它已经被重装/修好 → 什么都不许动
    healthStub.broken.delete(app.name);
    const notBroken = await call(`${API}/api/leftover/fix`, {
      method: "POST",
      url: `${API}/api/leftover/fix?name=${target}`,
    });
    check(`复检发现已修好 → 409 · ${app.name}`, notBroken.status, 409);
    check(`错误码 not_broken（拒绝动手）· ${app.name}`, notBroken.body.error, "not_broken");

    // 还是坏的，但没有任何脚本 shim 可移（真正的 .exe 永不作为候选）
    healthStub.broken.add(app.name);
    healthStub.shims.set(app.commands[0], []);
    const noFiles = await call(`${API}/api/leftover/fix`, {
      method: "POST",
      url: `${API}/api/leftover/fix?name=${target}`,
    });
    check(`没有 shim 可移 → 409 · ${app.name}`, noFiles.status, 409);
    check(`错误码 no_files · ${app.name}`, noFiles.body.error, "no_files");

    healthStub.broken.delete(app.name);
  }
}

/* -------------------------------------------------------------------- 7 */

console.log("\n=== 7. _resetScanCache() 幂等（dispose 可能调用两次）===");
let threw = null;
try {
  _resetScanCache();
  _resetScanCache();
} catch (error) {
  threw = String(error && error.message);
}
check("连续调用两次不抛错", threw, null);

/* -------------------------------------------------------------------- 8 */

console.log("\n=== 8. 卸载后新路由立即失效 ===");
const stale = {};
for (const p of ["/app-manager/api/open", "/app-manager/api/updates", "/app-manager/api/update"]) {
  stale[p] = routes.get("exact " + p).handler;
}
ctx.__dispose();
check("路由表已清空", routes.size, 0);
for (const [p, handler] of Object.entries(stale)) {
  const res = { status: 0, headers: {}, raw: "" };
  await handler({ method: "POST", url: p + "?name=x", headers: {} }, {
    writeHead: (s, h) => {
      res.status = s;
      res.headers = h || {};
    },
    end: (d) => {
      res.raw = String(d ?? "");
    },
  });
  check(`${p} 旧 handler 返回 404`, res.status, 404);
  check(`${p} 仍带 no-store`, res.headers["cache-control"], "no-store");
}
teardown();
check("重复卸载不抛错", "ok", "ok");

/* -------------------------------------------------------------------- 9 */

console.log("\n=== 9. 收尾：关闭测试期间打开的应用 ===");
// 只有"本次运行接触过的应用"才算测试遗留：拿全体进程做差集会把用户自己开的程序也算进去。
const touchedCommands = [...launchables, ...npmApps].flatMap((a) => a.commands || []);
const leaked = discoverLeaks(procBefore, await snapshot(), touchedCommands);
for (const l of leaked) console.log(`  · 发现遗留进程：${l.image} (PID ${l.pid})`);

const closed = await closeAll(leaked);
for (const l of closed.leaked) {
  console.log(`  · 已关闭 ${l.image} (PID ${l.pid})：${l.closed ? "成功" : "失败"}`);
}
check("启动动作全部走桩（没有需要登记关闭的进程）", openedCount(), 0);
check(
  "测试期间打开的应用全部关闭成功",
  closed.leaked.filter((l) => !l.closed).length,
  0
);
check(
  "收尾后无遗留应用进程",
  discoverLeaks(procBefore, await snapshot(), touchedCommands).length,
  0
);

/* -------------------------------------------------------------------- */

console.log(`\n=== 结果：${checks - failures}/${checks} 通过${failures ? `，${failures} 项失败 ✗` : " ✓"} ===`);

/* --------------------------------------------------------------- 报告落盘 */

const pad = (n) => String(n).padStart(2, "0");
const stamp = `${STARTED_AT.getFullYear()}-${pad(STARTED_AT.getMonth() + 1)}-${pad(STARTED_AT.getDate())}_${pad(STARTED_AT.getHours())}${pad(STARTED_AT.getMinutes())}${pad(STARTED_AT.getSeconds())}`;
let md = "";
md += `# 动作组报告 actions-${stamp}\n\n`;
md += `> 由 tests/actions.test.mjs 自动生成（页面动作 / 健康残留 / 收尾关闭）\n\n`;
md += `- 结果: **${checks - failures}/${checks} 通过${failures ? ` · ${failures} 项失败` : ""}**\n`;
md += `- 开始: ${STARTED_AT.toLocaleString("zh-CN")} · 运行时: Node ${process.version} @ ${process.platform}\n\n`;
md += `## 本次测试用到的应用\n\n`;
md += `每次运行随机抽 4~6 个。样本写在这里，是为了让「通过」这句话可复现 ——\n`;
md += `换一批样本可能就红，而报告里没有样本就等于无法定位。\n\n`;
md += `| 用途 | 应用 | 来源 | 首命令 | 安装路径 |\n|---|---|---|---|---|\n`;
if (sampleRows.length === 0) {
  md += `| — | — | — | — | 本轮未抽到应用 |\n`;
}
for (const [role, a] of sampleRows) {
  md += `| ${role} | \`${a.name}\` | ${a.source ?? "?"} | \`${a.commands?.[0] ?? "—"}\` | \`${a.path ?? "—"}\` |\n`;
}
md += `\n禁用名单（永远不会成为测试对象，命中即剔除）：\n\n`;
md += excludedPatterns().map((p) => `- \`${p}\``).join("\n") + `\n\n`;
md += `## 收尾\n\n`;
md += `- 测试期间登记打开的进程数: ${openedCount()}（应为 0 —— 三个动作全部走桩）\n`;
md += `- 遗留进程: ${leaked.length} · 已关闭: ${closed.leaked.filter((l) => l.closed).length} · 关闭失败: ${closed.leaked.filter((l) => !l.closed).length}\n`;
md += `- 复检后仍残留: ${discoverLeaks(procBefore, await snapshot(), touchedCommands).length}\n`;

mkdirSync(REPORTS_DIR, { recursive: true });
const reportPath = path.join(REPORTS_DIR, `actions-${stamp}.md`);
writeFileSync(reportPath, md, "utf8");
console.log(`动作组报告: ${reportPath}`);

process.exit(failures === 0 ? 0 : 1);
