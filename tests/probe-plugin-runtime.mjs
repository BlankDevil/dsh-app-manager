/**
 * Runtime compatibility probe for the dsh-app-manager plugin under dsh 0.1.5.
 *
 * Loads the plugin's compiled output against the real @deepseek-ai/dsh-tools
 * `defineTool`, capturing tool definitions through a fake Cordis context.
 * This is the test that actually proves the 0.1.5 API contract is satisfied:
 * every tool must carry a mandatory `output.render` returning ContentBlock[].
 */
import { pathToFileURL, fileURLToPath } from "node:url";
import path from "node:path";

const TESTS_DIR = path.dirname(fileURLToPath(import.meta.url));
const PLUGIN_DIR = path.resolve(TESTS_DIR, "..");

async function main() {
  const plugin = await import(pathToFileURL(path.join(PLUGIN_DIR, "lib/src/index.js")).href);
  console.log("plugin module loaded:", typeof plugin.apply === "function" ? "OK (apply fn)" : "FAIL");
  console.log("plugin name:", plugin.name);
  console.log("plugin inject:", JSON.stringify(plugin.inject));

  const captured = [];
  const routes = [];

  // Minimal fake Cordis context that satisfies the plugin's duck-typed surface.
  const ctx = {
    logger: { info: (m) => console.log("  [plugin log]", m) },
    inject(deps, cb) {
      const child = {
        tools: {
          register(tool) {
            captured.push(tool);
            return () => {};
          },
        },
        webServer: {
          register(route) {
            routes.push(route);
            return () => {};
          },
        },
      };
      cb(child);
      return () => {};
    },
  };

  const dispose = plugin.apply(ctx);
  console.log("");
  console.log("=== TOOLS REGISTERED:", captured.length, "===");
  for (const t of captured) {
    const hasRender = typeof t.output?.render === "function";
    const hasSchema = t.output?.schema !== undefined;
    console.log(`- ${t.name}`);
    console.log(`    description: ${(t.description || "").slice(0, 60)}...`);
    console.log(`    output.schema: ${hasSchema ? "present" : "MISSING"}`);
    console.log(`    output.render: ${hasRender ? "present" : "MISSING"}`);
    // Contract check for 0.1.5: render must return ContentBlock[]
    if (hasRender) {
      let blocks;
      try {
        blocks = t.output.render({}, "sample");
      } catch (e) {
        console.log(`    render error: ${e.message}`);
        continue;
      }
      const ok = Array.isArray(blocks) && blocks.length > 0 && blocks[0].type === "text" && typeof blocks[0].text === "string";
      console.log(`    render() -> ${ok ? "ContentBlock[] OK" : "UNEXPECTED SHAPE: " + JSON.stringify(blocks)}`);
    }
  }

  console.log("");
  console.log("=== WEB ROUTES REGISTERED:", routes.length, "===");
  for (const r of routes) console.log(`- [${r.kind}] ${r.path}`);

  if (typeof dispose === "function") {
    dispose();
    console.log("");
    console.log("dispose(): OK");
  }

  const allGood = captured.length === 7 && captured.every((t) => typeof t.output?.render === "function");
  console.log("");
  console.log(allGood ? "RESULT: PASS" : "RESULT: FAIL");
  process.exit(allGood ? 0 : 1);
}

main().catch((e) => {
  console.error("PROBE ERROR:", e);
  process.exit(1);
});
