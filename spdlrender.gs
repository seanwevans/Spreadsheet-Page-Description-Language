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

  renderSheet.getRange(1, 1, maxRows, maxCols)
    .clear({contentsOnly: false, formatOnly: true})
    .clearContent()
    .clearDataValidations()
    .setBackground("#505050")
    .setFontColor("black")
    .setFontSize(currentFontSize)
    .setFontWeight("normal")
    .setFontStyle("normal")
    .setFontLine("none")
    .setTextRotation(0)
    .setBorder(false, false, false, false, false, false);

  renderSheet.setColumnWidths(1, maxCols, cellSize);
  renderSheet.setRowHeights(1, maxRows, cellSize);

  let oldImages = renderSheet.getImages();
  for (let k = 0; k < oldImages.length; k++)
    oldImages[k].remove();

  for (let i = 0; i < data.length; i++) {
    let command = data[i][0].toString().trim();
    let bounds = getActiveBounds(mediaBoxApplied, pageTopRow, pageWidth, pageHeight, maxRows, maxCols);

    // --- IMAGE (InsertImage) ---
    if (command.includes("/InsertImage")) {
       let match = command.match(/\(([^)]+)\)/);
       if (match) {
         let url = match[1];
         let remaining = command.replace(match[0], "");
         let nums = remaining.trim().split(" ");
         let w = parseInt(nums[0]);
         let h = parseInt(nums[1]);

         if (currentY > 0 && currentX > 0) {
           let img = renderSheet.insertImage(url, currentX, currentY);
           img.setWidth(w).setHeight(h);
         }
       }
    }

    // --- ANNOTATIONS (/Note) ---
    if (command.includes("/Note")) {
       let match = command.match(/\(([^)]+)\)/);
       if (match) {
         let targetCell = clampCellWrite(currentX, currentY, bounds, "/Note");
         if (targetCell) renderSheet.getRange(targetCell.y, targetCell.x).setNote(match[1]);
       }
    }

    // --- ACROFORMS ---
    if (command.includes("/CheckBox")) {
       let checkboxRect = clampRect(currentX, currentY, 1, 1, bounds, "/CheckBox");
       if (checkboxRect) {
         let range = renderSheet.getRange(checkboxRect.y, checkboxRect.x, checkboxRect.h, checkboxRect.w);
         range.merge().insertCheckboxes().setHorizontalAlignment("center").setVerticalAlignment("middle");
       }
    }
    if (command.includes("/Dropdown")) {
       let match = command.match(/\(([^)]+)\)/);
       if (match) {
         let options = match[1].split(",").map(s => s.trim());
         let rule = SpreadsheetApp.newDataValidation().requireValueInList(options, true).build();
         let dropdownRect = clampRect(currentX, currentY, 1, 6, bounds, "/Dropdown");
         if (dropdownRect) {
           let range = renderSheet.getRange(dropdownRect.y, dropdownRect.x, dropdownRect.h, dropdownRect.w);
           range.merge()
            .setDataValidation(rule)
            .setValue(options[0])
            .setBackground("#FFF2CC")
            .setHorizontalAlignment("center")
            .setVerticalAlignment("middle")
            .setBorder(true, true, true, true, false, false, "black", SpreadsheetApp.BorderStyle.SOLID);
         }
       }
    }

    // --- PAGE SETUP ---
    if (command.includes("MediaBox")) {
      let parts = command.split(" ");
      let parsedWidth = parseInt(parts[0]);
      let parsedHeight = parseInt(parts[1]);

      if (parsedWidth > 0 && parsedHeight > 0) {
        pageWidth = parsedWidth;
        pageHeight = parsedHeight;
        mediaBoxApplied = true;
        drawPageIfValid(renderSheet, pageTopRow, pageWidth, pageHeight, currentLineWidth);
      } else {
        mediaBoxApplied = false;
        Logger.log(`Ignoring MediaBox with invalid dimensions: ${command}`);
      }
    }
    if (command.includes("/NewPage")) {
      if (!mediaBoxApplied || pageWidth <= 0 || pageHeight <= 0) {
        Logger.log("/NewPage encountered before MediaBox was applied; skipping page break.");
      } else {
        pageTopRow = pageTopRow + pageHeight + 2;
        currentX = 1;
        currentY = pageTopRow;
        drawPageIfValid(renderSheet, pageTopRow, pageWidth, pageHeight, currentLineWidth);
      }
    }

    // --- LINE WIDTH ---
    let lineWidthMatch = command.match(/^(\d+)\s+w\b/);
    if (lineWidthMatch) {
      let widthValue = parseInt(lineWidthMatch[1]);
      currentLineWidth = mapLineWidth(widthValue);
    }

    // --- SHAPES ---
    if (command.includes("re")) {
      let parts = command.split(" ");
      currentPath.x = Math.floor(parseInt(parts[0]));
      currentPath.y = pageTopRow + Math.floor(parseInt(parts[1]));
      currentPath.w = Math.floor(parseInt(parts[2]));
      currentPath.h = Math.floor(parseInt(parts[3]));
    }
    if (command === "f" || command === "S") {
       let pathRect = clampRect(currentPath.x, currentPath.y, currentPath.h, currentPath.w, bounds, command === "f" ? "fill rect" : "stroke rect");
       if (pathRect) {
         let range = renderSheet.getRange(pathRect.y, pathRect.x, pathRect.h, pathRect.w);
         if (command === "f") range.setBackground(currentFillColor);
         if (command === "S") range.setBorder(true, true, true, true, false, false, currentStrokeColor, currentLineWidth);
       }
    }

    // --- PIXEL IMAGES ---
    if (command.includes("ID")) {
      let parts = command.split(" ");
      let width = parseInt(parts[0]);
      let height = parseInt(parts[1]);
      let pixelData = parts[3];
      if (pixelData && pixelData.length >= (width * height)) {
        let pixelRect = clampRect(currentX, currentY, height, width, bounds, "pixel-art");
        if (pixelRect) {
          for (let r = 0; r < pixelRect.h; r++) {
            for (let c = 0; c < pixelRect.w; c++) {
              let sourceRow = pixelRect.sourceRowOffset + r;
              let sourceCol = pixelRect.sourceColOffset + c;
              let colorCode = pixelData[(sourceRow * width) + sourceCol];
              let pixelColor = null;
              if (colorCode === '1') pixelColor = "#000000";
              if (colorCode === '2') pixelColor = "#F1C40F";
              if (colorCode === '3') pixelColor = "#E74C3C";
              if (pixelColor) renderSheet.getRange(pixelRect.y + r, pixelRect.x + c).setBackground(pixelColor);
            }
          }
        }
      }
    }

    // --- LINKS & TEXT ---
    if (command.includes("/Link")) {
        let matches = command.match(/\(([^)]+)\)/g);
      if (matches && matches.length >= 2) {
        let url = matches[0].replace(/[()]/g, "");
        let label = matches[1].replace(/[()]/g, "");
        let targetCell = clampCellWrite(currentX, currentY, bounds, "/Link");
        if (!targetCell) continue;
        let cell = renderSheet.getRange(targetCell.y, targetCell.x);
        cell.setFormula(`=HYPERLINK("${url}", "${label}")`);
        cell.setFontColor(currentFillColor).setFontWeight(isBold).setFontStyle(isItalic);
        cell.setFontWeight(isBold).setFontStyle(isItalic).setHorizontalAlignment(currentHorizontalAlignment).setVerticalAlignment(currentVerticalAlignment);
      }
    }
    if (command.includes("/Rotate")) {
       let parts = command.split(" ");
       currentRotation = parseInt(parts[0]);
    }
    if (command.includes("/Align")) {
      let parts = command.trim().split(/\s+/);
      let alignDirective = parts[1];
      if (alignDirective && alignDirective.startsWith("H")) {
        if (alignDirective === "HCenter") currentHorizontalAlignment = "center";
        if (alignDirective === "HRight") currentHorizontalAlignment = "right";
        if (alignDirective === "HLeft") currentHorizontalAlignment = "left";
      }
      if (alignDirective && alignDirective.startsWith("V")) {
        if (alignDirective === "VMiddle") currentVerticalAlignment = "middle";
        if (alignDirective === "VBottom") currentVerticalAlignment = "bottom";
        if (alignDirective === "VTop") currentVerticalAlignment = "top";
      }
    }
    if (command.includes("rg")) {
      let parts = command.split(" ");
      currentFillColor = rgbToHex(parts[0]*255, parts[1]*255, parts[2]*255);
    }
    if (/\bSC\b/.test(command)) {
      let parts = command.trim().split(/\s+/);
      let scIndex = parts.indexOf("SC");
      if (scIndex >= 3) {
        currentStrokeColor = rgbToHex(parts[scIndex-3]*255, parts[scIndex-2]*255, parts[scIndex-1]*255);
      }
    }
    if (command.includes("Tf")) {
      isBold = command.includes("/F2") ? "bold" : "normal";
      isItalic = command.includes("/F3") ? "italic" : "normal";
    }
    if (command.includes("Tr")) {
      lineStyle = command.startsWith("1") ? "underline" : "none";
    }
    if (command.match(/\d+\s+TA/)) {
      let match = command.match(/(\d+)\s+TA/);
      if (match) {
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
      }
    }
    if (command.includes("Td")) {
      let parts = command.split(" ");
      currentX += Math.floor(parseInt(parts[0]) / 10);
      currentY += Math.floor(parseInt(parts[1]) / 10);
    }
    if (command.includes("/MoveTo")) {
      let parts = command.split(" ");
      let targetX = parseInt(parts[1]);
      let targetY = parseInt(parts[2]);

      if (!isNaN(targetX) && !isNaN(targetY)) {
        let maxX = pageWidth > 0 ? pageWidth : maxCols;
        let pageBottom = pageHeight > 0 ? pageTopRow + pageHeight - 1 : maxRows;

        targetX = Math.max(1, Math.min(maxX, targetX));
        targetY = Math.max(pageTopRow, Math.min(pageBottom, pageTopRow + targetY - 1));

        currentX = targetX;
        currentY = targetY;
      }
    }
    if (command.includes("Tj")) {
      let match = command.match(/\(([^)]+)\)/);
        if (match) {
         let targetCell = clampCellWrite(currentX, currentY, bounds, "Tj");
         if (!targetCell) continue;
         let cell = renderSheet.getRange(targetCell.y, targetCell.x);
         cell.setValue(match[1]);
         cell.setFontColor(currentFillColor)
             .setFontWeight(isBold)
             .setFontStyle(isItalic)
             .setFontLine(lineStyle)
             .setTextRotation(currentRotation)
             .setHorizontalAlignment(currentHorizontalAlignment)
             .setVerticalAlignment(currentVerticalAlignment);
      }
    }
  }
}

function getActiveBounds(mediaBoxApplied, pageTopRow, pageWidth, pageHeight, maxRows, maxCols) {
  if (mediaBoxApplied && pageWidth > 0 && pageHeight > 0) {
    return { minX: 1, maxX: pageWidth, minY: pageTopRow, maxY: pageTopRow + pageHeight - 1, mode: "MediaBox" };
  }
  return { minX: 1, maxX: maxCols, minY: 1, maxY: maxRows, mode: "canvas" };
}

function clampCellWrite(x, y, bounds, operationName) {
  if (x < bounds.minX || x > bounds.maxX || y < bounds.minY || y > bounds.maxY) {
    Logger.log(`Skipping ${operationName}: cell (${x}, ${y}) is outside ${bounds.mode} bounds [x:${bounds.minX}-${bounds.maxX}, y:${bounds.minY}-${bounds.maxY}]`);
    return null;
  }
  return { x: x, y: y };
}

function clampRect(x, y, h, w, bounds, operationName) {
  if (h <= 0 || w <= 0) {
    Logger.log(`Skipping ${operationName}: invalid range size h=${h}, w=${w}`);
    return null;
  }
  let startX = x;
  let startY = y;
  let endX = x + w - 1;
  let endY = y + h - 1;
  let clampedStartX = Math.max(bounds.minX, startX);
  let clampedStartY = Math.max(bounds.minY, startY);
  let clampedEndX = Math.min(bounds.maxX, endX);
  let clampedEndY = Math.min(bounds.maxY, endY);
  if (clampedStartX > clampedEndX || clampedStartY > clampedEndY) {
    Logger.log(`Skipping ${operationName}: range (${startX}, ${startY}, h=${h}, w=${w}) is outside ${bounds.mode} bounds [x:${bounds.minX}-${bounds.maxX}, y:${bounds.minY}-${bounds.maxY}]`);
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

  function drawPage(sheet, topRow, width, height, borderStyle) {
    let pageRange = sheet.getRange(topRow, 1, height, width);
    pageRange.setBackground("white");
    pageRange.setBorder(true, true, true, true, false, false, "black", borderStyle || mapLineWidth(3));
  }

  function drawPageIfValid(sheet, topRow, width, height, borderStyle) {
    if (width > 0 && height > 0) {
      drawPage(sheet, topRow, width, height, borderStyle);
    } else {
      Logger.log(`Skipping page draw due to non-positive dimensions: width=${width}, height=${height}`);
    }
  }

function rgbToHex(r, g, b) {
  return "#" + ((1 << 24) + (Math.floor(r) << 16) + (Math.floor(g) << 8) + Math.floor(b)).toString(16).slice(1);
}

function mapLineWidth(widthValue) {
  if (widthValue === 1) return SpreadsheetApp.BorderStyle.SOLID;
  if (widthValue === 2) return SpreadsheetApp.BorderStyle.SOLID_MEDIUM;
  if (widthValue === 3) return SpreadsheetApp.BorderStyle.SOLID_THICK;
  if (widthValue === 4) return SpreadsheetApp.BorderStyle.DOUBLE;
  return SpreadsheetApp.BorderStyle.SOLID;
}
