# <img src="src/CarveCAM.Server/wwwroot/favicon.svg" width="40" height="40" alt="" align="top"> CarveCAM

Software CAM web per **mini CNC**: **svuotatura (pocketing) a terrazze** e **finitura in proiezione**
con fresa, su modelli 3D importati e su artefatti primitivi, con piani di lavoro liberi nello spazio.

- **Backend e motore di calcolo: VB.NET su .NET 10** (ASP.NET Core, controller MVC).
- **Frontend:** HTML/CSS/JavaScript con Three.js (servito dal server VB, nessun build step).

## Avvio

Requisiti: .NET SDK 10. Per il frontend serve la connessione a internet (Three.js e OpenCascade da CDN jsDelivr).

```bash
dotnet run --project src/CarveCAM.Server/CarveCAM.Server.vbproj
```

Poi aprire <http://localhost:5080>. La porta si cambia in `src/CarveCAM.Server/appsettings.json` (`Urls`).

Test del motore CAM:

```bash
dotnet test
```

### Progetto di prova

Il generatore `tools/CarveCAM.SampleProject` costruisce con il motore VB un progetto completo (pezzo
"Stampo" con cupola, tronco di cono, nervatura e perni; staffe e perni come artefatti; piano superiore e
piano inclinato di 30°; sgrossatura torica con ingresso a elica, svuotatura zigzag con rampa, finitura
sferica e finitura 3+2 torica), calcola i percorsi e scrive `Progetto di prova.ccam`, `modelli/stampo.stl`
e `.obj`, il G-code di riferimento (Fanuc/ISO e GRBL), `LEGGIMI.txt` e `risultati-calcolo.txt`.

```bash
dotnet run --project tools/CarveCAM.SampleProject -- "C:\percorso\cartella"
```

Senza argomenti scrive in `Desktop\CarveCAM - Progetto di prova`. Esce con codice 1 se un percorso
presenta interferenze, quindi è utilizzabile anche come prova di regressione del motore.

## Struttura

```
src/CarveCAM.Core      (VB.NET, libreria)   geometria, importatori mesh, CAM, post-processor
  Geometry/           Vec2/Vec3, Mat4 (convenzione Three.js), PlaneFrame (piano + angoli G68.2)
  Meshes/             lettori STL (ascii/bin), OBJ, PLY (ascii/bin), OFF; tassellazione artefatti
  Cam/                DropCutter, HeightField (marching squares), PathPlanner (concentrico/zigzag),
                      CamEngine (svuotatura, finitura, verifica collisioni), Poly (Clipper2),
                      ProfileBuilder (profili da 3D: ombra proiettata e booleane)
  Post/               G-code GRBL (mini CNC) e ISO/Fanuc (3 assi o 3+2 con G68.2), CL data APT
src/CarveCAM.Server    (VB.NET, ASP.NET Core) API REST + file statici
  Controllers/        /api/mesh (anche facce B-rep), /api/cam, /api/project, /api/profile,
                      /api/library (utensili e setup), /api/recovery (copie di sicurezza), /api/log
  Services/           archivio mesh e percorsi, log su file
  wwwroot/            interfaccia web (Three.js)
tests/CarveCAM.Tests   (VB.NET, xUnit)       test di motore, post, profili e importatori
tools/CarveCAM.SampleProject (VB.NET)       generatore del progetto di prova
samples/blocco-L.stp                        STEP di prova (blocco a L con gradino e foro) per i profili da 3D
```

## Interfaccia

- **Barra del titolo:** menu a tendina con icone (File, Modifica, Inserisci, Piani, Sketch, Lavorazioni,
  Strumenti, Vista, Aiuto; navigabili con le frecce), nome del progetto modificabile (Invio o uscita dal campo
  chiedono se salvare) con indicatore delle modifiche non salvate, ricerca comandi (**Ctrl+K**), stato del server.
  Il menu File contiene il riquadro degli **ultimi 5 progetti** aperti o salvati.
- **Barra strumenti a flusso di lavoro:** i gruppi seguono le fasi Modello › Piani › Sketch › Lavorazioni ›
  Calcolo e uscita; una spia sotto ogni fase indica se è completata (verde) o in corso (gialla). I comandi non
  utilizzabili nel contesto corrente sono spenti (il suggerimento dice perché).
- **Navigatore** (a sinistra): oggetti, artefatti, piani › sketch › entità, lavorazioni; occhio per
  mostrare/nascondere, lucchetto per bloccare/sbloccare. **Ctrl+clic** aggiunge o toglie dalla selezione.
- **Proprietà** (a destra): gruppi comprimibili e colorati; **clic sul nome di un parametro** per la sua
  spiegazione; i campi numerici accettano espressioni (es. `40/2`).
- **Vista 3D:** Z in alto; tasto sinistro ruota, centrale/destro trasla, rotella zoom; Ctrl+clic per la
  selezione multipla. Il piano attivo (quello dell'elemento selezionato o dello sketch in modifica) è
  riempito con bordo continuo, gli altri hanno solo il bordo tratteggiato; la normale è indicata da quattro
  piccole frecce agli angoli.
- **Manipolatore** (G sposta, R ruota): muove insieme oggetti, artefatti e piani selezionati. **Clic sul
  centro** del manipolatore: compaiono dei pallini verdi sui vertici della selezione, il clic su uno di essi
  lo sceglie come nuovo punto di riferimento.
- **Cubo di orientamento** (in alto a destra): clic su una faccia (Alto, Fronte, Destra…), uno spigolo o
  un vertice per le 26 viste standard, con breve rotazione animata; trascinandolo si ruota la vista.
  Sotto il cubo: vista isometrica, adatta alla vista, proiezione ortogonale, **vista normale al piano**.

### Elementi bloccati

Oggetti, artefatti e piani hanno la proprietà **Bloccato** (lucchetto nel navigatore, casella nelle
proprietà, **Ctrl+L**). Un elemento bloccato cambia colore, il manipolatore compare attenuato con un
lucchetto e non lo sposta, i campi di posizione/rotazione e i pulsanti di spostamento sono disattivati; se fa
parte di una selezione multipla blocca il movimento di tutta la selezione. **Modifica › Sposta origine**
trasla invece tutto il progetto (anche gli elementi bloccati) perché un punto scelto, digitato o cliccato
nella vista, diventi l'origine.

## Flusso di lavoro

1. **Importa** i modelli (File › Importa, o trascinali nella vista) e/o **inserisci artefatti**:
   cilindro, tronco di cono, sfera, parallelepipedo (dimensioni e posizione nelle proprietà).
2. **Aggiungi piano**: il comando attiva la creazione dei piani (finché non è attivo i comandi dei piani
   restano spenti). Si sceglie un **piano standard** dall'elenco (XY, XZ, YZ con normale positiva o negativa),
   oppure **da faccia**, **da 3 punti** o **dalla vista**.
   La **normale** (frecce blu) è l'**asse utensile**: la fresa lavora dal lato delle frecce.
   *Piano dalla vista*: normale verso chi guarda, agganciata alla vista standard più vicina entro 1°
   (dall'alto si ottiene esattamente +Z), piano appoggiato al punto del modello più vicino all'osservatore,
   dimensionato sull'ingombro e con l'asse X come la destra dello schermo.
3. Seleziona il piano, **Nuovo sketch** e disegna l'**area di contenimento** con polilinea, rettangolo,
   cerchio, poligono regolare, oppure ricavala dal modello con **Da 3D** (vedi sotto). Gli strumenti di
   disegno sono attivi solo durante la modifica di uno sketch. Aggancio a griglia e punti; coordinate
   digitate `x,y`, `@dx,dy`, raggio. Un contorno dentro un altro diventa un'isola esclusa (regola pari/dispari).
4. Seleziona lo sketch (oppure, con Ctrl+clic, una o più entità dello stesso sketch: solo quelle delimitano
   la zona lavorata) e scegli **Svuotatura** o **Finitura**: si sceglie l'**utensile dal magazzino** e poi il
   **setup** di lavorazione.
5. **Ricalcola tutto** (o F9 sulla lavorazione selezionata), **Simula tutto** ed **Esporta G-code** (o CL data).

## Utensili, setup e parametri

- **Strumenti › Magazzino utensili:** archivio delle frese (numero T, tipo, diametro, raggio di raccordo,
  **altezza del tagliente**, lunghezza utile, gambo, taglienti, materiale, avanzamenti consigliati).
- **Strumenti › Setup di lavorazione:** parametri preferiti (strategia, passi, quote, ingresso, tecnologia);
  dalle proprietà di una lavorazione **Salva come setup…** ne crea uno nuovo.
- **Parametri relativi:** passo laterale e raggio dell'elica in **% del diametro**, passo verticale in
  **% dell'altezza del tagliente**, con limiti minimo e massimo in mm; il valore effettivo è mostrato accanto.
- **Ostacoli:** ogni lavorazione ricorda quali oggetti e artefatti considera. Gli elementi 3D aggiunti dopo
  la sua creazione non sono ostacoli finché non vengono spuntati nel gruppo *Ostacoli* delle proprietà.

Gli archivi sono sul server, in `App_Data/library/tools.json` e `setups.json`.

## Simulazione

**Simula tutto** esegue in sequenza tutte le lavorazioni; nella barra di simulazione il pulsante
*Solo questa* / *Fino all'ultima* sceglie se simulare solo la lavorazione selezionata o anche tutte le
successive. Durante la simulazione un riquadro in alto a sinistra mostra le coordinate del TCP (X, Y, Z
della punta e A, C dell'asse utensile). Facendo clic nel vuoto (la lavorazione perde la selezione) la
simulazione si chiude.

## Profili dal modello 3D

Nello sketch lo strumento **Da 3D** (tasto **D**) ricava i contorni dal modello:

- **Facce od Oggetti:** clic sulle facce del modello (di nuovo per toglierle) oppure su oggetti interi, di
  cui si prende la sagoma. Durante lo strumento si può ruotare la vista per raggiungere le facce; uscendo si
  torna in pianta sul piano.
- **Facce CAD vere per STEP, IGES e BREP:** all'importazione ogni triangolo conserva la sua faccia B-rep
  (salvata sul server e nel file `.ccam`). Per STL, OBJ e artefatti le facce si ricavano dalla mesh,
  raggruppando i triangoli contigui con normali entro 20°.
- **Proiezione:** ogni elemento diventa la sua "ombra" lungo la normale del piano (unione dei triangoli
  proiettati, fori compresi); le facce viste di taglio non hanno area e vengono segnalate.
- **Combinazione:** *Unione*, *Sottrazione* (il primo selezionato meno gli altri), *Intersezione* oppure
  *Separati* (non booleano: un contorno per elemento, dove si sovrappongono vale la regola pari/dispari).
- **Offset** in mm (positivo verso l'esterno), anteprima sul piano con l'area risultante; **Crea profilo**
  (Invio) aggiunge polilinee chiuse allo sketch, annullabili con Ctrl+Z.

Il calcolo avviene sul server con Clipper2 (`/api/profile`). Per provarlo: importa
`samples/blocco-L.stp`, vista dall'alto, *Piano dalla vista*, nuovo sketch, **Da 3D** e clic sulle due
facce superiori.

## Lavorazioni

**Svuotatura a terrazze.** Parte dal piano di proiezione e scende a passate costanti (passo verticale)
fino alla profondità massima. A ogni quota la regione lavorabile è l'area dello sketch (ristretta del
raggio utensile se "utensile dentro contorno") meno lo spazio occupato da oggetti e artefatti,
maggiorato della forma dell'utensile: le terrazze arrivano quindi a ridosso degli oggetti (più
l'eventuale sovrametallo). La regione si ottiene da una griglia di "drop-cutter" con isolinee
(marching squares) raffinate per bisezione esatta.
Strategie: **concentrica** (offset dall'interno verso l'esterno) o **rettangolare zigzag**
(con passata di contorno opzionale). Collegamenti in lavoro quando restano nella regione,
altrimenti disimpegno alla quota di sicurezza.
Ingresso nel materiale: **elica** (passa per il punto d'ingresso ed è contenuta nella zona lavorabile),
**rampa** lungo il primo tratto del percorso (o attorno al contorno se corto) oppure affondo verticale;
angolo di discesa e avanzamento di rampa configurabili, con ripiego automatico se manca spazio.

**Utensili:** fresa cilindrica, **torica** (raggio di raccordo r: fondo piatto di raggio R-r più toro) e
sferica. Il contatto torico con gli spigoli è calcolato massimizzando una funzione concava
(sezione aurea), verificato nei test contro una ricerca a forza bruta.

**Finitura in proiezione.** Il percorso 2D (zigzag o concentrico) viene proiettato lungo la normale
del piano direttamente sulle superfici (drop-cutter esatto per fresa cilindrica e sferica, con
campionamento adattivo sulla tolleranza), senza passate intermedie.

Ogni percorso viene **verificato** campionando tutti i movimenti: la massima interferenza
residua (oltre la tolleranza) è riportata nelle proprietà della lavorazione.

## Formati 3D

| Dove | Formati |
|---|---|
| Server (VB.NET) | STL ascii/binario, OBJ, PLY ascii/binario, OFF |
| Browser (Three.js) | glTF/GLB, FBX, 3MF, DAE (Collada), 3DS, AMF, VRML/WRL |
| Browser (OpenCascade WASM) | STEP/STP, IGES/IGS, BREP (con le facce B-rep per i profili da 3D) |

I formati con Y verticale (glTF, FBX, DAE, VRML) vengono ruotati per avere Z in alto.
Le unità sono millimetri: se il modello è in altre unità usare la scala nelle proprietà.

## G-code

**GRBL 1.1, grblHAL e FluidNC** (mini CNC, 3 assi):

- Solo comandi supportati da GRBL: niente `%`, numeri di programma `O`, `M6`, `G43 H` o `G68.2`. Tutte le
  righe, commenti compresi, restano entro gli 80 caratteri del buffer di GRBL.
- A ogni lavorazione: salita alla quota di sicurezza, poi `S# M3` con attesa `G4 P` (configurabile, GRBL non
  sa quando il mandrino è in velocità), poi posizionamento in XY.
- **Cambio utensile:** `M5` + pausa `M0`, con l'utensile da montare e l'invito a riazzerare Z nei commenti.
- **Piano inclinato o pezzo capovolto:** pausa `M0` con le istruzioni di piazzamento (inclinazione, normale
  del piano, direzione dell'asse X, origine da azzerare). Le coordinate sono nel sistema del piano: è il 3+2
  manuale di una macchina a 3 assi. Quando si torna alle lavorazioni dall'alto c'è una nuova pausa.

**Fanuc/ISO:**

- Piano allineato a XY mondo: coordinate XYZ a 3 assi.
- Piano inclinato: `G68.2 X Y Z I J K` (angoli di Eulero ZXZ) + `G53.1`, coordinate nel sistema del piano;
  in alternativa coordinate mondo con commento sull'asse utensile.
- Cambio utensile `T# M6`, `G43 H#`, `S# M3`, refrigerante opzionale.

Verificare sempre il programma con il simulatore della propria macchina prima dell'uso.

## Opzioni, lingua, sicurezza e diagnostica

- **Strumenti › Opzioni:** colori (sfondo, griglia, oggetti, bloccati, selezione, piani, sketch, percorsi…),
  dimensioni di manipolatore, frecce della normale, mirino e pallini, **lingua** (italiano, inglese),
  parametri della **griglia** e **tema chiaro o scuro**. Le opzioni sono salvate nel browser.
  I testi dell'interfaccia sono in italiano e fanno da chiave per le traduzioni in `wwwroot/js/i18n-en.js`.
- **Salvataggio:** con Chrome ed Edge il progetto si salva direttamente sul file aperto (File System Access
  API, *Salva con nome* per cambiarlo); negli altri browser il file viene scaricato.
- **Copie di sicurezza:** il progetto è salvato di continuo nel browser e, ogni minuto se ci sono modifiche,
  sul server (`App_Data/recovery`, ultime 30 copie, *File › Copie di sicurezza*). Se il programma non è stato
  chiuso correttamente, alla riapertura viene chiesto se recuperare le modifiche non salvate.
- **File di log:** `App_Data/logs/carvecam-AAAAMMGG.log` (14 giorni). Server e interfaccia scrivono nello
  stesso file: richieste API con esito e durata, richieste lente, calcoli (parametri, tempi, avvisi),
  importazioni, salvataggi, azioni dell'utente, errori JavaScript e blocchi dell'interfaccia (con le ultime
  azioni eseguite). Si consulta e si scarica da *Aiuto › File di log*.

## Limiti noti

- Il grezzo non è modellato: la svuotatura assume che il materiale parta dal piano di lavoro.
- Gli ingressi a rampa/elica riguardano la svuotatura; la finitura si avvicina alla superficie con affondo.
- I messaggi generati dal server (errori e avvisi del calcolo) restano in italiano anche con l'interfaccia in inglese.
- Il progetto (.ccam) contiene progetto e mesh; i percorsi calcolati si rigenerano all'apertura (Ricalcola tutto).
  Si aprono anche i file `.pcam` e `.m3dz` salvati con i nomi precedenti del programma (PocketCAM, Mini3D CAM).
