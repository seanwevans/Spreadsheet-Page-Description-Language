"""
SPDL renderer for LibreOffice Calc using UNO API.
Paste into the Calc macro organizer (My Macros → Standard) or keep adjacent to the document and run with the Python macro bridge.
"""
from __future__ import annotations
import math
import uno
from com.sun.star.uno import Exception as UnoException
from com.sun.star.awt import Size, Point

# Constants
CELL_SIZE_PX = 25
MAX_ROWS = 1000
MAX_COLS = 26
DEFAULT_FONT_SIZE = 15
DEFAULT_FILL = "#000000"
DEFAULT_STROKE = "#000000"


def _px_to_hmm(px: int) -> int:
    # 1 px ≈ 26.46 hundredths of a millimetre at 96 dpi
    return int(px * 26.46)


def _get_sheets(doc):
    sheets = doc.getSheets()
    return sheets.getByName("01_Hex_Stream"), sheets.getByName("02_Rendered_View")


def _read_stream(source_sheet) -> list[str]:
    data = []
    cursor = source_sheet.createCursor()
    cursor.gotoEndOfUsedArea(False)
    last_row = cursor.getRangeAddress().EndRow
    for row in range(1, last_row + 1):
        cell = source_sheet.getCellByPosition(0, row)
        text = cell.getString().strip()
        if text:
            data.append(text)
    return data


def _clear_canvas(sheet):
    # Clear cell formatting and resize grid
    sheet_rows = sheet.Rows
    sheet_cols = sheet.Columns
    for c in range(MAX_COLS):
        sheet_cols.getByIndex(c).Width = _px_to_hmm(CELL_SIZE_PX)
    for r in range(MAX_ROWS):
        sheet_rows.getByIndex(r).Height = _px_to_hmm(CELL_SIZE_PX)
    sheet.getCellRangeByPosition(0, 0, MAX_COLS - 1, MAX_ROWS - 1).clearContents(1023)
    cursor = sheet.createCursor()
    cursor.gotoEndOfUsedArea(True)
    cursor.CharHeight = DEFAULT_FONT_SIZE
    cursor.CharColor = int(DEFAULT_FILL.replace("#", "0x"), 16)
    cursor.CharWeight = uno.getConstantByName("com.sun.star.awt.FontWeight.NORMAL")
    cursor.CharPosture = uno.getConstantByName("com.sun.star.awt.FontSlant.NONE")
    cursor.CellBackColor = 0x505050
    cursor.HoriJustify = uno.getConstantByName("com.sun.star.table.CellHoriJustify.LEFT")
    cursor.VertJustify = uno.getConstantByName("com.sun.star.table.CellVertJustify.TOP")
    sheet.clearAllConditionalFormats()


def _hex_to_color(value: str) -> int:
    return int(value.replace("#", "0x"), 16)


def _parse_rgb(parts: list[str]) -> str:
    r = max(0, min(255, int(float(parts[0]) * 255)))
    g = max(0, min(255, int(float(parts[1]) * 255)))
    b = max(0, min(255, int(float(parts[2]) * 255)))
    return f"#{r:02x}{g:02x}{b:02x}"


def _border_line(color: str, width: int):
    line = uno.createUnoStruct("com.sun.star.table.BorderLine2")
    line.Color = _hex_to_color(color)
    line.OuterLineWidth = max(20, min(150, width * 20))
    return line


def _draw_page(sheet, top_row: int, width: int, height: int, stroke: str, stroke_width: int):
    cell_range = sheet.getCellRangeByPosition(0, top_row, max(0, width - 1), max(0, height - 1))
    borders = cell_range.TableBorder2
    line = _border_line(stroke, stroke_width)
    borders.LeftLine = borders.RightLine = borders.TopLine = borders.BottomLine = line
    borders.IsTopLineValid = borders.IsBottomLineValid = borders.IsLeftLineValid = borders.IsRightLineValid = True
    cell_range.TableBorder2 = borders
    cell_range.CellBackColor = 0xFFFFFF


def _insert_image(sheet, url: str, col: int, row: int, width_px: int, height_px: int):
    doc = sheet.getSpreadsheet().getSpreadsheetDocument()
    graphic_provider = doc.createInstance("com.sun.star.graphic.GraphicProvider")
    graphic = graphic_provider.queryGraphic({"URL": url})
    draw_page = sheet.getDrawPage()
    shape = doc.createInstance("com.sun.star.drawing.GraphicObjectShape")
    shape.Graphic = graphic
    cell = sheet.getCellByPosition(col - 1, row - 1)
    pos = cell.getPosition()
    shape.Position = Point(pos.X, pos.Y)
    shape.Size = Size(_px_to_hmm(width_px), _px_to_hmm(height_px))
    draw_page.add(shape)


def _checkbox(sheet, col: int, row: int):
    doc = sheet.getSpreadsheet().getSpreadsheetDocument()
    form = doc.createInstance("com.sun.star.form.component.CheckBox")
    shape = doc.createInstance("com.sun.star.drawing.ControlShape")
    cell = sheet.getCellByPosition(col - 1, row - 1)
    pos = cell.getPosition()
    shape.Control = form
    shape.Position = Point(pos.X + 30, pos.Y + 30)
    shape.Size = Size(_px_to_hmm(20), _px_to_hmm(20))
    sheet.getDrawPage().add(shape)


def _dropdown(sheet, col: int, row: int, options: list[str]):
    cell_range = sheet.getCellRangeByPosition(col - 1, row - 1, col + 4, row - 1)
    dv = uno.createUnoStruct("com.sun.star.sheet.Validation")
    dv.Type = uno.getConstantByName("com.sun.star.sheet.ValidationType.LIST")
    dv.ShowList = True
    dv.Formula1 = ",".join(options)
    cell_range.Validation = dv
    cell_range.setFormula(options[0])
    cell_range.CellBackColor = 0xFFF2CC


def render_spdl(*args):
    doc = XSCRIPTCONTEXT.getDocument()
    source_sheet, render_sheet = _get_sheets(doc)
    stream = _read_stream(source_sheet)
    _clear_canvas(render_sheet)

    cursor_x = 1
    cursor_y = 1
    page_top = 0
    page_width = 0
    page_height = 0
    fill_color = DEFAULT_FILL
    stroke_color = DEFAULT_STROKE
    stroke_width = 3
    bold = False
    italic = False
    underline = False
    rotation = 0
    font_size = DEFAULT_FONT_SIZE
    hori_align = uno.getConstantByName("com.sun.star.table.CellHoriJustify.LEFT")
    vert_align = uno.getConstantByName("com.sun.star.table.CellVertJustify.TOP")
    current_path = None

    for command in stream:
        try:
            if "MediaBox" in command:
                parts = command.split()
                if len(parts) >= 2:
                    page_width = max(1, int(parts[0]))
                    page_height = max(1, int(parts[1]))
                    page_top = cursor_y - 1
                    _draw_page(render_sheet, page_top, page_width, page_height, stroke_color, stroke_width)
                continue
            if "/NewPage" in command:
                if page_height > 0:
                    cursor_y = page_top + page_height + 2
                    page_top = cursor_y - 1
                    _draw_page(render_sheet, page_top, page_width, page_height, stroke_color, stroke_width)
                continue
            if "/MoveTo" in command:
                parts = command.split()
                cursor_x = max(1, int(parts[1]))
                cursor_y = page_top + max(1, int(parts[2]))
                continue
            if command.endswith("Td"):
                parts = command.split()
                dx = math.floor(float(parts[0]) / 10)
                dy = math.floor(float(parts[1]) / 10)
                cursor_x += dx
                cursor_y += dy
                continue
            if command.endswith("rg"):
                fill_color = _parse_rgb(command.split())
                continue
            if command.endswith("SC"):
                stroke_color = _parse_rgb(command.split())
                continue
            if command.endswith("Tf"):
                parts = command.split()
                font_size = int(parts[-2]) if len(parts) >= 2 else font_size
                bold = "/F2" in command
                italic = "/F3" in command
                continue
            if command.endswith("Ts"):
                parts = command.split()
                font_size = int(parts[0])
                continue
            if command.endswith("Tr"):
                underline = command.startswith("1")
                continue
            if command.endswith("TA"):
                code = int(command.split()[0])
                if code == 0:
                    hori_align = uno.getConstantByName("com.sun.star.table.CellHoriJustify.LEFT")
                elif code == 1:
                    hori_align = uno.getConstantByName("com.sun.star.table.CellHoriJustify.CENTER")
                elif code == 2:
                    hori_align = uno.getConstantByName("com.sun.star.table.CellHoriJustify.RIGHT")
                elif code == 3:
                    vert_align = uno.getConstantByName("com.sun.star.table.CellVertJustify.TOP")
                elif code == 4:
                    vert_align = uno.getConstantByName("com.sun.star.table.CellVertJustify.CENTER")
                elif code == 5:
                    vert_align = uno.getConstantByName("com.sun.star.table.CellVertJustify.BOTTOM")
                continue
            if "/Align" in command:
                directive = command.split()[1]
                if directive == "HLeft":
                    hori_align = uno.getConstantByName("com.sun.star.table.CellHoriJustify.LEFT")
                if directive == "HCenter":
                    hori_align = uno.getConstantByName("com.sun.star.table.CellHoriJustify.CENTER")
                if directive == "HRight":
                    hori_align = uno.getConstantByName("com.sun.star.table.CellHoriJustify.RIGHT")
                if directive == "VTop":
                    vert_align = uno.getConstantByName("com.sun.star.table.CellVertJustify.TOP")
                if directive == "VMiddle":
                    vert_align = uno.getConstantByName("com.sun.star.table.CellVertJustify.CENTER")
                if directive == "VBottom":
                    vert_align = uno.getConstantByName("com.sun.star.table.CellVertJustify.BOTTOM")
                continue
            if "/Rotate" in command:
                rotation = int(command.split()[0])
                continue
            if command.endswith("w"):
                stroke_width = int(command.split()[0])
                continue
            if command.endswith("re"):
                parts = command.split()
                current_path = {
                    "x": int(parts[0]),
                    "y": page_top + int(parts[1]),
                    "w": int(parts[2]),
                    "h": int(parts[3]),
                }
                continue
            if command == "f" and current_path:
                rng = render_sheet.getCellRangeByPosition(current_path["x"] - 1, current_path["y"] - 1,
                                                           current_path["x"] + current_path["w"] - 2,
                                                           current_path["y"] + current_path["h"] - 2)
                rng.CellBackColor = _hex_to_color(fill_color)
                continue
            if command == "S" and current_path:
                rng = render_sheet.getCellRangeByPosition(current_path["x"] - 1, current_path["y"] - 1,
                                                           current_path["x"] + current_path["w"] - 2,
                                                           current_path["y"] + current_path["h"] - 2)
                borders = rng.TableBorder2
                line = _border_line(stroke_color, stroke_width)
                borders.LeftLine = borders.RightLine = borders.TopLine = borders.BottomLine = line
                borders.IsTopLineValid = borders.IsBottomLineValid = borders.IsLeftLineValid = borders.IsRightLineValid = True
                rng.TableBorder2 = borders
                continue
            if "/InsertImage" in command:
                import re
                match = re.search(r"\(([^)]+)\)", command)
                if match:
                    url = match.group(1)
                    nums = command.replace(match.group(0), "").split()
                    if len(nums) >= 2:
                        _insert_image(render_sheet, url, cursor_x, cursor_y, int(nums[0]), int(nums[1]))
                continue
            if " ID " in command:
                parts = command.split()
                width = int(parts[0]); height = int(parts[1]); data = parts[3]
                for r in range(height):
                    for c in range(width):
                        idx = r * width + c
                        if idx >= len(data):
                            break
                        color_code = data[idx]
                        color = None
                        if color_code == '1':
                            color = 0x000000
                        elif color_code == '2':
                            color = 0xF1C40F
                        elif color_code == '3':
                            color = 0xE74C3C
                        if color is not None:
                            render_sheet.getCellByPosition(cursor_x - 1 + c, cursor_y - 1 + r).CellBackColor = color
                continue
            if "/Note" in command:
                import re
                match = re.search(r"\(([^)]+)\)", command)
                if match:
                    render_sheet.getCellByPosition(cursor_x - 1, cursor_y - 1).setNote(match.group(1))
                continue
            if "/CheckBox" in command:
                _checkbox(render_sheet, cursor_x, cursor_y)
                continue
            if "/Dropdown" in command:
                import re
                match = re.search(r"\(([^)]+)\)", command)
                if match:
                    options = [opt.strip() for opt in match.group(1).split(',') if opt.strip()]
                    _dropdown(render_sheet, cursor_x, cursor_y, options)
                continue
            if "/Link" in command:
                import re
                matches = re.findall(r"\(([^)]+)\)", command)
                if len(matches) >= 2:
                    url, label = matches[0], matches[1]
                    cell = render_sheet.getCellByPosition(cursor_x - 1, cursor_y - 1)
                    cell.setFormula(f'=HYPERLINK("{url}", "{label}")')
                    cell.CharColor = _hex_to_color(fill_color)
                continue
            if command.endswith("Tj") and command.startswith("("):
                text = command[1:command.rfind(")")]
                cell = render_sheet.getCellByPosition(cursor_x - 1, cursor_y - 1)
                cell.String = text
                cell.CharColor = _hex_to_color(fill_color)
                cell.CharHeight = font_size
                cell.CharWeight = uno.getConstantByName("com.sun.star.awt.FontWeight.BOLD") if bold else uno.getConstantByName("com.sun.star.awt.FontWeight.NORMAL")
                cell.CharPosture = uno.getConstantByName("com.sun.star.awt.FontSlant.ITALIC") if italic else uno.getConstantByName("com.sun.star.awt.FontSlant.NONE")
                cell.HoriJustify = hori_align
                cell.VertJustify = vert_align
                cell.CharUnderline = uno.getConstantByName("com.sun.star.awt.FontUnderline.SINGLE") if underline else uno.getConstantByName("com.sun.star.awt.FontUnderline.NONE")
                cell.RotationAngle = rotation * 100
                continue
        except UnoException as exc:
            print(f"SPDL render error on command '{command}': {exc}")
            continue

    return None


g_exportedScripts = render_spdl,
