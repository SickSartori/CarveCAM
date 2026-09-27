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
    End Enum

    ''' <summary>
    ''' "Drop cutter": dato un punto (u,v) del piano, calcola la quota w più alta della punta utensile
    ''' (asse lungo la normale del piano) alla quale l'utensile tocca il modello scendendo dall'alto.
    ''' Supporta fresa cilindrica (flat), sferica (ball) e torica (bull: fondo piatto di raggio R-r
    ''' raccordato con un toro di raggio r). Il sovrametallo viene gestito come utensile maggiorato
    ''' (raggi + s) e punta sollevata di s.
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

        Public ReadOnly Property Radius As Double
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
            Dim r = Math.Max(tool.Radius * 0.5, tool.Radius - shrink)
            If tool.IsBall Then Return New DropCutter(tris, r, r, stock, CutterKind.Ball)
            If tool.IsBull Then
                Dim cr = tool.EffectiveCorner - shrink
                If cr > 0.000001 Then Return New DropCutter(tris, r, cr, stock, CutterKind.Bull)
            End If
            Return New DropCutter(tris, r, 0, stock, CutterKind.Flat)
        End Function

        Public Sub New(tris As List(Of LocalTri), radius As Double, cornerRadius As Double, stock As Double, kind As CutterKind)
            Me.Radius = radius
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
            If _tris.Length = 0 Then
                _nu = 1 : _nv = 1 : _cs = 1
                _cellStart = {0, 0}
                _items = Array.Empty(Of Integer)()
                Return
            End If
            Dim minU = Double.MaxValue, minV = Double.MaxValue, maxU = Double.MinValue, maxV = Double.MinValue
            For Each t In _tris
                minU = Math.Min(minU, t.MinU) : maxU = Math.Max(maxU, t.MaxU)
                minV = Math.Min(minV, t.MinV) : maxV = Math.Max(maxV, t.MaxV)
                MaxW = Math.Max(MaxW, t.MaxW)
            Next
            Dim ext = Math.Max(maxU - minU, 0.001) * Math.Max(maxV - minV, 0.001)
            _cs = Math.Max(Math.Max(_re * 0.5, 0.05), Math.Sqrt(ext / 4000000.0))
            _u0 = minU - _cs : _v0 = minV - _cs
            _nu = CInt(Math.Floor((maxU - _u0) / _cs)) + 2
            _nv = CInt(Math.Floor((maxV - _v0) / _cs)) + 2

            ' griglia CSR: conteggio, prefissi, riempimento
            Dim counts(_nu * _nv) As Integer
            For Each t In _tris
                Dim i0 = CellU(t.MinU), i1 = CellU(t.MaxU), j0 = CellV(t.MinV), j1 = CellV(t.MaxV)
                For j = j0 To j1
                    For i = i0 To i1
                        counts(j * _nu + i) += 1
                    Next
                Next
            Next
            _cellStart = New Integer(_nu * _nv) {}
            Dim acc = 0
            For c = 0 To _nu * _nv - 1
                _cellStart(c) = acc
                acc += counts(c)
            Next
            _cellStart(_nu * _nv) = acc
            _items = New Integer(acc - 1) {}
            Dim fill(_nu * _nv - 1) As Integer
            For k = 0 To _tris.Length - 1
                Dim i0 = CellU(_tris(k).MinU), i1 = CellU(_tris(k).MaxU), j0 = CellV(_tris(k).MinV), j1 = CellV(_tris(k).MaxV)
                For j = j0 To j1
                    For i = i0 To i1
                        Dim c = j * _nu + i
                        _items(_cellStart(c) + fill(c)) = k
                        fill(c) += 1
                    Next
                Next
            Next
            ' ordina ogni cella per quota massima decrescente: permette l'uscita anticipata
            Dim tr = _tris
            Dim cmp As Comparison(Of Integer) = Function(x, y) tr(y).MaxW.CompareTo(tr(x).MaxW)
            For c = 0 To _nu * _nv - 1
                Dim len = _cellStart(c + 1) - _cellStart(c)
                If len > 1 Then Array.Sort(_items, _cellStart(c), len, Comparer(Of Integer).Create(cmp))
            Next
        End Sub

        Private Function CellU(u As Double) As Integer
            Return Math.Max(0, Math.Min(_nu - 1, CInt(Math.Floor((u - _u0) / _cs))))
        End Function

        Private Function CellV(v As Double) As Integer
            Return Math.Max(0, Math.Min(_nv - 1, CInt(Math.Floor((v - _v0) / _cs))))
        End Function

        ''' <summary>Quota punta utensile in (u,v); ritorna almeno <paramref name="floor"/>.</summary>
        Public Function Contact(u As Double, v As Double, floor As Double) As Double
            Dim best = floor - Stock
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
                        Dim w As Double
                        Select Case Kind
                            Case CutterKind.Flat : w = FlatTri(_tris(ti), u, v)
                            Case CutterKind.Ball : w = BallTri(_tris(ti), u, v)
                            Case Else : w = BullTri(_tris(ti), u, v, best)
                        End Select
                        If w > best Then best = w
                    Next
                Next
            Next
            Return best + Stock
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

    End Class

End Namespace
