const test = require('node:test');
const assert = require('node:assert/strict');

const { parseSpdl } = require('../spdl-parser.js');
const { lint } = require('../spdl-lint.js');

function textCells(records) {
  return records.filter((r) => typeof r.fields.Value === 'string');
}

test('% comment lines are skipped', () => {
  const stream = [
    '% set up the page',
    '16 20 MediaBox',
    '% this is not a command: rg Td Tj',
    '(hello) Tj',
  ].join('\n');

  const records = parseSpdl(stream);
  assert.equal(textCells(records).length, 1);
  assert.equal(textCells(records)[0].fields.Value, 'hello');
  assert.deepEqual(lint(stream).errors, []);
});

test('escaped parens render literally in Tj', () => {
  const cell = textCells(parseSpdl('(a \\(nested\\) note) Tj'))[0];
  assert.equal(cell.fields.Value, 'a (nested) note');
});

test('bare parens still work in Tj for backward compatibility', () => {
  const cell = textCells(parseSpdl('(smile :)) Tj'))[0];
  assert.equal(cell.fields.Value, 'smile :)');
});

test('escaped backslash renders literally', () => {
  const cell = textCells(parseSpdl('(C:\\\\path) Tj'))[0];
  assert.equal(cell.fields.Value, 'C:\\path');
});

test('escaped parens do not end /Link operands', () => {
  const records = parseSpdl('(https://example.com/a\\)b) (label \\(x\\)) /Link');
  const cell = records[0];
  assert.equal(cell.fields.Link, 'https://example.com/a)b');
  assert.equal(cell.fields.Value, 'label (x)');
});

test('escaped parens work in /Note and /Dropdown', () => {
  const records = parseSpdl([
    '(see \\(footnote\\)) /Note',
    '(Option A \\(default\\),Option B) /Dropdown',
  ].join('\n'));

  assert.equal(records[0].fields.Note, 'see (footnote)');
  assert.equal(records[1].fields.Dropdown, 'Option A (default)');
});

test('escaped commands lint clean', () => {
  const stream = [
    '(a \\(nested\\)) Tj',
    '(url\\)x) (label) /Link',
    '(note \\(1\\)) /Note',
  ].join('\n');
  assert.deepEqual(lint(stream).errors, []);
});
