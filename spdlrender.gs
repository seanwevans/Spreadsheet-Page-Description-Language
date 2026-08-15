// Anchored command patterns. Every SPDL command must match one of these
// exactly; substring checks are never used for dispatch so that text content
// such as "(Morgan) Tj" can never be mistaken for an operator like "rg".
const TEXT_COMMAND_PATTERN = /^\((.*)\)\s+Tj\s*$/;
const LINK_COMMAND_PATTERN = /^\(((?:[^)\\]|\\.)*)\)\s+\(((?:[^)\\]|\\.)*)\)\s+\/Link$/;
const INSERT_IMAGE_PATTERN = /^(\d+)\s+(\d+)\s+\(((?:[^)\\]|\\.)*)\)\s+\/InsertImage$/;
const NOTE_COMMAND_PATTERN = /^\(((?:[^)\\]|\\.)*)\)\s+\/Note$/;
const DROPDOWN_COMMAND_PATTERN = /^\(((?:[^)\\]|\\.)*)\)\s+\/Dropdown$/;
const MEDIABOX_PATTERN = /^(\d+)\s+(\d+)\s+MediaBox$/;
const LINE_WIDTH_PATTERN = /^(\d+)\s+w$/;
const RECTANGLE_COMMAND_PATTERN = /^\s*-?\d+(\.\d+)?\s+-?\d+(\.\d+)?\s+-?\d+(\.\d+)?\s+-?\d+(\.\d+)?\s+re\s*$/;
const PIXEL_ART_PATTERN = /^(\d+)\s+(\d+)\s+ID\s+(\S+)$/;
const ALIGN_COMMAND_PATTERN = /^\/Align\s+(\S+)$/;
const FILL_COLOR_PATTERN = /^(\d*\.?\d+)\s+(\d*\.?\d+)\s+(\d*\.?\d+)\s+rg$/;
const STROKE_COLOR_PATTERN = /^(\d*\.?\d+)\s+(\d*\.?\d+)\s+(\d*\.?\d+)\s+SC$/;
const FONT_COMMAND_PATTERN = /^\/F(\d+)(?:\s+(\d*\.?\d+))?\s+Tf$/;
const UNDERLINE_PATTERN = /^([01])\s+Tr$/;
const FONT_SIZE_PATTERN = /^([+-]?\d*\.?\d+)\s+Ts$/;
const ALIGN_CODE_PATTERN = /^(\d+)\s+TA$/;
const TD_PATTERN = /^([+-]?\d*\.?\d+)\s+([+-]?\d*\.?\d+)\s+Td$/;
const MOVE_TO_PATTERN = /^\/MoveTo\s+(-?\d+)\s+(-?\d+)$/;
const ROTATE_TOKEN = "/Rotate";

function renderPDF() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sourceSheet = ss.getSheetByName("01_Hex_Stream");
  const renderSheet = ss.getSheetByName("02_Rendered_View");

  const lastRow = sourceSheet.getLastRow();
  const data = lastRow >= 2 ? sourceSheet.getRange(2, 1, lastRow - 1).getValues() : [];
  if (data.length === 0) {
    Logger.log("renderPDF exiting: no stream data rows detected (lastRow=%s)", lastRow);
  }
  const maxRows = 1000;
  const maxCols = 26;

  const defaultHorizontalAlignment = renderSheet.getRange(1, 1).getHorizontalAlignment() || "left";
  const defaultVerticalAlignment = renderSheet.getRange(1, 1).getVerticalAlignment() || "top";

  let currentX = 1;
  let currentY = 1;
  let currentFillColor = "#000000";
  let currentStrokeColor = "#000000";
  let isBold = "normal";
  let isItalic = "normal";
  let lineStyle = "none";
  let currentLineWidth = mapLineWidth(3);
  let currentRotation = 0;
  let currentPath = {x:0, y:0, w:0, h:0};
  let pageTopRow = 1;
  let pageWidth = 0;
  let pageHeight = 0;
  let mediaBoxApplied = false;
  let cellSize = 25;
  let defaultFontSize = 15;
  let currentFontSize = defaultFontSize;
  let currentHorizontalAlignment = defaultHorizontalAlignment;
  let currentVerticalAlignment = defaultVerticalAlignment;

  // The renderer draws into these in-memory grids and flushes them to the
  // sheet in a handful of bulk calls at the end. Per-cell Range calls are the
  // dominant cost in Apps Script (~tens of ms each), so everything that can
  // be expressed as a 2D array is; operations that have no bulk API (borders,
  // merges, checkboxes, data validations, images) are queued as deferred ops
  // and replayed after the flush so the arrays cannot overwrite them.
  const makeGrid = (fill) => {
    const grid = new Array(maxRows);
    for (let r = 0; r < maxRows; r++) grid[r] = new Array(maxCols).fill(fill);
    return grid;
  };
  const values = makeGrid("");
  const backgrounds = makeGrid("#505050");
  const fontColors = makeGrid("#000000");
  const fontWeights = makeGrid("normal");
  const fontStyles = makeGrid("normal");
  const fontLines = makeGrid("none");
  const fontSizes = makeGrid(defaultFontSize);
  const rotations = makeGrid(0);
  const hAligns = makeGrid(defaultHorizontalAlignment);
  const vAligns = makeGrid(defaultVerticalAlignment);
  const notes = makeGrid("");
  const deferredOps = [];

  const writeText = (x, y, text) => {
    values[y - 1][x - 1] = text;
    fontColors[y - 1][x - 1] = currentFillColor;
    fontSizes[y - 1][x - 1] = currentFontSize;
    fontWeights[y - 1][x - 1] = isBold;
    fontStyles[y - 1][x - 1] = isItalic;
    fontLines[y - 1][x - 1] = lineStyle;
    rotations[y - 1][x - 1] = currentRotation;
    hAligns[y - 1][x - 1] = currentHorizontalAlignment;
    vAligns[y - 1][x - 1] = currentVerticalAlignment;
  };

  const fillRegion = (grid, x, y, w, h, value) => {
    const clamped = clampRect(x, y, w, h, maxRows, maxCols);
    if (!clamped) return null;
    for (let r = clamped.y - 1; r < clamped.y - 1 + clamped.h; r++) {
      for (let c = clamped.x - 1; c < clamped.x - 1 + clamped.w; c++) {
        grid[r][c] = value;
      }
    }
    return clamped;
  };

  const drawPageIntoGrids = (topRow, width, height, borderStyle) => {
    const clamped = fillRegion(backgrounds, 1, topRow, width, height, "white");
    if (!clamped) {
      Logger.log(`Skipping page draw entirely outside canvas: topRow=${topRow}, width=${width}, height=${height}`);
      return;
    }
    deferredOps.push(() => {
      renderSheet.getRange(clamped.y, clamped.x, clamped.h, clamped.w)
        .setBorder(true, true, true, true, false, false, "black", borderStyle || mapLineWidth(3));
    });
  };

  renderSheet.getRange(1, 1, maxRows, maxCols)
    .clear({contentsOnly: false, formatOnly: true})
    .clearContent()
    .clearDataValidations()
    .setBorder(false, false, false, false, false, false);

  renderSheet.setColumnWidths(1, maxCols, cellSize);
  renderSheet.setRowHeights(1, maxRows, cellSize);

  let oldImages = renderSheet.getImages();
  for (let k = 0; k < oldImages.length; k++)
    oldImages[k].remove();

  for (let i = 0; i < data.length; i++) {
    let command = data[i][0].toString().trim();
    if (!command) continue;
    if (command.startsWith("%")) continue; // comment line

    // One bad command must not abort the whole render: log it and continue
    // with the next command.
    try {
      let match;

      // --- TEXT --- (parsed first so text content can never be misread as an operator)
      if ((match = command.match(TEXT_COMMAND_PATTERN))) {
        if (isInsideCanvas(currentX, currentY, maxRows, maxCols)) {
          writeText(currentX, currentY, unescapeTextOperand(match[1]));
        } else {
          Logger.log(`Skipping text outside canvas at (${currentX}, ${currentY}): ${command}`);
        }
        continue;
      }

      // --- LINKS ---
      if ((match = command.match(LINK_COMMAND_PATTERN))) {
        let url = unescapeTextOperand(match[1]);
        let label = unescapeTextOperand(match[2]);
        if (isInsideCanvas(currentX, currentY, maxRows, maxCols)) {
          // A link renders with the active text styling (SPEC.md), the same
          // as the Office Scripts renderer — underline and rotation included.
          writeText(currentX, currentY, `=HYPERLINK("${escapeFormulaString(url)}", "${escapeFormulaString(label)}")`);
        } else {
          Logger.log(`Skipping link outside canvas at (${currentX}, ${currentY}): ${command}`);
        }
        continue;
      }

      // --- IMAGE (InsertImage) ---
      if ((match = command.match(INSERT_IMAGE_PATTERN))) {
        let w = parseInt(match[1]);
        let h = parseInt(match[2]);
        let url = unescapeTextOperand(match[3]);
        if (isInsideCanvas(currentX, currentY, maxRows, maxCols)) {
          const imgX = currentX;
          const imgY = currentY;
          deferredOps.push(() => {
            let img = renderSheet.insertImage(url, imgX, imgY);
            img.setWidth(w).setHeight(h);
          });
        }
        continue;
      }

      // --- ANNOTATIONS (/Note) ---
      if ((match = command.match(NOTE_COMMAND_PATTERN))) {
        if (isInsideCanvas(currentX, currentY, maxRows, maxCols)) {
          notes[currentY - 1][currentX - 1] = unescapeTextOperand(match[1]);
        }
        continue;
      }

      // --- ACROFORMS ---
      if (isExactOperator(command, "/CheckBox")) {
        if (isInsideCanvas(currentX, currentY, maxRows, maxCols)) {
          hAligns[currentY - 1][currentX - 1] = "center";
          vAligns[currentY - 1][currentX - 1] = "middle";
          const boxX = currentX;
          const boxY = currentY;
          deferredOps.push(() => {
            renderSheet.getRange(boxY, boxX, 1, 1).insertCheckboxes();
          });
        }
        continue;
      }
      if ((match = command.match(DROPDOWN_COMMAND_PATTERN))) {
        let options = match[1].split(",").map(s => unescapeTextOperand(s.trim()));
        if (isInsideCanvas(currentX, currentY, maxRows, maxCols)) {
          let dropdownWidth = Math.min(6, maxCols - currentX + 1);
          fillRegion(backgrounds, currentX, currentY, dropdownWidth, 1, "#FFF2CC");
          values[currentY - 1][currentX - 1] = options[0];
          hAligns[currentY - 1][currentX - 1] = "center";
          vAligns[currentY - 1][currentX - 1] = "middle";
          const dropX = currentX;
          const dropY = currentY;
          // The dropdown's frame uses the active stroke state, the same as
          // the Office Scripts and VBA renderers.
          const dropStrokeColor = currentStrokeColor;
          const dropStrokeStyle = currentLineWidth;
          deferredOps.push(() => {
            let rule = SpreadsheetApp.newDataValidation().requireValueInList(options, true).build();
            renderSheet.getRange(dropY, dropX, 1, dropdownWidth)
              .merge()
              .setDataValidation(rule)
              .setBorder(true, true, true, true, false, false, dropStrokeColor, dropStrokeStyle);
          });
        }
        continue;
      }

      // --- PAGE SETUP ---
      if ((match = command.match(MEDIABOX_PATTERN))) {
        let parsedWidth = parseInt(match[1]);
        let parsedHeight = parseInt(match[2]);

        if (parsedWidth > 0 && parsedHeight > 0) {
          pageWidth = parsedWidth;
          pageHeight = parsedHeight;
          mediaBoxApplied = true;
          drawPageIntoGrids(pageTopRow, pageWidth, pageHeight, currentLineWidth);
        } else {
          mediaBoxApplied = false;
          Logger.log(`Ignoring MediaBox with invalid dimensions: ${command}`);
        }
        continue;
      }
      if (isExactOperator(command, "/NewPage")) {
        if (!mediaBoxApplied || pageWidth <= 0 || pageHeight <= 0) {
          Logger.log("/NewPage encountered before MediaBox was applied; skipping page break.");
        } else {
          pageTopRow = pageTopRow + pageHeight + 2;
          currentX = 1;
          currentY = pageTopRow;
          drawPageIntoGrids(pageTopRow, pageWidth, pageHeight, currentLineWidth);
        }
        continue;
      }

      // --- LINE WIDTH ---
      if ((match = command.match(LINE_WIDTH_PATTERN))) {
        currentLineWidth = mapLineWidth(parseInt(match[1]));
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
          if (isExactOperator(command, "f")) {
            const clamped = fillRegion(backgrounds, currentPath.x, currentPath.y, currentPath.w, currentPath.h, currentFillColor);
            if (!clamped) Logger.log(`Skipping path entirely outside canvas: ${JSON.stringify(currentPath)}`);
          } else {
            const clamped = clampRect(currentPath.x, currentPath.y, currentPath.w, currentPath.h, maxRows, maxCols);
            if (clamped) {
              const strokeColor = currentStrokeColor;
              const strokeWidth = currentLineWidth;
              deferredOps.push(() => {
                renderSheet.getRange(clamped.y, clamped.x, clamped.h, clamped.w)
                  .setBorder(true, true, true, true, false, false, strokeColor, strokeWidth);
              });
            } else {
              Logger.log(`Skipping path entirely outside canvas: ${JSON.stringify(currentPath)}`);
            }
          }
        }
        continue;
      }

      // --- PIXEL IMAGES ---
      if ((match = command.match(PIXEL_ART_PATTERN))) {
        let width = parseInt(match[1]);
        let height = parseInt(match[2]);
        let pixelData = match[3];
        if (pixelData && pixelData.length >= (width * height)) {
          for (let r = 0; r < height; r++) {
            for (let c = 0; c < width; c++) {
              let colorCode = pixelData[(r * width) + c];
              let pixelColor = null;
              if (colorCode === '1') pixelColor = "#000000";
              if (colorCode === '2') pixelColor = "#F1C40F";
              if (colorCode === '3') pixelColor = "#E74C3C";
              if (pixelColor && isInsideCanvas(currentX + c, currentY + r, maxRows, maxCols)) {
                backgrounds[currentY + r - 1][currentX + c - 1] = pixelColor;
              }
            }
          }
        }
        continue;
      }

      // --- ROTATION / ALIGNMENT ---
      if (command.split(/\s+/).indexOf(ROTATE_TOKEN) >= 0) {
        const rotationCandidate = parseRotationOperand(command);
        if (rotationCandidate !== null) {
          currentRotation = rotationCandidate;
        }
        continue;
      }
      if ((match = command.match(ALIGN_COMMAND_PATTERN))) {
        let alignDirective = match[1];
        if (alignDirective === "HCenter") currentHorizontalAlignment = "center";
        if (alignDirective === "HRight") currentHorizontalAlignment = "right";
        if (alignDirective === "HLeft") currentHorizontalAlignment = "left";
        if (alignDirective === "VMiddle") currentVerticalAlignment = "middle";
        if (alignDirective === "VBottom") currentVerticalAlignment = "bottom";
        if (alignDirective === "VTop") currentVerticalAlignment = "top";
        continue;
      }

      // --- COLORS ---
      if ((match = command.match(FILL_COLOR_PATTERN))) {
        currentFillColor = rgbToHex(match[1]*255, match[2]*255, match[3]*255);
        continue;
      }
      if ((match = command.match(STROKE_COLOR_PATTERN))) {
        currentStrokeColor = rgbToHex(match[1]*255, match[2]*255, match[3]*255);
        continue;
      }

      // --- TYPOGRAPHY ---
      if ((match = command.match(FONT_COMMAND_PATTERN))) {
        isBold = match[1] === "2" ? "bold" : "normal";
        isItalic = match[1] === "3" ? "italic" : "normal";
        if (match[2] !== undefined) {
          const parsedTfSize = parseFloat(match[2]);
          currentFontSize = parsedTfSize > 0 ? parsedTfSize : defaultFontSize;
        }
        continue;
      }
      if ((match = command.match(UNDERLINE_PATTERN))) {
        lineStyle = match[1] === "1" ? "underline" : "none";
        continue;
      }
      if ((match = command.match(FONT_SIZE_PATTERN))) {
        let parsedFontSize = parseFloat(match[1]);
        currentFontSize = (!isNaN(parsedFontSize) && parsedFontSize > 0) ? parsedFontSize : defaultFontSize;
        continue;
      }
      if ((match = command.match(ALIGN_CODE_PATTERN))) {
        let alignmentCode = parseInt(match[1]);
        if (alignmentCode === 0) currentHorizontalAlignment = "left";
        if (alignmentCode === 1) currentHorizontalAlignment = "center";
        if (alignmentCode === 2) currentHorizontalAlignment = "right";
        if (alignmentCode === 3) currentVerticalAlignment = "top";
        if (alignmentCode === 4) currentVerticalAlignment = "middle";
        if (alignmentCode === 5) currentVerticalAlignment = "bottom";
        if (alignmentCode >= 6) {
          currentHorizontalAlignment = defaultHorizontalAlignment;
          currentVerticalAlignment = defaultVerticalAlignment;
        }
        continue;
      }

      // --- CURSOR ---
      if ((match = command.match(TD_PATTERN))) {
        let deltaX = parseFloat(match[1]);
        let deltaY = parseFloat(match[2]);
        if (!isNaN(deltaX) && !isNaN(deltaY)) {
          currentX += Math.trunc(deltaX / 10);
          currentY += Math.trunc(deltaY / 10);
        }
        continue;
      }
      if ((match = command.match(MOVE_TO_PATTERN))) {
        let targetX = parseInt(match[1]);
        let targetY = parseInt(match[2]);

        let maxX = pageWidth > 0 ? pageWidth : maxCols;
        let pageBottom = pageHeight > 0 ? pageTopRow + pageHeight - 1 : maxRows;

        currentX = Math.max(1, Math.min(maxX, targetX));
        currentY = Math.max(pageTopRow, Math.min(pageBottom, pageTopRow + targetY - 1));
        continue;
      }

      Logger.log(`Skipped unrecognized command: ${command}`);
    } catch (err) {
      Logger.log(`Error processing command "${command}" (stream row ${i + 2}): ${err}`);
    }
  }

  // Flush the grids in a fixed number of bulk calls, then replay the ops that
  // have no bulk API (borders, merges, checkboxes, validations, images).
  const canvas = renderSheet.getRange(1, 1, maxRows, maxCols);
  canvas.setValues(values);
  canvas.setBackgrounds(backgrounds);
  canvas.setFontColors(fontColors);
  canvas.setFontWeights(fontWeights);
  canvas.setFontStyles(fontStyles);
  canvas.setFontLines(fontLines);
  canvas.setFontSizes(fontSizes);
  canvas.setTextRotations(rotations);
  canvas.setHorizontalAlignments(hAligns);
  canvas.setVerticalAlignments(vAligns);
  canvas.setNotes(notes);

  for (let d = 0; d < deferredOps.length; d++) {
    try {
      deferredOps[d]();
    } catch (err) {
      Logger.log(`Error applying deferred operation ${d}: ${err}`);
    }
  }
}

function isExactOperator(command, operator) {
  return command === operator;
}

function isInsideCanvas(x, y, maxRows, maxCols) {
  return x >= 1 && x <= maxCols && y >= 1 && y <= maxRows;
}

// Doubles quotes so URL/label content stays inside the HYPERLINK formula's
// string literal instead of breaking the formula or injecting a new one.
function escapeFormulaString(value) {
  return String(value).replace(/"/g, '""');
}

// Resolves \( \) \\ escape sequences in a matched text operand.
function unescapeTextOperand(value) {
  return value.replace(/\\([()\\])/g, "$1");
}

function clampRect(x, y, w, h, maxRows, maxCols) {
  const x1 = Math.max(1, x);
  const y1 = Math.max(1, y);
  const x2 = Math.min(maxCols, x + w - 1);
  const y2 = Math.min(maxRows, y + h - 1);
  if (x2 < x1 || y2 < y1) return null;
  return {x: x1, y: y1, w: x2 - x1 + 1, h: y2 - y1 + 1};
}

function parseRectangleCommand(command) {
  if (!RECTANGLE_COMMAND_PATTERN.test(command)) return null;
  const parts = command.trim().split(/\s+/);
  return {
    x: Math.floor(parseFloat(parts[0])),
    y: Math.floor(parseFloat(parts[1])),
    w: Math.floor(parseFloat(parts[2])),
    h: Math.floor(parseFloat(parts[3]))
  };
}

function rgbToHex(r, g, b) {
  const clamp = (value) => {
    // Components are scaled by 255 and rounded to nearest (SPEC.md), so
    // "0.5 0.5 0.5 rg" is #808080 in every renderer.
    const n = Math.round(Number(value));
    if (isNaN(n)) return 0;
    return Math.max(0, Math.min(255, n));
  };
  return "#" + ((1 << 24) + (clamp(r) << 16) + (clamp(g) << 8) + clamp(b)).toString(16).slice(1);
}

function mapLineWidth(widthValue) {
  // Canonical SPDL stroke width mapping (shared across renderers):
  // 1 = thin, 2 = medium, 3 = thick, 4 = double.
  if (widthValue === 1) return SpreadsheetApp.BorderStyle.SOLID;
  if (widthValue === 2) return SpreadsheetApp.BorderStyle.SOLID_MEDIUM;
  if (widthValue === 3) return SpreadsheetApp.BorderStyle.SOLID_THICK;
  if (widthValue === 4) return SpreadsheetApp.BorderStyle.DOUBLE;
  return SpreadsheetApp.BorderStyle.SOLID;
}

function parseRotationOperand(command) {
  const parts = command.trim().split(/\s+/);
  const rotateIndex = parts.indexOf("/Rotate");
  if (rotateIndex < 0) return null;

  const candidates = [];
  if (rotateIndex + 1 < parts.length) candidates.push(parts[rotateIndex + 1]);
  if (rotateIndex - 1 >= 0) candidates.push(parts[rotateIndex - 1]);

  for (let i = 0; i < candidates.length; i++) {
    const value = Number(candidates[i]);
    if (Number.isFinite(value)) return Math.trunc(value);
  }

  return null;
}
