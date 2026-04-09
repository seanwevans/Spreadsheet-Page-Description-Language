const test = require('node:test');
const assert = require('node:assert/strict');

const { parseSpdl } = require('../spdlrender.airtable.js');

function firstTextCell(records) {
  return records.find((r) => typeof r.fields.Value === 'string');
}

test('MoveTo converts Y to pageTop + y - 1', () => {
  const stream = [
    '6 4 MediaBox',
    '/NewPage',
    '/MoveTo 3 1',
    '(A) Tj',
  ].join('\n');

  const records = parseSpdl(stream);
  const cell = firstTextCell(records);

  assert.ok(cell);
  assert.equal(cell.fields.Col, 3);
  assert.equal(cell.fields.Row, 7);
});

test('MoveTo clamps X to at least 1 and to pageWidth when defined', () => {
  const stream = [
    '6 4 MediaBox',
    '/MoveTo 0 2',
    '(LeftClamp) Tj',
    '/MoveTo 99 2',
    '(RightClamp) Tj',
  ].join('\n');

  const records = parseSpdl(stream).filter((r) => typeof r.fields.Value === 'string');

  assert.equal(records[0].fields.Col, 1);
  assert.equal(records[0].fields.Row, 2);

  assert.equal(records[1].fields.Col, 6);
  assert.equal(records[1].fields.Row, 2);
});

test('MoveTo clamps Y to page bounds when pageHeight is defined', () => {
  const stream = [
    '6 4 MediaBox',
    '/MoveTo 2 0',
    '(TopClamp) Tj',
    '/MoveTo 2 99',
    '(BottomClamp) Tj',
  ].join('\n');

  const records = parseSpdl(stream).filter((r) => typeof r.fields.Value === 'string');

  assert.equal(records[0].fields.Col, 2);
  assert.equal(records[0].fields.Row, 1);

  assert.equal(records[1].fields.Col, 2);
  assert.equal(records[1].fields.Row, 4);
});

test('MoveTo keeps X >= 1 when pageWidth is not defined', () => {
  const stream = [
    '/MoveTo -5 3',
    '(NoWidth) Tj',
  ].join('\n');

  const records = parseSpdl(stream);
  const cell = firstTextCell(records);

  assert.ok(cell);
  assert.equal(cell.fields.Col, 1);
  assert.equal(cell.fields.Row, 3);
});
