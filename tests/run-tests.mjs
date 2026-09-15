#!/usr/bin/env node
/**
 * dsh-app-manager — 自动化测试运行器（测试专用，与开发分离）
 *
 * 用例规格：TEST-CASES.md（用例 ID 与本文件一一对应）
 * 运行方式：见 README.md
 * 约束：
 *   - 只读测试：不修改插件源码
 *   - 零副作用：update 仅测守卫路径（不存在名 / 不支持来源）
 *   - 退出码 0 = 无 FAIL；1 = 存在 FAIL
 */

import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

// ---------- 环境常量 ----------
const NODE = process.execPath;
const TESTS_DIR = path.dirname(fileURLToPath(import.meta.url));
// The plugin root is the parent of this tests/ directory.
const PLUGIN_DIR = path.resolve(TESTS_DIR, "..");
const CLI = path.join(PLUGIN_DIR, "lib/bin/cli-app-manager.js");
const PLUGIN_ENTRY = pathToFileURL(path.join(PLUGIN_DIR, "lib/src/index.js")).href;
const REPORTS_DIR = path.join(TESTS_DIR, "reports");

const QUICK = process.argv.includes("--quick");
const NETWORK_CASES = new Set(["TC-A18", "TC-B15"]);

// --group A,B / --group D —— 只跑指定组（用于「修 bug 只跑相关模块回顾测试」）
const groupIdx = process.argv.indexOf("--group");
const GROUP_FILTER = groupIdx >= 0 && process.argv[groupIdx + 1]
  ? new Set(process.argv[groupIdx + 1].toUpperCase().split(",").map((s) => s.trim()))
  : null;
function inGroupFilter(id) {
  if (!GROUP_FILTER) return true;
  const g = id.match(/^TC-([A-Z])/)?.[1];
  return g ? GROUP_FILTER.has(g) : true;
}

// ---------- 用例收集器 ----------
const results = [];
let currentGroup = "";

function group(name) {
  currentGroup = name;
  process.stdout.write(`\n━━━ ${name} ━━━\n`);
}

class AssertionError extends Error {
  constructor(msg) {
    super(msg);
    this.kind = "FAIL";
  }
}
class SkipError extends Error {
  constructor(msg) {
    super(msg);
    this.kind = "SKIP";
  }
}

function assert(cond, msg) {
  if (!cond) throw new AssertionError(msg);
}

function skip(reason) {
  throw new SkipError(reason);
}

async function test(id, title, fn) {
  const t0 = Date.now();
  process.stdout.write(`  ${id} ${title} ... `);
  try {
    if (!inGroupFilter(id)) {
      throw new SkipError(`--group ${[...(GROUP_FILTER ?? [])].join(",")} 未包含 ${id.slice(3, 4)} 组`);
    }
    if (QUICK && NETWORK_CASES.has(id)) {
      throw new SkipError("--quick 模式跳过网络用例");
    }
    const evidence = (await fn()) ?? "";
    const ms = Date.now() - t0;
    results.push({ group: currentGroup, id, title, status: "PASS", ms, evidence: String(evidence) });
    process.stdout.write(`PASS (${ms}ms)\n`);
  } catch (e) {
    const ms = Date.now() - t0;
    const status = e instanceof SkipError ? "SKIP" : e instanceof AssertionError ? "FAIL" : "ERROR";
    results.push({ group: currentGroup, id, title, status, ms, evidence: String(e.message) });
    process.stdout.write(`${status} (${ms}ms)\n    ↳ ${String(e.message).slice(0, 160)}\n`);
  }
}

// ---------- 工具函数 ----------
function runCli(args, timeoutMs = 180000) {
  const r = spawnSync(NODE, [CLI, ...args], {
    encoding: "utf8",
    timeout: timeoutMs,
    maxBuffer: 64 * 1024 * 1024,
    env: process.env,
  });
  if (r.error && r.error.code === "ETIMEDOUT") {
    return { code: null, stdout: "", stderr: `TIMEOUT after ${timeoutMs}ms`, timedOut: true };
  }
  return { code: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "", timedOut: false };
}

function clip(text, max = 200) {
  const t = String(text).replace(/\x1b\[[0-9;]*m/g, "").replace(/\s+/g, " ").trim();
  return t.length > max ? t.slice(0, max) + "…" : t;
}

function lineOf(text, keyword) {
  const lines = String(text).split(/\r?\n/).map((l) => l.replace(/\x1b\[[0-9;]*m/g, ""));
  return lines.find((l) => l.includes(keyword)) ?? "";
}

// 伪 Cordis 上下文加载插件
async function loadPlugin() {
  const plugin = await import(PLUGIN_ENTRY);
  const tools = [];
  const routes = [];
  const ctx = {
    logger: { info: () => {} },
    inject(_deps, cb) {
      cb({
        tools: { register: (t) => (tools.push(t), () => {}) },
        webServer: { register: (r) => (routes.push(r), () => {}) },
      });
      return () => {};
    },
  };
  const dispose = plugin.apply(ctx);
  return { plugin, tools, routes, dispose };
}

// 伪 HTTP 调用
function callRoute(route, url) {
  return new Promise((resolve, reject) => {
    let code = 200;
    let contentType = "";
    let body = "";
    const res = {
      writeHead(c, headers) {
        code = c;
        contentType = headers?.["content-type"] ?? "";
      },
      end(d) {
        body = Buffer.isBuffer(d) ? d.toString("utf8") : String(d ?? "");
        resolve({ code, contentType, body });
      },
    };
    Promise.resolve(route.handler({ url, method: "GET", headers: {} }, res)).catch(reject);
  });
}

// 从 HTML 中提取全部 font-family / font-size 声明值
function cssDecls(html, prop) {
  const re = new RegExp(`${prop}\\s*:\\s*([^;{}]+)`, "g");
  const out = [];
  let m;
  while ((m = re.exec(html)) !== null) out.push(m[1].trim());
  return out;
}

function countOccurrences(haystack, needle) {
  return haystack.split(needle).length - 1;
}

// ---------- 主流程 ----------
async function main() {
  const startedAt = new Date();
  console.log(`dsh-app-manager 测试运行器  ${QUICK ? "[--quick]" : "[全量]"}`);
  console.log(`被测插件: ${PLUGIN_DIR} (v${JSON.parse(readFileSync(path.join(PLUGIN_DIR, "package.json"), "utf8")).version})`);
  console.log(`运行时  : ${process.version} @ ${process.platform}`);

  let pluginCtx;
  let pageHtml = "";
  let appsJson = null;
  let unmanagedJson = null;
  let methodJson = null;
  let pathAppName = null; // 供 update 守卫用例选取的非 npm 来源应用

  // ============ B 组（先行：产物供 A/D/E 组使用） ============
  group("B 组 · 插件加载与 DSH 工具契约");

  await test("TC-B01", "模块导出契约", async () => {
    pluginCtx = await loadPlugin();
    const { plugin } = pluginCtx;
    assert(typeof plugin.apply === "function", `apply 应为函数，实际 ${typeof plugin.apply}`);
    assert(plugin.name === "dsh-app-manager", `name 应为 dsh-app-manager，实际 ${plugin.name}`);
    assert(JSON.stringify(plugin.inject) === JSON.stringify(["tools", "webServer"]), `inject 应为 [tools,webServer]，实际 ${JSON.stringify(plugin.inject)}`);
    return `name=${plugin.name} inject=${JSON.stringify(plugin.inject)}`;
  });

  await test("TC-B02", "apply 注册工具数 = 7", async () => {
    assert(pluginCtx.tools.length === 7, `应注册 7 个工具，实际 ${pluginCtx.tools.length}`);
    return `tools=${pluginCtx.tools.length}`;
  });

  await test("TC-B03", "工具命名唯一且带前缀", async () => {
    const names = pluginCtx.tools.map((t) => t.name);
    assert(new Set(names).size === names.length, `工具名存在重复: ${names.join(",")}`);
    assert(names.every((n) => n.startsWith("app_manager_")), `存在非 app_manager_ 前缀: ${names.filter((n) => !n.startsWith("app_manager_")).join(",")}`);
    return names.join(", ");
  });

  await test("TC-B04", "0.1.5 契约·output 字段必填", async () => {
    const bad = pluginCtx.tools.filter((t) => !(t.output && t.output.schema !== undefined && typeof t.output.render === "function"));
    assert(bad.length === 0, `缺少 output.schema 或 output.render 的工具: ${bad.map((t) => t.name).join(",") || "无"}`);
    return `${pluginCtx.tools.length}/7 个工具均含 schema+render`;
  });

  await test("TC-B05", "0.1.5 契约·render 返回 ContentBlock[]", async () => {
    for (const t of pluginCtx.tools) {
      const blocks = t.output.render({}, "探针文本");
      assert(Array.isArray(blocks) && blocks.length > 0, `${t.name}.render 未返回数组`);
      assert(blocks[0].type === "text" && blocks[0].text === "探针文本", `${t.name}.render 首块非 {type:"text"}: ${JSON.stringify(blocks[0])}`);
    }
    return "7 个工具 render 均返回 [{type:'text',text}]";
  });

  const getTool = (name) => {
    const t = pluginCtx.tools.find((x) => x.name === name);
    if (!t) throw new AssertionError(`工具 ${name} 未注册`);
    return t;
  };
  const execSignal = { signal: new AbortController().signal };

  await test("TC-B06", "工具·list 全量", async () => {
    const out = String(await getTool("app_manager_list").execute({}, execSignal));
    assert(/^\d+ apps \(/m.test(out), `缺少计数行，实际开头: ${clip(out, 60)}`);
    assert(out.includes("| Name |"), "缺少表头 | Name |");
    return clip(out, 120);
  });

  await test("TC-B07", "工具·list 来源过滤", async () => {
    const full = String(await getTool("app_manager_list").execute({}, execSignal));
    const filtered = String(await getTool("app_manager_list").execute({ source: "npm" }, execSignal));
    const nFull = parseInt(full.match(/^(\d+) apps \(/m)?.[1] ?? "0", 10);
    const nFiltered = parseInt(filtered.match(/^(\d+) apps \(/m)?.[1] ?? "0", 10);
    assert(nFiltered <= nFull, `过滤后 ${nFiltered} 应 ≤ 全量 ${nFull}`);
    assert(filtered.includes("npm"), "过滤结果未包含 npm 来源行");
    return `全量 ${nFull} → npm 过滤 ${nFiltered}`;
  });

  await test("TC-B08", "工具·info 命中 dsh", async () => {
    const out = String(await getTool("app_manager_info").execute({ name: "dsh" }, execSignal));
    assert(out.includes("Version:"), "缺少 Version 字段");
    assert(out.toLowerCase().includes("dsh"), "输出未包含 dsh");
    return clip(out, 120);
  });

  await test("TC-B09", "工具·info 未命中", async () => {
    const out = String(await getTool("app_manager_info").execute({ name: "not-exist-xyz" }, execSignal));
    assert(out.includes("No application found"), `应返回未命中提示，实际: ${clip(out, 80)}`);
    return clip(out, 80);
  });

  await test("TC-B10", "工具·doctor", async () => {
    const out = String(await getTool("app_manager_doctor").execute({}, execSignal));
    assert(out.includes("healthy") || out.includes("Issues") || out.includes("issues"), `应含健康结论，实际: ${clip(out, 80)}`);
    return clip(out, 100);
  });

  await test("TC-B11", "工具·unmanaged", async () => {
    const out = String(await getTool("app_manager_unmanaged").execute({}, execSignal));
    assert(out.toLowerCase().includes("unmanaged"), "输出未包含 unmanaged");
    return clip(out, 100);
  });

  await test("TC-B12", "工具·scan_method", async () => {
    const out = String(await getTool("app_manager_scan_method").execute({}, execSignal));
    assert(out.includes("Scan methodology"), "缺少 Scan methodology 标题");
    assert(out.includes("| Source |"), "缺少方法论表头");
    return clip(out, 100);
  });

  await test("TC-B13", "工具·update 守卫·不存在名", async () => {
    const out = String(await getTool("app_manager_update").execute({ name: "not-exist-xyz" }, execSignal));
    assert(out.includes("No application found"), `守卫未生效: ${clip(out, 80)}`);
    return clip(out, 80);
  });

  // ============ C 组（路由 + JSON，产物供 D/E/A 组使用） ============
  group("C 组 · Web 路由与 JSON API");

  await test("TC-C01", "路由注册面 = 7 条 exact", async () => {
    const paths = pluginCtx.routes.map((r) => `${r.kind} ${r.path}`);
    // 0.5.3 起为 4 条只读路由 + 3 条动作路由（open/updates/update）。
    // 动作路由的**行为**（校验、并发、失败关闭）由 tests/actions.test.mjs 覆盖，
    // 这里只守注册面：少一条就是接口凭空消失。
    assert(pluginCtx.routes.length === 7, `应注册 7 条路由，实际 ${pluginCtx.routes.length}`);
    assert(pluginCtx.routes.every((r) => r.kind === "exact"), "存在非 exact 路由");
    const expected = [
      "/app-manager",
      "/app-manager/api/apps",
      "/app-manager/api/unmanaged",
      "/app-manager/api/method",
      "/app-manager/api/open",
      "/app-manager/api/updates",
      "/app-manager/api/update",
    ];
    for (const p of expected) assert(paths.some((x) => x.endsWith(p)), `缺少路由 ${p}`);
    return paths.join(" | ");
  });

  const route = (p) => pluginCtx.routes.find((r) => r.path === p);

  await test("TC-C02", "页面响应 /app-manager", async () => {
    const res = await callRoute(route("/app-manager"), "/app-manager");
    assert(res.code === 200, `状态码 ${res.code}`);
    assert(String(res.contentType).includes("text/html"), `content-type ${res.contentType}`);
    pageHtml = res.body;
    assert(pageHtml.includes("<style>"), "缺少 <style>");
    assert(pageHtml.includes("<script>"), "缺少 <script>");
    assert(pageHtml.includes("<title>"), "缺少 <title>");
    return `200 · ${pageHtml.length} bytes HTML`;
  });

  await test("TC-C03", "apps API 结构与计数", async () => {
    const res = await callRoute(route("/app-manager/api/apps"), "/app-manager/api/apps");
    assert(res.code === 200, `状态码 ${res.code}`);
    appsJson = JSON.parse(res.body);
    assert(appsJson.total > 0, `total 应 >0，实际 ${appsJson.total}`);
    assert(appsJson.total === appsJson.apps.length, `total(${appsJson.total}) !== apps.length(${appsJson.apps.length})`);
    assert(appsJson.managedCount + appsJson.unmanagedCount === appsJson.total, "计数不守恒");
    for (const a of appsJson.apps) {
      for (const k of ["name", "version", "commands", "category", "source", "managed", "installKind", "inPath"]) {
        assert(k in a, `应用 ${a.name} 缺字段 ${k}`);
      }
    }
    return `total=${appsJson.total} managed=${appsJson.managedCount} unmanaged=${appsJson.unmanagedCount}`;
  });

  await test("TC-C04", "unmanaged API 语义", async () => {
    const res = await callRoute(route("/app-manager/api/unmanaged"), "/app-manager/api/unmanaged");
    assert(res.code === 200, `状态码 ${res.code}`);
    unmanagedJson = JSON.parse(res.body);
    assert(Array.isArray(unmanagedJson.apps), "apps 应为数组");
    const bad = unmanagedJson.apps.filter((a) => a.installKind === "managed");
    assert(bad.length === 0, `unmanaged API 出现 managed 项: ${bad.map((a) => a.name).join(",")}`);
    return `total=${unmanagedJson.total}`;
  });

  await test("TC-C05", "method API 结构", async () => {
    const res = await callRoute(route("/app-manager/api/method"), "/app-manager/api/method");
    assert(res.code === 200, `状态码 ${res.code}`);
    methodJson = JSON.parse(res.body);
    for (const k of ["platform", "durationMs", "totalApps", "managedCount", "unmanagedCount", "sources"]) {
      assert(k in methodJson, `缺少字段 ${k}`);
    }
    assert(Array.isArray(methodJson.sources) && methodJson.sources.length > 0, "sources 应为非空数组");
    return `platform=${methodJson.platform} sources=${methodJson.sources.length} (${methodJson.durationMs}ms)`;
  });

  // 为 update 守卫用例动态选取 path 来源应用（安全：非 npm/pnpm/choco/scoop 不会触发真实安装）
  const pathApp = appsJson?.apps.find((a) => a.source === "path");
  pathAppName = pathApp?.name ?? null;

  // ============ D 组（UI 需求断言） ============
  group("D 组 · UI 需求断言");

  await test("TC-D01", "REQ1 统一字体/字号（全 var() 化）", async () => {
    assert(pageHtml.includes("--font-ui") && pageHtml.includes("--font-mono"), "CSS 未定义 --font-ui/--font-mono");
    for (const v of ["--fs-title", "--fs-section", "--fs-body", "--fs-small"]) {
      assert(pageHtml.includes(v), `CSS 未定义 ${v}`);
    }
    const ff = cssDecls(pageHtml, "font-family");
    assert(ff.length > 0, "未发现任何 font-family 声明");
    const ffBad = ff.filter((v) => !v.startsWith("var(--font-"));
    assert(ffBad.length === 0, `存在未走统一变量的 font-family: ${ffBad.join(" ; ")}`);
    const fs = cssDecls(pageHtml, "font-size");
    assert(fs.length > 0, "未发现任何 font-size 声明");
    const fsBad = fs.filter((v) => !v.startsWith("var(--fs-"));
    assert(fsBad.length === 0, `存在硬编码 font-size（应使用 --fs-* 变量）: ${fsBad.join(" ; ")}`);
    return `font-family ${ff.length} 处、font-size ${fs.length} 处全部走统一变量`;
  });

  await test("TC-D02", "REQ2 统一列表格式（应用列表 colgroup 全覆盖且一致）", async () => {
    // REQ2 的意图是「应用列表的列格式统一」。方法论参考表（methodology）
    // 语义上列结构本就不同（步骤/说明），不纳入统一性约束；但它同样必须带 <colgroup>。
    const nTable = countOccurrences(pageHtml, "<table");
    const nColgroup = countOccurrences(pageHtml, "<colgroup>");
    assert(nTable > 0, "页面无表格");
    assert(nColgroup === nTable, `仅 ${nColgroup}/${nTable} 个表格带 <colgroup>，未统一`);

    // 只对「分类区块内的应用列表表」校验列宽一致性
    const catBlocks = pageHtml.match(/<details class="category"[\s\S]*?<\/details>/g) ?? [];
    const appTables = [];
    for (const block of catBlocks) {
      const m = block.match(/<table[\s\S]*?<\/table>/g) ?? [];
      appTables.push(...m);
    }
    assert(appTables.length > 0, "未找到分类区块内的应用列表表");
    const cgInApp = appTables
      .map((t) => t.match(/<colgroup>[\s\S]*?<\/colgroup>/))
      .filter(Boolean)
      .map((m) => m[0].replace(/\s+/g, " "));
    assert(cgInApp.length === appTables.length, `应用列表表 ${cgInApp.length}/${appTables.length} 带 colgroup`);
    const unique = new Set(cgInApp);
    assert(unique.size === 1, `应用列表 colgroup 存在 ${unique.size} 种不同写法，列宽未统一`);
    return `${nTable} 表（colgroup ${nColgroup} 处全带）· 应用列表 ${appTables.length} 表 · 唯一列宽写法 ${unique.size} 种`;
  });

  await test("TC-D03", "REQ3 分类可折叠（details/summary）", async () => {
    const nDetails = countOccurrences(pageHtml, '<details class="category"');
    const nSummary = countOccurrences(pageHtml, '<summary class="cat-head"');
    const categories = new Set(appsJson.apps.map((a) => a.category));
    assert(nDetails >= 1, "页面无 details.category 折叠区块");
    assert(nDetails === nSummary, `details(${nDetails}) 与 summary(${nSummary}) 数量不一致`);
    assert(nDetails === categories.size, `折叠区块 ${nDetails} 应等于分类数 ${categories.size}`);
    // 每个折叠块内都应有表格
    const blocks = pageHtml.match(/<details class="category"[\s\S]*?<\/details>/g) ?? [];
    const noTable = blocks.filter((b) => !b.includes("<table"));
    assert(noTable.length === 0, `${noTable.length} 个折叠块内无表格`);
    return `${nDetails} 个折叠区块 · ${nSummary} 个 cat-head · 分类数 ${categories.size}`;
  });

  await test("TC-D04", "REQ4 统计可点击跳转", async () => {
    const jumps = new Set([...pageHtml.matchAll(/data-jump="([^"]+)"/g)].map((m) => m[1]));
    const expected = new Set(["all", "managed", "unmanaged", "inpath"]);
    assert(
      jumps.size === expected.size && [...expected].every((v) => jumps.has(v)),
      `data-jump 集合 ${[...jumps].join(",")} ≠ 预期 all/managed/unmanaged/inpath`
    );
    assert(pageHtml.includes("function jumpTo"), "脚本未定义 jumpTo");
    const chips = countOccurrences(pageHtml, "data-filter-source=");
    assert(chips > 0, "无来源筛选芯片");
    return `data-jump=${[...jumps].join("/")} · jumpTo 已定义 · 芯片 ${chips} 个`;
  });

  await test("TC-D05", "统计数字与 API 一致", async () => {
    const statValue = (label) => {
      const re = new RegExp(`data-jump="${label}"[\\s\\S]{0,200}?<span class="stat-value"[^>]*>(\\d+)</span>`);
      const m = pageHtml.match(re);
      if (!m) throw new AssertionError(`未找到 ${label} 统计值`);
      return parseInt(m[1], 10);
    };
    const inPathCount = appsJson.apps.filter((a) => a.inPath).length;
    const pairs = [
      ["all", appsJson.total],
      ["managed", appsJson.managedCount],
      ["unmanaged", appsJson.unmanagedCount],
      ["inpath", inPathCount],
    ];
    for (const [label, expect] of pairs) {
      assert(statValue(label) === expect, `统计 ${label}=${statValue(label)} ≠ API ${expect}`);
    }
    return pairs.map(([l, v]) => `${l}=${v}`).join(" ");
  });

  // ============ E 组（数据一致性） ============
  group("E 组 · 数据一致性");

  await test("TC-E01", "计数守恒", async () => {
    assert(appsJson.managedCount + appsJson.unmanagedCount === appsJson.total, "managed+unmanaged ≠ total");
    return `${appsJson.managedCount}+${appsJson.unmanagedCount}=${appsJson.total}`;
  });

  await test("TC-E02", "installKind 枚举合法", async () => {
    const legal = new Set(["managed", "portable", "path-shim", "unknown"]);
    const bad = appsJson.apps.filter((a) => !legal.has(a.installKind));
    assert(bad.length === 0, `非法 installKind: ${[...new Set(bad.map((a) => `${a.name}=${a.installKind}`))].join(",")}`);
    return `${appsJson.apps.length} 项全部合法`;
  });

  await test("TC-E03", "managed 语义自洽", async () => {
    const bad = appsJson.apps.filter((a) => (a.managed === true) !== (a.installKind === "managed"));
    assert(bad.length === 0, `managed 与 installKind 矛盾: ${bad.map((a) => `${a.name}(managed=${a.managed},${a.installKind})`).join(",")}`);
    return "无矛盾项";
  });

  await test("TC-E04", "unmanaged 口径一致", async () => {
    const expect = appsJson.apps.filter((a) => a.managed === false).length;
    assert(unmanagedJson.total === expect, `unmanaged API total=${unmanagedJson.total} ≠ apps 中未管理数 ${expect}`);
    return `unmanaged API ${unmanagedJson.total} === apps 口径 ${expect}`;
  });

  await test("TC-E05", "(name,source) 无重复", async () => {
    const seen = new Map();
    for (const a of appsJson.apps) {
      const k = `${a.name}::${a.source}`;
      seen.set(k, (seen.get(k) ?? 0) + 1);
    }
    const dup = [...seen.entries()].filter(([, n]) => n > 1);
    assert(dup.length === 0, `重复条目: ${dup.map(([k, n]) => `${k}×${n}`).join(",")}`);
    return `${seen.size} 个唯一键`;
  });

  await test("TC-E06", "commands 非空数组", async () => {
    const bad = appsJson.apps.filter((a) => !Array.isArray(a.commands) || a.commands.length === 0);
    assert(bad.length === 0, `commands 为空: ${bad.map((a) => a.name).join(",")}`);
    return `${appsJson.apps.length} 项全部有命令`;
  });

  await test("TC-E07", "跨端点总数一致", async () => {
    const diff = Math.abs(methodJson.totalApps - appsJson.total);
    assert(diff <= 2, `method.totalApps(${methodJson.totalApps}) 与 apps.total(${appsJson.total}) 差值 ${diff} > 2`);
    return `method=${methodJson.totalApps} apps=${appsJson.total} diff=${diff}`;
  });

  // ============ B 组收尾（依赖 C 组数据的 update 守卫 + 网络用例） ============
  group("B 组 · 续（守卫与网络用例）");

  await test("TC-B14", "工具·update 守卫·不支持来源", async () => {
    if (!pathAppName) skip("当前扫描无 path 来源应用");
    const out = String(await getTool("app_manager_update").execute({ name: pathAppName }, execSignal));
    assert(out.includes("Cannot auto-update"), `守卫未生效: ${clip(out, 80)}`);
    return `对 path 应用 "${pathAppName}" 正确拒绝`;
  });

  await test("TC-B15", "◆ 工具·check_updates", async () => {
    const out = String(await getTool("app_manager_check_updates").execute({}, execSignal));
    assert(typeof out === "string" && out.length > 0, "返回应为非空字符串");
    return clip(out, 100);
  });

  await test("TC-B16", "dispose 生命周期", async () => {
    assert(typeof pluginCtx.dispose === "function", "apply 返回值应为函数");
    pluginCtx.dispose();
    return "dispose() 调用无异常";
  });

  // ============ A 组（CLI 子进程实测，最慢放最后） ============
  group("A 组 · CLI 命令（子进程）");

  await test("TC-A01", "list 基本输出", async () => {
    const r = runCli(["list"]);
    assert(r.code === 0, `退出码 ${r.code} · stderr: ${clip(r.stderr, 80)}`);
    const plain = r.stdout.replace(/\x1b\[[0-9;]*m/g, "");
    assert(plain.includes("Managed:"), "缺少 Managed: 统计行");
    assert(plain.includes("Unmanaged"), "缺少 Unmanaged 字样");
    assert(plain.includes("CLI applications in"), "缺少汇总行");
    assert(plain.includes("By source:"), "缺少 By source 段");
    return clip(lineOf(plain, "CLI applications in"), 80);
  });

  await test("TC-A02", "list -s npm 过滤", async () => {
    const r = runCli(["list", "-s", "npm"]);
    assert(r.code === 0, `退出码 ${r.code}`);
    const plain = r.stdout.replace(/\x1b\[[0-9;]*m/g, "");
    const bySource = plain.slice(plain.indexOf("By source:"));
    assert(/npm:\s*\d+/.test(bySource), "By source 段缺少 npm 计数");
    assert(!/path:\s*\d+/.test(bySource), "过滤后仍出现 path 来源");
    return clip(lineOf(bySource, "npm:"), 60);
  });

  await test("TC-A03", "list -s path 过滤", async () => {
    const r = runCli(["list", "-s", "path"]);
    assert(r.code === 0, `退出码 ${r.code}`);
    const plain = r.stdout.replace(/\x1b\[[0-9;]*m/g, "");
    const bySource = plain.slice(plain.indexOf("By source:"));
    assert(/path:\s*\d+/.test(bySource), "By source 段缺少 path 计数");
    assert(!/npm:\s*\d+/.test(bySource), "过滤后仍出现 npm 来源");
    return clip(lineOf(bySource, "path:"), 60);
  });

  await test("TC-A04", "info dsh", async () => {
    const r = runCli(["info", "dsh"]);
    assert(r.code === 0, `退出码 ${r.code}`);
    const plain = r.stdout.replace(/\x1b\[[0-9;]*m/g, "");
    assert(plain.includes("Version:"), "缺少 Version 字段");
    assert(plain.includes("Source:"), "缺少 Source 字段");
    assert(plain.includes("Commands:"), "缺少 Commands 字段");
    return clip(lineOf(plain, "Version:"), 80);
  });

  await test("TC-A05", "info 未装应用", async () => {
    const r = runCli(["info", "not-exist-xyz"]);
    assert(r.code === 0, `退出码应为 0（友好提示），实际 ${r.code}`);
    assert(r.stdout.includes("No application found matching"), `提示不符: ${clip(r.stdout, 80)}`);
    return clip(r.stdout, 80);
  });

  await test("TC-A06", "unmanaged 输出", async () => {
    const r = runCli(["unmanaged"]);
    assert(r.code === 0, `退出码 ${r.code}`);
    const plain = r.stdout.replace(/\x1b\[[0-9;]*m/g, "");
    assert(plain.includes("Add/Remove-Programs baseline"), "缺少 ARP 基线行");
    assert(plain.includes("unmanaged program(s)"), "缺少 unmanaged 汇总行");
    return clip(lineOf(plain, "unmanaged program(s)"), 80);
  });

  await test("TC-A07", "portable 别名等价", async () => {
    const r = runCli(["portable"]);
    assert(r.code === 0, `退出码 ${r.code}`);
    assert(r.stdout.replace(/\x1b\[[0-9;]*m/g, "").includes("unmanaged program(s)"), "别名输出与 unmanaged 不一致");
    return "别名输出同构";
  });

  await test("TC-A08", "method 方法论", async () => {
    const r = runCli(["method"]);
    assert(r.code === 0, `退出码 ${r.code}`);
    const plain = r.stdout.replace(/\x1b\[[0-9;]*m/g, "");
    assert(plain.includes("Techniques used"), "缺少 Techniques used");
    assert(plain.includes("managed") && plain.includes("unmanaged"), "缺少 managed/unmanaged 汇总");
    return clip(lineOf(plain, "apps"), 80);
  });

  await test("TC-A09", "export 注册表 JSON", async () => {
    const r = runCli(["export"]);
    assert(r.code === 0, `退出码 ${r.code}`);
    let reg;
    try {
      reg = JSON.parse(r.stdout);
    } catch (e) {
      throw new AssertionError(`stdout 非合法 JSON: ${clip(r.stdout, 80)} (${e.message})`);
    }
    for (const k of ["totalApps", "managedCount", "unmanagedCount", "apps"]) {
      assert(k in reg, `缺少字段 ${k}`);
    }
    assert(reg.totalApps === reg.apps.length, `totalApps(${reg.totalApps}) ≠ apps.length(${reg.apps.length})`);
    return `totalApps=${reg.totalApps} managed=${reg.managedCount}`;
  });

  await test("TC-A10", "doctor 健康检查", async () => {
    const r = runCli(["doctor"], 300000);
    assert(r.code === 0, `退出码 ${r.code}`);
    const plain = r.stdout.replace(/\x1b\[[0-9;]*m/g, "");
    assert(plain.includes("Running health check"), "缺少标题");
    assert(plain.includes("All applications are healthy") || /issue\(s\)/.test(plain), "缺少健康结论");
    return clip(plain.includes("All applications are healthy") ? "全部健康" : lineOf(plain, "issue(s)"), 80);
  });

  await test("TC-A11", "monitor 进程监视", async () => {
    const r = runCli(["monitor"], 120000);
    assert(r.code === 0, `退出码 ${r.code}`);
    assert(r.stdout.replace(/\x1b\[[0-9;]*m/g, "").includes("Monitoring running processes"), "缺少标题");
    return clip(lineOf(r.stdout, "instance") || lineOf(r.stdout, "not running") || "无运行实例", 80);
  });

  await test("TC-A12", "search 搜索", async () => {
    const r = runCli(["search", "dsh"]);
    assert(r.code === 0, `退出码 ${r.code}`);
    const plain = r.stdout.replace(/\x1b\[[0-9;]*m/g, "");
    assert(plain.includes("Found") || plain.includes("No apps found"), "缺少结果行");
    if (plain.includes("Found")) assert(plain.toLowerCase().includes("dsh"), "结果未包含 dsh");
    return clip(lineOf(plain, "Found") || "No apps found", 80);
  });

  await test("TC-A13", "help 帮助", async () => {
    const r = runCli(["help"]);
    assert(r.code === 0, `退出码 ${r.code}`);
    const plain = r.stdout.replace(/\x1b\[[0-9;]*m/g, "");
    assert(plain.includes("Commands:"), "缺少命令列表");
    assert(plain.includes("unmanaged") && plain.includes("method"), "新命令未出现在帮助中");
    return "帮助含全部命令";
  });

  await test("TC-A14", "update 守卫·不存在名", async () => {
    const r = runCli(["update", "not-exist-xyz"]);
    assert(r.code === 0, `退出码 ${r.code}`);
    const plain = r.stdout.replace(/\x1b\[[0-9;]*m/g, "");
    assert(plain.includes("No application found matching"), "守卫提示缺失");
    assert(!plain.includes("Updating"), "出现 Updating 字样——可能触发了真实更新！");
    return "正确拒绝，无副作用";
  });

  await test("TC-A15", "update 守卫·不支持来源", async () => {
    if (!pathAppName) skip("当前扫描无 path 来源应用");
    const r = runCli(["update", pathAppName]);
    assert(r.code === 0, `退出码 ${r.code}`);
    const plain = r.stdout.replace(/\x1b\[[0-9;]*m/g, "");
    assert(plain.includes("Auto-update not supported"), `守卫提示缺失: ${clip(plain, 100)}`);
    assert(!plain.includes("updated successfully"), "出现更新成功字样——可能触发了真实更新！");
    return `对 path 应用 "${pathAppName}" 正确拒绝`;
  });

  await test("TC-A16", "未知命令回退帮助", async () => {
    const r = runCli(["foobar"]);
    assert(plain0(r.stderr).includes("Unknown command: foobar"), "stderr 缺少 Unknown command 提示");
    assert(plain0(r.stdout).includes("Commands:"), "未回退到帮助");
    function plain0(s) {
      return String(s).replace(/\x1b\[[0-9;]*m/g, "");
    }
    return "未知命令 → 帮助回退";
  });

  await test("TC-A17", "info 缺参数报错", async () => {
    const r = runCli(["info"]);
    assert(r.code === 1, `缺参数应退出码 1，实际 ${r.code}`);
    assert(r.stderr.includes("App name required"), `stderr 提示不符: ${clip(r.stderr, 80)}`);
    return "退出码 1 + 明确报错";
  });

  await test("TC-A18", "◆ check 更新检查", async () => {
    const r = runCli(["check"], 300000);
    if (r.timedOut) skip(`网络检查超时（>${300000 / 1000}s）`);
    assert(r.code === 0, `退出码 ${r.code}`);
    const plain = r.stdout.replace(/\x1b\[[0-9;]*m/g, "");
    assert(plain.includes("up to date") || plain.includes("update(s) available") || plain.includes("unable to check"), `输出异常: ${clip(plain, 100)}`);
    return clip(lineOf(plain, "up to date") || lineOf(plain, "update(s)"), 80);
  });

  // ============ 元断言：SKIP 不是通过 ============
  //
  // 为什么要有这条：本仓库吃过一次亏 —— 拖拽组在缺少 jsdom 时静默 SKIP 且
  // 退出码为 0，CI 全绿而拖拽覆盖实际为零。「没验证」和「验证通过」必须分开：
  // 跳过意味着这份报告不能用于放行，所以它计入失败（退出码非 0）。
  //
  // 代价是：离线环境跑本套件会因 ◆ 网络用例而失败 —— 这是刻意的，
  // 请在网络可用时重跑，或看报告顶部确认哪几条没被验证。
  await test("TC-Z01", "元断言：无 SKIP（未验证 ≠ 通过）", async () => {
    const skips = results.filter((r) => r.status === "SKIP");
    assert(
      skips.length === 0,
      `有 ${skips.length} 条被跳过（${skips.map((s) => s.id).join(", ")}）—— 跳过即视为失败，请在有网络的环境重跑`
    );
    return "0 skipped";
  });

  // ============ 汇总与机器报告 ============
  const endedAt = new Date();
  const byStatus = (s) => results.filter((r) => r.status === s).length;
  const pass = byStatus("PASS");
  const fail = byStatus("FAIL");
  const err = byStatus("ERROR");
  const skipped = byStatus("SKIP");

  const pad = (n) => String(n).padStart(2, "0");
  const stamp = `${startedAt.getFullYear()}-${pad(startedAt.getMonth() + 1)}-${pad(startedAt.getDate())}_${pad(startedAt.getHours())}${pad(startedAt.getMinutes())}${pad(startedAt.getSeconds())}`;

  const groups = [...new Set(results.map((r) => r.group))];
  let md = "";
  md += `# 机器测试报告 run-${stamp}\n\n`;
  md += `> 本文件由 run-tests.mjs 自动生成（只含客观结果，修改建议见 TEST-REPORT-*）\n\n`;
  md += `- 被测插件: dsh-app-manager v${JSON.parse(readFileSync(path.join(PLUGIN_DIR, "package.json"), "utf8")).version}\n`;
  md += `- 运行时: Node ${process.version} @ ${process.platform} ${process.arch}\n`;
  md += `- 模式: ${QUICK ? "--quick（跳过网络用例）" : "全量"}\n`;
  md += `- 开始: ${startedAt.toLocaleString("zh-CN")} · 结束: ${endedAt.toLocaleString("zh-CN")} · 耗时: ${Math.round((endedAt - startedAt) / 1000)}s\n`;
  md += `- 结果: **PASS ${pass} · FAIL ${fail} · ERROR ${err} · SKIP ${skipped}**（共 ${results.length} 条）\n\n`;

  md += `## 分组汇总\n\n| 组 | PASS | FAIL | ERROR | SKIP | 合计 |\n|---|---|---|---|---|---|\n`;
  for (const g of groups) {
    const rs = results.filter((r) => r.group === g);
    md += `| ${g} | ${rs.filter((r) => r.status === "PASS").length} | ${rs.filter((r) => r.status === "FAIL").length} | ${rs.filter((r) => r.status === "ERROR").length} | ${rs.filter((r) => r.status === "SKIP").length} | ${rs.length} |\n`;
  }

  md += `\n## 明细\n\n| ID | 用例 | 结果 | 耗时 | 证据 / 说明 |\n|---|---|---|---|---|\n`;
  for (const r of results) {
    const icon = { PASS: "✅", FAIL: "❌", ERROR: "💥", SKIP: "⏭️" }[r.status];
    md += `| ${r.id} | ${r.title} | ${icon} ${r.status} | ${r.ms}ms | ${r.evidence.replace(/\|/g, "\\|")} |\n`;
  }

  md += `\n## 失败与跳过汇总\n\n`;
  const bad = results.filter((r) => r.status !== "PASS");
  if (bad.length === 0) {
    md += `无。\n`;
  } else {
    for (const r of bad) md += `- **${r.id} ${r.title}** [${r.status}]: ${r.evidence}\n`;
  }

  mkdirSync(REPORTS_DIR, { recursive: true });
  const reportPath = path.join(REPORTS_DIR, `run-${stamp}.md`);
  writeFileSync(reportPath, md, "utf8");

  console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`结果: PASS ${pass} · FAIL ${fail} · ERROR ${err} · SKIP ${skipped} / 共 ${results.length}`);
  if (skipped > 0) {
    console.log(`⚠️  有 ${skipped} 条被跳过 —— 跳过即视为失败（未验证 ≠ 通过）`);
  }
  console.log(`机器报告: ${reportPath}`);
  // SKIP 计入失败：见 TC-Z01 的说明。
  process.exit(fail + err + skipped > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error("运行器致命错误:", e);
  process.exit(1);
});
