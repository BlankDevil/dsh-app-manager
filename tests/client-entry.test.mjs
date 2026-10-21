#!/usr/bin/env node
/**
 * 客户端入口守卫 —— 「插件在 DSH Desktop 里有没有能点开的页面」
 *
 * 为什么需要这个文件
 * ------------------
 * 插件的主体 UI 是注册在 `webServer` 上的 `/app-manager` 页面。在 `dsh web` 里
 * 它一直能用，因为浏览器**有地址栏**，敲 URL 就到了。到了 DSH Desktop（Electron
 * 外壳）就"打不开"了 —— 外壳没有地址栏，插件页只能从壳里的 UI 进。
 *
 * 壳里唯一的入口是「插件 → 某个 bundle → 它的某一行 → 该行的配置页」，由
 * `plugins.row.config` 这个 **keyed slot** 提供，键的格式是：
 *
 *     `<bundle 包名>#<patch 里那一行的 id>`
 *
 * 这个键**写错了完全不报错**：行上只是不出现那个展开箭头，页面就此消失，
 * 没有任何日志、没有任何异常。所以它必须有断言守着，而且要同时守住三处：
 * 包名、patch 里的行 id、以及客户端注册里那个字符串。
 *
 * 本文件还守住 bundle 的**格式**：DSH 的客户端 bundle 不是浏览器直接加载的
 * ES module，而是调用 `window.__ModuleLoader__.load({ id, factory })` 的脚本；
 * 写成 `export function apply` 会解析成模块、永远不注册 factory —— 同样是静默失败。
 *
 * 运行：node tests/client-entry.test.mjs
 */

import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PLUGIN_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PKG = JSON.parse(readFileSync(path.join(PLUGIN_DIR, "package.json"), "utf8"));
const SRC_CLIENT = path.join(PLUGIN_DIR, "src", "client.js");
const LIB_CLIENT = path.join(PLUGIN_DIR, "lib", "client.js");

let checks = 0;
let failures = 0;

function ok(label, condition, detail) {
  checks += 1;
  if (condition) {
    console.log(`PASS  ${label}`);
  } else {
    failures += 1;
    console.log(`FAIL  ${label}  --  ${detail ?? ""}`);
  }
}

function eq(label, actual, expected) {
  ok(label, Object.is(actual, expected), `期望 ${JSON.stringify(expected)}，实际 ${JSON.stringify(actual)}`);
}

// ---------------------------------------------------------------- 1. 清单声明

console.log("=== 1. 清单声明 ===");

eq("dsh.client.platform 为 web（web 与 desktop 共用同一套客户端模块）", PKG.dsh?.client?.platform, "web");

const clientExport = PKG.exports?.["./client"];
const clientEntry = typeof clientExport === "string" ? clientExport : clientExport?.default;
ok(
  'exports["./client"] 指向一个字符串路径',
  typeof clientEntry === "string" && clientEntry.length > 0,
  `实际 ${JSON.stringify(clientExport)} —— 宿主靠它找浏览器半侧，缺了就没入口`
);

ok(
  "exports[\".\"] 仍然存在（加 exports 不能把包根入口打掉）",
  PKG.exports?.["."] !== undefined,
  "新增 exports 会屏蔽 main 字段；不写 \".\" 的话 dsh 连插件主体都 import 不到"
);

if (typeof clientEntry === "string") {
  ok(
    `client 入口文件存在：${clientEntry}`,
    existsSync(path.join(PLUGIN_DIR, clientEntry)),
    "声明了但没产物 —— dsh-client-modules 会在激活时直接失败"
  );
}

const entryPath = String(clientEntry ?? "").replace(/^\.\//, "");
ok(
  "client 入口落在 files 白名单内",
  Array.isArray(PKG.files) && entryPath.length > 0 && PKG.files.some((f) => entryPath.startsWith(f)),
  `files=${JSON.stringify(PKG.files)}，入口=${JSON.stringify(clientEntry)} —— 不在白名单的话 npm 包不带这个文件`
);

// ---------------------------------------------------------------- 2. bundle 格式

console.log("\n=== 2. bundle 格式与 factory ===");

ok("src/client.js 存在", existsSync(SRC_CLIENT), "浏览器半侧的源码");
ok(
  "lib/client.js 与 src/client.js 同步",
  existsSync(LIB_CLIENT) && readFileSync(LIB_CLIENT, "utf8") === readFileSync(SRC_CLIENT, "utf8"),
  "构建产物过期 —— 跑 node scripts/build-client.mjs"
);

const source = readFileSync(SRC_CLIENT, "utf8");
let spec = null;

globalThis.window = {
  __ModuleLoader__: {
    load(candidate) {
      spec = candidate;
    },
  },
  location: { protocol: "http:", origin: "http://127.0.0.1:3080" },
};

try {
  new Function(source)();
} catch (error) {
  ok("bundle 可以执行", false, String(error && error.message));
}

ok("调用了 window.__ModuleLoader__.load", spec !== null, "没调用就不会注册 factory（静默失败）");
eq("loader id 等于包名", spec?.id, PKG.name);
ok("factory 是函数", typeof spec?.factory === "function", `实际 ${typeof spec?.factory}`);

const reactStub = {
  createElement(type, props, ...children) {
    return { type, props: props ?? {}, children: children.flat() };
  },
};

const client = spec.factory((name) => {
  if (name === "react") return reactStub;
  throw new Error(`bundle 请求了未声明的模块: ${name}`);
});

ok("导出 apply", typeof client.apply === "function", "客户端插件必须导出 apply");
ok("导出 inject 服务列表", Array.isArray(client.inject), `实际 ${typeof client.inject}`);
ok("inject 含 slots（注册页面需要它）", (client.inject ?? []).includes("slots"), JSON.stringify(client.inject));

// ---------------------------------------------------------------- 3. 注册行为

console.log("\n=== 3. 注册到 plugins.row.config ===");

const patchText = readFileSync(path.join(PLUGIN_DIR, "patch.yml"), "utf8");
const rowId = patchText.match(/^\s*-\s*id:\s*([A-Za-z0-9._@/-]+)\s*$/m)?.[1];
ok("patch.yml 里有行 id", typeof rowId === "string" && rowId.length > 0, `读到 ${JSON.stringify(rowId)}`);

const calls = { injected: [], registered: [], locale: null };
const ctx = {
  locale: {
    bind: () => (key) => key,
    register(namespace, dictionaries) {
      calls.locale = { namespace, dictionaries };
      return () => {};
    },
  },
  slots: {
    inject(name, callback) {
      calls.injected.push(name);
      return callback();
    },
    register(options, component) {
      calls.registered.push({ options, component });
      return () => {};
    },
  },
  effect(run) {
    const dispose = run();
    return typeof dispose === "function" ? dispose : () => {};
  },
};

client.apply(ctx);

eq(
  "注册到两个 slot（行页面 + 页面头部动作）",
  JSON.stringify(calls.injected),
  JSON.stringify(["plugins.row.config", "plugins.detail.actions"])
);
eq("注册条目数", calls.registered.length, 2);

const reg = calls.registered.find((r) => r?.options?.name === "plugins.row.config");
const action = calls.registered.find((r) => r?.options?.name === "plugins.detail.actions");

ok("行页面已注册", reg !== undefined, "缺 plugins.row.config 就没有可展开的页面");
ok("页面头部动作已注册", action !== undefined, "缺 plugins.detail.actions 就没有「打开面板」按钮");

eq("slot 名", reg?.options?.name, "plugins.row.config");
eq(
  "slot key = 包名#行 id",
  reg?.options?.key,
  `${PKG.name}#${rowId}`
);
ok(
  "key 与导出常量一致",
  reg?.options?.key === client.ROW_KEY,
  `常量 ${JSON.stringify(client.ROW_KEY)}，注册 ${JSON.stringify(reg?.options?.key)}`
);
eq("locale 命名空间", reg?.options?.locale, client.NS);
eq("词典同时提供 zh / en", Object.keys(reg ? calls.locale.dictionaries : {}).sort().join(","), "en,zh");
ok("注册的组件是函数组件", typeof reg?.component === "function", `实际 ${typeof reg?.component}`);
ok("头部动作是函数组件", typeof action?.component === "function", `实际 ${typeof action?.component}`);

// ---------------------------------------------------------------- 4. 渲染与地址

console.log("\n=== 4. 渲染：两端同源推导地址 ===");

const t = (key) => `T:${key}`;

/** Flatten the text out of a string / element / element array. */
function textOf(node) {
  if (node === null || node === undefined) return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  return textOf(node.children);
}

const summary = reg.component({ view: "summary", t });
ok(
  "view=summary 返回一段单行说明（不是 iframe）",
  textOf(summary).length > 0 && !JSON.stringify(summary).includes('"iframe"'),
  `实际 ${JSON.stringify(summary)} —— 行标题下面那行说明为空的话，卡片看起来像没有描述`
);

/** 在当前模拟 origin 下渲染页面视图，返回 iframe 元素。 */
function renderPage() {
  const tree = reg.component({ view: "page", t });
  const stack = [tree];
  while (stack.length > 0) {
    const node = stack.pop();
    if (!node || typeof node !== "object") continue;
    if (node.type === "iframe") return node;
    for (const child of node.children ?? []) stack.push(child);
  }
  return null;
}

for (const origin of ["http://127.0.0.1:3080", "http://127.0.0.1:19387"]) {
  window.location = { protocol: "http:", origin };
  const frame = renderPage();
  ok(
    `view=page 含 iframe（origin=${origin}）`,
    frame !== null,
    "没有 iframe，页面就没有内容"
  );
  eq(`iframe 指向同源的 ${client.PAGE_PATH}`, frame?.props?.src, origin + client.PAGE_PATH);
  ok("iframe 有 title（无障碍）", typeof frame?.props?.title === "string" && frame.props.title.length > 0, "");
}

window.location = { protocol: "file:", origin: "null" };
const fileFrame = renderPage();
eq("非 http(s) 外壳下退化为根相对路径", fileFrame?.props?.src, client.PAGE_PATH);

// ---------------------------------------------------------------- 5. 页面头部按钮

console.log("\n=== 5. 页面头部「打开面板」按钮 ===");

window.location = { protocol: "http:", origin: "http://127.0.0.1:19387" };

const foreign = action.component({
  t,
  subject: { kind: "bundle", pkg: { name: "some-other-plugin", installed: true, enabled: true, rows: [] } },
});
eq("别人的插件页上不渲染", foreign, null);

const itemSubject = action.component({ t, subject: { kind: "item", id: "x" } });
eq("官方插件页（无 pkg）上不渲染", itemSubject, null);

const ownBundle = action.component({
  t,
  subject: { kind: "bundle", pkg: { name: PKG.name, installed: true, enabled: true, rows: [] } },
});
ok("自己的 bundle 页上渲染按钮", ownBundle !== null && typeof ownBundle === "object", `实际 ${JSON.stringify(ownBundle)}`);
eq("按钮指向同源的 dashboard", ownBundle?.props?.href, "http://127.0.0.1:19387" + client.PAGE_PATH);
ok("按钮在新标签页打开", ownBundle?.props?.target === "_blank", `实际 ${JSON.stringify(ownBundle?.props?.target)}`);
ok("按钮有可见文案", textOf(ownBundle).length > 0, "空按钮等于没有按钮");

const ownRow = action.component({
  t,
  subject: {
    kind: "row",
    pkg: { name: PKG.name, installed: true, enabled: true, rows: [{ rowId: rowId }] },
    row: { rowId },
  },
});
ok("自己的行页面上同样渲染按钮", ownRow !== null && textOf(ownRow).length > 0, `实际 ${JSON.stringify(ownRow)}`);

console.log(`\n=== 结果：${checks - failures}/${checks} 通过${failures ? `，${failures} 项失败 ✗` : " ✓"} ===`);
if (failures > 0) {
  console.log(
    "提示：`plugins.row.config` 的 key 必须是 `<bundle 包名>#<patch 行 id>`，\n" +
      "      写错不会报错 —— 行上直接没有展开箭头，页面静默消失。"
  );
}
process.exit(failures === 0 ? 0 : 1);
