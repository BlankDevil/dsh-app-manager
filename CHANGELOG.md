# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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

