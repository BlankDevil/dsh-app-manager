/**
 * Utility functions for dsh-app-manager
 */

import { execFileSync, execSync, spawn } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, extname, join } from "node:path";
import type { ExecResult, ManagedApp, PathExecutable } from "./types.js";

/**
 * Execute a command synchronously and return stdout/stderr
 */
export function execSafe(command: string, options: { shell?: boolean | string; timeout?: number; cwd?: string } = {}): ExecResult {
  try {
    const result = execSync(command, {
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
      timeout: 30000,
      ...options,
    } as import("node:child_process").ExecSyncOptions) as string;
    return { success: true, output: result.trim(), error: "" };
  } catch (error: unknown) {
    const err = error as {
      stdout?: Buffer;
      stderr?: Buffer;
      message?: string;
    };
    return {
      success: false,
      output: err.stdout?.toString().trim() || "",
      error: err.stderr?.toString().trim() || err.message || String(error),
    };
  }
}

/**
 * Execute a command asynchronously
 */
export function execAsync(
  command: string,
  args: string[] = [],
  options: { shell?: boolean | string; timeout?: number; cwd?: string } = {}
): Promise<ExecResult> {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      stdio: ["pipe", "pipe", "pipe"],
      shell: process.platform === "win32",
      ...options,
    });

    let stdout = "";
    let stderr = "";

    child.stdout?.on("data", (data: Buffer) => {
      stdout += data.toString();
    });

    child.stderr?.on("data", (data: Buffer) => {
      stderr += data.toString();
    });

    child.on("close", (code: number | null) => {
      resolve({
        success: code === 0,
        output: stdout.trim(),
        error: stderr.trim(),
        code: code ?? undefined,
      });
    });

    child.on("error", (err: Error) => {
      resolve({
        success: false,
        output: stdout.trim(),
        error: err.message,
        code: -1,
      });
    });
  });
}

/**
 * Format bytes to human readable string
 */
export function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
}

/**
 * Format duration in milliseconds
 */
export function formatDuration(ms: number): string {
  if (ms < 1000) return ms + "ms";
  if (ms < 60000) return (ms / 1000).toFixed(1) + "s";
  if (ms < 3600000) return Math.floor(ms / 60000) + "m" + Math.floor((ms % 60000) / 1000) + "s";
  return Math.floor(ms / 3600000) + "h" + Math.floor((ms % 3600000) / 60000) + "m";
}

/**
 * Check if a command exists in PATH.
 *
 * This spawns a child process (`where` / `which`), so for bulk checks prefer
 * `pathIndexHas()` which reuses a cached directory listing.
 */
export function commandExists(command: string): boolean {
  try {
    execSync(process.platform === "win32" ? `where ${command}` : `which ${command}`, { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

let pathIndexCache: Map<string, PathExecutable[]> | null = null;

/** Build (once) an index of command name -> PATH executables. */
function getPathIndex(): Map<string, PathExecutable[]> {
  if (pathIndexCache) return pathIndexCache;
  const index = new Map<string, PathExecutable[]>();
  for (const exe of enumPathExecutables()) {
    const key = exe.command.toLowerCase();
    const list = index.get(key);
    if (list) list.push(exe);
    else index.set(key, [exe]);
  }
  pathIndexCache = index;
  return index;
}

/**
 * Check whether a command is on PATH using the cached directory index.
 * Much faster than `commandExists` when checking many commands.
 */
export function pathIndexHas(command: string): boolean {
  return getPathIndex().has(command.toLowerCase());
}

/** Clear the cached PATH index (useful for tests). */
export function resetPathIndex(): void {
  pathIndexCache = null;
}

/* -------------------------------------------------------------------------- */
/*  Subprocess diagnostics                                                    */
/* -------------------------------------------------------------------------- */

/**
 * One-line reason why the last child process failed, or `""` if it succeeded.
 *
 * Why this exists: on Windows with a locked-down Application Control policy
 * (or a security agent's program blacklist), spawning `powershell` can fail
 * outright. The old ARP reader swallowed the exception and returned `[]`, so
 * the whole "managed vs unmanaged" classification silently degraded to
 * "everything is unmanaged" with no visible cause. Callers can surface this
 * string in the scan report instead of guessing.
 */
let lastSpawnError = "";

export function getLastSpawnError(): string {
  return lastSpawnError;
}

/** Record a spawn failure reason (best effort — truncates very long text). */
export function noteSpawnError(message: string): void {
  lastSpawnError = message.length > 300 ? message.slice(0, 300) + "..." : message;
}

/**
 * Read package.json from a directory
 */
export function readPackageJson(dir: string): Record<string, unknown> | null {
  const path = join(dir, "package.json");
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/**
 * Compare two semantic versions
 * Returns: -1 if v1 < v2, 0 if equal, 1 if v1 > v2
 */
export function compareVersions(v1: string, v2: string): number {
  const normalize = (v: string): number[] =>
    v
      .replace(/^v/, "")
      .split(".")
      .map((n) => parseInt(n, 10) || 0);
  const a = normalize(v1);
  const b = normalize(v2);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i] || 0;
    const y = b[i] || 0;
    if (x < y) return -1;
    if (x > y) return 1;
  }
  return 0;
}

/**
 * Colorize output with ANSI codes
 */
export const colors = {
  reset: "\x1b[0m",
  bright: "\x1b[1m",
  dim: "\x1b[2m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
  white: "\x1b[37m",
  gray: "\x1b[90m",
};

export function colorize(text: string, color: keyof typeof colors): string {
  return `${colors[color] || ""}${text}${colors.reset}`;
}

/**
 * Truncate string with ellipsis
 */
export function truncate(str: string, maxLength: number): string {
  if (str.length <= maxLength) return str;
  return str.slice(0, maxLength - 3) + "...";
}

/* -------------------------------------------------------------------------- */
/*  Well-known directory resolution (env-var tolerant)                        */
/* -------------------------------------------------------------------------- */

/**
 * Resolve the user's roaming AppData directory.
 *
 * `process.env.APPDATA` is not guaranteed to be present (e.g. when spawned from
 * a shell that does not export it). Fall back to the conventional location
 * derived from the home directory.
 */
export function appDataDir(env: NodeJS.ProcessEnv = process.env): string {
  if (env.APPDATA) return env.APPDATA;
  if (env.USERPROFILE) return join(env.USERPROFILE, "AppData", "Roaming");
  if (env.HOME) return join(env.HOME, "AppData", "Roaming");
  return "";
}

/** Resolve the user's local AppData directory with the same fallbacks. */
export function localAppDataDir(env: NodeJS.ProcessEnv = process.env): string {
  if (env.LOCALAPPDATA) return env.LOCALAPPDATA;
  if (env.USERPROFILE) return join(env.USERPROFILE, "AppData", "Local");
  if (env.HOME) return join(env.HOME, "AppData", "Local");
  return "";
}

/** Resolve the user's home / profile directory. */
export function homeDir(env: NodeJS.ProcessEnv = process.env): string {
  return env.USERPROFILE || env.HOME || env.HOMEPATH || "";
}

/* -------------------------------------------------------------------------- */
/*  PATH enumeration                                                          */
/* -------------------------------------------------------------------------- */

/** Executable extensions we treat as runnable commands on each platform. */
export const EXECUTABLE_EXTS =
  process.platform === "win32"
    ? [".exe", ".cmd", ".bat", ".com", ".ps1"]
    : [""];

/** Extensions that are documentation / metadata rather than programs. */
const NON_PROGRAM_EXTS = [".md", ".txt", ".json", ".yml", ".yaml", ".map"];

/**
 * Split the current PATH into a de-duplicated list of absolute directories.
 * Empty segments and the literal `%VAR%` placeholders are dropped.
 */
export function getPathDirs(env: NodeJS.ProcessEnv = process.env): string[] {
  const raw = env.PATH || env.Path || "";
  const sep = process.platform === "win32" ? ";" : ":";
  const seen = new Set<string>();
  const dirs: string[] = [];

  for (const segment of raw.split(sep)) {
    const dir = segment.trim().replace(/^"|"$/g, "");
    if (!dir) continue;
    // Skip unresolved placeholders like %JAVA_HOME%\bin
    if (/%[^%]+%/.test(dir)) continue;
    const key = dir.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    dirs.push(dir);
  }

  return dirs;
}

/**
 * Enumerate executables directly inside every PATH directory (non-recursive).
 * This is the "PATH enumeration" technique — it finds every command-line tool
 * that is directly callable, regardless of how it was installed.
 */
export function enumPathExecutables(options: { maxPerDir?: number } = {}): PathExecutable[] {
  const { maxPerDir = 400 } = options;
  const results: PathExecutable[] = [];

  for (const dir of getPathDirs()) {
    if (!existsSync(dir)) continue;
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      continue;
    }

    let count = 0;
    for (const entry of entries) {
      if (count >= maxPerDir) break;
      const ext = extname(entry).toLowerCase();
      const isProgram =
        (process.platform === "win32" && EXECUTABLE_EXTS.includes(ext)) ||
        (process.platform !== "win32" && ext === "");

      if (!isProgram) continue;
      if (NON_PROGRAM_EXTS.includes(ext)) continue;

      const full = join(dir, entry);
      try {
        if (!statSync(full).isFile()) continue;
      } catch {
        continue;
      }

      const command = process.platform === "win32" ? basename(entry, ext) : basename(entry);
      results.push({ command, path: full, dir, ext });
      count++;
    }
  }

  return results;
}

/* -------------------------------------------------------------------------- */
/*  Windows Add/Remove Programs (ARP) registry baseline                       */
/* -------------------------------------------------------------------------- */

/**
 * Read the Windows "Add or Remove Programs" registry keys. These entries
 * represent programs managed by a Windows-level installer.
 *
 * Implementation note: we write the PowerShell snippet to a temporary `.ps1`
 * file and invoke it with `-File`. This avoids the quote-escaping corruption
 * that occurs when passing a complex script through `-Command` from Node, and
 * it lets us force UTF-8 output so non-ASCII product names survive intact.
 */
export function readArpEntries(): ManagedApp[] {
  if (process.platform !== "win32") return [];

  const script = [
    "$ErrorActionPreference = 'SilentlyContinue'",
    "[Console]::OutputEncoding = [System.Text.Encoding]::UTF8",
    "$keys = @(",
    "  'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*',",
    "  'HKLM:\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*',",
    "  'HKCU:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*'",
    ")",
    "$rows = foreach ($k in $keys) {",
    "  Get-ItemProperty $k | Where-Object { $_.DisplayName } |",
    "    Select-Object DisplayName, DisplayVersion, Publisher, InstallLocation",
    "}",
    "$rows | ConvertTo-Json -Compress -Depth 3",
  ].join("\n");

  let tmpFile = "";
  try {
    const dir = tmpdir();
    tmpFile = join(dir, `dsh-app-manager-arp-${process.pid}.ps1`);
    writeFileSync(tmpFile, script, "utf8");

    const out = execFileSync(
      "powershell",
      ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", tmpFile],
      { encoding: "utf8", timeout: 30000, maxBuffer: 16 * 1024 * 1024 }
    );

    return parseArpJson(out);
  } catch (error: unknown) {
    // Keep the reason so callers can report *why* the baseline is missing
    // rather than silently treating every app as unmanaged.
    noteSpawnError((error as { message?: string })?.message || String(error));
    return [];
  } finally {
    if (tmpFile) {
      try {
        unlinkSync(tmpFile);
      } catch {
        // best effort cleanup
      }
    }
  }
}

/** Parse the JSON emitted by the ARP PowerShell snippet into ManagedApp[]. */
function parseArpJson(output: string): ManagedApp[] {
  const trimmed = output.trim();
  if (!trimmed) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return [];
  }

  const rows = Array.isArray(parsed) ? parsed : [parsed];
  const out: ManagedApp[] = [];
  const seen = new Set<string>();

  for (const row of rows as Array<Record<string, unknown>>) {
    const name = typeof row.DisplayName === "string" ? row.DisplayName.trim() : "";
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);

    out.push({
      name,
      version: typeof row.DisplayVersion === "string" ? row.DisplayVersion : "",
      publisher: typeof row.Publisher === "string" ? row.Publisher : "",
      installLocation:
        typeof row.InstallLocation === "string" ? row.InstallLocation.replace(/^"|"$/g, "") : "",
    });
  }

  return out;
}

/* -------------------------------------------------------------------------- */
/*  De-duplication helpers                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Merge helper: keep the first occurrence of each key. Later duplicates are
 * dropped but can be used to enrich (e.g. fill in a missing path).
 */
export function dedupeBy<T>(items: T[], keyOf: (item: T) => string): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const item of items) {
    const key = keyOf(item).toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

/**
 * Normalise a name for fuzzy matching (strip scope, punctuation, casing).
 */
export function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/^@[^/]+\//, "")
    .replace(/[^a-z0-9]/g, "");
}

/**
 * Does an ARP display name correspond to a discovered command/package name?
 * Uses a normalised substring match in either direction.
 */
export function namesLikelyMatch(a: string, b: string): boolean {
  const na = normalizeName(a);
  const nb = normalizeName(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  if (na.length >= 4 && nb.length >= 4 && (na.includes(nb) || nb.includes(na))) return true;
  return false;
}
