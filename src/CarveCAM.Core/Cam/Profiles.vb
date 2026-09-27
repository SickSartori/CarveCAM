Imports Clipper2Lib

Namespace Cam

    ''' <summary>Elemento selezionato nel 3D (faccia o oggetto intero) con i triangoli già proiettati sul piano dello sketch.</summary>
    Public Class ProfileItem
        Public Property Name As String
        ''' <summary>Sei valori per triangolo: x0,y0,x1,y1,x2,y2 nel sistema del piano (mm).</summary>
        Public Property Triangles As Double()
    End Class

    Public Class ProfileRequest
        Public Property Items As List(Of ProfileItem)
        ''' <summary>"union", "subtract" (il primo meno gli altri), "intersect" oppure "separate" (un profilo per elemento).</summary>
        Public Property Mode As String = "union"
        ''' <summary>Offset del profilo in mm: positivo verso l'esterno, negativo verso l'interno.</summary>
        Public Property Offset As Double
        ''' <summary>Scostamento massimo ammesso nella semplificazione dei contorni (mm).</summary>
        Public Property Tolerance As Double = 0.005
    End Class

    Public Class ProfileShape
        Public Property Name As String
        ''' <summary>Contorni chiusi come x,y alternati: esterni antiorari, fori orari.</summary>
        Public Property Loops As New List(Of Double())()
        ''' <summary>Area netta (mm²).</summary>
        Public Property Area As Double
    End Class

    Public Class ProfileResult
        Public Property Shapes As New List(Of ProfileShape)()
        Public Property Warnings As New List(Of String)()
    End Class

    ''' <summary>
    ''' Profili da selezioni 3D: l'"ombra" di facce o oggetti sul piano dello sketch (unione dei triangoli proiettati),
    ''' combinata con operazioni booleane oppure lasciata separata, con offset e semplificazione dei contorni.
    ''' </summary>
    Public Module ProfileBuilder

        ''' <summary>Triangoli con area proiettata inferiore (mm²) sono visti di taglio e non contribuiscono.</summary>
        Private Const MinTriangleArea As Double = 0.000001

        ''' <summary>Regione coperta dai triangoli proiettati (unione, fori compresi).</summary>
        Public Function Shadow(tris As Double()) As Paths64
            Dim paths As New Paths64()
            If tris Is Nothing Then Return paths
            For t = 0 To tris.Length - 6 Step 6
                Dim a = Pt(tris(t), tris(t + 1)), b = Pt(tris(t + 2), tris(t + 3)), c = Pt(tris(t + 4), tris(t + 5))
                Dim cross = CDbl(b.X - a.X) * CDbl(c.Y - a.Y) - CDbl(b.Y - a.Y) * CDbl(c.X - a.X)
                If Math.Abs(cross) / 2 / (Poly.Scale * Poly.Scale) < MinTriangleArea Then Continue For
                ' tutti antiorari: con NonZero le facce viste da dietro non creano fori
                paths.Add(If(cross > 0, New Path64 From {a, b, c}, New Path64 From {a, c, b}))
            Next
            If paths.Count = 0 Then Return paths
            ' chiusura morfologica di 1 µm (giunzioni a spigolo vivo, che restituiscono la forma esatta):
            ' salda eventuali fessure tra triangoli di facce adiacenti
            Dim d = 0.001 * Poly.Scale
            Dim u = Clipper.Union(paths, FillRule.NonZero)
            Return Clipper.InflatePaths(Clipper.InflatePaths(u, d, JoinType.Miter, EndType.Polygon, 4.0), -d, JoinType.Miter, EndType.Polygon, 4.0)
        End Function

        Private Function Pt(x As Double, y As Double) As Point64
            Return New Point64(CLng(Math.Round(x * Poly.Scale)), CLng(Math.Round(y * Poly.Scale)))
        End Function

        Public Function Build(req As ProfileRequest) As ProfileResult
            Dim res As New ProfileResult()
            Dim items = If(req?.Items, New List(Of ProfileItem)())
            If items.Count = 0 Then
                res.Warnings.Add("Nessun elemento selezionato.")
                Return res
            End If
            Dim regions As New List(Of Paths64)()
            For Each it In items
                Dim s = Shadow(it.Triangles)
                If s.Count = 0 Then res.Warnings.Add($"{If(it.Name, "Elemento")}: visto di taglio dal piano, la sua proiezione non ha area.")
                regions.Add(s)
            Next

            Dim groups As New List(Of (Name As String, Paths As Paths64))()
            Select Case If(req.Mode, "union").ToLowerInvariant()
                Case "separate"
                    For i = 0 To items.Count - 1
                        groups.Add((If(items(i).Name, $"Elemento {i + 1}"), regions(i)))
                    Next
                Case "subtract"
                    Dim rest As New Paths64()
                    For i = 1 To regions.Count - 1
                        rest.AddRange(regions(i))
                    Next
                    groups.Add(("Sottrazione", Poly.Difference(regions(0), Clipper.Union(rest, FillRule.NonZero))))
                Case "intersect"
                    Dim acc = regions(0)
                    For i = 1 To regions.Count - 1
                        acc = Poly.Intersect(acc, regions(i))
                    Next
                    groups.Add(("Intersezione", acc))
                Case Else
                    Dim all As New Paths64()
                    For Each s In regions
                        all.AddRange(s)
                    Next
                    groups.Add(("Unione", Clipper.Union(all, FillRule.NonZero)))
            End Select

            Dim tol = Math.Max(0.0001, req.Tolerance)
            For Each g In groups
                Dim p = g.Paths
                If p.Count = 0 Then Continue For
                If Math.Abs(req.Offset) > 0.0000001 Then p = Poly.Offset(p, req.Offset)
                p = Clipper.SimplifyPaths(p, tol * Poly.Scale, True)
                p = Poly.RemoveSmall(p, Math.Max(4 * tol * tol, 0.0001))
                If p.Count = 0 Then Continue For
                Dim shape As New ProfileShape With {.Name = g.Name}
                For Each path In p
                    Dim flat(path.Count * 2 - 1) As Double
                    For k = 0 To path.Count - 1
                        flat(2 * k) = path(k).X / Poly.Scale
                        flat(2 * k + 1) = path(k).Y / Poly.Scale
                    Next
                    shape.Loops.Add(flat)
                    shape.Area += Poly.AreaMm2(path)
                Next
                res.Shapes.Add(shape)
            Next
            If res.Shapes.Count = 0 AndAlso Not res.Warnings.Any() Then res.Warnings.Add("Il risultato è vuoto: gli elementi non si sovrappongono o l'offset li annulla.")
            Return res
        End Function

    End Module

End Namespace
