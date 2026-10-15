/**
 * Close every app a test run opened.
 *
 * The suite stubs every launching action (terminal spawn, package install,
 * version probe, health probe), so on a healthy machine this closes nothing —
 * and that is exactly what has to be *proven*, not assumed. A cleanup that
 * silently does nothing is indistinguishable from a cleanup that does not
 * exist, so `discoverLeaks()` is the real guard: it diffs a process snapshot
 * taken before the run against one taken after, and reports any process that
 * belongs to an app the run touched.
 *
 * Two ways an app gets closed:
 *   - `registerOpened()` — a test action really launched something (none do
 *     today) and the PID is tracked explicitly;
 *   - a leak found in the snapshot diff, which is closed too, because the user
 *     asked for "close everything the tests opened" rather than "report it".
 */
import { spawn } from "node:child_process";

/** Windows mangles `/FO` into a path under Git Bash unless this is set. */
const ENV = { ...process.env, MSYS_NO_PATHCONV: "1" };

/** PIDs a test action really launched. */
const opened = [];

/** Record a process a test launched, so the run can close it. */
export function registerOpened(pid, label = "app") {
  if (Number.isInteger(pid) && pid > 0) opened.push({ pid, label });
}

export const openedCount = () => opened.length;

/**
 * Run a process-reading command.
 *
 * **Not `spawnSync`**: on this machine `spawnSync` returns EBUSY for *every*
 * target, including `cmd.exe /c echo`. That is what forced the CLI runner to
 * move to async `spawn`, and the same trap applies here — a `spawnSync` version
 * of this helper silently returns nothing and every leak check passes
 * vacuously.
 *
 * Settlement is on `exit`, not `close`: a grandchild can hold the stdio pipes
 * open and `close` would never arrive.
 */
function run(cmd, args, timeoutMs = 15_000) {
  return new Promise((resolve) => {
    let settled = false;
    const done = (res) => {
      if (settled) return;
      settled = true;
      resolve(res);
    };
    let out = "";
    let err = "";
    let child;
    try {
      child = spawn(cmd, args, { env: ENV, windowsHide: true });
    } catch (error) {
      return done({ ok: false, stdout: "", stderr: String(error) });
    }
    child.stdout?.on("data", (d) => {
      out += d;
    });
    child.stderr?.on("data", (d) => {
      err += d;
    });
    child.on("error", (error) => done({ ok: false, stdout: out, stderr: String(error) }));
    child.on("exit", () => done({ ok: true, stdout: out, stderr: err }));
    setTimeout(() => {
      try {
        child.kill();
      } catch {
        /* already gone */
      }
      done({ ok: false, stdout: out, stderr: err || "timed out" });
    }, timeoutMs);
  });
}

/**
 * Process snapshot: `Map<pid, imageName>`.
 *
 * Returns an **empty** map (not null) when `tasklist` is unavailable, so a
 * missing tool degrades to "no leaks found" — the caller asserts on the count,
 * and an empty map would make that assertion pass vacuously. `available()`
 * exists so the caller can fail loudly instead.
 */
export async function snapshot() {
  const out = new Map();
  const r = await run("tasklist", ["/FO", "CSV", "/NH"]);
  if (!r.ok || !r.stdout) return out;
  for (const line of String(r.stdout).split(/\r?\n/)) {
    const m = line.match(/^"([^"]+)","(\d+)"/);
    if (m) out.set(Number(m[2]), m[1]);
  }
  return out;
}

/** False when the process tool is missing — callers must not pass vacuously. */
export async function available() {
  const r = await run("tasklist", ["/FO", "CSV", "/NH"]);
  return Boolean(r.ok && r.stdout && r.stdout.includes('"'));
}

/**
 * Processes present in `after` but not `before` whose image matches one of
 * `commandNames` — i.e. an app the run touched and that is still running.
 */
export function discoverLeaks(before, after, commandNames) {
  const wanted = new Set(
    (commandNames || [])
      .filter(Boolean)
      .map((c) => String(c).replace(/\.exe$/i, "").toLowerCase())
  );
  const leaked = [];
  for (const [pid, image] of after) {
    if (before.has(pid)) continue;
    const base = String(image).replace(/\.exe$/i, "").toLowerCase();
    if (wanted.has(base)) leaked.push({ pid, image });
  }
  return leaked;
}

/** Terminate a PID: ask nicely, then insist. Returns true if it is gone. */
export async function killPid(pid) {
  await run("taskkill", ["/PID", String(pid), "/T"]);
  const after = await snapshot();
  if (!after.has(Number(pid))) return true;
  await run("taskkill", ["/PID", String(pid), "/T", "/F"]);
  const recheck = await snapshot();
  return !recheck.has(Number(pid));
}

/**
 * Close everything the run opened: registered PIDs first, then any leak that
 * the snapshot diff attributed to this run.
 *
 * @returns {{registered: Array, leaked: Array}}
 */
export async function closeAll(leaked = []) {
  const registered = [];
  for (const o of opened.splice(0, opened.length)) {
    registered.push({ ...o, closed: await killPid(o.pid) });
  }
  const closedLeaks = [];
  for (const l of leaked) {
    closedLeaks.push({ ...l, closed: await killPid(l.pid) });
  }
  return { registered, leaked: closedLeaks };
}
