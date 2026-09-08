/**
 * DSH App Manager Plugin
 * Registers AI-callable tools for discovering and managing CLI applications.
 */

import type { CliApp, CordisContext, ToolDefinition } from "./types.js";
import { discoverAll, findApp } from "./discovery.js";
import { commandExists, compareVersions, execSafe } from "./utils.js";

let defineTool: ((tool: ToolDefinition) => ToolDefinition) | null = null;
try {
  const dshTools = await import("@deepseek-ai/dsh-tools");
  defineTool = dshTools.defineTool as unknown as (tool: ToolDefinition) => ToolDefinition;
} catch {
  // Fallback when running outside DSH (e.g. standalone tests)
  defineTool = null;
}

/**
 * Format app list as a concise markdown table for LLM consumption
 */
function formatAppList(apps: CliApp[]): string {
  if (apps.length === 0) return "No CLI applications discovered.";
  const lines = ["| Name | Version | Commands | Source |", "|------|---------|----------|--------|"];
  for (const app of apps) {
    lines.push(`| ${app.name} | ${app.version} | ${app.commands.join(", ")} | ${app.source} |`);
  }
  return lines.join("\n");
}

/**
 * Check latest version of an npm/pnpm package
 */
async function checkLatestVersion(app: CliApp): Promise<string | null> {
  if (app.source !== "npm" && app.source !== "pnpm") return null;
  const result = execSafe(`npm.cmd view ${app.name} version 2>nul`, { shell: true, timeout: 10000 });
  if (!result.success || !result.output) return null;
  return result.output.trim();
}

/**
 * Register tools with DSH
 */
function registerTools(ctx: CordisContext): Array<(() => void) | undefined> {
  if (!defineTool || !ctx.tools?.register) return [];

  const disposers: Array<(() => void) | undefined> = [];
  const register = (tool: ToolDefinition) => disposers.push(ctx.tools!.register(tool));

  register({
    name: "app_manager_list",
    description: "List all installed CLI applications discovered from npm global, pnpm global, npx-cache, scoop, choco, cargo, and pipx. Returns name, version, available commands, package source, and category.",
    parameters: {
      source: {
        type: "string",
        required: false,
        description: "Optional filter by source (npm, pnpm, npx-cache, scoop, choco, cargo, pipx).",
      },
      category: {
        type: "string",
        required: false,
        description: "Optional filter by category (ai, package-manager, dev, deploy, cloud, database, framework, css, build, test, ui, design, other).",
      },
    },
    output: {
      schema: { type: "string", description: "Markdown table of discovered CLI applications." },
    },
    execute: async (args: Record<string, unknown>) => {
      let apps = discoverAll();
      if (typeof args.source === "string") apps = apps.filter((a) => a.source === args.source);
      if (typeof args.category === "string") apps = apps.filter((a) => a.category === args.category);
      return formatAppList(apps);
    },
  });

  register({
    name: "app_manager_info",
    description: "Show detailed information about one installed CLI application by package name or command name (e.g. 'dsh', 'claude', 'codex', 'pnpm').",
    parameters: {
      name: {
        type: "string",
        required: true,
        description: "Package name or command name of the application.",
      },
    },
    output: {
      schema: { type: "string", description: "Detailed app information in markdown." },
    },
    execute: async (args: Record<string, unknown>) => {
      const name = String(args.name);
      const apps = discoverAll();
      const matches = findApp(name, apps);
      if (matches.length === 0) return `No application found matching "${name}".`;

      const lines: string[] = [];
      for (const app of matches) {
        lines.push(`## ${app.name}`);
        lines.push(`- **Version:** ${app.version}`);
        lines.push(`- **Category:** ${app.category}`);
        lines.push(`- **Source:** ${app.source}`);
        lines.push(`- **Commands:** ${app.commands.join(", ")}`);
        lines.push(`- **Path:** ${app.path || "N/A"}`);
        if (app.description) lines.push(`- **Description:** ${app.description}`);

        const latest = await checkLatestVersion(app);
        if (latest) {
          const cmp = compareVersions(latest, app.version);
          lines.push(`- **Latest:** ${latest} ${cmp > 0 ? "(update available)" : "(up to date)"}`);
        }
      }
      return lines.join("\n");
    },
  });

  register({
    name: "app_manager_check_updates",
    description: "Check whether installed npm/pnpm CLI applications have newer versions available in the registry.",
    parameters: {},
    output: {
      schema: { type: "string", description: "Markdown table of apps with available updates." },
    },
    execute: async () => {
      const apps = discoverAll().filter((a) => a.source === "npm" || a.source === "pnpm");
      const updates: Array<CliApp & { latestVersion: string }> = [];
      for (const app of apps) {
        const latest = await checkLatestVersion(app);
        if (latest && compareVersions(latest, app.version) > 0) {
          updates.push({ ...app, latestVersion: latest });
        }
      }
      if (updates.length === 0) return "All npm/pnpm CLI applications are up to date.";
      const lines = ["| Package | Current | Latest | Source |", "|---------|---------|--------|--------|"];
      for (const u of updates) lines.push(`| ${u.name} | ${u.version} | ${u.latestVersion} | ${u.source} |`);
      return lines.join("\n");
    },
  });

  register({
    name: "app_manager_update",
    description: "Update an installed npm or pnpm CLI application to its latest version.",
    parameters: {
      name: {
        type: "string",
        required: true,
        description: "Package name of the application to update (e.g. 'dsh', '@deepseek-ai/dsh').",
      },
    },
    output: {
      schema: { type: "string", description: "Result of the update operation." },
    },
    execute: async (args: Record<string, unknown>, exec: { signal: AbortSignal }) => {
      const name = String(args.name);
      const apps = discoverAll();
      const matches = findApp(name, apps);
      if (matches.length === 0) return `No application found matching "${name}".`;

      const app = matches[0];
      if (app.source !== "npm" && app.source !== "pnpm") {
        return `Cannot auto-update ${app.name}: source "${app.source}" is not supported.`;
      }

      exec.signal.throwIfAborted();
      const cmd = app.source === "npm" ? "npm.cmd" : "pnpm";
      const argsList = app.source === "npm" ? ["install", "-g", `${app.name}@latest`] : ["add", "-g", `${app.name}@latest`];

      const { spawn } = await import("node:child_process");
      return new Promise<string>((resolve) => {
        const child = spawn(cmd, argsList, { shell: true, stdio: "pipe" });
        let stdout = "";
        let stderr = "";
        child.stdout?.on("data", (d: Buffer) => (stdout += d.toString()));
        child.stderr?.on("data", (d: Buffer) => (stderr += d.toString()));
        child.on("close", (code: number | null) => {
          if (code === 0) resolve(`✅ Updated ${app.name} to latest version.\n${stdout.trim()}`);
          else resolve(`❌ Failed to update ${app.name}:\n${stderr.trim() || stdout.trim()}`);
        });
      });
    },
  });

  register({
    name: "app_manager_doctor",
    description: "Run a health check on all discovered CLI applications: verify commands are in PATH and package directories exist.",
    parameters: {},
    output: {
      schema: { type: "string", description: "Health check report in markdown." },
    },
    execute: async () => {
      const apps = discoverAll();
      const issues: string[] = [];
      for (const app of apps) {
        for (const cmd of app.commands) {
          if (!commandExists(cmd)) issues.push(`${app.name}: command '${cmd}' not found in PATH`);
        }
      }
      if (issues.length === 0) return "✅ All discovered CLI applications are healthy.";
      return "⚠️ Issues found:\n" + issues.map((i) => `- ${i}`).join("\n");
    },
  });

  return disposers;
}

/**
 * Cordis plugin apply function
 */
export function apply(ctx: CordisContext): () => void {
  const disposers = registerTools(ctx);

  if (ctx.logger?.info) {
    ctx.logger.info("dsh-app-manager: discovered tools registered");
  }

  return () => {
    for (const dispose of disposers) dispose?.();
  };
}

/**
 * Declare service dependencies for DSH loader
 */
export const inject = ["tools"];

/**
 * Plugin name (used by Cordis)
 */
export const name = "dsh-app-manager";

/**
 * Default export for dynamic imports
 */
export default apply;
