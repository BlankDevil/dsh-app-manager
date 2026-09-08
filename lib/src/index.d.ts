/**
 * DSH App Manager Plugin
 * Registers AI-callable tools and a web management page for CLI applications.
 */
import type { CordisContext } from "./types.js";
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