## What this changes

<!-- What the change does, and why. Link any related issue. -->

## Renderers affected

<!-- Tick every renderer this touches. A language change usually touches all
     of them: a platform that cannot express a feature must log and skip it. -->

- [ ] Reference parser (`spdl-parser.js`)
- [ ] Google Apps Script (`spdlrender.gs`)
- [ ] Office Scripts (`spdlrender.office.ts`)
- [ ] VBA (`spdlrender.vba`)
- [ ] AppleScript / Numbers (`spdlrender.numbers.applescript`)
- [ ] Airtable (`spdlrender.airtable.js`)
- [ ] None — tooling, tests or docs only

## Checks

- [ ] `npm test`
- [ ] `npm run lint` and `npm run lint:examples`
- [ ] `SPEC.md` updated, if the language or its semantics changed
- [ ] Golden files regenerated (`npm run golden:update`) and the diff reviewed

## Notes for review

<!-- Anything reviewers should look at first: a behavior change, a spec
     ambiguity you had to resolve, a golden-file diff worth reading. -->
