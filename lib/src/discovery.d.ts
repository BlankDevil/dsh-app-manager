/**
 * Discovery module - finds installed CLI tools across package managers
 */
import type { CliApp } from "./types.js";
/**
 * Discover npm globally installed CLI packages by reading filesystem
 */
export declare function discoverNpmGlobal(): CliApp[];
/**
 * Discover pnpm globally installed CLI packages
 */
export declare function discoverPnpmGlobal(): CliApp[];
/**
 * Discover npx cached packages
 */
export declare function discoverNpxCache(): CliApp[];
/**
 * Discover scoop installed apps
 */
export declare function discoverScoop(): CliApp[];
/**
 * Discover chocolatey installed apps
 */
export declare function discoverChoco(): CliApp[];
/**
 * Discover cargo installed apps
 */
export declare function discoverCargo(): CliApp[];
/**
 * Discover pipx installed apps
 */
export declare function discoverPipx(): CliApp[];
/**
 * Discover all installed CLI applications
 */
export declare function discoverAll(): CliApp[];
/**
 * Find apps by name or command
 */
export declare function findApp(name: string, apps: CliApp[]): CliApp[];
//# sourceMappingURL=discovery.d.ts.map