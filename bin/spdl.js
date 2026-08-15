#!/usr/bin/env node
/**
 * The SPDL command line: render a stream to a picture, or lint it.
 *
 * `spdl render` exists so you can look at a stream without a Google account,
 * an Excel licence or an Airtable base — and so a change to the semantics can
 * be reviewed as a picture rather than as a golden-file diff.
 */

const fs = require("fs");
const path = require("path");

const { parseSpdlDocument } = require("../spdl-parser.js");
const { renderSvg, renderHtml } = require("../spdl-svg.js");
const { lint } = require("../spdl-lint.js");

const { version } = require("../package.json");

const USAGE = `Usage: spdl <command> [options]

Commands:
  render <file>    Render a stream to SVG, HTML or JSON (- reads stdin)
  lint [file ...]  Validate streams against the grammar in SPEC.md

Render options:
  -o, --output <file>   Write to a file (default: stdout)
  -f, --format <fmt>    svg | html | json (default: from -o, else svg)
  --cell-size <px>      Cell size in pixels (default: 25)
  --title <text>        Title for the HTML page

Common options:
  -h, --help       Show this message
  -v, --version    Show the version

Examples:
  spdl render examples/invoice.spdl -o invoice.svg
  spdl render - --format json < stream.spdl
  spdl lint --max-warnings 0 examples/*.spdl`;

const FORMATS = new Set(["svg", "html", "json"]);

function parseRenderArgs(argv) {
  const options = { input: null, output: null, format: null, cellSize: 25, title: null };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const takeValue = (name) => {
      const value = argv[++i];
      if (value === undefined) throw new Error(`${name} expects a value`);
      return value;
    };

    if (arg === "-o" || arg === "--output") {
      options.output = takeValue(arg);
    } else if (arg === "-f" || arg === "--format") {
      options.format = takeValue(arg).toLowerCase();
    } else if (arg === "--cell-size") {
      const value = Number(takeValue(arg));
      if (!Number.isFinite(value) || value <= 0) throw new Error("--cell-size expects a positive number");
      options.cellSize = value;
    } else if (arg === "--title") {
      options.title = takeValue(arg);
    } else if (arg.startsWith("-") && arg !== "-") {
      throw new Error(`unknown option "${arg}"`);
    } else if (options.input === null) {
      options.input = arg;
    } else {
      throw new Error("render takes a single input file");
    }
  }

  if (options.input === null) throw new Error("render needs an input file (use - for stdin)");

  if (options.format === null) {
    const extension = options.output ? path.extname(options.output).slice(1).toLowerCase() : "";
    options.format = FORMATS.has(extension) ? extension : "svg";
  }
  if (!FORMATS.has(options.format)) {
    throw new Error(`unknown format "${options.format}" (expected ${[...FORMATS].join(", ")})`);
  }

  return options;
}

function render(argv, out) {
  const options = parseRenderArgs(argv);
  const stream = options.input === "-"
    ? fs.readFileSync(0, "utf8")
    : fs.readFileSync(options.input, "utf8");

  const document = parseSpdlDocument(stream);
  const title = options.title
    || (options.input === "-" ? "SPDL document" : path.basename(options.input));

  let output;
  if (options.format === "json") {
    output = JSON.stringify(document, null, 2);
  } else if (options.format === "html") {
    output = renderHtml(document, { cellSize: options.cellSize, title });
  } else {
    output = renderSvg(document, { cellSize: options.cellSize });
  }

  if (options.output) {
    fs.writeFileSync(options.output, `${output}\n`);
    out.error(`Wrote ${options.output} (${document.records.length} cell ops, ${document.pages.length} page(s))`);
  } else {
    out.log(output);
  }
  return 0;
}

// A thin front-end over spdl-lint's `lint()`, so `spdl lint` and
// `node spdl-lint.js` report the same findings in the same format.
function runLint(argv, out) {
  const inputs = argv.length > 0
    ? argv.map((file) => ({ name: file, stream: fs.readFileSync(file, "utf8") }))
    : [{ name: "<stdin>", stream: fs.readFileSync(0, "utf8") }];

  let errorCount = 0;
  let warningCount = 0;
  for (const { name, stream } of inputs) {
    const findings = lint(stream);
    errorCount += findings.errors.length;
    warningCount += findings.warnings.length;
    for (const error of findings.errors) {
      out.log(`${name}:${error.line}: error: ${error.message}: "${error.command}"`);
    }
    for (const warning of findings.warnings) {
      out.log(`${name}:${warning.line}: warning: ${warning.message}: "${warning.command}"`);
    }
  }

  out.log(`${errorCount} error(s), ${warningCount} warning(s)`);
  return errorCount > 0 ? 1 : 0;
}

function main(argv = process.argv.slice(2), out = console) {
  const [command, ...rest] = argv;

  if (command === undefined || command === "-h" || command === "--help" || command === "help") {
    out.log(USAGE);
    return command === undefined ? 1 : 0;
  }
  if (command === "-v" || command === "--version" || command === "version") {
    out.log(version);
    return 0;
  }

  if (command === "lint") {
    return runLint(rest, out);
  }

  if (command === "render") {
    try {
      return render(rest, out);
    } catch (error) {
      out.error(`spdl render: ${error.message}`);
      return 2;
    }
  }

  out.error(`spdl: unknown command "${command}"\n\n${USAGE}`);
  return 2;
}

if (require.main === module) {
  process.exit(main());
}

module.exports = { main, parseRenderArgs, USAGE };
