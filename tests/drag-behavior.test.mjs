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
 * 依赖：jsdom >= 27（已列为 devDependency，`pnpm install` 即得）
 *       jsdom 26 及更早没有 PointerEvent 构造器，无法运行本测试。
 */

import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import { createRequire } from "node:module";

const TESTS_DIR = path.dirname(fileURLToPath(import.meta.url));
const PLUGIN_DIR = path.resolve(TESTS_DIR, "..");

/**
 * Locate jsdom.
 *
 * Order matters: normal module resolution first, so a plain `pnpm install`
 * (which now includes jsdom as a devDependency) is enough — that is what CI
 * relies on. `DSH_TEST_JSDOM_DIR` is an escape hatch for keeping jsdom outside
 * the repo, which is how this project was originally developed.
 *
 * Note: this deliberately contains NO hardcoded absolute path. An earlier
 * revision pointed at a specific developer's `~/.workbuddy/...` directory,
 * which both leaked that layout into a public repo and made CI silently SKIP
 * all 13 checks (the skip exits 0, so green CI with zero drag coverage).
 */
function resolveJsdom() {
  // Resolve EAGERLY inside the try — a lazy `() => req("jsdom")` closure would
  // not throw here, so the fallback would never be reached.
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
  // 退出码非 0，**不是** 0 —— 这是刻意的。
  //
  // 本文件曾在这里 `exit(0)`：缺 jsdom 时打印一行 SKIP 就"成功"结束，于是
  // 「拖拽一条都没验」和「拖拽 13 条全过」在 CI 里长得一模一样。本仓库真的
  // 被这个坑骗过一次（见 CHANGELOG 0.5.1：硬编码 jsdom 路径使 13 条检查
  // 静默全跳过，CI 全绿而覆盖为零）。
  //
  // 现在：跳过 = 失败。要让它通过，就装 jsdom，或用 DSH_TEST_JSDOM_DIR 指过去。
  console.error("FAIL: jsdom not installed; behavioural drag tests cannot run.");
  console.error("      install with: pnpm add -D jsdom");
  console.error("      (or set DSH_TEST_JSDOM_DIR to a directory containing it)");
  console.error("      未验证 ≠ 通过 —— 本组跳过一律按失败处理（退出码 3）。");
  process.exit(3);
}

const { JSDOM, VirtualConsole } = JSDOM_SOURCE.mod;

// jsdom only gained a PointerEvent constructor in v27.0.0, and the page's drag
// handling is driven by real pointer events — so an older jsdom would fail here
// with a confusing "PointerEvent is not a constructor". Fail with the reason
// instead. (jsdom >= 27 also requires Node >= 20, hence the CI Node version.)
if (typeof new JSDOM("<p></p>").window.PointerEvent !== "function") {
  console.error(
    `FAIL: this jsdom build has no PointerEvent constructor (expected jsdom >= 27).\n` +
      `      loaded from: ${JSDOM_SOURCE.from}\n` +
      `      jsdom 26 and earlier do not implement PointerEvent, and the drag\n` +
      `      behaviour under test is delivered entirely through pointer events.`
  );
  process.exit(1);
}

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

/**
 * Load the page again with localStorage pre-seeded.
 *
 * jsdom runs inline scripts during construction, so localStorage has to be
 * written *before* the page's own script executes. That is done by injecting a
 * seed script at the top of <head>; it also stubs `fetch` because the page
 * fires a few background requests that jsdom cannot serve.
 *
 * Without this, "the order is restored after a reload" could only be asserted
 * statically — which is exactly how the persistence bug went unnoticed.
 */
function loadSeeded(seed) {
  const seedJs =
    "<script>try{" +
    Object.entries(seed)
      .map(([k, v]) => `localStorage.setItem(${JSON.stringify(k)},${JSON.stringify(v)});`)
      .join("") +
    "}catch(e){}" +
    "window.fetch=function(){return Promise.resolve({ok:true,json:function(){return Promise.resolve({});},text:function(){return Promise.resolve('')}});};" +
    "</script>";
  const dom2 = new JSDOM(html.replace("<head>", "<head>" + seedJs), {
    runScripts: "dangerously",
    pretendToBeVisual: true,
    virtualConsole,
    url: "http://localhost/app-manager",
  });
  const secs = Array.from(dom2.window.document.querySelectorAll("details.category"));
  let y = 0;
  for (const sec of secs) {
    const h = 300;
    const rect = { top: y, bottom: y + h, left: 0, right: 800, width: 800, height: h, x: 0, y };
    sec.getBoundingClientRect = () => rect;
    y += h;
  }
  return dom2;
}

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

check("重载后顺序从 localStorage 恢复（真·行为断言）", () => {
  // The previous revision of this check only asserted that the page script
  // contained the strings "applySavedOrder" and ORDER_KEY — a static check
  // that passes even if the restore path is broken. It is replaced by an
  // actual reload: seed localStorage with the order we just persisted, load
  // the page again, and compare the rendered DOM order.
  const expected = catOrder();
  const raw = window.localStorage.getItem(ORDER_KEY);
  assert(raw, "no persisted order to reload with");

  const dom2 = loadSeeded({ [ORDER_KEY]: raw });
  const actual = Array.from(dom2.window.document.querySelectorAll("details.category")).map(
    (s) => s.getAttribute("data-category")
  );
  dom2.window.close();

  assert(
    JSON.stringify(actual) === JSON.stringify(expected),
    `reload lost the order: expected ${expected.join(",")}, got ${actual.join(",")}`
  );
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

check("重载后跨分类移动仍然生效（真·行为断言）", () => {
  const raw = window.localStorage.getItem(MOVE_KEY);
  assert(raw, "no persisted moves to reload with");
  const obj = JSON.parse(raw);
  const names = Object.keys(obj);
  assert(names.length > 0, "persisted moves object is empty");

  const dom3 = loadSeeded({ [MOVE_KEY]: raw });
  for (const appName of names) {
    const row = Array.from(dom3.window.document.querySelectorAll("tbody tr[data-app]")).find(
      (r) => r.getAttribute("data-app") === appName
    );
    if (!row) continue;
    const cat = row.closest("details.category")?.getAttribute("data-category");
    dom3.window.close();
    assert(cat === obj[appName], `after reload ${appName} is in ${cat}, expected ${obj[appName]}`);
    return;
  }
  dom3.window.close();
  assert(false, "none of the moved apps were found after reload");
});

console.log("");
console.log("━━━ 搜索框 ━━━");

check("工具栏存在搜索输入框", () => {
  const el = document.getElementById("app-search");
  assert(el, "#app-search not found");
  assert(el.getAttribute("type") === "search", `type is ${el.getAttribute("type")}`);
  const toolbar = el.closest(".toolbar");
  assert(toolbar, "search box is not inside the toolbar");
  const refresh = document.getElementById("refresh-btn");
  assert(refresh, "refresh button missing");
  // It must sit on the same row as the search box: same parent element.
  assert(refresh.parentElement === toolbar, "refresh button is not in the toolbar");
  // The storage warning must be present but hidden while storage works —
  // without it, a blocked localStorage silently reverts drag changes.
  const warn = document.getElementById("storage-warn");
  assert(warn, "#storage-warn missing");
  assert(warn.hidden, "storage warning should be hidden when localStorage works");
});

check("刷新按钮紧挨在倒计时右侧（右对齐的那一组）", () => {
  // Requested layout: the status/countdown and the refresh button form one
  // adjacent, right-aligned cluster at the end of the row; the search box
  // stays with the left-hand controls.
  const toolbar = document.querySelector(".toolbar");
  const status = document.getElementById("refresh-status");
  const refresh = document.getElementById("refresh-btn");
  const search = document.getElementById("app-search");
  assert(status && refresh && search, "toolbar elements missing");

  const order = Array.from(toolbar.children);
  const iStatus = order.indexOf(status);
  const iRefresh = order.indexOf(refresh);
  const iSearch = order.indexOf(search);

  assert(
    iRefresh === iStatus + 1,
    `refresh button must sit immediately after the countdown (status@${iStatus}, refresh@${iRefresh})`
  );
  assert(
    iSearch < iStatus,
    `search box must stay left of the right-aligned cluster (search@${iSearch}, status@${iStatus})`
  );

  // The spacer that pushes the cluster right must be on the countdown, not on
  // the search box — otherwise the cluster would not be flush right.
  const style = window.getComputedStyle(status);
  assert(
    style.marginLeft === "auto",
    `#refresh-status should carry margin-left:auto, got "${style.marginLeft}"`
  );
  const searchStyle = window.getComputedStyle(search);
  assert(
    searchStyle.marginLeft !== "auto",
    "#app-search must not carry margin-left:auto (keeps it in the left group)"
  );
});

check("输入关键字后只保留匹配的行", () => {
  const el = document.getElementById("app-search");
  const rows = Array.from(document.querySelectorAll("tbody tr[data-app]"));
  assert(rows.length > 0, "no rows to filter");
  const target = rows[0].getAttribute("data-app");

  el.value = target;
  el.dispatchEvent(new window.Event("input", { bubbles: true }));

  const visible = Array.from(document.querySelectorAll("tbody tr[data-app]")).filter(
    (r) => !r.classList.contains("tool-row-hidden")
  );
  assert(visible.length > 0, "search hid every row");
  assert(
    visible.every((r) => {
      const name = (r.getAttribute("data-app") || "").toLowerCase();
      const cmd = (r.getAttribute("data-cmd") || "").toLowerCase();
      const q = target.toLowerCase();
      return name.includes(q) || cmd.includes(q);
    }),
    "a visible row does not match the query"
  );

  // Clearing the box restores every row.
  el.value = "";
  el.dispatchEvent(new window.Event("input", { bubbles: true }));
  const restored = Array.from(document.querySelectorAll("tbody tr[data-app]")).filter(
    (r) => !r.classList.contains("tool-row-hidden")
  );
  assert(restored.length === rows.length, `clearing hid rows: ${restored.length}/${rows.length}`);
});

check("无命令的包显示为 no command 而不是 PATH 缺失", () => {
  const rows = Array.from(document.querySelectorAll("tbody tr[data-app]"));
  const noCmd = rows.filter((r) => r.getAttribute("data-cmd") === "");
  if (noCmd.length === 0) return; // machine-dependent; nothing to assert
  for (const r of noCmd) {
    const status = r.querySelector("td.status-cell");
    assert(status, "row has no status cell");
    assert(
      /no command/.test(status.textContent),
      `a package with no command shows "${status.textContent.trim()}"`
    );
    assert(
      !r.querySelector("button.name-btn"),
      "a package with no command must not be launchable"
    );
  }
});

// ---------- summary ----------
dom.window.close();
const pass = results.filter((r) => r.ok).length;
const fail = results.length - pass;
console.log("");
console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
console.log(`结果: PASS ${pass} · FAIL ${fail} / 共 ${results.length}`);
process.exit(fail === 0 ? 0 : 1);
