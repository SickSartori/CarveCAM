Imports System.IO
Imports System.Runtime.InteropServices
Imports System.Text
Imports System.Text.Json
Imports Microsoft.AspNetCore.Hosting
Imports Microsoft.AspNetCore.Mvc
Imports Microsoft.Extensions.Configuration
Imports Microsoft.Extensions.Logging
Imports CarveCAM.Core.Meshes
Imports CarveCAM.Server.Services

Namespace Controllers

    ''' <summary>
    ''' "Blackbox": archivio protetto da password con tutto ciò che serve a riprodurre un problema segnalato:
    ''' progetto corrente (anche non salvato) con le mesh, richieste di calcolo delle lavorazioni, stato
    ''' dell'interfaccia, magazzino utensili e setup, file di log recenti e informazioni sull'ambiente.
    ''' La password si imposta in appsettings (Blackbox:Password).
    ''' </summary>
    <ApiController>
    <Route("api/blackbox")>
    Public Class BlackboxController
        Inherits ControllerBase

        Private ReadOnly _meshes As MeshStore
        Private ReadOnly _files As FileLoggerProvider
        Private ReadOnly _env As IWebHostEnvironment
        Private ReadOnly _cfg As IConfiguration
        Private ReadOnly _log As ILogger(Of BlackboxController)

        Public Sub New(meshes As MeshStore, files As FileLoggerProvider, env As IWebHostEnvironment, cfg As IConfiguration, log As ILogger(Of BlackboxController))
            _meshes = meshes
            _files = files
            _env = env
            _cfg = cfg
            _log = log
        End Sub

        Private Shared ReadOnly Pretty As New JsonSerializerOptions With {.WriteIndented = True}

        Private Shared Function Indent(el As JsonElement) As String
            Return JsonSerializer.Serialize(el, Pretty)
        End Function

        <HttpPost("")>
        <DisableRequestSizeLimit>
        Public Async Function Export() As Task(Of IActionResult)
            Dim json As String
            Using sr As New StreamReader(Request.Body, Encoding.UTF8)
                json = Await sr.ReadToEndAsync()
            End Using
            Dim zip As New EncryptedZipWriter(If(_cfg("Blackbox:Password"), "1234"))
            Dim desc = "", includeMeshes = True, logDays = 2
            Dim meshIds As New List(Of String)()
            Dim projectRaw As String = Nothing
            Dim parts As New List(Of String)()
            Try
                Using doc = JsonDocument.Parse(json)
                    Dim root = doc.RootElement
                    Dim el As JsonElement
                    If root.TryGetProperty("description", el) AndAlso el.ValueKind = JsonValueKind.String Then desc = el.GetString()
                    If root.TryGetProperty("includeMeshes", el) AndAlso (el.ValueKind = JsonValueKind.False) Then includeMeshes = False
                    If root.TryGetProperty("logDays", el) AndAlso el.ValueKind = JsonValueKind.Number Then logDays = Math.Max(1, Math.Min(14, el.GetInt32()))
                    If root.TryGetProperty("project", el) AndAlso el.ValueKind = JsonValueKind.Object Then
                        projectRaw = el.GetRawText()
                        zip.Add("progetto/project.json", Indent(el))
                        parts.Add("progetto/project.json")
                        Dim objs As JsonElement
                        If el.TryGetProperty("objects", objs) AndAlso objs.ValueKind = JsonValueKind.Array Then
                            For Each o In objs.EnumerateArray()
                                Dim mid As JsonElement
                                If o.TryGetProperty("meshId", mid) AndAlso mid.ValueKind = JsonValueKind.String AndAlso MeshStore.IsValidId(mid.GetString()) Then meshIds.Add(mid.GetString())
                            Next
                        End If
                    End If
                    If root.TryGetProperty("requests", el) AndAlso el.ValueKind = JsonValueKind.Array Then
                        Dim i = 0
                        For Each r In el.EnumerateArray()
                            i += 1
                            zip.Add($"calcolo/richiesta-{i:00}.json", Indent(r))
                        Next
                        If i > 0 Then parts.Add($"calcolo/ ({i} richieste)")
                    End If
                    For Each key In {"client", "settings", "library", "toolpaths", "history"}
                        If root.TryGetProperty(key, el) AndAlso el.ValueKind <> JsonValueKind.Null Then
                            zip.Add($"interfaccia/{key}.json", Indent(el))
                            parts.Add($"interfaccia/{key}.json")
                        End If
                    Next
                End Using
            Catch ex As JsonException
                _log.LogWarning("Blackbox: dati non validi ({Message})", ex.Message)
                Return BadRequest(New With {.Error = "Dati della blackbox non validi."})
            End Try

            ' copia del progetto apribile direttamente con File › Apri (archivio .ccam con project.json e mesh)
            If projectRaw IsNot Nothing Then
                Dim n = 0
                Using ms As New MemoryStream()
                    Using cc As New System.IO.Compression.ZipArchive(ms, System.IO.Compression.ZipArchiveMode.Create, True)
                        Using w As New StreamWriter(cc.CreateEntry("project.json").Open(), New UTF8Encoding(False))
                            w.Write(projectRaw)
                        End Using
                        If includeMeshes Then
                            For Each id In meshIds.Distinct()
                                Dim pos = _meshes.TryGet(id)
                                If pos Is Nothing Then Continue For
                                Dim mb = MeshData.ToBytes(pos)
                                Using st = cc.CreateEntry("meshes/" & id & ".bin", System.IO.Compression.CompressionLevel.Fastest).Open()
                                    st.Write(mb, 0, mb.Length)
                                End Using
                                Dim faces = _meshes.TryGetFaces(id)
                                If faces IsNot Nothing Then
                                    Dim fb = MeshStore.FacesToBytes(faces)
                                    Using st = cc.CreateEntry("meshes/" & id & ".faces", System.IO.Compression.CompressionLevel.Fastest).Open()
                                        st.Write(fb, 0, fb.Length)
                                    End Using
                                End If
                                n += 1
                            Next
                        End If
                    End Using
                    zip.Add("progetto/progetto.ccam", ms.ToArray())
                End Using
                parts.Add($"progetto/progetto.ccam (apribile con File › Apri, {n} mesh)")
            End If

            ' archivi del magazzino sul server
            Dim libDir = Path.Combine(_env.ContentRootPath, "App_Data", "library")
            If Directory.Exists(libDir) Then
                For Each f In Directory.GetFiles(libDir, "*.json")
                    zip.Add($"magazzino/{Path.GetFileName(f)}", ReadShared(f))
                Next
            End If

            ' log recenti (il file del giorno è ancora aperto in scrittura)
            Dim since = DateTime.Today.AddDays(-(logDays - 1))
            For Each f In Directory.GetFiles(_files.Directory, "carvecam-*.log")
                Dim fi As New FileInfo(f)
                If fi.LastWriteTime < since Then Continue For
                zip.Add($"log/{fi.Name}", ReadShared(f))
                parts.Add($"log/{fi.Name}")
            Next

            Dim asm = GetType(BlackboxController).Assembly.GetName()
            Dim info As New StringBuilder()
            info.AppendLine("CARVECAM - BLACKBOX DI DIAGNOSTICA")
            info.AppendLine($"Creata il: {DateTime.Now:yyyy-MM-dd HH:mm:ss} (UTC{DateTimeOffset.Now:zzz})")
            info.AppendLine($"Versione server: {asm.Version}")
            info.AppendLine($"Sistema: {RuntimeInformation.OSDescription} ({RuntimeInformation.OSArchitecture})")
            info.AppendLine($".NET: {RuntimeInformation.FrameworkDescription}")
            info.AppendLine($"Computer: {Environment.MachineName} · processori: {Environment.ProcessorCount}")
            info.AppendLine($"Cartella: {_env.ContentRootPath}")
            info.AppendLine()
            info.AppendLine("DESCRIZIONE DEL PROBLEMA")
            info.AppendLine(If(String.IsNullOrWhiteSpace(desc), "(nessuna descrizione)", desc.Trim()))
            info.AppendLine()
            info.AppendLine("CONTENUTO")
            For Each p In parts
                info.AppendLine("- " & p)
            Next
            info.AppendLine("- magazzino/ (utensili e setup del server)")
            info.AppendLine()
            info.AppendLine("PER RIPRODURRE")
            info.AppendLine("1. Aprire progetto/progetto.ccam con File > Apri progetto (contiene anche le mesh).")
            info.AppendLine("2. Le richieste in calcolo/ sono quelle inviate a POST /api/cam/compute per ogni lavorazione.")
            info.AppendLine("3. Lo stato dell'interfaccia (selezione, vista, modalità, opzioni, ultime azioni) è in interfaccia/.")
            zip.Add("LEGGIMI.txt", info.ToString())

            Dim bytes = zip.ToArray()
            _log.LogInformation("Blackbox esportata: {Size} byte, {Meshes} mesh, descrizione {Len} caratteri", bytes.Length, meshIds.Count, desc.Length)
            Return File(bytes, "application/zip", $"carvecam-blackbox-{DateTime.Now:yyyyMMdd-HHmm}.zip")
        End Function

        Private Shared Function ReadShared(path As String) As Byte()
            Using fs As New FileStream(path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite Or FileShare.Delete), ms As New MemoryStream()
                fs.CopyTo(ms)
                Return ms.ToArray()
            End Using
        End Function

    End Class

End Namespace
