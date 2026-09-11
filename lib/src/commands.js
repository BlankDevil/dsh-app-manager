/**
 * Command handlers for dsh-app-manager
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import { buildScanReport, discoverAll, discoverUnmanaged, findApp, readManagedBaseline } from "./discovery.js";
import { colorize, commandExists, compareVersions, execAsync, execSafe, formatBytes, formatDuration, } from "./utils.js";
/**
 * Print a formatted table
 */
function printTable(headers, rows, columnWidths) {
    let headerLine = "";
    for (let i = 0; i < headers.length; i++) {
        const width = columnWidths[i] || 15;
        headerLine += headers[i].padEnd(width) + "  ";
    }
    console.log(colorize(headerLine, "bright"));
    console.log(colorize("-".repeat(headerLine.length - 10), "gray"));
    for (const row of rows) {
        let line = "";
        for (let i = 0; i < row.length; i++) {
            const width = columnWidths[i] || 15;
            line += String(row[i]).padEnd(width) + "  ";
        }
        console.log(line);
    }
}
/**
 * Get category icon
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
 * List all discovered CLI applications
 */
export async function listApps(options = {}) {
    console.log(colorize("🔍 Scanning for installed CLI applications...\n", "cyan"));
    const startTime = Date.now();
    let apps = discoverAll();
    const duration = Date.now() - startTime;
    if (options.source) {
        apps = apps.filter((a) => a.source === options.source);
    }
    if (options.category) {
        apps = apps.filter((a) => a.category === options.category);
    }
    if (apps.length === 0) {
        console.log(colorize("No CLI applications found.", "yellow"));
        console.log(colorize("Try installing some global npm packages: npm install -g <package>", "gray"));
        return;
    }
    const managedCount = apps.filter((a) => a.managed).length;
    const unmanagedCount = apps.length - managedCount;
    console.log(colorize(`Managed: ${managedCount}  ·  Unmanaged (portable): ${unmanagedCount}\n`, "gray"));
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
    let totalApps = 0;
    for (const category of sortedCategories) {
        const appsInCategory = byCategory[category];
        totalApps += appsInCategory.length;
        console.log(colorize(`${getCategoryIcon(category)} ${category.toUpperCase()} (${appsInCategory.length})`, "bright"));
        const rows = appsInCategory.map((app) => {
            const updateMarker = app.hasUpdate ? colorize(`↑${app.latestVersion}`, "yellow") : "";
            const managedMarker = app.managed
                ? colorize("managed", "green")
                : colorize(app.installKind, "yellow");
            return [
                colorize(app.name, "white"),
                colorize(app.version, "green"),
                app.commands.join(", "),
                colorize(app.source, "blue"),
                managedMarker,
                updateMarker,
            ];
        });
        printTable(["Name", "Version", "Commands", "Source", "Install", "Update"], rows, [22, 12, 18, 11, 11, 12]);
        console.log();
    }
    console.log(colorize(`✅ Found ${totalApps} CLI applications in ${formatDuration(duration)}`, "green"));
    const bySource = {};
    for (const app of apps) {
        bySource[app.source] = (bySource[app.source] || 0) + 1;
    }
    console.log(colorize("\n📊 By source:", "gray"));
    for (const [source, count] of Object.entries(bySource)) {
        console.log(colorize(`  ${source}: ${count}`, "gray"));
    }
}
/**
 * List only the programs NOT managed by a Windows installer.
 *
 * These are portable / manually-placed tools discovered by cross-referencing
 * the PATH enumeration against the Add/Remove-Programs registry baseline.
 */
export async function listUnmanaged(options = {}) {
    console.log(colorize("🔍 Finding programs not managed by a Windows installer...\n", "cyan"));
    const baseline = readManagedBaseline();
    if (process.platform === "win32") {
        console.log(colorize(`Add/Remove-Programs baseline: ${baseline.length} managed entries\n`, "gray"));
    }
    else {
        console.log(colorize("Not on Windows — showing all non-package-manager tools.\n", "gray"));
    }
    const apps = discoverUnmanaged({ baseline });
    if (apps.length === 0) {
        console.log(colorize("✅ No unmanaged programs found.", "green"));
        return;
    }
    const bySource = {};
    for (const app of apps) {
        if (!bySource[app.source])
            bySource[app.source] = [];
        bySource[app.source].push(app);
    }
    for (const [source, list] of Object.entries(bySource)) {
        console.log(colorize(`📎 ${source.toUpperCase()} (${list.length})`, "bright"));
        const rows = list.map((app) => [
            colorize(app.name, "white"),
            colorize(app.installKind, "yellow"),
            app.commands.join(", "),
            colorize(truncate(app.path || "N/A", 46), "gray"),
        ]);
        printTable(["Name", "Kind", "Command", "Path"], rows, [22, 12, 18, 48]);
        console.log();
    }
    console.log(colorize(`✅ ${apps.length} unmanaged program(s) — these are portable / manually placed.`, "green"));
    console.log(colorize("   Tip: portable tools live in user dirs (e.g. ~/.local/bin, ~/bin, AppData\\Roaming\\npm).", "gray"));
}
/**
 * Show exactly which scan techniques were used and what each found.
 * This is the self-documenting "how did you look?" report.
 */
export async function showScanMethod(options = {}) {
    console.log(colorize("🧭 Scan methodology report\n", "cyan"));
    const baseline = readManagedBaseline();
    const report = buildScanReport({ baseline });
    console.log(colorize("Techniques used:", "bright"));
    const rows = report.sources.map((s) => [
        colorize(s.source, "white"),
        s.available ? colorize("yes", "green") : colorize("no", "gray"),
        s.found.toString(),
        colorize(s.method, "gray"),
    ]);
    printTable(["Source", "Available", "Found", "Technique"], rows, [12, 10, 8, 52]);
    console.log();
    console.log(colorize(`✅ ${report.totalApps} apps  ·  ${report.managedCount} managed  ·  ${report.unmanagedCount} unmanaged  ·  ${formatDuration(report.durationMs)}`, "green"));
    if (options.output) {
        const { writeFileSync } = await import("node:fs");
        writeFileSync(options.output, JSON.stringify(report, null, 2), "utf8");
        console.log(colorize(`📄 Methodology report exported to ${options.output}`, "green"));
    }
}
/**
 * Check for available updates
 */
export async function checkUpdates(options = {}) {
    if (!options.silent)
        console.log(colorize("⬆️  Checking for updates...\n", "cyan"));
    const apps = discoverAll().filter((app) => app.source === "npm" || app.source === "pnpm");
    if (apps.length === 0) {
        if (!options.silent)
            console.log(colorize("No npm/pnpm packages found to check.", "yellow"));
        return [];
    }
    const updates = [];
    const checked = new Set();
    for (const app of apps) {
        if (checked.has(app.name))
            continue;
        checked.add(app.name);
        if (!options.silent)
            process.stdout.write(`Checking ${app.name}... `);
        const result = execSafe(`npm.cmd view ${app.name} version 2>nul`, { shell: true, timeout: 10000 });
        if (result.success && result.output) {
            const latestVersion = result.output.trim();
            const cmp = compareVersions(latestVersion, app.version);
            if (cmp > 0) {
                app.hasUpdate = true;
                app.latestVersion = latestVersion;
                updates.push(app);
                if (!options.silent)
                    console.log(colorize(`${app.version} → ${latestVersion}`, "yellow"));
            }
            else if (cmp < 0) {
                if (!options.silent)
                    console.log(colorize(`${app.version} (newer than ${latestVersion})`, "green"));
            }
            else {
                if (!options.silent)
                    console.log(colorize("up to date", "green"));
            }
        }
        else {
            if (!options.silent)
                console.log(colorize("unable to check", "gray"));
        }
    }
    if (!options.silent)
        console.log();
    if (updates.length === 0) {
        if (!options.silent)
            console.log(colorize("✅ All packages are up to date!", "green"));
    }
    else {
        if (!options.silent) {
            console.log(colorize(`⚠️  ${updates.length} update(s) available:\n`, "yellow"));
            const rows = updates.map((app) => [
                app.name,
                colorize(app.version, "red"),
                "→",
                colorize(app.latestVersion || "", "green"),
                colorize(app.source, "blue"),
            ]);
            printTable(["Package", "Current", "", "Latest", "Source"], rows, [25, 12, 3, 12, 10]);
            console.log(colorize("\nRun 'app-manager update <package>' or 'app-manager update-all' to update.", "gray"));
        }
    }
    return updates;
}
/**
 * Show detailed info about an app
 */
export async function showInfo(appName, options = {}) {
    const apps = discoverAll();
    const matches = findApp(appName, apps);
    if (matches.length === 0) {
        console.log(colorize(`❌ No application found matching "${appName}"`, "red"));
        console.log(colorize("Run 'app-manager list' to see all installed apps.", "gray"));
        return;
    }
    for (const app of matches) {
        console.log(colorize(`\n📋 ${app.name}`, "bright"));
        console.log(colorize("─".repeat(50), "gray"));
        console.log(`  ${colorize("Version:", "gray")}     ${colorize(app.version, "green")}`);
        console.log(`  ${colorize("Category:", "gray")}    ${getCategoryIcon(app.category)} ${app.category}`);
        console.log(`  ${colorize("Source:", "gray")}      ${app.source}`);
        console.log(`  ${colorize("Commands:", "gray")}    ${app.commands.join(", ")}`);
        console.log(`  ${colorize("Path:", "gray")}        ${app.path || "N/A"}`);
        if (app.description) {
            console.log(`  ${colorize("Description:", "gray")} ${app.description}`);
        }
        if (app.commands.length > 0) {
            const cmd = app.commands[0];
            const works = commandExists(cmd);
            console.log(`  ${colorize("Status:", "gray")}      ${works ? colorize("✅ Available in PATH", "green") : colorize("❌ Not in PATH", "red")}`);
        }
        if (app.source === "npm" || app.source === "pnpm") {
            const result = execSafe(`npm.cmd view ${app.name} version 2>nul`, { shell: true, timeout: 10000 });
            if (result.success && result.output) {
                const latest = result.output.trim();
                const cmp = compareVersions(latest, app.version);
                if (cmp > 0) {
                    console.log(`  ${colorize("Update:", "gray")}      ${colorize(`${app.version} → ${latest}`, "yellow")}`);
                }
                else {
                    console.log(`  ${colorize("Update:", "gray")}      ${colorize("up to date", "green")}`);
                }
            }
        }
        if (app.path && existsSync(join(app.path, "package.json"))) {
            const { readFileSync } = await import("node:fs");
            const pkg = JSON.parse(readFileSync(join(app.path, "package.json"), "utf8"));
            if (pkg.homepage)
                console.log(`  ${colorize("Homepage:", "gray")}   ${pkg.homepage}`);
            if (pkg.repository?.url) {
                console.log(`  ${colorize("Repository:", "gray")} ${pkg.repository.url.replace(/^git\+/, "").replace(/\.git$/, "")}`);
            }
            if (pkg.license)
                console.log(`  ${colorize("License:", "gray")}    ${pkg.license}`);
        }
    }
}
/**
 * Update a specific app
 */
export async function updateApp(appName, options = {}) {
    const apps = discoverAll();
    const matches = findApp(appName, apps);
    if (matches.length === 0) {
        console.log(colorize(`❌ No application found matching "${appName}"`, "red"));
        return;
    }
    for (const app of matches) {
        console.log(colorize(`\n⬆️  Updating ${app.name}...`, "cyan"));
        if (app.source === "npm") {
            const result = await execAsync("npm.cmd", ["install", "-g", `${app.name}@latest`]);
            if (result.success) {
                console.log(colorize(`✅ ${app.name} updated successfully!`, "green"));
            }
            else {
                console.log(colorize(`❌ Failed to update ${app.name}:`, "red"));
                console.log(colorize(result.error, "red"));
            }
        }
        else if (app.source === "pnpm") {
            const result = await execAsync("pnpm", ["add", "-g", `${app.name}@latest`]);
            if (result.success) {
                console.log(colorize(`✅ ${app.name} updated successfully!`, "green"));
            }
            else {
                console.log(colorize(`❌ Failed to update ${app.name}:`, "red"));
                console.log(colorize(result.error, "red"));
            }
        }
        else if (app.source === "choco") {
            const result = await execAsync("choco", ["upgrade", app.name, "-y"]);
            if (result.success) {
                console.log(colorize(`✅ ${app.name} updated successfully!`, "green"));
            }
            else {
                console.log(colorize(`❌ Failed to update ${app.name}:`, "red"));
            }
        }
        else if (app.source === "scoop") {
            const result = await execAsync("scoop", ["update", app.name]);
            if (result.success) {
                console.log(colorize(`✅ ${app.name} updated successfully!`, "green"));
            }
            else {
                console.log(colorize(`❌ Failed to update ${app.name}:`, "red"));
            }
        }
        else {
            console.log(colorize(`⚠️  Auto-update not supported for ${app.source} packages. Please update manually.`, "yellow"));
        }
    }
}
/**
 * Update all apps with available updates
 */
export async function updateAll(options = {}) {
    console.log(colorize("⬆️  Checking for updates first...\n", "cyan"));
    const updates = await checkUpdates({ silent: true });
    if (updates.length === 0) {
        console.log(colorize("✅ Everything is up to date!", "green"));
        return;
    }
    console.log(colorize(`\n🔄 Updating ${updates.length} package(s)...\n`, "cyan"));
    for (const app of updates) {
        await updateApp(app.name, options);
    }
    console.log(colorize("\n✅ Update process completed!", "green"));
}
/**
 * Run health check on all apps
 */
export async function runDoctor(options = {}) {
    console.log(colorize("🏥 Running health check...\n", "cyan"));
    const apps = discoverAll();
    const issues = [];
    for (const app of apps) {
        process.stdout.write(`Checking ${app.name}... `);
        let commandsOk = true;
        for (const cmd of app.commands) {
            if (!commandExists(cmd)) {
                commandsOk = false;
                issues.push({ app: app.name, severity: "error", message: `Command '${cmd}' not found in PATH` });
            }
        }
        let pathOk = true;
        if (app.path && !existsSync(app.path)) {
            pathOk = false;
            issues.push({ app: app.name, severity: "warning", message: `Package directory missing: ${app.path}` });
        }
        let versionOk = true;
        if (app.commands.length > 0 && commandExists(app.commands[0])) {
            const versionResult = execSafe(`${app.commands[0]} --version 2>nul`, { shell: true, timeout: 5000 });
            if (!versionResult.success) {
                versionOk = false;
                issues.push({
                    app: app.name,
                    severity: "warning",
                    message: `Command '${app.commands[0]} --version' failed`,
                });
            }
        }
        if (commandsOk && pathOk && versionOk) {
            console.log(colorize("✅ OK", "green"));
        }
        else {
            console.log(colorize("⚠️  Issues found", "yellow"));
        }
    }
    console.log();
    if (issues.length === 0) {
        console.log(colorize("✅ All applications are healthy!", "green"));
    }
    else {
        console.log(colorize(`⚠️  Found ${issues.length} issue(s):\n`, "yellow"));
        const errors = issues.filter((i) => i.severity === "error");
        const warnings = issues.filter((i) => i.severity === "warning");
        if (errors.length > 0) {
            console.log(colorize("Errors:", "red"));
            for (const issue of errors) {
                console.log(colorize(`  ❌ [${issue.app}] ${issue.message}`, "red"));
            }
        }
        if (warnings.length > 0) {
            console.log(colorize("\nWarnings:", "yellow"));
            for (const issue of warnings) {
                console.log(colorize(`  ⚠️  [${issue.app}] ${issue.message}`, "yellow"));
            }
        }
    }
}
/**
 * Monitor running processes
 */
export async function monitorProcesses(options = {}) {
    console.log(colorize("📊 Monitoring running processes...\n", "cyan"));
    if (process.platform !== "win32") {
        console.log(colorize("Process monitoring is optimized for Windows.", "yellow"));
    }
    const apps = discoverAll();
    const runningApps = [];
    let processes = [];
    try {
        const result = execSafe('powershell -Command "Get-Process | Select-Object Name, Id, Path, WorkingSet | ConvertTo-Json -Compress"', { shell: true, timeout: 10000 });
        if (result.success) {
            const data = JSON.parse(result.output);
            processes = Array.isArray(data) ? data : [data];
        }
    }
    catch {
        const result = execSafe("tasklist /FO CSV /NH", { shell: true, timeout: 10000 });
        if (result.success) {
            const lines = result.output.split("\n").filter((l) => l.trim());
            for (const line of lines) {
                const parts = line.split('","').map((p) => p.replace(/^"|"$/g, ""));
                if (parts.length >= 2) {
                    processes.push({ Name: parts[0], Id: parseInt(parts[1]) || 0, Path: parts[0], WorkingSet: 0 });
                }
            }
        }
    }
    const processMap = new Map();
    for (const proc of processes) {
        const procName = proc.Name?.toLowerCase() || "";
        processMap.set(procName, proc);
    }
    for (const app of apps) {
        for (const cmd of app.commands) {
            const procName = cmd.toLowerCase();
            if (processMap.has(procName)) {
                const proc = processMap.get(procName);
                runningApps.push({
                    app: app.name,
                    command: cmd,
                    pid: proc.Id || 0,
                    memory: proc.WorkingSet || 0,
                    path: proc.Path || "",
                });
            }
        }
    }
    if (runningApps.length === 0) {
        console.log(colorize("No monitored CLI applications are currently running.", "gray"));
    }
    else {
        console.log(colorize(`Found ${runningApps.length} running instance(s):\n`, "green"));
        const rows = runningApps.map((ra) => [
            colorize(ra.app, "white"),
            ra.command,
            ra.pid.toString(),
            ra.memory > 0 ? formatBytes(ra.memory) : "N/A",
            ra.path || "N/A",
        ]);
        printTable(["Application", "Command", "PID", "Memory", "Path"], rows, [20, 15, 10, 12, 30]);
    }
    const runningNames = new Set(runningApps.map((ra) => ra.app));
    const notRunning = apps.filter((app) => !runningNames.has(app.name));
    if (notRunning.length > 0) {
        console.log(colorize(`\n💤 ${notRunning.length} installed but not running:`, "gray"));
        console.log(colorize(notRunning.map((a) => a.name).join(", "), "gray"));
    }
}
/**
 * Export app registry to JSON
 */
export async function exportRegistry(options = {}) {
    const apps = discoverAll();
    const managedCount = apps.filter((a) => a.managed).length;
    const registry = {
        generatedAt: new Date().toISOString(),
        platform: process.platform,
        nodeVersion: process.version,
        totalApps: apps.length,
        managedCount,
        unmanagedCount: apps.length - managedCount,
        apps: apps.map((app) => ({
            name: app.name,
            version: app.version,
            category: app.category,
            source: app.source,
            commands: app.commands,
            description: app.description,
            path: app.path,
            managed: app.managed,
            installKind: app.installKind,
        })),
    };
    const output = JSON.stringify(registry, null, 2);
    if (options.output) {
        const { writeFileSync } = await import("node:fs");
        writeFileSync(options.output, output, "utf8");
        console.log(colorize(`✅ Registry exported to ${options.output}`, "green"));
    }
    else {
        console.log(output);
    }
}
/**
 * Search for apps
 */
export async function searchApps(query, options = {}) {
    const apps = discoverAll();
    const matches = apps.filter((app) => app.name.toLowerCase().includes(query.toLowerCase()) ||
        app.description.toLowerCase().includes(query.toLowerCase()) ||
        app.commands.some((cmd) => cmd.toLowerCase().includes(query.toLowerCase())) ||
        app.category.toLowerCase().includes(query.toLowerCase()));
    if (matches.length === 0) {
        console.log(colorize(`No apps found matching "${query}"`, "yellow"));
        return;
    }
    console.log(colorize(`Found ${matches.length} app(s) matching "${query}":\n`, "green"));
    const rows = matches.map((app) => [
        colorize(app.name, "white"),
        colorize(app.version, "green"),
        app.commands.join(", "),
        colorize(app.source, "blue"),
        app.description ? truncate(app.description, 40) : "",
    ]);
    printTable(["Name", "Version", "Commands", "Source", "Description"], rows, [25, 12, 20, 12, 40]);
}
/**
 * Show usage help
 */
export function showHelp() {
    console.log(colorize("DSH App Manager - CLI Application Manager\n", "bright"));
    console.log("Usage: app-manager <command> [options]\n");
    const commands = [
        ["list", "List all discovered CLI applications"],
        ["unmanaged", "List programs NOT managed by a Windows installer"],
        ["method", "Show how the scan works (sources + techniques)"],
        ["check", "Check for available updates"],
        ["info <app>", "Show detailed information about an app"],
        ["update <app>", "Update a specific application"],
        ["update-all", "Update all applications with available updates"],
        ["doctor", "Run health check on all applications"],
        ["monitor", "Monitor running processes"],
        ["search <query>", "Search for installed applications"],
        ["export", "Export registry to JSON"],
        ["help", "Show this help message"],
    ];
    console.log(colorize("Commands:", "bright"));
    for (const [cmd, desc] of commands) {
        console.log(`  ${colorize(cmd.padEnd(18), "cyan")} ${desc}`);
    }
    console.log("\n" + colorize("Examples:", "bright"));
    console.log("  app-manager list");
    console.log("  app-manager unmanaged");
    console.log("  app-manager method --output scan.json");
    console.log("  app-manager check");
    console.log("  app-manager info claude");
    console.log("  app-manager update dsh");
    console.log("  app-manager doctor");
    console.log("  app-manager search ai");
    console.log("  app-manager export --output registry.json");
    console.log("\n" + colorize("Supported sources:", "bright"));
    console.log("  npm, pnpm, npx-cache, scoop, choco, cargo, pipx, pip, uv, path");
    console.log(colorize("  (+ Windows Add/Remove registry used as the managed/unmanaged baseline)", "gray"));
}
/**
 * Truncate string helper
 */
function truncate(str, max) {
    if (str.length <= max)
        return str;
    return str.slice(0, max - 3) + "...";
}
//# sourceMappingURL=commands.js.map