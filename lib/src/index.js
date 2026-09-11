/**
 * DSH App Manager Plugin
 * Registers AI-callable tools and a web management page for CLI applications.
 */
import { buildScanReport, discoverAll, discoverUnmanaged, findApp, readManagedBaseline } from "./discovery.js";
import { commandExists, compareVersions, execSafe } from "./utils.js";
/**
 * Project a markdown string into DSH content blocks.
 *
 * DSH 0.1.5 requires `output.render` to return `ContentBlock[]` rather than the
 * bare string the older API accepted, so every tool funnels its markdown result
 * through this helper.
 */
function asText(text) {
    return [{ type: "text", text }];
}
/**
 * Format app list as a concise markdown table for LLM consumption
 */
function formatAppList(apps) {
    if (apps.length === 0)
        return "No CLI applications discovered.";
    const managedCount = apps.filter((a) => a.managed).length;
    const lines = [
        `${apps.length} apps (${managedCount} managed, ${apps.length - managedCount} unmanaged)`,
        "",
        "| Name | Version | Commands | Source | Install |",
        "|------|---------|----------|--------|---------|",
    ];
    for (const app of apps) {
        const install = app.managed ? "managed" : app.installKind;
        lines.push(`| ${app.name} | ${app.version} | ${app.commands.join(", ")} | ${app.source} | ${install} |`);
    }
    return lines.join("\n");
}
/**
 * Check latest version of an npm/pnpm package
 */
async function checkLatestVersion(app) {
    if (app.source !== "npm" && app.source !== "pnpm")
        return null;
    const result = execSafe(`npm.cmd view ${app.name} version 2>nul`, { shell: true, timeout: 10000 });
    if (!result.success || !result.output)
        return null;
    return result.output.trim();
}
/**
 * Register tools with DSH using the provided tools service
 */
function registerTools(toolsService) {
    const disposers = [];
    const register = (tool) => disposers.push(toolsService.register(tool));
    register({
        name: "app_manager_list",
        description: "List all installed CLI applications discovered from npm global, pnpm global, npx-cache, scoop, choco, cargo, and pipx. Returns name, version, available commands, package source, and category.",
        parameters: {
            source: {
                type: "string",
                required: false,
                description: "Optional filter by source (npm, pnpm, npx-cache, scoop, choco, cargo, pipx).",
            },
            category: {
                type: "string",
                required: false,
                description: "Optional filter by category (ai, package-manager, dev, deploy, cloud, database, framework, css, build, test, ui, design, other).",
            },
        },
        output: {
            schema: { type: "string", description: "Markdown table of discovered CLI applications." },
            render: (_args, value) => asText(String(value)),
        },
        execute: async (args) => {
            let apps = discoverAll();
            if (typeof args.source === "string")
                apps = apps.filter((a) => a.source === args.source);
            if (typeof args.category === "string")
                apps = apps.filter((a) => a.category === args.category);
            return formatAppList(apps);
        },
    });
    register({
        name: "app_manager_info",
        description: "Show detailed information about one installed CLI application by package name or command name (e.g. 'dsh', 'claude', 'codex', 'pnpm').",
        parameters: {
            name: {
                type: "string",
                required: true,
                description: "Package name or command name of the application.",
            },
        },
        output: {
            schema: { type: "string", description: "Detailed app information in markdown." },
            render: (_args, value) => asText(String(value)),
        },
        execute: async (args) => {
            const name = String(args.name);
            const apps = discoverAll();
            const matches = findApp(name, apps);
            if (matches.length === 0)
                return `No application found matching "${name}".`;
            const lines = [];
            for (const app of matches) {
                lines.push(`## ${app.name}`);
                lines.push(`- **Version:** ${app.version}`);
                lines.push(`- **Category:** ${app.category}`);
                lines.push(`- **Source:** ${app.source}`);
                lines.push(`- **Commands:** ${app.commands.join(", ")}`);
                lines.push(`- **Path:** ${app.path || "N/A"}`);
                if (app.description)
                    lines.push(`- **Description:** ${app.description}`);
                const latest = await checkLatestVersion(app);
                if (latest) {
                    const cmp = compareVersions(latest, app.version);
                    lines.push(`- **Latest:** ${latest} ${cmp > 0 ? "(update available)" : "(up to date)"}`);
                }
            }
            return lines.join("\n");
        },
    });
    register({
        name: "app_manager_check_updates",
        description: "Check whether installed npm/pnpm CLI applications have newer versions available in the registry.",
        parameters: {},
        output: {
            schema: { type: "string", description: "Markdown table of apps with available updates." },
            render: (_args, value) => asText(String(value)),
        },
        execute: async () => {
            const apps = discoverAll().filter((a) => a.source === "npm" || a.source === "pnpm");
            const updates = [];
            for (const app of apps) {
                const latest = await checkLatestVersion(app);
                if (latest && compareVersions(latest, app.version) > 0) {
                    updates.push({ ...app, latestVersion: latest });
                }
            }
            if (updates.length === 0)
                return "All npm/pnpm CLI applications are up to date.";
            const lines = ["| Package | Current | Latest | Source |", "|---------|---------|--------|--------|"];
            for (const u of updates)
                lines.push(`| ${u.name} | ${u.version} | ${u.latestVersion} | ${u.source} |`);
            return lines.join("\n");
        },
    });
    register({
        name: "app_manager_update",
        description: "Update an installed npm or pnpm CLI application to its latest version.",
        parameters: {
            name: {
                type: "string",
                required: true,
                description: "Package name of the application to update (e.g. 'dsh', '@deepseek-ai/dsh').",
            },
        },
        output: {
            schema: { type: "string", description: "Result of the update operation." },
            render: (_args, value) => asText(String(value)),
        },
        execute: async (args, exec) => {
            const name = String(args.name);
            const apps = discoverAll();
            const matches = findApp(name, apps);
            if (matches.length === 0)
                return `No application found matching "${name}".`;
            const app = matches[0];
            if (app.source !== "npm" && app.source !== "pnpm") {
                return `Cannot auto-update ${app.name}: source "${app.source}" is not supported.`;
            }
            exec.signal.throwIfAborted();
            const cmd = app.source === "npm" ? "npm.cmd" : "pnpm";
            const argsList = app.source === "npm" ? ["install", "-g", `${app.name}@latest`] : ["add", "-g", `${app.name}@latest`];
            const { spawn } = await import("node:child_process");
            return new Promise((resolve) => {
                const child = spawn(cmd, argsList, { shell: true, stdio: "pipe" });
                let stdout = "";
                let stderr = "";
                child.stdout?.on("data", (d) => (stdout += d.toString()));
                child.stderr?.on("data", (d) => (stderr += d.toString()));
                child.on("close", (code) => {
                    if (code === 0)
                        resolve(`✅ Updated ${app.name} to latest version.\n${stdout.trim()}`);
                    else
                        resolve(`❌ Failed to update ${app.name}:\n${stderr.trim() || stdout.trim()}`);
                });
            });
        },
    });
    register({
        name: "app_manager_doctor",
        description: "Run a health check on all discovered CLI applications: verify commands are in PATH and package directories exist.",
        parameters: {},
        output: {
            schema: { type: "string", description: "Health check report in markdown." },
            render: (_args, value) => asText(String(value)),
        },
        execute: async () => {
            const apps = discoverAll();
            const issues = [];
            for (const app of apps) {
                for (const cmd of app.commands) {
                    if (!commandExists(cmd))
                        issues.push(`${app.name}: command '${cmd}' not found in PATH`);
                }
            }
            if (issues.length === 0)
                return "✅ All discovered CLI applications are healthy.";
            return "⚠️ Issues found:\n" + issues.map((i) => `- ${i}`).join("\n");
        },
    });
    register({
        name: "app_manager_unmanaged",
        description: "List programs installed on this machine that are NOT managed by a Windows installer (Add/Remove Programs). These are portable, manually-placed, or user-dir tools discovered by cross-referencing the PATH enumeration against the Add/Remove-Programs registry baseline. On non-Windows platforms returns all tools not owned by a package manager.",
        parameters: {},
        output: {
            schema: { type: "string", description: "Markdown table of unmanaged/portable programs." },
            render: (_args, value) => asText(String(value)),
        },
        execute: async () => {
            const apps = discoverUnmanaged();
            if (apps.length === 0)
                return "No unmanaged programs found.";
            const lines = [
                `${apps.length} unmanaged program(s) — portable / manually placed:`,
                "",
                "| Name | Command | Install kind | Path |",
                "|------|---------|--------------|------|",
            ];
            for (const app of apps) {
                lines.push(`| ${app.name} | ${app.commands.join(", ")} | ${app.installKind} | ${app.path || "N/A"} |`);
            }
            return lines.join("\n");
        },
    });
    register({
        name: "app_manager_scan_method",
        description: "Explain how the app scan works: which discovery sources and techniques were used (PATH enumeration, package-manager queries, Add/Remove-Programs registry baseline), which were available on this machine, and how many entries each contributed.",
        parameters: {},
        output: {
            schema: { type: "string", description: "Scan methodology report in markdown." },
            render: (_args, value) => asText(String(value)),
        },
        execute: async () => {
            const baseline = readManagedBaseline();
            const report = buildScanReport({ baseline });
            const lines = [
                `Scan methodology (${report.platform}, ${report.durationMs}ms)`,
                "",
                `Total: ${report.totalApps} apps · ${report.managedCount} managed · ${report.unmanagedCount} unmanaged`,
                "",
                "| Source | Technique | Available | Found |",
                "|--------|-----------|-----------|-------|",
            ];
            for (const s of report.sources) {
                lines.push(`| ${s.source} | ${s.method} | ${s.available ? "yes" : "no"} | ${s.found} |`);
            }
            return lines.join("\n");
        },
    });
    return disposers;
}
/**
 * Escape HTML special characters
 */
function escapeHtml(text) {
    return text
        .replace(/\u0026/g, "&amp;")
        .replace(/\u003c/g, "&lt;")
        .replace(/\u003e/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}
/** Category emoji map. Single source of truth for both the page and CLI. */
const CATEGORY_ICONS = {
    ai: "🤖",
    "package-manager": "📦",
    dev: "🛠️",
    deploy: "🚀",
    cloud: "☁️",
    database: "🗄️",
    framework: "🏗️",
    css: "🎨",
    build: "🔨",
    test: "🧪",
    ui: "🖼️",
    design: "✏️",
    other: "📎",
};
/**
 * Default display order for categories. AI leads; the rest follow a rough
 * workflow relevance. Unknown categories rank last (index -1 would otherwise
 * sort them to the very front). Users can re-order at runtime by dragging.
 */
const CATEGORY_ORDER = [
    "ai",
    "package-manager",
    "framework",
    "dev",
    "build",
    "test",
    "deploy",
    "cloud",
    "database",
    "css",
    "ui",
    "design",
    "other",
];
/** Rank a category for sorting; unknown categories sort after all known ones. */
function categoryRank(category) {
    const i = CATEGORY_ORDER.indexOf(category);
    return i === -1 ? CATEGORY_ORDER.length : i;
}
/**
 * Get category emoji
 */
function getCategoryIcon(category) {
    return CATEGORY_ICONS[category] || "📎";
}
/**
 * Generate HTML page showing all discovered CLI applications
 */
function generateAppManagerPage() {
    const apps = discoverAll();
    const byCategory = {};
    for (const app of apps) {
        if (!byCategory[app.category])
            byCategory[app.category] = [];
        byCategory[app.category].push(app);
    }
    // Default rendering order: AI first, everything else by workflow relevance.
    // The user can re-order sections at runtime via drag (persisted locally).
    const sortedCategories = Object.keys(byCategory).sort((a, b) => categoryRank(a) - categoryRank(b));
    // ---- Category sections (collapsible) ----
    let categoryHtml = "";
    for (const category of sortedCategories) {
        const appsInCategory = byCategory[category];
        const rows = appsInCategory
            .map((app) => {
            const status = app.commands.some((cmd) => commandExists(cmd))
                ? "<span class='status ok'>✅ PATH</span>"
                : "<span class='status missing'>❌ PATH</span>";
            const installBadge = app.managed
                ? "<span class='kind managed'>managed</span>"
                : `<span class='kind unmanaged'>${escapeHtml(app.installKind)}</span>`;
            return `
          <tr data-app="${escapeHtml(app.name)}" data-source="${escapeHtml(app.source)}">
            <td class="name" title="${escapeHtml(app.name)}"><span class="row-grip" aria-hidden="true">⠿</span>${escapeHtml(app.name)}</td>
            <td class="version" title="${escapeHtml(app.version)}">${escapeHtml(app.version)}</td>
            <td class="commands" title="${escapeHtml(app.commands.join(", "))}">${escapeHtml(app.commands.join(", "))}</td>
            <td class="source" title="${escapeHtml(app.source)}">${escapeHtml(app.source)}</td>
            <td class="install">${installBadge}</td>
            <td class="path" title="${escapeHtml(app.path)}">${escapeHtml(app.path || "N/A")}</td>
            <td class="status-cell">${status}</td>
          </tr>
        `;
        })
            .join("");
        categoryHtml += `
      <details class="category" id="cat-${escapeHtml(category)}" data-category="${escapeHtml(category)}" open>
        <summary class="cat-head">
          <span class="drag-grip" title="拖动可调整分类顺序" aria-hidden="true">⠿</span>
          <span class="cat-chevron" aria-hidden="true"></span>
          <span class="cat-title">${getCategoryIcon(category)} ${escapeHtml(category.toUpperCase())}</span>
          <span class="cat-count">${appsInCategory.length}</span>
        </summary>
        <div class="cat-body">
          <table>
            <colgroup>
              <col class="c-name"><col class="c-version"><col class="c-command">
              <col class="c-source"><col class="c-install"><col class="c-path"><col class="c-status">
            </colgroup>
            <thead>
              <tr>
                <th>Name<span class="col-resizer" data-col="c-name"></span></th>
                <th>Version<span class="col-resizer" data-col="c-version"></span></th>
                <th>Commands<span class="col-resizer" data-col="c-command"></span></th>
                <th>Source<span class="col-resizer" data-col="c-source"></span></th>
                <th>Install<span class="col-resizer" data-col="c-install"></span></th>
                <th>Path<span class="col-resizer" data-col="c-path"></span></th>
                <th>Status<span class="col-resizer" data-col="c-status"></span></th>
              </tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
      </details>
    `;
    }
    const bySource = {};
    for (const app of apps) {
        bySource[app.source] = (bySource[app.source] || 0) + 1;
    }
    const managedCount = apps.filter((a) => a.managed).length;
    const unmanagedCount = apps.length - managedCount;
    const inPathCount = apps.filter((a) => a.commands.some((cmd) => commandExists(cmd))).length;
    const methodReport = buildScanReport({ baseline: readManagedBaseline() });
    const methodRows = methodReport.sources
        .map((s) => `<tr><td class="mono">${escapeHtml(s.source)}</td><td>${escapeHtml(s.method)}</td>` +
        `<td class="center">${s.available ? "✅" : "—"}</td><td class="mono center">${s.found}</td></tr>`)
        .join("");
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>DSH App Manager</title>
  <style>
    /* ---------- Theme tokens (S9: follow host light/dark preference) ---------- */
    :root {
      --bg: #ffffff;
      --surface: #f6f8fa;
      --surface-2: #eef1f4;
      --border: #d0d7de;
      --text: #1f2328;
      --muted: #59636e;
      --accent: #0969da;
      --ok: #1a7f37;
      --missing: #cf222e;
      --warn: #9a6700;
      --hover-row: rgba(9,105,218,0.06);
      --head-bg: rgba(9,105,218,0.09);
      --head-hover: rgba(9,105,218,0.14);
      --count-bg: rgba(89,99,110,0.14);
      --shadow: 0 1px 3px rgba(31,35,40,0.12);
      /* Unified typography */
      --font-ui: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto,
                 "Helvetica Neue", Arial, "PingFang SC", "Microsoft YaHei", sans-serif;
      --font-mono: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas,
                   "Liberation Mono", monospace;
      --fs-title: 1.6rem;
      --fs-section: 1rem;
      --fs-body: 0.875rem;
      --fs-small: 0.75rem;
      --fs-stat: 1.35rem;
    }
    @media (prefers-color-scheme: dark) {
      :root {
        --bg: #0d1117;
        --surface: #161b22;
        --surface-2: #1c2128;
        --border: #30363d;
        --text: #c9d1d9;
        --muted: #8b949e;
        --accent: #58a6ff;
        --ok: #3fb950;
        --missing: #f85149;
        --warn: #d29922;
        --hover-row: rgba(88,166,255,0.05);
        --head-bg: rgba(88,166,255,0.08);
        --head-hover: rgba(88,166,255,0.13);
        --count-bg: rgba(139,148,158,0.15);
        --shadow: 0 1px 3px rgba(0,0,0,0.4);
      }
    }
    * { box-sizing: border-box; }
    html { scroll-behavior: smooth; scroll-padding-top: 1rem; }
    body {
      font-family: var(--font-ui);
      font-size: var(--fs-body);
      background: var(--bg);
      color: var(--text);
      margin: 0;
      padding: 2rem;
      line-height: 1.55;
      -webkit-font-smoothing: antialiased;
    }
    .wrap { max-width: 1400px; margin: 0 auto; }

    /* ---------- Header ---------- */
    header {
      border-bottom: 1px solid var(--border);
      margin-bottom: 1.5rem;
      padding-bottom: 1.25rem;
    }
    h1 {
      margin: 0 0 0.35rem;
      font-size: var(--fs-title);
      font-weight: 650;
      letter-spacing: -0.01em;
    }
    .subtitle { color: var(--muted); margin: 0; font-size: var(--fs-body); }

    /* ---------- Clickable stat cards ---------- */
    .stats {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
      gap: 0.75rem;
      margin: 1.25rem 0 0;
    }
    .stat {
      appearance: none;
      font: inherit;
      text-align: left;
      cursor: pointer;
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 0.85rem 1rem;
      color: var(--text);
      transition: border-color .15s ease, background .15s ease, transform .1s ease;
      display: flex;
      flex-direction: column;
      gap: 0.15rem;
    }
    .stat:hover { border-color: var(--accent); background: var(--surface-2); }
    .stat:active { transform: translateY(1px); }
    .stat:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
    .stat-value { font-size: var(--fs-stat); font-weight: 650; line-height: 1.1; }
    .stat-label {
      font-size: var(--fs-small);
      color: var(--muted);
      text-transform: uppercase;
      letter-spacing: 0.06em;
    }
    .stat.is-active { border-color: var(--accent); background: var(--surface-2); }

    /* ---------- Source chips (also clickable) ---------- */
    .sources {
      display: flex;
      flex-wrap: wrap;
      gap: 0.5rem;
      margin: 1rem 0 0;
      align-items: center;
    }
    .sources-label {
      font-size: var(--fs-small);
      color: var(--muted);
      text-transform: uppercase;
      letter-spacing: 0.06em;
      margin-right: 0.25rem;
    }
    .chip {
      appearance: none;
      font: inherit;
      font-size: var(--fs-small);
      cursor: pointer;
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 999px;
      padding: 0.25rem 0.7rem;
      color: var(--text);
      transition: border-color .15s ease, background .15s ease;
    }
    .chip:hover { border-color: var(--accent); background: var(--surface-2); }
    .chip:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
    .chip .chip-count { color: var(--muted); margin-left: 0.3rem; }

    /* ---------- Methodology (collapsible) ---------- */
    details.method {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 8px;
      margin-bottom: 1.5rem;
      overflow: hidden;
    }
    details.method > summary {
      cursor: pointer;
      padding: 0.85rem 1rem;
      font-size: var(--fs-section);
      font-weight: 600;
      background: color-mix(in srgb, var(--warn) 8%, transparent);
      border-bottom: 1px solid transparent;
      list-style: none;
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }
    details.method > summary::-webkit-details-marker { display: none; }
    details.method[open] > summary { border-bottom-color: var(--border); }

    /* ---------- Category cards (collapsible) ---------- */
    .category {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 8px;
      margin-bottom: 1rem;
      overflow: hidden;
      scroll-margin-top: 0.75rem;
    }
    .category.target {
      animation: flash 1.4s ease;
    }
    @keyframes flash {
      0%   { border-color: var(--accent); box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 22%, transparent); }
      100% { border-color: var(--border); box-shadow: none; }
    }
    .cat-head {
      cursor: pointer;
      list-style: none;
      display: flex;
      align-items: center;
      gap: 0.6rem;
      padding: 0.8rem 1rem;
      background: var(--head-bg);
      font-size: var(--fs-section);
      font-weight: 600;
      user-select: none;
    }
    .cat-head::-webkit-details-marker { display: none; }
    .cat-head:hover { background: var(--head-hover); }
    .cat-chevron {
      flex: none;
      width: 0; height: 0;
      border-left: 5px solid var(--muted);
      border-top: 4px solid transparent;
      border-bottom: 4px solid transparent;
      transition: transform .15s ease;
    }
    .category[open] .cat-chevron { transform: rotate(90deg); }
    .cat-title { flex: 1; }
    .cat-count {
      font-size: var(--fs-small);
      font-weight: 600;
      color: var(--muted);
      background: var(--count-bg);
      border-radius: 999px;
      padding: 0.1rem 0.55rem;
      min-width: 1.8rem;
      text-align: center;
    }
    .cat-body { border-top: 1px solid var(--border); }

    /* ---------- Unified table format ---------- */
    table {
      width: 100%;
      border-collapse: collapse;
      font-size: var(--fs-body);
      table-layout: fixed;
    }
    th, td {
      padding: 0.6rem 0.9rem;
      text-align: left;
      border-bottom: 1px solid var(--border);
      vertical-align: middle;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    th {
      color: var(--muted);
      font-weight: 600;
      text-transform: uppercase;
      font-size: var(--fs-small);
      letter-spacing: 0.05em;
      background: var(--surface-2);
    }
    tbody tr:last-child td { border-bottom: none; }
    tbody tr:hover td { background: var(--hover-row); }

    /* ---------- S7: resizable columns + overflow tooltip ---------- */
    /* Header cells host a drag handle; body cells stay plain. */
    th { position: relative; }
    .col-resizer {
      position: absolute;
      top: 0; right: 0;
      width: 8px; height: 100%;
      cursor: col-resize;
      user-select: none;
      touch-action: none;
    }
    .col-resizer::after {
      content: "";
      position: absolute;
      top: 20%; right: 3px;
      width: 2px; height: 60%;
      background: transparent;
      transition: background .12s ease;
    }
    .col-resizer:hover::after,
    body.col-resizing .col-resizer::after { background: var(--accent); }
    body.col-resizing { cursor: col-resize; user-select: none; }
    body.col-resizing td, body.col-resizing th { user-select: none; }

    /* Tooltip for cells whose content does not fit (no auto-shrink; user
       can widen the column or hover to read the full value). */
    .has-tip { cursor: help; }

    /* ---------- Q6/Q7: draggable categories and app rows ---------- */
    .cat-head .drag-grip {
      flex: none;
      cursor: grab;
      color: var(--muted);
      font-size: var(--fs-small);
      letter-spacing: -0.1em;
      padding-right: 0.1rem;
      opacity: 0.55;
    }
    .cat-head .drag-grip:hover { opacity: 1; }
    details.category.dragging { opacity: 0.45; }
    details.category.drop-target > .cat-head {
      outline: 2px dashed var(--accent);
      outline-offset: -2px;
    }
    .cat-head .drag-grip.grabbing { cursor: grabbing; }
    /* While a category is being dragged, kill text selection everywhere. */
    body.cat-dragging { user-select: none; cursor: grabbing; }

    /* ---------- Q7: draggable app rows ---------- */
    tr.row-dragging { opacity: 0.4; }
    tr.row-drop-target td {
      box-shadow: inset 0 -2px 0 var(--accent);
    }
    tbody.row-drop-target { outline: 2px dashed var(--accent); outline-offset: -2px; }
    body.row-dragging-active { cursor: grabbing; }
    /* The grip is a visual affordance inside the name cell. */
    td.name .row-grip {
      color: var(--muted);
      opacity: 0;
      cursor: grab;
      margin-right: 0.35rem;
      letter-spacing: -0.1em;
      transition: opacity 0.12s ease;
    }
    tr:hover td.name .row-grip { opacity: 0.55; }
    tr:hover td.name .row-grip:hover { opacity: 1; }

    /* Column widths — kept identical across every category table */
    col.c-name    { width: 22%; }
    col.c-version { width: 11%; }
    col.c-command { width: 20%; }
    col.c-source  { width: 9%; }
    col.c-install { width: 11%; }
    col.c-path    { width: 21%; }
    col.c-status  { width: 6%; }
    /* Methodology table column widths (4 cols: source / technique / available / found) */
    col.m-source     { width: 14%; }
    col.m-technique  { width: 58%; }
    col.m-available  { width: 14%; }
    col.m-found      { width: 14%; }

    .name { font-weight: 600; color: var(--accent); }
    .version, .commands, .mono { font-family: var(--font-mono); }
    .version { font-size: var(--fs-small); }
    .commands { font-size: var(--fs-small); color: var(--text); }
    .source { text-transform: capitalize; }
    .path { font-size: var(--fs-small); color: var(--muted); }
    .center { text-align: center; }

    .status { font-size: var(--fs-small); font-weight: 600; }
    .status.ok { color: var(--ok); }
    .status.missing { color: var(--missing); }

    .kind {
      display: inline-block;
      font-size: var(--fs-small);
      font-weight: 600;
      padding: 0.1rem 0.5rem;
      border-radius: 999px;
      border: 1px solid var(--border);
      white-space: nowrap;
    }
    .kind.managed { color: var(--ok); border-color: color-mix(in srgb, var(--ok) 45%, transparent); background: color-mix(in srgb, var(--ok) 12%, transparent); }
    .kind.unmanaged { color: var(--warn); border-color: color-mix(in srgb, var(--warn) 45%, transparent); background: color-mix(in srgb, var(--warn) 12%, transparent); }

    .empty { text-align: center; padding: 3rem; color: var(--muted); }
    .no-result {
      text-align: center;
      padding: 2rem;
      color: var(--muted);
      background: var(--surface);
      border: 1px dashed var(--border);
      border-radius: 8px;
      display: none;
    }
    footer {
      margin-top: 2rem;
      padding-top: 1rem;
      border-top: 1px solid var(--border);
      color: var(--muted);
      font-size: var(--fs-small);
    }
    footer a { color: var(--accent); text-decoration: none; }
    footer a:hover { text-decoration: underline; }

    @media (max-width: 820px) {
      body { padding: 1rem; }
      col.c-path, col.c-command { width: 0; }
      th:nth-child(3), td:nth-child(3),
      th:nth-child(6), td:nth-child(6) { display: none; }
    }
  </style>
</head>
<body>
  <div class="wrap">
    <header>
      <h1>🚀 DSH App Manager</h1>
      <p class="subtitle">Discover, monitor, and manage installed CLI applications</p>

      <div class="stats">
        <button class="stat" type="button" data-jump="all">
          <span class="stat-value">${apps.length}</span>
          <span class="stat-label">Total apps</span>
        </button>
        <button class="stat" type="button" data-jump="managed">
          <span class="stat-value" style="color:var(--ok)">${managedCount}</span>
          <span class="stat-label">Managed</span>
        </button>
        <button class="stat" type="button" data-jump="unmanaged">
          <span class="stat-value" style="color:var(--warn)">${unmanagedCount}</span>
          <span class="stat-label">Unmanaged</span>
        </button>
        <button class="stat" type="button" data-jump="inpath">
          <span class="stat-value" style="color:var(--accent)">${inPathCount}</span>
          <span class="stat-label">On PATH</span>
        </button>
      </div>

      <div class="sources">
        <span class="sources-label">Sources</span>
        ${Object.entries(bySource)
        .map(([source, count]) => `<button class="chip" type="button" data-filter-source="${escapeHtml(source)}">` +
        `${escapeHtml(source)}<span class="chip-count">${count}</span></button>`)
        .join("")}
      </div>
    </header>

    <main>
      <details class="method">
        <summary><span class="cat-chevron"></span>🧭 Scan methodology</summary>
        <table>
          <colgroup>
            <col class="m-source"><col class="m-technique">
            <col class="m-available"><col class="m-found">
          </colgroup>
          <thead>
            <tr><th>Source</th><th>Technique</th><th class="center">Available</th><th class="center">Found</th></tr>
          </thead>
          <tbody>${methodRows}</tbody>
        </table>
      </details>

      <div id="app-list">
        ${apps.length === 0 ? "<div class='empty'>No CLI applications discovered.</div>" : categoryHtml}
      </div>
      <div class="no-result" id="no-result">No categories match the current filter.</div>
    </main>

    <footer>
      Generated by dsh-app-manager plugin ·
      <a href="/app-manager/api/apps">Apps API</a> ·
      <a href="/app-manager/api/unmanaged">Unmanaged API</a> ·
      <a href="/app-manager/api/method">Method API</a>
    </footer>
  </div>

  <script>
    (function () {
      var sections = Array.prototype.slice.call(
        document.querySelectorAll('details.category')
      );
      var noResult = document.getElementById('no-result');
      var stats = Array.prototype.slice.call(document.querySelectorAll('.stat'));
      var chips = Array.prototype.slice.call(document.querySelectorAll('.chip'));
      var activeChip = null; // single-source filter state

      // Scroll a category into view and flash it.
      function jumpTo(id) {
        var el = document.getElementById('cat-' + id);
        if (!el) return;
        el.open = true;
        el.scrollIntoView({ behavior: 'smooth', block: 'start' });
        el.classList.remove('target');
        void el.offsetWidth; // restart animation
        el.classList.add('target');
        setTimeout(function () { el.classList.remove('target'); }, 1500);
      }

      // Scroll to the first section that is currently visible (not hidden).
      function scrollToFirstVisible() {
        for (var i = 0; i < sections.length; i++) {
          if (sections[i].style.display !== 'none') {
            sections[i].scrollIntoView({ behavior: 'smooth', block: 'start' });
            return;
          }
        }
      }

      // Unified active-state reset: stat cards AND chips mutually exclusive.
      function clearAllActive() {
        stats.forEach(function (b) { b.classList.remove('is-active'); });
        chips.forEach(function (c) { c.classList.remove('is-active'); });
        activeChip = null;
      }

      // Reset every row to visible.
      function showAllRows() {
        document.querySelectorAll('details.category tbody tr').forEach(function (tr) {
          tr.style.display = '';
        });
      }

      function updateNoResult() {
        var visible = sections.filter(function (s) { return s.style.display !== 'none'; });
        noResult.style.display = visible.length === 0 ? 'block' : 'none';
        // Re-evaluate which visible cells now overflow (hidden rows don't matter).
        if (typeof refreshTooltips === 'function') refreshTooltips();
      }

      // Stat cards: jump to first matching category, or filter by property.
      stats.forEach(function (btn) {
        btn.addEventListener('click', function () {
          var mode = btn.getAttribute('data-jump');
          clearAllActive();
          btn.classList.add('is-active');
          showAllRows();

          if (mode === 'all') {
            sections.forEach(function (s) { s.style.display = ''; s.open = true; });
            updateNoResult();
            window.scrollTo({ top: 0, behavior: 'smooth' });
            return;
          }

          // Property filter (managed / unmanaged / inpath)
          var anyVisible = false;
          sections.forEach(function (sec) {
            var rows = sec.querySelectorAll('tbody tr');
            var shown = 0;
            rows.forEach(function (tr) {
              var badge = tr.querySelector('.kind');
              var status = tr.querySelector('.status');
              var keep = true;
              if (mode === 'managed') keep = badge && badge.classList.contains('managed');
              else if (mode === 'unmanaged') keep = badge && badge.classList.contains('unmanaged');
              else if (mode === 'inpath') keep = status && status.classList.contains('ok');
              tr.style.display = keep ? '' : 'none';
              if (keep) shown++;
            });
            sec.style.display = shown > 0 ? '' : 'none';
            if (shown > 0) { anyVisible = true; sec.open = true; }
          });
          updateNoResult();
          if (anyVisible) scrollToFirstVisible();
        });
      });

      // Source chips: filter rows by source, collapse non-matching groups,
      // and scroll to the first matching category so the user actually sees
      // the result. Single source at a time (click same chip again to clear).
      chips.forEach(function (chip) {
        chip.addEventListener('click', function () {
          var src = chip.getAttribute('data-filter-source');
          // If clicking the chip that is already active → toggle off (reset).
          if (activeChip === chip) {
            clearAllActive();
            showAllRows();
            sections.forEach(function (s) { s.style.display = ''; s.open = true; });
            updateNoResult();
            window.scrollTo({ top: 0, behavior: 'smooth' });
            return;
          }

          // Switching from another chip / from a stat card: reset stat highlight.
          clearAllActive();
          chip.classList.add('is-active');
          activeChip = chip;
          showAllRows();

          var anyVisible = false;
          sections.forEach(function (sec) {
            var rows = sec.querySelectorAll('tbody tr');
            var shown = 0;
            rows.forEach(function (tr) {
              var cell = tr.querySelector('.source');
              var keep = cell && cell.textContent.trim().toLowerCase() === src.toLowerCase();
              tr.style.display = keep ? '' : 'none';
              if (keep) shown++;
            });
            sec.style.display = shown > 0 ? '' : 'none';
            if (shown > 0) { anyVisible = true; sec.open = true; }
          });
          updateNoResult();
          // Always scroll to the first visible category so the filtered
          // results land in the viewport (was missing → user feedback).
          if (anyVisible) scrollToFirstVisible();
        });
      });

      // ------------------------------------------------
      // S7: resizable columns (drag handle on each <th>).
      // Widths persist in localStorage so a reload keeps the layout.
      // ------------------------------------------------
      var COL_KEY = 'dsh-app-manager:colwidths';
      var savedWidths = {};
      try { savedWidths = JSON.parse(localStorage.getItem(COL_KEY) || '{}') || {}; } catch (e) { savedWidths = {}; }

      function applyWidths() {
        Object.keys(savedWidths).forEach(function (cls) {
          var w = savedWidths[cls];
          if (typeof w !== 'number' || w <= 0) return;
          document.querySelectorAll('col.' + cls).forEach(function (c) {
            c.style.width = w + 'px';
          });
        });
      }

      // Establish pixel widths on first run so percentages do not fight the drag.
      function seedWidths(table) {
        table.querySelectorAll('colgroup > col').forEach(function (col) {
          var cls = (col.className || '').split(/\s+/)[0];
          if (!cls) return;
          if (!savedWidths[cls]) {
            var w = col.getBoundingClientRect().width;
            if (w > 0) savedWidths[cls] = Math.round(w);
          }
        });
      }

      function persistWidths() {
        try { localStorage.setItem(COL_KEY, JSON.stringify(savedWidths)); } catch (e) {}
      }

      // Seed once per table, then apply stored pixel widths everywhere.
      document.querySelectorAll('details.category table').forEach(function (t) { seedWidths(t); });
      applyWidths();

      document.querySelectorAll('.col-resizer').forEach(function (handle) {
        handle.addEventListener('pointerdown', function (ev) {
          ev.preventDefault();
          ev.stopPropagation();
          var cls = handle.getAttribute('data-col');
          var th = handle.parentElement;
          var startX = ev.clientX;
          var startW = th.getBoundingClientRect().width;
          document.body.classList.add('col-resizing');

          function onMove(e) {
            var next = Math.max(60, Math.round(startW + (e.clientX - startX)));
            savedWidths[cls] = next;
            document.querySelectorAll('col.' + cls).forEach(function (c) {
              c.style.width = next + 'px';
            });
          }
          function onUp() {
            document.body.classList.remove('col-resizing');
            window.removeEventListener('pointermove', onMove);
            window.removeEventListener('pointerup', onUp);
            persistWidths();
          }
          window.addEventListener('pointermove', onMove);
          window.addEventListener('pointerup', onUp);
        });
        // Prevent the header drag from toggling <details>.
        handle.addEventListener('click', function (e) { e.preventDefault(); e.stopPropagation(); });
      });

      // Refresh tooltips: a cell that overflows gets the full text in title.
      // Cells that fit keep no tooltip (avoids noise).
      function refreshTooltips(root) {
        (root || document).querySelectorAll('details.category td').forEach(function (td) {
          var full = td.getAttribute('data-full');
          if (full === null) {
            // Lazy-capture the original text so filters can't corrupt it.
            td.setAttribute('data-full', td.textContent.trim());
            full = td.getAttribute('data-full');
          }
          if (!full) return;
          if (td.scrollWidth > td.clientWidth + 1) {
            td.title = full;
            td.classList.add('has-tip');
          } else {
            td.removeAttribute('title');
            td.classList.remove('has-tip');
          }
        });
      }
      refreshTooltips();
      window.addEventListener('resize', function () { refreshTooltips(); });

      // ------------------------------------------------
      // Q6: re-order category sections by dragging their grip.
      // Order persists in localStorage.
      // ------------------------------------------------
      var ORDER_KEY = 'dsh-app-manager:catorder';
      var savedOrder = [];
      try { savedOrder = JSON.parse(localStorage.getItem(ORDER_KEY) || '[]') || []; } catch (e) { savedOrder = []; }

      var listRoot = document.getElementById('app-list');

      function applySavedOrder() {
        if (!listRoot || !savedOrder.length) return;
        var map = {};
        sections.forEach(function (s) { map[s.getAttribute('data-category')] = s; });
        // Re-append in the saved order; unknown ones keep their relative tail position.
        savedOrder.forEach(function (cat) {
          if (map[cat]) listRoot.appendChild(map[cat]);
        });
        sections = Array.prototype.slice.call(document.querySelectorAll('details.category'));
      }
      applySavedOrder();

      function persistOrder() {
        var order = Array.prototype.slice
          .call(document.querySelectorAll('details.category'))
          .map(function (s) { return s.getAttribute('data-category'); });
        try { localStorage.setItem(ORDER_KEY, JSON.stringify(order)); } catch (e) {}
      }

      // ------------------------------------------------
      // Q6: reorder category sections.
      //
      // Implemented with Pointer Events rather than native HTML5 drag & drop.
      // Native DnD on a <span> inside <summary> is unreliable: preventDefault
      // on pointerdown (needed to stop the <summary> from toggling) also
      // cancels the browser's own drag initiation, so dragstart never fires.
      // Pointer Events give us full control and work identically in every
      // engine.
      // ------------------------------------------------
      var sectionDrag = null; // { sec, grip, ghostOffsetY }

      function setCategoryDropTarget(sec) {
        sections.forEach(function (s) {
          if (s !== sec) s.classList.remove('drop-target');
        });
        if (sec) sec.classList.add('drop-target');
      }

      function clearCategoryDropTargets() {
        document.querySelectorAll('details.category.drop-target').forEach(function (s) {
          s.classList.remove('drop-target');
        });
      }

      function endSectionDrag() {
        if (!sectionDrag) return;
        sectionDrag.sec.classList.remove('dragging');
        sectionDrag.grip.classList.remove('grabbing');
        document.body.classList.remove('cat-dragging');
        clearCategoryDropTargets();
        sectionDrag = null;
      }

      function startSectionDrag(sec, grip, ev) {
        sectionDrag = { sec: sec, grip: grip };
        sec.classList.add('dragging');
        grip.classList.add('grabbing');
        // Suppress text selection across the whole page while dragging.
        document.body.classList.add('cat-dragging');
        try { grip.setPointerCapture(ev.pointerId); } catch (e) {}
      }

      // Which section should the pointer currently be "over"?
      // Uses elementFromPoint for precision (the dragged section is
      // translucent but still occupies its slot, so a pure rect test would
      // keep matching the section being dragged).
      function sectionUnderPointer(clientY, clientX) {
        var el = document.elementFromPoint(
          typeof clientX === 'number' ? clientX : window.innerWidth / 2,
          clientY
        );
        var host = el && el.closest ? el.closest('details.category') : null;
        if (host) return host;
        // Fallback: geometric hit test.
        for (var i = 0; i < sections.length; i++) {
          var rect = sections[i].getBoundingClientRect();
          if (clientY >= rect.top && clientY <= rect.bottom) return sections[i];
        }
        return null;
      }

      sections.forEach(function (sec) {
        var grip = sec.querySelector('.drag-grip');
        if (!grip) return;

        // Stop the <summary> from collapsing/expanding when the grip is used.
        grip.addEventListener('click', function (e) {
          e.preventDefault();
          e.stopPropagation();
        });

        grip.addEventListener('pointerdown', function (ev) {
          if (ev.button !== 0) return; // left button only
          ev.preventDefault();
          ev.stopPropagation();
          startSectionDrag(sec, grip, ev);
        });

        // Move / release are handled on the grip thanks to pointer capture,
        // but we also listen on document as a safety net.
        grip.addEventListener('pointermove', function (ev) {
          if (!sectionDrag || sectionDrag.sec !== sec) return;
          ev.preventDefault();
          var over = sectionUnderPointer(ev.clientY, ev.clientX);
          if (!over || over === sec) { clearCategoryDropTargets(); return; }
          setCategoryDropTarget(over);
        });

        grip.addEventListener('pointerup', function (ev) {
          if (!sectionDrag || sectionDrag.sec !== sec) return;
          ev.preventDefault();
          var over = sectionUnderPointer(ev.clientY, ev.clientX);
          if (over && over !== sec) {
            var rect = over.getBoundingClientRect();
            var before = (ev.clientY - rect.top) < rect.height / 2;
            if (before) listRoot.insertBefore(sec, over);
            else listRoot.insertBefore(sec, over.nextSibling);
            sections = Array.prototype.slice.call(document.querySelectorAll('details.category'));
            persistOrder();
          }
          try { grip.releasePointerCapture(ev.pointerId); } catch (e) {}
          endSectionDrag();
        });

        grip.addEventListener('pointercancel', function () { endSectionDrag(); });
      });

      // Safety net: if the pointer is released outside the grip.
      document.addEventListener('pointerup', function () { endSectionDrag(); });
      document.addEventListener('pointercancel', function () { endSectionDrag(); });

      // ------------------------------------------------
      // Q7: drag an app row into another category's table.
      // The move is a view-only override (persisted locally) — the backend
      // scan still reports the package's real category.
      // ------------------------------------------------
      var MOVE_KEY = 'dsh-app-manager:moves';
      var moves = {};
      try { moves = JSON.parse(localStorage.getItem(MOVE_KEY) || '{}') || {}; } catch (e) { moves = {}; }

      function applyMoves() {
        var byCat = {};
        sections.forEach(function (s) { byCat[s.getAttribute('data-category')] = s; });
        Object.keys(moves).forEach(function (appName) {
          var target = byCat[moves[appName]];
          if (!target) return;
          var body = target.querySelector('tbody');
          if (!body) return;
          var row = document.querySelector('tr[data-app="' + CSS.escape(appName) + '"]');
          if (row && row.parentElement !== body) body.appendChild(row);
        });
      }

      function persistMoves() {
        try { localStorage.setItem(MOVE_KEY, JSON.stringify(moves)); } catch (e) {}
      }

      function refreshCounts() {
        sections.forEach(function (sec) {
          var n = sec.querySelectorAll('tbody tr').length;
          var badge = sec.querySelector('.cat-count');
          if (badge) badge.textContent = String(n);
        });
      }

      // ------------------------------------------------
      // Q7: drag an app row into another category.
      //
      // Also Pointer Events based, for the same reasons as Q6, plus one more:
      // native DnD on a <tr> is flaky (text selection fights the drag) and the
      // drag image is poorly supported in some engines.
      //
      // The move is a view-level override persisted in localStorage; the
      // backend scan still reports the package's real category.
      // ------------------------------------------------
      var rowDrag = null; // { tr, startX, startY, engaged }

      var ROW_DRAG_THRESHOLD = 5; // px before we treat it as a drag, not a click

      function rowDragTargetAt(clientX, clientY) {
        // Find the category <section> under the pointer, then its tbody.
        for (var i = 0; i < sections.length; i++) {
          var rect = sections[i].getBoundingClientRect();
          if (clientX >= rect.left && clientX <= rect.right &&
              clientY >= rect.top && clientY <= rect.bottom) {
            return sections[i];
          }
        }
        return null;
      }

      function clearRowDropTargets() {
        document.querySelectorAll('tr.row-drop-target').forEach(function (tr) {
          tr.classList.remove('row-drop-target');
        });
        document.querySelectorAll('tbody.row-drop-target').forEach(function (b) {
          b.classList.remove('row-drop-target');
        });
      }

      function endRowDrag() {
        document.body.classList.remove('row-dragging-active');
        if (rowDrag && rowDrag.tr) rowDrag.tr.classList.remove('row-dragging');
        clearRowDropTargets();
        rowDrag = null;
      }

      function onRowPointerMove(ev) {
        if (!rowDrag) return;
        var dx = ev.clientX - rowDrag.startX;
        var dy = ev.clientY - rowDrag.startY;
        if (!rowDrag.engaged) {
          if (Math.abs(dx) < ROW_DRAG_THRESHOLD && Math.abs(dy) < ROW_DRAG_THRESHOLD) return;
          rowDrag.engaged = true;
          rowDrag.tr.classList.add('row-dragging');
          document.body.classList.add('row-dragging-active');
        }
        ev.preventDefault();
        clearRowDropTargets();
        var sec = rowDragTargetAt(ev.clientX, ev.clientY);
        if (!sec) return;
        var tbody = sec.querySelector('tbody');
        if (!tbody) return;
        var el = document.elementFromPoint(ev.clientX, ev.clientY);
        var overRow = el && el.closest ? el.closest('tbody tr') : null;
        if (overRow && overRow !== rowDrag.tr && tbody.contains(overRow)) {
          overRow.classList.add('row-drop-target');
        } else {
          tbody.classList.add('row-drop-target');
        }
      }

      function onRowPointerUp(ev) {
        if (!rowDrag) return;
        var drag = rowDrag;
        if (!drag.engaged) { endRowDrag(); return; }
        ev.preventDefault();
        var sec = rowDragTargetAt(ev.clientX, ev.clientY);
        if (sec) {
          var tbody = sec.querySelector('tbody');
          var el = document.elementFromPoint(ev.clientX, ev.clientY);
          var overRow = el && el.closest ? el.closest('tbody tr') : null;
          if (tbody) {
            if (overRow && overRow !== drag.tr && tbody.contains(overRow)) {
              tbody.insertBefore(drag.tr, overRow);
            } else {
              tbody.appendChild(drag.tr);
            }
            var targetCat = sec.getAttribute('data-category');
            var appName = drag.tr.getAttribute('data-app');
            if (appName && targetCat) { moves[appName] = targetCat; persistMoves(); }
            refreshCounts();
            refreshTooltips(sec);
          }
        }
        endRowDrag();
      }

      sections.forEach(function (sec) {
        var tbody = sec.querySelector('tbody');
        if (!tbody) return;

        tbody.addEventListener('pointerdown', function (ev) {
          if (ev.button !== 0) return;
          var tr = ev.target.closest ? ev.target.closest('tr') : null;
          if (!tr || !tbody.contains(tr)) return;
          // Do NOT preventDefault here: it would break the click-to-copy and
          // selection behaviour on the row's own cells. We only start dragging
          // once the pointer has moved past the threshold.
          if (ev.target.closest && ev.target.closest('.col-resizer')) return;
          rowDrag = { tr: tr, startX: ev.clientX, startY: ev.clientY, engaged: false };
        });
      });

      document.addEventListener('pointermove', onRowPointerMove);
      document.addEventListener('pointerup', onRowPointerUp);
      document.addEventListener('pointercancel', function () { endRowDrag(); });

      applyMoves();
      refreshCounts();

      // Also expose a reset for the layout overrides (convenient + testable).
      window.__resetLayout = function () {
        try {
          localStorage.removeItem(COL_KEY);
          localStorage.removeItem(ORDER_KEY);
          localStorage.removeItem(MOVE_KEY);
        } catch (e) {}
        location.reload();
      };

      // Category heading click: jump + expand (handled natively by details).
      window.__jumpTo = jumpTo;
    })();
  </script>
</body>
</html>`;
}
/**
 * Register web routes for the app manager page
 */
function registerWebRoutes(webServer) {
    const disposers = [];
    // Main HTML page
    disposers.push(webServer.register({
        kind: "exact",
        path: "/app-manager",
        handler: (_req, res) => {
            res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
            res.end(generateAppManagerPage());
        },
    }));
    // JSON API endpoint
    disposers.push(webServer.register({
        kind: "exact",
        path: "/app-manager/api/apps",
        handler: (_req, res) => {
            const apps = discoverAll().map((app) => ({
                name: app.name,
                version: app.version,
                commands: app.commands,
                category: app.category,
                source: app.source,
                description: app.description,
                path: app.path,
                managed: app.managed,
                installKind: app.installKind,
                inPath: app.commands.some((cmd) => commandExists(cmd)),
            }));
            const managedCount = apps.filter((a) => a.managed).length;
            res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
            res.end(JSON.stringify({ total: apps.length, managedCount, unmanagedCount: apps.length - managedCount, apps }, null, 2));
        },
    }));
    // Unmanaged-only JSON API
    disposers.push(webServer.register({
        kind: "exact",
        path: "/app-manager/api/unmanaged",
        handler: (_req, res) => {
            const apps = discoverUnmanaged().map((app) => ({
                name: app.name,
                commands: app.commands,
                source: app.source,
                installKind: app.installKind,
                path: app.path,
            }));
            res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
            res.end(JSON.stringify({ total: apps.length, apps }, null, 2));
        },
    }));
    // Scan methodology JSON API
    disposers.push(webServer.register({
        kind: "exact",
        path: "/app-manager/api/method",
        handler: (_req, res) => {
            const report = buildScanReport({ baseline: readManagedBaseline() });
            res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
            res.end(JSON.stringify(report, null, 2));
        },
    }));
    return disposers;
}
/**
 * Cordis plugin apply function
 */
export function apply(ctx) {
    const disposers = [];
    if (ctx.inject) {
        // Dynamically inject tools service to avoid Cordis inject export issues
        const injectDisposer = ctx.inject(["tools"], (toolsCtx) => {
            if (toolsCtx.tools?.register) {
                disposers.push(...registerTools(toolsCtx.tools));
            }
        });
        disposers.push(injectDisposer);
    }
    if (ctx.inject) {
        // Dynamically inject webServer service for the management page
        const injectDisposer = ctx.inject(["webServer"], (serverCtx) => {
            if (serverCtx.webServer?.register) {
                disposers.push(...registerWebRoutes(serverCtx.webServer));
            }
        });
        disposers.push(injectDisposer);
    }
    if (ctx.logger?.info) {
        ctx.logger.info("dsh-app-manager: plugin loaded");
    }
    return () => {
        for (const dispose of disposers)
            dispose?.();
    };
}
/**
 * Declare service dependencies for DSH loader (kept as fallback)
 */
export const inject = ["tools", "webServer"];
/**
 * Plugin name (used by Cordis)
 */
export const name = "dsh-app-manager";
/**
 * Default export for dynamic imports
 */
export default apply;
//# sourceMappingURL=index.js.map