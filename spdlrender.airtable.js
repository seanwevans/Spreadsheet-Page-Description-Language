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
  const response = await fetch(url, {
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
  // Delete in batches of 10 to respect API limits.
  const batchSize = 10;
  let offset = null;
  do {
    const queryUrl = `${AIRTABLE_API}/${config.baseId}/${encodeURIComponent(table)}?${offset ? `offset=${offset}&` : ""}pageSize=${batchSize}`;
    const res = await fetch(queryUrl, {
      headers: { Authorization: `Bearer ${config.apiToken}` },
    });
    if (!res.ok) {
      throw new Error(`Failed to list records: ${res.status}`);
    }
    const data = await res.json();
    const ids = data.records.map((r) => r.id);
    offset = data.offset;
    if (ids.length > 0) {
      await airtableRequest({
        config,
        table,
        method: "DELETE",
        body: { records: ids },
      });
      await new Promise((resolve) => setTimeout(resolve, RATE_LIMIT_DELAY_MS));
    }
  } while (offset);
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
    // IMAGE
    if (command.includes("/InsertImage")) {
      const match = command.match(/\(([^)]+)\)/);
      const parts = command.replace(match?.[0] || "", "").trim().split(/\s+/);
      const width = parseInt(parts[0], 10) || 0;
      const height = parseInt(parts[1], 10) || 0;
      const imageUrl = match?.[1] || "";
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
    if (command.includes("/Note")) {
      const match = command.match(/\(([^)]+)\)/);
      enqueueCell(state.cursorX, state.cursorY, { Note: match?.[1] || "" });
      continue;
    }

    // CHECKBOX
    if (command.includes("/CheckBox")) {
      enqueueCell(state.cursorX, state.cursorY, {
        Checkbox: true,
        Alignment: state.alignment || "VMiddle",
      });
      continue;
    }

    // DROPDOWN
    if (command.includes("/Dropdown")) {
      const match = command.match(/\(([^)]+)\)/);
      const options = match?.[1]?.split(",").map((s) => s.trim()) || [];
      enqueueCell(state.cursorX, state.cursorY, {
        Dropdown: options[0] || "",
        Note: options.length ? `Options: ${options.join(", ")}` : undefined,
        Background: "#FFF2CC",
        Alignment: "HCenter",
      });
      continue;
    }

    // PAGE
    if (command.includes("MediaBox")) {
      const parts = command.split(/\s+/);
      state.pageWidth = parseInt(parts[0], 10) || 0;
      state.pageHeight = parseInt(parts[1], 10) || 0;
      state.pageTop = state.cursorY;
      continue;
    }
    if (command.includes("/NewPage")) {
      if (state.pageHeight > 0) {
        state.pageTop += state.pageHeight + 2;
        state.cursorX = 1;
        state.cursorY = state.pageTop;
      }
      continue;
    }

    // LINE WIDTH
    const widthMatch = command.match(/^(\d+)\s+w\b/);
    if (widthMatch) {
      state.strokeWidth = parseInt(widthMatch[1], 10);
      continue;
    }

    // SHAPES
    if (command.endsWith("re")) {
      const parts = command.split(/\s+/);
      state.currentPath = {
        x: parseInt(parts[0], 10),
        y: parseInt(parts[1], 10),
        w: parseInt(parts[2], 10),
        h: parseInt(parts[3], 10),
      };
      continue;
    }
    if (command === "f" || command === "S") {
      const path = state.currentPath;
      if (path && path.w > 0 && path.h > 0) {
        const baseY = state.pageTop + path.y;
        for (let row = 0; row < path.h; row += 1) {
          for (let col = 0; col < path.w; col += 1) {
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
    if (command.includes("ID")) {
      const parts = command.split(/\s+/);
      const w = parseInt(parts[0], 10);
      const h = parseInt(parts[1], 10);
      const payload = parts[3];
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

    // LINKS & TEXT
    if (command.includes("/Link")) {
      const matches = command.match(/\(([^)]+)\)/g);
      const url = matches?.[0]?.replace(/[()]/g, "");
      const label = matches?.[1]?.replace(/[()]/g, "");
      enqueueCell(state.cursorX, state.cursorY, {
        Value: label,
        Link: url,
        TextColor: state.fill,
        Bold: state.bold,
        Italic: state.italic,
        Underline: state.underline,
        Alignment: state.alignment,
      });
      continue;
    }

    if (command.includes("/Rotate")) {
      const parts = command.split(/\s+/);
      state.rotation = parseInt(parts[1] || parts[0], 10) || 0;
      continue;
    }

    if (command.includes("/Align")) {
      const parts = command.trim().split(/\s+/);
      state.alignment = parts[1] || "";
      continue;
    }

    const alignCode = command.match(/^(\d+)\s+TA/);
    if (alignCode) {
      state.alignment = normalizeAlignment(parseInt(alignCode[1], 10));
      continue;
    }

    if (command.includes("rg")) {
      const parts = command.split(/\s+/);
      state.fill = parseColor(parts.slice(0, 3));
      continue;
    }
    if (command.includes("SC")) {
      const parts = command.split(/\s+/);
      state.stroke = parseColor(parts.slice(0, 3));
      continue;
    }

    if (command.includes("Tf")) {
      state.bold = command.includes("/F2");
      state.italic = command.includes("/F3");
      const size = command.match(/(\d+)\s+Tf/);
      state.fontSize = size ? parseInt(size[1], 10) : state.fontSize;
      continue;
    }

    if (command.includes("Tr")) {
      state.underline = command.startsWith("1");
      continue;
    }

    if (command.includes("Ts")) {
      const match = command.match(/(\d+)\s+Ts/);
      state.fontSize = match ? parseInt(match[1], 10) : state.fontSize;
      continue;
    }

    if (command.endsWith("Td")) {
      const parts = command.split(/\s+/);
      state.cursorX += Math.floor(parseFloat(parts[0]) / 10);
      state.cursorY += Math.floor(parseFloat(parts[1]) / 10);
      continue;
    }

    if (command.startsWith("/MoveTo")) {
      const parts = command.split(/\s+/);
      state.cursorX = parseInt(parts[1], 10);
      state.cursorY = state.pageTop + Math.min(state.pageHeight || Number.MAX_SAFE_INTEGER, parseInt(parts[2], 10));
      continue;
    }

    if (command.startsWith("(")) {
      const match = command.match(/\((.*)\)\s*Tj/);
      if (match) {
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
      }
      continue;
    }
  }

  return records;
}

async function syncRecords(config, records) {
  const batches = [];
  for (let i = 0; i < records.length; i += config.batchSize || 10) {
    batches.push(records.slice(i, i + (config.batchSize || 10)));
  }
  for (const batch of batches) {
    await airtableRequest({
      config,
      table: config.renderTable,
      method: "PATCH",
      body: {
        records: batch,
        performUpsert: {
          fieldsToMergeOn: ["Row", "Col"],
        },
      },
    });
    await new Promise((resolve) => setTimeout(resolve, RATE_LIMIT_DELAY_MS));
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

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
