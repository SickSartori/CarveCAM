// Contenuti della guida, in italiano e in inglese (L(it, en)). Nei testi: [[icona]] inserisce un'icona dei
// comandi (TB in icons.js), {{tasto}} un tasto. Blocchi: p, h3, ul, steps, grid, art (illustrazione di
// guide-art.js), shot (schermata reale con richiami numerati: wwwroot/img/guide, vedi tools/guide-shots.mjs),
// tip, warn, act (pulsanti: azione del programma, "Mostrami" un elemento dell'interfaccia, altro capitolo),
// flow (fasi del lavoro), keys (scorciatoie).
import { LANG } from './i18n.js';

export const L = (it, en) => (LANG === 'en' ? en : it);

const p = html => ({ k: 'p', html });
const h3 = text => ({ k: 'h3', text });
const ul = items => ({ k: 'ul', items });
const steps = items => ({ k: 'steps', items });
const grid = items => ({ k: 'grid', items });
const art = name => ({ k: 'art', name });
const shot = (name, callouts, caption) => ({ k: 'shot', name, callouts, caption });
const tip = html => ({ k: 'tip', html });
const warn = html => ({ k: 'warn', html });
const act = items => ({ k: 'act', items });
const S = (n, html) => ({ n, html });
const show = (sel, label) => ({ show: sel, label: label || L('Mostrami', 'Show me'), icon: 'search' });
const run = (action, label, icon) => ({ action, label, icon });
const go = (page, label) => ({ page, label, icon: 'help' });

/** Capitoli della guida, nell'ordine del lavoro. */
export function guidePages() {
  return [
    {
      id: 'start', icon: 'demo', title: L('Benvenuto in CarveCAM', 'Welcome to CarveCAM'), nav: L('Benvenuto', 'Welcome'),
      blocks: [
        p(L('CarveCAM prepara il lavoro della tua fresatrice CNC: parti da un <b>modello 3D</b> (o da forme semplici disegnate al momento), scegli <b>dove</b> e <b>come</b> lavorare, e il programma calcola i <b>percorsi della fresa</b>, li controlla, li <b>simula</b> e scrive il <b>G-code</b> per la macchina.',
          'CarveCAM prepares the work for your CNC milling machine: start from a <b>3D model</b> (or simple shapes drawn on the spot), choose <b>where</b> and <b>how</b> to cut, and the program computes the <b>tool paths</b>, checks them, <b>simulates</b> them and writes the <b>G-code</b> for the machine.')),
        { k: 'flow' },
        p(L('Ogni progetto segue sempre queste fasi, nello stesso ordine dei gruppi della barra strumenti:', 'Every project always goes through these stages, in the same order as the toolbar groups:')),
        steps([
          { icon: 'import', html: L('<b>Modello</b>: importa il pezzo (STL, STEP, OBJ…) o inserisci forme semplici, gli <i>artefatti</i>.', '<b>Model</b>: import the part (STL, STEP, OBJ…) or insert simple shapes, the <i>primitives</i>.') },
          { icon: 'planeAdd', html: L('<b>Piano di lavoro</b>: dice da che parte lavora la fresa. La normale del piano (le frecce blu) è l\'asse utensile.', '<b>Work plane</b>: tells which side the cutter works from. The plane normal (the blue arrows) is the tool axis.') },
          { icon: 'sketchNew', html: L('<b>Sketch</b>: sul piano disegni il contorno della zona da lavorare.', '<b>Sketch</b>: on the plane you draw the outline of the area to machine.') },
          { icon: 'pocket', html: L('<b>Lavorazione</b>: <i>svuotatura</i> per togliere il grosso del materiale, <i>finitura</i> per la superficie; scegli fresa e parametri.', '<b>Operation</b>: <i>pocketing</i> to remove most of the material, <i>finishing</i> for the surface; choose cutter and parameters.') },
          { icon: 'computeAll', html: L('<b>Calcolo e simulazione</b>: i percorsi vengono calcolati e verificati contro il modello; con la simulazione li vedi eseguire.', '<b>Compute and simulate</b>: tool paths are computed and checked against the model; the simulation shows them running.') },
          { icon: 'gcode', html: L('<b>G-code</b>: esporti il programma per il controllo della macchina (GRBL, Fanuc/ISO).', '<b>G-code</b>: export the program for the machine controller (GRBL, Fanuc/ISO).') },
        ]),
        tip(L('Il modo più rapido per capire come funziona: apri il <b>progetto di esempio</b>. È una targa con il logo e la scritta in rilievo, con tre lavorazioni già pronte: premi [[simulate]] <b>Simula tutto</b> e guarda.',
          'The quickest way to see how it works: open the <b>sample project</b>. It is a plaque with the logo and lettering in relief, with three operations ready: press [[simulate]] <b>Simulate all</b> and watch.')),
        act([run('file.demo', L('Apri il progetto di esempio', 'Open the sample project'), 'demo'), go('ui', L('Continua: l\'interfaccia', 'Next: the interface'))]),
        h3(L('Come usare questa guida', 'How to use this guide')),
        ul([
          L('I capitoli a sinistra sono nell\'ordine in cui servono: leggili la prima volta, poi usali come riferimento. Il campo <b>Cerca</b> trova i capitoli che contengono una parola.', 'The chapters on the left are in the order you need them: read them the first time, then use them as a reference. The <b>Search</b> field finds the chapters containing a word.'),
          L('I pulsanti <b>Mostrami</b> chiudono la guida e indicano il comando nella finestra; un clic ovunque torna alla guida.', '<b>Show me</b> buttons close the guide and point at the command in the window; a click anywhere returns to the guide.'),
          L('La guida si riapre con {{F1}}, con il pulsante [[help]] in alto a destra o dal menu <b>Aiuto</b>.', 'Reopen the guide with {{F1}}, with the [[help]] button at the top right or from the <b>Help</b> menu.'),
          L('Nelle proprietà, un <b>clic sul nome di un parametro</b> ne mostra la spiegazione.', 'In the properties, <b>click a parameter name</b> to see its explanation.'),
        ]),
      ],
    },
    {
      id: 'ui', icon: 'grid', title: L('L\'interfaccia', 'The interface'),
      blocks: [
        shot('overview', [
          S(1, L('<b>Menu</b>: tutti i comandi, raggruppati. Accanto c\'è il <b>nome del progetto</b>: clic per rinominarlo; il pallino indica modifiche non salvate.', '<b>Menus</b>: all commands, grouped. Next to them is the <b>project name</b>: click to rename it; the dot means unsaved changes.')),
          S(2, L('<b>Barra strumenti</b>: i gruppi seguono le fasi del lavoro, da sinistra a destra. La spia sotto ogni fase diventa gialla (in corso) e verde (fatto).', '<b>Toolbar</b>: the groups follow the work stages, from left to right. The light under each stage turns yellow (in progress) and green (done).')),
          S(3, L('<b>Navigatore</b>: tutti gli elementi del progetto. L\'occhio mostra o nasconde, il lucchetto blocca; le lavorazioni si trascinano per cambiarne l\'ordine.', '<b>Navigator</b>: all the project items. The eye shows or hides, the padlock locks; operations can be dragged to change their order.')),
          S(4, L('<b>Vista 3D</b>: la scena. Clic per selezionare, trascina per ruotare.', '<b>3D view</b>: the scene. Click to select, drag to orbit.')),
          S(5, L('<b>Cubo di orientamento</b> e comandi della vista (isometrica, adatta, ortogonale, normale al piano).', '<b>View cube</b> and view commands (isometric, fit, orthographic, normal to plane).')),
          S(6, L('<b>Proprietà</b> dell\'elemento selezionato: qui si cambiano tutti i parametri.', '<b>Properties</b> of the selected item: all parameters are changed here.')),
          S(7, L('<b>Barra di stato</b>: messaggi, coordinate sotto il cursore, numero di elementi.', '<b>Status bar</b>: messages, coordinates under the cursor, item counts.')),
          S(8, L('<b>Cerca un comando</b> ({{Ctrl+K}}) e stato del <b>server di calcolo</b> (verde = connesso).', '<b>Search a command</b> ({{Ctrl+K}}) and status of the <b>computing server</b> (green = connected).')),
        ], L('La finestra di CarveCAM con il progetto di esempio', 'The CarveCAM window with the sample project')),
        act([show('#menubar', L('Mostrami i menu', 'Show me the menus')), show('#toolbar', L('Mostrami la barra strumenti', 'Show me the toolbar')),
          show('#tree-panel', L('Mostrami il navigatore', 'Show me the navigator')), show('#props-panel', L('Mostrami le proprietà', 'Show me the properties'))]),
        h3(L('La barra strumenti segue il lavoro', 'The toolbar follows the work')),
        shot('toolbar', [
          S(1, L('<b>Progetto</b>: nuovo, apri, salva, annulla e ripeti.', '<b>Project</b>: new, open, save, undo and redo.')),
          S(2, L('<b>Modello</b>: importa, artefatti, sposta origine.', '<b>Model</b>: import, primitives, move origin.')),
          S(3, L('<b>Piani</b>: aggiungi piano e i modi per crearlo.', '<b>Planes</b>: add plane and the ways to create it.')),
          S(4, L('<b>Sketch</b>: nuovo sketch e strumenti di disegno.', '<b>Sketch</b>: new sketch and drawing tools.')),
          S(5, L('<b>Modifica</b>: sposta, ruota, copia, allinea, scala smart e serie (con la finestra stretta, in un solo pulsante con menu).', '<b>Edit</b>: move, rotate, copy, align, smart scale and arrays (in a narrow window, in a single button with a menu).')),
          S(6, L('<b>Lavorazioni</b>: svuotatura e finitura.', '<b>Operations</b>: pocketing and finishing.')),
          S(7, L('<b>Calcolo e uscita</b>: ricalcola tutto, simula tutto, G-code.', '<b>Compute and output</b>: recompute all, simulate all, G-code.')),
          S(8, L('<b>Vista</b>: manipolatore, blocco, griglia, percorsi, rapidi, adatta.', '<b>View</b>: gizmo, lock, grid, paths, rapids, fit.')),
        ]),
        tip(L('Un comando spento non è utilizzabile in quel momento: passa sopra con il mouse e il suggerimento dice perché (per esempio "Premi prima Aggiungi piano"). Con {{Ctrl+K}} trovi qualunque comando scrivendone il nome.',
          'A greyed-out command cannot be used right now: hover it and the tooltip tells you why (for example "Press Add plane first"). With {{Ctrl+K}} you find any command by typing its name.')),
      ],
    },
    {
      id: 'view', icon: 'viewIso', title: L('Muoversi nella vista 3D', 'Moving around the 3D view'), nav: L('Vista 3D', '3D view'),
      blocks: [
        art('mouse'),
        ul([
          L('<b>Ruota</b>: trascina con il tasto sinistro. <b>Trasla</b>: tasto destro o centrale. <b>Zoom</b>: rotella, verso il punto sotto il cursore.', '<b>Orbit</b>: drag with the left button. <b>Pan</b>: right or middle button. <b>Zoom</b>: wheel, towards the point under the cursor.'),
          L('<b>Selezione</b>: clic su un elemento; {{Ctrl}}+clic aggiunge o toglie. Un clic nel vuoto deseleziona; {{Esc}} anche.', '<b>Selection</b>: click an item; {{Ctrl}}+click adds or removes. A click on empty space deselects; so does {{Esc}}.'),
          L('Doppio clic su un piano apre il suo sketch.', 'Double-click a plane to open its sketch.'),
        ]),
        h3(L('Cubo di orientamento', 'View cube')),
        p(L('In alto a destra: clic su una faccia (Alto, Fronte, Destra…), su uno spigolo o un vertice per una delle 26 viste standard; trascinalo per ruotare. Sotto il cubo: [[viewIso]] vista isometrica, [[fit]] adatta alla vista, [[ortho]] proiezione ortogonale, [[viewNormal]] vista normale al piano selezionato.',
          'At the top right: click a face (Top, Front, Right…), an edge or a corner for one of the 26 standard views; drag it to orbit. Under the cube: [[viewIso]] isometric view, [[fit]] zoom to fit, [[ortho]] orthographic projection, [[viewNormal]] view normal to the selected plane.')),
        { k: 'keys', rows: [['7', L('Vista dall\'alto', 'Top view')], ['1', L('Vista frontale', 'Front view')], ['3', L('Vista da destra', 'Right view')], ['0', L('Vista isometrica', 'Isometric view')], ['F', L('Adatta alla vista', 'Zoom to fit')], ['5', L('Prospettica ↔ ortogonale', 'Perspective ↔ orthographic')]] },
        act([show('#view-tools', L('Mostrami il cubo', 'Show me the cube'))]),
        tip(L('In <b>Strumenti › Opzioni › Avvio</b> puoi memorizzare la vista attuale (orientamento e zoom): diventa quella di partenza e quella del comando Vista isometrica.', 'In <b>Tools › Options › Startup</b> you can store the current view (orientation and zoom): it becomes the startup view and the one of the Isometric view command.')),
      ],
    },
    {
      id: 'model', icon: 'import', title: L('Modelli e artefatti', 'Models and primitives'),
      blocks: [
        p(L('[[import]] <b>File › Importa modello 3D</b> ({{Ctrl+I}}), oppure trascina i file nella vista. Formati: <b>STL, OBJ, PLY, OFF</b> (letti dal server), <b>glTF/GLB, FBX, 3MF, DAE, 3DS, AMF, VRML</b> (convertiti nel browser), <b>STEP, IGES, BREP</b> (modelli CAD, con le facce vere per i profili da 3D).',
          '[[import]] <b>File › Import 3D model</b> ({{Ctrl+I}}), or drag the files onto the view. Formats: <b>STL, OBJ, PLY, OFF</b> (read by the server), <b>glTF/GLB, FBX, 3MF, DAE, 3DS, AMF, VRML</b> (converted in the browser), <b>STEP, IGES, BREP</b> (CAD models, with the real faces for profiles from 3D).')),
        tip(L('Le unità sono i <b>millimetri</b>. Se il modello è in un\'altra unità, correggi la <b>scala</b> nelle sue proprietà.', 'Units are <b>millimetres</b>. If the model uses another unit, fix its <b>scale</b> in the properties.')),
        h3(L('Artefatti', 'Primitives')),
        p(L('Forme parametriche da inserire con un clic: misure e posizione si cambiano nelle proprietà, anche con le freccette. Servono come pezzi semplici o come <b>ostacoli</b> da non toccare (morsetti, staffe, perni).', 'Parametric shapes inserted with one click: size and position are changed in the properties, also with the arrows. Use them as simple parts or as <b>obstacles</b> not to touch (vices, clamps, pins).')),
        grid([
          { icon: 'cylinder', title: L('Cilindro', 'Cylinder'), html: L('raggio e altezza', 'radius and height') },
          { icon: 'cone', title: L('Tronco di cono', 'Truncated cone'), html: L('due raggi e altezza', 'two radii and height') },
          { icon: 'sphere', title: L('Sfera', 'Sphere'), html: L('raggio', 'radius') },
          { icon: 'box', title: L('Parallelepipedo', 'Box'), html: L('tre lati', 'three sides') },
        ]),
        h3(L('Posizionare gli elementi', 'Placing items')),
        ul([
          L('[[move]] {{G}} sposta e [[rotate]] {{R}} ruota con il <b>manipolatore</b>. Clic sul suo centro: compaiono dei pallini verdi sui vertici e il clic su uno di essi lo sceglie come punto di riferimento.', '[[move]] {{G}} moves and [[rotate]] {{R}} rotates with the <b>gizmo</b>. Click its centre: green dots appear on the vertices and clicking one makes it the reference point.'),
          L('[[reposition]] <b>Riposiziona…</b> (proprietà, gruppo Posizionamento): per ogni asse minimo, centro o massimo, e <b>Appoggia su Z=0</b>.', '[[reposition]] <b>Reposition…</b> (properties, Positioning group): minimum, centre or maximum for each axis, and <b>Rest on Z=0</b>.'),
          L('[[origin]] <b>Sposta origine</b>: trasla tutto il progetto perché l\'origine sia, per ogni asse, il minimo, il medio o il massimo dei solidi, più un offset.', '[[origin]] <b>Move origin</b>: shifts the whole project so that the origin is, for each axis, the minimum, middle or maximum of the solids, plus an offset.'),
          L('[[lock]] <b>Blocca</b> ({{Ctrl+L}}): un elemento bloccato non si sposta per errore.', '[[lock]] <b>Lock</b> ({{Ctrl+L}}): a locked item cannot be moved by mistake.'),
        ]),
        h3(L('Solidi dagli sketch e operazioni booleane', 'Solids from sketches and boolean operations')),
        ul([
          L('[[extrude]] <b>Estrudi profilo</b>: seleziona uno sketch (o alcune sue entità) e scegli altezza e direzione: i contorni diventano un solido, estruso perpendicolarmente al piano (un contorno dentro un altro è un foro). Il solido è un artefatto: altezza e direzione si cambiano nelle proprietà.', '[[extrude]] <b>Extrude profile</b>: select a sketch (or some of its entities) and choose height and direction: the outlines become a solid, extruded perpendicular to the plane (an outline inside another is a hole). The solid is a primitive: height and direction are changed in its properties.'),
          L('[[boolUnion]] <b>Booleane</b> (menu omonimo): con due o più solidi selezionati ({{Ctrl}}+clic) <b>Unione</b>, <b>Sottrazione</b> (il primo selezionato meno gli altri) o <b>Intersezione</b>. Il risultato è un nuovo oggetto; i solidi di partenza si tolgono o restano nascosti.', '[[boolUnion]] <b>Booleans</b> (menu of the same name): with two or more solids selected ({{Ctrl}}+click) <b>Union</b>, <b>Subtraction</b> (the first selected minus the others) or <b>Intersection</b>. The result is a new object; the original solids are removed or kept hidden.'),
          L('Il <b>tasto destro</b> su un elemento (nella vista o nel navigatore) apre il suo menu.', 'A <b>right-click</b> on an item (in the view or in the navigator) opens its menu.'),
        ]),
        act([show('[data-action="file.import"]', L('Mostrami Importa', 'Show me Import')), show('[data-group="model"]', L('Mostrami il gruppo Modello', 'Show me the Model group'))]),
      ],
    },
    {
      id: 'planes', icon: 'planeAdd', title: L('Piani di lavoro', 'Work planes'),
      blocks: [
        art('planeAxis'),
        p(L('Il <b>piano di lavoro</b> è il riferimento delle lavorazioni: la sua <b>normale</b> (le frecce blu) è l\'<b>asse della fresa</b>, che lavora dal lato delle frecce; le profondità si misurano dal piano verso il materiale. Di solito il piano sta sulla faccia superiore del grezzo.',
          'The <b>work plane</b> is the reference of the operations: its <b>normal</b> (the blue arrows) is the <b>cutter axis</b>, which works from the arrows side; depths are measured from the plane into the material. Usually the plane sits on the top face of the stock.')),
        steps([
          { icon: 'planeAdd', html: L('Premi <b>Aggiungi piano</b>: si accendono i comandi per crearlo ({{Esc}} annulla).', 'Press <b>Add plane</b>: the commands to create it turn on ({{Esc}} cancels).') },
          { icon: 'plane', html: L('Scegli come crearlo:', 'Choose how to create it:') },
        ]),
        grid([
          { icon: 'plane', title: L('Piano standard', 'Standard plane'), html: L('XY, XZ o YZ con normale positiva o negativa, appoggiato all\'ingombro del modello', 'XY, XZ or YZ with positive or negative normal, resting on the model bounds') },
          { icon: 'planeFace', title: L('Da faccia', 'From face'), html: L('clic su una superficie del modello', 'click a surface of the model') },
          { icon: 'plane3pt', title: L('Da 3 punti', 'From 3 points'), html: L('tre clic, con aggancio ai vertici', 'three clicks, snapping to vertices') },
          { icon: 'planeView', title: L('Dalla vista', 'From view'), html: L('normale verso di te: orienta prima la vista con il cubo', 'normal towards you: orient the view with the cube first') },
        ]),
        ul([
          L('Posizione, rotazione e dimensione si cambiano nelle proprietà o con il manipolatore; [[flip]] <b>Inverti normale</b> la gira dall\'altra parte, lasciando gli sketch dove sono.', 'Position, rotation and size are changed in the properties or with the gizmo; [[flip]] <b>Flip normal</b> turns it the other way, leaving the sketches where they are.'),
          L('Un piano <b>inclinato</b> permette di lavorare un fianco del pezzo (3+2): con GRBL il programma si ferma e spiega come piazzare il pezzo, con Fanuc/ISO usa G68.2.', 'A <b>tilted</b> plane lets you machine a side of the part (3+2): with GRBL the program pauses and explains how to place the part, with Fanuc/ISO it uses G68.2.'),
          L('Il piano attivo è pieno con il bordo continuo; gli altri sono tratteggiati e si selezionano con un clic in qualunque punto del loro riquadro.', 'The active plane is filled with a solid border; the others are dashed and are selected with a click anywhere inside their frame.'),
        ]),
        act([show('[data-action="plane.add"]', L('Mostrami Aggiungi piano', 'Show me Add plane'))]),
      ],
    },
    {
      id: 'sketch', icon: 'sketchNew', title: L('Sketch: la zona da lavorare', 'Sketch: the area to machine'), nav: L('Sketch', 'Sketch'),
      blocks: [
        p(L('Lo <b>sketch</b> è il disegno 2D sul piano che delimita dove lavora la fresa. Seleziona il piano e premi [[sketchNew]] <b>Nuovo sketch</b>: la vista si mette perpendicolare al piano e compare la barra dello sketch.',
          'The <b>sketch</b> is the 2D drawing on the plane that bounds where the cutter works. Select the plane and press [[sketchNew]] <b>New sketch</b>: the view turns perpendicular to the plane and the sketch bar appears.')),
        shot('sketch', [
          S(1, L('<b>Barra dello sketch</b>: strumenti di disegno, lati del poligono, aggancio alla griglia.', '<b>Sketch bar</b>: drawing tools, polygon sides, grid snap.')),
          S(2, L('<b>Maniglie</b> dell\'entità selezionata: trascinale per cambiarne la forma.', '<b>Handles</b> of the selected entity: drag them to change its shape.')),
          S(3, L('<b>Termina sketch</b> (o {{Esc}} con lo strumento Seleziona).', '<b>Finish sketch</b> (or {{Esc}} with the Select tool).')),
        ], L('Modifica dello sketch del progetto di esempio', 'Editing the sketch of the sample project')),
        grid([
          { icon: 'select', title: L('Seleziona {{S}}', 'Select {{S}}'), html: L('scegli le entità e trascina le maniglie', 'pick entities and drag the handles') },
          { icon: 'polyline', title: L('Polilinea {{L}}', 'Polyline {{L}}'), html: L('clic sui vertici, {{Invio}} chiude, {{Backspace}} toglie l\'ultimo', 'click the vertices, {{Enter}} closes, {{Backspace}} removes the last one') },
          { icon: 'rect', title: L('Rettangolo {{R}}', 'Rectangle {{R}}'), html: L('due angoli opposti', 'two opposite corners') },
          { icon: 'circle', title: L('Cerchio {{C}}', 'Circle {{C}}'), html: L('centro e raggio', 'centre and radius') },
          { icon: 'polygon', title: L('Poligono {{P}}', 'Polygon {{P}}'), html: L('regolare, lati nella barra', 'regular, sides in the bar') },
          { icon: 'profile3d', title: L('Da 3D {{D}}', 'From 3D {{D}}'), html: L('contorno dalle facce o dagli oggetti del modello, con unione, sottrazione, intersezione e offset', 'outline from the faces or objects of the model, with union, subtraction, intersection and offset') },
        ]),
        ul([
          L('<b>Aggancio</b> alla griglia (passo nella barra dello sketch) e ai punti delle entità esistenti. Finito il disegno di un\'entità si torna allo strumento Seleziona, con l\'entità selezionata.', '<b>Snapping</b> to the grid (step in the sketch bar) and to the points of existing entities. When an entity is finished the Select tool comes back, with the entity selected.'),
          L('Con <b>Seleziona</b> l\'entità mostra vertici, punti medi, centro e quadranti: trascinandoli si modifica (trascinare il punto medio di un lato aggiunge un vertice). {{Ctrl+Z}} annulla.', 'With <b>Select</b> the entity shows vertices, midpoints, centre and quadrants: drag them to edit it (dragging a side midpoint adds a vertex). {{Ctrl+Z}} undoes.'),
          L('Nelle proprietà il <b>rettangolo</b> ha il primo punto cliccato come riferimento e la lunghezza dei due lati: cambiando i lati il primo punto resta fermo. Il <b>poligono</b> ha anche la lunghezza del lato.', 'In the properties the <b>rectangle</b> has the first clicked point as reference and the length of its two sides: changing the sides keeps the first point fixed. The <b>polygon</b> also has the side length.'),
        ]),
        art('island'),
        p(L('Un contorno dentro un altro diventa un\'<b>isola</b> che non viene lavorata. Per lavorare solo alcune entità selezionale con {{Ctrl}}+clic prima di creare la lavorazione: il progetto di esempio usa così il rettangolo della scritta.',
          'An outline inside another becomes an <b>island</b> that is not machined. To machine only some entities, select them with {{Ctrl}}+click before creating the operation: the sample project uses the lettering rectangle this way.')),
      ],
    },
    {
      id: 'modify', icon: 'xfMove', title: L('Modificare: sposta, ruota, copia, allinea, scala, serie', 'Editing: move, rotate, copy, align, scale, arrays'), nav: L('Modifica', 'Editing'),
      blocks: [
        p(L('I comandi del gruppo <b>Modifica</b> agiscono sulla selezione: le <b>entità di uno sketch</b> (quelle selezionate, oppure tutte con lo sketch selezionato o in modifica), che restano nel loro piano, oppure gli <b>elementi 3D</b>: oggetti, artefatti, piani con i loro sketch e punti di origine.',
          'The commands of the <b>Edit</b> group work on the selection: the <b>entities of a sketch</b> (the selected ones, or all of them with the sketch selected or being edited), which stay in their plane, or the <b>3D items</b>: objects, primitives, planes with their sketches and origin points.')),
        grid([
          { icon: 'xfMove', title: L('Sposta {{Shift+M}}', 'Move {{Shift+M}}'), html: L('punto base e punto di arrivo, oppure lo spostamento, la distanza o le coordinate di arrivo scritti', 'base point and destination point, or the typed displacement, distance or destination coordinates') },
          { icon: 'xfRotate', title: L('Ruota {{Shift+R}}', 'Rotate {{Shift+R}}'), html: L('centro e due direzioni o due bordi, oppure l\'angolo scritto; nel 3D attorno a Z, X, Y o a un asse per due punti', 'centre and two directions or two edges, or the typed angle; in 3D about Z, X, Y or an axis through two points') },
          { icon: 'xfCopy', title: L('Copia {{Shift+C}}', 'Copy {{Shift+C}}'), html: L('come Sposta, lasciando l\'originale: ogni clic aggiunge una copia', 'like Move, keeping the original: each click adds a copy') },
          { icon: 'xfAlign', title: L('Allinea a {{Shift+L}}', 'Align to {{Shift+L}}'), html: L('2 punti (3 nel 3D) sul pezzo e altrettanti sul riferimento: il pezzo si sposta e ruota per combaciare', '2 points (3 in 3D) on the part and as many on the reference: the part moves and rotates to match') },
          { icon: 'xfScale', title: L('Scala smart {{Shift+S}}', 'Smart scale {{Shift+S}}'), html: L('scegli un riferimento e scrivi la misura che deve avere', 'pick a reference and type the length it must have') },
          { icon: 'xfArrayRect', title: L('Serie rettangolare {{Shift+A}}', 'Rectangular array {{Shift+A}}'), html: L('colonne e righe (e livelli nel 3D) con il passo', 'columns and rows (and levels in 3D) with their spacing') },
          { icon: 'xfArrayPolar', title: L('Serie polare {{Shift+P}}', 'Polar array {{Shift+P}}'), html: L('copie in cerchio attorno a un centro cliccato o scritto, ruotate o no', 'copies in a circle around a clicked or typed centre, rotated or not') },
        ]),
        p(L('Un pannello in basso nella vista dice cosa fare e raccoglie i valori; l\'anteprima segue il puntatore e i punti si agganciano ai vertici (nello sketch anche alla griglia). {{Invio}} applica, {{Backspace}} torna al passo precedente, {{Esc}} annulla. Ogni modifica si annulla con {{Ctrl+Z}}.',
          'A panel at the bottom of the view tells you what to do and collects the values; the preview follows the pointer and points snap to vertices (in a sketch also to the grid). {{Enter}} applies, {{Backspace}} goes back a step, {{Esc}} cancels. Every change is undone with {{Ctrl+Z}}.')),
        h3(L('Scala smart', 'Smart scale')),
        shot('modify', [
          S(1, L('Il <b>pannello</b> dice cosa fare: qui, scrivere la misura finale del riferimento.', 'The <b>panel</b> tells you what to do: here, type the final length of the reference.')),
          S(2, L('<b>Riferimento</b> attuale, <b>nuova misura</b>, <b>fattore</b> calcolato e <b>punto fisso</b>.', 'Current <b>reference</b>, <b>new length</b>, computed <b>factor</b> and <b>fixed point</b>.')),
          S(3, L('Nella vista: il riferimento in arancione, il punto fisso in giallo e l\'<b>anteprima</b> in azzurro.', 'In the view: the reference in orange, the fixed point in yellow and the <b>preview</b> in light blue.')),
        ], L('Scala smart del rettangolo della scritta nel progetto di esempio', 'Smart scale of the lettering rectangle in the sample project')),
        steps([
          { icon: 'xfScale', html: L('Clic su un <b>segmento</b> dello sketch o un <b>bordo</b> del solido, oppure su due punti: è il riferimento (il bordo di un cerchio vale il diametro).', 'Click a <b>segment</b> of the sketch or an <b>edge</b> of the solid, or two points: that is the reference (the edge of a circle counts as its diameter).') },
          { icon: 'rename', html: L('Scrivi la <b>misura finale</b> e premi {{Invio}}: il fattore di scala si calcola da solo. Resta fermo l\'estremo più vicino al clic, oppure il centro della selezione.', 'Type the <b>final length</b> and press {{Enter}}: the scale factor is worked out for you. The end nearest to the click stays put, or the centre of the selection.') },
        ]),
        tip(L('Per portare un modello importato alla misura giusta: Scala smart, clic su uno spigolo di cui conosci la lunghezza, scrivi la misura vera.', 'To bring an imported model to the right size: Smart scale, click an edge whose length you know, type the real length.')),
        h3(L('Allineare bordi e pezzi', 'Aligning edges and parts')),
        ul([
          L('<b>Ruota</b>: dopo il centro, clic su un <b>bordo</b> del pezzo come direzione di partenza; poi clic su un altro bordo per renderlo <b>parallelo</b>, oppure scrivi la <b>direzione finale</b> (per esempio 0 per allinearlo all\'asse X).', '<b>Rotate</b>: after the centre, click an <b>edge</b> of the part as the starting direction; then click another edge to make it <b>parallel</b>, or type the <b>final direction</b> (for example 0 to line it up with the X axis).'),
          L('Nel 3D l\'asse di rotazione può passare per <b>due punti</b> qualsiasi (pulsante <b>2 punti</b> nel pannello).', 'In 3D the rotation axis can go through <b>any two points</b> (<b>2 points</b> button in the panel).'),
          L('<b>Allinea a</b>: clic su 2 punti del pezzo (3 nel 3D), poi sui punti corrispondenti del riferimento. Il primo punto combacia, il secondo dà la direzione, il terzo fissa la rotazione attorno a essa; con <b>Scala</b> anche le distanze combaciano.', '<b>Align to</b>: click 2 points on the part (3 in 3D), then the matching points on the reference. The first point matches, the second gives the direction, the third fixes the rotation around it; with <b>Scale</b> the distances match too.'),
        ]),
        ul([
          L('Con {{Maiusc}} lo spostamento resta lungo un asse e la direzione finale della rotazione va a multipli di 15°.', 'With {{Shift}} the move stays along an axis and the final direction of the rotation goes in multiples of 15°.'),
          L('Sul vertice agganciato il pallino del cursore diventa arancione e più grande; la dimensione si regola nelle Opzioni (Pallini del riferimento).', 'On the snapped vertex the cursor dot turns orange and larger; its size is set in the Options (Reference dots).'),
          L('Gli elementi bloccati non si spostano, ruotano né si scalano, ma si possono copiare. Copie e serie restano selezionate.', 'Locked items cannot be moved, rotated or scaled, but they can be copied. Copies and arrays stay selected.'),
          L('Un rettangolo ruotato di un angolo che non è multiplo di 90° diventa una polilinea.', 'A rectangle rotated by an angle that is not a multiple of 90° becomes a polyline.'),
        ]),
        act([show('[data-group="modify"]', L('Mostrami il gruppo Modifica', 'Show me the Edit group'))]),
      ],
    },
    {
      id: 'ops', icon: 'pocket', title: L('Lavorazioni', 'Operations'),
      blocks: [
        art('pocketFinish'),
        grid([
          { icon: 'pocket', title: L('Svuotatura (sgrossatura)', 'Pocketing (roughing)'), html: L('scende a terrazze dal piano fino alla profondità massima e si ferma a ridosso del modello, più il sovrametallo. Strategia concentrica o a zigzag; ingresso a elica, a rampa o con affondo.', 'goes down in terraces from the plane to the maximum depth and stops close to the model, plus the stock allowance. Concentric or zigzag strategy; helix, ramp or plunge entry.') },
          { icon: 'finish', title: L('Finitura (in proiezione)', 'Finishing (projection)'), html: L('il percorso 2D (zigzag o concentrico) è proiettato sulla superficie lungo la normale: la fresa segue la forma del pezzo. Di solito con fresa sferica e passo piccolo.', 'the 2D path (zigzag or concentric) is projected onto the surface along the normal: the cutter follows the shape of the part. Usually with a ball cutter and a small stepover.') },
        ]),
        steps([
          { icon: 'sketchEdit', html: L('Seleziona lo sketch (o alcune sue entità con {{Ctrl}}+clic).', 'Select the sketch (or some of its entities with {{Ctrl}}+click).') },
          { icon: 'pocket', html: L('Premi <b>Svuotatura</b> o <b>Finitura</b>.', 'Press <b>Pocket</b> or <b>Finish</b>.') },
          { icon: 'toolLib', html: L('Scegli la <b>fresa</b> dal magazzino, poi un <b>setup</b> (parametri preferiti) o quelli predefiniti.', 'Choose the <b>cutter</b> from the library, then a <b>setup</b> (favourite parameters) or the defaults.') },
          { icon: 'options', html: L('Regola i parametri nelle <b>proprietà</b>: clic sul nome di un parametro per la spiegazione.', 'Adjust the parameters in the <b>properties</b>: click a parameter name for its explanation.') },
        ]),
        shot('operation', [
          S(1, L('<b>Contorno</b>: sketch ed entità che delimitano la zona.', '<b>Boundary</b>: sketch and entities bounding the area.')),
          S(2, L('<b>Strategia</b>: concentrica o zigzag, concorde, utensile dentro il contorno.', '<b>Strategy</b>: concentric or zigzag, climb, tool inside the boundary.')),
          S(3, L('<b>Utensile</b>: dal magazzino o personalizzato.', '<b>Tool</b>: from the library or custom.')),
          S(4, L('<b>Passi e profondità</b>: passi in % della fresa, profondità massima, sovrametallo.', '<b>Steps and depth</b>: steps as a % of the cutter, maximum depth, stock allowance.')),
        ], L('Proprietà della sgrossatura del progetto di esempio', 'Properties of the roughing operation in the sample project')),
        art('steps'),
        ul([
          L('<b>Passo laterale</b>: distanza tra passate affiancate, in % del diametro (con limiti in mm). <b>Passo verticale</b>: altezza di ogni terrazza, in % dell\'altezza del tagliente.', '<b>Stepover</b>: distance between side-by-side passes, as a % of the diameter (with limits in mm). <b>Stepdown</b>: height of each terrace, as a % of the flute length.'),
          L('<b>Profondità massima</b> dal piano; <b>sovrametallo</b>: materiale lasciato sul modello per la finitura.', '<b>Maximum depth</b> from the plane; <b>stock allowance</b>: material left on the model for finishing.'),
          L('<b>Quota di sicurezza</b> per i movimenti rapidi e <b>tolleranza</b> del calcolo.', '<b>Safe height</b> for rapid moves and computing <b>tolerance</b>.'),
          L('Se la fresa scenderebbe sotto il <b>piano della griglia</b> (Z 0, dove appoggia il pezzo) il calcolo chiede conferma: <b>Scendi sotto il piano</b> o <b>Limita al piano</b>. La scelta resta nella proprietà <i>Sotto la griglia</i>.', 'If the cutter would go below the <b>grid plane</b> (Z 0, where the part rests) the computation asks for confirmation: <b>Go below the plane</b> or <b>Limit to the plane</b>. The choice is kept in the <i>Below the grid</i> property.'),
        ]),
        art('entries'),
        art('obstacles'),
        p(L('Ogni lavorazione considera come <b>ostacoli</b> gli oggetti e gli artefatti spuntati nel gruppo <i>Ostacoli</i> delle proprietà (passando sul nome l\'ostacolo si illumina nella vista). Gli elementi aggiunti dopo non sono ostacoli finché non li spunti.',
          'Each operation treats as <b>obstacles</b> the objects and primitives checked in the <i>Obstacles</i> group of the properties (hovering a name highlights it in the view). Items added later are not obstacles until you check them.')),
        tip(L('Con un <b>grezzo</b> le lavorazioni passano solo dove c\'è materiale e ognuna parte da quello lasciato dalla precedente: vedi il capitolo successivo.', 'With a <b>stock</b> the operations pass only where there is material and each starts from what the previous one left: see the next chapter.')),
        tip(L('<b>Salva come setup…</b> (nelle proprietà) conserva i parametri per riusarli. Per cambiare l\'ordine delle lavorazioni trascinale nel navigatore o usa [[reorder]] <b>Riordina lavorazioni</b>.', '<b>Save as setup…</b> (in the properties) keeps the parameters for reuse. To change the order of the operations drag them in the navigator or use [[reorder]] <b>Reorder operations</b>.')),
      ],
    },
    {
      id: 'stock', icon: 'box', title: L('Il grezzo', 'The stock'), nav: L('Grezzo', 'Stock'),
      blocks: [
        p(L('Il <b>grezzo</b> è il blocco di materiale da cui si ricava il pezzo. Senza grezzo le lavorazioni partono dal piano e lavorano tutta l\'area del contorno; con il grezzo sanno dov\'è il materiale.', 'The <b>stock</b> is the block of material the part is cut from. Without stock the operations start from the plane and machine the whole outline; with stock they know where the material is.')),
        steps([
          { icon: 'box', html: L('Crea il solido del grezzo: un <b>parallelepipedo</b>, un modello importato o un <b>profilo estruso</b> [[extrude]] dal contorno del pezzo.', 'Create the stock solid: a <b>box</b>, an imported model or an <b>extruded profile</b> [[extrude]] from the outline of the part.') },
          { icon: 'select', html: L('<b>Tasto destro</b> sul solido › <b>Considera come grezzo</b> (o la casella <i>Grezzo</i> nelle proprietà): passa nell\'elenco <b>Grezzo</b> del navigatore e diventa semitrasparente.', '<b>Right-click</b> the solid › <b>Treat as stock</b> (or the <i>Stock</i> box in the properties): it moves to the <b>Stock</b> list of the navigator and becomes semi-transparent.') },
          { icon: 'computeAll', html: L('<b>Ricalcola tutto</b>: le lavorazioni si calcolano nell\'ordine del navigatore, ognuna dal grezzo lasciato dalla precedente.', '<b>Recompute all</b>: operations are computed in the navigator order, each from the stock left by the previous one.') },
        ]),
        shot('stock', [
          S(1, L('L\'elenco <b>Grezzo</b> del navigatore.', 'The <b>Stock</b> list of the navigator.')),
          S(2, L('Il grezzo che si erode durante la simulazione: dove la fresa è passata il materiale è sceso.', 'The stock being eroded during the simulation: where the cutter has passed the material has gone down.')),
          S(3, L('La simulazione di tutte le lavorazioni, ognuna sul grezzo lasciato dalla precedente.', 'The simulation of all the operations, each on the stock left by the previous one.')),
        ], L('Il progetto di esempio con un blocco grezzo', 'The sample project with a stock block')),
        ul([
          L('Il grezzo è il <b>materiale da togliere</b>, non un ostacolo: gli ostacoli restano i modelli e gli artefatti spuntati nella lavorazione.', 'The stock is the <b>material to remove</b>, not an obstacle: obstacles are still the models and primitives checked in the operation.'),
          L('La svuotatura parte dalla <b>sommità del grezzo</b> (anche sopra il piano, così la fresa non lo urta) e passa <b>solo dove c\'è materiale</b>: niente passate in aria. La profondità massima resta misurata dal piano.', 'Pocketing starts from the <b>top of the stock</b> (also above the plane, so the cutter does not hit it) and passes <b>only where there is material</b>: no air cuts. The maximum depth is still measured from the plane.'),
          L('La finitura salta i tratti dove la fresa non tocca materiale; le lavorazioni successive lavorano solo il <b>materiale rimasto</b> (ripresa).', 'Finishing skips the stretches where the cutter touches no material; later operations machine only the <b>remaining material</b> (rest machining).'),
          L('Funziona anche con piani diversi (lavorazioni 3+2): il grezzo lasciato da una lavorazione si ricampiona nel sistema del piano della successiva.', 'It also works with different planes (3+2 machining): the stock left by one operation is resampled in the plane system of the next.'),
          L('In <b>simulazione</b> il grezzo si erode mentre la fresa passa.', 'In the <b>simulation</b> the stock is eroded as the cutter passes.'),
        ]),
        tip(L('Con il grezzo una lavorazione dipende dalle precedenti: cambiando la prima, le successive tornano <b>da ricalcolare</b>; {{F9}} su una lavorazione calcola prima quelle precedenti non aggiornate.', 'With stock an operation depends on the previous ones: changing the first one makes the following ones <b>to recompute</b>; {{F9}} on an operation first computes the previous ones that are not up to date.')),
      ],
    },
    {
      id: 'tools', icon: 'toolLib', title: L('Utensili e setup', 'Tools and setups'),
      blocks: [
        art('tools'),
        ul([
          L('<b>Cilindrica</b>: fondo piatto e pareti dritte. <b>Torica</b>: fondo piatto con lo spigolo raccordato, robusta per sgrossare. <b>Sferica</b>: per le superfici curve in finitura.', '<b>Flat</b>: flat bottom and straight walls. <b>Bull nose</b>: flat bottom with a rounded corner, sturdy for roughing. <b>Ball</b>: for curved surfaces in finishing.'),
          L('<b>Conica</b>: punta sottile su un gambo robusto, per i dettagli fini: diametro in punta, angolo per lato, punta sferica o piatta (diametro 0 = fresa a V).', '<b>Tapered</b>: a thin tip on a sturdy body, for fine details: tip diameter, angle per side, ball or flat tip (diameter 0 = V-bit).'),
        ]),
        p(L('[[toolLib]] <b>Strumenti › Magazzino utensili</b>: l\'archivio delle frese, con numero T, misure del tagliente, del collo e del gambo, materiale e avanzamenti consigliati. L\'anteprima 3D è in scala; se le misure non sono coerenti compare il disegno 2D con l\'errore in rosso.',
          '[[toolLib]] <b>Tools › Tool library</b>: the archive of cutters, with T number, sizes of flutes, neck and shank, material and recommended feeds. The 3D preview is to scale; if the sizes are inconsistent a 2D drawing shows the error in red.')),
        shot('toollib', [], L('Il magazzino utensili con l\'anteprima 3D', 'The tool library with the 3D preview')),
        ul([
          L('[[setups]] <b>Setup di lavorazione</b>: parametri preferiti (strategia, passi, quote, ingresso, avanzamenti), proposti quando crei una lavorazione.', '[[setups]] <b>Machining setups</b>: favourite parameters (strategy, steps, heights, entry, feeds), offered when you create an operation.'),
          L('<b>Esporta / Importa utensili e setup</b> (menu Strumenti): un file da portare su un altro computer o da tenere come copia.', '<b>Export / Import tools and setups</b> (Tools menu): a file to bring to another computer or to keep as a backup.'),
          L('Il progetto salva le schede degli utensili usati: se apri il progetto su un computer dove mancano o sono diversi, CarveCAM lo segnala e può aggiornare il magazzino.', 'The project stores the cards of the tools it uses: if you open it on a computer where they are missing or different, CarveCAM tells you and can update the library.'),
        ]),
        act([run('tools.library', L('Apri il magazzino utensili', 'Open the tool library'), 'toolLib')]),
      ],
    },
    {
      id: 'compute', icon: 'computeAll', title: L('Calcolo e simulazione', 'Computing and simulation'),
      blocks: [
        steps([
          { icon: 'computeAll', html: L('<b>Ricalcola tutto</b> (o {{F9}} sulla lavorazione selezionata): i percorsi sono calcolati sul server; durante il calcolo vedi il logo animato, il tempo trascorso e <b>Annulla</b>.', '<b>Recompute all</b> (or {{F9}} on the selected operation): the paths are computed on the server; while computing you see the animated logo, the elapsed time and <b>Cancel</b>.') },
          { icon: 'compute', html: L('Nel navigatore ogni lavorazione mostra lo stato: <b>ok</b> se il percorso è aggiornato, <b>da calcolare</b> se hai cambiato qualcosa.', 'In the navigator every operation shows its state: <b>ok</b> if the path is up to date, <b>to compute</b> if you changed something.') },
          { icon: 'simulate', html: L('<b>Simula tutto</b>, o <b>Simula</b> nelle proprietà della lavorazione: la fresa percorre i movimenti con i tempi reali.', '<b>Simulate all</b>, or <b>Simulate</b> in the operation properties: the cutter runs the moves with real timing.') },
        ]),
        p(L('Ogni percorso viene <b>verificato</b> contro modelli e artefatti: la massima interferenza è nelle proprietà, gruppo <i>Calcolo e risultato</i>, con tempo stimato, metri di lavoro e numero di terrazze.',
          'Every path is <b>verified</b> against models and primitives: the maximum interference is in the properties, <i>Computing and result</i> group, with estimated time, cutting length and number of terraces.')),
        shot('simulation', [
          S(1, L('<b>Barra della simulazione</b>: avvia o metti in pausa ({{Spazio}}), torna all\'inizio, scorri, velocità.', '<b>Simulation bar</b>: play or pause ({{Space}}), rewind, scrub, speed.')),
          S(2, L('<b>Cosa simulare</b>: solo la lavorazione selezionata o anche tutte le successive.', '<b>What to simulate</b>: only the selected operation or also all the following ones.')),
          S(3, L('<b>Coordinate della punta</b> (TCP) e orientamento dell\'asse utensile.', '<b>Tool tip coordinates</b> (TCP) and tool axis orientation.')),
        ], L('Simulazione del progetto di esempio', 'Simulation of the sample project')),
        tip(L('Nel menu <b>Vista</b> puoi nascondere percorsi e movimenti rapidi. Un clic nel vuoto chiude la simulazione.', 'In the <b>View</b> menu you can hide paths and rapid moves. A click on empty space closes the simulation.')),
        act([show('[data-action="op.computeAll"]', L('Mostrami Ricalcola tutto', 'Show me Recompute all')), show('[data-action="op.simulateAll"]', L('Mostrami Simula tutto', 'Show me Simulate all'))]),
      ],
    },
    {
      id: 'gcode', icon: 'gcode', title: L('Zero pezzo ed esportazione G-code', 'Work zero and G-code export'), nav: L('G-code', 'G-code'),
      blocks: [
        art('origin'),
        p(L('Lo <b>zero pezzo</b> è il punto del pezzo da cui partono le coordinate del programma: sulla macchina lo azzeri sullo stesso punto. Di solito è uno spigolo o il centro della faccia superiore del grezzo.',
          'The <b>work zero</b> is the point of the part where program coordinates start: on the machine you zero on the same point. Usually a corner or the centre of the top face of the stock.')),
        ul([
          L('[[refPoint]] <b>Origini › Nuova origine da un punto</b> (clic nella vista, con aggancio ai vertici) o <b>da coordinate</b> (con i punti notevoli dell\'ingombro). I punti si chiamano <i>Origine 1, 2…</i> e si rinominano nelle proprietà.', '[[refPoint]] <b>Origins › New origin from a point</b> (click in the view, snapping to vertices) or <b>from coordinates</b> (with the key points of the bounds). The points are called <i>Origin 1, 2…</i> and can be renamed in the properties.'),
          L('Nelle proprietà di un\'origine <b>Sposta il punto…</b> la porta su un altro punto con un clic nella vista (con aggancio ai vertici).', 'In the properties of an origin <b>Move the point…</b> moves it to another point with a click in the view (snapping to vertices).'),
          L('[[gcode]] <b>Esporta G-code</b>: scegli il controllo, lo zero pezzo e le lavorazioni; il programma si può copiare o scaricare.', '[[gcode]] <b>Export G-code</b>: choose the controller, the work zero and the operations; the program can be copied or downloaded.'),
        ]),
        shot('export', [
          S(1, L('<b>Controllo</b>: GRBL 1.1 / grblHAL / FluidNC per le mini CNC, oppure Fanuc/ISO.', '<b>Controller</b>: GRBL 1.1 / grblHAL / FluidNC for mini CNCs, or Fanuc/ISO.')),
          S(2, L('<b>Zero pezzo</b>: l\'origine del progetto o uno dei punti di origine.', '<b>Work zero</b>: the project origin or one of the origin points.')),
          S(3, L('<b>Lavorazioni</b> da mettere nel programma, nell\'ordine del progetto.', '<b>Operations</b> to put in the program, in project order.')),
        ], L('Esportazione del G-code', 'G-code export')),
        ul([
          L('<b>GRBL</b>: 3 assi; cambi utensile e piani inclinati diventano pause <code>M0</code> con le istruzioni nei commenti.', '<b>GRBL</b>: 3 axes; tool changes and tilted planes become <code>M0</code> pauses with the instructions in the comments.'),
          L('<b>Fanuc/ISO</b>: 3 assi in coordinate mondo, oppure 3+2 con <code>G68.2</code> per i piani inclinati. [[cldata]] <b>CL data</b> (APT) per altri post-processor.', '<b>Fanuc/ISO</b>: 3 axes in world coordinates, or 3+2 with <code>G68.2</code> for tilted planes. [[cldata]] <b>CL data</b> (APT) for other post-processors.'),
        ]),
        warn(L('Controlla sempre il programma con il simulatore della tua macchina e fai la prima prova <b>in aria</b>, con lo zero alzato sopra il pezzo.', 'Always check the program with your machine simulator and do the first run <b>in the air</b>, with the zero raised above the part.')),
      ],
    },
    {
      id: 'files', icon: 'save', title: L('Progetti, salvataggio e sicurezza', 'Projects, saving and safety'), nav: L('Progetti e file', 'Projects and files'),
      blocks: [
        ul([
          L('[[save]] <b>Salva</b> ({{Ctrl+S}}): file <code>.ccam</code> con modelli e utensili usati. Con Chrome ed Edge si salva direttamente sul file aperto; il nome del progetto diventa quello del file.', '[[save]] <b>Save</b> ({{Ctrl+S}}): <code>.ccam</code> file with models and the tools used. With Chrome and Edge it saves straight to the open file; the project name becomes the file name.'),
          L('[[open]] <b>Apri</b> ({{Ctrl+O}}): gli ultimi progetti sono nel menu File e nella schermata iniziale.', '[[open]] <b>Open</b> ({{Ctrl+O}}): the latest projects are in the File menu and on the start screen.'),
          L('[[history]] <b>Copie di sicurezza</b>: il progetto è salvato di continuo nel browser e ogni minuto sul server; dopo una chiusura anomala CarveCAM chiede se recuperare le modifiche.', '[[history]] <b>Backup copies</b>: the project is saved continuously in the browser and every minute on the server; after an abnormal shutdown CarveCAM asks whether to recover the changes.'),
          L('[[options]] <b>Opzioni</b>: colori, lingua, griglia, tema chiaro o scuro, vista e schermata iniziale; si esportano e importano in un file.', '[[options]] <b>Options</b>: colours, language, grid, light or dark theme, startup view and start screen; they can be exported to and imported from a file.'),
          L('[[blackbox]] <b>Aiuto › Esporta blackbox</b>: archivio protetto da password con tutto ciò che serve all\'assistenza per riprodurre un problema. [[log]] <b>File di log</b> per la diagnostica.', '[[blackbox]] <b>Help › Export blackbox</b>: password-protected archive with everything support needs to reproduce a problem. [[log]] <b>Log file</b> for diagnostics.'),
        ]),
        tip(L('La <b>schermata iniziale</b> si riapre da <b>File › Schermata iniziale</b> o con un clic sul logo in alto a sinistra; nelle opzioni puoi scegliere se mostrarla all\'avvio.', 'The <b>start screen</b> reopens from <b>File › Start screen</b> or by clicking the logo at the top left; in the options you can choose whether to show it at startup.')),
        act([run('file.home', L('Apri la schermata iniziale', 'Open the start screen'), 'home')]),
      ],
    },
    {
      id: 'keys', icon: 'keyboard', title: L('Scorciatoie da tastiera', 'Keyboard shortcuts'), nav: L('Scorciatoie', 'Shortcuts'),
      blocks: [{ k: 'keys' }],
    },
  ];
}
