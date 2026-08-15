/**
 * Property test: for randomly generated *valid* streams, the Apps Script
 * renderer must land on the same grid as the reference parser.
 *
 * The existing fuzz tests check that nothing throws on garbage. This checks
 * the harder property — that two independent implementations of the grammar
 * agree — over streams no hand-written fixture would think to write.
 */
const test = require('node:test');

const { parseSpdlDocument } = require('../spdl-parser.js');
const { canonicalizeReference, assertConforms, assertRenderersAgree } = require('./helpers/canonical.js');
const { renderWithAppsScript } = require('./helpers/gs-adapter.js');
const officeAdapter = require('./helpers/office-adapter.js');
// The reference's page fills live outside the record list, so both are
// needed to reconstruct the grid the renderers produce.
const documentOf = (stream) => {
  const { records, pages } = parseSpdlDocument(stream);
  return [records, pages];
};


const SEED = Number(process.env.SPDL_CONFORMANCE_SEED || 20260815);
const ITERATIONS = Number(process.env.SPDL_CONFORMANCE_ITERATIONS || 25);

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
const randInt = (min, max) => min + Math.floor(rand() * (max - min + 1));

// Text is kept free of parentheses and backslashes so the generator cannot
// accidentally produce an unbalanced operand — escape handling has its own
// dedicated tests.
const WORDS = ['alpha', 'beta', 'gamma', 'delta 1', 'a b c', 'Ünïcode', '42', 'x,y', 'quote"inside'];
const frac = () => pick(['0', '1', '0.5', '.25', '0.75']);

// Page-relative coordinates that stay inside both the page and the canvas, so
// clamping never enters into it.
const PAGE_WIDTH = 20;
const PAGE_HEIGHT = 24;

const COMMANDS = [
  () => `(${pick(WORDS)}) Tj`,
  () => `(https://example.com/${randInt(1, 99)}) (${pick(WORDS)}) /Link`,
  () => `(${pick(WORDS)}) /Note`,
  () => '/CheckBox',
  () => `(${pick(WORDS).replace(/,/g, '')},${pick(WORDS).replace(/,/g, '')}) /Dropdown`,
  () => `${frac()} ${frac()} ${frac()} rg`,
  () => `${frac()} ${frac()} ${frac()} SC`,
  () => `${randInt(1, 5)} w`,
  () => `/F${randInt(1, 4)} Tf`,
  () => `/F${randInt(1, 4)} ${randInt(6, 40)} Tf`,
  () => `${randInt(1, 40)} Ts`,
  () => `${randInt(0, 1)} Tr`,
  () => `${randInt(0, 8)} TA`,
  () => `/Align ${pick(['HLeft', 'HCenter', 'HRight', 'VTop', 'VMiddle', 'VBottom'])}`,
  () => `/Rotate ${randInt(-90, 90)}`,
  () => `${randInt(-90, 90)} /Rotate`,
  () => `/MoveTo ${randInt(1, PAGE_WIDTH)} ${randInt(1, PAGE_HEIGHT)}`,
  () => `${randInt(-2, 2) * 10} ${randInt(-2, 2) * 10} Td`,
  () => {
    const x = randInt(1, PAGE_WIDTH - 4);
    const y = randInt(0, PAGE_HEIGHT - 5);
    return `${x} ${y} ${randInt(1, 4)} ${randInt(1, 4)} re`;
  },
  () => 'f',
  () => 'S',
  () => `${randInt(1, 4)} ${randInt(1, 4)} ID ${Array.from({ length: 16 }, () => randInt(0, 4)).join('')}`,
  () => `% ${pick(WORDS)}`,
  () => '',
];

function randomStream() {
  const commands = [`${PAGE_WIDTH} ${PAGE_HEIGHT} MediaBox`];
  const length = randInt(10, 40);
  for (let i = 0; i < length; i += 1) {
    // A page break resets the cursor; allow it occasionally, but keep the
    // document short enough to stay well inside the canvas.
    commands.push(rand() < 0.04 ? '/NewPage' : pick(COMMANDS)());
  }
  return commands.filter((command) => command.length > 0);
}

const streams = Array.from({ length: ITERATIONS }, randomStream);

// Random Td deltas can walk the cursor off the sheet. What renderers do at
// the edges has its own dedicated tests; this property is about semantics
// inside the canvas, so out-of-bounds cells are dropped before comparing.
const CANVAS = { rows: 1000, cols: 26 };
function insideCanvas(grid) {
  const bounded = new Map();
  for (const [id, cell] of grid) {
    const [row, col] = id.split(',').map(Number);
    if (row >= 1 && row <= CANVAS.rows && col >= 1 && col <= CANVAS.cols) bounded.set(id, cell);
  }
  return bounded;
}

const referenceOf = (commands) => insideCanvas(canonicalizeReference(...documentOf(commands.join('\n'))));
const skipOffice = officeAdapter.isAvailable()
  ? false
  : 'install the optional `typescript` devDependency to run the Office Scripts harness';

test(`Apps Script matches the reference on generated streams (seed ${SEED})`, () => {
  for (const commands of streams) {
    const reference = referenceOf(commands);
    assertConforms(reference, renderWithAppsScript(commands), `seed ${SEED} stream:\n${commands.join('\n')}`);
  }
});

test(`Office Scripts matches the reference on generated streams (seed ${SEED})`, { skip: skipOffice }, () => {
  for (const commands of streams) {
    const reference = referenceOf(commands);
    assertConforms(reference, officeAdapter.renderWithOfficeScripts(commands), `seed ${SEED} stream:\n${commands.join('\n')}`);
  }
});

test(`the two spreadsheet renderers agree with each other (seed ${SEED})`, { skip: skipOffice }, () => {
  for (const commands of streams) {
    const reference = referenceOf(commands);
    assertRenderersAgree(
      reference,
      renderWithAppsScript(commands),
      officeAdapter.renderWithOfficeScripts(commands),
      `seed ${SEED} stream:\n${commands.join('\n')}`,
    );
  }
});
