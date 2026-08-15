const test = require('node:test');
const assert = require('node:assert/strict');

const { parseSpdl } = require('../spdl-parser.js');
const { createHarness } = require('./helpers/gs-harness.js');

const textAt = (records, row, col) => {
  const record = records.find(
    (r) => r.fields.Row === row && r.fields.Col === col && r.fields.Value !== undefined,
  );
  return record && record.fields;
};

test('Q restores the graphics state saved by q', () => {
  const records = parseSpdl([
    '1 0 0 rg',
    'q',
    '0 0 1 rg',
    '/F2 Tf',
    '1 Tr',
    '30 Ts',
    '/Rotate 45',
    '/Align HCenter',
    '30 0 Td',
    '(inside) Tj',
    'Q',
    '(outside) Tj',
  ].join('\n'));

  // Td moves in tenths of a cell: 30 is three columns along.
  const inside = textAt(records, 1, 4);
  assert.equal(inside.TextColor, '#0000ff');
  assert.equal(inside.Bold, true);
  assert.equal(inside.Underline, true);
  assert.equal(inside.Rotation, 45);
  assert.equal(inside.Alignment, 'HCenter');

  // Everything the save captured is back, cursor included.
  const outside = textAt(records, 1, 1);
  assert.equal(outside.Value, 'outside');
  assert.equal(outside.TextColor, '#ff0000');
  assert.equal(outside.Bold, false);
  assert.equal(outside.Underline, false);
  assert.equal(outside.Rotation, 0);
  assert.equal(outside.Alignment, '');
});

test('q/Q nest', () => {
  const records = parseSpdl([
    'q', '1 0 0 rg',
    'q', '0 1 0 rg', '(green) Tj',
    'Q', '/MoveTo 2 1', '(red) Tj',
    'Q', '/MoveTo 3 1', '(black) Tj',
  ].join('\n'));

  assert.equal(textAt(records, 1, 1).TextColor, '#00ff00');
  // The inner Q restored the outer save's red fill...
  assert.equal(textAt(records, 1, 2).TextColor, '#ff0000');
  // ...and the outer Q restored the default black.
  assert.equal(textAt(records, 1, 3).TextColor, '#000000');
});

test('an unmatched Q is a no-op', () => {
  const records = parseSpdl('1 0 0 rg\nQ\nQ\n(still red) Tj');
  assert.equal(textAt(records, 1, 1).TextColor, '#ff0000');
});

test('the saved state does not include the page', () => {
  // A /NewPage inside q…Q keeps its new page origin — page structure is
  // document layout, not graphics state — so a page-relative move after the
  // Q lands on the second page.
  const records = parseSpdl('4 3 MediaBox\nq\n/NewPage\nQ\n/MoveTo 1 1\n(where) Tj');
  assert.equal(textAt(records, 6, 1).Value, 'where');

  // The cursor itself *is* graphics state, so without the /MoveTo the Q puts
  // it back where the q was, even though that is on the previous page.
  const restored = parseSpdl('4 3 MediaBox\nq\n/NewPage\nQ\n(where) Tj');
  assert.equal(textAt(restored, 1, 1).Value, 'where');
});

test('the Apps Script renderer restores the same state', () => {
  const { renderPDF, model } = createHarness([
    '1 0 0 rg', 'q', '0 0 1 rg', '/F2 Tf', '30 0 Td', '(inside) Tj', 'Q', '(outside) Tj',
  ]);
  renderPDF();

  // 30 0 Td is three columns along, so "inside" lands in column 4.
  assert.equal(model.values[0][3], 'inside');
  assert.equal(model.fontColors[0][3], '#0000ff');
  assert.equal(model.fontWeights[0][3], 'bold');

  assert.equal(model.values[0][0], 'outside');
  assert.equal(model.fontColors[0][0], '#ff0000');
  assert.equal(model.fontWeights[0][0], 'normal');
});
