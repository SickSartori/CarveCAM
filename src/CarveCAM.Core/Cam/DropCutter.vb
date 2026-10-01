Imports CarveCAM.Core.Geometry

Namespace Cam

    ''' <summary>Triangolo in coordinate locali del piano (u,v,w) con dati precalcolati.</summary>
    Public Structure LocalTri
        Public A As Vec3
        Public B As Vec3
        Public C As Vec3
        Public MinU As Double
        Public MaxU As Double
        Public MinV As Double
        Public MaxV As Double
        Public MaxW As Double
        ''' <summary>Normale unitaria orientata verso +w.</summary>
        Public Nx As Double
        Public Ny As Double
        Public Nz As Double
        ''' <summary>Gradiente del piano del triangolo: dw/du, dw/dv (valido se HasFacet).</summary>
        Public Gu As Double
        Public Gv As Double
        Public HasFacet As Boolean

        Public Sub New(a As Vec3, b As Vec3, c As Vec3)
            Me.A = a : Me.B = b : Me.C = c
            MinU = Math.Min(a.X, Math.Min(b.X, c.X)) : MaxU = Math.Max(a.X, Math.Max(b.X, c.X))
            MinV = Math.Min(a.Y, Math.Min(b.Y, c.Y)) : MaxV = Math.Max(a.Y, Math.Max(b.Y, c.Y))
            MaxW = Math.Max(a.Z, Math.Max(b.Z, c.Z))
            Dim n = (b - a).Cross(c - a)
            Dim l = n.Length
            If l > 0 Then n = n / l
            If n.Z < 0 Then n = -n
            Nx = n.X : Ny = n.Y : Nz = n.Z
            HasFacet = Nz > 0.000000001
            If HasFacet Then
                Gu = -Nx / Nz : Gv = -Ny / Nz
            End If
        End Sub
    End Structure

    Public Enum CutterKind
        Flat
        Ball
        Bull
        ''' <summary>Profilo di rivoluzione generico (fresa conica): altezza del tagliente in funzione del raggio.</summary>
        Profile
    End Enum

    ''' <summary>
    ''' "Drop cutter": dato un punto (u,v) del piano, calcola la quota w più alta della punta utensile
    ''' (asse lungo la normale del piano) alla quale l'utensile tocca il modello scendendo dall'alto.
    ''' Supporta fresa cilindrica (flat), sferica (ball), torica (bull: fondo piatto di raggio R-r
    ''' raccordato con un toro di raggio r) e conica (profile: profilo convesso qualsiasi, per punti). Il
    ''' sovrametallo viene gestito come utensile maggiorato (offset del profilo di s) e punta sollevata di s.
    ''' Thread-safe in lettura: può essere interrogato in parallelo.
    ''' </summary>
    Public NotInheritable Class DropCutter
        Private ReadOnly _tris As LocalTri()
        Private ReadOnly _cellStart As Integer()
        Private ReadOnly _items As Integer()
        Private ReadOnly _u0 As Double, _v0 As Double, _cs As Double
        Private ReadOnly _nu As Integer, _nv As Integer
        Private ReadOnly _re As Double, _re2 As Double
        ' fresa torica: raggio della parte piatta e raggio del toro (con sovrametallo)
        Private ReadOnly _rf As Double, _rc As Double, _rc2 As Double
        ' profilo generico: tratti esatti (segmenti e archi) in funzione del raggio, abbassamento extra della punta
        Private ReadOnly _pieces As ProfPiece()
        Private ReadOnly _drop As Double

        Public ReadOnly Property Radius As Double

        ''' <summary>
        ''' Scala dei dettagli della forma, per i passi di campionamento: il raggio per le frese cilindrica, torica e
        ''' sferica; per la conica il raggio della punta (almeno 0,2 mm per la punta a V).
        ''' </summary>
        Public ReadOnly Property DetailRadius As Double
        Public ReadOnly Property CornerRadius As Double
        Public ReadOnly Property Stock As Double
        Public ReadOnly Property Kind As CutterKind

        Public ReadOnly Property IsBall As Boolean
            Get
                Return Kind = CutterKind.Ball
            End Get
        End Property

        Public ReadOnly Property TriangleCount As Integer
            Get
                Return _tris.Length
            End Get
        End Property

        ''' <summary>Quota massima (w) dei triangoli indicizzati; -inf se vuoto.</summary>
        Public ReadOnly Property MaxW As Double

        Public Sub New(tris As List(Of LocalTri), radius As Double, stock As Double, isBall As Boolean)
            Me.New(tris, radius, If(isBall, radius, 0), stock, If(isBall, CutterKind.Ball, CutterKind.Flat))
        End Sub

        ''' <summary>Crea il drop-cutter per un utensile, eventualmente ridotto di <paramref name="shrink"/> in tutte le direzioni.</summary>
        Public Shared Function ForTool(tris As List(Of LocalTri), tool As Model.ToolDef, stock As Double, Optional shrink As Double = 0) As DropCutter
            If tool.IsTaper Then
                ' riduzione per la verifica: si toglie prima dal sovrametallo, il resto abbassa la punta
                Dim s = Math.Max(0, stock - shrink)
                Return New DropCutter(tris, TaperPieces(tool), s, Math.Max(0, shrink - Math.Max(0, stock)))
            End If
            Dim r = Math.Max(tool.Radius * 0.5, tool.Radius - shrink)
            If tool.IsBall Then Return New DropCutter(tris, r, r, stock, CutterKind.Ball)
            If tool.IsBull Then
                Dim cr = tool.EffectiveCorner - shrink
                If cr > 0.000001 Then Return New DropCutter(tris, r, cr, stock, CutterKind.Bull)
            End If
            Return New DropCutter(tris, r, 0, stock, CutterKind.Flat)
        End Function

        ''' <summary>
        ''' Tratto del profilo di una fresa di rivoluzione, per raggi q in [Q0, Q1]: segmento (altezza H0 in Q0 e
        ''' pendenza Slope) oppure arco della metà inferiore di un cerchio (centro Cq, Ch e raggio Rr).
        ''' </summary>
        Public Structure ProfPiece
            Public Q0 As Double, Q1 As Double
            Public IsArc As Boolean
            Public H0 As Double, Slope As Double
            Public Cq As Double, Ch As Double, Rr As Double

            Public Shared Function Line(q0 As Double, h0 As Double, q1 As Double, h1 As Double) As ProfPiece
                Return New ProfPiece With {.Q0 = q0, .Q1 = q1, .H0 = h0, .Slope = (h1 - h0) / Math.Max(0.000000000001, q1 - q0)}
            End Function

            Public Shared Function Arc(cq As Double, ch As Double, rr As Double, q0 As Double, q1 As Double) As ProfPiece
                Return New ProfPiece With {.IsArc = True, .Cq = cq, .Ch = ch, .Rr = rr, .Q0 = q0, .Q1 = q1}
            End Function

            Public Function H(q As Double) As Double
                If Not IsArc Then Return H0 + Slope * (q - Q0)
                Dim d = q - Cq
                Return Ch - Math.Sqrt(Math.Max(0, Rr * Rr - d * d))
            End Function

            ''' <summary>Pendenza dh/dq in q (infinita dove l'arco è verticale).</summary>
            Public Function SlopeAt(q As Double) As Double
                If Not IsArc Then Return Slope
                Dim d = q - Cq
                Dim r2 = Rr * Rr - d * d
                Return If(r2 <= 1.0E-18, Double.PositiveInfinity, d / Math.Sqrt(r2))
            End Function

            ''' <summary>Normale esterna (verso il basso e l'esterno) in q.</summary>
            Public Function Normal(q As Double) As (Nq As Double, Nh As Double)
                If IsArc Then Return ((q - Cq) / Rr, (H(q) - Ch) / Rr)
                Dim l = Math.Sqrt(1 + Slope * Slope)
                Return (Slope / l, -1 / l)
            End Function
        End Structure

        ''' <summary>Profilo della fresa conica (dalla punta): punta sferica + cono tangente, oppure punta piatta/a V + cono.</summary>
        Public Shared Function TaperPieces(tool As Model.ToolDef) As List(Of ProfPiece)
            Dim rt = Math.Max(0, tool.Radius), lc = tool.ConeHeight, tn = tool.TaperTan
            Dim res As New List(Of ProfPiece)()
            If tool.TipIsBall Then
                Dim a = Math.Atan(tn)
                Dim q0 = rt * Math.Cos(a), h0 = rt * (1 - Math.Sin(a))
                If lc <= h0 Then
                    res.Add(ProfPiece.Arc(0, rt, rt, 0, Math.Sqrt(Math.Max(0, rt * rt - (rt - lc) * (rt - lc)))))
                Else
                    res.Add(ProfPiece.Arc(0, rt, rt, 0, q0))
                    res.Add(ProfPiece.Line(q0, h0, q0 + (lc - h0) * tn, lc))
                End If
            Else
                If rt > 0.000000001 Then res.Add(ProfPiece.Line(0, 0, rt, 0))
                res.Add(ProfPiece.Line(rt, 0, rt + lc * tn, lc))
            End If
            Return res
        End Function

        ''' <summary>
        ''' Profilo maggiorato del sovrametallo s (offset esatto): i segmenti si spostano lungo la normale, gli archi
        ''' crescono di s e negli spigoli (punta compresa) si aggiungono archi di raggio s. Altezze riferite alla
        ''' punta maggiorata (quota 0).
        ''' </summary>
        Private Shared Function OffsetPieces(base As List(Of ProfPiece), s As Double) As ProfPiece()
            Dim res As New List(Of ProfPiece)()
            Dim joint = Sub(jq As Double, jh As Double, n1 As (Nq As Double, Nh As Double), n2 As (Nq As Double, Nh As Double))
                            If s <= 0 OrElse Math.Abs(n1.Nq - n2.Nq) + Math.Abs(n1.Nh - n2.Nh) < 0.000000001 Then Return
                            Dim q0 = jq + s * n1.Nq, q1 = jq + s * n2.Nq
                            If q1 > q0 + 0.000000000001 Then res.Add(ProfPiece.Arc(jq, jh, s, q0, q1))
                        End Sub
            ' in punta la normale esterna è verso il basso (profilo simmetrico rispetto all'asse)
            Dim prevN As (Nq As Double, Nh As Double) = (0.0, -1.0)
            For Each pc In base
                Dim n0 = pc.Normal(pc.Q0), n1 = pc.Normal(pc.Q1)
                joint(pc.Q0, pc.H(pc.Q0), prevN, n0)
                If pc.IsArc Then
                    Dim rr = pc.Rr + s
                    res.Add(ProfPiece.Arc(pc.Cq, pc.Ch, rr, pc.Q0 + s * n0.Nq, pc.Q1 + s * n1.Nq))
                Else
                    res.Add(ProfPiece.Line(pc.Q0 + s * n0.Nq, pc.H(pc.Q0) + s * n0.Nh, pc.Q1 + s * n1.Nq, pc.H(pc.Q1) + s * n1.Nh))
                End If
                prevN = n1
            Next
            ' quota 0 sulla punta maggiorata
            For i = 0 To res.Count - 1
                Dim pc = res(i)
                If pc.IsArc Then pc.Ch += s Else pc.H0 += s
                res(i) = pc
            Next
            Return res.ToArray()
        End Function

        ''' <summary>Fresa a profilo (conica): tratti convessi e crescenti dalla punta.</summary>
        Public Sub New(tris As List(Of LocalTri), base As List(Of ProfPiece), stock As Double, Optional drop As Double = 0)
            Me.Kind = CutterKind.Profile
            Me.Stock = Math.Max(0, stock)
            _drop = Math.Max(0, drop)
            _pieces = OffsetPieces(base, Me.Stock)
            Me.Radius = base(base.Count - 1).Q1
            Dim tip = If(base(0).IsArc, base(0).Rr, If(Math.Abs(base(0).Slope) < 0.000000001, base(0).Q1, 0.0))
            Me.DetailRadius = Math.Max(0.2, tip)
            Me.CornerRadius = 0
            _re = _pieces(_pieces.Length - 1).Q1
            _re2 = _re * _re
            _tris = tris.ToArray()
            MaxW = Double.NegativeInfinity
            BuildIndex(_tris, _re, _nu, _nv, _cs, _u0, _v0, _cellStart, _items, MaxW)
        End Sub

        ''' <summary>Altezza del profilo maggiorato a distanza q dall'asse (esatta).</summary>
        Private Function ProfH(q As Double) As Double
            For i = 0 To _pieces.Length - 1
                If q <= _pieces(i).Q1 Then Return _pieces(i).H(Math.Max(q, _pieces(i).Q0))
            Next
            Dim last = _pieces(_pieces.Length - 1)
            Return last.H(last.Q1)
        End Function

        ''' <summary>Raggio in cui la pendenza del profilo raggiunge g (punto di contatto con un piano di pendenza g).</summary>
        Private Function ProfTangentQ(g As Double) As Double
            For i = 0 To _pieces.Length - 1
                Dim pc = _pieces(i)
                If pc.SlopeAt(pc.Q1) < g Then Continue For
                If pc.SlopeAt(pc.Q0) >= g Then Return pc.Q0
                ' arco: h'(q) = d / sqrt(r² - d²) = g  =>  d = r·g / sqrt(1 + g²)
                Return Math.Min(pc.Q1, pc.Cq + pc.Rr * g / Math.Sqrt(1 + g * g))
            Next
            Return _pieces(_pieces.Length - 1).Q1
        End Function

        Public Sub New(tris As List(Of LocalTri), radius As Double, cornerRadius As Double, stock As Double, kind As CutterKind)
            Me.Radius = radius
            Me.DetailRadius = radius
            Me.Stock = Math.Max(0, stock)
            Dim cr = Math.Max(0, Math.Min(cornerRadius, radius))
            If kind = CutterKind.Bull AndAlso cr >= radius - 0.000000001 Then kind = CutterKind.Ball
            If kind = CutterKind.Bull AndAlso cr <= 0.000000001 Then kind = CutterKind.Flat
            If kind = CutterKind.Ball Then cr = radius
            If kind = CutterKind.Flat Then cr = 0
            Me.Kind = kind
            Me.CornerRadius = cr
            _re = radius + Me.Stock
            _re2 = _re * _re
            _rf = radius - cr
            _rc = cr + Me.Stock
            _rc2 = _rc * _rc
            _tris = tris.ToArray()
            MaxW = Double.NegativeInfinity
            BuildIndex(_tris, _re, _nu, _nv, _cs, _u0, _v0, _cellStart, _items, MaxW)
        End Sub

        ''' <summary>Griglia di celle (formato CSR) dei triangoli, ordinati per quota massima decrescente in ogni cella.</summary>
        Private Shared Sub BuildIndex(tris As LocalTri(), re As Double, ByRef nu As Integer, ByRef nv As Integer, ByRef cs As Double,
                                      ByRef u0 As Double, ByRef v0 As Double, ByRef cellStart As Integer(), ByRef items As Integer(), ByRef maxW As Double)
            maxW = Double.NegativeInfinity
            If tris.Length = 0 Then
                nu = 1 : nv = 1 : cs = 1
                cellStart = {0, 0}
                items = Array.Empty(Of Integer)()
                Return
            End If
            Dim minU = Double.MaxValue, minV = Double.MaxValue, maxU = Double.MinValue, maxV = Double.MinValue
            For Each t In tris
                minU = Math.Min(minU, t.MinU) : maxU = Math.Max(maxU, t.MaxU)
                minV = Math.Min(minV, t.MinV) : maxV = Math.Max(maxV, t.MaxV)
                maxW = Math.Max(maxW, t.MaxW)
            Next
            Dim ext = Math.Max(maxU - minU, 0.001) * Math.Max(maxV - minV, 0.001)
            Dim c0 = Math.Max(Math.Max(re * 0.5, 0.05), Math.Sqrt(ext / 4000000.0))
            Dim uu0 = minU - c0, vv0 = minV - c0
            Dim nnu = CInt(Math.Floor((maxU - uu0) / c0)) + 2
            Dim nnv = CInt(Math.Floor((maxV - vv0) / c0)) + 2
            Dim cu = Function(u As Double) Math.Max(0, Math.Min(nnu - 1, CInt(Math.Floor((u - uu0) / c0))))
            Dim cv = Function(v As Double) Math.Max(0, Math.Min(nnv - 1, CInt(Math.Floor((v - vv0) / c0))))

            ' griglia CSR: conteggio, prefissi, riempimento
            Dim counts(nnu * nnv) As Integer
            For Each t In tris
                Dim i0 = cu(t.MinU), i1 = cu(t.MaxU), j0 = cv(t.MinV), j1 = cv(t.MaxV)
                For j = j0 To j1
                    For i = i0 To i1
                        counts(j * nnu + i) += 1
                    Next
                Next
            Next
            Dim starts = New Integer(nnu * nnv) {}
            Dim acc = 0
            For c = 0 To nnu * nnv - 1
                starts(c) = acc
                acc += counts(c)
            Next
            starts(nnu * nnv) = acc
            Dim its = New Integer(acc - 1) {}
            Dim fill(nnu * nnv - 1) As Integer
            For k = 0 To tris.Length - 1
                Dim i0 = cu(tris(k).MinU), i1 = cu(tris(k).MaxU), j0 = cv(tris(k).MinV), j1 = cv(tris(k).MaxV)
                For j = j0 To j1
                    For i = i0 To i1
                        Dim c = j * nnu + i
                        its(starts(c) + fill(c)) = k
                        fill(c) += 1
                    Next
                Next
            Next
            ' ordina ogni cella per quota massima decrescente: permette l'uscita anticipata
            Dim cmp As Comparison(Of Integer) = Function(x, y) tris(y).MaxW.CompareTo(tris(x).MaxW)
            For c = 0 To nnu * nnv - 1
                Dim len = starts(c + 1) - starts(c)
                If len > 1 Then Array.Sort(its, starts(c), len, Comparer(Of Integer).Create(cmp))
            Next
            nu = nnu : nv = nnv : cs = c0 : u0 = uu0 : v0 = vv0
            cellStart = starts : items = its
        End Sub

        Private Function CellU(u As Double) As Integer
            Return Math.Max(0, Math.Min(_nu - 1, CInt(Math.Floor((u - _u0) / _cs))))
        End Function

        Private Function CellV(v As Double) As Integer
            Return Math.Max(0, Math.Min(_nv - 1, CInt(Math.Floor((v - _v0) / _cs))))
        End Function

        ''' <summary>Quota punta utensile in (u,v); ritorna almeno <paramref name="floor"/>.</summary>
        Public Function Contact(u As Double, v As Double, floor As Double) As Double
            Dim best = floor - Stock + _drop
            If _tris.Length = 0 Then Return floor
            Dim re = _re
            Dim i0 = CellU(u - re), i1 = CellU(u + re), j0 = CellV(v - re), j1 = CellV(v + re)
            For j = j0 To j1
                For i = i0 To i1
                    Dim c = j * _nu + i
                    For k = _cellStart(c) To _cellStart(c + 1) - 1
                        Dim ti = _items(k)
                        If _tris(ti).MaxW <= best Then Exit For
                        If _tris(ti).MaxU < u - re OrElse _tris(ti).MinU > u + re OrElse
                           _tris(ti).MaxV < v - re OrElse _tris(ti).MinV > v + re Then Continue For
                        If Kind = CutterKind.Profile Then
                            ' scarto anticipato: a distanza q dall'asse il tagliente è già alto h(q); il triangolo
                            ' non può alzare la punta oltre MaxW - h(distanza minima del suo ingombro)
                            Dim du = Math.Max(0, Math.Max(_tris(ti).MinU - u, u - _tris(ti).MaxU))
                            Dim dv = Math.Max(0, Math.Max(_tris(ti).MinV - v, v - _tris(ti).MaxV))
                            Dim dq = Math.Sqrt(du * du + dv * dv)
                            If dq > re OrElse _tris(ti).MaxW - ProfH(dq) <= best Then Continue For
                        End If
                        Dim w As Double
                        Select Case Kind
                            Case CutterKind.Flat : w = FlatTri(_tris(ti), u, v)
                            Case CutterKind.Ball : w = BallTri(_tris(ti), u, v)
                            Case CutterKind.Bull : w = BullTri(_tris(ti), u, v, best)
                            Case Else : w = ProfTri(_tris(ti), u, v, best)
                        End Select
                        If w > best Then best = w
                    Next
                Next
            Next
            Return best + Stock - _drop
        End Function

        Private Shared Function InTri(pu As Double, pv As Double, ByRef t As LocalTri) As Boolean
            Dim d1 = (t.B.X - t.A.X) * (pv - t.A.Y) - (t.B.Y - t.A.Y) * (pu - t.A.X)
            Dim d2 = (t.C.X - t.B.X) * (pv - t.B.Y) - (t.C.Y - t.B.Y) * (pu - t.B.X)
            Dim d3 = (t.A.X - t.C.X) * (pv - t.C.Y) - (t.A.Y - t.C.Y) * (pu - t.C.X)
            Dim hasNeg = d1 < 0 OrElse d2 < 0 OrElse d3 < 0
            Dim hasPos = d1 > 0 OrElse d2 > 0 OrElse d3 > 0
            Return Not (hasNeg AndAlso hasPos)
        End Function

        ' ------------------------------------------------------------ fresa cilindrica
        Private Function FlatTri(ByRef t As LocalTri, u As Double, v As Double) As Double
            If t.HasFacet Then
                ' punto più alto del piano entro il disco: spostato di R lungo il gradiente
                Dim gl = Math.Sqrt(t.Gu * t.Gu + t.Gv * t.Gv)
                Dim cu = u, cv = v
                If gl > 0.000000000001 Then
                    cu = u + _re * t.Gu / gl : cv = v + _re * t.Gv / gl
                End If
                If InTri(cu, cv, t) Then
                    Return t.A.Z + t.Gu * (cu - t.A.X) + t.Gv * (cv - t.A.Y)
                End If
            End If
            Dim best = Double.NegativeInfinity
            best = Math.Max(best, FlatEdge(t.A, t.B, u, v))
            best = Math.Max(best, FlatEdge(t.B, t.C, u, v))
            best = Math.Max(best, FlatEdge(t.C, t.A, u, v))
            Return best
        End Function

        Private Function FlatEdge(p As Vec3, q As Vec3, u As Double, v As Double) As Double
            Dim dx = q.X - p.X, dy = q.Y - p.Y
            Dim l2 = dx * dx + dy * dy
            Dim fx = p.X - u, fy = p.Y - v
            If l2 < 1.0E-24 Then
                Return If(fx * fx + fy * fy <= _re2, Math.Max(p.Z, q.Z), Double.NegativeInfinity)
            End If
            Dim b = dx * fx + dy * fy
            Dim cc = fx * fx + fy * fy - _re2
            Dim disc = b * b - l2 * cc
            If disc < 0 Then Return Double.NegativeInfinity
            Dim sq = Math.Sqrt(disc)
            Dim t1 = (-b - sq) / l2, t2 = (-b + sq) / l2
            If t2 < 0 OrElse t1 > 1 Then Return Double.NegativeInfinity
            t1 = Math.Max(t1, 0) : t2 = Math.Min(t2, 1)
            Dim dz = q.Z - p.Z
            Return Math.Max(p.Z + t1 * dz, p.Z + t2 * dz)
        End Function

        ' ------------------------------------------------------------ fresa sferica
        Private Function BallTri(ByRef t As LocalTri, u As Double, v As Double) As Double
            If t.HasFacet Then
                Dim cu = u - _re * t.Nx, cv = v - _re * t.Ny
                If InTri(cu, cv, t) Then
                    Dim wc = t.A.Z + t.Gu * (cu - t.A.X) + t.Gv * (cv - t.A.Y)
                    Return wc + _re * t.Nz - _re
                End If
            End If
            Dim best = Double.NegativeInfinity
            best = Math.Max(best, BallVertex(t.A, u, v))
            best = Math.Max(best, BallVertex(t.B, u, v))
            best = Math.Max(best, BallVertex(t.C, u, v))
            best = Math.Max(best, BallEdge(t.A, t.B, u, v))
            best = Math.Max(best, BallEdge(t.B, t.C, u, v))
            best = Math.Max(best, BallEdge(t.C, t.A, u, v))
            Return best
        End Function

        Private Function BallVertex(p As Vec3, u As Double, v As Double) As Double
            Dim dx = p.X - u, dy = p.Y - v
            Dim d2 = dx * dx + dy * dy
            If d2 > _re2 Then Return Double.NegativeInfinity
            Return p.Z + Math.Sqrt(_re2 - d2) - _re
        End Function

        Private Function BallEdge(p As Vec3, q As Vec3, u As Double, v As Double) As Double
            Dim dx = q.X - p.X, dy = q.Y - p.Y
            Dim luv = Math.Sqrt(dx * dx + dy * dy)
            If luv < 0.000000000001 Then Return Double.NegativeInfinity
            Dim ex = dx / luv, ey = dy / luv
            Dim ru = u - p.X, rv = v - p.Y
            Dim s0 = ru * ex + rv * ey
            Dim dp = -ru * ey + rv * ex
            Dim dp2 = dp * dp
            If dp2 > _re2 Then Return Double.NegativeInfinity
            Dim rp = Math.Sqrt(_re2 - dp2)
            Dim m = (q.Z - p.Z) / luv
            Dim k = Math.Sqrt(1 + m * m)
            Dim sc = s0 + rp * m / k
            If sc < 0 OrElse sc > luv Then Return Double.NegativeInfinity
            Return p.Z + m * sc + rp / k - _re
        End Function

        ' ------------------------------------------------------------ fresa torica
        ''' <summary>Abbassamento della punta rispetto al punto toccato a distanza orizzontale q dall'asse (0 sul fondo piatto).</summary>
        Private Function BullH(q As Double) As Double
            If q <= _rf Then Return 0
            Dim dq = q - _rf
            Return Math.Sqrt(Math.Max(0, _rc2 - dq * dq)) - _rc
        End Function

        Private Function BullTri(ByRef t As LocalTri, u As Double, v As Double, best As Double) As Double
            If t.HasFacet Then
                ' contatto sul piano: centro del tubo spostato di Rf verso valle, poi -r lungo la normale
                Dim cu = u - _rc * t.Nx, cv = v - _rc * t.Ny
                Dim nxy = Math.Sqrt(t.Nx * t.Nx + t.Ny * t.Ny)
                If nxy > 0.000000000001 Then
                    cu -= _rf * t.Nx / nxy : cv -= _rf * t.Ny / nxy
                End If
                If InTri(cu, cv, t) Then
                    Dim wc = t.A.Z + t.Gu * (cu - t.A.X) + t.Gv * (cv - t.A.Y)
                    Return wc + _rc * t.Nz - _rc
                End If
            End If
            Dim res = Double.NegativeInfinity
            res = Math.Max(res, BullVertex(t.A, u, v))
            res = Math.Max(res, BullVertex(t.B, u, v))
            res = Math.Max(res, BullVertex(t.C, u, v))
            ' uno spigolo non può dare un contatto più alto del suo estremo più alto
            If Math.Max(t.A.Z, t.B.Z) > Math.Max(best, res) Then res = Math.Max(res, BullEdge(t.A, t.B, u, v))
            If Math.Max(t.B.Z, t.C.Z) > Math.Max(best, res) Then res = Math.Max(res, BullEdge(t.B, t.C, u, v))
            If Math.Max(t.C.Z, t.A.Z) > Math.Max(best, res) Then res = Math.Max(res, BullEdge(t.C, t.A, u, v))
            Return res
        End Function

        Private Function BullVertex(p As Vec3, u As Double, v As Double) As Double
            Dim dx = p.X - u, dy = p.Y - v
            Dim d2 = dx * dx + dy * dy
            If d2 > _re2 Then Return Double.NegativeInfinity
            Return p.Z + BullH(Math.Sqrt(d2))
        End Function

        ''' <summary>
        ''' Contatto con uno spigolo: massimo su t di f(t) = z(t) + H(q(t)). La distanza dall'asse q(t) è convessa e
        ''' H è concava non crescente, quindi f è concava: la sezione aurea converge al massimo globale.
        ''' </summary>
        Private Function BullEdge(p As Vec3, q As Vec3, u As Double, v As Double) As Double
            Dim dx = q.X - p.X, dy = q.Y - p.Y, dz = q.Z - p.Z
            Dim l2 = dx * dx + dy * dy
            If l2 < 1.0E-24 Then Return Double.NegativeInfinity
            Dim fx = p.X - u, fy = p.Y - v
            Dim b = dx * fx + dy * fy
            Dim cc = fx * fx + fy * fy - _re2
            Dim disc = b * b - l2 * cc
            If disc < 0 Then Return Double.NegativeInfinity
            Dim sq = Math.Sqrt(disc)
            Dim t1 = Math.Max(0, (-b - sq) / l2), t2 = Math.Min(1, (-b + sq) / l2)
            If t1 > t2 Then Return Double.NegativeInfinity
            Const G = 0.6180339887498949
            Dim a = t1, c = t2
            Dim x1 = c - G * (c - a), x2 = a + G * (c - a)
            Dim f1 = BullEdgeF(p.Z, dz, fx, fy, dx, dy, x1), f2 = BullEdgeF(p.Z, dz, fx, fy, dx, dy, x2)
            For it = 1 To 48
                If c - a < 0.0000000001 Then Exit For
                If f1 < f2 Then
                    a = x1 : x1 = x2 : f1 = f2
                    x2 = a + G * (c - a) : f2 = BullEdgeF(p.Z, dz, fx, fy, dx, dy, x2)
                Else
                    c = x2 : x2 = x1 : f2 = f1
                    x1 = c - G * (c - a) : f1 = BullEdgeF(p.Z, dz, fx, fy, dx, dy, x1)
                End If
            Next
            Return Math.Max(Math.Max(f1, f2), Math.Max(BullEdgeF(p.Z, dz, fx, fy, dx, dy, t1), BullEdgeF(p.Z, dz, fx, fy, dx, dy, t2)))
        End Function

        Private Function BullEdgeF(z0 As Double, dz As Double, fx As Double, fy As Double, dx As Double, dy As Double, t As Double) As Double
            Dim ex = fx + t * dx, ey = fy + t * dy
            Return z0 + t * dz + BullH(Math.Min(_re, Math.Sqrt(ex * ex + ey * ey)))
        End Function

        ' ------------------------------------------------------------ fresa a profilo (conica)
        Private Function ProfTri(ByRef t As LocalTri, u As Double, v As Double, best As Double) As Double
            If t.HasFacet Then
                ' contatto sul piano: il punto del profilo dove la pendenza del tagliente supera quella del piano
                Dim g = Math.Sqrt(t.Gu * t.Gu + t.Gv * t.Gv)
                Dim qs = If(g > 0.000000000001, ProfTangentQ(g), 0.0)
                Dim cu = u, cv = v
                If g > 0.000000000001 Then cu = u + qs * t.Gu / g : cv = v + qs * t.Gv / g
                If InTri(cu, cv, t) Then
                    Return t.A.Z + t.Gu * (cu - t.A.X) + t.Gv * (cv - t.A.Y) - ProfH(qs)
                End If
            End If
            Dim res = Double.NegativeInfinity
            res = Math.Max(res, ProfVertex(t.A, u, v))
            res = Math.Max(res, ProfVertex(t.B, u, v))
            res = Math.Max(res, ProfVertex(t.C, u, v))
            ' uno spigolo non dà un contatto più alto del suo estremo più alto meno h(distanza minima dall'asse)
            If EdgeBound(t.A, t.B, u, v) > Math.Max(best, res) Then res = Math.Max(res, ProfEdge(t.A, t.B, u, v))
            If EdgeBound(t.B, t.C, u, v) > Math.Max(best, res) Then res = Math.Max(res, ProfEdge(t.B, t.C, u, v))
            If EdgeBound(t.C, t.A, u, v) > Math.Max(best, res) Then res = Math.Max(res, ProfEdge(t.C, t.A, u, v))
            Return res
        End Function

        Private Function EdgeBound(p As Vec3, q As Vec3, u As Double, v As Double) As Double
            Dim dx = q.X - p.X, dy = q.Y - p.Y
            Dim l2 = dx * dx + dy * dy
            Dim tt = If(l2 > 1.0E-24, Math.Max(0, Math.Min(1, ((u - p.X) * dx + (v - p.Y) * dy) / l2)), 0)
            Dim ex = p.X + tt * dx - u, ey = p.Y + tt * dy - v
            Dim d = Math.Sqrt(ex * ex + ey * ey)
            If d > _re Then Return Double.NegativeInfinity
            Return Math.Max(p.Z, q.Z) - ProfH(d)
        End Function

        Private Function ProfVertex(p As Vec3, u As Double, v As Double) As Double
            Dim dx = p.X - u, dy = p.Y - v
            Dim d2 = dx * dx + dy * dy
            If d2 > _re2 Then Return Double.NegativeInfinity
            Return p.Z - ProfH(Math.Sqrt(d2))
        End Function

        ''' <summary>Contatto con uno spigolo: f(t) = z(t) - h(q(t)) è concava (profilo convesso), sezione aurea.</summary>
        Private Function ProfEdge(p As Vec3, q As Vec3, u As Double, v As Double) As Double
            Dim dx = q.X - p.X, dy = q.Y - p.Y, dz = q.Z - p.Z
            Dim l2 = dx * dx + dy * dy
            If l2 < 1.0E-24 Then Return Double.NegativeInfinity
            Dim fx = p.X - u, fy = p.Y - v
            Dim b = dx * fx + dy * fy
            Dim cc = fx * fx + fy * fy - _re2
            Dim disc = b * b - l2 * cc
            If disc < 0 Then Return Double.NegativeInfinity
            Dim sq = Math.Sqrt(disc)
            Dim t1 = Math.Max(0, (-b - sq) / l2), t2 = Math.Min(1, (-b + sq) / l2)
            If t1 > t2 Then Return Double.NegativeInfinity
            Dim f = Function(tt As Double)
                        Dim ex = fx + tt * dx, ey = fy + tt * dy
                        Return p.Z + tt * dz - ProfH(Math.Min(_re, Math.Sqrt(ex * ex + ey * ey)))
                    End Function
            Const G = 0.6180339887498949
            Dim a = t1, c = t2
            Dim x1 = c - G * (c - a), x2 = a + G * (c - a)
            Dim f1 = f(x1), f2 = f(x2)
            Dim tolT = 0.000001 / Math.Sqrt(l2)   ' circa un micron lungo lo spigolo
            For it = 1 To 48
                If c - a < tolT Then Exit For
                If f1 < f2 Then
                    a = x1 : x1 = x2 : f1 = f2
                    x2 = a + G * (c - a) : f2 = f(x2)
                Else
                    c = x2 : x2 = x1 : f2 = f1
                    x1 = c - G * (c - a) : f1 = f(x1)
                End If
            Next
            Return Math.Max(Math.Max(f1, f2), Math.Max(f(t1), f(t2)))
        End Function

    End Class

End Namespace
