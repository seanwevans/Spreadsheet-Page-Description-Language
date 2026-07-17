# Contributing to SPDL

Thanks for helping improve the Spreadsheet Page Description Language!

## Getting started

```bash
git clone https://github.com/seanwevans/Spreadsheet-Page-Description-Language
cd Spreadsheet-Page-Description-Language
npm test
```

Node 18+ is the only requirement; there are no dependencies to install.

## Project layout

| Path | What it is |
| --- | --- |
| `SPEC.md` | The canonical grammar and semantics. All renderers target it. |
| `spdl-parser.js` | The **reference parser** (UMD; Node + browser). The tested source of truth. |
| `spdlrender.*.{gs,office.ts,vba,numbers.applescript,airtable.js}` | Platform renderers. |
| `spdl-lint.js` | Stream validator CLI built on the reference grammar. |
| `examples/*.spdl` | Runnable example streams. |
| `tests/` | Node test suite, including golden files and a mocked-SpreadsheetApp harness for the Apps Script renderer. |
| `docs/playground.html` | Self-contained browser preview. |

## Making changes

- **Changing language semantics?** Update, in one PR: `SPEC.md`, the
  reference parser, the affected renderers, and the golden files
  (`npm run golden:update` — commit the diff so the change is visible in
  review). Add or update tests.
- **Renderer-only changes** must keep behavior aligned with `SPEC.md`. If a
  platform can't express a feature, log and skip — don't approximate
  differently from the spec.
- **Dispatch rule**: commands are matched with anchored patterns only. Never
  use substring checks (`includes`, `InStr`, `Like`) to recognize a command —
  text content must remain opaque.
- Run `npm test` before pushing; CI runs it on Node 18/20/22. Keep the fuzz
  tests passing — if fuzzing finds a crash, fix the crash rather than the
  fuzzer.
- Validate example streams with `npm run lint:examples`.

## Pull requests

- One logical change per PR, with a description of behavior before/after.
- Tests accompany behavior changes; golden diffs accompany semantics changes.
- CI must be green.

## Reporting issues

Use the issue templates. For rendering bugs, include the SPDL stream (or a
minimal reproduction), which renderer, and what you expected versus what
rendered — a screenshot helps for visual issues.
