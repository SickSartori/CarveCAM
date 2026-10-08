// Comandi dell'applicazione (menu, navigatore, pannello proprietà, scorciatoie).
import * as THREE from 'three';
import {
  App, emit, mutate, select, selectMany, uid, nextName, resolve, resolveAll, getPlane, getSketch, getOperation, getOrigin,
  setProject, newProject, undo as undoState, redo as redoState, setPath, markSaved, MOVABLE, operationSource,
} from './state.js';
import { ICONS } from './icons.js';
import { api, download } from './api.js';
import { planeFrame, frameQuaternion, angleOfU, fmt, toWorld, entityLoop, entitySnapPoints, mirrorEntityV } from './geom.js';
import { extrudeMesh, booleanMeshes, EXTRUDE_SIDES } from './solids.js';
import { evalNum } from './ui-props.js';
import { modal, confirmBox, toast, status, busy, busyText, idle, h } from './dialogs.js';
import { SERVER_FORMATS, CLIENT_FORMATS, extOf, parseInBrowser, buildDisplayGeometry } from './importers.js';
import { sampleMesh, sampleProject, SAMPLE_VERSION, SAMPLE_BOUNDS } from './sample.js';
import { shortcutRows } from './shortcuts.js';
import { OP_DEFAULTS, effParam, round4 } from './oplib.js';
import {
  pickTool, pickSetup, toolFromLibrary, getTools, getSetups, openToolLibrary, openSetupLibrary, saveOperationAsSetup,
  usedTools, reconcileProjectTools, exportLibrary, importLibrary,
} from './library.js';
import { pickProjectFile, writeProjectFile, addRecent, recentList, fileOfRecent, removeRecent } from './files.js';
import { openOptions } from './options.js';
import { getMachines, openMachineLibrary, machineSummary, usesProgramNumber, COOLANTS } from './machines.js';
import { color, settings } from './settings.js';
import { artifactKeyPoints } from './scene-sync.js';
import { t, num, LOCALE } from './i18n.js';
import { log } from './log.js';

const POST_MODE_KEY = 'carvecam.post.mode';   // controllo scelto nelle versioni precedenti (per browser)
const MACHINE_KEY = 'carvecam.post.machine';   // ultima macchina scelta nell'esportazione G-code (per browser)
const ORIGIN_KEY = 'carvecam.origin.v1';       // ultime scelte di "Sposta origine" (per browser)
const REPOS_KEY = 'carvecam.reposition.v1';    // ultime scelte di "Riposiziona" (per browser)
const SAMPLE_KEY = 'carvecam.sample.mesh';     // mesh della targa di esempio già caricata sul server
const EXTRUDE_KEY = 'carvecam.extrude.v1';     // ultime scelte di "Estrudi profilo" (per browser)
const BOOL_KEY = 'carvecam.boolean.v1';        // ultime scelte delle operazioni booleane (per browser)
const AXES = ['X', 'Y', 'Z'];

const loadPref = (key, def) => { try { return { ...def, ...JSON.parse(localStorage.getItem(key) || '{}') }; } catch { return { ...def }; } };
const savePref = (key, v) => { try { localStorage.setItem(key, JSON.stringify(v)); } catch { /* storage non disponibile */ } };

/** Ingombro esatto (dai vertici trasformati) delle mesh di un elemento della scena, anche se nascosto. */
export function preciseBox(obj) {
  const box = new THREE.Box3();
  if (!obj) return box;
  const v = new THREE.Vector3();
  obj.updateMatrixWorld(true);
  obj.traverse(o => {
    const pos = o.isMesh && o.userData?.type ? o.geometry?.attributes.position : null;
    if (!pos) return;
    for (let i = 0; i < pos.count; i++) box.expandByPoint(v.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld));
  });
  return box;
}

/** Pulsanti a scelta singola: options [[value, label, disabled?]]; onChange(value). */
function segmented(options, value, onChange) {
  const el = h('div', { class: 'seg', role: 'radiogroup' });
  const btns = options.map(([v, label, disabled]) => {
    const b = h('button', { type: 'button', class: 'seg-btn', role: 'radio', disabled: !!disabled, 'data-v': v }, label);
    b.addEventListener('click', () => { set(v); onChange(v); });
    el.append(b);
    return b;
  });
  const set = v => { for (const b of btns) b.setAttribute('aria-checked', String(b.dataset.v === v)); };
  set(value);
  el.set = set;
  return el;
}

const range3 = (box, i) => `${fmt(box.min.getComponent(i), 2)} … ${fmt(box.max.getComponent(i), 2)}`;

// direzioni delle viste standard (facce, spigoli e vertici del cubo di orientamento)
const VIEW_SNAP = [];
for (let x = -1; x <= 1; x++) for (let y = -1; y <= 1; y++) for (let z = -1; z <= 1; z++) {
  if (x || y || z) VIEW_SNAP.push(new THREE.Vector3(x, y, z).normalize());
}
const AXIS_NAMES = [['+X', 1, 0, 0], ['-X', -1, 0, 0], ['+Y', 0, 1, 0], ['-Y', 0, -1, 0], ['+Z', 0, 0, 1], ['-Z', 0, 0, -1]]
  .map(([name, ...d]) => ({ name, d: new THREE.Vector3(...d) }));

/** Piani standard: tutte le orientazioni allineate agli assi. */
export const PLANE_PRESETS = [
  { id: 'xy+', label: 'XY · normale +Z (dall\'alto)', normal: [0, 0, 1] },
  { id: 'xy-', label: 'XY · normale −Z (dal basso)', normal: [0, 0, -1] },
  { id: 'xz-', label: 'XZ · normale −Y (dal fronte)', normal: [0, -1, 0] },
  { id: 'xz+', label: 'XZ · normale +Y (dal retro)', normal: [0, 1, 0] },
  { id: 'yz+', label: 'YZ · normale +X (da destra)', normal: [1, 0, 0] },
  { id: 'yz-', label: 'YZ · normale −X (da sinistra)', normal: [-1, 0, 0] },
];
const PRESET_ALIAS = { xy: 'xy+', xz: 'xz-', yz: 'yz+' };

const ARTIFACT_DEFAULTS = {
  box: { base: 'Parallelepipedo', size: [20, 20, 20] },
  cylinder: { base: 'Cilindro', radius: 10, height: 20 },
  cone: { base: 'Tronco di cono', radius: 10, radius2: 4, height: 20 },
  sphere: { base: 'Sfera', radius: 10 },
};

const PLANE_MODE_HINT = () => t('<b>Aggiungi piano</b>: scegli un piano standard dall\'elenco, oppure da faccia, da 3 punti o dalla vista · <b>Esc</b> annulla');

export function createCommands({ vp, sync, sketch, sim, gizmo }) {
  const cmd = {};

  // ================================================================ utilità
  const sceneBox = () => {
    const box = new THREE.Box3();
    for (const g of [vp.groups.objects, vp.groups.artifacts]) {
      g.updateMatrixWorld(true);
      g.traverseVisible(o => { if (o.isMesh) box.expandByObject(o); });
    }
    return box;
  };

  function planeOfSelection() {
    const r = resolve();
    if (!r) return null;
    if (r.type === 'plane') return r.item;
    if (r.type === 'sketch' || r.type === 'entity') return r.plane;
    if (r.type === 'operation') return getSketch(r.item.sketchId)?.plane || null;
    return null;
  }

  function sketchOfSelection() {
    const r = resolve();
    if (!r) return null;
    if (r.type === 'sketch') return r.item;
    if (r.type === 'entity') return r.sketch;
    if (r.type === 'plane') return r.item.sketches[0] || null;
    if (r.type === 'operation') return getSketch(r.item.sketchId)?.sketch || null;
    return null;
  }

  /** Elementi movibili selezionati (oggetti, artefatti, piani). */
  const movableSelected = () => resolveAll().filter(x => MOVABLE.includes(x.type));

  const lockedWarn = () => toast(t('Elemento bloccato: sbloccalo per spostarlo'), 'warn');

  /** Comandi "Modello" non disponibili durante la creazione di un piano, il disegno di uno sketch o con un piano selezionato. */
  function modelBlocked() {
    if (sketch.active) { toast(t('Termina lo sketch prima di modificare il modello'), 'warn'); return true; }
    if (App.planeMode) { toast(t('Concludi o annulla (Esc) la creazione del piano prima di modificare il modello'), 'warn'); return true; }
    if (App.selected.some(s => s.type === 'plane')) { toast(t('Deseleziona il piano (Esc o clic nel vuoto) prima di modificare il modello'), 'warn'); return true; }
    return false;
  }
  const opsBlocked = () => {
    if (!sketch.active) return false;
    toast(t('Termina lo sketch prima di creare o modificare le lavorazioni'), 'warn');
    return true;
  };

  const confirmDiscard = async title => !App.dirty || confirmBox(title, t('Il progetto corrente ha modifiche non salvate che andranno perse.'), t('Continua'));

  // ================================================================ FILE
  cmd.newProject = async () => {
    if (!(await confirmDiscard(t('Nuovo progetto')))) return false;
    sketch.exit(false);
    sim.stop();
    cmd.endPlaneMode();
    setProject(newProject());
    App.fileHandle = null;
    App.fileName = '';
    log.info('Nuovo progetto');
    status(t('Nuovo progetto'));
    return true;
  };

  async function openFile(file, handle) {
    let proj;
    busy(t('Apertura progetto…'));
    try {
      proj = await api.loadProject(file);
    } catch (e) {
      log.error('Apertura del progetto non riuscita', e);
      toast(t('Apertura non riuscita: {msg}', { msg: e.message }), 'err');
      return false;
    } finally { idle(); }
    // utensili usati dal progetto confrontati con il magazzino: avviso, ed eventuale aggiornamento
    if (!(await reconcileProjectTools(proj))) { log.info('Apertura annullata (utensili diversi dal magazzino)', { file: file.name }); return false; }
    busy(t('Apertura progetto…'));
    try {
      sketch.exit(false);
      sim.stop();
      cmd.endPlaneMode();
      setProject(proj);
      App.fileHandle = handle || null;
      App.fileName = file.name;
      await cmd.loadMeshes();
      vp.fit();
      await addRecent({ name: App.project.name, fileName: file.name, handle, project: App.project, thumb: vp.snapshot(320, 200, true) });
      emit('recent');
      log.info('Progetto aperto', { file: file.name, size: file.size });
      status(t('Progetto aperto: {name}', { name: file.name }));
      return true;
    } catch (e) {
      log.error('Apertura del progetto non riuscita', e);
      toast(t('Apertura non riuscita: {msg}', { msg: e.message }), 'err');
      return false;
    } finally { idle(); }
  }

  /** Apre un progetto scelto dall'utente: true se aperto. */
  cmd.openProject = async () => {
    if (!(await confirmDiscard(t('Apri progetto')))) return false;
    const pick = await pickProjectFile();
    return pick ? openFile(pick.file, pick.handle) : false;
  };

  cmd.recentProjects = () => recentList();

  /** Riapre un progetto recente (dal file o dalla copia memorizzata): true se aperto. */
  cmd.openRecent = async entry => {
    if (!(await confirmDiscard(t('Apri progetto recente')))) return false;
    try {
      const f = await fileOfRecent(entry);
      if (f) return openFile(f, entry.handle);
    } catch (e) { log.warn('File recente non accessibile', e); }
    if (!entry.snapshot) {
      toast(t('Il file "{name}" non è più disponibile', { name: entry.fileName || entry.name }), 'err');
      await removeRecent(entry.key);
      emit('recent');
      return false;
    }
    const when = new Date(entry.time).toLocaleString(LOCALE);
    const ok0 = await confirmBox(t('Progetto recente'),
      entry.handle
        ? t('Il file "{file}" non è accessibile. Aprire la copia del progetto memorizzata il {when}?', { file: entry.fileName, when })
        : t('Il browser non consente di riaprire direttamente il file "{file}". Aprire la copia del progetto memorizzata il {when}? Per salvarla usa Salva con nome.', { file: entry.fileName || entry.name, when }),
      t('Apri la copia'));
    if (!ok0) return false;
    const snap = JSON.parse(entry.snapshot);
    if (!(await reconcileProjectTools(snap))) return false;
    sketch.exit(false);
    sim.stop();
    setProject(snap);
    App.fileHandle = null;
    App.fileName = entry.fileName || '';
    busy(t('Apertura progetto…'));
    try { await cmd.loadMeshes(); } finally { idle(); }
    vp.fit();
    log.info('Progetto recente aperto dalla copia memorizzata', { name: entry.name });
    status(t('Aperta la copia memorizzata di "{name}"', { name: entry.name }));
    return true;
  };

  /**
   * Salva il progetto (.ccam): sul file già aperto se possibile, altrimenti chiede dove (o scarica).
   * Il nome del progetto diventa quello del file; se il progetto è stato rinominato si salva in un nuovo file.
   */
  cmd.saveProject = async (saveAs = false) => {
    const base = safeName(App.project.name || t('progetto'));
    if (!saveAs && App.fileHandle && fileBase(App.fileName) !== base) saveAs = true;
    const name = `${base}.ccam`;
    try {
      const res = await writeProjectFile(async fileName => {
        const fb = fileBase(fileName);
        if (fb && fb !== App.project.name) {
          log.info('Nome del progetto allineato al file', { from: App.project.name, to: fb });
          App.project.name = fb;
        }
        busy(t('Salvataggio progetto…'));
        try {
          // il progetto porta con sé le schede degli utensili usati (confrontate col magazzino all'apertura)
          App.project.tools = await usedTools(App.project);
          return await api.saveProject(App.project);
        } finally { idle(); }
      }, name, App.fileHandle, saveAs);
      if (!res) return false;
      App.fileHandle = res.handle;
      App.fileName = res.fileName;
      markSaved();
      await addRecent({ name: App.project.name, fileName: res.fileName, handle: res.handle, project: App.project, thumb: vp.snapshot(320, 200, true) });
      emit('recent');
      log.info('Progetto salvato', { file: res.fileName, handle: !!res.handle });
      status(t('Progetto salvato: {name}', { name: res.fileName }));
      return true;
    } catch (e) {
      log.error('Salvataggio non riuscito', e);
      toast(t('Salvataggio non riuscito: {msg}', { msg: e.message }), 'err');
      return false;
    }
  };
  cmd.saveProjectAs = () => cmd.saveProject(true);

  /** Rinomina il progetto e chiede se salvarlo. */
  cmd.renameTo = async name => {
    const v = String(name || '').trim();
    if (!v || v === App.project.name) return;
    mutate(p => { p.name = v; });
    const msg = App.fileHandle
      ? t('Il progetto si chiama ora "{name}". Salvarlo adesso nel file "{file}"?', { name: v, file: `${safeName(v)}.ccam` })
      : t('Il progetto si chiama ora "{name}". Salvarlo adesso?', { name: v });
    if (await confirmBox(t('Salvare il progetto?'), msg, t('Salva'), t('Non ora'))) {
      await cmd.saveProject();
    }
  };

  cmd.renameProject = async () => {
    const inp = h('input', { value: App.project.name || '', style: { width: '100%' } });
    const ok = await modal({
      title: t('Nome progetto'), body: h('div', { class: 'form-row' }, h('label', {}, t('Nome')), inp),
      buttons: [{ label: t('Annulla'), value: false }, { label: t('OK'), value: true, primary: true }],
    });
    if (ok) await cmd.renameTo(inp.value);
  };

  /** Chiede i modelli da importare: la promessa vale true se ne sono stati scelti, false se annullato. */
  cmd.importModel = () => new Promise(resolve => {
    if (modelBlocked()) { resolve(false); return; }
    const inp = document.getElementById('file-import');
    inp.value = '';
    inp.onchange = () => { resolve(inp.files.length > 0); cmd.importFiles([...inp.files]); };
    inp.oncancel = () => resolve(false);
    inp.click();
  });

  cmd.importFiles = async files => {
    if (!files.length || modelBlocked()) return;
    busy(t('Importazione…'));
    let lastId = null;
    try {
      for (const f of files) {
        const ext = extOf(f.name);
        const name = f.name.replace(/\.[^.]+$/, '');
        busyText(t('Importazione {name}…', { name: f.name }));
        log.info('Importazione modello', { file: f.name, size: f.size });
        let info, faces = null;
        try {
          if (SERVER_FORMATS.includes(ext)) {
            info = await api.importFile(f);
          } else if (CLIENT_FORMATS.includes(ext)) {
            if (['step', 'stp', 'iges', 'igs', 'brep', 'brp'].includes(ext)) busyText(t('Tassellazione CAD di {name} (OpenCascade)…', { name: f.name }));
            const parsed = await parseInBrowser(f);
            busyText(t('Invio al server di {name}…', { name: f.name }));
            info = await api.uploadMesh(name, parsed.positions);
            // facce B-rep: servono per selezionare le facce vere del modello (profili da 3D)
            if (parsed.faces && parsed.faces.length === info.triangles) {
              try { await api.uploadFaces(info.id, parsed.faces); faces = parsed.faces; } catch { /* restano le facce ricavate dalla mesh */ }
            }
          } else {
            toast(t('Formato .{ext} non supportato', { ext }), 'err');
            continue;
          }
        } catch (e) {
          log.error(`Importazione di ${f.name} non riuscita`, e);
          toast(`${f.name}: ${e.message}`, 'err');
          continue;
        }
        busyText(t('Preparazione vista {name}…', { name: f.name }));
        const positions = await api.getMesh(info.id);
        App.runtime.meshGeo.set(info.id, await buildDisplayGeometry(positions));
        if (faces) App.runtime.meshFaces.set(info.id, faces);
        const id = uid('obj');
        mutate(p => {
          p.objects.push({
            id, name: info.name || name, meshId: info.id,
            position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1],
            color: color('object'), visible: true, locked: false,
            triangles: info.triangles, size: info.max.map((v, i) => round4(v - info.min[i])),
            source: f.name,
          });
        });
        lastId = id;
        log.info('Modello importato', { file: f.name, triangles: info.triangles });
        status(t('Importato {name}: {tri} triangoli, {size} mm', { name: f.name, tri: num(info.triangles), size: info.max.map((v, i) => fmt(v - info.min[i], 2)).join(' × ') }));
      }
    } finally { idle(); }
    if (lastId) {
      select({ type: 'object', id: lastId });
      vp.fit();
      if (App.project.operations.length) toast(t('Il nuovo oggetto non è un ostacolo delle lavorazioni esistenti: abilitalo nelle loro proprietà (Ostacoli) se serve'), 'info', 6000);
    }
  };

  /** Carica dal server le mesh degli oggetti non ancora in memoria (dopo apertura/ripristino progetto). */
  cmd.loadMeshes = async () => {
    const todo = App.project.objects.filter(o => o.meshId && !App.runtime.meshGeo.has(o.meshId) && !App.runtime.meshLoading.has(o.meshId));
    await Promise.all(todo.map(async o => {
      App.runtime.meshLoading.add(o.meshId);
      try {
        const [pos, faces] = await Promise.all([api.getMesh(o.meshId), api.getFaces(o.meshId).catch(() => null)]);
        App.runtime.meshGeo.set(o.meshId, await buildDisplayGeometry(pos));
        if (faces && faces.length === pos.length / 9) App.runtime.meshFaces.set(o.meshId, faces);
      } catch (e) {
        log.warn(`Mesh di ${o.name} non disponibile`, e);
        toast(t('Mesh di "{name}" non disponibile sul server: reimportare il file.', { name: o.name }), 'warn', 6000);
      } finally {
        App.runtime.meshLoading.delete(o.meshId);
      }
    }));
    if (todo.length) emit('project');
  };

  // ---------------------------------------------------------------- copie di sicurezza
  cmd.recoveryCopies = async () => {
    let list;
    try { list = await api.recoveryList(); } catch (e) { toast(e.message, 'err'); return; }
    if (!list.length) { toast(t('Nessuna copia di sicurezza sul server'), 'info'); return; }
    let sel = list[0].file;
    const tbody = h('tbody');
    const draw = () => {
      tbody.innerHTML = '';
      for (const x of list) {
        const tr = h('tr', { class: x.file === sel ? 'sel' : '' },
          h('td', {}, new Date(x.time).toLocaleString(LOCALE)), h('td', {}, x.name || '–'),
          h('td', {}, x.reason === 'auto' ? t('automatica') : x.reason || ''), h('td', { class: 'num' }, `${fmt(x.size / 1024, 1)} kB`));
        tr.addEventListener('click', () => { sel = x.file; draw(); });
        tbody.append(tr);
      }
    };
    draw();
    const ok = await modal({
      title: t('Copie di sicurezza'), size: 'wide',
      body: h('div', {},
        h('p', { class: 'p-note', style: { margin: '0 0 8px' } }, t('Copie salvate automaticamente sul server mentre lavori (ogni minuto, se ci sono modifiche). Le mesh dei modelli restano sul server.')),
        h('div', { class: 'lib-list chooser' }, h('table', {}, h('thead', {}, h('tr', {}, [t('Data'), t('Progetto'), t('Tipo'), t('Dimensione')].map(x => h('th', {}, x)))), tbody))),
      buttons: [{ label: t('Chiudi'), value: false }, { label: t('Apri la copia'), value: true, primary: true }],
    });
    if (!ok || !(await confirmDiscard(t('Copie di sicurezza')))) return;
    try {
      const proj = await api.recoveryGet(sel);
      sketch.exit(false);
      sim.stop();
      setProject(proj, true);
      App.fileHandle = null;
      await cmd.loadMeshes();
      vp.fit();
      log.info('Aperta una copia di sicurezza', { file: sel });
      status(t('Copia di sicurezza aperta: salvala con Salva con nome'));
    } catch (e) { toast(e.message, 'err'); }
  };

  // ---------------------------------------------------------------- file di log
  cmd.showLog = async () => {
    let info;
    try { info = await api.logInfo(); } catch (e) { toast(e.message, 'err'); return; }
    const files = info.files || [];
    const sel = h('select', {}, files.map(f => h('option', { value: f.name }, `${f.name} (${fmt(f.size / 1024, 1)} kB)`)));
    const pre = h('pre', { class: 'log-pre' }, t('Caricamento…'));
    const load = async () => {
      if (!sel.value) { pre.textContent = t('Nessun file di log'); return; }
      try {
        pre.textContent = await api.logTail(sel.value, 500);
        pre.scrollTop = pre.scrollHeight;
      } catch (e) { pre.textContent = e.message; }
    };
    sel.addEventListener('change', load);
    const body = h('div', {},
      h('div', { class: 'form-row' }, h('label', {}, t('Cartella')), h('code', { class: 'log-dir' }, info.dir || '')),
      h('div', { class: 'form-row' }, h('label', {}, t('File')), h('div', { class: 'form-field' }, sel,
        h('button', { class: 'btn', type: 'button', onclick: load }, t('Aggiorna')),
        h('button', { class: 'btn', type: 'button', onclick: () => { if (sel.value) window.open(`/api/log/${encodeURIComponent(sel.value)}?download=1`, '_blank'); } }, t('Scarica')))),
      h('p', { class: 'p-note', style: { margin: '0 0 6px' } }, t('Ultime righe del file: server e interfaccia scrivono nello stesso log (eventi, tempi di calcolo, errori e blocchi).')),
      pre);
    modal({ title: t('File di log'), body, size: 'xl', enter: false, buttons: [{ label: t('Chiudi'), value: true, primary: true }] });
    log.flush();
    setTimeout(load, 300);
  };

  // ================================================================ MODIFICA
  cmd.undo = () => { undoState(); sketch.refreshFrame(); };
  cmd.redo = () => { redoState(); sketch.refreshFrame(); };

  cmd.setProp = (sel, key, value) => {
    mutate(() => {
      const r = resolve(sel);
      if (!r) return;
      setPath(r.item, key, value);
      if (r.type === 'artifact' && key === 'kind') {
        const d = ARTIFACT_DEFAULTS[value];
        for (const k of ['size', 'radius', 'radius2', 'height']) if (r.item[k] == null && d[k] != null) r.item[k] = structuredClone(d[k]);
      }
      if (r.type === 'operation' && key === 'tool.diameter' && value > 0 && !r.item.rel?.stepover?.on && r.item.stepover > value) r.item.stepover = round4(value * 0.5);
      if (r.type === 'operation' && (key === 'tool.diameter' || key === 'tool.type') && r.item.tool) {
        const tl = r.item.tool;
        if (tl.type === 'ball') tl.cornerRadius = round4(tl.diameter / 2);
        if (tl.type === 'taper') {
          if (!(tl.taperAngle > 0)) tl.taperAngle = 5;
          if (!tl.tipType) tl.tipType = tl.diameter > 0 ? 'ball' : 'flat';
        }
        if (!(tl.cornerRadius > 0)) tl.cornerRadius = round4(Math.min(1, tl.diameter / 4));
        if (tl.cornerRadius > tl.diameter / 2) tl.cornerRadius = round4(tl.diameter / 4);
      }
      // la geometria cambiata scollega l'utensile dal magazzino; numero e concorde sono scelte della lavorazione
      if (r.type === 'operation' && key.startsWith('tool.') && key !== 'tool.number' && key !== 'tool.climb') r.item.tool.libId = null;
    });
    sketch.refreshFrame();
  };

  /** Modifica annullabile dell'elemento selezionato sel con una funzione (campi calcolati delle proprietà). */
  cmd.editItem = (sel, fn) => {
    mutate(() => { const r = resolve(sel); if (r) fn(r.item); });
    sketch.refreshFrame();
  };

  /** Solidi (oggetti, artefatti) considerati o no come grezzo: elenco Grezzo del navigatore. */
  cmd.setStock = (refs, on) => {
    const items = refs.map(r => resolve(r)).filter(r => r && (r.type === 'object' || r.type === 'artifact'));
    if (!items.length) return;
    mutate(() => { for (const r of items) r.item.stock = !!on; });
    log.info(on ? 'Solidi considerati grezzo' : 'Solidi tolti dal grezzo', { items: items.map(r => r.item.name) });
    status(on
      ? t('Grezzo: {names}. Le lavorazioni lo usano come materiale da togliere, aggiornandolo dall\'una alla successiva', { names: items.map(r => r.item.name).join(', ') })
      : t('{names}: non più grezzo', { names: items.map(r => r.item.name).join(', ') }));
  };

  /** Il progetto ha un grezzo (solidi considerati come grezzo). */
  const hasStock = () => App.project.objects.some(o => o.stock && o.meshId) || App.project.artifacts.some(a => a.stock);

  cmd.toggleVisible = (type, id) => {
    mutate(() => {
      const r = resolve({ type, id });
      if (r) r.item.visible = r.item.visible === false;
    });
  };

  /** Blocca o sblocca: un riferimento, oppure la selezione (bloccata se almeno un elemento è sbloccato). */
  cmd.toggleLock = ref => {
    const list = ref ? [resolve(ref)].filter(Boolean) : movableSelected();
    if (!list.length) { toast(t('Selezionare oggetti, artefatti o piani'), 'warn'); return; }
    const lock = !list.every(x => x.item.locked);
    mutate(() => { for (const x of list) x.item.locked = lock; });
    log.info(lock ? 'Elementi bloccati' : 'Elementi sbloccati', { count: list.length });
    status(lock ? t('{n} elementi bloccati', { n: list.length }) : t('{n} elementi sbloccati', { n: list.length }));
  };

  cmd.deleteSelected = async () => {
    const all = resolveAll();
    if (!all.length) return;
    const planes = all.filter(x => x.type === 'plane' && x.item.sketches.length);
    if (planes.length) {
      const n = planes.reduce((s, x) => s + x.item.sketches.length, 0);
      const msg = planes.length === 1
        ? t('Il piano "{name}" contiene {n} sketch che verranno eliminati.', { name: planes[0].item.name, n })
        : t('I piani selezionati contengono {n} sketch che verranno eliminati.', { n });
      if (!(await confirmBox(t('Elimina piano'), msg, t('Elimina')))) return;
    }
    let next = null;
    const gone = new Set();
    mutate(p => {
      for (const x of all) {
        const s = x.ref;
        switch (s.type) {
          case 'object': p.objects = p.objects.filter(o => o.id !== s.id); gone.add(s.id); break;
          case 'artifact': p.artifacts = p.artifacts.filter(o => o.id !== s.id); gone.add(s.id); break;
          case 'plane': p.planes = p.planes.filter(o => o.id !== s.id); break;
          case 'origin': p.origins = p.origins.filter(o => o.id !== s.id); break;
          case 'operation':
            p.operations = p.operations.filter(o => o.id !== s.id);
            App.runtime.toolpaths.delete(s.id);
            break;
          case 'sketch': {
            const rr = getSketch(s.id);
            if (!rr) break;
            rr.plane.sketches = rr.plane.sketches.filter(y => y.id !== s.id);
            next = { type: 'plane', id: rr.plane.id };
            break;
          }
          case 'entity': {
            const rr = getSketch(s.sketchId);
            if (!rr) break;
            rr.sketch.entities = rr.sketch.entities.filter(y => y.id !== s.id);
            next = { type: 'sketch', id: s.sketchId };
            break;
          }
        }
      }
      // riferimenti delle lavorazioni a ostacoli ed entità eliminati
      for (const op of p.operations) {
        if (Array.isArray(op.obstacles)) op.obstacles = op.obstacles.filter(id => !gone.has(id));
        if (Array.isArray(op.entityIds)) {
          const sk = getSketch(op.sketchId);
          op.entityIds = sk ? op.entityIds.filter(id => sk.sketch.entities.some(e => e.id === id)) : op.entityIds;
          if (!op.entityIds.length) op.entityIds = null;
        }
      }
    });
    log.info('Elementi eliminati', { count: all.length, types: [...new Set(all.map(x => x.type))] });
    if (sim.active && !getOperation(sim.opId)) sim.stop();
    if (App.sketch && !getSketch(App.sketch.sketchId)) sketch.exit();
    select(all.length === 1 ? next : null);
  };

  cmd.duplicateSelected = () => {
    const all = resolveAll();
    if (!all.length) return;
    const sel = [];
    mutate(p => {
      for (const r of all) {
        const s = r.ref;
        const clone = structuredClone(r.item);
        switch (s.type) {
          case 'object':
          case 'artifact': {
            clone.id = uid(s.type === 'object' ? 'obj' : 'art');
            clone.name = `${r.item.name} (${t('copia')})`;
            clone.position = [clone.position[0] + 10, clone.position[1] + 10, clone.position[2]];
            clone.locked = false;
            (s.type === 'object' ? p.objects : p.artifacts).push(clone);
            sel.push({ type: s.type, id: clone.id });
            break;
          }
          case 'origin': {
            clone.id = uid('org');
            clone.name = `${r.item.name} (${t('copia')})`;
            clone.position = [clone.position[0] + 10, clone.position[1] + 10, clone.position[2]];
            clone.locked = false;
            p.origins.push(clone);
            sel.push({ type: 'origin', id: clone.id });
            break;
          }
          case 'plane': {
            clone.id = uid('pl');
            clone.name = `${r.item.name} (${t('copia')})`;
            clone.locked = false;
            for (const sk of clone.sketches) { sk.id = uid('sk'); for (const e of sk.entities) e.id = uid('e'); }
            p.planes.push(clone);
            sel.push({ type: 'plane', id: clone.id });
            break;
          }
          case 'sketch': {
            clone.id = uid('sk');
            clone.name = `${r.item.name} (${t('copia')})`;
            for (const e of clone.entities) e.id = uid('e');
            getSketch(s.id).plane.sketches.push(clone);
            sel.push({ type: 'sketch', id: clone.id });
            break;
          }
          case 'entity': {
            clone.id = uid('e');
            getSketch(s.sketchId).sketch.entities.push(clone);
            sel.push({ type: 'entity', id: clone.id, sketchId: s.sketchId });
            break;
          }
          case 'operation': {
            clone.id = uid('op');
            clone.name = `${r.item.name} (${t('copia')})`;
            p.operations.push(clone);
            sel.push({ type: 'operation', id: clone.id });
            break;
          }
        }
      }
    });
    selectMany(sel);
  };

  cmd.setGizmo = mode => {
    App.view.gizmo = mode;
    emit('gizmo');
  };

  cmd.dropToFloor = sel => {
    const r = resolve(sel);
    if (!r) return;
    if (r.item.locked) { lockedWarn(); return; }
    const box = preciseBox(sync.objectFor(sel.type, sel.id));
    if (box.isEmpty()) return;
    mutate(() => { r.item.position[2] = round4(r.item.position[2] - box.min.z); });
  };

  cmd.centerXY = sel => {
    const r = resolve(sel);
    if (!r) return;
    if (r.item.locked) { lockedWarn(); return; }
    const box = preciseBox(sync.objectFor(sel.type, sel.id));
    if (box.isEmpty()) return;
    const c = box.getCenter(new THREE.Vector3());
    mutate(() => {
      r.item.position[0] = round4(r.item.position[0] - c.x);
      r.item.position[1] = round4(r.item.position[1] - c.y);
    });
  };

  /**
   * Riposiziona un oggetto o artefatto rispetto all'origine o all'ingombro degli altri solidi: per ogni asse
   * minimo, centro o massimo (Z anche "appoggia su Z=0"). Si applica con un solo passo di annullamento.
   */
  cmd.reposition = async sel => {
    const r = resolve(sel);
    if (!r || !['object', 'artifact'].includes(r.type)) return;
    if (r.item.locked) { lockedWarn(); return; }
    if (modelBlocked()) return;
    const box = preciseBox(sync.objectFor(sel.type, sel.id));
    if (box.isEmpty()) { toast(t('Geometria non disponibile'), 'warn'); return; }
    const others = new THREE.Box3();
    for (const g of [vp.groups.objects, vp.groups.artifacts]) {
      for (const o of g.children) if (!(o.userData.type === sel.type && o.userData.id === sel.id)) others.union(preciseBox(o));
    }
    const pref = loadPref(REPOS_KEY, { ref: 'origin', x: '', y: '', z: 'floor' });
    if (pref.ref === 'others' && others.isEmpty()) pref.ref = 'origin';
    const st = { ...pref };
    const preview = h('div', { class: 'p-info repos-preview' });
    const delta = () => AXES.map((ax, i) => {
      const m = st[ax.toLowerCase()];
      if (!m) return 0;
      if (m === 'floor') return -box.min.z;
      const rb = st.ref === 'others' ? others : null;
      const refMin = rb ? rb.min.getComponent(i) : 0, refMax = rb ? rb.max.getComponent(i) : 0;
      if (m === 'min') return refMin - box.min.getComponent(i);
      if (m === 'max') return refMax - box.max.getComponent(i);
      return (refMin + refMax) / 2 - (box.min.getComponent(i) + box.max.getComponent(i)) / 2;
    });
    const draw = () => {
      const d = delta();
      const nb = box.clone().translate(new THREE.Vector3(...d));
      preview.replaceChildren(
        h('div', {}, t('Spostamento'), ': ', AXES.map((ax, i) => `${ax} ${d[i] >= 0 ? '+' : ''}${fmt(d[i], 3)}`).join('   ')),
        h('div', {}, t('Ingombro risultante'), ': ', AXES.map((ax, i) => `${ax} ${range3(nb, i)}`).join('   ')));
    };
    const axisRow = (ax, opts) => {
      const k = ax.toLowerCase();
      return h('div', { class: 'form-row' }, h('label', {}, ax),
        segmented([['', '—'], ...opts], st[k], v => { st[k] = v; draw(); }));
    };
    const refSeg = segmented([['origin', t('Origine (0, 0, 0)')], ['others', t('Ingombro degli altri solidi'), others.isEmpty()]], st.ref, v => { st.ref = v; draw(); });
    const body = h('div', { class: 'repos' },
      h('p', { style: { margin: '0 0 8px' } }, t('Ingombro attuale di "{name}"', { name: r.item.name }), ': ',
        h('span', { class: 'mono' }, AXES.map((ax, i) => `${ax} ${range3(box, i)}`).join('   '))),
      h('div', { class: 'form-row' }, h('label', {}, t('Riferimento')), refSeg),
      axisRow('X', [['min', t('Min X')], ['mid', t('Centra X')], ['max', t('Max X')]]),
      axisRow('Y', [['min', t('Min Y')], ['mid', t('Centra Y')], ['max', t('Max Y')]]),
      axisRow('Z', [['floor', t('Appoggia su Z=0')], ['min', t('Min Z')], ['mid', t('Centra Z')], ['max', t('Max Z')]]),
      preview,
      h('p', { class: 'p-note' }, t('Min, Centra e Max allineano il minimo, il centro o il massimo dell\'ingombro dell\'elemento a quelli del riferimento (con l\'origine: alla coordinata 0). "Appoggia su Z=0" porta il punto più basso a Z=0.')));
    draw();
    const ok = await modal({
      title: t('Riposiziona'), body, size: 'wide',
      buttons: [{ label: t('Annulla'), value: false }, { label: t('Applica'), value: true, primary: true }],
    });
    if (!ok) return;
    savePref(REPOS_KEY, st);
    const d = delta();
    if (d.every(v => Math.abs(v) < 1e-9)) { status(t('Nessuno spostamento necessario')); return; }
    mutate(() => { r.item.position = r.item.position.map((v, i) => round4(v + d[i])); });
    log.info('Elemento riposizionato', { type: sel.type, ref: st.ref, x: st.x, y: st.y, z: st.z });
    status(t('"{name}" riposizionato', { name: r.item.name }));
  };

  // ---------------------------------------------------------------- spostamento dell'origine del progetto
  /** Ingombro di tutti i solidi caricati (oggetti e artefatti, anche nascosti). */
  function solidsBox() {
    const box = new THREE.Box3();
    for (const g of [vp.groups.objects, vp.groups.artifacts]) for (const o of g.children) box.union(preciseBox(o));
    return box;
  }

  /** Trasla tutto il progetto (anche gli elementi bloccati) perché il punto p diventi la nuova origine. */
  function shiftProject(p) {
    if (p.every(v => Math.abs(v) < 1e-9)) return;
    const d = p.map(v => -v);
    mutate(pr => {
      const add = a => a.map((v, i) => round4(v + d[i]));
      for (const o of pr.objects) o.position = add(o.position);
      for (const a of pr.artifacts) a.position = add(a.position);
      for (const pl of pr.planes) pl.origin = add(pl.origin);
      for (const og of pr.origins) og.position = add(og.position);
    });
    const dv = new THREE.Vector3(...d);
    vp.controls.target.add(dv);
    vp.camera.position.add(dv);
    vp.controls.update();
    sketch.refreshFrame();
    log.info('Origine del progetto spostata', { point: p });
    status(t('Origine spostata in ({p}): tutto il progetto è stato traslato. Ricalcolare le lavorazioni.', { p: p.map(v => fmt(v, 3)).join(', ') }));
  }

  /**
   * Sposta origine: per ogni asse la nuova origine è il minimo, il medio o il massimo dell'ingombro di tutti i
   * solidi caricati (oppure l'origine attuale), più un offset manuale. point: punto scelto nella vista.
   */
  cmd.moveOrigin = async point => {
    if (!point && modelBlocked()) return;
    if (sketch.active) sketch.exit();
    const box = solidsBox();
    const has = !box.isEmpty();
    const st = loadPref(ORIGIN_KEY, { modes: ['mid', 'mid', 'min'], offsets: [0, 0, 0] });
    st.modes = [...st.modes];
    st.offsets = [...st.offsets];
    if (point) { st.modes = ['cur', 'cur', 'cur']; st.offsets = [...point]; }
    if (!has) st.modes = st.modes.map(() => 'cur');
    const refOf = i => {
      const m = st.modes[i];
      if (m === 'min') return box.min.getComponent(i);
      if (m === 'max') return box.max.getComponent(i);
      if (m === 'mid') return (box.min.getComponent(i) + box.max.getComponent(i)) / 2;
      return 0;
    };
    const target = () => AXES.map((_, i) => refOf(i) + (Number(st.offsets[i]) || 0));
    const outs = AXES.map(() => h('span', { class: 'mono og-val' }));
    const after = h('div', { class: 'p-info og-after' });
    const draw = () => {
      const p = target();
      outs.forEach((o, i) => { o.textContent = fmt(p[i], 3); });
      after.textContent = has
        ? `${t('Ingombro dopo lo spostamento')}: ${AXES.map((ax, i) => `${ax} ${fmt(box.min.getComponent(i) - p[i], 2)} … ${fmt(box.max.getComponent(i) - p[i], 2)}`).join('   ')}`
        : t('Nessun solido caricato: si possono usare solo l\'origine attuale e gli offset');
    };
    const rows = AXES.map((ax, i) => {
      const off = h('input', { class: 'num', inputmode: 'decimal', value: fmt(st.offsets[i] || 0, 4), 'aria-label': t('Offset {ax}', { ax }) });
      off.addEventListener('input', () => {
        const v = Number(String(off.value).replace(',', '.'));
        off.classList.toggle('bad', !Number.isFinite(v));
        if (Number.isFinite(v)) { st.offsets[i] = v; draw(); }
      });
      const seg = segmented([['cur', t('Attuale')], ['min', t('Min'), !has], ['mid', t('Medio'), !has], ['max', t('Max'), !has]], st.modes[i], v => { st.modes[i] = v; draw(); });
      return h('tr', {},
        h('th', { class: `og-ax ax-${ax.toLowerCase()}` }, ax),
        h('td', {}, seg),
        h('td', {}, h('div', { class: 'form-field' }, h('span', { class: 'unit' }, '+'), off, h('span', { class: 'unit' }, 'mm'))),
        h('td', { class: 'num' }, outs[i]));
    });
    draw();
    const body = h('div', { class: 'origin-dlg' },
      h('p', { style: { margin: '0 0 8px' } }, t('Il punto indicato diventa la nuova origine (0, 0, 0): tutti gli oggetti, gli artefatti e i piani vengono traslati insieme, compresi quelli bloccati.')),
      h('div', { class: 'p-info', style: { marginBottom: '8px' } }, has
        ? `${t('Ingombro dei solidi caricati')}: ${AXES.map((ax, i) => `${ax} ${range3(box, i)}`).join('   ')}`
        : t('Nessun solido caricato')),
      h('table', { class: 'og-table' },
        h('thead', {}, h('tr', {}, h('th', {}, t('Asse')), h('th', {}, t('Riferimento nell\'ingombro')), h('th', {}, t('Offset')), h('th', { class: 'num' }, t('Nuova origine')))),
        h('tbody', {}, rows)),
      after,
      h('p', { class: 'p-note' }, t('Per ogni asse: nuova origine = riferimento (minimo, medio o massimo dell\'ingombro di tutti gli oggetti e artefatti, anche nascosti, oppure l\'origine attuale) + offset. Con "Scegli nella vista" si fa clic su un punto del modello (agganciato al vertice più vicino).')));
    const res = await modal({
      title: t('Sposta origine'), body, size: 'wide',
      buttons: [
        { label: t('Scegli nella vista…'), value: 'pick', left: true },
        { label: t('Annulla'), value: false },
        { label: t('Sposta'), value: true, primary: true },
      ],
    });
    if (res === 'pick') {
      startPick({ kind: 'origin' }, t('Clic su un punto di un oggetto o artefatto: diventerà la nuova origine · <b>Esc</b> annulla'));
      return;
    }
    if (!res) return;
    const p = target();
    if (p.some(v => !Number.isFinite(v))) { toast(t('Coordinate non valide'), 'err'); return; }
    // le scelte si ricordano; un punto preso nella vista no (vale per quella volta)
    if (!point) savePref(ORIGIN_KEY, st);
    shiftProject(p.map(round4));
  };

  // ================================================================ PUNTI DI ORIGINE (zero pezzo del G-code)
  /** Crea un punto di origine "Origine N" (rinominabile) nella posizione data. */
  cmd.createOrigin = (pos, name) => {
    const id = uid('org');
    mutate(p => {
      p.origins.push({ id, name: name || nextName(t('Origine')), position: pos.map(round4), visible: true, locked: false });
    });
    select({ type: 'origin', id });
    log.info('Punto di origine creato', { position: pos });
    status(t('Punto di origine creato: rinominalo nelle proprietà; si sceglie come zero pezzo nell\'esportazione del G-code'));
    return id;
  };

  /** Nuovo punto di applicazione di un'origine esistente: clic nella vista, con aggancio ai vertici. */
  cmd.relocateOrigin = id => {
    const og = getOrigin(id);
    if (!og) return;
    if (og.locked) { lockedWarn(); return; }
    if (modelBlocked()) return;
    startPick({ kind: 'reloc', id }, t('Clic sul nuovo punto di "{name}" (si aggancia ai vertici di solidi, sketch e piani vicini) · <b>Esc</b> annulla', { name: og.name }));
  };

  cmd.originFromPoint = () => {
    if (modelBlocked()) return;
    startPick({ kind: 'ref' }, t('Clic su un punto (si aggancia ai vertici di solidi, sketch e piani vicini): diventa un punto di origine · <b>Esc</b> annulla'));
  };

  cmd.originFromCoords = async () => {
    if (modelBlocked()) return;
    const name = h('input', { value: `${t('Origine')} ${((App.project.counters || {})[t('Origine')] || 0) + 1}` });
    const inputs = AXES.map(ax => h('input', { class: 'num', inputmode: 'decimal', value: '0', 'aria-label': ax }));
    const box = solidsBox();
    const preset = (label, fn) => h('button', { class: 'btn', type: 'button', disabled: box.isEmpty(), onclick: () => { const v = fn(); inputs.forEach((x, i) => { x.value = fmt(v[i], 4); }); } }, t(label));
    const c = box.isEmpty() ? new THREE.Vector3() : box.getCenter(new THREE.Vector3());
    const ok = await modal({
      title: t('Nuova origine'),
      body: h('div', {},
        h('div', { class: 'form-row' }, h('label', {}, t('Nome')), name),
        h('div', { class: 'form-row' }, h('label', {}, t('Posizione')), h('div', { class: 'p-vec' }, inputs.map((x, i) => h('div', { class: 'ax', 'data-ax': AXES[i] }, x)))),
        h('div', { class: 'form-row' }, h('label', {}, t('Punti dell\'ingombro')), h('div', { class: 'form-field wrap' },
          preset('Centro della sommità', () => [c.x, c.y, box.max.z]),
          preset('Centro della base', () => [c.x, c.y, box.min.z]),
          preset('Angolo minimo', () => [box.min.x, box.min.y, box.min.z]),
          preset('Angolo minimo in alto', () => [box.min.x, box.min.y, box.max.z]))),
        h('p', { class: 'p-note' }, t('Coordinate nel sistema del progetto. Il punto si può spostare poi con il manipolatore o dalle proprietà.'))),
      buttons: [{ label: t('Annulla'), value: false }, { label: t('Crea'), value: true, primary: true }],
    });
    if (!ok) return;
    const v = inputs.map(x => Number(String(x.value).replace(',', '.')));
    if (v.some(x => !Number.isFinite(x))) { toast(t('Coordinate non valide'), 'err'); return; }
    const nm = name.value.trim();
    if (nm) mutate(p => { p.counters = p.counters || {}; p.counters[t('Origine')] = (p.counters[t('Origine')] || 0) + 1; });
    cmd.createOrigin(v, nm || null);
  };

  // ================================================================ INSERISCI (artefatti)
  cmd.addArtifact = kind => {
    if (modelBlocked()) return;
    const d = ARTIFACT_DEFAULTS[kind];
    const tg = vp.controls.target;
    const id = uid('art');
    mutate(p => {
      p.artifacts.push({
        id, name: nextName(t(d.base)), kind,
        size: d.size ? [...d.size] : [20, 20, 20],
        radius: d.radius ?? 10, radius2: d.radius2 ?? 5, height: d.height ?? 20,
        position: [Math.round(tg.x), Math.round(tg.y), Math.round(tg.z)], rotation: [0, 0, 0],
        color: color('artifact'), visible: true, locked: false,
      });
    });
    select({ type: 'artifact', id });
    status(t('{name} inserito: posizionalo con il manipolatore (G sposta, R ruota) o dalle proprietà', { name: t(d.base) }));
  };

  // ================================================================ SOLIDI: profilo estruso e booleane
  /**
   * Estrude in linea retta, perpendicolare al piano, i contorni chiusi dello sketch selezionato (o delle entità
   * selezionate): il solido è un artefatto "extrude" con il profilo copiato nel suo sistema locale (quello del
   * piano), quindi resta valido anche se poi lo sketch cambia.
   */
  cmd.extrudeProfile = async () => {
    if (modelBlocked()) return;
    const src = operationSource();
    const r = src && getSketch(src.sketchId);
    if (!r) { toast(t('Seleziona prima uno sketch (o alcune sue entità) da estrudere'), 'warn'); return; }
    const ents = src.entityIds ? r.sketch.entities.filter(e => src.entityIds.includes(e.id)) : r.sketch.entities;
    const loops = ents.map(e => entityLoop(e)).filter(l => l.length >= 3).map(l => l.map(([x, y]) => [round4(x), round4(y)]));
    if (!loops.length) { toast(t('Lo sketch "{name}" non contiene contorni chiusi', { name: r.sketch.name }), 'warn'); return; }
    const pref = loadPref(EXTRUDE_KEY, { height: 10, side: 'down', stock: false });
    const name = h('input', { value: `${t('Estrusione')} ${((App.project.counters || {})[t('Estrusione')] || 0) + 1}` });
    const height = h('input', { class: 'num', inputmode: 'decimal', value: fmt(pref.height, 4) });
    let side = EXTRUDE_SIDES.some(([v]) => v === pref.side) ? pref.side : 'down';
    const sideSel = segmented(EXTRUDE_SIDES.map(([v, l]) => [v, t(l)]), side, v => { side = v; });
    const asStock = h('input', { type: 'checkbox' });
    asStock.checked = !!pref.stock;
    const ok = await modal({
      title: t('Estrudi profilo'),
      body: h('div', {},
        h('p', { class: 'p-note', style: { marginTop: 0 } }, t('{n} contorni di "{sketch}" ({plane}), estrusi perpendicolarmente al piano.', { n: loops.length, sketch: r.sketch.name, plane: r.plane.name })),
        h('div', { class: 'form-row' }, h('label', {}, t('Nome')), name),
        h('div', { class: 'form-row' }, h('label', {}, t('Altezza')), h('div', { class: 'form-field' }, height, h('span', { class: 'unit' }, 'mm'))),
        h('div', { class: 'form-row' }, h('label', {}, t('Direzione')), sideSel),
        h('div', { class: 'form-row' }, h('label', {}, t('Grezzo')), h('label', { class: 'opt-radio' }, asStock, t('Considera il solido come grezzo'))),
        h('p', { class: 'p-note' }, t('Un contorno dentro un altro diventa un foro. Il solido è un artefatto: altezza e direzione si cambiano poi nelle sue proprietà.'))),
      buttons: [{ label: t('Annulla'), value: false }, { label: t('Estrudi'), value: true, primary: true }],
    });
    if (!ok) return;
    const hv = evalNum(height.value);
    if (!(hv > 0)) { toast(t('Altezza non valida'), 'err'); return; }
    savePref(EXTRUDE_KEY, { height: hv, side, stock: asStock.checked });
    const f = planeFrame(r.plane);
    const e = new THREE.Euler().setFromQuaternion(frameQuaternion(f), 'XYZ');
    const id = uid('art');
    mutate(p => {
      p.counters = p.counters || {};
      p.counters[t('Estrusione')] = (p.counters[t('Estrusione')] || 0) + 1;
      p.artifacts.push({
        id, name: name.value.trim() || `${t('Estrusione')} ${p.counters[t('Estrusione')]}`, kind: 'extrude',
        profile: loops, height: round4(hv), side, size: [20, 20, 20], radius: 10, radius2: 5,
        position: f.o.toArray().map(round4), rotation: [e.x, e.y, e.z].map(v => Math.round(THREE.MathUtils.radToDeg(v) * 1e6) / 1e6),
        color: color('artifact'), visible: true, locked: false, stock: asStock.checked,
      });
    });
    select({ type: 'artifact', id });
    log.info('Profilo estruso', { sketch: r.sketch.name, loops: loops.length, height: hv, side });
    status(t('Profilo estruso: {n} contorni, altezza {h} mm', { n: loops.length, h: fmt(hv, 3) }));
  };

  /**
   * Operazione booleana tra i solidi selezionati (oggetti e artefatti): unione, sottrazione (il primo selezionato
   * meno gli altri) o intersezione. Il risultato è un nuovo oggetto (mesh caricata sul server); i solidi di
   * partenza si tolgono (o restano nascosti) e le lavorazioni che li avevano come ostacolo usano il risultato.
   */
  cmd.booleanSolids = async kind => {
    if (modelBlocked()) return;
    const items = App.selected.map(s => resolve(s)).filter(x => x && (x.type === 'object' || x.type === 'artifact'));
    if (items.length < 2) { toast(t('Seleziona almeno due solidi (oggetti o artefatti) con Ctrl+clic'), 'warn'); return; }
    const title = { union: t('Unione'), subtract: t('Sottrazione'), intersect: t('Intersezione') }[kind];
    const pref = loadPref(BOOL_KEY, { keep: false });
    const keep = h('input', { type: 'checkbox' });
    keep.checked = !!pref.keep;
    const what = kind === 'subtract'
      ? t('"{first}" meno {others}', { first: items[0].item.name, others: items.slice(1).map(x => `"${x.item.name}"`).join(', ') })
      : items.map(x => `"${x.item.name}"`).join(', ');
    const ok = await modal({
      title,
      body: h('div', {},
        h('p', { style: { marginTop: 0 } }, what),
        h('label', { class: 'opt-radio' }, keep, t('Conserva i solidi di partenza (nascosti)')),
        h('p', { class: 'p-note' }, t('Il risultato è un nuovo oggetto. I solidi devono essere chiusi; i modelli molto grandi richiedono qualche secondo.'))),
      buttons: [{ label: t('Annulla'), value: false }, { label: title, value: true, primary: true }],
    });
    if (!ok) return;
    savePref(BOOL_KEY, { keep: keep.checked });
    busy(t('Operazione booleana: {op}…', { op: title.toLowerCase() }));
    let info, geo;
    try {
      const geos = items.map(x => {
        const obj = sync.objectFor(x.type, x.item.id);
        if (!obj?.geometry) throw new Error(t('"{name}" non è ancora pronto nella vista', { name: x.item.name }));
        obj.updateMatrixWorld(true);
        return obj.geometry.clone().applyMatrix4(obj.matrixWorld);
      });
      const positions = await booleanMeshes(geos, kind);
      if (positions.length < 9) { toast(t('Il risultato è vuoto: i solidi non hanno volume in comune'), 'warn'); return; }
      busyText(t('Invio al server del risultato…'));
      info = await api.uploadMesh(title, positions);
      geo = await buildDisplayGeometry(await api.getMesh(info.id));
    } catch (e) {
      log.error('Operazione booleana non riuscita', e);
      toast(t('Operazione booleana non riuscita: {msg}', { msg: e.message }), 'err', 6000);
      return;
    } finally { idle(); }
    App.runtime.meshGeo.set(info.id, geo);
    const id = uid('obj');
    const ids = new Set(items.map(x => x.item.id));
    mutate(p => {
      p.objects.push({
        id, name: nextName(title), meshId: info.id, position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1],
        color: color('object'), visible: true, locked: false, triangles: info.triangles,
        size: info.max.map((v, i) => round4(v - info.min[i])), source: t('operazione booleana'),
        stock: items.every(x => x.item.stock),
      });
      // le lavorazioni che avevano come ostacolo uno dei solidi di partenza considerano il risultato
      for (const op of p.operations) {
        if (!(op.obstacles || []).some(o => ids.has(o))) continue;
        if (!keep.checked) op.obstacles = op.obstacles.filter(o => !ids.has(o));
        op.obstacles.push(id);
      }
      if (keep.checked) for (const x of items) resolve({ type: x.type, id: x.item.id }).item.visible = false;
      else {
        p.objects = p.objects.filter(o => !ids.has(o.id));
        p.artifacts = p.artifacts.filter(a => !ids.has(a.id));
      }
    });
    select({ type: 'object', id });
    log.info('Operazione booleana', { kind, items: items.map(x => x.item.name), triangles: info.triangles });
    status(t('{op}: {tri} triangoli', { op: title, tri: num(info.triangles) }));
  };

  // ================================================================ PIANI
  /** Modalità "aggiungi piano": finché non è attiva i comandi di creazione dei piani restano disabilitati. */
  cmd.startPlaneMode = () => {
    if (sketch.active) sketch.exit();
    if (sim.active) sim.stop();
    App.planeMode = true;
    const hint = document.getElementById('hint');
    hint.innerHTML = PLANE_MODE_HINT();
    hint.hidden = false;
    log.action('plane.mode.start');
    emit('mode');
  };
  cmd.endPlaneMode = () => {
    if (!App.planeMode) return;
    App.planeMode = false;
    if (!App.pickMode) document.getElementById('hint').hidden = true;
    emit('mode');
  };
  cmd.togglePlaneMode = () => (App.planeMode ? cmd.endPlaneMode() : cmd.startPlaneMode());

  cmd.addPlane = preset => {
    const ps = PLANE_PRESETS.find(x => x.id === (PRESET_ALIAS[preset] || preset)) || PLANE_PRESETS[0];
    const box = sceneBox();
    const has = !box.isEmpty();
    const c = has ? box.getCenter(new THREE.Vector3()) : new THREE.Vector3();
    const sz = has ? box.getSize(new THREE.Vector3()) : new THREE.Vector3(80, 80, 80);
    const n = ps.normal;
    const ax = n.findIndex(v => v !== 0);
    // origine sulla faccia dell'ingombro verso cui punta la normale
    const origin = [c.x, c.y, c.z];
    origin[ax] = has ? (n[ax] > 0 ? box.max.getComponent(ax) : box.min.getComponent(ax)) : 0;
    const others = [0, 1, 2].filter(i => i !== ax).map(i => sz.getComponent(i));
    cmd.createPlane(origin, n, Math.max(60, Math.ceil(Math.max(...others) * 1.3 / 10) * 10));
  };

  cmd.createPlane = (origin, normal, size = 100, angle = 0) => {
    const id = uid('pl');
    mutate(p => {
      p.planes.push({
        id, name: nextName(t('Piano')), origin: origin.map(round4), normal: normal.map(v => Math.round(v * 1e6) / 1e6),
        angle, size, visible: true, locked: false, sketches: [],
      });
    });
    cmd.endPlaneMode();
    select({ type: 'plane', id });
    log.info('Piano creato', { normal });
    status(t('Piano creato: aggiungi uno sketch per disegnare l\'area di contenimento'));
    return id;
  };

  /**
   * Piano dalla vista: normale verso chi guarda, appoggiato al punto del modello più vicino all'osservatore
   * (da lì parte la svuotatura), centrato sull'ingombro visto e con l'asse U allineato alla destra dello schermo,
   * così lo sketch si disegna come lo si vede.
   */
  cmd.planeFromView = () => {
    if (sketch.active) sketch.exit();
    const n = vp.camera.position.clone().sub(vp.controls.target).normalize();
    // vicino a una vista standard (facce, spigoli, vertici del cubo) si usa la direzione esatta:
    // dall'alto il piano risulta allineato a XY e il G-code resta a 3 assi
    const snap = VIEW_SNAP.find(d => d.angleTo(n) < THREE.MathUtils.degToRad(1));
    if (snap) n.copy(snap);
    vp.camera.updateMatrixWorld();
    const right = new THREE.Vector3().setFromMatrixColumn(vp.camera.matrixWorld, 0);
    right.addScaledVector(n, -right.dot(n));
    let angle = right.lengthSq() > 1e-8 ? angleOfU(n, right.normalize()) : 0;
    angle = Math.abs(angle - Math.round(angle)) < 0.05 ? Math.round(angle) : Math.round(angle * 1000) / 1000;
    if (angle <= -180) angle += 360;
    const f = planeFrame({ normal: n.toArray(), angle, origin: [0, 0, 0] });

    // ingombro del modello nel sistema del piano, dai vertici reali (non dal box allineato agli assi)
    let umin = Infinity, umax = -Infinity, vmin = Infinity, vmax = -Infinity, wmax = -Infinity;
    const p = new THREE.Vector3();
    for (const g of [vp.groups.objects, vp.groups.artifacts]) {
      g.updateMatrixWorld(true);
      g.traverseVisible(o => {
        const pos = o.isMesh ? o.geometry?.attributes.position : null;
        if (!pos) return;
        for (let i = 0; i < pos.count; i++) {
          p.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld);
          const u = p.dot(f.u), v = p.dot(f.v), w = p.dot(f.n);
          if (u < umin) umin = u;
          if (u > umax) umax = u;
          if (v < vmin) vmin = v;
          if (v > vmax) vmax = v;
          if (w > wmax) wmax = w;
        }
      });
    }
    let origin = vp.controls.target.clone(), size = 100;
    if (wmax > -Infinity) {
      origin = f.u.clone().multiplyScalar((umin + umax) / 2).addScaledVector(f.v, (vmin + vmax) / 2).addScaledVector(f.n, wmax);
      size = Math.max(60, Math.ceil(Math.max(umax - umin, vmax - vmin) * 1.3 / 10) * 10);
    }
    cmd.createPlane(origin.toArray(), n.toArray(), size, angle);
    const axis = AXIS_NAMES.find(a => a.d.angleTo(n) < 1e-9)?.name || `(${n.toArray().map(x => fmt(x, 3)).join(', ')})`;
    status(t('Piano dalla vista: normale {axis}, appoggiato al modello. Aggiungi uno sketch per l\'area di contenimento', { axis }));
  };

  cmd.planeFromFace = () => {
    startPick({ kind: 'face' }, t('Clic su una superficie di un oggetto o artefatto: il piano avrà la normale della faccia · <b>Esc</b> annulla'));
  };

  cmd.planeFrom3Points = () => {
    startPick({ kind: '3pt', pts: [] }, t('Clic su 3 punti degli oggetti per definire il piano ({i}/3) · <b>Esc</b> annulla', { i: 1 }));
    status(t('Avvicinandosi a un vertice di solidi o sketch il punto si aggancia (pallino arancione)'));
  };

  // ---------------------------------------------------------------- aggancio ai vertici (piano da 3 punti, origini)
  const SNAP_KINDS = ['3pt', 'origin', 'ref', 'reloc'];
  const SNAP_PX = 12;
  let snapMarker = null;

  function snapTargets() {
    const list = [];
    for (const g of [vp.groups.objects, vp.groups.artifacts]) g.traverseVisible(o => { if (o.isMesh && o.userData.type) list.push(o); });
    return list;
  }

  /**
   * Punto sotto il puntatore, agganciato al vertice più vicino entro SNAP_PX pixel: vertici del triangolo colpito,
   * punti notevoli degli artefatti, vertici e centri delle entità degli sketch, origini dei piani e punti di origine.
   * { point, snapped, hit } oppure null se non c'è né una superficie né un vertice vicino.
   */
  function pickPoint(ev) {
    const hit = vp.raycast(ev, snapTargets(), false)[0] || null;
    const cands = [];
    if (hit?.face) {
      const o = hit.object;
      const pos = o.geometry.attributes.position;
      for (const k of ['a', 'b', 'c']) cands.push(new THREE.Vector3().fromBufferAttribute(pos, hit.face[k]).applyMatrix4(o.matrixWorld));
    }
    for (const a of App.project.artifacts) {
      const obj = a.visible !== false && sync.objectFor('artifact', a.id);
      if (!obj) continue;
      obj.updateMatrixWorld(true);
      for (const q of artifactKeyPoints(a)) cands.push(new THREE.Vector3(...q).applyMatrix4(obj.matrixWorld));
    }
    for (const pl of App.project.planes) {
      if (pl.visible === false) continue;
      const f = planeFrame(pl);
      cands.push(f.o.clone());
      for (const sk of pl.sketches) {
        if (sk.visible === false) continue;
        for (const e of sk.entities) for (const q of entitySnapPoints(e)) cands.push(toWorld(f, q[0], q[1]));
      }
    }
    for (const og of App.project.origins) if (og.visible !== false) cands.push(new THREE.Vector3(...og.position));
    const m = vp.pointer(ev);
    const near = [];
    for (const c of cands) {
      const sc = vp.toScreen(c);
      if (!sc) continue;
      const d = Math.hypot(sc.x - m.x, sc.y - m.y);
      if (d < SNAP_PX) near.push({ c, d });
    }
    near.sort((a, b) => a.d - b.d);
    // il più vicino tra i vertici visibili: quelli nascosti dietro un solido non si agganciano
    const targets = snapTargets();
    const eye = vp.camera.isOrthographicCamera ? null : vp.camera.position.clone();
    const best = near.slice(0, 8).find(({ c }) => {
      const from = eye || c.clone().sub(vp.camera.getWorldDirection(new THREE.Vector3()).multiplyScalar(1e5));
      const dir = c.clone().sub(from);
      const dist = dir.length();
      vp.raycaster.set(from, dir.normalize());
      const first = vp.raycaster.intersectObjects(targets, false)[0];
      return !first || first.distance >= dist - Math.max(0.05, dist * 1e-4);
    })?.c;
    if (best) return { point: best, snapped: true, hit };
    return hit ? { point: hit.point.clone(), snapped: false, hit } : null;
  }

  function showSnap(r) {
    if (!snapMarker) {
      snapMarker = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 10), new THREE.MeshBasicMaterial({ depthTest: false, transparent: true }));
      snapMarker.renderOrder = 40;
      snapMarker.raycast = () => {};
      vp.scene.add(snapMarker);
    }
    snapMarker.visible = !!r;
    if (!r) return;
    snapMarker.position.copy(r.point);
    snapMarker.scale.setScalar(vp.pixelSize(r.point) * (r.snapped ? 6 : 3.5));
    snapMarker.material.color.set(r.snapped ? 0xff8a3d : 0xffffff);
  }

  /** Punto sotto il puntatore con aggancio ai vertici (comandi di modifica): { point, snapped, hit } o null. */
  cmd.snapPoint = ev => pickPoint(ev);

  /** Movimento del mouse in una modalità di scelta punti: evidenzia il vertice agganciabile. */
  cmd.pickHover = ev => {
    if (!App.pickMode || !SNAP_KINDS.includes(App.pickMode.kind)) { showSnap(null); return null; }
    const r = pickPoint(ev);
    showSnap(r);
    return r;
  };

  function startPick(mode, hintHtml) {
    if (sketch.active) sketch.exit();
    App.pickMode = mode;
    vp.transform.detach();
    vp.el.classList.add('picking');
    const hint = document.getElementById('hint');
    hint.innerHTML = hintHtml;
    hint.hidden = false;
    emit('gizmo');
  }

  cmd.cancelPick = () => {
    if (App.pickMode?.kind === 'pivot') { gizmo.cancelPivotPick(); return; }
    if (App.pickMode?.kind === 'modify') { cmd.modifyCancel?.(); return; }
    App.pickMode = null;
    showSnap(null);
    vp.el.classList.remove('picking');
    const hint = document.getElementById('hint');
    if (App.planeMode) hint.innerHTML = PLANE_MODE_HINT();
    else hint.hidden = true;
    clearHelpers();
    emit('gizmo');
  };

  function clearHelpers() {
    for (const c of [...vp.groups.helpers.children]) {
      c.removeFromParent();
      c.geometry?.dispose(); c.material?.dispose();
    }
  }

  /** Gestisce un clic nel 3D quando è attiva una modalità di selezione punti. */
  cmd.handlePick = ev => {
    const pm = App.pickMode;
    if (!pm || ev.button !== 0) return;
    if (SNAP_KINDS.includes(pm.kind)) { pickSnapped(pm, ev); return; }
    const targets = [];
    vp.groups.objects.traverseVisible(o => { if (o.isMesh) targets.push(o); });
    vp.groups.artifacts.traverseVisible(o => { if (o.isMesh) targets.push(o); });
    const hit = vp.raycast(ev, targets, false)[0];
    if (!hit) { toast(t('Nessuna superficie sotto il cursore'), 'warn', 1800); return; }
    const p = hit.point.clone();
    if (pm.kind === 'face') {
      const n = hit.face.normal.clone().transformDirection(hit.object.matrixWorld).normalize();
      const toCam = vp.camera.position.clone().sub(p);
      if (n.dot(toCam) < 0) n.negate();
      cmd.cancelPick();
      cmd.createPlane(p.toArray(), n.toArray(), 80);
      return;
    }
  };

  /** Clic nelle modalità con aggancio ai vertici: piano da 3 punti, nuova origine del progetto, punto di origine. */
  function pickSnapped(pm, ev) {
    const r = pickPoint(ev);
    if (!r) { toast(t('Nessuna superficie o vertice sotto il cursore'), 'warn', 1800); return; }
    const p = r.point.clone();
    if (pm.kind === 'origin') {
      cmd.cancelPick();
      cmd.moveOrigin([p.x, p.y, p.z].map(round4));
      return;
    }
    if (pm.kind === 'ref') {
      cmd.cancelPick();
      cmd.createOrigin([p.x, p.y, p.z]);
      return;
    }
    if (pm.kind === 'reloc') {
      cmd.cancelPick();
      const og = getOrigin(pm.id);
      if (!og) return;
      mutate(() => { og.position = [p.x, p.y, p.z].map(round4); });
      select({ type: 'origin', id: og.id });
      log.info('Punto di origine spostato', { name: og.name, position: og.position });
      status(t('"{name}" spostato in {p}', { name: og.name, p: og.position.map(v => fmt(v, 3)).join('; ') }));
      return;
    }
    // piano da 3 punti
    pm.pts.push(p);
    const m = new THREE.Mesh(new THREE.SphereGeometry(vp.pixelSize(p) * 5, 12, 8), new THREE.MeshBasicMaterial({ color: 0xff8a3d, depthTest: false }));
    m.position.copy(p);
    m.renderOrder = 30;
    vp.groups.helpers.add(m);
    document.getElementById('hint').innerHTML = t('Clic su 3 punti degli oggetti per definire il piano ({i}/3) · <b>Esc</b> annulla', { i: pm.pts.length + 1 });
    status(t('Punto {i}: {p}{s}', { i: pm.pts.length, p: p.toArray().map(v => fmt(v, 3)).join('; '), s: r.snapped ? ` (${t('vertice')})` : '' }));
    if (pm.pts.length === 3) {
      const [a, b, c] = pm.pts;
      const n = b.clone().sub(a).cross(c.clone().sub(a));
      if (n.lengthSq() < 1e-10) { toast(t('Punti allineati: riprovare'), 'err'); pm.pts = []; clearHelpers(); return; }
      n.normalize();
      if (n.dot(vp.camera.position.clone().sub(a)) < 0) n.negate();
      const size = Math.max(a.distanceTo(b), b.distanceTo(c), c.distanceTo(a)) * 1.5;
      cmd.cancelPick();
      cmd.createPlane(a.toArray(), n.toArray(), Math.max(40, Math.ceil(size / 10) * 10));
    }
  }

  /**
   * Inverte la normale (asse utensile) del piano lasciando gli sketch dove sono: con la normale opposta e la
   * rotazione nel piano cambiata di segno l'asse U resta lo stesso e l'asse V si inverte, quindi le entità si
   * ribaltano in V (altrimenti comparirebbero specchiate).
   */
  cmd.flipNormal = planeId => {
    const pl = getPlane(planeId);
    if (!pl) return;
    if (pl.locked) { lockedWarn(); return; }
    mutate(() => {
      pl.normal = pl.normal.map(v => (v === 0 ? 0 : -v));
      pl.angle = pl.angle ? -pl.angle : 0;
      for (const s of pl.sketches) for (const e of s.entities) mirrorEntityV(e);
    });
    sketch.refreshFrame();
  };

  cmd.viewNormal = planeId => {
    const pl = getPlane(planeId || planeOfSelection()?.id);
    if (!pl) { toast(t('Selezionare un piano (o uno sketch, un\'entità, una lavorazione)'), 'warn'); return; }
    const f = planeFrame(pl);
    vp.lookAlongFrame(f, false, (pl.size || 100) * 1.8);
  };

  // ================================================================ SKETCH
  cmd.newSketch = planeId => {
    const r = resolve();
    const pl = planeId ? getPlane(planeId) : (r?.type === 'plane' ? r.item : null);
    if (!pl) { toast(t('Selezionare prima il piano su cui creare lo sketch'), 'warn'); return; }
    const id = uid('sk');
    mutate(() => {
      getPlane(pl.id).sketches.push({ id, name: nextName(t('Sketch')), visible: true, entities: [] });
    });
    sketch.enter(id);
  };

  cmd.editSketch = id => {
    const sid = id || sketchOfSelection()?.id;
    if (!sid) { toast(t('Selezionare uno sketch'), 'warn'); return; }
    sim.stop();
    if (App.pickMode) cmd.cancelPick();
    cmd.endPlaneMode();
    sketch.enter(sid);
  };

  cmd.finishSketch = () => sketch.exit();

  cmd.sketchTool = tool => {
    if (!sketch.active) { toast(t('Gli strumenti di disegno si usano dentro uno sketch: Modifica sketch o Nuovo sketch'), 'warn'); return; }
    sketch.setTool(tool);
  };

  // ================================================================ LAVORAZIONI
  /**
   * Nuova lavorazione dallo sketch selezionato (o da entità selezionate dello stesso sketch): si sceglie
   * l'utensile dal magazzino, poi il setup dei parametri.
   */
  cmd.newOperation = async (kind, sketchId) => {
    if (opsBlocked()) return;
    const src = sketchId ? { sketchId, entityIds: null } : operationSource();
    if (!src) {
      modal({
        title: t('Serve un contorno'),
        body: h('div', {}, t('Selezionare uno sketch, oppure una o più entità dello stesso sketch, che definiscano l\'area di contenimento della lavorazione.')),
      });
      return;
    }
    const sk = getSketch(src.sketchId);
    if (!sk) return;
    if (!sk.sketch.entities.length) { toast(t('Lo sketch "{name}" non contiene contorni chiusi', { name: sk.sketch.name }), 'warn'); return; }
    let libTool = null, chosen = null;
    for (;;) {
      libTool = await pickTool(kind, libTool?.id);
      if (!libTool) return;
      chosen = await pickSetup(kind, libTool);
      if (chosen === 'back') continue;
      if (!chosen) return;
      break;
    }
    const d = structuredClone(OP_DEFAULTS[kind]);
    const base = d.base;
    delete d.base;
    const setup = chosen.setup;
    if (setup) Object.assign(d, structuredClone(setup.params));
    delete d.climb;   // concorde è dell'utensile (setup salvati con le versioni precedenti)
    if (!setup || setup.useToolFeeds !== false) {
      if (libTool.feed > 0) d.feed = libTool.feed;
      if (libTool.plunge > 0) d.plunge = libTool.plunge;
      if (libTool.spindle > 0) d.spindle = libTool.spindle;
      if (d.rampFeed > 0 && libTool.feed > 0) d.rampFeed = Math.round(libTool.feed / 2);
    }
    const all = sk.sketch.entities.map(e => e.id);
    const entityIds = src.entityIds && src.entityIds.length < all.length ? [...src.entityIds] : null;
    const id = uid('op');
    mutate(p => {
      p.operations.push({
        id, name: nextName(t(base)), kind, sketchId: src.sketchId, entityIds, visible: true,
        ...d, tool: toolFromLibrary(libTool), setupId: setup?.id || null, setupName: setup?.name || '',
        // ostacoli: gli elementi esistenti ora; quelli aggiunti dopo vanno abilitati a mano
        obstacles: [...p.objects, ...p.artifacts].map(x => x.id),
      });
    });
    log.info('Lavorazione creata', { kind, tool: libTool.name, setup: setup?.name || 'predefiniti', entities: entityIds?.length || 'tutte' });
    if (sketch.active) sketch.exit();
    select({ type: 'operation', id });
    status(t('Lavorazione creata: premi Calcola (F9) per generare il percorso'));
  };

  // ---------------------------------------------------------------- sequenza delle lavorazioni
  const opLine = op => `T${op.tool?.number ?? ''} · ${op.kind === 'finish' ? t('finitura') : t('svuotatura')}`;

  function applyOrder(order) {
    const ops = App.project.operations;
    if (order.length !== ops.length || order.every((o, i) => o === ops[i])) return false;
    if (sim.active) sim.stop();
    mutate(p => { p.operations = order.map(o => p.operations.find(x => x.id === o.id)); });
    log.info('Sequenza delle lavorazioni cambiata', { order: order.map(o => o.name) });
    status(t('Nuova sequenza delle lavorazioni: la simulazione e il G-code seguono quest\'ordine'));
    return true;
  }

  /** Sposta le lavorazioni ids prima di beforeId (null: in fondo), dopo conferma della nuova sequenza. */
  cmd.moveOperations = async (ids, beforeId) => {
    if (opsBlocked()) return;
    const ops = App.project.operations;
    const moving = ops.filter(o => ids.includes(o.id));
    if (!moving.length) return;
    const rest = ops.filter(o => !ids.includes(o.id));
    let idx = beforeId ? rest.findIndex(o => o.id === beforeId) : rest.length;
    if (idx < 0) idx = rest.length;
    const order = [...rest.slice(0, idx), ...moving, ...rest.slice(idx)];
    if (order.every((o, i) => o === ops[i])) return;
    const list = h('ol', { class: 'op-order' }, order.map(o => h('li', { class: ids.includes(o.id) ? 'moved' : '' },
      h('span', { class: 'ico', html: o.kind === 'finish' ? ICONS.finish : ICONS.pocket }), h('span', { class: 'lbl' }, o.name), h('span', { class: 'sub' }, opLine(o)))));
    const ok = await modal({
      title: t('Sposta lavorazioni'),
      body: h('div', {}, h('p', { style: { margin: '0 0 6px' } }, t('Confermare la nuova sequenza delle lavorazioni?')), list,
        h('p', { class: 'p-note' }, t('L\'ordine è quello di esecuzione: simulazione "fino all\'ultima", Simula tutto ed esportazione G-code lo seguono.'))),
      buttons: [{ label: t('Annulla'), value: false }, { label: t('Conferma'), value: true, primary: true }],
    });
    if (ok) applyOrder(order);
  };

  /** Finestra per riordinare le lavorazioni con i pulsanti su/giù (o trascinando le righe). */
  cmd.reorderOperations = async () => {
    if (opsBlocked()) return;
    let order = [...App.project.operations];
    if (order.length < 2) return;
    let sel = resolve()?.type === 'operation' ? App.selection.id : order[0].id;
    const list = h('ol', { class: 'op-order editable' });
    let dragId = null;
    const move = (id, to) => {
      const i = order.findIndex(o => o.id === id);
      if (i < 0 || to < 0 || to >= order.length || to === i) return;
      const [x] = order.splice(i, 1);
      order.splice(to, 0, x);
      draw();
    };
    const draw = () => {
      list.replaceChildren(...order.map((o, i) => {
        const up = h('button', { class: 'icon-btn', type: 'button', title: t('Sposta su'), disabled: i === 0, onclick: e => { e.stopPropagation(); sel = o.id; move(o.id, i - 1); } }, '▲');
        const dn = h('button', { class: 'icon-btn', type: 'button', title: t('Sposta giù'), disabled: i === order.length - 1, onclick: e => { e.stopPropagation(); sel = o.id; move(o.id, i + 1); } }, '▼');
        const li = h('li', { class: o.id === sel ? 'sel' : '', draggable: 'true' },
          h('span', { class: 'grip', html: ICONS.grip }), h('span', { class: 'ico', html: o.kind === 'finish' ? ICONS.finish : ICONS.pocket }),
          h('span', { class: 'lbl' }, o.name), h('span', { class: 'sub' }, opLine(o)), up, dn);
        li.addEventListener('click', () => { sel = o.id; draw(); });
        li.addEventListener('dragstart', e => { dragId = o.id; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', o.id); });
        li.addEventListener('dragover', e => { if (dragId) { e.preventDefault(); li.classList.add('drop-before'); } });
        li.addEventListener('dragleave', () => li.classList.remove('drop-before'));
        li.addEventListener('drop', e => { e.preventDefault(); const id = dragId; dragId = null; sel = id; const j = order.findIndex(x => x.id === o.id); const k = order.findIndex(x => x.id === id); move(id, k < j ? j - 1 : j); });
        li.addEventListener('dragend', () => { dragId = null; draw(); });
        return li;
      }));
    };
    draw();
    const keys = e => {
      const i = order.findIndex(o => o.id === sel);
      if (e.altKey && e.key === 'ArrowUp') { e.preventDefault(); move(sel, i - 1); }
      if (e.altKey && e.key === 'ArrowDown') { e.preventDefault(); move(sel, i + 1); }
    };
    const ok = await modal({
      title: t('Riordina lavorazioni'),
      body: h('div', { onkeydown: keys }, list,
        h('p', { class: 'p-note' }, t('Trascina le righe o usa ▲ ▼ (Alt+frecce sulla riga selezionata). L\'ordine è quello di esecuzione di simulazione e G-code.'))),
      buttons: [{ label: t('Annulla'), value: false }, { label: t('Applica'), value: true, primary: true }],
    });
    if (ok) applyOrder(order);
  };

  /** Copia nella lavorazione un utensile del magazzino. */
  cmd.setToolFromLibrary = async (opId, libId) => {
    const lt = (await getTools()).find(x => x.id === libId);
    if (!lt) return;
    mutate(() => {
      const op = getOperation(opId);
      if (op) op.tool = toolFromLibrary(lt);
    });
  };

  cmd.setObstacle = (opId, itemId, on) => {
    mutate(() => {
      const op = getOperation(opId);
      if (!op) return;
      const s = new Set(op.obstacles || []);
      if (on) s.add(itemId); else s.delete(itemId);
      op.obstacles = [...s];
    });
  };
  cmd.setAllObstacles = (opId, on) => {
    mutate(p => {
      const op = getOperation(opId);
      if (op) op.obstacles = on ? [...p.objects, ...p.artifacts].map(x => x.id) : [];
    });
  };

  /** Evidenzia nella vista un elemento della scena (null: nessuno). */
  cmd.hoverItem = ref => sync.setHover(ref);

  cmd.useWholeSketch = opId => mutate(() => { const op = getOperation(opId); if (op) op.entityIds = null; });

  /** Parametro relativo: on/off (convertendo il valore) e campi pct/min/max. */
  cmd.setRel = (opId, key, patch) => {
    mutate(() => {
      const op = getOperation(opId);
      if (!op) return;
      op.rel = op.rel || {};
      const cur = op.rel[key] || { on: false, pct: 50, min: 0, max: 0 };
      if ('on' in patch && patch.on !== cur.on) {
        const base = key === 'stepdown' ? (op.tool.fluteLength || op.tool.diameter * 2.5) : op.tool.diameter;
        if (patch.on) cur.pct = round4((op[key] || 0) / Math.max(1e-9, base) * 100);
        else op[key] = effParam(op, key);
      }
      op.rel[key] = { ...cur, ...patch };
    });
  };

  cmd.saveAsSetup = opId => { const op = getOperation(opId); if (op) saveOperationAsSetup(op); };
  cmd.toolLibrary = () => openToolLibrary();
  cmd.exportLibrary = () => exportLibrary();
  cmd.importLibrary = () => importLibrary();
  cmd.setupLibrary = () => openSetupLibrary();
  cmd.machineLibrary = () => openMachineLibrary();
  cmd.options = () => openOptions({ vp });

  /** Artefatto per il server; send: con i triangoli dei profili estrusi (per il confronto basta la loro definizione). */
  const artifactReq = (x, send) => ({
    id: x.id, name: x.name, kind: x.kind, size: x.size, radius: x.radius, radius2: x.radius2, height: x.height,
    position: x.position, rotation: x.rotation, include: true,
    ...(x.kind === 'extrude' ? (send ? { mesh: extrudeMesh(x) } : { profile: x.profile, side: x.side }) : {}),
  });
  const objectReq = x => ({ meshId: x.meshId, name: x.name, position: x.position, rotation: x.rotation, scale: x.scale, include: true });

  /**
   * Richiesta di calcolo. Con il grezzo: la prima lavorazione riceve i solidi del grezzo, le successive il percorso
   * della precedente (il server parte dal grezzo che ha lasciato). send: richiesta da inviare (non per il confronto).
   */
  function buildRequest(op, send = false) {
    const sk = getSketch(op.sketchId);
    if (!sk) throw new Error(t('"{name}": selezionare uno sketch di contorno', { name: op.name }));
    let ents = sk.sketch.entities;
    if (Array.isArray(op.entityIds) && op.entityIds.length) ents = ents.filter(e => op.entityIds.includes(e.id));
    ents = ents.filter(e => e.kind !== 'polyline' || (e.pts && e.pts.length >= 3));
    if (!ents.length) throw new Error(t('Lo sketch "{name}" non contiene contorni chiusi', { name: sk.sketch.name }));
    const f = planeFrame(sk.plane);
    const vec = v => [v.x, v.y, v.z];
    const o = op;
    const obst = new Set(o.obstacles || []);
    return {
      operation: {
        id: o.id, name: o.name, kind: o.kind, strategy: o.strategy,
        tool: {
          number: o.tool.number, type: o.tool.type, diameter: o.tool.diameter, cornerRadius: o.tool.cornerRadius,
          rotation: o.tool.rotation === 'ccw' ? 'ccw' : 'cw', climb: o.tool.climb !== false,
          // fresa conica: altezza del cono, angolo per lato e punta
          ...(o.tool.type === 'taper' ? { fluteLength: o.tool.fluteLength, taperAngle: o.tool.taperAngle ?? 5, tipType: o.tool.tipType || 'ball' } : {}),
        },
        stepover: effParam(o, 'stepover'), stepdown: effParam(o, 'stepdown'), maxDepth: o.maxDepth, stock: o.stock, safeHeight: o.safeHeight,
        clearance: o.clearance, angle: o.angle, toolInside: o.toolInside !== false,
        contourPass: o.contourPass !== false, resolution: o.resolution, tolerance: o.tolerance,
        feed: o.feed, plunge: o.plunge, spindle: o.spindle,
        entry: o.entry || 'plunge', rampAngle: o.rampAngle ?? 3, helixRadius: effParam(o, 'helixRadius') ?? 0, rampFeed: o.rampFeed ?? 0,
      },
      plane: { origin: vec(f.o), u: vec(f.u), v: vec(f.v), n: vec(f.n) },
      boundary: ents.map(e => ({
        id: e.id, kind: e.kind, pts: e.pts, closed: true, x1: e.x1, y1: e.y1, x2: e.x2, y2: e.y2,
        cx: e.cx, cy: e.cy, r: e.r, sides: e.sides, rot: e.rot,
      })),
      objects: App.project.objects.filter(x => obst.has(x.id) && x.meshId && !x.stock).map(objectReq),
      artifacts: App.project.artifacts.filter(x => obst.has(x.id) && !x.stock).map(x => artifactReq(x, send)),
      ...stockOf(op, send),
      // la fresa non scende sotto il piano della griglia (z 0) se la lavorazione è limitata
      floor: o.belowGrid === 'limit' ? 0 : null,
    };
  }

  function stockOf(op, send) {
    if (!hasStock()) return {};
    const ops = App.project.operations;
    const prev = ops[ops.indexOf(op) - 1];
    if (prev) return { stockFrom: App.runtime.toolpaths.get(prev.id)?.toolpathId || '' };
    return { stock: {
      objects: App.project.objects.filter(x => x.stock && x.meshId).map(objectReq),
      artifacts: App.project.artifacts.filter(x => x.stock).map(x => artifactReq(x, send)),
    } };
  }

  function requestHash(req) {
    return JSON.stringify({
      ...req,
      operation: { ...req.operation, name: undefined },
      objects: req.objects.map(o => ({ ...o, name: undefined })),
      artifacts: req.artifacts.map(a => ({ ...a, name: undefined })),
    });
  }

  cmd.opStatus = op => {
    const d = App.runtime.toolpaths.get(op.id);
    if (!d) return 'none';
    try { return requestHash(buildRequest(op)) === d.hash ? 'ok' : 'stale'; } catch { return 'stale'; }
  };

  async function computeOne(op, signal) {
    const req = buildRequest(op, true);
    const t0 = performance.now();
    log.info(`Calcolo "${op.name}"`, { kind: op.kind, strategy: op.strategy, tool: req.operation.tool, stepover: req.operation.stepover, stepdown: req.operation.stepdown, boundary: req.boundary.length, objects: req.objects.length, artifacts: req.artifacts.length });
    let res = await api.compute(req, signal);
    // la fresa scende sotto il piano della griglia: si chiede se consentirlo (la scelta resta nella lavorazione)
    if (!op.belowGrid && res.stats?.minZ < -0.001) {
      const choice = await askBelowGrid(op, -res.stats.minZ);
      if (!choice) throw new DOMException(t('Calcolo annullato'), 'AbortError');
      mutate(() => { op.belowGrid = choice; });
      log.info(`"${op.name}" sotto la griglia: ${choice}`, { minZ: res.stats.minZ });
      if (choice === 'limit') res = await api.compute(buildRequest(op, true), signal);
    }
    const tp = await api.getToolpath(res.toolpathId);
    App.runtime.toolpaths.set(op.id, {
      toolpathId: res.toolpathId, hash: requestHash(buildRequest(op)), stats: res.stats, warnings: res.warnings || [],
      positions: tp.positions, types: tp.types, hasStock: !!res.hasStock,
    });
    log.info(`Calcolo "${op.name}" concluso in ${Math.round(performance.now() - t0)} ms`, { points: res.stats?.pointCount, warnings: res.warnings?.length || 0, maxGouge: res.stats?.maxGouge });
    return res;
  }

  /** Chiede se la lavorazione può scendere sotto il piano della griglia: 'allow', 'limit' o null (annulla). */
  function askBelowGrid(op, depth) {
    return modal({
      title: t('Sotto il piano della griglia'),
      body: h('div', {},
        h('p', { style: { marginTop: 0 } }, t('La lavorazione "{name}" porta la fresa fino a {d} mm sotto il piano base della griglia (Z 0), dove di solito appoggia il pezzo.', { name: op.name, d: fmt(depth, 2) })),
        h('p', {}, t('Consentire di scendere sotto il piano?')),
        h('p', { class: 'p-note' }, t('"Limita al piano" ricalcola la lavorazione fermando la fresa sul piano della griglia. La scelta resta nelle proprietà della lavorazione (Sotto la griglia).'))),
      buttons: [
        { label: t('Annulla'), value: null, left: true },
        { label: t('Scendi sotto il piano'), value: 'allow', danger: true },
        { label: t('Limita al piano'), value: 'limit', primary: true },
      ],
    });
  }

  cmd.compute = async opId => {
    const op = getOperation(opId);
    if (!op) return;
    // con il grezzo la lavorazione dipende dalle precedenti: si calcolano in ordine quelle non aggiornate
    if (hasStock()) {
      const ok = await ensureComputed([op], true);
      const d = App.runtime.toolpaths.get(op.id);
      if (ok && d) status(t('"{name}": {pts} punti, {len} m di lavoro, {ms} ms', { name: op.name, pts: num(d.stats.pointCount), len: fmt(d.stats.feedLength / 1000, 2), ms: d.stats.computeMs }));
      return ok;
    }
    if (sim.active && sim.listFor(sim.opId).includes(opId)) sim.stop();
    const signal = busy(t('Calcolo "{name}"…', { name: op.name }));
    try {
      const res = await computeOne(op, signal);
      emit('toolpath');
      const s = res.stats;
      status(t('"{name}": {pts} punti, {len} m di lavoro, {lv} {what}, {ms} ms', {
        name: op.name, pts: num(s.pointCount), len: fmt(s.feedLength / 1000, 2), lv: s.levels,
        what: op.kind === 'finish' ? t('passata') : t('terrazze'), ms: s.computeMs,
      }));
      for (const w of res.warnings || []) toast(w, 'warn', 6000);
      if (!res.warnings?.length) toast(t('Percorso "{name}" calcolato', { name: op.name }), 'ok', 2200);
      return true;
    } catch (e) {
      if (e.name === 'AbortError') toast(t('Calcolo annullato'), 'warn');
      else { log.error(`Calcolo "${op.name}" non riuscito`, e); toast(e.message, 'err', 6000); status(e.message, true); }
      return false;
    } finally { idle(); }
  };

  cmd.computeSelected = () => {
    const r = resolve();
    if (r?.type === 'operation') return cmd.compute(r.item.id);
    if (App.project.operations.length) return cmd.computeAll();
    toast(t('Nessuna lavorazione da calcolare'), 'warn');
  };

  /**
   * Calcola le lavorazioni indicate che non sono aggiornate (force: tutte quelle indicate). Con il grezzo ogni
   * lavorazione parte da quello lasciato dalla precedente: si considerano anche le precedenti, in ordine, e lo
   * stato si valuta man mano (ricalcolarne una rende da ricalcolare le successive).
   */
  async function ensureComputed(ops, force = false) {
    ops = ops.filter(Boolean);
    const all = App.project.operations;
    const chain = hasStock();
    const list = chain && ops.length ? all.slice(0, Math.max(...ops.map(o => all.indexOf(o))) + 1) : ops;
    const forced = new Set(force ? ops.map(o => o.id) : []);
    const needs = op => forced.has(op.id) || cmd.opStatus(op) !== 'ok';
    if (!list.some(needs)) return true;
    sim.stop();   // i percorsi cambiano: la simulazione in corso non è più valida
    const signal = busy(t('Calcolo lavorazioni…'));
    try {
      let retried = false;
      for (let i = 0; i < list.length; i++) {
        const op = list[i];
        if (!needs(op)) continue;
        busyText(t('Calcolo {i}/{n}: "{name}"…', { i: i + 1, n: list.length, name: op.name }));
        let res;
        try {
          res = await computeOne(op, signal);
        } catch (e) {
          // il server non ha più il grezzo della lavorazione precedente (es. riavviato): si ricalcola la catena
          if (e.code !== 'stock-chain' || retried) throw e;
          retried = true;
          for (const o of all) App.runtime.toolpaths.delete(o.id);
          for (const o of list) forced.add(o.id);
          i = -1;
          continue;
        }
        forced.delete(op.id);
        for (const w of res.warnings || []) toast(`${op.name}: ${w}`, 'warn', 6000);
      }
      return true;
    } catch (e) {
      if (e.name === 'AbortError') toast(t('Calcolo annullato'), 'warn');
      else { log.error('Calcolo delle lavorazioni non riuscito', e); toast(e.message, 'err', 6000); }
      return false;
    } finally {
      idle();
      emit('toolpath');
    }
  }
  sim.prepare = ids => ensureComputed(ids.map(getOperation));

  /** Ricalcola tutto: tutte le lavorazioni esistenti, anche quelle aggiornate. */
  cmd.computeAll = async () => {
    const ops = App.project.operations;
    if (!ops.length) { toast(t('Nessuna lavorazione'), 'warn'); return; }
    if (await ensureComputed(ops, true)) status(t('{n} lavorazioni ricalcolate', { n: ops.length }));
  };

  /** Simula la lavorazione (selezionata) secondo l'ambito della barra di simulazione. */
  cmd.simulate = async (opId, scope) => {
    const id = opId || (resolve()?.type === 'operation' ? App.selection.id : null);
    const op = getOperation(id);
    if (!op) { toast(t('Selezionare una lavorazione'), 'warn'); return; }
    if (!(await ensureComputed(sim.listFor(op.id, scope || sim.scope).map(getOperation)))) return;
    if (sketch.active) sketch.exit();
    cmd.endPlaneMode();
    // la simulazione resta aperta finché la lavorazione rimane selezionata
    if (!(App.selected.length === 1 && App.selection?.type === 'operation' && App.selection.id === op.id)) select({ type: 'operation', id: op.id });
    sim.start(op.id, scope);
  };

  /** Simula tutto: dalla prima lavorazione all'ultima. */
  cmd.simulateAll = async () => {
    const first = App.project.operations[0];
    if (!first) { toast(t('Nessuna lavorazione'), 'warn'); return; }
    await cmd.simulate(first.id, 'rest');
  };

  // ---------------------------------------------------------------- esportazione
  cmd.exportGcode = async (opIds, originId) => exportDialog('gcode', opIds, originId);
  cmd.exportCl = async opIds => exportDialog('cl', opIds);

  async function exportDialog(kind, opIds, originId) {
    const ops = App.project.operations;
    if (!ops.length) { toast(t('Nessuna lavorazione da esportare'), 'warn'); return; }
    const preset = new Set(opIds && opIds.length ? opIds : ops.filter(o => o.visible !== false).map(o => o.id));
    const checks = ops.map(op => {
      const c = h('input', { type: 'checkbox' });
      c.checked = preset.has(op.id);
      return { op, c };
    });
    // macchina del magazzino: quella del progetto, l'ultima scelta, oppure quella del controllo usato finora
    let machines = [];
    if (kind === 'gcode') {
      try { machines = await getMachines(); } catch (e) { toast(t('Magazzino macchine non disponibile: {msg}', { msg: e.message }), 'err'); return; }
      if (!machines.length) { toast(t('Il magazzino macchine è vuoto: aggiungi una macchina'), 'warn'); await openMachineLibrary(); machines = await getMachines(); if (!machines.length) return; }
    }
    const mode = h('select', {});
    const fillMachines = () => {
      const keep = mode.value;
      mode.replaceChildren(...machines.map(m => h('option', { value: m.id }, t(m.name))));
      if (keep && machines.some(m => m.id === keep)) mode.value = keep;
    };
    fillMachines();
    {
      let pref = App.project.machineId;
      try { pref = pref || localStorage.getItem(MACHINE_KEY) || ({ grbl: 'grbl', g682: 'fanuc-g682', world: 'iso-world' }[localStorage.getItem(POST_MODE_KEY)] || ''); } catch { /* storage non disponibile */ }
      if (pref && machines.some(m => m.id === pref)) mode.value = pref;
    }
    const machineOf = () => machines.find(m => m.id === mode.value) || machines[0];
    const libBtn = h('button', { class: 'btn', type: 'button', style: { whiteSpace: 'nowrap', flex: '0 0 auto' }, onclick: async () => {
      await openMachineLibrary();
      machines = await getMachines();
      fillMachines();
      syncMode();
    } }, t('Magazzino macchine…'));
    // zero pezzo: origine del progetto oppure uno dei punti di origine
    const origins = App.project.origins || [];
    const zero = h('select', {},
      h('option', { value: '' }, t('Origine del progetto (0, 0, 0)')),
      origins.map(o => h('option', { value: o.id }, `${o.name}  (${o.position.map(v => fmt(v, 2)).join('; ')})`)));
    const lastZero = originId || App.project.gcodeOrigin;
    zero.value = lastZero && origins.some(o => o.id === lastZero) ? lastZero : '';
    const prog = h('input', { value: '1000', style: { width: '90px' } });
    const cool = h('select', {});
    let coolTouched = false;
    cool.addEventListener('change', () => { coolTouched = true; });
    const hint = h('p', { style: { color: 'var(--text-faint)', margin: '2px 0 8px' } });
    const rowProg = h('div', { class: 'form-row' }, h('label', {}, t('Numero programma')), prog);
    function syncMode() {
      const m = machineOf();
      if (!m) return;
      rowProg.hidden = !usesProgramNumber(m);
      // refrigerante: quello predefinito della macchina (se non lo si è già cambiato), con i suoi comandi
      const cmdOf = c => ({ flood: m.coolantFlood, mist: m.coolantMist, air: m.coolantAir }[c] || []).join(' ');
      const was = cool.value;
      cool.replaceChildren(...COOLANTS.map(([v, l]) => h('option', { value: v }, cmdOf(v) ? `${t(l)} (${cmdOf(v)})` : t(l))));
      cool.value = coolTouched && was ? was : (m.coolant || 'none');
      hint.textContent = [machineSummary(m), m.notes ? t(m.notes) : ''].filter(Boolean).join('. ');
    }
    mode.addEventListener('change', syncMode);
    syncMode();
    const body = h('div', {},
      kind === 'gcode' ? [
        h('div', { class: 'form-row' }, h('label', {}, t('Macchina')), h('div', { class: 'form-field' }, mode, libBtn)),
        hint,
        h('div', { class: 'form-row' }, h('label', {}, t('Zero pezzo (origine)')), zero),
        origins.length ? null : h('p', { class: 'p-note', style: { margin: '0 0 6px' } }, t('Per usare un altro zero pezzo crea un punto con il menu Origini.')),
        rowProg,
        h('div', { class: 'form-row' }, h('label', {}, t('Refrigerante')), cool),
      ] : h('p', {}, t('CL data in coordinate mondo con vettore asse utensile (GOTO/x,y,z,i,j,k).')),
      h('div', { class: 'p-sec', style: { padding: '6px 0' } }, t('Lavorazioni')),
      checks.map(({ op, c }) => h('label', { style: { display: 'flex', gap: '8px', alignItems: 'center', padding: '2px 0' } }, c, op.name,
        h('span', { style: { color: 'var(--text-faint)' } }, ` · T${op.tool.number} ${toolLabel(op.tool)} · ${op.kind === 'finish' ? t('finitura') : t('svuotatura')}`))));
    const ok = await modal({
      title: kind === 'gcode' ? t('Esporta G-code') : t('Esporta CL data'), body,
      buttons: [{ label: t('Annulla'), value: false }, { label: t('Genera'), value: true, primary: true }],
    });
    if (!ok) return;
    const selOps = checks.filter(x => x.c.checked).map(x => x.op);
    if (!selOps.length) { toast(t('Nessuna lavorazione selezionata'), 'warn'); return; }
    if (!(await ensureComputed(selOps))) return;
    const ids = selOps.map(o => App.runtime.toolpaths.get(o.id).toolpathId);
    const machine = kind === 'gcode' ? machineOf() : null;
    const zo = kind === 'gcode' ? getOrigin(zero.value) : null;
    if (kind === 'gcode') {
      try { localStorage.setItem(MACHINE_KEY, machine.id); } catch { /* storage non disponibile */ }
      App.project.gcodeOrigin = zo ? zo.id : '';
      App.project.machineId = machine.id;
    }
    const options = {
      origin: zo ? zo.position : null, originName: zo ? zo.name : '',
      machine, coolantMode: kind === 'gcode' ? cool.value : null,
      programNumber: parseInt(prog.value, 10) || 1000, decimals: 3, programName: App.project.name || 'CARVECAM',
    };
    log.info(`Esportazione ${kind}`, { ops: selOps.map(o => o.name), machine: machine?.name, origin: options.originName || 'progetto' });
    let out;
    const run = list => (kind === 'gcode' ? api.gcode(list, options) : api.cldata(list, options).then(text => ({ text, warnings: [] })));
    try {
      out = await run(ids);
    } catch (e) {
      // percorsi scaduti sul server (es. riavvio): ricalcola e riprova una volta
      if (!(await ensureComputed(selOps, true))) return;
      const ids2 = selOps.map(o => App.runtime.toolpaths.get(o.id).toolpathId);
      try {
        out = await run(ids2);
      } catch (e2) { log.error('Esportazione non riuscita', e2); toast(e2.message, 'err'); return; }
    }
    const { text, warnings } = out;
    if (warnings.length) log.warn('Avvisi della macchina', { machine: machine?.name, warnings });
    const ext = kind === 'gcode' ? String(machine?.fileExtension || 'nc').replace(/^\./, '').trim() || 'nc' : 'cls';
    const lines = text.split('\n');
    const pre = h('pre', {}, lines.length > 4000 ? lines.slice(0, 4000).join('\n') + `\n… (${t('{n} righe non mostrate', { n: lines.length - 4000 })})` : text);
    const copy = h('button', { class: 'btn', onclick: async () => { try { await navigator.clipboard.writeText(text); toast(t('Copiato negli appunti'), 'ok'); } catch { toast(t('Copia non consentita dal browser'), 'warn'); } } }, t('Copia'));
    const warnBox = warnings.length
      ? h('div', { class: 'gc-warn' }, h('b', {}, t('Avvisi per "{name}"', { name: t(machine.name) })), h('ul', {}, warnings.map(x => h('li', {}, x))))
      : null;
    const res = await modal({
      title: `${kind === 'gcode' ? `G-code · ${t(machine.name)}` : 'CL data'} · ${t('{n} righe', { n: num(lines.length) })}`, wide: true,
      body: h('div', {}, warnBox, pre, h('div', { style: { marginTop: '8px' } }, copy)),
      buttons: [{ label: t('Chiudi'), value: false }, { label: t('Scarica .{ext}', { ext }), value: true, primary: true }],
    });
    if (res) download(text, `${safeName(App.project.name || 'carvecam')}.${ext}`, 'text/plain');
  }

  // ================================================================ VISTA
  cmd.setView = name => vp.setView(name);
  cmd.fit = () => vp.fit();
  cmd.toggleProjection = () => {
    vp.setProjection(!vp.isOrtho);
    document.getElementById('btn-proj').setAttribute('aria-pressed', String(vp.isOrtho));
  };
  const toggleView = key => () => { App.view[key] = !App.view[key]; emit('view'); };
  cmd.toggleGrid = toggleView('grid');
  cmd.toggleToolpaths = toggleView('toolpaths');
  cmd.toggleRapids = toggleView('rapids');
  cmd.toggleWireframe = toggleView('wireframe');
  cmd.toggleGizmoSnap = () => { App.view.gizmoSnap = !App.view.gizmoSnap; emit('gizmo'); };
  cmd.toggleGizmoSpace = () => { App.view.gizmoLocal = !App.view.gizmoLocal; emit('gizmo'); };

  // ================================================================ BLACKBOX DI DIAGNOSTICA
  /**
   * Esporta in un archivio protetto da password tutto ciò che serve a riprodurre un problema: progetto
   * corrente (anche non salvato) con le mesh, richieste di calcolo, stato dell'interfaccia, opzioni, magazzino,
   * ultimi messaggi e file di log del server.
   */
  cmd.exportBlackbox = async () => {
    const desc = h('textarea', { rows: 5, placeholder: t('Cosa stavi facendo, cosa ti aspettavi e cosa è successo invece…'), style: { width: '100%' } });
    const meshes = h('input', { type: 'checkbox' });
    meshes.checked = true;
    const days = h('select', {}, [1, 2, 3, 7, 14].map(n => h('option', { value: n }, n === 1 ? t('solo oggi') : t('ultimi {n} giorni', { n }))));
    days.value = '2';
    const ok = await modal({
      title: t('Esporta blackbox'), size: 'wide', enter: false,
      body: h('div', {},
        h('p', { style: { marginTop: 0 } }, t('Crea un archivio .zip protetto da password con i dati per riprodurre il problema: progetto corrente con le mesh, parametri di calcolo delle lavorazioni, stato dell\'interfaccia, opzioni, magazzino utensili e file di log.')),
        h('div', { class: 'form-row' }, h('label', {}, t('Descrizione del problema')), desc),
        h('div', { class: 'form-row' }, h('label', {}, t('Includi le mesh dei modelli')), h('div', {}, meshes)),
        h('div', { class: 'form-row' }, h('label', {}, t('File di log')), days),
        h('p', { class: 'p-note', style: { margin: 0 } }, t('La password dell\'archivio è nota all\'assistenza: invia il file così com\'è.'))),
      onOpen: () => setTimeout(() => desc.focus(), 60),
      buttons: [{ label: t('Annulla'), value: false }, { label: t('Esporta'), value: true, primary: true }],
    });
    if (!ok) return;
    log.info('Blackbox: esportazione', { description: desc.value.slice(0, 200) });
    log.flush();
    busy(t('Preparazione blackbox…'));
    try {
      const requests = App.project.operations.map(op => {
        try { return { opId: op.id, name: op.name, request: buildRequest(op) }; } catch (e) { return { opId: op.id, name: op.name, error: e.message }; }
      });
      const toolpaths = App.project.operations.map(op => {
        const d = App.runtime.toolpaths.get(op.id);
        return { opId: op.id, name: op.name, status: cmd.opStatus(op), toolpathId: d?.toolpathId, stats: d?.stats, warnings: d?.warnings, points: d?.types?.length ?? 0 };
      });
      let library = null;
      try { library = { tools: await getTools(), setups: await getSetups() }; } catch { /* magazzino non disponibile */ }
      let gl = null;
      try {
        const ctx = vp.renderer.getContext();
        const ext = ctx.getExtension('WEBGL_debug_renderer_info');
        gl = {
          vendor: ext ? ctx.getParameter(ext.UNMASKED_VENDOR_WEBGL) : ctx.getParameter(ctx.VENDOR),
          renderer: ext ? ctx.getParameter(ext.UNMASKED_RENDERER_WEBGL) : ctx.getParameter(ctx.RENDERER),
          version: ctx.getParameter(ctx.VERSION),
        };
      } catch { /* informazioni WebGL non disponibili */ }
      const client = {
        time: new Date().toISOString(), session: log.session, url: location.href, userAgent: navigator.userAgent,
        language: navigator.language, locale: LOCALE, screen: `${screen.width}x${screen.height}@${devicePixelRatio}`,
        window: `${innerWidth}x${innerHeight}`, viewport: `${vp.el.clientWidth}x${vp.el.clientHeight}`, webgl: gl,
        memory: performance.memory ? { usedMB: Math.round(performance.memory.usedJSHeapSize / 1048576), limitMB: Math.round(performance.memory.jsHeapSizeLimit / 1048576) } : null,
        state: {
          fileName: App.fileName, dirty: App.dirty, selection: App.selection, selected: App.selected, sketch: App.sketch,
          sketchTool: sketch.active ? sketch.tool : null, planeMode: App.planeMode, pickMode: App.pickMode?.kind || null,
          view: App.view, camera: vp.captureView(),
          simulation: sim.active ? { opId: sim.opId, scope: sim.scope, t: sim.t, total: sim.total } : null,
          meshesLoaded: [...App.runtime.meshGeo.keys()],
        },
        recentActions: log.recent,
      };
      const blob = await api.blackbox({
        description: desc.value, includeMeshes: meshes.checked, logDays: Number(days.value),
        project: App.project, requests, toolpaths, library, client, settings: structuredClone(settings), history: log.history,
      });
      const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '');
      download(blob, `carvecam-blackbox-${stamp}.zip`, 'application/zip');
      log.info('Blackbox esportata', { size: blob.size });
      toast(t('Blackbox esportata ({size} MB): inviala all\'assistenza', { size: fmt(blob.size / 1048576, 1) }), 'ok', 6000);
    } catch (e) {
      log.error('Esportazione blackbox non riuscita', e);
      toast(t('Esportazione blackbox non riuscita: {msg}', { msg: e.message }), 'err', 6000);
    } finally { idle(); }
  };

  // ================================================================ AIUTO
  cmd.shortcuts = () => {
    modal({ title: t('Scorciatoie da tastiera'), body: h('table', {}, shortcutRows().map(([k, v]) => h('tr', {}, h('td', {}, k), h('td', {}, v)))) });
  };

  /** Mesh della targa di esempio sul server: quella caricata in precedenza se c'è ancora, altrimenti la si genera. */
  async function sampleMeshOnServer() {
    let m = null;
    try { m = JSON.parse(localStorage.getItem(SAMPLE_KEY) || 'null'); } catch { /* storage non disponibile */ }
    if (m?.v === SAMPLE_VERSION && m.id) {
      try {
        const pos = await api.getMesh(m.id);
        if (pos.length === m.triangles * 9) {
          App.runtime.meshGeo.set(m.id, await buildDisplayGeometry(pos));
          return m;
        }
      } catch { /* mesh non più sul server: la si rigenera */ }
    }
    const info = await api.uploadMesh(t('Targa con rilievo'), await sampleMesh());
    App.runtime.meshGeo.set(info.id, await buildDisplayGeometry(await api.getMesh(info.id)));
    m = { v: SAMPLE_VERSION, id: info.id, triangles: info.triangles };
    savePref(SAMPLE_KEY, m);
    return m;
  }

  /**
   * Progetto di esempio: targa con cornice, logo e scritta in rilievo (modello come se fosse importato), piano
   * superiore, sketch con due contorni, zero pezzo sullo spigolo e tre lavorazioni (sgrossatura, finitura,
   * ripresa con fresa conica), calcolate subito. True se caricato.
   */
  cmd.demoProject = async () => {
    if (!(await confirmDiscard(t('Progetto di esempio')))) return false;
    sketch.exit(false);
    sim.stop();
    cmd.endPlaneMode();
    let mesh;
    busy(t('Preparazione del progetto di esempio…'));
    try {
      mesh = await sampleMeshOnServer();
    } catch (e) {
      log.error('Progetto di esempio non disponibile', e);
      toast(t('Progetto di esempio non disponibile: {msg}', { msg: e.message }), 'err', 6000);
      return false;
    } finally { idle(); }
    const { project, operationId } = sampleProject(mesh);
    setProject(project);
    App.fileHandle = null;
    App.fileName = '';
    vp.setView('iso');
    vp.fit(new THREE.Box3(new THREE.Vector3(...SAMPLE_BOUNDS.min), new THREE.Vector3(...SAMPLE_BOUNDS.max)));
    log.info('Progetto di esempio caricato', { mesh: mesh.id });
    // percorsi calcolati subito: l'esempio è pronto da simulare
    const ok = await ensureComputed(project.operations, true);
    select({ type: 'operation', id: operationId });
    status(t('Progetto di esempio: targa con logo e scritta in rilievo'));
    if (ok) toast(t('Esempio pronto: premi Simula tutto per vedere le tre lavorazioni, o seleziona una lavorazione per cambiarne i parametri'), 'ok', 7000);
    return true;
  };

  /** Informazioni sul programma: versione, descrizione, crediti di sviluppo e componenti di terze parti. */
  cmd.about = () => {
    const ver = h('div', { class: 'p-note' }, '');
    fetch('/api/version').then(r => r.json()).then(j => { ver.textContent = `${t('Versione')} ${j.version}`; }).catch(() => {});
    return modal({
      title: t('Informazioni su CarveCAM'),
      body: h('div', { class: 'about' },
        h('div', { class: 'about-head' }, h('img', { src: 'favicon.svg', alt: '', width: 56, height: 56 }),
          h('div', {}, h('div', { class: 'about-name' }, 'CarveCAM'), ver, h('div', { class: 'p-note' }, t('CAM web per mini CNC')))),
        h('p', {}, t('Software CAM web per mini CNC: svuotatura (pocketing) a terrazze e finitura in proiezione con fresa, su modelli 3D e artefatti primitivi.')),
        h('p', {}, t('Server e motore di calcolo in VB.NET (.NET 10, ASP.NET Core): importazione mesh, drop-cutter, offset con Clipper2, verifica collisioni, post-processor G-code/CL. Interfaccia in Three.js.')),
        h('p', { style: { color: 'var(--text-faint)' } }, t('Unità: millimetri. Utensili: fresa cilindrica, torica, sferica e conica. Ingressi: affondo, rampa, elica.')),
        h('div', { class: 'p-sec about-sec' }, t('Sviluppo')),
        h('ul', { class: 'credits' }, h('li', {}, 'William Veronesi'), h('li', {}, 'Gabriel S. Sartori')),
        h('div', { class: 'p-sec about-sec' }, t('Componenti di terze parti')),
        h('p', { class: 'p-note', style: { margin: 0 } }, 'Three.js · Clipper2 · OpenCascade (occt-import-js) · ASP.NET Core')),
    });
  };

  // ================================================================ menu contestuale del navigatore
  cmd.contextItems = sel => {
    const r = resolve(sel);
    const multi = App.selected.length > 1;
    const common = [{ label: t('Duplica'), kbd: 'Ctrl+D', action: () => cmd.duplicateSelected() }, { label: t('Elimina'), kbd: 'Canc', action: () => cmd.deleteSelected() }];
    const lockItem = () => {
      const locked = multi ? movableSelected().every(x => x.item.locked) : !!r?.item.locked;
      return { label: locked ? t('Sblocca') : t('Blocca'), kbd: 'Ctrl+L', action: () => cmd.toggleLock(multi ? null : sel) };
    };
    // comandi di modifica (Sposta, Ruota, Copia, Scala smart, serie) per entità, sketch ed elementi 3D
    const modifyItems = () => [...(cmd.modifyItems?.() || []), { sep: true }];
    if (multi) {
      const items = [];
      const solids = App.selected.filter(s => s.type === 'object' || s.type === 'artifact');
      if (solids.length === App.selected.length) {
        const allStock = resolveAll().every(x => x.item.stock);
        items.push({ label: allStock ? t('Non considerare come grezzo') : t('Considera come grezzo'), action: () => cmd.setStock(solids, !allStock) });
      }
      if (movableSelected().length) items.push(lockItem(), { sep: true });
      if (operationSource() && !sketch.active) items.push({ label: t('Nuova svuotatura'), action: () => cmd.newOperation('pocket') }, { label: t('Nuova finitura'), action: () => cmd.newOperation('finish') }, { sep: true });
      if (!App.selected.some(s => s.type === 'operation')) items.push(...modifyItems());
      return [...items, ...common];
    }
    const locked = !!r?.item.locked;
    const noSketch = () => !sketch.active;
    switch (sel.type) {
      case 'object':
      case 'artifact':
        return [{ label: r?.item.stock ? t('Non considerare come grezzo') : t('Considera come grezzo'), action: () => cmd.setStock([sel], !r?.item.stock) },
          lockItem(), { sep: true },
          { label: t('Riposiziona…'), enabled: () => !locked && !sketch.active && !App.planeMode, action: () => cmd.reposition(sel) },
          { label: t('Appoggia su Z=0'), enabled: () => !locked, action: () => cmd.dropToFloor(sel) },
          { label: t('Centra in XY'), enabled: () => !locked, action: () => cmd.centerXY(sel) },
          { label: t('Mostra / nascondi'), action: () => cmd.toggleVisible(sel.type, sel.id) }, { sep: true }, ...modifyItems(), ...common];
      case 'origin':
        return [lockItem(), { label: t('Rinomina'), kbd: 'F2', action: () => document.querySelector('#props [data-key="name"]')?.focus() },
          { label: t('Mostra / nascondi'), action: () => cmd.toggleVisible(sel.type, sel.id) },
          { label: t('Esporta G-code con questo zero…'), action: () => cmd.exportGcode(null, sel.id) }, { sep: true }, ...modifyItems(), ...common];
      case 'plane':
        return [{ label: t('Nuovo sketch'), action: () => cmd.newSketch(sel.id) }, { label: t('Vista normale al piano'), action: () => cmd.viewNormal(sel.id) },
          { label: t('Inverti normale'), enabled: () => !locked, action: () => cmd.flipNormal(sel.id) }, lockItem(), { sep: true }, ...modifyItems(), ...common];
      case 'sketch':
        return [{ label: t('Modifica sketch'), action: () => cmd.editSketch(sel.id) },
          { label: t('Nuova svuotatura'), enabled: noSketch, action: () => cmd.newOperation('pocket', sel.id) },
          { label: t('Nuova finitura'), enabled: noSketch, action: () => cmd.newOperation('finish', sel.id) }, { sep: true }, ...modifyItems(), ...common];
      case 'entity':
        return [{ label: t('Nuova svuotatura'), enabled: noSketch, action: () => cmd.newOperation('pocket') },
          { label: t('Nuova finitura'), enabled: noSketch, action: () => cmd.newOperation('finish') }, { sep: true }, ...modifyItems(), ...common];
      case 'operation':
        return [{ label: t('Calcola'), kbd: 'F9', enabled: noSketch, action: () => cmd.compute(sel.id) }, { label: t('Simula'), enabled: noSketch, action: () => cmd.simulate(sel.id) },
          { label: t('Esporta G-code…'), action: () => cmd.exportGcode([sel.id]) }, { label: t('Salva come setup…'), action: () => cmd.saveAsSetup(sel.id) },
          { label: t('Riordina lavorazioni…'), enabled: () => noSketch() && App.project.operations.length > 1, action: () => cmd.reorderOperations() },
          { sep: true }, ...common];
    }
    return common;
  };

  return cmd;
}

export function toolLabel(tl) {
  if (tl.type === 'ball') return t('sferica Ø{d}', { d: tl.diameter });
  if (tl.type === 'taper') return t('conica Ø{d} {a}° per lato', { d: tl.diameter, a: tl.taperAngle ?? 5 });
  if (tl.type === 'bull') return t('torica Ø{d} R{r}', { d: tl.diameter, r: tl.cornerRadius ?? 1 });
  return t('cilindrica Ø{d}', { d: tl.diameter });
}

/** Nome di un file senza cartella né estensione. */
function fileBase(name) {
  return String(name || '').replace(/^.*[\\/]/, '').replace(/\.[^.]+$/, '').trim();
}

function safeName(s) {
  return String(s).replace(/[\\/:*?"<>|]+/g, '_').trim() || 'carvecam';
}
