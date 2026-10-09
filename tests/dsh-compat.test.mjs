#!/usr/bin/env node
/**
 * dsh 宿主兼容性守卫
 *
 * 为什么需要：插件**能不能在某个 dsh 上加载**，不取决于代码，而取决于
 * package.json 里的 peer 范围。dsh 0.2.0 的 app-boot 在加载 bundle 前会做
 *
 *   semver.satisfies(runtimeVersion, range, { includePrerelease: true })
 *
 * 校验，**不满足就抛错并跳过该 bundle**。也就是说：代码全对、声明写窄了，
 * 插件照样装不上（0.5.3 就是这样：`^0.1.5-rc.1` 不匹配 `0.2.0-rc.2`）。
 *
 * 本文件守的是**声明漂移**：
 *   1. peer 范围必须为每条「声称支持的 dsh 线」各写一条子句，且用 `||` 并列；
 *   2. 声称支持的线列表与实际写出的子句**必须一致**（加线不加声明、或声明过期都失败）；
 *   3. bundle 声明可用：`dsh.bundle.patch` 存在且指向真实文件，patch 里确实
 *      insert 了本包，版本号是合法 semver。
 *
 * ⚠️ **本文件不重实现 semver**。范围与运行时版本之间的**语义判定**由宿主自己
 * 在加载时执行（且失败是响亮的），手写一个评估器的风险是把错规则固化成"守卫"。
 * 实测参考（用 dsh 依赖树里的 semver，`includePrerelease: true`）：
 *
 *   satisfies("0.2.0-rc.2", "^0.1.5-rc.1")            = false   ← 0.5.3 被拒的原因
 *   satisfies("0.2.0-rc.2", "^0.2.0-rc.2")            = true
 *   satisfies("0.1.5-rc.3", "^0.1.5-rc.1 || ^0.2.0-rc.2") = true
 *   satisfies("0.2.0-rc.2", "^0.1.5-rc.1 || ^0.2.0-rc.2") = true
 *   satisfies("0.3.0",      "^0.1.5-rc.1 || ^0.2.0-rc.2") = false
 *
 * 运行：node tests/dsh-compat.test.mjs
 */

import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PLUGIN_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/**
 * 插件声称支持的 dsh 宿主线 —— 改动这里就必须同步改 peer 子句（反之亦然）。
 * 每条线取一个代表版本，用于人工/宿主侧核对；本文件只比对**子句文本**。
 */
const SUPPORTED_HOST_LINES = [
  { line: "dsh 0.1.5-rc.x", clause: "^0.1.5-rc.1", representative: "0.1.5-rc.3" },
  { line: "dsh 0.2.0-rc.x", clause: "^0.2.0-rc.2", representative: "0.2.0-rc.2" },
];

let failures = 0;
let checks = 0;

function check(label, actual, expected) {
  checks += 1;
  const ok = Object.is(actual, expected);
  if (!ok) failures += 1;
  console.log(
    `  ${ok ? "PASS" : "FAIL"}  ${label}: ${JSON.stringify(actual)}${ok ? "" : ` (期望 ${JSON.stringify(expected)})`}`
  );
}

function assert(label, condition, detail = "") {
  checks += 1;
  if (condition) console.log(`  PASS  ${label}`);
  else {
    failures += 1;
    console.log(`  FAIL  ${label}${detail ? " — " + detail : ""}`);
  }
}

const pkg = JSON.parse(readFileSync(path.join(PLUGIN_DIR, "package.json"), "utf8"));
const range = pkg.peerDependencies?.["@deepseek-ai/dsh-tools"] ?? "";

console.log("=== 1. peer 范围覆盖每条声称支持的宿主线 ===");
assert("peerDependencies 声明了 @deepseek-ai/dsh-tools", range !== "", "缺失该 peer");
check("声称支持的线数", SUPPORTED_HOST_LINES.length >= 1, true);

const clauses = range.split("||").map((s) => s.trim()).filter(Boolean);
for (const { line, clause } of SUPPORTED_HOST_LINES) {
  assert(`子句存在：${clause}（${line}）`, clauses.includes(clause), `实际子句：${JSON.stringify(clauses)}`);
}
check("子句数量与声称的线数一致", clauses.length, SUPPORTED_HOST_LINES.length);

if (SUPPORTED_HOST_LINES.length > 1) {
  assert(
    "多线支持必须用 || 并列（否则第二条线其实是死的）",
    range.includes("||"),
    `实际范围：${JSON.stringify(range)}`
  );
}

console.log("\n=== 2. 单线时不得留下悬空的并列/多余空白 ===");
assert("范围无前后空白", range === range.trim(), JSON.stringify(range));
assert("范围不含空子句", clauses.every((c) => c.length > 0), JSON.stringify(clauses));

console.log("\n=== 3. bundle 声明可用（dsh 按声明路径解析 patch）===");
const declared = pkg.dsh?.bundle?.patch;
assert("声明了 dsh.bundle.patch", typeof declared === "string" || Array.isArray(declared), JSON.stringify(declared));
const patchFiles = typeof declared === "string" ? [declared] : declared ?? [];
check("patch 文件数", patchFiles.length >= 1, true);
for (const rel of patchFiles) {
  const abs = path.join(PLUGIN_DIR, rel);
  assert(`patch 文件存在：${rel}`, existsSync(abs), "声明了但文件不存在 → dsh 会加载失败");
  if (!existsSync(abs)) continue;
  const text = readFileSync(abs, "utf8");
  assert(`patch 含 insert 段：${rel}`, /^\s*-\s*insert:/m.test(text), "没有 insert，插件不会被插进条目列表");
  assert(
    `patch 插入了本包：${rel}`,
    new RegExp(`name:\\s*['"]${pkg.name}['"]`).test(text),
    `patch 里找不到 name: '${pkg.name}'`
  );
}

console.log("\n=== 4. 版本与包身份 ===");
assert(
  "version 是合法 semver",
  /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(pkg.version),
  `实际 ${JSON.stringify(pkg.version)}`
);
check("包名", pkg.name, "dsh-app-manager");
check("运行时依赖保持为空（依赖自包含）", JSON.stringify(pkg.dependencies ?? {}), "{}");

console.log(`\n=== 结果：${checks - failures}/${checks} 通过${failures ? `，${failures} 项失败 ✗` : " ✓"} ===`);
if (failures > 0) {
  console.log(
    "提示：peer 子句与 SUPPORTED_HOST_LINES 必须同步。\n" +
      "      范围的语义判定由宿主在加载时执行（semver.satisfies + includePrerelease），\n" +
      "      本文件只防「声明与自称支持范围不一致」。"
  );
}
process.exit(failures === 0 ? 0 : 1);
