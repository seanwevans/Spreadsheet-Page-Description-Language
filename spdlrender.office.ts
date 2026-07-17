/**
 * Office Scripts renderer for the Spreadsheet Page Description Language (SPDL).
 * Mirrors the Google Apps Script implementation in `spdlrender.gs` using Excel APIs.
 */
function main(workbook: ExcelScript.Workbook) {
  const sourceSheet = workbook.getWorksheet("01_Hex_Stream");
  const renderSheet = workbook.getWorksheet("02_Rendered_View");

  if (!sourceSheet || !renderSheet) {
    throw new Error("Missing required sheets: 01_Hex_Stream and 02_Rendered_View");
  }

  const usedRange = sourceSheet.getUsedRange();
  const lastRow = usedRange ? usedRange.getRowCount() : 0;
  const commandCount = Math.max(0, lastRow - 1);
  const commands: string[] = commandCount > 0
    ? sourceSheet.getRangeByIndexes(1, 0, commandCount, 1).getValues().flat().map(String)
    : [];

  const maxRows = 1000;
  const maxCols = 26;
  const cellSize = 25;
  const defaultFontSize = 15;

  const canvas = renderSheet.getRangeByIndexes(0, 0, maxRows, maxCols);
  canvas.clear(ExcelScript.ClearApplyTo.contents);
  canvas.clear(ExcelScript.ClearApplyTo.formats);
  canvas.getFormat().getFill().setColor("#505050");
  canvas.getFormat().getFont().setColor("black");
  canvas.getFormat().getFont().setSize(defaultFontSize);
  canvas.getFormat().getFont().setBold(false);
  canvas.getFormat().getFont().setItalic(false);
  canvas.getFormat().setTextOrientation(0);
  canvas.getFormat().getBorders().forEach(border => {
    border.setStyle(ExcelScript.BorderLineStyle.none);
  });

  for (let c = 0; c < maxCols; c++) {
    renderSheet.getRangeByIndexes(0, c, maxRows, 1).setColumnWidth(cellSize);
  }
  for (let r = 0; r < maxRows; r++) {
    renderSheet.getRangeByIndexes(r, 0, 1, maxCols).setRowHeight(cellSize);
  }

  // Remove existing images
  renderSheet.getShapes().forEach(shape => {
    if (shape.getType() === ExcelScript.ShapeType.image) {
      shape.delete();
    }
  });

  let currentX = 1;
  let currentY = 1;
  let currentFillColor = "#000000";
  let currentStrokeColor = "#000000";
  let currentLineWidth: ExcelScript.BorderLineStyle = mapLineWidth(3);
  let currentLineWeight: ExcelScript.BorderWeight = mapLineWeight(3);
  let currentRotation = 0;
  let currentPath = { x: 0, y: 0, w: 0, h: 0 };
  let pageTopRow = 1;
  let pageWidth = 0;
  let pageHeight = 0;
  let mediaBoxApplied = false;
  let currentFontSize = defaultFontSize;
  let currentHorizontalAlignment = ExcelScript.HorizontalAlignment.left;
  let currentVerticalAlignment = ExcelScript.VerticalAlignment.top;
  let isBold = false;
  let isItalic = false;
  let underline = false;

  for (const rawCommand of commands) {
    const command = rawCommand.trim();
    if (!command) continue;
    let match: RegExpMatchArray | null;

    // One bad command (e.g. a range outside the sheet) must not abort the
    // whole render: log it and continue with the next command.
    try {
      // --- TEXT --- (parsed first so text content can never be misread as an operator)
      if ((match = command.match(TEXT_COMMAND_PATTERN))) {
        if (isInsideCanvas(currentX, currentY, maxRows, maxCols)) {
          const cell = getCell(renderSheet, currentX, currentY);
          cell.setValue(match[1]);
          applyTextFormatting(cell, currentFillColor, currentFontSize, isBold, isItalic, underline, currentRotation, currentHorizontalAlignment, currentVerticalAlignment);
        } else {
          console.log(`Skipping text outside canvas at (${currentX}, ${currentY}): ${command}`);
        }
        continue;
      }

      // --- LINKS ---
      if ((match = command.match(LINK_COMMAND_PATTERN))) {
        const url = match[1];
        const label = match[2];
        if (isInsideCanvas(currentX, currentY, maxRows, maxCols)) {
          const cell = getCell(renderSheet, currentX, currentY);
          cell.setFormula(`=HYPERLINK("${url}", "${label}")`);
          applyTextFormatting(cell, currentFillColor, currentFontSize, isBold, isItalic, underline, currentRotation, currentHorizontalAlignment, currentVerticalAlignment);
        } else {
          console.log(`Skipping link outside canvas at (${currentX}, ${currentY}): ${command}`);
        }
        continue;
      }

      // --- IMAGE (InsertImage) ---
      if ((match = command.match(INSERT_IMAGE_PATTERN))) {
        // Office Scripts cannot directly fetch external images without base64 data.
        // Leave a placeholder to avoid runtime errors.
        console.log(`Skipping image insertion for ${match[3]}; provide base64 to add images manually.`);
        continue;
      }

      // --- ANNOTATIONS (/Note) ---
      if ((match = command.match(NOTE_COMMAND_PATTERN))) {
        if (isInsideCanvas(currentX, currentY, maxRows, maxCols)) {
          const cell = getCell(renderSheet, currentX, currentY);
          cell.addComment(match[1], "SPDL");
        }
        continue;
      }

      // --- ACROFORMS ---
      if (isExactOperator(command, "/CheckBox")) {
        if (!isInsideCanvas(currentX, currentY, maxRows, maxCols)) continue;
        const range = renderSheet.getRangeByIndexes(currentY - 1, currentX - 1, 1, 1);
        range.setValue("☐");
        range.getFormat().setHorizontalAlignment(ExcelScript.HorizontalAlignment.center);
        range.getFormat().setVerticalAlignment(ExcelScript.VerticalAlignment.center);
        continue;
      }

      if ((match = command.match(DROPDOWN_COMMAND_PATTERN))) {
        if (!isInsideCanvas(currentX, currentY, maxRows, maxCols)) continue;
        const options = match[1].split(",").map(s => s.trim());
        const dropdownWidth = Math.min(6, maxCols - currentX + 1);
        const range = renderSheet.getRangeByIndexes(currentY - 1, currentX - 1, 1, dropdownWidth);
        range.merge();
        range.getDataValidation().setList(options);
        range.setValue(options[0]);
        const format = range.getFormat();
        format.getFill().setColor("#FFF2CC");
        format.setHorizontalAlignment(ExcelScript.HorizontalAlignment.center);
        format.setVerticalAlignment(ExcelScript.VerticalAlignment.center);
        setBorder(range, currentStrokeColor, currentLineWidth, currentLineWeight);
        continue;
      }

      // --- PAGE SETUP ---
      if ((match = command.match(MEDIABOX_PATTERN))) {
        const parsedWidth = parseInt(match[1], 10);
        const parsedHeight = parseInt(match[2], 10);
        if (parsedWidth > 0 && parsedHeight > 0) {
          pageWidth = parsedWidth;
          pageHeight = parsedHeight;
          mediaBoxApplied = true;
          drawPageIfValid(renderSheet, pageTopRow, pageWidth, pageHeight, currentLineWidth, currentLineWeight, maxRows, maxCols);
        } else {
          mediaBoxApplied = false;
          console.log(`Ignoring MediaBox with invalid dimensions: ${command}`);
        }
        continue;
      }

      if (isExactOperator(command, "/NewPage")) {
        if (!mediaBoxApplied || pageWidth <= 0 || pageHeight <= 0) {
          console.log("/NewPage encountered before MediaBox was applied; skipping page break.");
        } else {
          pageTopRow = pageTopRow + pageHeight + 2;
          currentX = 1;
          currentY = pageTopRow;
          drawPageIfValid(renderSheet, pageTopRow, pageWidth, pageHeight, currentLineWidth, currentLineWeight, maxRows, maxCols);
        }
        continue;
      }

      // --- LINE WIDTH ---
      if ((match = command.match(LINE_WIDTH_PATTERN))) {
        const widthValue = parseInt(match[1], 10);
        currentLineWidth = mapLineWidth(widthValue);
        currentLineWeight = mapLineWeight(widthValue);
        continue;
      }

      // --- SHAPES ---
      const rectanglePath = parseRectangleCommand(command);
      if (rectanglePath) {
        currentPath.x = rectanglePath.x;
        currentPath.y = pageTopRow + rectanglePath.y;
        currentPath.w = rectanglePath.w;
        currentPath.h = rectanglePath.h;
        continue;
      }

      if (isExactOperator(command, "f") || isExactOperator(command, "S")) {
        if (currentPath.w > 0 && currentPath.h > 0) {
          const clamped = clampRect(currentPath.x, currentPath.y, currentPath.w, currentPath.h, maxRows, maxCols);
          if (clamped) {
            const range = renderSheet.getRangeByIndexes(clamped.y - 1, clamped.x - 1, clamped.h, clamped.w);
            if (isExactOperator(command, "f")) {
              range.getFormat().getFill().setColor(currentFillColor);
            }
            if (command === "S") {
              setBorder(range, currentStrokeColor, currentLineWidth, currentLineWeight);
            }
          } else {
            console.log(`Skipping path entirely outside canvas: ${JSON.stringify(currentPath)}`);
          }
        }
        continue;
      }

      // --- PIXEL IMAGES ---
      if ((match = command.match(PIXEL_ART_PATTERN))) {
        const width = parseInt(match[1], 10);
        const height = parseInt(match[2], 10);
        const pixelData = match[3];
        if (pixelData && pixelData.length >= width * height) {
          for (let r = 0; r < height; r++) {
            for (let c = 0; c < width; c++) {
              const colorCode = pixelData[(r * width) + c];
              const pixelColor = colorCode === '1' ? "#000000" : colorCode === '2' ? "#F1C40F" : colorCode === '3' ? "#E74C3C" : null;
              if (pixelColor && isInsideCanvas(currentX + c, currentY + r, maxRows, maxCols)) {
                const cell = renderSheet.getRangeByIndexes(currentY + r - 1, currentX + c - 1, 1, 1);
                cell.getFormat().getFill().setColor(pixelColor);
              }
            }
          }
        }
        continue;
      }

      // --- ROTATION / ALIGNMENT ---
      if (command.split(/\s+/).indexOf("/Rotate") >= 0) {
        const rotationCandidate = parseRotationOperand(command);
        if (rotationCandidate !== null) {
          currentRotation = rotationCandidate;
        }
        continue;
      }

      if ((match = command.match(ALIGN_COMMAND_PATTERN))) {
        const alignDirective = match[1];
        if (alignDirective === "HCenter") currentHorizontalAlignment = ExcelScript.HorizontalAlignment.center;
        if (alignDirective === "HRight") currentHorizontalAlignment = ExcelScript.HorizontalAlignment.right;
        if (alignDirective === "HLeft") currentHorizontalAlignment = ExcelScript.HorizontalAlignment.left;
        if (alignDirective === "VMiddle") currentVerticalAlignment = ExcelScript.VerticalAlignment.center;
        if (alignDirective === "VBottom") currentVerticalAlignment = ExcelScript.VerticalAlignment.bottom;
        if (alignDirective === "VTop") currentVerticalAlignment = ExcelScript.VerticalAlignment.top;
        continue;
      }

      // --- COLORS ---
      if ((match = command.match(FILL_COLOR_PATTERN))) {
        currentFillColor = rgbToHex(parseFloat(match[1]) * 255, parseFloat(match[2]) * 255, parseFloat(match[3]) * 255);
        continue;
      }

      if ((match = command.match(STROKE_COLOR_PATTERN))) {
        currentStrokeColor = rgbToHex(parseFloat(match[1]) * 255, parseFloat(match[2]) * 255, parseFloat(match[3]) * 255);
        continue;
      }

      // --- TYPOGRAPHY ---
      if ((match = command.match(FONT_COMMAND_PATTERN))) {
        isBold = match[1] === "2";
        isItalic = match[1] === "3";
        continue;
      }

      if ((match = command.match(UNDERLINE_PATTERN))) {
        underline = match[1] === "1";
        continue;
      }

      if ((match = command.match(FONT_SIZE_PATTERN))) {
        currentFontSize = parseInt(match[1], 10) || defaultFontSize;
        continue;
      }

      if ((match = command.match(ALIGN_CODE_PATTERN))) {
        const alignmentCode = parseInt(match[1], 10);
        if (alignmentCode === 0) currentHorizontalAlignment = ExcelScript.HorizontalAlignment.left;
        if (alignmentCode === 1) currentHorizontalAlignment = ExcelScript.HorizontalAlignment.center;
        if (alignmentCode === 2) currentHorizontalAlignment = ExcelScript.HorizontalAlignment.right;
        if (alignmentCode === 3) currentVerticalAlignment = ExcelScript.VerticalAlignment.top;
        if (alignmentCode === 4) currentVerticalAlignment = ExcelScript.VerticalAlignment.center;
        if (alignmentCode === 5) currentVerticalAlignment = ExcelScript.VerticalAlignment.bottom;
        if (alignmentCode >= 6) {
          currentHorizontalAlignment = ExcelScript.HorizontalAlignment.left;
          currentVerticalAlignment = ExcelScript.VerticalAlignment.top;
        }
        continue;
      }

      // --- CURSOR ---
      if ((match = command.match(TD_PATTERN))) {
        const deltaX = parseFloat(match[1]);
        const deltaY = parseFloat(match[2]);
        if (!isNaN(deltaX) && !isNaN(deltaY)) {
          currentX += Math.trunc(deltaX / 10);
          currentY += Math.trunc(deltaY / 10);
        }
        continue;
      }

      if ((match = command.match(MOVE_TO_PATTERN))) {
        const targetX = parseInt(match[1], 10);
        const targetY = parseInt(match[2], 10);
        const maxX = pageWidth > 0 ? pageWidth : maxCols;
        const pageBottom = pageHeight > 0 ? pageTopRow + pageHeight - 1 : maxRows;
        currentX = Math.max(1, Math.min(maxX, targetX));
        currentY = Math.max(pageTopRow, Math.min(pageBottom, pageTopRow + targetY - 1));
        continue;
      }


      console.log(`Skipped unrecognized command: ${command}`);
    } catch (err) {
      console.log(`Error processing command "${command}": ${err}`);
    }
  }
}

// Anchored command patterns. Every SPDL command must match one of these
// exactly; substring checks are never used for dispatch so that text content
// such as "(Morgan) Tj" can never be mistaken for an operator like "rg".
const TEXT_COMMAND_PATTERN = /^\((.*)\)\s+Tj\s*$/;
const LINK_COMMAND_PATTERN = /^\(([^)]*)\)\s+\(([^)]*)\)\s+\/Link$/;
const INSERT_IMAGE_PATTERN = /^(\d+)\s+(\d+)\s+\(([^)]*)\)\s+\/InsertImage$/;
const NOTE_COMMAND_PATTERN = /^\(([^)]*)\)\s+\/Note$/;
const DROPDOWN_COMMAND_PATTERN = /^\(([^)]*)\)\s+\/Dropdown$/;
const MEDIABOX_PATTERN = /^(\d+)\s+(\d+)\s+MediaBox$/;
const LINE_WIDTH_PATTERN = /^(\d+)\s+w$/;
const RECTANGLE_COMMAND_PATTERN = /^\s*-?\d+(\.\d+)?\s+-?\d+(\.\d+)?\s+-?\d+(\.\d+)?\s+-?\d+(\.\d+)?\s+re\s*$/;
const PIXEL_ART_PATTERN = /^(\d+)\s+(\d+)\s+ID\s+(\S+)$/;
const ALIGN_COMMAND_PATTERN = /^\/Align\s+(\S+)$/;
const FILL_COLOR_PATTERN = /^(\d*\.?\d+)\s+(\d*\.?\d+)\s+(\d*\.?\d+)\s+rg$/;
const STROKE_COLOR_PATTERN = /^(\d*\.?\d+)\s+(\d*\.?\d+)\s+(\d*\.?\d+)\s+SC$/;
const FONT_COMMAND_PATTERN = /^\/F(\d+)(?:\s+(\d+(?:\.\d+)?))?\s+Tf$/;
const UNDERLINE_PATTERN = /^([01])\s+Tr$/;
const FONT_SIZE_PATTERN = /^([+-]?\d*\.?\d+)\s+Ts$/;
const ALIGN_CODE_PATTERN = /^(\d+)\s+TA$/;
const TD_PATTERN = /^([+-]?\d*\.?\d+)\s+([+-]?\d*\.?\d+)\s+Td$/;
const MOVE_TO_PATTERN = /^\/MoveTo\s+(-?\d+)\s+(-?\d+)$/;

function isExactOperator(command: string, operator: string): boolean {
  return command === operator;
}

function parseRectangleCommand(command: string): { x: number; y: number; w: number; h: number } | null {
  if (!RECTANGLE_COMMAND_PATTERN.test(command)) return null;
  const parts = command.trim().split(/\s+/);
  return {
    x: Math.floor(parseFloat(parts[0])),
    y: Math.floor(parseFloat(parts[1])),
    w: Math.floor(parseFloat(parts[2])),
    h: Math.floor(parseFloat(parts[3]))
  };
}

function parseTextCommand(command: string): string | null {
  const textMatch = command.match(TEXT_COMMAND_PATTERN);
  return textMatch ? textMatch[1] : null;
}

function applyTextFormatting(cell: ExcelScript.Range, color: string, size: number, bold: boolean, italic: boolean, underline: boolean, rotation: number, hAlign: ExcelScript.HorizontalAlignment, vAlign: ExcelScript.VerticalAlignment) {
  const format = cell.getFormat();
  const font = format.getFont();
  font.setColor(color);
  font.setSize(size);
  font.setBold(bold);
  font.setItalic(italic);
  font.setUnderline(underline ? ExcelScript.RangeUnderlineStyle.single : ExcelScript.RangeUnderlineStyle.none);
  format.setTextOrientation(rotation);
  format.setHorizontalAlignment(hAlign);
  format.setVerticalAlignment(vAlign);
}

function getCell(sheet: ExcelScript.Worksheet, x: number, y: number): ExcelScript.Range {
  return sheet.getRangeByIndexes(y - 1, x - 1, 1, 1);
}

function drawPageIfValid(
  sheet: ExcelScript.Worksheet,
  topRow: number,
  width: number,
  height: number,
  borderStyle: ExcelScript.BorderLineStyle,
  borderWeight: ExcelScript.BorderWeight,
  maxRows: number,
  maxCols: number
) {
  if (width > 0 && height > 0) {
    const clamped = clampRect(1, topRow, width, height, maxRows, maxCols);
    if (!clamped) {
      console.log(`Skipping page draw entirely outside canvas: topRow=${topRow}, width=${width}, height=${height}`);
      return;
    }
    const pageRange = sheet.getRangeByIndexes(clamped.y - 1, clamped.x - 1, clamped.h, clamped.w);
    pageRange.getFormat().getFill().setColor("white");
    setBorder(pageRange, "black", borderStyle, borderWeight);
  }
}

function isInsideCanvas(x: number, y: number, maxRows: number, maxCols: number): boolean {
  return x >= 1 && x <= maxCols && y >= 1 && y <= maxRows;
}

function clampRect(x: number, y: number, w: number, h: number, maxRows: number, maxCols: number): { x: number; y: number; w: number; h: number } | null {
  const x1 = Math.max(1, x);
  const y1 = Math.max(1, y);
  const x2 = Math.min(maxCols, x + w - 1);
  const y2 = Math.min(maxRows, y + h - 1);
  if (x2 < x1 || y2 < y1) return null;
  return { x: x1, y: y1, w: x2 - x1 + 1, h: y2 - y1 + 1 };
}

function setBorder(
  range: ExcelScript.Range,
  color: string,
  style: ExcelScript.BorderLineStyle,
  weight: ExcelScript.BorderWeight
) {
  const borders = range.getFormat().getBorders();
  borders.getItem(ExcelScript.BorderIndex.edgeTop).setStyle(style);
  borders.getItem(ExcelScript.BorderIndex.edgeTop).setWeight(weight);
  borders.getItem(ExcelScript.BorderIndex.edgeTop).setColor(color);
  borders.getItem(ExcelScript.BorderIndex.edgeBottom).setStyle(style);
  borders.getItem(ExcelScript.BorderIndex.edgeBottom).setWeight(weight);
  borders.getItem(ExcelScript.BorderIndex.edgeBottom).setColor(color);
  borders.getItem(ExcelScript.BorderIndex.edgeLeft).setStyle(style);
  borders.getItem(ExcelScript.BorderIndex.edgeLeft).setWeight(weight);
  borders.getItem(ExcelScript.BorderIndex.edgeLeft).setColor(color);
  borders.getItem(ExcelScript.BorderIndex.edgeRight).setStyle(style);
  borders.getItem(ExcelScript.BorderIndex.edgeRight).setWeight(weight);
  borders.getItem(ExcelScript.BorderIndex.edgeRight).setColor(color);
}

function rgbToHex(r: number, g: number, b: number): string {
  const toHex = (value: number) => Math.max(0, Math.min(255, Math.floor(value))).toString(16).padStart(2, "0");
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

function mapLineWidth(widthValue: number): ExcelScript.BorderLineStyle {
  // Canonical SPDL stroke width mapping (shared across renderers):
  // 1 = thin, 2 = medium, 3 = thick, 4 = double.
  if (widthValue === 1) return ExcelScript.BorderLineStyle.continuous;
  if (widthValue === 2) return ExcelScript.BorderLineStyle.continuous;
  if (widthValue === 3) return ExcelScript.BorderLineStyle.continuous;
  if (widthValue === 4) return ExcelScript.BorderLineStyle.double;
  return ExcelScript.BorderLineStyle.continuous;
}

function mapLineWeight(widthValue: number): ExcelScript.BorderWeight {
  if (widthValue === 1) return ExcelScript.BorderWeight.thin;
  if (widthValue === 2) return ExcelScript.BorderWeight.medium;
  if (widthValue === 3) return ExcelScript.BorderWeight.thick;
  if (widthValue === 4) return ExcelScript.BorderWeight.thick;
  return ExcelScript.BorderWeight.thin;
}

function parseRotationOperand(command: string): number | null {
  const parts = command.trim().split(/\s+/);
  const rotateIndex = parts.indexOf("/Rotate");
  if (rotateIndex < 0) return null;

  const candidates: string[] = [];
  if (rotateIndex + 1 < parts.length) candidates.push(parts[rotateIndex + 1]);
  if (rotateIndex - 1 >= 0) candidates.push(parts[rotateIndex - 1]);

  for (const candidate of candidates) {
    const value = Number(candidate);
    if (Number.isFinite(value)) return Math.trunc(value);
  }

  return null;
}
