/**
 * DSH App Manager Plugin
 * Registers AI-callable tools and a web management page for CLI applications.
 */
import { buildScanReport, discoverAll, discoverUnmanaged, findApp, readManagedBaseline } from "./discovery.js";
import { commandExists, compareVersions, execSafe } from "./utils.js";
import { defineTool as dshDefineTool } from "@deepseek-ai/dsh-tools";
const defineTool = dshDefineTool;
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
/**
 * Get category emoji
 */
function getCategoryIcon(category) {
    const icons = {
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
    return icons[category] || "📎";
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
    const categoryOrder = [
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
    const sortedCategories = Object.keys(byCategory).sort((a, b) => categoryOrder.indexOf(a) - categoryOrder.indexOf(b));
    // ---- Category sections (collapsible) ----
    let categoryHtml = "";
    for (const category of sortedCategories) {
        const appsInCategory = byCategory[category];
        const managedInCat = appsInCategory.filter((a) => a.managed).length;
        const rows = appsInCategory
            .map((app) => {
            const status = app.commands.some((cmd) => commandExists(cmd))
                ? "<span class='status ok'>✅ PATH</span>"
                : "<span class='status missing'>❌ PATH</span>";
            const installBadge = app.managed
                ? "<span class='kind managed'>managed</span>"
                : `<span class='kind unmanaged'>${escapeHtml(app.installKind)}</span>`;
            return `
          <tr>
            <td class="name">${escapeHtml(app.name)}</td>
            <td class="version">${escapeHtml(app.version)}</td>
            <td class="commands">${escapeHtml(app.commands.join(", "))}</td>
            <td class="source">${escapeHtml(app.source)}</td>
            <td class="install">${installBadge}</td>
            <td class="path" title="${escapeHtml(app.path)}">${escapeHtml(app.path || "N/A")}</td>
            <td class="status-cell">${status}</td>
          </tr>
        `;
        })
            .join("");
        categoryHtml += `
      <details class="category" id="cat-${escapeHtml(category)}" open>
        <summary class="cat-head">
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
                <th>Name</th>
                <th>Version</th>
                <th>Commands</th>
                <th>Source</th>
                <th>Install</th>
                <th>Path</th>
                <th>Status</th>
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
      background: rgba(210,153,34,0.08);
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
      0%   { border-color: var(--accent); box-shadow: 0 0 0 3px rgba(88,166,255,0.22); }
      100% { border-color: var(--border); box-shadow: none; }
    }
    .cat-head {
      cursor: pointer;
      list-style: none;
      display: flex;
      align-items: center;
      gap: 0.6rem;
      padding: 0.8rem 1rem;
      background: rgba(88,166,255,0.08);
      font-size: var(--fs-section);
      font-weight: 600;
      user-select: none;
    }
    .cat-head::-webkit-details-marker { display: none; }
    .cat-head:hover { background: rgba(88,166,255,0.13); }
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
      background: rgba(139,148,158,0.15);
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
    tbody tr:hover td { background: rgba(88,166,255,0.05); }

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
    .kind.managed { color: var(--ok); border-color: rgba(63,185,80,0.45); background: rgba(63,185,80,0.12); }
    .kind.unmanaged { color: var(--warn); border-color: rgba(210,153,34,0.45); background: rgba(210,153,34,0.12); }

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