Imports Microsoft.AspNetCore.Mvc
Imports Microsoft.Extensions.Logging
Imports CarveCAM.Core.Cam

Namespace Controllers

    ''' <summary>Profili per gli sketch ricavati da facce e oggetti 3D proiettati sul piano (ombra e booleane).</summary>
    <ApiController>
    <Route("api/profile")>
    Public Class ProfileController
        Inherits ControllerBase

        Private ReadOnly _log As ILogger(Of ProfileController)

        Public Sub New(log As ILogger(Of ProfileController))
            _log = log
        End Sub

        <HttpPost("")>
        <DisableRequestSizeLimit>
        Public Function Build(<FromBody> req As ProfileRequest) As IActionResult
            If req?.Items Is Nothing OrElse req.Items.Count = 0 Then Return BadRequest(New With {.Error = "Nessun elemento selezionato."})
            Dim sw = System.Diagnostics.Stopwatch.StartNew()
            Dim res = ProfileBuilder.Build(req)
            _log.LogInformation("Profilo da 3D ({Mode}, offset {Offset}): {Items} elementi -> {Shapes} contorni in {Ms} ms", req.Mode, req.Offset, req.Items.Count, res?.Shapes?.Count, sw.ElapsedMilliseconds)
            Return Ok(res)
        End Function

    End Class

End Namespace
