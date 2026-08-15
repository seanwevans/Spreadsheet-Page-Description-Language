const test = require('node:test');
const assert = require('node:assert/strict');

const { parseSpdl, parseSpdlDocument, wrapText, CHARS_PER_CELL } = require('../spdl-parser.js');
const { createHarness } = require('./helpers/gs-harness.js');

const cellsOf = (records) => records.map((r) => `${r.fields.Row},${r.fields.Col}`);

test('a horizontal line strokes the run of cells between its endpoints', () => {
  const records = parseSpdl('2 0 5 0 l');
  assert.deepEqual(cellsOf(records), ['1,2', '1,3', '1,4', '1,5']);
  assert.equal(records[0].fields.BorderColor, '#000000');
  assert.equal(records[0].fields.BorderStyle, 'thick');
});

test('a vertical line runs down a column and honors the stroke state', () => {
  const records = parseSpdl('1 0 0 SC\n2 w\n3 1 3 4 l');
  assert.deepEqual(cellsOf(records), ['2,3', '3,3', '4,3', '5,3']);
  assert.equal(records[0].fields.BorderColor, '#ff0000');
  assert.equal(records[0].fields.BorderStyle, 'medium');
});

test('endpoints may be given in either order', () => {
  assert.deepEqual(cellsOf(parseSpdl('5 0 2 0 l')), cellsOf(parseSpdl('2 0 5 0 l')));
});

test('lines are page-relative', () => {
  const records = parseSpdl('4 3 MediaBox\n/NewPage\n1 0 3 0 l');
  assert.deepEqual(cellsOf(records), ['6,1', '6,2', '6,3']);
});

test('a diagonal line is skipped rather than approximated', () => {
  assert.deepEqual(parseSpdl('1 1 4 4 l'), []);
});

test('wrapText fills lines up to width * CHARS_PER_CELL characters', () => {
  assert.equal(CHARS_PER_CELL, 4);
  assert.deepEqual(wrapText('the quick brown fox', 4), ['the quick brown', 'fox']);
  assert.deepEqual(wrapText('the quick brown fox', 2), ['the', 'quick', 'brown', 'fox']);
  // A word longer than the line gets a line of its own instead of being split.
  assert.deepEqual(wrapText('supercalifragilistic ok', 2), ['supercalifragilistic', 'ok']);
  assert.deepEqual(wrapText('   ', 4), []);
});

test('/TextBox writes one wrapped line per row and clips the overflow', () => {
  const records = parseSpdl('/MoveTo 2 3\n4 2 (the quick brown fox jumps over the lazy dog) /TextBox');

  assert.equal(records.length, 2, 'the box is two rows tall');
  assert.deepEqual(records.map((r) => r.fields.Value), ['the quick brown', 'fox jumps over']);
  assert.deepEqual(cellsOf(records), ['3,2', '4,2']);
});

test('/TextBox carries the active text styling', () => {
  const records = parseSpdl('1 0 0 rg\n/F2 Tf\n1 Tr\n3 1 (styled) /TextBox');
  assert.deepEqual(records[0].fields, {
    Row: 1,
    Col: 1,
    Value: 'styled',
    TextColor: '#ff0000',
    Bold: true,
    Italic: false,
    Underline: true,
    Rotation: 0,
    Alignment: '',
    StrokeWidth: 3,
  });
});

test('/TextBox with a non-positive box draws nothing', () => {
  assert.deepEqual(parseSpdl('0 2 (text) /TextBox'), []);
  assert.deepEqual(parseSpdl('2 0 (text) /TextBox'), []);
});

test('/ColWidth and /RowHeight size the cursor column and row', () => {
  const { columns, rows } = parseSpdlDocument([
    '120 /ColWidth',
    '/MoveTo 3 5',
    '80 /ColWidth',
    '40 /RowHeight',
    '/MoveTo 3 5',
    '90 /ColWidth',
  ].join('\n'));

  // Last request for an index wins; entries are sorted by index.
  assert.deepEqual(columns, [{ col: 1, size: 120 }, { col: 3, size: 90 }]);
  assert.deepEqual(rows, [{ row: 5, size: 40 }]);
});

test('the Apps Script renderer applies lines, text boxes and cell sizes', () => {
  const { renderPDF, model } = createHarness([
    '8 8 MediaBox',
    '1 2 5 2 l',
    '/MoveTo 1 4',
    '4 2 (the quick brown fox jumps over the lazy dog) /TextBox',
    '/MoveTo 2 6',
    '120 /ColWidth',
    '40 /RowHeight',
  ]);
  renderPDF();

  const line = model.borders.find((b) => b.row === 3 && b.numRows === 1 && b.numCols === 5);
  assert.ok(line, `expected a 5-cell border run, got ${JSON.stringify(model.borders)}`);

  assert.equal(model.values[3][0], 'the quick brown');
  assert.equal(model.values[4][0], 'fox jumps over');

  assert.deepEqual(model.columnWidths, [{ column: 2, width: 120 }]);
  assert.deepEqual(model.rowHeights, [{ row: 6, height: 40 }]);
});
