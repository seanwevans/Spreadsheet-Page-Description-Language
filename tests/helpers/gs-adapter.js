// Canonical-grid adapter for the Google Apps Script renderer.
const { createHarness } = require('./gs-harness.js');
const { cellAt, key, mergeExemptions, unpackHyperlink } = require('./canonical.js');

// SpreadsheetApp.BorderStyle -> canonical stroke name.
const BORDER_STYLES = {
  SOLID: 'thin',
  SOLID_MEDIUM: 'medium',
  SOLID_THICK: 'thick',
  DOUBLE: 'double',
};

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
  'checkbox',
  'dropdownOptions',
  'borderColor',
  'borderStyle',
]);

// Border ops cover a whole range; the reference records the perimeter cell by
// cell, so expand each op onto the cells along its edges.
function applyBorders(overlay, borders) {
  for (const border of borders) {
    if (!border.style) continue; // the initial clear passes no style
    for (let r = border.row; r < border.row + border.numRows; r += 1) {
      for (let c = border.col; c < border.col + border.numCols; c += 1) {
        const onPerimeter = r === border.row
          || r === border.row + border.numRows - 1
          || c === border.col
          || c === border.col + border.numCols - 1;
        if (!onPerimeter) continue;
        const cell = cellAt(overlay, r, c);
        cell.borderColor = String(border.color).toLowerCase();
        cell.borderStyle = BORDER_STYLES[border.style] || border.style;
      }
    }
  }
}

function renderWithAppsScript(commands) {
  const harness = createHarness(commands);
  harness.renderPDF();
  const model = harness.model;

  // Deferred ops (borders, checkboxes, validations) are sparse; the styling
  // grids are dense, so those are read lazily on lookup.
  const overlay = new Map();
  applyBorders(overlay, model.borders);
  for (const box of model.checkboxes) {
    cellAt(overlay, box.row, box.col).checkbox = true;
  }
  for (const validation of model.validations) {
    cellAt(overlay, validation.row, validation.col).dropdownOptions = validation.rule.options;
  }

  const grid = {
    get(id) {
      const [row, col] = id.split(',').map(Number);
      const r = row - 1;
      const c = col - 1;
      if (r < 0 || c < 0 || r >= model.values.length || c >= model.values[0].length) return undefined;

      const cell = {
        textColor: String(model.fontColors[r][c]).toLowerCase(),
        fontSize: model.fontSizes[r][c],
        bold: model.fontWeights[r][c] === 'bold',
        italic: model.fontStyles[r][c] === 'italic',
        underline: model.fontLines[r][c] === 'underline',
        rotation: model.rotations[r][c],
        hAlign: model.hAligns[r][c],
        vAlign: model.vAligns[r][c],
        background: String(model.backgrounds[r][c]).toLowerCase(),
        ...(overlay.get(id) || {}),
      };

      const value = model.values[r][c];
      const hyperlink = unpackHyperlink(value);
      if (hyperlink) {
        cell.value = hyperlink.value;
        cell.link = hyperlink.link;
      } else {
        cell.value = value;
      }
      if (model.notes[r][c]) cell.note = model.notes[r][c];
      return cell;
    },
  };

  return {
    name: 'Apps Script',
    grid,
    capabilities: CAPABILITIES,
    exemptions: mergeExemptions(model.merges),
    model,
    logs: harness.logs,
    key,
  };
}

module.exports = { renderWithAppsScript, BORDER_STYLES };
