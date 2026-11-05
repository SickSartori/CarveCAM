# Novità di CarveCAM

Le versioni seguono [Semantic Versioning](https://semver.org/lang/it/): finché il numero comincia con 0 il programma è
in sviluppo e i formati possono cambiare. Il numero è in `Directory.Build.props`. Il pacchetto Windows di ogni
versione si scarica dalla pagina [Releases](https://github.com/SickSartori/CarveCAM/releases).

## [Non rilasciato]

### Aggiunto
- **Prova online** con GitHub Codespaces (cartella `.devcontainer` e pulsante nel README): compila e avvia CarveCAM in un
  ambiente di GitHub, senza installare nulla. Serve un account GitHub.

## [0.4.1] - 2026-11-05

### Aggiunto
- **Installatore per Windows** (`CarveCAM-0.4.1-win-x64-setup.exe`): installa nella cartella personale, senza diritti
  di amministratore, e crea l'**icona sul desktop** e la voce nel **menu Start**. Lo zip resta per chi non vuole
  installare. Il programma ha ora un'icona e i dati del file (prodotto, descrizione, copyright).
- **Aggiornamenti** dall'interno dell'app. Quando CarveCAM è aperto cerca su GitHub una versione nuova e avvisa;
  *Info › Aggiornamenti* la scarica, ne verifica l'SHA256 e la installa con un riavvio. Utensili, setup, copie di
  sicurezza e `appsettings.json` non si toccano; se l'installazione non riesce si resta sulla versione in uso. Non
  parte nulla da solo: a un avvio normale il programma non scarica, sostituisce né riavvia niente. L'avviso si spegne in
  *Opzioni › Avvio*, tutta la funzione con `Update:Enabled` a `false` in `appsettings.json`.

### Da sapere
- La 0.4.0 non ha gli aggiornamenti: va aggiornata a mano una volta (con l'installatore, o copiando `App_Data` nella
  nuova cartella se si usa lo zip).
- Il pacchetto è verificato con l'SHA256 pubblicato da GitHub ma non è firmato dagli autori: ci si fida di GitHub e
  dell'account del repository. Anche installatore e programma sono senza firma, quindi Windows o un antivirus possono
  avvisare.

## [0.4.0] - 2026-11-05

Prima versione pubblica.

### Aggiunto
- Licenza MIT (`LICENSE`), indicata anche in *Info › Informazioni su CarveCAM*, e note sulle componenti di terze
  parti (`THIRD-PARTY-NOTICES.md`). Il pacchetto Windows contiene entrambi i file.
- README in italiano e in inglese, con a cosa serve, a chi è rivolto, macchine supportate e cosa non fa; il manuale
  completo è in `docs/MANUALE.md`.
- Questo elenco delle novità, con le versioni precedenti ricostruite dalla cronologia del repository.

### Corretto
- La soluzione non si compilava più dalla 0.3.1: il generatore del progetto di prova
  (`tools/CarveCAM.SampleProject`) usava ancora il "Concorde" della lavorazione, passato all'utensile. Ora
  `dotnet build` dell'intera soluzione riesce e il generatore scrive di nuovo il progetto di prova.

### Modificato
- LEGGIMI del pacchetto: avviso di verificare sempre il G-code sul simulatore della macchina e indirizzo per le
  segnalazioni su GitHub.
- *Esporta blackbox*: l'avviso dice che la password predefinita è pubblica e che l'archivio, che contiene il
  progetto, non va allegato a una segnalazione pubblica ma inviato in privato.

## [0.3.2] - 2026-11-02

### Modificato
- Le lavorazioni si aggiornano quando si salvano il magazzino utensili e i setup.

## [0.3.1] - 2026-10-08

### Aggiunto
- Utensili: **senso di rotazione** orario (`M3`) o antiorario (`M4`, frese sinistre) e lavorazione **concorde** o
  discorde. Insieme decidono il verso di contorni, anelli concentrici ed eliche; G-code e CL data seguono l'utensile.
  I progetti precedenti passano il loro "Concorde" all'utensile.
- Guida e README aggiornati.

## [0.3.0] - 2026-10-05

### Aggiunto
- **Magazzino macchine**: il G-code si scrive per una macchina configurabile (GRBL 1.1 / grblHAL / FluidNC, Fanuc/ISO
  3+2 con `G68.2`, Fanuc/ISO 3 assi, LinuxCNC, Mach3/Mach4, controllo generico solo `G1`), con anteprima del G-code,
  esportazione e importazione.
- Post-processor guidato dalla macchina: **archi** `G2`/`G3`, **solo `G1`** con corde regolari e tolleranza di corda,
  movimenti esatto e smooth, mandrino, refrigerazione, cambio utensile e righe di inizio e fine programma.

## [0.2.1] - 2026-10-04

### Aggiunto
- Modifica: coordinate assolute di arrivo, asse di rotazione per due punti, rotazione da bordi, centro scritto della
  serie polare e **Allinea a**.

## [0.2.0] - 2026-10-04

### Aggiunto
- **Comandi di modifica**: Sposta, Ruota, Copia, Scala smart, Serie rettangolare e Serie polare per entità di sketch
  ed elementi 3D, con anteprima, aggancio ai vertici e un passo di annullamento per modifica.
- **Grezzo**: i solidi diventano materiale da togliere; la svuotatura parte dalla sommità del grezzo, le lavorazioni
  in catena lavorano il materiale residuo, la simulazione mostra l'erosione.
- **Estrudi profilo** e **booleane** (unione, sottrazione, intersezione) tra solidi.
- **Frese coniche** e frese generate dai parametri, con anteprima 3D in scala e verifica delle misure; esportazione e
  importazione di utensili e setup; utensili del progetto confrontati con il magazzino all'apertura.
- **Guida illustrata** (F1) con schermate e pulsanti *Mostrami*, **progetto di esempio** (targa con logo) e
  **schermata iniziale** con progetti recenti e vetrina animata.
- Origini come zero pezzo del G-code, *Sposta origine* per asse, *Riposiziona…*, aggancio ai vertici visibili.
- Sequenza delle lavorazioni con trascinamento, ambito della simulazione (solo la selezionata o fino all'ultima),
  conferma prima di scendere sotto il piano della griglia, *Ricalcola tutto*.
- Sketch con navigazione come fuori dallo sketch, maniglie per modificare le entità e lati del rettangolo e del
  poligono nelle proprietà.
- Opzioni: vista iniziale memorizzata, esportazione e importazione delle impostazioni, nomi di origini e piani della
  stessa altezza.
- **Blackbox** (*Aiuto › Esporta blackbox*): archivio di diagnostica protetto da password.
- Nuovo logo, caricamento animato e crediti di sviluppo in *Info*.

### Modificato
- *Inverti normale* non specchia più gli sketch del piano.
- Il nome del progetto diventa quello del file al salvataggio.

## [0.1.0] - 2026-10-01

Prima versione, sviluppata dal 2026-09-27.

### Aggiunto
- Backend e motore di calcolo in VB.NET su .NET 10 (ASP.NET Core), interfaccia web con Three.js.
- **Svuotatura a terrazze** (concentrica o zigzag, ingresso a elica, rampa o affondo) e **finitura in proiezione**,
  con frese cilindrica, torica e sferica, verifica delle collisioni e piani di lavoro liberi nello spazio (3+2).
- Importazione di modelli STL, OBJ, PLY, OFF, glTF, FBX, 3MF, DAE, 3DS, AMF, VRML e STEP/IGES/BREP; artefatti
  primitivi; profili ricavati dal modello 3D.
- G-code GRBL e Fanuc/ISO e CL data; simulazione.
- Blocco e selezione multipla, magazzino utensili e setup, opzioni, interfaccia in italiano e inglese, file di log,
  copie di sicurezza e recupero.
- Pacchetto di distribuzione per Windows con eseguibile autonomo.

[0.4.1]: https://github.com/SickSartori/CarveCAM/releases/tag/v0.4.1
[0.4.0]: https://github.com/SickSartori/CarveCAM/releases/tag/v0.4.0
[0.3.2]: https://github.com/SickSartori/CarveCAM/releases/tag/v0.3.2
[0.3.1]: https://github.com/SickSartori/CarveCAM/releases/tag/v0.3.1
[0.3.0]: https://github.com/SickSartori/CarveCAM/releases/tag/v0.3.0
[0.2.1]: https://github.com/SickSartori/CarveCAM/releases/tag/v0.2.1
[0.2.0]: https://github.com/SickSartori/CarveCAM/releases/tag/v0.2.0
[0.1.0]: https://github.com/SickSartori/CarveCAM/releases/tag/v0.1.0
