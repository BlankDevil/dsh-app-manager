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
import type { CliApp, ManagedApp, ScanReport } from "./types.js";
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
 * Discover pip globally installed packages (distinct from pipx).
 * Reads the `pip list --format=json` output of the active interpreter.
 */
export declare function discoverPipGlobal(): CliApp[];
/**
 * Discover tools installed by `uv` (uv tool install / uv-managed Pythons).
 * uv places shims in the uv tool bin directory (typically ~/.local/bin).
 */
export declare function discoverUvTools(): CliApp[];
/**
 * Discover executables by enumerating PATH directories.
 *
 * This is the broadest source: it catches portable tools, manually-dropped
 * binaries, and shims that no package manager knows about. System/Runtime
 * directories are filtered out to keep the result meaningful.
 */
export declare function discoverFromPath(): CliApp[];
/**
 * Read the Windows ARP baseline once. Returns an empty array off Windows.
 */
export declare function readManagedBaseline(): ManagedApp[];
/**
 * Discover all installed CLI applications.
 *
 * Sources are run in order; the first hit for a `name@source` key wins, then
 * every app is classified as managed/unmanaged by cross-referencing the ARP
 * baseline (and package-manager provenance).
 */
export declare function discoverAll(options?: {
    baseline?: ManagedApp[];
}): CliApp[];
/**
 * Return only the apps that are NOT managed by a Windows installer.
 * These are portable / manually-placed tools.
 */
export declare function discoverUnmanaged(options?: {
    baseline?: ManagedApp[];
}): CliApp[];
/**
 * Find apps by name or command
 */
export declare function findApp(name: string, apps: CliApp[]): CliApp[];
/**
 * Build a report describing exactly which techniques were used, whether each
 * source was available, and how many entries it contributed. This makes the
 * scan auditable ("how did you look?").
 */
export declare function buildScanReport(options?: {
    baseline?: ManagedApp[];
}): ScanReport;
//# sourceMappingURL=discovery.d.ts.map