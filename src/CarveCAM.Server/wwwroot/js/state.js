// Stato dell'applicazione: progetto (documento serializzabile), selezione (anche multipla), dati runtime,
// undo/redo, eventi, autosalvataggio locale.
import { log } from './log.js';

const AUTOSAVE_KEY = 'carvecam.autosave.v2';
// formato precedente (solo il progetto) e nomi precedenti del programma (PocketCAM, Mini3D CAM)
const LEGACY_AUTOSAVE_KEYS = ['carvecam.project.v1', 'pocketcam.project.v1', 'mini3d.project.v1'];

export const PROJECT_FORMAT = 'carvecam';
const LEGACY_FORMATS = ['pocketcam', 'mini3d'];

/** Il documento è un progetto CarveCAM (anche salvato con un nome precedente). */
export function isProjectDoc(p) {
  return !!p && (p.format === PROJECT_FORMAT || LEGACY_FORMATS.includes(p.format));
}

/** File di progetto: .ccam, oppure .pcam e .m3dz delle versioni precedenti. */
export function isProjectFile(name) {
  return /\.(ccam|pcam|m3dz)$/i.test(name);
}

/** Tipi di elemento che si spostano con il manipolatore (e si possono bloccare). */
export const MOVABLE = ['object', 'artifact', 'plane', 'origin'];

export const App = {
  project: null,
  selection: null,          // elemento principale: { type: 'object'|'artifact'|'plane'|'sketch'|'entity'|'operation', id, sketchId? }
  selected: [],             // tutti gli elementi selezionati (il principale è l'ultimo)
  sketch: null,             // sketch in modifica: { planeId, sketchId }
  pickMode: null,           // modalità di selezione punti nel 3D
  planeMode: false,         // modalità "aggiungi piano": abilita i comandi di creazione dei piani
  fileHandle: null,         // file del progetto aperto/salvato (File System Access API), se disponibile
  runtime: {
    meshGeo: new Map(),     // meshId -> THREE.BufferGeometry
    meshFaces: new Map(),   // meshId -> Uint32Array: faccia B-rep di ogni triangolo (modelli CAD)
    meshLoading: new Set(),
    toolpaths: new Map(),   // operationId -> { toolpathId, hash, stats, warnings, positions, types }
  },
  view: {
    grid: true, toolpaths: true, rapids: true, wireframe: false,
    gizmo: 'translate', gizmoSnap: false, gizmoLocal: false,
  },
};

// ------------------------------------------------------------------ eventi
const listeners = new Map();
export function on(evt, fn) {
  if (!listeners.has(evt)) listeners.set(evt, new Set());
  listeners.get(evt).add(fn);
  return () => listeners.get(evt).delete(fn);
}
export function emit(evt, data) {
  const set = listeners.get(evt);
  if (set) for (const fn of [...set]) {
    try { fn(data); } catch (e) { console.error(`listener ${evt}`, e); }
  }
}

// ------------------------------------------------------------------ id e nomi
export function uid(prefix = 'id') {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

export function nextName(base) {
  const p = App.project;
  p.counters = p.counters || {};
  p.counters[base] = (p.counters[base] || 0) + 1;
  return `${base} ${p.counters[base]}`;
}

// ------------------------------------------------------------------ progetto
export function newProject() {
  return {
    format: PROJECT_FORMAT, version: 2,
    name: 'Nuovo progetto', units: 'mm',
    objects: [], artifacts: [], planes: [], operations: [],
    origins: [],            // punti di riferimento usabili come zero pezzo del G-code
    counters: {},
  };
}

function normalize(p) {
  const d = newProject();
  const r = Object.assign(d, p || {});
  r.format = PROJECT_FORMAT;
  for (const k of ['objects', 'artifacts', 'planes', 'operations', 'origins']) if (!Array.isArray(r[k])) r[k] = [];
  for (const pl of r.planes) {
    if (!Array.isArray(pl.sketches)) pl.sketches = [];
    for (const s of pl.sketches) if (!Array.isArray(s.entities)) s.entities = [];
  }
  // progetti precedenti: gli ostacoli di ogni lavorazione sono gli elementi allora inclusi nel calcolo
  const included = [...r.objects, ...r.artifacts].filter(x => x.include !== false).map(x => x.id);
  for (const op of r.operations) {
    if (!Array.isArray(op.obstacles)) op.obstacles = [...included];
    if (!op.rel || typeof op.rel !== 'object') op.rel = {};
    if (op.tool && !(op.tool.fluteLength > 0)) op.tool.fluteLength = Math.round((op.tool.diameter || 6) * 2.5 * 100) / 100;
  }
  if (r.version < 2) r.version = 2;
  return r;
}

// ------------------------------------------------------------------ undo/redo
let undoStack = [];
let redoStack = [];
const UNDO_MAX = 120;

export function snapshot() { return JSON.stringify(App.project); }

function pushUndo(snap) {
  undoStack.push(snap);
  if (undoStack.length > UNDO_MAX) undoStack.shift();
  redoStack = [];
}

/** Applica una modifica al progetto con possibilità di annullarla. */
export function mutate(fn) {
  const snap = snapshot();
  const res = fn(App.project);
  pushUndo(snap);
  changed();
  return res;
}

/** Registra come passo di undo uno snapshot preso prima di una modifica già applicata (es. trascinamento). */
export function commitSnapshot(snap) {
  if (snap === snapshot()) return;
  pushUndo(snap);
  changed();
}

/** Il progetto è stato salvato su file: nessuna modifica in sospeso. */
export function markSaved() {
  App.dirty = false;
  writeAutosave();
  emit('dirty');
}

export function canUndo() { return undoStack.length > 0; }
export function canRedo() { return redoStack.length > 0; }

export function undo() {
  if (!undoStack.length) return;
  redoStack.push(snapshot());
  App.project = normalize(JSON.parse(undoStack.pop()));
  validateSelection();
  changed();
  emit('selection');
}

export function redo() {
  if (!redoStack.length) return;
  undoStack.push(snapshot());
  App.project = normalize(JSON.parse(redoStack.pop()));
  validateSelection();
  changed();
  emit('selection');
}

function changed() {
  App.dirty = true;
  App.changeSeq = (App.changeSeq || 0) + 1;
  emit('project');
  scheduleAutosave();
}

/** Nuovo documento corrente; dirty: il progetto contiene modifiche non salvate (es. recupero dopo un arresto). */
export function setProject(p, dirty = false) {
  App.project = normalize(p);
  undoStack = []; redoStack = [];
  App.selection = null;
  App.selected = [];
  App.dirty = dirty;
  App.runtime.toolpaths.clear();
  log.info('Progetto impostato', { name: App.project.name, objects: App.project.objects.length, planes: App.project.planes.length, ops: App.project.operations.length, dirty });
  emit('project');
  emit('selection');
  emit('dirty');
  scheduleAutosave();
}

// ------------------------------------------------------------------ autosalvataggio locale (copia di sicurezza)
let saveTimer = null;
function writeAutosave() {
  clearTimeout(saveTimer);
  try {
    localStorage.setItem(AUTOSAVE_KEY, JSON.stringify({ ts: Date.now(), dirty: !!App.dirty, project: App.project }));
  } catch (e) { log.warn('Autosalvataggio locale non riuscito', e); }
}
function scheduleAutosave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(writeAutosave, 700);
}
/** Ultimo autosalvataggio: { project, dirty, ts } oppure null. */
export function loadAutosave() {
  try {
    const s = localStorage.getItem(AUTOSAVE_KEY);
    if (s) {
      const r = JSON.parse(s);
      if (r && r.project) return r;
    }
    for (const k of LEGACY_AUTOSAVE_KEYS) {
      const old = localStorage.getItem(k);
      if (old) return { project: JSON.parse(old), dirty: false, ts: 0 };
    }
  } catch { /* storage non disponibile o dati non validi */ }
  return null;
}
export function flushAutosave() { writeAutosave(); }

// ------------------------------------------------------------------ selezione e ricerca
export const sameRef = (a, b) => !!a && !!b && a.type === b.type && a.id === b.id;
const refKey = r => `${r.type}:${r.id}`;

/** Seleziona un solo elemento (null = nessuno). */
export function select(sel) {
  App.selection = sel || null;
  App.selected = sel ? [sel] : [];
  emit('selection');
}

/** Aggiunge o toglie un elemento dalla selezione (Ctrl+clic). */
export function toggleSelect(sel) {
  if (!sel) return;
  const i = App.selected.findIndex(x => sameRef(x, sel));
  if (i >= 0) App.selected.splice(i, 1);
  else App.selected.push(sel);
  App.selection = App.selected[App.selected.length - 1] || null;
  emit('selection');
}

/** Seleziona più elementi; il principale è l'ultimo. */
export function selectMany(list) {
  const seen = new Set();
  App.selected = (list || []).filter(x => x && !seen.has(refKey(x)) && seen.add(refKey(x)));
  App.selection = App.selected[App.selected.length - 1] || null;
  emit('selection');
}

export function isSelected(type, id) {
  return App.selected.some(s => s.type === type && s.id === id);
}

export const getObject = id => App.project.objects.find(o => o.id === id);
export const getArtifact = id => App.project.artifacts.find(o => o.id === id);
export const getPlane = id => App.project.planes.find(o => o.id === id);
export const getOperation = id => App.project.operations.find(o => o.id === id);
export const getOrigin = id => App.project.origins.find(o => o.id === id);

export function getSketch(id) {
  for (const plane of App.project.planes)
    for (const sketch of plane.sketches)
      if (sketch.id === id) return { plane, sketch };
  return null;
}

export function getEntity(sketchId, id) {
  const r = getSketch(sketchId);
  if (!r) return null;
  const entity = r.sketch.entities.find(e => e.id === id);
  return entity ? { ...r, entity } : null;
}

export function allSketches() {
  const res = [];
  for (const plane of App.project.planes)
    for (const sketch of plane.sketches) res.push({ plane, sketch });
  return res;
}

/** Risolve un riferimento (di default la selezione principale) nell'elemento del progetto. */
export function resolve(sel = App.selection) {
  if (!sel) return null;
  switch (sel.type) {
    case 'object': { const item = getObject(sel.id); return item && { type: sel.type, item }; }
    case 'artifact': { const item = getArtifact(sel.id); return item && { type: sel.type, item }; }
    case 'plane': { const item = getPlane(sel.id); return item && { type: sel.type, item }; }
    case 'operation': { const item = getOperation(sel.id); return item && { type: sel.type, item }; }
    case 'origin': { const item = getOrigin(sel.id); return item && { type: sel.type, item }; }
    case 'sketch': { const r = getSketch(sel.id); return r && { type: sel.type, item: r.sketch, plane: r.plane }; }
    case 'entity': { const r = getEntity(sel.sketchId, sel.id); return r && { type: sel.type, item: r.entity, sketch: r.sketch, plane: r.plane }; }
  }
  return null;
}

/** Tutti gli elementi selezionati, risolti: [{ ref, type, item, ... }]. */
export function resolveAll() {
  const res = [];
  for (const ref of App.selected) {
    const r = resolve(ref);
    if (r) res.push({ ref, ...r });
  }
  return res;
}

/** Piano "attivo": quello dello sketch in modifica, altrimenti quello dell'elemento selezionato. */
export function activePlaneId() {
  if (App.sketch) return App.sketch.planeId;
  const r = resolve();
  if (!r) return null;
  if (r.type === 'plane') return r.item.id;
  if (r.type === 'sketch' || r.type === 'entity') return r.plane.id;
  if (r.type === 'operation') return getSketch(r.item.sketchId)?.plane.id || null;
  return null;
}

/**
 * Sketch su cui creare una lavorazione: lo sketch selezionato, oppure quello di una o più entità selezionate
 * (tutte dello stesso sketch). Ritorna { sketchId, entityIds } oppure null.
 */
export function operationSource() {
  const all = resolveAll();
  if (!all.length) return null;
  if (all.length === 1 && all[0].type === 'sketch') return { sketchId: all[0].item.id, entityIds: null };
  if (all.every(x => x.type === 'entity')) {
    const sid = all[0].sketch.id;
    if (all.every(x => x.sketch.id === sid)) return { sketchId: sid, entityIds: all.map(x => x.item.id) };
  }
  return null;
}

function validateSelection() {
  App.selected = App.selected.filter(s => resolve(s));
  if (!App.selected.some(s => sameRef(s, App.selection))) App.selection = App.selected[App.selected.length - 1] || null;
  if (App.sketch && !getSketch(App.sketch.sketchId)) App.sketch = null;
}

// ------------------------------------------------------------------ utilità per percorsi annidati
export function getPath(obj, path) {
  return path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
}
export function setPath(obj, path, value) {
  const keys = path.split('.');
  let o = obj;
  for (let i = 0; i < keys.length - 1; i++) {
    if (o[keys[i]] == null) o[keys[i]] = {};
    o = o[keys[i]];
  }
  o[keys[keys.length - 1]] = value;
}
