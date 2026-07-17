const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { parseSpdl, parseSpdlDocument } = require('../spdl-parser.js');

test('parseSpdlDocument reports page regions for MediaBox and /NewPage', () => {
  const stream = fs.readFileSync(path.join(__dirname, '..', 'examples', 'example.spdl'), 'utf8');
  const { pages } = parseSpdlDocument(stream);

  assert.deepEqual(pages, [
    { top: 1, width: 16, height: 20 },
    { top: 23, width: 16, height: 20 },
  ]);
});

test('parseSpdlDocument.records matches parseSpdl output', () => {
  const stream = fs.readFileSync(path.join(__dirname, '..', 'examples', 'example.spdl'), 'utf8');
  assert.deepEqual(parseSpdlDocument(stream).records, parseSpdl(stream));
});

test('invalid MediaBox does not create a page', () => {
  const { pages } = parseSpdlDocument('0 5 MediaBox\n(text) Tj');
  assert.deepEqual(pages, []);
});
