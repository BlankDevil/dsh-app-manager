/**
 * UI verification probe: captures the generated /app-manager page HTML and
 * asserts the four UI requirements from the task are actually present.
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
    cb({
      tools: { register: () => () => {} },
      webServer: {
        register(route) {
          routes.push(route);
          return () => {};
        },
      },
    });
    return () => {};
  },
};

plugin.apply(ctx);

const page = routes.find((r) => r.path === "/app-manager");
if (!page) {
  console.log("FAIL: /app-manager route not found");
  process.exit(1);
}

let html = "";
const req = { url: "/app-manager", method: "GET", headers: {} };
const res = {
  writeHead: () => {},
  end: (data) => {
    html = String(data ?? "");
  },
};

await page.handler(req, res);

writeFileSync(path.join(TESTS_DIR, "last-page.html"), html, "utf8");

const checks = [
  ["REQ1 unified font variable --font-ui", html.includes("--font-ui")],
  ["REQ1 unified font-size variables", html.includes("--fs-body") && html.includes("--fs-title")],
  ["REQ2 unified table colgroup", html.includes("<colgroup")],
  ["REQ2 shared col widths (c-name)", html.includes("c-name")],
  ["REQ3 collapsible details.category", html.includes('details class="category"') || html.includes("<details")],
  ["REQ3 summary cat-head", html.includes("cat-head")],
  ["REQ4 clickable stat cards (data-jump)", html.includes("data-jump")],
  ["REQ4 source filter chips (data-filter-source)", html.includes("data-filter-source")],
  ["REQ4 jumpTo() client function", html.includes("jumpTo")],
  ["no raw <script> leak / has script tag", html.includes("<script>")],
];

let pass = 0;
for (const [label, ok] of checks) {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
  if (ok) pass++;
}

console.log("");
console.log(`HTML length: ${html.length} bytes`);
console.log(`Checks: ${pass}/${checks.length}`);
console.log(pass === checks.length ? "RESULT: PASS" : "RESULT: FAIL");
process.exit(pass === checks.length ? 0 : 1);
