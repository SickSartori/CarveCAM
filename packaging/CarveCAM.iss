; Installatore di CarveCAM per Windows (Inno Setup 6). Lo costruisce publish.ps1, che passa versione, cartella dei file e sistema:
;   ISCC /DAppVersion=0.4.1 /DSourceDir=dist\CarveCAM-0.4.1-win-x64 /DOutDir=dist /DRuntime=win-x64 packaging\CarveCAM.iss
;
; Installa nella cartella personale dell'utente (%LOCALAPPDATA%\Programs\CarveCAM): non servono i diritti di amministratore
; e la cartella è scrivibile, quindi dati (App_Data) e aggiornamenti funzionano. Crea l'icona sul desktop e la voce nel menu Start.
; Reinstallando o aggiornando restano App_Data (utensili, setup, copie di sicurezza, log) e appsettings.json.

#ifndef AppVersion
  #error Passare /DAppVersion=X.Y.Z
#endif
#ifndef SourceDir
  #error Passare /DSourceDir=cartella con i file del pacchetto
#endif
#ifndef OutDir
  #define OutDir "."
#endif
#ifndef Runtime
  #define Runtime "win-x64"
#endif

[Setup]
; identifica il programma tra un'installazione e l'altra: non cambiarlo
AppId={{6B2D0732-ADF5-4C6F-97FF-C2EABC314FBC}
AppName=CarveCAM
AppVersion={#AppVersion}
AppVerName=CarveCAM {#AppVersion}
AppPublisher=William Veronesi e Gabriel S. Sartori
AppPublisherURL=https://github.com/SickSartori/CarveCAM
AppSupportURL=https://github.com/SickSartori/CarveCAM/issues
AppUpdatesURL=https://github.com/SickSartori/CarveCAM/releases
VersionInfoVersion={#AppVersion}
VersionInfoDescription=Installazione di CarveCAM
DefaultDirName={autopf}\CarveCAM
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
#if Runtime == "win-arm64"
ArchitecturesAllowed=arm64
ArchitecturesInstallIn64BitMode=arm64
#else
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
#endif
OutputDir={#OutDir}
OutputBaseFilename=CarveCAM-{#AppVersion}-{#Runtime}-setup
SetupIconFile=carvecam.ico
UninstallDisplayIcon={app}\CarveCAM.exe
Compression=lzma2/max
SolidCompression=yes
WizardStyle=modern
CloseApplications=yes

[Languages]
Name: "it"; MessagesFile: "compiler:Languages\Italian.isl"
Name: "en"; MessagesFile: "compiler:Default.isl"

[Tasks]
; spuntata di default: l'icona sul desktop è la via più semplice per aprire il programma
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"

[Files]
Source: "{#SourceDir}\*"; DestDir: "{app}"; Excludes: "appsettings.json,App_Data"; Flags: ignoreversion recursesubdirs createallsubdirs
; le impostazioni (porta, blackbox, aggiornamenti) si scrivono solo la prima volta
Source: "{#SourceDir}\appsettings.json"; DestDir: "{app}"; Flags: onlyifdoesntexist

[Icons]
Name: "{autoprograms}\CarveCAM"; Filename: "{app}\CarveCAM.exe"; WorkingDir: "{app}"; Comment: "CAM per mini CNC"
Name: "{autodesktop}\CarveCAM"; Filename: "{app}\CarveCAM.exe"; WorkingDir: "{app}"; Comment: "CAM per mini CNC"; Tasks: desktopicon

[Run]
Filename: "{app}\CarveCAM.exe"; Description: "{cm:LaunchProgram,CarveCAM}"; WorkingDir: "{app}"; Flags: nowait postinstall skipifsilent

[UninstallDelete]
; file che gli aggiornamenti automatici hanno portato o lasciato e che l'installatore non conosce; App_Data (i dati dell'utente) resta
Type: filesandordirs; Name: "{app}\wwwroot"
Type: filesandordirs; Name: "{app}\*.old"
Type: filesandordirs; Name: "{app}\App_Data\updates"
