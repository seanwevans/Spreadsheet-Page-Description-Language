function renderPDF() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sourceSheet = ss.getSheetByName("01_Hex_Stream");
  const renderSheet = ss.getSheetByName("02_Rendered_View");
  const data = sourceSheet.getRange(2, 1, sourceSheet.getLastRow() - 1).getValues();
  const maxRows = 1000;
  const maxCols = 26;

  const defaultHorizontalAlignment = renderSheet.getRange(1, 1).getHorizontalAlignment() || "left";
  const defaultVerticalAlignment = renderSheet.getRange(1, 1).getVerticalAlignment() || "top";
  
  let currentX = 1;
  let currentY = 1;
  let currentColor = "#000000";    
  let isBold = "normal";
  let isItalic = "normal";
  let lineStyle = "none";
  let currentLineWidth = mapLineWidth(3);
  let currentRotation = 0;
  let currentPath = {x:0, y:0, w:0, h:0};
  let pageTopRow = 1;
  let pageWidth = 0;
  let pageHeight = 0;
  let cellSize = 25;
  let defaultFontSize = 15;
  let currentHorizontalAlignment = defaultHorizontalAlignment;
  let currentVerticalAlignment = defaultVerticalAlignment;

  renderSheet.getRange(1, 1, maxRows, maxCols)
    .clear({contentsOnly: false, formatOnly: true})
    .clearContent()
    .clearDataValidations()
    .setBackground("#505050")
    .setFontColor("black")
    .setFontSize(defaultFontSize)
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
      pageWidth = parseInt(parts[0]);
      pageHeight = parseInt(parts[1]);
      drawPage(renderSheet, pageTopRow, pageWidth, pageHeight, currentLineWidth);
    }
    if (command.includes("/NewPage")) {
      pageTopRow = pageTopRow + pageHeight + 2;
      currentX = 1;
      currentY = pageTopRow;
      drawPage(renderSheet, pageTopRow, pageWidth, pageHeight, currentLineWidth);
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
         if (command === "f") range.setBackground(currentColor);
         if (command === "S") range.setBorder(true, true, true, true, false, false, currentColor, currentLineWidth);
       }
    }

    // --- PIXEL IMAGES ---    
    if (command.includes("ID")) {
      let parts = command.split(" ");
      let width = parseInt(parts[0]);
      let height = parseInt(parts[1]);
      let pixelData = parts[3];
      if (pixelData && pixelData.length >= (width * height)) {
        for (let r = 0; r < height; r++) {        
          for (let c = 0; c < width; c++) {
            let colorCode = pixelData[(r * width) + c];
            let pixelColor = null;
            if (colorCode === '1') pixelColor = "#000000"; 
            if (colorCode === '2') pixelColor = "#F1C40F"; 
            if (colorCode === '3') pixelColor = "#E74C3C"; 
            if (pixelColor) renderSheet.getRange(currentY + r, currentX + c).setBackground(pixelColor);
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
        let cell = renderSheet.getRange(currentY, currentX);
        cell.setFormula(`=HYPERLINK("${url}", "${label}")`);
        cell.setFontWeight(isBold)
            .setFontStyle(isItalic)
            .setHorizontalAlignment(currentHorizontalAlignment)
            .setVerticalAlignment(currentVerticalAlignment);
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
      currentColor = rgbToHex(parts[0]*255, parts[1]*255, parts[2]*255);
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
           let cell = renderSheet.getRange(currentY, currentX);
           cell.setValue(match[1]);
           cell.setFontColor(currentColor)
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
}

function drawPage(sheet, topRow, width, height, borderStyle) {
  let pageRange = sheet.getRange(topRow, 1, height, width);
  pageRange.setBackground("white");
  pageRange.setBorder(true, true, true, true, false, false, "black", borderStyle || mapLineWidth(3));
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