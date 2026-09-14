/**
 * Shared types for dsh-app-manager
 */

export type AppSource =
  | "npm"
  | "pnpm"
  | "npx-cache"
  | "scoop"
  | "choco"
  | "cargo"
  | "pipx"
  | "pip"
  | "uv"
  | "path"
  | "winget"
  | "arp"
  | "other";

/**
 * How an application is installed on the machine.
 * - "managed":    registered in Windows Add/Remove Programs (ARP) or a package manager
 * - "portable":   a standalone/portable executable living in a scanned directory
 * - "path-shim":  a shim/exe found on PATH but not attributable to a package manager
 */
export type InstallKind = "managed" | "portable" | "path-shim" | "unknown";

export type AppCategory =
  | "ai"
  | "package-manager"
  | "dev"
  | "deploy"
  | "cloud"
  | "database"
  | "framework"
  | "css"
  | "build"
  | "test"
  | "ui"
  | "design"
  | "other";

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

/** Text content block, matching `@deepseek-ai/dsh-llm`'s TextBlock. */
export interface TextContentBlock {
  type: "text";
  text: string;
}

/** Any DSH content block; the plugin only ever emits text blocks. */
export type ContentBlock = TextContentBlock;

/**
 * Tool definition compatible with `@deepseek-ai/dsh-tools` >= 0.1.5.
 *
 * In 0.1.5 the `output` field became mandatory and uses a structured shape:
 * `schema` declares the canonical value and `render` must project that value
 * into `ContentBlock[]` (previously an optional `(value) => string`).
 */
/**
 * Execution identity the host hands to a tool's `execute`.
 *
 * Mirrors the relevant subset of DSH's `ToolExecution`: `callId` and `agent`
 * are what the approval seam needs to attach a permission prompt to the tool
 * call it already streamed. Both are optional because a host may dispatch a
 * tool outside an agent loop (tests, nested dispatchers).
 */
export interface ToolRunContext {
  signal: AbortSignal;
  callId?: unknown;
  agent?: unknown;
}

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, ToolParameter>;
  output: {
    schema: unknown;
    render: (args: Record<string, unknown>, value: unknown) => ContentBlock[];
  };
  execute: (args: Record<string, unknown>, exec: ToolRunContext) => Promise<unknown>;
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

/**
 * Vocabularly of an approval decision. `allowed-once` is the only grant;
 * everything else — including a missing answerer, which fails closed as
 * `unavailable` — means the action must not proceed.
 */
export type ApprovalOutcome =
  | "allowed-once"
  | "rejected"
  | "cancelled"
  | "unavailable"
  | (string & {});

/**
 * The host's approval seam (`@deepseek-ai/dsh-user-approval`).
 *
 * Deliberately optional on {@link CordisContext}: not every deployment composes
 * an answerer (headless/CI runs resolve to `never`), so callers must handle its
 * absence instead of assuming a prompt will appear.
 */
export interface ApprovalService {
  request(req: {
    agent: unknown;
    toolName: string;
    callId?: unknown;
    reason?: string;
    signal?: AbortSignal;
  }): Promise<ApprovalOutcome>;
}

export interface CordisContext {
  logger?: {
    info: (msg: string) => void;
  };
  tools?: {
    register: (tool: ToolDefinition) => (() => void);
  };
  webServer?: WebServerService;
  approval?: ApprovalService;
  service?: (name: string, instance: unknown) => void;
  inject?: (services: string[], callback: (ctx: CordisContext) => void) => (() => void);
}
