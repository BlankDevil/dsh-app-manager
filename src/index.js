/**
 * DSH App Manager Plugin Entry Point
 * Provides integration with DeepSeek Harness
 */

import { discoverAll } from "./discovery.js";
import {
  listApps,
  checkUpdates,
  showInfo,
  updateApp,
  updateAll,
  runDoctor,
  monitorProcesses,
  exportRegistry,
  searchApps,
} from "./commands.js";

/**
 * Plugin configuration
 */
const defaultConfig = {
  enabled: true,
  autoDiscover: true,
  sources: ["npm", "pnpm", "npx-cache", "scoop", "choco", "cargo", "pipx"],
};

/**
 * Initialize the plugin
 */
export function init(config = {}) {
  const mergedConfig = { ...defaultConfig, ...config };

  if (!mergedConfig.enabled) {
    return null;
  }

  return {
    config: mergedConfig,
    registry: null,

    /**
     * Discover all installed applications
     */
    async discover() {
      this.registry = discoverAll();
      return this.registry;
    },

    /**
     * Get the current registry
     */
    getRegistry() {
      if (!this.registry) {
        this.registry = discoverAll();
      }
      return this.registry;
    },

    /**
     * Handle DSH command invocations
     */
    async handleCommand(command, ...args) {
      switch (command) {
        case "list":
          return await listApps(...args);
        case "check":
          return await checkUpdates(...args);
        case "info":
          return await showInfo(...args);
        case "update":
          return await updateApp(...args);
        case "update-all":
          return await updateAll(...args);
        case "doctor":
          return await runDoctor(...args);
        case "monitor":
          return await monitorProcesses(...args);
        case "search":
          return await searchApps(...args);
        case "export":
          return await exportRegistry(...args);
        default:
          throw new Error(`Unknown app-manager command: ${command}`);
      }
    },
  };
}

/**
 * Default export for DSH bundle loading
 */
export default init;
