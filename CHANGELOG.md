# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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


