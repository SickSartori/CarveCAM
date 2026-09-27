Imports CarveCAM.Core.Geometry

Namespace Meshes

    ''' <summary>Mesh triangolare "triangle soup": 9 float (3 vertici x,y,z) per triangolo.</summary>
    Public NotInheritable Class MeshData
        Public Property Id As String
        Public Property Name As String
        Public Property Positions As Single()

        Public Sub New(id As String, name As String, positions As Single())
            Me.Id = id
            Me.Name = name
            Me.Positions = positions
        End Sub

        Public ReadOnly Property TriangleCount As Integer
            Get
                Return If(Positions Is Nothing, 0, Positions.Length \ 9)
            End Get
        End Property

        Public Function Bounds() As BBox3
            Dim b = BBox3.Empty()
            For i = 0 To Positions.Length - 3 Step 3
                b.Include(New Vec3(Positions(i), Positions(i + 1), Positions(i + 2)))
            Next
            Return b
        End Function

        Public Shared Function ToBytes(positions As Single()) As Byte()
            Dim bytes(positions.Length * 4 - 1) As Byte
            Buffer.BlockCopy(positions, 0, bytes, 0, bytes.Length)
            Return bytes
        End Function

        Public Shared Function FromBytes(bytes As Byte()) As Single()
            Dim n = bytes.Length \ 4
            Dim res(n - 1) As Single
            Buffer.BlockCopy(bytes, 0, res, 0, n * 4)
            Return res
        End Function

        ''' <summary>Rimuove triangoli degeneri o con coordinate non finite.</summary>
        Public Shared Function Sanitize(positions As Single()) As Single()
            Dim outList As New List(Of Single)(positions.Length)
            For t = 0 To positions.Length - 9 Step 9
                Dim ok = True
                For k = 0 To 8
                    If Not Single.IsFinite(positions(t + k)) Then ok = False : Exit For
                Next
                If Not ok Then Continue For
                Dim a As New Vec3(positions(t), positions(t + 1), positions(t + 2))
                Dim b As New Vec3(positions(t + 3), positions(t + 4), positions(t + 5))
                Dim c As New Vec3(positions(t + 6), positions(t + 7), positions(t + 8))
                If (b - a).Cross(c - a).Length < 1.0E-14 Then Continue For
                For k = 0 To 8
                    outList.Add(positions(t + k))
                Next
            Next
            Return outList.ToArray()
        End Function
    End Class

End Namespace
