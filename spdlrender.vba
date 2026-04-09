' VBA renderer for Spreadsheet Page Description Language (SPDL).
' Paste this module into the VBA editor (ALT+F11) and run RenderSPDL.
Option Explicit

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

    Dim i As Long
    For i = 1 To commandCount
        Dim command As String
        command = Trim$(CStr(sourceSheet.Cells(i + 1, 1).Value))
        If Len(command) = 0 Then GoTo NextCommand

        ' --- IMAGE (InsertImage) ---
        If InStr(command, "/InsertImage") > 0 Then
            Dim urlMatch As Object
            Set urlMatch = CreateObject("VBScript.RegExp")
            urlMatch.Pattern = "\(([^)]+)\)"
            If urlMatch.test(command) Then
                Dim url As String
                url = urlMatch.Execute(command)(0).SubMatches(0)
                Dim parts() As String
                parts = Split(Replace(command, "(" & url & ")", vbNullString), " ")
                Dim w As Double, h As Double
                w = CDbl(parts(0)): h = CDbl(parts(1))
                On Error Resume Next
                renderSheet.Shapes.AddPicture url, msoFalse, msoTrue, _
                    renderSheet.Cells(currentY, currentX).Left, _
                    renderSheet.Cells(currentY, currentX).Top, _
                    w, h
                On Error GoTo 0
            End If
            GoTo NextCommand
        End If

        ' --- ANNOTATIONS (/Note) ---
        If InStr(command, "/Note") > 0 Then
            Dim noteMatch As Object
            Set noteMatch = CreateObject("VBScript.RegExp")
            noteMatch.Pattern = "\(([^)]+)\)"
            If noteMatch.test(command) Then
                renderSheet.Cells(currentY, currentX).NoteText noteMatch.Execute(command)(0).SubMatches(0)
            End If
            GoTo NextCommand
        End If

        ' --- ACROFORMS ---
        If InStr(command, "/CheckBox") > 0 Then
            With renderSheet.Cells(currentY, currentX)
                .Value = "☐"
                .HorizontalAlignment = xlCenter
                .VerticalAlignment = xlCenter
            End With
            GoTo NextCommand
        End If

        If InStr(command, "/Dropdown") > 0 Then
            Dim dropMatch As Object
            Set dropMatch = CreateObject("VBScript.RegExp")
            dropMatch.Pattern = "\(([^)]+)\)"
            If dropMatch.test(command) Then
                Dim options As String
                options = dropMatch.Execute(command)(0).SubMatches(0)
                With renderSheet.Cells(currentY, currentX).Resize(1, 6)
                    .Merge
                    .Validation.Delete
                    .Validation.Add Type:=xlValidateList, AlertStyle:=xlValidAlertStop, Operator:=xlBetween, Formula1:=options
                    .Value = Split(options, ",")(0)
                    .Interior.Color = RGB(255, 242, 204)
                    .HorizontalAlignment = xlCenter
                    .VerticalAlignment = xlCenter
                    SetAllBorders .Borders, currentStrokeColor, currentLineStyle
                End With
            End If
            GoTo NextCommand
        End If

        ' --- PAGE SETUP ---
        If InStr(command, "MediaBox") > 0 Then
            Dim mbParts() As String
            mbParts = Split(command, " ")
            pageWidth = CLng(mbParts(0))
            pageHeight = CLng(mbParts(1))
            If pageWidth > 0 And pageHeight > 0 Then
                mediaBoxApplied = True
                DrawPage renderSheet, pageTopRow, pageWidth, pageHeight, currentLineStyle
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
                DrawPage renderSheet, pageTopRow, pageWidth, pageHeight, currentLineStyle
            End If
            GoTo NextCommand
        End If

        ' --- LINE WIDTH ---
        If command Like "* w*" Then
            currentLineStyle = MapLineWidth(CInt(Split(command)(0)))
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
                Dim targetRange As Range
                Set targetRange = renderSheet.Range(renderSheet.Cells(currentPath(2), currentPath(1)), _
                                                    renderSheet.Cells(currentPath(2) + currentPath(4) - 1, currentPath(1) + currentPath(3) - 1))
                If IsExactOperator(command, "f") Then targetRange.Interior.Color = currentFillColor
                If IsExactOperator(command, "S") Then SetAllBorders targetRange.Borders, currentStrokeColor, currentLineStyle
            End If
            GoTo NextCommand
        End If

        ' --- PIXEL IMAGES ---
        If InStr(command, " ID") > 0 Then
            Dim idParts() As String
            idParts = Split(command, " ")
            Dim widthPx As Long: widthPx = CLng(idParts(0))
            Dim heightPx As Long: heightPx = CLng(idParts(1))
            Dim pixelData As String: pixelData = idParts(3)
            If Len(pixelData) >= widthPx * heightPx Then
                Dim rr As Long, cc As Long
                For rr = 0 To heightPx - 1
                    For cc = 0 To widthPx - 1
                        Dim code As String
                        code = Mid$(pixelData, (rr * widthPx) + cc + 1, 1)
                        Dim pixelColor As Variant
                        If code = "1" Then pixelColor = RGB(0, 0, 0)
                        If code = "2" Then pixelColor = RGB(241, 196, 15)
                        If code = "3" Then pixelColor = RGB(231, 76, 60)
                        If Not IsEmpty(pixelColor) Then
                            renderSheet.Cells(currentY + rr, currentX + cc).Interior.Color = pixelColor
                        End If
                    Next cc
                Next rr
            End If
            GoTo NextCommand
        End If

        ' --- LINKS & TEXT ---
        If InStr(command, "/Link") > 0 Then
            Dim linkMatches As Object
            Set linkMatches = CreateObject("VBScript.RegExp")
            linkMatches.Pattern = "\(([^)]+)\)"
            If linkMatches.test(command) Then
                Dim urlLabel() As String
                ReDim urlLabel(linkMatches.Execute(command).Count - 1)
                Dim idx As Long
                For idx = 0 To UBound(urlLabel)
                    urlLabel(idx) = linkMatches.Execute(command)(idx).SubMatches(0)
                Next idx
                If UBound(urlLabel) >= 1 Then
                    With renderSheet.Cells(currentY, currentX)
                        .Hyperlinks.Delete
                        renderSheet.Hyperlinks.Add Anchor:=renderSheet.Cells(currentY, currentX), Address:=urlLabel(0), TextToDisplay:=urlLabel(1)
                        ApplyText .Font, currentFillColor, currentFontSize, isBold, isItalic, underline
                        .HorizontalAlignment = hAlign
                        .VerticalAlignment = vAlign
                    End With
                End If
            End If
            GoTo NextCommand
        End If

        If InStr(command, "/Rotate") > 0 Then
            currentRotation = CInt(Split(command)(0))
            renderSheet.Cells(currentY, currentX).Orientation = currentRotation
            GoTo NextCommand
        End If

        If InStr(command, "/Align") > 0 Then
            Dim alignParts() As String
            alignParts = Split(command, " ")
            If UBound(alignParts) >= 1 Then
                Select Case alignParts(1)
                    Case "HCenter": hAlign = xlHAlignCenter
                    Case "HRight": hAlign = xlHAlignRight
                    Case "HLeft": hAlign = xlHAlignLeft
                    Case "VMiddle": vAlign = xlVAlignCenter
                    Case "VBottom": vAlign = xlVAlignBottom
                    Case "VTop": vAlign = xlVAlignTop
                End Select
            End If
            GoTo NextCommand
        End If

        If InStr(command, " rg") > 0 Then
            Dim rgParts() As String
            rgParts = Split(command, " ")
            currentFillColor = RGB(CInt(rgParts(0) * 255), CInt(rgParts(1) * 255), CInt(rgParts(2) * 255))
            GoTo NextCommand
        End If

        If InStr(command, " SC") > 0 Then
            Dim scParts() As String
            scParts = Split(command, " ")
            Dim scIndex As Long
            scIndex = UBound(scParts)
            currentStrokeColor = RGB(CInt(scParts(scIndex - 3) * 255), CInt(scParts(scIndex - 2) * 255), CInt(scParts(scIndex - 1) * 255))
            GoTo NextCommand
        End If

        If InStr(command, "Tf") > 0 Then
            isBold = InStr(command, "/F2") > 0
            isItalic = InStr(command, "/F3") > 0
            GoTo NextCommand
        End If

        If InStr(command, "Tr") > 0 Then
            underline = Left$(command, 1) = "1"
            GoTo NextCommand
        End If

        If command Like "* TA" Then
            Dim alignmentCode As Long
            alignmentCode = CLng(Split(command)(0))
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

        If InStr(command, "Ts") > 0 Then
            Dim tsParts() As String
            tsParts = Split(command, " ")
            Dim tsIndex As Long
            tsIndex = UBound(tsParts)
            currentFontSize = CDbl(tsParts(tsIndex - 1))
            GoTo NextCommand
        End If

        If InStr(command, " Td") > 0 Then
            Dim tdParts() As String
            tdParts = Split(command, " ")
            Dim deltaX As Double
            Dim deltaY As Double
            deltaX = CDbl(tdParts(0))
            deltaY = CDbl(tdParts(1))
            currentX = currentX + CLng(Fix(deltaX / 10))
            currentY = currentY + CLng(Fix(deltaY / 10))
            GoTo NextCommand
        End If

        If InStr(command, "/MoveTo") > 0 Then
            Dim mvParts() As String
            mvParts = Split(command, " ")
            Dim targetX As Long: targetX = CLng(mvParts(1))
            Dim targetY As Long: targetY = CLng(mvParts(2))
            Dim maxX As Long: maxX = IIf(pageWidth > 0, pageWidth, maxCols)
            Dim pageBottom As Long: pageBottom = IIf(pageHeight > 0, pageTopRow + pageHeight - 1, maxRows)
            targetX = WorksheetFunction.Max(1, WorksheetFunction.Min(maxX, targetX))
            targetY = WorksheetFunction.Max(pageTopRow, WorksheetFunction.Min(pageBottom, pageTopRow + targetY - 1))
            currentX = targetX
            currentY = targetY
            GoTo NextCommand
        End If

        Dim textValue As String
        If ParseTextCommand(command, textValue) Then
                With renderSheet.Cells(currentY, currentX)
                    .Value = textValue
                    ApplyText .Font, currentFillColor, currentFontSize, isBold, isItalic, underline
                    .Orientation = currentRotation
                    .HorizontalAlignment = hAlign
                    .VerticalAlignment = vAlign
                End With
            GoTo NextCommand
        End If

NextCommand:
    Next i
End Sub

Private Sub DrawPage(ByVal sheet As Worksheet, ByVal topRow As Long, ByVal width As Long, ByVal height As Long, ByVal borderStyle As XlLineStyle)
    If width <= 0 Or height <= 0 Then Exit Sub
    With sheet.Range(sheet.Cells(topRow, 1), sheet.Cells(topRow + height - 1, width))
        .Interior.Color = vbWhite
        SetAllBorders .Borders, vbBlack, borderStyle
    End With
End Sub

Private Sub SetAllBorders(ByVal borders As Borders, ByVal color As Long, ByVal style As XlLineStyle)
    Dim b As Variant
    For Each b In Array(xlEdgeTop, xlEdgeBottom, xlEdgeLeft, xlEdgeRight)
        With borders(b)
            .LineStyle = style
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
    Select Case widthValue
        Case 1: MapLineWidth = xlContinuous
        Case 2: MapLineWidth = xlContinuous
        Case 3: MapLineWidth = xlThick
        Case 4: MapLineWidth = xlDouble
        Case Else: MapLineWidth = xlContinuous
    End Select
End Function

Private Function IsExactOperator(ByVal command As String, ByVal expectedOperator As String) As Boolean
    IsExactOperator = (StrComp(Trim$(command), expectedOperator, vbBinaryCompare) = 0)
End Function

Private Function ParseRectangleCommand(ByVal command As String, ByRef x As Long, ByRef y As Long, ByRef w As Long, ByRef h As Long) As Boolean
    Dim re As Object
    Set re = CreateObject("VBScript.RegExp")
    re.Pattern = "^\s*-?\d+(\.\d+)?\s+-?\d+(\.\d+)?\s+-?\d+(\.\d+)?\s+-?\d+(\.\d+)?\s+re\s*$"

    If Not re.test(command) Then Exit Function

    Dim parts() As String
    parts = Split(Trim$(command))
    x = CLng(Fix(CDbl(parts(0))))
    y = CLng(Fix(CDbl(parts(1))))
    w = CLng(Fix(CDbl(parts(2))))
    h = CLng(Fix(CDbl(parts(3))))
    ParseRectangleCommand = True
End Function

Private Function ParseTextCommand(ByVal command As String, ByRef value As String) As Boolean
    Dim re As Object
    Set re = CreateObject("VBScript.RegExp")
    re.Pattern = "^\((.*)\)\s+Tj\s*$"

    If Not re.test(command) Then Exit Function

    value = re.Execute(command)(0).SubMatches(0)
    ParseTextCommand = True
End Function
