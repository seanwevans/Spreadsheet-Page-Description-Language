const test = require('node:test');
const assert = require('node:assert/strict');

const { parseSpdl, DEFAULT_CANVAS } = require('../spdl-parser.js');

const at = (records, row, col) => records.find((r) => r.fields.Row === row && r.fields.Col === col);

test('shapes are clamped to the canvas instead of being dropped', () => {
  // 999 columns wide is far past the 26-column canvas: the visible part still
  // renders, which is what every spreadsheet renderer does with clampRect.
  const records = parseSpdl('0 0 999 3 re\nf');
  assert.ok(records.length > 0, 'clamped shape should still draw');
  assert.equal(Math.max(...records.map((r) => r.fields.Col)), DEFAULT_CANVAS.cols);
  assert.equal(records.length, DEFAULT_CANVAS.cols * 3);
});

test('shapes entirely outside the canvas draw nothing', () => {
  assert.deepEqual(parseSpdl('40 0 4 4 re\nf'), []);
  assert.deepEqual(parseSpdl('1 5000 4 4 re\nf'), []);
});

test('stroke traces the perimeter of the clamped rectangle', () => {
  const records = parseSpdl('1 1 999 3 re\nS');
  const rows = records.map((r) => r.fields.Row);
  // Middle row keeps only its left and right edges, at the clamped width.
  const middle = records.filter((r) => r.fields.Row === Math.min(...rows) + 1);
  assert.deepEqual(middle.map((r) => r.fields.Col).sort((a, b) => a - b), [1, DEFAULT_CANVAS.cols]);
});

test('the 100k cell cap applies after clamping, not before', () => {
  // Unbounded parsing keeps the old guard: a 999x999 fill is refused outright.
  assert.deepEqual(parseSpdl('1 1 999 999 re\nf', { canvas: null }), []);
  // Bounded parsing clamps the same shape down to something drawable.
  assert.ok(parseSpdl('1 1 999 999 re\nf').length > 0);
});

test('a custom canvas bounds the drawing', () => {
  const records = parseSpdl('0 0 999 2 re\nf', { canvas: { rows: 10, cols: 5 } });
  assert.equal(Math.max(...records.map((r) => r.fields.Col)), 5);
});

test('text with an off-canvas cursor is skipped', () => {
  assert.deepEqual(parseSpdl('400 0 Td\n(off the right edge) Tj'), []);
  assert.deepEqual(parseSpdl('0 20000 Td\n(off the bottom) Tj'), []);
});

test('pixel art keeps only the pixels that land on the canvas', () => {
  const records = parseSpdl('240 0 Td\n3 1 ID 111', { canvas: { rows: 10, cols: 26 } });
  assert.deepEqual(records.map((r) => r.fields.Col), [25, 26]);
});

test('/MoveTo without a page is bounded by the canvas', () => {
  const records = parseSpdl('/MoveTo 999 9999\n(edge) Tj');
  assert.equal(at(records, DEFAULT_CANVAS.rows, DEFAULT_CANVAS.cols).fields.Value, 'edge');
});
