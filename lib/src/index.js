/**
 * DSH App Manager Plugin
 * Registers AI-callable tools and a web management page for CLI applications.
 */
import { buildScanReport, discoverAll, discoverUnmanaged, findApp, readManagedBaseline } from "./discovery.js";
import { commandExists, compareVersions, execSafe } from "./utils.js";
import { defineTool as dshDefineTool } from "@deepseek-ai/dsh-tools";
const defineTool = dshDefineTool;
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
      <section class="category">
        <h2>${getCategoryIcon(category)} ${escapeHtml(category.toUpperCase())} <span class="count">(${appsInCategory.length})</span></h2>
        <table>
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
      </section>
    `;
    }
    const bySource = {};
    for (const app of apps) {
        bySource[app.source] = (bySource[app.source] || 0) + 1;
    }
    const sourceSummary = Object.entries(bySource)
        .map(([source, count]) => `<span class="badge">${escapeHtml(source)}: ${count}</span>`)
        .join(" ");
    const managedCount = apps.filter((a) => a.managed).length;
    const unmanagedCount = apps.length - managedCount;
    const methodReport = buildScanReport({ baseline: readManagedBaseline() });
    const methodRows = methodReport.sources
        .map((s) => `<tr><td class="mono">${escapeHtml(s.source)}</td><td>${escapeHtml(s.method)}</td>` +
        `<td>${s.available ? "✅" : "—"}</td><td class="mono">${s.found}</td></tr>`)
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
      --border: #30363d;
      --text: #c9d1d9;
      --muted: #8b949e;
      --accent: #58a6ff;
      --ok: #238636;
      --missing: #da3633;
      --warn: #d29922;
    }
    * { box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      background: var(--bg);
      color: var(--text);
      margin: 0;
      padding: 2rem;
      line-height: 1.6;
    }
    header {
      border-bottom: 1px solid var(--border);
      margin-bottom: 2rem;
      padding-bottom: 1rem;
    }
    h1 { margin: 0 0 0.5rem; font-size: 1.75rem; }
    .subtitle { color: var(--muted); margin: 0; }
    .summary { margin: 1rem 0; }
    .badge {
      display: inline-block;
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 999px;
      padding: 0.25rem 0.75rem;
      margin-right: 0.5rem;
      font-size: 0.85rem;
    }
    .category {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 8px;
      margin-bottom: 1.5rem;
      overflow: hidden;
    }
    .category h2 {
      margin: 0;
      padding: 1rem;
      background: rgba(88, 166, 255, 0.1);
      border-bottom: 1px solid var(--border);
      font-size: 1.1rem;
    }
    .count { color: var(--muted); font-weight: normal; }
    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 0.9rem;
    }
    th, td {
      padding: 0.75rem 1rem;
      text-align: left;
      border-bottom: 1px solid var(--border);
    }
    th {
      color: var(--muted);
      font-weight: 600;
      text-transform: uppercase;
      font-size: 0.75rem;
      letter-spacing: 0.05em;
    }
    tr:last-child td { border-bottom: none; }
    .name { font-weight: 600; color: var(--accent); }
    .version { font-family: monospace; }
    .commands { font-family: monospace; font-size: 0.85rem; }
    .source { text-transform: capitalize; }
    .path {
      max-width: 300px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      font-size: 0.8rem;
      color: var(--muted);
    }
    .status { font-size: 0.8rem; font-weight: 600; }
    .status.ok { color: var(--ok); }
    .status.missing { color: var(--missing); }
    .kind {
      display: inline-block;
      font-size: 0.72rem;
      font-weight: 600;
      padding: 0.15rem 0.5rem;
      border-radius: 999px;
      border: 1px solid var(--border);
    }
    .kind.managed { color: var(--ok); border-color: rgba(35,134,54,0.5); background: rgba(35,134,54,0.12); }
    .kind.unmanaged { color: var(--warn); border-color: rgba(210,153,34,0.5); background: rgba(210,153,34,0.12); }
    .mono { font-family: monospace; font-size: 0.8rem; }
    .method-section {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 8px;
      margin-bottom: 1.5rem;
      overflow: hidden;
    }
    .method-section h2 {
      margin: 0;
      padding: 1rem;
      background: rgba(210,153,34,0.1);
      border-bottom: 1px solid var(--border);
      font-size: 1.1rem;
    }
    .empty {
      text-align: center;
      padding: 3rem;
      color: var(--muted);
    }
    footer {
      margin-top: 2rem;
      padding-top: 1rem;
      border-top: 1px solid var(--border);
      color: var(--muted);
      font-size: 0.85rem;
    }
  </style>
</head>
<body>
  <header>
    <h1>🚀 DSH App Manager</h1>
    <p class="subtitle">Discover, monitor, and manage installed CLI applications</p>
    <div class="summary">
      <span class="badge">Total: ${apps.length}</span>
      <span class="badge">Managed: ${managedCount}</span>
      <span class="badge">Unmanaged: ${unmanagedCount}</span>
      ${sourceSummary}
    </div>
  </header>
  <main>
    <section class="method-section">
      <h2>🧭 Scan methodology</h2>
      <table>
        <thead>
          <tr><th>Source</th><th>Technique</th><th>Available</th><th>Found</th></tr>
        </thead>
        <tbody>${methodRows}</tbody>
      </table>
    </section>
    ${apps.length === 0 ? "<div class='empty'>No CLI applications discovered.</div>" : categoryHtml}
  </main>
  <footer>
    Generated by dsh-app-manager plugin · <a href="/app-manager/api/apps" style="color:var(--accent)">JSON API</a>
  </footer>
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