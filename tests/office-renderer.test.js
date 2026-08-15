/**
 * Office Scripts behavior that the cross-renderer conformance suite cannot
 * assert, because it is where Excel for the web genuinely differs from the
 * other platforms.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

const { runOfficeRenderer, isAvailable } = require('./helpers/office-harness.js');
const { CHECKBOX_GLYPH } = require('./helpers/office-adapter.js');

const skip = isAvailable()
  ? false
  : 'install the optional `typescript` devDependency to run the Office Scripts harness';

test('the checkbox placeholder lands at the cursor and is centered', { skip }, () => {
  const { model } = runOfficeRenderer(['16 20 MediaBox', '/MoveTo 3 4', '/CheckBox']);
  const cell = model.cells.get('4,3');

  assert.equal(cell.value, CHECKBOX_GLYPH);
  assert.equal(cell.hAlign, 'center');
  assert.equal(cell.vAlign, 'center');
});

test('images are logged and skipped rather than failing the render', { skip }, () => {
  const { model, logs } = runOfficeRenderer([
    '16 20 MediaBox',
    '80 60 (https://example.com/logo.png) /InsertImage',
    '(after the image) Tj',
  ]);

  assert.ok(
    logs.some((line) => line.includes('Skipping image insertion') && line.includes('logo.png')),
    `expected an image skip log, got: ${logs.join(' | ')}`,
  );
  assert.equal(model.cells.get('1,1').value, 'after the image');
});

test('an unrecognized command is logged and does not stop the stream', { skip }, () => {
  const { model, logs } = runOfficeRenderer(['16 20 MediaBox', '/Nonsense 1 2', '(kept) Tj']);

  assert.ok(logs.some((line) => line.includes('Skipped unrecognized command: /Nonsense 1 2')));
  assert.equal(model.cells.get('1,1').value, 'kept');
});

test('the dropdown merges up to six columns and shrinks at the canvas edge', { skip }, () => {
  const { model } = runOfficeRenderer(['(a,b) /Dropdown']);
  assert.deepEqual(model.merges, [{ row: 1, col: 1, numCols: 6 }]);

  const atEdge = runOfficeRenderer(['/MoveTo 24 1', '(a,b) /Dropdown']);
  assert.deepEqual(atEdge.model.merges, [{ row: 1, col: 24, numCols: 3 }]);
});

test('notes are attached as comments', { skip }, () => {
  const { model } = runOfficeRenderer(['(remember this) /Note']);
  assert.deepEqual(model.comments, [{ row: 1, col: 1, text: 'remember this' }]);
});
