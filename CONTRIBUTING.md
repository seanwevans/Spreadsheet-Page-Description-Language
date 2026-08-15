# Contributing to SPDL

Thanks for helping out. This repository holds a small language spec and five
renderers that all have to agree with each other, so most of the guidance here
is about keeping that agreement intact.

## Getting set up

```bash
git clone https://github.com/seanwevans/Spreadsheet-Page-Description-Language
cd Spreadsheet-Page-Description-Language
npm install     # optional: no runtime dependencies, dev tooling only
npm test
```

Node 18 or newer. The renderers themselves have no dependencies — the
`devDependencies` are the linter and the TypeScript used to check the Office
Scripts renderer.

## The checks

| Command | What it covers |
| --- | --- |
| `npm test` | The whole suite (`node --test`) |
| `npm run lint` | ESLint over the JavaScript and the Apps Script renderer |
| `npm run lint:examples` | The bundled `.spdl` examples, via `spdl-lint` |
| `npm run golden:update` | Regenerates `tests/golden/*.json` after an intentional semantics change |

CI runs the tests on Node 18, 20 and 22, plus lint. Everything must be green.

## Changing the language

`SPEC.md` is the contract; the renderers implement it. So:

1. **Update `SPEC.md` first.** If the behavior is not written down, two
   renderers will eventually disagree about it — that is exactly how the bugs
   this repository has already fixed got in.
2. **Update every renderer that can express the feature.** A platform that
   cannot must log and skip, never approximate.
3. **Add a test.** If a bug came from two renderers disagreeing, add a
   conformance fixture so it cannot come back.
4. **Regenerate the golden files** if the reference parser's output changed,
   and include the diff in your commit so reviewers can see the effect.

## Style

Match the surrounding code: two-space indentation, semicolons, double quotes
in the renderers, single quotes in the tests. Comments should explain *why* a
rule exists (a platform quirk, a spec requirement) rather than restate the
code. `npm run lint` enforces the mechanical parts.

## Commits and pull requests

Write commit messages that explain the change and its motivation, not just
the files touched. Keep pull requests focused on one concern — a spec change,
a renderer fix, a tooling addition — so they can be reviewed and reverted
independently.

## Reporting bugs

A stream that reproduces the problem is worth more than a description of it.
Include the stream, the renderer you ran it on, and what you expected to see;
`node spdl-lint.js your-stream.spdl` output helps too.
