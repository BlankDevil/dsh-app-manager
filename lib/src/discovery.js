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
import { existsSync, readdirSync } from "node:fs";
import { basename, join } from "node:path";
import { appDataDir, commandExists, dedupeBy, enumPathExecutables, execSafe, homeDir, localAppDataDir, namesLikelyMatch, pathIndexHas, readArpEntries, readPackageJson, } from "./utils.js";
/**
 * Known CLI tool mappings (package name -> command names)
 */
const KNOWN_CLI_PACKAGES = {
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
function detectCliFromPackageJson(pkgPath, pkgName) {
    const pkg = readPackageJson(pkgPath);
    if (!pkg)
        return null;
    const commands = [];
    // Check bin field
    if (pkg.bin) {
        if (typeof pkg.bin === "string") {
            commands.push(basename(pkgName));
        }
        else if (typeof pkg.bin === "object" && pkg.bin !== null) {
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
                if (!commands.includes(cleanBin))
                    commands.push(cleanBin);
            }
        }
        catch {
            // ignore
        }
    }
    if (commands.length === 0)
        return null;
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
        managed: false,
        installKind: "managed",
    };
}
/**
 * Discover npm globally installed CLI packages by reading filesystem
 */
export function discoverNpmGlobal() {
    const apps = [];
    const globalDir = join(appDataDir(), "npm", "node_modules");
    if (!existsSync(globalDir))
        return apps;
    try {
        const entries = readdirSync(globalDir, { withFileTypes: true });
        for (const entry of entries) {
            if (!entry.isDirectory())
                continue;
            if (entry.name.startsWith("@")) {
                const scopeDir = join(globalDir, entry.name);
                try {
                    const scopedEntries = readdirSync(scopeDir, { withFileTypes: true });
                    for (const scopedEntry of scopedEntries) {
                        if (!scopedEntry.isDirectory())
                            continue;
                        const fullName = `${entry.name}/${scopedEntry.name}`;
                        const pkgPath = join(scopeDir, scopedEntry.name);
                        const app = detectCliFromPackageJson(pkgPath, fullName);
                        if (app) {
                            app.source = "npm";
                            apps.push(app);
                        }
                    }
                }
                catch {
                    // ignore scope read errors
                }
            }
            else {
                const pkgPath = join(globalDir, entry.name);
                const app = detectCliFromPackageJson(pkgPath, entry.name);
                if (app) {
                    app.source = "npm";
                    apps.push(app);
                }
            }
        }
    }
    catch {
        // ignore read errors
    }
    return apps;
}
/**
 * Discover pnpm globally installed CLI packages
 */
export function discoverPnpmGlobal() {
    const apps = [];
    if (!commandExists("pnpm"))
        return apps;
    const result = execSafe("pnpm list -g --json 2>nul", { shell: true });
    if (!result.success)
        return apps;
    try {
        const data = JSON.parse(result.output);
        const packages = Array.isArray(data) ? data : [data];
        for (const pkg of packages) {
            const deps = pkg.dependencies;
            if (!deps)
                continue;
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
    }
    catch {
        // ignore parse errors
    }
    return apps;
}
/**
 * Discover npx cached packages
 */
export function discoverNpxCache() {
    const apps = [];
    const npxCache = join(localAppDataDir(), "npm-cache", "_npx");
    if (!existsSync(npxCache))
        return apps;
    try {
        const entries = readdirSync(npxCache, { withFileTypes: true });
        for (const entry of entries) {
            if (!entry.isDirectory())
                continue;
            const pkgPath = join(npxCache, entry.name, "node_modules");
            if (!existsSync(pkgPath))
                continue;
            try {
                const pkgs = readdirSync(pkgPath, { withFileTypes: true });
                for (const pkg of pkgs) {
                    if (!pkg.isDirectory() || pkg.name.startsWith("."))
                        continue;
                    const fullPath = join(pkgPath, pkg.name);
                    const app = detectCliFromPackageJson(fullPath, pkg.name);
                    if (app) {
                        app.source = "npx-cache";
                        apps.push(app);
                    }
                }
            }
            catch {
                // ignore
            }
        }
    }
    catch {
        // ignore
    }
    return apps;
}
/**
 * Discover scoop installed apps
 */
export function discoverScoop() {
    const apps = [];
    const scoopDir = join(homeDir(), "scoop", "apps");
    if (!existsSync(scoopDir))
        return apps;
    try {
        const entries = readdirSync(scoopDir, { withFileTypes: true });
        for (const entry of entries) {
            if (!entry.isDirectory())
                continue;
            const appDir = join(scoopDir, entry.name, "current");
            if (!existsSync(appDir))
                continue;
            const commands = [];
            const binDir = join(appDir, "bin");
            if (existsSync(binDir)) {
                try {
                    const bins = readdirSync(binDir).filter((f) => f.endsWith(".exe") || !f.includes("."));
                    for (const b of bins) {
                        const clean = b.replace(".exe", "");
                        if (!commands.includes(clean))
                            commands.push(clean);
                    }
                }
                catch {
                    // ignore
                }
            }
            const shimDir = join(homeDir(), "scoop", "shims");
            if (existsSync(shimDir)) {
                try {
                    const shims = readdirSync(shimDir).filter((f) => f.startsWith(entry.name) && (f.endsWith(".exe") || f.endsWith(".cmd") || f.endsWith(".ps1")));
                    for (const shim of shims) {
                        const clean = shim.replace(/\.(exe|cmd|ps1)$/, "");
                        if (!commands.includes(clean))
                            commands.push(clean);
                    }
                }
                catch {
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
    }
    catch {
        // ignore
    }
    return apps;
}
/**
 * Discover chocolatey installed apps
 */
export function discoverChoco() {
    const apps = [];
    if (!commandExists("choco"))
        return apps;
    const result = execSafe("choco list --local-only 2>nul", { shell: true });
    if (!result.success)
        return apps;
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
export function discoverCargo() {
    const apps = [];
    if (!commandExists("cargo"))
        return apps;
    const result = execSafe("cargo install --list 2>nul", { shell: true });
    if (!result.success)
        return apps;
    const lines = result.output.split("\n");
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line || line.startsWith(" "))
            continue;
        const match = line.match(/^(\S+)\s+v(\S+):/);
        if (match) {
            const bins = [];
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
export function discoverPipx() {
    const apps = [];
    if (!commandExists("pipx"))
        return apps;
    const result = execSafe("pipx list --json 2>nul", { shell: true });
    if (!result.success)
        return apps;
    try {
        const data = JSON.parse(result.output);
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
    }
    catch {
        // ignore
    }
    return apps;
}
/**
 * Discover pip globally installed packages (distinct from pipx).
 * Reads the `pip list --format=json` output of the active interpreter.
 */
export function discoverPipGlobal() {
    const apps = [];
    if (!commandExists("pip") && !commandExists("pip3"))
        return apps;
    const cmd = commandExists("pip") ? "pip" : "pip3";
    const result = execSafe(`${cmd} list --format=json 2>nul`, { shell: true, timeout: 15000 });
    if (!result.success || !result.output)
        return apps;
    try {
        const data = JSON.parse(result.output);
        for (const pkg of data) {
            // pip packages are libraries more often than CLIs; only surface ones that
            // actually expose a console_scripts entry we can see on PATH.
            const command = pkg.name.toLowerCase().replace(/_/g, "-");
            const hasCommand = pathIndexHas(command) || pathIndexHas(pkg.name.toLowerCase());
            if (!hasCommand)
                continue;
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
    }
    catch {
        // ignore parse errors
    }
    return apps;
}
/**
 * Discover tools installed by `uv` (uv tool install / uv-managed Pythons).
 * uv places shims in the uv tool bin directory (typically ~/.local/bin).
 */
export function discoverUvTools() {
    const apps = [];
    if (!commandExists("uv"))
        return apps;
    const result = execSafe("uv tool list 2>nul", { shell: true, timeout: 15000 });
    if (!result.success || !result.output)
        return apps;
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
export function discoverFromPath() {
    const exes = enumPathExecutables();
    const apps = [];
    for (const exe of dedupeBy(exes, (e) => `${e.command}|${e.path}`)) {
        if (isNoiseExecutable(exe))
            continue;
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
function isWindowsRootDir(dir) {
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
    // Generic script helpers that are not user-facing tools
    "install_tools", "nodevars",
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
const VARIANT_COMMAND_PATTERNS = [
    /^pythonw?\d*(\.\d+)?[a-z_]*$/i, // python, python3, python_d, pythonw3.13t
    /^pip\d*(\.\d+)?$/i, // pip, pip3, pip3.13
    /^pyw?$/i, // py, pyw launchers
    /^java(w|ws)?$/i, // javaw, javaws
    /^corepack$/i,
    /^(run|headless|test)-/i,
];
function isNoiseExecutable(exe) {
    const dir = exe.dir.toLowerCase().replace(/\//g, "\\");
    if (isWindowsRootDir(exe.dir))
        return true;
    if (PATH_NOISE_DIRS.some((noise) => dir.includes(noise.toLowerCase())))
        return true;
    if (PATH_BUNDLED_RUNTIME_DIRS.some((noise) => dir.includes(noise.toLowerCase())))
        return true;
    const cmd = exe.command.toLowerCase();
    if (PATH_NOISE_COMMANDS.has(cmd))
        return true;
    if (PYTHON_HELPER_COMMANDS.has(cmd))
        return true;
    if (PATH_NOISE_PREFIXES.some((prefix) => cmd.startsWith(prefix)))
        return true;
    if (VARIANT_COMMAND_PATTERNS.some((re) => re.test(cmd)))
        return true;
    // Skip single-letter or purely numeric shims
    if (/^[a-z]$/i.test(exe.command) || /^\d+$/.test(exe.command))
        return true;
    return false;
}
/**
 * Lightweight command -> category/description hints for PATH-discovered tools
 * that are not covered by KNOWN_CLI_PACKAGES (which is npm-package oriented).
 */
const KNOWN_COMMAND_HINTS = {
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
export function readManagedBaseline() {
    return readArpEntries();
}
/**
 * Decide whether a discovered app is "managed" by cross-referencing it against
 * the ARP baseline and/or its own package-manager provenance.
 */
function resolveManaged(app, baseline) {
    // Package-manager apps are managed by definition.
    if (app.source === "npm" ||
        app.source === "pnpm" ||
        app.source === "npx-cache" ||
        app.source === "scoop" ||
        app.source === "choco" ||
        app.source === "cargo" ||
        app.source === "pipx" ||
        app.source === "pip" ||
        app.source === "uv" ||
        app.source === "winget") {
        app.managed = true;
        if (app.installKind === "unknown")
            app.installKind = "managed";
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
function pathUnderAnyInstallLocation(filePath, baseline) {
    const norm = (p) => p.toLowerCase().replace(/\//g, "\\").replace(/\\+$/, "");
    const target = norm(filePath);
    if (!target)
        return false;
    for (const entry of baseline) {
        const loc = norm(entry.installLocation);
        if (!loc || loc.length < 4)
            continue;
        // Require a path-boundary match so "C:\Foo" does not match "C:\Foobar".
        if (target.startsWith(loc + "\\") || target === loc)
            return true;
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
export function discoverAll(options = {}) {
    const sources = [
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
    const allApps = [];
    const seen = new Set();
    /** Every command name already claimed by a higher-priority (manager) source. */
    const claimedCommands = new Set();
    for (const source of sources) {
        try {
            const apps = source.fn();
            for (const app of apps) {
                const key = `${app.name}@${app.source}`;
                if (seen.has(key)) {
                    // Enrich an existing entry with a path if it was missing one.
                    const existing = allApps.find((a) => `${a.name}@${a.source}` === key);
                    if (existing && !existing.path && app.path)
                        existing.path = app.path;
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
                    for (const cmd of app.commands)
                        claimedCommands.add(cmd.toLowerCase());
                }
            }
        }
        catch {
            // Silently skip failing sources
        }
    }
    const baseline = options.baseline ?? readManagedBaseline();
    for (const app of allApps)
        resolveManaged(app, baseline);
    return allApps;
}
/**
 * Return only the apps that are NOT managed by a Windows installer.
 * These are portable / manually-placed tools.
 */
export function discoverUnmanaged(options = {}) {
    return discoverAll(options).filter((app) => !app.managed);
}
/**
 * Find apps by name or command
 */
export function findApp(name, apps) {
    return apps.filter((app) => app.name.toLowerCase() === name.toLowerCase() ||
        app.commands.some((cmd) => cmd.toLowerCase() === name.toLowerCase()));
}
/* -------------------------------------------------------------------------- */
/*  Scan methodology report                                                   */
/* -------------------------------------------------------------------------- */
/** Static description of every technique this module uses. */
const SOURCE_METHODS = [
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
        probe: () => commandExists("pnpm"),
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
        probe: () => commandExists("choco"),
    },
    {
        source: "cargo",
        label: "Cargo packages",
        method: "exec:cargo install --list",
        probe: () => commandExists("cargo"),
    },
    {
        source: "pipx",
        label: "pipx environments",
        method: "exec:pipx list --json",
        probe: () => commandExists("pipx"),
    },
    {
        source: "pip",
        label: "pip global packages",
        method: "exec:pip list --format=json",
        probe: () => commandExists("pip") || commandExists("pip3"),
    },
    {
        source: "uv",
        label: "uv tools",
        method: "exec:uv tool list",
        probe: () => commandExists("uv"),
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
export function buildScanReport(options = {}) {
    const start = Date.now();
    const apps = discoverAll(options);
    const durationMs = Date.now() - start;
    const sources = SOURCE_METHODS.map((meta) => {
        let available = false;
        try {
            available = meta.probe();
        }
        catch {
            available = false;
        }
        const found = meta.source === "arp"
            ? (options.baseline ?? []).length
            : apps.filter((a) => a.source === meta.source).length;
        const report = {
            source: meta.source,
            label: meta.label,
            method: meta.method,
            found,
            available,
        };
        if (!available)
            report.note = meta.note || "not present on this machine";
        else if (meta.note)
            report.note = meta.note;
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
//# sourceMappingURL=discovery.js.map