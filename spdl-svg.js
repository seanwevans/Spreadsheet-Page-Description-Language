/**
 * Renders a parsed SPDL document to standalone SVG (or an HTML page wrapping
 * it), so a stream can be looked at without a spreadsheet.
 *
 * This is a *view* of the reference parser's output, not a sixth renderer:
 * it consumes `parseSpdlDocument` and draws what the cell operations say.
 * That makes it useful for reviewing a golden diff visually, for embedding a
 * stream's output in documentation, and as a zero-setup way to try SPDL.
 *
 * Like spdl-parser.js this is a UMD bundle, so it also loads in a browser.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory(require("./spdl-parser.js"));
  } else {
    root.SPDLSvg = factory(root.SPDL);
  }
})(typeof self !== "undefined" ? self : this, function (SPDL) {
  "use strict";

  const DEFAULTS = {
    cellSize: 25,
    // The sheet colour the spreadsheet renderers paint outside the page.
    background: "#505050",
    pageBackground: "#ffffff",
    pageBorder: "#000000",
    fontFamily: "Arial, Helvetica, sans-serif",
    margin: 10,
    // Never emit an unbounded canvas for a stream that draws far off-sheet.
    maxRows: 1000,
    maxCols: 26,
  };

  const BORDER_WIDTHS = { thin: 1, medium: 2, thick: 3, double: 3 };

  function escapeXml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  // SPDL's alignment directives map onto SVG's text-anchor and the cell's
  // horizontal extent; the vertical directives pick a baseline offset.
  function horizontalPlacement(alignment, x, width) {
    if (alignment === "HCenter") return { anchor: "middle", x: x + width / 2 };
    if (alignment === "HRight") return { anchor: "end", x: x + width - 3 };
    return { anchor: "start", x: x + 3 };
  }

  function verticalPlacement(alignment, y, height, fontSize) {
    if (alignment === "VMiddle") return y + height / 2 + fontSize * 0.35;
    if (alignment === "VBottom") return y + height - 4;
    return y + Math.min(height - 4, fontSize);
  }

  function documentExtent(document, options) {
    let rows = 1;
    let cols = 1;
    for (const page of document.pages) {
      rows = Math.max(rows, page.top + page.height - 1);
      cols = Math.max(cols, page.width);
    }
    for (const record of document.records) {
      rows = Math.max(rows, record.fields.Row);
      cols = Math.max(cols, record.fields.Col);
    }
    return {
      rows: Math.min(rows, options.maxRows),
      cols: Math.min(cols, options.maxCols),
    };
  }

  /**
   * Draws one cell operation. Records are applied in stream order, so a later
   * write paints over an earlier one exactly as it does on a sheet.
   */
  /**
   * Works out which cell edges to actually draw.
   *
   * `S` records a border on every cell of a rectangle's perimeter, but a
   * spreadsheet draws one outline around the range — so drawing all four
   * edges of every bordered cell turns a stroked rectangle into a grid of
   * boxes with a second outline inside it. An edge is suppressed when it
   * faces a cell with the same border, or a cell *enclosed* by that border.
   *
   * Enclosure is decided per connected group of identically bordered cells:
   * flood fill the group's bounding box from outside, and anything the fill
   * cannot reach is inside the ring. Two separate rectangles are separate
   * groups, so the edges facing each other are still drawn.
   */
  function borderMap(records) {
    const signatures = new Map();
    for (const { fields } of records) {
      if (fields.BorderColor) {
        signatures.set(`${fields.Row},${fields.Col}`, `${fields.BorderColor}|${fields.BorderStyle}`);
      }
    }

    const enclosed = new Set();
    const visited = new Set();
    const neighbors = [[-1, 0], [1, 0], [0, -1], [0, 1]];

    for (const [id, signature] of signatures) {
      if (visited.has(id)) continue;

      // Collect the connected group of cells sharing this border.
      const group = new Set();
      const queue = [id];
      visited.add(id);
      let minRow = Infinity; let maxRow = -Infinity;
      let minCol = Infinity; let maxCol = -Infinity;

      while (queue.length > 0) {
        const current = queue.pop();
        group.add(current);
        const [row, col] = current.split(",").map(Number);
        minRow = Math.min(minRow, row); maxRow = Math.max(maxRow, row);
        minCol = Math.min(minCol, col); maxCol = Math.max(maxCol, col);

        for (const [dRow, dCol] of neighbors) {
          const next = `${row + dRow},${col + dCol}`;
          if (visited.has(next) || signatures.get(next) !== signature) continue;
          visited.add(next);
          queue.push(next);
        }
      }

      // Flood the bounding box (grown by one ring) from its edge, over cells
      // that are not part of the group.
      const outside = new Set();
      const boxMinRow = minRow - 1; const boxMaxRow = maxRow + 1;
      const boxMinCol = minCol - 1; const boxMaxCol = maxCol + 1;
      const fill = [`${boxMinRow},${boxMinCol}`];
      while (fill.length > 0) {
        const current = fill.pop();
        if (outside.has(current) || group.has(current)) continue;
        const [row, col] = current.split(",").map(Number);
        if (row < boxMinRow || row > boxMaxRow || col < boxMinCol || col > boxMaxCol) continue;
        outside.add(current);
        for (const [dRow, dCol] of neighbors) fill.push(`${row + dRow},${col + dCol}`);
      }

      for (let row = minRow; row <= maxRow; row += 1) {
        for (let col = minCol; col <= maxCol; col += 1) {
          const cell = `${row},${col}`;
          if (!group.has(cell) && !outside.has(cell)) enclosed.add(`${signature}@${cell}`);
        }
      }
    }

    return { signatures, enclosed };
  }

  function renderRecord(fields, options, out, borders) {
    const size = options.cellSize;
    const x = (fields.Col - 1) * size;
    const y = (fields.Row - 1) * size;

    if (fields.Background) {
      out.push(`<rect x="${x}" y="${y}" width="${size}" height="${size}" fill="${escapeXml(fields.Background)}"/>`);
    }

    if (fields.BorderColor) {
      const width = BORDER_WIDTHS[fields.BorderStyle] || 1;
      const inset = width / 2;
      const dashed = fields.BorderStyle === "double" ? ' stroke-dasharray="4 2"' : "";
      // A spreadsheet draws one outline around a stroked range, not a box per
      // cell, so an edge shared with an identically bordered neighbour is not
      // drawn — otherwise a filled rectangle comes out as a grid of boxes.
      const signature = `${fields.BorderColor}|${fields.BorderStyle}`;
      const shares = (dRow, dCol) => {
        const neighbor = `${fields.Row + dRow},${fields.Col + dCol}`;
        return borders.signatures.get(neighbor) === signature
          || borders.enclosed.has(`${signature}@${neighbor}`);
      };
      const edges = [];
      if (!shares(-1, 0)) edges.push(`M ${x} ${y + inset} H ${x + size}`);
      if (!shares(1, 0)) edges.push(`M ${x} ${y + size - inset} H ${x + size}`);
      if (!shares(0, -1)) edges.push(`M ${x + inset} ${y} V ${y + size}`);
      if (!shares(0, 1)) edges.push(`M ${x + size - inset} ${y} V ${y + size}`);
      if (edges.length > 0) {
        out.push(
          `<path d="${edges.join(" ")}" fill="none" stroke="${escapeXml(fields.BorderColor)}"`
          + ` stroke-width="${width}"${dashed}/>`,
        );
      }
    }

    const text = fields.Checkbox ? "☐" : fields.Dropdown || fields.Value;
    if (text !== undefined && text !== "" && !fields.ImageURL) {
      const fontSize = fields.FontSize || 15;
      const horizontal = horizontalPlacement(fields.Alignment, x, size);
      const baseline = verticalPlacement(fields.Alignment, y, size, fontSize);
      const attributes = [
        `x="${horizontal.x}"`,
        `y="${baseline}"`,
        `font-family="${escapeXml(options.fontFamily)}"`,
        `font-size="${fontSize}"`,
        `fill="${escapeXml(fields.TextColor || "#000000")}"`,
        `text-anchor="${horizontal.anchor}"`,
      ];
      if (fields.Bold) attributes.push('font-weight="bold"');
      if (fields.Italic) attributes.push('font-style="italic"');
      if (fields.Underline) attributes.push('text-decoration="underline"');
      if (fields.Rotation) {
        attributes.push(`transform="rotate(${-fields.Rotation} ${horizontal.x} ${baseline})"`);
      }

      // A cell's text is not clipped: spreadsheets spill a long string over
      // the empty cells to the right, and so does this.
      let element = `<text ${attributes.join(" ")}>${escapeXml(text)}</text>`;
      if (fields.Link) {
        element = `<a href="${escapeXml(fields.Link)}" target="_blank">${element}</a>`;
      }
      if (fields.Note) {
        element = `<g><title>${escapeXml(fields.Note)}</title>${element}</g>`;
      }
      out.push(element);
    } else if (fields.ImageURL) {
      // The image itself needs a fetch the exporter deliberately does not do;
      // its footprint is drawn so the layout still reads correctly.
      out.push(
        `<g><title>${escapeXml(fields.ImageURL)}</title>`
        + `<rect x="${x}" y="${y}" width="${fields.ImageWidth || size}" height="${fields.ImageHeight || size}"`
        + ' fill="none" stroke="#888888" stroke-dasharray="3 2"/>'
        + `<text x="${x + 3}" y="${y + 14}" font-family="${escapeXml(options.fontFamily)}" font-size="10" fill="#888888">image</text>`
        + "</g>",
      );
    } else if (fields.Note) {
      // A note with no visible content still marks its cell.
      out.push(
        `<g><title>${escapeXml(fields.Note)}</title>`
        + `<rect x="${x}" y="${y}" width="${size}" height="${size}" fill="transparent"/>`
        + `<path d="M ${x + size - 6} ${y} L ${x + size} ${y} L ${x + size} ${y + 6} Z" fill="#c0392b"/></g>`,
      );
    }
  }

  function renderSvg(document, userOptions) {
    const options = Object.assign({}, DEFAULTS, userOptions || {});
    const size = options.cellSize;
    const extent = documentExtent(document, options);
    const width = extent.cols * size + options.margin * 2;
    const height = extent.rows * size + options.margin * 2;

    const out = [];
    out.push(`<rect width="${width}" height="${height}" fill="${escapeXml(options.background)}"/>`);
    out.push(`<g transform="translate(${options.margin} ${options.margin})">`);

    // Pages first, then content: a page is the sheet the cells are drawn on.
    for (const page of document.pages) {
      out.push(
        `<rect x="0" y="${(page.top - 1) * size}" width="${page.width * size}" height="${page.height * size}"`
        + ` fill="${escapeXml(options.pageBackground)}" stroke="${escapeXml(options.pageBorder)}" stroke-width="2"/>`,
      );
    }

    const borders = borderMap(document.records);
    for (const record of document.records) {
      renderRecord(record.fields, options, out, borders);
    }

    out.push("</g>");

    return [
      `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"`
      + ` width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
      ...out,
      "</svg>",
    ].join("\n");
  }

  function renderHtml(document, userOptions) {
    const options = Object.assign({}, DEFAULTS, userOptions || {});
    const title = escapeXml(options.title || "SPDL document");
    return [
      "<!doctype html>",
      '<html lang="en">',
      "<head>",
      '<meta charset="utf-8">',
      `<title>${title}</title>`,
      "<style>",
      "  body { margin: 0; padding: 24px; background: #1e1e1e; color: #ddd;",
      "         font-family: Arial, Helvetica, sans-serif; }",
      "  h1 { font-size: 16px; font-weight: normal; margin: 0 0 16px; }",
      "  svg { max-width: 100%; height: auto; }",
      "</style>",
      "</head>",
      "<body>",
      `<h1>${title}</h1>`,
      renderSvg(document, options),
      "</body>",
      "</html>",
    ].join("\n");
  }

  // Convenience: stream in, SVG out.
  function streamToSvg(stream, options) {
    return renderSvg(SPDL.parseSpdlDocument(stream), options);
  }

  function streamToHtml(stream, options) {
    return renderHtml(SPDL.parseSpdlDocument(stream), options);
  }

  return { renderSvg, renderHtml, streamToSvg, streamToHtml, escapeXml, DEFAULTS };
});
