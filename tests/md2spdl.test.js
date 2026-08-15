const test = require('node:test');
const assert = require('node:assert/strict');

const { compile, parseBlocks, escapeOperand, plainText, main } = require('../tools/md2spdl.js');
const { lint } = require('../spdl-lint.js');
const { parseSpdl } = require('../spdl-parser.js');

const valuesOf = (stream) => parseSpdl(stream)
  .filter((r) => r.fields.Value !== undefined)
  .map((r) => r.fields.Value);

test('blocks are recognized by type', () => {
  const blocks = parseBlocks([
    '# Title',
    '',
    'A paragraph that',
    'spans two source lines.',
    '',
    '- bullet',
    '1. numbered',
    '- [ ] todo',
    '- [x] done',
    '> quoted',
    '---',
    '```',
    'code()',
    '```',
  ].join('\n'));

  assert.deepEqual(blocks.map((b) => b.type), [
    'heading', 'paragraph', 'item', 'item', 'task', 'task', 'quote', 'rule', 'code',
  ]);
  assert.equal(blocks[0].level, 1);
  // Soft-wrapped source lines join into one paragraph.
  assert.equal(blocks[1].text, 'A paragraph that spans two source lines.');
  assert.equal(blocks[3].marker, '1.');
  assert.equal(blocks[4].checked, false);
  assert.equal(blocks[5].checked, true);
  assert.deepEqual(blocks[8].lines, ['code()']);
});

test('inline emphasis and link syntax are reduced to text', () => {
  assert.equal(plainText('**bold** and _italic_ and `code`'), 'bold and italic and code');
  assert.equal(plainText('see [the docs](https://example.com)'), 'see the docs');
  assert.equal(plainText('![alt text](https://example.com/x.png)'), 'alt text');
});

test('parentheses and backslashes in text are escaped for SPDL', () => {
  assert.equal(escapeOperand('a (b) c\\d'), 'a \\(b\\) c\\\\d');

  const stream = compile('A footnote (like this).');
  assert.deepEqual(valuesOf(stream), ['A footnote (like this).']);
});

test('the compiled stream is valid SPDL', () => {
  const stream = compile([
    '# Report',
    '',
    'Some prose long enough to wrap onto a second row of the page.',
    '',
    '- one',
    '- two',
    '',
    '---',
    '',
    '- [ ] a task',
    '',
    '> a quote',
    '',
    '```',
    'x = 1',
    '```',
  ].join('\n'));

  const findings = lint(stream);
  assert.deepEqual(findings.errors, []);
  assert.deepEqual(findings.warnings, []);
});

test('headings are bold and sized by level', () => {
  const stream = compile('# One\n\n## Two\n\n### Three');
  assert.match(stream, /\/F2 Tf\n24 Ts/);
  assert.match(stream, /\/F2 Tf\n19 Ts/);
  assert.match(stream, /\/F2 Tf\n16 Ts/);
  // The heading style is reset afterwards so the body is not bold.
  assert.match(stream, /\/F1 Tf\n15 Ts/);
});

test('paragraphs wrap to the page width', () => {
  const words = Array.from({ length: 40 }, (_, i) => `word${i}`).join(' ');
  const narrow = valuesOf(compile(words, { width: 10 }));
  const wide = valuesOf(compile(words, { width: 30 }));

  assert.ok(narrow.length > wide.length, 'a narrower page needs more rows');
  for (const line of narrow) {
    assert.ok(line.length <= (10 - 2) * 4, `"${line}" should fit the text column`);
  }
});

test('list markers sit in their own column', () => {
  const records = parseSpdl(compile('- first\n- second'));
  const markers = records.filter((r) => r.fields.Value === '•');
  const labels = records.filter((r) => r.fields.Value === 'first' || r.fields.Value === 'second');

  assert.equal(markers.length, 2);
  assert.ok(markers.every((r) => r.fields.Col === 1));
  assert.ok(labels.every((r) => r.fields.Col === 2));
});

test('tasks become checkboxes with their label alongside', () => {
  const records = parseSpdl(compile('- [ ] send invoice'));
  assert.ok(records.some((r) => r.fields.Checkbox === true && r.fields.Col === 1));
  assert.ok(records.some((r) => r.fields.Value === 'send invoice' && r.fields.Col === 2));
});

test('a standalone link becomes /Link, in a paragraph or a list', () => {
  const paragraph = parseSpdl(compile('[The docs](https://example.com/docs)'));
  assert.ok(paragraph.some((r) => r.fields.Link === 'https://example.com/docs' && r.fields.Value === 'The docs'));

  const item = parseSpdl(compile('- [The docs](https://example.com/docs)'));
  assert.ok(item.some((r) => r.fields.Link === 'https://example.com/docs'));
});

test('an image paragraph becomes /InsertImage', () => {
  const records = parseSpdl(compile('![logo](https://example.com/logo.png)'));
  const image = records.find((r) => r.fields.ImageURL);
  assert.equal(image.fields.ImageURL, 'https://example.com/logo.png');
});

test('a rule is a stroked one-row rectangle', () => {
  const records = parseSpdl(compile('a\n\n---\n\nb'));
  assert.ok(records.some((r) => r.fields.BorderColor === '#000000'));
});

test('content past the page height starts a new page', () => {
  const many = Array.from({ length: 30 }, (_, i) => `- item ${i}`).join('\n');
  const stream = compile(many, { height: 12 });

  assert.match(stream, /\/NewPage/);
  const rows = parseSpdl(stream).map((r) => r.fields.Row);
  assert.ok(Math.max(...rows) > 12, 'later pages sit below the first');
});

test('quotes and code are styled but still plain text', () => {
  const quote = compile('> hush');
  assert.match(quote, /\/F3 Tf/);

  const code = compile('```\nconst x = 1;\n```');
  assert.match(code, /0\.3 0\.3 0\.3 rg/);
  assert.deepEqual(valuesOf(code), ['const x = 1;']);
});

test('the CLI writes a stream and reports bad options', () => {
  const output = [];
  const errors = [];
  const io = { log: (l) => output.push(String(l)), error: (l) => errors.push(String(l)) };

  assert.equal(main(['--help'], io), 0);
  assert.match(output.join('\n'), /Usage: md2spdl/);

  assert.equal(main(['--width', 'wide'], io), 2);
  assert.match(errors.join('\n'), /non-negative integer/);
});
