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
const { parseSpdl } = require("./spdl-parser.js");

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
  return applyEnvOverrides(JSON.parse(fs.readFileSync(absolute, "utf8")));
}

// The API token can come from the environment instead of the config file so
// that credentials never need to be written to disk (or committed).
function applyEnvOverrides(config, env = process.env) {
  return {
    ...config,
    apiToken: config.apiToken || env.AIRTABLE_API_TOKEN || env.AIRTABLE_API_KEY,
  };
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
    throw new Error("Config must include baseId and renderTable, plus apiToken (or the AIRTABLE_API_TOKEN environment variable)");
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
  applyEnvOverrides,
};
