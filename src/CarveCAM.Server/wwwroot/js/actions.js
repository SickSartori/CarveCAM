// Registro unico delle azioni: menu, barra strumenti e ricerca comandi usano le stesse definizioni.
import { App, resolve, resolveAll, canUndo, canRedo, MOVABLE, operationSource } from './state.js';
import { PLANE_PRESETS } from './commands.js';
import { MODIFY_COMMANDS } from './modify.js';
import { t } from './i18n.js';
import { log } from './log.js';
import { DEMO, DEMO_OFF, demoWhy } from './demo.js';

/**
 * Ogni azione: { id, label, icon (chiave di TB), kbd, run(), enabled(), checked(), hint, tone }
 * tone: colore dell'icona coerente con la vista 3D (model, plane, sketch, op).
 * Le azioni con options ({ value, label }[]) e pick(value) diventano un elenco a discesa nella barra strumenti.
 */
export function createActions({ cmd, vp, sketch }) {
  const hasSel = () => App.selected.length > 0;
  const selIs = (...types) => () => types.includes(resolve()?.type);
  const hasOps = () => App.project.operations.length > 0;
  const movable = () => resolveAll().some(x => MOVABLE.includes(x.type));
  const planeMode = () => App.planeMode && !sketch.active;
  // comandi "Modello" fermi mentre si crea un piano, si disegna uno sketch o è selezionato un piano;
  // "Lavorazioni" fermi nello sketch
  const planeSelected = () => App.selected.some(s => s.type === 'plane');
  const modelOk = () => !App.planeMode && !App.pickMode && !sketch.active && !planeSelected();
  /** Perché i comandi "Modello" sono spenti (suggerimento della barra strumenti). */
  const modelWhy = () => (sketch.active ? t('Termina prima lo sketch')
    : App.planeMode ? t('Concludi o annulla (Esc) prima la creazione del piano')
      : planeSelected() ? t('Deseleziona prima il piano (Esc o clic nel vuoto)')
        : App.pickMode ? t('Concludi o annulla (Esc) prima la scelta del punto') : null);
  const opsOk = () => !sketch.active;
  const draw = tl => ({
    run: () => cmd.sketchTool(tl),
    checked: () => sketch.active && sketch.tool === tl,
    enabled: () => sketch.active,
  });
  const opSource = () => !!operationSource();
  const solidsSelected = () => App.selected.filter(s => s.type === 'object' || s.type === 'artifact').length;

  const list = [
    // ---- file
    { id: 'file.new', label: 'Nuovo progetto', icon: 'new', run: cmd.newProject },
    { id: 'file.open', label: 'Apri progetto…', icon: 'open', kbd: 'Ctrl+O', run: cmd.openProject },
    { id: 'file.save', label: 'Salva progetto', icon: 'save', kbd: 'Ctrl+S', run: () => cmd.saveProject() },
    { id: 'file.saveAs', label: 'Salva con nome…', icon: 'saveAs', kbd: 'Ctrl+Shift+S', run: cmd.saveProjectAs },
    { id: 'file.rename', label: 'Rinomina progetto…', icon: 'rename', run: cmd.renameProject },
    { id: 'file.import', label: 'Importa modello 3D…', short: 'Importa', icon: 'import', kbd: 'Ctrl+I', tone: 'model', run: cmd.importModel, enabled: modelOk, whyOff: modelWhy,
      hint: 'STL, OBJ, PLY, OFF, glTF/GLB, FBX, 3MF, DAE, 3DS, STEP, IGES…' },
    { id: 'file.gcode', label: 'Esporta G-code…', short: 'G-code', icon: 'gcode', run: () => cmd.exportGcode(), enabled: hasOps },
    { id: 'file.cl', label: 'Esporta CL data…', icon: 'cldata', run: () => cmd.exportCl(), enabled: hasOps },
    { id: 'file.recovery', label: 'Copie di sicurezza…', icon: 'history', run: cmd.recoveryCopies,
      hint: 'Copie del progetto salvate automaticamente sul server mentre lavori' },
    { id: 'file.demo', label: 'Progetto di esempio', icon: 'demo', run: cmd.demoProject,
      hint: 'Targa con logo e scritta in rilievo: tre lavorazioni calcolate subito, pronte da simulare' },
    { id: 'file.home', label: 'Schermata iniziale', icon: 'home', run: () => cmd.home?.(),
      hint: 'Nuovo progetto, apertura, progetti recenti, esempio e guida' },
    // ---- modifica
    { id: 'edit.undo', label: 'Annulla', icon: 'undo', kbd: 'Ctrl+Z', run: cmd.undo, enabled: canUndo },
    { id: 'edit.redo', label: 'Ripeti', icon: 'redo', kbd: 'Ctrl+Y', run: cmd.redo, enabled: canRedo },
    { id: 'edit.duplicate', label: 'Duplica', icon: 'duplicate', kbd: 'Ctrl+D', run: cmd.duplicateSelected, enabled: hasSel },
    { id: 'edit.delete', label: 'Elimina', icon: 'trash', kbd: 'Canc', run: cmd.deleteSelected, enabled: hasSel },
    { id: 'edit.lock', label: 'Blocca / sblocca selezione', icon: 'lock', kbd: 'Ctrl+L', run: () => cmd.toggleLock(), enabled: movable,
      hint: 'Un elemento bloccato non si può spostare né ruotare' },
    { id: 'edit.origin', label: 'Sposta origine…', short: 'Origine', icon: 'origin', tone: 'model', run: () => cmd.moveOrigin(), enabled: modelOk, whyOff: modelWhy,
      hint: 'Nuova origine dal minimo, medio o massimo dell\'ingombro dei solidi, per ogni asse, più un offset: tutto il progetto viene traslato (anche gli elementi bloccati)' },
    // ---- comandi di modifica (entità degli sketch ed elementi 3D)
    ...MODIFY_COMMANDS.map(([k, label, icon, key, hint]) => ({
      id: `xf.${k}`, label, icon, kbd: `Shift+${key}`, hint, run: () => cmd.modify(k),
      enabled: () => !cmd.modifyWhy(k), whyOff: () => cmd.modifyWhy(k), checked: () => cmd.modifyKind() === k,
    })),
    { id: 'gizmo.move', label: 'Manipolatore: sposta', short: 'Sposta', icon: 'move', kbd: 'G', run: () => cmd.setGizmo('translate'), checked: () => App.view.gizmo !== 'rotate',
      hint: 'Clic sul centro del manipolatore per scegliere un nuovo punto di riferimento' },
    { id: 'gizmo.rotate', label: 'Manipolatore: ruota', short: 'Ruota', icon: 'rotate', kbd: 'R', run: () => cmd.setGizmo('rotate'), checked: () => App.view.gizmo === 'rotate' },
    { id: 'gizmo.snap', label: 'Aggancio manipolatore 1 mm / 15°', icon: 'snap', run: cmd.toggleGizmoSnap, checked: () => App.view.gizmoSnap },
    { id: 'gizmo.local', label: 'Manipolatore su assi locali', icon: 'local', run: cmd.toggleGizmoSpace, checked: () => App.view.gizmoLocal },
    // ---- punti di origine (zero pezzo del G-code)
    { id: 'origin.pick', label: 'Nuova origine da un punto…', short: 'Origine', icon: 'refPoint', tone: 'model', run: cmd.originFromPoint, enabled: modelOk, whyOff: modelWhy,
      hint: 'Clic su un punto della scena (si aggancia ai vertici): il punto potrà essere lo zero pezzo del G-code' },
    { id: 'origin.coords', label: 'Nuova origine da coordinate…', icon: 'refPoint', tone: 'model', run: cmd.originFromCoords, enabled: modelOk, whyOff: modelWhy,
      hint: 'Punto di origine con coordinate o punti notevoli dell\'ingombro dei solidi' },
    // ---- artefatti
    { id: 'art.cylinder', label: 'Cilindro', icon: 'cylinder', tone: 'model', run: () => cmd.addArtifact('cylinder'), enabled: modelOk, whyOff: modelWhy, hint: 'Inserisci un artefatto cilindrico (ostacolo)' },
    { id: 'art.cone', label: 'Tronco di cono', icon: 'cone', tone: 'model', run: () => cmd.addArtifact('cone'), enabled: modelOk, whyOff: modelWhy, hint: 'Inserisci un tronco di cono' },
    { id: 'art.sphere', label: 'Sfera', icon: 'sphere', tone: 'model', run: () => cmd.addArtifact('sphere'), enabled: modelOk, whyOff: modelWhy, hint: 'Inserisci una sfera' },
    { id: 'art.box', label: 'Parallelepipedo', icon: 'box', tone: 'model', run: () => cmd.addArtifact('box'), enabled: modelOk, whyOff: modelWhy, hint: 'Inserisci un parallelepipedo' },
    // ---- solidi: profilo estruso e operazioni booleane
    { id: 'model.extrude', label: 'Estrudi profilo…', short: 'Estrudi', icon: 'extrude', tone: 'model', run: cmd.extrudeProfile,
      enabled: () => modelOk() && opSource(), whyOff: () => modelWhy() || t('Seleziona prima uno sketch (o alcune sue entità) da estrudere'),
      hint: 'Estrude in linea retta, perpendicolare al piano, i contorni dello sketch o delle entità selezionate: il solido diventa un artefatto' },
    ...[['union', 'Unione', 'boolUnion', 'Un solo solido con il volume di tutti i solidi selezionati'],
      ['subtract', 'Sottrazione', 'boolSubtract', 'Il primo solido selezionato meno gli altri'],
      ['intersect', 'Intersezione', 'boolIntersect', 'Solo il volume comune a tutti i solidi selezionati']].map(([k, label, icon, hint]) => ({
      id: `bool.${k}`, label: `${label}…`, icon, tone: 'model', run: () => cmd.booleanSolids(k), hint,
      enabled: () => modelOk() && solidsSelected() >= 2,
      whyOff: () => modelWhy() || t('Seleziona almeno due solidi (oggetti o artefatti) con Ctrl+clic'),
    })),
    // ---- piani
    { id: 'plane.add', label: 'Aggiungi piano', short: 'Aggiungi piano', icon: 'planeAdd', tone: 'plane', run: cmd.togglePlaneMode,
      checked: () => App.planeMode, enabled: () => !sketch.active,
      hint: 'Attiva i comandi di creazione dei piani: piano standard, da faccia, da 3 punti, dalla vista' },
    { id: 'plane.preset', label: 'Piano standard', icon: 'plane', tone: 'plane', enabled: planeMode,
      options: PLANE_PRESETS.map(p => ({ value: p.id, label: p.label })), pick: v => cmd.addPlane(v),
      hint: 'Piano allineato agli assi, appoggiato all\'ingombro del modello' },
    ...PLANE_PRESETS.map(p => ({ id: `plane.${p.id}`, label: `Piano ${p.label}`, icon: 'plane', tone: 'plane', run: () => cmd.addPlane(p.id), enabled: planeMode, menuOnly: true })),
    { id: 'plane.face', label: 'Piano da faccia (clic su superficie)', short: 'Da faccia', icon: 'planeFace', tone: 'plane', run: cmd.planeFromFace, enabled: planeMode },
    { id: 'plane.3pt', label: 'Piano da 3 punti', short: 'Da 3 punti', icon: 'plane3pt', tone: 'plane', run: cmd.planeFrom3Points, enabled: planeMode },
    { id: 'plane.view', label: 'Piano dalla vista', short: 'Da vista', icon: 'planeView', tone: 'plane', run: cmd.planeFromView, enabled: planeMode,
      hint: 'Normale verso chi guarda, appoggiato al modello, asse X come la destra dello schermo. Orienta prima la vista con il cubo.' },
    { id: 'plane.flip', label: 'Inverti normale del piano', icon: 'flip', tone: 'plane', run: () => cmd.flipNormal(resolve()?.item.id),
      enabled: () => resolve()?.type === 'plane' && !resolve().item.locked },
    { id: 'plane.normalView', label: 'Vista normale al piano', icon: 'viewNormal', tone: 'plane', run: () => cmd.viewNormal(), enabled: selIs('plane', 'sketch', 'entity', 'operation') },
    // ---- sketch
    { id: 'sketch.new', label: 'Nuovo sketch sul piano', short: 'Nuovo sketch', icon: 'sketchNew', tone: 'sketch', run: () => cmd.newSketch(),
      enabled: () => resolve()?.type === 'plane' && !sketch.active, hint: 'Seleziona prima il piano su cui disegnare' },
    { id: 'sketch.edit', label: 'Modifica sketch selezionato', icon: 'sketchEdit', tone: 'sketch', run: () => cmd.editSketch(),
      enabled: () => { const r = resolve(); return !!r && (r.type === 'sketch' || r.type === 'entity' || (r.type === 'plane' && r.item.sketches.length > 0)); } },
    { id: 'sketch.finish', label: 'Termina sketch', icon: 'sketchDone', tone: 'sketch', kbd: 'Esc', run: cmd.finishSketch, enabled: () => sketch.active },
    { id: 'tool.select', label: 'Seleziona entità', icon: 'select', tone: 'sketch', kbd: 'S', ...draw('select') },
    { id: 'tool.polyline', label: 'Polilinea', icon: 'polyline', tone: 'sketch', kbd: 'L', ...draw('polyline') },
    { id: 'tool.rect', label: 'Rettangolo', icon: 'rect', tone: 'sketch', kbd: 'R', ...draw('rect') },
    { id: 'tool.circle', label: 'Cerchio', icon: 'circle', tone: 'sketch', kbd: 'C', ...draw('circle') },
    { id: 'tool.polygon', label: 'Poligono regolare', icon: 'polygon', tone: 'sketch', kbd: 'P', ...draw('polygon') },
    { id: 'tool.profile', label: 'Profilo dal modello 3D', short: 'Da 3D', icon: 'profile3d', tone: 'sketch', kbd: 'D', ...draw('profile'),
      hint: 'Clic su facce (anche CAD di STEP e IGES) od oggetti: contorno proiettato sul piano, con unione, sottrazione, intersezione o contorni separati' },
    // ---- lavorazioni
    { id: 'op.pocket', label: 'Nuova svuotatura (pocketing)', short: 'Svuotatura', icon: 'pocket', tone: 'op', run: () => cmd.newOperation('pocket'), enabled: () => opsOk() && opSource(),
      hint: 'Seleziona uno sketch, o una o più entità dello stesso sketch. Terrazze dal piano fino a ridosso degli oggetti' },
    { id: 'op.finish', label: 'Nuova finitura (finishing)', short: 'Finitura', icon: 'finish', tone: 'op', run: () => cmd.newOperation('finish'), enabled: () => opsOk() && opSource(),
      hint: 'Seleziona uno sketch, o una o più entità dello stesso sketch. Percorso proiettato lungo la normale sulle superfici' },
    { id: 'op.compute', label: 'Calcola lavorazione selezionata', icon: 'compute', kbd: 'F9', run: cmd.computeSelected, enabled: () => opsOk() && hasOps() },
    { id: 'op.computeAll', label: 'Ricalcola tutto', short: 'Ricalcola tutto', icon: 'computeAll', run: cmd.computeAll, enabled: () => opsOk() && hasOps(),
      hint: 'Ricalcola tutte le lavorazioni esistenti' },
    { id: 'op.simulateAll', label: 'Simula tutto', short: 'Simula tutto', icon: 'simulate', run: cmd.simulateAll, enabled: () => opsOk() && hasOps(),
      hint: 'Simula tutte le lavorazioni in sequenza, dalla prima all\'ultima' },
    { id: 'op.simulate', label: 'Simula lavorazione selezionata', icon: 'simulate', run: () => cmd.simulate(), enabled: () => opsOk() && selIs('operation')() },
    { id: 'op.reorder', label: 'Riordina lavorazioni…', icon: 'reorder', tone: 'op', run: () => cmd.reorderOperations(), enabled: () => opsOk() && App.project.operations.length > 1,
      hint: 'Cambia la sequenza delle lavorazioni (anche trascinandole nel navigatore)' },
    // ---- strumenti
    { id: 'tools.library', label: 'Magazzino utensili…', short: 'Utensili', icon: 'toolLib', tone: 'op', run: cmd.toolLibrary,
      hint: 'Archivio delle frese: diametro, raggio, altezza del tagliente, avanzamenti consigliati' },
    { id: 'tools.machines', label: 'Magazzino macchine…', short: 'Macchine', icon: 'machine', tone: 'op', run: cmd.machineLibrary,
      hint: 'Le tue CNC con il post-processor: sintassi, archi G2/G3 o solo G1 con le corde, movimento esatto o smooth, mandrino, refrigerante, aspirazione, cambio utensile' },
    { id: 'tools.setups', label: 'Setup di lavorazione…', icon: 'setups', tone: 'op', run: cmd.setupLibrary,
      hint: 'Parametri di lavorazione preferiti, anche in % del diametro o dell\'altezza del tagliente' },
    { id: 'tools.libExport', label: 'Esporta utensili, setup e macchine…', icon: 'saveAs', run: cmd.exportLibrary,
      hint: 'Salva magazzino utensili, setup di lavorazione e magazzino macchine in un file, per un altro computer o come copia' },
    { id: 'tools.libImport', label: 'Importa utensili, setup e macchine…', icon: 'open', run: cmd.importLibrary,
      hint: 'Aggiunge o sostituisce utensili, setup e macchine da un file esportato' },
    { id: 'tools.options', label: 'Opzioni…', icon: 'options', run: cmd.options, hint: 'Colori, frecce e cursori, lingua, griglia, tema chiaro o scuro' },
    // ---- vista
    { id: 'view.top', label: 'Vista dall\'alto', icon: 'viewTop', kbd: '7', run: () => cmd.setView('top') },
    { id: 'view.front', label: 'Vista frontale', icon: 'viewFront', kbd: '1', run: () => cmd.setView('front') },
    { id: 'view.right', label: 'Vista da destra', icon: 'viewRight', kbd: '3', run: () => cmd.setView('right') },
    { id: 'view.left', label: 'Vista da sinistra', icon: 'viewRight', run: () => cmd.setView('left') },
    { id: 'view.back', label: 'Vista posteriore', icon: 'viewFront', run: () => cmd.setView('back') },
    { id: 'view.bottom', label: 'Vista dal basso', icon: 'viewTop', run: () => cmd.setView('bottom') },
    { id: 'view.iso', label: 'Vista isometrica', icon: 'viewIso', kbd: '0', run: () => cmd.setView('iso') },
    { id: 'view.fit', label: 'Adatta alla vista', icon: 'fit', kbd: 'F', run: cmd.fit },
    { id: 'view.ortho', label: 'Proiezione ortogonale', icon: 'ortho', kbd: '5', run: cmd.toggleProjection, checked: () => vp.isOrtho },
    { id: 'view.grid', label: 'Griglia', icon: 'grid', run: cmd.toggleGrid, checked: () => App.view.grid },
    { id: 'view.paths', label: 'Percorsi utensile', icon: 'paths', run: cmd.toggleToolpaths, checked: () => App.view.toolpaths },
    { id: 'view.rapids', label: 'Movimenti rapidi', icon: 'rapids', run: cmd.toggleRapids, checked: () => App.view.rapids },
    { id: 'view.wire', label: 'Fil di ferro', icon: 'wire', run: cmd.toggleWireframe, checked: () => App.view.wireframe },
    // ---- aiuto
    { id: 'help.guide', label: 'Guida di CarveCAM…', icon: 'help', kbd: 'F1', run: () => cmd.guide?.(),
      hint: 'Guida illustrata per chi comincia: interfaccia, flusso di lavoro, lavorazioni, utensili, G-code' },
    { id: 'help.palette', label: 'Cerca un comando…', icon: 'search', kbd: 'Ctrl+K', run: () => cmd.openPalette?.() },
    { id: 'help.shortcuts', label: 'Scorciatoie da tastiera', icon: 'keyboard', run: cmd.shortcuts },
    { id: 'help.log', label: 'File di log…', icon: 'log', run: cmd.showLog, hint: 'Registro di diagnostica di server e interfaccia, per cercare errori e blocchi' },
    { id: 'help.blackbox', label: 'Esporta blackbox…', icon: 'blackbox', run: cmd.exportBlackbox,
      hint: 'Archivio protetto da password con tutti i dati per riprodurre un problema da segnalare' },
    { id: 'help.about', label: 'Informazioni su CarveCAM…', icon: 'info', run: cmd.about, hint: 'Versione, crediti di sviluppo e componenti di terze parti' },
    { id: 'help.updates', label: 'Aggiornamenti…', icon: 'import', run: cmd.updates, hint: 'Cerca una versione nuova di CarveCAM e installala' },
  ];
  for (const a of list) {
    a.label = t(a.label);
    if (a.short) a.short = t(a.short);
    if (a.hint) a.hint = t(a.hint);
    if (a.options) for (const o of a.options) o.label = t(o.label);
    if (DEMO && DEMO_OFF.has(a.id)) { a.enabled = () => false; a.whyOff = demoWhy; }   // prova online: vedi demo.js
  }
  // le etichette dei piani standard nel menu: "Piano " + preset tradotto
  for (const p of PLANE_PRESETS) {
    const a = list.find(x => x.id === `plane.${p.id}`);
    if (a) a.label = `${t('Piano')} ${t(p.label)}`;
  }

  const map = new Map(list.map(a => [a.id, a]));
  return {
    get: id => map.get(id),
    all: () => list,
    isEnabled: a => (a.enabled ? !!a.enabled() : true),
    isChecked: a => (a.checked ? !!a.checked() : false),
    run(id) {
      const a = typeof id === 'string' ? map.get(id) : id;
      if (a && (a.enabled ? a.enabled() : true) && a.run) {
        log.action(a.id);
        try {
          const r = a.run();
          if (r && typeof r.catch === 'function') r.catch(e => log.error(`Azione ${a.id} non riuscita`, e));
        } catch (e) { log.error(`Azione ${a.id} non riuscita`, e); throw e; }
      }
    },
    pick(a, value) {
      if (!a || !a.pick || (a.enabled && !a.enabled())) return;
      log.action(`${a.id}:${value}`);
      a.pick(value);
    },
  };
}

/** Menu a tendina: id azione, '-' separatore, { head } intestazione, { recent: true } progetti recenti. */
export const MENUS = [
  { label: 'File', items: ['file.home', '-', 'file.new', 'file.open', 'file.save', 'file.saveAs', 'file.rename', '-', { recent: true }, '-', 'file.import', '-', 'file.gcode', 'file.cl', '-', 'file.recovery', 'file.demo'] },
  { label: 'Modifica', items: ['edit.undo', 'edit.redo', '-', 'edit.duplicate', 'edit.delete', 'edit.lock', '-', { head: 'Trasforma la selezione' }, ...MODIFY_COMMANDS.map(c => `xf.${c[0]}`), '-', 'edit.origin', '-', { head: 'Manipolatore' }, 'gizmo.move', 'gizmo.rotate', 'gizmo.snap', 'gizmo.local'] },
  { label: 'Inserisci', items: [{ head: 'Artefatti' }, 'art.cylinder', 'art.cone', 'art.sphere', 'art.box', 'model.extrude', '-', { head: 'Punti di origine' }, 'origin.pick', 'origin.coords', '-', 'file.import'] },
  { label: 'Booleane', items: [{ head: 'Operazioni tra i solidi selezionati' }, 'bool.union', 'bool.subtract', 'bool.intersect'] },
  { label: 'Origini', items: [{ head: 'Punti di origine (zero pezzo del G-code)' }, 'origin.pick', 'origin.coords', '-', 'edit.origin'] },
  { label: 'Piani', items: ['plane.add', '-', { head: 'Piani standard' }, ...['xy+', 'xy-', 'xz-', 'xz+', 'yz+', 'yz-'].map(p => `plane.${p}`), '-', 'plane.face', 'plane.3pt', 'plane.view', '-', 'plane.flip'] },
  { label: 'Sketch', items: ['sketch.new', 'sketch.edit', 'sketch.finish', '-', { head: 'Strumenti di disegno' }, 'tool.select', 'tool.polyline', 'tool.rect', 'tool.circle', 'tool.polygon', '-', 'tool.profile'] },
  { label: 'Lavorazioni', items: ['op.pocket', 'op.finish', '-', 'op.reorder', '-', 'op.compute', 'op.computeAll', '-', 'op.simulate', 'op.simulateAll', '-', 'file.gcode', 'file.cl'] },
  { label: 'Strumenti', items: ['tools.library', 'tools.setups', 'tools.machines', '-', 'tools.libExport', 'tools.libImport', '-', 'tools.options'] },
  { label: 'Vista', items: ['view.top', 'view.front', 'view.right', 'view.left', 'view.back', 'view.bottom', 'view.iso', '-', 'plane.normalView', 'view.fit', 'view.ortho', '-', 'view.grid', 'view.paths', 'view.rapids', 'view.wire'] },
  { label: 'Aiuto', items: ['help.guide', 'help.palette', 'help.shortcuts', '-', 'file.demo', 'file.home', '-', 'help.log', 'help.blackbox'] },
  { label: 'Info', items: ['help.about', 'help.updates'] },
];
for (const m of MENUS) {
  m.label = t(m.label);
  for (const it of m.items) if (it && it.head) it.head = t(it.head);
}

/**
 * Barra strumenti ordinata come il flusso di lavoro CAM. stage: fase di cui mostrare lo stato.
 * Voci: id azione, '|' separatore; { id, label: true } mostra anche il testo.
 */
export const TOOLBAR = [
  { caption: 'Progetto', items: ['file.new', 'file.open', 'file.save', '|', 'edit.undo', 'edit.redo'] },
  { caption: 'Modello', stage: 'model', items: [{ id: 'file.import', label: true }, 'art.cylinder', 'art.cone', 'art.sphere', 'art.box', 'model.extrude', '|', 'edit.origin'] },
  { caption: 'Piani', stage: 'planes', items: [{ id: 'plane.add', label: true }, 'plane.preset', 'plane.face', 'plane.3pt', 'plane.view'] },
  { caption: 'Sketch', stage: 'sketch', items: ['sketch.new', '|', 'tool.select', 'tool.polyline', 'tool.rect', 'tool.circle', 'tool.polygon', 'tool.profile'] },
  { caption: 'Modifica', group: 'modify', items: MODIFY_COMMANDS.map(c => `xf.${c[0]}`),
    collapse: { icon: 'xfMove', label: 'Modifica la selezione', hint: 'Sposta, ruota, copia, scala smart, serie rettangolare e polare' } },
  { caption: 'Lavorazioni', stage: 'ops', items: [{ id: 'op.pocket', label: true }, { id: 'op.finish', label: true }] },
  { caption: 'Calcolo e uscita', stage: 'output', items: [{ id: 'op.computeAll', label: true }, { id: 'op.simulateAll', label: true }, { id: 'file.gcode', label: true }] },
  { caption: 'Vista', end: true, items: ['gizmo.move', 'gizmo.rotate', 'edit.lock', '|', 'view.grid', 'view.paths', 'view.rapids', '|', 'view.fit'] },
];
for (const g of TOOLBAR) {
  g.caption = t(g.caption);
  if (g.collapse) Object.assign(g.collapse, { label: t(g.collapse.label), hint: t(g.collapse.hint) });
}
