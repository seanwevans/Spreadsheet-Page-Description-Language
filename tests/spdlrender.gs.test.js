// Executes the Google Apps Script renderer in Node against a mocked
// SpreadsheetApp, so its rendering behavior and API-call budget are testable
// without a Google account.
const test = require('node:test');
const assert = require('node:assert/strict');

const { createHarness, loadExample } = require('./helpers/gs-harness.js');

test('renders hello-world.spdl into the expected grid', () => {
  const { renderPDF, model } = createHarness(loadExample('hello-world.spdl'));
  renderPDF();

  // 40 40 Td moves the cursor to (5, 5).
  assert.equal(model.values[4][4], 'Hello World');
  assert.equal(model.fontColors[4][4], '#ff0000');
  assert.equal(model.fontWeights[4][4], 'bold');

  assert.equal(model.values[8][4], 'Welcome to SPDL');
  assert.equal(model.fontColors[8][4], '#000000');

  // 16x20 MediaBox: white page with a border, dark canvas outside it.
  assert.equal(model.backgrounds[0][0], 'white');
  assert.equal(model.backgrounds[19][15], 'white');
  assert.equal(model.backgrounds[20][0], '#505050');
  assert.equal(model.backgrounds[0][16], '#505050');
  assert.ok(model.borders.some((b) => b.row === 1 && b.col === 1 && b.numRows === 20 && b.numCols === 16));

  // /CheckBox lands on the current cursor cell.
  assert.deepEqual(model.checkboxes, [{ row: 9, col: 5 }]);
  assert.equal(model.hAligns[8][4], 'center');
});

test('renders example.spdl with links, forms, and a bounded API budget', () => {
  const { renderPDF, model } = createHarness(loadExample('example.spdl'));
  renderPDF();

  const flat = model.values.flat();
  assert.ok(flat.includes('SPDL Demo'));
  assert.ok(flat.includes('=HYPERLINK("https://example.com", "Click Me")'));
  assert.ok(flat.includes('Alpha'), 'dropdown default value');
  assert.ok(model.merges.some((m) => m.numCols === 6), 'dropdown merges 6 columns');
  assert.ok(model.validations.length === 1);
  assert.ok(model.notes.flat().includes('Rendered by an SPDL renderer'));
  assert.ok(model.backgrounds.flat().includes('#F1C40F'), 'pixel art');
  assert.ok(model.checkboxes.length === 1);

  // Second page starts below the first (20 rows + 2 gap).
  const pageTwoRow = model.values.findIndex((row) => row.includes('Page two'));
  assert.equal(pageTwoRow, 23); // row 24, 0-indexed 23

  // The whole render must stay within a fixed API budget: 11 bulk grid
  // writes + setup + a handful of deferred ops. Before batching this was
  // hundreds of calls.
  assert.ok(model.apiCalls < 40, `expected < 40 API calls, got ${model.apiCalls}`);
  assert.equal(model.bulkCalls.setValues, 1);
  assert.equal(model.bulkCalls.setBackgrounds, 1);
});

test('text styling state applies per cell, not globally', () => {
  const { renderPDF, model } = createHarness([
    '/F2 15 Tf',
    '1 Tr',
    '(bold underlined) Tj',
    '/F1 15 Tf',
    '0 Tr',
    '20 0 Td',
    '(plain) Tj',
  ]);
  renderPDF();

  assert.equal(model.fontWeights[0][0], 'bold');
  assert.equal(model.fontLines[0][0], 'underline');
  assert.equal(model.fontWeights[0][2], 'normal');
  assert.equal(model.fontLines[0][2], 'none');
});

test('one bad command does not abort the render', () => {
  const { renderPDF, model, logs } = createHarness([
    '(before) Tj',
    'complete nonsense !!',
    '10 0 Td',
    '(after) Tj',
  ]);
  renderPDF();

  assert.equal(model.values[0][0], 'before');
  assert.equal(model.values[0][1], 'after');
  assert.ok(logs.some((l) => l.includes('Skipped unrecognized command')));
});
