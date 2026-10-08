Namespace Post

    ''' <summary>
    ''' Macchina CNC del magazzino macchine: controllo, sintassi, archi o solo G1 con le corde, modalità di
    ''' movimento esatto/smooth, mandrino, refrigerazione, aspirazione, cambio utensile, righe di inizio e fine.
    ''' Nelle righe dei comandi si usano i segnaposto {S} giri, {T} utensile, {TOOL} descrizione dell'utensile,
    ''' {D} diametro, {F} avanzamento, {SEC} e {MS} attesa, {TOL} tolleranza smooth, {NAME} nome del programma,
    ''' {PROG} numero di programma, {OP} lavorazione, {DATE} e {TIME}. Una riga "(testo)" o "; testo" è un
    ''' commento e si scrive con lo stile della macchina.
    ''' </summary>
    Public Class MachineDef
        Public Property Id As String = ""
        Public Property Name As String = "Macchina"
        Public Property Notes As String = ""

        ' ---------------------------------------------------------------- generale
        ''' <summary>Piani inclinati: "pause" (pausa M0 e istruzioni per orientare il pezzo, coordinate del piano), "g682" (G68.2), "world" (coordinate mondo).</summary>
        Public Property Tilt As String = "pause"
        ''' <summary>Corse degli assi (mm, 0 = non controllare): un percorso più grande dà un avviso.</summary>
        Public Property TravelX As Double
        Public Property TravelY As Double
        Public Property TravelZ As Double
        ''' <summary>Avanzamento massimo (mm/min, 0 = senza limite): gli avanzamenti oltre si riducono, con un avviso.</summary>
        Public Property MaxFeed As Double
        ''' <summary>Avvicinamento: prima la Z alla quota di sicurezza, poi mandrino e XY (true); altrimenti mandrino, XY, Z.</summary>
        Public Property ApproachZFirst As Boolean = True

        ' ---------------------------------------------------------------- sintassi
        Public Property WordRapid As String = "G0"
        Public Property WordLinear As String = "G1"
        Public Property WordArcCw As String = "G2"
        Public Property WordArcCcw As String = "G3"
        Public Property AxisX As String = "X"
        Public Property AxisY As String = "Y"
        Public Property AxisZ As String = "Z"
        Public Property AxisI As String = "I"
        Public Property AxisJ As String = "J"
        Public Property AxisK As String = "K"
        Public Property WordRadius As String = "R"
        Public Property WordFeed As String = "F"
        Public Property Decimals As Integer = 3
        Public Property ArcDecimals As Integer = 3
        Public Property FeedDecimals As Integer = 0
        ''' <summary>Numeri: "auto" (10, 10.5), "point" (10., 10.5: punto decimale sempre), "zeros" (10.000).</summary>
        Public Property NumberStyle As String = "auto"
        Public Property InvertX As Boolean
        Public Property InvertY As Boolean
        Public Property InvertZ As Boolean
        ''' <summary>Spazio tra le parole della riga (G1 X10 Y5) e tra lettera e valore (X 10).</summary>
        Public Property SpaceWords As Boolean = True
        Public Property SpaceAfterLetter As Boolean
        ''' <summary>Comando di movimento solo quando cambia (modale) e solo le coordinate che cambiano.</summary>
        Public Property ModalMotion As Boolean = True
        Public Property ModalCoords As Boolean = True
        Public Property LineNumbers As Boolean
        Public Property LineStart As Integer = 10
        Public Property LineStep As Integer = 10
        Public Property LineLetter As String = "N"
        ''' <summary>Commenti: "paren" (testo), "semicolon" ; testo, "none" (nessun commento).</summary>
        Public Property CommentStyle As String = "paren"
        Public Property CommentUppercase As Boolean = True
        ''' <summary>Lunghezza massima dei commenti (0 = senza limite; GRBL 78).</summary>
        Public Property CommentMaxLength As Integer
        Public Property FileExtension As String = "nc"
        ''' <summary>Fine riga: "crlf" o "lf".</summary>
        Public Property LineEnd As String = "crlf"

        ' ---------------------------------------------------------------- archi e corde
        ''' <summary>G2/G3 (true) oppure solo G1: gli archi diventano corde.</summary>
        Public Property Arcs As Boolean = True
        ''' <summary>Centro dell'arco: "ij" incrementale dal punto iniziale, "ijabs" assoluto, "r" raggio.</summary>
        Public Property ArcFormat As String = "ij"
        ''' <summary>Tolleranza con cui i punti del percorso si riconoscono come arco (mm).</summary>
        Public Property ArcTolerance As Double = 0.005
        Public Property ArcMinRadius As Double = 0.2
        Public Property ArcMaxRadius As Double = 2000
        ''' <summary>Angolo massimo di un arco (gradi): gli archi più ampi si dividono.</summary>
        Public Property ArcMaxAngle As Double = 180
        ''' <summary>Archi anche nei piani XZ e YZ (G18, G19), oltre che in XY (G17).</summary>
        Public Property ArcAllPlanes As Boolean
        ''' <summary>Archi elicoidali (con la terza coordinata che varia lungo l'arco).</summary>
        Public Property ArcHelical As Boolean = True
        ''' <summary>Solo G1: errore di corda (mm) con cui gli archi si rifanno a segmenti; 0 = punti del percorso invariati.</summary>
        Public Property ChordTolerance As Double = 0.01
        ''' <summary>Solo G1: lunghezza minima e massima delle corde (mm, 0 = senza limite).</summary>
        Public Property ChordMin As Double = 0.02
        Public Property ChordMax As Double = 5

        ' ---------------------------------------------------------------- modalità di movimento (esatto / smooth)
        Public Property MotionExact As String = "G61"
        Public Property MotionSmooth As String = "G64 P{TOL}"
        Public Property SmoothTolerance As Double = 0.02
        ''' <summary>Modalità per le svuotature e le finiture: "none", "exact", "smooth".</summary>
        Public Property MotionPocket As String = "none"
        Public Property MotionFinish As String = "none"
        ''' <summary>Righe a fine programma per tornare alla modalità normale (es. G64).</summary>
        Public Property MotionEnd As String() = Array.Empty(Of String)()

        ' ---------------------------------------------------------------- mandrino
        ''' <summary>"auto" (M3/M4 con i giri), "manual" (pausa per accenderlo a mano), "none".</summary>
        Public Property SpindleControl As String = "auto"
        ''' <summary>Avvio per gli utensili orari e antiorari (il senso di rotazione è quello dell'utensile).</summary>
        Public Property SpindleOnCw As String() = {"S{S} M3"}
        Public Property SpindleOnCcw As String() = {"S{S} M4"}
        Public Property SpindleOff As String() = {"M5"}
        ''' <summary>Attesa dopo l'avvio del mandrino (s) e comando di attesa.</summary>
        Public Property SpindleDelay As Double = 2
        Public Property Dwell As String = "G4 P{SEC}"
        Public Property SpindleMin As Double
        Public Property SpindleMax As Double
        ''' <summary>Mandrino fermo alla fine di ogni lavorazione (altrimenti solo al cambio utensile e a fine programma).</summary>
        Public Property SpindleStopEachOp As Boolean

        ' ---------------------------------------------------------------- refrigerazione e aspirazione
        ''' <summary>Refrigerante predefinito: "none", "flood" (a pioggia), "mist" (nebulizzato), "air" (aria).</summary>
        Public Property Coolant As String = "none"
        Public Property CoolantFlood As String() = {"M8"}
        Public Property CoolantMist As String() = {"M7"}
        Public Property CoolantAir As String() = {"M7"}
        Public Property CoolantOff As String() = {"M9"}
        ''' <summary>Aspirazione o ventola: "none", "program" (per tutto il programma), "spindle" (con il mandrino).</summary>
        Public Property Fan As String = "none"
        Public Property FanOn As String() = {"M106"}
        Public Property FanOff As String() = {"M107"}

        ' ---------------------------------------------------------------- cambio utensile
        ''' <summary>"auto" (cambio automatico), "manual" (pausa per cambiarlo), "none" (solo un commento).</summary>
        Public Property ToolChange As String = "manual"
        Public Property ToolChangeAuto As String() = {"T{T} M6"}
        Public Property ToolChangeManual As String() = {"(CAMBIO UTENSILE: T{T} {TOOL})", "(MONTARE L'UTENSILE E RIAZZERARE Z SULLO STESSO RIFERIMENTO)", "M0"}
        ''' <summary>Correttore lunghezza utensile sul primo movimento in Z (es. G43 H{T}).</summary>
        Public Property LengthComp As Boolean
        Public Property LengthCompCmd As String = "G43 H{T}"

        ' ---------------------------------------------------------------- inizio e fine
        Public Property Header As String() = {"({NAME})", "(GENERATO DA CARVECAM - {DATE} {TIME})", "G21 G90 G94 G17", "G54"}
        Public Property Footer As String() = {"M30"}
        Public Property OperationStart As String() = Array.Empty(Of String)()
        Public Property OperationEnd As String() = Array.Empty(Of String)()

        Public Function Clone() As MachineDef
            Dim m = DirectCast(MemberwiseClone(), MachineDef)
            For Each p In GetType(MachineDef).GetProperties()
                If p.PropertyType Is GetType(String()) Then
                    Dim a = DirectCast(p.GetValue(Me), String())
                    p.SetValue(m, If(a Is Nothing, Array.Empty(Of String)(), DirectCast(a.Clone(), String())))
                End If
            Next
            Return m
        End Function
    End Class

    ''' <summary>Macchine predefinite del magazzino (anche per le richieste senza macchina, dal vecchio campo Mode).</summary>
    Public Module MachinePresets

        ''' <summary>GRBL 1.1, grblHAL, FluidNC: 3 assi, archi G2/G3, cambi utensile e piazzamenti con pausa M0.</summary>
        Public Function Grbl() As MachineDef
            Return New MachineDef With {
                .Id = "grbl", .Name = "GRBL 1.1 / grblHAL / FluidNC (mini CNC)",
                .Notes = "3 assi. Cambi utensile e piani inclinati diventano pause M0 con le istruzioni nei commenti.",
                .Tilt = "pause", .ApproachZFirst = True, .CommentMaxLength = 78,
                .SpindleDelay = 2, .Dwell = "G4 P{SEC}", .SpindleMax = 24000,
                .ToolChange = "manual",
                .Header = {"({NAME})", "(GENERATO DA CARVECAM PER GRBL - {DATE} {TIME})", "(UNITA: MM - 3 ASSI - CAMBI UTENSILE E PIAZZAMENTI CON PAUSA M0)", "G21 G90 G94 G17", "G54"},
                .Footer = {"M30"}}
        End Function

        ''' <summary>Fanuc e controlli ISO a 5 assi con piano inclinato G68.2 (3+2).</summary>
        Public Function Fanuc3p2() As MachineDef
            Return New MachineDef With {
                .Id = "fanuc-g682", .Name = "Fanuc / ISO 3+2 (G68.2)",
                .Notes = "Piani inclinati con G68.2 e coordinate nel sistema del piano; cambio utensile automatico e correttore G43.",
                .Tilt = "g682", .ApproachZFirst = False, .NumberStyle = "point",
                .SpindleDelay = 0, .Dwell = "G4 X{SEC}", .SpindleStopEachOp = True,
                .Coolant = "flood", .ToolChange = "auto", .LengthComp = True,
                .Header = {"%", "O{PROG} ({NAME})", "(GENERATO DA CARVECAM - {DATE} {TIME})", "(UNITA: MM)", "G21 G90 G94 G17 G40 G49 G80"},
                .Footer = {"G49", "M30", "%"}}
        End Function

        ''' <summary>Fanuc e controlli ISO a 3 assi: coordinate mondo XYZ.</summary>
        Public Function IsoWorld() As MachineDef
            Dim m = Fanuc3p2()
            m.Id = "iso-world"
            m.Name = "Fanuc / ISO 3 assi (coordinate mondo)"
            m.Notes = "Tutte le coordinate nel sistema del progetto: con un piano inclinato l'utensile va orientato a mano secondo l'asse indicato."
            m.Tilt = "world"
            Return m
        End Function

        ''' <summary>LinuxCNC: archi, cambio utensile automatico, G64 P per i movimenti smooth.</summary>
        Public Function LinuxCnc() As MachineDef
            Return New MachineDef With {
                .Id = "linuxcnc", .Name = "LinuxCNC",
                .Notes = "Movimenti smooth con G64 P (tolleranza di raccordo) nelle lavorazioni, G61 per il movimento esatto.",
                .Tilt = "pause", .ApproachZFirst = True, .Dwell = "G4 P{SEC}", .SpindleDelay = 1,
                .ToolChange = "auto", .ToolChangeAuto = {"T{T} M6"}, .LengthComp = True,
                .MotionPocket = "smooth", .MotionFinish = "smooth", .SmoothTolerance = 0.02, .MotionEnd = {"G64"},
                .Header = {"%", "({NAME})", "(GENERATO DA CARVECAM - {DATE} {TIME})", "G21 G90 G94 G17 G40 G49 G80", "G54"},
                .Footer = {"G49", "M30", "%"}}
        End Function

        ''' <summary>Mach3 / Mach4: archi IJ incrementali, cambio utensile automatico.</summary>
        Public Function Mach3() As MachineDef
            Return New MachineDef With {
                .Id = "mach3", .Name = "Mach3 / Mach4",
                .Notes = "Archi con centro incrementale (impostare IJ incrementale anche in Mach); G64 per il movimento continuo.",
                .Tilt = "pause", .ApproachZFirst = True, .Dwell = "G4 P{SEC}", .SpindleDelay = 2,
                .ToolChange = "manual", .MotionPocket = "smooth", .MotionFinish = "smooth", .MotionSmooth = "G64", .MotionExact = "G61",
                .Header = {"({NAME})", "(GENERATO DA CARVECAM - {DATE} {TIME})", "G21 G90 G91.1 G94 G17 G40 G49", "G54"},
                .Footer = {"M5", "M30"}}
        End Function

        ''' <summary>Controllo generico che accetta solo G0/G1: gli archi diventano corde.</summary>
        Public Function GenericG1() As MachineDef
            Return New MachineDef With {
                .Id = "generic-g1", .Name = "Generico solo G1",
                .Notes = "Solo movimenti lineari: gli archi si rifanno a corde con errore e lunghezza minima e massima.",
                .Arcs = False, .ChordTolerance = 0.01, .ChordMin = 0.02, .ChordMax = 5,
                .Tilt = "pause", .ApproachZFirst = True, .CommentStyle = "semicolon",
                .Header = {"; {NAME}", "; GENERATO DA CARVECAM - {DATE} {TIME}", "G21 G90 G94", "G54"},
                .Footer = {"M5", "M30"}}
        End Function

        Public Function All() As List(Of MachineDef)
            Return New List(Of MachineDef) From {Grbl(), Fanuc3p2(), IsoWorld(), LinuxCnc(), Mach3(), GenericG1()}
        End Function

        ''' <summary>Macchina dal vecchio campo Mode delle opzioni ("grbl", "g682", "world").</summary>
        Public Function FromMode(mode As String) As MachineDef
            Select Case If(mode, "").ToLowerInvariant()
                Case "grbl" : Return Grbl()
                Case "world" : Return IsoWorld()
                Case Else : Return Fanuc3p2()
            End Select
        End Function

    End Module

End Namespace
