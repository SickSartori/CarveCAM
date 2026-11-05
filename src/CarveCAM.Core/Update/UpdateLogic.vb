Imports System.IO
Imports System.IO.Compression
Imports System.Runtime.InteropServices
Imports System.Text.RegularExpressions

Namespace Update

    ''' <summary>Pacchetto Windows di una release di GitHub.</summary>
    Public Class ReleaseAsset
        Public Property Name As String
        Public Property Url As String
        Public Property Size As Long
        ''' <summary>SHA256 dichiarato da GitHub, esadecimale minuscolo (vuoto se manca o non è valido).</summary>
        Public Property Sha256 As String
    End Class

    ''' <summary>
    ''' Logica dell'aggiornamento automatico, senza rete né processi: confronto delle versioni, scelta e controllo del
    ''' pacchetto, estrazione sicura e sostituzione dei file con ritorno allo stato precedente se qualcosa va storto.
    ''' </summary>
    Public Module UpdateLogic

        ''' <summary>I pacchetti si scaricano solo da qui (GitHub poi li serve da un altro host: l'integrità la garantisce l'SHA256).</summary>
        Public Const DownloadPrefix As String = "https://github.com/SickSartori/CarveCAM/releases/download/"
        Public Const DefaultApiUrl As String = "https://api.github.com/repos/SickSartori/CarveCAM/releases/latest"
        Public Const MaxPackageBytes As Long = 400L * 1024 * 1024
        Public Const MaxExtractedBytes As Long = 1024L * 1024 * 1024
        Private ReadOnly RequiredFiles As String() = {"CarveCAM.exe", "wwwroot/index.html"}
        ''' <summary>Voci del pacchetto che l'aggiornamento non sostituisce: i dati e le impostazioni dell'utente.</summary>
        Private ReadOnly KeptNames As String() = {"App_Data", "appsettings.json"}
        Private ReadOnly TagRx As New Regex("^v?\d+\.\d+\.\d+$", RegexOptions.Compiled)
        Private ReadOnly DigestRx As New Regex("^sha256:([0-9a-fA-F]{64})$", RegexOptions.Compiled)

        ' ---------------------------------------------------------------- versioni e pacchetto

        ''' <summary>Versione da un tag ("v0.4.1") o dalla versione del programma ("0.4.0+78da241"); Nothing se non valida.</summary>
        Public Function ParseVersion(text As String) As Version
            If String.IsNullOrWhiteSpace(text) Then Return Nothing
            Dim s = text.Trim()
            If s.StartsWith("v", StringComparison.OrdinalIgnoreCase) Then s = s.Substring(1)
            Dim cut = s.IndexOfAny({"+"c, "-"c})
            If cut >= 0 Then s = s.Substring(0, cut)
            Dim parts = s.Split("."c)
            If parts.Length < 2 OrElse parts.Length > 4 Then Return Nothing
            Dim v As Version = Nothing
            Return If(Version.TryParse(s, v), v, Nothing)
        End Function

        Public Function IsNewer(latest As String, current As String) As Boolean
            Dim a = ParseVersion(latest)
            Dim b = ParseVersion(current)
            Return a IsNot Nothing AndAlso b IsNot Nothing AndAlso a > b
        End Function

        ''' <summary>True se il tag è del tipo vX.Y.Z (solo questi si usano per nomi di cartelle e per i collegamenti).</summary>
        Public Function IsReleaseTag(tag As String) As Boolean
            Return tag IsNot Nothing AndAlso TagRx.IsMatch(tag)
        End Function

        ''' <summary>SHA256 minuscolo da "sha256:…" come lo scrive GitHub; Nothing se manca o non è nel formato atteso.</summary>
        Public Function ParseDigest(digest As String) As String
            If digest Is Nothing Then Return Nothing
            Dim m = DigestRx.Match(digest.Trim())
            Return If(m.Success, m.Groups(1).Value.ToLowerInvariant(), Nothing)
        End Function

        ''' <summary>Parte del nome del pacchetto che dipende dal sistema ("win-x64", "win-arm64"); Nothing dove non c'è un pacchetto.</summary>
        Public Function RuntimeSuffix() As String
            If Not OperatingSystem.IsWindows() Then Return Nothing
            Select Case RuntimeInformation.ProcessArchitecture
                Case Architecture.X64 : Return "win-x64"
                Case Architecture.Arm64 : Return "win-arm64"
            End Select
            Return Nothing
        End Function

        ''' <summary>
        ''' Il pacchetto CarveCAM-X.Y.Z-&lt;sistema&gt;.zip tra gli allegati di una release. Con il tag (v0.4.2) deve essere proprio
        ''' quella versione: un allegato di un'altra farebbe riscaricare l'aggiornamento a ogni avvio.
        ''' </summary>
        Public Function PickAsset(assets As IEnumerable(Of ReleaseAsset), suffix As String, Optional tag As String = Nothing) As ReleaseAsset
            If assets Is Nothing OrElse suffix Is Nothing Then Return Nothing
            Dim ver = If(tag Is Nothing, "\d+\.\d+\.\d+", Regex.Escape(tag.TrimStart("v"c)))
            Dim rx As New Regex("^CarveCAM-" & ver & "-" & Regex.Escape(suffix) & "\.zip$")
            Return assets.FirstOrDefault(Function(a) a.Name IsNot Nothing AndAlso rx.IsMatch(a.Name))
        End Function

        ''' <summary>Indirizzo da cui leggere l'ultima release: quello di GitHub, salvo un indirizzo locale scritto in appsettings (prove).</summary>
        Public Function ResolveApiUrl(configured As String) As String
            Dim u As Uri = Nothing
            If Not String.IsNullOrWhiteSpace(configured) AndAlso Uri.TryCreate(configured, UriKind.Absolute, u) AndAlso u.IsLoopback Then Return configured
            Return DefaultApiUrl
        End Function

        ''' <summary>True se il pacchetto si può scaricare da quell'indirizzo: GitHub, oppure lo stesso host locale dell'API usato per le prove.</summary>
        Public Function IsAllowedDownloadUrl(url As String, apiUrl As String) As Boolean
            If String.IsNullOrEmpty(url) Then Return False
            If url.StartsWith(DownloadPrefix, StringComparison.Ordinal) Then Return True
            Dim a As Uri = Nothing
            Dim u As Uri = Nothing
            Return Uri.TryCreate(apiUrl, UriKind.Absolute, a) AndAlso a.IsLoopback AndAlso
                   Uri.TryCreate(url, UriKind.Absolute, u) AndAlso u.IsLoopback AndAlso u.Port = a.Port
        End Function

        ' ---------------------------------------------------------------- cartelle

        Public Function UpdatesDir(installDir As String) As String
            Return Path.Combine(installDir, "App_Data", "updates")
        End Function

        Public Function StagedRoot(installDir As String) As String
            Return Path.Combine(UpdatesDir(installDir), "staged")
        End Function

        ''' <summary>True se si può creare un file nella cartella del programma (non in C:\Programmi, per esempio).</summary>
        Public Function IsWritable(dir As String) As Boolean
            Try
                Dim f = Path.Combine(dir, $".scrittura-{Guid.NewGuid():N}.tmp")
                File.WriteAllText(f, "")
                File.Delete(f)
                Return True
            Catch
                Return False
            End Try
        End Function

        ' ---------------------------------------------------------------- estrazione

        ''' <summary>
        ''' Scompatta il pacchetto in una cartella rifiutando percorsi che escono dalla cartella, voci doppie e dimensioni
        ''' eccessive, e controlla che ci siano i file indispensabili.
        ''' </summary>
        Public Sub ExtractPackage(zipPath As String, destDir As String)
            Dim root = Path.GetFullPath(destDir).TrimEnd(Path.DirectorySeparatorChar) & Path.DirectorySeparatorChar
            Directory.CreateDirectory(destDir)
            Using zip = ZipFile.OpenRead(zipPath)
                Dim total As Long = 0
                For Each e In zip.Entries
                    Dim target = Path.GetFullPath(Path.Combine(destDir, e.FullName))
                    If Not target.StartsWith(root, StringComparison.OrdinalIgnoreCase) Then
                        Throw New InvalidDataException($"Il pacchetto contiene un percorso non valido: {e.FullName}")
                    End If
                    total += e.Length
                    If total > MaxExtractedBytes Then Throw New InvalidDataException("Il pacchetto decompresso è troppo grande")
                    If String.IsNullOrEmpty(e.Name) Then
                        Directory.CreateDirectory(target)
                    Else
                        Directory.CreateDirectory(Path.GetDirectoryName(target))
                        e.ExtractToFile(target, False)
                    End If
                Next
            End Using
            For Each f In RequiredFiles
                If Not File.Exists(Path.Combine(destDir, f)) Then Throw New InvalidDataException($"Il pacchetto è incompleto: manca {f}")
            Next
        End Sub

        ' ---------------------------------------------------------------- installazione

        ''' <summary>La cartella con la versione più recente di quella in uso tra quelle già scaricate e verificate; Nothing se non ce n'è.</summary>
        Public Function FindStaged(installDir As String, current As Version, ByRef stagedVersion As Version) As String
            stagedVersion = Nothing
            Dim root = StagedRoot(installDir)
            If current Is Nothing OrElse Not Directory.Exists(root) Then Return Nothing
            Dim best As String = Nothing
            For Each d In Directory.GetDirectories(root)
                Dim v = ParseVersion(Path.GetFileName(d))
                If v Is Nothing OrElse v <= current Then Continue For
                If RequiredFiles.Any(Function(f) Not File.Exists(Path.Combine(d, f))) Then Continue For
                If stagedVersion Is Nothing OrElse v > stagedVersion Then
                    stagedVersion = v
                    best = d
                End If
            Next
            Return best
        End Function

        ''' <summary>
        ''' Sostituisce i file del programma con quelli della cartella già verificata: ogni voce di primo livello (eseguibile,
        ''' wwwroot, documenti) vecchia diventa "nome.old" e quella nuova va al suo posto. App_Data e appsettings.json restano
        ''' come sono. Se una mossa fallisce le voci già sostituite tornano come prima e l'errore viene rilanciato.
        ''' </summary>
        Public Sub ApplyStaged(stagedDir As String, installDir As String)
            Dim done As New List(Of KeyValuePair(Of String, Boolean))   ' nome, esisteva una voce vecchia
            Try
                For Each src In Directory.GetFileSystemEntries(stagedDir)
                    Dim name = Path.GetFileName(src)
                    If KeptNames.Contains(name, StringComparer.OrdinalIgnoreCase) Then Continue For
                    Dim dst = Path.Combine(installDir, name)
                    Dim bak = dst & ".old"
                    DeleteEntry(bak)
                    Dim had = Exists(dst)
                    If had Then MoveEntry(dst, bak)
                    done.Add(New KeyValuePair(Of String, Boolean)(name, had))
                    MoveEntry(src, dst)
                Next
            Catch
                For i = done.Count - 1 To 0 Step -1
                    Dim dst = Path.Combine(installDir, done(i).Key)
                    Try
                        DeleteEntry(dst)
                        If done(i).Value Then MoveEntry(dst & ".old", dst)
                    Catch
                        ' il ritorno indietro è il meglio che si può fare: l'errore da mostrare è quello originale
                    End Try
                Next
                Throw
            End Try
        End Sub

        ''' <summary>
        ''' Elimina i "nome.old" lasciati da un aggiornamento (quello dell'eseguibile in uso si può togliere solo dopo l'uscita).
        ''' Solo se accanto c'è "nome": un "archivio.old" qualunque dell'utente non si tocca.
        ''' </summary>
        Public Sub CleanupOld(installDir As String)
            Try
                For Each e In Directory.GetFileSystemEntries(installDir, "*.old")
                    Dim baseName = Path.GetFileName(e)
                    baseName = baseName.Substring(0, baseName.Length - ".old".Length)
                    If baseName.Length = 0 OrElse KeptNames.Contains(baseName, StringComparer.OrdinalIgnoreCase) Then Continue For
                    If Not Exists(Path.Combine(installDir, baseName)) Then Continue For
                    Try
                        DeleteEntry(e)
                    Catch
                    End Try
                Next
            Catch
            End Try
        End Sub

        ''' <summary>Toglie le versioni scaricate (dopo averle installate, o dopo un errore, per non riprovare all'infinito).</summary>
        Public Sub DiscardStaged(installDir As String)
            Try
                DeleteEntry(StagedRoot(installDir))
            Catch
            End Try
        End Sub

        ''' <summary>Toglie tutto ciò che resta di un aggiornamento mai installato (versioni pronte, file parziali, cartelle di lavoro).</summary>
        Public Sub DiscardUpdateFiles(installDir As String)
            Try
                DeleteEntry(UpdatesDir(installDir))
            Catch
            End Try
        End Sub

        ''' <summary>Argomenti per riavviare il programma: quelli di partenza più l'attesa dell'uscita di questo processo.</summary>
        Public Function RelaunchArgs(args As IEnumerable(Of String), pid As Integer, fromVersion As String, noBrowser As Boolean) As String
            Dim list As New List(Of String)
            Dim skip = 0
            For Each a In args
                If skip > 0 Then
                    skip -= 1
                ElseIf a = "--after-update" OrElse a = "--updated-from" Then
                    skip = 1
                ElseIf a <> "--no-browser" Then
                    list.Add(a)
                End If
            Next
            list.Add("--after-update") : list.Add(pid.ToString(Globalization.CultureInfo.InvariantCulture))
            If Not String.IsNullOrEmpty(fromVersion) Then list.Add("--updated-from") : list.Add(fromVersion)
            If noBrowser Then list.Add("--no-browser")
            Return String.Join(" ", list.Select(AddressOf QuoteArg))
        End Function

        Private Function QuoteArg(a As String) As String
            If a.Length > 0 AndAlso a.IndexOfAny({" "c, """"c, ControlChars.Tab}) < 0 Then Return a
            Return """" & a.Replace("""", "\""") & """"
        End Function

        Private Function Exists(path As String) As Boolean
            Return File.Exists(path) OrElse Directory.Exists(path)
        End Function

        Private Sub MoveEntry(src As String, dst As String)
            If Directory.Exists(src) Then Directory.Move(src, dst) Else File.Move(src, dst)
        End Sub

        Private Sub DeleteEntry(path As String)
            If Directory.Exists(path) Then
                Directory.Delete(path, True)
            ElseIf File.Exists(path) Then
                File.Delete(path)
            End If
        End Sub

    End Module

End Namespace
