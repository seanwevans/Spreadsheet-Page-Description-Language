/**
 * Conformance fixtures: streams every renderer must agree on.
 *
 * These are deliberately kept inside the canvas and inside a page, so a
 * failure means the renderers genuinely disagree about semantics rather than
 * about clamping edge cases (those have their own targeted tests).
 *
 * Add a fixture whenever a bug turns out to be a divergence between two
 * renderers — that is what stops it from coming back.
 */

const fixtures = [
  {
    name: 'text with the default graphics state',
    stream: `
      16 20 MediaBox
      (Hello World) Tj
    `,
  },
  {
    name: 'fill color, weight, style and underline apply per cell',
    stream: `
      16 20 MediaBox
      1 0 0 rg
      /F2 Tf
      1 Tr
      (bold red underlined) Tj
      20 0 Td
      0 Tr
      /F3 Tf
      0 0 1 rg
      (italic blue) Tj
      20 0 Td
      /F1 Tf
      0 0 0 rg
      (plain) Tj
    `,
  },
  {
    name: 'font size via Ts and via the Tf operand',
    stream: `
      16 20 MediaBox
      24 Ts
      (big) Tj
      0 10 Td
      /F2 9 Tf
      (small bold) Tj
      0 10 Td
      0 Ts
      (back to default) Tj
    `,
  },
  {
    name: 'alignment shorthand and verbose directives',
    stream: `
      16 20 MediaBox
      1 TA
      (centered) Tj
      0 10 Td
      /Align HRight
      (right) Tj
      0 10 Td
      /Align VBottom
      (bottom) Tj
      0 10 Td
      6 TA
      (defaults) Tj
    `,
  },
  {
    name: 'rotation in both operand orders',
    stream: `
      16 20 MediaBox
      /Rotate 45
      (rotated) Tj
      0 10 Td
      -30 /Rotate
      (other way) Tj
      0 10 Td
      /Rotate 0
      (upright) Tj
    `,
  },
  {
    name: 'relative and absolute cursor movement',
    stream: `
      16 20 MediaBox
      /MoveTo 4 3
      (header) Tj
      20 0 Td
      (next cell) Tj
      15 15 Td
      (truncated deltas) Tj
      /MoveTo 1 15
      (footer) Tj
    `,
  },
  {
    name: 'fill and stroke are independent',
    stream: `
      16 20 MediaBox
      0 0 1 rg
      1 0 0 SC
      2 2 6 4 re
      f
      S
    `,
  },
  {
    name: 'every stroke width maps to a border style',
    stream: `
      16 20 MediaBox
      1 w
      1 1 3 3 re
      S
      2 w
      5 1 3 3 re
      S
      3 w
      9 1 3 3 re
      S
      4 w
      1 5 3 3 re
      S
    `,
  },
  {
    name: 'links carry text styling and escape their operands',
    stream: `
      16 20 MediaBox
      1 Tr
      /F2 Tf
      0 0 1 rg
      (https://example.com) (Click Me) /Link
      0 10 Td
      (https://example.com/?q=\\(1\\)) (Parens \\(escaped\\)) /Link
    `,
  },
  {
    name: 'notes, checkboxes and dropdowns',
    stream: `
      16 20 MediaBox
      /MoveTo 2 2
      (a note) /Note
      0 10 Td
      /CheckBox
      0 10 Td
      (Alpha,Beta,Gamma) /Dropdown
    `,
  },
  {
    name: 'pixel art',
    stream: `
      16 20 MediaBox
      /MoveTo 2 2
      4 3 ID 123012301230
    `,
  },
  {
    name: 'multiple pages',
    stream: `
      10 6 MediaBox
      (page one) Tj
      /NewPage
      (page two) Tj
      0 0 1 rg
      1 1 3 2 re
      f
    `,
  },
  {
    name: 'comments, blank lines and unrecognized commands are skipped',
    stream: `
      16 20 MediaBox
      % this is a comment, not a command

      (kept) Tj
      /NotACommand 1 2 3
      0 10 Td
      (also kept) Tj
    `,
  },
  {
    name: 'text operands are opaque',
    stream: `
      16 20 MediaBox
      (1 0 0 rg) Tj
      0 10 Td
      (f) Tj
      0 10 Td
      (this (has) parens) Tj
    `,
  },
  {
    name: 'invalid MediaBox disables NewPage',
    stream: `
      0 0 MediaBox
      /NewPage
      (still on the first page) Tj
    `,
  },
];

// Streams are indented for readability in this file; renderers see one
// trimmed command per line.
function commandsOf(fixture) {
  return fixture.stream
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

function streamOf(fixture) {
  return commandsOf(fixture).join('\n');
}

module.exports = { fixtures, commandsOf, streamOf };
