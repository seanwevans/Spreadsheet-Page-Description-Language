# Spreadsheet Page Description Language (SPDL)

SPDL is a lightweight, interpreted markup language for building high-fidelity, interactive documents inside Google Sheets. It separates a linear **content stream** from the rendered **presentation layer**, letting you describe pages, text, shapes, images, and form controls using concise commands that are parsed by a Google Apps Script renderer.

![Status](https://img.shields.io/badge/Specification-v1.0-blue)
![Engine](https://img.shields.io/badge/Engine-Google%20Apps%20Script-green)

## Table of Contents
- [Overview](#overview)
- [How It Works](#how-it-works)
- [Setup](#setup)
- [Rendering a Document](#rendering-a-document)
- [Command Reference](#command-reference)
- [Examples](#examples)
- [Tips and Limitations](#tips-and-limitations)

## Overview
- **Content Sheet (`01_Hex_Stream`)**: Contains a linear command stream, one instruction per row starting at row 2, column A.
- **Render Sheet (`02_Rendered_View`)**: Acts as a 25×25 px canvas that the renderer manipulates to draw pages, text, shapes, form elements, and images.
- **Renderer (`spdlrender.gs`)**: A Google Apps Script that interprets the command stream, maintains graphics state (cursor position, colors, font, alignment, rotation, stroke width), and applies updates to the render sheet.

## How It Works
1. The renderer clears formatting on `02_Rendered_View`, sets a dark background, and initializes default state (cursor at A1, black fill/stroke, 15pt font, thick borders, no rotation).
2. Each command in `01_Hex_Stream` is read in order and modifies the graphics state or applies an action such as placing text, drawing a rectangle, inserting an image, or adding a checkbox.
3. Pages are defined with `MediaBox` and optionally chained with `/NewPage`. The renderer draws the page boundary and tracks the top row for subsequent page-relative commands.
4. At the end of the stream, the render sheet shows the fully composed layout.

## Setup
1. Create a new Google Sheet with two sheets named exactly:
   - `01_Hex_Stream`
   - `02_Rendered_View`
2. Open **Extensions → Apps Script** and paste the contents of [`spdlrender.gs`](spdlrender.gs) into the editor.
3. Save the project and grant permissions to the script when prompted.
4. (Optional) Adjust the `maxRows`, `maxCols`, or `cellSize` constants if you need a different canvas size.

## Rendering a Document
1. In `01_Hex_Stream`, place one command per row starting at **row 2, column A**.
2. From Apps Script, run the `renderPDF()` function. The script will:
   - Clear previous formatting and images in `02_Rendered_View`.
   - Resize rows/columns to 25 px and set default styles.
   - Interpret each command and update the grid.

## Command Reference
The renderer understands a subset of PDF/PostScript-inspired operations. Commands are case-sensitive.

### Page and Cursor Control
- `W H MediaBox` — Define page width/height (in cells). Draws a white canvas with a border. Required before `/NewPage`.
- `/NewPage` — Starts a new page below the previous one using the last `MediaBox` dimensions.
- `/MoveTo X Y` — Move cursor to an absolute cell (1-based) relative to the current page’s top-left corner. Y is clamped to the page height.
- `dx dy Td` — Move cursor **relatively** by deltas (tenths of a cell). `10 10 Td` moves one cell down/right.

### Text and Typography
- `(text) Tj` — Write text at the current cursor with active styling (fill color, weight, style, rotation, alignment).
- `/Link` — `(url) (label) /Link` inserts a hyperlink formula using the current font settings.
- `/F2 15 Tf` — Sets **bold** font; `/F3` sets **italic**. Font size defaults to 15 pt; adjust with `Ts` in the command stream (see examples).
- `1 Tr` — Underline on; `0 Tr` — remove underline.
- `n TA` — Alignment shorthand:
  - `0/1/2` → horizontal left/center/right
  - `3/4/5` → vertical top/middle/bottom
  - `6+` → reset to sheet defaults
- `/Align HLeft|HCenter|HRight|VTop|VMiddle|VBottom` — Verbose alignment controls.
- `/Rotate n` — Sets text rotation in degrees applied to subsequent text.

### Color and Stroke
- `r g b rg` — Set **fill** color (0–1 floats scaled to 0–255).
- `r g b SC` — Set **stroke** color independently.
- `n w` — Set stroke width. Maps to Google Sheets border styles: 1=solid, 2=medium, 3=thick (default), 4=double.

### Shapes and Paths
- `x y w h re` — Define a rectangle path at page-relative position.
- `f` — Fill the last path using the current fill color.
- `S` — Stroke the last path using the current stroke color and width.

### Images
- `w h (url) /InsertImage` — Insert an image at the cursor, sized to `w × h` pixels.
- `w h ID <data>` — Render pixel art where `<data>` is a string of color codes (1=black, 2=yellow, 3=red) filling the specified width/height starting at the cursor.

### Forms and Annotations
- `/CheckBox` — Inserts a centered checkbox at the current cell.
- `(opt1,opt2,...) /Dropdown` — Merged dropdown list across six columns with a yellow background and border.
- `(note) /Note` — Adds a cell note at the cursor.

## Examples
Place these streams in `01_Hex_Stream` (starting at row 2) and run `renderPDF()`.

### Hello World
```spdl
16 20 MediaBox
1 0 0 rg
/F2 15 Tf
40 40 Td
(Hello World) Tj
0 0 0 rg
0 40 Td
(Welcome to SPDL) Tj
/CheckBox
```

### Variable Font Size and Movement
```spdl
16 20 MediaBox
/F2 15 Tf
12 Ts
40 40 Td
(Hello World) Tj
20 Ts
0 40 Td
(Bigger Text) Tj
```

### Fill and Stroke Separation
```spdl
16 20 MediaBox
0 0 1 rg
1 0 0 SC
10 10 4 2 re
f
S
0 20 Td
(Outlined Text) Tj
```

### Absolute vs Relative Positioning
```spdl
16 20 MediaBox
/MoveTo 4 3
(Header) Tj
20 0 Td
(Next Cell) Tj
/MoveTo 1 15
(Footer) Tj
```

### Alignment and Hyperlink
```spdl
16 20 MediaBox
/Align VMiddle
1 TA
(https://example.com) (Click Me) /Link
0 TA
0 -10 Td
(Left-aligned subtitle) Tj
```

### Shape with Custom Stroke
```spdl
16 20 MediaBox
3 w
0 0 0 rg
2 2 8 6 re
S
```

## Tips and Limitations
- The renderer clamps `/MoveTo` coordinates within the current page and sheet bounds to avoid errors.
- Page drawing requires valid positive dimensions; invalid `MediaBox` values are skipped with a log message.
- Pixel art `ID` data must include at least `width × height` characters; extra data is ignored.
- Alignment resets can be triggered with `6 TA` or higher to fall back to the sheet’s defaults.
- The default canvas is 1000 rows × 26 columns with 25 px cells; adjust the constants in the script if needed.

## License
MIT (c) 2024.
