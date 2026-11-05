Imports Microsoft.AspNetCore.Mvc
Imports CarveCAM.Server.Services

Namespace Controllers

    ''' <summary>
    ''' Aggiornamenti automatici: stato, ricerca, scaricamento e riavvio per installare. Le richieste che cambiano qualcosa
    ''' devono portare l'intestazione X-CarveCAM, che una pagina qualunque aperta nel browser non può aggiungere.
    ''' </summary>
    <ApiController>
    <Route("api/update")>
    Public Class UpdateController
        Inherits ControllerBase

        Private ReadOnly _svc As UpdateService

        Public Sub New(svc As UpdateService)
            _svc = svc
        End Sub

        Private Function FromApp() As Boolean
            Return Request.Headers.ContainsKey("X-CarveCAM")
        End Function

        <HttpGet("")>
        Public Function [Get]() As IActionResult
            Return Ok(_svc.Status())
        End Function

        ''' <summary>Cerca una versione nuova. Senza force si usa l'esito dell'ultima ora, per non consumare le chiamate che GitHub concede per indirizzo.</summary>
        <HttpPost("check")>
        Public Async Function Check(<FromQuery> force As Boolean, ct As Threading.CancellationToken) As Task(Of IActionResult)
            If Not FromApp() Then Return StatusCode(403)
            Return Ok(Await _svc.CheckAsync(force, ct))
        End Function

        <HttpPost("download")>
        Public Function Download() As IActionResult
            If Not FromApp() Then Return StatusCode(403)
            Return Ok(_svc.StartDownload())
        End Function

        <HttpPost("restart")>
        Public Function Restart() As IActionResult
            If Not FromApp() Then Return StatusCode(403)
            If Not _svc.RequestRestart() Then Return Conflict(New With {.Error = If(_svc.Status().LastError, "Nessun aggiornamento pronto da installare")})
            Return Accepted(New With {.Ok = True})
        End Function

    End Class

End Namespace
