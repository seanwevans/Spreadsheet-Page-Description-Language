/**
 * Extracts the command-pattern table from each renderer's source.
 *
 * The four implementations each hand-maintain their own copy of the grammar.
 * Nothing can share code across Apps Script, Office Scripts, VBA and Node, so
 * the next best thing is to read the tables back out and check they still
 * describe the same language.
 */
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..', '..');

// Reference-parser key -> the constant name the other renderers use.
const NAME_BY_KEY = {
  text: 'TEXT_COMMAND_PATTERN',
  link: 'LINK_COMMAND_PATTERN',
  insertImage: 'INSERT_IMAGE_PATTERN',
  note: 'NOTE_COMMAND_PATTERN',
  dropdown: 'DROPDOWN_COMMAND_PATTERN',
  mediaBox: 'MEDIABOX_PATTERN',
  lineWidth: 'LINE_WIDTH_PATTERN',
  rectangle: 'RECTANGLE_COMMAND_PATTERN',
  pixelArt: 'PIXEL_ART_PATTERN',
  align: 'ALIGN_COMMAND_PATTERN',
  fillColor: 'FILL_COLOR_PATTERN',
  strokeColor: 'STROKE_COLOR_PATTERN',
  font: 'FONT_COMMAND_PATTERN',
  underline: 'UNDERLINE_PATTERN',
  fontSize: 'FONT_SIZE_PATTERN',
  alignCode: 'ALIGN_CODE_PATTERN',
  td: 'TD_PATTERN',
  moveTo: 'MOVE_TO_PATTERN',
};

// `const NAME = /pattern/;` in the JS/TS renderers.
function readRegexLiterals(file) {
  const source = fs.readFileSync(path.join(root, file), 'utf8');
  const patterns = {};
  const declaration = /^const\s+([A-Z_]+_PATTERN)\s*=\s*(\/.*\/)\s*;\s*$/gm;
  let match;
  while ((match = declaration.exec(source)) !== null) {
    const body = match[2].slice(1, match[2].lastIndexOf('/'));
    patterns[match[1]] = new RegExp(body);
  }
  return patterns;
}

// `Private Const NAME As String = "pattern"` in the VBA renderer. VBScript's
// regex flavor is close enough to JavaScript's for the constructs used here
// (character classes, non-capturing groups, anchors); `/` needs no escaping
// there, which is the only systematic difference.
function readVbaPatterns() {
  const source = fs.readFileSync(path.join(root, 'spdlrender.vba'), 'utf8');
  const patterns = {};
  const declaration = /^Private Const\s+([A-Z_]+_PATTERN)\s+As String\s*=\s*"(.*)"\s*$/gm;
  let match;
  while ((match = declaration.exec(source)) !== null) {
    patterns[match[1]] = new RegExp(match[2]);
  }
  return patterns;
}

function loadPatternTables() {
  const { patterns: reference } = require(path.join(root, 'spdl-parser.js'));
  const byName = {};
  for (const [key, name] of Object.entries(NAME_BY_KEY)) {
    byName[name] = reference[key];
  }
  return {
    'reference parser': byName,
    'Apps Script': readRegexLiterals('spdlrender.gs'),
    'Office Scripts': readRegexLiterals('spdlrender.office.ts'),
    VBA: readVbaPatterns(),
  };
}

module.exports = { loadPatternTables, NAME_BY_KEY };
