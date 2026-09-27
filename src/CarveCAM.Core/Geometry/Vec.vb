Imports System.Globalization

Namespace Geometry

    ''' <summary>Vettore/punto 3D in doppia precisione.</summary>
    Public Structure Vec3
        Public X As Double
        Public Y As Double
        Public Z As Double

        Public Sub New(x As Double, y As Double, z As Double)
            Me.X = x : Me.Y = y : Me.Z = z
        End Sub

        Public Shared ReadOnly Zero As New Vec3(0, 0, 0)
        Public Shared ReadOnly UnitX As New Vec3(1, 0, 0)
        Public Shared ReadOnly UnitY As New Vec3(0, 1, 0)
        Public Shared ReadOnly UnitZ As New Vec3(0, 0, 1)

        Public Shared Operator +(a As Vec3, b As Vec3) As Vec3
            Return New Vec3(a.X + b.X, a.Y + b.Y, a.Z + b.Z)
        End Operator

        Public Shared Operator -(a As Vec3, b As Vec3) As Vec3
            Return New Vec3(a.X - b.X, a.Y - b.Y, a.Z - b.Z)
        End Operator

        Public Shared Operator -(a As Vec3) As Vec3
            Return New Vec3(-a.X, -a.Y, -a.Z)
        End Operator

        Public Shared Operator *(a As Vec3, s As Double) As Vec3
            Return New Vec3(a.X * s, a.Y * s, a.Z * s)
        End Operator

        Public Shared Operator *(s As Double, a As Vec3) As Vec3
            Return New Vec3(a.X * s, a.Y * s, a.Z * s)
        End Operator

        Public Shared Operator /(a As Vec3, s As Double) As Vec3
            Return New Vec3(a.X / s, a.Y / s, a.Z / s)
        End Operator

        Public Function Dot(b As Vec3) As Double
            Return X * b.X + Y * b.Y + Z * b.Z
        End Function

        Public Function Cross(b As Vec3) As Vec3
            Return New Vec3(Y * b.Z - Z * b.Y, Z * b.X - X * b.Z, X * b.Y - Y * b.X)
        End Function

        Public ReadOnly Property Length As Double
            Get
                Return Math.Sqrt(X * X + Y * Y + Z * Z)
            End Get
        End Property

        Public Function Normalized() As Vec3
            Dim l = Length
            If l < 1.0E-300 Then Return Zero
            Return New Vec3(X / l, Y / l, Z / l)
        End Function

        Public Shared Function FromArray(a As Double(), Optional fallback As Vec3 = Nothing) As Vec3
            If a Is Nothing OrElse a.Length < 3 Then Return fallback
            Return New Vec3(a(0), a(1), a(2))
        End Function

        Public Function ToArray() As Double()
            Return {X, Y, Z}
        End Function

        Public Overrides Function ToString() As String
            Return String.Format(CultureInfo.InvariantCulture, "({0:0.####}, {1:0.####}, {2:0.####})", X, Y, Z)
        End Function
    End Structure

    ''' <summary>Vettore/punto 2D (coordinate u,v sul piano di lavoro).</summary>
    Public Structure Vec2
        Public X As Double
        Public Y As Double

        Public Sub New(x As Double, y As Double)
            Me.X = x : Me.Y = y
        End Sub

        Public Shared Operator +(a As Vec2, b As Vec2) As Vec2
            Return New Vec2(a.X + b.X, a.Y + b.Y)
        End Operator

        Public Shared Operator -(a As Vec2, b As Vec2) As Vec2
            Return New Vec2(a.X - b.X, a.Y - b.Y)
        End Operator

        Public Shared Operator *(a As Vec2, s As Double) As Vec2
            Return New Vec2(a.X * s, a.Y * s)
        End Operator

        Public Shared Operator *(s As Double, a As Vec2) As Vec2
            Return New Vec2(a.X * s, a.Y * s)
        End Operator

        Public Function Dot(b As Vec2) As Double
            Return X * b.X + Y * b.Y
        End Function

        ''' <summary>Componente Z del prodotto vettoriale.</summary>
        Public Function Cross(b As Vec2) As Double
            Return X * b.Y - Y * b.X
        End Function

        Public ReadOnly Property Length As Double
            Get
                Return Math.Sqrt(X * X + Y * Y)
            End Get
        End Property

        Public Shared Function Distance(a As Vec2, b As Vec2) As Double
            Dim dx = a.X - b.X, dy = a.Y - b.Y
            Return Math.Sqrt(dx * dx + dy * dy)
        End Function

        Public Shared Function Lerp(a As Vec2, b As Vec2, t As Double) As Vec2
            Return New Vec2(a.X + (b.X - a.X) * t, a.Y + (b.Y - a.Y) * t)
        End Function

        Public Overrides Function ToString() As String
            Return String.Format(CultureInfo.InvariantCulture, "({0:0.####}, {1:0.####})", X, Y)
        End Function
    End Structure

    ''' <summary>Box allineato agli assi.</summary>
    Public Structure BBox3
        Public Min As Vec3
        Public Max As Vec3

        Public Shared Function Empty() As BBox3
            Return New BBox3 With {
                .Min = New Vec3(Double.PositiveInfinity, Double.PositiveInfinity, Double.PositiveInfinity),
                .Max = New Vec3(Double.NegativeInfinity, Double.NegativeInfinity, Double.NegativeInfinity)}
        End Function

        Public Sub Include(p As Vec3)
            If p.X < Min.X Then Min.X = p.X
            If p.Y < Min.Y Then Min.Y = p.Y
            If p.Z < Min.Z Then Min.Z = p.Z
            If p.X > Max.X Then Max.X = p.X
            If p.Y > Max.Y Then Max.Y = p.Y
            If p.Z > Max.Z Then Max.Z = p.Z
        End Sub

        Public ReadOnly Property IsValid As Boolean
            Get
                Return Min.X <= Max.X
            End Get
        End Property
    End Structure

End Namespace
