Imports System.Diagnostics
Imports System.IO
Imports System.Text.Json.Serialization
Imports Microsoft.AspNetCore.Builder
Imports Microsoft.AspNetCore.Http
Imports Microsoft.AspNetCore.Http.Features
Imports Microsoft.Extensions.DependencyInjection
Imports Microsoft.Extensions.Hosting
Imports Microsoft.Extensions.Logging

Public Module Program

    ''' <summary>Richieste più lente di così vengono segnalate nel log come possibili blocchi.</summary>
    Private Const SlowRequestMs As Long = 5000

    Public Sub Main(args As String())
        ' pacchetto distribuito: wwwroot e App_Data stanno accanto all'eseguibile, qualunque sia la cartella di avvio
        ' (con dotnet run l'interfaccia è servita dal progetto e la radice resta quella predefinita)
        Dim exeDir = AppContext.BaseDirectory
        Dim packaged = File.Exists(Path.Combine(exeDir, "wwwroot", "index.html"))
        Dim openBrowser = packaged AndAlso Not args.Contains("--no-browser")
        Dim version = AppVersion()

        Dim builder = WebApplication.CreateBuilder(New WebApplicationOptions With {
            .Args = args, .ContentRootPath = If(packaged, exeDir, Nothing)})
        Dim appUrl = BrowserUrl(builder.Configuration("Urls"))

        If packaged Then
            Try
                System.Console.OutputEncoding = Text.Encoding.UTF8
                System.Console.Title = $"CarveCAM {version} - chiudere questa finestra per uscire"
            Catch ex As Exception
                ' nessuna console (avvio come servizio o con output reindirizzato)
            End Try
            ' secondo doppio clic sull'eseguibile: CarveCAM è già in esecuzione, basta riaprire il browser
            If IsCarveCamRunning(appUrl) Then
                If openBrowser Then StartBrowser(appUrl)
                Return
            End If
        End If

        ' log su file (App_Data/logs): server e interfaccia scrivono nello stesso file
        Dim logDir = Path.Combine(builder.Environment.ContentRootPath, "App_Data", "logs")
        Dim fileLog As New Services.FileLoggerProvider(logDir)
        builder.Logging.AddProvider(fileLog)
        builder.Services.AddSingleton(fileLog)

        builder.Services.AddControllers().AddJsonOptions(
            Sub(o)
                o.JsonSerializerOptions.NumberHandling = JsonNumberHandling.AllowNamedFloatingPointLiterals Or JsonNumberHandling.AllowReadingFromString
                o.JsonSerializerOptions.DefaultIgnoreCondition = JsonIgnoreCondition.Never
            End Sub)
        builder.Services.Configure(Of FormOptions)(Sub(o) o.MultipartBodyLengthLimit = 2L * 1024 * 1024 * 1024)
        builder.Services.AddSingleton(Of Services.MeshStore)()
        builder.Services.AddSingleton(Of Services.ToolpathStore)()

        Dim app = builder.Build()
        Dim log = app.Services.GetRequiredService(Of ILoggerFactory)().CreateLogger("CarveCAM.Server.Http")
        Dim life = app.Services.GetRequiredService(Of ILoggerFactory)().CreateLogger("CarveCAM.Server.Avvio")

        ' registro di ogni richiesta API (esito e durata), delle richieste lente e degli errori non gestiti
        app.Use(Async Function(ctx As HttpContext, nxt As Func(Of Task)) As Task
                    Dim sw = Stopwatch.StartNew()
                    Dim reqPath = ctx.Request.Path.Value
                    Dim api = reqPath IsNot Nothing AndAlso reqPath.StartsWith("/api/", StringComparison.OrdinalIgnoreCase)
                    Dim quiet = reqPath IsNot Nothing AndAlso (reqPath.Equals("/api/log", StringComparison.OrdinalIgnoreCase) OrElse
                                                            reqPath.Equals("/api/mesh/formats", StringComparison.OrdinalIgnoreCase))
                    Dim failure As Exception = Nothing
                    Try
                        Await nxt()
                    Catch ex As Exception When Not ctx.RequestAborted.IsCancellationRequested
                        failure = ex
                    End Try
                    If failure IsNot Nothing Then
                        log.LogError(failure, "Errore non gestito in {Method} {Path} dopo {Ms} ms", ctx.Request.Method, reqPath, sw.ElapsedMilliseconds)
                        If Not ctx.Response.HasStarted Then
                            ctx.Response.Clear()
                            ctx.Response.StatusCode = 500
                            Await ctx.Response.WriteAsJsonAsync(New With {.Error = "Errore interno del server: " & failure.Message})
                        End If
                        Return
                    End If
                    Dim ms = sw.ElapsedMilliseconds
                    Dim status = ctx.Response.StatusCode
                    If ms > SlowRequestMs Then
                        log.LogWarning("Richiesta lenta: {Method} {Path} -> {Status} in {Ms} ms", ctx.Request.Method, reqPath, status, ms)
                    ElseIf status >= 500 Then
                        log.LogError("{Method} {Path} -> {Status} in {Ms} ms", ctx.Request.Method, reqPath, status, ms)
                    ElseIf api AndAlso Not quiet Then
                        log.LogInformation("{Method} {Path}{Query} -> {Status} in {Ms} ms", ctx.Request.Method, reqPath, ctx.Request.QueryString.Value, status, ms)
                    Else
                        log.LogDebug("{Method} {Path} -> {Status} in {Ms} ms", ctx.Request.Method, reqPath, status, ms)
                    End If
                End Function)

        app.UseDefaultFiles()
        ' no-cache: il browser rivalida sempre (ETag) e carica subito le versioni aggiornate dei moduli JS
        app.UseStaticFiles(New StaticFileOptions With {
            .OnPrepareResponse = Sub(ctx) ctx.Context.Response.Headers.CacheControl = "no-cache"})
        app.MapControllers()
        app.MapGet("/api/version", CType(Function() New With {.version = version}, Func(Of Object)))

        Dim lifetime = app.Services.GetRequiredService(Of IHostApplicationLifetime)()
        lifetime.ApplicationStarted.Register(
            Sub()
                life.LogInformation("CarveCAM {Version} avviato: {Urls} · .NET {Runtime} · {OS} · cartella {Root} · log in {LogDir}",
                                    version, String.Join(", ", app.Urls), Environment.Version, Runtime.InteropServices.RuntimeInformation.OSDescription,
                                    builder.Environment.ContentRootPath, logDir)
                If packaged Then System.Console.WriteLine($"{Environment.NewLine}CarveCAM è aperto nel browser: {appUrl}{Environment.NewLine}Per uscire chiudere questa finestra.{Environment.NewLine}")
                If openBrowser Then StartBrowser(appUrl)
            End Sub)
        lifetime.ApplicationStopping.Register(Sub() life.LogInformation("CarveCAM.Server in arresto"))
        AddHandler AppDomain.CurrentDomain.UnhandledException,
            Sub(s, e) life.LogCritical(TryCast(e.ExceptionObject, Exception), "Eccezione non gestita: il server si arresta")
        AddHandler TaskScheduler.UnobservedTaskException,
            Sub(s, e) life.LogError(e.Exception, "Eccezione non osservata in un task")

        Try
            app.Run()
        Catch ex As IOException When packaged
            ' tipicamente la porta è occupata da un altro programma: senza questa pausa la finestra si chiuderebbe subito
            life.LogCritical(ex, "Avvio non riuscito su {Url}", appUrl)
            System.Console.WriteLine($"{Environment.NewLine}Impossibile avviare CarveCAM su {appUrl}: {ex.Message}")
            System.Console.WriteLine("La porta può essere cambiata in appsettings.json (voce ""Urls""). Premere un tasto per chiudere.")
            Try
                System.Console.ReadKey(True)
            Catch
            End Try
        End Try
    End Sub

    ''' <summary>Versione del programma (da Directory.Build.props) con l'eventuale commit abbreviato.</summary>
    Private Function AppVersion() As String
        Dim info = GetType(Program).Assembly.GetCustomAttributes(GetType(Reflection.AssemblyInformationalVersionAttribute), False).
            OfType(Of Reflection.AssemblyInformationalVersionAttribute)().FirstOrDefault()?.InformationalVersion
        If String.IsNullOrEmpty(info) Then Return "?"
        Dim plus = info.IndexOf("+"c)
        Return If(plus >= 0 AndAlso info.Length > plus + 8, info.Substring(0, plus + 8), info)
    End Function

    ''' <summary>Indirizzo da aprire nel browser: il primo di "Urls", con localhost al posto degli indirizzi jolly.</summary>
    Private Function BrowserUrl(urls As String) As String
        Dim first = If(urls, "").Split(";"c, StringSplitOptions.RemoveEmptyEntries Or StringSplitOptions.TrimEntries).FirstOrDefault()
        If String.IsNullOrEmpty(first) Then Return "http://localhost:5000"
        Return first.Replace("://*", "://localhost").Replace("://+", "://localhost").Replace("://0.0.0.0", "://localhost").Replace("://[::]", "://localhost")
    End Function

    ''' <summary>True se all'indirizzo risponde già un CarveCAM (e non un altro programma sulla stessa porta).</summary>
    Private Function IsCarveCamRunning(url As String) As Boolean
        Try
            Using http As New Net.Http.HttpClient With {.Timeout = TimeSpan.FromSeconds(2)}
                Dim res = http.GetAsync(url.TrimEnd("/"c) & "/api/version").GetAwaiter().GetResult()
                Return res.IsSuccessStatusCode AndAlso res.Content.ReadAsStringAsync().GetAwaiter().GetResult().Contains("""version""")
            End Using
        Catch
            Return False
        End Try
    End Function

    Private Sub StartBrowser(url As String)
        Try
            Process.Start(New ProcessStartInfo(url) With {.UseShellExecute = True})
        Catch ex As Exception
            System.Console.WriteLine($"Aprire manualmente il browser su {url} ({ex.Message})")
        End Try
    End Sub

End Module
