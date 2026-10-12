/**
 * Command handlers for dsh-app-manager
 */
import type { CliApp } from "./types.js";
interface CommandOptions {
    output?: string;
    json?: boolean;
    category?: string;
    source?: string;
    silent?: boolean;
}
/** Drop the version-probe cache (used by tests and after installs). */
export declare function resetVersionCache(): void;
/** Why this app may not be run; `null` means it may. */
export declare function refuseToExecute(app: {
    name?: string;
    path?: string;
    commands?: string[];
}): string | null;
/**
 * The program files a shim asks its interpreter to run.
 *
 * Only **script** targets are returned, never the interpreter: a shim
 * references its interpreter conditionally (`IF EXIST "%dp0%\node.exe" … ELSE
 * node`), so a missing `.exe` there is normal and must not read as "broken".
 */
export declare function shimTargets(file: string): string[];
/**
 * Resolve a shim target through npm's **hashed** package directory.
 *
 * npm installs any package whose name starts with a digit into a hashed
 * directory — `9router` lands in `node_modules/.9router-wssQRq4J` — but the
 * shims it generates still reference the *logical* path
 * `node_modules/9router/cli.js`. That logical path is normally a link to the
 * hashed one; when a manifest-less directory from an older layout is sitting
 * at `node_modules/9router` instead, the link is never created and the logical
 * path does not exist.
 *
 * A plain "does the target exist?" check then reports a perfectly installed,
 * perfectly working package as an orphan, and offers to "clean up the
 * leftover" — which moves the user's working shims away. That is worse than
 * the problem it claims to fix. So: if the logical path is missing but the
 * hashed equivalent exists, the package is present and the shim is fine.
 *
 * @returns the hashed path that does exist, or `null` when there is none.
 */
export declare function viaHashedPackageDir(target: string): string | null;
/**
 * Is this leftover really broken? **Pure** — it reads the shim and checks what
 * the shim points at. No child process is spawned.
 */
export declare function brokenShimReason(files: string[]): string | null;
/**
 * The script shims a command leaves in PATH directories.
 *
 * Only `cmd` / `bat` / `ps1` and the extensionless POSIX wrapper — a real
 * `.exe` is a program, not a leftover, and is never a candidate.
 */
export declare function shimFilesOnPath(command: string): string[];
/**
 * Is this app's command a leftover from an uninstall?
 *
 * Deliberately **does not run the command**. It used to (`<cmd> --version`,
 * then pattern-match the failure), which meant one child process per app on
 * every sweep — and on this machine that executed Fiddler's `ExecAction`,
 * starting Fiddler and flipping the system proxy. Static analysis answers the
 * same question: a shim whose target no longer exists *is* the leftover, and
 * reading a file cannot start a program.
 */
export declare function probeCommandHealth(app: CliApp, _options?: {
    refresh?: boolean;
}): Promise<{
    broken: boolean;
    reason: string;
}>;
/**
 * Pull a version-looking token out of probe output.
 *
 * Deliberately permissive on shape and strict on "has digits and dots": the
 * outputs in the wild are `v22.22.2`, `2.1.293 (Claude Code)`,
 * `Docker version 28.4.0, build d8eb465`, `Docker Compose version v2.39.2-desktop.1`,
 * `0.34.0` … A strict parser would reject half of them, and the token is shown
 * as-is next to the app, not compared unless a numeric version is needed.
 */
export declare function extractVersionToken(text: string): string | null;
/**
 * Resolve an app's displayed version.
 *
 * Package-manager sources already carry a version from their manifest, so they
 * are answered without spawning anything. Everything else — the ~2/3 of a real
 * machine that is discovered by **PATH enumeration** (portable tools, and shims
 * whose package directory is gone) — has no metadata at all, which is why the
 * table used to show `unknown` for most rows. For those we probe the tool
 * itself: `<cmd> --version`, falling back to `-v` (some tools only accept the
 * short form).
 *
 * Returns `null` when the tool does not answer or answers without a version.
 */
export declare function resolveAppVersion(app: CliApp, options?: {
    refresh?: boolean;
}): Promise<string | null>;
/**
 * List all discovered CLI applications
 */
export declare function listApps(options?: CommandOptions): Promise<void>;
/**
 * List only the programs NOT managed by a Windows installer.
 *
 * These are portable / manually-placed tools discovered by cross-referencing
 * the PATH enumeration against the Add/Remove-Programs registry baseline.
 */
export declare function listUnmanaged(options?: CommandOptions): Promise<void>;
/**
 * Show exactly which scan techniques were used and what each found.
 * This is the self-documenting "how did you look?" report.
 */
export declare function showScanMethod(options?: CommandOptions): Promise<void>;
/**
 * Check for available updates. Each `npm view` was previously run sequentially;
 * now they go through a 5-way concurrency pool so a machine with 30+ npm/pnpm
 * packages finishes in seconds instead of tens.
 */
export declare function checkUpdates(options?: CommandOptions): Promise<CliApp[]>;
/**
 * Show detailed info about an app
 */
export declare function showInfo(appName: string, options?: CommandOptions): Promise<void>;
/**
 * The command that upgrades one app, per source.
 *
 * Single source of truth for both the CLI (`app-manager update`) and the web
 * page's upgrade button — if the two kept their own copies they would drift,
 * and the page would promise a command the CLI no longer runs. Returns `null`
 * for sources with no unattended upgrade path (pip/pipx/uv/cargo/PATH finds).
 */
export declare function updateCommandFor(app: CliApp): {
    cmd: string;
    args: string[];
} | null;
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
export declare function runUpdate(app: CliApp): Promise<UpdateOutcome>;
/**
 * Update a specific app
 */
export declare function updateApp(appName: string, options?: CommandOptions): Promise<void>;
/**
 * Update all apps with available updates
 */
export declare function updateAll(options?: CommandOptions): Promise<void>;
/**
 * Run health check on all apps. The expensive `cmd --version` probe used to
 * be sequential (~150s for 50+ apps on Windows); now they run with a small
 * concurrency pool so the whole check finishes in tens of seconds.
 */
export declare function runDoctor(options?: CommandOptions): Promise<void>;
/**
 * Monitor running processes
 */
export declare function monitorProcesses(options?: CommandOptions): Promise<void>;
/**
 * Export app registry to JSON
 */
export declare function exportRegistry(options?: CommandOptions): Promise<void>;
/**
 * Search for apps
 */
export declare function searchApps(query: string, options?: CommandOptions): Promise<void>;
/**
 * Show usage help
 */
export declare function showHelp(): void;
export {};
//# sourceMappingURL=commands.d.ts.map