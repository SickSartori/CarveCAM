Imports System.Collections.Concurrent
Imports System.IO
Imports System.Text.RegularExpressions
Imports Microsoft.AspNetCore.Hosting
Imports CarveCAM.Core.Cam
Imports CarveCAM.Core.Meshes

Namespace Services

    ''' <summary>
    ''' Archivio delle mesh caricate: in memoria con copia su disco (App_Data/meshes). Per i modelli CAD
    ''' (STEP, IGES, BREP) conserva anche la faccia B-rep di ogni triangolo ({id}.faces, int32).
    ''' </summary>
    Public NotInheritable Class MeshStore
        Private ReadOnly _mem As New ConcurrentDictionary(Of String, Single())()
        Private ReadOnly _faces As New ConcurrentDictionary(Of String, Integer())()
        Private ReadOnly _dir As String
        Private Shared ReadOnly IdRx As New Regex("^[A-Za-z0-9_-]{1,64}$", RegexOptions.Compiled)

        Public Sub New(env As IWebHostEnvironment)
            _dir = Path.Combine(env.ContentRootPath, "App_Data", "meshes")
            Directory.CreateDirectory(_dir)
        End Sub

        Public Shared Function IsValidId(id As String) As Boolean
            Return id IsNot Nothing AndAlso IdRx.IsMatch(id)
        End Function

        Public Function Add(positions As Single()) As String
            Dim id = Guid.NewGuid().ToString("N")
            Put(id, positions)
            Return id
        End Function

        Public Sub Put(id As String, positions As Single())
            If Not IsValidId(id) Then Throw New ArgumentException("Id mesh non valido.")
            _mem(id) = positions
            File.WriteAllBytes(Path.Combine(_dir, id & ".bin"), MeshData.ToBytes(positions))
        End Sub

        Public Function TryGet(id As String) As Single()
            If Not IsValidId(id) Then Return Nothing
            Dim p As Single() = Nothing
            If _mem.TryGetValue(id, p) Then Return p
            Dim f = Path.Combine(_dir, id & ".bin")
            If Not File.Exists(f) Then Return Nothing
            p = MeshData.FromBytes(File.ReadAllBytes(f))
            _mem(id) = p
            Return p
        End Function

        ''' <summary>Associa a ogni triangolo della mesh la sua faccia B-rep; False se il numero non corrisponde.</summary>
        Public Function PutFaces(id As String, faces As Integer()) As Boolean
            Dim pos = TryGet(id)
            If pos Is Nothing OrElse faces Is Nothing OrElse faces.Length <> pos.Length \ 9 Then Return False
            _faces(id) = faces
            File.WriteAllBytes(Path.Combine(_dir, id & ".faces"), FacesToBytes(faces))
            Return True
        End Function

        Public Function TryGetFaces(id As String) As Integer()
            If Not IsValidId(id) Then Return Nothing
            Dim fc As Integer() = Nothing
            If _faces.TryGetValue(id, fc) Then Return fc
            Dim f = Path.Combine(_dir, id & ".faces")
            If Not File.Exists(f) Then Return Nothing
            fc = FacesFromBytes(File.ReadAllBytes(f))
            _faces(id) = fc
            Return fc
        End Function

        Public Shared Function FacesToBytes(faces As Integer()) As Byte()
            Dim b(faces.Length * 4 - 1) As Byte
            Buffer.BlockCopy(faces, 0, b, 0, b.Length)
            Return b
        End Function

        Public Shared Function FacesFromBytes(b As Byte()) As Integer()
            Dim faces(b.Length \ 4 - 1) As Integer
            Buffer.BlockCopy(b, 0, faces, 0, faces.Length * 4)
            Return faces
        End Function
    End Class

    ''' <summary>Percorsi calcolati (in memoria, ultimi 300).</summary>
    Public NotInheritable Class ToolpathStore
        Private ReadOnly _items As New ConcurrentDictionary(Of String, Toolpath)()
        Private ReadOnly _order As New ConcurrentQueue(Of String)()

        Public Sub Add(tp As Toolpath)
            _items(tp.Id) = tp
            _order.Enqueue(tp.Id)
            While _order.Count > 300
                Dim old As String = Nothing
                If _order.TryDequeue(old) Then _items.TryRemove(old, Nothing)
            End While
        End Sub

        Public Function TryGet(id As String) As Toolpath
            Dim tp As Toolpath = Nothing
            If id IsNot Nothing AndAlso _items.TryGetValue(id, tp) Then Return tp
            Return Nothing
        End Function
    End Class

End Namespace
