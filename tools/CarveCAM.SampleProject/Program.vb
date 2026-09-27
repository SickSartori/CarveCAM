Imports System.Globalization
Imports System.IO
Imports System.IO.Compression
Imports System.Text
Imports System.Text.Encodings.Web
Imports System.Text.Json
Imports System.Threading
Imports CarveCAM.Core.Cam
Imports CarveCAM.Core.Geometry
Imports CarveCAM.Core.Meshes
Imports CarveCAM.Core.Model
Imports CarveCAM.Core.Post

''' <summary>
''' Genera il progetto di prova di CarveCAM con il motore VB.NET: pezzo "Stampo" (mesh), artefatti,
''' piani, sketch e quattro lavorazioni. Calcola i percorsi, verifica le collisioni e scrive:
''' progetto .ccam, modelli STL/OBJ, G-code di riferimento, LEGGIMI.txt e risultati-calcolo.txt.
''' Uso: dotnet run --project tools/CarveCAM.SampleProject [-- cartella_di_uscita]
''' Codice di uscita 1 se un percorso presenta interferenze.
''' </summary>
Module Program

    Private ReadOnly Inv As CultureInfo = CultureInfo.InvariantCulture
    Private ReadOnly Ita As CultureInfo = CultureInfo.GetCultureInfo("it-IT")
    Private Const MaxAllowedGouge = 0.01

    Function Main(args As String()) As Integer
        If args.Length > 0 AndAlso (args(0) = "-h" OrElse args(0) = "--help" OrElse args(0) = "/?") Then
            Console.WriteLine("Uso: CarveCAM.SampleProject [cartella_di_uscita]")
            Console.WriteLine("Predefinita: Desktop\CarveCAM - Progetto di prova")
            Return 0
        End If
        Dim outDir = If(args.Length > 0, args(0),
                        Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Desktop), "CarveCAM - Progetto di prova"))
        Directory.CreateDirectory(Path.Combine(outDir, "modelli"))

        Dim scene = BuildScene()
        Dim md As New MeshData("stampo", "Stampo", scene.Mesh)
        Dim bb = md.Bounds()
        Console.WriteLine(String.Format(Ita, "Stampo: {0:N0} triangoli, {1:0.#} x {2:0.#} x {3:0.#} mm",
                                        md.TriangleCount, bb.Max.X - bb.Min.X, bb.Max.Y - bb.Min.Y, bb.Max.Z - bb.Min.Z))

        ' ---- calcolo dei percorsi con il motore VB
        Dim objects As New List(Of SceneObjectDef) From {New SceneObjectDef With {.MeshId = scene.MeshId, .Name = "Stampo"}}
        Dim provider = Function(id As String) If(id = scene.MeshId, scene.Mesh, Nothing)
        Dim paths As New List(Of Toolpath)()
        Dim results As New List(Of String)()
        Dim failed = False
        For Each j In scene.Jobs
            Dim req As New ComputeRequest With {.Operation = j.Op, .Plane = j.Plane, .Boundary = j.Boundary, .Objects = objects, .Artifacts = scene.Artifacts}
            Dim tp = CamEngine.Compute(req, provider, CancellationToken.None)
            paths.Add(tp)
            Dim line = Summary(tp)
            Console.WriteLine(line)
            results.Add(line)
            For Each w In tp.Warnings
                Console.WriteLine("      ! " & w)
                results.Add("      ! " & w)
            Next
            If tp.Stats.MaxGouge > MaxAllowedGouge Then failed = True
        Next

        ' ---- file di uscita
        WriteProject(Path.Combine(outDir, "Progetto di prova.ccam"), scene, md, bb)
        WriteStl(Path.Combine(outDir, "modelli", "stampo.stl"), scene.Mesh)
        WriteObj(Path.Combine(outDir, "modelli", "stampo.obj"), scene.Mesh)
        Dim g = PostProcessor.GCode(paths, New PostOptions With {.ProgramName = "PROGETTO DI PROVA", .ProgramNumber = 2001})
        File.WriteAllText(Path.Combine(outDir, "Progetto di prova.nc"), g, Encoding.ASCII)
        Dim grbl = PostProcessor.GCode(paths, New PostOptions With {.Mode = "grbl", .ProgramName = "PROGETTO DI PROVA", .Coolant = False})
        File.WriteAllText(Path.Combine(outDir, "Progetto di prova - GRBL.nc"), grbl, Encoding.ASCII)
        File.WriteAllText(Path.Combine(outDir, "risultati-calcolo.txt"), String.Join(Environment.NewLine, results) & Environment.NewLine, New UTF8Encoding(False))
        File.WriteAllText(Path.Combine(outDir, "LEGGIMI.txt"), Readme(scene, md, bb, results), New UTF8Encoding(False))

        Console.WriteLine(String.Format(Ita, "G-code: {0:N0} righe", g.Split(ControlChars.Lf).Length))
        Console.WriteLine("Scritto in: " & outDir)
        If failed Then
            Console.Error.WriteLine($"ERRORE: interferenza oltre {MaxAllowedGouge} mm in almeno un percorso.")
            Return 1
        End If
        Return 0
    End Function

    ' ================================================================ scena di prova
    Private NotInheritable Class Job
        Public Op As OperationDef
        Public Plane As PlaneDef
        Public Boundary As List(Of SketchEntityDef)
        Public SketchId As String
    End Class

    Private NotInheritable Class PlaneInfo
        Public Id As String
        Public Name As String
        Public Origin As Vec3
        Public Normal As Vec3
        Public Size As Double
        Public Sketches As New List(Of (Id As String, Name As String, Entities As List(Of SketchEntityDef)))()
    End Class

    Private NotInheritable Class Scene
        Public Mesh As Single()
        Public MeshId As String
        Public Artifacts As List(Of ArtifactDef)
        Public Planes As New List(Of PlaneInfo)()
        Public Jobs As New List(Of Job)()
    End Class

    Private Function NewId(prefix As String) As String
        Return prefix & "_" & Guid.NewGuid().ToString("N").Substring(0, 12)
    End Function

    Private Function Solid(kind As String, pos As Double(), Optional size As Double() = Nothing,
                           Optional radius As Double = 10, Optional radius2 As Double = 5, Optional height As Double = 20) As Single()
        Return Primitives.Build(New ArtifactDef With {.Kind = kind, .Position = pos, .Size = If(size, {20.0, 20.0, 20.0}),
                                                      .Radius = radius, .Radius2 = radius2, .Height = height})
    End Function

    Private Function PlaneDefOf(p As PlaneInfo) As PlaneDef
        Dim f = PlaneFrame.FromNormalAngle(p.Origin, p.Normal, 0)
        Return New PlaneDef With {.Origin = f.Origin.ToArray(), .U = f.U.ToArray(), .V = f.V.ToArray(), .N = f.N.ToArray()}
    End Function

    Private Function BuildScene() As Scene
        Dim sc As New Scene()

        ' pezzo "Stampo": solidi chiusi sovrapposti (il drop-cutter non richiede un'unione booleana), base a Z=0
        Dim soup As New List(Of Single)()
        soup.AddRange(Solid("box", {0, 0, 8}, {160, 100, 16}))                       ' piastra 160x100x16
        soup.AddRange(Solid("cylinder", {-38, 0, 22}, radius:=18, height:=12))        ' boss cilindrico
        soup.AddRange(Solid("sphere", {-38, 0, 22}, radius:=18))                      ' cupola (sommità Z=40)
        soup.AddRange(Solid("cone", {38, 0, 24}, radius:=20, radius2:=9, height:=16)) ' tronco di cono (sommità Z=32)
        soup.AddRange(Solid("box", {0, 0, 20.5}, {12, 70, 9}))                       ' nervatura
        For Each sx In {-64.0, 64.0}
            For Each sy In {-38.0, 38.0}
                soup.AddRange(Solid("cylinder", {sx, sy, 19}, radius:=4, height:=6))  ' perni
            Next
        Next
        sc.Mesh = MeshData.Sanitize(soup.ToArray())
        sc.MeshId = Guid.NewGuid().ToString("N")

        ' artefatti: attrezzature che l'utensile deve evitare
        sc.Artifacts = New List(Of ArtifactDef) From {
            New ArtifactDef With {.Id = NewId("art"), .Name = "Staffa sinistra", .Kind = "box", .Size = {16, 24, 10}, .Position = {-70, 0, 21}, .Rotation = {0, 0, 0}},
            New ArtifactDef With {.Id = NewId("art"), .Name = "Staffa destra", .Kind = "box", .Size = {16, 24, 10}, .Position = {70, 0, 21}, .Rotation = {0, 0, 0}},
            New ArtifactDef With {.Id = NewId("art"), .Name = "Perno di riferimento", .Kind = "cylinder", .Radius = 5, .Height = 34, .Position = {0, -44, 17}, .Rotation = {0, 0, 0}},
            New ArtifactDef With {.Id = NewId("art"), .Name = "Tastatore", .Kind = "sphere", .Radius = 6, .Position = {-60, 40, 24}, .Rotation = {0, 0, 0}}}

        ' piano superiore: contorno del grezzo con isole attorno alle staffe + zona della nervatura
        Dim top As New PlaneInfo With {.Id = NewId("pl"), .Name = "Piano superiore", .Origin = New Vec3(0, 0, 45), .Normal = Vec3.UnitZ, .Size = 190}
        Dim skOutline = (NewId("sk"), "Contorno grezzo (con isole staffe)", New List(Of SketchEntityDef) From {
            New SketchEntityDef With {.Id = NewId("e"), .Kind = "rect", .X1 = -78, .Y1 = -48, .X2 = 78, .Y2 = 48},
            New SketchEntityDef With {.Id = NewId("e"), .Kind = "rect", .X1 = -77, .Y1 = -15, .X2 = -60, .Y2 = 15},
            New SketchEntityDef With {.Id = NewId("e"), .Kind = "rect", .X1 = 60, .Y1 = -15, .X2 = 77, .Y2 = 15}})
        Dim skRib = (NewId("sk"), "Zona nervatura", New List(Of SketchEntityDef) From {
            New SketchEntityDef With {.Id = NewId("e"), .Kind = "polyline", .Closed = True,
                .Pts = {New Double() {-22, -40}, New Double() {22, -40}, New Double() {28, 0}, New Double() {22, 40}, New Double() {-22, 40}, New Double() {-28, 0}}}})
        top.Sketches.Add(skOutline)
        top.Sketches.Add(skRib)

        ' piano inclinato di 30° sopra il tronco di cono (asse utensile inclinato: 3+2)
        Dim n2 = New Vec3(0.5, 0, Math.Sqrt(3) / 2)
        Dim tilted As New PlaneInfo With {.Id = NewId("pl"), .Name = "Piano inclinato 30°", .Origin = New Vec3(38, 0, 24) + n2 * 24, .Normal = n2, .Size = 80}
        Dim skCone = (NewId("sk"), "Fianco cono", New List(Of SketchEntityDef) From {
            New SketchEntityDef With {.Id = NewId("e"), .Kind = "circle", .Cx = 0, .Cy = 0, .R = 28}})
        tilted.Sketches.Add(skCone)
        sc.Planes.Add(top)
        sc.Planes.Add(tilted)

        ' lavorazioni
        Dim op1 As New OperationDef With {.Id = NewId("op"), .Name = "Sgrossatura torica (elica)", .Kind = "pocket", .Strategy = "concentric",
            .Tool = New ToolDef With {.Number = 1, .Type = "bull", .Diameter = 12, .CornerRadius = 1.5},
            .Stepover = 6, .Stepdown = 3, .MaxDepth = 29, .Stock = 0.4, .SafeHeight = 10, .Clearance = 1,
            .Feed = 1800, .Plunge = 400, .Spindle = 10000, .Entry = "helix", .RampAngle = 3, .RampFeed = 700}
        Dim op2 As New OperationDef With {.Id = NewId("op"), .Name = "Svuotatura nervatura (rampa)", .Kind = "pocket", .Strategy = "zigzag", .Angle = 90,
            .Tool = New ToolDef With {.Number = 4, .Type = "flat", .Diameter = 8, .CornerRadius = 1},
            .Stepover = 4, .Stepdown = 2, .MaxDepth = 29, .Stock = 0.4, .SafeHeight = 10, .Clearance = 1, .ContourPass = True,
            .Feed = 1500, .Plunge = 300, .Spindle = 12000, .Entry = "ramp", .RampAngle = 4, .RampFeed = 600}
        Dim op3 As New OperationDef With {.Id = NewId("op"), .Name = "Finitura sferica 45°", .Kind = "finish", .Strategy = "zigzag", .Angle = 45,
            .Tool = New ToolDef With {.Number = 2, .Type = "ball", .Diameter = 6, .CornerRadius = 1},
            .Stepover = 0.6, .MaxDepth = 29, .Stock = 0, .SafeHeight = 10, .Clearance = 2, .ContourPass = False,
            .Feed = 2200, .Plunge = 500, .Spindle = 14000, .Entry = "plunge"}
        Dim op4 As New OperationDef With {.Id = NewId("op"), .Name = "Finitura 3+2 torica (piano 30°)", .Kind = "finish", .Strategy = "concentric",
            .Tool = New ToolDef With {.Number = 3, .Type = "bull", .Diameter = 8, .CornerRadius = 2},
            .Stepover = 1, .MaxDepth = 45, .Stock = 0, .SafeHeight = 10, .Clearance = 2, .ContourPass = False,
            .Feed = 1600, .Plunge = 400, .Spindle = 12000, .Entry = "plunge"}

        Dim pTop = PlaneDefOf(top), pTilted = PlaneDefOf(tilted)
        sc.Jobs.Add(New Job With {.Op = op1, .Plane = pTop, .Boundary = skOutline.Item3, .SketchId = skOutline.Item1})
        sc.Jobs.Add(New Job With {.Op = op2, .Plane = pTop, .Boundary = skRib.Item3, .SketchId = skRib.Item1})
        sc.Jobs.Add(New Job With {.Op = op3, .Plane = pTop, .Boundary = skOutline.Item3, .SketchId = skOutline.Item1})
        sc.Jobs.Add(New Job With {.Op = op4, .Plane = pTilted, .Boundary = skCone.Item3, .SketchId = skCone.Item1})
        Return sc
    End Function

    ' ================================================================ progetto .ccam (formato del client web)
    Private Function EntityJson(e As SketchEntityDef) As Object
        Select Case e.Kind
            Case "rect" : Return New With {.Id = e.Id, .Kind = e.Kind, .X1 = e.X1, .Y1 = e.Y1, .X2 = e.X2, .Y2 = e.Y2}
            Case "circle" : Return New With {.Id = e.Id, .Kind = e.Kind, .Cx = e.Cx, .Cy = e.Cy, .R = e.R}
            Case "polygon" : Return New With {.Id = e.Id, .Kind = e.Kind, .Cx = e.Cx, .Cy = e.Cy, .R = e.R, .Sides = e.Sides, .Rot = e.Rot}
            Case Else : Return New With {.Id = e.Id, .Kind = e.Kind, .Pts = e.Pts, .Closed = True}
        End Select
    End Function

    Private Function OperationJson(o As OperationDef, sketchId As String) As Object
        Return New With {
            .Id = o.Id, .Name = o.Name, .Kind = o.Kind, .SketchId = sketchId, .Visible = True, .Strategy = o.Strategy,
            .Tool = New With {.Number = o.Tool.Number, .Type = o.Tool.Type, .Diameter = o.Tool.Diameter, .CornerRadius = o.Tool.CornerRadius},
            .Stepover = o.Stepover, .Stepdown = o.Stepdown, .MaxDepth = o.MaxDepth, .Stock = o.Stock, .SafeHeight = o.SafeHeight,
            .Clearance = o.Clearance, .Angle = o.Angle, .Climb = o.Climb, .ToolInside = o.ToolInside, .ContourPass = o.ContourPass,
            .Resolution = o.Resolution, .Tolerance = o.Tolerance, .Feed = o.Feed, .Plunge = o.Plunge, .Spindle = o.Spindle,
            .Entry = o.Entry, .RampAngle = o.RampAngle, .HelixRadius = o.HelixRadius, .RampFeed = o.RampFeed}
    End Function

    Private Sub WriteProject(file As String, sc As Scene, md As MeshData, bb As BBox3)
        Dim project = New With {
            .Format = "carvecam", .Version = 1, .Name = "Progetto di prova", .Units = "mm",
            .Objects = New Object() {New With {
                .Id = NewId("obj"), .Name = "Stampo", .MeshId = sc.MeshId, .Position = {0.0, 0.0, 0.0}, .Rotation = {0.0, 0.0, 0.0}, .Scale = {1.0, 1.0, 1.0},
                .Color = "#9aa8b8", .Visible = True, .Include = True, .Triangles = md.TriangleCount,
                .Size = {bb.Max.X - bb.Min.X, bb.Max.Y - bb.Min.Y, bb.Max.Z - bb.Min.Z}, .Source = "stampo.stl"}},
            .Artifacts = sc.Artifacts.Select(Function(a) CObj(New With {
                .Id = a.Id, .Name = a.Name, .Kind = a.Kind, .Size = a.Size, .Radius = a.Radius, .Radius2 = a.Radius2, .Height = a.Height,
                .Position = a.Position, .Rotation = a.Rotation, .Color = If(a.Kind = "sphere", "#ff7a59", "#ffb547"), .Visible = True, .Include = True})).ToArray(),
            .Planes = sc.Planes.Select(Function(p) CObj(New With {
                .Id = p.Id, .Name = p.Name, .Origin = p.Origin.ToArray(), .Normal = p.Normal.ToArray(), .Angle = 0.0, .Size = p.Size, .Visible = True,
                .Sketches = p.Sketches.Select(Function(s) CObj(New With {
                    .Id = s.Id, .Name = s.Name, .Visible = True, .Entities = s.Entities.Select(Function(e) EntityJson(e)).ToArray()})).ToArray()})).ToArray(),
            .Operations = sc.Jobs.Select(Function(j) OperationJson(j.Op, j.SketchId)).ToArray(),
            .Counters = New Dictionary(Of String, Integer) From {
                {"Piano", sc.Planes.Count}, {"Sketch", sc.Planes.Sum(Function(p) p.Sketches.Count)},
                {"Svuotatura", sc.Jobs.Where(Function(j) j.Op.Kind = "pocket").Count()}, {"Finitura", sc.Jobs.Where(Function(j) j.Op.Kind = "finish").Count()}}}
        Dim json = JsonSerializer.Serialize(project, New JsonSerializerOptions With {
            .PropertyNamingPolicy = JsonNamingPolicy.CamelCase, .WriteIndented = True, .Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping})

        If IO.File.Exists(file) Then IO.File.Delete(file)
        Using fs = IO.File.Create(file), zip As New ZipArchive(fs, ZipArchiveMode.Create)
            Using w As New StreamWriter(zip.CreateEntry("project.json").Open(), New UTF8Encoding(False))
                w.Write(json)
            End Using
            Using s = zip.CreateEntry($"meshes/{sc.MeshId}.bin", CompressionLevel.Optimal).Open()
                Dim bytes = MeshData.ToBytes(sc.Mesh)
                s.Write(bytes, 0, bytes.Length)
            End Using
        End Using
    End Sub

    ' ================================================================ testi
    Private Function Summary(tp As Toolpath) As String
        Dim s = tp.Stats
        Dim entries = If(tp.Kind = "pocket", String.Format(Ita, ", ingressi elica/rampa/affondo {0}/{1}/{2}", s.HelixEntries, s.RampEntries, s.PlungeEntries), "")
        Dim levels = If(tp.Kind = "pocket", String.Format(Ita, ", {0} terrazze", s.Levels), "")
        Return String.Format(Ita, "  - {0}: {1:N0} punti, lavoro {2:0.00} m, rapidi {3:0.00} m, ~{4:0.0} min{5}{6}, interferenza max {7:0.000} mm",
                             tp.Name, s.PointCount, s.FeedLength / 1000, s.RapidLength / 1000, s.EstimatedMinutes, levels, entries, s.MaxGouge)
    End Function

    Private Function ToolText(t As ToolDef) As String
        If t.IsBall Then Return String.Format(Ita, "fresa sferica D{0}", t.Diameter)
        If t.IsBull Then Return String.Format(Ita, "fresa torica D{0} R{1}", t.Diameter, t.EffectiveCorner)
        Return String.Format(Ita, "fresa cilindrica D{0}", t.Diameter)
    End Function

    Private Function OpText(o As OperationDef) As String
        Dim strat = If(o.Strategy = "zigzag", String.Format(Ita, "zigzag a {0}°", o.Angle), "concentrica")
        If o.Kind = "pocket" Then
            Dim entry = If(o.Entry = "helix", "ELICA", If(o.Entry = "ramp", "RAMPA", "affondo verticale"))
            Return String.Format(Ita, "svuotatura {0}, {1}, passo {2}, terrazze da {3} mm, sovrametallo {4}, ingresso {5} ({6}°)",
                                 strat, ToolText(o.Tool), o.Stepover, o.Stepdown, o.Stock, entry, o.RampAngle)
        End If
        Return String.Format(Ita, "finitura {0}, {1}, passo {2}", strat, ToolText(o.Tool), o.Stepover)
    End Function

    Private Function Readme(sc As Scene, md As MeshData, bb As BBox3, results As List(Of String)) As String
        Dim sb As New StringBuilder()
        sb.AppendLine("CARVECAM - PROGETTO DI PROVA")
        sb.AppendLine("==============================")
        sb.AppendLine($"Generato il {DateTime.Now:dd/MM/yyyy HH:mm} da tools/CarveCAM.SampleProject (motore VB.NET CarveCAM.Core).")
        sb.AppendLine()
        sb.AppendLine("COME APRIRLO")
        sb.AppendLine("1. Dalla cartella del repository avvia il server:")
        sb.AppendLine("     dotnet run --project src/CarveCAM.Server/CarveCAM.Server.vbproj")
        sb.AppendLine("2. Apri nel browser:  http://localhost:5080")
        sb.AppendLine("3. File > Apri progetto...  e scegli ""Progetto di prova.ccam""")
        sb.AppendLine("4. Lavorazioni > Calcola tutte  (oppure F9 sulla lavorazione selezionata)")
        sb.AppendLine("5. Lavorazioni > Simula  /  Esporta G-code...")
        sb.AppendLine()
        sb.AppendLine("CONTENUTO DEL PROGETTO (unità: mm, Z verso l'alto)")
        sb.AppendLine(String.Format(Ita, "- Oggetto ""Stampo"" (mesh, {0:N0} triangoli, {1:0.#} x {2:0.#} x {3:0.#}):",
                                    md.TriangleCount, bb.Max.X - bb.Min.X, bb.Max.Y - bb.Min.Y, bb.Max.Z - bb.Min.Z))
        sb.AppendLine("  piastra 160x100x16 con cupola, tronco di cono, nervatura centrale e 4 perni.")
        sb.AppendLine("- Artefatti (ostacoli): " & String.Join(", ", sc.Artifacts.Select(Function(a) a.Name)) & ".")
        For Each p In sc.Planes
            sb.AppendLine(String.Format(Inv, "- {0} (origine {1:0.##}, {2:0.##}, {3:0.##}; normale {4:0.###}, {5:0.###}, {6:0.###}):",
                                        p.Name, p.Origin.X, p.Origin.Y, p.Origin.Z, p.Normal.X, p.Normal.Y, p.Normal.Z))
            For Each s In p.Sketches
                sb.AppendLine($"    * sketch ""{s.Name}"": {s.Entities.Count} entità")
            Next
        Next
        sb.AppendLine("  Un contorno dentro un altro (isola) esclude la zona dalla lavorazione.")
        sb.AppendLine()
        sb.AppendLine("LAVORAZIONI")
        Dim i = 0
        For Each j In sc.Jobs
            i += 1
            sb.AppendLine($"{i}. {j.Op.Name}: {OpText(j.Op)}")
        Next
        sb.AppendLine()
        sb.AppendLine("RISULTATI DEL CALCOLO")
        For Each r In results
            sb.AppendLine(r)
        Next
        sb.AppendLine()
        sb.AppendLine("ALTRI FILE")
        sb.AppendLine("- modelli\stampo.stl, modelli\stampo.obj : lo stesso pezzo, per provare File > Importa modello 3D")
        sb.AppendLine("- Progetto di prova.nc : G-code di riferimento (Fanuc/ISO, G68.2 per il piano inclinato).")
        sb.AppendLine("- Progetto di prova - GRBL.nc : lo stesso programma per mini CNC GRBL a 3 assi; cambi utensile e")
        sb.AppendLine("  piazzamento sul piano inclinato con pausa M0 e istruzioni nei commenti.")
        sb.AppendLine("  Verificare sempre i programmi con il simulatore della propria macchina prima dell'uso.")
        sb.AppendLine("- risultati-calcolo.txt : statistiche del calcolo")
        Return sb.ToString()
    End Function

    ' ================================================================ modelli STL / OBJ
    Private Sub WriteStl(file As String, pos As Single())
        Using bw As New BinaryWriter(IO.File.Create(file))
            bw.Write(Encoding.ASCII.GetBytes("CarveCAM - stampo di prova (mm)".PadRight(80)), 0, 80)
            Dim n = pos.Length \ 9
            bw.Write(CUInt(n))
            For t = 0 To n - 1
                Dim a As New Vec3(pos(t * 9), pos(t * 9 + 1), pos(t * 9 + 2))
                Dim b As New Vec3(pos(t * 9 + 3), pos(t * 9 + 4), pos(t * 9 + 5))
                Dim c As New Vec3(pos(t * 9 + 6), pos(t * 9 + 7), pos(t * 9 + 8))
                Dim nn = (b - a).Cross(c - a).Normalized()
                bw.Write(CSng(nn.X)) : bw.Write(CSng(nn.Y)) : bw.Write(CSng(nn.Z))
                For k = 0 To 8
                    bw.Write(pos(t * 9 + k))
                Next
                bw.Write(CUShort(0))
            Next
        End Using
    End Sub

    Private Sub WriteObj(file As String, pos As Single())
        Dim index As New Dictionary(Of (Single, Single, Single), Integer)()
        Dim verts As New StringBuilder()
        Dim faces As New StringBuilder()
        Dim ids(2) As Integer
        For t = 0 To pos.Length \ 9 - 1
            For k = 0 To 2
                Dim key = (pos(t * 9 + k * 3), pos(t * 9 + k * 3 + 1), pos(t * 9 + k * 3 + 2))
                Dim id As Integer
                If Not index.TryGetValue(key, id) Then
                    id = index.Count + 1
                    index(key) = id
                    verts.AppendLine(String.Format(Inv, "v {0} {1} {2}", key.Item1, key.Item2, key.Item3))
                End If
                ids(k) = id
            Next
            faces.AppendLine($"f {ids(0)} {ids(1)} {ids(2)}")
        Next
        IO.File.WriteAllText(file, "# CarveCAM - stampo di prova (mm)" & vbLf & "o Stampo" & vbLf & verts.ToString() & faces.ToString(), New UTF8Encoding(False))
    End Sub

End Module
