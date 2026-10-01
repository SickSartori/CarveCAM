Imports System.Text.RegularExpressions
Imports System.Threading
Imports CarveCAM.Core.Cam
Imports CarveCAM.Core.Geometry
Imports CarveCAM.Core.Model
Imports CarveCAM.Core.Post
Imports Xunit

''' <summary>Fresa conica (drop-cutter a profilo) e zero pezzo del post-processor.</summary>
Public Class TaperTests

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

    Private Shared Function Taper(d As Double, angle As Double, tip As String, lc As Double) As ToolDef
        Return New ToolDef With {.Type = "taper", .Diameter = d, .TaperAngle = angle, .TipType = tip, .FluteLength = lc}
    End Function

    <Fact>
    Public Sub Taper_BallTip_NearZeroAngle_EqualsBall()
        ' cono quasi cilindrico e alto quanto la semisfera: resta solo la punta sferica
        Dim tool = Taper(6, 0.05, "ball", 3)
        For Each t In RandomTris(11, 300)
            Dim tp = DropCutter.ForTool(Single1(t), tool, 0)
            Dim ball As New DropCutter(Single1(t), 3, 0, True)
            Assert.Equal(CutterKind.Profile, tp.Kind)
            For Each p In {New Vec2(0, 0), New Vec2(1.5, -2), New Vec2(-2, 1)}
                Assert.True(Math.Abs(ball.Contact(p.X, p.Y, -100) - tp.Contact(p.X, p.Y, -100)) < 0.005,
                            $"sferica {ball.Contact(p.X, p.Y, -100)} conica {tp.Contact(p.X, p.Y, -100)}")
            Next
        Next
    End Sub

    <Fact>
    Public Sub Taper_FlatTip_ShortCone_EqualsFlat()
        Dim tool = Taper(6, 0.05, "flat", 0.001)
        For Each t In RandomTris(12, 300)
            Dim tp = DropCutter.ForTool(Single1(t), tool, 0)
            Dim flat As New DropCutter(Single1(t), 3, 0, False)
            For Each p In {New Vec2(0, 0), New Vec2(1.5, -2), New Vec2(-2, 1)}
                Assert.True(Math.Abs(flat.Contact(p.X, p.Y, -100) - tp.Contact(p.X, p.Y, -100)) < 0.005)
            Next
        Next
    End Sub

    ''' <summary>Confronto con la forza bruta: massimo di z - h(q) su una fitta griglia di punti del triangolo.</summary>
    <Theory>
    <InlineData(0.0, 30.0, "flat", 10.0)>
    <InlineData(2.0, 5.0, "ball", 8.0)>
    <InlineData(1.0, 15.0, "flat", 6.0)>
    Public Sub Taper_MatchesBruteForce(d As Double, angle As Double, tip As String, lc As Double)
        Dim tool = Taper(d, angle, tip, lc)
        Dim prof = tool.TaperProfile()
        Dim rMax = prof(prof.Count - 1).Q
        Dim h = Function(q As Double) As Double
                    If q > rMax Then Return Double.PositiveInfinity
                    For i = 1 To prof.Count - 1
                        If q <= prof(i).Q Then
                            Dim a = prof(i - 1), b = prof(i)
                            Return If(b.Q - a.Q < 0.000000001, a.H, a.H + (b.H - a.H) * (q - a.Q) / (b.Q - a.Q))
                        End If
                    Next
                    Return prof(prof.Count - 1).H
                End Function
        Dim rnd As New Random(21)
        For Each t In RandomTris(13, 120)
            Dim dc = DropCutter.ForTool(Single1(t), tool, 0)
            Dim u = -6 + 12 * rnd.NextDouble(), v = -6 + 12 * rnd.NextDouble()
            Dim exact = dc.Contact(u, v, -1000)
            Dim brute = -1000.0
            Const N = 140
            For i = 0 To N
                For j = 0 To N - i
                    Dim a = i / N, b = j / N
                    Dim p = t.A + (t.B - t.A) * a + (t.C - t.A) * b
                    Dim q = Math.Sqrt((p.X - u) ^ 2 + (p.Y - v) ^ 2)
                    brute = Math.Max(brute, p.Z - h(q))
                Next
            Next
            Assert.True(exact >= brute - 0.000001, $"contatto {exact} sotto la forza bruta {brute}")
            Assert.True(exact - brute < 0.08, $"contatto {exact} troppo alto rispetto a {brute}")
        Next
    End Sub

    <Fact>
    Public Sub Taper_VBit_Vertex_WithStock_Analytic()
        ' punta a V da 90° (45° per lato): un vertice a distanza d dall'asse, sovrametallo s
        ' la punta si ferma dove il vertice dista s dal fianco del cono: w = z - d + s·√2
        Dim t As New LocalTri(New Vec3(0, 0, 0), New Vec3(60, -1, -400), New Vec3(60, 1, -400))
        Dim tool = Taper(0, 45, "flat", 20)
        Dim s = 0.5
        Dim dc = DropCutter.ForTool(Single1(t), tool, s)
        Assert.Equal(-4 + s * Math.Sqrt(2), dc.Contact(-4, 0, -100), 3)
        ' sulla punta (offset sferico di raggio s attorno all'apice)
        Assert.Equal(s, dc.Contact(0, 0, -100), 3)
    End Sub

    Private Shared Function NoMesh(id As String) As Single()
        Return Nothing
    End Function

    <Fact>
    Public Sub Pocket_TaperBall_NoGouge()
        Dim req As New ComputeRequest With {
            .Plane = New PlaneDef(),
            .Boundary = New List(Of SketchEntityDef) From {New SketchEntityDef With {.Kind = "rect", .X1 = -20, .Y1 = -15, .X2 = 20, .Y2 = 15}},
            .Artifacts = New List(Of ArtifactDef) From {New ArtifactDef With {.Kind = "sphere", .Radius = 8, .Position = {0, 0, -6}}},
            .Operation = New OperationDef With {.Kind = "pocket", .Strategy = "concentric", .Stepover = 1, .Stepdown = 1.5, .MaxDepth = 6,
                .Stock = 0.2, .Entry = "helix", .Tool = Taper(1, 3, "ball", 15)}}
        Dim tp = CamEngine.Compute(req, AddressOf NoMesh, CancellationToken.None)
        Assert.True(tp.Points.Count > 100)
        Assert.True(tp.Stats.MaxGouge < 0.02, $"interferenza {tp.Stats.MaxGouge}")
        Dim g = PostProcessor.GCode({tp}, New PostOptions())
        Assert.Contains("CONICA PUNTA SFERICA D=1 A=3", g)
    End Sub

    <Fact>
    Public Sub Finish_VBit_NoGouge()
        Dim req As New ComputeRequest With {
            .Plane = New PlaneDef With {.Origin = {0, 0, 5}},
            .Boundary = New List(Of SketchEntityDef) From {New SketchEntityDef With {.Kind = "circle", .R = 14}},
            .Artifacts = New List(Of ArtifactDef) From {New ArtifactDef With {.Kind = "sphere", .Radius = 10, .Position = {0, 0, -10}}},
            .Operation = New OperationDef With {.Kind = "finish", .Strategy = "zigzag", .Stepover = 1, .MaxDepth = 20, .Stock = 0.1,
                .Tool = Taper(0, 30, "flat", 12)}}
        Dim tp = CamEngine.Compute(req, AddressOf NoMesh, CancellationToken.None)
        Assert.True(tp.Stats.MaxGouge < 0.02, $"interferenza {tp.Stats.MaxGouge}")
        ' la punta a V tocca la sfera (più il sovrametallo) dove la superficie è più ripida di 60°? no: sopra la
        ' calotta la punta resta a distanza ≥ sovrametallo dalla sfera
        Dim ctr As New Vec3(0, 0, -10)
        For Each p In tp.Points.Where(Function(q) q.Type = MoveType.Feed)
            Dim w = tp.Frame.ToWorld(p.U, p.V, p.W)
            Assert.True((w - ctr).Length >= 10 + 0.1 - 0.02, $"punta dentro la sfera in {w}")
        Next
    End Sub

End Class

Public Class WorkZeroTests

    Private Shared Function NoMesh(id As String) As Single()
        Return Nothing
    End Function

    Private Shared Function Pocket(fr As PlaneFrame) As Toolpath
        Dim req As New ComputeRequest With {
            .Plane = New PlaneDef With {.Origin = fr.Origin.ToArray(), .U = fr.U.ToArray(), .V = fr.V.ToArray(), .N = fr.N.ToArray()},
            .Boundary = New List(Of SketchEntityDef) From {New SketchEntityDef With {.Kind = "rect", .X1 = -10, .Y1 = -10, .X2 = 10, .Y2 = 10}},
            .Operation = New OperationDef With {.Kind = "pocket", .Stepover = 2, .Stepdown = 1, .MaxDepth = 2, .Entry = "plunge",
                .Tool = New ToolDef With {.Diameter = 4, .Number = 1}}}
        Return CamEngine.Compute(req, AddressOf NoMesh, CancellationToken.None)
    End Function

    Private Shared Function FirstXY(g As String) As (X As Double, Y As Double)
        Dim m = Regex.Match(g, "^G0 X(-?[\d.]+) Y(-?[\d.]+)", RegexOptions.Multiline)
        Return (Double.Parse(m.Groups(1).Value, Globalization.CultureInfo.InvariantCulture), Double.Parse(m.Groups(2).Value, Globalization.CultureInfo.InvariantCulture))
    End Function

    <Theory>
    <InlineData("world")>
    <InlineData("grbl")>
    <InlineData("g682")>
    Public Sub Origin_ShiftsCoordinates_OnTopPlane(mode As String)
        Dim tp = Pocket(PlaneFrame.FromNormalAngle(New Vec3(5, 5, 10), New Vec3(0, 0, 1), 0))
        Dim a = FirstXY(PostProcessor.GCode({tp}, New PostOptions With {.Mode = mode}))
        Dim gb = PostProcessor.GCode({tp}, New PostOptions With {.Mode = mode, .Origin = {12, -3, 4}, .OriginName = "Zero pezzo"})
        Dim b = FirstXY(gb)
        Assert.Equal(a.X - 12, b.X, 3)
        Assert.Equal(a.Y + 3, b.Y, 3)
        Assert.Contains("ZERO PEZZO", gb)
    End Sub

    <Fact>
    Public Sub Origin_OnTiltedPlane_Grbl_LocalCoordinatesFromZero()
        ' piano inclinato con origine in P: con zero pezzo in P le coordinate locali non cambiano
        Dim fr = PlaneFrame.FromNormalAngle(New Vec3(3, -2, 7), New Vec3(0, -1, 1), 0)
        Dim tp = Pocket(fr)
        Dim a = FirstXY(PostProcessor.GCode({tp}, New PostOptions With {.Mode = "grbl"}))
        Dim same = FirstXY(PostProcessor.GCode({tp}, New PostOptions With {.Mode = "grbl", .Origin = {3, -2, 7}}))
        Assert.Equal(a.X, same.X, 3)
        Assert.Equal(a.Y, same.Y, 3)
        ' zero spostato lungo l'asse U del piano: la X locale cambia della stessa quantità
        Dim o = fr.Origin - fr.U * 5
        Dim moved = FirstXY(PostProcessor.GCode({tp}, New PostOptions With {.Mode = "grbl", .Origin = {o.X, o.Y, o.Z}}))
        Assert.Equal(a.X + 5, moved.X, 3)
        Assert.Equal(a.Y, moved.Y, 3)
    End Sub

End Class
