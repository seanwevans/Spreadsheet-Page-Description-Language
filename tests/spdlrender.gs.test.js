// Executes the Google Apps Script renderer in Node against a mocked
// SpreadsheetApp, so its rendering behavior and API-call budget are testable
// without a Google account.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const GS_SOURCE = fs.readFileSync(path.join(__dirname, '..', 'spdlrender.gs'), 'utf8');
const MAX_ROWS = 1000;
const MAX_COLS = 26;

function makeGrid(fill) {
  return Array.from({ length: MAX_ROWS }, () => new Array(MAX_COLS).fill(fill));
}

function createHarness(commands) {
  const model = {
    values: makeGrid(''),
    backgrounds: makeGrid(null),
    fontColors: makeGrid(null),
    fontWeights: makeGrid(null),
    fontStyles: makeGrid(null),
    fontLines: makeGrid(null),
    fontSizes: makeGrid(null),
    rotations: makeGrid(null),
    hAligns: makeGrid(null),
    vAligns: makeGrid(null),
    notes: makeGrid(null),
    borders: [],
    merges: [],
    checkboxes: [],
    validations: [],
    images: [],
    apiCalls: 0,
    bulkCalls: {},
  };

  const countCall = (name) => {
    model.apiCalls += 1;
    model.bulkCalls[name] = (model.bulkCalls[name] || 0) + 1;
  };

  class FakeRange {
    constructor(sheet, row, col, numRows = 1, numCols = 1) {
      this.sheet = sheet;
      this.row = row;
      this.col = col;
      this.numRows = numRows;
      this.numCols = numCols;
    }

    _applyGrid(gridName, data, methodName) {
      countCall(methodName);
      assert.equal(data.length, this.numRows, `${methodName}: row count must match range`);
      assert.equal(data[0].length, this.numCols, `${methodName}: column count must match range`);
      for (let r = 0; r < this.numRows; r++) {
        for (let c = 0; c < this.numCols; c++) {
          model[gridName][this.row - 1 + r][this.col - 1 + c] = data[r][c];
        }
      }
      return this;
    }

    setValues(v) { return this._applyGrid('values', v, 'setValues'); }
    setBackgrounds(v) { return this._applyGrid('backgrounds', v, 'setBackgrounds'); }
    setFontColors(v) { return this._applyGrid('fontColors', v, 'setFontColors'); }
    setFontWeights(v) { return this._applyGrid('fontWeights', v, 'setFontWeights'); }
    setFontStyles(v) { return this._applyGrid('fontStyles', v, 'setFontStyles'); }
    setFontLines(v) { return this._applyGrid('fontLines', v, 'setFontLines'); }
    setFontSizes(v) { return this._applyGrid('fontSizes', v, 'setFontSizes'); }
    setTextRotations(v) { return this._applyGrid('rotations', v, 'setTextRotations'); }
    setHorizontalAlignments(v) { return this._applyGrid('hAligns', v, 'setHorizontalAlignments'); }
    setVerticalAlignments(v) { return this._applyGrid('vAligns', v, 'setVerticalAlignments'); }
    setNotes(v) { return this._applyGrid('notes', v, 'setNotes'); }

    clear() { countCall('clear'); return this; }
    clearContent() { countCall('clearContent'); return this; }
    clearDataValidations() { countCall('clearDataValidations'); return this; }
    setBorder(top, left, bottom, right, vertical, horizontal, color, style) {
      countCall('setBorder');
      model.borders.push({ row: this.row, col: this.col, numRows: this.numRows, numCols: this.numCols, color, style });
      return this;
    }
    merge() {
      countCall('merge');
      model.merges.push({ row: this.row, col: this.col, numRows: this.numRows, numCols: this.numCols });
      return this;
    }
    insertCheckboxes() {
      countCall('insertCheckboxes');
      model.checkboxes.push({ row: this.row, col: this.col });
      return this;
    }
    setDataValidation(rule) {
      countCall('setDataValidation');
      model.validations.push({ row: this.row, col: this.col, numCols: this.numCols, rule });
      return this;
    }
    getHorizontalAlignment() { return 'left'; }
    getVerticalAlignment() { return 'top'; }
    getValues() {
      return commands.map((c) => [c]);
    }
  }

  const renderSheet = {
    getRange(row, col, numRows, numCols) {
      return new FakeRange(this, row, col, numRows, numCols);
    },
    setColumnWidths() { countCall('setColumnWidths'); },
    setRowHeights() { countCall('setRowHeights'); },
    getImages() { return []; },
    insertImage(url, col, row) {
      countCall('insertImage');
      const image = { url, col, row, width: null, height: null };
      model.images.push(image);
      const handle = {
        setWidth(w) { image.width = w; return handle; },
        setHeight(h) { image.height = h; return handle; },
      };
      return handle;
    },
  };

  const sourceSheet = {
    getLastRow() { return commands.length + 1; },
    getRange(row, col, numRows) {
      return new FakeRange(this, row, col, numRows, 1);
    },
  };

  const logs = [];
  const context = {
    Logger: { log: (...args) => logs.push(args.join(' ')) },
    SpreadsheetApp: {
      getActiveSpreadsheet() {
        return {
          getSheetByName(name) {
            return name === '01_Hex_Stream' ? sourceSheet : renderSheet;
          },
        };
      },
      BorderStyle: {
        SOLID: 'SOLID',
        SOLID_MEDIUM: 'SOLID_MEDIUM',
        SOLID_THICK: 'SOLID_THICK',
        DOUBLE: 'DOUBLE',
      },
      newDataValidation() {
        const builder = {
          requireValueInList(options) { builder.options = options; return builder; },
          build() { return { options: builder.options }; },
        };
        return builder;
      },
    },
  };

  vm.createContext(context);
  vm.runInContext(GS_SOURCE, context);

  return { renderPDF: () => context.renderPDF(), model, logs };
}

function loadExample(name) {
  return fs.readFileSync(path.join(__dirname, '..', 'examples', name), 'utf8')
    .split(/\r?\n/)
    .filter((l) => l.trim().length > 0);
}

test('renders hello-world.spdl into the expected grid', () => {
  const { renderPDF, model } = createHarness(loadExample('hello-world.spdl'));
  renderPDF();

  // 40 40 Td moves the cursor to (5, 5).
  assert.equal(model.values[4][4], 'Hello World');
  assert.equal(model.fontColors[4][4], '#ff0000');
  assert.equal(model.fontWeights[4][4], 'bold');

  assert.equal(model.values[8][4], 'Welcome to SPDL');
  assert.equal(model.fontColors[8][4], '#000000');

  // 16x20 MediaBox: white page with a border, dark canvas outside it.
  assert.equal(model.backgrounds[0][0], 'white');
  assert.equal(model.backgrounds[19][15], 'white');
  assert.equal(model.backgrounds[20][0], '#505050');
  assert.equal(model.backgrounds[0][16], '#505050');
  assert.ok(model.borders.some((b) => b.row === 1 && b.col === 1 && b.numRows === 20 && b.numCols === 16));

  // /CheckBox lands on the current cursor cell.
  assert.deepEqual(model.checkboxes, [{ row: 9, col: 5 }]);
  assert.equal(model.hAligns[8][4], 'center');
});

test('renders example.spdl with links, forms, and a bounded API budget', () => {
  const { renderPDF, model } = createHarness(loadExample('example.spdl'));
  renderPDF();

  const flat = model.values.flat();
  assert.ok(flat.includes('SPDL Demo'));
  assert.ok(flat.includes('=HYPERLINK("https://example.com", "Click Me")'));
  assert.ok(flat.includes('Alpha'), 'dropdown default value');
  assert.ok(model.merges.some((m) => m.numCols === 6), 'dropdown merges 6 columns');
  assert.ok(model.validations.length === 1);
  assert.ok(model.notes.flat().includes('Rendered by an SPDL renderer'));
  assert.ok(model.backgrounds.flat().includes('#F1C40F'), 'pixel art');
  assert.ok(model.checkboxes.length === 1);

  // Second page starts below the first (20 rows + 2 gap).
  const pageTwoRow = model.values.findIndex((row) => row.includes('Page two'));
  assert.equal(pageTwoRow, 23); // row 24, 0-indexed 23

  // The whole render must stay within a fixed API budget: 11 bulk grid
  // writes + setup + a handful of deferred ops. Before batching this was
  // hundreds of calls.
  assert.ok(model.apiCalls < 40, `expected < 40 API calls, got ${model.apiCalls}`);
  assert.equal(model.bulkCalls.setValues, 1);
  assert.equal(model.bulkCalls.setBackgrounds, 1);
});

test('text styling state applies per cell, not globally', () => {
  const { renderPDF, model } = createHarness([
    '/F2 15 Tf',
    '1 Tr',
    '(bold underlined) Tj',
    '/F1 15 Tf',
    '0 Tr',
    '20 0 Td',
    '(plain) Tj',
  ]);
  renderPDF();

  assert.equal(model.fontWeights[0][0], 'bold');
  assert.equal(model.fontLines[0][0], 'underline');
  assert.equal(model.fontWeights[0][2], 'normal');
  assert.equal(model.fontLines[0][2], 'none');
});

test('one bad command does not abort the render', () => {
  const { renderPDF, model, logs } = createHarness([
    '(before) Tj',
    'complete nonsense !!',
    '10 0 Td',
    '(after) Tj',
  ]);
  renderPDF();

  assert.equal(model.values[0][0], 'before');
  assert.equal(model.values[0][1], 'after');
  assert.ok(logs.some((l) => l.includes('Skipped unrecognized command')));
});
