Imports Clipper2Lib
Imports CarveCAM.Core.Geometry

Namespace Cam

    Public Enum LinkKind
        ''' <summary>Disimpegno alla quota di sicurezza prima di questo tratto.</summary>
        Retract
        ''' <summary>Collegamento diretto (in lavoro) dal tratto precedente.</summary>
        Direct
    End Enum

    ''' <summary>Tratto di percorso 2D sul piano, con il tipo di collegamento dal tratto precedente.</summary>
    Public NotInheritable Class PathSeg2D
        Public ReadOnly Points As List(Of Vec2)
        Public Link As LinkKind

        Public Sub New(points As List(Of Vec2), link As LinkKind)
            Me.Points = points
            Me.Link = link
        End Sub
    End Class

    ''' <summary>Generazione delle strategie 2D: concentrica (offset) e zigzag (rettangolare).</summary>
    Public Module PathPlanner

        ' ============================================================ CONCENTRICA
        Private NotInheritable Class LoopNode
            Public Points As List(Of Vec2)
            Public Level As Integer
            Public Children As New List(Of LoopNode)()
            Public Done As Boolean
        End Class

        ''' <summary>
        ''' Contorni concentrici della regione (passata 0 = bordo regione, poi offset interni di stepover).
        ''' Ordine: dall'interno verso l'esterno, completando un ramo prima di passare al successivo.
        ''' </summary>
        Public Function Concentric(region As Paths64, stepover As Double, climb As Boolean,
                                   Optional startFrom As Vec2? = Nothing) As List(Of PathSeg2D)
            Dim levels As New List(Of List(Of LoopNode))()
            Dim k = 0
            Dim cur = region
            While cur.Count > 0 AndAlso k < 100000
                Dim nodes As New List(Of LoopNode)()
                For Each p In cur
                    If p.Count < 3 Then Continue For
                    Dim pts = Poly.ToLoop(p)
                    If Not climb Then pts.Reverse()
                    nodes.Add(New LoopNode With {.Points = pts, .Level = k})
                Next
                levels.Add(nodes)
                k += 1
                cur = Poly.RemoveSmall(Poly.Offset(region, -k * stepover), 0.0001)
            End While

            ' albero: ogni contorno è figlio del contorno più vicino del livello precedente
            For lv = 1 To levels.Count - 1
                For Each nd In levels(lv)
                    Dim best As LoopNode = Nothing, bd = Double.MaxValue
                    Dim probe = nd.Points(0)
                    For Each par In levels(lv - 1)
                        Dim d = Poly.NearestVertex(par.Points, probe).Dist
                        If d < bd Then bd = d : best = par
                    Next
                    If best IsNot Nothing Then best.Children.Add(nd)
                Next
            Next

            Dim result As New List(Of PathSeg2D)()
            If levels.Count = 0 Then Return result
            Dim pos = If(startFrom.HasValue, startFrom.Value, levels(0)(0).Points(0))
            Dim hasPos = startFrom.HasValue
            Dim roots = levels(0)
            Do
                Dim nxt = NearestNode(roots, pos)
                If nxt Is Nothing Then Exit Do
                EmitNode(nxt, pos, hasPos, result, region, stepover)
            Loop
            Return result
        End Function

        Private Function NearestNode(nodes As List(Of LoopNode), pos As Vec2) As LoopNode
            Dim best As LoopNode = Nothing, bd = Double.MaxValue
            For Each n In nodes
                If n.Done Then Continue For
                Dim d = Poly.NearestVertex(n.Points, pos).Dist
                If d < bd Then bd = d : best = n
            Next
            Return best
        End Function

        Private Sub EmitNode(node As LoopNode, ByRef pos As Vec2, ByRef hasPos As Boolean,
                             result As List(Of PathSeg2D), region As Paths64, stepover As Double)
            node.Done = True
            ' prima i figli (più interni), il più vicino per primo
            Do
                Dim ch = NearestNode(node.Children, pos)
                If ch Is Nothing Then Exit Do
                EmitNode(ch, pos, hasPos, result, region, stepover)
            Loop
            Dim nv = Poly.NearestVertex(node.Points, pos)
            Dim pts As New List(Of Vec2)(node.Points.Count + 1)
            For i = 0 To node.Points.Count - 1
                pts.Add(node.Points((nv.Index + i) Mod node.Points.Count))
            Next
            pts.Add(pts(0))
            Dim link = LinkKind.Retract
            If hasPos AndAlso nv.Dist <= stepover * 1.6 + 0.001 AndAlso Poly.SegmentInside(region, pos, pts(0)) Then
                link = LinkKind.Direct
            End If
            result.Add(New PathSeg2D(pts, link))
            pos = pts(pts.Count - 1)
            hasPos = True
        End Sub

        ' ============================================================ ZIGZAG
        Private NotInheritable Class RowSeg
            Public Row As Integer
            Public XA As Double
            Public XB As Double
            Public Y As Double
            Public Used As Boolean
        End Class

        ''' <summary>
        ''' Passate parallele all'angolo indicato, collegate a zigzag quando il collegamento resta nella regione.
        ''' coverEdges: le righe estreme coincidono con i bordi (finitura); altrimenti sono a metà passo (con contornatura).
        ''' </summary>
        Public Function ZigZag(region As Paths64, stepover As Double, angleDeg As Double, coverEdges As Boolean) As List(Of PathSeg2D)
            Dim result As New List(Of PathSeg2D)()
            If region.Count = 0 Then Return result
            Dim a = angleDeg * Math.PI / 180
            Dim ca = Math.Cos(a), sa = Math.Sin(a)
            ' ruota la regione di -angolo: le passate diventano orizzontali
            Dim rot As New Paths64()
            For Each p In region
                Dim q As New Path64(p.Count)
                For Each pt In p
                    Dim x = pt.X / Poly.Scale, y = pt.Y / Poly.Scale
                    q.Add(Poly.ToPoint(New Vec2(x * ca + y * sa, -x * sa + y * ca)))
                Next
                rot.Add(q)
            Next
            Dim bb = Poly.Bounds(rot)
            Dim h = bb.MaxY - bb.MinY
            If h <= 0 Then Return result
            Dim n = Math.Max(1, CInt(Math.Ceiling(h / stepover - 0.000001)))
            Dim st = h / n
            Dim ys As New List(Of Double)()
            If coverEdges Then
                For i = 0 To n
                    ys.Add(Math.Min(bb.MaxY - 0.0005, Math.Max(bb.MinY + 0.0005, bb.MinY + i * st)))
                Next
            Else
                For i = 0 To n - 1
                    ys.Add(bb.MinY + (i + 0.5) * st)
                Next
            End If

            Dim lines As New Paths64()
            For Each y In ys
                lines.Add(Poly.ToPath({New Vec2(bb.MinX - 1, y), New Vec2(bb.MaxX + 1, y)}))
            Next
            Dim c As New Clipper64()
            c.AddOpenSubject(lines)
            c.AddClip(rot)
            Dim closedSol As New Paths64(), openSol As New Paths64()
            c.Execute(ClipType.Intersection, FillRule.NonZero, closedSol, openSol)

            Dim rows As New Dictionary(Of Integer, List(Of RowSeg))()
            For Each p In openSol
                If p.Count < 2 Then Continue For
                Dim x0 = p(0).X / Poly.Scale, x1 = p(p.Count - 1).X / Poly.Scale
                Dim y = p(0).Y / Poly.Scale
                If Math.Abs(x1 - x0) < 0.0001 Then Continue For
                ' riga di appartenenza
                Dim ri = 0, bd = Double.MaxValue
                For i = 0 To ys.Count - 1
                    Dim d = Math.Abs(ys(i) - y)
                    If d < bd Then bd = d : ri = i
                Next
                If Not rows.ContainsKey(ri) Then rows(ri) = New List(Of RowSeg)()
                rows(ri).Add(New RowSeg With {.Row = ri, .XA = Math.Min(x0, x1), .XB = Math.Max(x0, x1), .Y = ys(ri)})
            Next
            For Each r In rows.Values
                r.Sort(Function(p, q) p.XA.CompareTo(q.XA))
            Next
            Dim rowIds = rows.Keys.OrderBy(Function(x) x).ToList()

            Dim chains As New List(Of (Pts As List(Of Vec2), Link As LinkKind))()
            Dim pos As New Vec2(bb.MinX, bb.MinY)
            Do
                ' partenza: prima riga con segmenti liberi, estremo più vicino
                Dim start As RowSeg = Nothing, startFromB = False, bd = Double.MaxValue
                For Each ri In rowIds
                    For Each s In rows(ri)
                        If s.Used Then Continue For
                        Dim da = Vec2.Distance(pos, New Vec2(s.XA, s.Y)), db = Vec2.Distance(pos, New Vec2(s.XB, s.Y))
                        If da < bd Then bd = da : start = s : startFromB = False
                        If db < bd Then bd = db : start = s : startFromB = True
                    Next
                    If start IsNot Nothing Then Exit For
                Next
                If start Is Nothing Then Exit Do

                Dim chain As New List(Of Vec2)()
                Dim curSeg = start, fromB = startFromB
                Dim chainLink = LinkKind.Retract
                Dim firstPt = New Vec2(If(fromB, curSeg.XB, curSeg.XA), curSeg.Y)
                If chains.Count > 0 AndAlso Vec2.Distance(pos, firstPt) <= stepover * 3 + 0.001 AndAlso
                   Poly.SegmentInside(rot, pos, firstPt) Then chainLink = LinkKind.Direct
                Do
                    curSeg.Used = True
                    Dim p0 = New Vec2(If(fromB, curSeg.XB, curSeg.XA), curSeg.Y)
                    Dim p1 = New Vec2(If(fromB, curSeg.XA, curSeg.XB), curSeg.Y)
                    chain.Add(p0) : chain.Add(p1)
                    pos = p1
                    ' prossima riga: segmento libero sovrapposto in x, estremo più vicino
                    Dim nextRow = curSeg.Row + 1
                    Dim cand As RowSeg = Nothing, cb = Double.MaxValue, candFromB = False
                    Dim list As List(Of RowSeg) = Nothing
                    If rows.TryGetValue(nextRow, list) Then
                        For Each s In list
                            If s.Used Then Continue For
                            If s.XB < curSeg.XA - 0.000001 OrElse s.XA > curSeg.XB + 0.000001 Then Continue For
                            Dim da = Vec2.Distance(pos, New Vec2(s.XA, s.Y)), db = Vec2.Distance(pos, New Vec2(s.XB, s.Y))
                            If da < cb Then cb = da : cand = s : candFromB = False
                            If db < cb Then cb = db : cand = s : candFromB = True
                        Next
                    End If
                    If cand Is Nothing Then Exit Do
                    Dim nstart = New Vec2(If(candFromB, cand.XB, cand.XA), cand.Y)
                    If cb > stepover * 3 + 0.001 OrElse Not Poly.SegmentInside(rot, pos, nstart) Then Exit Do
                    curSeg = cand : fromB = candFromB
                Loop
                chains.Add((chain, chainLink))
            Loop

            ' ruota indietro
            For Each ch In chains
                Dim pts As New List(Of Vec2)(ch.Pts.Count)
                For Each p In ch.Pts
                    pts.Add(New Vec2(p.X * ca - p.Y * sa, p.X * sa + p.Y * ca))
                Next
                result.Add(New PathSeg2D(pts, ch.Link))
            Next
            Return result
        End Function

        ''' <summary>Contorni della regione come tratti chiusi (orientati per fresatura concorde se climb).</summary>
        Public Function Contours(region As Paths64, climb As Boolean, ByRef pos As Vec2, ByRef hasPos As Boolean,
                                 stepover As Double) As List(Of PathSeg2D)
            Dim res As New List(Of PathSeg2D)()
            Dim loops = Poly.ToLoops(region)
            If Not climb Then
                For Each l In loops
                    l.Reverse()
                Next
            End If
            Dim done(loops.Count - 1) As Boolean
            For c = 0 To loops.Count - 1
                Dim bi = -1, bd = Double.MaxValue, bv = 0
                For i = 0 To loops.Count - 1
                    If done(i) OrElse loops(i).Count < 3 Then Continue For
                    Dim nv = Poly.NearestVertex(loops(i), pos)
                    If nv.Dist < bd Then bd = nv.Dist : bi = i : bv = nv.Index
                Next
                If bi < 0 Then Exit For
                done(bi) = True
                Dim l = loops(bi)
                Dim pts As New List(Of Vec2)(l.Count + 1)
                For i = 0 To l.Count - 1
                    pts.Add(l((bv + i) Mod l.Count))
                Next
                pts.Add(pts(0))
                Dim link = LinkKind.Retract
                If hasPos AndAlso bd <= stepover * 1.6 + 0.001 AndAlso Poly.SegmentInside(region, pos, pts(0)) Then link = LinkKind.Direct
                res.Add(New PathSeg2D(pts, link))
                pos = pts(pts.Count - 1) : hasPos = True
            Next
            Return res
        End Function

    End Module

End Namespace
