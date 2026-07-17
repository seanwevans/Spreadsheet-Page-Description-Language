// Fuzz tests: the parser, linter, and Apps Script renderer must never throw,
// whatever the stream contains. Uses a fixed seed so failures are
// reproducible; set SPDL_FUZZ_SEED to explore other seeds locally.
const test = require('node:test');
const assert = require('node:assert/strict');

const { parseSpdl, parseSpdlDocument } = require('../spdl-parser.js');
const { lint } = require('../spdl-lint.js');
const { createHarness } = require('./helpers/gs-harness.js');

const SEED = Number(process.env.SPDL_FUZZ_SEED || 20260717);

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rand = mulberry32(SEED);
const pick = (list) => list[Math.floor(rand() * list.length)];
const randInt = (max) => Math.floor(rand() * max);

const CHARS = 'abcXYZ019 ()\\%/.,-+"\'=*&^$#@!~`{}[]<>?;:|_é世';
function randomString(maxLen) {
  let out = '';
  const len = randInt(maxLen);
  for (let i = 0; i < len; i += 1) out += pick(CHARS);
  return out;
}

const num = () => pick(['0', '1', '15', '-15', '3.5', '-0.5', '9999', '0.0001']);
const TEMPLATES = [
  () => `${num()} ${num()} MediaBox`,
  () => '/NewPage',
  () => `/MoveTo ${num()} ${num()}`,
  () => `${num()} ${num()} Td`,
  () => `(${randomString(20)}) Tj`,
  () => `(${randomString(12)}) (${randomString(12)}) /Link`,
  () => `${num()} ${num()} ${num()} rg`,
  () => `${num()} ${num()} ${num()} SC`,
  () => `${num()} w`,
  () => `${num()} ${num()} ${num()} ${num()} re`,
  () => 'f',
  () => 'S',
  () => `${randInt(6)} ${randInt(6)} ID ${randomString(30).replace(/\s/g, '') || '1'}`,
  () => `/Rotate ${num()}`,
  () => `/Align ${randomString(8).trim() || 'HLeft'}`,
  () => `/F${randInt(5)} ${num()} Tf`,
  () => `${randInt(2)} Tr`,
  () => `${num()} Ts`,
  () => `${randInt(9)} TA`,
  () => `(${randomString(10)}) /Note`,
  () => `(${randomString(15)}) /Dropdown`,
  () => '/CheckBox',
  () => `${num()} ${num()} (${randomString(15)}) /InsertImage`,
  () => `% ${randomString(20)}`,
  () => randomString(40), // pure junk
];

function mutate(command) {
  const kind = randInt(4);
  if (kind === 0) return command.slice(0, randInt(command.length + 1)); // truncate
  if (kind === 1) return `${command} ${command}`; // duplicate
  if (kind === 2) { // splice a random char in
    const i = randInt(command.length + 1);
    return command.slice(0, i) + pick(CHARS) + command.slice(i);
  }
  return command.split(' ').reverse().join(' '); // reverse tokens
}

function randomStream(lines) {
  const out = [];
  for (let i = 0; i < lines; i += 1) {
    let command = pick(TEMPLATES)();
    if (rand() < 0.3) command = mutate(command);
    out.push(command);
  }
  return out;
}

test(`parser and linter never throw (seed ${SEED})`, () => {
  for (let iteration = 0; iteration < 50; iteration += 1) {
    const stream = randomStream(30).join('\n');
    let document;
    assert.doesNotThrow(() => { document = parseSpdlDocument(stream); }, stream);
    assert.ok(Array.isArray(document.records));
    assert.ok(Array.isArray(document.pages));
    assert.doesNotThrow(() => parseSpdl(stream), stream);

    let findings;
    assert.doesNotThrow(() => { findings = lint(stream); }, stream);
    assert.ok(Array.isArray(findings.errors));
    assert.ok(Array.isArray(findings.warnings));
  }
});

test(`records always carry integer Row/Col (seed ${SEED})`, () => {
  for (let iteration = 0; iteration < 20; iteration += 1) {
    const records = parseSpdl(randomStream(30).join('\n'));
    for (const record of records) {
      assert.ok(Number.isInteger(record.fields.Row), JSON.stringify(record));
      assert.ok(Number.isInteger(record.fields.Col), JSON.stringify(record));
    }
  }
});

test(`Apps Script renderer never throws on fuzzed streams (seed ${SEED})`, () => {
  for (let iteration = 0; iteration < 3; iteration += 1) {
    const { renderPDF } = createHarness(randomStream(120));
    assert.doesNotThrow(renderPDF);
  }
});

test('oversized rectangles are skipped instead of exploding the record list', () => {
  const records = parseSpdl('9999 9999 9999 9999 re\nf');
  assert.equal(records.length, 0);
  const { warnings } = lint('9999 9999 9999 9999 re\nf');
  assert.equal(warnings.length, 1);
  assert.match(warnings[0].message, /100000 cells/);
});
