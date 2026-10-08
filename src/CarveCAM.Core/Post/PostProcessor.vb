Imports System.Globalization
Imports System.Text
Imports System.Text.RegularExpressions
Imports CarveCAM.Core.Cam
Imports CarveCAM.Core.Geometry

Namespace Post

    Public Class PostOptions
        ''' <summary>
        ''' Macchina del magazzino. Senza macchina vale il vecchio campo Mode: "g682" Fanuc/ISO con piano inclinato
        ''' G68.2, "world" Fanuc/ISO in coordinate mondo, "grbl" GRBL 1.1 e compatibili.
        ''' </summary>
        Public Property Machine As MachineDef
        Public Property Mode As String = "g682"
        Public Property ProgramNumber As Integer = 1000
        ''' <summary>Decimali delle coordinate (solo senza macchina: con la macchina valgono i suoi).</summary>
        Public Property Decimals As Integer = 3
        ''' <summary>Refrigerante acceso (solo se CoolantMode non è indicato: allora vale quello predefinito della macchina, o a pioggia).</summary>
        Public Property Coolant As Boolean = True
        ''' <summary>Refrigerante per questa esportazione: "none", "flood", "mist", "air" (vuoto = da Coolant).</summary>
        Public Property CoolantMode As String
        Public Property ProgramName As String = "CARVECAM"
        ''' <summary>GRBL senza macchina: attesa in secondi dopo M3 perché il mandrino arrivi in velocità.</summary>
        Public Property SpindleDelay As Double = 2
        ''' <summary>
        ''' Zero pezzo del programma: punto di riferimento [x, y, z] nelle coordinate del progetto (Nothing = origine
        ''' del progetto). Le coordinate in uscita sono relative a questo punto.
        ''' </summary>
        Public Property Origin As Double() = Nothing
        ''' <summary>Nome del punto di riferimento, riportato nei commenti per l'azzeramento.</summary>
        Public Property OriginName As String = ""

        Public Function OriginPoint() As Vec3
            If Origin Is Nothing OrElse Origin.Length < 3 Then Return Vec3.Zero
            Return New Vec3(Origin(0), Origin(1), Origin(2))
        End Function

        Public ReadOnly Property HasOrigin As Boolean
            Get
                Return Origin IsNot Nothing AndAlso Origin.Length >= 3
            End Get
        End Property

        ''' <summary>Macchina da usare: quella indicata, oppure quella predefinita del vecchio campo Mode.</summary>
        Public Function ResolveMachine() As MachineDef
            If Machine IsNot Nothing Then Return Machine.Clone()
            Dim m = MachinePresets.FromMode(Mode)
            m.Decimals = Math.Max(0, Math.Min(6, Decimals))
            If m.Id = "grbl" Then m.SpindleDelay = SpindleDelay
            Return m
        End Function
    End Class

    ''' <summary>
    ''' Post-processor G-code guidato dalla macchina del magazzino (sintassi, archi o solo G1, mandrino, refrigerante,
    ''' aspirazione, cambio utensile, piani inclinati) e CL data (APT) per i percorsi calcolati.
    ''' </summary>
    Public Module PostProcessor

        Private ReadOnly Inv As CultureInfo = CultureInfo.InvariantCulture

        Private Function F(v As Double, dec As Integer) As String
            Dim r = Math.Round(v, dec)
            If r = 0 Then r = 0 ' evita "-0"
            Return r.ToString("0." & New String("#"c, dec), Inv)
        End Function

        Private Function StrategyLabel(s As String) As String
            Return If(String.Equals(s, "zigzag", StringComparison.OrdinalIgnoreCase), "ZIGZAG", "CONCENTRICA")
        End Function

        Private Function ToolLabel(t As Model.ToolDef, d As Integer) As String
            If t.IsTaper Then
                Return $"CONICA {If(t.TipIsBall, "PUNTA SFERICA", If(t.Diameter > 0, "PUNTA PIATTA", "A V"))} D={F(t.Diameter, d)} A={F(t.TaperAngle, 2)} GRADI PER LATO DMAX={F(2 * t.MaxRadius, d)}"
            End If
            Dim label As String
            If t.IsBall Then
                label = $"SFERICA D={F(t.Diameter, d)}"
            ElseIf t.IsBull Then
                label = $"TORICA D={F(t.Diameter, d)} R={F(t.EffectiveCorner, d)}"
            Else
                label = $"CILINDRICA D={F(t.Diameter, d)}"
            End If
            Return If(t.IsCcw, label & " ANTIORARIA", label)
        End Function

        Private Function FeedOf(tp As Toolpath, t As MoveType) As Double
            Select Case t
                Case MoveType.Plunge : Return tp.Plunge
                Case MoveType.Ramp : Return If(tp.RampFeed > 0, tp.RampFeed, tp.Feed)
                Case Else : Return tp.Feed
            End Select
        End Function

        ''' <summary>Testo per commenti e nomi: solo ASCII (lettere accentate senza accento, ° in GRADI), niente parentesi.</summary>
        Private Function Clean(s As String, Optional upper As Boolean = True) As String
            Dim t = If(s, "").Replace("°", " GRADI").Normalize(NormalizationForm.FormD)
            Dim sb As New StringBuilder(t.Length)
            For Each ch In t
                If CharUnicodeInfo.GetUnicodeCategory(ch) = UnicodeCategory.NonSpacingMark Then Continue For
                If AscW(ch) >= 32 AndAlso AscW(ch) < 127 Then sb.Append(ch)
            Next
            Dim r = sb.ToString().Replace("(", "[").Replace(")", "]")
            Return If(upper, r.ToUpperInvariant(), r)
        End Function

        Private Function OperationLabel(tp As Toolpath) As String
            Return $"{Clean(tp.Name)} - {If(tp.Kind = "pocket", "SVUOTATURA A TERRAZZE", "FINITURA")} {StrategyLabel(tp.Strategy)}"
        End Function

        ''' <summary>Punto in uscita: coordinate locali del piano o mondo, più lo spostamento dello zero pezzo.</summary>
        Private Function PointXYZ(fr As PlaneFrame, p As CLPoint, local As Boolean, shift As Vec3) As Vec3
            Return If(local, New Vec3(p.U, p.V, p.W), fr.ToWorld(p.U, p.V, p.W)) + shift
        End Function

        ''' <summary>
        ''' Spostamento da applicare alle coordinate perché siano relative allo zero pezzo: in coordinate mondo si
        ''' sottrae il punto; in coordinate locali del piano si aggiunge l'origine del piano vista dallo zero.
        ''' </summary>
        Private Function ShiftOf(fr As PlaneFrame, local As Boolean, opt As PostOptions) As Vec3
            ' senza zero pezzo: coordinate mondo o locali del piano invariate
            If Not opt.HasOrigin Then Return Vec3.Zero
            Dim o = opt.OriginPoint()
            If Not local Then Return -o
            Dim dlt = fr.Origin - o
            Return New Vec3(dlt.Dot(fr.U), dlt.Dot(fr.V), dlt.Dot(fr.N))
        End Function

        Private Function OriginLabel(opt As PostOptions, d As Integer) As String
            Dim o = opt.OriginPoint()
            Dim name = If(String.IsNullOrWhiteSpace(opt.OriginName), "ORIGINE", opt.OriginName)
            Return $"{name} X={F(o.X, d)} Y={F(o.Y, d)} Z={F(o.Z, d)}"
        End Function

        ''' <summary>Stesso piazzamento del pezzo: entrambi con asse utensile +Z mondo, oppure lo stesso piano inclinato.</summary>
        Private Function SameSetup(a As PlaneFrame, b As PlaneFrame) As Boolean
            If a Is Nothing OrElse b Is Nothing Then Return False
            If a.IsWorldAligned AndAlso b.IsWorldAligned Then Return True
            Return (a.N - b.N).Length < 0.000001 AndAlso (a.U - b.U).Length < 0.000001 AndAlso (a.Origin - b.Origin).Length < 0.001
        End Function

        ' ================================================================ scrittura delle righe
        ''' <summary>Righe del programma con la sintassi della macchina e lo stato modale (movimento, piano, avanzamento, posizione).</summary>
        Private NotInheritable Class GWriter
            Private ReadOnly _m As MachineDef
            Private ReadOnly _lines As New List(Of String)()
            Private _no As Integer
            Public LastMotion As String = ""
            Public LastPlane As Integer = 17
            Public LastFeed As String = ""
            ''' <summary>Ultima posizione scritta, arrotondata come nel programma.</summary>
            Public Pos As Vec3
            Private ReadOnly _known(2) As Boolean

            Public Sub New(m As MachineDef)
                _m = m
                _no = m.LineStart
            End Sub

            Public Sub Blank()
                If _lines.Count > 0 AndAlso _lines(_lines.Count - 1) <> "" Then _lines.Add("")
            End Sub

            ''' <summary>Riga di codice (con il numero di riga, se richiesto).</summary>
            Public Sub Code(text As String)
                If String.IsNullOrWhiteSpace(text) Then Return
                text = text.Trim()
                If _m.LineNumbers AndAlso Not text.StartsWith("%") Then
                    text = $"{_m.LineLetter}{_no}{If(_m.SpaceWords, " ", "")}{text}"
                    _no += Math.Max(1, _m.LineStep)
                End If
                _lines.Add(text)
            End Sub

            ''' <summary>Commento nello stile della macchina (parentesi o punto e virgola), entro la lunghezza massima.</summary>
            Public Sub Comment(text As String)
                If _m.CommentStyle = "none" Then Return
                Dim t = Clean(text, _m.CommentUppercase).Trim()
                If t.Length = 0 Then Return
                Dim semi = _m.CommentStyle = "semicolon"
                Dim room = If(_m.CommentMaxLength > 0, _m.CommentMaxLength - If(semi, 2, 0), Integer.MaxValue)
                If t.Length > room Then t = t.Substring(0, Math.Max(1, room)).TrimEnd()
                _lines.Add(If(semi, "; " & t, "(" & t & ")"))
            End Sub

            ''' <summary>Righe di comando della macchina con i segnaposto: "(testo)" e "; testo" diventano commenti.</summary>
            Public Sub Template(lines As IEnumerable(Of String), vars As IDictionary(Of String, String))
                If lines Is Nothing Then Return
                For Each raw In lines
                    Dim s = Expand(If(raw, ""), vars).Trim()
                    If s.Length = 0 Then Continue For
                    If s.StartsWith("(") AndAlso s.EndsWith(")") AndAlso s.IndexOf("("c, 1) < 0 Then
                        Comment(s.Substring(1, s.Length - 2))
                    ElseIf s.StartsWith(";") Then
                        Comment(s.Substring(1))
                    Else
                        Code(s)
                    End If
                Next
            End Sub

            Public Function Num(v As Double, dec As Integer) As String
                dec = Math.Max(0, Math.Min(6, dec))
                Dim r = Math.Round(v, dec)
                If r = 0 Then r = 0
                If dec = 0 Then
                    Dim s0 = r.ToString("0", Inv)
                    Return If(_m.NumberStyle = "point", s0 & ".", s0)
                End If
                Select Case _m.NumberStyle
                    Case "zeros" : Return r.ToString("0." & New String("0"c, dec), Inv)
                    Case "point"
                        Dim s = r.ToString("0." & New String("#"c, dec), Inv)
                        Return If(s.Contains("."c), s, s & ".")
                    Case Else : Return r.ToString("0." & New String("#"c, dec), Inv)
                End Select
            End Function

            Public Function Word(letter As String, value As String) As String
                Return letter & If(_m.SpaceAfterLetter, " ", "") & value
            End Function

            Public Function Join(words As IEnumerable(Of String)) As String
                Return String.Join(If(_m.SpaceWords, " ", ""), words.Where(Function(x) Not String.IsNullOrEmpty(x)))
            End Function

            Private Function AxisName(i As Integer) As String
                Return If(i = 0, _m.AxisX, If(i = 1, _m.AxisY, _m.AxisZ))
            End Function

            Private Shared Function Comp(p As Vec3, i As Integer) As Double
                Return If(i = 0, p.X, If(i = 1, p.Y, p.Z))
            End Function

            ''' <summary>
            ''' Movimento verso target sugli assi indicati (mask: X, Y, Z): comando se cambia (o sempre con force),
            ''' solo le coordinate che cambiano (con la sintassi modale), parole aggiuntive e avanzamento.
            ''' </summary>
            Public Sub Move(motion As String, target As Vec3, mask As Boolean(), Optional extra As IEnumerable(Of String) = Nothing,
                            Optional feed As Double = Double.NaN, Optional forceMotion As Boolean = False, Optional forceAxes As Boolean() = Nothing)
                Dim words As New List(Of String)()
                Dim coords As New List(Of String)()
                Dim v(2) As Double
                v(0) = Pos.X : v(1) = Pos.Y : v(2) = Pos.Z
                For i = 0 To 2
                    If Not mask(i) Then Continue For
                    Dim s = Num(Comp(target, i), _m.Decimals)
                    Dim was = Num(Comp(Pos, i), _m.Decimals)
                    Dim force = forceAxes IsNot Nothing AndAlso forceAxes(i)
                    If Not _m.ModalCoords OrElse Not _known(i) OrElse s <> was OrElse force Then coords.Add(Word(AxisName(i), s))
                    v(i) = Double.Parse(s, Inv)
                    _known(i) = True
                Next
                If coords.Count = 0 AndAlso extra Is Nothing Then Return
                If forceMotion OrElse Not _m.ModalMotion OrElse motion <> LastMotion Then words.Add(motion)
                LastMotion = motion
                If extra IsNot Nothing Then words.AddRange(extra)
                words.AddRange(coords)
                If Not Double.IsNaN(feed) Then
                    Dim fs = Num(feed, _m.FeedDecimals)
                    If fs <> LastFeed OrElse Not _m.ModalCoords Then words.Add(Word(_m.WordFeed, fs)) : LastFeed = fs
                End If
                Code(Join(words))
                Pos = New Vec3(v(0), v(1), v(2))
            End Sub

            ''' <summary>Arco: parole prima del comando (piano), coordinate (quelle del piano sempre), centro o raggio, avanzamento.</summary>
            Public Sub MoveArc(motion As String, target As Vec3, pre As List(Of String), post As List(Of String), forceAxes As Boolean(), feed As Double)
                Dim words As New List(Of String)(pre)
                If Not _m.ModalMotion OrElse motion <> LastMotion OrElse pre.Count > 0 Then words.Add(motion)
                LastMotion = motion
                Dim v(2) As Double
                For i = 0 To 2
                    Dim s = Num(Comp(target, i), _m.Decimals)
                    Dim was = Num(Comp(Pos, i), _m.Decimals)
                    If Not _m.ModalCoords OrElse Not _known(i) OrElse s <> was OrElse forceAxes(i) Then words.Add(Word(AxisName(i), s))
                    v(i) = Double.Parse(s, Inv)
                    _known(i) = True
                Next
                words.AddRange(post)
                Dim fs = Num(feed, _m.FeedDecimals)
                If fs <> LastFeed OrElse Not _m.ModalCoords Then words.Add(Word(_m.WordFeed, fs)) : LastFeed = fs
                Code(Join(words))
                Pos = New Vec3(v(0), v(1), v(2))
            End Sub

            Public Function Text() As String
                Dim eol = If(_m.LineEnd = "lf", vbLf, vbCrLf)
                Dim list = _lines.ToList()
                While list.Count > 0 AndAlso list(list.Count - 1) = "" : list.RemoveAt(list.Count - 1) : End While
                Return String.Join(eol, list) & eol
            End Function
        End Class

        ''' <summary>Sostituisce i segnaposto {CHIAVE} con i valori (le chiavi sconosciute restano).</summary>
        Private Function Expand(s As String, vars As IDictionary(Of String, String)) As String
            If vars Is Nothing OrElse s.IndexOf("{"c) < 0 Then Return s
            Return Regex.Replace(s, "\{([A-Za-z]+)\}", Function(mt)
                                                          Dim v As String = Nothing
                                                          Return If(vars.TryGetValue(mt.Groups(1).Value.ToUpperInvariant(), v), v, mt.Value)
                                                      End Function)
        End Function

        ''' <summary>La riga contiene una pausa programmata (M0, M00, M1, M01).</summary>
        Private Function HasPause(lines As IEnumerable(Of String)) As Boolean
            Return lines IsNot Nothing AndAlso lines.Any(Function(l) Regex.IsMatch(If(l, ""), "(^|\s)M0*[01](\s|$|;|\()", RegexOptions.IgnoreCase))
        End Function

        ' ================================================================ G-code
        Public Function GCode(paths As IEnumerable(Of Toolpath), opt As PostOptions) As String
            Return GCode(paths, opt, Nothing)
        End Function

        ''' <summary>G-code per la macchina delle opzioni; warnings riceve gli avvisi (corse, avanzamenti, giri), scritti anche come commenti.</summary>
        Public Function GCode(paths As IEnumerable(Of Toolpath), opt As PostOptions, warnings As List(Of String)) As String
            Dim m = opt.ResolveMachine()
            Dim w As New GWriter(m)
            Dim warn = If(warnings, New List(Of String)())
            Dim list = paths.Where(Function(t) t.Points.Count > 0).ToList()
            Dim d = m.Decimals
            Dim delay = Math.Max(0, Math.Min(600, m.SpindleDelay))
            Dim baseVars As New Dictionary(Of String, String) From {
                {"NAME", Clean(opt.ProgramName)}, {"PROG", opt.ProgramNumber.ToString("0000", Inv)},
                {"DATE", DateTime.Now.ToString("yyyy-MM-dd", Inv)}, {"TIME", DateTime.Now.ToString("HH:mm", Inv)},
                {"TOL", w.Num(m.SmoothTolerance, 4).TrimEnd("."c)}, {"SEC", F(delay, 2)}, {"MS", CInt(Math.Round(delay * 1000)).ToString(Inv)}}
            Dim coolant = CoolantOf(opt, m)
            CheckLimits(list, m, opt, warn)

            w.Template(m.Header, baseVars)
            If opt.HasOrigin Then w.Comment($"ZERO PEZZO: {OriginLabel(opt, d)}")
            For Each x In warn : w.Comment("ATTENZIONE: " & x) : Next
            If m.Fan = "program" Then w.Template(m.FanOn, baseVars)

            Dim pauseMode = m.Tilt = "pause"
            Dim lastTool = -1
            Dim lastFrame As PlaneFrame = Nothing
            Dim setupNo = 0
            Dim st As New SpindleState()
            Dim motion = "none"
            For i = 0 To list.Count - 1
                Dim tp = list(i)
                Dim fr = tp.Frame
                Dim aligned = fr.IsWorldAligned
                Dim local = Not aligned AndAlso m.Tilt <> "world"
                Dim tilted682 = Not aligned AndAlso m.Tilt = "g682"
                Dim newSetup = pauseMode AndAlso Not SameSetup(lastFrame, fr)
                Dim newTool = tp.Tool.Number <> lastTool
                Dim vars = OpVars(baseVars, tp, m, w, d)
                w.Blank()
                ' prima di una pausa o di un cambio utensile: refrigerante e mandrino fermi, utensile alla quota di sicurezza
                If i > 0 AndAlso st.On AndAlso (newTool OrElse newSetup) Then StopSpindle(w, m, coolant, st, vars)
                If newSetup Then setupNo += 1 : AppendSetup(w, setupNo, fr, d, opt)
                Dim paused = False
                If newTool Then
                    Select Case m.ToolChange
                        Case "auto"
                            w.Comment($"UTENSILE T{tp.Tool.Number} {ToolLabel(tp.Tool, d)}")
                            w.Template(m.ToolChangeAuto, vars)
                        Case "manual"
                            If i = 0 Then
                                w.Comment($"UTENSILE: T{tp.Tool.Number} {ToolLabel(tp.Tool, d)}")
                            Else
                                w.Template(m.ToolChangeManual, vars)
                                paused = HasPause(m.ToolChangeManual)
                            End If
                        Case Else
                            w.Comment($"UTENSILE T{tp.Tool.Number} {ToolLabel(tp.Tool, d)}")
                    End Select
                End If
                ' pausa per orientare il pezzo (piazzamento nuovo, o primo piano inclinato)
                If pauseMode AndAlso Not paused AndAlso ((i > 0 AndAlso newSetup) OrElse (i = 0 AndAlso local)) Then w.Code("M0")
                lastFrame = fr
                lastTool = tp.Tool.Number

                w.Comment($"OP {i + 1}: {OperationLabel(tp)}")
                If Not aligned Then w.Comment($"ASSE UTENSILE I={F(fr.N.X, 6)} J={F(fr.N.Y, 6)} K={F(fr.N.Z, 6)}")
                w.Template(m.OperationStart, vars)
                ' movimento esatto o smooth per il tipo di lavorazione
                Dim want = If(tp.Kind = "finish", m.MotionFinish, m.MotionPocket)
                If (want = "exact" OrElse want = "smooth") AndAlso want <> motion Then
                    w.Template({If(want = "exact", m.MotionExact, m.MotionSmooth)}, vars)
                    motion = want
                End If
                If tilted682 Then
                    ' G68.2: origine del piano rispetto allo zero pezzo; le coordinate restano locali al piano
                    Dim e = fr.EulerZXZ()
                    Dim po = fr.Origin - opt.OriginPoint()
                    w.Code(w.Join({"G68.2", w.Word("X", w.Num(po.X, d)), w.Word("Y", w.Num(po.Y, d)), w.Word("Z", w.Num(po.Z, d)),
                                   w.Word("I", w.Num(e.Alpha, 4)), w.Word("J", w.Num(e.Beta, 4)), w.Word("K", w.Num(e.Gamma, 4))}))
                    w.Code("G53.1")
                ElseIf m.Tilt = "world" AndAlso Not aligned Then
                    w.Comment("ATTENZIONE: COORDINATE MONDO, ORIENTARE L'UTENSILE SECONDO L'ASSE INDICATO")
                End If

                Dim shift = If(tilted682, Vec3.Zero, ShiftOf(fr, local, opt))
                Dim pts As New List(Of Vec3)(tp.Points.Count)
                For Each p In tp.Points
                    Dim c = PointXYZ(fr, p, local, shift)
                    pts.Add(New Vec3(If(m.InvertX, -c.X, c.X), If(m.InvertY, -c.Y, c.Y), If(m.InvertZ, -c.Z, c.Z)))
                Next
                Dim p0 = pts(0)
                Dim comp = If(m.LengthComp, Expand(m.LengthCompCmd, vars), Nothing)
                Dim compWords = If(String.IsNullOrWhiteSpace(comp), Nothing, {comp.Trim()})
                ' avvicinamento: Z di sicurezza, mandrino, XY (oppure mandrino, XY, Z con il correttore)
                If m.ApproachZFirst Then
                    w.Move(m.WordRapid, p0, {False, False, True}, compWords, forceMotion:=True, forceAxes:={False, False, True})
                    StartSpindle(w, m, coolant, st, vars, tp)
                    w.Move(m.WordRapid, p0, {True, True, False}, forceMotion:=True, forceAxes:={True, True, False})
                Else
                    StartSpindle(w, m, coolant, st, vars, tp)
                    w.Move(m.WordRapid, p0, {True, True, False}, forceMotion:=True, forceAxes:={True, True, False})
                    w.Move(m.WordRapid, p0, {False, False, True}, compWords, forceAxes:={False, False, True})
                End If
                WriteMoves(w, tp, pts, m)
                If tilted682 Then w.Code("G69")
                w.Template(m.OperationEnd, vars)
                If m.SpindleStopEachOp AndAlso st.On Then StopSpindle(w, m, coolant, st, vars)
            Next
            w.Blank()
            If st.On Then StopSpindle(w, m, coolant, st, baseVars)
            If m.Fan = "program" Then w.Template(m.FanOff, baseVars)
            If motion <> "none" Then w.Template(m.MotionEnd, baseVars)
            w.Template(m.Footer, baseVars)
            Return w.Text()
        End Function

        ''' <summary>Segnaposto della lavorazione: giri, utensile, diametro, avanzamento, nome.</summary>
        Private Function OpVars(baseVars As Dictionary(Of String, String), tp As Toolpath, m As MachineDef, w As GWriter, d As Integer) As Dictionary(Of String, String)
            Dim v As New Dictionary(Of String, String)(baseVars)
            v("S") = CInt(Math.Round(SpindleOf(tp, m))).ToString(Inv)
            v("T") = tp.Tool.Number.ToString(Inv)
            v("H") = v("T")
            v("TOOL") = ToolLabel(tp.Tool, d)
            v("D") = F(tp.Tool.Diameter, d)
            v("F") = w.Num(FeedLimit(tp.Feed, m), m.FeedDecimals)
            v("OP") = Clean(tp.Name)
            Return v
        End Function

        Private Function SpindleOf(tp As Toolpath, m As MachineDef) As Double
            Dim s = tp.Spindle
            If m.SpindleMax > 0 Then s = Math.Min(s, m.SpindleMax)
            If m.SpindleMin > 0 Then s = Math.Max(s, m.SpindleMin)
            Return s
        End Function

        Private Function FeedLimit(f As Double, m As MachineDef) As Double
            Return If(m.MaxFeed > 0, Math.Min(f, m.MaxFeed), f)
        End Function

        ''' <summary>Refrigerante dell'esportazione: indicato, altrimenti acceso/spento con quello predefinito della macchina.</summary>
        Private Function CoolantOf(opt As PostOptions, m As MachineDef) As String
            Dim c = If(opt.CoolantMode, "").ToLowerInvariant()
            If {"none", "flood", "mist", "air"}.Contains(c) Then Return c
            If Not opt.Coolant Then Return "none"
            Return If(m.Coolant = "none" OrElse String.IsNullOrEmpty(m.Coolant), "flood", m.Coolant)
        End Function

        Private NotInheritable Class SpindleState
            Public [On] As Boolean
            Public Speed As Double = -1
            Public CoolantOn As Boolean
            Public FanOn As Boolean
            ''' <summary>Senso di rotazione del mandrino acceso (true antiorario).</summary>
            Public Ccw As Boolean
        End Class

        Private Sub StartSpindle(w As GWriter, m As MachineDef, coolant As String, st As SpindleState, vars As IDictionary(Of String, String), tp As Toolpath)
            Dim s = SpindleOf(tp, m)
            Dim ccw = tp.Tool.IsCcw
            ' cambia il senso di rotazione: il mandrino si ferma prima di ripartire nell'altro verso
            If st.On AndAlso st.Ccw <> ccw Then StopSpindle(w, m, coolant, st, vars)
            Dim changed = Not st.On OrElse Math.Abs(s - st.Speed) > 0.5
            Select Case m.SpindleControl
                Case "manual"
                    If changed Then
                        w.Comment($"ACCENDERE IL MANDRINO A {CInt(Math.Round(s))} GIRI/MIN{If(ccw, " ANTIORARIO", "")}")
                        w.Code("M0")
                    End If
                Case "none"
                Case Else
                    w.Template(If(ccw, m.SpindleOnCcw, m.SpindleOnCw), vars)
                    If changed AndAlso m.SpindleDelay > 0 AndAlso Not String.IsNullOrWhiteSpace(m.Dwell) Then w.Template({m.Dwell}, vars)
            End Select
            st.On = True
            st.Speed = s
            st.Ccw = ccw
            If Not st.CoolantOn AndAlso coolant <> "none" Then
                w.Template(If(coolant = "mist", m.CoolantMist, If(coolant = "air", m.CoolantAir, m.CoolantFlood)), vars)
                st.CoolantOn = True
            End If
            If Not st.FanOn AndAlso m.Fan = "spindle" Then w.Template(m.FanOn, vars) : st.FanOn = True
        End Sub

        Private Sub StopSpindle(w As GWriter, m As MachineDef, coolant As String, st As SpindleState, vars As IDictionary(Of String, String))
            If st.CoolantOn Then w.Template(m.CoolantOff, vars) : st.CoolantOn = False
            Select Case m.SpindleControl
                Case "manual" : w.Comment("SPEGNERE IL MANDRINO")
                Case "none"
                Case Else : w.Template(m.SpindleOff, vars)
            End Select
            If st.FanOn Then w.Template(m.FanOff, vars) : st.FanOn = False
            st.On = False
        End Sub

        ''' <summary>Avvisi: giri fuori dai limiti del mandrino, avanzamenti oltre il massimo, percorso più grande delle corse.</summary>
        Private Sub CheckLimits(list As List(Of Toolpath), m As MachineDef, opt As PostOptions, warn As List(Of String))
            Dim inv = CultureInfo.InvariantCulture
            For Each tp In list
                If m.SpindleMax > 0 AndAlso tp.Spindle > m.SpindleMax + 0.5 Then
                    warn.Add($"{tp.Name}: {CInt(tp.Spindle)} giri/min ridotti al massimo del mandrino ({CInt(m.SpindleMax)})")
                End If
                If m.SpindleMin > 0 AndAlso tp.Spindle < m.SpindleMin - 0.5 Then
                    warn.Add($"{tp.Name}: {CInt(tp.Spindle)} giri/min portati al minimo del mandrino ({CInt(m.SpindleMin)})")
                End If
                Dim fmax = Math.Max(tp.Feed, Math.Max(tp.Plunge, tp.RampFeed))
                If m.MaxFeed > 0 AndAlso fmax > m.MaxFeed + 0.5 Then
                    warn.Add($"{tp.Name}: avanzamento {CInt(fmax)} mm/min ridotto al massimo della macchina ({CInt(m.MaxFeed)})")
                End If
                If m.TravelX > 0 OrElse m.TravelY > 0 OrElse m.TravelZ > 0 Then
                    Dim local = Not tp.Frame.IsWorldAligned AndAlso m.Tilt <> "world"
                    Dim mn As New Vec3(Double.MaxValue, Double.MaxValue, Double.MaxValue), mx As New Vec3(Double.MinValue, Double.MinValue, Double.MinValue)
                    For Each p In tp.Points
                        Dim c = PointXYZ(tp.Frame, p, local, Vec3.Zero)
                        mn = New Vec3(Math.Min(mn.X, c.X), Math.Min(mn.Y, c.Y), Math.Min(mn.Z, c.Z))
                        mx = New Vec3(Math.Max(mx.X, c.X), Math.Max(mx.Y, c.Y), Math.Max(mx.Z, c.Z))
                    Next
                    Dim sz = mx - mn
                    For Each ax In {("X", sz.X, m.TravelX), ("Y", sz.Y, m.TravelY), ("Z", sz.Z, m.TravelZ)}
                        If ax.Item3 > 0 AndAlso ax.Item2 > ax.Item3 + 0.001 Then
                            warn.Add($"{tp.Name}: il percorso occupa {ax.Item2.ToString("0.#", inv)} mm in {ax.Item1}, oltre la corsa della macchina ({ax.Item3.ToString("0.#", inv)} mm)")
                        End If
                    Next
                End If
            Next
        End Sub

        ''' <summary>
        ''' Movimenti dal secondo punto in poi: G0 per i rapidi; per gli altri tratti (stesso tipo, stesso avanzamento)
        ''' archi G2/G3 riconosciuti nei punti, oppure con solo G1 gli archi rifatti a corde.
        ''' </summary>
        Private Sub WriteMoves(w As GWriter, tp As Toolpath, pts As List(Of Vec3), m As MachineDef)
            Dim all = {True, True, True}
            Dim i = 1
            Dim n = pts.Count
            Dim detect As MachineDef = Nothing
            If Not m.Arcs AndAlso m.ChordTolerance > 0 Then
                ' solo G1: si riconoscono gli archi in tutti i piani (anche elicoidali) per rifarli a corde
                detect = m.Clone()
                detect.Arcs = True : detect.ArcFormat = "ij" : detect.ArcMaxAngle = 360 : detect.ArcAllPlanes = True : detect.ArcHelical = True
            End If
            While i < n
                Dim type = tp.Points(i).Type
                If type = MoveType.Rapid Then
                    w.Move(m.WordRapid, pts(i), all)
                    i += 1
                    Continue While
                End If
                Dim j = i
                While j + 1 < n AndAlso tp.Points(j + 1).Type = type : j += 1 : End While
                Dim feed = FeedLimit(FeedOf(tp, type), m)
                Dim run = pts.GetRange(i - 1, j - i + 2)
                If m.Arcs Then
                    For Each s In PathFitter.Fit(run, m)
                        If Not s.IsArc OrElse Not WriteArc(w, s, m, feed) Then
                            For k = s.FromIndex + 1 To s.ToIndex : w.Move(m.WordLinear, run(k), all, feed:=feed) : Next
                        End If
                    Next
                ElseIf detect IsNot Nothing Then
                    For Each s In PathFitter.Fit(run, detect)
                        Dim start = run(s.FromIndex)
                        Dim seq = If(s.IsArc, PathFitter.Chords(start, s, m.ChordTolerance, m.ChordMin, m.ChordMax), PathFitter.SplitLine(start, s.End, m.ChordMax))
                        For Each q In seq : w.Move(m.WordLinear, q, all, feed:=feed) : Next
                    Next
                Else
                    For k = 1 To run.Count - 1 : w.Move(m.WordLinear, run(k), all, feed:=feed) : Next
                End If
                i = j + 1
            End While
        End Sub

        ''' <summary>
        ''' Arco G2/G3 con il centro incrementale, assoluto o il raggio. False (e nulla scritto) se dopo
        ''' l'arrotondamento i raggi all'inizio e alla fine differiscono troppo: allora si scrivono i segmenti.
        ''' </summary>
        Private Function WriteArc(w As GWriter, s As PathSeg, m As MachineDef, feed As Double) As Boolean
            Dim a, b As Integer
            Select Case s.Plane
                Case 18 : a = 2 : b = 0
                Case 19 : a = 1 : b = 2
                Case Else : a = 0 : b = 1
            End Select
            Dim cp = Function(p As Vec3, k As Integer) If(k = 0, p.X, If(k = 1, p.Y, p.Z))
            Dim rd = Function(v As Double, dec As Integer) Math.Round(v, Math.Max(0, Math.Min(6, dec)))
            Dim sa = cp(w.Pos, a), sb = cp(w.Pos, b)
            Dim ea = rd(cp(s.End, a), m.Decimals), eb = rd(cp(s.End, b), m.Decimals)
            Dim ca = cp(s.Center, a), cb = cp(s.Center, b)
            Dim rs = Math.Sqrt((sa - ca) ^ 2 + (sb - cb) ^ 2), re = Math.Sqrt((ea - ca) ^ 2 + (eb - cb) ^ 2)
            If Math.Abs(rs - re) > Math.Max(0.002, 0.0005 * s.Radius) Then Return False
            If (ea - sa) ^ 2 + (eb - sb) ^ 2 < 0.000001 Then Return False
            Dim pre As New List(Of String)()
            If s.Plane <> w.LastPlane Then pre.Add("G" & s.Plane) : w.LastPlane = s.Plane
            Dim post As New List(Of String)()
            If m.ArcFormat = "r" Then
                ' il controllo ricava il centro da inizio, fine e raggio arrotondati: deve cadere vicino a quello vero
                Dim r = Math.Round(Math.Sqrt((ea - ca) ^ 2 + (eb - cb) ^ 2), Math.Max(0, Math.Min(6, m.ArcDecimals)))
                Dim qx = ea - sa, qy = eb - sb
                Dim q = Math.Sqrt(qx * qx + qy * qy)
                If q > 2 * r Then Return False
                Dim hh = Math.Sqrt(Math.Max(0, r * r - q * q / 4))
                Dim sg = If(s.Ccw, 1.0, -1.0) * If(s.Sweep > Math.PI, -1.0, 1.0)
                Dim kx = (sa + ea) / 2 - sg * hh * qy / q, ky = (sb + eb) / 2 + sg * hh * qx / q
                If Math.Sqrt((kx - ca) ^ 2 + (ky - cb) ^ 2) > Math.Max(0.002, m.ArcTolerance) Then Return False
                post.Add(w.Word(m.WordRadius, w.Num(If(s.Sweep > Math.PI, -r, r), m.ArcDecimals)))
            Else
                ' centro incrementale dal punto iniziale (come scritto nel programma) oppure assoluto
                Dim cen = {s.Center.X, s.Center.Y, s.Center.Z}
                Dim stv = {w.Pos.X, w.Pos.Y, w.Pos.Z}
                For Each k In {a, b}.OrderBy(Function(x) x)
                    Dim v = If(m.ArcFormat = "ijabs", cen(k), cen(k) - stv(k))
                    post.Add(w.Word(If(k = 0, m.AxisI, If(k = 1, m.AxisJ, m.AxisK)), w.Num(v, m.ArcDecimals)))
                Next
            End If
            Dim force(2) As Boolean
            force(a) = True : force(b) = True
            w.MoveArc(If(s.Ccw, m.WordArcCcw, m.WordArcCw), s.End, pre, post, force, feed)
            Return True
        End Function

        Private Sub AppendSetup(w As GWriter, n As Integer, fr As PlaneFrame, d As Integer, opt As PostOptions)
            If fr.IsWorldAligned Then
                w.Comment($"PIAZZAMENTO {n}: PEZZO COME NEL PROGETTO, Z VERSO L'ALTO")
                If opt.HasOrigin Then
                    w.Comment("AZZERARE X Y Z SUL PUNTO DI RIFERIMENTO")
                    w.Comment(OriginLabel(opt, d))
                Else
                    w.Comment("AZZERARE X Y Z SULLO ZERO DEL PROGETTO")
                End If
                Return
            End If
            Dim tilt = Math.Acos(Math.Max(-1.0, Math.Min(1.0, fr.N.Z))) * 180.0 / Math.PI
            If fr.N.Z < -0.999999 Then
                w.Comment($"PIAZZAMENTO {n}: PEZZO CAPOVOLTO, LAVORAZIONE DAL LATO OPPOSTO")
            Else
                w.Comment($"PIAZZAMENTO {n}: PIANO INCLINATO DI {F(tilt, 1)} GRADI")
            End If
            w.Comment("ORIENTARE IL PEZZO CON LA NORMALE DEL PIANO VERSO +Z MACCHINA")
            w.Comment($"NORMALE DEL PIANO I={F(fr.N.X, 4)} J={F(fr.N.Y, 4)} K={F(fr.N.Z, 4)}")
            w.Comment($"ASSE X MACCHINA LUNGO I={F(fr.U.X, 4)} J={F(fr.U.Y, 4)} K={F(fr.U.Z, 4)}")
            If opt.HasOrigin Then
                w.Comment("AZZERARE X Y Z SUL PUNTO DI RIFERIMENTO")
                w.Comment(OriginLabel(opt, d))
            Else
                w.Comment("AZZERARE X Y Z SULL'ORIGINE DEL PIANO, CHE NEL PROGETTO E' IN")
                w.Comment($"X={F(fr.Origin.X, d)} Y={F(fr.Origin.Y, d)} Z={F(fr.Origin.Z, d)}")
            End If
        End Sub

        ''' <summary>CL data stile APT: GOTO/x,y,z,i,j,k in coordinate mondo con vettore asse utensile.</summary>
        Public Function ClData(paths As IEnumerable(Of Toolpath), opt As PostOptions) As String
            Dim sb As New StringBuilder()
            Dim d = Math.Max(4, opt.Decimals)
            sb.AppendLine($"PARTNO/{Clean(opt.ProgramName)}")
            sb.AppendLine("UNITS/MM")
            For Each tp In paths
                If tp.Points.Count = 0 Then Continue For
                Dim fr = tp.Frame
                Dim ijk = $"{F(fr.N.X, 6)},{F(fr.N.Y, 6)},{F(fr.N.Z, 6)}"
                sb.AppendLine($"$$ OPERAZIONE: {Clean(tp.Name)}")
                sb.AppendLine($"LOADTL/{tp.Tool.Number}")
                If tp.Tool.IsTaper Then
                    ' APT: CUTTER/d,r,e,f,a,b,h (diametro, raggio, angolo di conicità, altezza)
                    Dim rt = If(tp.Tool.TipIsBall, tp.Tool.Radius, 0)
                    sb.AppendLine($"CUTTER/{F(tp.Tool.Diameter, d)},{F(rt, d)},0,{F(rt, d)},{F(tp.Tool.TaperAngle, 4)},0,{F(tp.Tool.ConeHeight, d)}")
                Else
                    sb.AppendLine($"CUTTER/{F(tp.Tool.Diameter, d)},{F(tp.Tool.EffectiveCorner, d)}")
                End If
                sb.AppendLine($"SPINDL/RPM,{CInt(tp.Spindle)},{If(tp.Tool.IsCcw, "CCLW", "CLW")}")
                Dim lastType = CType(255, MoveType)
                For Each p In tp.Points
                    If p.Type <> lastType Then
                        Select Case p.Type
                            Case MoveType.Rapid : sb.AppendLine("RAPID")
                            Case MoveType.Feed : sb.AppendLine($"FEDRAT/MMPM,{F(tp.Feed, 1)}")
                            Case MoveType.Plunge : sb.AppendLine($"FEDRAT/MMPM,{F(tp.Plunge, 1)}")
                            Case MoveType.Ramp : sb.AppendLine($"FEDRAT/MMPM,{F(FeedOf(tp, MoveType.Ramp), 1)}")
                        End Select
                        lastType = p.Type
                    End If
                    Dim wp = fr.ToWorld(p.U, p.V, p.W)
                    sb.AppendLine($"GOTO/{F(wp.X, d)},{F(wp.Y, d)},{F(wp.Z, d)},{ijk}")
                Next
            Next
            sb.AppendLine("FINI")
            Return sb.ToString()
        End Function

    End Module

End Namespace
