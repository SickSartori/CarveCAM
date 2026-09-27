Imports System.Globalization
Imports System.Text
Imports CarveCAM.Core.Cam
Imports CarveCAM.Core.Geometry

Namespace Post

    Public Class PostOptions
        ''' <summary>
        ''' "g682": Fanuc/ISO, piano inclinato G68.2 (3+2) con coordinate locali; "world": Fanuc/ISO in coordinate mondo XYZ;
        ''' "grbl": GRBL 1.1 e compatibili (grblHAL, FluidNC) a 3 assi.
        ''' </summary>
        Public Property Mode As String = "g682"
        Public Property ProgramNumber As Integer = 1000
        Public Property Decimals As Integer = 3
        Public Property Coolant As Boolean = True
        Public Property ProgramName As String = "CARVECAM"
        ''' <summary>GRBL: attesa in secondi dopo M3 perché il mandrino arrivi in velocità (GRBL non ha retroazione).</summary>
        Public Property SpindleDelay As Double = 2
    End Class

    ''' <summary>Post-processor G-code (ISO/Fanuc e GRBL) e CL data (APT) per i percorsi calcolati.</summary>
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
            If t.IsBall Then Return $"SFERICA D={F(t.Diameter, d)}"
            If t.IsBull Then Return $"TORICA D={F(t.Diameter, d)} R={F(t.EffectiveCorner, d)}"
            Return $"CILINDRICA D={F(t.Diameter, d)}"
        End Function

        Private Function FeedOf(tp As Toolpath, t As MoveType) As Double
            Select Case t
                Case MoveType.Plunge : Return tp.Plunge
                Case MoveType.Ramp : Return If(tp.RampFeed > 0, tp.RampFeed, tp.Feed)
                Case Else : Return tp.Feed
            End Select
        End Function

        ''' <summary>Testo per commenti e nomi: solo ASCII (lettere accentate senza accento, ° in GRADI), niente parentesi.</summary>
        Private Function Clean(s As String) As String
            Dim t = If(s, "").Replace("°", " GRADI").Normalize(NormalizationForm.FormD)
            Dim sb As New StringBuilder(t.Length)
            For Each ch In t
                If CharUnicodeInfo.GetUnicodeCategory(ch) = UnicodeCategory.NonSpacingMark Then Continue For
                If AscW(ch) >= 32 AndAlso AscW(ch) < 127 Then sb.Append(ch)
            Next
            Return sb.ToString().Replace("(", "[").Replace(")", "]").ToUpperInvariant()
        End Function

        Private Function OperationLabel(tp As Toolpath) As String
            Return $"{Clean(tp.Name)} - {If(tp.Kind = "pocket", "SVUOTATURA A TERRAZZE", "FINITURA")} {StrategyLabel(tp.Strategy)}"
        End Function

        Private Function PointXYZ(fr As PlaneFrame, p As CLPoint, local As Boolean) As Vec3
            Return If(local, New Vec3(p.U, p.V, p.W), fr.ToWorld(p.U, p.V, p.W))
        End Function

        ''' <summary>
        ''' Movimenti dal secondo punto in poi (il primo lo posiziona il chiamante): G0/G1 modali, solo le coordinate
        ''' che cambiano, avanzamento scritto quando cambia.
        ''' </summary>
        Private Sub AppendMoves(sb As StringBuilder, tp As Toolpath, local As Boolean, d As Integer)
            Dim last = PointXYZ(tp.Frame, tp.Points(0), local)
            Dim lastG = 0
            Dim lf = Double.NaN
            For i = 1 To tp.Points.Count - 1
                Dim p = tp.Points(i)
                Dim c = PointXYZ(tp.Frame, p, local)
                Dim g = If(p.Type = MoveType.Rapid, 0, 1)
                Dim coords As New StringBuilder()
                If F(c.X, d) <> F(last.X, d) Then coords.Append(" X" & F(c.X, d))
                If F(c.Y, d) <> F(last.Y, d) Then coords.Append(" Y" & F(c.Y, d))
                If F(c.Z, d) <> F(last.Z, d) Then coords.Append(" Z" & F(c.Z, d))
                If coords.Length = 0 Then Continue For
                Dim line As New StringBuilder()
                If g <> lastG Then line.Append("G" & g) : lastG = g
                line.Append(coords)
                If g = 1 Then
                    Dim feed = FeedOf(tp, p.Type)
                    If feed <> lf Then line.Append(" F" & CInt(Math.Round(feed))) : lf = feed
                End If
                sb.AppendLine(line.ToString().Trim())
                last = c
            Next
        End Sub

        Public Function GCode(paths As IEnumerable(Of Toolpath), opt As PostOptions) As String
            If String.Equals(opt.Mode, "grbl", StringComparison.OrdinalIgnoreCase) Then Return GrblCode(paths, opt)
            Dim sb As New StringBuilder()
            Dim d = opt.Decimals
            sb.AppendLine("%")
            sb.AppendLine($"O{opt.ProgramNumber:0000} ({Clean(opt.ProgramName)})")
            sb.AppendLine($"(GENERATO DA CARVECAM - {DateTime.Now:yyyy-MM-dd HH:mm})")
            sb.AppendLine("(UNITA: MM)")
            sb.AppendLine("G21 G90 G94 G17 G40 G49 G80")
            Dim lastTool = -1
            Dim opIndex = 0
            For Each tp In paths
                opIndex += 1
                If tp.Points.Count = 0 Then Continue For
                Dim fr = tp.Frame
                Dim tilted = opt.Mode = "g682" AndAlso Not fr.IsWorldAligned
                sb.AppendLine()
                sb.AppendLine($"(OP {opIndex}: {OperationLabel(tp)})")
                sb.AppendLine($"(UTENSILE T{tp.Tool.Number} {ToolLabel(tp.Tool, d)})")
                sb.AppendLine($"(ASSE UTENSILE I={F(fr.N.X, 6)} J={F(fr.N.Y, 6)} K={F(fr.N.Z, 6)})")
                If tp.Tool.Number <> lastTool Then
                    sb.AppendLine($"T{tp.Tool.Number} M6")
                    lastTool = tp.Tool.Number
                End If
                sb.AppendLine($"S{CInt(Math.Round(tp.Spindle))} M3")
                If opt.Coolant Then sb.AppendLine("M8")
                If tilted Then
                    Dim e = fr.EulerZXZ()
                    sb.AppendLine($"G68.2 X{F(fr.Origin.X, d)} Y{F(fr.Origin.Y, d)} Z{F(fr.Origin.Z, d)} I{F(e.Alpha, 4)} J{F(e.Beta, 4)} K{F(e.Gamma, 4)}")
                    sb.AppendLine("G53.1")
                ElseIf opt.Mode <> "g682" AndAlso Not fr.IsWorldAligned Then
                    sb.AppendLine("(ATTENZIONE: COORDINATE MONDO, ORIENTARE L'UTENSILE SECONDO L'ASSE INDICATO)")
                End If

                ' primo posizionamento: XY poi Z con correttore lunghezza
                Dim p0 = PointXYZ(fr, tp.Points(0), tilted)
                sb.AppendLine($"G0 X{F(p0.X, d)} Y{F(p0.Y, d)}")
                sb.AppendLine($"G43 H{tp.Tool.Number} Z{F(p0.Z, d)}")
                AppendMoves(sb, tp, tilted, d)
                If tilted Then sb.AppendLine("G69")
                If opt.Coolant Then sb.AppendLine("M9")
                sb.AppendLine("M5")
            Next
            sb.AppendLine()
            sb.AppendLine("G49")
            sb.AppendLine("M30")
            sb.AppendLine("%")
            Return sb.ToString()
        End Function

        ''' <summary>Stesso piazzamento del pezzo: entrambi con asse utensile +Z mondo, oppure lo stesso piano inclinato.</summary>
        Private Function SameSetup(a As PlaneFrame, b As PlaneFrame) As Boolean
            If a Is Nothing OrElse b Is Nothing Then Return False
            If a.IsWorldAligned AndAlso b.IsWorldAligned Then Return True
            Return (a.N - b.N).Length < 0.000001 AndAlso (a.U - b.U).Length < 0.000001 AndAlso (a.Origin - b.Origin).Length < 0.001
        End Function

        Private Sub AppendSetup(sb As StringBuilder, n As Integer, fr As PlaneFrame, d As Integer)
            If fr.IsWorldAligned Then
                sb.AppendLine(Cm($"PIAZZAMENTO {n}: PEZZO COME NEL PROGETTO, Z VERSO L'ALTO"))
                sb.AppendLine(Cm("AZZERARE X Y Z SULLO ZERO DEL PROGETTO"))
                Return
            End If
            Dim tilt = Math.Acos(Math.Max(-1.0, Math.Min(1.0, fr.N.Z))) * 180.0 / Math.PI
            If fr.N.Z < -0.999999 Then
                sb.AppendLine(Cm($"PIAZZAMENTO {n}: PEZZO CAPOVOLTO, LAVORAZIONE DAL LATO OPPOSTO"))
            Else
                sb.AppendLine(Cm($"PIAZZAMENTO {n}: PIANO INCLINATO DI {F(tilt, 1)} GRADI"))
            End If
            sb.AppendLine(Cm("ORIENTARE IL PEZZO CON LA NORMALE DEL PIANO VERSO +Z MACCHINA"))
            sb.AppendLine(Cm($"NORMALE DEL PIANO I={F(fr.N.X, 4)} J={F(fr.N.Y, 4)} K={F(fr.N.Z, 4)}"))
            sb.AppendLine(Cm($"ASSE X MACCHINA LUNGO I={F(fr.U.X, 4)} J={F(fr.U.Y, 4)} K={F(fr.U.Z, 4)}"))
            sb.AppendLine(Cm("AZZERARE X Y Z SULL'ORIGINE DEL PIANO, CHE NEL PROGETTO E' IN"))
            sb.AppendLine(Cm($"X={F(fr.Origin.X, d)} Y={F(fr.Origin.Y, d)} Z={F(fr.Origin.Z, d)}"))
        End Sub

        ''' <summary>Commento GRBL: parentesi non annidate e riga entro gli 80 caratteri del buffer di GRBL.</summary>
        Private Function Cm(text As String) As String
            Dim t = Clean(text)
            If t.Length > 78 Then t = t.Substring(0, 78)
            Return "(" & t & ")"
        End Function

        ''' <summary>
        ''' G-code per GRBL 1.1 e compatibili (grblHAL, FluidNC) a 3 assi. GRBL non accetta G68.2, G43 H, M6, numeri
        ''' di programma O né "%": i cambi utensile e i cambi di piazzamento (piani inclinati, pezzo capovolto)
        ''' diventano pause M0 con le istruzioni per l'operatore nei commenti; sui piani inclinati le coordinate sono
        ''' nel sistema del piano, da azzerare sull'origine del piano dopo aver orientato il pezzo.
        ''' </summary>
        Private Function GrblCode(paths As IEnumerable(Of Toolpath), opt As PostOptions) As String
            Dim sb As New StringBuilder()
            Dim d = opt.Decimals
            Dim list = paths.Where(Function(t) t.Points.Count > 0).ToList()
            sb.AppendLine(Cm(opt.ProgramName))
            sb.AppendLine(Cm($"GENERATO DA CARVECAM PER GRBL - {DateTime.Now:yyyy-MM-dd HH:mm}"))
            sb.AppendLine(Cm("UNITA: MM - 3 ASSI - CAMBI UTENSILE E PIAZZAMENTI CON PAUSA M0"))
            sb.AppendLine("G21 G90 G94 G17")
            sb.AppendLine("G54")
            Dim lastTool = -1
            Dim lastFrame As PlaneFrame = Nothing
            Dim setupNo = 0
            For i = 0 To list.Count - 1
                Dim tp = list(i)
                Dim fr = tp.Frame
                Dim local = Not fr.IsWorldAligned
                Dim newSetup = Not SameSetup(lastFrame, fr)
                Dim newTool = tp.Tool.Number <> lastTool
                sb.AppendLine()
                If i > 0 AndAlso (newSetup OrElse newTool) Then
                    ' pausa per l'operatore: mandrino e refrigerante fermi, utensile già alla quota di sicurezza
                    sb.AppendLine("M5")
                    If opt.Coolant Then sb.AppendLine("M9")
                End If
                If newSetup Then setupNo += 1 : AppendSetup(sb, setupNo, fr, d)
                If newTool Then
                    sb.AppendLine(Cm($"{If(i = 0, "UTENSILE", "CAMBIO UTENSILE")}: T{tp.Tool.Number} {ToolLabel(tp.Tool, d)}"))
                    If i > 0 AndAlso Not newSetup Then sb.AppendLine(Cm("MONTARE L'UTENSILE E RIAZZERARE Z SULLO STESSO RIFERIMENTO"))
                End If
                If (i > 0 AndAlso (newSetup OrElse newTool)) OrElse (i = 0 AndAlso local) Then sb.AppendLine("M0")
                lastFrame = fr
                lastTool = tp.Tool.Number

                sb.AppendLine(Cm($"OP {i + 1}: {OperationLabel(tp)}"))
                ' prima si sale alla quota di sicurezza (dopo l'azzeramento l'utensile può essere a contatto del pezzo),
                ' poi si avvia il mandrino e ci si porta sopra il punto d'ingresso
                Dim p0 = PointXYZ(fr, tp.Points(0), local)
                sb.AppendLine($"G0 Z{F(p0.Z, d)}")
                sb.AppendLine($"S{CInt(Math.Round(tp.Spindle))} M3")
                If opt.SpindleDelay > 0 Then sb.AppendLine($"G4 P{F(opt.SpindleDelay, 1)}")
                If opt.Coolant Then sb.AppendLine("M8")
                sb.AppendLine($"G0 X{F(p0.X, d)} Y{F(p0.Y, d)}")
                AppendMoves(sb, tp, local, d)
            Next
            sb.AppendLine()
            sb.AppendLine("M5")
            If opt.Coolant Then sb.AppendLine("M9")
            sb.AppendLine("M30")
            Return sb.ToString()
        End Function

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
                sb.AppendLine($"CUTTER/{F(tp.Tool.Diameter, d)},{F(tp.Tool.EffectiveCorner, d)}")
                sb.AppendLine($"SPINDL/RPM,{CInt(tp.Spindle)},CLW")
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
                    Dim w = fr.ToWorld(p.U, p.V, p.W)
                    sb.AppendLine($"GOTO/{F(w.X, d)},{F(w.Y, d)},{F(w.Z, d)},{ijk}")
                Next
            Next
            sb.AppendLine("FINI")
            Return sb.ToString()
        End Function

    End Module

End Namespace
