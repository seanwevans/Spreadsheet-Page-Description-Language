const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { parseSpdl } = require('../spdl-parser.js');

const examplesDir = path.join(__dirname, '..', 'examples');
const goldenDir = path.join(__dirname, 'golden');

// Every example stream must parse to exactly the committed golden output.
// If a semantics change is intentional, run `npm run golden:update` and
// commit the resulting diff.
for (const file of fs.readdirSync(examplesDir).filter((f) => f.endsWith('.spdl'))) {
  const goldenPath = path.join(goldenDir, `${path.basename(file, '.spdl')}.json`);

  test(`golden: ${file} matches ${path.basename(goldenPath)}`, () => {
    assert.ok(fs.existsSync(goldenPath), `missing golden file — run npm run golden:update`);
    const stream = fs.readFileSync(path.join(examplesDir, file), 'utf8');
    const expected = JSON.parse(fs.readFileSync(goldenPath, 'utf8'));
    assert.deepEqual(parseSpdl(stream), expected);
  });
}
