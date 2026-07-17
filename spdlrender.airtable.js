#!/usr/bin/env node
/**
 * SPDL renderer for Airtable REST API
 *
 * Reads an SPDL command stream (from stdin or a file), maintains a lightweight
 * graphics state, and renders into an Airtable base using the official REST
 * API. The renderer assumes two tables:
 *   - `01_Hex_Stream`: optional source of commands; otherwise a local file or stdin
 *   - `02_Rendered_View`: grid table where one record = one cell
 *
 * The grid table should have fields: Row (number), Col (number), Value (rich
 * text/string), Background (color hex), TextColor (hex), Bold (checkbox), Italic
 * (checkbox), Underline (checkbox), Link (url), Rotation (number), Alignment
 * (single select: HLeft, HCenter, HRight, VTop, VMiddle, VBottom), BorderColor
 * (hex), BorderStyle (string), StrokeWidth (number), Attachment (attachment),
 * ImageURL (url or text), ImageWidth (number), ImageHeight (number),
 * Meta (long text/json), Dropdown (single select), Checkbox (checkbox),
 * Note (long text).
 *
 * Authentication uses an Airtable personal access token with `Bearer` header.
 * Upserts leverage `performUpsert` on Row+Col to avoid duplicate records.
 */

const fs = require("fs");
const path = require("path");

const AIRTABLE_API = "https://api.airtable.com/v0";
const RATE_LIMIT_DELAY_MS = 210; // Airtable allows ~5 requests/sec
const MAX_BATCH_SIZE = 10; // Airtable's per-request record limit
const MAX_RETRIES = 5;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Retries 429 (rate limited) responses, honoring Retry-After when present
// and falling back to exponential backoff.
async function fetchWithRetry(url, options) {
  for (let attempt = 0; ; attempt += 1) {
    const response = await fetch(url, options);
    if (response.status !== 429 || attempt >= MAX_RETRIES) {
      return response;
    }
    const retryAfter = parseFloat(response.headers.get("Retry-After"));
    const delayMs = Number.isFinite(retryAfter) && retryAfter > 0
      ? retryAfter * 1000
      : 2 ** attempt * 500;
    await sleep(delayMs);
  }
}

function loadConfig(configPath) {
  const absolute = path.resolve(configPath);
  if (!fs.existsSync(absolute)) {
    throw new Error(`Config file not found at ${absolute}`);
  }
  return JSON.parse(fs.readFileSync(absolute, "utf8"));
}

function readStream(config) {
  if (config.streamPath) {
    return fs.readFileSync(path.resolve(config.streamPath), "utf8");
  }
  return fs.readFileSync(0, "utf8");
}

async function airtableRequest({ config, table, method = "GET", body }) {
  const url = `${AIRTABLE_API}/${config.baseId}/${encodeURIComponent(table)}`;
  const response = await fetchWithRetry(url, {
    method,
    headers: {
      Authorization: `Bearer ${config.apiToken}`,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Airtable request failed ${response.status}: ${text}`);
  }
  return response.json();
}

async function clearTable(config, table) {
  // Repeatedly delete the first page of records until the table is empty.
  // (The previous implementation paginated with `offset` while deleting,
  // which skips records: the cursor references rows that no longer exist.)
  const baseUrl = `${AIRTABLE_API}/${config.baseId}/${encodeURIComponent(table)}`;
  const headers = { Authorization: `Bearer ${config.apiToken}` };
  for (;;) {
    const res = await fetchWithRetry(`${baseUrl}?pageSize=100`, { headers });
    if (!res.ok) {
      throw new Error(`Failed to list records: ${res.status}`);
    }
    const data = await res.json();
    const ids = data.records.map((r) => r.id);
    if (ids.length === 0) {
      return;
    }
    for (let i = 0; i < ids.length; i += MAX_BATCH_SIZE) {
      const chunk = ids.slice(i, i + MAX_BATCH_SIZE);
      const query = chunk.map((id) => `records[]=${encodeURIComponent(id)}`).join("&");
      const del = await fetchWithRetry(`${baseUrl}?${query}`, { method: "DELETE", headers });
      if (!del.ok) {
        const text = await del.text();
        throw new Error(`Failed to delete records ${del.status}: ${text}`);
      }
      await sleep(RATE_LIMIT_DELAY_MS);
    }
  }
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

// Anchored command patterns. Every SPDL command must match one of these
// exactly; substring checks are never used for dispatch so that text content
// such as "(Morgan) Tj" can never be mistaken for an operator like "rg".
const TEXT_RE = /^\((.*)\)\s+Tj$/;
const LINK_RE = /^\(([^)]*)\)\s+\(([^)]*)\)\s+\/Link$/;
const INSERT_IMAGE_RE = /^(\d+)\s+(\d+)\s+\(([^)]*)\)\s+\/InsertImage$/;
const NOTE_RE = /^\(([^)]*)\)\s+\/Note$/;
const DROPDOWN_RE = /^\(([^)]*)\)\s+\/Dropdown$/;
const MEDIABOX_RE = /^(\d+)\s+(\d+)\s+MediaBox$/;
const LINE_WIDTH_RE = /^(\d+)\s+w$/;
const RECT_RE = /^(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s+re$/;
const PIXEL_ART_RE = /^(\d+)\s+(\d+)\s+ID\s+(\S+)$/;
// /Rotate accepts its operand on either side ("/Rotate 45" or "45 /Rotate"),
// matching the other renderers.
const ROTATE_RE = /^(?:\/Rotate\s+(-?\d+(?:\.\d+)?)|(-?\d+(?:\.\d+)?)\s+\/Rotate)$/;
const ALIGN_RE = /^\/Align\s+(\S+)$/;
const FILL_COLOR_RE = /^(\d*\.?\d+)\s+(\d*\.?\d+)\s+(\d*\.?\d+)\s+rg$/;
const STROKE_COLOR_RE = /^(\d*\.?\d+)\s+(\d*\.?\d+)\s+(\d*\.?\d+)\s+SC$/;
const FONT_RE = /^\/F(\d+)(?:\s+(\d+(?:\.\d+)?))?\s+Tf$/;
const UNDERLINE_RE = /^([01])\s+Tr$/;
const FONT_SIZE_RE = /^([+-]?\d*\.?\d+)\s+Ts$/;
const ALIGN_CODE_RE = /^(\d+)\s+TA$/;
const TD_RE = /^([+-]?\d*\.?\d+)\s+([+-]?\d*\.?\d+)\s+Td$/;
const MOVE_TO_RE = /^\/MoveTo\s+(-?\d+)\s+(-?\d+)$/;

function parseSpdl(stream) {
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

  const enqueueCell = (x, y, fields) => {
    records.push({ fields: { Row: y, Col: x, ...fields } });
  };

  for (const command of lines) {
    let match;

    // TEXT — parsed first so text content can never be misread as an operator.
    if ((match = command.match(TEXT_RE))) {
      enqueueCell(state.cursorX, state.cursorY, {
        Value: match[1],
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
    if ((match = command.match(INSERT_IMAGE_RE))) {
      const width = parseInt(match[1], 10) || 0;
      const height = parseInt(match[2], 10) || 0;
      const imageUrl = match[3];
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
    if ((match = command.match(NOTE_RE))) {
      enqueueCell(state.cursorX, state.cursorY, { Note: match[1] });
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
    if ((match = command.match(DROPDOWN_RE))) {
      const options = match[1].split(",").map((s) => s.trim());
      enqueueCell(state.cursorX, state.cursorY, {
        Dropdown: options[0] || "",
        Note: options.length ? `Options: ${options.join(", ")}` : undefined,
        Background: "#FFF2CC",
        Alignment: "HCenter",
      });
      continue;
    }

    // PAGE
    if ((match = command.match(MEDIABOX_RE))) {
      state.pageWidth = parseInt(match[1], 10) || 0;
      state.pageHeight = parseInt(match[2], 10) || 0;
      state.pageTop = state.cursorY;
      continue;
    }
    if (command === "/NewPage") {
      if (state.pageHeight > 0) {
        state.pageTop += state.pageHeight + 2;
        state.cursorX = 1;
        state.cursorY = state.pageTop;
      }
      continue;
    }

    // LINE WIDTH
    if ((match = command.match(LINE_WIDTH_RE))) {
      state.strokeWidth = parseInt(match[1], 10);
      continue;
    }

    // SHAPES
    if ((match = command.match(RECT_RE))) {
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
    if ((match = command.match(PIXEL_ART_RE))) {
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
    if ((match = command.match(LINK_RE))) {
      enqueueCell(state.cursorX, state.cursorY, {
        Value: match[2],
        Link: match[1],
        TextColor: state.fill,
        Bold: state.bold,
        Italic: state.italic,
        Underline: state.underline,
        Alignment: state.alignment,
      });
      continue;
    }

    if ((match = command.match(ROTATE_RE))) {
      state.rotation = Math.trunc(parseFloat(match[1] !== undefined ? match[1] : match[2])) || 0;
      continue;
    }

    if ((match = command.match(ALIGN_RE))) {
      state.alignment = match[1];
      continue;
    }

    if ((match = command.match(ALIGN_CODE_RE))) {
      state.alignment = normalizeAlignment(parseInt(match[1], 10));
      continue;
    }

    if ((match = command.match(FILL_COLOR_RE))) {
      state.fill = parseColor(match.slice(1, 4));
      continue;
    }
    if ((match = command.match(STROKE_COLOR_RE))) {
      state.stroke = parseColor(match.slice(1, 4));
      continue;
    }

    if ((match = command.match(FONT_RE))) {
      state.bold = match[1] === "2";
      state.italic = match[1] === "3";
      state.fontSize = match[2] ? parseInt(match[2], 10) : state.fontSize;
      continue;
    }

    if ((match = command.match(UNDERLINE_RE))) {
      state.underline = match[1] === "1";
      continue;
    }

    if ((match = command.match(FONT_SIZE_RE))) {
      const parsedFontSize = parseFloat(match[1]);
      state.fontSize = parsedFontSize > 0 ? parsedFontSize : 15;
      continue;
    }

    // Deltas are truncated toward zero, matching the documented Td semantics
    // shared by all renderers.
    if ((match = command.match(TD_RE))) {
      state.cursorX += Math.trunc(parseFloat(match[1]) / 10);
      state.cursorY += Math.trunc(parseFloat(match[2]) / 10);
      continue;
    }

    if ((match = command.match(MOVE_TO_RE))) {
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

  return records;
}

async function syncRecords(config, records) {
  // Airtable rejects requests with more than MAX_BATCH_SIZE records, so a
  // configured batchSize is clamped rather than passed through.
  const batchSize = Math.max(1, Math.min(MAX_BATCH_SIZE, config.batchSize || MAX_BATCH_SIZE));
  for (let i = 0; i < records.length; i += batchSize) {
    await airtableRequest({
      config,
      table: config.renderTable,
      method: "PATCH",
      body: {
        records: records.slice(i, i + batchSize),
        performUpsert: {
          fieldsToMergeOn: ["Row", "Col"],
        },
      },
    });
    await sleep(RATE_LIMIT_DELAY_MS);
  }
}

async function main() {
  const configPath = process.argv[2] || "spdlrender.airtable.config.json";
  const config = loadConfig(configPath);
  if (!config.apiToken || !config.baseId || !config.renderTable) {
    throw new Error("Config must include apiToken, baseId, and renderTable");
  }

  const streamText = readStream(config);
  const records = parseSpdl(streamText);

  if (config.truncateTable) {
    await clearTable(config, config.renderTable);
  }

  if (records.length === 0) {
    console.log("No commands to apply.");
    return;
  }

  await syncRecords(config, records);
  console.log(`Rendered ${records.length} cell updates to ${config.renderTable}`);
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = {
  parseSpdl,
  clearTable,
  syncRecords,
};
