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
  | "winget"
  | "other";

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
  apps: Array<{
    name: string;
    version: string;
    category: AppCategory;
    source: AppSource;
    commands: string[];
    description: string;
    path: string;
  }>;
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
  execute: (args: Record<string, unknown>, exec: { signal: AbortSignal }) => Promise<unknown>;
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
