# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.5.3] - 2026-09-15

First release with **page actions**: the table is no longer read-only. You can
launch a tool by clicking its name, see which apps have a newer version waiting,
and upgrade one from the page — after confirming the exact command.

### Added

- **Normalised teardown — an unloaded plugin stops serving.** Previously the
  disposer handed the registrations back and stopped there. Three gaps
  remained, all closed here:

  1. the window between "marked unloaded" and "registrations removed", during
     which a handler still answered;
  2. a host that still holds a handler reference (not the return-value path) —
     the page answered anyway;
  3. the browser cache resurrecting an uninstalled page.

  `apply()` now creates a `PluginLifecycle`, and `dispose()` sets
  `disposed` as its **first act** — fail closed, *then* unwind. All four routes
  check it at entry and answer **404 + `no-store`**; the 200 responses carry
  `no-store` too. The seven tools go through the same guard, so a stale tool
  reference fails loudly instead of quietly working for a plugin that is gone.
  Teardown is idempotent (the host may call the returned function *and* emit
  `dispose`), unwinds in LIFO order, drops the scan caches, and logs one unload
  line so "was it actually unloaded?" is answerable.

- **Click NAME to open a terminal running that app's own command.** One
  mechanism covers both cases the request asked for: a CLI opens its interactive
  prompt (`@anthropic-ai/claude-code` → `claude`), and a service starts in place
  (`9router`). Their only difference is *which* command runs — and that command
  comes from discovery, so no "service" taxonomy had to be invented.

  `POST /app-manager/api/open?name=<pkg>` → a terminal on the host (Windows via
  the shell's `start` builtin plus `/k`, so a failure stays readable instead of
  flashing away — and with the empty title argument that `start` would otherwise
  consume; macOS via Terminal; Linux via `x-terminal-emulator`).

- **Update detection, and a per-app upgrade from the table.**
  `GET /app-manager/api/updates` asks the registry which apps have a newer
  version (npm/pnpm only — those are the sources with a cheap "what is the
  latest" answer), with a 4-wide worker pool, a 45-second overall deadline that
  reports `truncated: true` when it cuts the sweep short, and a 5-minute cache
  so reloading the page is not a second sweep. The page renders first and
  decorates `VERSION` with an `⬆ <latest>` badge when the answer lands.

  `POST /app-manager/api/update?name=<pkg>` upgrades one app. Both endpoints are
  POST-only, because a GET is something a link, a prefetch or an `<img>` can
  trigger and neither action may start that way.

- **`On PATH` is now the column header** (was `Status`). The cell has always
  rendered `✅/❌ PATH` — whether the command resolves in `PATH` — so `Status`
  promised more than the column delivered. `Path` was already taken (that column
  is the install location). The header now says what the column is.

- **`npm run test:actions`** — 44 checks over the three new endpoints, the
  platform-specific terminal argv, and the teardown guarantees. It calls the
  real registered handlers (asserting behaviour, not the presence of a
  function), and the three machine-touching actions are routed through
  `_setActionHooks` to stubs, with a **sentinel check that aborts the suite if a
  stub did not take effect** — otherwise the test would open real windows and
  install real packages.

### Fixed

- **Two concurrent upgrades of the same app could run together.** Two clicks (or
  a double submit) meant two `install -g` writing the same global package —
  the classic way to end up with a half-written install. The second request now
  gets **409 `already_running`**; the lock releases in `finally` and is cleared
  on unload.

- **The new page strings were Chinese in an otherwise English UI.** Now English
  throughout (toasts, confirm dialog, badge tooltip, button labels). No i18n
  framework: the page is monoglot English from title to filter, so adding one
  for four strings would cost more than it explains.

### Changed

- **Upgrade commands have a single source of truth.** `updateCommandFor(app)` in
  `commands.ts` maps each source to its command (`npm install -g <pkg>@latest`,
  `pnpm add -g …`, `choco upgrade … -y`, `scoop update …`), and `runUpdate()`
  reports a structured outcome. Both `app-manager update` and the page's upgrade
  button use them, so the command the page promises cannot drift from the one
  the CLI runs.

### Notes

- **Terminal windows are detached and are deliberately *not* torn down on
  unload.** The window belongs to the user — they may sit inside `claude` for an
  hour — so closing it on plugin unload would be the destructive behaviour, not
  the tidy one. This is the one documented exception to "the plugin cleans up
  its own child processes" in `DESIGN.md` §6.
- The action endpoints accept only `?name=`; the command is re-derived
  server-side from the discovery result and re-checked against
  `/^[A-Za-z0-9._-]+$/`, so spaces, quotes, `&&` and redirection are all
  rejected — `?name=` never becomes an arbitrary-command endpoint.
- Update checks remain npm/pnpm only: `cargo`, `pip`, `pipx`, `uv`, `scoop` and
  PATH-found executables have no equivalent cheap version API and are reported as
  skipped rather than guessed at.

## [0.5.2] - 2026-09-14

First public release to npm. Metadata and docs only — no runtime behaviour
changes, so an upgrade from 0.5.1 carries no risk.

### Added
- **The plugin description now states where the dashboard actually lives.**
  `package.json` `description` ends with
  `... DSH plugin: 7 AI-callable tools plus a web dashboard at
  http://127.0.0.1:3080/app-manager.` A freshly installed plugin previously
  gave no hint that a UI existed at all — the only way to find the page was to
  read the source.

  The port is **3080**, taken from the host's own declaration in
  `@deepseek-ai/dsh-web-app/cordis.patch.yml`:
  ```yaml
  port: !!js ctx.webStartup.port ?? 3080
  ```
  Worth flagging because the host's `--port 8080` help text is an *example of
  how to change the port*, not the default — it is easy to copy the wrong one.

- **README**: the features table and the install section both name the default
  address, and install now ends with an explicit "open
  http://127.0.0.1:3080/app-manager" line.

### Changed
- **`author` is now `BlankDevil <blank.devil.yang@gmail.com>`** instead of the
  placeholder. npm shows this on the package page.

- **`keywords` gained `dashboard`, `web-ui`, `tool-manager`** so the package is
  findable by what it provides rather than only by `dsh`.

### Fixed
- **The "install from source" snippet could not be run.** It ended with
  `dsh plugin --profile web add ./dsh-app-manager` *after* `cd dsh-app-manager`,
  but dsh's `anchorPathSpec()` anchors a relative path to the **invoking cwd**,
  so that resolves to `<repo>/dsh-app-manager` — which does not exist. Now
  `add .`.

## [0.5.1] - 2026-09-14

Release-readiness pass on the packaging and tooling around the plugin. No
runtime behaviour changes — the published artifact only differs in one metadata
field.

### Fixed
- **`peerDependencies` was tighter than the host's own declaration.** The plugin
  asked for `@deepseek-ai/dsh-tools: ^0.1.5-rc.2` while `dsh` itself declares
  `^0.1.5-rc.1`, so any 0.1.5 build resolving dsh-tools to `rc.1` would produce a
  spurious peer warning. Now `^0.1.5-rc.1`, matching the host. The floor is
  correct on the merits too: the plugin's contract (`output.render` required,
  returning `ContentBlock[]`) arrived in the 0.1.5 line.

- **The lockfile contradicted `package.json`.** `pnpm-lock.yaml` still pinned
  `specifier: ^0.1.2-rc.1` / `version: 0.1.2-rc.1`, so a fresh `pnpm install`
  vendored dsh-tools 0.1.2-rc.1 — a version the declared range does not even
  allow. Regenerated; `pnpm install --frozen-lockfile` now passes.
  (Diagnosis note: reading the *vendored* copy is not the same as reading the
  runtime. The `dsh` CLI here is 0.1.5-rc.1 and bundles dsh-tools **0.1.5-rc.2**,
  which the declared range *did* satisfy — the real defect was the stale lock,
  not the range.)

- **The drag test resolved jsdom from a developer's absolute path.** An earlier
  revision hardcoded `C:/Users/<name>/.workbuddy/.../jsdom`, which both leaked a
  local directory layout into a public repo and made CI **silently skip all 13
  checks** (the skip exits 0, so green CI with zero drag coverage). Resolution
  is now normal `node_modules` first, then an optional `DSH_TEST_JSDOM_DIR`
  override, with no hardcoded path anywhere.

### Added
- **CI** (`.github/workflows/ci.yml`):
  - *build* on ubuntu — install, compile, assert the artifacts exist, then run
    `help` / `list` / `method` to prove the CLI loads and the platform-aware
    discovery path runs off Windows;
  - *test* on windows — the full suite plus every standalone script, and a guard
    that the committed `lib/` matches `src/`. The guard uses `git diff -w`, not
    `--ignore-cr-at-eol`: a plain diff reports CRLF-only noise as a change, and
    the latter flag does not exist in older git (2.9 errors on it and *still
    exits 0*, which is a silent false pass — verified the hard way).
  - CI runs Node 22: `jsdom >= 27` requires Node >= 20.
- **`jsdom` is now a devDependency.** It was previously only present in an
  isolated workspace outside the repo, so nothing guaranteed the behavioural
  drag tests could run. Pinned to `^27.0.0` — **jsdom 26 and earlier have no
  `PointerEvent` constructor** (added in 27), and the drag handling under test is
  driven entirely by pointer events. The test now detects a too-old jsdom and
  fails with that reason instead of a confusing constructor error.
- `test:paths` / `test:approval` npm scripts (they existed as files but were not
  wired up).

### Changed
- **README**: the architecture section listed files that are *not* published
  (`src/`, `PRD.md`, `DESIGN.md`, `PUBLISH.md`, `bin/*.ts`), which is misleading
  on the npm page. It now separates "repository layout" from "what the npm
  package contains", and states that the package has no runtime dependencies.
- **`PUBLISH.md`** rewritten. The old copy still described version 0.2.0 and a
  three-entry `files` list. It now records only verified facts: the package name
  is free on npm, the packed tarball is 29 files / 88K with no stray content,
  the packed artifact runs and registers 7 tools + 4 routes, and the
  `--force-with-lease` / sandbox pitfalls hit during this work.
- **LICENSE** copyright year 2025 → 2026.

### Notes
- `dsh.client` is deliberately **not** declared. It is a client-runtime
  integration (client packages plus a bundled UI module), not a metadata field;
  declaring it without shipping the matching client artifact would make DSH fail
  to load the plugin — worse than having no in-UI entry point. Deferred and
  documented rather than guessed at.

## [0.5.0] - 2026-09-14

Release-readiness pass: fixes the cross-platform discovery bug and puts a
consent gate in front of the one tool that mutates the user's machine.

### Fixed
- **`app-manager doctor` could hang forever.** `execAsync()` forwarded its
  `timeout` option to `child_process.spawn`, which **ignores** it — only
  `exec`/`execFile` honour `timeout`. So when 0.4.6 moved the `--version` probes
  onto `execAsync` for real concurrency, it also silently dropped their timeout.
  On this machine `doctor` then never returned: `RefreshEnv` (a Chocolatey
  `.cmd` on PATH) shells out to `reg.exe`/`WMIC.exe`, which are blocked by the
  security policy, so the probe blocked indefinitely and the whole health check
  hit the harness's 300s ceiling.

  `execAsync` now enforces its `timeout` with an explicit timer, and tears the
  process down with `taskkill /T /F` on Windows so the real command dies too
  (with `shell: true` the child handle is `cmd.exe`, so a plain `kill()` would
  orphan the actual process). Measured: `doctor` **300s timeout → 20.6s**.
  Version probes also moved from a 5s to an 8s budget, since cold-starting a
  bundled CLI can take ~3s and the probes run 12-wide.

- **`RefreshEnv` was treated as an installable tool.** It is Chocolatey's
  environment-reload helper — same category as the already-excluded
  `install_tools` / `nodevars` — and it is also what triggered the hang above.
  Added to the noise list.

- **npm and npx global discovery silently returned nothing on macOS/Linux.**
  `discoverNpmGlobal()` hardcoded `appDataDir()/npm/node_modules`, and off
  Windows `appDataDir()` falls back to `$HOME/AppData/Roaming` — a path that
  does not exist. `discoverNpxCache()` had the same shape of bug via
  `localAppDataDir()`. The failure mode was the worst kind: no error, no crash,
  just a quietly short list — and npm globals are exactly where `dsh`, `claude`
  and `codex` live, so the headline feature was dead for every non-Windows user.

  Global roots are now resolved per platform and per Node install by
  `npmGlobalCandidates()` (`src/utils.ts`), which derives the active prefix from
  `process.execPath` and special-cases the ones that need it:
  nvm (`~/.nvm/versions/node/vX/lib/node_modules`), system (`/usr/lib`),
  Homebrew (`/opt/homebrew`, cutting at `/Cellar/` rather than the binary's
  parent), plus `~/.npm-global`, `~/.local` and the `/usr/local` fallbacks.
  Only the first existing root is used, so the result matches what
  `npm root -g` reports rather than unioning every Node version installed.
  `npm root -g` itself is the last-resort fallback, guarded by a PATH check.
  pnpm got the same treatment (`~/.local/share/pnpm`, `~/Library/pnpm`, XDG).
  npx cache resolves to `~/.npm/_npx` off Windows and honours `npm_config_cache`.

### Added
- **Approval gate on `app_manager_update`.** The tool runs
  `npm install -g <pkg>@latest`, which rewrites a global package on the user's
  machine. It now asks the host through the `approval` service
  (`@deepseek-ai/dsh-user-approval`) and proceeds **only** on `allowed-once`.

  Fail-closed by design: when no approval service is composed (headless, CI,
  older hosts) the call is **refused**, not silently permitted — "no answerer"
  must not read as "yes". Refusals name both ways forward: run
  `app-manager update <pkg>` directly, or set
  `APP_MANAGER_ALLOW_UNATTENDED_UPDATE=1` for unattended runs.

  The `approval` service is injected **separately** from `tools`, so a
  deployment without an answerer still gets all 7 tools — the gate governs
  execution, never registration.

  Note the safety property that made this easy to add: `findApp()` is an exact
  (case-insensitive) match on name or command, and the spawn arguments use the
  *discovered* `app.name` rather than the raw tool input, so there is no
  argument-injection surface.

### Added
- **`tests/crossplatform-paths.test.mjs`** (15 checks). Asserts the derived
  global roots for Windows, system Linux, `/usr/local`, nvm and Homebrew by
  injecting `platform`/`execPath`, so the logic is verified on any machine. It
  explicitly asserts `AppData` never leaks into a POSIX candidate list — the
  exact defect this release fixes.
- **`tests/approval-gate.test.mjs`** (11 checks). Drives the real
  `app_manager_update` tool and asserts the gate blocks on
  `rejected`/`cancelled`/`unavailable`/unknown outcomes and on a throwing
  answerer, always with **zero spawn calls**; that `allowed-once` proceeds, with
  the prompt carrying `toolName`/`callId`/`agent`/`reason`; and that the env
  escape hatch works in a real child process.

  Safety note for future maintainers: `node:child_process`'s ESM namespace fixes
  its bindings at first import, so patching `spawn` *after* importing the plugin
  leaves the real one in place and the test silently performs a genuine global
  install. The suite therefore patches `spawn` via `createRequire` **before any
  ESM import**, then verifies through a dynamic import that the stub is visible
  and aborts if it is not.

## [0.4.6] - 2026-09-11

### Fixed
- **`/app-manager` still took ~10s to open even with a warm `discoverAll` cache.**
  The 0.4.5 fix addressed `commandExists()` (a *general* slowness), but the page
  handler was measurably still 9.6s while `discoverAll()` returned in **0ms** —
  proving a second, independent bottleneck. Tracing every
  `execSync`/`spawn` during one render found four package-manager probes that
  re-ran on **every request**, because `buildScanReport()` and `doctor` call the
  individual discoverers directly and therefore bypassed `allCache`:

  | probe | cost |
  |-------|------|
  | `pip list --format=json` | 3.4s |
  | `choco list --local-only` | 2.7s |
  | `pnpm list -g --json` | 2.2s |
  | `uv tool list` | 0.8s |

  Fixes:
  - The per-source memo now lives **inside each discoverer** (`memoized()`
    wrappers around `discoverXxxRaw`), so any call path — `discoverAll`,
    `buildScanReport`, `doctor`, the web method panel — hits the TTL cache.
  - **Filesystem fast paths** for `choco`, `pnpm`, and `uv`: when the package
    manager's data directory is absent we can prove there are no packages and
    skip the subprocess entirely. `choco` 2741ms → **2ms**, `uv` 4191ms → **1ms**,
    `pnpm` 2401ms → **310ms**.
  - `choco` now reads `<ChocolateyInstall>/lib/*/*.nuspec` (version included)
    instead of parsing CLI output. This also **fixes a latent bug**: the old
    fallback ran `choco list --local-only`, but Chocolatey v2 **removed** that
    flag (`Invalid argument --local-only`), so on any modern Chocolatey the
    probe silently returned zero packages.

  Result: warm page render **9626ms → 9ms**; cold `discoverAll` **11.8s → 4.5s**.

- **`doctor` reported ~34 false "not found in PATH" issues.** `commands` was
  being populated with launcher filenames and internal entry points instead of
  the names you actually invoke:
  - `@anthropic-ai/claude-code` declared bin keys `claude` **and** `claude.exe`
  - `@openai/codex` declared `codex` and `codex.js`
  - `npm`'s own `bin/` directory contains `node-gyp-bin/` (a *directory*) plus
    `npm-cli.js`, `npm-prefix.js`, `npx-cli.js`

  None of those resolve on PATH — the PATH index stores extensionless names —
  so every one produced a spurious issue. Fixed in `detectCliFromPackageJson`:
  skip directories when scanning `bin/`, strip launcher extensions
  (`.exe .cmd .bat .com .ps1 .js .mjs .cjs`), and keep a `bin/`-directory
  candidate only if it was explicitly declared in `package.json#bin` or
  actually resolves on PATH. Total command count **113 → 56**, all invocable;
  real "not found" issues **34 → 7** (all genuine npx-cache entries).

- **`choco` reported the command `chocolatey`.** The Chocolatey install dir is
  named `chocolatey` but the command it provides is `choco`; other packages map
  name → command directly.

- **Fake "concurrency" in `doctor` and `checkUpdates`.** Both used
  `runWithConcurrency(..., 8|5, ...)` to overlap subprocess work, but the work
  called the blocking `execSync`-based `execSafe`, which stalls the event loop —
  so the lanes ran strictly serially. `doctor` measured **98.6s**. Version
  probes and `npm view` lookups now go through the spawn-based `execAsync`
  (with a `probeVersion()` memo, TTL 5min), so the pools genuinely overlap and
  the limits were raised to 8/6/12.
  Affected: `src/commands.ts` (`checkUpdates`, `showInfo`, `runDoctor`,
  `monitorProcesses`), `src/index.ts` (`checkLatestVersion`).

### Added
- **`tests/perf-guard.test.mjs`** (10 checks) — a dedicated perf guard, because
  performance regressions have **no functional symptom**: the page renders
  perfectly, just slowly. Covers the bulk-`pathIndexHas` budget, cold/warm scan
  budgets, warm page-render budget, per-source cache hits, `buildScanReport` on
  a warm cache, plus three **command-name hygiene** assertions that lock in the
  `doctor` fix above. Verified to have real regression power: forcing
  `SCAN_TTL_MS=0` yields 3 PASS / 4 FAIL with the render assertion measuring
  7547ms against a 300ms budget, and reverting the command normalisation fails
  the internal-entry-point check.
- **`lastSpawnError` diagnostics** (`utils.ts`). The ARP registry read returns
  `[]` when the PowerShell spawn is blocked (e.g. by a Windows Application
  Control / security-agent program blacklist), which silently degrades every app
  to "unmanaged". The reason is now captured and logged once instead of
  swallowed.
- `npm run test:perf` script.

### Notes
- 0.4.5's "cold scan ~5.9s" and "page renders instantly once warm" claims were
  incomplete: the page still cost ~9.6s warm. Both numbers are corrected above.

## [0.4.5] - 2026-09-11

### Fixed
- **`/app-manager` took ~40s on a cold cache.** The page and `/api/apps`
  computed `inPath` with `commandExists()`, which spawns `where`/`which` per
  command — 66 spawns ≈ **35s**, and it ran *inside the row-render loop*.
  Everything now uses the already-cached `pathIndexHas()` (a PATH index build
  + Map lookup): 66 checks went **35,297ms → 0ms**. Cold scan is now ~5.9s
  (was ~10.7s after that), and the page renders instantly once warm.
  Affected: `src/index.ts` (row status, `inPath` stat, `/api/apps`, doctor
  tool), `src/commands.ts` (`info` status line, `doctor` checks),
  `src/discovery.ts` (every source guard and scan-report probe, 13 sites).
  `commandExists()` is kept for genuine one-off checks.

### Added
- **Background scan warm-up.** The plugin primes the discovery cache on load
  (deferred to the next macrotask, `unref`ed, failures non-fatal) so the first
  visit to `/app-manager` does not pay the ~5.9s scan cost.
- **Command subtitle in the Name column.** Scoped npm packages now show the
  callable command beneath the package name — `@anthropic-ai/claude-code`
  displays `claude`, `@openai/codex` displays `codex`. Rows whose command and
  package name already match stay single-line, so only 4 of 52 rows gain a
  subtitle. Rows also carry `data-cmd` for filtering.

### Notes
- A worker-thread parallel scanner was prototyped and **reverted**: `execSync`
  blocks its thread, and `Atomics.wait` on the main thread deadlocks because
  worker `message` events cannot be delivered. The real win was removing the
  per-command subprocess spawns, not parallelising the sources.

## [0.4.4] - 2026-09-11

### Fixed
- **Category drag-to-reorder (Q6) did not work at all.** The first
  implementation used native HTML5 drag & drop and called
  `preventDefault()` on the grip's `pointerdown` (intended to stop the
  `<summary>` from collapsing). That call also cancels the browser's own
  drag initiation, so `dragstart` never fired and nothing was draggable.
  Rewritten with **Pointer Events**, which gives full control and behaves
  identically across engines.
- **Drag an app row between categories (Q7) did not work.** Native DnD on a
  `<tr>` is unreliable (text selection fights the drag, drag image poorly
  supported). Rewritten with Pointer Events and a movement threshold, so a
  plain click still selects text and does not move the row.

### Changed
- Rows no longer carry `draggable="true"`; each name cell shows a `.row-grip`
  handle on hover instead. Section grips stay, now with `cursor: grabbing`
  feedback and a `body.cat-dragging` selection lock during the drag.
- Section hit-testing uses `elementFromPoint` (with a geometric fallback) so
  the translucent section being dragged does not keep matching itself.

### Added
- `tests/drag-behavior.test.mjs` — **behavioural** drag tests driven through
  jsdom with real `PointerEvent`s (13 checks). Covers category reorder, the
  resulting DOM order, localStorage persistence, row moves between
  categories, badge refresh, and the click-vs-drag threshold.
  Regression-proven: the old implementation scores 7 PASS / 6 FAIL against it,
  the new one 13/13.
- `npm run test:drag`.

### Notes
- Static marker assertions (`smoke-features.mjs`) were updated for the new
  implementation. They **cannot** prove an interaction works — that is what
  `drag-behavior.test.mjs` is for. See `tests/README.md` for the distinction.

## [0.4.3] - 2026-09-11

### Added
- **Resizable table columns (S7)**: every column header carries a drag handle.
  Widths become fixed pixel values on first render (no auto-shrink) and persist
  in `localStorage`, so a reload keeps the layout the user chose.
- **Overflow tooltips (S7)**: any cell whose text does not fit gains a native
  `title` tooltip showing the full value; cells that fit stay tooltip-free to
  avoid noise. Re-evaluated on resize and after filtering.
- **Drag-to-reorder categories (Q6)**: each category header has a grip; drag it
  to move the whole section. Order persists in `localStorage`. AI still leads
  by default.
- **Drag apps between categories (Q7)**: drag any app row into another
  category's table. The move is a view-level override persisted locally — the
  backend scan still reports the package's real category. Row counts refresh.
- `window.__resetLayout()` clears all three layout overrides (column widths,
  category order, row moves) and reloads.
- `tests/` now ships inside the plugin: full suite (`run-tests.mjs`), feature
  smoke (`smoke-features.mjs`), probes, and archived reports.
- The suite supports `--group B,C,D` for module-scoped regression runs, so a
  UI change does not require the full 51-case sweep.

### Changed
- **Light/dark theming (S9)**: the page previously hardcoded a dark palette.
  It now defines light tokens by default and switches to dark via
  `prefers-color-scheme`, with every rule colour funnelled through tokens
  (hover, header, count background, badges).
- **Maintainability (S6)**: removed the unused `defineTool` import and the
  `managedInCat` dead local; extracted `CATEGORY_ICONS` / `CATEGORY_ORDER` /
  `categoryRank()` to module scope so unknown categories sort last instead of
  first (a latent `indexOf === -1` bug).
- `npm test` now runs the real suite (`node tests/run-tests.mjs`) instead of
  globbing a non-existent `lib/**/*.test.js`. Added `test:quick` and `smoke`.
- Scratch paths moved from the sibling `dsh-playground/tests/` into the plugin
  repo so tests travel with the code.

### Removed
- Empty `slides/` directory; `.slidep/`, `slides/`, `*.pptx` and generated test
  snapshots are now git-ignored as unrelated tooling artifacts.

## [0.4.1] - 2026-09-11

### Added
- **Collapsible category sections** on the web page: each tool category
  (source group) renders inside a native `<details>/<summary>` block, so long
  lists stay scannable.
- **Clickable top statistics module**: the four stat cards (`All`,
  `Managed`, `Unmanaged`, `In PATH`) jump to the matching section, and source
  chips filter the tables client-side.

### Changed
- **Unified typography** across the whole page via CSS custom properties
  (`--font-ui`, `--font-mono`, `--fs-title`, `--fs-section`, `--fs-body`,
  `--fs-small`) — every heading, table cell, and label now shares one font
  family and a fixed size scale.
- **Unified list format**: all category tables share a single fixed
  `<colgroup>` column layout (name 22%, version 11%, command 20%, source 9%,
  install 11%, path 21%, status 6%), replacing per-table ad-hoc widths.

### Fixed
- **Compatibility with dsh 0.1.5-rc.1** (bundled `@deepseek-ai/dsh-tools`
  0.1.5-rc.2). The tool API changed in two breaking ways the plugin now
  satisfies:
  - `output` is now **mandatory** — every one of the 7 tools declares it.
  - `output.render` must return **`ContentBlock[]`**, not a bare string; each
    tool now projects its markdown through a shared `asText()` helper that
    returns `[{ type: "text", text }]`.
- `peerDependencies` for `@deepseek-ai/dsh-tools` raised to `^0.1.5-rc.2`.

## [0.4.0] - 2026-09-11

### Added
- **PATH enumeration source** (`discoverFromPath`): walks every directory on
  `PATH` and lists directly-callable executables, catching portable /
  manually-dropped tools no package manager knows about.
- **Windows Add/Remove-Programs (ARP) baseline** (`readArpEntries`): reads the
  three `Uninstall` registry keys to build the list of installer-managed
  programs, used as the cross-reference baseline.
- **Managed vs unmanaged classification**: every discovered app now carries
  `managed: boolean` and `installKind` (`managed` / `portable` / `path-shim`),
  resolved by cross-referencing ARP display names **and** install locations.
- **New sources**: `pip` (global pip packages with a PATH entry) and `uv`
  (`uv tool list`).
- **New CLI commands**:
  - `app-manager unmanaged` (alias `portable`) — list programs not managed by a
    Windows installer.
  - `app-manager method` (alias `how`, `scan`) — print the scan methodology:
    which techniques were used, whether each source was available, and how many
    entries it contributed.
- **New DSH tools**: `app_manager_unmanaged`, `app_manager_scan_method`.
- **New web APIs**: `/app-manager/api/unmanaged`, `/app-manager/api/method`.
- **`--source` / `-s` CLI filter** for `list`.
- Web dashboard now shows a **scan-methodology table**, managed/unmanaged
  badges, and an `Install` column.
- `tests/` directory convention for temporary probe scripts.

### Changed
- `list` output gained a `Managed: N · Unmanaged: M` header and an `Install`
  column per row.
- `export` registry JSON now includes `managedCount`, `unmanagedCount`,
  `managed`, and `installKind`.
- PATH-discovered shims that duplicate a package-manager command are dropped, so
  `npm`/`npx`/`pip` are no longer double-reported as portable tools.

### Fixed
- **`APPDATA` undefined crash**: npm-global discovery now falls back through
  `APPDATA` → `USERPROFILE\AppData\Roaming` → `HOME\AppData\Roaming` instead of
  silently returning nothing. This restores detection of `@deepseek-ai/dsh`,
  `@anthropic-ai/claude-code`, `@openai/codex`, and pnpm.
- **ARP registry read returned zero entries**: the PowerShell snippet is now
  written to a temp `.ps1` file and invoked with `-File` (plus forced UTF-8
  output), avoiding the quote-escaping corruption of the old `-Command` path.
- **Slow scans (~50s → ~9s)**: bulk command checks now reuse a cached PATH index
  (`pathIndexHas`) instead of spawning `where` per package.
- Noise filtering for OS/bundled-runtime directories (`System32`, PortableGit
  `usr/bin`, JetBrains/DevEco bundled runtimes, `node_modules/.bin`) and command
  variants (`python_d`, `pip3.13`, `git-*` plumbing).

## [0.3.0] - 2025-01-15

### Added
- Web dashboard at `/app-manager` with dark-themed HTML page
- JSON API endpoint `/app-manager/api/apps`
- Product Requirements Document (PRD.md)
- Publishing guide (PUBLISH.md)
- Future feature design document (DESIGN.md)
- `repository`, `bugs`, `homepage` fields in `package.json`
- Bilingual README (Chinese + English)
- CHANGELOG.md

### Changed
- Improved `package.json` metadata for marketplace publishing
- Updated `files` field to include `CHANGELOG.md` and `LICENSE`
- Bumped version to 0.3.0

## [0.2.0] - 2025-01-15

### Added
- Full TypeScript rewrite with strict types
- DSH AI tools integration (`app_manager_list`, `app_manager_info`, `app_manager_check_updates`, `app_manager_update`, `app_manager_doctor`)
- `ctx.inject` pattern for Cordis service injection (avoids `cannot get property "tools" without inject` error)
- Type definitions in `src/types.ts`

### Changed
- Refactored from JavaScript to TypeScript
- Updated build output directory to `lib/`
- CLI entry now compiled from `bin/cli-app-manager.ts`

## [0.1.0] - 2025-01-14

### Added
- Initial release with JavaScript implementation
- Auto-discovery from npm, pnpm, npx-cache, scoop, choco, cargo, pipx
- CLI commands: list, check, info, update, update-all, doctor, monitor, search, export
- DSH bundle configuration (`patch.yml`)
- Terminal output with colorization and tables


