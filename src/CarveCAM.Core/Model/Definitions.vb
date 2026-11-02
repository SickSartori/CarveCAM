Namespace Model

    ''' <summary>Oggetto mesh importato, posizionato nella scena.</summary>
    Public Class SceneObjectDef
        Public Property MeshId As String
        Public Property Name As String
        Public Property Position As Double() = {0, 0, 0}
        ''' <summary>Rotazione Euler XYZ in gradi (convenzione Three.js).</summary>
        Public Property Rotation As Double() = {0, 0, 0}
        Public Property Scale As Double() = {1, 1, 1}
        ''' <summary>Se falso l'oggetto non viene considerato nel calcolo dei percorsi.</summary>
        Public Property Include As Boolean = True
    End Class

    ''' <summary>Artefatto primitivo: box, cylinder, cone (tronco di cono), sphere. Centrato nella propria origine, asse lungo Z locale.</summary>
    Public Class ArtifactDef
        Public Property Id As String
        Public Property Name As String
        Public Property Kind As String = "box"
        ''' <summary>Dimensioni del parallelepipedo (X,Y,Z).</summary>
        Public Property Size As Double() = {20, 20, 20}
        ''' <summary>Raggio (sfera, cilindro) o raggio inferiore (tronco di cono).</summary>
        Public Property Radius As Double = 10
        ''' <summary>Raggio superiore del tronco di cono.</summary>
        Public Property Radius2 As Double = 5
        Public Property Height As Double = 20
        Public Property Position As Double() = {0, 0, 0}
        Public Property Rotation As Double() = {0, 0, 0}
        Public Property Include As Boolean = True
        ''' <summary>
        ''' Triangoli nel sistema locale (9 valori per triangolo) per gli artefatti non parametrici, come il
        ''' profilo estruso ("extrude"): li prepara il client con la stessa geometria che mostra.
        ''' </summary>
        Public Property Mesh As Single()
    End Class

    ''' <summary>Piano di lavoro: origine e assi (U,V nel piano, N normale = asse utensile).</summary>
    Public Class PlaneDef
        Public Property Origin As Double() = {0, 0, 0}
        Public Property U As Double() = {1, 0, 0}
        Public Property V As Double() = {0, 1, 0}
        Public Property N As Double() = {0, 0, 1}
    End Class

    ''' <summary>Entità di sketch in coordinate piano (u,v). Kind: polyline, rect, circle, polygon.</summary>
    Public Class SketchEntityDef
        Public Property Id As String
        Public Property Kind As String
        Public Property Pts As Double()()
        Public Property Closed As Boolean = True
        Public Property X1 As Double
        Public Property Y1 As Double
        Public Property X2 As Double
        Public Property Y2 As Double
        Public Property Cx As Double
        Public Property Cy As Double
        Public Property R As Double
        Public Property Sides As Integer = 6
        ''' <summary>Rotazione in gradi (poligono regolare).</summary>
        Public Property Rot As Double
    End Class

    Public Class ToolDef
        Public Property Number As Integer = 1
        ''' <summary>"flat" (fresa cilindrica), "ball" (fresa sferica) o "bull" (fresa torica).</summary>
        Public Property Type As String = "flat"
        Public Property Diameter As Double = 6
        ''' <summary>Raggio di raccordo dello spigolo (solo fresa torica) [mm].</summary>
        Public Property CornerRadius As Double = 1
        ''' <summary>Senso di rotazione visto dal mandrino verso il pezzo: "cw" orario (M3) o "ccw" antiorario (M4).</summary>
        Public Property Rotation As String = "cw"
        ''' <summary>Lavora concorde (climb): avanzamento concorde al senso di rotazione dell'utensile; falso: discorde.</summary>
        Public Property Climb As Boolean = True
        Public ReadOnly Property IsCcw As Boolean
            Get
                Return String.Equals(Rotation, "ccw", StringComparison.OrdinalIgnoreCase)
            End Get
        End Property
        ''' <summary>
        ''' Verso dei percorsi chiusi come per la fresatura concorde con mandrino orario: concorde con utensile orario,
        ''' oppure discorde con utensile antiorario (il verso di rotazione inverte quello di concorde e discorde).
        ''' </summary>
        Public ReadOnly Property ClimbM3 As Boolean
            Get
                Return Climb Xor IsCcw
            End Get
        End Property
        Public ReadOnly Property Radius As Double
            Get
                Return Diameter / 2
            End Get
        End Property
        Public ReadOnly Property IsBall As Boolean
            Get
                Return String.Equals(Type, "ball", StringComparison.OrdinalIgnoreCase)
            End Get
        End Property
        Public ReadOnly Property IsBull As Boolean
            Get
                Return String.Equals(Type, "bull", StringComparison.OrdinalIgnoreCase)
            End Get
        End Property
        ''' <summary>Raggio di raccordo effettivo: 0 cilindrica, R sferica, [0,R] torica.</summary>
        Public ReadOnly Property EffectiveCorner As Double
            Get
                If IsBall Then Return Radius
                If IsBull Then Return Math.Max(0, Math.Min(CornerRadius, Radius))
                Return 0
            End Get
        End Property

        ' ------------------------------------------------------------ fresa conica ("taper")
        ''' <summary>Altezza del tagliente [mm]: per la fresa conica è l'altezza del cono.</summary>
        Public Property FluteLength As Double
        ''' <summary>Fresa conica: angolo di conicità per lato, rispetto all'asse [gradi].</summary>
        Public Property TaperAngle As Double = 5
        ''' <summary>Fresa conica: punta "flat" (piatta, a V se il diametro in punta è 0) o "ball" (sferica).</summary>
        Public Property TipType As String = "flat"

        ''' <summary>Fresa conica: Diameter è il diametro in punta (0 = punta a V).</summary>
        Public ReadOnly Property IsTaper As Boolean
            Get
                Return String.Equals(Type, "taper", StringComparison.OrdinalIgnoreCase)
            End Get
        End Property

        Public ReadOnly Property TipIsBall As Boolean
            Get
                Return IsTaper AndAlso String.Equals(TipType, "ball", StringComparison.OrdinalIgnoreCase) AndAlso Diameter > 0
            End Get
        End Property

        Public ReadOnly Property TaperTan As Double
            Get
                Return Math.Tan(Math.Max(0.1, Math.Min(80.0, TaperAngle)) * Math.PI / 180.0)
            End Get
        End Property

        Public ReadOnly Property ConeHeight As Double
            Get
                Return If(FluteLength > 0, FluteLength, Math.Max(10.0, 3 * Diameter))
            End Get
        End Property

        ''' <summary>Raggio del tagliente all'altezza h sopra la punta (fresa conica; le altre: raggio costante).</summary>
        Public Function RadiusAt(h As Double) As Double
            If Not IsTaper Then Return Radius
            Dim hh = Math.Max(0, Math.Min(h, ConeHeight))
            Dim rt = Math.Max(0, Radius)
            If TipIsBall Then
                Dim a = Math.Atan(TaperTan)
                Dim q0 = rt * Math.Cos(a), h0 = rt * (1 - Math.Sin(a))
                If hh <= h0 Then Return Math.Sqrt(Math.Max(0, rt * rt - (rt - hh) * (rt - hh)))
                Return q0 + (hh - h0) * TaperTan
            End If
            Return rt + hh * TaperTan
        End Function

        ''' <summary>
        ''' Quota del punto più basso del tagliente rispetto alla punta, lungo Z mondo, con l'asse utensile (dalla
        ''' punta verso il mandrino) di componente Z axisZ: 0 con l'asse verticale, negativa con l'asse inclinato
        ''' (scende il bordo del tagliente).
        ''' </summary>
        Public Function LowestOffset(axisZ As Double) As Double
            Dim nz = Math.Max(-1, Math.Min(1, axisZ))
            Dim s = Math.Sqrt(Math.Max(0, 1 - nz * nz))
            If s < 0.000000001 Then Return If(nz >= 0, 0, -ConeHeight)
            Dim rc = EffectiveCorner, r = Radius
            Dim prof = Function(h As Double) As Double
                           If IsTaper Then Return RadiusAt(h)
                           If h < rc Then Return (r - rc) + Math.Sqrt(Math.Max(0, rc * rc - (rc - h) * (rc - h)))
                           Return r
                       End Function
            ' con l'asse rivolto in basso conta solo il primo tratto (raccordo, cono); altrimenti tutto il tagliente
            Dim hMax = If(IsTaper OrElse nz <= 0, ConeHeight, Math.Max(rc, 0.000001))
            Dim best = 0.0
            Const N = 256
            For k = 0 To N
                Dim h = hMax * k / N
                best = Math.Min(best, h * nz - prof(h) * s)
            Next
            Return best
        End Function

        ''' <summary>Raggio massimo del tagliente (in cima al cono per la fresa conica).</summary>
        Public ReadOnly Property MaxRadius As Double
            Get
                Return If(IsTaper, RadiusAt(ConeHeight), Radius)
            End Get
        End Property

        ''' <summary>
        ''' Raggio "di lavoro" per contorni, passi e risoluzioni: per la fresa conica il raggio alla profondità
        ''' massima di lavoro (la parte più alta del cono resta sopra il piano, fuori dal materiale).
        ''' </summary>
        Public Function WorkRadius(maxDepth As Double) As Double
            If Not IsTaper Then Return Radius
            Return Math.Max(0.02, RadiusAt(Math.Min(Math.Max(0, maxDepth), ConeHeight)))
        End Function

        ''' <summary>Profilo del tagliente (metà, dalla punta) per punti (raggio, altezza): riferimento per i test; il drop-cutter usa tratti esatti.</summary>
        Public Function TaperProfile() As List(Of (Q As Double, H As Double))
            Dim pts As New List(Of (Q As Double, H As Double))()
            Dim rt = Math.Max(0, Radius), lc = ConeHeight, tn = TaperTan
            If TipIsBall Then
                Dim a = Math.Atan(tn)
                Dim phiMax = Math.PI / 2 - a   ' punto di tangenza tra sfera e cono
                Dim n = 24
                For i = 0 To n
                    Dim phi = phiMax * i / n
                    Dim h = rt * (1 - Math.Cos(phi))
                    If h > lc Then Exit For
                    pts.Add((rt * Math.Sin(phi), h))
                Next
                Dim q0 = rt * Math.Cos(a), h0 = rt * (1 - Math.Sin(a))
                If lc > h0 Then pts.Add((q0 + (lc - h0) * tn, lc))
            Else
                pts.Add((0.0, 0.0))
                If rt > 0.000001 Then pts.Add((rt, 0.0))
                pts.Add((rt + lc * tn, lc))
            End If
            Return pts
        End Function
    End Class

    ''' <summary>Parametri di una lavorazione.</summary>
    Public Class OperationDef
        Public Property Id As String
        Public Property Name As String = "Lavorazione"
        ''' <summary>"pocket" (svuotatura a terrazze) o "finish" (finitura in proiezione).</summary>
        Public Property Kind As String = "pocket"
        ''' <summary>"concentric" (offset) o "zigzag" (rettangolare).</summary>
        Public Property Strategy As String = "concentric"
        Public Property Tool As New ToolDef()
        ''' <summary>Passo laterale [mm].</summary>
        Public Property Stepover As Double = 2.5
        ''' <summary>Passo verticale tra le terrazze [mm] (solo svuotatura).</summary>
        Public Property Stepdown As Double = 1
        ''' <summary>Profondità massima sotto il piano [mm].</summary>
        Public Property MaxDepth As Double = 10
        ''' <summary>Sovrametallo lasciato sugli oggetti [mm].</summary>
        Public Property Stock As Double = 0
        ''' <summary>Quota di sicurezza sopra il piano [mm].</summary>
        Public Property SafeHeight As Double = 10
        ''' <summary>Distanza di avvicinamento in rapido prima dell'affondo [mm].</summary>
        Public Property Clearance As Double = 1
        ''' <summary>Angolo delle passate zigzag [gradi].</summary>
        Public Property Angle As Double = 0
        ''' <summary>Vero: l'utensile resta interamente dentro il contorno; falso: il centro utensile percorre il contorno.</summary>
        Public Property ToolInside As Boolean = True
        ''' <summary>Passata di contornatura finale ad ogni terrazza (zigzag).</summary>
        Public Property ContourPass As Boolean = True
        ''' <summary>Risoluzione della griglia di calcolo [mm], 0 = automatica.</summary>
        Public Property Resolution As Double = 0
        ''' <summary>Tolleranza cordale del percorso [mm].</summary>
        Public Property Tolerance As Double = 0.01
        Public Property Feed As Double = 1200
        Public Property Plunge As Double = 300
        Public Property Spindle As Double = 12000
        ''' <summary>Ingresso nel materiale (svuotatura): "plunge" (affondo verticale), "ramp" (rampa), "helix" (elica).</summary>
        Public Property Entry As String = "plunge"
        ''' <summary>Angolo di discesa di rampa ed elica [gradi].</summary>
        Public Property RampAngle As Double = 3
        ''' <summary>Raggio dell'elica (percorso del centro utensile) [mm], 0 = automatico (metà raggio utensile).</summary>
        Public Property HelixRadius As Double = 0
        ''' <summary>Avanzamento in rampa/elica [mm/min], 0 = avanzamento di lavoro.</summary>
        Public Property RampFeed As Double = 0
    End Class

    ''' <summary>Richiesta di calcolo percorso: tutto ciò che serve per essere autosufficiente.</summary>
    ''' <summary>Solidi del grezzo (materiale da lavorare, non ostacoli).</summary>
    Public Class StockDef
        Public Property Objects As List(Of SceneObjectDef)
        Public Property Artifacts As List(Of ArtifactDef)
    End Class

    Public Class ComputeRequest
        Public Property Operation As OperationDef
        Public Property Plane As PlaneDef
        Public Property Boundary As List(Of SketchEntityDef)
        Public Property Objects As List(Of SceneObjectDef)
        Public Property Artifacts As List(Of ArtifactDef)
        ''' <summary>Grezzo iniziale (prima lavorazione).</summary>
        Public Property Stock As StockDef
        ''' <summary>Percorso della lavorazione precedente: il grezzo parte da quello che ha lasciato.</summary>
        Public Property StockFrom As String
        ''' <summary>Quota Z mondo sotto cui l'utensile non scende (piano della griglia); Nothing = nessun limite.</summary>
        Public Property Floor As Double?
    End Class

End Namespace
