// Stato dell'applicazione: progetto (documento serializzabile), selezione, dati runtime, undo/redo, eventi.

const AUTOSAVE_KEY = 'carvecam.project.v1';
// nomi precedenti del programma (PocketCAM, Mini3D CAM): l'autosalvataggio viene recuperato
const LEGACY_AUTOSAVE_KEYS = ['pocketcam.project.v1', 'mini3d.project.v1'];

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

export const App = {
  project: null,
  selection: null,          // { type: 'object'|'artifact'|'plane'|'sketch'|'entity'|'operation', id, sketchId? }
  sketch: null,             // sketch in modifica: { planeId, sketchId }
  pickMode: null,           // modalità di selezione punti nel 3D
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
    format: PROJECT_FORMAT, version: 1,
    name: 'Nuovo progetto', units: 'mm',
    objects: [], artifacts: [], planes: [], operations: [],
    counters: {},
  };
}

function normalize(p) {
  const d = newProject();
  const r = Object.assign(d, p || {});
  r.format = PROJECT_FORMAT;
  for (const k of ['objects', 'artifacts', 'planes', 'operations']) if (!Array.isArray(r[k])) r[k] = [];
  for (const pl of r.planes) {
    if (!Array.isArray(pl.sketches)) pl.sketches = [];
    for (const s of pl.sketches) if (!Array.isArray(s.entities)) s.entities = [];
  }
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
  emit('project');
  scheduleAutosave();
}

export function setProject(p) {
  App.project = normalize(p);
  undoStack = []; redoStack = [];
  App.selection = null;
  App.dirty = false;
  App.runtime.toolpaths.clear();
  emit('project');
  emit('selection');
  scheduleAutosave();
}

// ------------------------------------------------------------------ autosalvataggio (solo comodità locale)
let saveTimer = null;
function scheduleAutosave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try { localStorage.setItem(AUTOSAVE_KEY, snapshot()); } catch { /* storage non disponibile */ }
  }, 700);
}
export function loadAutosave() {
  try {
    let s = localStorage.getItem(AUTOSAVE_KEY);
    for (const k of LEGACY_AUTOSAVE_KEYS) s ??= localStorage.getItem(k);
    return s ? JSON.parse(s) : null;
  } catch { return null; }
}

// ------------------------------------------------------------------ selezione e ricerca
export function select(sel) {
  App.selection = sel || null;
  emit('selection');
}

export function isSelected(type, id) {
  const s = App.selection;
  return !!s && s.type === type && s.id === id;
}

export const getObject = id => App.project.objects.find(o => o.id === id);
export const getArtifact = id => App.project.artifacts.find(o => o.id === id);
export const getPlane = id => App.project.planes.find(o => o.id === id);
export const getOperation = id => App.project.operations.find(o => o.id === id);

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

/** Risolve la selezione corrente nell'elemento del progetto. */
export function resolve(sel = App.selection) {
  if (!sel) return null;
  switch (sel.type) {
    case 'object': { const item = getObject(sel.id); return item && { type: sel.type, item }; }
    case 'artifact': { const item = getArtifact(sel.id); return item && { type: sel.type, item }; }
    case 'plane': { const item = getPlane(sel.id); return item && { type: sel.type, item }; }
    case 'operation': { const item = getOperation(sel.id); return item && { type: sel.type, item }; }
    case 'sketch': { const r = getSketch(sel.id); return r && { type: sel.type, item: r.sketch, plane: r.plane }; }
    case 'entity': { const r = getEntity(sel.sketchId, sel.id); return r && { type: sel.type, item: r.entity, sketch: r.sketch, plane: r.plane }; }
  }
  return null;
}

function validateSelection() {
  if (App.selection && !resolve(App.selection)) App.selection = null;
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
