/**
 * Feature smoke test for the 0.4.3 work: S6/S7/S9 + Q6/Q7.
 * Dev-time smoke only (not the full suite).
 */
import { writeFileSync } from "node:fs";
import { pathToFileURL, fileURLToPath } from "node:url";
import path from "node:path";

const TESTS_DIR = path.dirname(fileURLToPath(import.meta.url));
const PLUGIN_DIR = path.resolve(TESTS_DIR, "..");
const plugin = await import(pathToFileURL(path.join(PLUGIN_DIR, "lib/src/index.js")).href);

const routes = [];
const ctx = {
  logger: { info: () => {} },
  inject(_deps, cb) {
    cb({ tools: { register: () => () => {} }, webServer: { register: (r) => (routes.push(r), () => {}) } });
    return () => {};
  },
};
plugin.apply(ctx);

const page = routes.find((r) => r.path === "/app-manager");
let html = "";
await page.handler({ url: "/app-manager", method: "GET", headers: {} }, { writeHead: () => {}, end: (d) => (html = String(d ?? "")) });

const checks = [];
const check = (label, ok, ev) => { checks.push(ok); console.log(`${ok ? "PASS" : "FAIL"}  ${label}${ev ? "  --  " + ev : ""}`); };

// S9: light theme default + dark via media query
check("S9: light theme default (--bg #ffffff)", html.includes("--bg: #ffffff"));
check("S9: dark via prefers-color-scheme", html.includes("@media (prefers-color-scheme: dark)"));
// S9: colors are tokenised — raw rgba may only appear inside :root token defs,
// never in a rule body (which is what made the dark-only theme unmaintainable).
const rulesOutsideTokens = html.replace(/:root\s*\{[\s\S]*?\}/g, "");
check("S9: no raw rgba in rule bodies", !/rgba\(\d+,\s*\d+,\s*\d+/.test(rulesOutsideTokens));
check("S9: tokens used for hover/head/count", html.includes("var(--hover-row)") && html.includes("var(--head-bg)") && html.includes("var(--count-bg)"));

// S7: resizable columns + tooltip
check("S7: col-resizer handles present", (html.match(/col-resizer/g) ?? []).length >= 7);
check("S7: pointerdown resize logic", html.includes("col-resizing"));
check("S7: tooltip refresh logic", html.includes("refreshTooltips"));
check("S7: tooltip only when overflow", html.includes("scrollWidth > td.clientWidth"));
check("S7: NO auto-shrink (fixed px widths)", html.includes("savedWidths[cls] = Math.round(w)"));

// Q6: draggable categories, AI first.
// NOTE: implemented with Pointer Events, NOT native HTML5 DnD — the old
// preventDefault-on-pointerdown approach killed dragstart entirely. Behaviour
// is covered by drag-behavior.test.mjs; here we only check the wiring exists.
check("Q6: drag-grip present", html.includes("drag-grip"));
check("Q6: pointer-driven section drag", html.includes("startSectionDrag") && html.includes("sectionUnderPointer"));
check("Q6: grip click suppressed", /drag-grip[\s\S]{0,900}stopPropagation/.test(html) || html.includes("cat-dragging"));
check("Q6: order persisted", html.includes("dsh-app-manager:catorder"));
check("Q6: no native draggable on sections", !html.includes("setAttribute('draggable'"));
const aiIdx = html.indexOf('data-category="ai"');
const firstCatIdx = html.search(/data-category="/);
check("Q6: AI category rendered first", aiIdx >= 0 && aiIdx === firstCatIdx, `ai@${aiIdx} first@${firstCatIdx}`);

// Q7: drag rows between categories (Pointer Events, threshold-gated).
check("Q7: row grip present", html.includes("row-grip"));
check("Q7: rows NOT natively draggable", !html.includes('draggable="true" data-app='));
check("Q7: row drag threshold", html.includes("ROW_DRAG_THRESHOLD"));
check("Q7: moves persisted", html.includes("dsh-app-manager:moves"));
check("Q7: counts refresh after move", html.includes("refreshCounts"));

// D1/D2 regressions
check("D1: --fs-stat still used", html.includes("var(--fs-stat)"));
check("D2: all tables have colgroup", (html.match(/<table/g) ?? []).length === (html.match(/<colgroup>/g) ?? []).length);

writeFileSync(path.join(TESTS_DIR, "last-page.html"), html, "utf8");

const pass = checks.filter(Boolean).length;
console.log(`\n${pass === checks.length ? "ALL OK" : "FAILURES"} (${pass}/${checks.length})`);
console.log(`HTML: ${html.length} bytes`);
process.exit(pass === checks.length ? 0 : 1);
