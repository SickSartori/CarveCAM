Imports CarveCAM.Core.Geometry
Imports CarveCAM.Core.Model

Namespace Cam

    ''' <summary>
    ''' Grezzo come mappa di quote nel sistema del piano di una lavorazione: in ogni cella (u, v) il materiale va da
    ''' Bottom a Top lungo la normale w (una sola fascia per colonna: è quello che una fresa con quell'asse può
    ''' togliere). Celle senza materiale: Top = Bottom = Empty. Le celle sono centrate in (U0 + i·Res, V0 + j·Res).
    ''' La fresa toglie materiale abbassando Top fino al suo profilo. Per un piano parallelo la mappa si trasla,
    ''' per un piano con altra normale diventa una superficie chiusa (triangoli) e si ricampiona.
    ''' </summary>
    Public NotInheritable Class StockMap
        Public Const Empty As Single = -1.0E+30F
        ''' <summary>Spessore sotto il quale una colonna è considerata vuota [mm].</summary>
        Private Const Thin As Double = 0.0001
        Private Const LiftSamples As Integer = 512

        Public ReadOnly Property Frame As PlaneFrame
        Public ReadOnly Property U0 As Double
        Public ReadOnly Property V0 As Double
        Public ReadOnly Property Res As Double
        Public ReadOnly Property Nu As Integer
        Public ReadOnly Property Nv As Integer
        Public ReadOnly Property Top As Single()
        Public ReadOnly Property Bottom As Single()

        Public Sub New(frame As PlaneFrame, u0 As Double, v0 As Double, res As Double, nu As Integer, nv As Integer, top As Single(), bottom As Single())
            Me.Frame = frame
            Me.U0 = u0 : Me.V0 = v0 : Me.Res = res
            Me.Nu = nu : Me.Nv = nv
            Me.Top = top : Me.Bottom = bottom
        End Sub

        Public Function HasMaterial(idx As Integer) As Boolean
            Return Top(idx) > Bottom(idx) + Thin
        End Function

        Public Function Clone() As StockMap
            Return New StockMap(Frame, U0, V0, Res, Nu, Nv, CType(Top.Clone(), Single()), CType(Bottom.Clone(), Single()))
        End Function

        ' ================================================================ costruzione
        ''' <summary>
        ''' Mappa dai triangoli di un solido chiuso (coordinate mondo): ogni triangolo si proietta sul piano e si
        ''' rasterizza sui centri delle celle; per ogni colonna Top è la quota massima incontrata, Bottom la minima.
        ''' La risoluzione si sceglie sull'ingombro, per circa maxCells celle. Nothing se non ci sono triangoli.
        ''' </summary>
        Public Shared Function FromTriangles(worldTris As Single(), frame As PlaneFrame, Optional maxCells As Integer = 160000) As StockMap
            If worldTris Is Nothing OrElse worldTris.Length < 9 Then Return Nothing
            Dim n = worldTris.Length \ 9
            Dim loc(n * 3 - 1) As Vec3
            Dim minU = Double.MaxValue, minV = Double.MaxValue, maxU = Double.MinValue, maxV = Double.MinValue
            For k = 0 To n * 3 - 1
                Dim p = frame.ToLocal(New Vec3(worldTris(k * 3), worldTris(k * 3 + 1), worldTris(k * 3 + 2)))
                loc(k) = p
                minU = Math.Min(minU, p.X) : maxU = Math.Max(maxU, p.X)
                minV = Math.Min(minV, p.Y) : maxV = Math.Max(maxV, p.Y)
            Next
            Dim area = Math.Max(1.0, (maxU - minU) * (maxV - minV))
            Dim res = Math.Max(0.1, Math.Sqrt(area / maxCells))
            Dim nu = Math.Max(1, CInt(Math.Ceiling((maxU - minU) / res)))
            Dim nv = Math.Max(1, CInt(Math.Ceiling((maxV - minV) / res)))
            Dim u0 = minU + res / 2, v0 = minV + res / 2
            Dim top(nu * nv - 1) As Single, bot(nu * nv - 1) As Single
            For i = 0 To top.Length - 1
                top(i) = Empty : bot(i) = Single.MaxValue
            Next
            For t = 0 To n - 1
                Rasterize(loc(t * 3), loc(t * 3 + 1), loc(t * 3 + 2), u0, v0, res, nu, nv, top, bot)
            Next
            For i = 0 To top.Length - 1
                If top(i) = Empty Then bot(i) = Empty
            Next
            Return New StockMap(frame, u0, v0, res, nu, nv, top, bot)
        End Function

        ''' <summary>Quote del triangolo sui centri delle celle che la sua proiezione copre.</summary>
        Private Shared Sub Rasterize(a As Vec3, b As Vec3, c As Vec3, u0 As Double, v0 As Double, res As Double, nu As Integer, nv As Integer,
                                     top As Single(), bot As Single())
            Dim det = (b.X - a.X) * (c.Y - a.Y) - (c.X - a.X) * (b.Y - a.Y)
            If Math.Abs(det) < 1.0E-12 Then Return  ' triangolo visto di taglio: lo coprono le facce vicine
            Dim i0 = Math.Max(0, CInt(Math.Ceiling((Math.Min(a.X, Math.Min(b.X, c.X)) - u0) / res)))
            Dim i1 = Math.Min(nu - 1, CInt(Math.Floor((Math.Max(a.X, Math.Max(b.X, c.X)) - u0) / res)))
            Dim j0 = Math.Max(0, CInt(Math.Ceiling((Math.Min(a.Y, Math.Min(b.Y, c.Y)) - v0) / res)))
            Dim j1 = Math.Min(nv - 1, CInt(Math.Floor((Math.Max(a.Y, Math.Max(b.Y, c.Y)) - v0) / res)))
            Const tol = -0.000000001
            For j = j0 To j1
                Dim v = v0 + j * res
                For i = i0 To i1
                    Dim u = u0 + i * res
                    Dim l1 = ((b.X - u) * (c.Y - v) - (c.X - u) * (b.Y - v)) / det
                    Dim l2 = ((c.X - u) * (a.Y - v) - (a.X - u) * (c.Y - v)) / det
                    Dim l3 = 1 - l1 - l2
                    If l1 < tol OrElse l2 < tol OrElse l3 < tol Then Continue For
                    Dim w = CSng(l1 * a.Z + l2 * b.Z + l3 * c.Z)
                    Dim idx = j * nu + i
                    If w > top(idx) Then top(idx) = w
                    If w < bot(idx) Then bot(idx) = w
                Next
            Next
        End Sub

        ''' <summary>
        ''' Stessa mappa nel sistema di un altro piano: la stessa (o traslata, se il piano è parallelo con gli stessi
        ''' assi), altrimenti ricampionata dalla sua superficie.
        ''' </summary>
        Public Shared Function Reframe(src As StockMap, frame As PlaneFrame) As StockMap
            If src Is Nothing Then Return Nothing
            Const tolA = 0.000000001
            Dim f = src.Frame
            If (f.U - frame.U).Length < tolA AndAlso (f.N - frame.N).Length < tolA Then
                Dim d = f.Origin - frame.Origin
                Dim du = d.Dot(frame.U), dv = d.Dot(frame.V), dw = d.Dot(frame.N)
                If Math.Abs(du) < tolA AndAlso Math.Abs(dv) < tolA AndAlso Math.Abs(dw) < tolA Then Return src
                ' piano parallelo: celle traslate, quote spostate di dw
                Dim top = CType(src.Top.Clone(), Single()), bot = CType(src.Bottom.Clone(), Single())
                For i = 0 To top.Length - 1
                    If top(i) <> Empty Then top(i) = CSng(top(i) + dw) : bot(i) = CSng(bot(i) + dw)
                Next
                Return New StockMap(frame, src.U0 + du, src.V0 + dv, src.Res, src.Nu, src.Nv, top, bot)
            End If
            Return FromTriangles(src.ToTriangles(), frame, src.Nu * src.Nv)
        End Function

        ''' <summary>Superficie chiusa del grezzo (triangoli in coordinate mondo): sommità, fondo e pareti sul bordo.</summary>
        Public Function ToTriangles() As Single()
            Dim out As New List(Of Single)()
            Dim quad As Func(Of Integer, Integer, Boolean) =
                Function(i, j) i >= 0 AndAlso j >= 0 AndAlso i < Nu - 1 AndAlso j < Nv - 1 AndAlso
                               HasMaterial(j * Nu + i) AndAlso HasMaterial(j * Nu + i + 1) AndAlso HasMaterial((j + 1) * Nu + i) AndAlso HasMaterial((j + 1) * Nu + i + 1)
            Dim P = Function(i As Integer, j As Integer, w As Single) Frame.ToWorld(U0 + i * Res, V0 + j * Res, w)
            Dim tri = Sub(a As Vec3, b As Vec3, c As Vec3)
                          out.Add(CSng(a.X)) : out.Add(CSng(a.Y)) : out.Add(CSng(a.Z))
                          out.Add(CSng(b.X)) : out.Add(CSng(b.Y)) : out.Add(CSng(b.Z))
                          out.Add(CSng(c.X)) : out.Add(CSng(c.Y)) : out.Add(CSng(c.Z))
                      End Sub
            Dim wall = Sub(i1 As Integer, j1 As Integer, i2 As Integer, j2 As Integer)
                           Dim a = j1 * Nu + i1, b = j2 * Nu + i2
                           Dim ta = P(i1, j1, Top(a)), tb = P(i2, j2, Top(b)), ba = P(i1, j1, Bottom(a)), bb = P(i2, j2, Bottom(b))
                           tri(ta, ba, bb) : tri(ta, bb, tb)
                       End Sub
            For j = 0 To Nv - 2
                For i = 0 To Nu - 2
                    If Not quad(i, j) Then Continue For
                    Dim i00 = j * Nu + i, i10 = i00 + 1, i01 = i00 + Nu, i11 = i01 + 1
                    Dim t00 = P(i, j, Top(i00)), t10 = P(i + 1, j, Top(i10)), t01 = P(i, j + 1, Top(i01)), t11 = P(i + 1, j + 1, Top(i11))
                    tri(t00, t10, t11) : tri(t00, t11, t01)
                    Dim b00 = P(i, j, Bottom(i00)), b10 = P(i + 1, j, Bottom(i10)), b01 = P(i, j + 1, Bottom(i01)), b11 = P(i + 1, j + 1, Bottom(i11))
                    tri(b00, b11, b10) : tri(b00, b01, b11)
                    If Not quad(i, j - 1) Then wall(i, j, i + 1, j)
                    If Not quad(i, j + 1) Then wall(i + 1, j + 1, i, j + 1)
                    If Not quad(i - 1, j) Then wall(i, j + 1, i, j)
                    If Not quad(i + 1, j) Then wall(i + 1, j, i + 1, j + 1)
                Next
            Next
            Return out.ToArray()
        End Function

        ' ================================================================ interrogazioni
        ''' <summary>Quota massima del materiale nella finestra (u, v); Double.NegativeInfinity se non c'è materiale.</summary>
        Public Function MaxTop(minU As Double, minV As Double, maxU As Double, maxV As Double) As Double
            Dim best = Double.NegativeInfinity
            Dim i0 = Math.Max(0, CInt(Math.Floor((minU - U0) / Res))), i1 = Math.Min(Nu - 1, CInt(Math.Ceiling((maxU - U0) / Res)))
            Dim j0 = Math.Max(0, CInt(Math.Floor((minV - V0) / Res))), j1 = Math.Min(Nv - 1, CInt(Math.Ceiling((maxV - V0) / Res)))
            For j = j0 To j1
                For i = i0 To i1
                    Dim idx = j * Nu + i
                    If HasMaterial(idx) AndAlso Top(idx) > best Then best = Top(idx)
                Next
            Next
            Return best
        End Function

        ''' <summary>Campo delle quote della sommità (colonne vuote molto in basso): contorni del materiale a una quota.</summary>
        Public Function MaterialField() As HeightField
            Dim h(Nu * Nv - 1) As Double
            For i = 0 To h.Length - 1
                h(i) = If(HasMaterial(i), CDbl(Top(i)), -1.0E+30)
            Next
            Return New HeightField(U0, V0, Res, Nu, Nv, h)
        End Function

        ''' <summary>
        ''' Altezza del tagliente sopra la punta a distanza q dall'asse, in tabella da 0 al raggio massimo:
        ''' piatta, sferica, torica o conica (profilo per punti).
        ''' </summary>
        Public Shared Function LiftTable(tool As ToolDef) As (RMax As Double, Lift As Double())
            Dim rMax = Math.Max(0.001, tool.MaxRadius)
            Dim tab(LiftSamples) As Double
            Dim prof = If(tool.IsTaper, tool.TaperProfile(), Nothing)
            For k = 0 To LiftSamples
                Dim q = rMax * k / LiftSamples
                Dim h As Double
                If prof IsNot Nothing Then
                    h = prof(prof.Count - 1).H
                    For s = 1 To prof.Count - 1
                        If q <= prof(s).Q + 0.000000001 Then
                            Dim a = prof(s - 1), b = prof(s)
                            h = If(b.Q - a.Q < 0.000000001, a.H, a.H + (b.H - a.H) * (q - a.Q) / (b.Q - a.Q))
                            Exit For
                        End If
                    Next
                Else
                    Dim r = tool.EffectiveCorner, rf = tool.Radius - r
                    h = If(q <= rf, 0, r - Math.Sqrt(Math.Max(0, r * r - (q - rf) * (q - rf))))
                End If
                tab(k) = h
            Next
            Return (rMax, tab)
        End Function

        Private Shared Function LiftAt(tab As Double(), rMax As Double, q As Double) As Double
            Dim x = q / rMax * LiftSamples
            Dim k = Math.Min(LiftSamples - 1, CInt(Math.Floor(x)))
            Dim t = x - k
            Return tab(k) + (tab(k + 1) - tab(k)) * t
        End Function

        ''' <summary>True se la fresa con la punta in (u, v, w) tocca materiale (oltre eps).</summary>
        Public Function Engages(u As Double, v As Double, w As Double, lift As (RMax As Double, Lift As Double()), Optional eps As Double = 0.02) As Boolean
            Dim rMax = lift.RMax
            Dim i0 = Math.Max(0, CInt(Math.Ceiling((u - rMax - U0) / Res))), i1 = Math.Min(Nu - 1, CInt(Math.Floor((u + rMax - U0) / Res)))
            Dim j0 = Math.Max(0, CInt(Math.Ceiling((v - rMax - V0) / Res))), j1 = Math.Min(Nv - 1, CInt(Math.Floor((v + rMax - V0) / Res)))
            Dim r2 = rMax * rMax
            For j = j0 To j1
                Dim dv = V0 + j * Res - v
                For i = i0 To i1
                    Dim du = U0 + i * Res - u
                    Dim q2 = du * du + dv * dv
                    If q2 > r2 Then Continue For
                    Dim idx = j * Nu + i
                    If HasMaterial(idx) AndAlso Top(idx) > w + LiftAt(lift.Lift, rMax, Math.Sqrt(q2)) + eps Then Return True
                Next
            Next
            Return False
        End Function

        ' ================================================================ asportazione
        ''' <summary>Materiale tolto dalla fresa lungo i movimenti di lavoro, rampa e affondo (i rapidi non tagliano).</summary>
        Public Sub Cut(points As IList(Of CLPoint), tool As ToolDef)
            If points Is Nothing OrElse points.Count < 2 Then Return
            Dim lift = LiftTable(tool)
            Dim stepLen = Math.Max(0.01, Res * 0.5)
            Dim topMax = Double.NegativeInfinity
            For i = 0 To Top.Length - 1
                If HasMaterial(i) AndAlso Top(i) > topMax Then topMax = Top(i)
            Next
            For k = 1 To points.Count - 1
                Dim b = points(k)
                If b.Type = MoveType.Rapid Then Continue For
                Dim a = points(k - 1)
                If Math.Min(a.W, b.W) >= topMax Then Continue For   ' sopra il grezzo: niente da togliere
                Dim len = Math.Sqrt((b.U - a.U) ^ 2 + (b.V - a.V) ^ 2)
                Dim n = Math.Max(1, CInt(Math.Ceiling(len / stepLen)))
                For s = 0 To n
                    Dim t = s / n
                    Stamp(a.U + (b.U - a.U) * t, a.V + (b.V - a.V) * t, a.W + (b.W - a.W) * t, lift)
                Next
            Next
        End Sub

        Private Sub Stamp(u As Double, v As Double, w As Double, lift As (RMax As Double, Lift As Double()))
            Dim rMax = lift.RMax
            Dim i0 = Math.Max(0, CInt(Math.Ceiling((u - rMax - U0) / Res))), i1 = Math.Min(Nu - 1, CInt(Math.Floor((u + rMax - U0) / Res)))
            Dim j0 = Math.Max(0, CInt(Math.Ceiling((v - rMax - V0) / Res))), j1 = Math.Min(Nv - 1, CInt(Math.Floor((v + rMax - V0) / Res)))
            Dim r2 = rMax * rMax
            For j = j0 To j1
                Dim dv = V0 + j * Res - v
                For i = i0 To i1
                    Dim du = U0 + i * Res - u
                    Dim q2 = du * du + dv * dv
                    If q2 > r2 Then Continue For
                    Dim idx = j * Nu + i
                    If Top(idx) <= w Then Continue For
                    If Not HasMaterial(idx) Then Continue For
                    Dim tw = w + LiftAt(lift.Lift, rMax, Math.Sqrt(q2))
                    If Top(idx) > tw Then Top(idx) = CSng(Math.Max(tw, Bottom(idx)))
                Next
            Next
        End Sub

        ' ================================================================ per il client
        ''' <summary>
        ''' Formato binario: int32 nu, int32 nv, float64 u0, v0, res, origine, U, V, N del piano (12 valori),
        ''' poi nu·nv float32 Top e nu·nv float32 Bottom (Empty = colonna vuota).
        ''' </summary>
        Public Function ToBinary() As Byte()
            Dim cells = Nu * Nv
            Dim head = 8 + 15 * 8
            Dim bytes(head + cells * 8 - 1) As Byte
            BitConverter.TryWriteBytes(bytes.AsSpan(0, 4), Nu)
            BitConverter.TryWriteBytes(bytes.AsSpan(4, 4), Nv)
            Dim vals = {U0, V0, Res, Frame.Origin.X, Frame.Origin.Y, Frame.Origin.Z, Frame.U.X, Frame.U.Y, Frame.U.Z, Frame.V.X, Frame.V.Y, Frame.V.Z, Frame.N.X, Frame.N.Y, Frame.N.Z}
            For k = 0 To vals.Length - 1
                BitConverter.TryWriteBytes(bytes.AsSpan(8 + k * 8, 8), vals(k))
            Next
            Buffer.BlockCopy(Top, 0, bytes, head, cells * 4)
            Buffer.BlockCopy(Bottom, 0, bytes, head + cells * 4, cells * 4)
            Return bytes
        End Function

    End Class

End Namespace
