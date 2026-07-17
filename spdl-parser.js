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
    font: /^\/F(\d+)(?:\s+(\d+(?:\.\d+)?))?\s+Tf$/,
    underline: /^([01])\s+Tr$/,
    fontSize: /^([+-]?\d*\.?\d+)\s+Ts$/,
    alignCode: /^(\d+)\s+TA$/,
    td: /^([+-]?\d*\.?\d+)\s+([+-]?\d*\.?\d+)\s+Td$/,
    moveTo: /^\/MoveTo\s+(-?\d+)\s+(-?\d+)$/,
  };

  // Exact-match operators that take no operands.
  const operators = ["/CheckBox", "/NewPage", "f", "S"];

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

  // Parses a stream into { records, pages }: `records` is the cell-operation
  // list, `pages` the page regions ({ top, width, height }) that MediaBox and
  // /NewPage established — enough for a renderer to draw page backgrounds.
  function parseSpdlDocument(stream) {
    const lines = stream
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l.length > 0);

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
      fontSize: 15,
    };

    const records = [];
    const pages = [];

    // Fields set to undefined are omitted entirely so the operation list is
    // stable under JSON round-trips (golden files) and never sends explicit
    // undefined values to consumers.
    const enqueueCell = (x, y, fields) => {
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
          Bold: state.bold,
          Italic: state.italic,
          Underline: state.underline,
          Rotation: state.rotation,
          Alignment: state.alignment,
          StrokeWidth: state.strokeWidth,
        });
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
        enqueueCell(state.cursorX, state.cursorY, {
          Checkbox: true,
          Alignment: state.alignment || "VMiddle",
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
          pages.push({ top: state.pageTop, width: state.pageWidth, height: state.pageHeight });
        }
        continue;
      }
      if (command === "/NewPage") {
        if (state.pageHeight > 0) {
          state.pageTop += state.pageHeight + 2;
          state.cursorX = 1;
          state.cursorY = state.pageTop;
          pages.push({ top: state.pageTop, width: state.pageWidth, height: state.pageHeight });
        }
        continue;
      }

      // LINE WIDTH
      if ((match = command.match(patterns.lineWidth))) {
        state.strokeWidth = parseInt(match[1], 10);
        continue;
      }

      // SHAPES
      if ((match = command.match(patterns.rectangle))) {
        state.currentPath = {
          x: parseInt(match[1], 10),
          y: parseInt(match[2], 10),
          w: parseInt(match[3], 10),
          h: parseInt(match[4], 10),
        };
        continue;
      }
      if (command === "f" || command === "S") {
        const path = state.currentPath;
        if (path && path.w > 0 && path.h > 0) {
          const baseY = state.pageTop + path.y;
          for (let row = 0; row < path.h; row += 1) {
            for (let col = 0; col < path.w; col += 1) {
              // Strokes only touch the rectangle's perimeter, matching the
              // border-only behavior of the other renderers.
              const onPerimeter = row === 0 || row === path.h - 1 || col === 0 || col === path.w - 1;
              if (command === "S" && !onPerimeter) continue;
              enqueueCell(path.x + col, baseY + row, {
                Background: command === "f" ? state.fill : undefined,
                BorderColor: command === "S" ? state.stroke : undefined,
                BorderStyle: command === "S" ? mapLineWidth(state.strokeWidth) : undefined,
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
        state.fontSize = match[2] ? parseInt(match[2], 10) : state.fontSize;
        continue;
      }

      if ((match = command.match(patterns.underline))) {
        state.underline = match[1] === "1";
        continue;
      }

      if ((match = command.match(patterns.fontSize))) {
        const parsedFontSize = parseFloat(match[1]);
        state.fontSize = parsedFontSize > 0 ? parsedFontSize : 15;
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
        if (state.pageWidth > 0) {
          targetX = Math.max(1, Math.min(state.pageWidth, targetX));
        } else {
          targetX = Math.max(1, targetX);
        }

        const rawY = state.pageTop + targetY - 1;
        if (state.pageHeight > 0) {
          const pageBottom = state.pageTop + state.pageHeight - 1;
          targetY = Math.max(state.pageTop, Math.min(pageBottom, rawY));
        } else {
          targetY = Math.max(state.pageTop, rawY);
        }

        state.cursorX = targetX;
        state.cursorY = targetY;
        continue;
      }

      // Unrecognized command: ignore rather than guessing.
    }

    return { records, pages };
  }

  function parseSpdl(stream) {
    return parseSpdlDocument(stream).records;
  }

  return {
    parseSpdl,
    parseSpdlDocument,
    patterns,
    operators,
    mapLineWidth,
    parseColor,
    normalizeAlignment,
    unescapeTextOperand,
  };
});
