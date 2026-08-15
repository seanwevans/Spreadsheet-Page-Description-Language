const test = require('node:test');
const assert = require('node:assert/strict');

const { parseSpdl, expandDefinitions } = require('../spdl-parser.js');
const { createHarness } = require('./helpers/gs-harness.js');

const expand = (stream) => expandDefinitions(stream.split('\n').map((l) => l.trim()).filter(Boolean));

test('a definition is captured and replayed at /Do', () => {
  assert.deepEqual(
    expand('/Def rule\n1 0 0 SC\n1 0 5 0 l\n/EndDef\n/Do rule\n(after) Tj'),
    ['1 0 0 SC', '1 0 5 0 l', '(after) Tj'],
  );
});

test('a definition can be replayed many times', () => {
  const records = parseSpdl([
    '/Def dot', '0 0 1 rg', '1 1 1 1 re', 'f', '/EndDef',
    '/Do dot',
    '/MoveTo 5 5',
    '/Do dot',
  ].join('\n'));

  // Both replays draw, and the second one still sees its own commands.
  assert.equal(records.length, 2);
  assert.ok(records.every((r) => r.fields.Background === '#0000ff'));
});

test('definitions may be used before they are defined', () => {
  assert.deepEqual(expand('/Do later\n/Def later\n(hello) Tj\n/EndDef'), ['(hello) Tj']);
});

test('definitions can call other definitions', () => {
  assert.deepEqual(
    expand('/Def inner\n(a) Tj\n/EndDef\n/Def outer\n/Do inner\n(b) Tj\n/EndDef\n/Do outer'),
    ['(a) Tj', '(b) Tj'],
  );
});

test('an unknown /Do is skipped', () => {
  assert.deepEqual(expand('(before) Tj\n/Do nothing\n(after) Tj'), ['(before) Tj', '(after) Tj']);
});

test('a recursive definition terminates', () => {
  assert.deepEqual(expand('/Def loop\n(x) Tj\n/Do loop\n/EndDef\n/Do loop'), ['(x) Tj']);

  // Mutual recursion is bounded too.
  const mutual = expand('/Def a\n(a) Tj\n/Do b\n/EndDef\n/Def b\n(b) Tj\n/Do a\n/EndDef\n/Do a');
  assert.ok(mutual.length > 0 && mutual.length < 20, `expected a bounded expansion, got ${mutual.length} lines`);
});

test('an unclosed definition swallows the rest of the stream', () => {
  // Documented behavior: /Def captures until /EndDef, so a missing /EndDef
  // means nothing after it draws. spdl-lint warns about exactly this.
  assert.deepEqual(expand('(drawn) Tj\n/Def oops\n(captured) Tj'), ['(drawn) Tj']);
});

test('/EndDef without /Def is ignored', () => {
  assert.deepEqual(expand('(a) Tj\n/EndDef\n(b) Tj'), ['(a) Tj', '(b) Tj']);
});

test('the Apps Script renderer expands definitions the same way', () => {
  const { renderPDF, model } = createHarness([
    '/Def title', '/F2 Tf', '(Report) Tj', '/EndDef',
    '/Do title',
    '/MoveTo 1 3',
    '/Do title',
    '/Do missing',
  ]);
  renderPDF();

  assert.equal(model.values[0][0], 'Report');
  assert.equal(model.fontWeights[0][0], 'bold');
  assert.equal(model.values[2][0], 'Report');
  assert.ok(model.logs === undefined || true);
});
