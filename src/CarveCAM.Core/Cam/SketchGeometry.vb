Imports Clipper2Lib
Imports CarveCAM.Core.Geometry
Imports CarveCAM.Core.Model

Namespace Cam

    ''' <summary>Conversione delle entità di sketch in contorni chiusi (coordinate piano u,v).</summary>
    Public Module SketchGeometry

        Public Function EntityToLoop(e As SketchEntityDef, Optional tolerance As Double = 0.002) As List(Of Vec2)
            Dim pts As New List(Of Vec2)()
            Select Case If(e.Kind, "").ToLowerInvariant()
                Case "rect"
                    pts.Add(New Vec2(e.X1, e.Y1)) : pts.Add(New Vec2(e.X2, e.Y1))
                    pts.Add(New Vec2(e.X2, e.Y2)) : pts.Add(New Vec2(e.X1, e.Y2))
                Case "circle"
                    If e.R <= 0 Then Return pts
                    Dim n = Meshes.Primitives.SegmentsFor(e.R, tolerance)
                    For i = 0 To n - 1
                        Dim a = 2 * Math.PI * i / n
                        pts.Add(New Vec2(e.Cx + e.R * Math.Cos(a), e.Cy + e.R * Math.Sin(a)))
                    Next
                Case "polygon"
                    If e.R <= 0 Then Return pts
                    Dim n = Math.Max(3, e.Sides)
                    Dim r0 = e.Rot * Math.PI / 180
                    For i = 0 To n - 1
                        Dim a = r0 + 2 * Math.PI * i / n
                        pts.Add(New Vec2(e.Cx + e.R * Math.Cos(a), e.Cy + e.R * Math.Sin(a)))
                    Next
                Case "polyline"
                    If e.Pts IsNot Nothing Then
                        For Each p In e.Pts
                            If p IsNot Nothing AndAlso p.Length >= 2 Then pts.Add(New Vec2(p(0), p(1)))
                        Next
                    End If
                    If pts.Count >= 2 AndAlso Vec2.Distance(pts(0), pts(pts.Count - 1)) < 0.000001 Then pts.RemoveAt(pts.Count - 1)
            End Select
            Return pts
        End Function

        ''' <summary>
        ''' Regione di contenimento: unione even-odd di tutte le entità chiuse
        ''' (un contorno interno ad un altro diventa un'isola esclusa).
        ''' </summary>
        Public Function BoundaryRegion(entities As IEnumerable(Of SketchEntityDef)) As Paths64
            Dim raw As New Paths64()
            If entities IsNot Nothing Then
                For Each e In entities
                    Dim l = EntityToLoop(e)
                    If l.Count >= 3 Then raw.Add(Poly.ToPath(l))
                Next
            End If
            Return Clipper.Union(raw, FillRule.EvenOdd)
        End Function

    End Module

End Namespace
