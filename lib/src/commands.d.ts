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
 * Check for available updates
 */
export declare function checkUpdates(options?: CommandOptions): Promise<CliApp[]>;
/**
 * Show detailed info about an app
 */
export declare function showInfo(appName: string, options?: CommandOptions): Promise<void>;
/**
 * Update a specific app
 */
export declare function updateApp(appName: string, options?: CommandOptions): Promise<void>;
/**
 * Update all apps with available updates
 */
export declare function updateAll(options?: CommandOptions): Promise<void>;
/**
 * Run health check on all apps
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