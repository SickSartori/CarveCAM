Imports CarveCAM.Core.Cam
Imports Xunit

Public Class ProfileTests

    ''' <summary>Rettangolo come due triangoli (il secondo in senso orario, come una faccia vista da dietro).</summary>
    Private Shared Function RectTris(x0 As Double, y0 As Double, x1 As Double, y1 As Double) As Double()
        Return {x0, y0, x1, y0, x1, y1, x0, y0, x0, y1, x1, y1}
    End Function

    ''' <summary>Corona circolare tassellata a quadrilateri spezzati in triangoli.</summary>
    Private Shared Function RingTris(r As Double, rr As Double, n As Integer) As Double()
        Dim l As New List(Of Double)()
        For i = 0 To n - 1
            Dim a0 = 2 * Math.PI * i / n, a1 = 2 * Math.PI * (i + 1) / n
            Dim p = Function(rad As Double, a As Double) {rad * Math.Cos(a), rad * Math.Sin(a)}
            Dim i0 = p(r, a0), i1 = p(r, a1), o0 = p(rr, a0), o1 = p(rr, a1)
            l.AddRange({i0(0), i0(1), o0(0), o0(1), o1(0), o1(1)})
            l.AddRange({i0(0), i0(1), o1(0), o1(1), i1(0), i1(1)})
        Next
        Return l.ToArray()
    End Function

    Private Shared Function Req(mode As String, ParamArray tris As Double()()) As ProfileRequest
        Return New ProfileRequest With {.Mode = mode, .Items = tris.Select(Function(t, i) New ProfileItem With {.Name = $"F{i + 1}", .Triangles = t}).ToList()}
    End Function

    <Fact>
    Public Sub Boolean_ModesOnOverlappingSquares()
        Dim a = RectTris(0, 0, 10, 10), b = RectTris(5, 0, 15, 10)
        Assert.Equal(150, ProfileBuilder.Build(Req("union", a, b)).Shapes.Single().Area, 2)
        Assert.Equal(50, ProfileBuilder.Build(Req("intersect", a, b)).Shapes.Single().Area, 2)
        Assert.Equal(50, ProfileBuilder.Build(Req("subtract", a, b)).Shapes.Single().Area, 2)
        Dim sep = ProfileBuilder.Build(Req("separate", a, b))
        Assert.Equal(2, sep.Shapes.Count)
        Assert.All(sep.Shapes, Sub(s) Assert.Equal(100, s.Area, 2))
    End Sub

    <Fact>
    Public Sub Shadow_OfFinelyTessellatedFace_IsOneClean4GonLoop()
        ' faccia 20x10 in 400 triangoli con orientamenti misti: un solo contorno di 4 vertici
        Dim l As New List(Of Double)()
        For i = 0 To 19
            For j = 0 To 9
                l.AddRange(RectTris(i, j, i + 1, j + 1))
            Next
        Next
        Dim s = ProfileBuilder.Build(Req("union", l.ToArray())).Shapes.Single()
        Assert.Equal(200, s.Area, 2)
        Assert.Single(s.Loops)
        Assert.Equal(8, s.Loops(0).Length)
    End Sub

    <Fact>
    Public Sub Shadow_KeepsHoles_AndOffsetGrowsOutward()
        Dim ring = RingTris(5, 10, 72)
        Dim s = ProfileBuilder.Build(Req("union", ring)).Shapes.Single()
        Assert.Equal(2, s.Loops.Count)                                 ' contorno esterno + foro
        Dim polyArea = 0.5 * 72 * Math.Sin(2 * Math.PI / 72) * (100 - 25)
        Assert.Equal(polyArea, s.Area, 1)
        Dim grown = ProfileBuilder.Build(New ProfileRequest With {.Mode = "union", .Offset = 1,
            .Items = New List(Of ProfileItem) From {New ProfileItem With {.Triangles = ring}}}).Shapes.Single()
        ' +1 mm: il bordo esterno cresce e il foro si restringe
        Assert.True(grown.Area > s.Area + 2 * Math.PI * (10 + 5) * 0.9, $"area {grown.Area}")
    End Sub

    <Fact>
    Public Sub EdgeOnFace_GivesWarningAndNoShape()
        ' faccia verticale proiettata su un piano orizzontale: triangoli degeneri
        Dim r = ProfileBuilder.Build(Req("union", {0, 0, 10, 0, 5, 0}))
        Assert.Empty(r.Shapes)
        Assert.Contains(r.Warnings, Function(w) w.Contains("di taglio"))
    End Sub

    <Fact>
    Public Sub NegativeOffset_ThatRemovesEverything_Warns()
        Dim r = New ProfileRequest With {.Mode = "union", .Offset = -6,
            .Items = New List(Of ProfileItem) From {New ProfileItem With {.Triangles = RectTris(0, 0, 10, 10)}}}
        Dim res = ProfileBuilder.Build(r)
        Assert.Empty(res.Shapes)
        Assert.NotEmpty(res.Warnings)
    End Sub

End Class
