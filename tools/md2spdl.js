#!/usr/bin/env node
/**
 * Compiles a subset of Markdown into an SPDL stream.
 *
 * Writing SPDL by hand is fine for a form or a diagram, but tedious for a
 * document. This turns prose into a stream so SPDL has an on-ramp that does
 * not start with "learn the command set".
 *
 * The output is plain SPDL 1.0 — it renders on every renderer in this
 * repository, and `spdl-lint` accepts it.
 *
 * Supported Markdown:
 *   # / ## / ###      headings (bold, decreasing font size)
 *   paragraphs        word-wrapped to the page width
 *   - item, 1. item   bullet and numbered lists
 *   - [ ] item        task lists, rendered as a checkbox plus its label
 *   > quote           italic
 *   ---               a horizontal rule
 *   ```code```        code blocks, one line per row, not wrapped
 *   [label](url)      a link (when a paragraph or list item is just a link)
 *   ![alt](url)       an image
 *
 * Anything else is emitted as plain text: the point is a readable document,
 * not a complete Markdown implementation.
 */

const fs = require("fs");
const path = require("path");

// A 15pt string fits roughly four characters in a default 25px cell.
const CHARS_PER_CELL = 4;

const DEFAULTS = { width: 20, height: 40, margin: 1 };

const HEADING_SIZES = { 1: 24, 2: 19, 3: 16, 4: 15, 5: 15, 6: 15 };

// SPDL text operands take PDF-style escapes for parentheses and backslashes.
function escapeOperand(text) {
  return text.replace(/([\\()])/g, "\\$1");
}

function wrap(text, columns) {
  const limit = Math.max(1, columns * CHARS_PER_CELL);
  const lines = [];
  let current = "";

  for (const word of text.split(/\s+/).filter(Boolean)) {
    if (current.length === 0) current = word;
    else if (current.length + 1 + word.length <= limit) current += ` ${word}`;
    else {
      lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines;
}

// Strips inline emphasis and code markers: SPDL styles a whole cell, so
// mid-string emphasis cannot be represented.
function plainText(markdown) {
  return markdown
    .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, "$1")
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1")
    .replace(/(\*\*|__)(.*?)\1/g, "$2")
    .replace(/(\*|_)(.*?)\1/g, "$2")
    .replace(/`([^`]+)`/g, "$1")
    .trim();
}

const LINK_ONLY = /^\[([^\]]+)\]\(([^)\s]+)\)$/;
const IMAGE_ONLY = /^!\[([^\]]*)\]\(([^)\s]+)\)$/;

/**
 * Splits Markdown into the block types this compiler understands. Doing it in
 * one pass keeps the emitter below free of lookahead.
 */
function parseBlocks(markdown) {
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
  const blocks = [];
  let paragraph = [];

  const flushParagraph = () => {
    if (paragraph.length > 0) {
      blocks.push({ type: "paragraph", text: paragraph.join(" ") });
      paragraph = [];
    }
  };

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const trimmed = line.trim();

    if (trimmed.startsWith("```")) {
      flushParagraph();
      const code = [];
      i += 1;
      while (i < lines.length && !lines[i].trim().startsWith("```")) {
        code.push(lines[i]);
        i += 1;
      }
      blocks.push({ type: "code", lines: code });
      continue;
    }

    if (trimmed.length === 0) {
      flushParagraph();
      continue;
    }

    if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
      flushParagraph();
      blocks.push({ type: "rule" });
      continue;
    }

    const heading = trimmed.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      flushParagraph();
      blocks.push({ type: "heading", level: heading[1].length, text: heading[2] });
      continue;
    }

    const task = trimmed.match(/^[-*+]\s+\[( |x|X)\]\s+(.*)$/);
    if (task) {
      flushParagraph();
      blocks.push({ type: "task", checked: task[1].toLowerCase() === "x", text: task[2] });
      continue;
    }

    const bullet = trimmed.match(/^[-*+]\s+(.*)$/);
    if (bullet) {
      flushParagraph();
      blocks.push({ type: "item", marker: "•", text: bullet[1] });
      continue;
    }

    const numbered = trimmed.match(/^(\d+)[.)]\s+(.*)$/);
    if (numbered) {
      flushParagraph();
      blocks.push({ type: "item", marker: `${numbered[1]}.`, text: numbered[2] });
      continue;
    }

    const quote = trimmed.match(/^>\s?(.*)$/);
    if (quote) {
      flushParagraph();
      blocks.push({ type: "quote", text: quote[1] });
      continue;
    }

    paragraph.push(trimmed);
  }

  flushParagraph();
  return blocks;
}

function compile(markdown, userOptions) {
  const options = Object.assign({}, DEFAULTS, userOptions || {});
  const textWidth = Math.max(1, options.width - options.margin * 2);
  const out = [`% Generated from Markdown by tools/md2spdl.js`, `${options.width} ${options.height} MediaBox`];

  // Page-relative cursor. A block that would run past the bottom starts a new
  // page instead of spilling into the gap between pages.
  let row = options.margin;

  const ensureRoom = (rowsNeeded) => {
    if (row + rowsNeeded - 1 <= options.height - options.margin) return;
    out.push("/NewPage");
    row = options.margin;
  };

  const moveTo = (column) => out.push(`/MoveTo ${column} ${row}`);

  const emitTextLines = (lines, column) => {
    for (const line of lines) {
      moveTo(column);
      out.push(`(${escapeOperand(line)}) Tj`);
      row += 1;
    }
  };

  for (const block of blocks(markdown)) {
    switch (block.type) {
      case "heading": {
        const lines = wrap(plainText(block.text), textWidth);
        ensureRoom(lines.length + 1);
        out.push("/F2 Tf", `${HEADING_SIZES[block.level]} Ts`);
        emitTextLines(lines, options.margin);
        out.push("/F1 Tf", "15 Ts");
        row += 1;
        break;
      }

      case "paragraph": {
        const image = block.text.match(IMAGE_ONLY);
        if (image) {
          ensureRoom(2);
          moveTo(options.margin);
          out.push(`120 90 (${escapeOperand(image[2])}) /InsertImage`);
          row += 4;
          break;
        }

        const link = block.text.match(LINK_ONLY);
        if (link) {
          ensureRoom(2);
          moveTo(options.margin);
          out.push(`(${escapeOperand(link[2])}) (${escapeOperand(plainText(link[1]))}) /Link`);
          row += 2;
          break;
        }

        const lines = wrap(plainText(block.text), textWidth);
        ensureRoom(lines.length + 1);
        emitTextLines(lines, options.margin);
        row += 1;
        break;
      }

      case "item": {
        // The marker sits in its own column so wrapped lines stay aligned.
        const link = block.text.trim().match(LINK_ONLY);
        ensureRoom(1);
        moveTo(options.margin);
        out.push(`(${escapeOperand(block.marker)}) Tj`);
        if (link) {
          moveTo(options.margin + 1);
          out.push(`(${escapeOperand(link[2])}) (${escapeOperand(plainText(link[1]))}) /Link`);
          row += 1;
          break;
        }
        emitTextLines(wrap(plainText(block.text), textWidth - 1), options.margin + 1);
        break;
      }

      case "task": {
        const lines = wrap(plainText(block.text), textWidth - 1);
        ensureRoom(lines.length);
        moveTo(options.margin);
        out.push("/CheckBox");
        emitTextLines(lines, options.margin + 1);
        break;
      }

      case "quote": {
        const lines = wrap(plainText(block.text), textWidth - 1);
        ensureRoom(lines.length + 1);
        out.push("/F3 Tf");
        emitTextLines(lines, options.margin + 1);
        out.push("/F1 Tf");
        row += 1;
        break;
      }

      case "code": {
        ensureRoom(block.lines.length + 1);
        out.push("0.3 0.3 0.3 rg");
        emitTextLines(block.lines.map((line) => line.replace(/\t/g, "  ")), options.margin + 1);
        out.push("0 0 0 rg");
        row += 1;
        break;
      }

      case "rule": {
        ensureRoom(2);
        // SPDL 1.0 has no line primitive, so a rule is a one-row stroked
        // rectangle spanning the text column.
        out.push(`${options.margin} ${row - 1} ${textWidth} 1 re`, "S");
        row += 2;
        break;
      }

      default:
        break;
    }
  }

  return `${out.join("\n")}\n`;
}

// Named separately so `compile` reads as a pipeline.
function blocks(markdown) {
  return parseBlocks(markdown);
}

const USAGE = `Usage: md2spdl [options] <file.md>

Compiles Markdown into an SPDL stream on stdout.

Options:
  -o, --output <file>   Write the stream to a file
  --width <cells>       Page width in cells (default: ${DEFAULTS.width})
  --height <cells>      Page height in cells (default: ${DEFAULTS.height})
  --margin <cells>      Margin inside the page (default: ${DEFAULTS.margin})
  -h, --help            Show this message`;

function parseArgs(argv) {
  const options = Object.assign({ input: null, output: null, help: false }, DEFAULTS);

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const takeNumber = (name) => {
      const value = Number(argv[++i]);
      if (!Number.isInteger(value) || value < 0) throw new Error(`${name} expects a non-negative integer`);
      return value;
    };

    if (arg === "-h" || arg === "--help") options.help = true;
    else if (arg === "-o" || arg === "--output") {
      options.output = argv[++i];
      if (options.output === undefined) throw new Error("--output expects a path");
    } else if (arg === "--width") options.width = takeNumber(arg);
    else if (arg === "--height") options.height = takeNumber(arg);
    else if (arg === "--margin") options.margin = takeNumber(arg);
    else if (arg.startsWith("-") && arg !== "-") throw new Error(`unknown option "${arg}"`);
    else if (options.input === null) options.input = arg;
    else throw new Error("md2spdl takes a single input file");
  }

  return options;
}

function main(argv = process.argv.slice(2), out = console) {
  let options;
  try {
    options = parseArgs(argv);
  } catch (error) {
    out.error(`md2spdl: ${error.message}\n\n${USAGE}`);
    return 2;
  }

  if (options.help) {
    out.log(USAGE);
    return 0;
  }

  const markdown = options.input && options.input !== "-"
    ? fs.readFileSync(options.input, "utf8")
    : fs.readFileSync(0, "utf8");

  const stream = compile(markdown, options);
  if (options.output) {
    fs.writeFileSync(options.output, stream);
    out.error(`Wrote ${options.output} from ${options.input ? path.basename(options.input) : "stdin"}`);
  } else {
    out.log(stream.trimEnd());
  }
  return 0;
}

if (require.main === module) {
  process.exit(main());
}

module.exports = { compile, parseBlocks, wrap, escapeOperand, plainText, main, USAGE, DEFAULTS };
