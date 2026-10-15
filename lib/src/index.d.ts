/**
 * DSH App Manager Plugin
 * Registers AI-callable tools and a web management page for CLI applications.
 */
import type { CliApp, CordisContext } from "./types.js";
import { type UpdateOutcome } from "./commands.js";
/**
 * Which shell a click-to-launch should open on Windows.
 *
 * `powershell` is the default (requested behaviour): most of these tools are
 * used interactively, and PowerShell is the shell a Windows user expects in
 * that role. `cmd` stays available for tools/habits that need cmd semantics,
 * and the choice is a **whitelist** — the browser may pick between these
 * values and nothing else, so this can never become a free-form shell switch.
 */
type WindowsShell = "powershell" | "cmd";
/**
 * Test seam for the platform branch above.
 *
 * `terminalInvocation` is pure, but the branch it takes depends on the host —
 * so the argv shapes for all three platforms are only reachable through this
 * export, and only one of them can ever run for real on a given machine.
 */
export declare function _terminalInvocationFor(platform: NodeJS.Platform, command: string, cwd: string, shell?: WindowsShell, hasGui?: boolean): {
    cmd: string;
    args: string[];
    kind: "direct" | "terminal";
};
export declare function _setActionHooks(hooks: {
    spawnTerminal?: (command: string, cwd: string, shell?: WindowsShell, hasGui?: boolean) => {
        ok: boolean;
        detail: string;
    };
    runUpdate?: (app: CliApp) => Promise<UpdateOutcome>;
    collectUpdates?: () => Promise<UpdatesPayload>;
    resolveAppVersion?: (app: CliApp, options?: {
        refresh?: boolean;
    }) => Promise<string | null>;
    resetScanCache?: () => void;
    probeCommandHealth?: (app: CliApp, options?: {
        refresh?: boolean;
    }) => Promise<{
        broken: boolean;
        reason: string;
    }>;
    renameOrphanShim?: (file: string) => string;
    findOrphanShims?: (command: string) => string[];
}): void;
interface UpdatesPayload {
    checkedAt: string;
    /** Apps with a newer version, keyed by package name. */
    updates: Record<string, {
        current: string;
        latest: string;
        command: string;
    }>;
    /** Apps we could not check (no version API for that source, or a failed lookup). */
    skipped: number;
    /** True when the whole sweep was cut short by the deadline, so this is partial. */
    truncated?: boolean;
}
/**
 * Cordis plugin apply function
 */
export declare function apply(ctx: CordisContext): () => void;
/**
 * Declare service dependencies for DSH loader (kept as fallback)
 */
export declare const inject: string[];
/**
 * Plugin name (used by Cordis)
 */
export declare const name = "dsh-app-manager";
/**
 * Default export for dynamic imports
 */
export default apply;
//# sourceMappingURL=index.d.ts.map