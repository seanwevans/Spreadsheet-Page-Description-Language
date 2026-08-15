# Changelog

Notable changes to the SPDL specification, the renderers, and the tooling.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

The **specification** is versioned separately from this repository: `SPEC.md`
carries its own version (currently 1.0), and a change to it is called out
under a "Specification" heading below.

## [Unreleased]

### Added
- `spdl-lint` gained `--json`, `--quiet`, `--max-warnings <n>` and `--help`,
  so it composes into other tooling and can gate on warnings.
- ESLint configuration covering the Node tooling, the UMD reference parser and
  the Apps Script renderer, wired into CI as `npm run lint`.
- A GitHub Pages workflow that publishes `docs/playground.html`.
- `CONTRIBUTING.md` and this changelog; issue and pull request templates.

### Changed
- CI now lints the bundled examples, so a broken example fails the build.

## 1.0 — 2025-11-28

The initial public state of the project: the SPDL 1.0 specification, five
renderers (Google Apps Script, Office Scripts, VBA, AppleScript/Numbers and
Airtable), the shared reference parser, the stream linter, the browser
playground, and the test suite.
