Imports Clipper2Lib
Imports CarveCAM.Core.Geometry

Namespace Cam

    ''' <summary>Utilità per poligoni 2D basate su Clipper2 (coordinate intere, scala 1e4 = 0.1 µm).</summary>
    Public Module Poly

        Public Const Scale As Double = 10000.0

        Public Function ToPath(loop2 As IList(Of Vec2)) As Path64
            Dim p As New Path64(loop2.Count)
            For Each v In loop2
                p.Add(New Point64(CLng(Math.Round(v.X * Scale)), CLng(Math.Round(v.Y * Scale))))
            Next
            Return p
        End Function

        Public Function ToPaths(loops As IEnumerable(Of List(Of Vec2))) As Paths64
            Dim res As New Paths64()
            For Each l In loops
                If l.Count >= 2 Then res.Add(ToPath(l))
            Next
            Return res
        End Function

        Public Function ToLoop(p As Path64) As List(Of Vec2)
            Dim res As New List(Of Vec2)(p.Count)
            For Each pt In p
                res.Add(New Vec2(pt.X / Scale, pt.Y / Scale))
            Next
            Return res
        End Function

        Public Function ToLoops(paths As Paths64) As List(Of List(Of Vec2))
            Dim res As New List(Of List(Of Vec2))(paths.Count)
            For Each p In paths
                res.Add(ToLoop(p))
            Next
            Return res
        End Function

        Public Function ToPoint(v As Vec2) As Point64
            Return New Point64(CLng(Math.Round(v.X * Scale)), CLng(Math.Round(v.Y * Scale)))
        End Function

        ''' <summary>Offset (mm): negativo = verso l'interno.</summary>
        Public Function Offset(paths As Paths64, delta As Double, Optional arcTolerance As Double = 0.002) As Paths64
            If paths.Count = 0 Then Return New Paths64()
            If Math.Abs(delta) < 0.0000001 Then Return Clipper.Union(paths, FillRule.NonZero)
            Return Clipper.InflatePaths(paths, delta * Scale, JoinType.Round, EndType.Polygon, 2.0, arcTolerance * Scale)
        End Function

        Public Function Union(paths As Paths64, Optional rule As FillRule = FillRule.NonZero) As Paths64
            Return Clipper.Union(paths, rule)
        End Function

        Public Function Difference(a As Paths64, b As Paths64) As Paths64
            If b.Count = 0 Then Return Clipper.Union(a, FillRule.NonZero)
            Return Clipper.Difference(a, b, FillRule.NonZero)
        End Function

        Public Function Intersect(a As Paths64, b As Paths64) As Paths64
            Return Clipper.Intersect(a, b, FillRule.NonZero)
        End Function

        ''' <summary>Area (mm²) con segno (positiva = antioraria).</summary>
        Public Function AreaMm2(p As Path64) As Double
            Return Clipper.Area(p) / (Scale * Scale)
        End Function

        ''' <summary>Elimina i contorni con area assoluta inferiore a minArea (mm²).</summary>
        Public Function RemoveSmall(paths As Paths64, minArea As Double) As Paths64
            Dim res As New Paths64()
            For Each p In paths
                If Math.Abs(AreaMm2(p)) >= minArea Then res.Add(p)
            Next
            Return res
        End Function

        ''' <summary>Apertura morfologica: rimuove lembi più sottili di 2*eps.</summary>
        Public Function Opening(paths As Paths64, eps As Double) As Paths64
            If paths.Count = 0 Then Return paths
            Return Offset(Offset(paths, -eps), eps)
        End Function

        ''' <summary>Punto interno alla regione (regola even-odd su tutti i contorni); i punti sul bordo contano come interni.</summary>
        Public Function Contains(paths As Paths64, v As Vec2) As Boolean
            Dim pt = ToPoint(v)
            Dim inside = False
            For Each p In paths
                Dim r = Clipper.PointInPolygon(pt, p)
                If r = PointInPolygonResult.IsOn Then Return True
                If r = PointInPolygonResult.IsInside Then inside = Not inside
            Next
            Return inside
        End Function

        ''' <summary>Come <see cref="Contains"/>, ma considera interni anche i punti entro <paramref name="tol"/> mm dal bordo.</summary>
        Public Function ContainsTol(paths As Paths64, v As Vec2, tol As Double) As Boolean
            If Contains(paths, v) Then Return True
            For Each p In paths
                Dim n = p.Count
                For i = 0 To n - 1
                    Dim q0 = p(i), q1 = p((i + 1) Mod n)
                    If DistPointSeg(v.X, v.Y, q0.X / Scale, q0.Y / Scale, q1.X / Scale, q1.Y / Scale) <= tol Then Return True
                Next
            Next
            Return False
        End Function

        Private Function DistPointSeg(px As Double, py As Double, ax As Double, ay As Double, bx As Double, by As Double) As Double
            Dim dx = bx - ax, dy = by - ay
            Dim l2 = dx * dx + dy * dy
            Dim t = If(l2 > 0, ((px - ax) * dx + (py - ay) * dy) / l2, 0.0)
            t = Math.Max(0, Math.Min(1, t))
            Dim qx = ax + dx * t - px, qy = ay + dy * t - py
            Return Math.Sqrt(qx * qx + qy * qy)
        End Function

        ''' <summary>
        ''' Vero se il segmento a-b è interamente nella regione. I punti sul bordo (entro 1 µm, per l'arrotondamento
        ''' delle coordinate intere) contano come interni e i tratti che corrono lungo il bordo non sono attraversamenti.
        ''' </summary>
        Public Function SegmentInside(paths As Paths64, a As Vec2, b As Vec2) As Boolean
            Const TOL = 0.001
            Dim len = Vec2.Distance(a, b)
            If len < 0.000001 Then Return True
            For Each t In {0.25, 0.5, 0.75}
                If Not ContainsTol(paths, Vec2.Lerp(a, b, t), TOL) Then Return False
            Next
            Dim eps = Math.Min(0.001, len * 0.01) / len
            Dim pa = Vec2.Lerp(a, b, eps), pb = Vec2.Lerp(a, b, 1 - eps)
            Dim minX = Math.Min(pa.X, pb.X), maxX = Math.Max(pa.X, pb.X)
            Dim minY = Math.Min(pa.Y, pb.Y), maxY = Math.Max(pa.Y, pb.Y)
            For Each p In paths
                Dim n = p.Count
                For i = 0 To n - 1
                    Dim q0 = p(i), q1 = p((i + 1) Mod n)
                    Dim x0 = q0.X / Scale, y0 = q0.Y / Scale, x1 = q1.X / Scale, y1 = q1.Y / Scale
                    If Math.Max(x0, x1) < minX OrElse Math.Min(x0, x1) > maxX OrElse
                       Math.Max(y0, y1) < minY OrElse Math.Min(y0, y1) > maxY Then Continue For
                    If ProperIntersect(pa.X, pa.Y, pb.X, pb.Y, x0, y0, x1, y1) Then Return False
                Next
            Next
            Return True
        End Function

        ''' <summary>Attraversamento netto tra due segmenti: le distanze con segno dei punti dalle rette devono superare 1 µm.</summary>
        Private Function ProperIntersect(ax As Double, ay As Double, bx As Double, by As Double,
                                         cx As Double, cy As Double, dx As Double, dy As Double) As Boolean
            Const E = 0.001
            Dim lcd = Math.Sqrt((dx - cx) ^ 2 + (dy - cy) ^ 2), lab = Math.Sqrt((bx - ax) ^ 2 + (by - ay) ^ 2)
            If lcd < 0.000000001 OrElse lab < 0.000000001 Then Return False
            Dim d1 = Orient(cx, cy, dx, dy, ax, ay) / lcd, d2 = Orient(cx, cy, dx, dy, bx, by) / lcd
            Dim d3 = Orient(ax, ay, bx, by, cx, cy) / lab, d4 = Orient(ax, ay, bx, by, dx, dy) / lab
            Return ((d1 > E AndAlso d2 < -E) OrElse (d1 < -E AndAlso d2 > E)) AndAlso
                   ((d3 > E AndAlso d4 < -E) OrElse (d3 < -E AndAlso d4 > E))
        End Function

        Private Function Orient(ax As Double, ay As Double, bx As Double, by As Double, cx As Double, cy As Double) As Double
            Return (bx - ax) * (cy - ay) - (by - ay) * (cx - ax)
        End Function

        ''' <summary>Box 2D di un insieme di contorni (mm).</summary>
        Public Function Bounds(paths As Paths64) As (MinX As Double, MinY As Double, MaxX As Double, MaxY As Double)
            Dim minX = Double.MaxValue, minY = Double.MaxValue, maxX = Double.MinValue, maxY = Double.MinValue
            For Each p In paths
                For Each pt In p
                    minX = Math.Min(minX, pt.X) : maxX = Math.Max(maxX, pt.X)
                    minY = Math.Min(minY, pt.Y) : maxY = Math.Max(maxY, pt.Y)
                Next
            Next
            Return (minX / Scale, minY / Scale, maxX / Scale, maxY / Scale)
        End Function

        ''' <summary>Distanza minima tra un punto e i vertici di un contorno, con indice del vertice.</summary>
        Public Function NearestVertex(loop2 As List(Of Vec2), p As Vec2) As (Index As Integer, Dist As Double)
            Dim bi = 0, bd = Double.MaxValue
            For i = 0 To loop2.Count - 1
                Dim dx = loop2(i).X - p.X, dy = loop2(i).Y - p.Y
                Dim d = dx * dx + dy * dy
                If d < bd Then bd = d : bi = i
            Next
            Return (bi, Math.Sqrt(bd))
        End Function

    End Module

End Namespace
