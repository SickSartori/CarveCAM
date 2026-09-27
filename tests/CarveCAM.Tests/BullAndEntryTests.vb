Imports System.Threading
Imports CarveCAM.Core.Cam
Imports CarveCAM.Core.Geometry
Imports CarveCAM.Core.Model
Imports Xunit

Public Class BullNoseTests

    Private Shared Function RandomTris(seed As Integer, count As Integer) As List(Of LocalTri)
        Dim rnd As New Random(seed)
        Dim r = Function(a As Double, b As Double) a + (b - a) * rnd.NextDouble()
        Dim res As New List(Of LocalTri)()
        For i = 0 To count - 1
            Dim c As New Vec3(r(-6, 6), r(-6, 6), r(-4, 4))
            res.Add(New LocalTri(c + New Vec3(r(-5, 5), r(-5, 5), r(-4, 4)),
                                 c + New Vec3(r(-5, 5), r(-5, 5), r(-4, 4)),
                                 c + New Vec3(r(-5, 5), r(-5, 5), r(-4, 4))))
        Next
        Return res
    End Function

    Private Shared Function Single1(t As LocalTri) As List(Of LocalTri)
        Return New List(Of LocalTri) From {t}
    End Function

    <Fact>
    Public Sub Bull_WithFullCorner_EqualsBall()
        For Each t In RandomTris(1, 300)
            Dim bull As New DropCutter(Single1(t), 3, 2.99999, 0, CutterKind.Bull)
            Dim ball As New DropCutter(Single1(t), 3, 0, True)
            Assert.Equal(CutterKind.Bull, bull.Kind)
            For Each p In {New Vec2(0, 0), New Vec2(1.5, -2), New Vec2(-3, 4)}
                Assert.True(Math.Abs(ball.Contact(p.X, p.Y, -100) - bull.Contact(p.X, p.Y, -100)) < 0.001)
            Next
        Next
    End Sub

    <Fact>
    Public Sub Bull_WithTinyCorner_EqualsFlat()
        For Each t In RandomTris(2, 300)
            Dim bull As New DropCutter(Single1(t), 3, 0.00001, 0, CutterKind.Bull)
            Dim flat As New DropCutter(Single1(t), 3, 0, False)
            For Each p In {New Vec2(0, 0), New Vec2(1.5, -2), New Vec2(-3, 4)}
                Assert.True(Math.Abs(flat.Contact(p.X, p.Y, -100) - bull.Contact(p.X, p.Y, -100)) < 0.001)
            Next
        Next
    End Sub

    <Fact>
    Public Sub Bull_Vertex_Analytic()
        ' triangolo a punta con vertice più alto in (0,0,0)
        Dim t As New LocalTri(New Vec3(0, 0, 0), New Vec3(60, -1, -60), New Vec3(60, 1, -60))
        Dim dc As New DropCutter(Single1(t), 5, 2, 0, CutterKind.Bull)
        ' distanza 2 (dentro il fondo piatto Rf=3): punta sul vertice
        Assert.Equal(0, dc.Contact(-2, 0, -100), 6)
        ' distanza 4 (sul toro): punta = sqrt(r² - (q-Rf)²) - r
        Assert.Equal(Math.Sqrt(4 - 1) - 2, dc.Contact(-4, 0, -100), 6)
    End Sub

    ''' <summary>Confronto con la forza bruta: massimo del contatto "puntiforme" su una fitta griglia di punti del triangolo.</summary>
    <Fact>
    Public Sub Bull_MatchesBruteForce()
        Const R = 4.0, rc = 1.5
        Dim rf = R - rc
        Dim h = Function(q As Double) As Double
                    If q <= rf Then Return 0
                    If q > R Then Return Double.NegativeInfinity
                    Return Math.Sqrt(rc * rc - (q - rf) ^ 2) - rc
                End Function
        Dim rnd As New Random(7)
        For Each t In RandomTris(3, 120)
            Dim dc As New DropCutter(Single1(t), R, rc, 0, CutterKind.Bull)
            Dim u = -6 + 12 * rnd.NextDouble(), v = -6 + 12 * rnd.NextDouble()
            Dim exact = dc.Contact(u, v, -1000)
            Dim brute = -1000.0
            Const N = 120
            For i = 0 To N
                For j = 0 To N - i
                    Dim a = i / N, b = j / N
                    Dim p = t.A + (t.B - t.A) * a + (t.C - t.A) * b
                    Dim q = Math.Sqrt((p.X - u) ^ 2 + (p.Y - v) ^ 2)
                    brute = Math.Max(brute, p.Z + h(q))
                Next
            Next
            Assert.True(exact >= brute - 0.000001, $"contatto {exact} sotto la forza bruta {brute}")
            Assert.True(exact - brute < 0.05, $"contatto {exact} troppo alto rispetto a {brute}")
        Next
    End Sub

End Class

Public Class EntryTests

    Private Shared Function NoMesh(id As String) As Single()
        Return Nothing
    End Function

    Private Shared Function PocketReq(entry As String, strategy As String, tool As ToolDef) As ComputeRequest
        Return New ComputeRequest With {
            .Plane = New PlaneDef(),
            .Boundary = New List(Of SketchEntityDef) From {New SketchEntityDef With {.Kind = "rect", .X1 = -40, .Y1 = -30, .X2 = 40, .Y2 = 30}},
            .Artifacts = New List(Of ArtifactDef) From {New ArtifactDef With {.Kind = "cylinder", .Radius = 8, .Height = 30, .Position = {0, 0, -12}}},
            .Operation = New OperationDef With {.Kind = "pocket", .Strategy = strategy, .Stepover = 4, .Stepdown = 2, .MaxDepth = 8,
                .Tool = tool, .Entry = entry, .RampAngle = 3, .RampFeed = 500}}
    End Function

    Private Shared Sub AssertSlopes(tp As Toolpath, maxAngleDeg As Double)
        Dim tanA = Math.Tan(maxAngleDeg * Math.PI / 180) * 1.02
        For i = 1 To tp.Points.Count - 1
            Dim b = tp.Points(i)
            If b.Type <> MoveType.Ramp Then Continue For
            Dim a = tp.Points(i - 1)
            Dim dxy = Math.Sqrt((b.U - a.U) ^ 2 + (b.V - a.V) ^ 2)
            Dim dw = a.W - b.W
            Assert.True(dw <= tanA * dxy + 0.000001, $"rampa troppo ripida: dw={dw} dxy={dxy}")
        Next
    End Sub

    <Fact>
    Public Sub Pocket_HelixEntry_BullNose()
        Dim tool As New ToolDef With {.Type = "bull", .Diameter = 8, .CornerRadius = 1}
        Dim tp = CamEngine.Compute(PocketReq("helix", "concentric", tool), AddressOf NoMesh, CancellationToken.None)
        Assert.True(tp.Stats.HelixEntries > 0, "nessuna elica")
        Assert.Contains(tp.Points, Function(p) p.Type = MoveType.Ramp)
        Assert.DoesNotContain(tp.Points, Function(p) p.Type = MoveType.Plunge AndAlso p.W < -0.01)
        Assert.True(tp.Stats.MaxGouge < 0.01, $"interferenza {tp.Stats.MaxGouge}")
        AssertSlopes(tp, 3)
        ' il centro utensile resta dentro il contorno ridotto del raggio
        Assert.All(tp.Points.Where(Function(p) p.Type <> MoveType.Rapid), Sub(p)
                                                                              Assert.InRange(p.U, -36.01, 36.01)
                                                                              Assert.InRange(p.V, -26.01, 26.01)
                                                                          End Sub)
        Dim g = CarveCAM.Core.Post.PostProcessor.GCode({tp}, New CarveCAM.Core.Post.PostOptions())
        Assert.Contains("TORICA D=8 R=1", g)
        Assert.Contains("F500", g)
    End Sub

    <Fact>
    Public Sub Pocket_RampEntry_ZigZag()
        Dim tool As New ToolDef With {.Type = "flat", .Diameter = 6}
        Dim tp = CamEngine.Compute(PocketReq("ramp", "zigzag", tool), AddressOf NoMesh, CancellationToken.None)
        Assert.True(tp.Stats.RampEntries > 0, "nessuna rampa")
        Assert.True(tp.Stats.MaxGouge < 0.01, $"interferenza {tp.Stats.MaxGouge}")
        AssertSlopes(tp, 3)
        ' le rampe restano fuori dal cilindro maggiorato del raggio utensile
        For Each p In tp.Points.Where(Function(q) q.Type = MoveType.Ramp)
            Assert.True(Math.Sqrt(p.U * p.U + p.V * p.V) >= 8 + 3 - 0.01)
        Next
    End Sub

    <Fact>
    Public Sub Finish_BullNose_NoGouge()
        Dim sph As New ArtifactDef With {.Kind = "sphere", .Radius = 12, .Position = {0, 0, -12}}
        Dim req As New ComputeRequest With {
            .Plane = New PlaneDef With {.Origin = {0, 0, 5}},
            .Boundary = New List(Of SketchEntityDef) From {New SketchEntityDef With {.Kind = "circle", .R = 18}},
            .Artifacts = New List(Of ArtifactDef) From {sph},
            .Operation = New OperationDef With {.Kind = "finish", .Strategy = "zigzag", .Stepover = 1, .MaxDepth = 30,
                .Tool = New ToolDef With {.Type = "bull", .Diameter = 10, .CornerRadius = 2}}}
        Dim tp = CamEngine.Compute(req, AddressOf NoMesh, CancellationToken.None)
        Assert.True(tp.Stats.MaxGouge < 0.02, $"interferenza {tp.Stats.MaxGouge}")
        ' verifica indipendente: il toro (asse verticale) non penetra la sfera
        Const rf = 3.0, rc = 2.0
        Dim ctr As New Vec3(0, 0, -12)
        For Each p In tp.Points.Where(Function(q) q.Type = MoveType.Feed)
            Dim w = tp.Frame.ToWorld(p.U, p.V, p.W)
            ' distanza tra il centro sfera e la circonferenza centrale del toro
            Dim dh = Math.Sqrt((ctr.X - w.X) ^ 2 + (ctr.Y - w.Y) ^ 2)
            Dim dz = ctr.Z - (w.Z + rc)
            Dim dist = Math.Sqrt((dh - rf) ^ 2 + dz * dz)
            Dim distFlat = If(dh <= rf, w.Z - ctr.Z, Double.MaxValue) ' fondo piatto sopra la sfera
            Assert.True(Math.Min(dist - rc, distFlat) >= 12 - 0.02, $"penetrazione in {w}")
        Next
    End Sub

End Class
