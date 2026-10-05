Imports CarveCAM.Core.Geometry
Imports CarveCAM.Core.Model

Namespace Meshes

    ''' <summary>
    ''' Tassellazione degli artefatti primitivi. Convenzioni (identiche al client):
    ''' tutti centrati nell'origine locale, asse di cilindro/cono lungo Z locale,
    ''' raggio inferiore (Radius) a z=-h/2, superiore (Radius2) a z=+h/2.
    ''' </summary>
    Public Module Primitives

        Public Function SegmentsFor(radius As Double, tolerance As Double) As Integer
            If radius <= tolerance Then Return 24
            Dim a = Math.Acos(1 - tolerance / radius)
            Return Math.Max(24, Math.Min(720, CInt(Math.Ceiling(Math.PI / a))))
        End Function

        ''' <summary>Genera i triangoli (coordinate mondo) di un artefatto.</summary>
        Public Function Build(def As ArtifactDef, Optional tolerance As Double = 0.005) As Single()
            Dim tris As New List(Of Vec3)()
            Select Case If(def.Kind, "").ToLowerInvariant()
                Case "box"
                    Dim s = If(def.Size IsNot Nothing AndAlso def.Size.Length >= 3, def.Size, {20.0, 20.0, 20.0})
                    AddBox(tris, s(0), s(1), s(2))
                Case "cylinder"
                    AddFrustum(tris, def.Radius, def.Radius, def.Height, SegmentsFor(def.Radius, tolerance))
                Case "cone"
                    AddFrustum(tris, def.Radius, def.Radius2, def.Height, SegmentsFor(Math.Max(def.Radius, def.Radius2), tolerance))
                Case "sphere"
                    AddSphere(tris, def.Radius, SegmentsFor(def.Radius, tolerance))
                Case "extrude"
                    If def.Mesh Is Nothing OrElse def.Mesh.Length < 9 Then Throw New ArgumentException("Profilo estruso senza geometria: " & def.Name)
                    For k = 0 To def.Mesh.Length - 3 Step 3
                        tris.Add(New Vec3(def.Mesh(k), def.Mesh(k + 1), def.Mesh(k + 2)))
                    Next
                Case Else
                    Throw New ArgumentException("Tipo di artefatto sconosciuto: " & def.Kind)
            End Select
            Dim m = Mat4.FromTRS(def.Position, def.Rotation, Nothing)
            Dim res(tris.Count * 3 - 1) As Single
            For i = 0 To tris.Count - 1
                Dim p = m.TransformPoint(tris(i))
                res(i * 3) = CSng(p.X) : res(i * 3 + 1) = CSng(p.Y) : res(i * 3 + 2) = CSng(p.Z)
            Next
            Return res
        End Function

        Private Sub Tri(l As List(Of Vec3), a As Vec3, b As Vec3, c As Vec3)
            l.Add(a) : l.Add(b) : l.Add(c)
        End Sub

        Private Sub Quad(l As List(Of Vec3), a As Vec3, b As Vec3, c As Vec3, d As Vec3)
            Tri(l, a, b, c) : Tri(l, a, c, d)
        End Sub

        Public Sub AddBox(l As List(Of Vec3), sx As Double, sy As Double, sz As Double)
            Dim x = sx / 2, y = sy / 2, z = sz / 2
            Dim p000 As New Vec3(-x, -y, -z), p100 As New Vec3(x, -y, -z), p110 As New Vec3(x, y, -z), p010 As New Vec3(-x, y, -z)
            Dim p001 As New Vec3(-x, -y, z), p101 As New Vec3(x, -y, z), p111 As New Vec3(x, y, z), p011 As New Vec3(-x, y, z)
            Quad(l, p000, p010, p110, p100) ' -Z
            Quad(l, p001, p101, p111, p011) ' +Z
            Quad(l, p000, p100, p101, p001) ' -Y
            Quad(l, p010, p011, p111, p110) ' +Y
            Quad(l, p000, p001, p011, p010) ' -X
            Quad(l, p100, p110, p111, p101) ' +X
        End Sub

        Public Sub AddFrustum(l As List(Of Vec3), rBottom As Double, rTop As Double, h As Double, n As Integer)
            Dim zb = -h / 2, zt = h / 2
            Dim cb As New Vec3(0, 0, zb), ct As New Vec3(0, 0, zt)
            For i = 0 To n - 1
                Dim a0 = 2 * Math.PI * i / n, a1 = 2 * Math.PI * (i + 1) / n
                Dim c0 = Math.Cos(a0), s0 = Math.Sin(a0), c1 = Math.Cos(a1), s1 = Math.Sin(a1)
                Dim b0 As New Vec3(rBottom * c0, rBottom * s0, zb), b1 As New Vec3(rBottom * c1, rBottom * s1, zb)
                Dim t0 As New Vec3(rTop * c0, rTop * s0, zt), t1 As New Vec3(rTop * c1, rTop * s1, zt)
                If rBottom > 0 AndAlso rTop > 0 Then
                    Quad(l, b0, b1, t1, t0)
                ElseIf rBottom > 0 Then
                    Tri(l, b0, b1, ct)
                ElseIf rTop > 0 Then
                    Tri(l, cb, t1, t0)
                End If
                If rBottom > 0 Then Tri(l, cb, b1, b0)
                If rTop > 0 Then Tri(l, ct, t0, t1)
            Next
        End Sub

        Public Sub AddSphere(l As List(Of Vec3), r As Double, n As Integer)
            Dim rings = Math.Max(12, n \ 2)
            For j = 0 To rings - 1
                Dim th0 = Math.PI * j / rings, th1 = Math.PI * (j + 1) / rings
                For i = 0 To n - 1
                    Dim ph0 = 2 * Math.PI * i / n, ph1 = 2 * Math.PI * (i + 1) / n
                    Dim p00 = SpherePt(r, th0, ph0), p01 = SpherePt(r, th0, ph1)
                    Dim p10 = SpherePt(r, th1, ph0), p11 = SpherePt(r, th1, ph1)
                    If j = 0 Then
                        Tri(l, p00, p10, p11)
                    ElseIf j = rings - 1 Then
                        Tri(l, p00, p10, p01)
                    Else
                        Quad(l, p00, p10, p11, p01)
                    End If
                Next
            Next
        End Sub

        Private Function SpherePt(r As Double, theta As Double, phi As Double) As Vec3
            Return New Vec3(r * Math.Sin(theta) * Math.Cos(phi), r * Math.Sin(theta) * Math.Sin(phi), r * Math.Cos(theta))
        End Function

    End Module

End Namespace
