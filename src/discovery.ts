/**
 * Discovery module - finds installed CLI tools across package managers
 *
 * Scanning strategy (multi-source cross-reference):
 *   1. Package managers   -> npm / pnpm / npx-cache / scoop / choco / cargo / pipx / pip / uv
 *   2. PATH enumeration   -> every executable directly callable on PATH
 *   3. ARP registry       -> Windows Add/Remove baseline, used to mark "managed"
 *   4. Cross-reference    -> anything on PATH but absent from the ARP baseline
 *                            is flagged as unmanaged (portable / manually-placed)
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import type {
  AppCategory,
  CliApp,
  KnownPackageInfo,
  ManagedApp,
  PathExecutable,
  ScanReport,
  ScanSourceReport,
} from "./types.js";
import {
  appDataDir,
  dedupeBy,
  enumPathExecutables,
  execSafe,
  getLastSpawnError,
  homeDir,
  localAppDataDir,
  namesLikelyMatch,
  npmGlobalRoot,
  npxCacheCandidates,
  pathIndexHas,
  pnpmGlobalCandidates,
  readArpEntries,
  readPackageJson,
} from "./utils.js";

/* -------------------------------------------------------------------------- */
/*  Scan-result cache                                                         */
/* -------------------------------------------------------------------------- */

/**
 * TTL (ms) for the in-process scan cache. Override with the
 * APP_MANAGER_SCAN_TTL_MS env var. CLI processes (one-shot) are unaffected
 * because each invocation starts a fresh Node — only the in-process DSH
 * tool + web routes benefit.
 */
const SCAN_TTL_MS = Number(process.env.APP_MANAGER_SCAN_TTL_MS) || 60_000;

interface BaselineCacheEntry {
  ts: number;
  data: ManagedApp[];
}
interface AllCacheEntry {
  ts: number;
  apps: CliApp[];
  baseline: ManagedApp[];
}

let baselineCache: BaselineCacheEntry | null = null;
let allCache: AllCacheEntry | null = null;

/** Internal: read the ARP baseline through a TTL cache. */
function readBaselineCached(): ManagedApp[] {
  if (baselineCache && Date.now() - baselineCache.ts < SCAN_TTL_MS) {
    return baselineCache.data;
  }
  const data = readArpEntries();
  if (data.length === 0 && process.platform === "win32") {
    // On Windows a healthy ARP read always returns many rows. Getting zero
    // means the PowerShell spawn was blocked or failed, which would make every
    // app look "unmanaged". Log the reason once instead of failing silently.
    const why = getLastSpawnError();
    if (why) {
      console.warn(
        `[dsh-app-manager] ARP baseline unavailable — managed/unmanaged classification ` +
          `will be degraded. Reason: ${why}`
      );
    }
  }
  baselineCache = { ts: Date.now(), data };
  return data;
}

function invalidateAllCache(): void {
  allCache = null;
}

/* -------------------------------------------------------------------------- */
/*  Slow source-probe memoisation                                             */
/* -------------------------------------------------------------------------- */

/**
 * Per-source TTL cache for `discoverXxx()` results.
 *
 * Why this matters: each `discoverXxx()` shells out to a package manager
 * (`pnpm list -g`, `pip list`, `uv tool list`, `cargo install --list`, ...).
 * On Windows every one of those spawns `cmd.exe` -> batch shim -> interpreter,
 * which measured 0.8-3.4s each. They are *not* covered by the `allCache` TTL
 * above, because `buildScanReport()` and the doctor/legacy paths call the
 * individual discoverers directly — so a page render used to pay ~7s of
 * blocking subprocess time on *every* request.
 *
 * Memoising here makes that cost once-per-TTL no matter which entry point
 * is used.
 */
const sourceProbeCache = new Map<string, { ts: number; data: CliApp[] }>();

function memoSource(name: string, fn: () => CliApp[]): CliApp[] {
  const hit = sourceProbeCache.get(name);
  if (hit && Date.now() - hit.ts < SCAN_TTL_MS) return hit.data;
  const data = fn();
  sourceProbeCache.set(name, { ts: Date.now(), data });
  return data;
}

/**
 * Wrap a raw discoverer with the per-source memo and return the public
 * function. Every exported `discoverXxx` goes through this, so callers that
 * reach a discoverer directly (doctor, buildScanReport, the web method panel)
 * get the cache too — not just the `discoverAll` path.
 */
function memoized<T extends () => CliApp[]>(name: string, fn: T): () => CliApp[] {
  return () => memoSource(name, fn);
}

/* --- Public (memoised) discoverers. Each shells out to a package manager on
       a cache miss, which costs 0.3-7s per call on Windows. --- */

export const discoverNpmGlobal = memoized("npm", discoverNpmGlobalRaw);
export const discoverPnpmGlobal = memoized("pnpm", discoverPnpmGlobalRaw);
export const discoverNpxCache = memoized("npx-cache", discoverNpxCacheRaw);
export const discoverScoop = memoized("scoop", discoverScoopRaw);
export const discoverChoco = memoized("choco", discoverChocoRaw);
export const discoverCargo = memoized("cargo", discoverCargoRaw);
export const discoverPipx = memoized("pipx", discoverPipxRaw);
export const discoverPipGlobal = memoized("pip", discoverPipGlobalRaw);
export const discoverUvTools = memoized("uv", discoverUvToolsRaw);
export const discoverFromPath = memoized("path", discoverFromPathRaw);

/** Test/dev hook: drop both caches (used by the runner to force a fresh scan). */
export function _resetScanCache(): void {
  baselineCache = null;
  allCache = null;
  sourceProbeCache.clear();
}

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
/**
 * Strip a launcher extension from a command name so it matches the name you
 * actually type. The PATH index (and `where`) resolve `claude`, not
 * `claude.exe`, so keeping extensions in `commands` produced false
 * "not found in PATH" reports in `doctor`.
 */
const LAUNCHER_EXTS = [".exe", ".cmd", ".bat", ".com", ".ps1", ".js", ".mjs", ".cjs"];

function stripLauncherExt(name: string): string {
  const lower = name.toLowerCase();
  for (const ext of LAUNCHER_EXTS) {
    if (lower.endsWith(ext)) return name.slice(0, -ext.length);
  }
  return name;
}

function detectCliFromPackageJson(pkgPath: string, pkgName: string): CliApp | null {
  const pkg = readPackageJson(pkgPath);
  if (!pkg) return null;

  const commands: string[] = [];
  /** Names explicitly declared in `package.json#bin` — always authoritative. */
  const declared = new Set<string>();

  // Check bin field. When `bin` is an object, the **keys** are the command
  // names users type — the values are repo-relative script paths, so only the
  // keys are taken.
  if (pkg.bin) {
    if (typeof pkg.bin === "string") {
      commands.push(basename(pkgName));
      declared.add(basename(pkgName).toLowerCase());
    } else if (typeof pkg.bin === "object" && pkg.bin !== null) {
      for (const key of Object.keys(pkg.bin)) {
        commands.push(key);
        declared.add(key.toLowerCase());
      }
    }
  }

  // Check direct binaries in the package's own bin/ directory.
  //
  // Two filters matter here, both learned from real breakage:
  //   - skip directories (`npm` ships `bin/node-gyp-bin/`, which is not a
  //     command);
  //   - strip launcher extensions (`npm-cli.js` -> `npm-cli`, `claude.exe` ->
  //     `claude`) so the name matches what is actually on PATH.
  const binDir = join(pkgPath, "bin");
  if (existsSync(binDir)) {
    try {
      for (const entry of readdirSync(binDir, { withFileTypes: true })) {
        if (entry.isDirectory()) continue;
        const name = entry.name;
        if (name.endsWith(".md") || name.endsWith(".txt")) continue;
        const clean = stripLauncherExt(name);
        if (clean) commands.push(clean);
      }
    } catch {
      // ignore
    }
  }

  // Normalise anything that arrived with an extension from the `bin` keys.
  const normalised = commands
    .map((c) => stripLauncherExt(c.trim()))
    .filter(Boolean)
    // Drop internal entry points: the `bin/` directory of a package often
    // contains helper modules (`npm-cli`, `npm-prefix`, `npx-cli`) that are
    // implementation details, not commands a user runs. A candidate is kept if
    // it is one of the declared `bin` keys, or if it actually resolves on PATH.
    .filter((c) => {
      if (declared.has(c.toLowerCase())) return true;
      return pathIndexHas(c);
    });

  if (normalised.length === 0) return null;

  const known = KNOWN_CLI_PACKAGES[pkgName];
  return {
    name: pkgName,
    version: typeof pkg.version === "string" ? pkg.version : "unknown",
    commands: [...new Set(normalised)],
    category: known?.category || "other",
    description: known?.desc || (typeof pkg.description === "string" ? pkg.description : ""),
    source: "npm",
    path: pkgPath,
    hasUpdate: false,
    latestVersion: null,
    managed: false,
    installKind: "managed",
  };
}

/**
 * Resolve the active npm global `node_modules` directory.
 *
 * Filesystem candidates come first because they cost ~1ms. Only when none of
 * them exist do we ask npm itself — that spawns a process (~1.5s), so it is
 * guarded by a PATH check and, in practice, runs at most once per scan-cache
 * TTL (the whole `discoverNpmGlobal` source is memoised).
 */
function resolveNpmGlobalRoot(): string {
  const conventional = npmGlobalRoot();
  if (conventional) return conventional;

  if (!pathIndexHas("npm")) return "";
  const res = execSafe("npm root -g", { shell: process.platform === "win32", timeout: 15000 });
  const out = res.output.trim();
  return res.success && out ? out : "";
}

/**
 * Discover npm globally installed CLI packages by reading filesystem
 *
 * The global root is resolved per-platform (see `npmGlobalCandidates`); the
 * old code assumed `%APPDATA%\npm\node_modules`, which silently yielded zero
 * packages on macOS and Linux.
 */
function discoverNpmGlobalRaw(): CliApp[] {
  const apps: CliApp[] = [];
  const globalDir = resolveNpmGlobalRoot();

  if (!globalDir) return apps;

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
function discoverPnpmGlobalRaw(): CliApp[] {
  const apps: CliApp[] = [];
  if (!pathIndexHas("pnpm")) return apps;

  // Fast path: pnpm keeps global packages under a `global/node_modules` tree
  // (or drops shims into `bin`). `pnpm list -g --json` costs ~2.2s — it spawns
  // `cmd.exe` -> the pnpm shim -> node — while reading the filesystem costs
  // ~1ms. On a machine where pnpm exists for project work but no global
  // packages are installed, we can prove there is nothing to list and skip the
  // subprocess entirely.
  const pnpmHome = process.env.PNPM_HOME || localAppDataDir();
  const globalRoots = [
    ...pnpmGlobalCandidates(),
    join(pnpmHome, "global"),
  ];
  const hasGlobalRoot = globalRoots.some((d) => d && existsSync(d));
  if (!hasGlobalRoot) return apps; // never installed a global package
  const result = execSafe("pnpm list -g --json 2>nul", { shell: true, timeout: 15000 });
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
 * Discover npx cached packages.
 *
 * The cache lives under a different directory per platform, so every candidate
 * is probed and all hits are scanned (a machine can legitimately have both).
 */
function discoverNpxCacheRaw(): CliApp[] {
  const apps: CliApp[] = [];
  const roots = npxCacheCandidates().filter((d) => d && existsSync(d));
  if (roots.length === 0) return apps;

  for (const npxCache of roots) {
    scanNpxCacheDir(npxCache, apps);
  }
  return apps;
}

/** Read one `_npx` directory and append discovered packages to `apps`. */
function scanNpxCacheDir(npxCache: string, apps: CliApp[]): void {
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
}

/**
 * Discover scoop installed apps
 */
function discoverScoopRaw(): CliApp[] {
  const apps: CliApp[] = [];
  const scoopDir = join(homeDir(), "scoop", "apps");
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

      const shimDir = join(homeDir(), "scoop", "shims");
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
          managed: true,
          installKind: "managed",
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
function discoverChocoRaw(): CliApp[] {
  const apps: CliApp[] = [];
  if (!pathIndexHas("choco")) return apps;

  // Fast path: Chocolatey records every installed package as a `.nupkg` in
  // its lib directory. Reading the filesystem costs ~1ms, whereas
  // `choco list --local-only` spawns PowerShell and measured ~2.7s — and on
  // a machine with no Chocolatey packages the old code paid that price for
  // nothing on every cold scan.
  const chocoLibCandidates = [
    process.env.ChocolateyInstall ? join(process.env.ChocolateyInstall, "lib") : "",
    process.env.ChocolateyToolsLocation
      ? join(process.env.ChocolateyToolsLocation, "..", "lib")
      : "",
    join(appDataDir(), "..", "..", "..", "ProgramData", "chocolatey", "lib"),
    "C:\\ProgramData\\chocolatey\\lib",
  ].filter(Boolean);

  const libDir = chocoLibCandidates.find((d) => existsSync(d));
  if (libDir) {
    let entries: string[] = [];
    try {
      entries = readdirSync(libDir);
    } catch {
      entries = [];
    }
    if (entries.length === 0) return apps;

    for (const entry of entries) {
      const versionFile = join(libDir, entry, `${entry}.nuspec`);
      let version = "";
      try {
        const nuspec = readFileSync(versionFile, "utf8");
        version = nuspec.match(/<version>([^<]+)<\/version>/)?.[1] ?? "";
      } catch {
        // fall through — report the package without a version
      }
      // Chocolatey appends `.install` / `.portable` to the package directory.
      const name = entry.replace(/\.(install|portable)$/, "");
      if (!name) continue;
      // The `chocolatey` package itself provides the `choco` command; for all
      // other packages the command matches the package name.
      const command = name.toLowerCase() === "chocolatey" ? "choco" : name.toLowerCase();
      apps.push({
        name,
        version,
        commands: [command],
        category: "other",
        description: "",
        source: "choco",
        path: join(libDir, entry),
        hasUpdate: false,
        latestVersion: null,
        managed: true,
        installKind: "managed",
      });
    }
    return apps;
  }

  // Fallback: the lib directory wasn't where we expected. Shell out, but this
  // only happens on unusual installs.
  //
  // Version note: Chocolatey **removed** `--local-only` from `list` in v2
  // (`Invalid argument --local-only`), and older v1 builds defaulted to remote
  // results without it. `--local-only` is therefore avoided entirely — the
  // bare `list` prints local packages on both lines of history.
  const result = execSafe("choco list 2>nul", { shell: true, timeout: 15000 });
  if (!result.success) return apps;

  const lines = result.output.split("\n");
  for (const line of lines) {
    // Skip the banner ("Chocolatey v2.7.4") and the trailing count line.
    if (/^Chocolatey v/i.test(line)) continue;
    if (/packages? installed/i.test(line)) continue;
    const match = line.match(/^(\S+)\s+(\S+)/);
    if (match) {
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
        managed: true,
        installKind: "managed",
      });
    }
  }

  return apps;
}

/**
 * Discover cargo installed apps
 */
function discoverCargoRaw(): CliApp[] {
  const apps: CliApp[] = [];
  if (!pathIndexHas("cargo")) return apps;

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
        managed: true,
        installKind: "managed",
      });
    }
  }

  return apps;
}

/**
 * Discover pipx installed apps
 */
function discoverPipxRaw(): CliApp[] {
  const apps: CliApp[] = [];
  if (!pathIndexHas("pipx")) return apps;

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
        managed: true,
        installKind: "managed",
      });
    }
  } catch {
    // ignore
  }

  return apps;
}

/**
 * Discover pip globally installed packages (distinct from pipx).
 * Reads the `pip list --format=json` output of the active interpreter.
 */
function discoverPipGlobalRaw(): CliApp[] {
  const apps: CliApp[] = [];
  if (!pathIndexHas("pip") && !pathIndexHas("pip3")) return apps;

  const cmd = pathIndexHas("pip") ? "pip" : "pip3";
  const result = execSafe(`${cmd} list --format=json 2>nul`, { shell: true, timeout: 15000 });
  if (!result.success || !result.output) return apps;

  try {
    const data = JSON.parse(result.output) as Array<{ name: string; version: string }>;
    for (const pkg of data) {
      // pip packages are libraries more often than CLIs; only surface ones that
      // actually expose a console_scripts entry we can see on PATH.
      const command = pkg.name.toLowerCase().replace(/_/g, "-");
      const hasCommand = pathIndexHas(command) || pathIndexHas(pkg.name.toLowerCase());
      if (!hasCommand) continue;

      apps.push({
        name: pkg.name,
        version: pkg.version || "unknown",
        commands: [command],
        category: "other",
        description: "",
        source: "pip",
        path: "",
        hasUpdate: false,
        latestVersion: null,
        managed: true,
        installKind: "managed",
      });
    }
  } catch {
    // ignore parse errors
  }

  return apps;
}

/**
 * Discover tools installed by `uv` (uv tool install / uv-managed Pythons).
 * uv places shims in the uv tool bin directory (typically ~/.local/bin).
 */
function discoverUvToolsRaw(): CliApp[] {
  const apps: CliApp[] = [];
  if (!pathIndexHas("uv")) return apps;

  // Fast path: `uv tool list` spawns a Python interpreter and measured 4-7s.
  // uv records installed tools as directories under its tool dir; if that dir
  // is absent there is nothing to list, so skip the subprocess entirely.
  const uvToolDirs = [
    process.env.UV_TOOL_DIR,
    join(homeDir(), ".local", "share", "uv", "tools"),
    join(localAppDataDir(), "uv", "tools"),
  ].filter((d): d is string => Boolean(d));
  if (!uvToolDirs.some((d) => existsSync(d))) return apps;

  const result = execSafe("uv tool list 2>nul", { shell: true, timeout: 15000 });
  if (!result.success || !result.output) return apps;

  const lines = result.output.split("\n");
  for (const line of lines) {
    // Format: "<package> v<version>" followed by indented "- <command>" lines
    const pkgMatch = line.match(/^(\S+)\s+v?(\S+)\s*$/);
    if (pkgMatch) {
      apps.push({
        name: pkgMatch[1],
        version: pkgMatch[2],
        commands: [pkgMatch[1].toLowerCase()],
        category: "other",
        description: "",
        source: "uv",
        path: "",
        hasUpdate: false,
        latestVersion: null,
        managed: true,
        installKind: "managed",
      });
    }
  }

  return apps;
}

/**
 * Discover executables by enumerating PATH directories.
 *
 * This is the broadest source: it catches portable tools, manually-dropped
 * binaries, and shims that no package manager knows about. System/Runtime
 * directories are filtered out to keep the result meaningful.
 */
function discoverFromPathRaw(): CliApp[] {
  const exes = enumPathExecutables();
  const apps: CliApp[] = [];

  for (const exe of dedupeBy(exes, (e) => `${e.command}|${e.path}`)) {
    if (isNoiseExecutable(exe)) continue;

    const known = KNOWN_COMMAND_HINTS[exe.command.toLowerCase()];
    apps.push({
      name: exe.command,
      version: "unknown",
      commands: [exe.command],
      category: known?.category || "other",
      description: known?.desc || "",
      source: "path",
      path: exe.path,
      hasUpdate: false,
      latestVersion: null,
      // Managed-ness is resolved later during cross-referencing with ARP.
      managed: false,
      installKind: "path-shim",
    });
  }

  return apps;
}

/** Directory fragments that indicate OS/runtime noise we should not report. */
const PATH_NOISE_DIRS = [
  "\\windows\\system32",
  "\\windows\\syswow64",
  "\\windows\\winsxs",
  "\\windows\\servicing",
  "\\windows\\system32\\wbem",
  "\\windows\\system32\\windowspowershell",
  "\\windows\\system32\\openssh",
  "\\windows\\system32\\driverstore",
  "\\windows\\microsoft.net",
  "\\git\\usr\\bin",
  "\\git\\mingw",
  "\\git\\cmd",
  "\\portablegit",
  "\\nodejs\\node_modules\\npm\\bin",
  "\\node_modules\\.bin",
  "\\pnpm\\",
  "\\npm-cache\\",
  "\\_npx\\",
  "\\binaries\\python\\envs",
  "/usr/bin",
  "/usr/sbin",
  "/bin",
  "/sbin",
  "/mingw64/bin",
];

/** Directory fragments that indicate a bundled runtime we should skip. */
const PATH_BUNDLED_RUNTIME_DIRS = [
  "\\jetbrains\\",
  "\\huawei\\deveco studio\\",
];

/**
 * Windows OS root directories (e.g. `C:\WINDOWS`, `C:\Windows`). Executables
 * sitting directly in these directories are OS components, not user tools.
 */
function isWindowsRootDir(dir: string): boolean {
  const norm = dir.toLowerCase().replace(/\//g, "\\").replace(/\\+$/, "");
  return /^[a-z]:\\windows(\.old)?$/.test(norm);
}

/** Command names that are pure OS utilities and add no value to the report. */
const PATH_NOISE_COMMANDS = new Set([
  "cmd", "powershell", "pwsh", "conhost", "wscript", "cscript", "bash", "wsl",
  "notepad", "regedit", "reg", "tasklist", "taskkill", "where", "whoami",
  "ipconfig", "netstat", "ping", "tracert", "pathping", "systeminfo", "shutdown",
  "sc", "schtasks", "wmic", "diskpart", "certutil", "cipher", "attrib", "xcopy",
  "robocopy", "findstr", "find", "sort", "chcp", "timeout", "curl", "tar", "setx",
  "unzip", "makecert", "fsutil", "takeown", "icacls", "runas", "openfiles",
  // PowerShell / cmd builtins & aliases
  "activate", "deactivate", "cl", "nmake", "msbuild", "vswhere",
  // Generic script helpers that are not user-facing tools.
  // RefreshEnv is Chocolatey's environment-reload shim: it shells out to
  // reg.exe/WMIC, which can block indefinitely on locked-down machines (and
  // made `doctor` hang trying to probe it).
  "install_tools", "nodevars", "refreshenv",
]);

/**
 * Command-name prefixes that belong to internal packaging machinery rather
 * than user-facing CLI tools (git plumbing, Python test/helper entry points).
 */
const PATH_NOISE_PREFIXES = [
  "git-",
  "pywin32_",
  "test_",
];

/** Command names that are internal Python package entry points, not tools. */
const PYTHON_HELPER_COMMANDS = new Set([
  "f2py", "idna", "normalizer", "numpy-config", "onnxruntime_test",
  "py.test", "pygmentize", "tqdm", "brotli", "wheel", "easy_install",
]);

/**
 * Pattern for command variants that are aliases / debug builds of a tool that
 * is already reported under its canonical name (e.g. `python_d`,
 * `pip3.13`, `pythonw3.13t`) or OS-bundled helpers.
 */
const VARIANT_COMMAND_PATTERNS: RegExp[] = [
  /^pythonw?\d*(\.\d+)?[a-z_]*$/i, // python, python3, python_d, pythonw3.13t
  /^pip\d*(\.\d+)?$/i, // pip, pip3, pip3.13
  /^pyw?$/i, // py, pyw launchers
  /^java(w|ws)?$/i, // javaw, javaws
  /^corepack$/i,
  /^(run|headless|test)-/i,
];

function isNoiseExecutable(exe: PathExecutable): boolean {
  const dir = exe.dir.toLowerCase().replace(/\//g, "\\");
  if (isWindowsRootDir(exe.dir)) return true;
  if (PATH_NOISE_DIRS.some((noise) => dir.includes(noise.toLowerCase()))) return true;
  if (PATH_BUNDLED_RUNTIME_DIRS.some((noise) => dir.includes(noise.toLowerCase()))) return true;

  const cmd = exe.command.toLowerCase();
  if (PATH_NOISE_COMMANDS.has(cmd)) return true;
  if (PYTHON_HELPER_COMMANDS.has(cmd)) return true;
  if (PATH_NOISE_PREFIXES.some((prefix) => cmd.startsWith(prefix))) return true;
  if (VARIANT_COMMAND_PATTERNS.some((re) => re.test(cmd))) return true;

  // Skip single-letter or purely numeric shims
  if (/^[a-z]$/i.test(exe.command) || /^\d+$/.test(exe.command)) return true;
  return false;
}

/**
 * Lightweight command -> category/description hints for PATH-discovered tools
 * that are not covered by KNOWN_CLI_PACKAGES (which is npm-package oriented).
 */
const KNOWN_COMMAND_HINTS: Record<string, { category: AppCategory; desc: string }> = {
  git: { category: "dev", desc: "Distributed version control system" },
  docker: { category: "deploy", desc: "Container platform CLI" },
  "docker-compose": { category: "deploy", desc: "Docker Compose" },
  "docker-machine": { category: "deploy", desc: "Docker Machine (legacy)" },
  kubectl: { category: "deploy", desc: "Kubernetes CLI" },
  node: { category: "dev", desc: "Node.js runtime" },
  npm: { category: "package-manager", desc: "Node.js package manager" },
  npx: { category: "package-manager", desc: "Node.js package runner" },
  pnpm: { category: "package-manager", desc: "Fast disk-efficient package manager" },
  yarn: { category: "package-manager", desc: "Yarn package manager" },
  python: { category: "dev", desc: "Python interpreter" },
  python3: { category: "dev", desc: "Python 3 interpreter" },
  pip: { category: "package-manager", desc: "Python package installer" },
  pip3: { category: "package-manager", desc: "Python 3 package installer" },
  uv: { category: "package-manager", desc: "Extremely fast Python package manager" },
  uvx: { category: "package-manager", desc: "uv tool runner" },
  uvw: { category: "package-manager", desc: "uv wrapper (Windows)" },
  py: { category: "dev", desc: "Python launcher" },
  java: { category: "dev", desc: "Java runtime" },
  javac: { category: "dev", desc: "Java compiler" },
  go: { category: "dev", desc: "Go toolchain" },
  cargo: { category: "dev", desc: "Rust package manager" },
  rustc: { category: "dev", desc: "Rust compiler" },
  choco: { category: "package-manager", desc: "Chocolatey package manager" },
  scoop: { category: "package-manager", desc: "Scoop package manager" },
  winget: { category: "package-manager", desc: "Windows Package Manager" },
  code: { category: "dev", desc: "Visual Studio Code CLI" },
  cursor: { category: "dev", desc: "Cursor editor CLI" },
  claude: { category: "ai", desc: "Claude Code - AI coding assistant" },
  codex: { category: "ai", desc: "OpenAI Codex CLI" },
  dsh: { category: "ai", desc: "DeepSeek Harness CLI" },
  kimi: { category: "ai", desc: "Kimi CLI" },
  fd: { category: "dev", desc: "Fast file finder" },
  rg: { category: "dev", desc: "ripgrep - fast search" },
  jq: { category: "dev", desc: "JSON processor" },
  ffmpeg: { category: "dev", desc: "Media transcoder" },
  "7z": { category: "dev", desc: "7-Zip archiver" },
  "trae-cn": { category: "dev", desc: "Trae CN editor CLI" },
  idea: { category: "dev", desc: "IntelliJ IDEA launcher" },
  pycharm: { category: "dev", desc: "PyCharm launcher" },
  devecostudio: { category: "dev", desc: "Huawei DevEco Studio launcher" },
};

/* -------------------------------------------------------------------------- */
/*  Cross-referencing: ARP baseline -> managed vs unmanaged                   */
/* -------------------------------------------------------------------------- */

/**
 * Read the Windows ARP baseline once. Returns an empty array off Windows.
 */
export function readManagedBaseline(): ManagedApp[] {
  return readBaselineCached();
}

/**
 * Decide whether a discovered app is "managed" by cross-referencing it against
 * the ARP baseline and/or its own package-manager provenance.
 */
function resolveManaged(app: CliApp, baseline: ManagedApp[]): void {
  // Package-manager apps are managed by definition.
  if (
    app.source === "npm" ||
    app.source === "pnpm" ||
    app.source === "npx-cache" ||
    app.source === "scoop" ||
    app.source === "choco" ||
    app.source === "cargo" ||
    app.source === "pipx" ||
    app.source === "pip" ||
    app.source === "uv" ||
    app.source === "winget"
  ) {
    app.managed = true;
    if (app.installKind === "unknown") app.installKind = "managed";
    return;
  }

  // Is this executable located inside a directory owned by an ARP entry?
  // This catches IDE launchers (idea64, pycharm64) whose command name does not
  // resemble the product's registered display name.
  if (app.path && pathUnderAnyInstallLocation(app.path, baseline)) {
    app.managed = true;
    app.installKind = "managed";
    return;
  }

  // Otherwise try a name-based match against the ARP display names.
  const candidates = [app.name, ...app.commands];
  for (const candidate of candidates) {
    if (baseline.some((b) => namesLikelyMatch(b.name, candidate))) {
      app.managed = true;
      app.installKind = "managed";
      return;
    }
  }

  // Not in ARP -> portable / manually placed.
  app.managed = false;
  app.installKind = app.source === "path" ? "path-shim" : "portable";
}

/**
 * Does `filePath` live inside any ARP-recorded install location?
 * Compares case-insensitively on normalised, slash-consistent prefixes.
 */
function pathUnderAnyInstallLocation(filePath: string, baseline: ManagedApp[]): boolean {
  const norm = (p: string) => p.toLowerCase().replace(/\//g, "\\").replace(/\\+$/, "");
  const target = norm(filePath);
  if (!target) return false;

  for (const entry of baseline) {
    const loc = norm(entry.installLocation);
    if (!loc || loc.length < 4) continue;
    // Require a path-boundary match so "C:\Foo" does not match "C:\Foobar".
    if (target.startsWith(loc + "\\") || target === loc) return true;
  }
  return false;
}

/**
 * Discover all installed CLI applications.
 *
 * Sources are run in order; the first hit for a `name@source` key wins, then
 * every app is classified as managed/unmanaged by cross-referencing the ARP
 * baseline (and package-manager provenance).
 */
export function discoverAll(options: { baseline?: ManagedApp[] } = {}): CliApp[] {
  // Cache hit: same baseline, fresh result, no caller-supplied baseline.
  if (
    !options.baseline &&
    allCache &&
    Date.now() - allCache.ts < SCAN_TTL_MS
  ) {
    return allCache.apps;
  }

  // Each discoverer is already memoised (see the `memoized()` wrappers), so
  // ordering here is the only thing that matters.
  const sources: Array<{ name: string; fn: () => CliApp[] }> = [
    { name: "npm", fn: discoverNpmGlobal },
    { name: "pnpm", fn: discoverPnpmGlobal },
    { name: "npx-cache", fn: discoverNpxCache },
    { name: "scoop", fn: discoverScoop },
    { name: "choco", fn: discoverChoco },
    { name: "cargo", fn: discoverCargo },
    { name: "pipx", fn: discoverPipx },
    { name: "pip", fn: discoverPipGlobal },
    { name: "uv", fn: discoverUvTools },
    { name: "path", fn: discoverFromPath },
  ];

  const allApps: CliApp[] = [];
  const seen = new Set<string>();
  /** Every command name already claimed by a higher-priority (manager) source. */
  const claimedCommands = new Set<string>();

  for (const source of sources) {
    try {
      const apps = source.fn();
      for (const app of apps) {
        const key = `${app.name}@${app.source}`;
        if (seen.has(key)) {
          // Enrich an existing entry with a path if it was missing one.
          const existing = allApps.find((a) => `${a.name}@${a.source}` === key);
          if (existing && !existing.path && app.path) existing.path = app.path;
          continue;
        }

        // A PATH-discovered shim that merely re-exposes a command already
        // claimed by a package manager is a duplicate, not a distinct tool.
        if (source.name === "path" && app.commands.some((c) => claimedCommands.has(c.toLowerCase()))) {
          continue;
        }

        seen.add(key);
        allApps.push(app);

        // Package managers own their commands; PATH entries do not claim.
        if (source.name !== "path") {
          for (const cmd of app.commands) claimedCommands.add(cmd.toLowerCase());
        }
      }
    } catch {
      // Silently skip failing sources
    }
  }

  const baseline = options.baseline ?? readManagedBaseline();
  for (const app of allApps) resolveManaged(app, baseline);

  // Cache only when the caller didn't pass an explicit baseline (otherwise
  // the cached snapshot could disagree with the caller's view).
  if (!options.baseline) {
    allCache = { ts: Date.now(), apps: allApps, baseline };
  }
  return allApps;
}

/**
 * Return only the apps that are NOT managed by a Windows installer.
 * These are portable / manually-placed tools.
 */
export function discoverUnmanaged(options: { baseline?: ManagedApp[] } = {}): CliApp[] {
  return discoverAll(options).filter((app) => !app.managed);
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

/* -------------------------------------------------------------------------- */
/*  Scan methodology report                                                   */
/* -------------------------------------------------------------------------- */

/** Static description of every technique this module uses. */
const SOURCE_METHODS: Array<{
  source: string;
  label: string;
  method: string;
  probe: () => boolean;
  note?: string;
}> = [
  {
    source: "npm",
    label: "npm global packages",
    method: "fs:%APPDATA%/npm/node_modules + package.json bin",
    probe: () => existsSync(join(appDataDir(), "npm", "node_modules")),
  },
  {
    source: "pnpm",
    label: "pnpm global packages",
    method: "exec:pnpm list -g --json",
    probe: () => pathIndexHas("pnpm"),
  },
  {
    source: "npx-cache",
    label: "npx cache",
    method: "fs:%LOCALAPPDATA%/npm-cache/_npx",
    probe: () => existsSync(join(localAppDataDir(), "npm-cache", "_npx")),
  },
  {
    source: "scoop",
    label: "Scoop packages",
    method: "fs:~/scoop/apps/*/current",
    probe: () => existsSync(join(homeDir(), "scoop", "apps")),
  },
  {
    source: "choco",
    label: "Chocolatey packages",
    method: "exec:choco list --local-only",
    probe: () => pathIndexHas("choco"),
  },
  {
    source: "cargo",
    label: "Cargo packages",
    method: "exec:cargo install --list",
    probe: () => pathIndexHas("cargo"),
  },
  {
    source: "pipx",
    label: "pipx environments",
    method: "exec:pipx list --json",
    probe: () => pathIndexHas("pipx"),
  },
  {
    source: "pip",
    label: "pip global packages",
    method: "exec:pip list --format=json",
    probe: () => pathIndexHas("pip") || pathIndexHas("pip3"),
  },
  {
    source: "uv",
    label: "uv tools",
    method: "exec:uv tool list",
    probe: () => pathIndexHas("uv"),
  },
  {
    source: "path",
    label: "PATH enumeration",
    method: "fs:PATH dirs -> executable extensions",
    probe: () => true,
  },
  {
    source: "arp",
    label: "Windows Add/Remove baseline",
    method: "registry:HKLM|HKCU Uninstall keys",
    probe: () => process.platform === "win32",
    note: "Used to classify managed vs unmanaged, not reported as apps",
  },
];

/**
 * Build a report describing exactly which techniques were used, whether each
 * source was available, and how many entries it contributed. This makes the
 * scan auditable ("how did you look?").
 */
export function buildScanReport(options: { baseline?: ManagedApp[] } = {}): ScanReport {
  const start = Date.now();
  const apps = discoverAll(options);
  const durationMs = Date.now() - start;

  const sources: ScanSourceReport[] = SOURCE_METHODS.map((meta) => {
    let available = false;
    try {
      available = meta.probe();
    } catch {
      available = false;
    }
    const found =
      meta.source === "arp"
        ? (options.baseline ?? []).length
        : apps.filter((a) => a.source === meta.source).length;

    const report: ScanSourceReport = {
      source: meta.source,
      label: meta.label,
      method: meta.method,
      found,
      available,
    };
    if (!available) report.note = meta.note || "not present on this machine";
    else if (meta.note) report.note = meta.note;
    return report;
  });

  const managedCount = apps.filter((a) => a.managed).length;
  return {
    generatedAt: new Date().toISOString(),
    platform: process.platform,
    durationMs,
    totalApps: apps.length,
    managedCount,
    unmanagedCount: apps.length - managedCount,
    sources,
  };
}
