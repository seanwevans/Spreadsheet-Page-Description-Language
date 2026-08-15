/**
 * Minimal ambient declarations for the Office Scripts runtime.
 *
 * Office Scripts run inside Excel for the web, where the ExcelScript namespace
 * is provided by the host; there is no npm package for it. These declarations
 * cover exactly the surface `spdlrender.office.ts` uses, which is enough to
 * type-check the renderer in CI and to document the API contract the test
 * harness has to mock.
 *
 * Extend this file when the renderer starts using a new Excel API.
 */
declare namespace ExcelScript {
  const enum ClearApplyTo {
    all = 'All',
    contents = 'Contents',
    formats = 'Formats',
  }

  const enum BorderLineStyle {
    none = 'None',
    continuous = 'Continuous',
    dash = 'Dash',
    double = 'Double',
  }

  const enum BorderIndex {
    edgeTop = 'EdgeTop',
    edgeBottom = 'EdgeBottom',
    edgeLeft = 'EdgeLeft',
    edgeRight = 'EdgeRight',
    insideHorizontal = 'InsideHorizontal',
    insideVertical = 'InsideVertical',
  }

  const enum BorderWeight {
    hairline = 'Hairline',
    thin = 'Thin',
    medium = 'Medium',
    thick = 'Thick',
  }

  const enum HorizontalAlignment {
    left = 'Left',
    center = 'Center',
    right = 'Right',
  }

  const enum VerticalAlignment {
    top = 'Top',
    center = 'Center',
    bottom = 'Bottom',
  }

  const enum RangeUnderlineStyle {
    none = 'None',
    single = 'Single',
    double = 'Double',
  }

  const enum ShapeType {
    image = 'Image',
    geometricShape = 'GeometricShape',
    line = 'Line',
  }

  interface RangeBorder {
    setStyle(style: BorderLineStyle): void;
    setWeight(weight: BorderWeight): void;
    setColor(color: string): void;
  }

  interface RangeBorderCollection extends Array<RangeBorder> {
    getItem(index: BorderIndex): RangeBorder;
  }

  interface RangeFill {
    setColor(color: string): void;
  }

  interface RangeFont {
    setColor(color: string): void;
    setSize(size: number): void;
    setBold(bold: boolean): void;
    setItalic(italic: boolean): void;
    setUnderline(style: RangeUnderlineStyle): void;
  }

  interface RangeFormat {
    getFill(): RangeFill;
    getFont(): RangeFont;
    getBorders(): RangeBorderCollection;
    setTextOrientation(degrees: number): void;
    setHorizontalAlignment(alignment: HorizontalAlignment): void;
    setVerticalAlignment(alignment: VerticalAlignment): void;
    setColumnWidth(width: number): void;
    setRowHeight(height: number): void;
  }

  interface DataValidation {
    setList(options: string[]): void;
  }

  interface Range {
    getFormat(): RangeFormat;
    getDataValidation(): DataValidation;
    getRowCount(): number;
    getValues(): (string | number | boolean)[][];
    setValue(value: string | number | boolean): void;
    setFormula(formula: string): void;
    addComment(content: string, author?: string): void;
    clear(applyTo?: ClearApplyTo): void;
    merge(across?: boolean): void;
  }

  interface Shape {
    getType(): ShapeType;
    delete(): void;
  }

  interface Worksheet {
    getRangeByIndexes(startRow: number, startColumn: number, rowCount: number, columnCount: number): Range;
    getUsedRange(): Range | undefined;
    getShapes(): Shape[];
  }

  interface Workbook {
    getWorksheet(name: string): Worksheet | undefined;
  }
}
