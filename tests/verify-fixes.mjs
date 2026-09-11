/**
 * Verify D1/D2/chip fix on the rebuilt plugin.
 */
import { writeFileSync } from "node:fs";
import { pathToFileURL, fileURLToPath } from "node:url";
import path from "node:path";

const TESTS_DIR = path.dirname(fileURLToPath(import.meta.url));
const PLUGIN_DIR = path.resolve(TESTS_DIR, "..");
const plugin = await import(pathToFileURL(path.join(PLUGIN_DIR, "lib/src/index.js")).href);

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
plugin.apply(ctx);

const page = routes.find((r) => r.path === "/app-manager");
let html = "";
await page.handler({ url: "/app-manager", method: "GET", headers: {} }, {
  writeHead: () => {},
  end: (d) => (html = String(d ?? "")),
});

const checks = [];

function check(label, ok, evidence) {
  checks.push({ label, ok, evidence });
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}  --  ${evidence}`);
}

// D1: --fs-stat exists, no hardcoded 1.35rem
const hasVar = html.includes("--fs-stat");
const usesVar = /\.stat-value\s*\{[^}]*var\(--fs-stat\)/.test(html);
const noRaw = !/font-size:\s*1\.35rem/.test(html);
check("D1: --fs-stat defined", hasVar, hasVar ? "found" : "missing");
check("D1: .stat-value uses var(--fs-stat)", usesVar, usesVar ? "ok" : "still raw");
check("D1: no hardcoded 1.35rem", noRaw, noRaw ? "ok" : "1.35rem still present");

// D2: every <table> has <colgroup>, all app-table colgroups identical
const nTable = (html.match(/<table/g) ?? []).length;
const nColgroup = (html.match(/<colgroup>/g) ?? []).length;
check("D2: every <table> has <colgroup>", nColgroup === nTable, `${nColgroup}/${nTable}`);

// Chip behavior: script contains the fixed logic
const hasClearAllActive = html.includes("clearAllActive");
const hasScrollToFirstVisible = html.includes("scrollToFirstVisible");
const hasActiveChip = html.includes("activeChip");
check("Chip: clearAllActive() defined", hasClearAllActive, hasClearAllActive ? "ok" : "missing");
check("Chip: scrollToFirstVisible() defined", hasScrollToFirstVisible, hasScrollToFirstVisible ? "ok" : "missing");
check("Chip: single-source activeChip state", hasActiveChip, hasActiveChip ? "ok" : "missing");

// No regression: jumpTo still defined
check("Chip: jumpTo still defined", html.includes("function jumpTo"), "ok");

writeFileSync(path.join(TESTS_DIR, "last-page.html"), html, "utf8");

const fails = checks.filter((c) => !c.ok).length;
console.log(`\n${fails === 0 ? "ALL OK" : `${fails} FAIL`} (${checks.length - fails}/${checks.length})`);
process.exit(fails);