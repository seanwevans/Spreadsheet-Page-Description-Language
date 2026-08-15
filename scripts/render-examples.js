#!/usr/bin/env node
/**
 * Renders every bundled example to docs/examples/*.svg.
 *
 * These are committed so a change to the semantics shows up in a pull request
 * as a picture of what moved, next to the golden-file diff of what changed.
 * Run `npm run render:examples` after an intentional change.
 */
const fs = require('node:fs');
const path = require('node:path');

const { parseSpdlDocument } = require('../spdl-parser.js');
const { renderSvg } = require('../spdl-svg.js');

const root = path.join(__dirname, '..');
const examplesDir = path.join(root, 'examples');
const outputDir = path.join(root, 'docs', 'examples');

fs.mkdirSync(outputDir, { recursive: true });

for (const file of fs.readdirSync(examplesDir).filter((name) => name.endsWith('.spdl'))) {
  const stream = fs.readFileSync(path.join(examplesDir, file), 'utf8');
  const document = parseSpdlDocument(stream);
  const target = path.join(outputDir, `${path.basename(file, '.spdl')}.svg`);
  fs.writeFileSync(target, `${renderSvg(document)}\n`);
  console.log(`Wrote ${path.relative(root, target)} (${document.records.length} cell ops)`);
}
