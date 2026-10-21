#!/usr/bin/env node
/**
 * Publish `src/client.js` as `lib/client.js`.
 *
 * The browser half is hand-written in the shell's loader format (see the header
 * of `src/client.js`), so there is nothing to compile — but it still has to end
 * up next to the compiled Node half, because `exports["./client"]` points at
 * `lib/client.js` and `dsh-client-modules` reads the file directly.
 *
 * `tsc` only emits `.ts`, and enabling `allowJs` just to copy one file would
 * drag every test helper into type checking. A two-line copy is the smaller
 * change, and it gives us a place to fail early on the mistakes that are
 * otherwise silent at runtime:
 *
 *   - the `id` in the loader call must equal the package name (the module graph
 *     keys rows by it; a mismatch means the bundle registers under a name the
 *     shell never asks for);
 *   - the file must actually contain a loader call (an ES `export` would parse
 *     as a module and never register a factory).
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SRC = path.join(ROOT, "src", "client.js");
const OUT = path.join(ROOT, "lib", "client.js");
const PKG = JSON.parse(readFileSync(path.join(ROOT, "package.json"), "utf8"));

const source = readFileSync(SRC, "utf8");

if (!source.includes("window.__ModuleLoader__.load(")) {
  throw new Error(
    `client.js: missing the "window.__ModuleLoader__.load({" wrapper — ` +
      `a plain ES module would never register a factory with the shell`
  );
}

const idMatch = source.match(/__ModuleLoader__\.load\(\{\s*\n\s*id:\s*"([^"]+)"/);
if (!idMatch) {
  throw new Error(`client.js: could not read the loader \`id\` (expected id: "<package name>")`);
}
if (idMatch[1] !== PKG.name) {
  throw new Error(
    `client.js: loader id "${idMatch[1]}" !== package name "${PKG.name}" — ` +
      `the shell keys the module graph by package name, so this bundle would never be loaded`
  );
}

if (PKG.exports?.["./client"] === undefined) {
  throw new Error(`package.json: exports["./client"] is missing — the host cannot find the browser half`);
}

mkdirSync(path.dirname(OUT), { recursive: true });
writeFileSync(OUT, source, "utf8");

const bytes = Buffer.byteLength(source, "utf8");
console.log(`client: src/client.js -> lib/client.js (${bytes} bytes, id=${idMatch[1]})`);
