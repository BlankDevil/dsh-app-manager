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