/**
 * Random app sampling for the test suite.
 *
 * The suite used to reach for `apps.find(...)` — the *same* one or two apps on
 * every single run, forever. That hides a whole class of bug: if the first app
 * happens to have a clean name, a plain command and a tidy path, every
 * assertion passes while the other ~60 discovered apps rot untested. A bug that
 * only shows up on an app with a space in its name, or a command that differs
 * from its package name, would never be caught.
 *
 * Each run now exercises a random sample instead. The picked names are printed
 * so a failing run can be reproduced by reading the log.
 */

/**
 * Apps that must never become a test subject.
 *
 * `ExecAction` is Fiddler's helper (`...\Fiddler\ExecAction.exe`). Picking it
 * means a test **runs** it, and running it starts Fiddler — which flips the
 * Windows system-proxy switch to `127.0.0.1:8888` as a side effect. A test that
 * quietly reconfigures the machine's network is not a test.
 *
 * Matching is deliberately broad (name, install path, commands): Fiddler ships
 * several executables and the app record can surface under any of them.
 */
const EXCLUDED = [
  /fiddler/i, // 产品名与安装目录
  /telerik/i, // Fiddler 的发行方（Progress Telerik）
  /execaction/i, // Fiddler 的命令行助手，跑它就会启动 Fiddler
  /sfxwiz/i, // Fiddler 安装/卸载包的自解压壳（SFXWiz32 / SFXWiz32-gcc）
  /trustcert/i, // Fiddler 首次运行的证书信任助手
  /enableloopback/i, // Fiddler 的 AppContainer 回环豁免工具
  /forcecpu/i, // Fiddler 自带工具
];

/** True when an app record belongs to an excluded product. */
export function isExcluded(app) {
  const hay = [app?.name, app?.path, ...(app?.commands || [])].filter(Boolean).join(" ");
  return EXCLUDED.some((re) => re.test(hay));
}

/** Drop excluded products from a candidate pool, logging what was dropped. */
function usable(pool, label) {
  const kept = [];
  const dropped = [];
  for (const app of pool || []) (isExcluded(app) ? dropped : kept).push(app);
  if (dropped.length > 0) {
    console.log(
      `  · 已排除 ${dropped.length} 个禁用应用（${label}）：${dropped.map((a) => a.name).join(", ")}`
    );
  }
  return kept;
}

/**
 * Pick a random sample of `pool`.
 *
 * Unbiased partial Fisher–Yates on a **copy** (the caller's array is left
 * alone). Clamped: a pool smaller than `min` is used in full rather than
 * silently dropping apps, and an empty pool stays empty (the caller decides
 * whether that is a failure).
 *
 * `stratify` spreads the sample across `source` values instead of drawing it
 * uniformly. Uniform drawing is fine on a machine where the sources are evenly
 * populated, but this one has ~35 `path` apps and ~10 `npm` ones — a uniform
 * sample of 5 is mostly `path` most of the time, so the npm / choco / npx
 * branches of the app record go untested run after run. Round-robin across
 * sources means every run touches several of them.
 *
 * @param {Array<{name: string, source?: string}>} pool candidates
 * @param {{min?: number, max?: number, label?: string, stratify?: boolean}} [opts]
 */
export function sampleApps(pool, { min = 4, max = 6, label = "app", stratify = false } = {}) {
  const list = usable(pool, label);
  if (list.length === 0) return [];

  const want = min + Math.floor(Math.random() * (max - min + 1));
  const n = Math.min(list.length, Math.max(min, Math.min(max, want)));

  const shuffled = list.slice();
  for (let i = 0; i < shuffled.length; i += 1) {
    const j = i + Math.floor(Math.random() * (shuffled.length - i));
    const t = shuffled[i];
    shuffled[i] = shuffled[j];
    shuffled[j] = t;
  }

  let picked;
  if (stratify) {
    const bySource = new Map();
    for (const app of shuffled) {
      const key = app.source ?? "?";
      if (!bySource.has(key)) bySource.set(key, []);
      bySource.get(key).push(app);
    }
    const buckets = [...bySource.values()];
    picked = [];
    let progressed = true;
    while (picked.length < n && progressed) {
      progressed = false;
      for (const bucket of buckets) {
        if (picked.length >= n) break;
        if (bucket.length > 0) {
          picked.push(bucket.shift());
          progressed = true;
        }
      }
    }
  } else {
    picked = shuffled.slice(0, n);
  }

  const sources = [...new Set(picked.map((a) => a.source ?? "?"))].join("+");
  console.log(
    `  · 随机抽样 ${label} ${picked.length}/${list.length}（来源 ${sources}）：${picked.map((a) => a.name).join(", ")}`
  );
  return picked;
}

/** Pick exactly one random candidate (null on an empty pool). */
export function pickOne(pool, label = "app") {
  return sampleApps(pool, { min: 1, max: 1, label })[0] ?? null;
}

/**
 * Human-readable one-liner for an app: `name（source · command）`.
 *
 * Needed because the report must state *which* apps this run exercised. Once
 * sampling is random, "the suite passed" is meaningless without the subject
 * list — a failure on `wezterm` is not reproducible from a run that picked
 * `ripgrep`.
 */
export function describeApp(app) {
  if (!app) return "—";
  const cmd = app.commands?.[0] ?? "—";
  return `${app.name}（${app.source ?? "?"} · ${cmd}）`;
}

/** The blacklist, for the report: readers need to know what is never touched. */
export function excludedPatterns() {
  return EXCLUDED.map((re) => String(re));
}
