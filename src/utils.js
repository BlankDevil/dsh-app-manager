/**
 * Utility functions for dsh-app-manager
 */

import { execSync, spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";

/**
 * Execute a command and return stdout/stderr
 */
export function execSafe(command, options = {}) {
  try {
    const result = execSync(command, {
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
      timeout: 30000,
      ...options,
    });
    return { success: true, output: result.trim(), error: null };
  } catch (error) {
    return {
      success: false,
      output: error.stdout?.toString().trim() || "",
      error: error.stderr?.toString().trim() || error.message,
    };
  }
}

/**
 * Execute a command asynchronously
 */
export function execAsync(command, args = [], options = {}) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      stdio: ["pipe", "pipe", "pipe"],
      shell: process.platform === "win32",
      ...options,
    });

    let stdout = "";
    let stderr = "";

    child.stdout?.on("data", (data) => {
      stdout += data.toString();
    });

    child.stderr?.on("data", (data) => {
      stderr += data.toString();
    });

    child.on("close", (code) => {
      resolve({
        success: code === 0,
        output: stdout.trim(),
        error: stderr.trim(),
        code,
      });
    });

    child.on("error", (err) => {
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
export function formatBytes(bytes) {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
}

/**
 * Format duration
 */
export function formatDuration(ms) {
  if (ms < 1000) return ms + "ms";
  if (ms < 60000) return (ms / 1000).toFixed(1) + "s";
  if (ms < 3600000) return Math.floor(ms / 60000) + "m" + Math.floor((ms % 60000) / 1000) + "s";
  return Math.floor(ms / 3600000) + "h" + Math.floor((ms % 3600000) / 60000) + "m";
}

/**
 * Check if a command exists in PATH
 */
export function commandExists(command) {
  try {
    execSync(
      process.platform === "win32" ? `where ${command}` : `which ${command}`,
      { stdio: "ignore" }
    );
    return true;
  } catch {
    return false;
  }
}

/**
 * Get package.json from a package directory
 */
export function readPackageJson(dir) {
  const path = join(dir, "package.json");
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

/**
 * Parse npm list JSON output safely
 */
export function parseNpmList(jsonStr) {
  try {
    // npm list outputs lines, sometimes with warnings
    const lines = jsonStr.split("\n").filter((l) => l.trim());
    // Find the first valid JSON line
    for (const line of lines) {
      try {
        return JSON.parse(line);
      } catch {
        continue;
      }
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Compare two semantic versions
 * Returns: -1 if v1 < v2, 0 if equal, 1 if v1 > v2
 */
export function compareVersions(v1, v2) {
  const normalize = (v) =>
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
 * Colorize output (simple ANSI colors)
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

export function colorize(text, color) {
  return `${colors[color] || ""}${text}${colors.reset}`;
}

/**
 * Truncate string with ellipsis
 */
export function truncate(str, maxLength) {
  if (str.length <= maxLength) return str;
  return str.slice(0, maxLength - 3) + "...";
}

/**
 * Get current timestamp
 */
export function now() {
  return new Date().toISOString();
}
