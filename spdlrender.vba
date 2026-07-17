' VBA renderer for Spreadsheet Page Description Language (SPDL).
' Paste this module into the VBA editor (ALT+F11) and run RenderSPDL.
Option Explicit

' Anchored command patterns. Every SPDL command must match one of these
' exactly; substring checks are never used for dispatch so that text content
' such as "(Morgan) Tj" can never be mistaken for an operator like "rg".
Private Const TEXT_COMMAND_PATTERN As String = "^\((.*)\)\s+Tj\s*$"
Private Const LINK_COMMAND_PATTERN As String = "^\(((?:[^)\\]|\\.)*)\)\s+\(((?:[^)\\]|\\.)*)\)\s+/Link$"
Private Const INSERT_IMAGE_PATTERN As String = "^(\d+)\s+(\d+)\s+\(((?:[^)\\]|\\.)*)\)\s+/InsertImage$"
Private Const NOTE_COMMAND_PATTERN As String = "^\(((?:[^)\\]|\\.)*)\)\s+/Note$"
Private Const DROPDOWN_COMMAND_PATTERN As String = "^\(((?:[^)\\]|\\.)*)\)\s+/Dropdown$"
Private Const MEDIABOX_PATTERN As String = "^(\d+)\s+(\d+)\s+MediaBox$"
Private Const LINE_WIDTH_PATTERN As String = "^(\d+)\s+w$"
Private Const RECTANGLE_COMMAND_PATTERN As String = "^\s*-?\d+(\.\d+)?\s+-?\d+(\.\d+)?\s+-?\d+(\.\d+)?\s+-?\d+(\.\d+)?\s+re\s*$"
Private Const PIXEL_ART_PATTERN As String = "^(\d+)\s+(\d+)\s+ID\s+(\S+)$"
Private Const ALIGN_COMMAND_PATTERN As String = "^/Align\s+(\S+)$"
Private Const FILL_COLOR_PATTERN As String = "^(\d*\.?\d+)\s+(\d*\.?\d+)\s+(\d*\.?\d+)\s+rg$"
Private Const STROKE_COLOR_PATTERN As String = "^(\d*\.?\d+)\s+(\d*\.?\d+)\s+(\d*\.?\d+)\s+SC$"
Private Const FONT_COMMAND_PATTERN As String = "^/F(\d+)(\s+\d+(\.\d+)?)?\s+Tf$"
Private Const UNDERLINE_PATTERN As String = "^([01])\s+Tr$"
Private Const FONT_SIZE_PATTERN As String = "^([+-]?\d*\.?\d+)\s+Ts$"
Private Const ALIGN_CODE_PATTERN As String = "^(\d+)\s+TA$"
Private Const TD_PATTERN As String = "^([+-]?\d*\.?\d+)\s+([+-]?\d*\.?\d+)\s+Td$"
Private Const MOVE_TO_PATTERN As String = "^/MoveTo\s+(-?\d+)\s+(-?\d+)$"

Public Sub RenderSPDL()
    Dim sourceSheet As Worksheet
    Dim renderSheet As Worksheet
    Set sourceSheet = ThisWorkbook.Worksheets("01_Hex_Stream")
    Set renderSheet = ThisWorkbook.Worksheets("02_Rendered_View")

    Dim lastRow As Long
    lastRow = sourceSheet.Cells(sourceSheet.Rows.Count, 1).End(xlUp).Row
    Dim commandCount As Long
    commandCount = Application.Max(0, lastRow - 1)

    Dim maxRows As Long: maxRows = 1000
    Dim maxCols As Long: maxCols = 26
    Dim cellSize As Double: cellSize = 25
    Dim defaultFontSize As Double: defaultFontSize = 15

    With renderSheet.Range(renderSheet.Cells(1, 1), renderSheet.Cells(maxRows, maxCols))
        .Clear
        .Interior.Color = RGB(80, 80, 80)
        .Font.Color = vbBlack
        .Font.Size = defaultFontSize
        .Font.Bold = False
        .Font.Italic = False
        .Font.Underline = xlUnderlineStyleNone
    End With

    Dim c As Long
    For c = 1 To maxCols
        renderSheet.Columns(c).ColumnWidth = cellSize / 5
    Next c
    Dim r As Long
    For r = 1 To maxRows
        renderSheet.Rows(r).RowHeight = cellSize
    Next r

    Dim shapeIndex As Long
    For shapeIndex = renderSheet.Shapes.Count To 1 Step -1
        If renderSheet.Shapes(shapeIndex).Type = msoPicture Then
            renderSheet.Shapes(shapeIndex).Delete
        End If
    Next shapeIndex

    Dim currentX As Long: currentX = 1
    Dim currentY As Long: currentY = 1
    Dim currentFillColor As Long: currentFillColor = RGB(0, 0, 0)
    Dim currentStrokeColor As Long: currentStrokeColor = RGB(0, 0, 0)
    Dim currentLineStyle As XlLineStyle: currentLineStyle = MapLineWidth(3)
    Dim currentLineWeight As XlBorderWeight: currentLineWeight = MapLineWeight(3)
    Dim currentRotation As Long: currentRotation = 0
    Dim currentPath(1 To 4) As Long ' x, y, w, h
    Dim pageTopRow As Long: pageTopRow = 1
    Dim pageWidth As Long: pageWidth = 0
    Dim pageHeight As Long: pageHeight = 0
    Dim mediaBoxApplied As Boolean: mediaBoxApplied = False
    Dim currentFontSize As Double: currentFontSize = defaultFontSize
    Dim isBold As Boolean: isBold = False
    Dim isItalic As Boolean: isItalic = False
    Dim underline As Boolean: underline = False
    Dim hAlign As XlHAlign: hAlign = xlHAlignLeft
    Dim vAlign As XlVAlign: vAlign = xlVAlignTop

    Dim m As Object
    Dim i As Long
    For i = 1 To commandCount
        Dim command As String
        command = Trim$(CStr(sourceSheet.Cells(i + 1, 1).Value))
        If Len(command) = 0 Then GoTo NextCommand
        If Left$(command, 1) = "%" Then GoTo NextCommand ' comment line

        ' One bad command (e.g. a range outside the sheet) must not abort the
        ' whole render: log it and continue with the next command.
        On Error GoTo CommandError

        ' --- TEXT --- (parsed first so text content can never be misread as an operator)
        Set m = ExecPattern(command, TEXT_COMMAND_PATTERN)
        If Not m Is Nothing Then
            If Not IsInsideCanvas(currentX, currentY, maxRows, maxCols) Then GoTo NextCommand
            With renderSheet.Cells(currentY, currentX)
                .Value = UnescapeTextOperand(m.SubMatches(0))
                ApplyText .Font, currentFillColor, currentFontSize, isBold, isItalic, underline
                .Orientation = currentRotation
                .HorizontalAlignment = hAlign
                .VerticalAlignment = vAlign
            End With
            GoTo NextCommand
        End If

        ' --- LINKS ---
        Set m = ExecPattern(command, LINK_COMMAND_PATTERN)
        If Not m Is Nothing Then
            If Not IsInsideCanvas(currentX, currentY, maxRows, maxCols) Then GoTo NextCommand
            With renderSheet.Cells(currentY, currentX)
                .Hyperlinks.Delete
                renderSheet.Hyperlinks.Add Anchor:=renderSheet.Cells(currentY, currentX), Address:=UnescapeTextOperand(m.SubMatches(0)), TextToDisplay:=UnescapeTextOperand(m.SubMatches(1))
                ApplyText .Font, currentFillColor, currentFontSize, isBold, isItalic, underline
                .HorizontalAlignment = hAlign
                .VerticalAlignment = vAlign
            End With
            GoTo NextCommand
        End If

        ' --- IMAGE (InsertImage) ---
        Set m = ExecPattern(command, INSERT_IMAGE_PATTERN)
        If Not m Is Nothing Then
            Dim w As Double, h As Double
            w = Val(m.SubMatches(0)): h = Val(m.SubMatches(1))
            If Not IsInsideCanvas(currentX, currentY, maxRows, maxCols) Then GoTo NextCommand
            On Error Resume Next
            renderSheet.Shapes.AddPicture UnescapeTextOperand(m.SubMatches(2)), msoFalse, msoTrue, _
                renderSheet.Cells(currentY, currentX).Left, _
                renderSheet.Cells(currentY, currentX).Top, _
                w, h
            On Error GoTo CommandError
            GoTo NextCommand
        End If

        ' --- ANNOTATIONS (/Note) ---
        Set m = ExecPattern(command, NOTE_COMMAND_PATTERN)
        If Not m Is Nothing Then
            If IsInsideCanvas(currentX, currentY, maxRows, maxCols) Then
                renderSheet.Cells(currentY, currentX).NoteText UnescapeTextOperand(m.SubMatches(0))
            End If
            GoTo NextCommand
        End If

        ' --- ACROFORMS ---
        If IsExactOperator(command, "/CheckBox") Then
            If Not IsInsideCanvas(currentX, currentY, maxRows, maxCols) Then GoTo NextCommand
            With renderSheet.Cells(currentY, currentX)
                .Value = ChrW(9744) ' ballot box
                .HorizontalAlignment = xlCenter
                .VerticalAlignment = xlCenter
            End With
            GoTo NextCommand
        End If

        Set m = ExecPattern(command, DROPDOWN_COMMAND_PATTERN)
        If Not m Is Nothing Then
            If Not IsInsideCanvas(currentX, currentY, maxRows, maxCols) Then GoTo NextCommand
            Dim options As String
            options = UnescapeTextOperand(m.SubMatches(0))
            Dim dropdownWidth As Long
            dropdownWidth = Application.Min(6, maxCols - currentX + 1)
            With renderSheet.Cells(currentY, currentX).Resize(1, dropdownWidth)
                .Merge
                .Validation.Delete
                .Validation.Add Type:=xlValidateList, AlertStyle:=xlValidAlertStop, Operator:=xlBetween, Formula1:=options
                .Value = Split(options, ",")(0)
                .Interior.Color = RGB(255, 242, 204)
                .HorizontalAlignment = xlCenter
                .VerticalAlignment = xlCenter
                SetAllBorders .Borders, currentStrokeColor, currentLineStyle, currentLineWeight
            End With
            GoTo NextCommand
        End If

        ' --- PAGE SETUP ---
        Set m = ExecPattern(command, MEDIABOX_PATTERN)
        If Not m Is Nothing Then
            pageWidth = CLng(m.SubMatches(0))
            pageHeight = CLng(m.SubMatches(1))
            If pageWidth > 0 And pageHeight > 0 Then
                mediaBoxApplied = True
                DrawPage renderSheet, pageTopRow, pageWidth, pageHeight, currentLineStyle, currentLineWeight, maxRows, maxCols
            Else
                mediaBoxApplied = False
            End If
            GoTo NextCommand
        End If

        If IsExactOperator(command, "/NewPage") Then
            If mediaBoxApplied And pageWidth > 0 And pageHeight > 0 Then
                pageTopRow = pageTopRow + pageHeight + 2
                currentX = 1
                currentY = pageTopRow
                DrawPage renderSheet, pageTopRow, pageWidth, pageHeight, currentLineStyle, currentLineWeight, maxRows, maxCols
            End If
            GoTo NextCommand
        End If

        ' --- LINE WIDTH ---
        Set m = ExecPattern(command, LINE_WIDTH_PATTERN)
        If Not m Is Nothing Then
            currentLineStyle = MapLineWidth(CInt(m.SubMatches(0)))
            currentLineWeight = MapLineWeight(CInt(m.SubMatches(0)))
            GoTo NextCommand
        End If

        ' --- SHAPES ---
        Dim rectX As Long, rectY As Long, rectW As Long, rectH As Long
        If ParseRectangleCommand(command, rectX, rectY, rectW, rectH) Then
            currentPath(1) = rectX
            currentPath(2) = pageTopRow + rectY
            currentPath(3) = rectW
            currentPath(4) = rectH
            GoTo NextCommand
        End If

        If IsExactOperator(command, "f") Or IsExactOperator(command, "S") Then
            If currentPath(3) > 0 And currentPath(4) > 0 Then
                Dim clampX As Long, clampY As Long, clampW As Long, clampH As Long
                clampX = currentPath(1): clampY = currentPath(2)
                clampW = currentPath(3): clampH = currentPath(4)
                If ClampRect(clampX, clampY, clampW, clampH, maxRows, maxCols) Then
                    Dim targetRange As Range
                    Set targetRange = renderSheet.Range(renderSheet.Cells(clampY, clampX), _
                                                        renderSheet.Cells(clampY + clampH - 1, clampX + clampW - 1))
                    If command = "f" Then targetRange.Interior.Color = currentFillColor
                    If command = "S" Then SetAllBorders targetRange.Borders, currentStrokeColor, currentLineStyle, currentLineWeight
                End If
            End If
            GoTo NextCommand
        End If

        ' --- PIXEL IMAGES ---
        Set m = ExecPattern(command, PIXEL_ART_PATTERN)
        If Not m Is Nothing Then
            Dim widthPx As Long: widthPx = CLng(m.SubMatches(0))
            Dim heightPx As Long: heightPx = CLng(m.SubMatches(1))
            Dim pixelData As String: pixelData = m.SubMatches(2)
            If Len(pixelData) >= widthPx * heightPx Then
                Dim rr As Long, cc As Long
                For rr = 0 To heightPx - 1
                    For cc = 0 To widthPx - 1
                        Dim code As String
                        code = Mid$(pixelData, (rr * widthPx) + cc + 1, 1)
                        Dim pixelColor As Variant
                        pixelColor = Empty
                        If code = "1" Then pixelColor = RGB(0, 0, 0)
                        If code = "2" Then pixelColor = RGB(241, 196, 15)
                        If code = "3" Then pixelColor = RGB(231, 76, 60)
                        If Not IsEmpty(pixelColor) And IsInsideCanvas(currentX + cc, currentY + rr, maxRows, maxCols) Then
                            renderSheet.Cells(currentY + rr, currentX + cc).Interior.Color = pixelColor
                        End If
                    Next cc
                Next rr
            End If
            GoTo NextCommand
        End If

        ' --- ROTATION / ALIGNMENT ---
        If HasRotateToken(command) Then
            Dim parsedRotation As Long
            If TryParseRotationOperand(command, parsedRotation) Then
                currentRotation = parsedRotation
                If IsInsideCanvas(currentX, currentY, maxRows, maxCols) Then
                    renderSheet.Cells(currentY, currentX).Orientation = currentRotation
                End If
            End If
            GoTo NextCommand
        End If

        Set m = ExecPattern(command, ALIGN_COMMAND_PATTERN)
        If Not m Is Nothing Then
            Select Case m.SubMatches(0)
                Case "HCenter": hAlign = xlHAlignCenter
                Case "HRight": hAlign = xlHAlignRight
                Case "HLeft": hAlign = xlHAlignLeft
                Case "VMiddle": vAlign = xlVAlignCenter
                Case "VBottom": vAlign = xlVAlignBottom
                Case "VTop": vAlign = xlVAlignTop
            End Select
            GoTo NextCommand
        End If

        ' --- COLORS ---
        Set m = ExecPattern(command, FILL_COLOR_PATTERN)
        If Not m Is Nothing Then
            currentFillColor = RGB(CInt(Val(m.SubMatches(0)) * 255), CInt(Val(m.SubMatches(1)) * 255), CInt(Val(m.SubMatches(2)) * 255))
            GoTo NextCommand
        End If

        Set m = ExecPattern(command, STROKE_COLOR_PATTERN)
        If Not m Is Nothing Then
            currentStrokeColor = RGB(CInt(Val(m.SubMatches(0)) * 255), CInt(Val(m.SubMatches(1)) * 255), CInt(Val(m.SubMatches(2)) * 255))
            GoTo NextCommand
        End If

        ' --- TYPOGRAPHY ---
        Set m = ExecPattern(command, FONT_COMMAND_PATTERN)
        If Not m Is Nothing Then
            isBold = m.SubMatches(0) = "2"
            isItalic = m.SubMatches(0) = "3"
            GoTo NextCommand
        End If

        Set m = ExecPattern(command, UNDERLINE_PATTERN)
        If Not m Is Nothing Then
            underline = m.SubMatches(0) = "1"
            GoTo NextCommand
        End If

        Set m = ExecPattern(command, FONT_SIZE_PATTERN)
        If Not m Is Nothing Then
            currentFontSize = Val(m.SubMatches(0))
            If currentFontSize <= 0 Then currentFontSize = defaultFontSize
            GoTo NextCommand
        End If

        Set m = ExecPattern(command, ALIGN_CODE_PATTERN)
        If Not m Is Nothing Then
            Dim alignmentCode As Long
            alignmentCode = CLng(m.SubMatches(0))
            Select Case alignmentCode
                Case 0: hAlign = xlHAlignLeft
                Case 1: hAlign = xlHAlignCenter
                Case 2: hAlign = xlHAlignRight
                Case 3: vAlign = xlVAlignTop
                Case 4: vAlign = xlVAlignCenter
                Case 5: vAlign = xlVAlignBottom
                Case Is >= 6
                    hAlign = xlHAlignLeft
                    vAlign = xlVAlignTop
            End Select
            GoTo NextCommand
        End If

        ' --- CURSOR ---
        Set m = ExecPattern(command, TD_PATTERN)
        If Not m Is Nothing Then
            currentX = currentX + CLng(Fix(Val(m.SubMatches(0)) / 10))
            currentY = currentY + CLng(Fix(Val(m.SubMatches(1)) / 10))
            GoTo NextCommand
        End If

        Set m = ExecPattern(command, MOVE_TO_PATTERN)
        If Not m Is Nothing Then
            Dim targetX As Long: targetX = CLng(m.SubMatches(0))
            Dim targetY As Long: targetY = CLng(m.SubMatches(1))
            Dim maxX As Long: maxX = IIf(pageWidth > 0, pageWidth, maxCols)
            Dim pageBottom As Long: pageBottom = IIf(pageHeight > 0, pageTopRow + pageHeight - 1, maxRows)
            currentX = WorksheetFunction.Max(1, WorksheetFunction.Min(maxX, targetX))
            currentY = WorksheetFunction.Max(pageTopRow, WorksheetFunction.Min(pageBottom, pageTopRow + targetY - 1))
            GoTo NextCommand
        End If

        Debug.Print "Skipped unrecognized command: " & command

NextCommand:
        On Error GoTo 0
    Next i
    Exit Sub

CommandError:
    Debug.Print "Error processing command """ & command & """ (stream row " & (i + 1) & "): " & Err.Description
    Resume NextCommand
End Sub

Private Function ExecPattern(ByVal command As String, ByVal pattern As String) As Object
    Static re As Object
    If re Is Nothing Then Set re = CreateObject("VBScript.RegExp")
    re.Global = False
    re.Pattern = pattern
    If re.test(command) Then
        Set ExecPattern = re.Execute(command)(0)
    Else
        Set ExecPattern = Nothing
    End If
End Function

' Resolves \( \) \\ escape sequences in a matched text operand.
Private Function UnescapeTextOperand(ByVal value As String) As String
    Static re As Object
    If re Is Nothing Then
        Set re = CreateObject("VBScript.RegExp")
        re.Global = True
        re.Pattern = "\\([()\\])"
    End If
    UnescapeTextOperand = re.Replace(value, "$1")
End Function

Private Function HasRotateToken(ByVal command As String) As Boolean
    Dim parts() As String
    parts = Split(Trim$(command))
    Dim i As Long
    For i = LBound(parts) To UBound(parts)
        If parts(i) = "/Rotate" Then
            HasRotateToken = True
            Exit Function
        End If
    Next i
    HasRotateToken = False
End Function

Private Sub DrawPage(ByVal sheet As Worksheet, ByVal topRow As Long, ByVal width As Long, ByVal height As Long, ByVal borderStyle As XlLineStyle, ByVal borderWeight As XlBorderWeight, ByVal maxRows As Long, ByVal maxCols As Long)
    If width <= 0 Or height <= 0 Then Exit Sub
    Dim x As Long, y As Long, w As Long, h As Long
    x = 1: y = topRow: w = width: h = height
    If Not ClampRect(x, y, w, h, maxRows, maxCols) Then Exit Sub
    With sheet.Range(sheet.Cells(y, x), sheet.Cells(y + h - 1, x + w - 1))
        .Interior.Color = vbWhite
        SetAllBorders .Borders, vbBlack, borderStyle, borderWeight
    End With
End Sub

Private Function IsInsideCanvas(ByVal x As Long, ByVal y As Long, ByVal maxRows As Long, ByVal maxCols As Long) As Boolean
    IsInsideCanvas = (x >= 1 And x <= maxCols And y >= 1 And y <= maxRows)
End Function

' Clamps the rectangle (x, y, w, h) to the canvas in place. Returns False when
' the rectangle lies entirely outside the canvas.
Private Function ClampRect(ByRef x As Long, ByRef y As Long, ByRef w As Long, ByRef h As Long, ByVal maxRows As Long, ByVal maxCols As Long) As Boolean
    Dim x2 As Long, y2 As Long
    x2 = x + w - 1
    y2 = y + h - 1
    If x < 1 Then x = 1
    If y < 1 Then y = 1
    If x2 > maxCols Then x2 = maxCols
    If y2 > maxRows Then y2 = maxRows
    If x2 < x Or y2 < y Then Exit Function
    w = x2 - x + 1
    h = y2 - y + 1
    ClampRect = True
End Function

Private Sub SetAllBorders(ByVal borders As Borders, ByVal color As Long, ByVal style As XlLineStyle, ByVal borderWeight As XlBorderWeight)
    Dim b As Variant
    For Each b In Array(xlEdgeTop, xlEdgeBottom, xlEdgeLeft, xlEdgeRight)
        With borders(b)
            .LineStyle = style
            .Weight = borderWeight
            .Color = color
        End With
    Next b
End Sub

Private Sub ApplyText(ByVal font As Font, ByVal color As Long, ByVal size As Double, ByVal bold As Boolean, ByVal italic As Boolean, ByVal underline As Boolean)
    font.Color = color
    font.Size = size
    font.Bold = bold
    font.Italic = italic
    font.Underline = IIf(underline, xlUnderlineStyleSingle, xlUnderlineStyleNone)
End Sub

Private Function MapLineWidth(ByVal widthValue As Long) As XlLineStyle
    ' Canonical SPDL stroke width mapping (shared across renderers):
    ' 1 = thin, 2 = medium, 3 = thick, 4 = double.
    Select Case widthValue
        Case 1: MapLineWidth = xlContinuous
        Case 2: MapLineWidth = xlContinuous
        Case 3: MapLineWidth = xlContinuous
        Case 4: MapLineWidth = xlDouble
        Case Else: MapLineWidth = xlContinuous
    End Select
End Function

Private Function MapLineWeight(ByVal widthValue As Long) As XlBorderWeight
    Select Case widthValue
        Case 1: MapLineWeight = xlThin
        Case 2: MapLineWeight = xlMedium
        Case 3: MapLineWeight = xlThick
        Case 4: MapLineWeight = xlThick
        Case Else: MapLineWeight = xlThin
    End Select
End Function

Private Function TryParseRotationOperand(ByVal command As String, ByRef rotationValue As Long) As Boolean
    Dim parts() As String
    parts = Split(Trim$(command))

    Dim rotateIndex As Long
    rotateIndex = -1

    Dim i As Long
    For i = LBound(parts) To UBound(parts)
        If parts(i) = "/Rotate" Then
            rotateIndex = i
            Exit For
        End If
    Next i

    If rotateIndex = -1 Then Exit Function

    Dim candidates(1 To 2) As String
    Dim candidateCount As Long
    candidateCount = 0

    If rotateIndex + 1 <= UBound(parts) Then
        candidateCount = candidateCount + 1
        candidates(candidateCount) = parts(rotateIndex + 1)
    End If
    If rotateIndex - 1 >= LBound(parts) Then
        candidateCount = candidateCount + 1
        candidates(candidateCount) = parts(rotateIndex - 1)
    End If

    For i = 1 To candidateCount
        If IsNumeric(candidates(i)) Then
            rotationValue = CLng(Fix(CDbl(candidates(i))))
            TryParseRotationOperand = True
            Exit Function
        End If
    Next i

    TryParseRotationOperand = False
End Function

Private Function IsExactOperator(ByVal command As String, ByVal expectedOperator As String) As Boolean
    IsExactOperator = (StrComp(Trim$(command), expectedOperator, vbBinaryCompare) = 0)
End Function

Private Function ParseRectangleCommand(ByVal command As String, ByRef x As Long, ByRef y As Long, ByRef w As Long, ByRef h As Long) As Boolean
    Dim m As Object
    Set m = ExecPattern(command, RECTANGLE_COMMAND_PATTERN)
    If m Is Nothing Then Exit Function

    Dim parts() As String
    parts = Split(Trim$(command))
    x = CLng(Fix(Val(parts(0))))
    y = CLng(Fix(Val(parts(1))))
    w = CLng(Fix(Val(parts(2))))
    h = CLng(Fix(Val(parts(3))))
    ParseRectangleCommand = True
End Function
