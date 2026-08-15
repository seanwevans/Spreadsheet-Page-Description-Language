// Canonical-grid adapter for the Office Scripts renderer.
const { runOfficeRenderer, isAvailable } = require('./office-harness.js');
const { cellAt, key, mergeExemptions, unpackHyperlink } = require('./canonical.js');

// Office Scripts has no checkbox control and cannot fetch external images, so
// it renders a ballot-box glyph and logs images instead.
const CHECKBOX_GLYPH = '☐';

const CAPABILITIES = new Set([
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
  // No 'checkbox': Excel for the web has no checkbox control, so /CheckBox
  // only leaves a glyph in the cell — a placeholder that any later write to
  // the same cell erases. tests/office-renderer.test.js checks the glyph
  // lands where it should instead.
  'dropdownOptions',
  'borderColor',
  'borderStyle',
]);

const EDGES = {
  edgeTop: (r, c, b) => r === b.row,
  edgeBottom: (r, c, b) => r === b.row + b.numRows - 1,
  edgeLeft: (r, c, b) => c === b.col,
  edgeRight: (r, c, b) => c === b.col + b.numCols - 1,
};

// A double line style wins over the weight; otherwise the weight names the
// canonical stroke (see mapLineWidth/mapLineWeight in the renderer).
function canonicalStroke(border) {
  if (border.style === 'double') return 'double';
  return border.weight;
}

function applyBorders(overlay, borders) {
  for (const border of borders.values()) {
    if (!border.style || border.style === 'none') continue;
    const isOnEdge = EDGES[border.index];
    if (!isOnEdge) continue; // inside gridlines have no reference equivalent
    for (let r = border.row; r < border.row + border.numRows; r += 1) {
      for (let c = border.col; c < border.col + border.numCols; c += 1) {
        if (!isOnEdge(r, c, border)) continue;
        const cell = cellAt(overlay, r, c);
        cell.borderColor = String(border.color).toLowerCase();
        cell.borderStyle = canonicalStroke(border);
      }
    }
  }
}

function renderWithOfficeScripts(commands) {
  const { model, logs } = runOfficeRenderer(commands);

  // Excel for the web has no checkbox control, so /CheckBox writes a ballot
  // glyph *into* the cell — which replaces any text already there. That is a
  // documented platform limitation (SPEC.md), not a conformance failure, so
  // the cell's value is exempted from comparison.
  const exemptions = mergeExemptions(model.merges);
  for (const [id, cell] of model.cells) {
    if (cell.value === CHECKBOX_GLYPH) {
      const existing = exemptions.get(id) || new Set();
      existing.add('value');
      exemptions.set(id, existing);
    }
  }

  const overlay = new Map();
  applyBorders(overlay, model.borders);
  for (const validation of model.validations) {
    cellAt(overlay, validation.row, validation.col).dropdownOptions = validation.options;
  }

  const grid = {
    get(id) {
      const raw = model.cells.get(id) || {};
      const cell = {
        textColor: raw.textColor === undefined ? undefined : String(raw.textColor).toLowerCase(),
        fontSize: raw.fontSize,
        bold: raw.bold,
        italic: raw.italic,
        underline: raw.underline === undefined ? undefined : raw.underline === 'single',
        rotation: raw.rotation,
        hAlign: raw.hAlign,
        // Excel names the middle vertical alignment "center"; SPDL calls it
        // VMiddle, and the canonical grid follows SPDL.
        vAlign: raw.vAlign === 'center' ? 'middle' : raw.vAlign,
        background: raw.background === undefined ? undefined : String(raw.background).toLowerCase(),
        note: raw.note,
        ...(overlay.get(id) || {}),
      };

      const hyperlink = unpackHyperlink(raw.value);
      if (hyperlink) {
        cell.value = hyperlink.value;
        cell.link = hyperlink.link;
      } else if (raw.value === CHECKBOX_GLYPH) {
        cell.checkbox = true;
      } else {
        cell.value = raw.value;
      }
      return cell;
    },
  };

  return { name: 'Office Scripts', grid, capabilities: CAPABILITIES, exemptions, model, logs, key };
}

module.exports = { renderWithOfficeScripts, isAvailable, CHECKBOX_GLYPH };
