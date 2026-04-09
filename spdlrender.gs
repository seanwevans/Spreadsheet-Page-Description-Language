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
  let pendingTextOps = [];

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
         if (currentY > 0 && currentX > 0) {
           renderSheet.getRange(currentY, currentX).setNote(match[1]);
         }
       }
    }

    // --- ACROFORMS ---
    if (command.includes("/CheckBox")) {
       if (currentY > 0 && currentX > 0) {
         let range = renderSheet.getRange(currentY, currentX, 1, 1);
         range.merge().insertCheckboxes().setHorizontalAlignment("center").setVerticalAlignment("middle");
       }
    }
    if (command.includes("/Dropdown")) {
       let match = command.match(/\(([^)]+)\)/);
       if (match) {
         let options = match[1].split(",").map(s => s.trim());
         let rule = SpreadsheetApp.newDataValidation().requireValueInList(options, true).build();
         if (currentY > 0 && currentX > 0) {
           let range = renderSheet.getRange(currentY, currentX, 1, 6);
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
       if (currentPath.w > 0 && currentPath.h > 0) {
         let range = renderSheet.getRange(currentPath.y, currentPath.x, currentPath.h, currentPath.w);
         if (command === "f") {
           range.setBackground(currentFillColor);
         } else {
           range.setBorder(true, true, true, true, false, false, currentStrokeColor, currentLineWidth);
         }
       }
    }

    // --- PIXEL IMAGES ---    
    if (command.includes("ID")) {
      let parts = command.split(" ");
      let width = parseInt(parts[0]);
      let height = parseInt(parts[1]);
      let pixelData = parts[3];
      if (pixelData && pixelData.length >= (width * height)) {
        const pixelRange = renderSheet.getRange(currentY, currentX, height, width);
        const backgrounds = pixelRange.getBackgrounds();
        for (let r = 0; r < height; r++) {
          for (let c = 0; c < width; c++) {
            let colorCode = pixelData[(r * width) + c];
            if (colorCode === '1') backgrounds[r][c] = "#000000";
            if (colorCode === '2') backgrounds[r][c] = "#F1C40F";
            if (colorCode === '3') backgrounds[r][c] = "#E74C3C";
          }
        }
        pixelRange.setBackgrounds(backgrounds);
      }
    }

    // --- LINKS & TEXT ---
    if (command.includes("/Link")) {
      let matches = command.match(/\(([^)]+)\)/g);
      if (matches && matches.length >= 2) {
        let url = matches[0].replace(/[()]/g, "");
        let label = matches[1].replace(/[()]/g, "");
        pendingTextOps.push({
          row: currentY,
          col: currentX,
          value: `=HYPERLINK("${url}", "${label}")`,
          isFormula: true,
          style: {
            color: currentFillColor,
            weight: isBold,
            style: isItalic,
            line: lineStyle,
            rotation: currentRotation,
            hAlign: currentHorizontalAlignment,
            vAlign: currentVerticalAlignment
          }
        });
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
         if (currentY > 0 && currentX > 0) {
           pendingTextOps.push({
             row: currentY,
             col: currentX,
             value: match[1],
             isFormula: false,
             style: {
               color: currentFillColor,
               weight: isBold,
               style: isItalic,
               line: lineStyle,
               rotation: currentRotation,
               hAlign: currentHorizontalAlignment,
               vAlign: currentVerticalAlignment
             }
           });
         }
      }
    }
  }

  flushPendingTextOps(renderSheet, pendingTextOps);
}

function flushPendingTextOps(sheet, textOps) {
  if (!textOps || textOps.length === 0) return;

  const sorted = textOps.slice().sort((a, b) => (a.row - b.row) || (a.col - b.col));
  let i = 0;
  while (i < sorted.length) {
    const base = sorted[i];
    const row = base.row;
    const startCol = base.col;
    const isFormula = base.isFormula;
    const values = [base.value];
    let endCol = startCol;
    i++;
    while (i < sorted.length && sorted[i].row === row && sorted[i].col === endCol + 1 && sorted[i].isFormula === isFormula) {
      values.push(sorted[i].value);
      endCol = sorted[i].col;
      i++;
    }
    const range = sheet.getRange(row, startCol, 1, values.length);
    if (isFormula) {
      range.setFormulas([values]);
    } else {
      range.setValues([values]);
    }
  }

  const styleMap = {};
  for (const op of sorted) {
    const key = [
      op.style.color,
      op.style.weight,
      op.style.style,
      op.style.line,
      op.style.rotation,
      op.style.hAlign,
      op.style.vAlign
    ].join("|");
    if (!styleMap[key]) {
      styleMap[key] = { style: op.style, a1: [] };
    }
    styleMap[key].a1.push(toA1(op.row, op.col));
  }

  Object.keys(styleMap).forEach((key) => {
    const entry = styleMap[key];
    const rangeList = sheet.getRangeList(entry.a1);
    rangeList
      .setFontColor(entry.style.color)
      .setFontWeight(entry.style.weight)
      .setFontStyle(entry.style.style)
      .setFontLine(entry.style.line)
      .setTextRotation(entry.style.rotation)
      .setHorizontalAlignment(entry.style.hAlign)
      .setVerticalAlignment(entry.style.vAlign);
  });
}

function toA1(row, col) {
  let n = col;
  let label = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    label = String.fromCharCode(65 + rem) + label;
    n = Math.floor((n - 1) / 26);
  }
  return `${label}${row}`;
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
