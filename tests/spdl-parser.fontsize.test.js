const test = require('node:test');
const assert = require('node:assert/strict');

const { parseSpdl, DEFAULT_FONT_SIZE } = require('../spdl-parser.js');

const firstText = (stream) => parseSpdl(stream)[0].fields;

test('text records carry the active font size', () => {
  assert.equal(firstText('(default) Tj').FontSize, DEFAULT_FONT_SIZE);
  assert.equal(firstText('30 Ts\n(big) Tj').FontSize, 30);
  assert.equal(firstText('12.5 Ts\n(fractional) Tj').FontSize, 12.5);
});

test('links carry the active font size too', () => {
  const fields = firstText('20 Ts\n(https://example.com) (Click) /Link');
  assert.equal(fields.FontSize, 20);
  assert.equal(fields.Link, 'https://example.com');
});

test('the Tf size operand sets the font size', () => {
  assert.equal(firstText('/F2 24 Tf\n(bold big) Tj').FontSize, 24);
  assert.equal(firstText('/F1 .5 Tf\n(tiny) Tj').FontSize, 0.5);
  assert.equal(firstText('/F2 18.5 Tf\n(fractional) Tj').FontSize, 18.5);
});

test('Tf without a size operand leaves the size alone', () => {
  assert.equal(firstText('30 Ts\n/F2 Tf\n(kept) Tj').FontSize, 30);
});

test('a non-positive size resets to the default', () => {
  assert.equal(firstText('30 Ts\n0 Ts\n(reset) Tj').FontSize, DEFAULT_FONT_SIZE);
  assert.equal(firstText('30 Ts\n/F2 0 Tf\n(reset) Tj').FontSize, DEFAULT_FONT_SIZE);
});
