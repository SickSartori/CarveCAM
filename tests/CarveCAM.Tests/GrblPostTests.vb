Imports System.Text.RegularExpressions
Imports System.Threading
Imports CarveCAM.Core.Cam
Imports CarveCAM.Core.Geometry
Imports CarveCAM.Core.Model
Imports CarveCAM.Core.Post
Imports Xunit

Public Class GrblPostTests

    Private Shared Function NoMesh(id As String) As Single()
        Return Nothing
    End Function

    Private Shared Function Pocket(fr As PlaneFrame, toolNumber As Integer, name As String) As Toolpath
        Dim req As New ComputeRequest With {
            .Plane = New PlaneDef With {.Origin = fr.Origin.ToArray(), .U = fr.U.ToArray(), .V = fr.V.ToArray(), .N = fr.N.ToArray()},
            .Boundary = New List(Of SketchEntityDef) From {New SketchEntityDef With {.Kind = "rect", .X1 = -10, .Y1 = -10, .X2 = 10, .Y2 = 10}},
            .Operation = New OperationDef With {.Name = name, .Kind = "pocket", .Stepover = 2, .Stepdown = 1, .MaxDepth = 2,
                .Entry = "helix", .Tool = New ToolDef With {.Diameter = 4, .Number = toolNumber}}}
        Return CamEngine.Compute(req, AddressOf NoMesh, CancellationToken.None)
    End Function

    Private Shared Function Code(lines As IEnumerable(Of String)) As List(Of String)
        Return lines.Select(Function(l) Regex.Replace(l, "\([^)]*\)", "").Trim()).Where(Function(l) l.Length > 0).ToList()
    End Function

    <Fact>
    Public Sub Grbl_UsesOnlySupportedWords()
        Dim top = PlaneFrame.FromNormalAngle(New Vec3(0, 0, 5), New Vec3(0, 0, 1), 0)
        Dim tilted = PlaneFrame.FromNormalAngle(New Vec3(0, 0, 0), New Vec3(0, -1, 1), 0)
        Dim g = PostProcessor.GCode({Pocket(top, 1, "Sopra"), Pocket(top, 2, "Sopra fine"), Pocket(tilted, 2, "Inclinata")},
                                    New PostOptions With {.Mode = "grbl", .ProgramName = "Prova (GRBL) con un nome di programma molto lungo che supera gli ottanta caratteri"})
        Dim lines = g.Split({vbCrLf, vbLf}, StringSplitOptions.None)
        Assert.All(lines, Sub(l) Assert.True(l.Length <= 80, $"riga oltre 80 caratteri: {l}"))
        For Each l In lines.Where(Function(x) x.StartsWith("("))
            Assert.EndsWith(")", l)
            Assert.DoesNotMatch("[()]", l.Substring(1, l.Length - 2))
        Next
        Dim allowed As New HashSet(Of String) From {"G0", "G1", "G2", "G3", "G4", "G17", "G21", "G54", "G90", "G94", "M0", "M3", "M5", "M8", "M9", "M30"}
        For Each l In Code(lines)
            For Each m As Match In Regex.Matches(l, "([A-Z])(-?[0-9.]+)")
                Dim letter = m.Groups(1).Value
                If letter = "G" OrElse letter = "M" Then
                    Dim word = letter & CInt(Double.Parse(m.Groups(2).Value, Globalization.CultureInfo.InvariantCulture))
                    Assert.True(allowed.Contains(word), $"comando non GRBL {word} in: {l}")
                Else
                    Assert.Contains(letter, {"X", "Y", "Z", "I", "J", "F", "S", "P"})
                End If
            Next
            Assert.Matches("^([A-Z]-?[0-9.]+)( [A-Z]-?[0-9.]+)*$", l)
        Next
        Assert.DoesNotContain("%", g)
        Assert.DoesNotContain("G68.2", g)
        Assert.DoesNotContain("G43", g)
        Assert.DoesNotContain("M6", g)
        Assert.Equal("M30", Code(lines).Last())
    End Sub

    <Fact>
    Public Sub Grbl_PausesForToolChangeAndSetup()
        Dim top = PlaneFrame.FromNormalAngle(New Vec3(0, 0, 5), New Vec3(0, 0, 1), 0)
        Dim tilted = PlaneFrame.FromNormalAngle(New Vec3(0, 0, 0), New Vec3(0, -1, 1), 0)
        Dim a = Pocket(top, 1, "A"), b = Pocket(top, 2, "B"), c = Pocket(tilted, 2, "C"), e = Pocket(top, 2, "E")
        Dim code1 = Code(PostProcessor.GCode({a, b, c, e}, New PostOptions With {.Mode = "grbl"}).Split({vbCrLf, vbLf}, StringSplitOptions.None))
        ' cambio utensile A→B, piazzamento inclinato B→C, ritorno al piazzamento del progetto C→E
        Assert.Equal(3, code1.Where(Function(l) l = "M0").Count())
        ' ogni pausa è preceduta dall'arresto del mandrino
        For i = 0 To code1.Count - 1
            If code1(i) = "M0" Then Assert.Contains("M5", code1.Skip(Math.Max(0, i - 2)).Take(2))
        Next
        ' stesso utensile e stesso piazzamento: nessuna pausa
        Dim code2 = Code(PostProcessor.GCode({b, e}, New PostOptions With {.Mode = "grbl"}).Split({vbCrLf, vbLf}, StringSplitOptions.None))
        Assert.DoesNotContain("M0", code2)
        Assert.Equal(2, code2.Where(Function(l) l.EndsWith(" M3")).Count())
    End Sub

    <Fact>
    Public Sub Grbl_RaisesBeforeSpindleAndUsesPlaneCoordinatesWhenTilted()
        Dim tilted = PlaneFrame.FromNormalAngle(New Vec3(10, 20, 30), New Vec3(1, 0, 1), 0)
        Dim tp = Pocket(tilted, 1, "Inclinata")
        Dim code1 = Code(PostProcessor.GCode({tp}, New PostOptions With {.Mode = "grbl", .SpindleDelay = 3}).Split({vbCrLf, vbLf}, StringSplitOptions.None))
        Dim iz = code1.FindIndex(Function(l) l.StartsWith("G0 Z"))
        Dim im = code1.FindIndex(Function(l) l.EndsWith(" M3"))
        Dim ixy = code1.FindIndex(Function(l) l.StartsWith("G0 X"))
        Assert.True(iz >= 0 AndAlso iz < im AndAlso im < ixy, "ordine atteso: salita Z, mandrino, posizionamento XY")
        Assert.Equal("G4 P3", code1(im + 1))
        ' coordinate nel sistema del piano: la prima quota è la quota di sicurezza sopra il piano
        Dim z0 = Double.Parse(code1(iz).Substring(4), Globalization.CultureInfo.InvariantCulture)
        Assert.Equal(tp.SafeW, z0, 3)
        ' pezzo da orientare prima di partire
        Assert.Equal("M0", code1(iz - 1))
    End Sub

    <Fact>
    Public Sub Fanuc_OutputUnchangedByGrblOption()
        Dim top = PlaneFrame.FromNormalAngle(New Vec3(0, 0, 5), New Vec3(0, 0, 1), 0)
        Dim g = PostProcessor.GCode({Pocket(top, 1, "A")}, New PostOptions())
        Assert.Contains("T1 M6", g)
        Assert.Contains("G43 H1 Z", g)
        Assert.StartsWith("%", g)
    End Sub

End Class
