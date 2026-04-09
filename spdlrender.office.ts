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
    const bounds = getActiveBounds(mediaBoxApplied, pageTopRow, pageWidth, pageHeight, maxRows, maxCols);

    // --- IMAGE (InsertImage) ---
    if (command.includes("/InsertImage")) {
      const match = command.match(/\(([^)]+)\)/);
      if (match) {
        const url = match[1];
        const remaining = command.replace(match[0], "");
        const parts = remaining.trim().split(/\s+/);
        const w = parseInt(parts[0], 10);
        const h = parseInt(parts[1], 10);
        // Office Scripts cannot directly fetch external images without base64 data.
        // Leave a placeholder to avoid runtime errors.
        console.log(`Skipping image insertion for ${url}; provide base64 to add images manually.`);
      }
      continue;
    }

    // --- ANNOTATIONS (/Note) ---
    if (command.includes("/Note")) {
      const match = command.match(/\(([^)]+)\)/);
      if (match) {
        const targetCell = clampCellWrite(currentX, currentY, bounds, "/Note");
        if (!targetCell) continue;
        const cell = getCell(renderSheet, targetCell.x, targetCell.y);
        cell.addComment(match[1], "SPDL");
      }
      continue;
    }

    // --- ACROFORMS ---
    if (command.includes("/CheckBox")) {
      const checkboxRect = clampRect(currentX, currentY, 1, 1, bounds, "/CheckBox");
      if (!checkboxRect) continue;
      const range = renderSheet.getRangeByIndexes(checkboxRect.y - 1, checkboxRect.x - 1, checkboxRect.h, checkboxRect.w);
      range.setValue("☐");
      range.getFormat().setHorizontalAlignment(ExcelScript.HorizontalAlignment.center);
      range.getFormat().setVerticalAlignment(ExcelScript.VerticalAlignment.center);
      continue;
    }

    if (command.includes("/Dropdown")) {
      const match = command.match(/\(([^)]+)\)/);
      if (match) {
        const options = match[1].split(",").map(s => s.trim());
        const dropdownRect = clampRect(currentX, currentY, 1, 6, bounds, "/Dropdown");
        if (!dropdownRect) continue;
        const range = renderSheet.getRangeByIndexes(dropdownRect.y - 1, dropdownRect.x - 1, dropdownRect.h, dropdownRect.w);
        range.merge();
        range.getDataValidation().setList(options);
        range.setValue(options[0]);
        const format = range.getFormat();
        format.getFill().setColor("#FFF2CC");
        format.setHorizontalAlignment(ExcelScript.HorizontalAlignment.center);
        format.setVerticalAlignment(ExcelScript.VerticalAlignment.center);
        setBorder(range, currentStrokeColor, currentLineWidth);
      }
      continue;
    }

    // --- PAGE SETUP ---
    if (command.includes("MediaBox")) {
      const parts = command.split(/\s+/);
      const parsedWidth = parseInt(parts[0], 10);
      const parsedHeight = parseInt(parts[1], 10);
      if (parsedWidth > 0 && parsedHeight > 0) {
        pageWidth = parsedWidth;
        pageHeight = parsedHeight;
        mediaBoxApplied = true;
        drawPageIfValid(renderSheet, pageTopRow, pageWidth, pageHeight, currentLineWidth);
      } else {
        mediaBoxApplied = false;
        console.log(`Ignoring MediaBox with invalid dimensions: ${command}`);
      }
      continue;
    }

    if (command.includes("/NewPage")) {
      if (!mediaBoxApplied || pageWidth <= 0 || pageHeight <= 0) {
        console.log("/NewPage encountered before MediaBox was applied; skipping page break.");
      } else {
        pageTopRow = pageTopRow + pageHeight + 2;
        currentX = 1;
        currentY = pageTopRow;
        drawPageIfValid(renderSheet, pageTopRow, pageWidth, pageHeight, currentLineWidth);
      }
      continue;
    }

    // --- LINE WIDTH ---
    const lineWidthMatch = command.match(/^(\d+)\s+w\b/);
    if (lineWidthMatch) {
      const widthValue = parseInt(lineWidthMatch[1], 10);
      currentLineWidth = mapLineWidth(widthValue);
      continue;
    }

    // --- SHAPES ---
    if (command.includes("re")) {
      const parts = command.split(/\s+/);
      currentPath.x = Math.floor(parseInt(parts[0], 10));
      currentPath.y = pageTopRow + Math.floor(parseInt(parts[1], 10));
      currentPath.w = Math.floor(parseInt(parts[2], 10));
      currentPath.h = Math.floor(parseInt(parts[3], 10));
      continue;
    }

    if (command === "f" || command === "S") {
      const pathRect = clampRect(currentPath.x, currentPath.y, currentPath.h, currentPath.w, bounds, command === "f" ? "fill rect" : "stroke rect");
      if (pathRect) {
        const range = renderSheet.getRangeByIndexes(pathRect.y - 1, pathRect.x - 1, pathRect.h, pathRect.w);
        if (command === "f") {
          range.getFormat().getFill().setColor(currentFillColor);
        }
        if (command === "S") {
          setBorder(range, currentStrokeColor, currentLineWidth);
        }
      }
      continue;
    }

    // --- PIXEL IMAGES ---
    if (command.includes("ID")) {
      const parts = command.split(/\s+/);
      const width = parseInt(parts[0], 10);
      const height = parseInt(parts[1], 10);
      const pixelData = parts[3];
      if (pixelData && pixelData.length >= width * height) {
        const pixelRect = clampRect(currentX, currentY, height, width, bounds, "pixel-art");
        if (!pixelRect) continue;
        for (let r = 0; r < pixelRect.h; r++) {
          for (let c = 0; c < pixelRect.w; c++) {
            const sourceRow = pixelRect.sourceRowOffset + r;
            const sourceCol = pixelRect.sourceColOffset + c;
            const colorCode = pixelData[(sourceRow * width) + sourceCol];
            const pixelColor = colorCode === '1' ? "#000000" : colorCode === '2' ? "#F1C40F" : colorCode === '3' ? "#E74C3C" : null;
            if (pixelColor) {
              const cell = renderSheet.getRangeByIndexes(pixelRect.y + r - 1, pixelRect.x + c - 1, 1, 1);
              cell.getFormat().getFill().setColor(pixelColor);
            }
          }
        }
      }
      continue;
    }

    // --- LINKS & TEXT ---
    if (command.includes("/Link")) {
      const matches = command.match(/\(([^)]+)\)/g);
      if (matches && matches.length >= 2) {
        const url = matches[0].replace(/[()]/g, "");
        const label = matches[1].replace(/[()]/g, "");
        const targetCell = clampCellWrite(currentX, currentY, bounds, "/Link");
        if (!targetCell) continue;
        const cell = getCell(renderSheet, targetCell.x, targetCell.y);
        cell.setFormula(`=HYPERLINK("${url}", "${label}")`);
        applyTextFormatting(cell, currentFillColor, currentFontSize, isBold, isItalic, underline, currentRotation, currentHorizontalAlignment, currentVerticalAlignment);
      }
      continue;
    }

    if (command.includes("/Rotate")) {
      const parts = command.split(/\s+/);
      currentRotation = parseInt(parts[0], 10);
      continue;
    }

    if (command.includes("/Align")) {
      const parts = command.trim().split(/\s+/);
      const alignDirective = parts[1];
      if (alignDirective?.startsWith("H")) {
        if (alignDirective === "HCenter") currentHorizontalAlignment = ExcelScript.HorizontalAlignment.center;
        if (alignDirective === "HRight") currentHorizontalAlignment = ExcelScript.HorizontalAlignment.right;
        if (alignDirective === "HLeft") currentHorizontalAlignment = ExcelScript.HorizontalAlignment.left;
      }
      if (alignDirective?.startsWith("V")) {
        if (alignDirective === "VMiddle") currentVerticalAlignment = ExcelScript.VerticalAlignment.center;
        if (alignDirective === "VBottom") currentVerticalAlignment = ExcelScript.VerticalAlignment.bottom;
        if (alignDirective === "VTop") currentVerticalAlignment = ExcelScript.VerticalAlignment.top;
      }
      continue;
    }

    if (command.includes("rg")) {
      const parts = command.split(/\s+/);
      currentFillColor = rgbToHex(parseFloat(parts[0]) * 255, parseFloat(parts[1]) * 255, parseFloat(parts[2]) * 255);
      continue;
    }

    if (/\bSC\b/.test(command)) {
      const parts = command.trim().split(/\s+/);
      const scIndex = parts.indexOf("SC");
      if (scIndex >= 3) {
        currentStrokeColor = rgbToHex(parseFloat(parts[scIndex - 3]) * 255, parseFloat(parts[scIndex - 2]) * 255, parseFloat(parts[scIndex - 1]) * 255);
      }
      continue;
    }

    if (command.includes("Tf")) {
      isBold = command.includes("/F2");
      isItalic = command.includes("/F3");
      continue;
    }

    if (command.includes("Tr")) {
      underline = command.startsWith("1");
      continue;
    }

    const taMatch = command.match(/(\d+)\s+TA/);
    if (taMatch) {
      const alignmentCode = parseInt(taMatch[1], 10);
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

    if (command.includes("Ts")) {
      const parts = command.trim().split(/\s+/);
      const sizeIndex = parts.indexOf("Ts");
      if (sizeIndex >= 1) {
        currentFontSize = parseInt(parts[sizeIndex - 1], 10) || defaultFontSize;
      }
      continue;
    }

    if (command.includes("Td")) {
      const parts = command.split(/\s+/);
      currentX += Math.floor(parseInt(parts[0], 10) / 10);
      currentY += Math.floor(parseInt(parts[1], 10) / 10);
      continue;
    }

    if (command.includes("/MoveTo")) {
      const parts = command.split(/\s+/);
      let targetX = parseInt(parts[1], 10);
      let targetY = parseInt(parts[2], 10);
      if (!isNaN(targetX) && !isNaN(targetY)) {
        const maxX = pageWidth > 0 ? pageWidth : maxCols;
        const pageBottom = pageHeight > 0 ? pageTopRow + pageHeight - 1 : maxRows;
        targetX = Math.max(1, Math.min(maxX, targetX));
        targetY = Math.max(pageTopRow, Math.min(pageBottom, pageTopRow + targetY - 1));
        currentX = targetX;
        currentY = targetY;
      }
      continue;
    }

    if (command.includes("Tj")) {
      const match = command.match(/\(([^)]+)\)/);
      if (match) {
        const targetCell = clampCellWrite(currentX, currentY, bounds, "Tj");
        if (!targetCell) continue;
        const cell = getCell(renderSheet, targetCell.x, targetCell.y);
        cell.setValue(match[1]);
        applyTextFormatting(cell, currentFillColor, currentFontSize, isBold, isItalic, underline, currentRotation, currentHorizontalAlignment, currentVerticalAlignment);
      }
      continue;
    }
  }
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

function getActiveBounds(mediaBoxApplied: boolean, pageTopRow: number, pageWidth: number, pageHeight: number, maxRows: number, maxCols: number) {
  if (mediaBoxApplied && pageWidth > 0 && pageHeight > 0) {
    return { minX: 1, maxX: pageWidth, minY: pageTopRow, maxY: pageTopRow + pageHeight - 1, mode: "MediaBox" };
  }
  return { minX: 1, maxX: maxCols, minY: 1, maxY: maxRows, mode: "canvas" };
}

function clampCellWrite(x: number, y: number, bounds: { minX: number; maxX: number; minY: number; maxY: number; mode: string }, operationName: string) {
  if (x < bounds.minX || x > bounds.maxX || y < bounds.minY || y > bounds.maxY) {
    console.log(`Skipping ${operationName}: cell (${x}, ${y}) is outside ${bounds.mode} bounds [x:${bounds.minX}-${bounds.maxX}, y:${bounds.minY}-${bounds.maxY}]`);
    return null;
  }
  return { x, y };
}

function clampRect(x: number, y: number, h: number, w: number, bounds: { minX: number; maxX: number; minY: number; maxY: number; mode: string }, operationName: string) {
  if (h <= 0 || w <= 0) {
    console.log(`Skipping ${operationName}: invalid range size h=${h}, w=${w}`);
    return null;
  }
  const startX = x;
  const startY = y;
  const endX = x + w - 1;
  const endY = y + h - 1;
  const clampedStartX = Math.max(bounds.minX, startX);
  const clampedStartY = Math.max(bounds.minY, startY);
  const clampedEndX = Math.min(bounds.maxX, endX);
  const clampedEndY = Math.min(bounds.maxY, endY);
  if (clampedStartX > clampedEndX || clampedStartY > clampedEndY) {
    console.log(`Skipping ${operationName}: range (${startX}, ${startY}, h=${h}, w=${w}) is outside ${bounds.mode} bounds [x:${bounds.minX}-${bounds.maxX}, y:${bounds.minY}-${bounds.maxY}]`);
    return null;
  }
  return {
    x: clampedStartX,
    y: clampedStartY,
    h: clampedEndY - clampedStartY + 1,
    w: clampedEndX - clampedStartX + 1,
    sourceRowOffset: clampedStartY - startY,
    sourceColOffset: clampedStartX - startX
  };
}

function drawPageIfValid(sheet: ExcelScript.Worksheet, topRow: number, width: number, height: number, borderStyle: ExcelScript.BorderLineStyle) {
  if (width > 0 && height > 0) {
    const pageRange = sheet.getRangeByIndexes(topRow - 1, 0, height, width);
    pageRange.getFormat().getFill().setColor("white");
    setBorder(pageRange, "black", borderStyle);
  }
}

function setBorder(range: ExcelScript.Range, color: string, style: ExcelScript.BorderLineStyle) {
  const borders = range.getFormat().getBorders();
  borders.getItem(ExcelScript.BorderIndex.edgeTop).setStyle(style);
  borders.getItem(ExcelScript.BorderIndex.edgeTop).setColor(color);
  borders.getItem(ExcelScript.BorderIndex.edgeBottom).setStyle(style);
  borders.getItem(ExcelScript.BorderIndex.edgeBottom).setColor(color);
  borders.getItem(ExcelScript.BorderIndex.edgeLeft).setStyle(style);
  borders.getItem(ExcelScript.BorderIndex.edgeLeft).setColor(color);
  borders.getItem(ExcelScript.BorderIndex.edgeRight).setStyle(style);
  borders.getItem(ExcelScript.BorderIndex.edgeRight).setColor(color);
}

function rgbToHex(r: number, g: number, b: number): string {
  const toHex = (value: number) => Math.max(0, Math.min(255, Math.floor(value))).toString(16).padStart(2, "0");
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

function mapLineWidth(widthValue: number): ExcelScript.BorderLineStyle {
  if (widthValue === 1) return ExcelScript.BorderLineStyle.continuous;
  if (widthValue === 2) return ExcelScript.BorderLineStyle.continuous;
  if (widthValue === 3) return ExcelScript.BorderLineStyle.double;
  if (widthValue === 4) return ExcelScript.BorderLineStyle.double;
  return ExcelScript.BorderLineStyle.continuous;
}
