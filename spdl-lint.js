#!/usr/bin/env node
/**
 * SPDL stream validator.
 *
 * Checks each line of a stream against the grammar in SPEC.md (as implemented
 * by the reference parser's anchored patterns) and reports:
 *   - errors: lines that match no command and would be silently skipped
 *   - warnings: commands that parse but will render as no-ops or clamped
 *     values (e.g. /NewPage before MediaBox, short pixel-art payloads)
 *
 * Usage:
 *   node spdl-lint.js stream.spdl [more.spdl ...]
 *   cat stream.spdl | node spdl-lint.js
 *
 * Exits 1 when any error is found.
 */

const { patterns, operators } = require("./spdl-parser.js");

const ALIGN_DIRECTIVES = new Set(["HLeft", "HCenter", "HRight", "VTop", "VMiddle", "VBottom"]);

function lint(stream) {
  const errors = [];
  const warnings = [];
  let mediaBoxValid = false;

  const lines = stream.split(/\r?\n/);
  for (let i = 0; i < lines.length; i += 1) {
    const lineNumber = i + 1;
    const command = lines[i].trim();
    if (!command) continue;
    if (command.startsWith("%")) continue; // comment line

    const report = (list, message) => list.push({ line: lineNumber, command, message });

    let match;
    if ((match = command.match(patterns.mediaBox))) {
      const w = parseInt(match[1], 10);
      const h = parseInt(match[2], 10);
      if (w > 0 && h > 0) {
        mediaBoxValid = true;
      } else {
        mediaBoxValid = false;
        report(warnings, "MediaBox dimensions must be positive; this page is skipped and /NewPage is disabled");
      }
      continue;
    }

    if (command === "/NewPage") {
      if (!mediaBoxValid) {
        report(warnings, "/NewPage before a valid MediaBox is skipped");
      }
      continue;
    }

    if ((match = command.match(patterns.pixelArt))) {
      const w = parseInt(match[1], 10);
      const h = parseInt(match[2], 10);
      if (match[3].length < w * h) {
        report(warnings, `pixel art payload has ${match[3].length} characters but ${w}x${h} needs ${w * h}; the block is skipped`);
      }
      continue;
    }

    if ((match = command.match(patterns.align))) {
      if (!ALIGN_DIRECTIVES.has(match[1])) {
        report(warnings, `unknown /Align directive "${match[1]}" (expected ${[...ALIGN_DIRECTIVES].join(", ")})`);
      }
      continue;
    }

    if ((match = command.match(patterns.fillColor)) || (match = command.match(patterns.strokeColor))) {
      const components = match.slice(1, 4).map(parseFloat);
      if (components.some((v) => v > 1)) {
        report(warnings, "color components are 0-1; larger values are clamped");
      }
      continue;
    }

    if ((match = command.match(patterns.rectangle))) {
      const w = Math.floor(parseFloat(match[3]));
      const h = Math.floor(parseFloat(match[4]));
      if (w > 0 && h > 0 && w * h > 100000) {
        report(warnings, `rectangle covers ${w * h} cells; shapes above 100000 cells are skipped`);
      }
      continue;
    }

    if ((match = command.match(patterns.fontSize))) {
      if (!(parseFloat(match[1]) > 0)) {
        report(warnings, "non-positive Ts resets the font size to the default");
      }
      continue;
    }

    const recognized = operators.includes(command)
      || Object.values(patterns).some((pattern) => pattern.test(command));
    if (!recognized) {
      report(errors, "unrecognized command; renderers skip this line");
    }
  }

  return { errors, warnings };
}

function formatFindings(name, findings) {
  const lines = [];
  for (const error of findings.errors) {
    lines.push(`${name}:${error.line}: error: ${error.message}: "${error.command}"`);
  }
  for (const warning of findings.warnings) {
    lines.push(`${name}:${warning.line}: warning: ${warning.message}: "${warning.command}"`);
  }
  return lines;
}

const USAGE = `Usage: spdl-lint [options] [file ...]

Validates SPDL streams against the grammar in SPEC.md. With no files, reads
the stream from stdin.

Options:
  --json               report findings as JSON instead of text
  --max-warnings <n>   fail when more than n warnings are found
  --quiet              report errors only (warnings are still counted)
  -h, --help           show this message

Exits 1 when any error is found, or when --max-warnings is exceeded.`;

// Parses argv into { files, json, quiet, maxWarnings }. Unknown options are
// an error rather than being treated as filenames.
function parseArgs(argv) {
  const options = { files: [], json: false, quiet: false, maxWarnings: Infinity, help: false };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else if (arg === "--json") {
      options.json = true;
    } else if (arg === "--quiet") {
      options.quiet = true;
    } else if (arg === "--max-warnings" || arg.startsWith("--max-warnings=")) {
      const raw = arg.startsWith("--max-warnings=")
        ? arg.slice("--max-warnings=".length)
        : argv[++i];
      const parsed = Number(raw);
      if (!Number.isInteger(parsed) || parsed < 0) {
        throw new Error(`--max-warnings expects a non-negative integer, got "${raw === undefined ? "" : raw}"`);
      }
      options.maxWarnings = parsed;
    } else if (arg.startsWith("-")) {
      throw new Error(`unknown option "${arg}"`);
    } else {
      options.files.push(arg);
    }
  }

  return options;
}

function lintInputs(inputs, options) {
  const results = [];
  let errorCount = 0;
  let warningCount = 0;

  for (const { name, stream } of inputs) {
    const findings = lint(stream);
    errorCount += findings.errors.length;
    warningCount += findings.warnings.length;
    results.push({ file: name, errors: findings.errors, warnings: findings.warnings });
  }

  const overWarningLimit = warningCount > options.maxWarnings;
  return {
    results,
    errorCount,
    warningCount,
    maxWarnings: options.maxWarnings === Infinity ? null : options.maxWarnings,
    ok: errorCount === 0 && !overWarningLimit,
  };
}

function main(argv = process.argv.slice(2), out = console) {
  const fs = require("fs");

  let options;
  try {
    options = parseArgs(argv);
  } catch (error) {
    out.error(`spdl-lint: ${error.message}\n\n${USAGE}`);
    return 2;
  }

  if (options.help) {
    out.log(USAGE);
    return 0;
  }

  const inputs = options.files.length > 0
    ? options.files.map((file) => ({ name: file, stream: fs.readFileSync(file, "utf8") }))
    : [{ name: "<stdin>", stream: fs.readFileSync(0, "utf8") }];

  const report = lintInputs(inputs, options);

  if (options.json) {
    out.log(JSON.stringify(report, null, 2));
  } else {
    for (const result of report.results) {
      const findings = options.quiet
        ? { errors: result.errors, warnings: [] }
        : result;
      for (const line of formatFindings(result.file, findings)) {
        out.log(line);
      }
    }
    out.log(`${report.errorCount} error(s), ${report.warningCount} warning(s)`);
    if (report.maxWarnings !== null && report.warningCount > report.maxWarnings) {
      out.log(`exceeded --max-warnings ${report.maxWarnings}`);
    }
  }

  return report.ok ? 0 : 1;
}

if (require.main === module) {
  process.exit(main());
}

module.exports = { lint, lintInputs, parseArgs, main, USAGE };
