Imports System.Threading
Imports CarveCAM.Core.Cam
Imports CarveCAM.Core.Model
Imports Xunit

''' <summary>Piano della griglia (z = 0): quota minima raggiunta dal tagliente e limite che la fresa non supera.</summary>
Public Class GridFloorTests

    Private Shared Function NoMesh(id As String) As Single()
        Return Nothing
    End Function

    Private Shared Function Plane(z As Double, Optional tiltDeg As Double = 0) As PlaneDef
        Dim a = tiltDeg * Math.PI / 180
        Return New PlaneDef With {.Origin = {0, 0, z}, .U = {Math.Cos(a), 0, -Math.Sin(a)}, .V = {0, 1, 0}, .N = {Math.Sin(a), 0, Math.Cos(a)}}
    End Function

    Private Shared Function Rect(x1 As Double, y1 As Double, x2 As Double, y2 As Double) As SketchEntityDef
        Return New SketchEntityDef With {.Kind = "rect", .X1 = x1, .Y1 = y1, .X2 = x2, .Y2 = y2}
    End Function

    Private Shared Function Op(kind As String, maxDepth As Double, Optional type As String = "flat") As OperationDef
        Return New OperationDef With {.Kind = kind, .Strategy = "concentric", .Stepover = 2.5, .Stepdown = 2, .MaxDepth = maxDepth,
            .Tool = New ToolDef With {.Type = type, .Diameter = 6}, .Entry = "plunge"}
    End Function

    Private Shared Function Run(op As OperationDef, pl As PlaneDef, Optional floor As Double? = Nothing) As Toolpath
        Dim req As New ComputeRequest With {.Plane = pl, .Boundary = New List(Of SketchEntityDef) From {Rect(-15, -10, 15, 10)}, .Operation = op, .Floor = floor}
        Return CamEngine.Compute(req, AddressOf NoMesh, CancellationToken.None)
    End Function

    <Fact>
    Public Sub LowestOffset_TiltedTools()
        Dim c = Math.Cos(Math.PI / 6)
        Assert.Equal(0.0, New ToolDef With {.Type = "flat", .Diameter = 6}.LowestOffset(1), 6)
        Assert.Equal(-1.5, New ToolDef With {.Type = "flat", .Diameter = 6}.LowestOffset(c), 3)
        Assert.Equal(-3 * (1 - c), New ToolDef With {.Type = "ball", .Diameter = 6}.LowestOffset(c), 3)
    End Sub

    <Fact>
    Public Sub Pocket_BelowGrid_MinZ_AndLimit()
        ' piano a z = 5, profondità 8: senza limite si scende a z = -3; con il limite l'ultima terrazza è a z = 0
        Dim free = Run(Op("pocket", 8), Plane(5))
        Assert.Equal(-3.0, free.Stats.MinZ, 4)
        Dim lim = Run(Op("pocket", 8), Plane(5), 0)
        Assert.True(lim.Stats.MinZ >= -0.001, $"sotto la griglia: {lim.Stats.MinZ}")
        Assert.Equal(-5.0, lim.Points.Where(Function(p) p.Type = MoveType.Feed).Min(Function(p) p.W), 3)
        Assert.Contains(lim.Warnings, Function(w) w.Contains("piano della griglia"))
    End Sub

    <Fact>
    Public Sub Pocket_AboveGrid_NoChange()
        Dim tp = Run(Op("pocket", 4), Plane(10), 0)
        Assert.Equal(6.0, tp.Stats.MinZ, 4)
        Assert.DoesNotContain(tp.Warnings, Function(w) w.Contains("piano della griglia"))
    End Sub

    <Fact>
    Public Sub Finish_BelowGrid_Limited()
        ' finitura senza superfici: la fresa scende alla profondità massima, con il limite si ferma a z = 0
        Dim free = Run(Op("finish", 6, "ball"), Plane(2))
        Assert.Equal(-4.0, free.Stats.MinZ, 4)
        Dim lim = Run(Op("finish", 6, "ball"), Plane(2), 0)
        Assert.True(lim.Stats.MinZ >= -0.001 AndAlso lim.Stats.MinZ < 0.01, $"quota minima: {lim.Stats.MinZ}")
    End Sub

    <Fact>
    Public Sub Pocket_TiltedPlane_Limited()
        ' piano inclinato di 30° a z = 4: il bordo della fresa inclinata non scende sotto la griglia
        Dim free = Run(Op("pocket", 10), Plane(4, 30))
        Assert.True(free.Stats.MinZ < -1)
        Dim lim = Run(Op("pocket", 10), Plane(4, 30), 0)
        Assert.True(lim.Stats.MinZ >= -0.01, $"sotto la griglia: {lim.Stats.MinZ}")
        Assert.NotEmpty(lim.Points.Where(Function(p) p.Type = MoveType.Feed))
    End Sub

End Class
