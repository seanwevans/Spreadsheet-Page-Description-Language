/**
 * A platform-neutral view of a rendered sheet, so renderers written against
 * completely different APIs can be compared to the reference parser.
 *
 * Every adapter turns its renderer's output into the same shape:
 *
 *   Map<"row,col", {
 *     value, link, textColor, fontSize, bold, italic, underline,
 *     rotation, hAlign, vAlign, background, note, checkbox,
 *     dropdownOptions, borderColor, borderStyle
 *   }>
 *
 * plus a `capabilities` set naming the properties that platform can express.
 * Comparisons are one-directional — every property the reference sets must
 * appear in the renderer's grid — so a renderer may do *more* (Sheets centers
 * checkboxes horizontally; Airtable cannot) without failing conformance, but
 * it may never contradict the reference.
 */

const assert = require('node:assert/strict');

const ALL_PROPERTIES = [
  'value',
  'link',
  'textColor',
  'fontSize',
  'bold',
  'italic',
  'underline',
  'rotation',
  'hAlign',
  'vAlign',
  'background',
  'note',
  'checkbox',
  'dropdownOptions',
  'borderColor',
  'borderStyle',
];

const key = (row, col) => `${row},${col}`;

function cellAt(grid, row, col) {
  const id = key(row, col);
  if (!grid.has(id)) grid.set(id, {});
  return grid.get(id);
}

// Canonical stroke names, shared by every adapter's style mapping.
const STROKE_NAMES = ['thin', 'medium', 'thick', 'double'];

// "HCenter" -> { hAlign: 'center' }, "VMiddle" -> { vAlign: 'middle' }.
function alignmentToProperties(directive) {
  switch (directive) {
    case 'HLeft': return { hAlign: 'left' };
    case 'HCenter': return { hAlign: 'center' };
    case 'HRight': return { hAlign: 'right' };
    case 'VTop': return { vAlign: 'top' };
    case 'VMiddle': return { vAlign: 'middle' };
    case 'VBottom': return { vAlign: 'bottom' };
    default: return {};
  }
}

// Renderers that build a =HYPERLINK() formula store the link in the cell
// value; unpack it so it can be compared with the reference's Link field.
const HYPERLINK_FORMULA = /^=HYPERLINK\("((?:[^"]|"")*)",\s*"((?:[^"]|"")*)"\)$/;

function unpackHyperlink(value) {
  if (typeof value !== 'string') return null;
  const match = value.match(HYPERLINK_FORMULA);
  if (!match) return null;
  const undouble = (s) => s.replace(/""/g, '"');
  return { link: undouble(match[1]), value: undouble(match[2]) };
}

/**
 * Folds the reference parser's ordered operation list into a grid, applying
 * last-write-wins per property the way a renderer's own grids do.
 */
function canonicalizeReference(records, pages) {
  const grid = new Map();
  const pageDraws = (pages || []).slice().sort((a, b) => a.recordIndex - b.recordIndex);
  let nextPage = 0;

  // The reference's record list has no page chrome — pages live in a separate
  // array — so the page fill is replayed here at the point in the stream
  // where it happened. Its border is not modeled at all, so page perimeters
  // are left unspecified rather than asserted.
  const drawPagesUpTo = (recordIndex) => {
    while (nextPage < pageDraws.length && pageDraws[nextPage].recordIndex <= recordIndex) {
      const page = pageDraws[nextPage];
      nextPage += 1;
      for (let r = page.top; r < page.top + page.height; r += 1) {
        for (let c = 1; c <= page.width; c += 1) {
          const cell = cellAt(grid, r, c);
          cell.background = '#ffffff';
          delete cell.borderColor;
          delete cell.borderStyle;
        }
      }
    }
  };

  for (const [index, record] of records.entries()) {
    drawPagesUpTo(index);
    const f = record.fields;
    const cell = cellAt(grid, f.Row, f.Col);

    if (f.Value !== undefined && f.Link === undefined) {
      cell.value = f.Value;
      // Writing text over a link replaces the whole cell, formula included.
      delete cell.link;
    }
    if (f.Link !== undefined) {
      cell.link = f.Link;
      cell.value = f.Value;
      // The reference has no rotation field for links, so a link leaves the
      // cell's rotation unspecified rather than inheriting whatever an
      // earlier write to the same cell asserted.
      delete cell.rotation;
    }
    if (f.TextColor !== undefined) cell.textColor = f.TextColor.toLowerCase();
    if (f.FontSize !== undefined) cell.fontSize = f.FontSize;
    if (f.Bold !== undefined) cell.bold = f.Bold;
    if (f.Italic !== undefined) cell.italic = f.Italic;
    if (f.Underline !== undefined) cell.underline = f.Underline;
    if (f.Rotation !== undefined) cell.rotation = f.Rotation;
    if (f.Background !== undefined) cell.background = f.Background.toLowerCase();
    if (f.BorderColor !== undefined) cell.borderColor = f.BorderColor.toLowerCase();
    if (f.BorderStyle !== undefined) cell.borderStyle = f.BorderStyle;
    if (f.Checkbox !== undefined) {
      cell.checkbox = f.Checkbox;
      // A checkbox takes the cell over: a control in Sheets, a glyph
      // elsewhere. Either way whatever was written there before is gone.
      delete cell.value;
      delete cell.link;
    }
    if (f.Alignment !== undefined) {
      // Renderers set both axes on every write; the reference's Alignment is
      // a single value (an Airtable single select), so it can name at most
      // one of them. Anything it does not name is unspecified rather than
      // inherited — including "" for the sheet's own defaults, which the
      // reference has no vocabulary for.
      delete cell.hAlign;
      delete cell.vAlign;
      Object.assign(cell, alignmentToProperties(f.Alignment));
    }

    if (f.Dropdown !== undefined) {
      // The reference packs the option list into Note because Airtable has no
      // data-validation API; that is metadata, not a cell comment.
      cell.dropdownOptions = f.Note && f.Note.startsWith('Options: ')
        ? f.Note.slice('Options: '.length).split(', ')
        : [f.Dropdown];
      cell.value = f.Dropdown;
      delete cell.link;
    } else if (f.Note !== undefined) {
      cell.note = f.Note;
    }
  }

  drawPagesUpTo(records.length);
  return grid;
}

/**
 * Asserts that every property the reference sets is matched by the renderer,
 * for the properties that renderer can express.
 */
function assertConforms(referenceGrid, actual, context) {
  const { grid, capabilities, name } = actual;
  const exemptions = actual.exemptions || new Map();
  const mismatches = [];

  for (const [id, expectedCell] of referenceGrid) {
    const actualCell = grid.get(id) || {};
    const exempt = exemptions.get(id);
    for (const property of ALL_PROPERTIES) {
      if (expectedCell[property] === undefined) continue;
      if (!capabilities.has(property)) continue;
      // A documented platform limitation, e.g. a placeholder checkbox glyph
      // occupying a cell that also holds text (see SPEC.md).
      if (exempt && exempt.has(property)) continue;

      const expected = normalizeForComparison(property, expectedCell[property]);
      const found = normalizeForComparison(property, actualCell[property]);
      const equal = Array.isArray(expected)
        ? JSON.stringify(expected) === JSON.stringify(found)
        : expected === found;
      if (!equal) {
        mismatches.push(
          `  cell ${id} ${property}: reference ${JSON.stringify(expected)}, ${name} ${JSON.stringify(found)}`,
        );
      }
    }
  }

  assert.equal(
    mismatches.length,
    0,
    `${name} diverges from the reference parser${context ? ` for ${context}` : ''}:\n${mismatches.join('\n')}`,
  );
}

/**
 * Only a merged range's anchor cell is observable. Continuation cells show
 * the anchor's value and formatting no matter what the API left in them, so
 * renderers legitimately differ there — Sheets formats the anchor, Excel the
 * whole range — and nothing about those cells can be asserted.
 */
function mergeExemptions(merges) {
  const exemptions = new Map();
  for (const merge of merges) {
    const numRows = merge.numRows || 1;
    const numCols = merge.numCols || 1;
    for (let r = merge.row; r < merge.row + numRows; r += 1) {
      for (let c = merge.col; c < merge.col + numCols; c += 1) {
        if (r === merge.row && c === merge.col) continue;
        exemptions.set(key(r, c), new Set(ALL_PROPERTIES));
      }
    }
  }
  return exemptions;
}

// Platforms spell a couple of colors as names rather than hex.
const COLOR_NAMES = { black: '#000000', white: '#ffffff' };

function normalizeForComparison(property, value) {
  if (value === '') return undefined;
  if (typeof value === 'string' && (property === 'textColor' || property === 'background' || property === 'borderColor')) {
    return COLOR_NAMES[value.toLowerCase()] || value.toLowerCase();
  }
  return value;
}

/**
 * Asserts two renderers agree with each other on the cells the reference
 * touched — including properties the reference itself cannot express, which
 * is where renderers drift apart unnoticed (Airtable has no rotation field,
 * so nothing else was checking that links rotate the same way everywhere).
 *
 * A property is compared only where both renderers set it: an untouched cell
 * is not evidence of disagreement.
 */
function assertRenderersAgree(referenceGrid, left, right, context) {
  const shared = [...left.capabilities].filter((property) => right.capabilities.has(property));
  const mismatches = [];

  const exemptions = [left.exemptions, right.exemptions];
  for (const id of referenceGrid.keys()) {
    const leftCell = left.grid.get(id) || {};
    const rightCell = right.grid.get(id) || {};
    const exempt = exemptions.some((map) => map && map.get(id));
    for (const property of shared) {
      if (exempt && exemptions.some((map) => map && map.get(id) && map.get(id).has(property))) continue;
      const a = normalizeForComparison(property, leftCell[property]);
      const b = normalizeForComparison(property, rightCell[property]);
      if (a === undefined || b === undefined) continue;
      const equal = Array.isArray(a) ? JSON.stringify(a) === JSON.stringify(b) : a === b;
      if (!equal) {
        mismatches.push(`  cell ${id} ${property}: ${left.name} ${JSON.stringify(a)}, ${right.name} ${JSON.stringify(b)}`);
      }
    }
  }

  assert.equal(
    mismatches.length,
    0,
    `${left.name} and ${right.name} disagree${context ? ` for ${context}` : ''}:\n${mismatches.join('\n')}`,
  );
}

module.exports = {
  ALL_PROPERTIES,
  assertRenderersAgree,
  normalizeForComparison,
  STROKE_NAMES,
  alignmentToProperties,
  assertConforms,
  canonicalizeReference,
  cellAt,
  mergeExemptions,
  key,
  unpackHyperlink,
};
