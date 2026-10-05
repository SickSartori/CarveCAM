Imports System.IO
Imports System.Text
Imports System.Text.Json
Imports Microsoft.AspNetCore.Hosting
Imports Microsoft.AspNetCore.Mvc
Imports Microsoft.Extensions.Logging

Namespace Controllers

    ''' <summary>
    ''' Archivi dell'utente, condivisi da tutti i progetti: magazzino utensili (tools), setup di lavorazione
    ''' (setups) e magazzino macchine (machines). Ogni archivio è un array JSON di oggetti con un "id" in App_Data/library/{archivio}.json;
    ''' il contenuto dei singoli elementi è gestito dall'interfaccia.
    ''' </summary>
    <ApiController>
    <Route("api/library")>
    Public Class LibraryController
        Inherits ControllerBase

        Private Shared ReadOnly Kinds As String() = {"tools", "setups", "machines"}
        Private Shared ReadOnly Gate As New Object()
        Private Const MaxBytes As Integer = 8 * 1024 * 1024
        Private ReadOnly _dir As String
        Private ReadOnly _log As ILogger(Of LibraryController)

        Public Sub New(env As IWebHostEnvironment, log As ILogger(Of LibraryController))
            _dir = Path.Combine(env.ContentRootPath, "App_Data", "library")
            Directory.CreateDirectory(_dir)
            _log = log
        End Sub

        Private Function FileOf(kind As String) As String
            Return Path.Combine(_dir, kind & ".json")
        End Function

        ''' <summary>Elenco dell'archivio; null se non è mai stato creato (l'interfaccia lo inizializza).</summary>
        <HttpGet("{kind}")>
        Public Function GetList(kind As String) As IActionResult
            If Not Kinds.Contains(kind) Then Return NotFound(New With {.Error = "Archivio sconosciuto."})
            Dim f = FileOf(kind)
            If Not System.IO.File.Exists(f) Then Return Content("null", "application/json", Encoding.UTF8)
            SyncLock Gate
                Return Content(System.IO.File.ReadAllText(f, Encoding.UTF8), "application/json", Encoding.UTF8)
            End SyncLock
        End Function

        ''' <summary>Sostituisce l'archivio con l'elenco ricevuto (scrittura atomica tramite file temporaneo).</summary>
        <HttpPut("{kind}")>
        Public Async Function PutList(kind As String) As Task(Of IActionResult)
            If Not Kinds.Contains(kind) Then Return NotFound(New With {.Error = "Archivio sconosciuto."})
            Dim json As String
            Using sr As New StreamReader(Request.Body, Encoding.UTF8)
                json = Await sr.ReadToEndAsync()
            End Using
            If json.Length > MaxBytes Then Return BadRequest(New With {.Error = "Archivio troppo grande."})
            Dim count As Integer
            Try
                Using doc = JsonDocument.Parse(json)
                    If doc.RootElement.ValueKind <> JsonValueKind.Array Then Return BadRequest(New With {.Error = "L'archivio deve essere un elenco."})
                    For Each it In doc.RootElement.EnumerateArray()
                        Dim id As JsonElement
                        If it.ValueKind <> JsonValueKind.Object OrElse Not it.TryGetProperty("id", id) OrElse id.ValueKind <> JsonValueKind.String Then
                            Return BadRequest(New With {.Error = "Ogni elemento dell'archivio deve avere un id."})
                        End If
                        count += 1
                    Next
                End Using
            Catch ex As JsonException
                _log.LogWarning("Archivio {Kind} non valido: {Message}", kind, ex.Message)
                Return BadRequest(New With {.Error = "JSON non valido."})
            End Try
            Dim f = FileOf(kind)
            SyncLock Gate
                Dim tmp = f & ".tmp"
                System.IO.File.WriteAllText(tmp, json, New UTF8Encoding(False))
                System.IO.File.Move(tmp, f, True)
            End SyncLock
            _log.LogInformation("Archivio {Kind} salvato: {Count} elementi", kind, count)
            Return NoContent()
        End Function

    End Class

End Namespace
