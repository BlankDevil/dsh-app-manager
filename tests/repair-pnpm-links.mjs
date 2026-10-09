/**
 * Repair broken pnpm links in this sandbox.
 *
 * Why this exists: pnpm lays out dependencies as **symlinks**. This sandbox
 * cannot create symlinks, so `pnpm install` silently produces *empty
 * directories* instead. Everything looks installed (`node_modules/jsdom`
 * exists) but `require("jsdom")` dies on `MODULE_NOT_FOUND: tough-cookie`.
 *
 * The fix is a Windows **junction** (directory symlink), which *can* be
 * created here. This script walks a package's dependency tree and replaces
 * every empty directory with a junction to the real copy under
 * `node_modules/.pnpm/<name>@<version>/node_modules/<name>`.
 *
 * Usage: node tests/repair-pnpm-links.mjs [pkgName ...]
 *        (defaults to the devDependencies that tests actually need: jsdom)
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const NODE_MODULES = path.join(ROOT, "node_modules");
const STORE = path.join(NODE_MODULES, ".pnpm");

let created = 0;
let skipped = 0;
const missing = [];

/**
 * name -> [{version, realPath}]
 *
 * Built by **reading each copy's package.json**, not by parsing the folder
 * name. pnpm truncates long folder names and appends a hash —
 * `@csstools+css-parser-algorithms` becomes
 * `@csstools+css-parser-algori_b9ad755e…` — so the folder name cannot be
 * trusted to contain either the full name or the version. The manifest can.
 */
const index = new Map();

function indexPackage(dir) {
  const nm = path.join(STORE, dir, "node_modules");
  if (!fs.existsSync(nm)) return;
  for (const entry of fs.readdirSync(nm)) {
    const names = entry.startsWith("@")
      ? fs.readdirSync(path.join(nm, entry)).map((sub) => `${entry}/${sub}`)
      : [entry];
    for (const rel of names) {
      const realPath = path.join(nm, rel);
      try {
        // Skip links: only real copies belong in the index.
        if (fs.lstatSync(realPath).isSymbolicLink()) continue;
      } catch {
        continue;
      }
      const manifest = path.join(realPath, "package.json");
      if (!fs.existsSync(manifest)) continue;
      let pkg;
      try {
        pkg = JSON.parse(fs.readFileSync(manifest, "utf8"));
      } catch {
        continue;
      }
      if (!pkg.name) continue;
      if (!index.has(pkg.name)) index.set(pkg.name, []);
      const list = index.get(pkg.name);
      if (!list.some((c) => c.realPath === realPath)) {
        list.push({ version: pkg.version ?? "0.0.0", realPath });
      }
    }
  }
}

for (const dir of fs.existsSync(STORE) ? fs.readdirSync(STORE) : []) {
  indexPackage(dir);
}

/**
 * Pick the right installed copy for `name`.
 *
 * The store can hold several versions of one package (jsdom 26 *and* 27 are
 * both present here). Linking the wrong one is worse than linking none: jsdom
 * 26 has no `PointerEvent`, so the drag suite would fail with a confusing
 * error instead of the "install jsdom" message. So honour the declared major.
 */
function pick(name, range) {
  const candidates = index.get(name);
  if (!candidates || candidates.length === 0) return null;
  const byNewest = [...candidates].sort((a, b) => (a.version < b.version ? 1 : -1));
  const major = /(\d+)\./.exec(String(range ?? ""))?.[1];
  if (major) {
    const sameMajor = byNewest.find((c) => c.version.startsWith(`${major}.`));
    if (sameMajor) return sameMajor.realPath;
  }
  return byNewest[0].realPath;
}

/** True when `p` is missing, or is an empty directory (the broken-link shape). */
function isBroken(p) {
  if (!fs.existsSync(p)) return true;
  try {
    const st = fs.lstatSync(p);
    if (st.isDirectory()) return fs.readdirSync(p).length === 0;
    return false; // real file or working junction: leave it alone
  } catch {
    return true;
  }
}

const VERBOSE = Boolean(process.env.REPAIR_VERBOSE);

function link(parentNodeModules, name, range) {
  const target = pick(name, range);
  if (!target) {
    if (VERBOSE) console.log(`  [miss] ${name} @ ${parentNodeModules}`);
    missing.push(name);
    return null;
  }
  const linkPath = path.join(parentNodeModules, name);
  if (VERBOSE) {
    console.log(`  [link] ${name} → ${path.relative(ROOT, target)}  @ ${path.relative(ROOT, linkPath)} broken=${isBroken(linkPath)}`);
  }
  if (isBroken(linkPath)) {
    if (fs.existsSync(linkPath)) fs.rmdirSync(linkPath);
    fs.mkdirSync(path.dirname(linkPath), { recursive: true });
    try {
      fs.symlinkSync(target, linkPath, "junction");
      created += 1;
    } catch (e) {
      console.error(`  ! junction failed ${name}: ${e.code ?? e.message}`);
      return null;
    }
  } else {
    skipped += 1;
  }
  return target;
}

const visited = new Set();

/** Recursively repair `realPath`'s dependency links. */
function repair(realPath, depth = 0) {
  if (depth > 12 || visited.has(realPath)) return;
  visited.add(realPath);

  let pkg;
  try {
    pkg = JSON.parse(fs.readFileSync(path.join(realPath, "package.json"), "utf8"));
  } catch {
    return;
  }
  const deps = { ...(pkg.dependencies || {}), ...(pkg.optionalDependencies || {}) };
  // A package's siblings live in the `node_modules` that *contains* it. For a
  // scoped package that is **two** levels up (`@scope/name` → `node_modules`),
  // not one — getting this wrong links `@csstools/css-calc` into
  // `node_modules/@asamuzakjp/`, which then resolves to nothing.
  const nm = pkg.name?.startsWith("@")
    ? path.dirname(path.dirname(realPath))
    : path.dirname(realPath);

  for (const [depName, range] of Object.entries(deps)) {
    const childReal = link(nm, depName, range);
    if (childReal) repair(childReal, depth + 1);
  }
}

const targets = process.argv.slice(2);
const list = targets.length > 0 ? targets : ["jsdom"];

console.log(`store packages indexed: ${index.size}  (.pnpm entries: ${fs.readdirSync(STORE).length})`);
for (const name of list) {
  const rootRange = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"))
    ?.devDependencies?.[name];
  const real = link(NODE_MODULES, name, rootRange);
  if (!real) {
    console.error(`  ! cannot locate ${name} in the pnpm store`);
    continue;
  }
  console.log(`  · ${name} → ${path.relative(ROOT, real)}`);
  repair(real);
}

console.log(`\njunctions created: ${created} · already fine: ${skipped}`);
if (missing.length > 0) {
  console.log(`not present in store (${missing.length}): ${[...new Set(missing)].join(", ")}`);
}

// Verify by actually requiring the top-level targets.
for (const name of list) {
  try {
    const mod = (await import(name));
    console.log(`  ✔ require("${name}") ok — ${Object.keys(mod).slice(0, 4).join(", ")}`);
  } catch (e) {
    console.error(`  ✘ require("${name}") still fails: ${e.code ?? ""} ${String(e.message).split("\n")[0]}`);
  }
}
