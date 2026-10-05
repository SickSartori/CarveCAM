Imports CarveCAM.Core.Cam
Imports CarveCAM.Core.Geometry
Imports CarveCAM.Core.Model

Namespace Post

    ''' <summary>
    ''' Percorsi di prova per l'anteprima del G-code nel magazzino macchine: una svuotatura (ingresso a elica, cerchio,
    ''' rettangolo raccordato) e una finitura su una superficie curva in XZ, con due utensili.
    ''' </summary>
    Public Module SamplePaths

        Public Function Build() As List(Of Toolpath)
            Dim top = PlaneFrame.FromNormalAngle(New Vec3(0, 0, 0), New Vec3(0, 0, 1), 0)
            Dim pocket As New Toolpath With {
                .Id = "anteprima-1", .Name = "Svuotatura di prova", .Kind = "pocket", .Strategy = "concentric",
                .Tool = New ToolDef With {.Number = 1, .Type = "flat", .Diameter = 6}, .Feed = 1200, .Plunge = 300, .RampFeed = 600,
                .Spindle = 18000, .SafeW = 5, .Frame = top}
            Dim pt = pocket.Points
            pt.Add(New CLPoint(2, 0, 5, MoveType.Rapid))
            pt.Add(New CLPoint(2, 0, 1, MoveType.Rapid))
            ' elica di ingresso: due giri di raggio 2 fino a -2
            Dim n = 32
            For i = 1 To 2 * n
                Dim a = 2 * Math.PI * i / n
                pt.Add(New CLPoint(2 * Math.Cos(a), 2 * Math.Sin(a), 1 - 3.0 * i / (2 * n), MoveType.Ramp))
            Next
            ' cerchio di raggio 8
            pt.Add(New CLPoint(8, 0, -2, MoveType.Feed))
            For i = 1 To 180
                Dim a = 2 * Math.PI * i / 180
                pt.Add(New CLPoint(8 * Math.Cos(a), 8 * Math.Sin(a), -2, MoveType.Feed))
            Next
            ' rettangolo 30 x 20 con gli spigoli raccordati di raggio 3
            Dim corners = {(12.0, 7.0, 0.0), (-12.0, 7.0, 90.0), (-12.0, -7.0, 180.0), (12.0, -7.0, 270.0)}
            pt.Add(New CLPoint(15, -7, -2, MoveType.Feed))
            For Each c In corners
                For i = 0 To 24
                    Dim a = (c.Item3 + 90.0 * i / 24) * Math.PI / 180
                    pt.Add(New CLPoint(c.Item1 + 3 * Math.Cos(a), c.Item2 + 3 * Math.Sin(a), -2, MoveType.Feed))
                Next
            Next
            pt.Add(New CLPoint(15, -7, -2, MoveType.Feed))
            pt.Add(New CLPoint(15, -7, 5, MoveType.Rapid))

            Dim finish As New Toolpath With {
                .Id = "anteprima-2", .Name = "Finitura di prova", .Kind = "finish", .Strategy = "zigzag",
                .Tool = New ToolDef With {.Number = 2, .Type = "ball", .Diameter = 3, .CornerRadius = 1.5}, .Feed = 1500, .Plunge = 400,
                .Spindle = 20000, .SafeW = 5, .Frame = top}
            Dim pf = finish.Points
            pf.Add(New CLPoint(-10, -4, 5, MoveType.Rapid))
            ' passate lungo X su una superficie cilindrica (arco in XZ di raggio 20)
            Dim row = 0
            For y = -4.0 To 4.0 Step 2.0
                Dim fwd = row Mod 2 = 0
                For k = 0 To 40
                    Dim x = If(fwd, -10 + 0.5 * k, 10 - 0.5 * k)
                    Dim z = -21 + Math.Sqrt(400 - x * x)
                    pf.Add(New CLPoint(x, y, z, If(k = 0 AndAlso row = 0, MoveType.Plunge, MoveType.Feed)))
                Next
                row += 1
            Next
            pf.Add(New CLPoint(pf(pf.Count - 1).U, pf(pf.Count - 1).V, 5, MoveType.Rapid))
            Return New List(Of Toolpath) From {pocket, finish}
        End Function

    End Module

End Namespace
