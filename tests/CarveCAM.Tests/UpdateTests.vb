Imports System.IO
Imports System.IO.Compression
Imports CarveCAM.Core.Update
Imports Xunit

''' <summary>Aggiornamento automatico: versioni, controllo del pacchetto, estrazione sicura e sostituzione dei file.</summary>
Public Class UpdateTests

    ' ---------------------------------------------------------------- versioni

    <Theory>
    <InlineData("v0.4.1", "0.4.1")>
    <InlineData("0.4.0+78da241", "0.4.0")>
    <InlineData("0.4.1-beta", "0.4.1")>
    <InlineData("0.4", "0.4")>
    Public Sub ParseVersion_ReadsTagsAndProgramVersions(text As String, expected As String)
        Assert.Equal(Version.Parse(expected), UpdateLogic.ParseVersion(text))
    End Sub

    <Theory>
    <InlineData("")>
    <InlineData("?")>
    <InlineData("latest")>
    <InlineData("1.2.3.4.5")>
    <InlineData("v")>
    Public Sub ParseVersion_RejectsGarbage(text As String)
        Assert.Null(UpdateLogic.ParseVersion(text))
    End Sub

    <Theory>
    <InlineData("v0.4.1", "0.4.0+78da241", True)>
    <InlineData("v0.4.0", "0.4.0+78da241", False)>
    <InlineData("v0.3.9", "0.4.0", False)>
    <InlineData("v0.10.0", "0.9.0", True)>
    <InlineData("v1.0.0", "0.99.99", True)>
    <InlineData("boh", "0.4.0", False)>
    <InlineData("v0.4.1", "?", False)>
    Public Sub IsNewer_ComparesNumbersNotText(latest As String, current As String, expected As Boolean)
        Assert.Equal(expected, UpdateLogic.IsNewer(latest, current))
    End Sub

    <Theory>
    <InlineData("v0.4.1", True)>
    <InlineData("0.4.1", True)>
    <InlineData("v0.4.1-beta", False)>
    <InlineData("v0.4", False)>
    <InlineData("../../x", False)>
    Public Sub IsReleaseTag_OnlyPlainVersions(tag As String, expected As Boolean)
        Assert.Equal(expected, UpdateLogic.IsReleaseTag(tag))
    End Sub

    ' ---------------------------------------------------------------- pacchetto

    <Fact>
    Public Sub ParseDigest_AcceptsOnlySha256()
        Dim hex = New String("A"c, 32) & New String("b"c, 32)
        Assert.Equal(hex.ToLowerInvariant(), UpdateLogic.ParseDigest("sha256:" & hex))
        Assert.Null(UpdateLogic.ParseDigest("sha256:" & hex.Substring(1)))
        Assert.Null(UpdateLogic.ParseDigest("md5:" & hex))
        Assert.Null(UpdateLogic.ParseDigest(hex))
        Assert.Null(UpdateLogic.ParseDigest(""))
        Assert.Null(UpdateLogic.ParseDigest(Nothing))
    End Sub

    Private Shared Function Assets(ParamArray names As String()) As List(Of ReleaseAsset)
        Return names.Select(Function(n) New ReleaseAsset With {.Name = n, .Url = "https://x/" & n}).ToList()
    End Function

    <Fact>
    Public Sub PickAsset_MatchesTheWindowsPackageOfThisArchitecture()
        Dim list = Assets("Source code.zip", "CarveCAM-0.4.1-win-x64.zip.sig", "CarveCAM-0.4.1-win-arm64.zip", "CarveCAM-0.4.1-win-x64.zip", "evilCarveCAM-0.4.1-win-x64.zip")
        Assert.Equal("CarveCAM-0.4.1-win-x64.zip", UpdateLogic.PickAsset(list, "win-x64").Name)
        Assert.Equal("CarveCAM-0.4.1-win-arm64.zip", UpdateLogic.PickAsset(list, "win-arm64").Name)
        Assert.Null(UpdateLogic.PickAsset(list, Nothing))
        Assert.Null(UpdateLogic.PickAsset(Assets("Source code.zip"), "win-x64"))
        Assert.Null(UpdateLogic.PickAsset(Nothing, "win-x64"))
    End Sub

    <Fact>
    Public Sub PickAsset_WithATag_RequiresThePackageOfThatVersion()
        Dim list = Assets("CarveCAM-0.4.1-win-x64.zip", "CarveCAM-0.4.2-win-x64.zip")
        Assert.Equal("CarveCAM-0.4.2-win-x64.zip", UpdateLogic.PickAsset(list, "win-x64", "v0.4.2").Name)
        ' un allegato di un'altra versione non va bene: l'aggiornamento ripartirebbe a ogni avvio
        Assert.Null(UpdateLogic.PickAsset(Assets("CarveCAM-0.4.1-win-x64.zip"), "win-x64", "v0.4.2"))
        Assert.Null(UpdateLogic.PickAsset(Assets("CarveCAM-0.4.20-win-x64.zip"), "win-x64", "v0.4.2"))
    End Sub

    <Theory>
    <InlineData("https://github.com/SickSartori/CarveCAM/releases/download/v0.4.1/CarveCAM-0.4.1-win-x64.zip", UpdateLogic.DefaultApiUrl, True)>
    <InlineData("https://github.com/Altro/CarveCAM/releases/download/v1/x.zip", UpdateLogic.DefaultApiUrl, False)>
    <InlineData("https://github.com.evil.example/SickSartori/CarveCAM/releases/download/v1/x.zip", UpdateLogic.DefaultApiUrl, False)>
    <InlineData("http://github.com/SickSartori/CarveCAM/releases/download/v1/x.zip", UpdateLogic.DefaultApiUrl, False)>
    <InlineData("https://evil.example/x.zip", UpdateLogic.DefaultApiUrl, False)>
    <InlineData("http://localhost:5999/CarveCAM-0.4.1-win-x64.zip", "http://localhost:5999/api/latest", True)>
    <InlineData("http://localhost:6000/CarveCAM-0.4.1-win-x64.zip", "http://localhost:5999/api/latest", False)>
    <InlineData("http://localhost:5999/CarveCAM-0.4.1-win-x64.zip", UpdateLogic.DefaultApiUrl, False)>
    <InlineData("", UpdateLogic.DefaultApiUrl, False)>
    Public Sub IsAllowedDownloadUrl_OnlyGitHubOrLocalTestServer(url As String, apiUrl As String, expected As Boolean)
        Assert.Equal(expected, UpdateLogic.IsAllowedDownloadUrl(url, apiUrl))
    End Sub

    <Fact>
    Public Sub ResolveApiUrl_IgnoresNonLocalOverrides()
        Assert.Equal(UpdateLogic.DefaultApiUrl, UpdateLogic.ResolveApiUrl(Nothing))
        Assert.Equal(UpdateLogic.DefaultApiUrl, UpdateLogic.ResolveApiUrl("https://evil.example/latest"))
        Assert.Equal("http://localhost:5999/api/latest", UpdateLogic.ResolveApiUrl("http://localhost:5999/api/latest"))
    End Sub

    ' ---------------------------------------------------------------- cartelle e file di prova

    Private NotInheritable Class TempDir
        Implements IDisposable

        Public ReadOnly Path As String = System.IO.Path.Combine(System.IO.Path.GetTempPath(), "carvecam-upd-" & Guid.NewGuid().ToString("N"))

        Public Sub New()
            Directory.CreateDirectory(Path)
        End Sub

        Public Sub Dispose() Implements IDisposable.Dispose
            Try
                Directory.Delete(Path, True)
            Catch
            End Try
        End Sub
    End Class

    Private Shared Sub Put(root As String, rel As String, text As String)
        Dim f = System.IO.Path.Combine(root, rel)
        Directory.CreateDirectory(System.IO.Path.GetDirectoryName(f))
        File.WriteAllText(f, text)
    End Sub

    Private Shared Function Read(root As String, rel As String) As String
        Return File.ReadAllText(System.IO.Path.Combine(root, rel))
    End Function

    Private Shared Sub MakeZip(zipPath As String, ParamArray entries As String())
        Using z = ZipFile.Open(zipPath, ZipArchiveMode.Create)
            For Each name In entries
                Using w = New StreamWriter(z.CreateEntry(name).Open())
                    w.Write("contenuto di " & name)
                End Using
            Next
        End Using
    End Sub

    ' ---------------------------------------------------------------- estrazione

    <Fact>
    Public Sub ExtractPackage_UnpacksAValidPackage()
        Using tmp As New TempDir
            Dim zip = Path.Combine(tmp.Path, "p.zip")
            MakeZip(zip, "CarveCAM.exe", "wwwroot/index.html", "wwwroot/js/main.js", "LICENSE")
            Dim dest = Path.Combine(tmp.Path, "out")
            UpdateLogic.ExtractPackage(zip, dest)
            Assert.Equal("contenuto di wwwroot/js/main.js", Read(dest, "wwwroot/js/main.js"))
            Assert.True(File.Exists(Path.Combine(dest, "CarveCAM.exe")))
        End Using
    End Sub

    <Theory>
    <InlineData("../fuori.txt")>
    <InlineData("wwwroot/../../fuori.txt")>
    <InlineData("C:\Windows\fuori.txt")>
    <InlineData("/fuori.txt")>
    Public Sub ExtractPackage_RejectsPathsOutsideTheFolder(evil As String)
        Using tmp As New TempDir
            Dim zip = Path.Combine(tmp.Path, "p.zip")
            MakeZip(zip, "CarveCAM.exe", "wwwroot/index.html", evil)
            Dim dest = Path.Combine(tmp.Path, "out", "dentro")
            Assert.Throws(Of InvalidDataException)(Sub() UpdateLogic.ExtractPackage(zip, dest))
            Assert.False(File.Exists(Path.Combine(tmp.Path, "out", "fuori.txt")))
            Assert.False(File.Exists(Path.Combine(tmp.Path, "fuori.txt")))
        End Using
    End Sub

    <Theory>
    <InlineData("CarveCAM.exe")>
    <InlineData("wwwroot/index.html")>
    Public Sub ExtractPackage_RequiresTheEssentialFiles(missing As String)
        Using tmp As New TempDir
            Dim zip = Path.Combine(tmp.Path, "p.zip")
            Dim names = {"CarveCAM.exe", "wwwroot/index.html", "LICENSE"}.Where(Function(n) n <> missing).ToArray()
            MakeZip(zip, names)
            Dim ex = Assert.Throws(Of InvalidDataException)(Sub() UpdateLogic.ExtractPackage(zip, Path.Combine(tmp.Path, "out")))
            Assert.Contains(missing, ex.Message)
        End Using
    End Sub

    ' ---------------------------------------------------------------- installazione

    ''' <summary>Cartella di installazione 0.4.0 con i dati dell'utente e, già scaricata, la 0.4.1.</summary>
    Private Shared Sub MakeInstall(root As String)
        Put(root, "CarveCAM.exe", "exe 0.4.0")
        Put(root, "wwwroot/index.html", "pagina 0.4.0")
        Put(root, "wwwroot/js/solo-vecchio.js", "vecchio")
        Put(root, "appsettings.json", "{ ""Urls"": ""http://localhost:5999"" }")
        Put(root, "LEGGIMI.txt", "leggimi 0.4.0")
        Put(root, "App_Data/library/tools.json", "[utensili dell'utente]")
        Dim s = Path.Combine(root, "App_Data", "updates", "staged", "0.4.1")
        Put(s, "CarveCAM.exe", "exe 0.4.1")
        Put(s, "wwwroot/index.html", "pagina 0.4.1")
        Put(s, "wwwroot/js/solo-nuovo.js", "nuovo")
        Put(s, "appsettings.json", "{ ""Urls"": ""http://localhost:5080"" }")
        Put(s, "LEGGIMI.txt", "leggimi 0.4.1")
        Put(s, "LICENSE", "licenza 0.4.1")
    End Sub

    <Fact>
    Public Sub FindStaged_ReturnsOnlyAVersionNewerThanTheCurrentOne()
        Using tmp As New TempDir
            MakeInstall(tmp.Path)
            Dim v As Version = Nothing
            Dim dir = UpdateLogic.FindStaged(tmp.Path, New Version(0, 4, 0), v)
            Assert.NotNull(dir)
            Assert.Equal(New Version(0, 4, 1), v)
            Assert.Null(UpdateLogic.FindStaged(tmp.Path, New Version(0, 4, 1), v))
            Assert.Null(v)
            ' una cartella incompleta non si installa
            File.Delete(Path.Combine(dir, "CarveCAM.exe"))
            Assert.Null(UpdateLogic.FindStaged(tmp.Path, New Version(0, 4, 0), v))
        End Using
    End Sub

    <Fact>
    Public Sub ApplyStaged_ReplacesProgramFilesAndKeepsUserData()
        Using tmp As New TempDir
            MakeInstall(tmp.Path)
            Put(tmp.Path, "archivio.old/dati.txt", "dell'utente")   ' un .old che non è nostro
            Dim v As Version = Nothing
            UpdateLogic.ApplyStaged(UpdateLogic.FindStaged(tmp.Path, New Version(0, 4, 0), v), tmp.Path)

            Assert.Equal("exe 0.4.1", Read(tmp.Path, "CarveCAM.exe"))
            Assert.Equal("pagina 0.4.1", Read(tmp.Path, "wwwroot/index.html"))
            Assert.True(File.Exists(Path.Combine(tmp.Path, "wwwroot", "js", "solo-nuovo.js")))
            Assert.False(File.Exists(Path.Combine(tmp.Path, "wwwroot", "js", "solo-vecchio.js")), "i file che non esistono più vanno via")
            Assert.Equal("leggimi 0.4.1", Read(tmp.Path, "LEGGIMI.txt"))
            Assert.Equal("licenza 0.4.1", Read(tmp.Path, "LICENSE"))
            ' impostazioni e dati dell'utente restano come sono
            Assert.Contains("5999", Read(tmp.Path, "appsettings.json"))
            Assert.Equal("[utensili dell'utente]", Read(tmp.Path, "App_Data/library/tools.json"))
            ' le vecchie versioni restano come nome.old finché il programma non riparte
            Assert.Equal("exe 0.4.0", Read(tmp.Path, "CarveCAM.exe.old"))
            UpdateLogic.CleanupOld(tmp.Path)
            Assert.False(File.Exists(Path.Combine(tmp.Path, "CarveCAM.exe.old")))
            Assert.False(Directory.Exists(Path.Combine(tmp.Path, "wwwroot.old")))
            Assert.Equal("dell'utente", Read(tmp.Path, "archivio.old/dati.txt"))
        End Using
    End Sub

    <Fact>
    Public Sub ApplyStaged_RestoresEverythingWhenAFileIsLocked()
        If Not OperatingSystem.IsWindows() Then Return   ' altrove un file aperto si può rinominare
        Using tmp As New TempDir
            MakeInstall(tmp.Path)
            Dim v As Version = Nothing
            Dim staged = UpdateLogic.FindStaged(tmp.Path, New Version(0, 4, 0), v)
            Using locked As New FileStream(Path.Combine(tmp.Path, "LEGGIMI.txt"), FileMode.Open, FileAccess.Read, FileShare.None)
                Assert.ThrowsAny(Of IOException)(Sub() UpdateLogic.ApplyStaged(staged, tmp.Path))
            End Using
            Assert.Equal("exe 0.4.0", Read(tmp.Path, "CarveCAM.exe"))
            Assert.Equal("pagina 0.4.0", Read(tmp.Path, "wwwroot/index.html"))
            Assert.True(File.Exists(Path.Combine(tmp.Path, "wwwroot", "js", "solo-vecchio.js")))
            Assert.Equal("leggimi 0.4.0", Read(tmp.Path, "LEGGIMI.txt"))
            Assert.Contains("5999", Read(tmp.Path, "appsettings.json"))
            Assert.Equal("[utensili dell'utente]", Read(tmp.Path, "App_Data/library/tools.json"))
        End Using
    End Sub

    ' ---------------------------------------------------------------- riavvio

    <Fact>
    Public Sub RelaunchArgs_KeepsTheOriginalArgumentsAndAddsTheWait()
        Dim args = {"--urls", "http://localhost:5081", "--after-update", "12", "--updated-from", "0.3.0", "--no-browser"}
        Assert.Equal("--urls http://localhost:5081 --after-update 99 --updated-from 0.4.0",
                     UpdateLogic.RelaunchArgs(args, 99, "0.4.0", False))
        Assert.Equal("--urls http://localhost:5081 --after-update 99 --no-browser",
                     UpdateLogic.RelaunchArgs(args, 99, Nothing, True))
        Assert.Equal("--after-update 7", UpdateLogic.RelaunchArgs(Array.Empty(Of String)(), 7, Nothing, False))
        Assert.Equal("--cartella ""C:\Mie prove"" --after-update 7", UpdateLogic.RelaunchArgs({"--cartella", "C:\Mie prove"}, 7, Nothing, False))
    End Sub

End Class
