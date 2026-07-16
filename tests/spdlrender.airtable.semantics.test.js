const test = require('node:test');
const assert = require('node:assert/strict');

const { parseSpdl } = require('../spdlrender.airtable.js');

function textCells(records) {
  return records.filter((r) => typeof r.fields.Value === 'string');
}

test('Td truncates toward zero for negative deltas', () => {
  // Move to (5, 5), then -15/-15 must truncate to -1 (not floor to -2).
  const stream = [
    '40 40 Td',
    '-15 -15 Td',
    '(here) Tj',
  ].join('\n');

  const cell = textCells(parseSpdl(stream))[0];
  assert.equal(cell.fields.Col, 4);
  assert.equal(cell.fields.Row, 4);
});

test('Td truncates toward zero for positive deltas', () => {
  const stream = [
    '15 15 Td',
    '(here) Tj',
  ].join('\n');

  const cell = textCells(parseSpdl(stream))[0];
  assert.equal(cell.fields.Col, 2);
  assert.equal(cell.fields.Row, 2);
});

test('Ts accepts decimal font sizes without breaking dispatch', () => {
  const stream = [
    '12.5 Ts',
    '(sized) Tj',
  ].join('\n');

  const cells = textCells(parseSpdl(stream));
  assert.equal(cells.length, 1);
  assert.equal(cells[0].fields.Value, 'sized');
});

test('/Rotate accepts the operand on either side', () => {
  const stream = [
    '/Rotate 30',
    '(a) Tj',
    '45 /Rotate',
    '(b) Tj',
  ].join('\n');

  const cells = textCells(parseSpdl(stream));
  assert.equal(cells[0].fields.Rotation, 30);
  assert.equal(cells[1].fields.Rotation, 45);
});

test('S strokes only the rectangle perimeter', () => {
  const stream = [
    '2 2 3 3 re',
    'S',
  ].join('\n');

  const records = parseSpdl(stream);
  assert.equal(records.length, 8); // 3x3 rect has 8 perimeter cells

  const centerCell = records.find((r) => r.fields.Col === 3 && r.fields.Row === 4);
  assert.equal(centerCell, undefined);
  for (const record of records) {
    assert.equal(record.fields.BorderColor, '#000000');
  }
});

test('f still fills the full rectangle', () => {
  const stream = [
    '2 2 3 3 re',
    'f',
  ].join('\n');

  const records = parseSpdl(stream);
  assert.equal(records.length, 9);
});
