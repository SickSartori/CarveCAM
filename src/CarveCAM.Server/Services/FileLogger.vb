Imports System.Collections.Concurrent
Imports System.IO
Imports System.Text
Imports System.Threading
Imports Microsoft.Extensions.Logging

Namespace Services

    ''' <summary>
    ''' Log su file per la diagnostica (App_Data/logs/carvecam-AAAAMMGG.log, un file al giorno, conservati
    ''' <see cref="KeepDays"/> giorni). Le righe vengono accodate e scritte da un thread dedicato, così il
    ''' logging non rallenta le richieste; ogni riga riporta ora, livello, thread, categoria e messaggio.
    ''' </summary>
    Public NotInheritable Class FileLoggerProvider
        Implements ILoggerProvider

        Public Const KeepDays As Integer = 14
        Private ReadOnly _queue As New BlockingCollection(Of String)(New ConcurrentQueue(Of String)(), 20000)
        Private ReadOnly _thread As Thread
        Private ReadOnly _minLevel As LogLevel
        Public ReadOnly Property Directory As String

        Public Sub New(dir As String, Optional minLevel As LogLevel = LogLevel.Debug)
            Me.Directory = dir
            _minLevel = minLevel
            IO.Directory.CreateDirectory(dir)
            Cleanup()
            _thread = New Thread(AddressOf Writer) With {.IsBackground = True, .Name = "CarveCAM log"}
            _thread.Start()
        End Sub

        Public Function CurrentFile() As String
            Return Path.Combine(Me.Directory, $"carvecam-{DateTime.Now:yyyyMMdd}.log")
        End Function

        Public Function CreateLogger(categoryName As String) As ILogger Implements ILoggerProvider.CreateLogger
            Return New FileLogger(Me, categoryName)
        End Function

        Friend ReadOnly Property MinLevel As LogLevel
            Get
                Return _minLevel
            End Get
        End Property

        Friend Sub Enqueue(line As String)
            ' coda piena (disco bloccato): si scarta la riga piuttosto che bloccare il server
            _queue.TryAdd(line)
        End Sub

        Private Sub Writer()
            Dim sb As New StringBuilder()
            For Each line In _queue.GetConsumingEnumerable()
                sb.Clear()
                sb.Append(line).Append(Environment.NewLine)
                ' raccoglie le righe già in coda per scriverle insieme
                Dim more As String = Nothing
                While sb.Length < 256 * 1024 AndAlso _queue.TryTake(more)
                    sb.Append(more).Append(Environment.NewLine)
                End While
                For attempt = 1 To 3
                    Try
                        File.AppendAllText(CurrentFile(), sb.ToString(), Encoding.UTF8)
                        Exit For
                    Catch ex As IOException
                        Thread.Sleep(50 * attempt)
                    Catch ex As UnauthorizedAccessException
                        Exit For
                    End Try
                Next
            Next
        End Sub

        Private Sub Cleanup()
            Try
                For Each f In IO.Directory.GetFiles(Me.Directory, "carvecam-*.log")
                    If File.GetLastWriteTime(f) < DateTime.Now.AddDays(-KeepDays) Then File.Delete(f)
                Next
            Catch ex As IOException
                ' pulizia non riuscita: non è un problema
            Catch ex As UnauthorizedAccessException
            End Try
        End Sub

        ''' <summary>Scrive una riga già formattata (usato per i messaggi che arrivano dal browser).</summary>
        Public Sub WriteRaw(level As LogLevel, category As String, message As String, Optional timestamp As DateTime? = Nothing)
            If level < _minLevel Then Return
            Enqueue(Format(If(timestamp, DateTime.Now), level, category, message, Nothing))
        End Sub

        Friend Shared Function Format(ts As DateTime, level As LogLevel, category As String, message As String, ex As Exception) As String
            Dim sb As New StringBuilder()
            sb.Append(ts.ToString("yyyy-MM-dd HH:mm:ss.fff")).Append(" [").Append(LevelTag(level)).Append("] ")
            sb.Append("[T").Append(Environment.CurrentManagedThreadId.ToString("00")).Append("] ")
            sb.Append(category).Append(": ").Append(message)
            If ex IsNot Nothing Then sb.Append(Environment.NewLine).Append("    ").Append(ex.ToString().Replace(Environment.NewLine, Environment.NewLine & "    "))
            Return sb.ToString()
        End Function

        Private Shared Function LevelTag(level As LogLevel) As String
            Select Case level
                Case LogLevel.Trace : Return "TRC"
                Case LogLevel.Debug : Return "DBG"
                Case LogLevel.Information : Return "INF"
                Case LogLevel.Warning : Return "WRN"
                Case LogLevel.Error : Return "ERR"
                Case LogLevel.Critical : Return "CRT"
                Case Else : Return "---"
            End Select
        End Function

        Public Sub Dispose() Implements IDisposable.Dispose
            _queue.CompleteAdding()
            _thread.Join(2000)
        End Sub
    End Class

    Friend NotInheritable Class FileLogger
        Implements ILogger

        Private ReadOnly _provider As FileLoggerProvider
        Private ReadOnly _category As String

        Public Sub New(provider As FileLoggerProvider, category As String)
            _provider = provider
            ' categorie brevi: "CarveCAM.Server.Controllers.CamController" -> "CamController"
            _category = If(category.StartsWith("CarveCAM.", StringComparison.Ordinal), category.Substring(category.LastIndexOf("."c) + 1), category)
        End Sub

        Public Function BeginScope(Of TState)(state As TState) As IDisposable Implements ILogger.BeginScope
            Return Nothing
        End Function

        Public Function IsEnabled(logLevel As LogLevel) As Boolean Implements ILogger.IsEnabled
            Return logLevel <> LogLevel.None AndAlso logLevel >= _provider.MinLevel
        End Function

        Public Sub Log(Of TState)(logLevel As LogLevel, eventId As EventId, state As TState, exception As Exception,
                                  formatter As Func(Of TState, Exception, String)) Implements ILogger.Log
            If Not IsEnabled(logLevel) Then Return
            Dim msg = formatter(state, exception)
            If String.IsNullOrEmpty(msg) AndAlso exception Is Nothing Then Return
            _provider.Enqueue(FileLoggerProvider.Format(DateTime.Now, logLevel, _category, msg, exception))
        End Sub
    End Class

End Namespace
