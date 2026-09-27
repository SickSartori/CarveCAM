Imports System.Text.Json.Serialization
Imports Microsoft.AspNetCore.Builder
Imports Microsoft.AspNetCore.Http.Features
Imports Microsoft.Extensions.DependencyInjection
Imports Microsoft.Extensions.Hosting

Public Module Program

    Public Sub Main(args As String())
        Dim builder = WebApplication.CreateBuilder(args)

        builder.Services.AddControllers().AddJsonOptions(
            Sub(o)
                o.JsonSerializerOptions.NumberHandling = JsonNumberHandling.AllowNamedFloatingPointLiterals Or JsonNumberHandling.AllowReadingFromString
                o.JsonSerializerOptions.DefaultIgnoreCondition = JsonIgnoreCondition.Never
            End Sub)
        builder.Services.Configure(Of FormOptions)(Sub(o) o.MultipartBodyLengthLimit = 2L * 1024 * 1024 * 1024)
        builder.Services.AddSingleton(Of Services.MeshStore)()
        builder.Services.AddSingleton(Of Services.ToolpathStore)()

        Dim app = builder.Build()
        app.UseDefaultFiles()
        ' no-cache: il browser rivalida sempre (ETag) e carica subito le versioni aggiornate dei moduli JS
        app.UseStaticFiles(New StaticFileOptions With {
            .OnPrepareResponse = Sub(ctx) ctx.Context.Response.Headers.CacheControl = "no-cache"})
        app.MapControllers()
        app.Run()
    End Sub

End Module
