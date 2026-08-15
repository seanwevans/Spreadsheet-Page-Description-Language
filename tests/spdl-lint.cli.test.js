const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { main, parseArgs, lintInputs } = require('../spdl-lint.js');

const DIRTY_STREAM = [
  '16 20 MediaBox',
  '/NotACommand',
  '9999 9999 9999 9999 re',
  'f',
].join('\n');

function writeStream(contents) {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'spdl-lint-')), 'stream.spdl');
  fs.writeFileSync(file, contents);
  return file;
}

// Captures what the CLI would print instead of writing to the real console.
function run(argv) {
  const output = [];
  const errors = [];
  const code = main(argv, {
    log: (line) => output.push(String(line)),
    error: (line) => errors.push(String(line)),
  });
  return { code, output: output.join('\n'), errors: errors.join('\n') };
}

test('parseArgs reads flags, values and files', () => {
  const options = parseArgs(['--json', '--quiet', '--max-warnings', '3', 'a.spdl', 'b.spdl']);
  assert.equal(options.json, true);
  assert.equal(options.quiet, true);
  assert.equal(options.maxWarnings, 3);
  assert.deepEqual(options.files, ['a.spdl', 'b.spdl']);

  assert.equal(parseArgs(['--max-warnings=0']).maxWarnings, 0);
  assert.equal(parseArgs([]).maxWarnings, Infinity);
});

test('parseArgs rejects unknown options and bad warning limits', () => {
  assert.throws(() => parseArgs(['--nope']), /unknown option/);
  assert.throws(() => parseArgs(['--max-warnings', 'lots']), /non-negative integer/);
  assert.throws(() => parseArgs(['--max-warnings', '-1']), /non-negative integer/);
});

test('a clean stream exits 0', () => {
  const file = writeStream('16 20 MediaBox\n(hello) Tj\n');
  const { code, output } = run([file]);
  assert.equal(code, 0);
  assert.match(output, /0 error\(s\), 0 warning\(s\)/);
});

test('errors exit 1 and are reported with file, line and command', () => {
  const file = writeStream(DIRTY_STREAM);
  const { code, output } = run([file]);
  assert.equal(code, 1);
  assert.match(output, /stream\.spdl:2: error: unrecognized command/);
  assert.match(output, /stream\.spdl:3: warning: rectangle covers/);
});

test('--quiet drops warnings from the report but still counts them', () => {
  const file = writeStream(DIRTY_STREAM);
  const { output } = run(['--quiet', file]);
  assert.doesNotMatch(output, /warning: rectangle covers/);
  assert.match(output, /1 error\(s\), 1 warning\(s\)/);
});

test('--json emits a machine-readable report', () => {
  const file = writeStream(DIRTY_STREAM);
  const { code, output } = run(['--json', file]);
  const report = JSON.parse(output);

  assert.equal(code, 1);
  assert.equal(report.ok, false);
  assert.equal(report.errorCount, 1);
  assert.equal(report.warningCount, 1);
  assert.equal(report.maxWarnings, null);
  assert.equal(report.results.length, 1);
  assert.equal(report.results[0].errors[0].line, 2);
  assert.equal(report.results[0].warnings[0].command, '9999 9999 9999 9999 re');
});

test('--max-warnings fails a stream that only has warnings', () => {
  const file = writeStream('16 20 MediaBox\n/NewPage\n0 0 MediaBox\n');
  assert.equal(run([file]).code, 0, 'warnings alone do not fail by default');

  const limited = run(['--max-warnings', '0', file]);
  assert.equal(limited.code, 1);
  assert.match(limited.output, /exceeded --max-warnings 0/);

  assert.equal(run(['--max-warnings', '9', file]).code, 0);
});

test('--help prints usage and exits 0; a bad option exits 2', () => {
  const help = run(['--help']);
  assert.equal(help.code, 0);
  assert.match(help.output, /Usage: spdl-lint/);

  const bad = run(['--nope']);
  assert.equal(bad.code, 2);
  assert.match(bad.errors, /unknown option/);
});

test('several files are aggregated into one report', () => {
  const clean = writeStream('16 20 MediaBox\n(ok) Tj\n');
  const dirty = writeStream(DIRTY_STREAM);
  const report = lintInputs(
    [clean, dirty].map((file) => ({ name: file, stream: fs.readFileSync(file, 'utf8') })),
    { maxWarnings: Infinity },
  );

  assert.equal(report.results.length, 2);
  assert.equal(report.errorCount, 1);
  assert.equal(report.ok, false);
});
