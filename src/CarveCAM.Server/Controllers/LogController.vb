Imports System.IO
Imports System.Text
Imports System.Text.Json
Imports System.Text.RegularExpressions
Imports Microsoft.AspNetCore.Mvc
Imports Microsoft.Extensions.Logging
Imports CarveCAM.Server.Services

Namespace Controllers

    ''' <summary>Messaggio di diagnostica inviato dal browser.</summary>
    Public Class ClientLogEntry
        ''' <summary>Ora del browser (ISO 8601).</summary>
        Public Property T As String
        ''' <summary>Livello: debug, info, warn, error.</summary>
        Public Property L As String
        ''' <summary>Sessione (scheda) del browser.</summary>
        Public Property S As String
        Public Property M As String
        ''' <summary>Dati aggiuntivi (JSON libero).</summary>
        Public Property D As JsonElement?
    End Class

    ''' <summary>
    ''' File di log: riceve i messaggi dell'interfaccia (scritti nello stesso file del server, categoria
    ''' "Client") e permette di consultare e scaricare i file.
    ''' </summary>
    <ApiController>
    <Route("api/log")>
    Public Class LogController
        Inherits ControllerBase

        Private Const MaxEntries As Integer = 500
        Private Const MaxText As Integer = 6000
        Private Shared ReadOnly FileRx As New Regex("^carvecam-\d{8}\.log$", RegexOptions.Compiled)
        Private ReadOnly _files As FileLoggerProvider

        Public Sub New(files As FileLoggerProvider)
            _files = files
        End Sub

        <HttpPost("")>
        <RequestSizeLimit(4 * 1024 * 1024)>
        Public Function Post(<FromBody> entries As List(Of ClientLogEntry)) As IActionResult
            If entries Is Nothing Then Return NoContent()
            For Each e In entries.Take(MaxEntries)
                If e Is Nothing Then Continue For
                Dim level As LogLevel
                Select Case If(e.L, "").ToLowerInvariant()
                    Case "error" : level = LogLevel.Error
                    Case "warn" : level = LogLevel.Warning
                    Case "debug" : level = LogLevel.Debug
                    Case Else : level = LogLevel.Information
                End Select
                Dim sb As New StringBuilder()
                sb.Append("[").Append(If(e.S, "?")).Append("] ").Append(If(e.M, ""))
                If e.D.HasValue AndAlso e.D.Value.ValueKind <> JsonValueKind.Null AndAlso e.D.Value.ValueKind <> JsonValueKind.Undefined Then
                    sb.Append(" | ").Append(e.D.Value.GetRawText())
                End If
                Dim text = sb.ToString().Replace(vbCr, " ").Replace(vbLf, " ⏎ ")
                If text.Length > MaxText Then text = text.Substring(0, MaxText) & "…"
                Dim ts As DateTimeOffset
                Dim local As DateTime? = Nothing
                If DateTimeOffset.TryParse(e.T, Globalization.CultureInfo.InvariantCulture, Globalization.DateTimeStyles.None, ts) Then local = ts.LocalDateTime
                _files.WriteRaw(level, "Client", text, local)
            Next
            Return NoContent()
        End Function

        ''' <summary>Cartella e file di log disponibili (dal più recente).</summary>
        <HttpGet("")>
        Public Function Info() As IActionResult
            Dim files = Directory.GetFiles(_files.Directory, "carvecam-*.log").
                Select(Function(f) New FileInfo(f)).
                OrderByDescending(Function(f) f.Name, StringComparer.Ordinal).
                Select(Function(f) New With {.Name = f.Name, .Size = f.Length, .Modified = f.LastWriteTime}).ToList()
            Return Ok(New With {.Dir = _files.Directory, .Files = files})
        End Function

        ''' <summary>Ultime righe di un file (tail) oppure il file intero da scaricare (download=1).</summary>
        <HttpGet("{file}")>
        Public Function GetFile(file As String, <FromQuery> tail As Integer?, <FromQuery> download As Integer?) As IActionResult
            If file Is Nothing OrElse Not FileRx.IsMatch(file) Then Return BadRequest(New With {.Error = "Nome file non valido."})
            Dim f = Path.Combine(_files.Directory, file)
            If Not System.IO.File.Exists(f) Then Return NotFound(New With {.Error = "File di log non trovato."})
            Dim bytes As Byte()
            Using fs As New FileStream(f, FileMode.Open, FileAccess.Read, FileShare.ReadWrite Or FileShare.Delete), ms As New MemoryStream()
                fs.CopyTo(ms)
                bytes = ms.ToArray()
            End Using
            If download.GetValueOrDefault() = 1 Then Return Me.File(bytes, "text/plain; charset=utf-8", file)
            Dim n = Math.Max(1, Math.Min(5000, tail.GetValueOrDefault(400)))
            Dim lines = Encoding.UTF8.GetString(bytes).Split(ControlChars.Lf)
            Dim start = Math.Max(0, lines.Length - n - 1)
            Return Content(String.Join(ControlChars.Lf, lines.Skip(start)).TrimEnd(), "text/plain", Encoding.UTF8)
        End Function

    End Class

End Namespace
