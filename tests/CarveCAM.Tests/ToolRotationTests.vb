Imports System.Text.RegularExpressions
Imports System.Threading
Imports CarveCAM.Core.Cam
Imports CarveCAM.Core.Model
Imports CarveCAM.Core.Post
Imports Xunit

''' <summary>Senso di rotazione dell'utensile e lavorazione concorde/discorde: verso dei percorsi e comandi del mandrino.</summary>
Public Class ToolRotationTests

    Private Shared Function NoMesh(id As String) As Single()
        Return Nothing
    End Function

    Private Shared Function Pocket(rotation As String, climb As Boolean, Optional number As Integer = 1) As Toolpath
        Dim req As New ComputeRequest With {
            .Plane = New PlaneDef(),
            .Boundary = New List(Of SketchEntityDef) From {New SketchEntityDef With {.Kind = "circle", .Cx = 0, .Cy = 0, .R = 15}},
            .Operation = New OperationDef With {.Name = "Cerchio", .Kind = "pocket", .Strategy = "concentric", .Stepover = 2, .Stepdown = 1, .MaxDepth = 1,
                .Entry = "helix", .Tool = New ToolDef With {.Diameter = 4, .Number = number, .Rotation = rotation, .Climb = climb}}}
        Return CamEngine.Compute(req, AddressOf NoMesh, CancellationToken.None)
    End Function

    ''' <summary>Verso prevalente dei tratti di un tipo: +1 antiorario, -1 orario (somma delle aree con segno attorno all'origine).</summary>
    Private Shared Function Turn(tp As Toolpath, type As MoveType) As Integer
        Dim a = 0.0
        For i = 1 To tp.Points.Count - 1
            Dim p = tp.Points(i - 1), q = tp.Points(i)
            If q.Type <> type OrElse p.Type = MoveType.Rapid Then Continue For
            a += p.U * q.V - q.U * p.V
        Next
        Return Math.Sign(a)
    End Function

    <Theory>
    <InlineData("cw", True, 1)>
    <InlineData("cw", False, -1)>
    <InlineData("ccw", True, -1)>
    <InlineData("ccw", False, 1)>
    Public Sub PathDirection_FollowsRotationAndClimb(rotation As String, climb As Boolean, expected As Integer)
        Dim tp = Pocket(rotation, climb)
        ' svuotatura interna: concorde con utensile orario = percorso antiorario; ogni inversione cambia il verso
        Assert.Equal(expected, Turn(tp, MoveType.Feed))
        Assert.Equal(expected, Turn(tp, MoveType.Ramp))
    End Sub

    <Fact>
    Public Sub Post_SpindleDirectionFromTool()
        Dim cw = Pocket("cw", True, 1), ccw = Pocket("ccw", True, 1)
        Dim m = MachinePresets.Grbl()
        Dim lines = PostProcessor.GCode({cw, ccw}, New PostOptions With {.Machine = m, .CoolantMode = "none"}).
            Split({vbCrLf, vbLf}, StringSplitOptions.None).Select(Function(l) Regex.Replace(l, "\([^)]*\)", "").Trim()).Where(Function(l) l.Length > 0).ToList()
        Dim i3 = lines.FindIndex(Function(l) l.EndsWith(" M3"))
        Dim i4 = lines.FindIndex(Function(l) l.EndsWith(" M4"))
        Assert.True(i3 >= 0 AndAlso i4 > i3, "M3 per l'utensile orario, poi M4 per quello antiorario")
        ' stesso utensile (nessun cambio): il mandrino si ferma prima di invertire il senso
        Assert.Contains("M5", lines.Skip(i3).Take(i4 - i3))
        Dim g = PostProcessor.GCode({ccw}, New PostOptions With {.Machine = m})
        Assert.Contains("ANTIORARIA", g)
        Assert.Contains("SPINDL/RPM,12000,CCLW", PostProcessor.ClData({ccw}, New PostOptions()))
        Assert.Contains("SPINDL/RPM,12000,CLW", PostProcessor.ClData({cw}, New PostOptions()))
    End Sub

End Class
