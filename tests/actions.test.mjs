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

import { apply, _setActionHooks, _terminalInvocationFor } from "../lib/src/index.js";
import { _resetScanCache } from "../lib/src/discovery.js";

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
const calls = { spawn: [], update: [], collect: 0 };

_setActionHooks({
  spawnTerminal: (command, cwd) => {
    calls.spawn.push({ command, cwd });
    return { ok: true, detail: SENTINEL_TERMINAL };
  },
  runUpdate: async (app) => {
    calls.update.push(app.name);
    // 故意慢一点：并发保护只有在真正重叠时才看得出来
    await new Promise((r) => setTimeout(r, 150));
    return { ok: true, command: `STUB install -g ${app.name}@latest`, detail: "stubbed" };
  },
  collectUpdates: async () => {
    calls.collect += 1;
    return {
      checkedAt: new Date().toISOString(),
      updates: { "stub-pkg": { current: "1.0.0", latest: "2.0.0", command: "STUB install -g stub-pkg@latest" } },
      skipped: 0,
    };
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
const launchable = apps.find((a) => a.commands && a.commands.length > 0);
const npmApp = apps.find((a) => a.source === "npm");

/* -------------------------------------------------------------------- 2 */

console.log("\n=== 2. 桩是否真的生效（不生效就中止，否则会真开窗口/真装包）===");
if (!launchable) {
  skipAsFailure("终端桩有效性", "本机没有带命令的应用，无法验证 —— 跳过即失败");
} else {
  const probe = await call(`${API}/api/open`, {
    method: "POST",
    url: `${API}/api/open?name=${encodeURIComponent(launchable.name)}`,
  });
  if (probe.body.detail !== SENTINEL_TERMINAL) {
    abort(`终端桩未生效（detail=${JSON.stringify(probe.body.detail)}）—— 拒绝继续，可能真的开了终端`);
  }
  check("终端桩生效（返回哨兵）", probe.body.detail, SENTINEL_TERMINAL);
}

/* -------------------------------------------------------------------- 3 */

console.log("\n=== 3. /api/open 的校验与取数 ===");
check("GET 被拒（链接/预取不能开终端）", (await call(`${API}/api/open`)).status, 405);
check("未知应用 404", (await call(`${API}/api/open`, { method: "POST", url: `${API}/api/open?name=__nope__` })).status, 404);
check("缺 name 参数 404", (await call(`${API}/api/open`, { method: "POST" })).status, 404);
if (launchable) {
  const before = calls.spawn.length;
  const res = await call(`${API}/api/open`, {
    method: "POST",
    url: `${API}/api/open?name=${encodeURIComponent(launchable.name)}`,
  });
  check("已知应用 200", res.status, 200);
  check("确实调用了桩", calls.spawn.length, before + 1);
  check("跑的是该应用的第一个命令（来自 discovery）", calls.spawn.at(-1).command, launchable.commands[0]);
  assert("cwd 非空（应用目录或主目录）", typeof res.body.cwd === "string" && res.body.cwd.length > 0);
}

/* -------------------------------------------------------------------- 4 */

console.log("\n=== 4. 三平台终端调用形态（纯函数，逐平台断言）===");
const win = _terminalInvocationFor("win32", "9router", "C:\\work");
check("win32 解释器", win.cmd, "cmd.exe");
assert("win32 参数含空标题（否则命令会被 start 当成窗口标题）", win.args[2] === "" && win.args[3] === "cmd.exe");
check("win32 /k 保持窗口", win.args[4], "/k");
check("win32 命令在末位", win.args[5], "9router");
const mac = _terminalInvocationFor("darwin", "9router", "/tmp/x");
check("darwin 走 open", mac.cmd, "open");
assert("darwin 参数含 Terminal", mac.args.includes("Terminal"));
assert("darwin 命令带 cwd", String(mac.args.at(-1)).includes("/tmp/x") && String(mac.args.at(-1)).includes("9router"));
const lin = _terminalInvocationFor("linux", "9router", "/tmp/x");
check("linux 走 x-terminal-emulator", lin.cmd, "x-terminal-emulator");
assert("linux 命令带 cwd", String(lin.args.at(-1)).includes("/tmp/x"));

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
if (npmApp) {
  const url = `${API}/api/update?name=${encodeURIComponent(npmApp.name)}`;
  // 同时发两个：桩每次 150ms，必然重叠 —— 第二个必须被挡下
  const [a, b] = await Promise.all([
    call(`${API}/api/update`, { method: "POST", url }),
    call(`${API}/api/update`, { method: "POST", url }),
  ]);
  const statuses = [a.status, b.status].sort((x, y) => x - y);
  check("并发同一应用：一个成功", statuses[0], 200);
  check("并发同一应用：另一个 409", statuses[1], 409);
  check("实际只执行了一次", calls.update.filter((n) => n === npmApp.name).length, 1);

  // 串行再跑一次应该又能成功（锁已释放）
  const again = await call(`${API}/api/update`, { method: "POST", url });
  check("释放后可再次执行", again.status, 200);
} else {
  skipAsFailure("升级·并发保护", "本机没有 npm 来源的应用 —— 跳过即失败");
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

/* -------------------------------------------------------------------- */

console.log(`\n=== 结果：${checks - failures}/${checks} 通过${failures ? `，${failures} 项失败 ✗` : " ✓"} ===`);
process.exit(failures === 0 ? 0 : 1);
