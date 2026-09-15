#!/usr/bin/env node
/**
 * dsh-app-manager — 性能守卫测试
 *
 * 为什么需要：`/app-manager` 曾经冷启动要 ~40 秒，根因是渲染循环里对每个
 * 命令调用 `commandExists()`（每次都 spawn 一个 `where`/`which` 子进程，
 * 66 次约 35 秒）。这类性能退化**不会**让任何功能断言失败——页面照样渲染
 * 正确，只是慢——所以必须有专门的耗时守卫。
 *
 * 本测试断言：
 *   1. 批量命令检查走缓存索引（pathIndexHas），不得用 commandExists
 *   2. discoverAll 冷扫描在合理上限内完成
 *   3. discoverAll 二次调用命中缓存（接近 0ms）
 *   4. 渲染页面不触发逐命令子进程
 *
 * 运行：node tests/perf-guard.test.mjs
 */

import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const TESTS_DIR = path.dirname(fileURLToPath(import.meta.url));
const PLUGIN_DIR = path.resolve(TESTS_DIR, "..");

/**
 * 本进程的解释器 —— **原样**交给 `execAsync`，不加引号。
 *
 * 这正是回归点：先前 `execAsync` 把 command/argv 直接丢给 shell（Windows 上
 * `shell: true`），而 Node 不为 cmd.exe 转义 argv，于是当 Node 装在
 * `C:\Program Files\nodejs\`（路径含空格）时，命令被空格拆开，子进程以
 * `'D:\Program' 不是内部或外部命令` 秒退 —— 下面两条用例会「假失败」：
 * 子进程压根没起来，超时也就无从验证。
 *
 * 现在 `execAsync` 自己加引号（`quoteForShell` / `shellCommand`），所以这里
 * 故意传原始路径：一旦有人把引用逻辑改回去，本组会立刻失败。
 * 实测：修复前系统 Node 下 10/12、托管 Node 下 12/12；修复后两种都 12/12。
 */
const NODE_BIN = process.execPath;

/** 宿主路径是否含空格 —— 决定下面哪条断言真正起作用。 */
const HOST_PATH_HAS_SPACE = /\s/.test(process.execPath);

const results = [];
async function check(label, fn) {
  try {
    const detail = await fn();
    results.push({ label, ok: true });
    console.log(`PASS  ${label}${detail ? "  --  " + detail : ""}`);
  } catch (e) {
    results.push({ label, ok: false, err: e.message });
    console.log(`FAIL  ${label}`);
    console.log(`      ↳ ${e.message}`);
  }
}
function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

// Budgets are deliberately generous: they must not flake on a slow CI box,
// but they do catch an order-of-magnitude regression like the 35s one.
const COLD_SCAN_BUDGET_MS = 20_000;
const WARM_SCAN_BUDGET_MS = 50;
const BULK_CHECK_BUDGET_MS = 500;

const utils = await import(
  pathToFileURL(path.join(PLUGIN_DIR, "lib/src/utils.js")).href
);
const discovery = await import(
  pathToFileURL(path.join(PLUGIN_DIR, "lib/src/discovery.js")).href
);

console.log("");
console.log("━━━ 批量命令检查 ━━━");

await check("pathIndexHas 批量检查 66 个命令 < 500ms", () => {
  discovery.discoverAll(); // ensure apps + PATH index are ready
  const apps = discovery.discoverAll();
  const cmds = apps.flatMap((a) => a.commands);
  assert(cmds.length > 0, "no commands to check");
  const t0 = Date.now();
  for (const c of cmds) utils.pathIndexHas(c);
  const ms = Date.now() - t0;
  assert(
    ms < BULK_CHECK_BUDGET_MS,
    `${cmds.length} checks took ${ms}ms (budget ${BULK_CHECK_BUDGET_MS}ms) — ` +
      `is something still calling commandExists() per command?`
  );
  return `${cmds.length} checks in ${ms}ms`;
});

await check("pathIndexHas 与 commandExists 结论一致（抽样）", () => {
  const apps = discovery.discoverAll();
  const cmds = apps.flatMap((a) => a.commands).slice(0, 12);
  const diffs = [];
  for (const c of cmds) {
    const slow = utils.commandExists(c);
    const fast = utils.pathIndexHas(c);
    // PATH shims and real executables can legitimately disagree on edge
    // cases; we only flag it when the cached index *misses* something the
    // authoritative check finds, which would hide a tool.
    if (slow && !fast) diffs.push(c);
  }
  assert(
    diffs.length === 0,
    `pathIndexHas missed commands that commandExists found: ${diffs.join(", ")}`
  );
  return `${cmds.length} sampled, 0 misses`;
});

console.log("");
console.log("━━━ 扫描耗时 ━━━");

await check(`discoverAll 冷扫描 < ${COLD_SCAN_BUDGET_MS}ms`, () => {
  utils.resetPathIndex?.();
  // Bust the discovery cache so this is a genuine cold scan.
  discovery._resetScanCache?.();
  const t0 = Date.now();
  const apps = discovery.discoverAll();
  const ms = Date.now() - t0;
  assert(apps.length > 0, "scan returned no apps");
  assert(
    ms < COLD_SCAN_BUDGET_MS,
    `cold scan took ${ms}ms (budget ${COLD_SCAN_BUDGET_MS}ms)`
  );
  return `${ms}ms for ${apps.length} apps`;
});

await check(`discoverAll 二次调用命中缓存 < ${WARM_SCAN_BUDGET_MS}ms`, () => {
  discovery.discoverAll();
  const t0 = Date.now();
  const apps = discovery.discoverAll();
  const ms = Date.now() - t0;
  assert(
    ms < WARM_SCAN_BUDGET_MS,
    `warm scan took ${ms}ms (budget ${WARM_SCAN_BUDGET_MS}ms) — cache not effective`
  );
  return `${ms}ms for ${apps.length} apps`;
});

console.log("");
console.log("━━━ 页面渲染 ━━━");

await check("生成 /app-manager 页面 < 300ms（缓存已热）", async () => {
  const routes = [];
  const plugin = await import(
    pathToFileURL(path.join(PLUGIN_DIR, "lib/src/index.js")).href
  );
  plugin.apply({
    logger: { info: () => {} },
    inject(_d, cb) {
      cb({
        tools: { register: () => () => {} },
        webServer: { register: (r) => (routes.push(r), () => {}) },
      });
      return () => {};
    },
  });
  const page = routes.find((r) => r.path === "/app-manager");
  assert(page, "/app-manager route not registered");

  // Simulate the real server: the background warm-up (or a prior request)
  // has already populated the caches. Without this the very first render
  // legitimately pays the cold-scan cost — that is what the cold-scan
  // assertion above covers, not this one.
  discovery.discoverAll();

  const render = async () => {
    let html = "";
    await page.handler(
      { url: "/app-manager", method: "GET", headers: {} },
      { writeHead: () => {}, end: (d) => { html = String(d ?? ""); } }
    );
    return html;
  };

  // Discard one render so module/route initialisation is not measured.
  await render();

  const t0 = Date.now();
  const html = await render();
  const ms = Date.now() - t0;
  assert(html.length > 10000, `page too small (${html.length} bytes)`);
  assert(
    ms < 300,
    `warm page render took ${ms}ms (budget 300ms) — ` +
      `is a source probe no longer memoised, or is the ARP baseline re-read per render?`
  );
  return `${ms}ms, ${html.length} bytes`;
});

console.log("");
console.log("━━━ 源探测缓存 ━━━");

await check("二次调用各 discoverXxx 命中缓存 < 50ms", () => {
  // Regression guard for the 14.5s page render: every discoverXxx() shells out
  // to a package manager, and those calls were NOT covered by the allCache TTL
  // because buildScanReport()/doctor call the discoverers directly.
  discovery._resetScanCache?.();
  const fns = [
    ["npm", discovery.discoverNpmGlobal],
    ["pnpm", discovery.discoverPnpmGlobal],
    ["npx-cache", discovery.discoverNpxCache],
    ["scoop", discovery.discoverScoop],
    ["choco", discovery.discoverChoco],
    ["cargo", discovery.discoverCargo],
    ["pipx", discovery.discoverPipx],
    ["pip", discovery.discoverPipGlobal],
    ["uv", discovery.discoverUvTools],
    ["path", discovery.discoverFromPath],
  ];
  // Cold pass through discoverAll() to fill the per-source memo.
  discovery.discoverAll();

  const slow = [];
  for (const [name, fn] of fns) {
    const t0 = Date.now();
    fn();
    const ms = Date.now() - t0;
    if (ms >= 50) slow.push(`${name}=${ms}ms`);
  }
  assert(
    slow.length === 0,
    `these sources re-ran their subprocess instead of hitting the cache: ${slow.join(", ")}`
  );
  return `${fns.length} sources all cached`;
});

await check("buildScanReport 二次调用 < 300ms（源探测已缓存）", () => {
  const baseline = discovery.readManagedBaseline();
  discovery.buildScanReport({ baseline }); // warm
  const t0 = Date.now();
  discovery.buildScanReport({ baseline });
  const ms = Date.now() - t0;
  assert(
    ms < 300,
    `buildScanReport took ${ms}ms on a warm cache — a source probe is not memoised`
  );
  return `${ms}ms`;
});

console.log("");
console.log("━━━ 命令名卫生（doctor 误报回归） ━━━");

await check("commands 不含启动器扩展名", () => {
  // Regression guard: `@anthropic-ai/claude-code` declared bin keys of both
  // `claude` and `claude.exe`; `@openai/codex` had `codex.js`; npm's bin/ dir
  // contained `npm-cli.js`. Those names never resolve on PATH (the PATH index
  // stores extensionless names), so doctor reported ~34 false "not found".
  const apps = discovery.discoverAll();
  const bad = [];
  for (const a of apps) {
    for (const c of a.commands) {
      if (/\.(exe|cmd|bat|com|ps1|js|mjs|cjs)$/i.test(c)) bad.push(`${a.name}:${c}`);
    }
  }
  assert(bad.length === 0, `commands still carry launcher extensions: ${bad.join(", ")}`);
  return `${apps.reduce((n, a) => n + a.commands.length, 0)} commands, none with extensions`;
});

await check("commands 不含内部入口点（node-gyp-bin / npm-cli 等）", () => {
  const apps = discovery.discoverAll();
  const noisy = apps
    .flatMap((a) => a.commands)
    .filter((c) => /^(node-gyp-bin|npm-cli|npm-prefix|npx-cli)$/i.test(c));
  assert(
    noisy.length === 0,
    `internal entry points leaked into commands: ${[...new Set(noisy)].join(", ")}`
  );
  return "no internal entry points";
});

await check("发现的命令绝大多数在 PATH 上可解析", () => {
  const apps = discovery.discoverAll();
  const cmds = apps.flatMap((a) => a.commands);
  const missing = cmds.filter((c) => !utils.pathIndexHas(c));
  // npx-cache entries legitimately are not globally installed; tolerate a
  // handful, but a large number means command extraction regressed.
  const ratio = missing.length / Math.max(1, cmds.length);
  assert(
    ratio < 0.2,
    `${missing.length}/${cmds.length} commands missing from PATH ` +
      `(${missing.slice(0, 10).join(", ")}) — command extraction regressed`
  );
  return `${cmds.length - missing.length}/${cmds.length} resolvable`;
});

console.log("");
console.log("━━━ 子进程健壮性 ━━━");

await check("execAsync 遵守 timeout，不无限等待", async () => {
  // Regression guard: `child_process.spawn` IGNORES a `timeout` option (only
  // exec/execFile honour it), so forwarding it used to leave callers waiting
  // forever. That became a real hang — `doctor` probes `<cmd> --version` for
  // every app, and a PATH shim that blocks (RefreshEnv shells out to
  // reg.exe/WMIC) made the whole health check never return.
  //
  // The child must genuinely hang. Two details matter:
  //   - the script must contain NO SPACES. `execAsync` uses `shell: true` on
  //     Windows and Node does not quote argv for cmd.exe, so an argument with a
  //     space is split and the child dies with a syntax error instead of
  //     hanging — the timeout would then never be exercised;
  //   - assert the elapsed time is AT LEAST the timeout, so an early exit
  //     cannot masquerade as a passing timeout.
  const TIMEOUT_MS = 1500;
  const t0 = Date.now();
  const res = await utils.execAsync(
    NODE_BIN,
    ["-e", "setTimeout(function(){},60000)"],
    { timeout: TIMEOUT_MS }
  );
  const ms = Date.now() - t0;

  assert(
    ms >= TIMEOUT_MS - 100,
    `child returned in ${ms}ms, before the ${TIMEOUT_MS}ms timeout — it exited early ` +
      `(likely argv was split on a space), so the timeout path was not exercised: ${res.error.slice(0, 120)}`
  );
  assert(
    ms < 8000,
    `a hanging child took ${ms}ms despite a ${TIMEOUT_MS}ms timeout — the promise never settled`
  );
  assert(res.success === false, "a timed-out child must not report success");
  assert(
    /timed out after/i.test(res.error),
    `expected a timeout note in the error, got: ${JSON.stringify(res.error.slice(0, 120))}`
  );
  return `settled in ${ms}ms with "${res.error}"`;
});

await check("execAsync 正常命令仍返回 stdout", async () => {
  const res = await utils.execAsync(
    NODE_BIN,
    ["-e", "process.stdout.write('ok-marker')"],
    { timeout: 15000 }
  );
  assert(res.success, `expected success, got error="${res.error}"`);
  assert(
    res.output.includes("ok-marker"),
    `stdout not captured: ${JSON.stringify(res.output)}`
  );
  return "stdout captured";
});

// ---------------------------------------------------------------------------
// 含空格 argv 的引用回归（0.5.3 后补）
//
// 这三条锁住 `execAsync` 的引用行为。先前它把 command/argv 原样交给 shell，
// Node 又不为 cmd.exe 转义，于是「路径含空格」与「参数含空格」都会被拆开。
// ---------------------------------------------------------------------------

await check("execAsync 引用含空格的命令路径", async () => {
  if (!HOST_PATH_HAS_SPACE) {
    // 无空格宿主：这条分支在这台机器上跑不到，但纯函数用例仍覆盖引用逻辑，
    // 且 CI 的 Windows 作业通常装在 Program Files —— 那里会真正走到。
    return "host execPath has no space; quoting logic covered by the pure-function case below";
  }
  const res = await utils.execAsync(
    NODE_BIN,
    ["-e", "process.stdout.write('spaced-path-ok')"],
    { timeout: 15000 }
  );
  assert(res.success, `spaced command path failed: ${res.error}`);
  assert(
    res.output.includes("spaced-path-ok"),
    `stdout missing: ${JSON.stringify(res.output)}`
  );
  return "spaced path ran as a single token";
});

await check("execAsync 引用含空格的参数", async () => {
  // 这条在任何机器上都成立：脚本参数里带空格，必须原样传给子进程。
  const res = await utils.execAsync(
    process.execPath,
    ["-e", "process.stdout.write('arg with spaces')"],
    { timeout: 15000 }
  );
  assert(res.success, `expected success, got error="${res.error}"`);
  assert(
    res.output.includes("arg with spaces"),
    `spaced argument was split or lost: ${JSON.stringify(res.output)}`
  );
  return "spaced argument preserved";
});

await check("引用函数：该加才加、已加不动", async () => {
  const q = utils._shellQuoteFor;
  assert(typeof q === "function", "_shellQuoteFor 未导出");
  assert(
    q("win32", "C:\\Program Files\\nodejs\\node.exe") === '"C:\\Program Files\\nodejs\\node.exe"',
    "win32 下的含空格路径应加双引号"
  );
  assert(
    q("linux", "/opt/my app/node") === "'/opt/my app/node'",
    "POSIX 下的含空格路径应加单引号"
  );
  assert(q("win32", "npm.cmd") === "npm.cmd", "无空格 token 不应被改动");
  assert(
    q("win32", '"C:\\already quoted\\x.exe"') === '"C:\\already quoted\\x.exe"',
    "已加引号的 token 不应被二次包裹"
  );
  return "4 条引用规则均符合预期";
});

// The page-render check is async; the sequential `await check(...)` calls
// above already awaited it. Nothing further to do here.
console.log("");console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
const pass = results.filter((r) => r.ok).length;
const fail = results.length - pass;
console.log(`结果: PASS ${pass} · FAIL ${fail} / 共 ${results.length}`);
process.exit(fail === 0 ? 0 : 1);
