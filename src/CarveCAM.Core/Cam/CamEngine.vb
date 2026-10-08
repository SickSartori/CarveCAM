Imports System.Diagnostics
Imports System.Threading
Imports Clipper2Lib
Imports CarveCAM.Core.Geometry
Imports CarveCAM.Core.Meshes
Imports CarveCAM.Core.Model

Namespace Cam

    ''' <summary>
    ''' Calcolo dei percorsi utensile.
    ''' - Svuotatura (pocket): parte dal piano di proiezione e scende a terrazze (stepdown); ad ogni quota
    '''   la regione lavorabile è il contorno disegnato meno lo spazio occupato (maggiorato dall'utensile)
    '''   da oggetti e artefatti. Si ferma a ridosso degli oggetti (più il sovrametallo).
    ''' - Finitura (finish): percorso 2D proiettato lungo la normale del piano direttamente sulle superfici
    '''   di oggetti e artefatti, senza passate intermedie.
    ''' </summary>
    Public Module CamEngine

        ''' <summary>
        ''' Calcola il percorso. previous: lavorazione precedente, il cui grezzo residuo è il punto di partenza;
        ''' altrimenti il grezzo sono i solidi di req.Stock (se ci sono).
        ''' </summary>
        Public Function Compute(req As ComputeRequest, meshProvider As Func(Of String, Single()), ct As CancellationToken,
                                Optional previous As Toolpath = Nothing) As Toolpath
            Dim sw = Stopwatch.StartNew()
            Dim op = req.Operation
            If op Is Nothing Then Throw New ArgumentException("Parametri della lavorazione mancanti.")
            If op.Tool Is Nothing OrElse op.Tool.Diameter < 0 OrElse (op.Tool.Diameter = 0 AndAlso Not op.Tool.IsTaper) Then Throw New ArgumentException("Diametro utensile non valido.")
            If op.MaxDepth <= 0 Then Throw New ArgumentException("La profondità massima deve essere maggiore di zero.")
            If op.Stepover <= 0 Then Throw New ArgumentException("Il passo laterale deve essere maggiore di zero.")
            Dim isPocket = Not String.Equals(op.Kind, "finish", StringComparison.OrdinalIgnoreCase)
            If isPocket AndAlso op.Stepdown <= 0 Then Throw New ArgumentException("Il passo verticale deve essere maggiore di zero.")

            Dim pl = If(req.Plane, New PlaneDef())
            Dim frame As New PlaneFrame(Vec3.FromArray(pl.Origin, Vec3.Zero), Vec3.FromArray(pl.U, Vec3.UnitX), Vec3.FromArray(pl.N, Vec3.UnitZ))
            ' raggio di lavoro (fresa conica: alla profondità massima) e ingombro massimo del tagliente
            Dim R = op.Tool.WorkRadius(op.MaxDepth)
            Dim stock = Math.Max(0, op.Stock)
            Dim stepover = Math.Min(op.Stepover, Math.Max(op.Tool.Diameter, 2 * R) * 0.95)

            Dim tp As New Toolpath With {
                .Id = Guid.NewGuid().ToString("N"),
                .OperationId = op.Id, .Name = op.Name, .Kind = If(isPocket, "pocket", "finish"),
                .Strategy = op.Strategy, .Tool = op.Tool, .Feed = op.Feed, .Plunge = op.Plunge, .Spindle = op.Spindle,
                .RampFeed = If(op.RampFeed > 0, op.RampFeed, op.Feed),
                .Frame = frame}
            If op.Tool.IsBull AndAlso (op.Tool.CornerRadius <= 0 OrElse op.Tool.CornerRadius > R) Then
                tp.Warnings.Add($"Raggio di raccordo della fresa torica limitato a {op.Tool.EffectiveCorner:0.###} mm.")
            End If
            If stepover < op.Stepover Then tp.Warnings.Add($"Passo laterale ridotto a {stepover:0.###} mm (max 95% del diametro).")
            If op.Tool.IsTaper AndAlso op.MaxDepth > op.Tool.ConeHeight Then
                tp.Warnings.Add($"Profondità massima ({op.MaxDepth:0.###} mm) oltre l'altezza del cono ({op.Tool.ConeHeight:0.###} mm): sopra il cono non si verificano collisioni.")
            End If

            ' ---- regione di contenimento
            Dim boundary = SketchGeometry.BoundaryRegion(req.Boundary)
            If boundary.Count = 0 Then Throw New ArgumentException("Lo sketch non contiene contorni chiusi.")
            Dim region0 = If(op.ToolInside, Poly.Offset(boundary, -R), Poly.Union(boundary))
            region0 = Poly.RemoveSmall(region0, 0.0001)
            If region0.Count = 0 Then Throw New ArgumentException("Il contorno è troppo piccolo per il diametro utensile.")
            Dim bb = Poly.Bounds(region0)

            ' ---- ostacoli: oggetti e artefatti in coordinate locali del piano
            Dim floor = -op.MaxDepth
            Dim margin = Math.Max(R, op.Tool.MaxRadius) + stock + 0.5
            Dim winMinU = bb.MinX - margin, winMaxU = bb.MaxX + margin, winMinV = bb.MinY - margin, winMaxV = bb.MaxY + margin
            Dim tris As New List(Of LocalTri)()
            Dim addPositions = Sub(pos As Single(), m As Mat4)
                                   For t = 0 To pos.Length - 9 Step 9
                                       Dim a = frame.ToLocal(Tp3(m, pos, t)), b = frame.ToLocal(Tp3(m, pos, t + 3)), c = frame.ToLocal(Tp3(m, pos, t + 6))
                                       If Math.Max(a.X, Math.Max(b.X, c.X)) < winMinU OrElse Math.Min(a.X, Math.Min(b.X, c.X)) > winMaxU OrElse
                                          Math.Max(a.Y, Math.Max(b.Y, c.Y)) < winMinV OrElse Math.Min(a.Y, Math.Min(b.Y, c.Y)) > winMaxV Then Continue For
                                       If Math.Max(a.Z, Math.Max(b.Z, c.Z)) + stock <= floor - 1 Then Continue For
                                       tris.Add(New LocalTri(a, b, c))
                                   Next
                               End Sub
            If req.Objects IsNot Nothing Then
                For Each o In req.Objects
                    If Not o.Include OrElse String.IsNullOrEmpty(o.MeshId) Then Continue For
                    Dim pos = meshProvider(o.MeshId)
                    If pos Is Nothing Then
                        tp.Warnings.Add($"Mesh '{o.Name}' non disponibile sul server: ignorata.")
                        Continue For
                    End If
                    addPositions(pos, Mat4.FromTRS(o.Position, o.Rotation, o.Scale))
                    ct.ThrowIfCancellationRequested()
                Next
            End If
            If req.Artifacts IsNot Nothing Then
                For Each a In req.Artifacts
                    If Not a.Include Then Continue For
                    addPositions(Primitives.Build(a), Nothing)
                Next
            End If
            ' limite al piano della griglia: un piano (z = Floor) sotto il pezzo, che la fresa tocca senza sovrametallo
            ' (abbassato del sovrametallo, che il drop-cutter riaggiunge) e appena più in basso per l'arrotondamento
            Dim floorZ As Double? = Nothing
            If req.Floor.HasValue Then
                If frame.N.Z < 0.05 Then
                    tp.Warnings.Add("Limite al piano della griglia non applicato: il piano della lavorazione è verticale o rivolto verso il basso.")
                Else
                    floorZ = req.Floor.Value
                    Dim zT = req.Floor.Value - stock - 0.0005
                    Dim corner = Function(u As Double, v As Double) As Vec3
                                     Return New Vec3(u, v, (zT - frame.Origin.Z - u * frame.U.Z - v * frame.V.Z) / frame.N.Z)
                                 End Function
                    Dim q0 = corner(winMinU, winMinV), q1 = corner(winMaxU, winMinV), q2 = corner(winMaxU, winMaxV), q3 = corner(winMinU, winMaxV)
                    If Math.Max(Math.Max(q0.Z, q1.Z), Math.Max(q2.Z, q3.Z)) + stock > floor - 1 Then
                        tris.Add(New LocalTri(q0, q1, q2))
                        tris.Add(New LocalTri(q0, q2, q3))
                    End If
                End If
            End If

            Dim dc = DropCutter.ForTool(tris, op.Tool, stock)
            tp.Stats.Triangles = dc.TriangleCount

            ' ---- grezzo nel sistema del piano: quello lasciato dalla lavorazione precedente, oppure i solidi del grezzo
            Dim stockMap As StockMap = Nothing
            If previous IsNot Nothing AndAlso previous.StockAfter IsNot Nothing Then
                stockMap = StockMap.Reframe(previous.StockAfter, frame)
            ElseIf req.Stock IsNot Nothing Then
                stockMap = StockMap.FromTriangles(StockTriangles(req.Stock, meshProvider, tp), frame)
            End If
            ct.ThrowIfCancellationRequested()
            tp.StockBefore = stockMap

            ' ---- quota di sicurezza (sopra tutti gli ostacoli e il grezzo dell'area)
            Dim safeW = Math.Max(op.SafeHeight, 1)
            If dc.TriangleCount > 0 AndAlso dc.MaxW + stock + 2 > safeW Then
                safeW = dc.MaxW + stock + Math.Max(2, op.SafeHeight)
                tp.Warnings.Add($"Quota di sicurezza alzata a {safeW:0.###} mm sopra il piano per superare gli ostacoli.")
            End If
            If stockMap IsNot Nothing Then
                Dim stockTop = stockMap.MaxTop(winMinU, winMinV, winMaxU, winMaxV)
                If stockTop + 2 > safeW Then
                    safeW = stockTop + Math.Max(2, op.SafeHeight)
                    tp.Warnings.Add($"Quota di sicurezza alzata a {safeW:0.###} mm sopra il piano per superare il grezzo.")
                End If
            End If
            tp.SafeW = safeW
            tp.Stats.SafeW = safeW

            If isPocket Then
                ' sopra il piano della griglia: l'ultima terrazza si ferma dove la fresa lo tocca
                Dim wGrid = Double.NegativeInfinity
                If floorZ.HasValue Then
                    Dim low = op.Tool.LowestOffset(frame.N.Z)
                    wGrid = Double.PositiveInfinity
                    For Each c In {(bb.MinX, bb.MinY), (bb.MaxX, bb.MinY), (bb.MaxX, bb.MaxY), (bb.MinX, bb.MaxY)}
                        wGrid = Math.Min(wGrid, (floorZ.Value - low - frame.Origin.Z - c.Item1 * frame.U.Z - c.Item2 * frame.V.Z) / frame.N.Z)
                    Next
                End If
                ComputePocket(tp, op, dc, region0, bb, stepover, safeW, stockMap, wGrid, ct)
            Else
                ComputeFinish(tp, op, dc, region0, stepover, safeW, stockMap, ct)
            End If

            ' grezzo residuo per la lavorazione successiva
            If stockMap IsNot Nothing Then
                Dim after = stockMap.Clone()
                after.Cut(tp.Points, op.Tool)
                tp.StockAfter = after
            End If

            If tp.Points.Count = 0 Then tp.Warnings.Add("Nessun percorso generato: area non lavorabile con i parametri indicati.")
            tp.ComputeStats()
            ' punto più basso raggiunto dal tagliente (per il controllo del piano della griglia)
            If tp.Points.Count > 0 Then
                Dim minW = Double.PositiveInfinity
                For Each p In tp.Points
                    minW = Math.Min(minW, frame.ToWorld(p.U, p.V, p.W).Z)
                Next
                tp.Stats.MinZ = minW + op.Tool.LowestOffset(frame.N.Z)
                If floorZ.HasValue AndAlso tp.Stats.MinZ < floorZ.Value + 0.002 Then
                    tp.Warnings.Add($"Percorso limitato al piano della griglia (Z {floorZ.Value:0.###}): la fresa non scende sotto.")
                End If
            End If
            ' verifica con utensile ridotto della tolleranza (in tutte le direzioni)
            Dim delta = Math.Max(0.005, op.Tolerance)
            Dim dcCheck = If(dc.TriangleCount = 0, dc, DropCutter.ForTool(tris, op.Tool, stock, delta))
            Verify(tp, dcCheck, delta, ct)
            tp.Stats.ComputeMs = sw.ElapsedMilliseconds
            Return tp
        End Function

        ''' <summary>Triangoli (coordinate mondo) dei solidi del grezzo.</summary>
        Private Function StockTriangles(st As StockDef, meshProvider As Func(Of String, Single()), tp As Toolpath) As Single()
            Dim all As New List(Of Single)()
            If st.Objects IsNot Nothing Then
                For Each o In st.Objects
                    If String.IsNullOrEmpty(o.MeshId) Then Continue For
                    Dim pos = meshProvider(o.MeshId)
                    If pos Is Nothing Then
                        tp.Warnings.Add($"Mesh del grezzo '{o.Name}' non disponibile sul server: ignorata.")
                        Continue For
                    End If
                    Dim m = Mat4.FromTRS(o.Position, o.Rotation, o.Scale)
                    For t = 0 To pos.Length - 3 Step 3
                        Dim p = Tp3(m, pos, t)
                        all.Add(CSng(p.X)) : all.Add(CSng(p.Y)) : all.Add(CSng(p.Z))
                    Next
                Next
            End If
            If st.Artifacts IsNot Nothing Then
                For Each a In st.Artifacts
                    all.AddRange(Primitives.Build(a))
                Next
            End If
            Return all.ToArray()
        End Function

        Private Function Tp3(m As Mat4, pos As Single(), i As Integer) As Vec3
            Dim p As New Vec3(pos(i), pos(i + 1), pos(i + 2))
            Return If(m Is Nothing, p, m.TransformPoint(p))
        End Function

        ' ================================================================ SVUOTATURA
        Private Sub ComputePocket(tp As Toolpath, op As OperationDef, dc As DropCutter, region0 As Paths64,
                                  bb As (MinX As Double, MinY As Double, MaxX As Double, MaxY As Double),
                                  stepover As Double, safeW As Double, stockMap As StockMap, wGrid As Double, ct As CancellationToken)
            Dim R = op.Tool.WorkRadius(op.MaxDepth)
            ' raggio di curvatura minimo dei contorni delle zone bloccate: per la fresa conica è quello della punta
            ' (attorno agli spigoli degli ostacoli appena sopra la terrazza tocca solo la punta)
            Dim rCurv = If(op.Tool.IsTaper, Math.Max(op.Tool.Radius, 0.05), R)
            Dim res = If(op.Resolution > 0, op.Resolution,
                         If(op.Tool.IsTaper, Math.Max(0.05, Math.Min(1.0, Math.Max(op.Tool.Radius, R / 8) / 3)), Math.Max(0.05, Math.Min(1.0, R / 4))))
            Dim w = bb.MaxX - bb.MinX + 4 * res, h = bb.MaxY - bb.MinY + 4 * res
            If w * h / (res * res) > 6000000.0 Then
                res = Math.Sqrt(w * h / 6000000.0)
                tp.Warnings.Add($"Risoluzione di calcolo portata a {res:0.###} mm per limitare la memoria.")
            End If
            tp.Stats.Resolution = res
            Dim floor = -op.MaxDepth
            Dim hf As HeightField = Nothing
            If dc.TriangleCount > 0 Then hf = New HeightField(dc, bb.MinX, bb.MinY, bb.MaxX, bb.MaxY, res, floor - 1, ct)
            ' limite al piano della griglia (wGrid: quota della punta che lo tocca, la più bassa nell'area)
            If wGrid > floor Then floor = wGrid

            ' con il grezzo le terrazze partono dalla sua sommità (anche sopra il piano, per non urtarlo) e
            ' coprono solo dove c'è materiale; il limite di profondità resta quello misurato dal piano
            Dim wStart = 0.0
            Dim material As HeightField = Nothing
            If stockMap IsNot Nothing Then
                Dim wTop = stockMap.MaxTop(bb.MinX - R, bb.MinY - R, bb.MaxX + R, bb.MaxY + R)
                If wTop <= floor + 0.0001 Then
                    tp.Warnings.Add("Il grezzo non ha materiale da togliere nella zona e nella profondità della lavorazione.")
                    Return
                End If
                wStart = Math.Max(0, wTop)
                material = stockMap.MaterialField()
            End If
            If floor >= wStart - 0.001 Then
                tp.Warnings.Add("Nessuna terrazza sopra il piano della griglia: la lavorazione resta vuota.")
                Return
            End If
            Dim levels As New List(Of Double)()
            Dim d = op.Stepdown
            While wStart - d > floor + 0.0001
                levels.Add(wStart - d)
                d += op.Stepdown
            End While
            levels.Add(floor)

            Dim safety = res * res / (4 * Math.Max(rCurv, res / 2)) + 0.003
            Dim pb As New PathBuilder(tp)
            Dim prevL = wStart
            Dim done = 0
            For Each L In levels
                ct.ThrowIfCancellationRequested()
                Dim free = region0
                If hf IsNot Nothing Then
                    Dim blocked = Poly.Union(Poly.ToPaths(hf.BlockedLoops(L, ct)), FillRule.NonZero)
                    If blocked.Count > 0 Then
                        blocked = Poly.Offset(blocked, safety)
                        free = Poly.Difference(region0, blocked)
                        free = Poly.RemoveSmall(Poly.Opening(free, 0.005), 0.0005)
                    End If
                End If
                If free.Count = 0 Then
                    If done = 0 Then tp.Warnings.Add("Gli ostacoli occupano tutta l'area già dalla prima terrazza.")
                    Exit For
                End If
                ' zona da lavorare: posizioni della fresa che toccano materiale a questa quota (materiale allargato
                ' del raggio meno una cella della mappa: i residui fuori portata, es. negli angoli, non si
                ' ripassano; le zone più piccole di una cella sono imprecisioni della mappa); niente passate in aria
                Dim region = free
                If material IsNot Nothing Then
                    Dim mat = Poly.Union(Poly.ToPaths(material.BlockedLoops(L, ct)), FillRule.NonZero)
                    If mat.Count = 0 Then Continue For
                    region = Poly.Intersect(free, Poly.Offset(mat, Math.Max(0.01, R - stockMap.Res)))
                    region = Poly.RemoveSmall(Poly.Opening(region, 0.005), stockMap.Res * stockMap.Res)
                    If region.Count = 0 Then Continue For
                End If

                Dim segs As List(Of PathSeg2D)
                Dim startFrom As Vec2? = Nothing
                If pb.HasCurrent Then startFrom = New Vec2(pb.Current.U, pb.Current.V)
                If String.Equals(op.Strategy, "zigzag", StringComparison.OrdinalIgnoreCase) Then
                    segs = PathPlanner.ZigZag(region, stepover, op.Angle, coverEdges:=Not op.ContourPass)
                    If op.ContourPass Then
                        Dim hasPos = segs.Count > 0
                        Dim pos = If(hasPos, segs(segs.Count - 1).Points.Last(), New Vec2(0, 0))
                        segs.AddRange(PathPlanner.Contours(region, op.Tool.ClimbM3, pos, hasPos, stepover))
                    End If
                Else
                    segs = PathPlanner.Concentric(region, stepover, op.Tool.ClimbM3, startFrom)
                End If

                For s = 0 To segs.Count - 1
                    Dim seg = segs(s)
                    If seg.Points.Count < 2 Then Continue For
                    Dim st = seg.Points(0)
                    If s = 0 OrElse seg.Link = LinkKind.Retract Then
                        Dim w0 = prevL + Math.Max(0.1, op.Clearance)
                        pb.RetractTo(st.X, st.Y, safeW, w0)
                        ' elica e rampa possono passare anche dove non c'è materiale: basta che la zona sia libera
                        EmitEntry(pb, op, tp, free, seg.Points, w0, L)
                    Else
                        pb.Feed(st.X, st.Y, L)
                    End If
                    For i = 1 To seg.Points.Count - 1
                        pb.Feed(seg.Points(i).X, seg.Points(i).Y, L)
                    Next
                Next
                prevL = L
                done += 1
            Next
            If pb.HasCurrent Then pb.Rapid(pb.Current.U, pb.Current.V, safeW)
            tp.Stats.Levels = done
            Dim wanted = If(op.Entry, "plunge").ToLowerInvariant()
            If wanted <> "plunge" AndAlso tp.Stats.PlungeEntries > 0 Then
                tp.Warnings.Add($"{tp.Stats.PlungeEntries} ingressi eseguiti con affondo verticale: spazio insufficiente per {If(wanted = "helix", "elica/rampa", "la rampa")}.")
            End If
        End Sub

        ' ================================================================ INGRESSI NEL MATERIALE
        ''' <summary>
        ''' Scende da w0 alla quota L terminando nel punto iniziale del tratto: elica (se il cerchio sta nella regione),
        ''' rampa lungo il tratto stesso, oppure affondo verticale.
        ''' </summary>
        Private Sub EmitEntry(pb As PathBuilder, op As OperationDef, tp As Toolpath, region As Paths64,
                          path As List(Of Vec2), w0 As Double, L As Double)
            Dim p0 = path(0)
            Select Case If(op.Entry, "plunge").ToLowerInvariant()
                Case "helix"
                    If TryHelix(pb, op, region, p0, w0, L) Then tp.Stats.HelixEntries += 1 : Return
                    If TryRamp(pb, op, path, w0, L) Then tp.Stats.RampEntries += 1 : Return
                Case "ramp"
                    If TryRamp(pb, op, path, w0, L) Then tp.Stats.RampEntries += 1 : Return
            End Select
            pb.Plunge(p0.X, p0.Y, L)
            tp.Stats.PlungeEntries += 1
        End Sub

        Private Function RampTan(op As OperationDef) As Double
            Return Math.Tan(Math.Max(0.5, Math.Min(45, op.RampAngle)) * Math.PI / 180)
        End Function

        ''' <summary>Elica che passa per p0 (inizio e fine), interamente contenuta nella regione lavorabile.</summary>
        Private Function TryHelix(pb As PathBuilder, op As OperationDef, region As Paths64, p0 As Vec2, w0 As Double, L As Double) As Boolean
            Dim rh = If(op.HelixRadius > 0, op.HelixRadius, op.Tool.WorkRadius(op.MaxDepth) * 0.5)
            rh = Math.Max(0.05, rh)
            Dim tanA = RampTan(op)
            Dim n = Math.Max(24, Primitives.SegmentsFor(rh, Math.Max(0.002, op.Tolerance)))
            Dim dirSign = If(op.Tool.ClimbM3, 1.0, -1.0) ' antiorario = concorde con utensile orario (M3)
            For k = 0 To 15
                Dim ang = 2 * Math.PI * k / 16
                Dim c As New Vec2(p0.X + rh * Math.Cos(ang), p0.Y + rh * Math.Sin(ang))
                Dim th0 = ang + Math.PI
                Dim ok = Poly.Contains(region, c)
                Dim prev = p0
                For i = 1 To n
                    If Not ok Then Exit For
                    Dim th = th0 + dirSign * 2 * Math.PI * i / n
                    Dim q As New Vec2(c.X + rh * Math.Cos(th), c.Y + rh * Math.Sin(th))
                    If Not Poly.SegmentInside(region, prev, q) Then ok = False
                    prev = q
                Next
                If Not ok Then Continue For
                Dim depth = w0 - L
                Dim turns = Math.Max(1, CInt(Math.Ceiling(depth / (2 * Math.PI * rh * tanA) - 0.000000001)))
                Dim total = turns * n
                For i = 1 To total
                    Dim th = th0 + dirSign * 2 * Math.PI * i / n
                    pb.Ramp(c.X + rh * Math.Cos(th), c.Y + rh * Math.Sin(th), w0 - depth * i / total)
                Next
                ' giro completo sul fondo, poi il tratto parte da p0
                For i = 1 To n
                    Dim th = th0 + dirSign * 2 * Math.PI * i / n
                    pb.Feed(c.X + rh * Math.Cos(th), c.Y + rh * Math.Sin(th), L)
                Next
                pb.Feed(p0.X, p0.Y, L)
                Return True
            Next
            Return False
        End Function

        ''' <summary>
        ''' Rampa lungo il tratto da lavorare: sui contorni chiusi corti gira attorno al contorno,
        ''' altrimenti va avanti e indietro sulla parte iniziale, terminando in p0 alla quota L.
        ''' </summary>
        Private Function TryRamp(pb As PathBuilder, op As OperationDef, path As List(Of Vec2), w0 As Double, L As Double) As Boolean
            Dim tanA = RampTan(op)
            Dim depth = w0 - L
            Dim maxLen = depth / (2 * tanA)
            Dim fullLen = 0.0
            For i = 1 To path.Count - 1
                fullLen += Vec2.Distance(path(i - 1), path(i))
            Next
            Dim isClosed = path.Count > 3 AndAlso Vec2.Distance(path(0), path(path.Count - 1)) < 0.000001
            ' contorno chiuso più corto della rampa: si gira attorno al contorno fino alla quota
            Dim closedLoop = isClosed AndAlso fullLen <= maxLen
            Dim pre As New List(Of Vec2) From {path(0)}
            Dim acc = 0.0
            For i = 1 To path.Count - 1
                Dim d = Vec2.Distance(path(i - 1), path(i))
                If d < 0.000000001 Then Continue For
                If Not closedLoop AndAlso acc + d >= maxLen Then
                    pre.Add(Vec2.Lerp(path(i - 1), path(i), (maxLen - acc) / d))
                    acc = maxLen
                    Exit For
                End If
                pre.Add(path(i))
                acc += d
            Next
            If acc < Math.Max(0.5 * op.Tool.WorkRadius(op.MaxDepth), 0.2) Then Return False
            Dim m = pre.Count - 1
            Dim passes = Math.Max(1, CInt(Math.Ceiling(depth / (acc * tanA) - 0.000000001)))
            If Not closedLoop Then
                passes = Math.Max(2, passes)
                If passes Mod 2 = 1 Then passes += 1
            End If
            Dim totalLen = passes * acc
            Dim run = 0.0
            Dim last = pre(0)
            For pIdx = 0 To passes - 1
                Dim forward = closedLoop OrElse pIdx Mod 2 = 0
                For j = 1 To m
                    Dim q = If(forward, pre(j), pre(m - j))
                    run += Vec2.Distance(last, q)
                    pb.Ramp(q.X, q.Y, Math.Max(L, w0 - depth * run / totalLen))
                    last = q
                Next
            Next
            pb.Ramp(path(0).X, path(0).Y, L)
            Return True
        End Function

        ' ================================================================ FINITURA
        Private Sub ComputeFinish(tp As Toolpath, op As OperationDef, dc As DropCutter, region0 As Paths64,
                                  stepover As Double, safeW As Double, stockMap As StockMap, ct As CancellationToken)
            Dim R = op.Tool.WorkRadius(op.MaxDepth)
            Dim floor = -op.MaxDepth
            ' fresa conica: campionamento sulla scala della punta (i dettagli che tocca sono piccoli come la punta)
            Dim rs = If(op.Tool.IsTaper, Math.Max(op.Tool.Radius, R / 8), R)
            Dim stepLen = If(op.Resolution > 0, op.Resolution, Math.Max(0.02, Math.Min(0.5, rs / 6)))
            Dim tol = Math.Max(0.001, op.Tolerance)
            tp.Stats.Resolution = stepLen

            Dim segs As List(Of PathSeg2D)
            If String.Equals(op.Strategy, "zigzag", StringComparison.OrdinalIgnoreCase) Then
                segs = PathPlanner.ZigZag(region0, stepover, op.Angle, coverEdges:=True)
            Else
                segs = PathPlanner.Concentric(region0, stepover, op.Tool.ClimbM3)
            End If

            ' proiezione lungo la normale (parallela per tratto)
            Dim proj(segs.Count - 1) As List(Of Vec3)
            Parallel.For(0, segs.Count, New ParallelOptions With {.CancellationToken = ct},
                Sub(s)
                    Dim poly2 As New List(Of Vec2)()
                    If s > 0 AndAlso segs(s).Link = LinkKind.Direct Then poly2.Add(segs(s - 1).Points.Last())
                    poly2.AddRange(segs(s).Points)
                    Dim p3 = ProjectPolyline(dc, poly2, stepLen, tol, floor)
                    proj(s) = SimplifyRdp(p3, tol * 0.5)
                End Sub)

            ' con il grezzo: i tratti dove la fresa non tocca materiale (già tolto o mai presente) si saltano
            Dim lift = If(stockMap IsNot Nothing, StockMap.LiftTable(op.Tool), Nothing)
            Dim minAir = Math.Max(5.0, 4 * R)
            Dim pb As New PathBuilder(tp)
            For s = 0 To segs.Count - 1
                Dim pts = proj(s)
                If pts Is Nothing OrElse pts.Count < 2 Then Continue For
                Dim pieces = If(stockMap IsNot Nothing, SplitAir(pts, stockMap, lift, minAir), New List(Of List(Of Vec3)) From {pts})
                For pi = 0 To pieces.Count - 1
                    Dim piece = pieces(pi)
                    Dim first = 0
                    Dim cur = pb.Current
                    ' prosegue dal tratto precedente se ne è la continuazione, altrimenti disimpegno e affondo
                    If pb.HasCurrent AndAlso Math.Abs(cur.U - piece(0).X) < 0.000001 AndAlso Math.Abs(cur.V - piece(0).Y) < 0.000001 AndAlso
                       Math.Abs(cur.W - piece(0).Z) < 0.000001 AndAlso Not (s = 0 OrElse segs(s).Link = LinkKind.Retract) Then
                        first = 1
                    ElseIf pi > 0 AndAlso pb.HasCurrent Then
                        ' salto di un tratto in aria nella stessa passata: appena sopra pezzo e grezzo, non alla quota di sicurezza
                        Dim p0 = piece(0)
                        Dim hTr = Math.Min(safeW, TransferHeight(dc, stockMap, New Vec2(cur.U, cur.V), New Vec2(p0.X, p0.Y), R, floor) + Math.Max(0.5, op.Clearance))
                        pb.Rapid(cur.U, cur.V, Math.Max(cur.W, hTr))
                        pb.Rapid(p0.X, p0.Y, Math.Max(hTr, p0.Z))
                        pb.Plunge(p0.X, p0.Y, p0.Z)
                    Else
                        Dim p0 = piece(0)
                        pb.RetractTo(p0.X, p0.Y, safeW, Math.Min(safeW, p0.Z + Math.Max(0.1, op.Clearance)))
                        pb.Plunge(p0.X, p0.Y, p0.Z)
                    End If
                    For i = first To piece.Count - 1
                        pb.Feed(piece(i).X, piece(i).Y, piece(i).Z)
                    Next
                Next
            Next
            If pb.HasCurrent Then pb.Rapid(pb.Current.U, pb.Current.V, safeW)
            tp.Stats.Levels = 1
        End Sub

        ''' <summary>Quota a cui la fresa passa da a a b senza toccare pezzo (con sovrametallo) né grezzo.</summary>
        Private Function TransferHeight(dc As DropCutter, stockMap As StockMap, a As Vec2, b As Vec2, r As Double, floor As Double) As Double
            Dim len = Vec2.Distance(a, b)
            Dim n = Math.Max(1, CInt(Math.Ceiling(len / Math.Max(0.2, r / 2))))
            Dim best = floor
            For k = 0 To n
                Dim q = Vec2.Lerp(a, b, k / n)
                best = Math.Max(best, dc.Contact(q.X, q.Y, floor))
                best = Math.Max(best, stockMap.MaxTop(q.X - r, q.Y - r, q.X + r, q.Y + r))
            Next
            Return best
        End Function

        ''' <summary>
        ''' Divide un tratto di finitura togliendo le parti in aria (la fresa non tocca il grezzo) più lunghe di minAir;
        ''' le parti in aria più corte restano, per non moltiplicare i disimpegni.
        ''' </summary>
        Private Function SplitAir(pts As List(Of Vec3), stockMap As StockMap, lift As (RMax As Double, Lift As Double()), minAir As Double) As List(Of List(Of Vec3))
            Dim n = pts.Count
            Dim cuts(n - 2) As Boolean
            Dim stepLen = Math.Max(0.3, lift.RMax / 2)
            For i = 0 To n - 2
                Dim a = pts(i), b = pts(i + 1)
                Dim len = Math.Sqrt((b.X - a.X) ^ 2 + (b.Y - a.Y) ^ 2)
                Dim m = Math.Max(1, CInt(Math.Ceiling(len / stepLen)))
                For k = 0 To m
                    Dim t = k / m
                    If stockMap.Engages(a.X + (b.X - a.X) * t, a.Y + (b.Y - a.Y) * t, a.Z + (b.Z - a.Z) * t, lift) Then cuts(i) = True : Exit For
                Next
            Next
            Dim res As New List(Of List(Of Vec3))()
            Dim cur As List(Of Vec3) = Nothing
            Dim i0 = 0
            While i0 <= n - 2
                If cuts(i0) Then
                    If cur Is Nothing Then cur = New List(Of Vec3) From {pts(i0)}
                    cur.Add(pts(i0 + 1))
                    i0 += 1
                    Continue While
                End If
                ' tratto in aria: da i0 a i1 (escluso)
                Dim i1 = i0, airLen = 0.0
                While i1 <= n - 2 AndAlso Not cuts(i1)
                    airLen += Math.Sqrt((pts(i1 + 1).X - pts(i1).X) ^ 2 + (pts(i1 + 1).Y - pts(i1).Y) ^ 2)
                    i1 += 1
                End While
                Dim lead = cur IsNot Nothing, tail = i1 <= n - 2
                If airLen < minAir AndAlso lead AndAlso tail Then
                    For k = i0 To i1 - 1
                        cur.Add(pts(k + 1))
                    Next
                ElseIf cur IsNot Nothing Then
                    res.Add(cur)
                    cur = Nothing
                End If
                i0 = i1
            End While
            If cur IsNot Nothing AndAlso cur.Count >= 2 Then res.Add(cur)
            Return res
        End Function

        ''' <summary>Campiona la polilinea 2D, calcola la quota con il drop-cutter e raffina dove la superficie varia.</summary>
        Public Function ProjectPolyline(dc As DropCutter, pts As List(Of Vec2), stepLen As Double, tol As Double, floor As Double) As List(Of Vec3)
            Dim res As New List(Of Vec3)()
            If pts.Count = 0 Then Return res
            Dim prev As New Vec3(pts(0).X, pts(0).Y, dc.Contact(pts(0).X, pts(0).Y, floor))
            res.Add(prev)
            For i = 1 To pts.Count - 1
                Dim a = pts(i - 1), b = pts(i)
                Dim len = Vec2.Distance(a, b)
                Dim n = Math.Max(1, CInt(Math.Ceiling(len / stepLen)))
                For k = 1 To n
                    Dim q = Vec2.Lerp(a, b, k / n)
                    Dim cur As New Vec3(q.X, q.Y, dc.Contact(q.X, q.Y, floor))
                    Refine(dc, prev, cur, tol, floor, stepLen / 64, 0, res)
                    res.Add(cur)
                    prev = cur
                Next
            Next
            Return res
        End Function

        Private Sub Refine(dc As DropCutter, p0 As Vec3, p1 As Vec3, tol As Double, floor As Double, minLen As Double,
                           depth As Integer, res As List(Of Vec3))
            If depth >= 10 Then Return
            Dim dx = p1.X - p0.X, dy = p1.Y - p0.Y
            If dx * dx + dy * dy < minLen * minLen Then Return
            Dim mu = (p0.X + p1.X) / 2, mv = (p0.Y + p1.Y) / 2
            Dim wm = dc.Contact(mu, mv, floor)
            If Math.Abs(wm - (p0.Z + p1.Z) / 2) <= tol Then Return
            Dim m As New Vec3(mu, mv, wm)
            Refine(dc, p0, m, tol, floor, minLen, depth + 1, res)
            res.Add(m)
            Refine(dc, m, p1, tol, floor, minLen, depth + 1, res)
        End Sub

        ''' <summary>Semplificazione Ramer-Douglas-Peucker 3D (iterativa).</summary>
        Public Function SimplifyRdp(pts As List(Of Vec3), eps As Double) As List(Of Vec3)
            If pts.Count < 3 Then Return pts
            Dim keep(pts.Count - 1) As Boolean
            keep(0) = True : keep(pts.Count - 1) = True
            Dim stack As New Stack(Of (A As Integer, B As Integer))()
            stack.Push((0, pts.Count - 1))
            While stack.Count > 0
                Dim seg = stack.Pop()
                If seg.B - seg.A < 2 Then Continue While
                Dim a = pts(seg.A), b = pts(seg.B)
                Dim ab = b - a
                Dim l2 = ab.Dot(ab)
                Dim lxy2 = ab.X * ab.X + ab.Y * ab.Y
                Dim bi = -1, bd = eps
                For i = seg.A + 1 To seg.B - 1
                    Dim ap = pts(i) - a
                    Dim d As Double
                    If l2 < 1.0E-18 Then
                        d = ap.Length
                    ElseIf lxy2 > 1.0E-18 Then
                        ' scarto in pianta dalla corda e scarto di quota alla stessa posizione: sui fianchi ripidi
                        ' un piccolo scarto in pianta corrisponde a un grande errore di quota (interferenza)
                        Dim t = Math.Max(0, Math.Min(1, (ap.X * ab.X + ap.Y * ab.Y) / lxy2))
                        Dim ex = ap.X - ab.X * t, ey = ap.Y - ab.Y * t, ez = ap.Z - ab.Z * t
                        d = Math.Max(Math.Sqrt(ex * ex + ey * ey), Math.Abs(ez))
                    Else
                        Dim t = Math.Max(0, Math.Min(1, ap.Dot(ab) / l2))
                        d = (ap - ab * t).Length
                    End If
                    If d > bd Then bd = d : bi = i
                Next
                If bi >= 0 Then
                    keep(bi) = True
                    stack.Push((seg.A, bi)) : stack.Push((bi, seg.B))
                End If
            End While
            Dim res As New List(Of Vec3)()
            For i = 0 To pts.Count - 1
                If keep(i) Then res.Add(pts(i))
            Next
            Return res
        End Function

        ' ================================================================ VERIFICA
        ''' <summary>
        ''' Verifica anticollisione: campiona tutti i movimenti e misura la massima penetrazione dell'utensile
        ''' rispetto alla superficie (oggetti + sovrametallo). <paramref name="dc"/> è l'utensile ridotto di
        ''' <paramref name="delta"/>: le interferenze entro la tolleranza non vengono segnalate.
        ''' </summary>
        Public Sub Verify(tp As Toolpath, dc As DropCutter, delta As Double, ct As CancellationToken)
            If dc.TriangleCount = 0 OrElse tp.Points.Count < 2 Then Return
            Dim stepLen = Math.Max(0.05, dc.DetailRadius / 4)
            Dim total = 0L
            For i = 1 To tp.Points.Count - 1
                Dim a = tp.Points(i - 1), b = tp.Points(i)
                total += CLng(Math.Ceiling(Math.Sqrt((b.U - a.U) ^ 2 + (b.V - a.V) ^ 2) / stepLen)) + 1
            Next
            If total > 4000000 Then stepLen *= Math.Sqrt(total / 4000000.0)
            Dim maxG = 0.0, samples = 0
            Dim lk As New Object()
            Parallel.For(1, tp.Points.Count, New ParallelOptions With {.CancellationToken = ct},
                Function() (0.0, 0),
                Function(i, state, loc)
                    Dim a = tp.Points(i - 1), b = tp.Points(i)
                    Dim len = Math.Sqrt((b.U - a.U) ^ 2 + (b.V - a.V) ^ 2)
                    Dim n = Math.Max(1, CInt(Math.Ceiling(len / stepLen)))
                    Dim g = loc.Item1, c = loc.Item2
                    For k = 0 To n
                        Dim t = k / n
                        Dim u = a.U + (b.U - a.U) * t, v = a.V + (b.V - a.V) * t, w = a.W + (b.W - a.W) * t
                        Dim cw = dc.Contact(u, v, Double.NegativeInfinity) - delta
                        If cw - w > g Then g = cw - w
                        c += 1
                    Next
                    Return (g, c)
                End Function,
                Sub(loc)
                    SyncLock lk
                        If loc.Item1 > maxG Then maxG = loc.Item1
                        samples += loc.Item2
                    End SyncLock
                End Sub)
            tp.Stats.MaxGouge = maxG
            tp.Stats.GougeSamples = samples
            If maxG > 0.001 Then
                tp.Warnings.Add($"Verifica: rilevata interferenza massima di {maxG:0.###} mm. Ridurre risoluzione/tolleranza.")
            End If
        End Sub

    End Module

End Namespace
