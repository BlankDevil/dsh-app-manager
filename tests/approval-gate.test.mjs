#!/usr/bin/env node
/**
 * dsh-app-manager — 变更类工具的审批门槛测试
 *
 * 为什么需要：`app_manager_update` 会执行 `npm install -g <pkg>@latest`，这是对
 * 用户机器的**不可逆改动**。对外发布后，第三方插件无声改动全局环境是不可接受的。
 *
 * 光断言「代码里有 requireApproval 这个函数」是不够的 —— 那正是本项目
 * （Q6/Q7 拖拽）栽过的坑：静态标记齐全，功能实际是死的。本测试**真实调用**
 * update 工具的 execute，断言：
 *   - 没有审批服务时**拒绝执行**（fail closed），且**没有 spawn**
 *   - 审批返回非 allowed-once 时拒绝，且**没有 spawn**
 *   - 审批返回 allowed-once 时放行（spawn 为桩，绝不真装）
 *   - 只读工具在缺少审批服务时仍然全部注册
 *
 * ⚠️ 安全设计（重要，别改坏）：
 * `node:child_process` 的 ESM 命名空间在**首次被 import 时**就固定了绑定值。
 * 如果先 import 插件（其 utils.js 静态 import 了 child_process），再 patch
 * `spawn`，那么插件里 `await import("node:child_process")` 拿到的仍是**真实 spawn**
 * —— 桩会失效，测试会**真的执行 npm install -g**。
 * 因此本文件：
 *   1) 不静态 import `node:child_process`（否则会提前固定绑定）；
 *   2) 用 createRequire 拿 CJS 对象，**在任何 ESM import 之前**打好 spawn 桩；
 *   3) 打桩后立刻用动态 import 验证桩确实生效，**不生效就中止整个套件**。
 *
 * 运行：node tests/approval-gate.test.mjs
 */

import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import { EventEmitter } from "node:events";
import path from "node:path";

const TESTS_DIR = path.dirname(fileURLToPath(import.meta.url));
const PLUGIN_DIR = path.resolve(TESTS_DIR, "..");
const NODE = process.execPath;
const PLUGIN_ENTRY = path.join(PLUGIN_DIR, "lib/src/index.js");

/* -------------------------------------------------------------------------- */
/*  1. 先打 spawn 桩（必须在任何 child_process 的 ESM import 之前）           */
/* -------------------------------------------------------------------------- */

const require_ = createRequire(import.meta.url);
const cp = require_("node:child_process");
/** spawnSync is captured before patching so the self-check can still spawn. */
const spawnSync = cp.spawnSync;

/** Every stubbed spawn call, as `[command, args, options]`. */
const SPAWNS = [];

function fakeChild() {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  // Resolve like a successful install, on the next tick.
  setImmediate(() => child.emit("close", 0));
  return child;
}

cp.spawn = (...args) => {
  SPAWNS.push(args);
  return fakeChild();
};

/* -------------------------------------------------------------------------- */
/*  2. 自检：桩对 ESM 导入者同样可见，否则中止（绝不真装）                     */
/* -------------------------------------------------------------------------- */

const cpViaEsm = await import("node:child_process");
if (cpViaEsm.spawn !== cp.spawn) {
  console.error(
    "ABORT: the child_process.spawn stub is not visible to ESM importers.\n" +
      "A real `npm install -g` could execute — refusing to run this suite."
  );
  process.exit(3);
}

/* -------------------------------------------------------------------------- */
/*  3. 子进程模式：验证 APP_MANAGER_ALLOW_UNATTENDED_UPDATE 逃生口             */
/* -------------------------------------------------------------------------- */

if (process.argv[2] === "--child-unattended") {
  const plugin = await import(pathToFileURL(PLUGIN_ENTRY).href);
  const tools = makeToolsService();
  loadTools(plugin, { tools }); // deliberately NO approval service
  const tool = tools.registered.find((t) => t.name === "app_manager_update");
  const out = String(
    await tool.execute(
      { name: "dsh" },
      { signal: new AbortController().signal, callId: "child_call_1", agent: { fake: "agent" } }
    )
  );
  process.stdout.write(`${out}\n[spawns=${SPAWNS.length}]`);
  process.exit(0);
}

/* -------------------------------------------------------------------------- */
/*  4. 测试装置                                                               */
/* -------------------------------------------------------------------------- */

const results = [];
async function check(label, fn) {
  try {
    const detail = await fn();
    results.push({ label, ok: true });
    console.log(`PASS  ${label}${detail ? "  --  " + detail : ""}`);
  } catch (e) {
    results.push({ label, ok: false, err: e.message });
    console.log(`FAIL  ${label}`);
    console.log(`      ↳ ${e.message}`);
  }
}
function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function makeToolsService() {
  const registered = [];
  return {
    registered,
    register: (t) => {
      registered.push(t);
      return () => {};
    },
  };
}

/**
 * Load the plugin with a fake Cordis context. `inject` only fires its callback
 * when every requested service is present in `host`, mirroring Cordis.
 */
function loadTools(plugin, host) {
  plugin.apply({
    logger: { info: () => {} },
    inject(deps, cb) {
      if (deps.every((d) => host[d] !== undefined)) {
        const ctx = {};
        for (const d of deps) ctx[d] = host[d];
        cb(ctx);
      }
      return () => {};
    },
  });
  return host.tools;
}

const SIG = new AbortController().signal;
function execCtx() {
  return { signal: SIG, callId: "call_test_1", agent: { fake: "agent" } };
}

/** Load the plugin now that the stub is proven effective. */
const plugin = await import(pathToFileURL(PLUGIN_ENTRY).href);
const discovery = await import(
  pathToFileURL(path.join(PLUGIN_DIR, "lib/src/discovery.js")).href
);

// Warm the scan cache so tool.execute() does not pay the cold-scan cost.
const apps = discovery.discoverAll();
const target = apps.find((a) => a.source === "npm" || a.source === "pnpm");
assert(target, "no npm/pnpm app discovered to test with — cannot run this suite");

/** Run the update tool with a given host shape and report the outcome. */
async function runUpdate(hostExtras) {
  SPAWNS.length = 0;
  const tools = makeToolsService();
  loadTools(plugin, { tools, ...hostExtras });
  const tool = tools.registered.find((t) => t.name === "app_manager_update");
  assert(tool, "app_manager_update not registered");
  const out = String(await tool.execute({ name: target.name }, execCtx()));
  return { out, spawns: SPAWNS.slice(), tools };
}

/* -------------------------------------------------------------------------- */

console.log("");
console.log("━━━ 只读工具不受影响 ━━━");

await check("缺少审批服务时，7 个工具仍全部注册", () => {
  const tools = makeToolsService();
  loadTools(plugin, { tools });
  assert(
    tools.registered.length === 7,
    `expected 7 tools, got ${tools.registered.length} — approval must not gate registration`
  );
  return `${tools.registered.length} tools`;
});

await check("提供审批服务时，工具数不变（仍 7 个）", () => {
  const tools = makeToolsService();
  loadTools(plugin, { tools, approval: { request: async () => "allowed-once" } });
  assert(tools.registered.length === 7, `expected 7, got ${tools.registered.length}`);
  return `${tools.registered.length} tools`;
});

console.log("");
console.log("━━━ 无审批服务 → fail closed ━━━");

await check("没有审批服务时拒绝执行 update，且不 spawn", async () => {
  const { out, spawns } = await runUpdate({});
  assert(/Refused to update/i.test(out), `expected a refusal, got: ${out.slice(0, 160)}`);
  assert(spawns.length === 0, `spawn ran ${spawns.length}x despite the refusal`);
  return "refused, 0 spawn calls";
});

await check("拒绝信息给出可操作的两条出路", async () => {
  const { out } = await runUpdate({});
  assert(out.includes("app-manager update"), "should offer running the CLI directly");
  assert(
    out.includes("APP_MANAGER_ALLOW_UNATTENDED_UPDATE=1"),
    "should name the unattended escape hatch"
  );
  return "both paths documented";
});

console.log("");
console.log("━━━ 审批被拒 / 取消 / 不可用 / 抛错 → 不执行 ━━━");

for (const outcome of ["rejected", "cancelled", "unavailable", "maybe"]) {
  await check(`审批返回 "${outcome}" 时不执行、不 spawn`, async () => {
    const { out, spawns } = await runUpdate({ approval: { request: async () => outcome } });
    assert(
      /not approved|Did not update/i.test(out),
      `expected a not-approved message, got: ${out.slice(0, 160)}`
    );
    assert(spawns.length === 0, `spawn ran despite outcome "${outcome}"`);
    return `outcome=${outcome}, 0 spawns`;
  });
}

await check("审批服务抛错时也拒绝（不是放行）", async () => {
  const { out, spawns } = await runUpdate({
    approval: {
      request: async () => {
        throw new Error("no open turn");
      },
    },
  });
  assert(/Refused to update/i.test(out), `throwing answerer must refuse: ${out.slice(0, 160)}`);
  assert(spawns.length === 0, "spawn ran despite the approval error");
  return "refused, 0 spawns";
});

console.log("");
console.log("━━━ 审批通过 → 放行（spawn 为桩） ━━━");

await check("allowed-once 时执行更新，且审批请求带齐身份信息", async () => {
  const seen = [];
  const { out, spawns } = await runUpdate({
    approval: {
      request: async (req) => {
        seen.push(req);
        return "allowed-once";
      },
    },
  });

  assert(spawns.length === 1, `expected exactly 1 spawn, got ${spawns.length}`);
  const [cmd, argv] = spawns[0];
  assert(Array.isArray(argv) && argv.includes("-g"), `should install globally: ${JSON.stringify(argv)}`);
  assert(/Updated/.test(out), `expected a success message, got: ${out.slice(0, 160)}`);

  const req = seen[0];
  assert(req, "approval.request was not called");
  assert(req.toolName === "app_manager_update", `wrong toolName: ${req.toolName}`);
  assert(req.callId === "call_test_1", `callId not forwarded: ${req.callId}`);
  assert(req.agent && req.agent.fake === "agent", "agent not forwarded");
  assert(typeof req.reason === "string" && req.reason.length > 0, "reason missing");
  return `1 spawn (${cmd} ${argv.join(" ")}), request payload complete`;
});

console.log("");
console.log("━━━ 逃生口：APP_MANAGER_ALLOW_UNATTENDED_UPDATE=1 ━━━");

await check("子进程实测：置位后无需审批直接放行", () => {
  const r = spawnSync(NODE, [fileURLToPath(import.meta.url), "--child-unattended"], {
    encoding: "utf8",
    timeout: 120000,
    env: { ...process.env, APP_MANAGER_ALLOW_UNATTENDED_UPDATE: "1" },
  });
  assert(r.status === 0, `child exited ${r.status}: ${String(r.stderr).slice(0, 300)}`);
  assert(/Updated/.test(r.stdout), `expected the update to proceed: ${r.stdout.slice(0, 200)}`);
  assert(/\[spawns=1\]/.test(r.stdout), `child should have stubbed exactly 1 spawn: ${r.stdout.slice(-80)}`);
  return "proceeded without prompting";
});

console.log("");
console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
const pass = results.filter((r) => r.ok).length;
const fail = results.length - pass;
console.log(`结果: PASS ${pass} · FAIL ${fail} / 共 ${results.length}`);
process.exit(fail === 0 ? 0 : 1);
