#!/usr/bin/env node
// Regenerates the golden files in tests/golden/ from examples/*.spdl using
// the reference parser. Run after an intentional semantics change and commit
// the diff — golden changes should always be visible in review.
const fs = require("fs");
const path = require("path");

const { parseSpdl } = require("../spdl-parser.js");

const examplesDir = path.join(__dirname, "..", "examples");
const goldenDir = path.join(__dirname, "..", "tests", "golden");

fs.mkdirSync(goldenDir, { recursive: true });

for (const file of fs.readdirSync(examplesDir).filter((f) => f.endsWith(".spdl"))) {
  const stream = fs.readFileSync(path.join(examplesDir, file), "utf8");
  const records = parseSpdl(stream);
  const target = path.join(goldenDir, `${path.basename(file, ".spdl")}.json`);
  fs.writeFileSync(target, `${JSON.stringify(records, null, 2)}\n`);
  console.log(`Wrote ${path.relative(process.cwd(), target)} (${records.length} records)`);
}
