#!/usr/bin/env node
/**
 * dsh-app-manager — 跨平台路径解析测试
 *
 * 为什么需要：`/app-manager` 曾在 macOS/Linux 上**静默**返回 0 条 npm 全局包。
 * 原因是 `discoverNpmGlobal()` 硬编码了 `appDataDir()/npm/node_modules`，而
 * `appDataDir()` 在非 Windows 上会回退到 `$HOME/AppData/Roaming` —— 一个不存在的
 * 路径。它不报错、不崩溃，只是安静地少显示东西，所以功能断言抓不到。
 *
 * 本测试直接验证候选路径的推导逻辑（按平台 + Node 安装方式），不依赖实际机器。
 * 这是本次修复的**回归守卫**：把 platform/execPath 作为参数注入，就能在
 * 任意平台上断言 Linux / macOS / nvm / Homebrew 的推导结果。
 *
 * 运行：node tests/crossplatform-paths.test.mjs
 */

import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const TESTS_DIR = path.dirname(fileURLToPath(import.meta.url));
const PLUGIN_DIR = path.resolve(TESTS_DIR, "..");

const results = [];
function check(label, fn) {
  try {
    const detail = fn();
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
/** First candidate (the one that wins when it exists). */
function first(list) {
  return list[0];
}
function includes(list, p) {
  return list.includes(p);
}

const utils = await import(
  pathToFileURL(path.join(PLUGIN_DIR, "lib/src/utils.js")).href
);

const LINUX_ENV = { HOME: "/home/u" };
const MAC_ENV = { HOME: "/Users/u" };

console.log("");
console.log("━━━ npm 全局根：按平台 / 安装方式推导 ━━━");

check("Windows 用 %APPDATA%\\npm\\node_modules 打头", () => {
  const c = utils.npmGlobalCandidates(
    { APPDATA: "C:\\Users\\u\\AppData\\Roaming" },
    "C:\\Program Files\\nodejs\\node.exe",
    "win32"
  );
  assert(
    first(c) === path.join("C:\\Users\\u\\AppData\\Roaming", "npm", "node_modules"),
    `unexpected first candidate: ${first(c)}`
  );
  // Must not leak POSIX candidates into Windows.
  assert(
    !c.some((p) => p.startsWith("/usr/")),
    `Windows list contains POSIX paths: ${c.join(", ")}`
  );
  return first(c);
});

check("Linux 系统 node (/usr/bin/node) → /usr/lib/node_modules", () => {
  const c = utils.npmGlobalCandidates(LINUX_ENV, "/usr/bin/node", "linux");
  assert(
    first(c) === path.join("/usr", "lib", "node_modules"),
    `expected /usr/lib/node_modules first, got ${first(c)}`
  );
  return first(c);
});

check("Linux 用户级 node (/usr/local/bin/node) → /usr/local/lib/node_modules", () => {
  const c = utils.npmGlobalCandidates(LINUX_ENV, "/usr/local/bin/node", "linux");
  assert(
    first(c) === path.join("/usr/local", "lib", "node_modules"),
    `expected /usr/local/lib/node_modules first, got ${first(c)}`
  );
  return first(c);
});

check("nvm → ~/.nvm/versions/node/vX/lib/node_modules", () => {
  const exec = "/home/u/.nvm/versions/node/v22.22.2/bin/node";
  const c = utils.npmGlobalCandidates(LINUX_ENV, exec, "linux");
  assert(
    first(c) === path.join("/home/u/.nvm/versions/node/v22.22.2", "lib", "node_modules"),
    `expected the nvm prefix first, got ${first(c)}`
  );
  return first(c);
});

check("Homebrew(arm64) → /opt/homebrew/lib/node_modules（不是 Cellar）", () => {
  const exec = "/opt/homebrew/Cellar/node/22.22.2/bin/node";
  const c = utils.npmGlobalCandidates(MAC_ENV, exec, "darwin");
  assert(
    first(c) === path.join("/opt/homebrew", "lib", "node_modules"),
    `expected /opt/homebrew/lib/node_modules first, got ${first(c)}`
  );
  assert(
    !first(c).includes("Cellar"),
    `Homebrew candidate must not point into Cellar: ${first(c)}`
  );
  return first(c);
});

check("macOS 系统 node → /usr/local/lib/node_modules", () => {
  const c = utils.npmGlobalCandidates(MAC_ENV, "/usr/local/bin/node", "darwin");
  assert(
    first(c) === path.join("/usr/local", "lib", "node_modules"),
    `expected /usr/local/lib/node_modules first, got ${first(c)}`
  );
  return first(c);
});

check("Linux 候选表含用户级回退（~/.npm-global、~/.local）", () => {
  const c = utils.npmGlobalCandidates(LINUX_ENV, "/usr/bin/node", "linux");
  assert(
    includes(c, path.join("/home/u", ".npm-global", "lib", "node_modules")),
    `missing ~/.npm-global fallback: ${c.join(", ")}`
  );
  assert(
    includes(c, path.join("/home/u", ".local", "lib", "node_modules")),
    `missing ~/.local fallback: ${c.join(", ")}`
  );
  return `${c.length} candidates`;
});

check("候选路径不含 $HOME/AppData（本次修复的具体缺陷）", () => {
  for (const [env, exec, plat] of [
    [LINUX_ENV, "/usr/bin/node", "linux"],
    [MAC_ENV, "/usr/local/bin/node", "darwin"],
    [LINUX_ENV, "/home/u/.nvm/versions/node/v22.22.2/bin/node", "linux"],
  ]) {
    const c = utils.npmGlobalCandidates(env, exec, plat);
    const bad = c.filter((p) => p.includes("AppData"));
    assert(
      bad.length === 0,
      `AppData leaked into a POSIX candidate list: ${bad.join(", ")}`
    );
  }
  return "no AppData paths on POSIX";
});

console.log("");
console.log("━━━ npx 缓存目录 ━━━");

check("Windows → %LOCALAPPDATA%\\npm-cache\\_npx", () => {
  const c = utils.npxCacheCandidates(
    { LOCALAPPDATA: "C:\\Users\\u\\AppData\\Local" },
    "win32"
  );
  assert(
    first(c) === path.join("C:\\Users\\u\\AppData\\Local", "npm-cache", "_npx"),
    `unexpected first: ${first(c)}`
  );
  return first(c);
});

check("Linux/macOS → ~/.npm/_npx", () => {
  for (const [env, plat] of [[LINUX_ENV, "linux"], [MAC_ENV, "darwin"]]) {
    const c = utils.npxCacheCandidates(env, plat);
    assert(
      includes(c, path.join(env.HOME, ".npm", "_npx")),
      `${plat} missing ~/.npm/_npx: ${c.join(", ")}`
    );
  }
  return "~/.npm/_npx present on both";
});

check("尊重 npm_config_cache 覆盖", () => {
  const c = utils.npxCacheCandidates(
    { HOME: "/home/u", npm_config_cache: "/tmp/npmcache" },
    "linux"
  );
  assert(
    includes(c, path.join("/tmp/npmcache", "_npx")),
    `override not honoured: ${c.join(", ")}`
  );
  return "/tmp/npmcache/_npx";
});

console.log("");
console.log("━━━ pnpm 全局根 ━━━");

check("Linux → ~/.local/share/pnpm/global（XDG 优先）", () => {
  const c = utils.pnpmGlobalCandidates({ HOME: "/home/u" }, "linux");
  assert(
    includes(c, path.join("/home/u", ".local", "share", "pnpm", "global")),
    `missing ~/.local/share/pnpm/global: ${c.join(", ")}`
  );
  const xdg = utils.pnpmGlobalCandidates(
    { HOME: "/home/u", XDG_DATA_HOME: "/data" },
    "linux"
  );
  assert(
    first(xdg) === path.join("/data", "pnpm", "global"),
    `XDG_DATA_HOME should take priority, got ${first(xdg)}`
  );
  return `${c.length} candidates, XDG priority ok`;
});

check("macOS → ~/Library/pnpm/global", () => {
  const c = utils.pnpmGlobalCandidates(MAC_ENV, "darwin");
  assert(
    includes(c, path.join("/Users/u", "Library", "pnpm", "global")),
    `missing ~/Library/pnpm/global: ${c.join(", ")}`
  );
  return path.join("/Users/u", "Library", "pnpm", "global");
});

console.log("");
console.log("━━━ 真实环境自检（当前平台必须能解析出根） ━━━");

check(`当前平台 (${process.platform}) npmGlobalCandidates 非空`, () => {
  const c = utils.npmGlobalCandidates();
  assert(c.length > 0, "candidate list is empty");
  assert(
    c.every((p) => typeof p === "string" && p.length > 0),
    `empty entries in list: ${JSON.stringify(c)}`
  );
  return `${c.length} candidates`;
});

check("npmGlobalRoot() 在当前机器能解析到真实目录", () => {
  const root = utils.npmGlobalRoot();
  // Not every machine has npm globals; only assert it points somewhere real
  // when it does resolve.
  if (!root) return "no npm global root on this machine (acceptable)";
  assert(
    root.includes("node_modules"),
    `resolved root does not look like a node_modules dir: ${root}`
  );
  return root;
});

console.log("");
console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
const pass = results.filter((r) => r.ok).length;
const fail = results.length - pass;
console.log(`结果: PASS ${pass} · FAIL ${fail} / 共 ${results.length}`);
process.exit(fail === 0 ? 0 : 1);
