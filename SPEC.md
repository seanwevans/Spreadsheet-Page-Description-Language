# SPDL Specification (v1.0)

This document defines the canonical semantics of the Spreadsheet Page
Description Language. Every renderer in this repository targets these rules;
where a platform cannot express a feature, the renderer must skip the command
(logging it where possible) rather than approximate it in a way that diverges
from this spec. The Node/Airtable parser (`parseSpdl` in
`spdlrender.airtable.js`) is the reference implementation for command parsing
and is covered by the test suite in `tests/`.

## Stream model

- A document is a **linear stream of commands**, one command per line (one per
  spreadsheet row, starting at row 2 of `01_Hex_Stream`).
- Leading/trailing whitespace is trimmed. **Blank lines are skipped**, not
  treated as end of stream.
- A line whose first non-whitespace character is `%` is a **comment** and is
  skipped entirely.
- Commands are **case-sensitive** and must match one of the grammar rules
  below **exactly** (anchored match). A line that matches no rule is an
  unrecognized command: renderers must skip it — never partially interpret
  it — and should log it.
- Text content inside `(…)` is opaque: it must never be scanned for operator
  substrings. `(Morgan) Tj` writes the text "Morgan"; it does not set a color.

## Text operands and escapes

Text operands support PDF-style escape sequences: `\(`, `\)`, and `\\`
produce a literal `(`, `)`, and `\` respectively. In multi-operand commands
(`/Link`, `/Note`, `/Dropdown`, `/InsertImage`) an escaped `)` does not end
the operand, so parentheses in labels and URLs must be escaped:
`(see \(footnote\)) /Note`. For backward compatibility, the single-operand
`(…) Tj` also accepts bare parentheses — its operand extends to the last `)`
before `Tj` — but escaping is recommended there too. Dropdown option lists
are split on `,` before unescaping; commas cannot appear inside an option.

The AppleScript renderer does not implement escape resolution (its text
handling is minimal); escaped text renders there with the backslashes
visible.

## Graphics state

Renderers maintain the following state, with these defaults:

| State | Default |
| --- | --- |
| Cursor (X, Y) | (1, 1) — 1-based cell coordinates |
| Fill color | black (`#000000`) |
| Stroke color | black (`#000000`) |
| Stroke width | 3 (thick) |
| Font size | 15 pt |
| Bold / italic / underline | off |
| Rotation | 0° |
| Alignment | the render sheet's defaults |
| Page | none (no MediaBox applied) |

## Number formats

- `int` — optionally signed decimal integer (`-?\d+`).
- `uint` — unsigned decimal integer (`\d+`).
- `num` — optionally signed decimal number with optional fraction
  (`[+-]?\d*\.?\d+`).
- `frac` — unsigned decimal number, expected in the range 0–1
  (`\d*\.?\d+`). Out-of-range values are clamped.

## Commands

### Page and cursor control

| Grammar | Meaning |
| --- | --- |
| `<uint:W> <uint:H> MediaBox` | Define the page size in cells and draw the page (white background, black border) at the current page top. Both dimensions must be > 0; otherwise the command is invalid, the renderer logs it, and `/NewPage` is disabled until a valid MediaBox appears. |
| `/NewPage` | Start a new page below the previous one, separated by 2 rows. Requires a valid MediaBox; otherwise logged and skipped. Resets the cursor to the new page's top-left. |
| `/MoveTo <int:X> <int:Y>` | Move the cursor to an absolute position **relative to the current page's top-left** (1-based). X is clamped to [1, pageWidth] (canvas width when no page is defined); Y is clamped to the page's rows (canvas height when no page is defined). |
| `<num:dx> <num:dy> Td` | Move the cursor relatively by tenths of a cell. Deltas are divided by 10 and **truncated toward zero**: `15 → +1`, `-15 → -1`, `5 → 0`. |

### Text and typography

| Grammar | Meaning |
| --- | --- |
| `(<text>) Tj` | Write `text` at the cursor using the active fill color, font size, weight, style, underline, rotation, and alignment. |
| `(<url>) (<label>) /Link` | Insert a hyperlink at the cursor with the active text styling. Renderers that build formulas must escape the URL and label so content cannot break out of the formula string. |
| `/F<uint:n> [<num:size>] Tf` | Select font variant: `n = 2` → bold, `n = 3` → italic, anything else → regular. The optional size operand sets the font size where supported. |
| `<num:size> Ts` | Set the font size in points. Non-positive or unparsable sizes reset to the default (15). Decimals are allowed. |
| `1 Tr` / `0 Tr` | Underline on / off. |
| `<uint:code> TA` | Alignment shorthand: `0/1/2` → horizontal left/center/right, `3/4/5` → vertical top/middle/bottom, `6+` → reset both to the sheet defaults. |
| `/Align <directive>` | Verbose alignment: `HLeft`, `HCenter`, `HRight`, `VTop`, `VMiddle`, `VBottom`. |
| `/Rotate <num:deg>` or `<num:deg> /Rotate` | Set text rotation in degrees for subsequent text. The value is truncated toward zero. |

### Color and stroke

| Grammar | Meaning |
| --- | --- |
| `<frac:r> <frac:g> <frac:b> rg` | Set the fill color. Components are 0–1, scaled to 0–255 and clamped. |
| `<frac:r> <frac:g> <frac:b> SC` | Set the stroke color, independent of fill. |
| `<uint:n> w` | Set the stroke width: `1` = thin, `2` = medium, `3` = thick (default), `4` = double. Other values map to the platform's thinnest style. |

### Shapes and paths

| Grammar | Meaning |
| --- | --- |
| `<num:x> <num:y> <num:w> <num:h> re` | Define a rectangle path at a page-relative position. Coordinates are floored to whole cells. Defining a path does not draw it. |
| `f` | Fill the current path with the fill color. |
| `S` | Stroke the current path's **perimeter** with the stroke color and width. |

Rectangles that extend past the canvas are clamped to it; rectangles entirely
outside the canvas are skipped with a log message.

### Images

| Grammar | Meaning |
| --- | --- |
| `<uint:w> <uint:h> (<url>) /InsertImage` | Insert the image at the cursor, sized to w × h pixels. Platforms that cannot fetch external images log and skip. |
| `<uint:w> <uint:h> ID <data>` | Pixel art: `data` is a string of color codes (`1` = black, `2` = yellow `#F1C40F`, `3` = red `#E74C3C`, anything else = transparent) laid out row-major from the cursor. `data` must contain at least `w × h` characters; extra characters are ignored. Out-of-canvas pixels are skipped. |

### Forms and annotations

| Grammar | Meaning |
| --- | --- |
| `/CheckBox` | Insert a centered checkbox (or a visual placeholder) at the cursor. |
| `(<opt1,opt2,…>) /Dropdown` | Insert a dropdown across up to 6 columns (shrunk at the canvas edge) with a yellow background, defaulting to the first option. |
| `(<note>) /Note` | Attach a note/comment to the cell at the cursor. |

## Error handling

- A failing command must not abort the render: renderers isolate each
  command, log the failure, and continue.
- All drawing is clamped to the canvas (default 1000 rows × 26 columns for
  the spreadsheet renderers); single-cell writes with an off-canvas cursor
  are skipped with a log message.

## Renderer feature support

Not every platform can express every command. The AppleScript/Numbers
renderer supports only the page, cursor, color, rectangle, and text commands
(see the README's feature matrix); the Office Scripts renderer cannot fetch
external images; Airtable stores alignment/rotation as metadata fields rather
than applying them visually. In all such cases the renderer logs and skips —
the stream itself remains portable.
