/**
 * The grammar is hand-copied into four renderers. VBA and AppleScript cannot
 * be executed here, so this is the check that keeps their regex tables from
 * drifting: every renderer must agree, command by command, on what matches.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { loadPatternTables, NAME_BY_KEY } = require('./helpers/pattern-sources.js');
const { fixtures, commandsOf } = require('./conformance/fixtures.js');

const tables = loadPatternTables();
const sources = Object.keys(tables);
const patternNames = Object.values(NAME_BY_KEY);

// Commands are trimmed by every renderer before dispatch, so the corpus is
// trimmed too — trailing-whitespace tolerance in a pattern is not drift.
const corpus = [
  ...fixtures.flatMap(commandsOf),
  ...fs.readdirSync(path.join(__dirname, '..', 'examples'))
    .filter((file) => file.endsWith('.spdl'))
    .flatMap((file) => fs.readFileSync(path.join(__dirname, '..', 'examples', file), 'utf8').split(/\r?\n/)),
  // Adversarial: text that looks like operators, malformed operands, and the
  // boundary cases each number production allows.
  '(1 0 0 rg) Tj',
  '(f) Tj',
  '(S) Tj',
  '() Tj',
  '(unterminated Tj',
  '(nested (parens) here) Tj',
  '(escaped \\(paren\\)) /Note',
  '(a,b) /Dropdown',
  '(https://e.com) (label) /Link',
  '(https://e.com) (a) (b) /Link',
  '0 0 0 rg',
  '.5 .5 .5 rg',
  '1. 0 0 rg',
  '-1 0 0 rg',
  '1 0 0 RG',
  '2 2 4 4 re',
  '-2 -2 4.5 4 re',
  '2 2 4 re',
  '/F2 Tf',
  '/F2 15 Tf',
  '/F2 15.5 Tf',
  '/F2 .5 Tf',
  '/F2 -1 Tf',
  '15 Ts',
  '+15 Ts',
  '-15 Ts',
  '.5 Ts',
  '1 Tr',
  '2 Tr',
  '0 TA',
  '99 TA',
  '-1 TA',
  '/MoveTo 1 1',
  '/MoveTo -1 -1',
  '/MoveTo 1.5 1',
  '10 10 Td',
  '-10 -10 Td',
  '1.5 -2.5 Td',
  '3 w',
  '3.5 w',
  '16 20 MediaBox',
  '0 0 MediaBox',
  '-1 20 MediaBox',
  '2 2 ID 1234',
  '2 2 ID',
  '4 4 (https://e.com/i.png) /InsertImage',
  '/Align HCenter',
  '/Align Sideways',
  '/Rotate 45',
  '45 /Rotate',
  '/NewPage',
  '/CheckBox',
  'f',
  'S',
  '',
  '   ',
  'not a command',
].map((line) => line.trim()).filter((line) => line.length > 0);

test('every renderer declares the same pattern table', () => {
  for (const source of sources) {
    assert.deepEqual(
      Object.keys(tables[source]).sort(),
      patternNames.slice().sort(),
      `${source} is missing or has extra command patterns`,
    );
  }
});

for (const name of patternNames) {
  test(`pattern parity: ${name}`, () => {
    const disagreements = [];
    for (const command of corpus) {
      const verdicts = sources.map((source) => ({
        source,
        matched: tables[source][name].test(command),
      }));
      const distinct = new Set(verdicts.map((v) => v.matched));
      if (distinct.size > 1) {
        const matched = verdicts.filter((v) => v.matched).map((v) => v.source);
        const missed = verdicts.filter((v) => !v.matched).map((v) => v.source);
        disagreements.push(`  "${command}": matched by ${matched.join(', ')} but not by ${missed.join(', ')}`);
      }
    }
    assert.equal(disagreements.length, 0, `${name} does not describe the same language everywhere:\n${disagreements.join('\n')}`);
  });
}

// Where the capture layout is shared, the operands must land in the same
// groups too — a pattern can match the same strings and still extract the
// wrong thing.
const SHARED_CAPTURE_LAYOUT = [
  'TEXT_COMMAND_PATTERN',
  'LINK_COMMAND_PATTERN',
  'INSERT_IMAGE_PATTERN',
  'NOTE_COMMAND_PATTERN',
  'DROPDOWN_COMMAND_PATTERN',
  'MEDIABOX_PATTERN',
  'LINE_WIDTH_PATTERN',
  'PIXEL_ART_PATTERN',
  'ALIGN_COMMAND_PATTERN',
  'FILL_COLOR_PATTERN',
  'STROKE_COLOR_PATTERN',
  'UNDERLINE_PATTERN',
  'FONT_SIZE_PATTERN',
  'ALIGN_CODE_PATTERN',
  'TD_PATTERN',
  'MOVE_TO_PATTERN',
];

for (const name of SHARED_CAPTURE_LAYOUT) {
  test(`capture parity: ${name}`, () => {
    for (const command of corpus) {
      const captures = sources.map((source) => {
        const match = command.match(tables[source][name]);
        return match ? JSON.stringify(match.slice(1)) : null;
      });
      const distinct = new Set(captures);
      assert.equal(distinct.size, 1, `${name} extracts different operands from "${command}": ${sources.map((s, i) => `${s}=${captures[i]}`).join(' | ')}`);
    }
  });
}
