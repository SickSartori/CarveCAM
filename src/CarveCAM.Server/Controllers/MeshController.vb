Imports System.IO
Imports Microsoft.AspNetCore.Http
Imports Microsoft.AspNetCore.Mvc
Imports Microsoft.Extensions.Logging
Imports CarveCAM.Core.Meshes
Imports CarveCAM.Server.Services

Namespace Controllers

    Public Class MeshInfo
        Public Property Id As String
        Public Property Name As String
        Public Property Triangles As Integer
        Public Property Min As Double()
        Public Property Max As Double()
    End Class

    <ApiController>
    <Route("api/mesh")>
    Public Class MeshController
        Inherits ControllerBase

        Private ReadOnly _store As MeshStore
        Private ReadOnly _log As ILogger(Of MeshController)

        Public Sub New(store As MeshStore, log As ILogger(Of MeshController))
            _store = store
            _log = log
        End Sub

        Private Shared Function Info(id As String, name As String, pos As Single()) As MeshInfo
            Dim md As New MeshData(id, name, pos)
            Dim b = md.Bounds()
            Return New MeshInfo With {.Id = id, .Name = name, .Triangles = md.TriangleCount,
                                      .Min = b.Min.ToArray(), .Max = b.Max.ToArray()}
        End Function

        ''' <summary>Formati letti nativamente dal server.</summary>
        <HttpGet("formats")>
        Public Function Formats() As IActionResult
            Return Ok(New With {.Server = MeshImporter.SupportedExtensions})
        End Function

        ''' <summary>Importa un file (STL, OBJ, PLY, OFF) con i lettori VB.NET.</summary>
        <HttpPost("import")>
        <DisableRequestSizeLimit>
        <RequestFormLimits(MultipartBodyLengthLimit:=2147483648L)>
        Public Async Function Import(file As IFormFile) As Task(Of IActionResult)
            If file Is Nothing OrElse file.Length = 0 Then Return BadRequest(New With {.Error = "Nessun file ricevuto."})
            If Not MeshImporter.IsSupported(file.FileName) Then Return StatusCode(415, New With {.Error = "Formato non gestito dal server."})
            Using ms As New MemoryStream()
                Await file.CopyToAsync(ms)
                Try
                    Dim sw = System.Diagnostics.Stopwatch.StartNew()
                    Dim pos = MeshImporter.Import(file.FileName, ms.ToArray())
                    Dim id = _store.Add(pos)
                    _log.LogInformation("Importato {File} ({Bytes} byte): {Triangles} triangoli in {Ms} ms, mesh {Id}", file.FileName, file.Length, pos.Length \ 9, sw.ElapsedMilliseconds, id)
                    Return Ok(Info(id, Path.GetFileNameWithoutExtension(file.FileName), pos))
                Catch ex As Exception When TypeOf ex Is InvalidDataException OrElse TypeOf ex Is NotSupportedException OrElse
                                           TypeOf ex Is FormatException OrElse TypeOf ex Is IndexOutOfRangeException OrElse
                                           TypeOf ex Is ArgumentException
                    _log.LogWarning(ex, "Importazione di {File} non riuscita", file.FileName)
                    Return BadRequest(New With {.Error = "Impossibile leggere il file: " & ex.Message})
                End Try
            End Using
        End Function

        ''' <summary>Carica una triangle soup già convertita dal client (float32 little-endian, 9 per triangolo).</summary>
        <HttpPost("upload")>
        <DisableRequestSizeLimit>
        Public Async Function Upload(<FromQuery> name As String) As Task(Of IActionResult)
            Using ms As New MemoryStream()
                Await Request.Body.CopyToAsync(ms)
                If ms.Length < 36 OrElse ms.Length Mod 36 <> 0 Then Return BadRequest(New With {.Error = "Dati mesh non validi."})
                Dim pos = MeshData.Sanitize(MeshData.FromBytes(ms.ToArray()))
                If pos.Length = 0 Then Return BadRequest(New With {.Error = "La mesh non contiene triangoli validi."})
                Dim id = _store.Add(pos)
                _log.LogInformation("Mesh caricata dal browser '{Name}': {Triangles} triangoli, mesh {Id}", name, pos.Length \ 9, id)
                Return Ok(Info(id, If(name, "Mesh"), pos))
            End Using
        End Function

        ''' <summary>Posizioni dei triangoli (float32) per la visualizzazione.</summary>
        <HttpGet("{id}")>
        Public Function GetMesh(id As String) As IActionResult
            Dim pos = _store.TryGet(id)
            If pos Is Nothing Then
                _log.LogWarning("Mesh {Id} richiesta ma non presente sul server", id)
                Return NotFound(New With {.Error = "Mesh non trovata."})
            End If
            Return File(MeshData.ToBytes(pos), "application/octet-stream")
        End Function

        ''' <summary>Faccia B-rep di ogni triangolo (int32 little-endian), per i modelli CAD.</summary>
        <HttpPost("{id}/faces")>
        <DisableRequestSizeLimit>
        Public Async Function PutFaces(id As String) As Task(Of IActionResult)
            Using ms As New MemoryStream()
                Await Request.Body.CopyToAsync(ms)
                If ms.Length Mod 4 <> 0 Then Return BadRequest(New With {.Error = "Dati facce non validi."})
                If Not _store.PutFaces(id, MeshStore.FacesFromBytes(ms.ToArray())) Then
                    Return BadRequest(New With {.Error = "Il numero di facce non corrisponde ai triangoli della mesh."})
                End If
                Return NoContent()
            End Using
        End Function

        <HttpGet("{id}/faces")>
        Public Function GetFaces(id As String) As IActionResult
            Dim faces = _store.TryGetFaces(id)
            If faces Is Nothing Then Return NotFound(New With {.Error = "Facce non disponibili per questa mesh."})
            Return File(MeshStore.FacesToBytes(faces), "application/octet-stream")
        End Function

    End Class

End Namespace
