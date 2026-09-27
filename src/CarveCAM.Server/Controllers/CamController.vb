Imports System.Text
Imports System.Threading
Imports Microsoft.AspNetCore.Mvc
Imports CarveCAM.Core.Cam
Imports CarveCAM.Core.Model
Imports CarveCAM.Core.Post
Imports CarveCAM.Server.Services

Namespace Controllers

    Public Class ComputeResponse
        Public Property ToolpathId As String
        Public Property Stats As ToolpathStats
        Public Property Warnings As List(Of String)
    End Class

    Public Class ExportRequest
        Public Property ToolpathIds As List(Of String)
        Public Property Options As New PostOptions()
    End Class

    <ApiController>
    <Route("api/cam")>
    Public Class CamController
        Inherits ControllerBase

        Private ReadOnly _meshes As MeshStore
        Private ReadOnly _paths As ToolpathStore

        Public Sub New(meshes As MeshStore, paths As ToolpathStore)
            _meshes = meshes
            _paths = paths
        End Sub

        ''' <summary>Calcola il percorso di una lavorazione (svuotatura o finitura).</summary>
        <HttpPost("compute")>
        Public Async Function Compute(<FromBody> req As ComputeRequest, ct As CancellationToken) As Task(Of IActionResult)
            If req Is Nothing OrElse req.Operation Is Nothing Then Return BadRequest(New With {.Error = "Richiesta non valida."})
            Try
                Dim tp = Await Task.Run(Function() CamEngine.Compute(req, AddressOf _meshes.TryGet, ct), ct)
                _paths.Add(tp)
                Return Ok(New ComputeResponse With {.ToolpathId = tp.Id, .Stats = tp.Stats, .Warnings = tp.Warnings})
            Catch ex As ArgumentException
                Return BadRequest(New With {.Error = ex.Message})
            Catch ex As OperationCanceledException
                Return StatusCode(499, New With {.Error = "Calcolo annullato."})
            End Try
        End Function

        ''' <summary>Percorso in formato binario: int32 n, n*(x,y,z) float32, n byte tipo movimento.</summary>
        <HttpGet("toolpath/{id}")>
        Public Function GetToolpath(id As String) As IActionResult
            Dim tp = _paths.TryGet(id)
            If tp Is Nothing Then Return NotFound(New With {.Error = "Percorso non trovato: ricalcolare."})
            Return File(tp.ToBinary(), "application/octet-stream")
        End Function

        Private Function Collect(req As ExportRequest, ByRef missing As String) As List(Of Toolpath)
            Dim res As New List(Of Toolpath)()
            If req?.ToolpathIds Is Nothing Then Return res
            For Each id In req.ToolpathIds
                Dim tp = _paths.TryGet(id)
                If tp Is Nothing Then missing = id : Return Nothing
                res.Add(tp)
            Next
            Return res
        End Function

        <HttpPost("gcode")>
        Public Function GCode(<FromBody> req As ExportRequest) As IActionResult
            Dim missing As String = Nothing
            Dim list = Collect(req, missing)
            If list Is Nothing Then Return NotFound(New With {.Error = "Percorso non disponibile, ricalcolare: " & missing})
            If list.Count = 0 Then Return BadRequest(New With {.Error = "Nessun percorso da esportare."})
            Dim txt = PostProcessor.GCode(list, If(req.Options, New PostOptions()))
            Return File(Encoding.ASCII.GetBytes(txt), "text/plain", "carvecam.nc")
        End Function

        <HttpPost("cl")>
        Public Function ClData(<FromBody> req As ExportRequest) As IActionResult
            Dim missing As String = Nothing
            Dim list = Collect(req, missing)
            If list Is Nothing Then Return NotFound(New With {.Error = "Percorso non disponibile, ricalcolare: " & missing})
            If list.Count = 0 Then Return BadRequest(New With {.Error = "Nessun percorso da esportare."})
            Dim txt = PostProcessor.ClData(list, If(req.Options, New PostOptions()))
            Return File(Encoding.ASCII.GetBytes(txt), "text/plain", "carvecam.cls")
        End Function

    End Class

End Namespace
