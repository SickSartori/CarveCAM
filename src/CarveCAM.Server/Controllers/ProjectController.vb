Imports System.IO
Imports System.IO.Compression
Imports System.Text
Imports System.Text.Json
Imports Microsoft.AspNetCore.Http
Imports Microsoft.AspNetCore.Mvc
Imports Microsoft.Extensions.Logging
Imports CarveCAM.Core.Meshes
Imports CarveCAM.Server.Services

Namespace Controllers

    ''' <summary>
    ''' Salvataggio/apertura progetto: archivio .ccam (zip) con project.json e le mesh binarie (meshes/{id}.bin).
    ''' </summary>
    <ApiController>
    <Route("api/project")>
    Public Class ProjectController
        Inherits ControllerBase

        Private ReadOnly _meshes As MeshStore
        Private ReadOnly _log As ILogger(Of ProjectController)

        Public Sub New(meshes As MeshStore, log As ILogger(Of ProjectController))
            _meshes = meshes
            _log = log
        End Sub

        Private Shared Function MeshIds(root As JsonElement) As List(Of String)
            Dim ids As New List(Of String)()
            Dim objs As JsonElement
            If root.ValueKind = JsonValueKind.Object AndAlso root.TryGetProperty("objects", objs) AndAlso objs.ValueKind = JsonValueKind.Array Then
                For Each o In objs.EnumerateArray()
                    Dim mid As JsonElement
                    If o.TryGetProperty("meshId", mid) AndAlso mid.ValueKind = JsonValueKind.String Then
                        Dim s = mid.GetString()
                        If MeshStore.IsValidId(s) AndAlso Not ids.Contains(s) Then ids.Add(s)
                    End If
                Next
            End If
            Return ids
        End Function

        <HttpPost("save")>
        <DisableRequestSizeLimit>
        Public Async Function Save() As Task(Of IActionResult)
            Dim json As String
            Using sr As New StreamReader(Request.Body, Encoding.UTF8)
                json = Await sr.ReadToEndAsync()
            End Using
            Dim ids As List(Of String)
            Try
                Using doc = JsonDocument.Parse(json)
                    ids = MeshIds(doc.RootElement)
                End Using
            Catch ex As JsonException
                _log.LogWarning("Salvataggio: progetto non valido ({Message})", ex.Message)
                Return BadRequest(New With {.Error = "Progetto non valido."})
            End Try
            Dim missingMeshes = ids.Where(Function(i) _meshes.TryGet(i) Is Nothing).ToList()
            If missingMeshes.Count > 0 Then _log.LogWarning("Salvataggio: {Count} mesh non presenti sul server ({Ids})", missingMeshes.Count, String.Join(", ", missingMeshes))
            Using ms As New MemoryStream()
                Using zip As New ZipArchive(ms, ZipArchiveMode.Create, True)
                    Dim pe = zip.CreateEntry("project.json", CompressionLevel.Optimal)
                    Using w As New StreamWriter(pe.Open(), New UTF8Encoding(False))
                        Await w.WriteAsync(json)
                    End Using
                    For Each id In ids
                        Dim pos = _meshes.TryGet(id)
                        If pos Is Nothing Then Continue For
                        Dim me1 = zip.CreateEntry("meshes/" & id & ".bin", CompressionLevel.Fastest)
                        Using s = me1.Open()
                            Dim bytes = MeshData.ToBytes(pos)
                            Await s.WriteAsync(bytes, 0, bytes.Length)
                        End Using
                        Dim faces = _meshes.TryGetFaces(id)
                        If faces IsNot Nothing Then
                            Using s = zip.CreateEntry("meshes/" & id & ".faces", CompressionLevel.Fastest).Open()
                                Dim bytes = MeshStore.FacesToBytes(faces)
                                Await s.WriteAsync(bytes, 0, bytes.Length)
                            End Using
                        End If
                    Next
                End Using
                _log.LogInformation("Progetto salvato: {Bytes} byte, {Meshes} mesh", ms.Length, ids.Count - missingMeshes.Count)
                Return File(ms.ToArray(), "application/zip", "progetto.ccam")
            End Using
        End Function

        <HttpPost("load")>
        <DisableRequestSizeLimit>
        <RequestFormLimits(MultipartBodyLengthLimit:=2147483648L)>
        Public Async Function Load(file As IFormFile) As Task(Of IActionResult)
            If file Is Nothing Then Return BadRequest(New With {.Error = "Nessun file ricevuto."})
            Using ms As New MemoryStream()
                Await file.CopyToAsync(ms)
                ms.Position = 0
                Try
                    Using zip As New ZipArchive(ms, ZipArchiveMode.Read)
                        Dim pe = zip.GetEntry("project.json")
                        If pe Is Nothing Then Return BadRequest(New With {.Error = "Archivio senza project.json."})
                        Dim json As String
                        Using sr As New StreamReader(pe.Open(), Encoding.UTF8)
                            json = Await sr.ReadToEndAsync()
                        End Using
                        ' prima le mesh, poi le facce B-rep (che vengono verificate sul numero di triangoli)
                        For Each ext In {".bin", ".faces"}
                            For Each e In zip.Entries
                                If Not e.FullName.StartsWith("meshes/", StringComparison.Ordinal) OrElse Not e.FullName.EndsWith(ext, StringComparison.Ordinal) Then Continue For
                                Dim id = Path.GetFileNameWithoutExtension(e.Name)
                                If Not MeshStore.IsValidId(id) Then Continue For
                                Using s = e.Open(), buf As New MemoryStream()
                                    Await s.CopyToAsync(buf)
                                    If ext = ".bin" Then
                                        _meshes.Put(id, MeshData.FromBytes(buf.ToArray()))
                                    ElseIf buf.Length Mod 4 = 0 Then
                                        _meshes.PutFaces(id, MeshStore.FacesFromBytes(buf.ToArray()))
                                    End If
                                End Using
                            Next
                        Next
                        _log.LogInformation("Progetto aperto: {File} ({Bytes} byte, {Entries} voci)", file.FileName, file.Length, zip.Entries.Count)
                        Return Content(json, "application/json", Encoding.UTF8)
                    End Using
                Catch ex As InvalidDataException
                    _log.LogWarning(ex, "Apertura di {File} non riuscita: archivio non valido", file.FileName)
                    Return BadRequest(New With {.Error = "File progetto non valido."})
                End Try
            End Using
        End Function

    End Class

End Namespace
