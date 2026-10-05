Imports System.Globalization
Imports System.Text.Json
Imports System.Text.RegularExpressions
Imports System.Threading
Imports CarveCAM.Core.Cam
Imports CarveCAM.Core.Geometry
Imports CarveCAM.Core.Model
Imports CarveCAM.Core.Post
Imports Xunit

''' <summary>Post-processor guidato dalla macchina: archi riconosciuti, corde del solo G1, sintassi e comandi.</summary>
Public Class MachinePostTests

    Private Shared ReadOnly Inv As CultureInfo = CultureInfo.InvariantCulture

    Private Shared Function NoMesh(id As String) As Single()
        Return Nothing
    End Function

    ''' <summary>Svuotatura di un cerchio (offset concentrici ad archi) con ingresso a elica.</summary>
    Private Shared Function CirclePocket(Optional toolNumber As Integer = 1, Optional feed As Double = 900) As Toolpath
        Dim req As New ComputeRequest With {
            .Plane = New PlaneDef(),
            .Boundary = New List(Of SketchEntityDef) From {New SketchEntityDef With {.Kind = "circle", .Cx = 0, .Cy = 0, .R = 15}},
            .Operation = New OperationDef With {.Name = "Cerchio", .Kind = "pocket", .Stepover = 2, .Stepdown = 1, .MaxDepth = 2,
                .Entry = "helix", .Feed = feed, .Tool = New ToolDef With {.Diameter = 4, .Number = toolNumber}}}
        Return CamEngine.Compute(req, AddressOf NoMesh, CancellationToken.None)
    End Function

    ''' <summary>Percorso ricostruito dal G-code (G0/G1/G2/G3 nel piano XY con centro IJ incrementale o R), con gli archi campionati.</summary>
    Private Shared Function Replay(g As String, m As MachineDef) As List(Of Vec3)
        Return ReplayMoves(g, m).Select(Function(x) x.P).ToList()
    End Function

    ''' <summary>Punti ricostruiti con il comando di movimento che li raggiunge (0 rapido, 1 lineare, 2/3 arco).</summary>
    Private Shared Function ReplayMoves(g As String, m As MachineDef) As List(Of (P As Vec3, G As Integer))
        Dim res As New List(Of (P As Vec3, G As Integer))()
        Dim pos As New Vec3(0, 0, 0)
        Dim motion = 0
        For Each raw In g.Split({vbCrLf, vbLf}, StringSplitOptions.RemoveEmptyEntries)
            Dim l = Regex.Replace(raw, "\([^)]*\)|;.*$", "").Trim()
            l = Regex.Replace(l, "^N\d+\s*", "")
            If l.Length = 0 OrElse l.StartsWith("%") Then Continue For
            Dim words = Regex.Matches(l, "([A-Z])\s*(-?[0-9.]+)").Cast(Of Match)().Select(Function(x) (x.Groups(1).Value, Double.Parse(x.Groups(2).Value, Inv))).ToList()
            For Each wd In words.Where(Function(x) x.Item1 = "G")
                If {0, 1, 2, 3}.Contains(CInt(wd.Item2)) AndAlso wd.Item2 = Math.Floor(wd.Item2) Then motion = CInt(wd.Item2)
            Next
            Dim val = Function(letter As String) As Double?
                          Dim f = words.FirstOrDefault(Function(x) x.Item1 = letter)
                          Return If(f.Item1 Is Nothing, CType(Nothing, Double?), f.Item2)
                      End Function
            Dim xv = val(m.AxisX), yv = val(m.AxisY), zv = val(m.AxisZ)
            If Not xv.HasValue AndAlso Not yv.HasValue AndAlso Not zv.HasValue Then Continue For
            If words.Any(Function(wd) wd.Item1 = "G" AndAlso {53.1, 68.2}.Contains(wd.Item2)) Then Continue For
            Dim target As New Vec3(If(xv, pos.X), If(yv, pos.Y), If(zv, pos.Z))
            If motion = 2 OrElse motion = 3 Then
                Dim cx, cy As Double
                Dim r = val(m.WordRadius)
                If r.HasValue Then
                    Dim dx = target.X - pos.X, dy = target.Y - pos.Y
                    Dim q = Math.Sqrt(dx * dx + dy * dy)
                    Dim hh = Math.Sqrt(Math.Max(0, r.Value * r.Value - q * q / 4))
                    Dim sgn = If((motion = 3) = (r.Value > 0), 1, -1)
                    cx = (pos.X + target.X) / 2 - sgn * hh * dy / q
                    cy = (pos.Y + target.Y) / 2 + sgn * hh * dx / q
                Else
                    cx = pos.X + If(val(m.AxisI), 0)
                    cy = pos.Y + If(val(m.AxisJ), 0)
                End If
                Dim a0 = Math.Atan2(pos.Y - cy, pos.X - cx), a1 = Math.Atan2(target.Y - cy, target.X - cx)
                Dim sweep = a1 - a0
                If motion = 3 AndAlso sweep <= 0 Then sweep += 2 * Math.PI
                If motion = 2 AndAlso sweep >= 0 Then sweep -= 2 * Math.PI
                Dim rad = Math.Sqrt((pos.X - cx) ^ 2 + (pos.Y - cy) ^ 2)
                Dim stepsN = Math.Max(4, CInt(Math.Ceiling(Math.Abs(sweep) / (Math.PI / 360))))
                For k = 1 To stepsN
                    Dim f = k / stepsN
                    res.Add((New Vec3(cx + rad * Math.Cos(a0 + sweep * f), cy + rad * Math.Sin(a0 + sweep * f), pos.Z + (target.Z - pos.Z) * f), motion))
                Next
            Else
                res.Add((target, motion))
            End If
            pos = target
        Next
        Return res
    End Function

    Private Shared Function DistToPolyline(p As Vec3, poly As List(Of Vec3)) As Double
        Dim best = Double.MaxValue
        For i = 0 To poly.Count - 2
            Dim a = poly(i), b = poly(i + 1)
            Dim ab = b - a
            Dim l2 = ab.Dot(ab)
            Dim t = If(l2 > 0, Math.Max(0, Math.Min(1, (p - a).Dot(ab) / l2)), 0)
            Dim d = (a + ab * t - p).Length
            If d < best Then best = d
        Next
        Return best
    End Function

    Private Shared Function MaxDeviation(tp As Toolpath, path As List(Of Vec3)) As Double
        Dim worst = 0.0
        For i = 0 To tp.Points.Count - 1
            If tp.Points(i).Type = MoveType.Rapid Then Continue For
            worst = Math.Max(worst, DistToPolyline(tp.WorldPoint(i), path))
        Next
        Return worst
    End Function

    Private Shared Function Code(g As String) As List(Of String)
        Return g.Split({vbCrLf, vbLf}, StringSplitOptions.None).Select(Function(l) Regex.Replace(l, "\([^)]*\)|;.*$", "").Trim()).Where(Function(l) l.Length > 0).ToList()
    End Function

    <Theory>
    <InlineData("ij")>
    <InlineData("ijabs")>
    <InlineData("r")>
    Public Sub Arcs_FollowThePathWithinTolerance(format As String)
        Dim tp = CirclePocket()
        Dim m = MachinePresets.Grbl()
        m.ArcFormat = format
        Dim g = PostProcessor.GCode({tp}, New PostOptions With {.Machine = m})
        Dim lines = Code(g)
        Dim arcs = lines.Where(Function(l) Regex.IsMatch(l, "^G[23] ")).Count() + lines.Where(Function(l) Regex.IsMatch(l, "^[XYZ]") AndAlso (l.Contains(" I") OrElse l.Contains(" R"))).Count()
        Assert.True(arcs > 4, $"archi attesi, trovati {arcs}")
        If format = "ijabs" Then
            ' centro assoluto: rileggendo come incrementale il percorso sarebbe sbagliato, si controlla solo il centro (0, 0)
            Assert.Contains(lines, Function(l) Regex.IsMatch(l, " I0 J0( |$)"))
            Return
        End If
        Dim dev = MaxDeviation(tp, Replay(g, m))
        Assert.True(dev < 0.01, $"scostamento {dev} mm")
        ' molte meno righe che con un segmento per punto
        Dim g1 = MachinePresets.Grbl()
        g1.Arcs = False : g1.ChordTolerance = 0
        Assert.True(lines.Count * 2 < Code(PostProcessor.GCode({tp}, New PostOptions With {.Machine = g1})).Count)
    End Sub

    <Fact>
    Public Sub Arcs_HelixEntryIsHelical()
        Dim tp = CirclePocket()
        Dim m = MachinePresets.Grbl()
        Dim lines = Code(PostProcessor.GCode({tp}, New PostOptions With {.Machine = m}))
        ' almeno un arco con la Z che cambia (elica di ingresso)
        Assert.Contains(lines, Function(l) Regex.IsMatch(l, "^(G[23] )?X.* Z-?[0-9.]+ I"))
        m.ArcHelical = False
        Dim flat = Code(PostProcessor.GCode({tp}, New PostOptions With {.Machine = m}))
        Assert.DoesNotContain(flat, Function(l) Regex.IsMatch(l, "Z-?[0-9.]+ I"))
        Assert.True(MaxDeviation(tp, Replay(String.Join(vbLf, flat), m)) < 0.01)
    End Sub

    <Fact>
    Public Sub OnlyG1_ChordsWithinLimits()
        Dim tp = CirclePocket()
        Dim m = MachinePresets.GenericG1()
        m.ChordTolerance = 0.02 : m.ChordMin = 0.5 : m.ChordMax = 2
        Dim g = PostProcessor.GCode({tp}, New PostOptions With {.Machine = m})
        Dim lines = Code(g)
        Assert.DoesNotContain(lines, Function(l) Regex.IsMatch(l, "^G[23]\b"))
        Assert.DoesNotContain(lines, Function(l) l.Contains(" I") OrElse l.Contains(" J"))
        Dim path = Replay(g, m)
        ' scostamento entro la freccia delle corde (lunghe almeno 0,5 mm) e la tolleranza di riconoscimento
        Assert.True(MaxDeviation(tp, path) < 0.1, $"scostamento {MaxDeviation(tp, path)}")
        ' corde dei movimenti di lavoro non più lunghe di 2 mm
        Dim moves = ReplayMoves(g, m)
        Dim feedLens = New List(Of Double)()
        For i = 1 To moves.Count - 1
            Dim len = (moves(i).P - moves(i - 1).P).Length
            If moves(i).G = 1 AndAlso len > 0.0001 Then feedLens.Add(len)
        Next
        Assert.True(feedLens.Max() <= 2.0 + 0.002, $"corda massima superata: {feedLens.Max()}")
        ' errore di corda più fine: più segmenti
        m.ChordTolerance = 0.002 : m.ChordMin = 0 : m.ChordMax = 0
        Dim fine = Code(PostProcessor.GCode({tp}, New PostOptions With {.Machine = m}))
        Assert.True(fine.Count > lines.Count)
        Assert.True(MaxDeviation(tp, Replay(String.Join(vbLf, fine), m)) < 0.01)
    End Sub

    <Fact>
    Public Sub Syntax_LineNumbersCommentsAliasesAndInversion()
        Dim tp = CirclePocket()
        Dim m = MachinePresets.Grbl()
        m.LineNumbers = True : m.LineStart = 100 : m.LineStep = 5
        m.CommentStyle = "semicolon"
        m.AxisX = "A" : m.AxisY = "B"
        m.NumberStyle = "zeros" : m.Decimals = 2
        m.InvertX = True
        m.Header = {"(PROVA {NAME})", "G21 G90"}
        Dim g = PostProcessor.GCode({tp}, New PostOptions With {.Machine = m, .ProgramName = "Targa"})
        Dim raw = g.Split({vbCrLf}, StringSplitOptions.RemoveEmptyEntries)
        Assert.Equal("; PROVA TARGA", raw(0))
        Assert.Equal("N100 G21 G90", raw(1))
        Assert.StartsWith("N105 ", raw.Where(Function(l) l.StartsWith("N")).ElementAt(1))
        Assert.DoesNotContain(raw, Function(l) l.Contains("("))
        Assert.Contains(raw, Function(l) Regex.IsMatch(l, "^N\d+ G0 A-?\d+\.\d\d B-?\d+\.\d\d$"))
        Assert.DoesNotContain(raw, Function(l) Regex.IsMatch(l, "\bX-?\d"))
        ' asse X invertito: le A sono le X cambiate di segno
        Dim first = tp.WorldPoint(0)
        Dim a = raw.First(Function(l) Regex.IsMatch(l, " G0 A"))
        Dim av = Double.Parse(Regex.Match(a, " A(-?[\d.]+)").Groups(1).Value, Inv)
        Assert.Equal(-first.X, av, 2)
        ' fine riga solo LF
        m.LineEnd = "lf"
        Assert.DoesNotContain(vbCr, PostProcessor.GCode({tp}, New PostOptions With {.Machine = m}))
    End Sub

    <Fact>
    Public Sub Motion_SpindleCoolantFanAndToolChange()
        Dim a = CirclePocket(1), b = CirclePocket(2)
        b.Kind = "finish"
        Dim m = MachinePresets.LinuxCnc()
        m.SmoothTolerance = 0.05
        m.MotionFinish = "exact"
        m.Fan = "program" : m.FanOn = {"M10"} : m.FanOff = {"M11"}
        m.SpindleDirection = "ccw"
        m.ToolChangeAuto = {"T{T} M6", "(UTENSILE {TOOL} D{D})"}
        Dim lines = Code(PostProcessor.GCode({a, b}, New PostOptions With {.Machine = m, .CoolantMode = "mist"}))
        Assert.Contains("G64 P0.05", lines)
        Assert.Contains("G61", lines)
        Assert.True(lines.IndexOf("G64 P0.05") < lines.IndexOf("G61"))
        Assert.Equal("G64", lines(lines.Count - 4))   ' ripristino a fine programma, prima di G49 M30 %
        Assert.Contains("T1 M6", lines)
        Assert.Contains("T2 M6", lines)
        Assert.Contains(lines, Function(l) l.EndsWith(" M4"))
        Assert.DoesNotContain(lines, Function(l) l.EndsWith(" M3"))
        Assert.Contains("M7", lines)
        Assert.DoesNotContain("M8", lines)
        Assert.Contains("M10", lines)
        Assert.True(lines.IndexOf("M11") > lines.IndexOf("T2 M6"))
        Assert.Contains(lines, Function(l) l.StartsWith("G43 H2") OrElse l.StartsWith("G0 G43 H2"))
    End Sub

    <Fact>
    Public Sub ManualSpindle_PausesWithInstructions()
        Dim tp = CirclePocket()
        Dim m = MachinePresets.Grbl()
        m.SpindleControl = "manual"
        Dim g = PostProcessor.GCode({tp}, New PostOptions With {.Machine = m, .CoolantMode = "none"})
        Assert.Contains("ACCENDERE IL MANDRINO", g)
        Assert.DoesNotContain(" M3", g)
        Assert.Contains("M0", Code(g))
        Assert.Contains("SPEGNERE IL MANDRINO", g)
    End Sub

    <Fact>
    Public Sub Limits_GiveWarnings()
        Dim tp = CirclePocket(1, 5000)
        tp.Spindle = 30000
        Dim m = MachinePresets.Grbl()
        m.MaxFeed = 2000 : m.SpindleMax = 24000 : m.TravelX = 20
        Dim warn As New List(Of String)()
        Dim g = PostProcessor.GCode({tp}, New PostOptions With {.Machine = m}, warn)
        Assert.Equal(3, warn.Count)
        Assert.Contains("ATTENZIONE", g)
        Assert.Contains("S24000", g)
        Assert.DoesNotContain(Code(g), Function(l) Regex.IsMatch(l, "F5000"))
        Assert.Contains(Code(g), Function(l) l.Contains("F2000"))
    End Sub

    <Fact>
    Public Sub Presets_AreValidAndSerializable()
        Dim opts As New JsonSerializerOptions(JsonSerializerDefaults.Web)
        For Each m In MachinePresets.All()
            Assert.False(String.IsNullOrWhiteSpace(m.Id))
            Dim json = JsonSerializer.Serialize(m, opts)
            Assert.Contains("""arcTolerance""", json)
            Dim back = JsonSerializer.Deserialize(Of MachineDef)(json, opts)
            Assert.Equal(m.Name, back.Name)
            Assert.Equal(m.Header, back.Header)
            Dim g = PostProcessor.GCode({CirclePocket()}, New PostOptions With {.Machine = back})
            Assert.Contains("M30", g)
        Next
    End Sub

End Class
