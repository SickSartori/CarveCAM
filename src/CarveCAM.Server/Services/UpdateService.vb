Imports System.IO
Imports System.Net.Http
Imports System.Security.Cryptography
Imports System.Text.Json
Imports System.Threading
Imports CarveCAM.Core.Update
Imports Microsoft.Extensions.Configuration
Imports Microsoft.Extensions.Hosting
Imports Microsoft.Extensions.Logging

Namespace Services

    ''' <summary>Stato dell'aggiornamento mostrato dall'interfaccia.</summary>
    Public Class UpdateStatus
        ''' <summary>False con dotnet run o dove non c'è un pacchetto (solo Windows x64 e arm64).</summary>
        Public Property Supported As Boolean
        ''' <summary>False se Update:Enabled è spento in appsettings.json.</summary>
        Public Property Enabled As Boolean
        ''' <summary>Si può scaricare e installare da qui (cartella scrivibile, pacchetto con SHA256 di GitHub).</summary>
        Public Property CanInstall As Boolean
        Public Property Current As String
        Public Property Latest As String
        Public Property Available As Boolean
        ''' <summary>idle, checking, downloading, ready o error.</summary>
        Public Property State As String
        Public Property Downloaded As Long
        Public Property Total As Long
        Public Property Notes As String
        Public Property PageUrl As String
        Public Property LastError As String
        Public Property CheckedAt As DateTime?
    End Class

    ''' <summary>
    ''' Aggiornamenti automatici dalle release di GitHub: cerca la versione nuova, scarica il pacchetto in background e lo
    ''' verifica con l'SHA256 dichiarato da GitHub, poi lo prepara in App_Data/updates/staged. Lo installa il processo che
    ''' parte dopo (vedi Program): così nessun file è in uso e il lavoro in corso non viene interrotto.
    ''' </summary>
    Public Class UpdateService

        Private Const PageBase As String = "https://github.com/SickSartori/CarveCAM/releases/tag/"
        Private ReadOnly _log As ILogger
        Private ReadOnly _life As IHostApplicationLifetime
        Private ReadOnly _http As HttpClient
        Private ReadOnly _installDir As String
        Private ReadOnly _apiUrl As String
        Private ReadOnly _current As String
        Private ReadOnly _suffix As String
        Private ReadOnly _supported As Boolean
        Private ReadOnly _enabled As Boolean
        Private ReadOnly _writable As Boolean
        Private ReadOnly _lock As New Object()

        Private _state As String = "idle"
        Private _tag As String
        Private _notes As String
        Private _asset As ReleaseAsset
        Private _available As Boolean
        Private _downloaded As Long
        Private _lastError As String
        Private _checkedAt As DateTime?

        Public Sub New(cfg As IConfiguration, loggerFactory As ILoggerFactory, life As IHostApplicationLifetime)
            _log = loggerFactory.CreateLogger("CarveCAM.Server.Aggiornamenti")
            _life = life
            _installDir = AppContext.BaseDirectory.TrimEnd(Path.DirectorySeparatorChar)
            _current = Program.AppVersion()
            _suffix = UpdateLogic.RuntimeSuffix()
            _supported = File.Exists(Path.Combine(_installDir, "wwwroot", "index.html")) AndAlso _suffix IsNot Nothing
            _enabled = cfg.GetValue(Of Boolean)("Update:Enabled", True)
            _apiUrl = UpdateLogic.ResolveApiUrl(cfg("Update:ApiUrl"))
            _writable = _supported AndAlso UpdateLogic.IsWritable(_installDir)
            _http = New HttpClient With {.Timeout = Timeout.InfiniteTimeSpan}
            ' GitHub rifiuta le richieste senza User-Agent
            _http.DefaultRequestHeaders.UserAgent.ParseAdd("CarveCAM/" & _current.Split("+"c)(0))
            If _supported AndAlso _enabled AndAlso Not _writable Then
                _log.LogWarning("La cartella {Dir} non è scrivibile: gli aggiornamenti vanno installati a mano", _installDir)
            End If
        End Sub

        Private ReadOnly Property Active As Boolean
            Get
                Return _supported AndAlso _enabled
            End Get
        End Property

        Public Function Status() As UpdateStatus
            SyncLock _lock
                Dim ok = _asset IsNot Nothing AndAlso Not String.IsNullOrEmpty(_asset.Sha256)
                Return New UpdateStatus With {
                    .Supported = _supported, .Enabled = _enabled, .Current = _current.Split("+"c)(0), .Latest = _tag?.TrimStart("v"c),
                    .Available = _available, .State = _state, .Downloaded = _downloaded, .Total = If(_asset?.Size, 0L),
                    .Notes = _notes, .PageUrl = If(UpdateLogic.IsReleaseTag(_tag), PageBase & _tag, Nothing),
                    .CanInstall = Active AndAlso _writable AndAlso _available AndAlso ok,
                    .LastError = _lastError, .CheckedAt = _checkedAt}
            End SyncLock
        End Function

        ''' <summary>Legge l'ultima release di GitHub (al massimo una volta all'ora, salvo force).</summary>
        Public Async Function CheckAsync(force As Boolean, ct As CancellationToken) As Task(Of UpdateStatus)
            If Not Active Then Return Status()
            SyncLock _lock
                If _state = "checking" OrElse _state = "downloading" OrElse _state = "ready" Then Return Status()
                If Not force AndAlso _checkedAt.HasValue AndAlso _state = "idle" AndAlso DateTime.UtcNow - _checkedAt.Value < TimeSpan.FromHours(1) Then Return Status()
                _state = "checking"
                _lastError = Nothing
            End SyncLock
            Try
                Using cts = CancellationTokenSource.CreateLinkedTokenSource(ct)
                    cts.CancelAfter(TimeSpan.FromSeconds(20))
                    Using req As New HttpRequestMessage(HttpMethod.Get, _apiUrl)
                        req.Headers.Accept.ParseAdd("application/vnd.github+json")
                        Using res = Await _http.SendAsync(req, cts.Token)
                            res.EnsureSuccessStatusCode()
                            Using doc = JsonDocument.Parse(Await res.Content.ReadAsStringAsync(cts.Token))
                                ReadRelease(doc.RootElement)
                            End Using
                        End Using
                    End Using
                End Using
                SyncLock _lock
                    _state = "idle"
                    _checkedAt = DateTime.UtcNow
                End SyncLock
                _log.LogInformation("Controllo aggiornamenti: ultima versione {Tag}, in uso {Current}, aggiornamento disponibile: {Available}", _tag, _current, _available)
            Catch ex As Exception When Not ct.IsCancellationRequested
                SyncLock _lock
                    _state = "error"
                    _lastError = ex.Message
                End SyncLock
                _log.LogWarning("Controllo aggiornamenti non riuscito: {Msg}", ex.Message)
            End Try
            Return Status()
        End Function

        Private Sub ReadRelease(root As JsonElement)
            Dim tag = Str(root, "tag_name")
            Dim notes = Str(root, "body")
            If notes IsNot Nothing AndAlso notes.Length > 4000 Then notes = notes.Substring(0, 4000)
            Dim assets As New List(Of ReleaseAsset)
            Dim arr As JsonElement
            If root.TryGetProperty("assets", arr) AndAlso arr.ValueKind = JsonValueKind.Array Then
                For Each a In arr.EnumerateArray()
                    assets.Add(New ReleaseAsset With {
                        .Name = Str(a, "name"), .Url = Str(a, "browser_download_url"),
                        .Size = Num(a, "size"), .Sha256 = UpdateLogic.ParseDigest(Str(a, "digest"))})
                Next
            End If
            SyncLock _lock
                _tag = If(UpdateLogic.IsReleaseTag(tag), tag, Nothing)
                _notes = notes
                _asset = If(_tag Is Nothing, Nothing, UpdateLogic.PickAsset(assets, _suffix, _tag))
                _available = _tag IsNot Nothing AndAlso UpdateLogic.IsNewer(_tag, _current)
            End SyncLock
        End Sub

        Private Shared Function Str(e As JsonElement, name As String) As String
            Dim v As JsonElement
            Return If(e.TryGetProperty(name, v) AndAlso v.ValueKind = JsonValueKind.String, v.GetString(), Nothing)
        End Function

        Private Shared Function Num(e As JsonElement, name As String) As Long
            Dim v As JsonElement
            Return If(e.TryGetProperty(name, v) AndAlso v.ValueKind = JsonValueKind.Number, v.GetInt64(), 0L)
        End Function

        ''' <summary>Avvia il download in background (se c'è una versione nuova installabile) e torna subito.</summary>
        Public Function StartDownload() As UpdateStatus
            Dim asset As ReleaseAsset
            Dim tag As String
            SyncLock _lock
                Dim s = Status()
                If _state <> "idle" OrElse Not s.CanInstall Then Return s
                _state = "downloading"
                _downloaded = 0
                _lastError = Nothing
                asset = _asset
                tag = _tag
            End SyncLock
            Dim ignored = DownloadAsync(asset, tag)   ' in background: gli errori li gestisce il metodo stesso
            Return Status()
        End Function

        Private Async Function DownloadAsync(asset As ReleaseAsset, tag As String) As Task
            Dim updDir = UpdateLogic.UpdatesDir(_installDir)
            Dim part = Path.Combine(updDir, asset.Name & ".part")
            Dim extractDir = Path.Combine(updDir, "extract")
            Try
                If Not UpdateLogic.IsAllowedDownloadUrl(asset.Url, _apiUrl) Then Throw New InvalidOperationException("Indirizzo di download non consentito")
                Directory.CreateDirectory(updDir)
                _log.LogInformation("Scarico {Name} ({Mb:0.0} MB)", asset.Name, asset.Size / 1048576.0)
                Dim ct = _life.ApplicationStopping
                Dim hash As String
                Using res = Await _http.GetAsync(asset.Url, HttpCompletionOption.ResponseHeadersRead, ct)
                    res.EnsureSuccessStatusCode()
                    Dim len = res.Content.Headers.ContentLength
                    If (len.HasValue AndAlso len.Value > UpdateLogic.MaxPackageBytes) OrElse asset.Size > UpdateLogic.MaxPackageBytes Then
                        Throw New InvalidDataException("Il pacchetto è troppo grande")
                    End If
                    Using inp = Await res.Content.ReadAsStreamAsync(ct), outp As New FileStream(part, FileMode.Create, FileAccess.Write, FileShare.None)
                        Using sha = IncrementalHash.CreateHash(HashAlgorithmName.SHA256)
                            Dim buf(81919) As Byte
                            Do
                                Dim n = Await inp.ReadAsync(buf.AsMemory(), ct)
                                If n = 0 Then Exit Do
                                sha.AppendData(buf, 0, n)
                                Await outp.WriteAsync(buf.AsMemory(0, n), ct)
                                SyncLock _lock
                                    _downloaded += n
                                    If _downloaded > UpdateLogic.MaxPackageBytes Then Throw New InvalidDataException("Il pacchetto è troppo grande")
                                End SyncLock
                            Loop
                            hash = Convert.ToHexString(sha.GetHashAndReset()).ToLowerInvariant()
                        End Using
                    End Using
                End Using
                If hash <> asset.Sha256 Then Throw New InvalidDataException("Il pacchetto scaricato non corrisponde all'SHA256 pubblicato su GitHub")
                If asset.Size > 0 AndAlso _downloaded <> asset.Size Then Throw New InvalidDataException("Il pacchetto scaricato è incompleto")

                ' scompattato in una cartella di lavoro, poi spostato tra le versioni pronte: all'avvio si installa solo ciò che è completo
                If Directory.Exists(extractDir) Then Directory.Delete(extractDir, True)
                UpdateLogic.ExtractPackage(part, extractDir)
                UpdateLogic.DiscardStaged(_installDir)
                Directory.CreateDirectory(UpdateLogic.StagedRoot(_installDir))
                Directory.Move(extractDir, Path.Combine(UpdateLogic.StagedRoot(_installDir), tag.TrimStart("v"c)))
                File.Delete(part)
                SyncLock _lock
                    _state = "ready"
                End SyncLock
                _log.LogInformation("Aggiornamento {Tag} scaricato e verificato: si installa al prossimo avvio", tag)
            Catch ex As Exception
                SyncLock _lock
                    _state = "error"
                    _lastError = If(_life.ApplicationStopping.IsCancellationRequested, "Interrotto", ex.Message)
                End SyncLock
                _log.LogWarning("Scaricamento dell'aggiornamento non riuscito: {Msg}", ex.Message)
                Try
                    If File.Exists(part) Then File.Delete(part)
                    If Directory.Exists(extractDir) Then Directory.Delete(extractDir, True)
                Catch
                End Try
            End Try
        End Function

        ''' <summary>
        ''' Riavvia il programma perché installi subito l'aggiornamento pronto: il nuovo processo aspetta l'uscita di questo,
        ''' installa e riparte (senza aprire un'altra scheda del browser). False se non c'è nulla di pronto.
        ''' </summary>
        Public Function RequestRestart() As Boolean
            SyncLock _lock
                If _state <> "ready" Then Return False
            End SyncLock
            Dim ignored = Task.Run(Async Function()
                         Await Task.Delay(400)   ' il tempo di rispondere al browser
                         Try
                             Dim exe = Environment.ProcessPath
                             Dim args = UpdateLogic.RelaunchArgs(Environment.GetCommandLineArgs().Skip(1), Environment.ProcessId, Nothing, True)
                             Diagnostics.Process.Start(New Diagnostics.ProcessStartInfo(exe, args) With {.UseShellExecute = False, .WorkingDirectory = _installDir})
                             _log.LogInformation("Riavvio per installare l'aggiornamento")
                             _life.StopApplication()
                         Catch ex As Exception
                             _log.LogError(ex, "Riavvio non riuscito")
                         End Try
                     End Function)
            Return True
        End Function

    End Class

End Namespace
