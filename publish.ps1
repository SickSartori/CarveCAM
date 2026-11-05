# Crea il pacchetto: dist\CarveCAM-<versione>-<runtime>.zip con CarveCAM.exe autonomo (non serve .NET
# installato), wwwroot, appsettings.json, LEGGIMI.txt, LICENSE e THIRD-PARTY-NOTICES.md.
# La versione è quella di Directory.Build.props. Il nome dello zip è quello che l'aggiornamento automatico cerca
# tra gli allegati della release (CarveCAM-X.Y.Z-win-x64.zip): non cambiarlo.
# Se c'è Inno Setup 6 crea anche l'installatore dist\CarveCAM-<versione>-<runtime>-setup.exe (installa nella cartella
# personale, con icona sul desktop e voce nel menu Start; il nome non coincide con quello dello zip, che resta l'unico
# allegato cercato dagli aggiornamenti).
#   ./publish.ps1                  Windows 64 bit, zip e installatore
#   ./publish.ps1 -NoSetup         solo lo zip
#   ./publish.ps1 -Runtime win-arm64
param([string]$Runtime = 'win-x64', [switch]$NoSetup)

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

# installatore (icona sul desktop e voce nel menu Start): serve Inno Setup 6, https://jrsoftware.org/isinfo.php
if (-not $NoSetup) {
    $iscc = @("$env:LOCALAPPDATA\Programs\Inno Setup 6\ISCC.exe", "${env:ProgramFiles(x86)}\Inno Setup 6\ISCC.exe", "$env:ProgramFiles\Inno Setup 6\ISCC.exe",
              (Get-Command ISCC.exe -ErrorAction SilentlyContinue).Source) | Where-Object { $_ -and (Test-Path $_) } | Select-Object -First 1
    if ($iscc) {
        & $iscc /Q "/DAppVersion=$version" "/DSourceDir=$out" "/DOutDir=$root\dist" "/DRuntime=$Runtime" "$root\packaging\CarveCAM.iss"
        if ($LASTEXITCODE -ne 0) { throw "Inno Setup non riuscito" }
        $setup = "$root\dist\CarveCAM-$version-$Runtime-setup.exe"
        Write-Host ("Installatore pronto: $setup ({0} MB)" -f [math]::Round((Get-Item $setup).Length / 1MB, 1))
    } else {
        Write-Host "Inno Setup 6 non trovato: creato solo lo zip (usare -NoSetup per non vedere questo avviso)."
    }
}
