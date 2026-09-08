#!/usr/bin/env node
/**
 * CLI Application Manager
 * A unified tool for discovering, monitoring, and managing CLI applications
 */

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
  showHelp,
} from "../src/commands.js";

interface ParsedArgs {
  command: string;
  subCommand: string | undefined;
  options: {
    output?: string;
    json?: boolean;
    category?: string;
  };
}

/**
 * Parse command line arguments
 */
function parseArgs(argv: string[]): ParsedArgs {
  const args = argv.slice(2);
  const command = args[0] || "help";
  const subCommand = args[1];
  const options: ParsedArgs["options"] = {};

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--output" || args[i] === "-o") {
      options.output = args[i + 1];
      i++;
    }
    if (args[i] === "--json") {
      options.json = true;
    }
    if (args[i] === "--category" || args[i] === "-c") {
      options.category = args[i + 1];
      i++;
    }
  }

  return { command, subCommand, options };
}

/**
 * Main entry point
 */
async function main(): Promise<void> {
  const { command, subCommand, options } = parseArgs(process.argv);

  try {
    switch (command) {
      case "list":
      case "ls":
        await listApps(options);
        break;

      case "check":
      case "outdated":
        await checkUpdates(options);
        break;

      case "info":
      case "show":
        if (!subCommand) {
          console.error("❌ Error: App name required. Usage: app-manager info <app>");
          process.exit(1);
        }
        await showInfo(subCommand, options);
        break;

      case "update":
      case "upgrade":
        if (!subCommand) {
          console.error("❌ Error: App name required. Usage: app-manager update <app>");
          process.exit(1);
        }
        await updateApp(subCommand, options);
        break;

      case "update-all":
      case "upgrade-all":
        await updateAll(options);
        break;

      case "doctor":
      case "health":
        await runDoctor(options);
        break;

      case "monitor":
      case "status":
        await monitorProcesses(options);
        break;

      case "search":
      case "find":
        if (!subCommand) {
          console.error("❌ Error: Search query required. Usage: app-manager search <query>");
          process.exit(1);
        }
        await searchApps(subCommand, options);
        break;

      case "export":
        await exportRegistry(options);
        break;

      case "help":
      case "--help":
      case "-h":
      default:
        if (command !== "help" && command !== "--help" && command !== "-h") {
          console.error(`❌ Unknown command: ${command}\n`);
        }
        showHelp();
        break;
    }
  } catch (error: unknown) {
    const err = error as Error;
    console.error("❌ Error:", err.message);
    if (process.env.DEBUG) {
      console.error(err.stack);
    }
    process.exit(1);
  }
}

main();
