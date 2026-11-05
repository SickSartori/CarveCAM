# Manuale di CarveCAM

Riferimento completo delle funzioni di CarveCAM. Per la presentazione, il download e la compilazione dai sorgenti
vedere il [README](../README.md); per le novità di ogni versione il [CHANGELOG](../CHANGELOG.md). Chi comincia può
partire dalla guida illustrata dentro il programma (**F1**).

## Progetto di esempio e guida

*Aiuto › Progetto di esempio* (anche dalla schermata iniziale) crea una **targa 120 × 64 mm con cornice, logo e
scritta "CarveCAM" in rilievo**: la mesh è generata nel browser come un modello importato (superficie a griglia
fine solo dove non è piana) e caricata sul server una volta sola, poi riusata. Il progetto ha il piano superiore,
uno sketch con due rettangoli (contorno della targa e zona della scritta), lo zero pezzo sullo spigolo anteriore
sinistro e tre lavorazioni calcolate subito: sgrossatura concentrica con fresa torica Ø6 ed elica, finitura zigzag
con sferica Ø3, ripresa della scritta a 90° con conica sferica Ø1 3° (solo il rettangolo della scritta).

*Aiuto › Guida di CarveCAM* (**F1**, pulsante **?** in alto a destra) è la guida illustrata per chi comincia: 12
capitoli nell'ordine del lavoro (interfaccia, vista, modelli, piani, sketch, lavorazioni, utensili, calcolo e
simulazione, zero pezzo e G-code, progetti, scorciatoie), con ricerca, schemi vettoriali che seguono il tema,
icone dei comandi, **schermate reali con richiami numerati** e pulsanti **Mostrami** che indicano il comando
nella finestra. Le schermate (`wwwroot/img/guide/<lingua>/`, con `shots.json` per i richiami) si rigenerano con
il server avviato:

```bash
node tools/guide-shots.mjs http://localhost:5080
```

## Progetto di prova del motore (sviluppo)

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

## Interfaccia

- **Schermata iniziale:** dopo il caricamento, al posto dell'area di lavoro vuota: nuovo progetto, apri, importa,
  progetto di esempio, il progetto da riprendere (con l'anteprima e le modifiche non salvate), i progetti recenti
  con le miniature, la guida e il flusso di lavoro, le cui fasi si illuminano in sequenza. Accanto, una vetrina
  animata in prospettiva (`home-anim.js`, CSS 3D e SVG, senza librerie): una fresa scava la "C" del logo in una
  lastra con passate concentriche e una passata di contorno, con la riga di G-code e l'avanzamento; un clic apre
  il progetto di esempio. Si riapre da *File › Schermata iniziale* o con un clic sul logo; *Mostra all'avvio*
  (anche in *Opzioni › Avvio*) decide se compare all'avvio. Mentre è aperta la vista 3D non viene disegnata; le
  animazioni si fermano quando si chiude e, con *riduci movimento* del sistema, restano ferme.
- **Barra del titolo:** menu a tendina con icone (File, Modifica, Inserisci, Booleane, Origini, Piani, Sketch,
  Lavorazioni, Strumenti, Vista, Aiuto, Info; navigabili con le frecce), nome del progetto modificabile (Invio o uscita dal
  campo chiedono se salvare) con indicatore delle modifiche non salvate, ricerca comandi (**Ctrl+K**), stato del
  server. Il menu File contiene il riquadro degli **ultimi 5 progetti** aperti o salvati; *Info › Informazioni
  su CarveCAM* mostra versione, descrizione, **crediti di sviluppo** (William Veronesi e Gabriel S. Sartori) e
  componenti di terze parti.
- **Barra strumenti a flusso di lavoro:** i gruppi seguono le fasi Modello › Piani › Sketch › Lavorazioni ›
  Calcolo e uscita; una spia sotto ogni fase indica se è completata (verde) o in corso (gialla). I comandi non
  utilizzabili nel contesto corrente sono spenti (il suggerimento dice perché): durante la creazione di un piano
  e con un piano selezionato sono spenti i comandi *Modello*; durante il disegno di uno sketch anche quelli
  delle *Lavorazioni*. Il gruppo *Modifica* raccoglie i comandi di modifica; quando la finestra è stretta si
  riduce a un solo pulsante con menu, prima che la barra nasconda il gruppo *Vista*.
- **Caricamento:** all'avvio e durante calcoli, aperture e importazioni compare il logo animato (la fresa scava
  la passata interna e poi la "C"), con la fase in corso e, dopo 2 s, il tempo trascorso; con il movimento
  ridotto attivo nel sistema il logo resta fermo e pulsa.
- **Navigatore** (a sinistra): oggetti, artefatti, **grezzo**, origini, piani › sketch › entità, lavorazioni;
  occhio per mostrare/nascondere, lucchetto per bloccare/sbloccare. **Ctrl+clic** aggiunge o toglie dalla
  selezione; il **tasto destro** su un elemento, nel navigatore o nella vista, apre il suo menu.
  Le lavorazioni si **trascinano** per cambiarne la sequenza (con conferma della nuova sequenza), oppure
  *Lavorazioni › Riordina lavorazioni*.
- **Proprietà** (a destra): gruppi comprimibili e colorati; **clic sul nome di un parametro** per la sua
  spiegazione; i campi numerici accettano espressioni (es. `40/2`). Le misure degli artefatti hanno le
  **freccette su/giù** (passo 1 mm, Maiusc ×10, Alt ×0,1; tenendo premuto si ripete). Nel gruppo *Ostacoli* di
  una lavorazione, passando con il mouse sul nome l'ostacolo si evidenzia nella vista.
- **Vista 3D:** Z in alto; tasto sinistro ruota, centrale/destro trasla, rotella zoom; Ctrl+clic per la
  selezione multipla. Il piano attivo (quello dell'elemento selezionato o dello sketch in modifica) è
  riempito con bordo continuo, gli altri hanno solo il bordo tratteggiato e si selezionano con un clic in
  qualunque punto del loro riquadro; la normale è indicata da quattro piccole frecce agli angoli e il nome del
  piano è scritto accanto a un angolo del riquadro.
- **Manipolatore** (G sposta, R ruota): muove insieme oggetti, artefatti e piani selezionati. **Clic sul
  centro** del manipolatore: compaiono dei pallini verdi sui vertici della selezione, il clic su uno di essi
  lo sceglie come nuovo punto di riferimento.
- **Cubo di orientamento** (in alto a destra): clic su una faccia (Alto, Fronte, Destra…), uno spigolo o
  un vertice per le 26 viste standard, con breve rotazione animata; trascinandolo si ruota la vista.
  Sotto il cubo: vista isometrica, adatta alla vista, proiezione ortogonale, **vista normale al piano**.
  Nelle *Opzioni › Avvio* si memorizzano orientamento e zoom attuali come vista di partenza e come
  vista isometrica.

### Posizionamento, origine e punti di origine

- **Riposiziona…** (proprietà di oggetti e artefatti, gruppo *Posizionamento*): per ogni asse *Min*, *Centra*
  o *Max*, rispetto all'origine o all'ingombro degli altri solidi, più **Appoggia su Z=0**; anteprima dello
  spostamento e dell'ingombro risultante, un solo passo di annullamento.
- **Sposta origine** (menu Modifica e Origini): per ogni asse la nuova origine è il **minimo, il medio o il
  massimo dell'ingombro di tutti i solidi caricati** (anche nascosti), oppure l'origine attuale, **più un
  offset** in mm; oppure un punto cliccato nella vista. Tutto il progetto viene traslato.
- **Origini** (menu omonimo): punti di riferimento nella scena, chiamati *Origine 1, 2…* e rinominabili, creati
  con un clic nella vista (aggancio ai vertici) o con coordinate; *Sposta il punto…* (proprietà dell'origine)
  lo porta su un altro punto con un clic nella vista. Nell'**esportazione del G-code** si sceglie
  quale usare come **zero pezzo**: le coordinate del programma sono relative a quel punto (anche con G68.2 e
  sui piazzamenti GRBL, con le istruzioni di azzeramento nei commenti).
- Nelle scelte di punti nella vista (piano da 3 punti, origini) il cursore **si aggancia ai vertici visibili**
  di solidi, sketch e piani vicini, indicati da un pallino arancione.

### Comandi di modifica

Sposta, Ruota, Copia, Allinea a, Scala smart, Serie rettangolare e Serie polare (gruppo *Modifica* della barra,
menu *Modifica*, tasto destro, **Maiusc+M / R / C / L / S / A / P**) agiscono sulla selezione: le **entità di uno sketch**
(quelle selezionate, oppure tutte con lo sketch selezionato o in modifica), che si trasformano nel piano, oppure
gli **elementi 3D** (oggetti, artefatti, piani con i loro sketch, punti di origine). Un pannello in basso nella
vista indica il passo da fare e raccoglie i valori scritti; l'anteprima segue il puntatore e i punti si agganciano
ai vertici (nello sketch anche alla griglia): il pallino del cursore diventa arancione e più grande sul vertice
agganciato (dimensione nelle *Opzioni › Frecce e cursori › Pallini del riferimento*). **Invio** applica,
**Backspace** torna al passo precedente, **Esc** annulla; ogni modifica è un passo di annullamento.

- **Sposta:** punto base e punto di arrivo, oppure ΔX ΔY ΔZ (ΔU ΔV nello sketch) scritti, la distanza nella
  direzione del cursore o le **coordinate assolute di arrivo** del punto base (senza punto base: del centro della
  selezione); **Maiusc** vincola lo spostamento all'asse principale.
- **Ruota:** centro, direzione di partenza e nuova direzione, oppure l'angolo scritto (senza centro: il centro
  della selezione). Gli elementi 3D ruotano attorno a Z, X, Y oppure a un **asse per due punti** cliccati (il verso
  va dal primo al secondo). La direzione di partenza può essere un **bordo** o un segmento: si porta col mouse
  sulla nuova direzione, la si rende **parallela a un altro bordo** con un clic, oppure si scrive la **direzione
  finale** (angolo assoluto: attorno a Z da X, attorno a X da Y, attorno a Y da Z; nello sketch da U). Un bordo
  non ha verso: la rotazione scelta è la più piccola. **Maiusc** porta la direzione finale a multipli di 15°. Un
  rettangolo ruotato di un angolo che non è multiplo di 90° diventa una polilinea.
- **Allinea a:** 2 punti (3 per il 3D) sul pezzo da spostare, poi altrettanti sul riferimento: il pezzo si sposta
  e ruota perché il primo punto combaci con il primo, la direzione verso il secondo punto con quella del
  riferimento e, nel 3D, il piano dei tre punti con quello dei tre del riferimento. Con *Scala* anche la distanza
  tra i primi due punti diventa quella del riferimento.
- **Copia:** come Sposta, ma lascia l'originale; i clic successivi aggiungono altre copie dallo stesso punto base
  e *Copie in fila* ripete lo spostamento più volte.
- **Scala smart:** clic su un **segmento** dello sketch, un **bordo** di un solido o due punti: è il
  riferimento. Si scrive la **misura finale** che deve avere e il fattore di scala si calcola da solo (si può
  scrivere anche il fattore). Resta fermo l'estremo del riferimento più vicino al clic (il primo punto, il centro
  per il diametro di un cerchio) oppure il centro della selezione. Scala uniforme: per gli oggetti cambia la
  scala, per gli artefatti le misure, per i piani il lato e i loro sketch.
- **Serie rettangolare:** colonne, righe (e livelli per il 3D) con il passo, proposto dall'ingombro.
- **Serie polare:** centro (cliccato o con le coordinate scritte), numero di elementi, angolo totale (360° li
  distribuisce sul giro intero), copie ruotate oppure solo spostate.

Gli elementi bloccati non si spostano, ruotano, allineano o scalano; si possono copiare. Copie e serie restano
selezionate.

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
   La **normale** (frecce blu) è l'**asse utensile**: la fresa lavora dal lato delle frecce. *Inverti normale*
   la gira dall'altra parte senza spostare né specchiare gli sketch del piano (le entità vengono riscritte nel
   sistema del piano capovolto, la rotazione nel piano cambia segno).
   *Piano dalla vista*: normale verso chi guarda, agganciata alla vista standard più vicina entro 1°
   (dall'alto si ottiene esattamente +Z), piano appoggiato al punto del modello più vicino all'osservatore,
   dimensionato sull'ingombro e con l'asse X come la destra dello schermo.
3. Seleziona il piano, **Nuovo sketch** e disegna l'**area di contenimento** con polilinea, rettangolo,
   cerchio, poligono regolare, oppure ricavala dal modello con **Da 3D** (vedi sotto). Gli strumenti di
   disegno sono attivi solo durante la modifica di uno sketch, con aggancio a griglia e punti; completata
   un'entità si torna allo strumento Seleziona con l'entità selezionata. Un contorno dentro un altro diventa
   un'isola esclusa (regola pari/dispari).
   Entrando nello sketch la vista si mette normale al piano (con la normale attuale) e si naviga come fuori
   dallo sketch. Con lo strumento **Seleziona**, l'entità selezionata mostra i **punti di riferimento**
   (vertici, punti medi dei lati, centro, quadranti): trascinandoli si modifica la geometria (il trascinamento
   del punto medio di un lato di polilinea inserisce un vertice), con aggancio e Ctrl+Z. Nelle proprietà il
   **rettangolo** ha il primo punto cliccato come riferimento (spostandolo si sposta tutto) e la **lunghezza dei
   due lati** (cambiandola il primo punto resta fermo); il **poligono** ha anche la **lunghezza del lato**.
4. Seleziona lo sketch (oppure, con Ctrl+clic, una o più entità dello stesso sketch: solo quelle delimitano
   la zona lavorata) e scegli **Svuotatura** o **Finitura**: si sceglie l'**utensile dal magazzino** e poi il
   **setup** di lavorazione.
5. **Ricalcola tutto** (o F9 sulla lavorazione selezionata), **Simula tutto** ed **Esporta G-code** (o CL data).

## Utensili, setup e parametri

- **Strumenti › Magazzino utensili:** archivio delle frese (numero T, tipo, diametro, raggio di raccordo,
  **altezza del tagliente**, sbalzo, diametro del collo e del gambo, taglienti, materiale, avanzamenti
  consigliati). La fresa è **generata dai suoi parametri** (tagliente, collo ribassato, raccordo al gambo,
  gambo e portautensile): nel magazzino c'è un'**anteprima 3D in scala** (si ruota trascinandola) o con le
  quote; se le misure sono incongruenti (es. raggio di raccordo oltre metà diametro, sbalzo più corto del
  tagliente, collo più largo della fresa) compare il **disegno 2D con l'errore in rosso** e il campo da
  correggere evidenziato. Il calcolo dei percorsi verifica le collisioni della parte tagliente.
- **Frese coniche:** diametro in punta (0 = punta a V), **angolo per lato**, punta **sferica** o **piatta** e
  altezza del cono; sono gestite dal motore di calcolo (drop-cutter a profilo), dalla simulazione e dal G-code.
- **Senso di rotazione e Lavora concorde** (dell'utensile, anche nelle proprietà della lavorazione): orario (M3)
  o antiorario (M4, frese sinistre); movimento degli assi concorde (climb) o discorde al senso di rotazione.
  Insieme decidono il verso dei contorni, degli anelli concentrici e delle eliche (concorde con utensile orario =
  antiorario nelle svuotature; ogni inversione cambia il verso). Il G-code avvia il mandrino con `M3` o `M4`
  secondo l'utensile, fermandolo prima di invertire il senso; i commenti indicano le frese antiorarie e il CL data
  scrive `SPINDL/…,CLW` o `CCLW`. I progetti precedenti passano il loro "Concorde" all'utensile.
- **Esporta / Importa** (nelle finestre degli archivi e in *Strumenti › Esporta/Importa utensili e setup*):
  file `.json` con utensili e/o setup, da aggiungere (aggiornando quelli già presenti) o da sostituire.
- **Utensili nel progetto:** il file `.ccam` contiene le schede degli utensili usati. All'apertura, se nel
  magazzino mancano o hanno parametri diversi, compare l'elenco delle differenze e si può aprire il progetto
  aggiornando il magazzino (aggiunge o modifica gli utensili spuntati), aprirlo senza aggiornare o annullare.
- **Strumenti › Setup di lavorazione:** parametri preferiti (strategia, passi, quote, ingresso, tecnologia);
  dalle proprietà di una lavorazione **Salva come setup…** ne crea uno nuovo.
- **Parametri relativi:** passo laterale e raggio dell'elica in **% del diametro**, passo verticale in
  **% dell'altezza del tagliente**, con limiti minimo e massimo in mm; il valore effettivo è mostrato accanto.
- **Ostacoli:** ogni lavorazione ricorda quali oggetti e artefatti considera. Gli elementi 3D aggiunti dopo
  la sua creazione non sono ostacoli finché non vengono spuntati nel gruppo *Ostacoli* delle proprietà.

Gli archivi sono sul server, in `App_Data/library/tools.json` e `setups.json`.

## Solidi: profilo estruso e booleane

- **Estrudi profilo** (gruppo *Modello* e menu *Inserisci*): con uno sketch (o alcune sue entità) selezionato,
  estrude i contorni in linea retta perpendicolarmente al piano, per l'altezza scelta, nel materiale (opposta
  alla normale), verso l'utensile o in modo simmetrico. Un contorno dentro un altro è un foro. Il solido è un
  artefatto (*Profilo estruso*) con il profilo copiato nel suo sistema locale: altezza e direzione si cambiano
  nelle proprietà, la posizione con il manipolatore. Il server riceve i triangoli preparati dal client.
- **Booleane** (menu omonimo): **Unione**, **Sottrazione** (il primo solido selezionato meno gli altri) e
  **Intersezione** tra due o più oggetti e artefatti selezionati, calcolate nel browser con
  [three-bvh-csg](https://github.com/gkjohnson/three-bvh-csg). Il risultato è un nuovo oggetto (mesh caricata sul
  server); i solidi di partenza si tolgono o restano nascosti e le lavorazioni che li avevano come ostacolo usano
  il risultato. I solidi devono essere chiusi.

## Grezzo

Un solido (oggetto o artefatto, anche un profilo estruso) diventa **grezzo** con il tasto destro › *Considera
come grezzo* o con la casella *Grezzo* nelle proprietà: passa nell'elenco *Grezzo* del navigatore, è disegnato
semitrasparente e non è più un ostacolo ma il **materiale da togliere**.

- Per ogni lavorazione il grezzo diventa una **mappa di quote** nel sistema del suo piano (una fascia di
  materiale per colonna, circa 160 000 celle) rasterizzando i triangoli dei solidi.
- **Svuotatura:** le terrazze partono dalla **sommità del grezzo** (anche sopra il piano, per non urtarlo) e a ogni
  quota coprono solo le posizioni della fresa che toccano materiale (materiale allargato del raggio): niente
  passate in aria; la profondità massima resta misurata dal piano. Elica e rampa possono passare dove il
  materiale non c'è, purché la zona sia libera dagli ostacoli. La quota di sicurezza supera anche il grezzo.
- **Finitura:** i tratti più lunghi di 5 mm (o 4 raggi) in cui la fresa non tocca materiale si saltano, passando
  appena sopra pezzo e grezzo invece che alla quota di sicurezza.
- **In catena:** dopo ogni lavorazione il server toglie dal grezzo il volume spazzato dalla fresa (profilo del
  tagliente, anche conico) e la lavorazione successiva parte da quello: le riprese lavorano solo il materiale
  rimasto. Le lavorazioni si calcolano nell'ordine del navigatore; con un piano parallelo la mappa si trasla, con
  un'altra normale (3+2) si ricampiona dalla sua superficie. Se il server non ha più il grezzo intermedio (es.
  dopo un riavvio) il client ricalcola la catena.
- **Simulazione:** il grezzo di ogni lavorazione (`GET /api/cam/toolpath/{id}/stock`) si mostra come superficie
  che si abbassa dove passa la fresa: si vede l'erosione del materiale.

## Simulazione

**Simula tutto** esegue in sequenza tutte le lavorazioni; nella barra di simulazione il selettore
*Solo la selezionata* / *Dalla selezionata all'ultima* sceglie se simulare solo la lavorazione selezionata o
anche tutte le successive. Durante la simulazione un riquadro in alto a sinistra mostra le coordinate del TCP (X, Y, Z
della punta e A, C dell'asse utensile). Facendo clic nel vuoto (la lavorazione perde la selezione) la
simulazione si chiude.

## Profili dal modello 3D

Nello sketch lo strumento **Da 3D** (tasto **D**) ricava i contorni dal modello:

- **Facce od Oggetti:** clic sulle facce del modello (di nuovo per toglierle) oppure su oggetti interi, di
  cui si prende la sagoma. Si può ruotare la vista per raggiungere le facce.
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

**Piano della griglia.** Se la fresa scende sotto il piano base della griglia (Z 0 mondo, dove di solito
appoggia il pezzo) il client chiede se consentirlo: *Scendi sotto il piano* tiene il percorso, *Limita al
piano* lo ricalcola con il piano come limite. La scelta resta nella lavorazione (*Sotto la griglia*: chiedi
conferma, consenti, limita al piano). Il server riporta la quota più bassa raggiunta dal tagliente
(`stats.minZ`, anche con l'asse inclinato: conta il bordo della fresa) e, con `floor`, aggiunge sotto il pezzo
un piano che la fresa tocca senza sovrametallo: le terrazze si fermano sul piano, la finitura ci passa sopra.

**Utensili:** fresa cilindrica, **torica** (raggio di raccordo r: fondo piatto di raggio R-r più toro),
sferica e **conica** (punta piatta, a V o sferica raccordata al cono). Il contatto torico con gli spigoli è
calcolato massimizzando una funzione concava (sezione aurea), verificato nei test contro una ricerca a forza
bruta. La conica usa un profilo di rivoluzione generico per punti, maggiorato esattamente del sovrametallo
(offset con raccordi): contatto con le facce nel punto in cui la pendenza del tagliente supera quella della
faccia, con spigoli e vertici come per la torica; i triangoli che il cono non può raggiungere vengono scartati
in anticipo. Per contorni, passi e risoluzioni si usa il raggio del cono alla profondità massima.

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

Il G-code si scrive per una **macchina del magazzino macchine** (*Strumenti › Magazzino macchine*, anche dal
pulsante nell'esportazione), salvato sul server in `App_Data/library/machines.json` ed esportabile insieme a
utensili e setup. Le macchine predefinite sono GRBL 1.1 / grblHAL / FluidNC, Fanuc/ISO 3+2 (G68.2), Fanuc/ISO 3 assi
in coordinate mondo, LinuxCNC, Mach3/Mach4 e un controllo generico solo G1; ognuna si duplica e si modifica, con
l'**anteprima del G-code** su un percorso di prova (elica, cerchio, raccordi, finitura curva). Per ogni macchina:

- **Generale:** piani inclinati (pausa `M0` con le istruzioni, `G68.2`, coordinate mondo), ordine di
  avvicinamento, corse degli assi e avanzamento massimo (avvisi nell'esportazione, avanzamenti ridotti), estensione
  del file. *Valori di partenza* applica le impostazioni di una macchina predefinita.
- **Sintassi:** parole di movimento (G0 G1 G2 G3), nomi degli assi e di I J K R F, decimali di coordinate, archi e
  avanzamento, formato dei numeri (`10`, `10.`, `10.000`), assi invertiti, spazi, sintassi modale, numeri di riga
  (lettera, inizio, passo), commenti tra parentesi o dopo `;` (o nessuno), maiuscolo, lunghezza massima, fine riga.
- **Archi e corde:** i percorsi sono polilinee; il post-processor riconosce gli **archi** nei punti (tolleranza,
  raggio minimo e massimo, angolo massimo, piani XZ e YZ, eliche) e li scrive come `G2`/`G3` con il centro `I J`
  incrementale, assoluto o il raggio `R` (verificando il centro che ne ricava il controllo dopo l'arrotondamento).
  Con **solo G1** gli archi riconosciuti si rifanno a corde regolari con l'**errore di corda** e la lunghezza
  **minima** e **massima** delle corde (0 = senza limite).
- **Movimenti:** comandi di **movimento esatto** e **smooth** (es. `G61`, `G64 P{TOL}`, `G05.1 Q1`) per le
  svuotature e per le finiture, con la tolleranza e le righe per tornare alla modalità normale a fine programma.
- **Mandrino:** automatico (`M3`/`M4` con i giri, nel senso di rotazione dell'utensile) o manuale (pausa per accenderlo), comandi
  di avvio e arresto, attesa dopo l'avvio (`G4 P{SEC}`, `G4 X{SEC}`, `G4 P{MS}`), giri minimi e massimi, arresto
  a ogni lavorazione o solo ai cambi utensile.
- **Refrigerazione e aspirazione:** a pioggia, nebulizzato, aria, con i loro comandi e quello predefinito
  (nell'esportazione se ne sceglie un altro); aspirazione o ventola per tutto il programma o con il mandrino.
- **Cambio utensile:** automatico, manuale (pausa) o nessuno, correttore lunghezza (`G43 H{T}`).
- **Inizio e fine:** righe di inizio e fine programma e di inizio e fine lavorazione con i segnaposto `{S}`
  `{T}` `{TOOL}` `{D}` `{F}` `{SEC}` `{MS}` `{TOL}` `{NAME}` `{PROG}` `{OP}` `{DATE}` `{TIME}`; una riga
  `(testo)` o `; testo` è un commento, scritto nello stile della macchina.

Le macchine predefinite riproducono i due controlli di partenza.

**GRBL 1.1, grblHAL e FluidNC** (mini CNC, 3 assi):

- Solo comandi supportati da GRBL: niente `%`, numeri di programma `O`, `M6`, `G43 H` o `G68.2`; archi `G2`/`G3`
  con `I J`. Tutte le righe, commenti compresi, restano entro gli 80 caratteri del buffer di GRBL.
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
  dimensioni di manipolatore, frecce della normale, mirino, pallini e **nomi di origini e piani** (stessa
  altezza del testo in pixel, costante sullo schermo anche nella vista ortogonale), **lingua** (italiano, inglese),
  parametri della **griglia**, **avvio** (schermata iniziale, vista iniziale con orientamento e zoom attuali) e
  **tema chiaro o scuro**. Le opzioni sono salvate nel browser e si **esportano/importano** in un file `.json`.
  I testi dell'interfaccia sono in italiano e fanno da chiave per le traduzioni in `wwwroot/js/i18n-en.js`.
- **Salvataggio:** con Chrome ed Edge il progetto si salva direttamente sul file aperto (File System Access
  API, *Salva con nome* per cambiarlo); negli altri browser il file viene scaricato. Il **nome del progetto
  diventa quello del file**; se il progetto è stato rinominato, il salvataggio propone un nuovo file con il
  nuovo nome.
- **Copie di sicurezza:** il progetto è salvato di continuo nel browser e, ogni minuto se ci sono modifiche,
  sul server (`App_Data/recovery`, ultime 30 copie, *File › Copie di sicurezza*). Se il programma non è stato
  chiuso correttamente, alla riapertura viene chiesto se recuperare le modifiche non salvate.
- **File di log:** `App_Data/logs/carvecam-AAAAMMGG.log` (14 giorni). Server e interfaccia scrivono nello
  stesso file: richieste API con esito e durata, richieste lente, calcoli (parametri, tempi, avvisi),
  importazioni, salvataggi, azioni dell'utente, errori JavaScript e blocchi dell'interfaccia (con le ultime
  azioni eseguite). Si consulta e si scarica da *Aiuto › File di log*.
- **Blackbox** (*Aiuto › Esporta blackbox*): archivio `.zip` **protetto da password** con tutto il necessario
  per riprodurre un problema: descrizione dell'utente, progetto corrente (anche non salvato) apribile come
  `.ccam` con le mesh, richieste di calcolo di ogni lavorazione, stato dell'interfaccia (selezione, vista,
  modalità, simulazione), opzioni, magazzino, ultimi messaggi della sessione e file di log del server. La
  password è in `appsettings.json` (`Blackbox:Password`, ora `1234`); la cifratura è quella ZIP tradizionale,
  apribile con Esplora risorse e 7-Zip. Il valore predefinito è pubblico (è in questo repository): l'archivio evita
  l'apertura casuale ma **non è riservato**. Contiene il progetto e i log, quindi non va allegato a una segnalazione
  pubblica: si invia in privato a chi presta assistenza; chi lo gestisce può cambiare la password.
- **Aggiornamenti** (dalla 0.4.1, solo con il pacchetto per Windows; non con `dotnet run`). Tutto passa dall'interno
  dell'app, quando è aperta: il server non contatta GitHub da solo e a un avvio normale non scarica, sostituisce né
  riavvia nulla.
  - **Avviso.** Quando la pagina è aperta CarveCAM legge da GitHub l'ultima release (`api.github.com`): la prima volta
    dopo ogni avvio e poi al massimo una volta all'ora, salvo il pulsante *Cerca aggiornamenti*. Non invia dati del
    progetto, solo il nome e la versione del programma. Se c'è una versione nuova compare un avviso. GitHub concede
    un numero limitato di richieste per indirizzo internet: con molti PC dietro lo stesso indirizzo si può spegnere
    la ricerca su alcuni.
  - **Scaricamento.** *Info › Aggiornamenti › Scarica* scarica `CarveCAM-X.Y.Z-win-x64.zip`, ne controlla l'**SHA256**
    (quello che GitHub pubblica per l'allegato: senza SHA256 o con un valore diverso il pacchetto si scarta) e lo
    scompatta in `App_Data/updates`. Un pacchetto scaricato e non installato si cancella al prossimo avvio.
  - **Installazione.** Solo con *Riavvia e installa ora*, dopo una conferma: il programma si riavvia, sostituisce
    l'eseguibile, `wwwroot` e i documenti e riparte. `App_Data` (magazzini, copie di sicurezza, log) e
    `appsettings.json` restano come sono. Se qualcosa non riesce tutto torna come prima e si continua con la versione
    in uso (il motivo è nel log).
  - Si spegne in *Opzioni › Avvio* (solo l'avviso all'apertura; *Info › Aggiornamenti* resta disponibile) oppure del
    tutto con `"Update": { "Enabled": false }` in `appsettings.json`.
  - Se la cartella non è scrivibile (per esempio `C:\Programmi`) il programma avvisa che c'è una versione nuova ma non
    la installa: va scaricata a mano dalla pagina Releases. L'installatore usa la cartella personale proprio per
    questo.
  - Se un antivirus isola il file scaricato il programma lo dice e basta scaricarlo di nuovo o aggiornare a mano.
  - La versione 0.4.0 non ha questa funzione: chi la usa scarica la 0.4.1 a mano una volta (copiando `App_Data`
    nella nuova cartella per tenere i dati).
  - **Fiducia:** il pacchetto è verificato con l'SHA256 pubblicato da GitHub, ma non è firmato dagli autori. Chi
    controlla l'account GitHub `SickSartori` può quindi pubblicare codice che le installazioni eseguono: ci si fida di
    GitHub e di quell'account. Chi non vuole questa fiducia spegne la funzione e aggiorna a mano.
- **Installazione con l'installatore** (`CarveCAM-X.Y.Z-win-x64-setup.exe`). Installa in `%LOCALAPPDATA%\Programs\CarveCAM`
  (cartella personale: nessun diritto di amministratore, e scrivibile, quindi gli aggiornamenti funzionano), crea
  l'icona sul desktop (si può togliere la spunta durante l'installazione) e la voce nel menu Start. Reinstallando o
  aggiornando restano `App_Data` e `appsettings.json`. Disinstallando dal pannello di Windows si tolgono programma e
  collegamenti ma si lasciano i dati in `App_Data`, da cancellare a mano se non servono. L'installatore si costruisce
  con `publish.ps1` se c'è Inno Setup 6; lo zip resta per chi non vuole installare.

## Limiti noti

- Senza grezzo la svuotatura assume che il materiale parta dal piano di lavoro. Il grezzo è una mappa di quote
  per piano (una fascia per colonna): i sottosquadri rispetto all'asse utensile non sono rappresentati.
- Gli ingressi a rampa/elica riguardano la svuotatura; la finitura si avvicina alla superficie con affondo.
- I messaggi generati dal server (errori e avvisi del calcolo) restano in italiano anche con l'interfaccia in inglese.
- Il progetto (.ccam) contiene progetto e mesh; i percorsi calcolati si rigenerano all'apertura (Ricalcola tutto).
  Si aprono anche i file `.pcam` e `.m3dz` salvati con i nomi precedenti del programma (PocketCAM, Mini3D CAM).
