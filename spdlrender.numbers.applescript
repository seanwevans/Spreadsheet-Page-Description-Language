-- SPDL renderer for Apple Numbers via AppleScript
-- This script mirrors the Google Sheets renderer at a basic level.
-- Supported commands (case-sensitive):
--   W H MediaBox            : Defines a page height/width (in cells) and draws a white background region
--   /NewPage                : Starts a new page using the last MediaBox size
--   /MoveTo X Y             : Sets the cursor to an absolute position on the current page (1-based, clamped to the page bounds)
--   dx dy Td                : Moves the cursor relatively (tenths of a cell; truncated toward zero, matching the other renderers)
--   (text) Tj               : Writes text at the current cursor using the active fill color
--   r g b rg                : Sets the fill color (0–1 values)
--   r g b SC                : Sets the stroke color for rectangles
--   x y w h re              : Stores a rectangle path (relative to the current page)
--   f                       : Fills the last rectangle using the current fill color
--   S                       : Strokes the last rectangle (uses border style only)
-- Unsupported commands are skipped with a log message in the Automation Log sheet (created on demand).

property commandSheetName : "01_Hex_Stream"
property renderSheetName : "02_Rendered_View"
property logSheetName : "Automation Log"
property defaultRows : 400
property defaultCols : 40
property cellSize : 25 -- px equivalent; used for column width/row height

on run
    tell application "Numbers"
        if not (exists document 1) then
            error "Open a Numbers document with SPDL sheets before running the script."
        end if
        set docRef to document 1
        set {cmdTable, renderTable} to my locateTables(docRef)
        set logTable to my ensureLogTable(docRef)
        my resetCanvas(renderTable)
        set state to {pageTop:1, pageHeight:0, pageWidth:0, cursorRow:1, cursorCol:1, fillColor:{0, 0, 0}, strokeColor:{0, 0, 0}, lastRect:missing value}
        set totalRows to row count of cmdTable
        repeat with r from 2 to totalRows
            set rawValue to value of cell ("A" & r) of cmdTable
            -- Blank rows are skipped rather than ending the stream, matching
            -- the other renderers.
            if rawValue is not missing value and rawValue is not "" then
                set cmd to my normalizeText(rawValue)
                try
                    set state to my processCommand(cmd, state, renderTable, logTable)
                on error errMsg number errNum
                    my logMessage(logTable, "Row " & r & ": " & errMsg)
                end try
            end if
        end repeat
        my logMessage(logTable, "Render complete at " & (current date))
    end tell
end run

on locateTables(docRef)
    tell application "Numbers"
        set cmdSheet to sheet commandSheetName of docRef
        set renderSheet to sheet renderSheetName of docRef
        set cmdTable to first table of cmdSheet
        set renderTable to first table of renderSheet
        return {cmdTable, renderTable}
    end tell
end locateTables

on ensureLogTable(docRef)
    tell application "Numbers"
        if not (exists sheet logSheetName of docRef) then
            set logSheet to make new sheet at end of docRef with properties {name:logSheetName}
            set logTable to make new table at logSheet with properties {name:"Log", row count:200, column count:2}
            set value of cell "A1" of logTable to "Timestamp"
            set value of cell "B1" of logTable to "Message"
        else
            set logSheet to sheet logSheetName of docRef
            set logTable to first table of logSheet
        end if
        return logTable
    end tell
end ensureLogTable

on resetCanvas(renderTable)
    tell application "Numbers"
        set row count of renderTable to defaultRows
        set column count of renderTable to defaultCols
        repeat with c from 1 to defaultCols
            set width of column c of renderTable to cellSize
        end repeat
        repeat with r from 1 to defaultRows
            set height of row r of renderTable to cellSize
        end repeat
        -- Clear values and formatting
        set value of (cells of renderTable) to ""
        set background color of (cells of renderTable) to {65535, 65535, 65535}
        set horizontal alignment of (cells of renderTable) to left
        set vertical alignment of (cells of renderTable) to top
    end tell
end resetCanvas

on normalizeText(rawValue)
    if class of rawValue is text then
        return rawValue
    else
        return rawValue as text
    end if
end normalizeText

on processCommand(cmd, state, renderTable, logTable)
    set tokens to my splitText(cmd, " ")
    -- Text is checked first so text content can never be misread as an
    -- operator, and MediaBox is matched as a trailing token rather than a
    -- substring for the same reason.
    if cmd starts with "(" and cmd ends with "Tj" then
        return my handleText(cmd, state, renderTable)
    else if cmd ends with "MediaBox" then
        return my handleMediaBox(tokens, state, renderTable)
    else if cmd is "/NewPage" then
        return my handleNewPage(state)
    else if cmd starts with "/MoveTo" then
        return my handleMoveTo(tokens, state)
    else if cmd ends with "Td" then
        return my handleRelativeMove(tokens, state)
    else if cmd ends with "rg" then
        return my handleFillColor(tokens, state)
    else if cmd ends with "SC" then
        return my handleStrokeColor(tokens, state)
    else if cmd ends with "re" then
        return my handleRectangle(tokens, state)
    else if cmd is "f" then
        return my handleFillPath(state, renderTable)
    else if cmd is "S" then
        return my handleStrokePath(state, renderTable)
    else
        my logMessage(logTable, "Skipped unsupported command: " & cmd)
        return state
    end if
end processCommand

on handleMediaBox(tokens, state, renderTable)
    if (count of tokens) < 3 then error "MediaBox requires width and height"
    set pageWidth to (item 1 of tokens) as integer
    set pageHeight to (item 2 of tokens) as integer
    set pageTop to (state's pageTop)
    my paintRegion(renderTable, pageTop, 1, pageWidth, pageHeight, {65535, 65535, 65535})
    return {pageTop:pageTop, pageHeight:pageHeight, pageWidth:pageWidth, cursorRow:pageTop, cursorCol:1, fillColor:(state's fillColor), strokeColor:(state's strokeColor), lastRect:missing value}
end handleMediaBox

on handleNewPage(state)
    if (state's pageHeight) is 0 then error "Cannot start a new page before MediaBox"
    set newTop to (state's pageTop) + (state's pageHeight) + 2
    return {pageTop:newTop, pageHeight:(state's pageHeight), pageWidth:(state's pageWidth), cursorRow:newTop, cursorCol:1, fillColor:(state's fillColor), strokeColor:(state's strokeColor), lastRect:missing value}
end handleNewPage

on handleMoveTo(tokens, state)
    if (count of tokens) < 3 then error "/MoveTo requires X and Y"
    set xVal to (item 2 of tokens) as integer
    set yVal to (item 3 of tokens) as integer
    -- Clamp to the current page (or canvas) bounds, matching the other renderers.
    set maxX to defaultCols
    if (state's pageWidth) > 0 then set maxX to (state's pageWidth)
    if xVal < 1 then set xVal to 1
    if xVal > maxX then set xVal to maxX
    set newRow to (state's pageTop) + yVal - 1
    if newRow < (state's pageTop) then set newRow to (state's pageTop)
    if (state's pageHeight) > 0 then
        set pageBottom to (state's pageTop) + (state's pageHeight) - 1
        if newRow > pageBottom then set newRow to pageBottom
    else if newRow > defaultRows then
        set newRow to defaultRows
    end if
    set newCol to xVal
    return {pageTop:(state's pageTop), pageHeight:(state's pageHeight), pageWidth:(state's pageWidth), cursorRow:newRow, cursorCol:newCol, fillColor:(state's fillColor), strokeColor:(state's strokeColor), lastRect:(state's lastRect)}
end handleMoveTo

on handleRelativeMove(tokens, state)
    if (count of tokens) < 3 then error "Td requires dx and dy"
    -- Deltas are truncated toward zero, matching the documented Td semantics
    -- shared by all renderers.
    set dx to my truncateTowardZero(((item 1 of tokens) as real) / 10)
    set dy to my truncateTowardZero(((item 2 of tokens) as real) / 10)
    set newRow to (state's cursorRow) + dy
    set newCol to (state's cursorCol) + dx
    return {pageTop:(state's pageTop), pageHeight:(state's pageHeight), pageWidth:(state's pageWidth), cursorRow:newRow, cursorCol:newCol, fillColor:(state's fillColor), strokeColor:(state's strokeColor), lastRect:(state's lastRect)}
end handleRelativeMove

on truncateTowardZero(v)
    if v < 0 then
        return -((-v) div 1)
    else
        return v div 1
    end if
end truncateTowardZero

on handleFillColor(tokens, state)
    if (count of tokens) < 3 then error "rg requires r g b"
    set colorVal to my rgbToColor(tokens)
    set state's fillColor to colorVal
    return state
end handleFillColor

on handleStrokeColor(tokens, state)
    if (count of tokens) < 3 then error "SC requires r g b"
    set colorVal to my rgbToColor(tokens)
    set state's strokeColor to colorVal
    return state
end handleStrokeColor

on handleRectangle(tokens, state)
    if (count of tokens) < 4 then error "re requires x y w h"
    set lastRect to {x:(item 1 of tokens) as integer, y:(item 2 of tokens) as integer, w:(item 3 of tokens) as integer, h:(item 4 of tokens) as integer}
    set state's lastRect to lastRect
    return state
end handleRectangle

on handleFillPath(state, renderTable)
    if (state's lastRect) is missing value then error "No rectangle path to fill"
    set rectData to state's lastRect
    set targetRow to (state's pageTop) + (rectData's y) - 1
    set targetCol to rectData's x
    my paintRegion(renderTable, targetRow, targetCol, rectData's w, rectData's h, state's fillColor)
    return state
end handleFillPath

on handleStrokePath(state, renderTable)
    if (state's lastRect) is missing value then error "No rectangle path to stroke"
    set rectData to state's lastRect
    set targetRow to (state's pageTop) + (rectData's y) - 1
    set targetCol to rectData's x
    my strokeRegion(renderTable, targetRow, targetCol, rectData's w, rectData's h, state's strokeColor)
    return state
end handleStrokePath

on handleText(cmd, state, renderTable)
    set txt to my extractText(cmd)
    set theCell to cell (state's cursorCol) of row (state's cursorRow) of renderTable
    tell application "Numbers"
        set value of theCell to txt
        set text color of theCell to (state's fillColor)
    end tell
    return state
end handleText

on paintRegion(renderTable, startRow, startCol, widthCount, heightCount, appleColor)
    tell application "Numbers"
        set endRow to startRow + heightCount - 1
        set endCol to startCol + widthCount - 1
        repeat with r from startRow to endRow
            repeat with c from startCol to endCol
                set background color of cell c of row r of renderTable to appleColor
            end repeat
        end repeat
    end tell
end paintRegion

on strokeRegion(renderTable, startRow, startCol, widthCount, heightCount, appleColor)
    tell application "Numbers"
        set endRow to startRow + heightCount - 1
        set endCol to startCol + widthCount - 1
        repeat with c from startCol to endCol
            set background color of cell c of row startRow of renderTable to appleColor
            set background color of cell c of row endRow of renderTable to appleColor
        end repeat
        repeat with r from startRow to endRow
            set background color of cell startCol of row r of renderTable to appleColor
            set background color of cell endCol of row r of renderTable to appleColor
        end repeat
    end tell
end strokeRegion

on rgbToColor(tokens)
    set r to (item 1 of tokens) as real
    set g to (item 2 of tokens) as real
    set b to (item 3 of tokens) as real
    return {my normalizeComponent(r), my normalizeComponent(g), my normalizeComponent(b)}
end rgbToColor

on normalizeComponent(v)
    if v > 1 then
        -- Already in 0–255 range
        return (v / 255) * 65535
    else
        return v * 65535
    end if
end normalizeComponent

on extractText(cmd)
    set tid to AppleScript's text item delimiters
    set AppleScript's text item delimiters to {"("}
    set parts to text items of cmd
    set AppleScript's text item delimiters to {")"}
    set afterOpen to item 2 of parts
    set textParts to text items of afterOpen
    set AppleScript's text item delimiters to tid
    return item 1 of textParts
end extractText

on splitText(t, delimiter)
    set tid to AppleScript's text item delimiters
    set AppleScript's text item delimiters to {delimiter}
    set itemsList to text items of t
    set AppleScript's text item delimiters to tid
    return itemsList
end splitText

on logMessage(logTable, msg)
    tell application "Numbers"
        set lastRow to row count of logTable
        add row after last row of logTable
        set targetRow to lastRow + 1
        set value of cell ("A" & targetRow) of logTable to (current date)
        set value of cell ("B" & targetRow) of logTable to msg
    end tell
end logMessage
