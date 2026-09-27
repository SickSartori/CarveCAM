Namespace Geometry

    ''' <summary>Matrice 4x4 (row-major) per trasformazioni affini.</summary>
    Public NotInheritable Class Mat4
        Public ReadOnly M(15) As Double

        Public Shared Function Identity() As Mat4
            Dim r As New Mat4()
            r.M(0) = 1 : r.M(5) = 1 : r.M(10) = 1 : r.M(15) = 1
            Return r
        End Function

        Public Shared Function Multiply(a As Mat4, b As Mat4) As Mat4
            Dim r As New Mat4()
            For i = 0 To 3
                For j = 0 To 3
                    Dim s = 0.0
                    For k = 0 To 3
                        s += a.M(i * 4 + k) * b.M(k * 4 + j)
                    Next
                    r.M(i * 4 + j) = s
                Next
            Next
            Return r
        End Function

        Public Shared Function Translation(x As Double, y As Double, z As Double) As Mat4
            Dim r = Identity()
            r.M(3) = x : r.M(7) = y : r.M(11) = z
            Return r
        End Function

        Public Shared Function Scaling(x As Double, y As Double, z As Double) As Mat4
            Dim r = Identity()
            r.M(0) = x : r.M(5) = y : r.M(10) = z
            Return r
        End Function

        Public Shared Function RotationX(rad As Double) As Mat4
            Dim r = Identity(), c = Math.Cos(rad), s = Math.Sin(rad)
            r.M(5) = c : r.M(6) = -s : r.M(9) = s : r.M(10) = c
            Return r
        End Function

        Public Shared Function RotationY(rad As Double) As Mat4
            Dim r = Identity(), c = Math.Cos(rad), s = Math.Sin(rad)
            r.M(0) = c : r.M(2) = s : r.M(8) = -s : r.M(10) = c
            Return r
        End Function

        Public Shared Function RotationZ(rad As Double) As Mat4
            Dim r = Identity(), c = Math.Cos(rad), s = Math.Sin(rad)
            r.M(0) = c : r.M(1) = -s : r.M(4) = s : r.M(5) = c
            Return r
        End Function

        ''' <summary>
        ''' T * Rx * Ry * Rz * S: stessa convenzione di Three.js (Euler ordine 'XYZ', angoli in gradi).
        ''' </summary>
        Public Shared Function FromTRS(position As Double(), rotationDeg As Double(), scale As Double()) As Mat4
            Dim p = If(position IsNot Nothing AndAlso position.Length >= 3, position, {0.0, 0.0, 0.0})
            Dim r = If(rotationDeg IsNot Nothing AndAlso rotationDeg.Length >= 3, rotationDeg, {0.0, 0.0, 0.0})
            Dim s = If(scale IsNot Nothing AndAlso scale.Length >= 3, scale, {1.0, 1.0, 1.0})
            Const D2R = Math.PI / 180.0
            Dim rot = Multiply(Multiply(RotationX(r(0) * D2R), RotationY(r(1) * D2R)), RotationZ(r(2) * D2R))
            Return Multiply(Multiply(Translation(p(0), p(1), p(2)), rot), Scaling(s(0), s(1), s(2)))
        End Function

        Public Function TransformPoint(p As Vec3) As Vec3
            Return New Vec3(
                M(0) * p.X + M(1) * p.Y + M(2) * p.Z + M(3),
                M(4) * p.X + M(5) * p.Y + M(6) * p.Z + M(7),
                M(8) * p.X + M(9) * p.Y + M(10) * p.Z + M(11))
        End Function

        ''' <summary>Applica la matrice ad un array di posizioni (triangle soup, 9 float per triangolo).</summary>
        Public Function TransformPositions(src As Single()) As Single()
            Dim dst(src.Length - 1) As Single
            For i = 0 To src.Length - 3 Step 3
                Dim x As Double = src(i), y As Double = src(i + 1), z As Double = src(i + 2)
                dst(i) = CSng(M(0) * x + M(1) * y + M(2) * z + M(3))
                dst(i + 1) = CSng(M(4) * x + M(5) * y + M(6) * z + M(7))
                dst(i + 2) = CSng(M(8) * x + M(9) * y + M(10) * z + M(11))
            Next
            Return dst
        End Function

        ''' <summary>Vero se la trasformazione inverte l'orientamento (determinante negativo).</summary>
        Public ReadOnly Property IsMirroring As Boolean
            Get
                Dim det = M(0) * (M(5) * M(10) - M(6) * M(9)) - M(1) * (M(4) * M(10) - M(6) * M(8)) + M(2) * (M(4) * M(9) - M(5) * M(8))
                Return det < 0
            End Get
        End Property
    End Class

    ''' <summary>
    ''' Sistema di riferimento di un piano di lavoro: origine, assi U,V nel piano e normale N.
    ''' La normale N è la direzione dell'asse utensile (dalla punta verso il mandrino).
    ''' Coordinate locali: u = (P-O)·U, v = (P-O)·V, w = (P-O)·N.
    ''' </summary>
    Public NotInheritable Class PlaneFrame
        Public ReadOnly Origin As Vec3
        Public ReadOnly U As Vec3
        Public ReadOnly V As Vec3
        Public ReadOnly N As Vec3

        Public Sub New(origin As Vec3, u As Vec3, n As Vec3)
            Me.Origin = origin
            Me.N = n.Normalized()
            If Me.N.Length < 0.5 Then Me.N = Vec3.UnitZ
            Dim uu = u - Me.N * u.Dot(Me.N)
            If uu.Length < 0.000001 Then uu = DefaultU(Me.N)
            Me.U = uu.Normalized()
            Me.V = Me.N.Cross(Me.U)
        End Sub

        ''' <summary>Asse U di riferimento (identico al client JS): X, oppure Y se la normale è quasi parallela a X.</summary>
        Public Shared Function DefaultU(n As Vec3) As Vec3
            Dim ref = If(Math.Abs(n.X) < 0.9, Vec3.UnitX, Vec3.UnitY)
            Return (ref - n * ref.Dot(n)).Normalized()
        End Function

        Public Shared Function FromNormalAngle(origin As Vec3, normal As Vec3, angleDeg As Double) As PlaneFrame
            Dim n = normal.Normalized()
            Dim u0 = DefaultU(n)
            Dim a = angleDeg * Math.PI / 180.0
            Dim u = u0 * Math.Cos(a) + n.Cross(u0) * Math.Sin(a)
            Return New PlaneFrame(origin, u, n)
        End Function

        Public Function ToLocal(p As Vec3) As Vec3
            Dim d = p - Origin
            Return New Vec3(d.Dot(U), d.Dot(V), d.Dot(N))
        End Function

        Public Function ToWorld(u As Double, v As Double, w As Double) As Vec3
            Return Origin + Me.U * u + Me.V * v + Me.N * w
        End Function

        ''' <summary>Vero se il piano coincide con un XY mondo (normale +Z), eventualmente ruotato attorno a Z.</summary>
        Public ReadOnly Property IsWorldAligned As Boolean
            Get
                Return N.Z > 0.999999999
            End Get
        End Property

        ''' <summary>Angoli di Eulero ZXZ (gradi) per G68.2 (I=alfa, J=beta, K=gamma).</summary>
        Public Function EulerZXZ() As (Alpha As Double, Beta As Double, Gamma As Double)
            Const R2D = 180.0 / Math.PI
            Dim cb = Math.Max(-1.0, Math.Min(1.0, N.Z))
            Dim beta = Math.Acos(cb)
            If Math.Sin(beta) > 0.000000001 Then
                Dim alpha = Math.Atan2(N.X, -N.Y)
                Dim gamma = Math.Atan2(U.Z, V.Z)
                Return (alpha * R2D, beta * R2D, gamma * R2D)
            ElseIf N.Z > 0 Then
                Return (0.0, 0.0, Math.Atan2(U.Y, U.X) * R2D)
            Else
                Return (0.0, 180.0, Math.Atan2(-U.Y, U.X) * R2D)
            End If
        End Function
    End Class

End Namespace
