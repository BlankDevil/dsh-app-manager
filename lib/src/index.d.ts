/**
 * DSH App Manager Plugin
 * Registers AI-callable tools and a web management page for CLI applications.
 */
import type { CliApp, CordisContext } from "./types.js";
import { type UpdateOutcome } from "./commands.js";
/**
 * Test seam for the platform branch above.
 *
 * `terminalInvocation` is pure, but the branch it takes depends on the host —
 * so the argv shapes for all three platforms are only reachable through this
 * export, and only one of them can ever run for real on a given machine.
 */
export declare function _terminalInvocationFor(platform: NodeJS.Platform, command: string, cwd: string): {
    cmd: string;
    args: string[];
};
export declare function _setActionHooks(hooks: {
    spawnTerminal?: (command: string, cwd: string) => {
        ok: boolean;
        detail: string;
    };
    runUpdate?: (app: CliApp) => Promise<UpdateOutcome>;
    collectUpdates?: () => Promise<UpdatesPayload>;
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