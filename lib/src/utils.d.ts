/**
 * Utility functions for dsh-app-manager
 */
import type { ExecResult, ManagedApp, PathExecutable } from "./types.js";
/**
 * Execute a command synchronously and return stdout/stderr
 */
export declare function execSafe(command: string, options?: {
    shell?: boolean | string;
    timeout?: number;
    cwd?: string;
}): ExecResult;
/**
 * Kill a child process and everything it spawned.
 *
 * `shell: true` means the child we hold is `cmd.exe`/`sh`, not the real
 * command — so a plain `kill()` would reap the wrapper and leave the actual
 * process running as an orphan. On Windows `taskkill /T /F` is the only way to
 * reach the whole tree; elsewhere the process group is signalled directly.
 *
 * Best effort by design: the caller has usually already settled its promise, so
 * a failure here must never surface.
 */
export declare function killProcessTree(child: {
    pid?: number;
    kill: (signal?: NodeJS.Signals) => boolean;
}): void;
/**
 * Test seam for the two helpers above: they are pure, but the branch they take
 * depends on the host (existing file / platform), so the space-handling cases
 * are only reachable through this export on a machine that has a spaced path.
 */
export declare function _shellQuoteFor(platform: NodeJS.Platform, token: string): string;
/**
 * Execute a command asynchronously.
 *
 * `timeout` is enforced with an explicit timer. This matters: `child_process
 * .spawn` **ignores** a `timeout` option (only `exec`/`execFile` honour it), so
 * passing it through silently produced unbounded waits. That turned into a real
 * hang in the field — `doctor` probes `<cmd> --version` for every app, and one
 * shim on PATH (`RefreshEnv`, a Chocolatey `.cmd` that shells out to
 * `reg.exe`/`WMIC.exe`) blocks indefinitely when those are unavailable, so the
 * health check never returned.
 *
 * Note for callers: `shell` defaults to `true` on Windows. `execAsync` now quotes
 * argv itself (see `quoteForShell` / `shellCommand`), so a path containing spaces
 * — `C:\Program Files\nodejs\node.exe`, or an app discovered under `Program Files`
 * — survives the shell instead of being split at the first space.
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
 * Check if a command exists in PATH.
 *
 * This spawns a child process (`where` / `which`), so for bulk checks prefer
 * `pathIndexHas()` which reuses a cached directory listing.
 */
export declare function commandExists(command: string): boolean;
/**
 * Check whether a command is on PATH using the cached directory index.
 * Much faster than `commandExists` when checking many commands.
 */
export declare function pathIndexHas(command: string): boolean;
/** Clear the cached PATH index (useful for tests). */
export declare function resetPathIndex(): void;
export declare function getLastSpawnError(): string;
/** Record a spawn failure reason (best effort — truncates very long text). */
export declare function noteSpawnError(message: string): void;
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
/**
 * Resolve the user's roaming AppData directory.
 *
 * `process.env.APPDATA` is not guaranteed to be present (e.g. when spawned from
 * a shell that does not export it). Fall back to the conventional location
 * derived from the home directory.
 */
export declare function appDataDir(env?: NodeJS.ProcessEnv): string;
/** Resolve the user's local AppData directory with the same fallbacks. */
export declare function localAppDataDir(env?: NodeJS.ProcessEnv): string;
/** Resolve the user's home / profile directory. */
export declare function homeDir(env?: NodeJS.ProcessEnv): string;
/**
 * Candidate directories holding globally-installed npm packages, ordered so
 * the *active* Node installation wins.
 *
 * Why this exists: the original implementation hardcoded
 * `appDataDir()/npm/node_modules`. Off Windows `appDataDir()` falls back to
 * `$HOME/AppData/Roaming`, a path that does not exist — so npm globals were
 * silently reported as zero on macOS and Linux, which is exactly where `dsh`,
 * `claude` and `codex` are usually installed.
 */
export declare function npmGlobalCandidates(env?: NodeJS.ProcessEnv, execPathRaw?: string, platform?: NodeJS.Platform): string[];
/**
 * The active npm global `node_modules` directory, or `""` when none of the
 * conventional locations exist. Only the first hit is used so the result
 * matches what `npm root -g` would report (rather than unioning every Node
 * version ever installed).
 */
export declare function npmGlobalRoot(env?: NodeJS.ProcessEnv): string;
/**
 * Candidate npx cache directories. npx (npm >= 7) stores extracted packages
 * under `<npm cache>/_npx`; the cache lives in `%LOCALAPPDATA%\npm-cache` on
 * Windows and `~/.npm` everywhere else.
 */
export declare function npxCacheCandidates(env?: NodeJS.ProcessEnv, platform?: NodeJS.Platform): string[];
/**
 * Candidate pnpm global roots (the parent of `global/node_modules`).
 * pnpm uses a different data dir per platform, same bug class as npm above.
 */
export declare function pnpmGlobalCandidates(env?: NodeJS.ProcessEnv, platform?: NodeJS.Platform): string[];
/** Executable extensions we treat as runnable commands on each platform. */
export declare const EXECUTABLE_EXTS: string[];
/**
 * Split the current PATH into a de-duplicated list of absolute directories.
 * Empty segments and the literal `%VAR%` placeholders are dropped.
 */
export declare function getPathDirs(env?: NodeJS.ProcessEnv): string[];
/**
 * Enumerate executables directly inside every PATH directory (non-recursive).
 * This is the "PATH enumeration" technique — it finds every command-line tool
 * that is directly callable, regardless of how it was installed.
 */
export declare function enumPathExecutables(options?: {
    maxPerDir?: number;
}): PathExecutable[];
/**
 * Read the Windows "Add or Remove Programs" registry keys. These entries
 * represent programs managed by a Windows-level installer.
 *
 * Implementation note: we write the PowerShell snippet to a temporary `.ps1`
 * file and invoke it with `-File`. This avoids the quote-escaping corruption
 * that occurs when passing a complex script through `-Command` from Node, and
 * it lets us force UTF-8 output so non-ASCII product names survive intact.
 */
export declare function readArpEntries(): ManagedApp[];
/**
 * Merge helper: keep the first occurrence of each key. Later duplicates are
 * dropped but can be used to enrich (e.g. fill in a missing path).
 */
export declare function dedupeBy<T>(items: T[], keyOf: (item: T) => string): T[];
/**
 * Normalise a name for fuzzy matching (strip scope, punctuation, casing).
 */
export declare function normalizeName(name: string): string;
/**
 * Does an ARP display name correspond to a discovered command/package name?
 * Uses a normalised substring match in either direction.
 */
export declare function namesLikelyMatch(a: string, b: string): boolean;
//# sourceMappingURL=utils.d.ts.map