/**
 * Utility functions for dsh-app-manager
 */
import type { ExecResult } from "./types.js";
/**
 * Execute a command synchronously and return stdout/stderr
 */
export declare function execSafe(command: string, options?: {
    shell?: boolean | string;
    timeout?: number;
    cwd?: string;
}): ExecResult;
/**
 * Execute a command asynchronously
 */
export declare function execAsync(command: string, args?: string[], options?: {
    shell?: boolean | string;
    timeout?: number;
    cwd?: string;
}): Promise<ExecResult>;
/**
 * Format bytes to human readable string
 */
export declare function formatBytes(bytes: number): string;
/**
 * Format duration in milliseconds
 */
export declare function formatDuration(ms: number): string;
/**
 * Check if a command exists in PATH
 */
export declare function commandExists(command: string): boolean;
/**
 * Read package.json from a directory
 */
export declare function readPackageJson(dir: string): Record<string, unknown> | null;
/**
 * Compare two semantic versions
 * Returns: -1 if v1 < v2, 0 if equal, 1 if v1 > v2
 */
export declare function compareVersions(v1: string, v2: string): number;
/**
 * Colorize output with ANSI codes
 */
export declare const colors: {
    reset: string;
    bright: string;
    dim: string;
    red: string;
    green: string;
    yellow: string;
    blue: string;
    magenta: string;
    cyan: string;
    white: string;
    gray: string;
};
export declare function colorize(text: string, color: keyof typeof colors): string;
/**
 * Truncate string with ellipsis
 */
export declare function truncate(str: string, maxLength: number): string;
//# sourceMappingURL=utils.d.ts.map