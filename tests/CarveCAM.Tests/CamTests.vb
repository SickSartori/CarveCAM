Imports System.Threading
Imports CarveCAM.Core.Cam
Imports CarveCAM.Core.Geometry
Imports CarveCAM.Core.Meshes
Imports CarveCAM.Core.Model
Imports CarveCAM.Core.Post
Imports Xunit

Public Class DropCutterTests

    Private Shared Function OneTri(a As Vec3, b As Vec3, c As Vec3, r As Double, ball As Boolean) As DropCutter
        Return New DropCutter(New List(Of LocalTri) From {New LocalTri(a, b, c)}, r, 0, ball)
    End Function

    <Fact>
    Public Sub Flat_OnHorizontalTriangle_ReturnsTriangleHeight()
        Dim dc = OneTri(New Vec3(-10, -10, -5), New Vec3(10, -10, -5), New Vec3(0, 10, -5), 3, False)
        Assert.Equal(-5, dc.Contact(0, 0, -100), 6)
        ' fuori dal triangolo ma entro il raggio: tocca lo spigolo
        Assert.Equal(-5, dc.Contact(0, -12, -100), 6)
        ' oltre il raggio: pavimento
        Assert.Equal(-100, dc.Contact(0, -13.5, -100), 6)
    End Sub

    <Fact>
    Public Sub Ball_OnVertex_UsesSphereGeometry()
        ' triangolo "a punta": vertice più alto in (0,0,0)
        Dim dc = OneTri(New Vec3(0, 0, 0), New Vec3(50, -1, -50), New Vec3(50, 1, -50), 3, True)
        ' a distanza orizzontale 2 dal vertice: centro = 0 + sqrt(9-4), punta = centro - 3
        Dim expected = Math.Sqrt(9 - 4) - 3
        Assert.Equal(expected, dc.Contact(-2, 0, -100), 6)
    End Sub

    <Fact>
    Public Sub Flat_OnSlopedFacet_TakesHighestPointInDisk()
        ' piano w = 0.5*u
        Dim dc = OneTri(New Vec3(-50, -50, -25), New Vec3(50, -50, 25), New Vec3(0, 50, 0), 2, False)
        Assert.Equal(0.5 * (0 + 2), dc.Contact(0, 0, -100), 6)
    End Sub

End Class

Public Class CamEngineTests

    Private Shared Function Rect(x1 As Double, y1 As Double, x2 As Double, y2 As Double) As SketchEntityDef
        Return New SketchEntityDef With {.Kind = "rect", .X1 = x1, .Y1 = y1, .X2 = x2, .Y2 = y2}
    End Function

    Private Shared Function NoMesh(id As String) As Single()
        Return Nothing
    End Function

    Private Shared Function XYPlane(z As Double) As PlaneDef
        Return New PlaneDef With {.Origin = {0, 0, z}, .U = {1, 0, 0}, .V = {0, 1, 0}, .N = {0, 0, 1}}
    End Function

    <Fact>
    Public Sub Pocket_NoObstacles_StaysInsideBoundaryAndReachesDepth()
        For Each strategy In {"concentric", "zigzag"}
            Dim req As New ComputeRequest With {
                .Plane = XYPlane(0),
                .Boundary = New List(Of SketchEntityDef) From {Rect(-25, -25, 25, 25)},
                .Operation = New OperationDef With {.Kind = "pocket", .Strategy = strategy, .Stepover = 2.5, .Stepdown = 2, .MaxDepth = 6,
                    .Tool = New ToolDef With {.Diameter = 6}}}
            Dim tp = CamEngine.Compute(req, AddressOf NoMesh, CancellationToken.None)
            Assert.True(tp.Points.Count > 10, strategy)
            Assert.Equal(3, tp.Stats.Levels)
            Dim feeds = tp.Points.Where(Function(p) p.Type <> MoveType.Rapid).ToList()
            Assert.All(feeds, Sub(p)
                                  Assert.InRange(p.U, -22.001, 22.001)
                                  Assert.InRange(p.V, -22.001, 22.001)
                              End Sub)
            Assert.Equal(-6, tp.Points.Min(Function(p) p.W), 6)
        Next
    End Sub

    <Fact>
    Public Sub Pocket_WithBoxArtifact_TerracesStopAtObstacle()
        For Each strategy In {"concentric", "zigzag"}
            ' box da z=-13 a z=-3
            Dim box As New ArtifactDef With {.Kind = "box", .Size = {20, 20, 10}, .Position = {0, 0, -8}}
            Dim req As New ComputeRequest With {
                .Plane = XYPlane(0),
                .Boundary = New List(Of SketchEntityDef) From {Rect(-40, -40, 40, 40)},
                .Artifacts = New List(Of ArtifactDef) From {box},
                .Operation = New OperationDef With {.Kind = "pocket", .Strategy = strategy, .Stepover = 2.5, .Stepdown = 2, .MaxDepth = 10,
                    .Tool = New ToolDef With {.Diameter = 6}}}
            Dim tp = CamEngine.Compute(req, AddressOf NoMesh, CancellationToken.None)
            Assert.Equal(5, tp.Stats.Levels)
            Assert.True(tp.Stats.MaxGouge < 0.01, $"{strategy}: gouge {tp.Stats.MaxGouge}")
            ' sotto il top del box l'utensile (R=3) deve restare fuori dal box maggiorato
            For Each p In tp.Points.Where(Function(q) q.Type <> MoveType.Rapid AndAlso q.W < -3.001)
                Dim dx = Math.Max(0, Math.Abs(p.U) - 10), dy = Math.Max(0, Math.Abs(p.V) - 10)
                Assert.True(Math.Sqrt(dx * dx + dy * dy) >= 3 - 0.01, $"{strategy}: punto {p.U},{p.V},{p.W} dentro l'ostacolo")
            Next
            ' alla prima terrazza (-2) l'area sopra il box è lavorata
            Dim pts = tp.Points
            Assert.True(Enumerable.Range(1, pts.Count - 1).Any(
                Function(i) pts(i).W = -2 AndAlso pts(i - 1).W = -2 AndAlso Math.Abs(pts(i).V) < 5 AndAlso
                            (Math.Abs(pts(i).U) < 5 OrElse Math.Sign(pts(i).U) <> Math.Sign(pts(i - 1).U))), strategy & ": area sopra il box")
            ' si avvicina al box entro stepover
            Assert.Contains(tp.Points, Function(p) p.W = -6 AndAlso Math.Max(Math.Abs(p.U), Math.Abs(p.V)) <= 13.1)
        Next
    End Sub

    <Fact>
    Public Sub Finish_BallOnSphere_TouchesWithoutGouge()
        ' sfera r=10 con sommità a z=0
        Dim sph As New ArtifactDef With {.Kind = "sphere", .Radius = 10, .Position = {0, 0, -10}}
        For Each strategy In {"zigzag", "concentric"}
            Dim req As New ComputeRequest With {
                .Plane = XYPlane(5),
                .Boundary = New List(Of SketchEntityDef) From {New SketchEntityDef With {.Kind = "circle", .Cx = 0, .Cy = 0, .R = 16}},
                .Artifacts = New List(Of ArtifactDef) From {sph},
                .Operation = New OperationDef With {.Kind = "finish", .Strategy = strategy, .Stepover = 1, .MaxDepth = 30,
                    .Tool = New ToolDef With {.Diameter = 6, .Type = "ball"}}}
            Dim tp = CamEngine.Compute(req, AddressOf NoMesh, CancellationToken.None)
            Assert.True(tp.Points.Count > 100)
            Assert.True(tp.Stats.MaxGouge < 0.02, $"gouge {tp.Stats.MaxGouge}")
            Dim touching = 0
            For Each p In tp.Points.Where(Function(q) q.Type = MoveType.Feed)
                Dim w = tp.Frame.ToWorld(p.U, p.V, p.W)
                Dim center = w + New Vec3(0, 0, 3)
                Dim dist = (center - New Vec3(0, 0, -10)).Length
                Assert.True(dist >= 13 - 0.02, $"penetrazione {13 - dist}")
                If dist < 13.02 Then touching += 1
            Next
            Assert.True(touching > 50, "la fresa deve seguire la superficie")
            ' sommità: la punta arriva a z=0 (w=-5 rispetto al piano a z=5)
            Assert.True(tp.Points.Max(Function(p) If(p.Type = MoveType.Feed, p.W, Double.MinValue)) > -5.05)
        Next
    End Sub

    <Fact>
    Public Sub Pocket_TiltedPlane_NoGouge()
        Dim n = New Vec3(1, 0, 1).Normalized()
        Dim fr = PlaneFrame.FromNormalAngle(New Vec3(0, 0, 20), n, 0)
        Dim cyl As New ArtifactDef With {.Kind = "cylinder", .Radius = 8, .Height = 30, .Position = {0, 0, 0}, .Rotation = {0, 45, 0}}
        Dim req As New ComputeRequest With {
            .Plane = New PlaneDef With {.Origin = fr.Origin.ToArray(), .U = fr.U.ToArray(), .V = fr.V.ToArray(), .N = fr.N.ToArray()},
            .Boundary = New List(Of SketchEntityDef) From {Rect(-30, -30, 30, 30)},
            .Artifacts = New List(Of ArtifactDef) From {cyl},
            .Operation = New OperationDef With {.Kind = "pocket", .Strategy = "concentric", .Stepover = 3, .Stepdown = 3, .MaxDepth = 25,
                .Tool = New ToolDef With {.Diameter = 8}}}
        Dim tp = CamEngine.Compute(req, AddressOf NoMesh, CancellationToken.None)
        Assert.True(tp.Points.Count > 10)
        Assert.True(tp.Stats.MaxGouge < 0.01, $"gouge {tp.Stats.MaxGouge}")
        ' il cilindro ha l'asse lungo N: la sua proiezione sul piano è un disco di raggio 8 (+4 utensile)
        Dim axis = fr.ToLocal(Vec3.Zero)
        Dim topW = fr.ToLocal(n * 15).Z
        Assert.DoesNotContain(tp.Points, Function(p) p.Type <> MoveType.Rapid AndAlso p.W < topW - 0.01 AndAlso
                                                     Math.Sqrt((p.U - axis.X) ^ 2 + (p.V - axis.Y) ^ 2) < 8 + 4 - 0.01)
        ' la svuotatura lavora fino a ridosso del cilindro
        Assert.Contains(tp.Points, Function(p) p.Type = MoveType.Feed AndAlso Math.Sqrt((p.U - axis.X) ^ 2 + (p.V - axis.Y) ^ 2) < 12.2)
    End Sub

    <Fact>
    Public Sub EulerZXZ_ReconstructsFrame()
        For Each nrm In {New Vec3(1, 0, 1), New Vec3(0, -1, 0.3), New Vec3(-0.2, 0.7, -0.4), New Vec3(0, 0, -1), New Vec3(0, 0, 1)}
            For Each ang In {0.0, 30.0, -120.0}
                Dim fr = PlaneFrame.FromNormalAngle(New Vec3(1, 2, 3), nrm, ang)
                Dim e = fr.EulerZXZ()
                Const D2R = Math.PI / 180
                Dim m = Mat4.Multiply(Mat4.Multiply(Mat4.RotationZ(e.Alpha * D2R), Mat4.RotationX(e.Beta * D2R)), Mat4.RotationZ(e.Gamma * D2R))
                Dim u = m.TransformPoint(Vec3.UnitX), v = m.TransformPoint(Vec3.UnitY), w = m.TransformPoint(Vec3.UnitZ)
                Assert.True((u - fr.U).Length < 0.000001, $"U {nrm} {ang}")
                Assert.True((v - fr.V).Length < 0.000001, $"V {nrm} {ang}")
                Assert.True((w - fr.N).Length < 0.000001, $"N {nrm} {ang}")
            Next
        Next
    End Sub

    <Fact>
    Public Sub GCode_ContainsToolChangeAndTiltedPlane()
        Dim fr = PlaneFrame.FromNormalAngle(New Vec3(0, 0, 0), New Vec3(0, -1, 1), 0)
        Dim req As New ComputeRequest With {
            .Plane = New PlaneDef With {.Origin = fr.Origin.ToArray(), .U = fr.U.ToArray(), .V = fr.V.ToArray(), .N = fr.N.ToArray()},
            .Boundary = New List(Of SketchEntityDef) From {Rect(-10, -10, 10, 10)},
            .Operation = New OperationDef With {.Name = "Test", .Kind = "pocket", .Stepover = 2, .Stepdown = 1, .MaxDepth = 2,
                .Tool = New ToolDef With {.Diameter = 4, .Number = 3}}}
        Dim tp = CamEngine.Compute(req, AddressOf NoMesh, CancellationToken.None)
        Dim g = PostProcessor.GCode({tp}, New PostOptions())
        Assert.Contains("T3 M6", g)
        Assert.Contains("G68.2", g)
        Assert.Contains("G69", g)
        Assert.Contains("M30", g)
        Dim cl = PostProcessor.ClData({tp}, New PostOptions())
        Assert.Contains("GOTO/", cl)
    End Sub

End Class

Public Class ImporterTests

    <Fact>
    Public Sub Stl_BinaryAndAscii_RoundTrip()
        Dim l As New List(Of Vec3)()
        Primitives.AddBox(l, 10, 20, 30)
        ' binario
        Using ms As New IO.MemoryStream()
            Dim bw As New IO.BinaryWriter(ms)
            bw.Write(New Byte(79) {})
            bw.Write(CUInt(l.Count \ 3))
            For t = 0 To l.Count - 1 Step 3
                bw.Write(0.0F) : bw.Write(0.0F) : bw.Write(0.0F)
                For k = 0 To 2
                    bw.Write(CSng(l(t + k).X)) : bw.Write(CSng(l(t + k).Y)) : bw.Write(CSng(l(t + k).Z))
                Next
                bw.Write(CUShort(0))
            Next
            bw.Flush()
            Dim pos = MeshImporter.Import("a.stl", ms.ToArray())
            Assert.Equal(12 * 9, pos.Length)
        End Using
        ' ascii
        Dim sb As New Text.StringBuilder("solid test" & vbLf)
        For t = 0 To l.Count - 1 Step 3
            sb.Append("facet normal 0 0 0" & vbLf & "outer loop" & vbLf)
            For k = 0 To 2
                sb.Append(FormattableString.Invariant($"vertex {l(t + k).X} {l(t + k).Y} {l(t + k).Z}") & vbLf)
            Next
            sb.Append("endloop" & vbLf & "endfacet" & vbLf)
        Next
        sb.Append("endsolid test" & vbLf)
        Dim pa = MeshImporter.Import("b.STL", Text.Encoding.ASCII.GetBytes(sb.ToString()))
        Assert.Equal(12 * 9, pa.Length)
    End Sub

    <Fact>
    Public Sub Obj_QuadsAreTriangulated()
        Dim obj = "v 0 0 0" & vbLf & "v 1 0 0" & vbLf & "v 1 1 0" & vbLf & "v 0 1 0" & vbLf & "f 1/1/1 2/2/1 3/3/1 4/4/1" & vbLf & "f -4 -3 -2" & vbLf
        Dim pos = MeshImporter.Import("q.obj", Text.Encoding.ASCII.GetBytes(obj))
        Assert.Equal(3 * 9, pos.Length)
    End Sub

    <Fact>
    Public Sub Ply_AsciiAndBinary()
        Dim ascii = "ply" & vbLf & "format ascii 1.0" & vbLf & "element vertex 4" & vbLf & "property float x" & vbLf & "property float y" & vbLf & "property float z" & vbLf &
                    "element face 1" & vbLf & "property list uchar int vertex_indices" & vbLf & "end_header" & vbLf &
                    "0 0 0" & vbLf & "1 0 0" & vbLf & "1 1 0" & vbLf & "0 1 0" & vbLf & "4 0 1 2 3" & vbLf
        Assert.Equal(2 * 9, MeshImporter.Import("a.ply", Text.Encoding.ASCII.GetBytes(ascii)).Length)

        Dim header = "ply" & vbLf & "format binary_little_endian 1.0" & vbLf & "element vertex 3" & vbLf & "property float x" & vbLf & "property float y" & vbLf & "property float z" & vbLf &
                     "element face 1" & vbLf & "property list uchar int vertex_indices" & vbLf & "end_header" & vbLf
        Using ms As New IO.MemoryStream()
            Dim bw As New IO.BinaryWriter(ms)
            bw.Write(Text.Encoding.ASCII.GetBytes(header))
            For Each v In {0.0F, 0.0F, 0.0F, 2.0F, 0.0F, 0.0F, 0.0F, 3.0F, 0.0F}
                bw.Write(v)
            Next
            bw.Write(CByte(3)) : bw.Write(0) : bw.Write(1) : bw.Write(2)
            bw.Flush()
            Dim pos = MeshImporter.Import("b.ply", ms.ToArray())
            Assert.Equal(9, pos.Length)
            Assert.Equal(3.0F, pos(7))
        End Using
    End Sub

    <Fact>
    Public Sub Off_Parses()
        Dim off = "OFF" & vbLf & "4 2 0" & vbLf & "0 0 0" & vbLf & "1 0 0" & vbLf & "1 1 0" & vbLf & "0 1 0" & vbLf & "3 0 1 2" & vbLf & "3 0 2 3 255 0 0" & vbLf
        Assert.Equal(2 * 9, MeshImporter.Import("x.off", Text.Encoding.ASCII.GetBytes(off)).Length)
    End Sub

End Class
