/**
 * Command handlers for dsh-app-manager
 */

import { existsSync } from "node:fs";
import { join } from "node:path";
import type { CliApp } from "./types.js";
import { buildScanReport, discoverAll, discoverUnmanaged, findApp, readManagedBaseline } from "./discovery.js";
import {
  colorize,
  colors,
  compareVersions,
  execAsync,
  formatBytes,
  formatDuration,
  pathIndexHas,
} from "./utils.js";

interface CommandOptions {
  output?: string;
  json?: boolean;
  category?: string;
  source?: string;
  silent?: boolean;
}

/**
 * Run `worker` over `items` with at most `limit` tasks in flight at once.
 * Results stay indexed to match the input order so callers can print in
 * the original sequence. Used by `runDoctor` (concurrent `--version`
 * checks) and `checkUpdates` (concurrent `npm view`).
 */
async function runWithConcurrency<T, R>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  const lanes = Math.max(1, Math.min(limit, items.length));
  const runners = Array.from({ length: lanes }, async () => {
    while (true) {
      const i = cursor++;
      if (i >= items.length) return;
      results[i] = await worker(items[i]);
    }
  });
  await Promise.all(runners);
  return results;
}

/**
 * Print a formatted table
 */
/**
 * Timeout (ms) for a single `cmd --version` probe.
 *
 * 8s rather than 5s: cold-starting a bundled CLI can take ~3s (measured), and
 * the probes run 12-wide, so a slow box can push an individual probe past a
 * tighter budget and produce spurious "failed" warnings.
 */
const VERSION_PROBE_TIMEOUT_MS = 8000;

/**
 * Cached `cmd --version` probes, keyed by command name.
 *
 * Why: `doctor` and `info` both probe versions, and a single `doctor` run used
 * to spawn one child process per app. Caching means a repeat probe inside
 * `--version-cache-ttl` returns instantly instead of paying another ~500ms
 * `cmd.exe` spawn. Failures are cached too — a missing broken shim should not
 * be retried 50 times.
 */
const versionProbeCache = new Map<string, { ok: boolean; output: string; at: number }>();
const VERSION_CACHE_TTL_MS = Number(process.env.APP_MANAGER_VERSION_CACHE_TTL_MS ?? 300_000);

/** Drop the version-probe cache (used by tests and after installs). */
export function resetVersionCache(): void {
  versionProbeCache.clear();
}

/**
 * Probe `cmd --version`, memoised. Returns `{ ok, output }` where `ok` means
 * the process exited 0. Uses the async spawn path so concurrent probes really
 * do overlap (see `execAsync`).
 */
async function probeVersion(cmd: string): Promise<{ ok: boolean; output: string }> {
  const hit = versionProbeCache.get(cmd);
  if (hit && Date.now() - hit.at < VERSION_CACHE_TTL_MS) {
    return { ok: hit.ok, output: hit.output };
  }
  const res = await execAsync(cmd, ["--version"], {
    shell: process.platform === "win32",
    timeout: VERSION_PROBE_TIMEOUT_MS,
  });
  const entry = { ok: res.success, output: res.output.trim(), at: Date.now() };
  versionProbeCache.set(cmd, entry);
  return { ok: entry.ok, output: entry.output };
}

/**
 * Fetch the latest published version of an npm package.
 *
 * Uses `spawn` (via `execAsync`) rather than the blocking `execSync` used by
 * `execSafe`. This matters: `execSync` blocks the whole event loop, which
 * silently serialised the "concurrent" pools in `checkUpdates` and `doctor`.
 */
async function fetchNpmLatest(pkg: string): Promise<string | null> {
  const res = await execAsync("npm.cmd", ["view", pkg, "version"], {
    shell: process.platform === "win32",
    timeout: 10_000,
  });
  const out = res.output.trim();
  return res.success && out ? out : null;
}

function printTable(headers: string[], rows: string[][], columnWidths: number[]): void {
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
function getCategoryIcon(category: string): string {
  const icons: Record<string, string> = {
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
export async function listApps(options: CommandOptions = {}): Promise<void> {
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
  console.log(
    colorize(
      `Managed: ${managedCount}  ·  Unmanaged (portable): ${unmanagedCount}\n`,
      "gray"
    )
  );

  const byCategory: Record<string, CliApp[]> = {};
  for (const app of apps) {
    if (!byCategory[app.category]) byCategory[app.category] = [];
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
  const sortedCategories = Object.keys(byCategory).sort(
    (a, b) => categoryOrder.indexOf(a) - categoryOrder.indexOf(b)
  );

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

    printTable(
      ["Name", "Version", "Commands", "Source", "Install", "Update"],
      rows,
      [22, 12, 18, 11, 11, 12]
    );
    console.log();
  }

  console.log(colorize(`✅ Found ${totalApps} CLI applications in ${formatDuration(duration)}`, "green"));

  const bySource: Record<string, number> = {};
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
export async function listUnmanaged(options: CommandOptions = {}): Promise<void> {
  console.log(colorize("🔍 Finding programs not managed by a Windows installer...\n", "cyan"));

  const baseline = readManagedBaseline();
  if (process.platform === "win32") {
    console.log(colorize(`Add/Remove-Programs baseline: ${baseline.length} managed entries\n`, "gray"));
  } else {
    console.log(colorize("Not on Windows — showing all non-package-manager tools.\n", "gray"));
  }

  const apps = discoverUnmanaged({ baseline });

  if (apps.length === 0) {
    console.log(colorize("✅ No unmanaged programs found.", "green"));
    return;
  }

  const bySource: Record<string, CliApp[]> = {};
  for (const app of apps) {
    if (!bySource[app.source]) bySource[app.source] = [];
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

  console.log(
    colorize(
      `✅ ${apps.length} unmanaged program(s) — these are portable / manually placed.`,
      "green"
    )
  );
  console.log(
    colorize(
      "   Tip: portable tools live in user dirs (e.g. ~/.local/bin, ~/bin, AppData\\Roaming\\npm).",
      "gray"
    )
  );
}

/**
 * Show exactly which scan techniques were used and what each found.
 * This is the self-documenting "how did you look?" report.
 */
export async function showScanMethod(options: CommandOptions = {}): Promise<void> {
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
  console.log(
    colorize(
      `✅ ${report.totalApps} apps  ·  ${report.managedCount} managed  ·  ${report.unmanagedCount} unmanaged  ·  ${formatDuration(report.durationMs)}`,
      "green"
    )
  );

  if (options.output) {
    const { writeFileSync } = await import("node:fs");
    writeFileSync(options.output, JSON.stringify(report, null, 2), "utf8");
    console.log(colorize(`📄 Methodology report exported to ${options.output}`, "green"));
  }
}

/**
 * Check for available updates. Each `npm view` was previously run sequentially;
 * now they go through a 5-way concurrency pool so a machine with 30+ npm/pnpm
 * packages finishes in seconds instead of tens.
 */
export async function checkUpdates(options: CommandOptions = {}): Promise<CliApp[]> {
  if (!options.silent) console.log(colorize("⬆️  Checking for updates...\n", "cyan"));

  const apps = discoverAll().filter((app) => app.source === "npm" || app.source === "pnpm");

  if (apps.length === 0) {
    if (!options.silent) console.log(colorize("No npm/pnpm packages found to check.", "yellow"));
    return [];
  }

  const checked = new Set<string>();
  const toCheck = apps.filter((app) => {
    if (checked.has(app.name)) return false;
    checked.add(app.name);
    return true;
  });

  type CheckOutcome = { app: CliApp; update: boolean; latestVersion?: string; note?: string };
  const checkOne = async (app: CliApp): Promise<CheckOutcome> => {
    const latestVersion = await fetchNpmLatest(app.name);
    if (!latestVersion) {
      return { app, update: false, note: "unable to check" };
    }
    const cmp = compareVersions(latestVersion, app.version);
    if (cmp > 0) {
      app.hasUpdate = true;
      app.latestVersion = latestVersion;
      return { app, update: true, latestVersion };
    }
    if (cmp < 0) return { app, update: false, latestVersion, note: `newer than ${latestVersion}` };
    return { app, update: false, latestVersion, note: "up to date" };
  };

  const outcomes = await runWithConcurrency(toCheck, 6, checkOne);

  const updates: CliApp[] = [];
  for (const o of outcomes) {
    if (!options.silent) process.stdout.write(`Checking ${o.app.name}... `);
    if (o.update && o.latestVersion) {
      if (!options.silent) console.log(colorize(`${o.app.version} → ${o.latestVersion}`, "yellow"));
      updates.push(o.app);
    } else if (o.note === "up to date") {
      if (!options.silent) console.log(colorize("up to date", "green"));
    } else if (o.note?.startsWith("newer than")) {
      if (!options.silent) console.log(colorize(`${o.app.version} (${o.note})`, "green"));
    } else {
      if (!options.silent) console.log(colorize(o.note ?? "unable to check", "gray"));
    }
  }

  if (!options.silent) console.log();

  if (updates.length === 0) {
    if (!options.silent) console.log(colorize("✅ All packages are up to date!", "green"));
  } else if (!options.silent) {
    console.log(colorize(`⚠️  ${updates.length} update(s) available:\n`, "yellow"));
    const rows = updates.map((app) => [
      app.name,
      colorize(app.version, "red"),
      "→",
      colorize(app.latestVersion || "", "green"),
      colorize(app.source, "blue"),
    ]);
    printTable(["Package", "Current", "", "Latest", "Source"], rows, [25, 12, 3, 12, 10]);
    console.log(
      colorize("\nRun 'app-manager update <package>' or 'app-manager update-all' to update.", "gray")
    );
  }

  return updates;
}

/**
 * Show detailed info about an app
 */
export async function showInfo(appName: string, options: CommandOptions = {}): Promise<void> {
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
      const works = pathIndexHas(cmd);
      console.log(
        `  ${colorize("Status:", "gray")}      ${works ? colorize("✅ Available in PATH", "green") : colorize("❌ Not in PATH", "red")}`
      );
    }

    if (app.source === "npm" || app.source === "pnpm") {
      const latest = await fetchNpmLatest(app.name);
      if (latest) {
        const cmp = compareVersions(latest, app.version);
        if (cmp > 0) {
          console.log(`  ${colorize("Update:", "gray")}      ${colorize(`${app.version} → ${latest}`, "yellow")}`);
        } else {
          console.log(`  ${colorize("Update:", "gray")}      ${colorize("up to date", "green")}`);
        }
      }
    }

    if (app.path && existsSync(join(app.path, "package.json"))) {
      const { readFileSync } = await import("node:fs");
      const pkg = JSON.parse(readFileSync(join(app.path, "package.json"), "utf8")) as {
        homepage?: string;
        repository?: { url?: string };
        license?: string;
      };
      if (pkg.homepage) console.log(`  ${colorize("Homepage:", "gray")}   ${pkg.homepage}`);
      if (pkg.repository?.url) {
        console.log(`  ${colorize("Repository:", "gray")} ${pkg.repository.url.replace(/^git\+/, "").replace(/\.git$/, "")}`);
      }
      if (pkg.license) console.log(`  ${colorize("License:", "gray")}    ${pkg.license}`);
    }
  }
}

/**
 * The command that upgrades one app, per source.
 *
 * Single source of truth for both the CLI (`app-manager update`) and the web
 * page's upgrade button — if the two kept their own copies they would drift,
 * and the page would promise a command the CLI no longer runs. Returns `null`
 * for sources with no unattended upgrade path (pip/pipx/uv/cargo/PATH finds).
 */
export function updateCommandFor(app: CliApp): { cmd: string; args: string[] } | null {
  switch (app.source) {
    case "npm":
      return { cmd: "npm.cmd", args: ["install", "-g", `${app.name}@latest`] };
    case "pnpm":
      return { cmd: "pnpm", args: ["add", "-g", `${app.name}@latest`] };
    case "choco":
      return { cmd: "choco", args: ["upgrade", app.name, "-y"] };
    case "scoop":
      return { cmd: "scoop", args: ["update", app.name] };
    default:
      return null;
  }
}

/** Everything a caller needs to report an upgrade, whether it succeeded or not. */
export interface UpdateOutcome {
  ok: boolean;
  /** The exact command line that ran (or would have run). */
  command: string;
  /** Human-readable detail: the failure reason, or a short confirmation. */
  detail: string;
}

/**
 * Run the upgrade for one app and report the result instead of printing it.
 *
 * The CLI wraps this in console output; the web endpoint returns it as JSON.
 */
export async function runUpdate(app: CliApp): Promise<UpdateOutcome> {
  const spec = updateCommandFor(app);
  if (!spec) {
    return {
      ok: false,
      command: "(none)",
      detail: `auto-update is not supported for ${app.source} packages — update it manually`,
    };
  }
  const command = [spec.cmd, ...spec.args].join(" ");
  const result = await execAsync(spec.cmd, spec.args);
  if (result.success) return { ok: true, command, detail: `${app.name} updated` };
  const reason = (result.error || "").trim().split("\n")[0] || "command failed";
  return { ok: false, command, detail: reason };
}

/**
 * Update a specific app
 */
export async function updateApp(appName: string, options: CommandOptions = {}): Promise<void> {
  const apps = discoverAll();
  const matches = findApp(appName, apps);

  if (matches.length === 0) {
    console.log(colorize(`❌ No application found matching "${appName}"`, "red"));
    return;
  }

  for (const app of matches) {
    console.log(colorize(`\n⬆️  Updating ${app.name}...`, "cyan"));
    const outcome = await runUpdate(app);
    if (outcome.ok) {
      console.log(colorize(`✅ ${app.name} updated successfully!`, "green"));
    } else if (updateCommandFor(app)) {
      console.log(colorize(`❌ Failed to update ${app.name}:`, "red"));
      console.log(colorize(outcome.detail, "red"));
    } else {
      console.log(colorize(`⚠️  Auto-update not supported for ${app.source} packages. Please update manually.`, "yellow"));
    }
  }
}

/**
 * Update all apps with available updates
 */
export async function updateAll(options: CommandOptions = {}): Promise<void> {
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
 * Run health check on all apps. The expensive `cmd --version` probe used to
 * be sequential (~150s for 50+ apps on Windows); now they run with a small
 * concurrency pool so the whole check finishes in tens of seconds.
 */
export async function runDoctor(options: CommandOptions = {}): Promise<void> {
  console.log(colorize("🏥 Running health check...\n", "cyan"));

  const apps = discoverAll();
  const issues: Array<{ app: string; severity: "error" | "warning"; message: string }> = [];

  type CheckResult = { name: string; ok: boolean; issues: typeof issues };
  const checkOne = async (app: CliApp): Promise<CheckResult> => {
    const local: typeof issues = [];
    for (const cmd of app.commands) {
      if (!pathIndexHas(cmd)) {
        local.push({ app: app.name, severity: "error", message: `Command '${cmd}' not found in PATH` });
      }
    }
    if (app.path && !existsSync(app.path)) {
      local.push({ app: app.name, severity: "warning", message: `Package directory missing: ${app.path}` });
    }
    if (app.commands.length > 0 && pathIndexHas(app.commands[0])) {
      const probe = await probeVersion(app.commands[0]);
      if (!probe.ok) {
        local.push({
          app: app.name,
          severity: "warning",
          message: `Command '${app.commands[0]} --version' failed`,
        });
      }
    }
    return { name: app.name, ok: local.length === 0, issues: local };
  };

  // 12 parallel is a safe ceiling on Windows now that the probes go through
  // the async spawn path — with the old blocking execSync these lanes were
  // cosmetic and the whole check ran serially (~98s for 50+ apps).
  const results = await runWithConcurrency(apps, 12, checkOne);

  for (const r of results) {
    console.log(`Checking ${r.name}... ${r.ok ? colorize("✅ OK", "green") : colorize("⚠️  Issues found", "yellow")}`);
    for (const i of r.issues) issues.push(i);
  }

  console.log();

  if (issues.length === 0) {
    console.log(colorize("✅ All applications are healthy!", "green"));
  } else {
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
export async function monitorProcesses(options: CommandOptions = {}): Promise<void> {
  console.log(colorize("📊 Monitoring running processes...\n", "cyan"));

  if (process.platform !== "win32") {
    console.log(colorize("Process monitoring is optimized for Windows.", "yellow"));
  }

  const apps = discoverAll();
  const runningApps: Array<{ app: string; command: string; pid: number; memory: number; path: string }> = [];

  interface ProcInfo {
    Name?: string;
    Id?: number;
    Path?: string;
    WorkingSet?: number;
  }

  let processes: ProcInfo[] = [];
  const ps = await execAsync(
    "powershell -Command \"Get-Process | Select-Object Name, Id, Path, WorkingSet | ConvertTo-Json -Compress\"",
    [],
    { shell: true, timeout: 10_000 }
  );
  if (ps.success) {
    try {
      const data = JSON.parse(ps.output) as ProcInfo | ProcInfo[];
      processes = Array.isArray(data) ? data : [data];
    } catch {
      processes = [];
    }
  }
  if (processes.length === 0) {
    const result = await execAsync("tasklist", ["/FO", "CSV", "/NH"], { shell: true, timeout: 10_000 });
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

  const processMap = new Map<string, ProcInfo>();
  for (const proc of processes) {
    const procName = proc.Name?.toLowerCase() || "";
    processMap.set(procName, proc);
  }

  for (const app of apps) {
    for (const cmd of app.commands) {
      const procName = cmd.toLowerCase();
      if (processMap.has(procName)) {
        const proc = processMap.get(procName)!;
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
  } else {
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
export async function exportRegistry(options: CommandOptions = {}): Promise<void> {
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
  } else {
    console.log(output);
  }
}

/**
 * Search for apps
 */
export async function searchApps(query: string, options: CommandOptions = {}): Promise<void> {
  const apps = discoverAll();
  const matches = apps.filter(
    (app) =>
      app.name.toLowerCase().includes(query.toLowerCase()) ||
      app.description.toLowerCase().includes(query.toLowerCase()) ||
      app.commands.some((cmd) => cmd.toLowerCase().includes(query.toLowerCase())) ||
      app.category.toLowerCase().includes(query.toLowerCase())
  );

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
export function showHelp(): void {
  console.log(colorize("DSH App Manager - CLI Application Manager\n", "bright"));
  console.log("Usage: app-manager <command> [options]\n");

  const commands: Array<[string, string]> = [
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
function truncate(str: string, max: number): string {
  if (str.length <= max) return str;
  return str.slice(0, max - 3) + "...";
}
