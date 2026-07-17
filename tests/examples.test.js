const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { parseSpdl } = require('../spdlrender.airtable.js');

const examplesDir = path.join(__dirname, '..', 'examples');

test('every example stream parses and produces records', () => {
  const files = fs.readdirSync(examplesDir).filter((f) => f.endsWith('.spdl'));
  assert.ok(files.length >= 3, 'expected example streams to exist');

  for (const file of files) {
    const stream = fs.readFileSync(path.join(examplesDir, file), 'utf8');
    const records = parseSpdl(stream);
    assert.ok(records.length > 0, `${file} should produce at least one record`);
  }
});

test('example.spdl exercises text, links, forms, shapes, and pixel art', () => {
  const stream = fs.readFileSync(path.join(examplesDir, 'example.spdl'), 'utf8');
  const records = parseSpdl(stream);
  const fields = records.map((r) => r.fields);

  assert.ok(fields.some((f) => f.Value === 'SPDL Demo'), 'title text');
  assert.ok(fields.some((f) => f.Link === 'https://example.com'), 'hyperlink');
  assert.ok(fields.some((f) => f.Dropdown === 'Alpha'), 'dropdown');
  assert.ok(fields.some((f) => f.Checkbox === true), 'checkbox');
  assert.ok(fields.some((f) => f.Note === 'Rendered by an SPDL renderer'), 'note');
  assert.ok(fields.some((f) => f.Background === '#0000ff'), 'filled rectangle');
  assert.ok(fields.some((f) => f.Background === '#F1C40F'), 'pixel art');
  assert.ok(fields.some((f) => f.Value === 'Page two' && f.Row > 20), 'second page content');
});
