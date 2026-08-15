// Shared harness that executes the Google Apps Script renderer in Node
// against a mocked SpreadsheetApp.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const GS_SOURCE = fs.readFileSync(path.join(__dirname, '..', '..', 'spdlrender.gs'), 'utf8');
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
    columnWidths: [],
    rowHeights: [],
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
    setColumnWidth(column, width) {
      countCall('setColumnWidth');
      model.columnWidths.push({ column, width });
    },
    setRowHeight(row, height) {
      countCall('setRowHeight');
      model.rowHeights.push({ row, height });
    },
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
  return fs.readFileSync(path.join(__dirname, '..', '..', 'examples', name), 'utf8')
    .split(/\r?\n/)
    .filter((l) => l.trim().length > 0);
}


module.exports = { createHarness, loadExample };
