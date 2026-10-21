#!/usr/bin/env node
/**
 * dsh-app-manager — 升级徽章的刷新同步测试
 *
 * 为什么需要这一组：
 *   `/api/updates` 一直是对的（后端能查出 9router 0.5.99 → 0.5.104），
 *   但页面上的徽章有三处会「看起来没侦测到」：
 *
 *   1. 徽章插进 `td.version`，而 `td` 是 `overflow:hidden` + 固定列宽 ——
 *      DOM 里有、屏幕上看不见（旧断言只查 DOM，所以全绿）。
 *   2. 点「刷新」时服务端真的跑了注册表扫描（十几秒），但 `applyPayload`
 *      只用了 `apps`，把 `updates` 丢掉了 —— 徽章永远停在首屏那一次。
 *   3. 旧的 `decorate` 只增不减：`cell.querySelector('.upd')` 存在就跳过，
 *      所以已升级应用的旧徽章会一直挂着。
 *
 *   本组用真实页面 + jsdom 驱动，断言的是「屏幕上那块 DOM 到底变成什么样」。
 *
 * 运行：node tests/updates-sync.test.mjs
 * 缺 jsdom 以退出码 3 失败（与 drag-behavior 一致：跳过 ≠ 通过）。
 */

import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";

const TESTS_DIR = path.dirname(fileURLToPath(import.meta.url));
const PLUGIN_DIR = path.resolve(TESTS_DIR, "..");

function resolveJsdom() {
  const attempt = (req, label) => {
    try {
      return { mod: req("jsdom"), from: label };
    } catch {
      return null;
    }
  };
  const primary = attempt(createRequire(import.meta.url), "node_modules");
  if (primary) return primary;
  const dir = process.env.DSH_TEST_JSDOM_DIR;
  if (dir) {
    const fallback = attempt(
      createRequire(pathToFileURL(path.join(dir, "package.json")).href),
      dir
    );
    if (fallback) return fallback;
  }
  return null;
}

const JSDOM_SOURCE = resolveJsdom();
if (!JSDOM_SOURCE) {
  console.error("FAIL: jsdom not installed; update-sync tests cannot run.");
  console.error("      install with: pnpm add -D jsdom");
  console.error("      未验证 ≠ 通过（退出码 3）。");
  process.exit(3);
}

const { JSDOM, VirtualConsole } = JSDOM_SOURCE.mod;

// ---------- tiny assertion harness ----------
const results = [];
async function check(label, fn) {
  try {
    await fn();
    results.push({ label, ok: true });
    console.log(`PASS  ${label}`);
  } catch (e) {
    results.push({ label, ok: false, err: e.message });
    console.log(`FAIL  ${label}`);
    console.log(`      ↳ ${e.message}`);
  }
}
function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}
const settle = (ms = 120) => new Promise((r) => setTimeout(r, ms));

// ---------- build the real page ----------
const routes = [];
const plugin = await import(pathToFileURL(path.join(PLUGIN_DIR, "lib/src/index.js")).href);
plugin.apply({
  logger: { info: () => {} },
  inject(_deps, cb) {
    cb({
      tools: { register: () => () => {} },
      webServer: { register: (r) => (routes.push(r), () => {}) },
    });
    return () => {};
  },
});

const pageRoute = routes.find((r) => r.path === "/app-manager");
assert(pageRoute, "/app-manager route not registered");

let html = "";
await pageRoute.handler(
  { url: "/app-manager", method: "GET", headers: {} },
  { writeHead: () => {}, end: (d) => { html = String(d ?? ""); } }
);
assert(html.length > 10000, `page HTML too small (${html.length} bytes)`);

// ---------- canned registry answers ----------
const state = {
  updates: { checkedAt: new Date().toISOString(), skipped: 0, updates: {} },
  refresh: null,
  failUpdates: false,
  calls: [],
};

const virtualConsole = new VirtualConsole();
virtualConsole.on("jsdomError", (e) => {
  if (!/Could not parse CSS/i.test(e.message)) console.log("  [jsdom error]", e.message);
});

const dom = new JSDOM(html, {
  runScripts: "dangerously",
  pretendToBeVisual: true,
  virtualConsole,
  url: "http://localhost/app-manager",
  beforeParse(win) {
    win.fetch = async (url, opts = {}) => {
      const u = new URL(String(url), "http://localhost");
      state.calls.push({ path: u.pathname + u.search, method: (opts.method || "GET").toUpperCase() });
      const json = (body, status = 200) => ({
        ok: status < 400,
        status,
        json: async () => body,
        text: async () => JSON.stringify(body),
      });

      if (u.pathname.endsWith("/updates")) {
        if (state.failUpdates) throw new Error("registry unreachable");
        return json(state.updates);
      }
      if (u.pathname.endsWith("/refresh")) {
        return json(state.refresh || { apps: [] });
      }
      if (u.pathname.endsWith("/versions")) return json({ resolved: {}, probed: 0, skipped: 0 });
      if (u.pathname.endsWith("/health")) return json({ uninstalled: [], leftovers: [] });
      return json({});
    };
    win.confirm = () => true;
    win.alert = () => {};
  },
});

const { window } = dom;
const { document } = window;
const $ = (sel) => document.querySelector(sel);
const rowOf = (name) => document.querySelector(`tr[data-app="${name}"]`);
const badgeOf = (name) => {
  const tr = rowOf(name);
  return tr ? tr.querySelector("td.version .upd") : null;
};
const verTextOf = (name) => {
  const tr = rowOf(name);
  const span = tr && tr.querySelector("td.version .ver-text");
  return span ? span.textContent.trim() : null;
};

const ROW_NAMES = Array.from(document.querySelectorAll("tr[data-app]")).map((tr) =>
  tr.getAttribute("data-app")
);
assert(ROW_NAMES.length > 10, `页面行数异常：${ROW_NAMES.length}`);
assert(ROW_NAMES.includes("9router"), "样本里没有 9router，无法覆盖用户报告的场景");

/** 构造一份与页面行集合一致的 /refresh 响应，避免 applyPayload 走整页重载。 */
function refreshPayload({ updates, versions = {} }) {
  return {
    total: ROW_NAMES.length,
    managedCount: 0,
    unmanagedCount: ROW_NAMES.length,
    hiddenUninstalled: 0,
    apps: ROW_NAMES.map((n) => ({
      name: n,
      version: versions[n] ?? "0.0.0",
      commands: [n],
      source: "npm",
      managed: false,
      inPath: true,
    })),
    ...(updates ? { updates: { checkedAt: new Date().toISOString(), updates } } : {}),
  };
}

// 首屏：后端已经能查出 9router 有更新
state.updates = {
  checkedAt: new Date().toISOString(),
  skipped: 0,
  updates: {
    "9router": { current: "0.5.99", latest: "0.5.104", command: "npm.cmd install -g 9router@latest" },
  },
};
await window.__appActions.refreshUpdates();
await settle(50);

await check("首屏就能挂上升级徽章（DOM 里存在）", () => {
  const b = badgeOf("9router");
  assert(b, "9router 行没有 .upd 徽章");
  assert(/0\.5\.104/.test(b.textContent), `徽章文案不对：${b.textContent}`);
});

await check("徽章挂在 .vwrap 里，不与版本号共用 ellipsis（不被列宽裁掉）", () => {
  const tr = rowOf("9router");
  const wrap = tr.querySelector("td.version .vwrap");
  assert(wrap, "缺少 .vwrap 容器 —— 徽章会重新落回被 overflow:hidden 裁切的位置");
  assert(wrap.contains(badgeOf("9router")), "徽章不在 .vwrap 内");
  const span = wrap.querySelector(".ver-text");
  assert(span, "版本号缺少 .ver-text 包裹");
  assert(span.textContent.trim() === "0.5.99", `版本号文本异常：${span.textContent}`);
});

await check("状态条能报出「可升级 N 个」", () => {
  const status = document.getElementById("refresh-status");
  assert(status, "缺少 #refresh-status");
  assert(/可升级\s*1\s*个/.test(status.textContent), `状态文本：${status.textContent}`);
});

// 手动刷新：服务端返回更新后的注册表结果
state.refresh = refreshPayload({
  updates: {
    "9router": { current: "0.5.99", latest: "0.5.110", command: "npm.cmd install -g 9router@latest" },
  },
  versions: { "9router": "0.5.99" },
});
document.getElementById("refresh-btn").click();
await settle(150);

await check("点刷新会强制重查注册表（updates=force）", () => {
  const last = state.calls.filter((c) => c.path.includes("/refresh")).pop();
  assert(last, "没有发出 /refresh 请求");
  assert(last.path.includes("updates=force"), `刷新请求没带 updates=force：${last.path}`);
});

await check("刷新把徽章更新到最新（0.5.104 → 0.5.110）", () => {
  const b = badgeOf("9router");
  assert(b, "刷新后徽章消失了");
  assert(/0\.5\.110/.test(b.textContent), `徽章仍是旧值：${b.textContent}`);
});

// 刷新后该应用已是最新：徽章必须消失（旧实现只增不减）
state.refresh = refreshPayload({
  updates: {},
  versions: { "9router": "0.5.110" },
});
window.__appActions.refresh({ versions: true, quiet: true, updates: "force" });
await settle(150);

await check("已是最新的应用，旧徽章会被移除（不是永久残留）", () => {
  assert(!badgeOf("9router"), "9router 已升到最新，徽章却还在");
  assert(verTextOf("9router") === "0.5.110", `版本号没同步：${verTextOf("9router")}`);
});

await check("版本号更新不会重复拼接（.ver-text 只有一个）", () => {
  const tr = rowOf("9router");
  const spans = tr.querySelectorAll("td.version .ver-text");
  assert(spans.length === 1, `.ver-text 数量 = ${spans.length}`);
  assert(!/0\.5\.110\s+0\.5\.110/.test(tr.querySelector("td.version").textContent), "版本号被重复写入");
});

// 自动刷新走缓存语义，别每 60 秒把注册表扫一遍
state.refresh = refreshPayload({ updates: {} });
window.__appActions.refresh({ versions: true, quiet: true, updates: true });
await settle(150);

await check("自动刷新用 updates=1（复用服务端缓存），不带 force", () => {
  const last = state.calls.filter((c) => c.path.includes("/refresh")).pop();
  assert(last, "没有发出 /refresh 请求");
  assert(last.path.includes("updates=1"), `自动刷新没带 updates=1：${last.path}`);
  assert(!last.path.includes("force"), `自动刷新不该强制扫描：${last.path}`);
});

await check("不加 updates 的刷新不会触网（省掉无谓扫描）", () => {
  const before = state.calls.length;
  window.__appActions.refresh({ versions: false, quiet: true });
  return settle(80).then(() => {
    const fresh = state.calls.slice(before).filter((c) => c.path.includes("/refresh"));
    assert(fresh.length === 1, "没有发出刷新请求");
    assert(!fresh[0].path.includes("updates"), `不该带 updates：${fresh[0].path}`);
  });
});

await check("检查失败不再静默（状态条报错）", async () => {
  state.failUpdates = true;
  await window.__appActions.refreshUpdates();
  await settle(30);
  const status = document.getElementById("refresh-status");
  assert(/更新检查失败/.test(status.textContent), `状态文本：${status.textContent}`);
  state.failUpdates = false;
});

// ---------- summary ----------
const failed = results.filter((r) => !r.ok);
console.log("");
console.log(`=== 结果：${results.length - failed.length}/${results.length} 通过 ===`);
if (failed.length) {
  for (const f of failed) console.log(`  FAIL ${f.label} — ${f.err}`);
}
try {
  window.close();
} catch {}
process.exit(failed.length ? 1 : 0);
