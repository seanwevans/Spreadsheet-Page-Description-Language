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

### 3. RenderRun the renderPDF() function. Watch 02_Rendered_View transform.
