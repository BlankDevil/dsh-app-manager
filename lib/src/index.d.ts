/**
 * DSH App Manager Plugin
 * Registers AI-callable tools and a web management page for CLI applications.
 */
import type { CliApp, CordisContext } from "./types.js";
import { type UpdateOutcome } from "./commands.js";
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