Imports System.Buffers.Binary
Imports System.Globalization
Imports System.IO
Imports System.Text

Namespace Meshes

    ''' <summary>
    ''' Importatori nativi VB.NET per i formati mesh più comuni (STL ascii/binario, OBJ, PLY ascii/binario, OFF).
    ''' Gli altri formati (glTF, FBX, 3MF, DAE, 3DS, STEP, IGES...) vengono convertiti in triangoli dal client web
    ''' e caricati come triangle soup.
    ''' </summary>
    Public Module MeshImporter

        Public ReadOnly Property SupportedExtensions As String() = {"stl", "obj", "ply", "off"}

        Public Function IsSupported(fileName As String) As Boolean
            Return SupportedExtensions.Contains(ExtensionOf(fileName))
        End Function

        Public Function ExtensionOf(fileName As String) As String
            Return Path.GetExtension(If(fileName, "")).TrimStart("."c).ToLowerInvariant()
        End Function

        Public Function Import(fileName As String, data As Byte()) As Single()
            Dim positions As Single()
            Select Case ExtensionOf(fileName)
                Case "stl" : positions = ReadStl(data)
                Case "obj" : positions = ReadObj(data)
                Case "ply" : positions = ReadPly(data)
                Case "off" : positions = ReadOff(data)
                Case Else
                    Throw New NotSupportedException("Formato non supportato lato server: " & fileName)
            End Select
            positions = MeshData.Sanitize(positions)
            If positions.Length = 0 Then Throw New InvalidDataException("Il file non contiene triangoli validi.")
            Return positions
        End Function

        Private Function Inv(s As String) As Double
            Dim d As Double
            If Double.TryParse(s, NumberStyles.Float, CultureInfo.InvariantCulture, d) Then Return d
            Throw New InvalidDataException("Numero non valido: " & s)
        End Function

        Private ReadOnly WS As Char() = {" "c, ControlChars.Tab}

        Private Iterator Function Lines(data As Byte()) As IEnumerable(Of String)
            Using sr As New StreamReader(New MemoryStream(data), Encoding.Latin1, True)
                Dim l = sr.ReadLine()
                While l IsNot Nothing
                    Yield l
                    l = sr.ReadLine()
                End While
            End Using
        End Function

        ' ---------------------------------------------------------------- STL
        Public Function ReadStl(data As Byte()) As Single()
            If IsBinaryStl(data) Then
                Dim n = CInt(BinaryPrimitives.ReadUInt32LittleEndian(data.AsSpan(80, 4)))
                Dim res(n * 9 - 1) As Single
                Dim off = 84
                For t = 0 To n - 1
                    Dim p = off + 12 ' salta la normale
                    For k = 0 To 8
                        res(t * 9 + k) = BinaryPrimitives.ReadSingleLittleEndian(data.AsSpan(p + k * 4, 4))
                    Next
                    off += 50
                Next
                Return res
            End If
            Dim outList As New List(Of Single)()
            For Each raw In Lines(data)
                Dim l = raw.Trim()
                If l.StartsWith("vertex", StringComparison.OrdinalIgnoreCase) Then
                    Dim tk = l.Split(WS, StringSplitOptions.RemoveEmptyEntries)
                    If tk.Length >= 4 Then
                        outList.Add(CSng(Inv(tk(1)))) : outList.Add(CSng(Inv(tk(2)))) : outList.Add(CSng(Inv(tk(3))))
                    End If
                End If
            Next
            Dim cnt = outList.Count - outList.Count Mod 9
            Return outList.GetRange(0, cnt).ToArray()
        End Function

        Private Function IsBinaryStl(data As Byte()) As Boolean
            If data.Length < 84 Then Return False
            Dim n = CLng(BinaryPrimitives.ReadUInt32LittleEndian(data.AsSpan(80, 4)))
            If 84 + n * 50 = data.Length Then Return True
            Dim head = Encoding.ASCII.GetString(data, 0, Math.Min(512, data.Length)).TrimStart()
            If head.StartsWith("solid", StringComparison.OrdinalIgnoreCase) AndAlso head.Contains("facet") Then Return False
            Return 84 + n * 50 <= data.Length
        End Function

        ' ---------------------------------------------------------------- OBJ
        Public Function ReadObj(data As Byte()) As Single()
            Dim verts As New List(Of Double)()
            Dim outList As New List(Of Single)()
            Dim idx As New List(Of Integer)()
            For Each raw In Lines(data)
                Dim l = raw.Trim()
                If l.Length < 2 Then Continue For
                If l(0) = "v"c AndAlso (l(1) = " "c OrElse l(1) = ControlChars.Tab) Then
                    Dim tk = l.Split(WS, StringSplitOptions.RemoveEmptyEntries)
                    If tk.Length >= 4 Then
                        verts.Add(Inv(tk(1))) : verts.Add(Inv(tk(2))) : verts.Add(Inv(tk(3)))
                    End If
                ElseIf l(0) = "f"c AndAlso (l(1) = " "c OrElse l(1) = ControlChars.Tab) Then
                    Dim tk = l.Split(WS, StringSplitOptions.RemoveEmptyEntries)
                    idx.Clear()
                    Dim nv = verts.Count \ 3
                    For i = 1 To tk.Length - 1
                        Dim s = tk(i)
                        Dim slash = s.IndexOf("/"c)
                        If slash >= 0 Then s = s.Substring(0, slash)
                        Dim vi As Integer
                        If Not Integer.TryParse(s, NumberStyles.Integer, CultureInfo.InvariantCulture, vi) Then Continue For
                        vi = If(vi < 0, nv + vi, vi - 1)
                        If vi >= 0 AndAlso vi < nv Then idx.Add(vi)
                    Next
                    For i = 1 To idx.Count - 2
                        For Each k In {idx(0), idx(i), idx(i + 1)}
                            outList.Add(CSng(verts(k * 3))) : outList.Add(CSng(verts(k * 3 + 1))) : outList.Add(CSng(verts(k * 3 + 2)))
                        Next
                    Next
                End If
            Next
            Return outList.ToArray()
        End Function

        ' ---------------------------------------------------------------- OFF
        Public Function ReadOff(data As Byte()) As Single()
            ' righe significative (senza commenti), ciascuna già suddivisa in token
            Dim rows As New List(Of String())()
            For Each raw In Lines(data)
                Dim l = raw
                Dim hash = l.IndexOf("#"c)
                If hash >= 0 Then l = l.Substring(0, hash)
                Dim tk = l.Split(WS, StringSplitOptions.RemoveEmptyEntries)
                If tk.Length > 0 Then rows.Add(tk)
            Next
            Dim r = 0
            Dim first = rows(0)
            Dim counts As String()
            If first(0).EndsWith("OFF", StringComparison.OrdinalIgnoreCase) Then
                counts = If(first.Length >= 3, first.Skip(1).ToArray(), rows(1))
                r = If(first.Length >= 3, 1, 2)
            Else
                counts = first : r = 1
            End If
            Dim nv = CInt(Inv(counts(0))), nf = CInt(Inv(counts(1)))
            Dim verts(nv * 3 - 1) As Double
            For i = 0 To nv - 1
                Dim tk = rows(r + i)
                verts(i * 3) = Inv(tk(0)) : verts(i * 3 + 1) = Inv(tk(1)) : verts(i * 3 + 2) = Inv(tk(2))
            Next
            r += nv
            Dim outList As New List(Of Single)()
            Dim ids As New List(Of Integer)()
            For f = 0 To nf - 1
                If r + f >= rows.Count Then Exit For
                Dim tk = rows(r + f)
                Dim cnt = CInt(Inv(tk(0)))
                ids.Clear()
                For k = 1 To Math.Min(cnt, tk.Length - 1)
                    ids.Add(CInt(Inv(tk(k))))
                Next
                EmitFan(ids, verts, outList)
            Next
            Return outList.ToArray()
        End Function

        ' ---------------------------------------------------------------- PLY
        Private Class PlyProp
            Public Name As String
            Public Type As String
            Public IsList As Boolean
            Public CountType As String
        End Class

        Private Class PlyElement
            Public Name As String
            Public Count As Integer
            Public Props As New List(Of PlyProp)()
        End Class

        Public Function ReadPly(data As Byte()) As Single()
            Dim headerEnd = IndexOf(data, Encoding.ASCII.GetBytes("end_header"))
            If headerEnd < 0 Then Throw New InvalidDataException("Header PLY non valido.")
            Dim dataStart = headerEnd + "end_header".Length
            While dataStart < data.Length AndAlso data(dataStart) <> 10
                dataStart += 1
            End While
            dataStart += 1
            Dim header = Encoding.ASCII.GetString(data, 0, headerEnd)
            Dim format = "ascii"
            Dim elements As New List(Of PlyElement)()
            For Each raw In header.Split({ControlChars.Lf}, StringSplitOptions.RemoveEmptyEntries)
                Dim tk = raw.Trim().Split(WS, StringSplitOptions.RemoveEmptyEntries)
                If tk.Length = 0 Then Continue For
                Select Case tk(0)
                    Case "format" : format = tk(1)
                    Case "element" : elements.Add(New PlyElement With {.Name = tk(1), .Count = CInt(tk(2))})
                    Case "property"
                        If elements.Count = 0 Then Continue For
                        If tk(1) = "list" Then
                            elements.Last().Props.Add(New PlyProp With {.IsList = True, .CountType = tk(2), .Type = tk(3), .Name = tk(4)})
                        Else
                            elements.Last().Props.Add(New PlyProp With {.Type = tk(1), .Name = tk(2)})
                        End If
                End Select
            Next

            Dim verts As New List(Of Double)()
            Dim outList As New List(Of Single)()
            Dim faceIdx As New List(Of Integer)()

            If format = "ascii" Then
                Dim tokens = Encoding.ASCII.GetString(data, dataStart, data.Length - dataStart).Split(
                    {" "c, ControlChars.Tab, ControlChars.Cr, ControlChars.Lf}, StringSplitOptions.RemoveEmptyEntries)
                Dim p = 0
                For Each el In elements
                    For i = 0 To el.Count - 1
                        Dim x = 0.0, y = 0.0, z = 0.0
                        For Each pr In el.Props
                            If pr.IsList Then
                                Dim cnt = CInt(Inv(tokens(p))) : p += 1
                                faceIdx.Clear()
                                For k = 0 To cnt - 1
                                    faceIdx.Add(CInt(Inv(tokens(p)))) : p += 1
                                Next
                                If el.Name = "face" AndAlso (pr.Name = "vertex_indices" OrElse pr.Name = "vertex_index") Then
                                    EmitFan(faceIdx, verts, outList)
                                End If
                            Else
                                Dim v = Inv(tokens(p)) : p += 1
                                If el.Name = "vertex" Then
                                    If pr.Name = "x" Then x = v
                                    If pr.Name = "y" Then y = v
                                    If pr.Name = "z" Then z = v
                                End If
                            End If
                        Next
                        If el.Name = "vertex" Then verts.Add(x) : verts.Add(y) : verts.Add(z)
                    Next
                Next
            Else
                Dim little = format = "binary_little_endian"
                Dim pos = dataStart
                For Each el In elements
                    For i = 0 To el.Count - 1
                        Dim x = 0.0, y = 0.0, z = 0.0
                        For Each pr In el.Props
                            If pr.IsList Then
                                Dim cnt = CInt(ReadBin(data, pos, pr.CountType, little))
                                faceIdx.Clear()
                                For k = 0 To cnt - 1
                                    faceIdx.Add(CInt(ReadBin(data, pos, pr.Type, little)))
                                Next
                                If el.Name = "face" AndAlso (pr.Name = "vertex_indices" OrElse pr.Name = "vertex_index") Then
                                    EmitFan(faceIdx, verts, outList)
                                End If
                            Else
                                Dim v = ReadBin(data, pos, pr.Type, little)
                                If el.Name = "vertex" Then
                                    If pr.Name = "x" Then x = v
                                    If pr.Name = "y" Then y = v
                                    If pr.Name = "z" Then z = v
                                End If
                            End If
                        Next
                        If el.Name = "vertex" Then verts.Add(x) : verts.Add(y) : verts.Add(z)
                    Next
                Next
            End If
            Return outList.ToArray()
        End Function

        Private Sub EmitFan(ids As List(Of Integer), verts As IList(Of Double), outList As List(Of Single))
            Dim nv = verts.Count \ 3
            For i = 1 To ids.Count - 2
                For Each k In {ids(0), ids(i), ids(i + 1)}
                    If k < 0 OrElse k >= nv Then Continue For
                    outList.Add(CSng(verts(k * 3))) : outList.Add(CSng(verts(k * 3 + 1))) : outList.Add(CSng(verts(k * 3 + 2)))
                Next
            Next
        End Sub

        Private Function ReadBin(data As Byte(), ByRef pos As Integer, type As String, little As Boolean) As Double
            Dim s = data.AsSpan(pos)
            Select Case type
                Case "char", "int8"
                    pos += 1 : Return CSByte(If(data(pos - 1) > 127, CInt(data(pos - 1)) - 256, CInt(data(pos - 1))))
                Case "uchar", "uint8"
                    pos += 1 : Return data(pos - 1)
                Case "short", "int16"
                    pos += 2 : Return If(little, BinaryPrimitives.ReadInt16LittleEndian(s), BinaryPrimitives.ReadInt16BigEndian(s))
                Case "ushort", "uint16"
                    pos += 2 : Return If(little, BinaryPrimitives.ReadUInt16LittleEndian(s), BinaryPrimitives.ReadUInt16BigEndian(s))
                Case "int", "int32"
                    pos += 4 : Return If(little, BinaryPrimitives.ReadInt32LittleEndian(s), BinaryPrimitives.ReadInt32BigEndian(s))
                Case "uint", "uint32"
                    pos += 4 : Return If(little, BinaryPrimitives.ReadUInt32LittleEndian(s), BinaryPrimitives.ReadUInt32BigEndian(s))
                Case "float", "float32"
                    pos += 4 : Return If(little, BinaryPrimitives.ReadSingleLittleEndian(s), BinaryPrimitives.ReadSingleBigEndian(s))
                Case "double", "float64"
                    pos += 8 : Return If(little, BinaryPrimitives.ReadDoubleLittleEndian(s), BinaryPrimitives.ReadDoubleBigEndian(s))
                Case Else
                    Throw New InvalidDataException("Tipo PLY non supportato: " & type)
            End Select
        End Function

        Private Function IndexOf(data As Byte(), pattern As Byte()) As Integer
            Dim limit = Math.Min(data.Length - pattern.Length, 1 << 20)
            For i = 0 To limit
                Dim ok = True
                For k = 0 To pattern.Length - 1
                    If data(i + k) <> pattern(k) Then ok = False : Exit For
                Next
                If ok Then Return i
            Next
            Return -1
        End Function

    End Module

End Namespace
