const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const cli = require('../bin/spdl.js');
const { lint } = require('../spdl-lint.js');

const workDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'spdl-cli-'));

function writeStream(contents) {
  const file = path.join(workDir(), 'stream.spdl');
  fs.writeFileSync(file, contents);
  return file;
}

function run(argv) {
  const output = [];
  const errors = [];
  const code = cli.main(argv, {
    log: (line) => output.push(String(line)),
    error: (line) => errors.push(String(line)),
  });
  return { code, output: output.join('\n'), errors: errors.join('\n') };
}

test('bare invocation prints usage and fails', () => {
  const { code, output } = run([]);
  assert.equal(code, 1);
  assert.match(output, /Usage: spdl <command>/);

  assert.equal(run(['--help']).code, 0);
  assert.match(run(['--version']).output, /^\d+\.\d+\.\d+$/);
});

test('an unknown command exits 2 with usage', () => {
  const { code, errors } = run(['frobnicate']);
  assert.equal(code, 2);
  assert.match(errors, /unknown command "frobnicate"/);
});

test('render writes SVG to stdout by default', () => {
  const file = writeStream('8 8 MediaBox\n(hello) Tj\n');
  const { code, output } = run(['render', file]);

  assert.equal(code, 0);
  assert.match(output, /^<svg xmlns=/);
  assert.match(output, />hello</);
});

test('the format follows the output extension', () => {
  const file = writeStream('8 8 MediaBox\n(hello) Tj\n');
  const directory = workDir();

  const html = path.join(directory, 'out.html');
  assert.equal(run(['render', file, '-o', html]).code, 0);
  assert.match(fs.readFileSync(html, 'utf8'), /^<!doctype html>/);

  const json = path.join(directory, 'out.json');
  assert.equal(run(['render', file, '-o', json]).code, 0);
  const document = JSON.parse(fs.readFileSync(json, 'utf8'));
  assert.equal(document.records[0].fields.Value, 'hello');
  assert.equal(document.pages.length, 1);

  const svg = path.join(directory, 'out.svg');
  assert.equal(run(['render', file, '-o', svg]).code, 0);
  assert.match(fs.readFileSync(svg, 'utf8'), /^<svg /);
});

test('--format overrides the extension', () => {
  const file = writeStream('4 4 MediaBox\n');
  const { output } = run(['render', file, '--format', 'json']);
  assert.equal(JSON.parse(output).pages.length, 1);
});

test('--cell-size scales the output', () => {
  const file = writeStream('4 4 MediaBox\n');
  assert.match(run(['render', file, '--cell-size', '10']).output, /width="60"/);
});

test('render reports bad arguments instead of throwing', () => {
  const file = writeStream('4 4 MediaBox\n');

  assert.equal(run(['render']).code, 2);
  assert.match(run(['render']).errors, /needs an input file/);
  assert.match(run(['render', file, '--format', 'pdf']).errors, /unknown format "pdf"/);
  assert.match(run(['render', file, '--cell-size', 'big']).errors, /positive number/);
  assert.match(run(['render', file, '--nope']).errors, /unknown option/);
  assert.match(run(['render', file, 'extra.spdl']).errors, /single input file/);
});

test('parseRenderArgs infers the format and keeps defaults', () => {
  assert.deepEqual(cli.parseRenderArgs(['a.spdl']), {
    input: 'a.spdl', output: null, format: 'svg', cellSize: 25, title: null,
  });
  assert.equal(cli.parseRenderArgs(['a.spdl', '-o', 'b.HTML']).format, 'html');
  assert.equal(cli.parseRenderArgs(['a.spdl', '-o', 'b.txt']).format, 'svg');
});

test('lint reports the same findings as spdl-lint', () => {
  const file = writeStream('16 20 MediaBox\n/NotACommand\n');
  const { code, output } = run(['lint', file]);

  assert.equal(code, 1);
  assert.equal(lint(fs.readFileSync(file, 'utf8')).errors.length, 1);
  assert.match(output, /error: unrecognized command/);
  assert.match(output, /1 error\(s\), 0 warning\(s\)/);

  const clean = writeStream('16 20 MediaBox\n(ok) Tj\n');
  assert.equal(run(['lint', clean]).code, 0);
});

test('every bundled example renders', () => {
  const examples = path.join(__dirname, '..', 'examples');
  for (const name of fs.readdirSync(examples).filter((f) => f.endsWith('.spdl'))) {
    const { code, output } = run(['render', path.join(examples, name)]);
    assert.equal(code, 0, `${name} should render`);
    assert.match(output, /<\/svg>$/, `${name} should produce a complete SVG`);
  }
});
