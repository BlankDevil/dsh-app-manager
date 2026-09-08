/**
 * DSH App Manager Plugin
 * Registers AI-callable tools for discovering and managing CLI applications.
 */
import type { CordisContext } from "./types.js";
/**
 * Cordis plugin apply function
 */
export declare function apply(ctx: CordisContext): () => void;
/**
 * Declare service dependencies for DSH loader
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