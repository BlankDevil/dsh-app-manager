# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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


