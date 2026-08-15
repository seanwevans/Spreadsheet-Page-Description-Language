/**
 * Runs the Office Scripts renderer (`spdlrender.office.ts`) in Node against a
 * mocked ExcelScript API, the way tests/helpers/gs-harness.js does for Apps
 * Script.
 *
 * Office Scripts are TypeScript, so the source is type-stripped before it is
 * evaluated: Node's own `module.stripTypeScriptTypes` when the runtime has it
 * (22.13+), otherwise the optional `typescript` devDependency. `isAvailable()`
 * reports whether either route works, and the conformance tests skip
 * themselves (loudly) when neither does, so `npm test` still works in a bare
 * checkout on an older Node.
 */
const fs = require('node:fs');
const nodeModule = require('node:module');
const path = require('node:path');
const vm = require('node:vm');

const SOURCE_PATH = path.join(__dirname, '..', '..', 'spdlrender.office.ts');
const MAX_ROWS = 1000;
const MAX_COLS = 26;

function loadTypeScript() {
  try {
    const ts = require('typescript');
    // TypeScript 7 ships a Go-based compiler whose Node API no longer exposes
    // transpileModule; only use the package when the API is actually there.
    return typeof ts.transpileModule === 'function' ? ts : null;
  } catch {
    return null;
  }
}

function isAvailable() {
  return typeof nodeModule.stripTypeScriptTypes === 'function' || loadTypeScript() !== null;
}

function transpile() {
  const source = fs.readFileSync(SOURCE_PATH, 'utf8');
  if (typeof nodeModule.stripTypeScriptTypes === 'function') {
    return nodeModule.stripTypeScriptTypes(source, { mode: 'strip' });
  }
  const ts = loadTypeScript();
  if (!ts) throw new Error('no TypeScript stripper available; see isAvailable()');
  return ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.None },
  }).outputText;
}

// Only the members spdlrender.office.ts actually touches.
const ExcelScript = {
  ClearApplyTo: { all: 'all', contents: 'contents', formats: 'formats' },
  BorderLineStyle: { none: 'none', continuous: 'continuous', double: 'double' },
  BorderIndex: {
    edgeTop: 'edgeTop',
    edgeBottom: 'edgeBottom',
    edgeLeft: 'edgeLeft',
    edgeRight: 'edgeRight',
    insideHorizontal: 'insideHorizontal',
    insideVertical: 'insideVertical',
  },
  BorderWeight: { hairline: 'hairline', thin: 'thin', medium: 'medium', thick: 'thick' },
  HorizontalAlignment: { left: 'left', center: 'center', right: 'right' },
  VerticalAlignment: { top: 'top', center: 'center', bottom: 'bottom' },
  RangeUnderlineStyle: { none: 'none', single: 'single' },
  ShapeType: { image: 'image', geometricShape: 'geometricShape' },
};

function createWorkbook(commands) {
  const model = {
    cells: new Map(),
    borders: new Map(),
    merges: [],
    validations: [],
    comments: [],
    logs: [],
  };

  const cell = (row, col) => {
    const id = `${row},${col}`;
    if (!model.cells.has(id)) model.cells.set(id, {});
    return model.cells.get(id);
  };

  class FakeRange {
    constructor(row, col, numRows, numCols) {
      this.row = row;
      this.col = col;
      this.numRows = numRows;
      this.numCols = numCols;
    }

    get id() {
      return `${this.row},${this.col},${this.numRows},${this.numCols}`;
    }

    forEachCell(fn) {
      for (let r = this.row; r < this.row + this.numRows; r += 1) {
        for (let c = this.col; c < this.col + this.numCols; c += 1) {
          fn(cell(r, c), r, c);
        }
      }
    }

    setValue(value) { this.forEachCell((target) => { target.value = value; }); }
    setFormula(formula) { this.forEachCell((target) => { target.value = formula; }); }
    getValues() {
      const rows = [];
      for (let r = this.row; r < this.row + this.numRows; r += 1) {
        const cells = [];
        for (let c = this.col; c < this.col + this.numCols; c += 1) {
          cells.push(cell(r, c).value === undefined ? '' : cell(r, c).value);
        }
        rows.push(cells);
      }
      return rows;
    }

    getRowCount() { return this.numRows; }

    clear(applyTo) {
      this.forEachCell((target) => {
        if (applyTo === ExcelScript.ClearApplyTo.contents) delete target.value;
        else if (applyTo === ExcelScript.ClearApplyTo.formats) {
          for (const property of Object.keys(target)) {
            if (property !== 'value') delete target[property];
          }
        }
      });
    }

    merge() { model.merges.push({ row: this.row, col: this.col, numCols: this.numCols }); }

    addComment(text) {
      model.comments.push({ row: this.row, col: this.col, text });
      this.forEachCell((target) => { target.note = text; });
    }

    getDataValidation() {
      const range = this;
      return {
        setList(options) {
          model.validations.push({ row: range.row, col: range.col, options: options.slice() });
        },
      };
    }

    getFormat() {
      const range = this;
      const borderRecord = (index) => {
        // Re-insert so the most recently touched edge sorts last: border ops
        // are replayed in order when the grid is canonicalized.
        const id = `${range.id}|${index}`;
        const existing = model.borders.get(id)
          || { row: range.row, col: range.col, numRows: range.numRows, numCols: range.numCols, index };
        model.borders.delete(id);
        model.borders.set(id, existing);
        return existing;
      };

      return {
        getFill: () => ({
          setColor(color) { range.forEachCell((target) => { target.background = color; }); },
        }),
        getFont: () => ({
          setColor(color) { range.forEachCell((target) => { target.textColor = color; }); },
          setSize(size) { range.forEachCell((target) => { target.fontSize = size; }); },
          setBold(bold) { range.forEachCell((target) => { target.bold = bold; }); },
          setItalic(italic) { range.forEachCell((target) => { target.italic = italic; }); },
          setUnderline(style) { range.forEachCell((target) => { target.underline = style; }); },
        }),
        setTextOrientation(deg) { range.forEachCell((target) => { target.rotation = deg; }); },
        setHorizontalAlignment(a) { range.forEachCell((target) => { target.hAlign = a; }); },
        setVerticalAlignment(a) { range.forEachCell((target) => { target.vAlign = a; }); },
        setColumnWidth() {},
        setRowHeight() {},
        getBorders() {
          const items = Object.values(ExcelScript.BorderIndex).map((index) => ({
            setStyle(style) { borderRecord(index).style = style; },
            setWeight(weight) { borderRecord(index).weight = weight; },
            setColor(color) { borderRecord(index).color = color; },
          }));
          items.getItem = (index) => {
            const position = Object.values(ExcelScript.BorderIndex).indexOf(index);
            return items[position];
          };
          return items;
        },
      };
    }
  }

  const renderSheet = {
    getRangeByIndexes(rowIndex, colIndex, rows, cols) {
      return new FakeRange(rowIndex + 1, colIndex + 1, rows, cols);
    },
    getShapes: () => [],
    getUsedRange: () => new FakeRange(1, 1, MAX_ROWS, MAX_COLS),
  };

  const sourceSheet = {
    getUsedRange: () => new FakeRange(1, 1, commands.length + 1, 1),
    getRangeByIndexes(rowIndex, colIndex, rows, cols) {
      const range = new FakeRange(rowIndex + 1, colIndex + 1, rows, cols);
      range.getValues = () => commands.map((command) => [command]);
      return range;
    },
  };

  const workbook = {
    getWorksheet(name) {
      return name === '01_Hex_Stream' ? sourceSheet : renderSheet;
    },
  };

  return { workbook, model };
}

function runOfficeRenderer(commands) {
  const { workbook, model } = createWorkbook(commands);
  const context = {
    ExcelScript,
    console: { log: (...args) => model.logs.push(args.join(' ')) },
  };
  vm.createContext(context);
  vm.runInContext(transpile(), context);
  context.main(workbook);
  return { model, logs: model.logs };
}

module.exports = { isAvailable, runOfficeRenderer, ExcelScript, MAX_ROWS, MAX_COLS };
