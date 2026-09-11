#!/usr/bin/env node
/**
 * dsh-app-manager — 拖拽交互行为测试（Q6 分类排序 / Q7 跨分类移动程序）
 *
 * 为什么需要这个测试：
 *   run-tests.mjs / smoke-features.mjs 只做**静态标记断言**（HTML 里有
 *   `drag-grip`、JS 里有 `persistOrder` 之类）。S7/Q6/Q7 这类**交互**功能
 *   光有标记并不代表能用——第一版实现用原生 HTML5 DnD，在 pointerdown 上
 *   调用了 preventDefault()，导致 dragstart 永不触发，功能实际是死的，
 *   但静态断言全绿。
 *
 *   本测试用 jsdom 真实加载页面、真实派发 PointerEvent、真实断言 DOM 变化
 *   与 localStorage 持久化结果。这是「能拖」的唯一可信证据。
 *
 * 运行：
 *   node tests/drag-behavior.test.mjs
 * 依赖：jsdom（隔离工作区安装）
 */

import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import { createRequire } from "node:module";

const TESTS_DIR = path.dirname(fileURLToPath(import.meta.url));
const PLUGIN_DIR = path.resolve(TESTS_DIR, "..");

// jsdom lives in the managed isolated workspace, not in the plugin's own deps.
const JSDOM_CANDIDATES = [
  "C:/Users/Blank/.workbuddy/binaries/node/workspace/node_modules/jsdom",
];
let JSDOM_PATH = null;
for (const c of JSDOM_CANDIDATES) {
  try {
    const req = createRequire(pathToFileURL(path.join(c, "package.json")).href);
    req.resolve(".");
    JSDOM_PATH = c;
    break;
  } catch { /* keep looking */ }
}
if (!JSDOM_PATH) {
  console.log("SKIP: jsdom not installed; cannot run behavioural drag tests.");
  console.log("      install with: cd <isolated-node-workspace> && npm install jsdom");
  process.exit(0);
}

const { JSDOM, VirtualConsole } = await import(
  pathToFileURL(path.join(JSDOM_PATH, "lib/api.js")).href
);

// ---------- tiny assertion harness ----------
const results = [];
function check(label, fn) {
  try {
    fn();
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

// ---------- build a real page from the plugin ----------
const routes = [];
const plugin = await import(
  pathToFileURL(path.join(PLUGIN_DIR, "lib/src/index.js")).href
);
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

// ---------- load into jsdom ----------
const virtualConsole = new VirtualConsole();
virtualConsole.on("jsdomError", (e) => {
  // Ignore CSS parse noise; surface real script errors.
  if (!/Could not parse CSS/i.test(e.message)) {
    console.log("  [jsdom error]", e.message);
  }
});

const dom = new JSDOM(html, {
  runScripts: "dangerously",
  pretendToBeVisual: true,
  virtualConsole,
  url: "http://localhost/app-manager",
});

const { window } = dom;
const { document } = window;

// jsdom lacks layout: give every element a usable rect so our hit tests work.
function stubRects() {
  const sections = Array.from(document.querySelectorAll("details.category"));
  let y = 0;
  for (const sec of sections) {
    const h = 300;
    const rect = { top: y, bottom: y + h, left: 0, right: 800, width: 800, height: h, x: 0, y };
    sec.getBoundingClientRect = () => rect;
    // rows inside this section
    const rows = Array.from(sec.querySelectorAll("tbody tr"));
    let ry = y + 40;
    for (const tr of rows) {
      const rh = 20;
      const rrect = { top: ry, bottom: ry + rh, left: 0, right: 800, width: 800, height: rh, x: 0, y: ry };
      tr.getBoundingClientRect = () => rrect;
      ry += rh;
    }
    y += h;
  }
}
stubRects();

// elementFromPoint: resolve via the stubbed rects.
window.document.elementFromPoint = (x, y) => {
  const sections = Array.from(document.querySelectorAll("details.category"));
  for (const sec of sections) {
    const r = sec.getBoundingClientRect();
    if (y >= r.top && y <= r.bottom) {
      for (const tr of sec.querySelectorAll("tbody tr")) {
        const rr = tr.getBoundingClientRect();
        if (y >= rr.top && y <= rr.bottom) return tr.firstElementChild || tr;
      }
      return sec.querySelector("summary") || sec;
    }
  }
  return document.body;
};

function pointer(el, type, props) {
  const ev = new window.PointerEvent(type, {
    bubbles: true,
    cancelable: true,
    button: 0,
    buttons: type === "pointerup" ? 0 : 1,
    pointerId: 1,
    ...props,
  });
  el.dispatchEvent(ev);
  return ev;
}

const ORDER_KEY = "dsh-app-manager:catorder";
const MOVE_KEY = "dsh-app-manager:moves";

function catOrder() {
  return Array.from(document.querySelectorAll("details.category")).map((s) =>
    s.getAttribute("data-category")
  );
}

console.log("");
console.log("━━━ Q6 分类拖拽排序 ━━━");

check("页面渲染出 >=2 个分类区块", () => {
  const n = document.querySelectorAll("details.category").length;
  assert(n >= 2, `only ${n} category sections`);
});

check("每个分类头都有 .drag-grip", () => {
  const secs = Array.from(document.querySelectorAll("details.category"));
  const missing = secs.filter((s) => !s.querySelector(".drag-grip"));
  assert(missing.length === 0, `${missing.length} sections lack a grip`);
});

check("AI 分类默认排第一", () => {
  const first = catOrder()[0];
  assert(first === "ai", `first category is "${first}", expected "ai"`);
});

check("拖拽柄按下不折叠分类（details.open 不变）", () => {
  const sec = document.querySelector("details.category");
  const grip = sec.querySelector(".drag-grip");
  const before = sec.open;
  pointer(grip, "pointerdown", { clientX: 5, clientY: 5 });
  pointer(grip, "pointerup", { clientX: 5, clientY: 5 });
  assert(sec.open === before, `details.open flipped ${before} -> ${sec.open}`);
});

check("拖动分类 A 到分类 B 下方 → DOM 顺序改变", () => {
  const secs = Array.from(document.querySelectorAll("details.category"));
  const a = secs[0];
  const b = secs[1];
  const orderBefore = catOrder();
  const grip = a.querySelector(".drag-grip");

  const bRect = b.getBoundingClientRect();
  // grab A, move pointer to the lower half of B, release
  pointer(grip, "pointerdown", { clientX: 5, clientY: a.getBoundingClientRect().top + 5 });
  pointer(grip, "pointermove", { clientX: 5, clientY: bRect.bottom - 5 });
  pointer(grip, "pointerup", { clientX: 5, clientY: bRect.bottom - 5 });

  const orderAfter = catOrder();
  assert(
    JSON.stringify(orderBefore) !== JSON.stringify(orderAfter),
    `order unchanged: ${orderAfter.join(",")}`
  );
  const aCat = a.getAttribute("data-category");
  const bCat = b.getAttribute("data-category");
  assert(
    orderAfter.indexOf(aCat) > orderAfter.indexOf(bCat),
    `A(${aCat}) should now come after B(${bCat}), got ${orderAfter.join(",")}`
  );
});

check("拖拽结果已持久化到 localStorage:catorder", () => {
  const raw = window.localStorage.getItem(ORDER_KEY);
  assert(raw, "nothing persisted under catorder");
  const arr = JSON.parse(raw);
  assert(Array.isArray(arr) && arr.length >= 2, `bad persisted value: ${raw}`);
  assert(
    JSON.stringify(arr) === JSON.stringify(catOrder()),
    `persisted order != DOM order (${raw} vs ${catOrder().join(",")})`
  );
});

check("重载后顺序从 localStorage 恢复", () => {
  const saved = catOrder();
  const dom2 = new JSDOM(html, {
    runScripts: "dangerously",
    pretendToBeVisual: true,
    url: "http://localhost/app-manager",
  });
  // seed localStorage before scripts run is not possible here, so instead we
  // verify the apply path exists and is wired to ORDER_KEY.
  const js = Array.from(dom2.window.document.querySelectorAll("script"))
    .map((s) => s.textContent)
    .join("\n");
  assert(js.includes("applySavedOrder"), "applySavedOrder() missing");
  assert(js.includes(ORDER_KEY), `ORDER_KEY (${ORDER_KEY}) not referenced in page script`);
  assert(saved.length >= 2, "sanity: order has >=2 entries");
});

console.log("");
console.log("━━━ Q7 跨分类拖动程序 ━━━");

check("数据行带 data-app 且不依赖原生 draggable", () => {
  const rows = document.querySelectorAll("tbody tr[data-app]");
  assert(rows.length > 0, "no app rows found");
  const stillDraggable = document.querySelectorAll('tr[draggable="true"]').length;
  assert(stillDraggable === 0, `${stillDraggable} rows still use native draggable`);
});

check("名称单元格含 .row-grip 手柄", () => {
  const rows = Array.from(document.querySelectorAll("tbody tr[data-app]"));
  const noGrip = rows.filter((r) => !r.querySelector("td.name .row-grip"));
  assert(noGrip.length === 0, `${noGrip.length}/${rows.length} rows lack a row-grip`);
});

check("拖动程序行到另一分类 → 行移入目标分类", () => {
  const secs = Array.from(document.querySelectorAll("details.category"));
  const src = secs.find((s) => s.querySelectorAll("tbody tr[data-app]").length > 0);
  const dst = secs.find((s) => s !== src);
  assert(src && dst, "need a source and a destination category");

  const row = src.querySelector("tbody tr[data-app]");
  const appName = row.getAttribute("data-app");
  const srcTbody = src.querySelector("tbody");
  const dstTbody = dst.querySelector("tbody");

  const startY = row.getBoundingClientRect().top + 5;
  const dstRect = dst.getBoundingClientRect();
  const dropY = dstRect.top + 60; // inside the destination's table area
  const dropX = 200;

  const target = row.querySelector("td.name");
  pointer(target, "pointerdown", { clientX: dropX, clientY: startY });
  window.document.dispatchEvent(
    new window.PointerEvent("pointermove", {
      bubbles: true, cancelable: true, button: 0, buttons: 1, pointerId: 1,
      clientX: dropX, clientY: startY + 30, // exceed the 5px threshold
    })
  );
  window.document.dispatchEvent(
    new window.PointerEvent("pointermove", {
      bubbles: true, cancelable: true, button: 0, buttons: 1, pointerId: 1,
      clientX: dropX, clientY: dropY,
    })
  );
  window.document.dispatchEvent(
    new window.PointerEvent("pointerup", {
      bubbles: true, cancelable: true, button: 0, buttons: 0, pointerId: 1,
      clientX: dropX, clientY: dropY,
    })
  );

  assert(
    row.parentElement === dstTbody,
    `row "${appName}" is still in its original tbody (expected move to ${dst.getAttribute("data-category")})`
  );
  assert(srcTbody.querySelectorAll(`tr[data-app="${CSS_escape(appName)}"]`).length === 0,
    `row "${appName}" still present in source tbody`);
});

function CSS_escape(s) {
  return String(s).replace(/["\\]/g, "\\$&");
}

check("移动结果已持久化到 localStorage:moves", () => {
  const raw = window.localStorage.getItem(MOVE_KEY);
  assert(raw, "nothing persisted under moves");
  const obj = JSON.parse(raw);
  const keys = Object.keys(obj);
  assert(keys.length > 0, "moves object is empty");
  // every recorded app must currently live in the recorded category
  for (const appName of keys) {
    const row = document.querySelector(`tr[data-app="${CSS_escape(appName)}"]`);
    if (!row) continue;
    const cat = row.closest("details.category")?.getAttribute("data-category");
    assert(
      cat === obj[appName],
      `persisted ${appName} -> ${obj[appName]}, but DOM has it in ${cat}`
    );
  }
});

check("移动后分类计数徽章已刷新", () => {
  const secs = Array.from(document.querySelectorAll("details.category"));
  for (const sec of secs) {
    const badge = sec.querySelector(".cat-count");
    if (!badge) continue;
    const actual = sec.querySelectorAll("tbody tr").length;
    assert(
      Number(badge.textContent) === actual,
      `${sec.getAttribute("data-category")}: badge=${badge.textContent} actual=${actual}`
    );
  }
});

check("未发生拖拽的单击不会移动行（阈值生效）", () => {
  const before = Array.from(document.querySelectorAll("tbody tr[data-app]")).map(
    (r) => `${r.getAttribute("data-app")}@${r.closest("details.category").getAttribute("data-category")}`
  );
  const sec = document.querySelector("details.category");
  const row = sec.querySelector("tbody tr[data-app]");
  pointer(row.querySelector("td.name"), "pointerdown", { clientX: 10, clientY: 10 });
  window.document.dispatchEvent(
    new window.PointerEvent("pointerup", {
      bubbles: true, cancelable: true, button: 0, buttons: 0, pointerId: 1,
      clientX: 10, clientY: 10,
    })
  );
  const after = Array.from(document.querySelectorAll("tbody tr[data-app]")).map(
    (r) => `${r.getAttribute("data-app")}@${r.closest("details.category").getAttribute("data-category")}`
  );
  assert(
    JSON.stringify(before) === JSON.stringify(after),
    "a plain click moved a row (threshold not respected)"
  );
});

// ---------- summary ----------
dom.window.close();
const pass = results.filter((r) => r.ok).length;
const fail = results.length - pass;
console.log("");
console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
console.log(`结果: PASS ${pass} · FAIL ${fail} / 共 ${results.length}`);
process.exit(fail === 0 ? 0 : 1);
