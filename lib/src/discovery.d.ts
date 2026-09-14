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
export declare const discoverNpmGlobal: () => CliApp[];
export declare const discoverPnpmGlobal: () => CliApp[];
export declare const discoverNpxCache: () => CliApp[];
export declare const discoverScoop: () => CliApp[];
export declare const discoverChoco: () => CliApp[];
export declare const discoverCargo: () => CliApp[];
export declare const discoverPipx: () => CliApp[];
export declare const discoverPipGlobal: () => CliApp[];
export declare const discoverUvTools: () => CliApp[];
export declare const discoverFromPath: () => CliApp[];
/** Test/dev hook: drop both caches (used by the runner to force a fresh scan). */
export declare function _resetScanCache(): void;
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