const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { lint } = require('../spdl-lint.js');

test('example streams lint clean', () => {
  const examplesDir = path.join(__dirname, '..', 'examples');
  for (const file of fs.readdirSync(examplesDir).filter((f) => f.endsWith('.spdl'))) {
    const findings = lint(fs.readFileSync(path.join(examplesDir, file), 'utf8'));
    assert.deepEqual(findings.errors, [], `${file} should have no errors`);
    assert.deepEqual(findings.warnings, [], `${file} should have no warnings`);
  }
});

test('unrecognized lines are errors with correct line numbers', () => {
  const { errors } = lint('16 20 MediaBox\nthis is junk\n(ok) Tj\nmore junk');
  assert.equal(errors.length, 2);
  assert.equal(errors[0].line, 2);
  assert.equal(errors[1].line, 4);
});

test('valid commands produce no errors', () => {
  const stream = [
    '16 20 MediaBox', '/NewPage', '/MoveTo 2 3', '40 40 Td', '(text) Tj',
    '1 0 0 rg', '0 1 0 SC', '2 w', '1 1 4 2 re', 'f', 'S',
    '3 3 ID 121212121', '/Rotate 45', '45 /Rotate', '/Align HCenter',
    '/F2 15 Tf', '1 Tr', '12.5 Ts', '2 TA',
    '(url) (label) /Link', '20 20 (http://x) /InsertImage',
    '(note) /Note', '(a,b) /Dropdown', '/CheckBox',
  ].join('\n');
  const { errors } = lint(stream);
  assert.deepEqual(errors, []);
});

test('warns on /NewPage before MediaBox', () => {
  const { warnings } = lint('/NewPage');
  assert.equal(warnings.length, 1);
  assert.match(warnings[0].message, /before a valid MediaBox/);
});

test('warns on short pixel art payload', () => {
  const { warnings } = lint('3 3 ID 1212');
  assert.equal(warnings.length, 1);
  assert.match(warnings[0].message, /needs 9/);
});

test('warns on zero-dimension MediaBox and unknown /Align directive', () => {
  const { warnings } = lint('0 5 MediaBox\n/Align HMiddle');
  assert.equal(warnings.length, 2);
  assert.match(warnings[0].message, /must be positive/);
  assert.match(warnings[1].message, /unknown \/Align directive/);
});

test('warns on out-of-range color components', () => {
  const { warnings } = lint('2 0 0 rg');
  assert.equal(warnings.length, 1);
  assert.match(warnings[0].message, /clamped/);
});
