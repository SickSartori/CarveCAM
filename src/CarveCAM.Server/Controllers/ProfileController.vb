Imports Microsoft.AspNetCore.Mvc
Imports CarveCAM.Core.Cam

Namespace Controllers

    ''' <summary>Profili per gli sketch ricavati da facce e oggetti 3D proiettati sul piano (ombra e booleane).</summary>
    <ApiController>
    <Route("api/profile")>
    Public Class ProfileController
        Inherits ControllerBase

        <HttpPost("")>
        <DisableRequestSizeLimit>
        Public Function Build(<FromBody> req As ProfileRequest) As IActionResult
            If req?.Items Is Nothing OrElse req.Items.Count = 0 Then Return BadRequest(New With {.Error = "Nessun elemento selezionato."})
            Return Ok(ProfileBuilder.Build(req))
        End Function

    End Class

End Namespace
