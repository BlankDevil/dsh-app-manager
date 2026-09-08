/**
 * Utility functions for dsh-app-manager
 */

import { execSync, spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { ExecResult } from "./types.js";

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
 * Check if a command exists in PATH
 */
export function commandExists(command: string): boolean {
  try {
    execSync(process.platform === "win32" ? `where ${command}` : `which ${command}`, { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
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
