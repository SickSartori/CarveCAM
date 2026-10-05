Imports System.Threading
Imports CarveCAM.Core.Cam
Imports CarveCAM.Core.Geometry
Imports CarveCAM.Core.Meshes
Imports CarveCAM.Core.Model
Imports Xunit

''' <summary>Grezzo: mappa di quote, asportazione, terrazze solo dove c'è materiale, grezzo residuo tra lavorazioni.</summary>
Public Class StockTests

    Private Shared Function NoMesh(id As String) As Single()
        Return Nothing
    End Function

    Private Shared Function Box(cx As Double, cy As Double, cz As Double, sx As Double, sy As Double, sz As Double) As ArtifactDef
        Return New ArtifactDef With {.Kind = "box", .Size = {sx, sy, sz}, .Position = {cx, cy, cz}}
    End Function

    Private Shared Function Plane(z As Double) As PlaneDef
        Return New PlaneDef With {.Origin = {0, 0, z}, .U = {1, 0, 0}, .V = {0, 1, 0}, .N = {0, 0, 1}}
    End Function

    Private Shared Function Rect(x1 As Double, y1 As Double, x2 As Double, y2 As Double) As SketchEntityDef
        Return New SketchEntityDef With {.Kind = "rect", .X1 = x1, .Y1 = y1, .X2 = x2, .Y2 = y2}
    End Function

    Private Shared Function Pocket(maxDepth As Double, Optional d As Double = 6) As OperationDef
        Return New OperationDef With {.Kind = "pocket", .Strategy = "concentric", .Stepover = d * 0.45, .Stepdown = 2, .MaxDepth = maxDepth,
            .Tool = New ToolDef With {.Type = "flat", .Diameter = d}, .Entry = "plunge"}
    End Function

    Private Shared Function Feeds(tp As Toolpath) As List(Of CLPoint)
        Return tp.Points.Where(Function(p) p.Type <> MoveType.Rapid).ToList()
    End Function

    <Fact>
    Public Sub Map_FromBox_TopBottomAndEmptyOutside()
        Dim tris = Primitives.Build(Box(0, 0, 10, 40, 20, 20))
        Dim m = StockMap.FromTriangles(tris, New PlaneFrame(New Vec3(0, 0, 20), Vec3.UnitX, Vec3.UnitZ))
        Dim mid = (m.Nv \ 2) * m.Nu + m.Nu \ 2
        Assert.True(m.HasMaterial(mid))
        Assert.Equal(0.0, m.Top(mid), 4)     ' sommità sul piano (z = 20)
        Assert.Equal(-20.0, m.Bottom(mid), 4)
        Assert.Equal(0.0, m.MaxTop(-100, -100, 100, 100), 4)
        Assert.Equal(Double.NegativeInfinity, m.MaxTop(50, 50, 60, 60))
    End Sub

    <Fact>
    Public Sub Pocket_StockBelowPlane_NoAirPasses_DepthFromPlane()
        ' grezzo con la sommità 5 mm sotto il piano: nessuna passata sopra z = 15, fondo a 10 mm dal piano
        Dim req As New ComputeRequest With {
            .Plane = Plane(20), .Boundary = New List(Of SketchEntityDef) From {Rect(-30, -20, 30, 20)},
            .Stock = New StockDef With {.Artifacts = New List(Of ArtifactDef) From {Box(0, 0, 7.5, 60, 40, 15)}},
            .Operation = Pocket(10)}
        Dim tp = CamEngine.Compute(req, AddressOf NoMesh, CancellationToken.None)
        Dim f = Feeds(tp).Where(Function(p) p.Type = MoveType.Feed).ToList()
        Assert.NotEmpty(f)
        Assert.True(f.Max(Function(p) p.W) <= -5 + 0.0001, $"passate sopra il grezzo: {f.Max(Function(p) p.W)}")
        Assert.Equal(-10.0, f.Min(Function(p) p.W), 4)
        Assert.NotNull(tp.StockAfter)
        ' dopo la svuotatura il grezzo al centro è sceso al fondo
        Dim m = tp.StockAfter
        Dim mid = (m.Nv \ 2) * m.Nu + m.Nu \ 2
        Assert.Equal(-10.0, m.Top(mid), 3)
    End Sub

    <Fact>
    Public Sub Pocket_StockAbovePlane_StartsFromStockTop()
        ' grezzo che sporge 3 mm sopra il piano: le terrazze partono dalla sua sommità
        Dim req As New ComputeRequest With {
            .Plane = Plane(10), .Boundary = New List(Of SketchEntityDef) From {Rect(-20, -20, 20, 20)},
            .Stock = New StockDef With {.Artifacts = New List(Of ArtifactDef) From {Box(0, 0, 6.5, 40, 40, 13)}},
            .Operation = Pocket(4)}
        Dim tp = CamEngine.Compute(req, AddressOf NoMesh, CancellationToken.None)
        Dim f = Feeds(tp).Where(Function(p) p.Type = MoveType.Feed).ToList()
        Assert.Equal(1.0, f.Max(Function(p) p.W), 4)   ' 3 - 2 (passo verticale)
        Assert.Equal(-4.0, f.Min(Function(p) p.W), 4)
        Assert.True(tp.SafeW >= 3 + 2 - 0.0001)
    End Sub

    <Fact>
    Public Sub Pocket_OnlyWhereMaterial()
        ' grezzo solo nella metà destra del contorno: nessuna passata nella metà sinistra (oltre il raggio)
        Dim req As New ComputeRequest With {
            .Plane = Plane(10), .Boundary = New List(Of SketchEntityDef) From {Rect(-40, -20, 40, 20)},
            .Stock = New StockDef With {.Artifacts = New List(Of ArtifactDef) From {Box(20, 0, 5, 40, 40, 10)}},
            .Operation = Pocket(5)}
        Dim tp = CamEngine.Compute(req, AddressOf NoMesh, CancellationToken.None)
        Dim f = Feeds(tp).Where(Function(p) p.Type = MoveType.Feed).ToList()
        Assert.NotEmpty(f)
        Assert.True(f.Min(Function(p) p.U) >= -3 - 0.6, $"passate dove non c'è grezzo: u min {f.Min(Function(p) p.U)}")
    End Sub

    <Fact>
    Public Sub Chain_SecondPocketUsesRemainingStock()
        ' seconda svuotatura uguale alla prima: il materiale è già stato tolto, restano solo pochi residui agli spigoli
        Dim mk = Function() New ComputeRequest With {
            .Plane = Plane(20), .Boundary = New List(Of SketchEntityDef) From {Rect(-30, -20, 30, 20)},
            .Stock = New StockDef With {.Artifacts = New List(Of ArtifactDef) From {Box(0, 0, 10, 60, 40, 20)}},
            .Operation = Pocket(6)}
        Dim first = CamEngine.Compute(mk(), AddressOf NoMesh, CancellationToken.None)
        Dim second = CamEngine.Compute(mk(), AddressOf NoMesh, CancellationToken.None, first)
        Dim lenA = first.Stats.FeedLength, lenB = second.Stats.FeedLength
        Assert.True(lenB < lenA * 0.2, $"seconda passata {lenB:0} mm contro {lenA:0} mm")
        ' terza: stessa zona ma più profonda, lavora solo la parte nuova (sotto i 6 mm)
        Dim deeper = mk()
        deeper.Operation = Pocket(10)
        Dim third = CamEngine.Compute(deeper, AddressOf NoMesh, CancellationToken.None, second)
        Dim f = Feeds(third).Where(Function(p) p.Type = MoveType.Feed).ToList()
        Assert.NotEmpty(f)
        Assert.True(f.Max(Function(p) p.W) <= -6 + 0.0001, $"ripassa sopra il fondo già fatto: {f.Max(Function(p) p.W)}")
    End Sub

    <Fact>
    Public Sub Chain_TiltedPlane_ReframesStock()
        ' grezzo lavorato dall'alto, poi da un fianco (normale -Y): la mappa si ricampiona nel nuovo sistema
        Dim stockBox = Box(0, 0, 10, 40, 40, 20)
        Dim top As New ComputeRequest With {
            .Plane = Plane(20), .Boundary = New List(Of SketchEntityDef) From {Rect(-20, -20, 20, 20)},
            .Stock = New StockDef With {.Artifacts = New List(Of ArtifactDef) From {stockBox}}, .Operation = Pocket(4)}
        Dim a = CamEngine.Compute(top, AddressOf NoMesh, CancellationToken.None)
        Dim side As New ComputeRequest With {
            .Plane = New PlaneDef With {.Origin = {0, -20, 10}, .U = {1, 0, 0}, .V = {0, 0, 1}, .N = {0, -1, 0}},
            .Boundary = New List(Of SketchEntityDef) From {Rect(-20, -10, 20, 10)},
            .Stock = New StockDef With {.Artifacts = New List(Of ArtifactDef) From {stockBox}}, .Operation = Pocket(3)}
        Dim b = CamEngine.Compute(side, AddressOf NoMesh, CancellationToken.None, a)
        Assert.NotNull(b.StockBefore)
        Assert.True(b.StockBefore.Frame.N.Y < -0.99)
        ' dal fianco la sommità è il piano (w = 0) nella parte bassa, dove la svuotatura dall'alto non è arrivata
        Assert.Equal(0.0, b.StockBefore.MaxTop(-15, -10, 15, 0), 1)
        Dim f = Feeds(b).Where(Function(p) p.Type = MoveType.Feed).ToList()
        Assert.NotEmpty(f)
        Assert.Equal(-3.0, f.Min(Function(p) p.W), 4)
    End Sub

    <Fact>
    Public Sub Finish_SkipsAirOverMachinedArea()
        ' finitura su un grezzo già spianato alla quota della superficie: nessun tratto di lavoro
        Dim req As New ComputeRequest With {
            .Plane = Plane(10), .Boundary = New List(Of SketchEntityDef) From {Rect(-20, -20, 20, 20)},
            .Artifacts = New List(Of ArtifactDef) From {Box(0, 0, 2.5, 60, 60, 5)},
            .Stock = New StockDef With {.Artifacts = New List(Of ArtifactDef) From {Box(0, 0, 2.5, 60, 60, 5)}},
            .Operation = New OperationDef With {.Kind = "finish", .Strategy = "zigzag", .Stepover = 1, .MaxDepth = 10,
                .Tool = New ToolDef With {.Type = "ball", .Diameter = 6}}}
        Dim tp = CamEngine.Compute(req, AddressOf NoMesh, CancellationToken.None)
        Assert.Empty(tp.Points.Where(Function(p) p.Type = MoveType.Feed))
    End Sub

End Class
