# Crea il pacchetto: dist\CarveCAM-<versione>-<runtime>.zip con CarveCAM.exe autonomo (non serve .NET
# installato), wwwroot, appsettings.json, LEGGIMI.txt, LICENSE e THIRD-PARTY-NOTICES.md.
# La versione è quella di Directory.Build.props. Il nome dello zip è quello che l'aggiornamento automatico cerca
# tra gli allegati della release (CarveCAM-X.Y.Z-win-x64.zip): non cambiarlo.
#   ./publish.ps1                  Windows 64 bit
#   ./publish.ps1 -Runtime win-arm64
param([string]$Runtime = 'win-x64')

$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$version = ([xml](Get-Content "$root\Directory.Build.props")).Project.PropertyGroup.Version
$name = "CarveCAM-$version-$Runtime"
$out = Join-Path $root "dist\$name"
$zip = "$out.zip"

if (Test-Path $out) { Remove-Item $out -Recurse -Force }
if (Test-Path $zip) { Remove-Item $zip -Force }

dotnet publish "$root\src\CarveCAM.Server\CarveCAM.Server.vbproj" -c Release -r $Runtime --self-contained `
    -p:PublishSingleFile=true -p:IncludeNativeLibrariesForSelfExtract=true -p:DebugType=none -o $out
if ($LASTEXITCODE -ne 0) { throw "dotnet publish non riuscito" }

Copy-Item "$root\packaging\LEGGIMI.txt", "$root\LICENSE", "$root\THIRD-PARTY-NOTICES.md" $out
# nel pacchetto non devono finire file di sviluppo
Get-ChildItem $out -Include '*.pdb', 'appsettings.Development.json', 'web.config' -Recurse | Remove-Item -Force

Compress-Archive -Path "$out\*" -DestinationPath $zip
$mb = [math]::Round((Get-Item $zip).Length / 1MB, 1)
Write-Host "Pacchetto pronto: $zip ($mb MB)"
