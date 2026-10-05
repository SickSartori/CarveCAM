Imports System.IO
Imports System.Text
Imports System.Text.Json
Imports System.Text.RegularExpressions
Imports Microsoft.AspNetCore.Hosting
Imports Microsoft.AspNetCore.Mvc
Imports Microsoft.Extensions.Logging

Namespace Controllers

    Public Class RecoveryInfo
        Public Property File As String
        Public Property Name As String
        Public Property Reason As String
        Public Property Time As DateTime
        Public Property Size As Long
    End Class

    ''' <summary>
    ''' Copie di sicurezza dei progetti (solo project.json: le mesh restano nell'archivio del server), salvate
    ''' periodicamente dall'interfaccia mentre ci sono modifiche non salvate. Si conservano le ultime
    ''' <see cref="Keep"/> copie in App_Data/recovery.
    ''' </summary>
    <ApiController>
    <Route("api/recovery")>
    Public Class RecoveryController
        Inherits ControllerBase

        Private Const Keep As Integer = 30
        Private Const MaxBytes As Integer = 32 * 1024 * 1024
        Private Shared ReadOnly Gate As New Object()
        Private Shared ReadOnly FileRx As New Regex("^(\d{8}-\d{6}-\d{3})_([a-z]{1,16})_(.{0,60})\.json$", RegexOptions.Compiled)
        Private ReadOnly _dir As String
        Private ReadOnly _log As ILogger(Of RecoveryController)

        Public Sub New(env As IWebHostEnvironment, log As ILogger(Of RecoveryController))
            _dir = Path.Combine(env.ContentRootPath, "App_Data", "recovery")
            Directory.CreateDirectory(_dir)
            _log = log
        End Sub

        Private Shared Function Safe(s As String, max As Integer) As String
            Dim r = Regex.Replace(If(s, ""), "[^A-Za-z0-9 _\-àèéìòùÀÈÉÌÒÙ]", "_").Trim()
            Return If(r.Length > max, r.Substring(0, max), r)
        End Function

        <HttpPost("")>
        Public Async Function Save(<FromQuery> reason As String) As Task(Of IActionResult)
            Dim json As String
            Using sr As New StreamReader(Request.Body, Encoding.UTF8)
                json = Await sr.ReadToEndAsync()
            End Using
            If json.Length > MaxBytes Then Return BadRequest(New With {.Error = "Progetto troppo grande."})
            Dim name As String = "progetto"
            Try
                Using doc = JsonDocument.Parse(json)
                    Dim n As JsonElement
                    If doc.RootElement.ValueKind <> JsonValueKind.Object Then Return BadRequest(New With {.Error = "Progetto non valido."})
                    If doc.RootElement.TryGetProperty("name", n) AndAlso n.ValueKind = JsonValueKind.String Then name = n.GetString()
                End Using
            Catch ex As JsonException
                Return BadRequest(New With {.Error = "Progetto non valido."})
            End Try
            Dim why = Regex.Replace(If(reason, "auto").ToLowerInvariant(), "[^a-z]", "")
            If why.Length = 0 Then why = "auto"
            If why.Length > 16 Then why = why.Substring(0, 16)
            Dim file = $"{DateTime.Now:yyyyMMdd-HHmmss-fff}_{why}_{Safe(name, 60)}.json"
            SyncLock Gate
                System.IO.File.WriteAllText(Path.Combine(_dir, file), json, New UTF8Encoding(False))
                ' si tengono solo le copie più recenti
                Dim all = Directory.GetFiles(_dir, "*.json").OrderByDescending(Function(f) Path.GetFileName(f), StringComparer.Ordinal).ToList()
                For Each old In all.Skip(Keep)
                    Try
                        System.IO.File.Delete(old)
                    Catch ex As IOException
                    End Try
                Next
            End SyncLock
            _log.LogInformation("Copia di sicurezza salvata: {File} ({Size} byte)", file, json.Length)
            Return NoContent()
        End Function

        <HttpGet("")>
        Public Function List() As IActionResult
            Dim res As New List(Of RecoveryInfo)()
            For Each f In Directory.GetFiles(_dir, "*.json")
                Dim n = Path.GetFileName(f)
                Dim m = FileRx.Match(n)
                If Not m.Success Then Continue For
                Dim ts As DateTime
                If Not DateTime.TryParseExact(m.Groups(1).Value, "yyyyMMdd-HHmmss-fff", Globalization.CultureInfo.InvariantCulture, Globalization.DateTimeStyles.None, ts) Then Continue For
                res.Add(New RecoveryInfo With {.File = n, .Reason = m.Groups(2).Value, .Name = m.Groups(3).Value, .Time = ts, .Size = New FileInfo(f).Length})
            Next
            Return Ok(res.OrderByDescending(Function(x) x.Time).ToList())
        End Function

        <HttpGet("{file}")>
        Public Function GetCopy(file As String) As IActionResult
            If file Is Nothing OrElse Not FileRx.IsMatch(file) OrElse file.Contains("..") OrElse file.IndexOfAny(Path.GetInvalidFileNameChars()) >= 0 Then
                Return BadRequest(New With {.Error = "Nome file non valido."})
            End If
            Dim f = Path.Combine(_dir, file)
            If Not System.IO.File.Exists(f) Then Return NotFound(New With {.Error = "Copia non trovata."})
            _log.LogInformation("Copia di sicurezza riaperta: {File}", file)
            Return Content(System.IO.File.ReadAllText(f, Encoding.UTF8), "application/json", Encoding.UTF8)
        End Function

    End Class

End Namespace
