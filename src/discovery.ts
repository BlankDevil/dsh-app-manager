/**
 * Discovery module - finds installed CLI tools across package managers
 */

import { existsSync, readdirSync } from "node:fs";
import { basename, join } from "node:path";
import type { AppCategory, AppSource, CliApp, KnownPackageInfo } from "./types.js";
import { commandExists, execSafe, readPackageJson } from "./utils.js";

/**
 * Known CLI tool mappings (package name -> command names)
 */
const KNOWN_CLI_PACKAGES: Record<string, KnownPackageInfo> = {
  "@anthropic-ai/claude-code": { commands: ["claude"], category: "ai", desc: "Claude Code - AI coding assistant" },
  "@openai/codex": { commands: ["codex"], category: "ai", desc: "OpenAI Codex CLI" },
  "@deepseek-ai/dsh": { commands: ["dsh"], category: "ai", desc: "DeepSeek Harness CLI" },
  "pnpm": { commands: ["pnpm"], category: "package-manager", desc: "Fast, disk space efficient package manager" },
  "npm": { commands: ["npm", "npx"], category: "package-manager", desc: "Node.js package manager" },
  "yarn": { commands: ["yarn"], category: "package-manager", desc: "Yarn package manager" },
  "typescript": { commands: ["tsc"], category: "dev", desc: "TypeScript compiler" },
  "tsx": { commands: ["tsx"], category: "dev", desc: "TypeScript execute" },
  "nodemon": { commands: ["nodemon"], category: "dev", desc: "Node.js monitor" },
  "pm2": { commands: ["pm2"], category: "dev", desc: "Process manager" },
  "vite": { commands: ["vite"], category: "dev", desc: "Next generation frontend tooling" },
  "esbuild": { commands: ["esbuild"], category: "dev", desc: "JavaScript bundler" },
  "eslint": { commands: ["eslint"], category: "dev", desc: "JavaScript linter" },
  "prettier": { commands: ["prettier"], category: "dev", desc: "Code formatter" },
  "http-server": { commands: ["http-server"], category: "dev", desc: "Simple HTTP server" },
  "serve": { commands: ["serve"], category: "dev", desc: "Static file serving" },
  "vercel": { commands: ["vercel"], category: "deploy", desc: "Vercel CLI" },
  "netlify-cli": { commands: ["netlify"], category: "deploy", desc: "Netlify CLI" },
  "firebase-tools": { commands: ["firebase"], category: "deploy", desc: "Firebase CLI" },
  "aws-cdk": { commands: ["cdk"], category: "cloud", desc: "AWS CDK CLI" },
  "@aws-amplify/cli": { commands: ["amplify"], category: "cloud", desc: "AWS Amplify CLI" },
  "supabase": { commands: ["supabase"], category: "cloud", desc: "Supabase CLI" },
  "prisma": { commands: ["prisma"], category: "database", desc: "Prisma ORM CLI" },
  "@nestjs/cli": { commands: ["nest"], category: "framework", desc: "NestJS CLI" },
  "@angular/cli": { commands: ["ng"], category: "framework", desc: "Angular CLI" },
  "@vue/cli": { commands: ["vue"], category: "framework", desc: "Vue CLI" },
  "create-react-app": { commands: ["create-react-app"], category: "framework", desc: "Create React App" },
  "next": { commands: ["next"], category: "framework", desc: "Next.js CLI" },
  "nuxt": { commands: ["nuxt"], category: "framework", desc: "Nuxt.js CLI" },
  "astro": { commands: ["astro"], category: "framework", desc: "Astro CLI" },
  "svelte-kit": { commands: ["svelte-kit"], category: "framework", desc: "SvelteKit CLI" },
  "tailwindcss": { commands: ["tailwindcss"], category: "css", desc: "Tailwind CSS CLI" },
  "sass": { commands: ["sass"], category: "css", desc: "Sass compiler" },
  "less": { commands: ["lessc"], category: "css", desc: "Less compiler" },
  "webpack": { commands: ["webpack"], category: "build", desc: "Webpack bundler" },
  "rollup": { commands: ["rollup"], category: "build", desc: "Rollup bundler" },
  "parcel": { commands: ["parcel"], category: "build", desc: "Parcel bundler" },
  "turbo": { commands: ["turbo"], category: "build", desc: "Turborepo CLI" },
  "nx": { commands: ["nx"], category: "build", desc: "Nx monorepo CLI" },
  "lerna": { commands: ["lerna"], category: "build", desc: "Lerna monorepo tool" },
  "changesets": { commands: ["changeset"], category: "build", desc: "Changesets versioning" },
  "semantic-release": { commands: ["semantic-release"], category: "build", desc: "Automated versioning" },
  "commitlint": { commands: ["commitlint"], category: "dev", desc: "Commit message linter" },
  "lint-staged": { commands: ["lint-staged"], category: "dev", desc: "Run linters on git staged files" },
  "husky": { commands: ["husky"], category: "dev", desc: "Git hooks manager" },
  "git-cz": { commands: ["git-cz", "cz"], category: "dev", desc: "Commitizen CLI" },
  "newman": { commands: ["newman"], category: "test", desc: "Postman CLI" },
  "playwright": { commands: ["playwright"], category: "test", desc: "Playwright testing" },
  "cypress": { commands: ["cypress"], category: "test", desc: "Cypress testing" },
  "vitest": { commands: ["vitest"], category: "test", desc: "Vitest testing" },
  "jest": { commands: ["jest"], category: "test", desc: "Jest testing framework" },
  "mocha": { commands: ["mocha"], category: "test", desc: "Mocha testing framework" },
  "ava": { commands: ["ava"], category: "test", desc: "AVA test runner" },
  "tap": { commands: ["tap"], category: "test", desc: "TAP test runner" },
  "nyc": { commands: ["nyc"], category: "test", desc: "Istanbul coverage" },
  "c8": { commands: ["c8"], category: "test", desc: "V8 coverage" },
  "storybook": { commands: ["storybook"], category: "ui", desc: "Storybook CLI" },
  "chromatic": { commands: ["chromatic"], category: "ui", desc: "Chromatic visual testing" },
  "figma-cli": { commands: ["figma"], category: "design", desc: "Figma CLI" },
  "github-copilot-cli": { commands: ["ghc"], category: "ai", desc: "GitHub Copilot CLI" },
  "aicommits": { commands: ["aicommits"], category: "ai", desc: "AI-generated commits" },
  "opencommit": { commands: ["opencommit"], category: "ai", desc: "AI commit messages" },
};

/**
 * Detect CLI metadata from a package directory
 */
function detectCliFromPackageJson(pkgPath: string, pkgName: string): CliApp | null {
  const pkg = readPackageJson(pkgPath);
  if (!pkg) return null;

  const commands: string[] = [];

  // Check bin field
  if (pkg.bin) {
    if (typeof pkg.bin === "string") {
      commands.push(basename(pkgName));
    } else if (typeof pkg.bin === "object" && pkg.bin !== null) {
      commands.push(...Object.keys(pkg.bin));
    }
  }

  // Check direct binaries in package directory
  const binDir = join(pkgPath, "bin");
  if (existsSync(binDir)) {
    try {
      const bins = readdirSync(binDir).filter((f) => !f.endsWith(".md") && !f.endsWith(".txt"));
      for (const bin of bins) {
        const cleanBin = bin.replace(/\.cmd$/, "").replace(/\.ps1$/, "");
        if (!commands.includes(cleanBin)) commands.push(cleanBin);
      }
    } catch {
      // ignore
    }
  }

  if (commands.length === 0) return null;

  const known = KNOWN_CLI_PACKAGES[pkgName];
  return {
    name: pkgName,
    version: typeof pkg.version === "string" ? pkg.version : "unknown",
    commands: [...new Set(commands)],
    category: known?.category || "other",
    description: known?.desc || (typeof pkg.description === "string" ? pkg.description : ""),
    source: "npm",
    path: pkgPath,
    hasUpdate: false,
    latestVersion: null,
  };
}

/**
 * Discover npm globally installed CLI packages by reading filesystem
 */
export function discoverNpmGlobal(): CliApp[] {
  const apps: CliApp[] = [];
  const globalDir = join(process.env.APPDATA || "", "npm", "node_modules");

  if (!existsSync(globalDir)) return apps;

  try {
    const entries = readdirSync(globalDir, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;

      if (entry.name.startsWith("@")) {
        const scopeDir = join(globalDir, entry.name);
        try {
          const scopedEntries = readdirSync(scopeDir, { withFileTypes: true });
          for (const scopedEntry of scopedEntries) {
            if (!scopedEntry.isDirectory()) continue;
            const fullName = `${entry.name}/${scopedEntry.name}`;
            const pkgPath = join(scopeDir, scopedEntry.name);
            const app = detectCliFromPackageJson(pkgPath, fullName);
            if (app) {
              app.source = "npm";
              apps.push(app);
            }
          }
        } catch {
          // ignore scope read errors
        }
      } else {
        const pkgPath = join(globalDir, entry.name);
        const app = detectCliFromPackageJson(pkgPath, entry.name);
        if (app) {
          app.source = "npm";
          apps.push(app);
        }
      }
    }
  } catch {
    // ignore read errors
  }

  return apps;
}

/**
 * Discover pnpm globally installed CLI packages
 */
export function discoverPnpmGlobal(): CliApp[] {
  const apps: CliApp[] = [];
  if (!commandExists("pnpm")) return apps;

  const result = execSafe("pnpm list -g --json 2>nul", { shell: true });
  if (!result.success) return apps;

  try {
    const data = JSON.parse(result.output) as Record<string, unknown> | Record<string, unknown>[];
    const packages = Array.isArray(data) ? data : [data];

    for (const pkg of packages) {
      const deps = pkg.dependencies as Record<string, { version?: string; path?: string } > | undefined;
      if (!deps) continue;
      for (const [name, info] of Object.entries(deps)) {
        const pkgPath = info.path || join(process.env.PNPM_HOME || "", "global", "node_modules", name);
        const app = detectCliFromPackageJson(pkgPath, name);
        if (app) {
          app.version = info.version || app.version;
          app.source = "pnpm";
          apps.push(app);
        }
      }
    }
  } catch {
    // ignore parse errors
  }

  return apps;
}

/**
 * Discover npx cached packages
 */
export function discoverNpxCache(): CliApp[] {
  const apps: CliApp[] = [];
  const npxCache = join(process.env.LOCALAPPDATA || "", "npm-cache", "_npx");

  if (!existsSync(npxCache)) return apps;

  try {
    const entries = readdirSync(npxCache, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const pkgPath = join(npxCache, entry.name, "node_modules");
      if (!existsSync(pkgPath)) continue;

      try {
        const pkgs = readdirSync(pkgPath, { withFileTypes: true });
        for (const pkg of pkgs) {
          if (!pkg.isDirectory() || pkg.name.startsWith(".")) continue;
          const fullPath = join(pkgPath, pkg.name);
          const app = detectCliFromPackageJson(fullPath, pkg.name);
          if (app) {
            app.source = "npx-cache";
            apps.push(app);
          }
        }
      } catch {
        // ignore
      }
    }
  } catch {
    // ignore
  }

  return apps;
}

/**
 * Discover scoop installed apps
 */
export function discoverScoop(): CliApp[] {
  const apps: CliApp[] = [];
  const scoopDir = join(process.env.USERPROFILE || "", "scoop", "apps");
  if (!existsSync(scoopDir)) return apps;

  try {
    const entries = readdirSync(scoopDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const appDir = join(scoopDir, entry.name, "current");
      if (!existsSync(appDir)) continue;

      const commands: string[] = [];
      const binDir = join(appDir, "bin");
      if (existsSync(binDir)) {
        try {
          const bins = readdirSync(binDir).filter((f) => f.endsWith(".exe") || !f.includes("."));
          for (const b of bins) {
            const clean = b.replace(".exe", "");
            if (!commands.includes(clean)) commands.push(clean);
          }
        } catch {
          // ignore
        }
      }

      const shimDir = join(process.env.USERPROFILE || "", "scoop", "shims");
      if (existsSync(shimDir)) {
        try {
          const shims = readdirSync(shimDir).filter((f) =>
            f.startsWith(entry.name) && (f.endsWith(".exe") || f.endsWith(".cmd") || f.endsWith(".ps1"))
          );
          for (const shim of shims) {
            const clean = shim.replace(/\.(exe|cmd|ps1)$/, "");
            if (!commands.includes(clean)) commands.push(clean);
          }
        } catch {
          // ignore
        }
      }

      if (commands.length > 0) {
        apps.push({
          name: entry.name,
          version: "unknown",
          commands: [...new Set(commands)],
          category: "other",
          description: "",
          source: "scoop",
          path: appDir,
          hasUpdate: false,
          latestVersion: null,
        });
      }
    }
  } catch {
    // ignore
  }

  return apps;
}

/**
 * Discover chocolatey installed apps
 */
export function discoverChoco(): CliApp[] {
  const apps: CliApp[] = [];
  if (!commandExists("choco")) return apps;

  const result = execSafe("choco list --local-only 2>nul", { shell: true });
  if (!result.success) return apps;

  const lines = result.output.split("\n");
  for (const line of lines) {
    const match = line.match(/^(\S+)\s+(\S+)/);
    if (match && !line.includes("packages installed")) {
      apps.push({
        name: match[1],
        version: match[2],
        commands: [match[1].toLowerCase()],
        category: "other",
        description: "",
        source: "choco",
        path: "",
        hasUpdate: false,
        latestVersion: null,
      });
    }
  }

  return apps;
}

/**
 * Discover cargo installed apps
 */
export function discoverCargo(): CliApp[] {
  const apps: CliApp[] = [];
  if (!commandExists("cargo")) return apps;

  const result = execSafe("cargo install --list 2>nul", { shell: true });
  if (!result.success) return apps;

  const lines = result.output.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.startsWith(" ")) continue;

    const match = line.match(/^(\S+)\s+v(\S+):/);
    if (match) {
      const bins: string[] = [];
      while (i + 1 < lines.length && lines[i + 1].trim().startsWith("-")) {
        i++;
        const binMatch = lines[i].match(/-\s+(.+)$/);
        if (binMatch) {
          bins.push(basename(binMatch[1].trim()));
        }
      }

      apps.push({
        name: match[1],
        version: match[2],
        commands: bins.length > 0 ? bins : [match[1]],
        category: "other",
        description: "",
        source: "cargo",
        path: "",
        hasUpdate: false,
        latestVersion: null,
      });
    }
  }

  return apps;
}

/**
 * Discover pipx installed apps
 */
export function discoverPipx(): CliApp[] {
  const apps: CliApp[] = [];
  if (!commandExists("pipx")) return apps;

  const result = execSafe("pipx list --json 2>nul", { shell: true });
  if (!result.success) return apps;

  try {
    const data = JSON.parse(result.output) as {
      venvs?: Record<
        string,
        {
          metadata?: {
            package_version?: string;
            injected_packages?: Array<{ package: string }>;
            venv_metadata?: { venv_dir?: string };
          };
        }
      >;
    };
    for (const [name, info] of Object.entries(data.venvs || {})) {
      const injected = info.metadata?.injected_packages?.map((p) => p.package) || [name];
      apps.push({
        name,
        version: info.metadata?.package_version || "unknown",
        commands: injected,
        category: "other",
        description: "",
        source: "pipx",
        path: info.metadata?.venv_metadata?.venv_dir || "",
        hasUpdate: false,
        latestVersion: null,
      });
    }
  } catch {
    // ignore
  }

  return apps;
}

/**
 * Discover all installed CLI applications
 */
export function discoverAll(): CliApp[] {
  const sources: Array<{ name: string; fn: () => CliApp[] }> = [
    { name: "npm", fn: discoverNpmGlobal },
    { name: "pnpm", fn: discoverPnpmGlobal },
    { name: "npx-cache", fn: discoverNpxCache },
    { name: "scoop", fn: discoverScoop },
    { name: "choco", fn: discoverChoco },
    { name: "cargo", fn: discoverCargo },
    { name: "pipx", fn: discoverPipx },
  ];

  const allApps: CliApp[] = [];
  const seen = new Set<string>();

  for (const source of sources) {
    try {
      const apps = source.fn();
      for (const app of apps) {
        const key = `${app.name}@${app.source}`;
        if (!seen.has(key)) {
          seen.add(key);
          allApps.push(app);
        }
      }
    } catch {
      // Silently skip failing sources
    }
  }

  return allApps;
}

/**
 * Find apps by name or command
 */
export function findApp(name: string, apps: CliApp[]): CliApp[] {
  return apps.filter(
    (app) =>
      app.name.toLowerCase() === name.toLowerCase() ||
      app.commands.some((cmd) => cmd.toLowerCase() === name.toLowerCase())
  );
}
