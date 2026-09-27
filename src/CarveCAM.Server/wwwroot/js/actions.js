// Registro unico delle azioni: menu, barra strumenti e ricerca comandi usano le stesse definizioni.
import { App, resolve, canUndo, canRedo } from './state.js';

/**
 * Ogni azione: { id, label, icon (chiave di TB), kbd, run(), enabled(), checked(), hint, tone }
 * tone: colore dell'icona coerente con la vista 3D (model, plane, sketch, op).
 */
export function createActions({ cmd, vp, sketch }) {
  const hasSel = () => !!resolve();
  const selIs = (...types) => () => types.includes(resolve()?.type);
  const hasOps = () => App.project.operations.length > 0;
  const tool = t => ({
    run: () => cmd.sketchTool(t),
    checked: () => sketch.active && sketch.tool === t,
  });

  const list = [
    // ---- file
    { id: 'file.new', label: 'Nuovo progetto', icon: 'new', run: cmd.newProject },
    { id: 'file.open', label: 'Apri progetto…', icon: 'open', kbd: 'Ctrl+O', run: cmd.openProject },
    { id: 'file.save', label: 'Salva progetto', icon: 'save', kbd: 'Ctrl+S', run: cmd.saveProject },
    { id: 'file.rename', label: 'Rinomina progetto…', icon: 'rename', run: cmd.renameProject },
    { id: 'file.import', label: 'Importa modello 3D…', short: 'Importa', icon: 'import', kbd: 'Ctrl+I', tone: 'model', run: cmd.importModel,
      hint: 'STL, OBJ, PLY, OFF, glTF/GLB, FBX, 3MF, DAE, 3DS, STEP, IGES…' },
    { id: 'file.gcode', label: 'Esporta G-code…', short: 'G-code', icon: 'gcode', run: () => cmd.exportGcode(), enabled: hasOps },
    { id: 'file.cl', label: 'Esporta CL data…', icon: 'cldata', run: () => cmd.exportCl(), enabled: hasOps },
    { id: 'file.demo', label: 'Progetto di esempio', icon: 'demo', run: cmd.demoProject },
    // ---- modifica
    { id: 'edit.undo', label: 'Annulla', icon: 'undo', kbd: 'Ctrl+Z', run: cmd.undo, enabled: canUndo },
    { id: 'edit.redo', label: 'Ripeti', icon: 'redo', kbd: 'Ctrl+Y', run: cmd.redo, enabled: canRedo },
    { id: 'edit.duplicate', label: 'Duplica', icon: 'duplicate', kbd: 'Ctrl+D', run: cmd.duplicateSelected, enabled: hasSel },
    { id: 'edit.delete', label: 'Elimina', icon: 'trash', kbd: 'Canc', run: cmd.deleteSelected, enabled: hasSel },
    { id: 'gizmo.move', label: 'Manipolatore: sposta', short: 'Sposta', icon: 'move', kbd: 'G', run: () => cmd.setGizmo('translate'), checked: () => App.view.gizmo === 'translate' },
    { id: 'gizmo.rotate', label: 'Manipolatore: ruota', short: 'Ruota', icon: 'rotate', kbd: 'R', run: () => cmd.setGizmo('rotate'), checked: () => App.view.gizmo === 'rotate' },
    { id: 'gizmo.none', label: 'Manipolatore nascosto', icon: 'noGizmo', run: () => cmd.setGizmo('none'), checked: () => App.view.gizmo === 'none' },
    { id: 'gizmo.snap', label: 'Aggancio manipolatore 1 mm / 15°', icon: 'snap', run: cmd.toggleGizmoSnap, checked: () => App.view.gizmoSnap },
    { id: 'gizmo.local', label: 'Manipolatore su assi locali', icon: 'local', run: cmd.toggleGizmoSpace, checked: () => App.view.gizmoLocal },
    // ---- artefatti
    { id: 'art.cylinder', label: 'Cilindro', icon: 'cylinder', tone: 'model', run: () => cmd.addArtifact('cylinder'), hint: 'Inserisci un artefatto cilindrico (ostacolo)' },
    { id: 'art.cone', label: 'Tronco di cono', icon: 'cone', tone: 'model', run: () => cmd.addArtifact('cone'), hint: 'Inserisci un tronco di cono' },
    { id: 'art.sphere', label: 'Sfera', icon: 'sphere', tone: 'model', run: () => cmd.addArtifact('sphere'), hint: 'Inserisci una sfera' },
    { id: 'art.box', label: 'Parallelepipedo', icon: 'box', tone: 'model', run: () => cmd.addArtifact('box'), hint: 'Inserisci un parallelepipedo' },
    // ---- piani
    { id: 'plane.xy', label: 'Nuovo piano XY (normale +Z)', short: 'Piano XY', icon: 'plane', tone: 'plane', run: () => cmd.addPlane('xy') },
    { id: 'plane.xz', label: 'Nuovo piano XZ (normale -Y)', icon: 'planeXZ', tone: 'plane', run: () => cmd.addPlane('xz') },
    { id: 'plane.yz', label: 'Nuovo piano YZ (normale +X)', icon: 'planeYZ', tone: 'plane', run: () => cmd.addPlane('yz') },
    { id: 'plane.face', label: 'Piano da faccia (clic su superficie)', short: 'Da faccia', icon: 'planeFace', tone: 'plane', run: cmd.planeFromFace },
    { id: 'plane.3pt', label: 'Piano da 3 punti', short: 'Da 3 punti', icon: 'plane3pt', tone: 'plane', run: cmd.planeFrom3Points },
    { id: 'plane.view', label: 'Piano dalla vista', short: 'Da vista', icon: 'planeView', tone: 'plane', run: cmd.planeFromView,
      hint: 'Normale verso chi guarda, appoggiato al modello, asse X come la destra dello schermo. Orienta prima la vista con il cubo.' },
    { id: 'plane.flip', label: 'Inverti normale del piano', icon: 'flip', tone: 'plane', run: () => cmd.flipNormal(resolve()?.item.id), enabled: selIs('plane') },
    { id: 'plane.normalView', label: 'Vista normale al piano', icon: 'viewNormal', tone: 'plane', run: () => cmd.viewNormal(), enabled: selIs('plane', 'sketch', 'entity', 'operation') },
    // ---- sketch
    { id: 'sketch.new', label: 'Nuovo sketch sul piano', short: 'Nuovo sketch', icon: 'sketchNew', tone: 'sketch', run: () => cmd.newSketch() },
    { id: 'sketch.edit', label: 'Modifica sketch selezionato', icon: 'sketchEdit', tone: 'sketch', run: () => cmd.editSketch(), enabled: selIs('sketch', 'entity', 'plane') },
    { id: 'sketch.finish', label: 'Termina sketch', icon: 'sketchDone', tone: 'sketch', kbd: 'Esc', run: cmd.finishSketch, enabled: () => sketch.active },
    { id: 'tool.select', label: 'Seleziona entità', icon: 'select', tone: 'sketch', kbd: 'S', ...tool('select') },
    { id: 'tool.polyline', label: 'Polilinea', icon: 'polyline', tone: 'sketch', kbd: 'L', ...tool('polyline') },
    { id: 'tool.rect', label: 'Rettangolo', icon: 'rect', tone: 'sketch', kbd: 'R', ...tool('rect') },
    { id: 'tool.circle', label: 'Cerchio', icon: 'circle', tone: 'sketch', kbd: 'C', ...tool('circle') },
    { id: 'tool.polygon', label: 'Poligono regolare', icon: 'polygon', tone: 'sketch', kbd: 'P', ...tool('polygon') },
    { id: 'tool.profile', label: 'Profilo dal modello 3D', short: 'Da 3D', icon: 'profile3d', tone: 'sketch', kbd: 'D', ...tool('profile'),
      hint: 'Clic su facce (anche CAD di STEP e IGES) od oggetti: contorno proiettato sul piano, con unione, sottrazione, intersezione o contorni separati' },
    // ---- lavorazioni
    { id: 'op.pocket', label: 'Nuova svuotatura (pocketing)', short: 'Svuotatura', icon: 'pocket', tone: 'op', run: () => cmd.newOperation('pocket'),
      hint: 'Terrazze dal piano fino a ridosso degli oggetti' },
    { id: 'op.finish', label: 'Nuova finitura (finishing)', short: 'Finitura', icon: 'finish', tone: 'op', run: () => cmd.newOperation('finish'),
      hint: 'Percorso proiettato lungo la normale sulle superfici' },
    { id: 'op.compute', label: 'Calcola lavorazione selezionata', short: 'Calcola', icon: 'compute', kbd: 'F9', run: cmd.computeSelected, enabled: hasOps },
    { id: 'op.computeAll', label: 'Calcola tutte le lavorazioni', icon: 'computeAll', run: cmd.computeAll, enabled: hasOps },
    { id: 'op.simulate', label: 'Simula percorso', short: 'Simula', icon: 'simulate', run: () => cmd.simulate(), enabled: hasOps },
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
    { id: 'help.palette', label: 'Cerca un comando…', icon: 'search', kbd: 'Ctrl+K', run: () => cmd.openPalette?.() },
    { id: 'help.shortcuts', label: 'Scorciatoie da tastiera', icon: 'keyboard', run: cmd.shortcuts },
    { id: 'help.about', label: 'Informazioni su CarveCAM', icon: 'info', run: cmd.about },
  ];

  const map = new Map(list.map(a => [a.id, a]));
  return {
    get: id => map.get(id),
    all: () => list,
    isEnabled: a => (a.enabled ? !!a.enabled() : true),
    isChecked: a => (a.checked ? !!a.checked() : false),
    run(id) {
      const a = typeof id === 'string' ? map.get(id) : id;
      if (a && (a.enabled ? a.enabled() : true)) a.run?.();
    },
  };
}

/** Menu a tendina: id azione, '-' separatore, { head } intestazione. */
export const MENUS = [
  { label: 'File', items: ['file.new', 'file.open', 'file.save', 'file.rename', '-', 'file.import', '-', 'file.gcode', 'file.cl', '-', 'file.demo'] },
  { label: 'Modifica', items: ['edit.undo', 'edit.redo', '-', 'edit.duplicate', 'edit.delete', '-', { head: 'Manipolatore' }, 'gizmo.move', 'gizmo.rotate', 'gizmo.none', 'gizmo.snap', 'gizmo.local'] },
  { label: 'Inserisci', items: [{ head: 'Artefatti' }, 'art.cylinder', 'art.cone', 'art.sphere', 'art.box', '-', 'file.import'] },
  { label: 'Piani', items: ['plane.xy', 'plane.xz', 'plane.yz', '-', 'plane.face', 'plane.3pt', 'plane.view', '-', 'plane.flip', 'plane.normalView'] },
  { label: 'Sketch', items: ['sketch.new', 'sketch.edit', 'sketch.finish', '-', { head: 'Strumenti di disegno' }, 'tool.select', 'tool.polyline', 'tool.rect', 'tool.circle', 'tool.polygon', '-', 'tool.profile'] },
  { label: 'Lavorazioni', items: ['op.pocket', 'op.finish', '-', 'op.compute', 'op.computeAll', 'op.simulate', '-', 'file.gcode', 'file.cl'] },
  { label: 'Vista', items: ['view.top', 'view.front', 'view.right', 'view.left', 'view.back', 'view.bottom', 'view.iso', '-', 'view.fit', 'view.ortho', '-', 'view.grid', 'view.paths', 'view.rapids', 'view.wire'] },
  { label: 'Aiuto', items: ['help.palette', 'help.shortcuts', '-', 'file.demo', 'help.about'] },
];

/**
 * Barra strumenti ordinata come il flusso di lavoro CAM. stage: fase di cui mostrare lo stato.
 * Voci: id azione, '|' separatore; { id, label: true } mostra anche il testo.
 */
export const TOOLBAR = [
  { caption: 'Progetto', items: ['file.new', 'file.open', 'file.save', '|', 'edit.undo', 'edit.redo'] },
  { caption: 'Modello', stage: 'model', items: [{ id: 'file.import', label: true }, 'art.cylinder', 'art.cone', 'art.sphere', 'art.box'] },
  { caption: 'Piani', stage: 'planes', items: ['plane.xy', 'plane.face', 'plane.3pt', 'plane.view', '|', 'plane.normalView'] },
  { caption: 'Sketch', stage: 'sketch', items: ['sketch.new', '|', 'tool.select', 'tool.polyline', 'tool.rect', 'tool.circle', 'tool.polygon', 'tool.profile'] },
  { caption: 'Lavorazioni', stage: 'ops', items: [{ id: 'op.pocket', label: true }, { id: 'op.finish', label: true }] },
  { caption: 'Calcolo e uscita', stage: 'output', items: [{ id: 'op.compute', label: true, primary: true }, { id: 'op.simulate', label: true }, { id: 'file.gcode', label: true }] },
  { caption: 'Vista', end: true, items: ['gizmo.move', 'gizmo.rotate', '|', 'view.grid', 'view.paths', 'view.rapids', '|', 'view.fit'] },
];
