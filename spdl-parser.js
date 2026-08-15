/**
 * Reference parser for the Spreadsheet Page Description Language (SPDL).
 *
 * Parses an SPDL command stream into a platform-neutral list of cell
 * operations: `{ fields: { Row, Col, ...cellProperties } }`. This is the
 * canonical implementation of the grammar defined in SPEC.md — renderers
 * either consume it directly (Node/Airtable, browser playground) or are
 * conformance-checked against its output (golden files in tests/golden).
 *
 * The module is a UMD-style bundle so it loads both via require() and as a
 * browser <script> (exposed as `window.SPDL`).
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.SPDL = factory();
  }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  // Anchored command patterns. Every SPDL command must match one of these
  // exactly; substring checks are never used for dispatch so that text content
  // such as "(Morgan) Tj" can never be mistaken for an operator like "rg".
  // Text operands support PDF-style escapes: \( \) \\ produce literal
  // characters. Tj keeps a greedy match for backward compatibility with bare
  // parens in text; multi-operand commands use the escaped-character class so
  // an escaped paren cannot end the operand early.
  const patterns = {
    text: /^\((.*)\)\s+Tj$/,
    link: /^\(((?:[^)\\]|\\.)*)\)\s+\(((?:[^)\\]|\\.)*)\)\s+\/Link$/,
    insertImage: /^(\d+)\s+(\d+)\s+\(((?:[^)\\]|\\.)*)\)\s+\/InsertImage$/,
    note: /^\(((?:[^)\\]|\\.)*)\)\s+\/Note$/,
    dropdown: /^\(((?:[^)\\]|\\.)*)\)\s+\/Dropdown$/,
    mediaBox: /^(\d+)\s+(\d+)\s+MediaBox$/,
    lineWidth: /^(\d+)\s+w$/,
    rectangle: /^(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s+re$/,
    pixelArt: /^(\d+)\s+(\d+)\s+ID\s+(\S+)$/,
    // /Rotate accepts its operand on either side ("/Rotate 45" or "45 /Rotate"),
    // matching the other renderers.
    rotate: /^(?:\/Rotate\s+(-?\d+(?:\.\d+)?)|(-?\d+(?:\.\d+)?)\s+\/Rotate)$/,
    align: /^\/Align\s+(\S+)$/,
    fillColor: /^(\d*\.?\d+)\s+(\d*\.?\d+)\s+(\d*\.?\d+)\s+rg$/,
    strokeColor: /^(\d*\.?\d+)\s+(\d*\.?\d+)\s+(\d*\.?\d+)\s+SC$/,
    font: /^\/F(\d+)(?:\s+(\d*\.?\d+))?\s+Tf$/,
    underline: /^([01])\s+Tr$/,
    fontSize: /^([+-]?\d*\.?\d+)\s+Ts$/,
    alignCode: /^(\d+)\s+TA$/,
    td: /^([+-]?\d*\.?\d+)\s+([+-]?\d*\.?\d+)\s+Td$/,
    moveTo: /^\/MoveTo\s+(-?\d+)\s+(-?\d+)$/,
    line: /^(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s+l$/,
    textBox: /^(\d+)\s+(\d+)\s+\(((?:[^)\\]|\\.)*)\)\s+\/TextBox$/,
    colWidth: /^(\d+)\s+\/ColWidth$/,
    rowHeight: /^(\d+)\s+\/RowHeight$/,
    def: /^\/Def\s+([A-Za-z][A-Za-z0-9_-]*)$/,
    doDef: /^\/Do\s+([A-Za-z][A-Za-z0-9_-]*)$/,
  };

  // Exact-match operators that take no operands.
  const operators = ["/CheckBox", "/NewPage", "/EndDef", "f", "S", "q", "Q"];

  // Upper bound on the cells a single f/S can touch, applied *after* the
  // shape is clamped to the canvas. Without it an unbounded canvas plus a
  // stream like "9999 9999 9999 9999 re" + "f" would enqueue ~100M cell
  // operations.
  const MAX_SHAPE_CELLS = 100000;

  // How many characters of 15pt text fit in a default 25px cell. /TextBox
  // wraps against `width * CHARS_PER_CELL`; spreadsheets spill a long string
  // over the empty cells to its right, so this only has to be close.
  const CHARS_PER_CELL = 4;

  // Guards against a definition that invokes itself, directly or through
  // another definition.
  const MAX_DEF_DEPTH = 8;

  // Graphics state saved by `q` and restored by `Q` — everything except the
  // page structure, which is document layout rather than drawing state.
  const SAVED_STATE_KEYS = [
    "cursorX",
    "cursorY",
    "fill",
    "stroke",
    "strokeWidth",
    "bold",
    "italic",
    "underline",
    "rotation",
    "alignment",
    "fontSize",
    "currentPath",
  ];

  // Greedy word wrap into lines of at most `columns * CHARS_PER_CELL`
  // characters. A word longer than a line gets a line of its own rather than
  // being split, matching how a spreadsheet overflows one long string.
  function wrapText(text, columns) {
    const limit = Math.max(1, columns * CHARS_PER_CELL);
    const lines = [];
    let current = "";

    for (const word of text.split(/\s+/).filter((w) => w.length > 0)) {
      if (current.length === 0) {
        current = word;
      } else if (current.length + 1 + word.length <= limit) {
        current += ` ${word}`;
      } else {
        lines.push(current);
        current = word;
      }
    }
    if (current.length > 0) lines.push(current);
    return lines;
  }

  /**
   * Expands `/Def name … /EndDef` blocks and replays them at `/Do name`.
   *
   * Definitions are collected and removed here so the main loop only ever
   * sees drawing commands. An unknown name, an unterminated definition or a
   * recursive one is dropped — the same "skip what you cannot interpret"
   * rule the rest of the language follows.
   */
  function expandDefinitions(lines) {
    const definitions = new Map();
    const expanded = [];
    let capturing = null;

    for (const line of lines) {
      const beginMatch = line.match(patterns.def);
      if (beginMatch) {
        // A nested /Def is not a nesting construct: it ends the previous one.
        capturing = { name: beginMatch[1], body: [] };
        definitions.set(capturing.name, capturing.body);
        continue;
      }
      if (line === "/EndDef") {
        capturing = null;
        continue;
      }
      if (capturing) {
        capturing.body.push(line);
        continue;
      }
      expanded.push(line);
    }

    const replay = (lineList, depth, active) => {
      const out = [];
      for (const line of lineList) {
        const useMatch = line.match(patterns.doDef);
        if (!useMatch) {
          out.push(line);
          continue;
        }
        const name = useMatch[1];
        const body = definitions.get(name);
        if (!body || depth >= MAX_DEF_DEPTH || active.has(name)) continue;
        active.add(name);
        out.push(...replay(body, depth + 1, active));
        active.delete(name);
      }
      return out;
    };

    return replay(expanded, 0, new Set());
  }

  // Resolves \( \) \\ escape sequences in a matched text operand.
  function unescapeTextOperand(value) {
    return value.replace(/\\([()\\])/g, "$1");
  }

  function mapLineWidth(width) {
    // Canonical SPDL stroke width mapping (shared across renderers):
    // 1 = thin, 2 = medium, 3 = thick, 4 = double.
    if (width <= 1) return "thin";
    if (width === 2) return "medium";
    if (width === 3) return "thick";
    if (width === 4) return "double";
    return "thin";
  }

  function parseColor(parts) {
    const [r, g, b] = parts.map((v) => Math.max(0, Math.min(1, parseFloat(v))));
    const toHex = (value) => Math.round(value * 255)
      .toString(16)
      .padStart(2, "0");
    return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
  }

  function normalizeAlignment(code) {
    const map = {
      0: "HLeft",
      1: "HCenter",
      2: "HRight",
      3: "VTop",
      4: "VMiddle",
      5: "VBottom",
    };
    return map[code] || "";
  }

  // Parses a stream into { records, pages, columns, rows }: `records` is the
  // cell-operation list, `pages` the page regions ({ top, width, height })
  // that MediaBox and /NewPage established, and `columns`/`rows` the sizes
  // /ColWidth and /RowHeight requested — enough for a renderer to draw page
  // backgrounds and lay out the sheet.
  function parseSpdlDocument(stream) {
    const lines = expandDefinitions(
      stream
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter((l) => l.length > 0),
    );

    const state = {
      cursorX: 1,
      cursorY: 1,
      pageTop: 1,
      pageWidth: 0,
      pageHeight: 0,
      fill: "#000000",
      stroke: "#000000",
      strokeWidth: 3,
      bold: false,
      italic: false,
      underline: false,
      rotation: 0,
      alignment: "",
      currentPath: null,
      fontSize: DEFAULT_FONT_SIZE,
    };

    const records = [];
    const pages = [];
    // Sheet geometry: `/ColWidth` and `/RowHeight` size the cursor's column
    // and row. Last request for an index wins.
    const columnWidths = new Map();
    const rowHeights = new Map();
    const stateStack = [];

    // `recordIndex` is how many cell operations preceded the page draw, so a
    // consumer can interleave page chrome with content instead of assuming
    // all pages are drawn first: content written before a /NewPage is painted
    // over by that page, exactly as it is in the spreadsheet renderers.
    const pushPage = (top, width, height) => {
      pages.push({ top, width, height, recordIndex: records.length });
    };

    // Fields set to undefined are omitted entirely so the operation list is
    // stable under JSON round-trips (golden files) and never sends explicit
    // undefined values to consumers. Writes outside the canvas are dropped —
    // the spreadsheet renderers log and skip them.
    const enqueueCell = (x, y, fields) => {
      if (!isInsideCanvas(x, y)) return;
      const cleaned = { Row: y, Col: x };
      for (const [key, value] of Object.entries(fields)) {
        if (value !== undefined) cleaned[key] = value;
      }
      records.push({ fields: cleaned });
    };

    for (const command of lines) {
      let match;

      // COMMENTS — % starts a comment line, skipped entirely.
      if (command.startsWith("%")) {
        continue;
      }

      // TEXT — parsed first so text content can never be misread as an operator.
      if ((match = command.match(patterns.text))) {
        enqueueCell(state.cursorX, state.cursorY, {
          Value: unescapeTextOperand(match[1]),
          TextColor: state.fill,
          FontSize: state.fontSize,
          Bold: state.bold,
          Italic: state.italic,
          Underline: state.underline,
          Rotation: state.rotation,
          Alignment: state.alignment,
          StrokeWidth: state.strokeWidth,
        });
        continue;
      }

      // TEXT BOX — wrapped text, one wrapped line per row of the box.
      if ((match = command.match(patterns.textBox))) {
        const boxWidth = parseInt(match[1], 10);
        const boxHeight = parseInt(match[2], 10);
        if (boxWidth > 0 && boxHeight > 0) {
          const wrapped = wrapText(unescapeTextOperand(match[3]), boxWidth);
          for (let row = 0; row < Math.min(wrapped.length, boxHeight); row += 1) {
            enqueueCell(state.cursorX, state.cursorY + row, {
              Value: wrapped[row],
              TextColor: state.fill,
              Bold: state.bold,
              Italic: state.italic,
              Underline: state.underline,
              Rotation: state.rotation,
              Alignment: state.alignment,
              StrokeWidth: state.strokeWidth,
            });
          }
        }
        continue;
      }

      // IMAGE
      if ((match = command.match(patterns.insertImage))) {
        const width = parseInt(match[1], 10) || 0;
        const height = parseInt(match[2], 10) || 0;
        const imageUrl = unescapeTextOperand(match[3]);
        enqueueCell(state.cursorX, state.cursorY, {
          Attachment: imageUrl ? [{ url: imageUrl }] : undefined,
          Value: imageUrl,
          ImageURL: imageUrl || undefined,
          ImageWidth: width || undefined,
          ImageHeight: height || undefined,
          Meta: imageUrl
            ? JSON.stringify({
              type: "image",
              url: imageUrl,
              width,
              height,
            })
            : undefined,
        });
        continue;
      }

      // NOTE
      if ((match = command.match(patterns.note))) {
        enqueueCell(state.cursorX, state.cursorY, { Note: unescapeTextOperand(match[1]) });
        continue;
      }

      // CHECKBOX
      if (command === "/CheckBox") {
        // A checkbox is centered chrome, not styled text: the active
        // alignment does not apply to it in any renderer.
        enqueueCell(state.cursorX, state.cursorY, {
          Checkbox: true,
          Alignment: "VMiddle",
        });
        continue;
      }

      // DROPDOWN
      if ((match = command.match(patterns.dropdown))) {
        const options = match[1].split(",").map((s) => unescapeTextOperand(s.trim()));
        enqueueCell(state.cursorX, state.cursorY, {
          Dropdown: options[0] || "",
          Note: options.length ? `Options: ${options.join(", ")}` : undefined,
          Background: "#FFF2CC",
          Alignment: "HCenter",
        });
        continue;
      }

      // PAGE
      if ((match = command.match(patterns.mediaBox))) {
        state.pageWidth = parseInt(match[1], 10) || 0;
        state.pageHeight = parseInt(match[2], 10) || 0;
        state.pageTop = state.cursorY;
        if (state.pageWidth > 0 && state.pageHeight > 0) {
          pushPage(state.pageTop, state.pageWidth, state.pageHeight);
        }
        continue;
      }
      if (command === "/NewPage") {
        if (state.pageHeight > 0) {
          state.pageTop += state.pageHeight + 2;
          state.cursorX = 1;
          state.cursorY = state.pageTop;
          pushPage(state.pageTop, state.pageWidth, state.pageHeight);
        }
        continue;
      }

      // GRAPHICS STATE STACK
      if (command === "q") {
        const saved = {};
        for (const key of SAVED_STATE_KEYS) saved[key] = state[key];
        stateStack.push(saved);
        continue;
      }
      if (command === "Q") {
        // An unmatched Q is a no-op rather than an error: the stream is a
        // linear command list, and renderers never abort on one bad command.
        const saved = stateStack.pop();
        if (saved) Object.assign(state, saved);
        continue;
      }

      // SHEET GEOMETRY
      if ((match = command.match(patterns.colWidth))) {
        columnWidths.set(state.cursorX, parseInt(match[1], 10));
        continue;
      }
      if ((match = command.match(patterns.rowHeight))) {
        rowHeights.set(state.cursorY, parseInt(match[1], 10));
        continue;
      }

      // LINE WIDTH
      if ((match = command.match(patterns.lineWidth))) {
        state.strokeWidth = parseInt(match[1], 10);
        continue;
      }

      // SHAPES
      if ((match = command.match(patterns.rectangle))) {
        // The path's position is page-relative at *definition* time: a
        // /NewPage between `re` and `f` must not move the shape. The other
        // renderers resolve pageTop here too.
        state.currentPath = {
          x: parseInt(match[1], 10),
          y: state.pageTop + parseInt(match[2], 10),
          w: parseInt(match[3], 10),
          h: parseInt(match[4], 10),
        };
        continue;
      }
      if (command === "f" || command === "S") {
        const path = state.currentPath;
        // Clamp to the canvas first, then bound the work: a rectangle that
        // hangs off the edge still draws the part that fits, exactly as the
        // spreadsheet renderers do with their clamped ranges.
        const clamped = path && path.w > 0 && path.h > 0
          ? clampRect(path.x, state.pageTop + path.y, path.w, path.h, canvas)
          : null;
        if (clamped && clamped.w * clamped.h <= MAX_SHAPE_CELLS) {
          const baseY = clamped.y;
          for (let row = 0; row < clamped.h; row += 1) {
            for (let col = 0; col < clamped.w; col += 1) {
              // Strokes only touch the rectangle's perimeter, matching the
              // border-only behavior of the other renderers.
              const onPerimeter = row === 0 || row === clamped.h - 1 || col === 0 || col === clamped.w - 1;
              if (command === "S" && !onPerimeter) continue;
              enqueueCell(clamped.x + col, baseY + row, {
                Background: command === "f" ? state.fill : undefined,
                BorderColor: command === "S" ? state.stroke : undefined,
                BorderStyle: command === "S" ? mapLineWidth(state.strokeWidth) : undefined,
              });
            }
          }
        }
        continue;
      }

      // LINES — an axis-aligned run of cells stroked like a degenerate
      // rectangle. Diagonals have no cell-grid representation, so they are
      // skipped rather than approximated.
      if ((match = command.match(patterns.line))) {
        const x1 = Math.floor(parseFloat(match[1]));
        const y1 = Math.floor(parseFloat(match[2]));
        const x2 = Math.floor(parseFloat(match[3]));
        const y2 = Math.floor(parseFloat(match[4]));
        if (x1 === x2 || y1 === y2) {
          const left = Math.min(x1, x2);
          const right = Math.max(x1, x2);
          const top = state.pageTop + Math.min(y1, y2);
          const bottom = state.pageTop + Math.max(y1, y2);
          for (let row = top; row <= bottom; row += 1) {
            for (let col = left; col <= right; col += 1) {
              enqueueCell(col, row, {
                BorderColor: state.stroke,
                BorderStyle: mapLineWidth(state.strokeWidth),
              });
            }
          }
        }
        continue;
      }

      // PIXEL ART
      if ((match = command.match(patterns.pixelArt))) {
        const w = parseInt(match[1], 10);
        const h = parseInt(match[2], 10);
        const payload = match[3];
        if (payload && payload.length >= w * h) {
          for (let r = 0; r < h; r += 1) {
            for (let c = 0; c < w; c += 1) {
              const code = payload[r * w + c];
              const colorMap = { 1: "#000000", 2: "#F1C40F", 3: "#E74C3C" };
              const bg = colorMap[code];
              if (bg) {
                enqueueCell(state.cursorX + c, state.cursorY + r, { Background: bg });
              }
            }
          }
        }
        continue;
      }

      // LINKS
      if ((match = command.match(patterns.link))) {
        enqueueCell(state.cursorX, state.cursorY, {
          Value: unescapeTextOperand(match[2]),
          Link: unescapeTextOperand(match[1]),
          TextColor: state.fill,
          FontSize: state.fontSize,
          Bold: state.bold,
          Italic: state.italic,
          Underline: state.underline,
          Alignment: state.alignment,
        });
        continue;
      }

      if ((match = command.match(patterns.rotate))) {
        state.rotation = Math.trunc(parseFloat(match[1] !== undefined ? match[1] : match[2])) || 0;
        continue;
      }

      if ((match = command.match(patterns.align))) {
        state.alignment = match[1];
        continue;
      }

      if ((match = command.match(patterns.alignCode))) {
        state.alignment = normalizeAlignment(parseInt(match[1], 10));
        continue;
      }

      if ((match = command.match(patterns.fillColor))) {
        state.fill = parseColor(match.slice(1, 4));
        continue;
      }
      if ((match = command.match(patterns.strokeColor))) {
        state.stroke = parseColor(match.slice(1, 4));
        continue;
      }

      if ((match = command.match(patterns.font))) {
        state.bold = match[1] === "2";
        state.italic = match[1] === "3";
        if (match[2] !== undefined) {
          // Fractional sizes are honored here just as they are for Ts.
          const parsedSize = parseFloat(match[2]);
          state.fontSize = parsedSize > 0 ? parsedSize : DEFAULT_FONT_SIZE;
        }
        continue;
      }

      if ((match = command.match(patterns.underline))) {
        state.underline = match[1] === "1";
        continue;
      }

      if ((match = command.match(patterns.fontSize))) {
        const parsedFontSize = parseFloat(match[1]);
        state.fontSize = parsedFontSize > 0 ? parsedFontSize : DEFAULT_FONT_SIZE;
        continue;
      }

      // Deltas are truncated toward zero, matching the documented Td semantics
      // shared by all renderers.
      if ((match = command.match(patterns.td))) {
        state.cursorX += Math.trunc(parseFloat(match[1]) / 10);
        state.cursorY += Math.trunc(parseFloat(match[2]) / 10);
        continue;
      }

      if ((match = command.match(patterns.moveTo))) {
        let targetX = parseInt(match[1], 10);
        let targetY = parseInt(match[2], 10);
        // Absent a page, the cursor is bounded by the canvas — the same
        // fallback the spreadsheet renderers use (maxCols / maxRows).
        const maxX = state.pageWidth > 0
          ? state.pageWidth
          : (canvas ? canvas.cols : Infinity);
        targetX = Math.max(1, Math.min(maxX, targetX));

        const rawY = state.pageTop + targetY - 1;
        const pageBottom = state.pageHeight > 0
          ? state.pageTop + state.pageHeight - 1
          : (canvas ? canvas.rows : Infinity);
        targetY = Math.max(state.pageTop, Math.min(pageBottom, rawY));

        state.cursorX = targetX;
        state.cursorY = targetY;
        continue;
      }

      // Unrecognized command: ignore rather than guessing.
    }

    const toSizeList = (map, key) => [...map.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([index, size]) => ({ [key]: index, size }));

    return {
      records,
      pages,
      columns: toSizeList(columnWidths, "col"),
      rows: toSizeList(rowHeights, "row"),
    };
  }

  function parseSpdl(stream, options) {
    return parseSpdlDocument(stream, options).records;
  }

  return {
    parseSpdl,
    parseSpdlDocument,
    patterns,
    operators,
    expandDefinitions,
    wrapText,
    CHARS_PER_CELL,
    mapLineWidth,
    parseColor,
    normalizeAlignment,
    unescapeTextOperand,
  };
});
