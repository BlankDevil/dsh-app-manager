/**
 * Shared types for dsh-app-manager
 */
export type AppSource = "npm" | "pnpm" | "npx-cache" | "scoop" | "choco" | "cargo" | "pipx" | "pip" | "uv" | "path" | "winget" | "arp" | "other";
/**
 * How an application is installed on the machine.
 * - "managed":    registered in Windows Add/Remove Programs (ARP) or a package manager
 * - "portable":   a standalone/portable executable living in a scanned directory
 * - "path-shim":  a shim/exe found on PATH but not attributable to a package manager
 */
export type InstallKind = "managed" | "portable" | "path-shim" | "unknown";
export type AppCategory = "ai" | "package-manager" | "dev" | "deploy" | "cloud" | "database" | "framework" | "css" | "build" | "test" | "ui" | "design" | "other";
export interface CliApp {
    name: string;
    version: string;
    commands: string[];
    category: AppCategory;
    description: string;
    source: AppSource;
    path: string;
    hasUpdate: boolean;
    latestVersion: string | null;
    /**
     * Whether this app is tracked by a Windows-level installer (Add/Remove
     * Programs / package manager). Portable or manually-dropped tools are `false`.
     */
    managed: boolean;
    /** How the app is installed on disk. */
    installKind: InstallKind;
}
/**
 * A program managed by a Windows installer (read from the Uninstall
 * registry keys). Used as the baseline for detecting unmanaged programs.
 */
export interface ManagedApp {
    name: string;
    version: string;
    publisher: string;
    installLocation: string;
}
/**
 * A raw executable found by enumerating PATH directories.
 */
export interface PathExecutable {
    command: string;
    path: string;
    dir: string;
    ext: string;
}
export interface ExecResult {
    success: boolean;
    output: string;
    error: string;
    code?: number;
}
export interface KnownPackageInfo {
    commands: string[];
    category: AppCategory;
    desc: string;
}
export interface RegistryExport {
    generatedAt: string;
    platform: string;
    nodeVersion: string;
    totalApps: number;
    managedCount: number;
    unmanagedCount: number;
    apps: Array<{
        name: string;
        version: string;
        category: AppCategory;
        source: AppSource;
        commands: string[];
        description: string;
        path: string;
        managed: boolean;
        installKind: InstallKind;
    }>;
}
/**
 * Per-source diagnostics from a scan run. Answers "how was this collected?"
 */
export interface ScanSourceReport {
    /** Discovery source id, e.g. "npm", "path", "arp". */
    source: string;
    /** Human-readable label. */
    label: string;
    /** The concrete technique used, e.g. "registry:Uninstall". */
    method: string;
    /** Number of entries this source contributed before de-duplication. */
    found: number;
    /** Whether the source was available on this machine. */
    available: boolean;
    /** Optional note (e.g. why it was skipped). */
    note?: string;
}
export interface ScanReport {
    generatedAt: string;
    platform: string;
    durationMs: number;
    totalApps: number;
    managedCount: number;
    unmanagedCount: number;
    sources: ScanSourceReport[];
}
export interface ToolParameter {
    type: string;
    required?: boolean;
    description: string;
}
export interface ToolDefinition {
    name: string;
    description: string;
    parameters: Record<string, ToolParameter>;
    output?: {
        schema?: unknown;
        render?: (value: unknown) => string;
    };
    execute: (args: Record<string, unknown>, exec: {
        signal: AbortSignal;
    }) => Promise<unknown>;
}
export interface HttpRequest {
    url?: string;
    method?: string;
    headers: Record<string, string | string[] | undefined>;
}
export interface HttpResponse {
    writeHead: (statusCode: number, headers?: Record<string, string>) => void;
    end: (data?: string | Buffer) => void;
}
export interface WebServerService {
    register: (route: {
        kind: "prefix" | "exact";
        path: string;
        handler: (req: HttpRequest, res: HttpResponse) => void | Promise<void>;
    }) => (() => void);
}
export interface CordisContext {
    logger?: {
        info: (msg: string) => void;
    };
    tools?: {
        register: (tool: ToolDefinition) => (() => void);
    };
    webServer?: WebServerService;
    service?: (name: string, instance: unknown) => void;
    inject?: (services: string[], callback: (ctx: CordisContext) => void) => (() => void);
}
//# sourceMappingURL=types.d.ts.map