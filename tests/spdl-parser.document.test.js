const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { parseSpdl, parseSpdlDocument } = require('../spdl-parser.js');

test('parseSpdlDocument reports page regions for MediaBox and /NewPage', () => {
  const stream = fs.readFileSync(path.join(__dirname, '..', 'examples', 'example.spdl'), 'utf8');
  const { pages } = parseSpdlDocument(stream);

  assert.deepEqual(pages, [
    { top: 1, width: 16, height: 20, recordIndex: 0 },
    { top: 23, width: 16, height: 20, recordIndex: 41 },
  ]);
});

test('page regions record how many cell operations preceded them', () => {
  // The second page is drawn after the first page's content, and paints over
  // anything already written in the rows it covers.
  const { records, pages } = parseSpdlDocument('4 3 MediaBox\n(one) Tj\n(two) /Note\n/NewPage\n(three) Tj');

  assert.equal(pages[0].recordIndex, 0);
  assert.equal(pages[1].recordIndex, 2);
  assert.equal(records.length, 3);
});

test('parseSpdlDocument.records matches parseSpdl output', () => {
  const stream = fs.readFileSync(path.join(__dirname, '..', 'examples', 'example.spdl'), 'utf8');
  assert.deepEqual(parseSpdlDocument(stream).records, parseSpdl(stream));
});

test('invalid MediaBox does not create a page', () => {
  const { pages } = parseSpdlDocument('0 5 MediaBox\n(text) Tj');
  assert.deepEqual(pages, []);
});
