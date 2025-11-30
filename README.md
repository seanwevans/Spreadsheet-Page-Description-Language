![Status](https://img.shields.io/badge/Specification-v1.0-blue)
![Engine](https://img.shields.io/badge/Engine-Google%20Apps%20Script-green)

# Spreadsheet Page Description Language (SPDL)

[Example](https://docs.google.com/spreadsheets/d/1SYbsbv3M6PNSxPFD_nSV5ypuiqDY3tPuvBJ46rLNb7s/edit?usp=sharing)

**SPDL** is a lightweight, interpreted markup language designed to define high-fidelity, interactive documents and forms programmatically within the constraint-based environment of a spreadsheet grid.

Inspired by the PDF specification and PostScript, SPDL separates the **Content Layer** (a linear stream of ASCII commands) from the **Presentation Layer** (the rendered spreadsheet view).

## 🏗 Architecture

The SPDL ecosystem consists of three components:

1.  **The Hex Stream (`01_Hex_Stream`)**: The source code. A linear sequence of instructions defining layout, state, and content.
2.  **The SPDL Virtual Machine (`spdlrender.gs`)**: A rendering engine that parses the stream, maintains graphics state (cursor `x,y`, color, rotation), and manipulates the DOM (Spreadsheet Grid).
3.  **The Viewport (`02_Rendered_View`)**: The target output. A standardized 25x25px grid canvas where the document is rasterized.

## 🚀 Quick Start

### 1. Environment Setup
1.  Create a new Google Sheet.
2.  Name the first tab `01_Hex_Stream`.
3.  Name the second tab `02_Rendered_View`.
4.  Open **Extensions > Apps Script** and deploy the SPDL Engine (see `spdlrender.gs`).

### 2. Your First SPDL Document
Paste this command stream into **Row 2, Column A** of `01_Hex_Stream`:

```spdl
16 20 MediaBox        % Set page size 16x20 units
1 0 0 rg              % Set Ink Color to Red
/F2 15 Tf             % Set Font to Bold, Size 15
40 40 Td              % Move Cursor
(Hello World) Tj      % Print Text
0 0 0 rg              % Set Ink Color to Black
0 40 Td               % Move Down
(Welcome to SPDL) Tj  % Print Text
/CheckBox             % Render Interactive Checkbox
```

### 3. Adjust font size with `Ts`

Use the `Ts` operator to update the current font size before placing text. The size is applied to subsequent `Tj` commands until `Ts` is called again.

```spdl
16 20 MediaBox     % Set page size 16x20 units
/F2 15 Tf          % Bold font face
12 Ts              % Set font size to 12pt
40 40 Td           % Move Cursor
(Hello World) Tj   % Render 12pt text
20 Ts              % Increase to 20pt
0 40 Td            % Move Down
(Bigger Text) Tj   % Render 20pt text
### 3. Independent Fill & Stroke Colors
Use `rg` to set the fill color and `SC` to set the stroke color independently:

```spdl
0 0 1 rg      % Fill with Blue
1 0 0 SC      % Stroke with Red
10 10 4 2 re  % Rectangle path
f             % Fill (blue)
S             % Stroke (red)
0 20 Td       % Move Down
(Outlined Text) Tj  % Text uses the fill color
### 3. Positioning Commands

- **`Td`**: Relative movement. Offsets the current cursor by the provided X/Y deltas (in tenths of a grid cell). Best for flowing text or incremental placement.
- **`/MoveTo x y`**: Absolute movement. Jumps the cursor to a specific grid cell on the active page. Y coordinates are interpreted relative to the top of the current page.

#### Combining `Td` and `/MoveTo`

```spdl
16 20 MediaBox
/MoveTo 4 3      % Jump to absolute row/column within the page
(Header) Tj
20 0 Td          % Move right relative to current position
(Next Cell) Tj
/MoveTo 1 15     % Jump to a new row on the same page
(Footer) Tj
```

### 4. Render
Run the renderPDF() function.

## ✏️ Stroke Widths
Control border weight with the `w` command before drawing strokes. Supported values map to Google Apps Script border styles:

| Command | Border Style                         |
|---------|--------------------------------------|
| `1 w`   | `SpreadsheetApp.BorderStyle.SOLID`   |
| `2 w`   | `SpreadsheetApp.BorderStyle.SOLID_MEDIUM` |
| `3 w`   | `SpreadsheetApp.BorderStyle.SOLID_THICK`  |
| `4 w`   | `SpreadsheetApp.BorderStyle.DOUBLE`  |

Example: set a thicker outline for the page frame and rectangles:

```spdl
16 20 MediaBox        % Page size
3 w                   % Use thick strokes
0 0 0 rg              % Black ink
2 2 8 6 re            % Define rectangle
S                     % Stroke rectangle with current width
## ✍️ Alignment Commands

Control horizontal and vertical alignment without changing font settings:

- `/Align HLeft`, `/Align HCenter`, `/Align HRight`
- `/Align VTop`, `/Align VMiddle`, `/Align VBottom`
- Numeric shorthand using `TA` (`Text Align`):
  - `0 TA` → horizontal left
  - `1 TA` → horizontal center
  - `2 TA` → horizontal right
  - `3 TA` → vertical top
  - `4 TA` → vertical middle
  - `5 TA` → vertical bottom
  - `6 TA` → reset both to the sheet defaults

### Sample Streams

Center a heading, then left-align the next line:

```spdl
16 20 MediaBox
/Align HCenter
(Centered Title) Tj
0 TA
0 -10 Td
(Left-aligned subtitle) Tj
```

Mix vertical and horizontal alignment for hyperlinks:

```spdl
16 20 MediaBox
/Align VMiddle
1 TA
(https://example.com) (Click Me) /Link
```
