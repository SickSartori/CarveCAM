Imports CarveCAM.Core.Geometry

Namespace Post

    ''' <summary>Tratto in uscita: segmento fino a [End], oppure arco nel piano G17/G18/G19 con centro e verso.</summary>
    Public NotInheritable Class PathSeg
        Public IsArc As Boolean
        Public [End] As Vec3
        ''' <summary>Arco: centro (stessa terza coordinata del punto iniziale), piano 17/18/19, verso antiorario attorno alla normale del piano.</summary>
        Public Center As Vec3
        Public Plane As Integer = 17
        Public Ccw As Boolean
        Public Sweep As Double
        Public Radius As Double
        ''' <summary>Punti originali del percorso coperti dal tratto (per tornare ai segmenti se l'arco non si può scrivere).</summary>
        Public FromIndex As Integer
        Public ToIndex As Integer
    End Class

    ''' <summary>
    ''' Riconoscimento degli archi nei punti del percorso (che il motore calcola come polilinee) e loro uscita come
    ''' archi G2/G3 oppure, per i controlli che accettano solo G1, come corde con errore e lunghezze minima e massima.
    ''' </summary>
    Public Module PathFitter

        Private Const MinArcPoints As Integer = 4     ' almeno tre segmenti per riconoscere un arco
        Private Const MaxArcPoints As Integer = 3000  ' punti massimi di un arco (limita il costo del controllo)

        ''' <summary>Assi (a, b) del piano e asse normale h: G17 XY / Z, G18 ZX / Y, G19 YZ / X.</summary>
        Private Sub Axes(plane As Integer, ByRef a As Integer, ByRef b As Integer, ByRef hh As Integer)
            Select Case plane
                Case 18 : a = 2 : b = 0 : hh = 1
                Case 19 : a = 1 : b = 2 : hh = 0
                Case Else : a = 0 : b = 1 : hh = 2
            End Select
        End Sub

        Private Function C(p As Vec3, i As Integer) As Double
            Return If(i = 0, p.X, If(i = 1, p.Y, p.Z))
        End Function

        Private Function Make(a As Integer, b As Integer, hh As Integer, va As Double, vb As Double, vh As Double) As Vec3
            Dim v(2) As Double
            v(a) = va : v(b) = vb : v(hh) = vh
            Return New Vec3(v(0), v(1), v(2))
        End Function

        ''' <summary>
        ''' Tratti per i punti pts (pts(0) è la posizione attuale): archi dove i punti stanno su una circonferenza entro
        ''' la tolleranza (con i limiti di raggio, angolo, piani ed elica della macchina), segmenti altrove.
        ''' </summary>
        Public Function Fit(pts As IList(Of Vec3), m As MachineDef) As List(Of PathSeg)
            Dim res As New List(Of PathSeg)()
            Dim n = pts.Count
            Dim tol = Math.Max(0.0001, m.ArcTolerance)
            Dim maxAngle = Math.Max(5.0, Math.Min(360.0, m.ArcMaxAngle))
            If m.Arcs AndAlso m.ArcFormat = "r" Then maxAngle = Math.Min(maxAngle, 175.0)   ' con R sopra i 180° il verso è ambiguo
            maxAngle *= Math.PI / 180.0
            Dim planes = If(m.ArcAllPlanes, {17, 18, 19}, {17})
            Dim i = 0
            While i < n - 1
                Dim best As PathSeg = Nothing
                If n - i >= MinArcPoints Then
                    For Each pl In planes
                        Dim s = GrowArc(pts, i, pl, tol, m.ArcMinRadius, m.ArcMaxRadius, maxAngle, m.ArcHelical)
                        If s IsNot Nothing AndAlso (best Is Nothing OrElse s.ToIndex > best.ToIndex) Then best = s
                    Next
                End If
                If best IsNot Nothing Then
                    res.Add(best)
                    i = best.ToIndex
                Else
                    res.Add(New PathSeg With {.End = pts(i + 1), .FromIndex = i, .ToIndex = i + 1})
                    i += 1
                End If
            End While
            Return res
        End Function

        ''' <summary>Arco più lungo che parte dal punto i nel piano dato, oppure Nothing.</summary>
        Private Function GrowArc(pts As IList(Of Vec3), i As Integer, plane As Integer, tol As Double, minR As Double, maxR As Double,
                                 maxAngle As Double, helical As Boolean) As PathSeg
            Dim last = Math.Min(pts.Count - 1, i + MaxArcPoints)
            If last - i < MinArcPoints - 1 Then Return Nothing
            Dim found As PathSeg = Nothing
            For j = i + MinArcPoints - 1 To last
                Dim s = TryArc(pts, i, j, plane, tol, minR, maxR, maxAngle, helical)
                If s Is Nothing Then Exit For
                found = s
            Next
            Return found
        End Function

        ''' <summary>Arco dai punti i..j se tutti stanno sulla circonferenza per il primo, il medio e l'ultimo punto.</summary>
        Private Function TryArc(pts As IList(Of Vec3), i As Integer, j As Integer, plane As Integer, tol As Double, minR As Double, maxR As Double,
                                maxAngle As Double, helical As Boolean) As PathSeg
            Dim a, b, hh As Integer
            Axes(plane, a, b, hh)
            Dim mid = (i + j) \ 2
            Dim x1 = C(pts(i), a), y1 = C(pts(i), b)
            Dim x2 = C(pts(mid), a), y2 = C(pts(mid), b)
            Dim x3 = C(pts(j), a), y3 = C(pts(j), b)
            Dim d = 2 * (x1 * (y2 - y3) + x2 * (y3 - y1) + x3 * (y1 - y2))
            If Math.Abs(d) < 0.0000000001 Then Return Nothing
            Dim s1 = x1 * x1 + y1 * y1, s2 = x2 * x2 + y2 * y2, s3 = x3 * x3 + y3 * y3
            Dim cx = (s1 * (y2 - y3) + s2 * (y3 - y1) + s3 * (y1 - y2)) / d
            Dim cy = (s1 * (x3 - x2) + s2 * (x1 - x3) + s3 * (x2 - x1)) / d
            Dim r = Math.Sqrt((x1 - cx) ^ 2 + (y1 - cy) ^ 2)
            If r < Math.Max(minR, tol * 4) OrElse r > maxR Then Return Nothing
            ' verso e ampiezza: tutti i passi nello stesso verso e non oltre l'angolo massimo
            Dim total = 0.0
            Dim sign = 0
            Dim cum(j - i) As Double
            ' i punti del motore stanno sulla curva vera e le corde se ne staccano al più della sua tolleranza: la freccia
            ' delle corde può superare quella dell'arco, ma non di molto (un poligono a pochi lati non è un arco)
            Dim sagMax = Math.Max(4 * tol, 0.02)
            For k = i To j - 1
                Dim ux = C(pts(k), a) - cx, uy = C(pts(k), b) - cy
                Dim wx = C(pts(k + 1), a) - cx, wy = C(pts(k + 1), b) - cy
                Dim dt = Math.Atan2(ux * wy - uy * wx, ux * wx + uy * wy)
                If Math.Abs(dt) < 0.000000001 OrElse Math.Abs(dt) > Math.PI / 2 Then Return Nothing
                Dim sg = Math.Sign(dt)
                If sign = 0 Then sign = sg Else If sg <> sign Then Return Nothing
                ' corda del segmento: la sua freccia rispetto all'arco resta nella tolleranza
                Dim len = Math.Sqrt((wx - ux) ^ 2 + (wy - uy) ^ 2)
                If r - Math.Sqrt(Math.Max(0, r * r - len * len / 4)) > sagMax Then Return Nothing
                total += dt
                cum(k - i + 1) = total
            Next
            If Math.Abs(total) > maxAngle + 0.000001 Then Return Nothing
            ' distanza dalla circonferenza e terza coordinata (costante, o lineare con l'angolo per l'elica)
            Dim h0 = C(pts(i), hh), h1 = C(pts(j), hh)
            If Not helical AndAlso Math.Abs(h1 - h0) > tol Then Return Nothing
            For k = i To j
                Dim dx = C(pts(k), a) - cx, dy = C(pts(k), b) - cy
                If Math.Abs(Math.Sqrt(dx * dx + dy * dy) - r) > tol Then Return Nothing
                Dim hk = h0 + (h1 - h0) * cum(k - i) / total
                If Math.Abs(C(pts(k), hh) - hk) > tol Then Return Nothing
            Next
            Return New PathSeg With {
                .IsArc = True, .End = pts(j), .Center = Make(a, b, hh, cx, cy, h0), .Plane = plane, .Ccw = total > 0,
                .Sweep = Math.Abs(total), .Radius = r, .FromIndex = i, .ToIndex = j}
        End Function

        ''' <summary>
        ''' Punti di un arco rifatto a corde (escluso il punto iniziale): errore di corda tol, lunghezza delle corde tra
        ''' minLen e maxLen (0 = senza limite); con l'elica la terza coordinata varia in proporzione.
        ''' </summary>
        Public Function Chords(start As Vec3, s As PathSeg, tol As Double, minLen As Double, maxLen As Double) As List(Of Vec3)
            Dim a, b, hh As Integer
            Axes(s.Plane, a, b, hh)
            Dim r = s.Radius
            Dim stepA = If(tol >= r, Math.PI / 2, 2 * Math.Acos(1 - tol / r))
            Dim len = 2 * r * Math.Sin(stepA / 2)
            If minLen > 0 Then len = Math.Max(len, minLen)
            If maxLen > 0 Then len = Math.Min(len, maxLen)
            stepA = 2 * Math.Asin(Math.Min(1.0, len / (2 * r)))
            Dim count = Math.Max(1, CInt(Math.Ceiling(s.Sweep / Math.Max(0.000001, stepA) - 0.000001)))
            Dim cx = C(s.Center, a), cy = C(s.Center, b)
            Dim a0 = Math.Atan2(C(start, b) - cy, C(start, a) - cx)
            Dim h0 = C(start, hh), h1 = C(s.End, hh)
            Dim dir = If(s.Ccw, 1.0, -1.0)
            Dim res As New List(Of Vec3)(count)
            For k = 1 To count - 1
                Dim f = k / count
                Dim ang = a0 + dir * s.Sweep * f
                res.Add(Make(a, b, hh, cx + r * Math.Cos(ang), cy + r * Math.Sin(ang), h0 + (h1 - h0) * f))
            Next
            res.Add(s.End)
            Return res
        End Function

        ''' <summary>Segmento diviso in parti non più lunghe di maxLen (escluso il punto iniziale).</summary>
        Public Function SplitLine(start As Vec3, [end] As Vec3, maxLen As Double) As List(Of Vec3)
            Dim res As New List(Of Vec3)()
            Dim len = ([end] - start).Length
            Dim count = If(maxLen > 0, Math.Max(1, CInt(Math.Ceiling(len / maxLen - 0.000001))), 1)
            For k = 1 To count - 1
                res.Add(start + ([end] - start) * (k / count))
            Next
            res.Add([end])
            Return res
        End Function

    End Module

End Namespace
