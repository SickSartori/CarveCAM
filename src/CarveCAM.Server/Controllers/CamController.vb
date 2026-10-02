Imports System.Diagnostics
Imports System.Text
Imports System.Threading
Imports Microsoft.AspNetCore.Mvc
Imports Microsoft.Extensions.Logging
Imports CarveCAM.Core.Cam
Imports CarveCAM.Core.Model
Imports CarveCAM.Core.Post
Imports CarveCAM.Server.Services

Namespace Controllers

    Public Class ComputeResponse
        Public Property ToolpathId As String
        Public Property Stats As ToolpathStats
        Public Property Warnings As List(Of String)
        ''' <summary>Il percorso ha il grezzo (GET toolpath/{id}/stock).</summary>
        Public Property HasStock As Boolean
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
        Private ReadOnly _log As ILogger(Of CamController)

        Public Sub New(meshes As MeshStore, paths As ToolpathStore, log As ILogger(Of CamController))
            _meshes = meshes
            _paths = paths
            _log = log
        End Sub

        ''' <summary>Calcola il percorso di una lavorazione (svuotatura o finitura).</summary>
        <HttpPost("compute")>
        Public Async Function Compute(<FromBody> req As ComputeRequest, ct As CancellationToken) As Task(Of IActionResult)
            If req Is Nothing OrElse req.Operation Is Nothing Then Return BadRequest(New With {.Error = "Richiesta non valida."})
            Dim op = req.Operation
            Dim sw = Stopwatch.StartNew()
            _log.LogInformation("Calcolo {Kind} '{Name}': strategia {Strategy}, utensile {Tool} Ø{Diameter} R{Corner}, passo {Stepover}/{Stepdown} mm, prof. {Depth} mm, {Boundary} entità, {Objects} oggetti, {Artifacts} artefatti, normale ({Nx};{Ny};{Nz})",
                               op.Kind, op.Name, op.Strategy, op.Tool?.Type, op.Tool?.Diameter, op.Tool?.CornerRadius, op.Stepover, op.Stepdown, op.MaxDepth,
                               If(req.Boundary?.Count, 0), If(req.Objects?.Count, 0), If(req.Artifacts?.Count, 0),
                               req.Plane?.N?.ElementAtOrDefault(0), req.Plane?.N?.ElementAtOrDefault(1), req.Plane?.N?.ElementAtOrDefault(2))
            ' grezzo: si parte da quello lasciato dalla lavorazione precedente, che deve essere ancora sul server
            Dim previous As Toolpath = Nothing
            If Not String.IsNullOrEmpty(req.StockFrom) Then
                previous = _paths.TryGet(req.StockFrom)
                If previous Is Nothing OrElse previous.StockAfter Is Nothing Then
                    _log.LogInformation("Calcolo '{Name}': grezzo della lavorazione precedente {Id} non disponibile", op.Name, req.StockFrom)
                    Return Conflict(New With {.Error = "Grezzo della lavorazione precedente non disponibile: ricalcolare le lavorazioni precedenti.", .Code = "stock-chain"})
                End If
            End If
            Try
                Dim tp = Await Task.Run(Function() CamEngine.Compute(req, AddressOf _meshes.TryGet, ct, previous), ct)
                _paths.Add(tp)
                Dim s = tp.Stats
                _log.LogInformation("Calcolo '{Name}' concluso in {Ms} ms: {Points} punti, {Levels} livelli, lavoro {Feed:0.0} mm, rapidi {Rapid:0.0} mm, interferenza max {Gouge:0.000} mm, {Warnings} avvisi",
                                   op.Name, sw.ElapsedMilliseconds, s?.PointCount, s?.Levels, s?.FeedLength, s?.RapidLength, s?.MaxGouge, If(tp.Warnings?.Count, 0))
                For Each w In If(tp.Warnings, New List(Of String)())
                    _log.LogWarning("Calcolo '{Name}': {Warning}", op.Name, w)
                Next
                Return Ok(New ComputeResponse With {.ToolpathId = tp.Id, .Stats = tp.Stats, .Warnings = tp.Warnings, .HasStock = tp.StockBefore IsNot Nothing})
            Catch ex As ArgumentException
                _log.LogWarning("Calcolo '{Name}' rifiutato dopo {Ms} ms: {Message}", op.Name, sw.ElapsedMilliseconds, ex.Message)
                Return BadRequest(New With {.Error = ex.Message})
            Catch ex As OperationCanceledException
                _log.LogInformation("Calcolo '{Name}' annullato dopo {Ms} ms", op.Name, sw.ElapsedMilliseconds)
                Return StatusCode(499, New With {.Error = "Calcolo annullato."})
            Catch ex As Exception
                _log.LogError(ex, "Calcolo '{Name}' non riuscito dopo {Ms} ms", op.Name, sw.ElapsedMilliseconds)
                Throw
            End Try
        End Function

        ''' <summary>Percorso in formato binario: int32 n, n*(x,y,z) float32, n byte tipo movimento.</summary>
        <HttpGet("toolpath/{id}")>
        Public Function GetToolpath(id As String) As IActionResult
            Dim tp = _paths.TryGet(id)
            If tp Is Nothing Then Return NotFound(New With {.Error = "Percorso non trovato: ricalcolare."})
            Return File(tp.ToBinary(), "application/octet-stream")
        End Function

        ''' <summary>Grezzo prima della lavorazione, per la simulazione dell'asportazione (formato di StockMap.ToBinary).</summary>
        <HttpGet("toolpath/{id}/stock")>
        Public Function GetStock(id As String) As IActionResult
            Dim tp = _paths.TryGet(id)
            If tp Is Nothing OrElse tp.StockBefore Is Nothing Then Return NotFound(New With {.Error = "Grezzo non disponibile: ricalcolare."})
            Return File(tp.StockBefore.ToBinary(), "application/octet-stream")
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
            If list Is Nothing Then
                _log.LogWarning("G-code: percorso {Id} non più disponibile sul server", missing)
                Return NotFound(New With {.Error = "Percorso non disponibile, ricalcolare: " & missing})
            End If
            If list.Count = 0 Then Return BadRequest(New With {.Error = "Nessun percorso da esportare."})
            Dim txt = PostProcessor.GCode(list, If(req.Options, New PostOptions()))
            _log.LogInformation("G-code generato: {Count} percorsi, controllo {Mode}, {Chars} caratteri", list.Count, req.Options?.Mode, txt.Length)
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
