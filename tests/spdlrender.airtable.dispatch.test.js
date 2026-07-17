const test = require('node:test');
const assert = require('node:assert/strict');

const { parseSpdl } = require('../spdlrender.airtable.js');

function textCells(records) {
  return records.filter((r) => typeof r.fields.Value === 'string');
}

test('text containing operator substrings is rendered verbatim', () => {
  const stream = [
    '(Morgan) Tj',       // contains "rg"
    '(hello world) Tj',  // contains " w"
    '(Try again) Tj',    // contains "Tr"
    '(Tsunami) Tj',      // contains "Ts"
    '(MediaBox) Tj',     // contains "MediaBox"
    '(ID card) Tj',      // contains "ID"
  ].join('\n');

  const cells = textCells(parseSpdl(stream));

  assert.deepEqual(
    cells.map((c) => c.fields.Value),
    ['Morgan', 'hello world', 'Try again', 'Tsunami', 'MediaBox', 'ID card'],
  );
});

test('text containing "rg" does not corrupt the fill color', () => {
  const stream = [
    '(Morgan) Tj',
    '(after) Tj',
  ].join('\n');

  const cells = textCells(parseSpdl(stream));
  assert.equal(cells[0].fields.TextColor, '#000000');
  assert.equal(cells[1].fields.TextColor, '#000000');
});

test('text containing "Tr" does not toggle underline', () => {
  const stream = [
    '1 Tr',
    '(Try again) Tj',
    '(still underlined) Tj',
  ].join('\n');

  const cells = textCells(parseSpdl(stream));
  assert.equal(cells[0].fields.Underline, true);
  assert.equal(cells[1].fields.Underline, true);
});

test('text containing "Td" does not move the cursor', () => {
  const stream = [
    '(Td rules) Tj',
    '(next) Tj',
  ].join('\n');

  const cells = textCells(parseSpdl(stream));
  assert.equal(cells[1].fields.Row, 1);
  assert.equal(cells[1].fields.Col, 1);
});

test('real operators still work after text has been written', () => {
  const stream = [
    '1 0 0 rg',
    '/F2 15 Tf',
    '40 40 Td',
    '(styled) Tj',
  ].join('\n');

  const cell = textCells(parseSpdl(stream))[0];
  assert.equal(cell.fields.TextColor, '#ff0000');
  assert.equal(cell.fields.Bold, true);
  assert.equal(cell.fields.Row, 5);
  assert.equal(cell.fields.Col, 5);
});

test('InsertImage URL containing operator substrings does not corrupt state', () => {
  const stream = [
    '20 20 (https://example.com/rg?Td=1) /InsertImage',
    '(after image) Tj',
  ].join('\n');

  const records = parseSpdl(stream);
  const image = records.find((r) => r.fields.ImageURL);
  assert.ok(image);
  assert.equal(image.fields.ImageURL, 'https://example.com/rg?Td=1');
  assert.equal(image.fields.ImageWidth, 20);
  assert.equal(image.fields.ImageHeight, 20);

  const text = textCells(records).find((c) => c.fields.Value === 'after image');
  assert.ok(text);
  assert.equal(text.fields.TextColor, '#000000');
  assert.equal(text.fields.Row, 1);
  assert.equal(text.fields.Col, 1);
});

test('unrecognized commands are ignored without producing records', () => {
  const records = parseSpdl('this is not a command\nfoo bar baz');
  assert.equal(records.length, 0);
});

test('operators embedded mid-command do not dispatch', () => {
  // "MediaBox" only matches as "W H MediaBox", so this junk line is skipped
  // instead of disabling page state.
  const stream = [
    '16 20 MediaBox',
    'bogus MediaBox trailing',
    '/NewPage',
    '(page two) Tj',
  ].join('\n');

  const cell = textCells(parseSpdl(stream))[0];
  assert.equal(cell.fields.Row, 23); // pageTop 1 + height 20 + 2
});
