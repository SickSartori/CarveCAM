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
        Dim builder = WebApplication.CreateBuilder(args)

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

        Dim lifetime = app.Services.GetRequiredService(Of IHostApplicationLifetime)()
        lifetime.ApplicationStarted.Register(
            Sub()
                life.LogInformation("CarveCAM.Server avviato: {Urls} · .NET {Runtime} · {OS} · cartella {Root} · log in {LogDir}",
                                    String.Join(", ", app.Urls), Environment.Version, Runtime.InteropServices.RuntimeInformation.OSDescription,
                                    builder.Environment.ContentRootPath, logDir)
            End Sub)
        lifetime.ApplicationStopping.Register(Sub() life.LogInformation("CarveCAM.Server in arresto"))
        AddHandler AppDomain.CurrentDomain.UnhandledException,
            Sub(s, e) life.LogCritical(TryCast(e.ExceptionObject, Exception), "Eccezione non gestita: il server si arresta")
        AddHandler TaskScheduler.UnobservedTaskException,
            Sub(s, e) life.LogError(e.Exception, "Eccezione non osservata in un task")

        app.Run()
    End Sub

End Module
