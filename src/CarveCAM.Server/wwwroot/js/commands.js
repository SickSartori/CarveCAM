// Comandi dell'applicazione (menu, navigatore, pannello proprietà, scorciatoie).
import * as THREE from 'three';
import {
  App, emit, mutate, select, selectMany, uid, nextName, resolve, resolveAll, getPlane, getSketch, getOperation,
  setProject, newProject, undo as undoState, redo as redoState, setPath, markSaved, MOVABLE, operationSource,
} from './state.js';
import { api, download } from './api.js';
import { planeFrame, angleOfU, fmt } from './geom.js';
import { modal, confirmBox, toast, status, busy, busyText, idle, h } from './dialogs.js';
import { SERVER_FORMATS, CLIENT_FORMATS, extOf, parseInBrowser, buildDisplayGeometry } from './importers.js';
import { OP_DEFAULTS, TOOL_DEFAULTS, effParam, round4 } from './oplib.js';
import {
  pickTool, pickSetup, toolFromLibrary, getTools, getSetups, openToolLibrary, openSetupLibrary, saveOperationAsSetup,
  usedTools, reconcileProjectTools, exportLibrary, importLibrary,
} from './library.js';
import { pickProjectFile, writeProjectFile, addRecent, recentList, fileOfRecent, removeRecent } from './files.js';
import { openOptions } from './options.js';
import { color } from './settings.js';
import { artifactKeyPoints } from './scene-sync.js';
import { t, num, LOCALE } from './i18n.js';
import { log } from './log.js';

const POST_MODE_KEY = 'carvecam.post.mode';   // ultimo controllo scelto nell'esportazione G-code (per browser)

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

  const confirmDiscard = async title => !App.dirty || confirmBox(title, t('Il progetto corrente ha modifiche non salvate che andranno perse.'), t('Continua'));

  // ================================================================ FILE
  cmd.newProject = async () => {
    if (!(await confirmDiscard(t('Nuovo progetto')))) return;
    sketch.exit(false);
    sim.stop();
    cmd.endPlaneMode();
    setProject(newProject());
    App.fileHandle = null;
    App.fileName = '';
    log.info('Nuovo progetto');
    status(t('Nuovo progetto'));
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
      await addRecent({ name: App.project.name, fileName: file.name, handle, project: App.project });
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

  cmd.openProject = async () => {
    if (!(await confirmDiscard(t('Apri progetto')))) return;
    const pick = await pickProjectFile();
    if (pick) await openFile(pick.file, pick.handle);
  };

  cmd.recentProjects = () => recentList();

  cmd.openRecent = async entry => {
    if (!(await confirmDiscard(t('Apri progetto recente')))) return;
    try {
      const f = await fileOfRecent(entry);
      if (f) { await openFile(f, entry.handle); return; }
    } catch (e) { log.warn('File recente non accessibile', e); }
    if (!entry.snapshot) {
      toast(t('Il file "{name}" non è più disponibile', { name: entry.fileName || entry.name }), 'err');
      await removeRecent(entry.key);
      emit('recent');
      return;
    }
    const when = new Date(entry.time).toLocaleString(LOCALE);
    const ok0 = await confirmBox(t('Progetto recente'),
      entry.handle
        ? t('Il file "{file}" non è accessibile. Aprire la copia del progetto memorizzata il {when}?', { file: entry.fileName, when })
        : t('Il browser non consente di riaprire direttamente il file "{file}". Aprire la copia del progetto memorizzata il {when}? Per salvarla usa Salva con nome.', { file: entry.fileName || entry.name, when }),
      t('Apri la copia'));
    if (!ok0) return;
    const snap = JSON.parse(entry.snapshot);
    if (!(await reconcileProjectTools(snap))) return;
    sketch.exit(false);
    sim.stop();
    setProject(snap);
    App.fileHandle = null;
    App.fileName = entry.fileName || '';
    await cmd.loadMeshes();
    vp.fit();
    log.info('Progetto recente aperto dalla copia memorizzata', { name: entry.name });
    status(t('Aperta la copia memorizzata di "{name}"', { name: entry.name }));
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
      await addRecent({ name: App.project.name, fileName: res.fileName, handle: res.handle, project: App.project });
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

  cmd.importModel = () => {
    const inp = document.getElementById('file-import');
    inp.value = '';
    inp.onchange = () => cmd.importFiles([...inp.files]);
    inp.click();
  };

  cmd.importFiles = async files => {
    if (!files.length) return;
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
      if (r.type === 'operation' && key.startsWith('tool.') && key !== 'tool.number') r.item.tool.libId = null;
    });
    sketch.refreshFrame();
  };

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
    const obj = sync.objectFor(sel.type, sel.id);
    if (!obj) return;
    obj.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(obj);
    mutate(() => { r.item.position[2] = round4(r.item.position[2] - box.min.z); });
  };

  cmd.centerXY = sel => {
    const r = resolve(sel);
    if (!r) return;
    if (r.item.locked) { lockedWarn(); return; }
    const obj = sync.objectFor(sel.type, sel.id);
    if (!obj) return;
    obj.updateMatrixWorld(true);
    const c = new THREE.Box3().setFromObject(obj).getCenter(new THREE.Vector3());
    mutate(() => {
      r.item.position[0] = round4(r.item.position[0] - c.x);
      r.item.position[1] = round4(r.item.position[1] - c.y);
    });
  };

  // ---------------------------------------------------------------- spostamento dell'origine del progetto
  /** Trasla tutto il progetto (anche gli elementi bloccati) perché il punto p diventi la nuova origine. */
  function shiftProject(p) {
    if (p.every(v => Math.abs(v) < 1e-9)) return;
    const d = p.map(v => -v);
    mutate(pr => {
      const add = a => a.map((v, i) => round4(v + d[i]));
      for (const o of pr.objects) o.position = add(o.position);
      for (const a of pr.artifacts) a.position = add(a.position);
      for (const pl of pr.planes) pl.origin = add(pl.origin);
    });
    const dv = new THREE.Vector3(...d);
    vp.controls.target.add(dv);
    vp.camera.position.add(dv);
    vp.controls.update();
    sketch.refreshFrame();
    log.info('Origine del progetto spostata', { point: p });
    status(t('Origine spostata in ({p}): tutto il progetto è stato traslato. Ricalcolare le lavorazioni.', { p: p.map(v => fmt(v, 3)).join(', ') }));
  }

  cmd.moveOrigin = async (preset) => {
    if (sketch.active) sketch.exit();
    const box = sceneBox();
    const has = !box.isEmpty();
    const vals = preset ? [...preset] : [0, 0, 0];
    const inputs = ['X', 'Y', 'Z'].map((ax, i) => h('input', { value: fmt(vals[i], 4), inputmode: 'decimal', class: 'num', 'aria-label': ax }));
    const setVals = v => inputs.forEach((inp, i) => { inp.value = fmt(v[i], 4); });
    const presetBtn = (label, fn) => h('button', { class: 'btn', type: 'button', disabled: !has, onclick: () => setVals(fn()) }, t(label));
    const c = has ? box.getCenter(new THREE.Vector3()) : new THREE.Vector3();
    const body = h('div', {},
      h('p', { style: { margin: '0 0 10px' } }, t('Il punto indicato diventa la nuova origine (0, 0, 0): tutti gli oggetti, gli artefatti e i piani vengono traslati insieme, compresi quelli bloccati.')),
      h('div', { class: 'form-row' }, h('label', {}, t('Nuova origine (coordinate attuali)')),
        h('div', { class: 'p-vec' }, inputs.map((inp, i) => h('div', { class: 'ax', 'data-ax': 'XYZ'[i] }, inp)))),
      h('div', { class: 'form-row' }, h('label', {}, t('Punti dell\'ingombro')), h('div', { class: 'form-field wrap' },
        presetBtn('Centro della base', () => [c.x, c.y, box.min.z]),
        presetBtn('Centro', () => [c.x, c.y, c.z]),
        presetBtn('Angolo minimo', () => [box.min.x, box.min.y, box.min.z]),
        presetBtn('Centro della sommità', () => [c.x, c.y, box.max.z]))),
      h('p', { class: 'p-note' }, t('Con "Scegli nella vista" si fa clic su un punto del modello (agganciato al vertice più vicino).')));
    const res = await modal({
      title: t('Sposta origine'), body,
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
    const p = inputs.map(inp => Number(String(inp.value).replace(',', '.')));
    if (p.some(v => !Number.isFinite(v))) { toast(t('Coordinate non valide'), 'err'); return; }
    shiftProject(p);
  };

  // ================================================================ INSERISCI (artefatti)
  cmd.addArtifact = kind => {
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
    App.pickMode = null;
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

  /** Vertice più vicino al punto colpito (entro qualche pixel), altrimenti il punto stesso. */
  function snapToVertex(hit, ev) {
    const cands = [];
    const o = hit.object;
    o.updateMatrixWorld(true);
    if (hit.face) {
      const pos = o.geometry.attributes.position;
      for (const k of ['a', 'b', 'c']) cands.push(new THREE.Vector3().fromBufferAttribute(pos, hit.face[k]).applyMatrix4(o.matrixWorld));
    }
    if (o.userData.type === 'artifact') {
      const a = App.project.artifacts.find(x => x.id === o.userData.id);
      if (a) for (const p of artifactKeyPoints(a)) cands.push(new THREE.Vector3(...p).applyMatrix4(o.matrixWorld));
    }
    const m = vp.pointer(ev);
    let best = hit.point.clone(), bd = 12;
    for (const c of cands) {
      const s = vp.toScreen(c);
      if (!s) continue;
      const d = Math.hypot(s.x - m.x, s.y - m.y);
      if (d < bd) { bd = d; best = c; }
    }
    return best;
  }

  /** Gestisce un clic nel 3D quando è attiva una modalità di selezione punti. */
  cmd.handlePick = ev => {
    const pm = App.pickMode;
    if (!pm || ev.button !== 0) return;
    const targets = [];
    vp.groups.objects.traverseVisible(o => { if (o.isMesh) targets.push(o); });
    vp.groups.artifacts.traverseVisible(o => { if (o.isMesh) targets.push(o); });
    const hit = vp.raycast(ev, targets, false)[0];
    if (!hit) { toast(t('Nessuna superficie sotto il cursore'), 'warn', 1800); return; }
    const p = hit.point.clone();
    const px = vp.pixelSize(p);
    if (pm.kind === 'origin') {
      const q = snapToVertex(hit, ev);
      cmd.cancelPick();
      cmd.moveOrigin([q.x, q.y, q.z].map(round4));
      return;
    }
    if (pm.kind === 'face') {
      const n = hit.face.normal.clone().transformDirection(hit.object.matrixWorld).normalize();
      const toCam = vp.camera.position.clone().sub(p);
      if (n.dot(toCam) < 0) n.negate();
      cmd.cancelPick();
      cmd.createPlane(p.toArray(), n.toArray(), 80);
      return;
    }
    if (pm.kind === '3pt') {
      pm.pts.push(p);
      const m = new THREE.Mesh(new THREE.SphereGeometry(px * 5, 12, 8), new THREE.MeshBasicMaterial({ color: 0xff8a3d, depthTest: false }));
      m.position.copy(p);
      m.renderOrder = 30;
      vp.groups.helpers.add(m);
      document.getElementById('hint').innerHTML = t('Clic su 3 punti degli oggetti per definire il piano ({i}/3) · <b>Esc</b> annulla', { i: pm.pts.length + 1 });
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
  };

  cmd.flipNormal = planeId => {
    const pl = getPlane(planeId);
    if (!pl) return;
    if (pl.locked) { lockedWarn(); return; }
    mutate(() => { pl.normal = pl.normal.map(v => (v === 0 ? 0 : -v)); });
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
  cmd.options = () => openOptions();

  function buildRequest(op) {
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
          // fresa conica: altezza del cono, angolo per lato e punta
          ...(o.tool.type === 'taper' ? { fluteLength: o.tool.fluteLength, taperAngle: o.tool.taperAngle ?? 5, tipType: o.tool.tipType || 'ball' } : {}),
        },
        stepover: effParam(o, 'stepover'), stepdown: effParam(o, 'stepdown'), maxDepth: o.maxDepth, stock: o.stock, safeHeight: o.safeHeight,
        clearance: o.clearance, angle: o.angle, climb: o.climb !== false, toolInside: o.toolInside !== false,
        contourPass: o.contourPass !== false, resolution: o.resolution, tolerance: o.tolerance,
        feed: o.feed, plunge: o.plunge, spindle: o.spindle,
        entry: o.entry || 'plunge', rampAngle: o.rampAngle ?? 3, helixRadius: effParam(o, 'helixRadius') ?? 0, rampFeed: o.rampFeed ?? 0,
      },
      plane: { origin: vec(f.o), u: vec(f.u), v: vec(f.v), n: vec(f.n) },
      boundary: ents.map(e => ({
        id: e.id, kind: e.kind, pts: e.pts, closed: true, x1: e.x1, y1: e.y1, x2: e.x2, y2: e.y2,
        cx: e.cx, cy: e.cy, r: e.r, sides: e.sides, rot: e.rot,
      })),
      objects: App.project.objects.filter(x => obst.has(x.id) && x.meshId).map(x => ({
        meshId: x.meshId, name: x.name, position: x.position, rotation: x.rotation, scale: x.scale, include: true,
      })),
      artifacts: App.project.artifacts.filter(x => obst.has(x.id)).map(x => ({
        id: x.id, name: x.name, kind: x.kind, size: x.size, radius: x.radius, radius2: x.radius2, height: x.height,
        position: x.position, rotation: x.rotation, include: true,
      })),
    };
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
    const req = buildRequest(op);
    const t0 = performance.now();
    log.info(`Calcolo "${op.name}"`, { kind: op.kind, strategy: op.strategy, tool: req.operation.tool, stepover: req.operation.stepover, stepdown: req.operation.stepdown, boundary: req.boundary.length, objects: req.objects.length, artifacts: req.artifacts.length });
    const res = await api.compute(req, signal);
    const tp = await api.getToolpath(res.toolpathId);
    App.runtime.toolpaths.set(op.id, {
      toolpathId: res.toolpathId, hash: requestHash(req), stats: res.stats, warnings: res.warnings || [],
      positions: tp.positions, types: tp.types,
    });
    log.info(`Calcolo "${op.name}" concluso in ${Math.round(performance.now() - t0)} ms`, { points: res.stats?.pointCount, warnings: res.warnings?.length || 0, maxGouge: res.stats?.maxGouge });
    return res;
  }

  cmd.compute = async opId => {
    const op = getOperation(opId);
    if (!op) return;
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

  /** Calcola le lavorazioni indicate (o tutte) che non sono aggiornate. */
  async function ensureComputed(ops, force = false) {
    const todo = ops.filter(op => op && (force || cmd.opStatus(op) !== 'ok'));
    if (!todo.length) return true;
    sim.stop();   // i percorsi cambiano: la simulazione in corso non è più valida
    const signal = busy(t('Calcolo lavorazioni…'));
    try {
      for (let i = 0; i < todo.length; i++) {
        busyText(t('Calcolo {i}/{n}: "{name}"…', { i: i + 1, n: todo.length, name: todo[i].name }));
        const res = await computeOne(todo[i], signal);
        for (const w of res.warnings || []) toast(`${todo[i].name}: ${w}`, 'warn', 6000);
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
  cmd.exportGcode = async opIds => exportDialog('gcode', opIds);
  cmd.exportCl = async opIds => exportDialog('cl', opIds);

  async function exportDialog(kind, opIds) {
    const ops = App.project.operations;
    if (!ops.length) { toast(t('Nessuna lavorazione da esportare'), 'warn'); return; }
    const preset = new Set(opIds && opIds.length ? opIds : ops.filter(o => o.visible !== false).map(o => o.id));
    const checks = ops.map(op => {
      const c = h('input', { type: 'checkbox' });
      c.checked = preset.has(op.id);
      return { op, c };
    });
    const mode = h('select', {},
      h('option', { value: 'grbl' }, t('GRBL 1.1 / grblHAL / FluidNC (mini CNC, 3 assi)')),
      h('option', { value: 'g682' }, t('Fanuc/ISO 3+2 assi: piano inclinato G68.2')),
      h('option', { value: 'world' }, t('Fanuc/ISO coordinate mondo XYZ (3 assi)')));
    try { const m = localStorage.getItem(POST_MODE_KEY); if (m && [...mode.options].some(o => o.value === m)) mode.value = m; } catch { /* storage non disponibile */ }
    const prog = h('input', { value: '1000', style: { width: '90px' } });
    const dwell = h('input', { value: '2', style: { width: '60px' } });
    const cool = h('input', { type: 'checkbox' });
    let coolTouched = false;
    cool.addEventListener('change', () => { coolTouched = true; });
    const hint = h('p', { style: { color: 'var(--text-faint)', margin: '2px 0 8px' } });
    const rowProg = h('div', { class: 'form-row' }, h('label', {}, t('Numero programma')), prog);
    const rowDwell = h('div', { class: 'form-row' }, h('label', {}, t('Attesa avvio mandrino (s)')), dwell);
    const syncMode = () => {
      const grbl = mode.value === 'grbl';
      rowProg.hidden = grbl;
      rowDwell.hidden = !grbl;
      if (!coolTouched) cool.checked = !grbl;   // le mini CNC di solito non hanno refrigerante
      hint.textContent = grbl
        ? t('Cambi utensile e piani inclinati diventano pause M0: le istruzioni per riposizionare il pezzo e azzerare sono nei commenti.')
        : mode.value === 'g682' ? t('I piani inclinati usano G68.2 con coordinate nel sistema del piano.') : t('Tutte le coordinate nel sistema del progetto: orientare l\'utensile secondo l\'asse indicato.');
    };
    mode.addEventListener('change', syncMode);
    syncMode();
    const body = h('div', {},
      kind === 'gcode' ? [
        h('div', { class: 'form-row' }, h('label', {}, t('Controllo')), mode),
        hint,
        rowProg, rowDwell,
        h('div', { class: 'form-row' }, h('label', {}, t('Refrigerante (M8/M9)')), h('div', {}, cool)),
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
    if (kind === 'gcode') try { localStorage.setItem(POST_MODE_KEY, mode.value); } catch { /* storage non disponibile */ }
    const delay = parseFloat(String(dwell.value).replace(',', '.'));
    const options = {
      mode: mode.value, programNumber: parseInt(prog.value, 10) || 1000, decimals: 3,
      coolant: cool.checked, programName: App.project.name || 'CARVECAM',
      spindleDelay: Number.isFinite(delay) ? Math.max(0, Math.min(60, delay)) : 2,
    };
    log.info(`Esportazione ${kind}`, { ops: selOps.map(o => o.name), mode: options.mode });
    let text;
    try {
      text = kind === 'gcode' ? await api.gcode(ids, options) : await api.cldata(ids, options);
    } catch (e) {
      // percorsi scaduti sul server (es. riavvio): ricalcola e riprova una volta
      if (!(await ensureComputed(selOps, true))) return;
      const ids2 = selOps.map(o => App.runtime.toolpaths.get(o.id).toolpathId);
      try {
        text = kind === 'gcode' ? await api.gcode(ids2, options) : await api.cldata(ids2, options);
      } catch (e2) { log.error('Esportazione non riuscita', e2); toast(e2.message, 'err'); return; }
    }
    const ext = kind === 'gcode' ? 'nc' : 'cls';
    const lines = text.split('\n');
    const pre = h('pre', {}, lines.length > 4000 ? lines.slice(0, 4000).join('\n') + `\n… (${t('{n} righe non mostrate', { n: lines.length - 4000 })})` : text);
    const copy = h('button', { class: 'btn', onclick: async () => { try { await navigator.clipboard.writeText(text); toast(t('Copiato negli appunti'), 'ok'); } catch { toast(t('Copia non consentita dal browser'), 'warn'); } } }, t('Copia'));
    const res = await modal({
      title: `${kind === 'gcode' ? 'G-code' : 'CL data'} · ${t('{n} righe', { n: num(lines.length) })}`, wide: true,
      body: h('div', {}, pre, h('div', { style: { marginTop: '8px' } }, copy)),
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

  // ================================================================ AIUTO
  cmd.shortcuts = () => {
    const rows = [
      ['Ctrl+K', t('Cerca un comando')], ['Ctrl+S / Ctrl+O', t('Salva / apri progetto (.ccam)')], ['Ctrl+Shift+S', t('Salva con nome')], ['Ctrl+I', t('Importa modello 3D')],
      ['Ctrl+Z / Ctrl+Y', t('Annulla / ripeti')], ['Canc', t('Elimina selezione')], ['Ctrl+D', t('Duplica')],
      [t('Ctrl+clic'), t('Aggiunge o toglie dalla selezione (navigatore, vista, entità dello sketch)')], ['Ctrl+L', t('Blocca / sblocca la selezione')],
      ['G / R', t('Manipolatore: sposta / ruota')], [t('Clic sul centro'), t('Manipolatore: scegli un nuovo punto di riferimento')],
      ['Esc', t('Annulla comando / deseleziona / esci dallo sketch')],
      ['F', t('Adatta alla vista')], ['7 / 1 / 3 / 0', t('Vista alto / fronte / destra / iso')], ['5', t('Prospettica ↔ ortogonale')],
      ['F9', t('Calcola lavorazione selezionata (o tutte)')], ['Spazio', t('Avvia/pausa simulazione')],
      [t('Sketch: L R C P S'), t('Polilinea, rettangolo, cerchio, poligono, seleziona')],
      [t('Sketch: Invio / Backspace'), t('Chiudi polilinea / annulla ultimo vertice')],
      [t('Sketch: coordinate'), t('x,y assolute · @dx,dy relative · numero = raggio')],
      [t('Mouse'), t('Sinistro ruota · centrale/destro trasla · rotella zoom')],
    ];
    modal({ title: t('Scorciatoie da tastiera'), body: h('table', {}, rows.map(([k, v]) => h('tr', {}, h('td', {}, k), h('td', {}, v)))) });
  };

  /** Scena dimostrativa: artefatti, piano di lavoro con contorno, svuotatura e finitura pronte da calcolare. */
  cmd.demoProject = async () => {
    if (!(await confirmDiscard(t('Progetto di esempio')))) return;
    sketch.exit(false);
    sim.stop();
    cmd.endPlaneMode();
    const art = (kind, name, extra) => ({ id: uid('art'), name, kind, size: [20, 20, 20], radius: 10, radius2: 5, height: 20,
      rotation: [0, 0, 0], color: color('artifact'), visible: true, locked: false, ...extra });
    const skId = uid('sk');
    const proj = newProject();
    proj.name = t('Esempio');
    proj.artifacts = [
      art('box', t('Blocco'), { size: [50, 30, 15], position: [0, 0, 7.5] }),
      art('cylinder', t('Perno'), { radius: 8, height: 22, position: [-38, 0, 11] }),
      art('sphere', t('Calotta'), { radius: 14, position: [38, 0, 2] }),
      art('cone', t('Torretta'), { radius: 11, radius2: 4, height: 18, position: [0, 34, 9] }),
    ];
    proj.planes = [{
      id: uid('pl'), name: t('Piano grezzo'), origin: [0, 5, 26], normal: [0, 0, 1], angle: 0, size: 150, visible: true, locked: false,
      sketches: [{ id: skId, name: t('Contorno'), visible: true, entities: [{ id: uid('e'), kind: 'rect', x1: -62, y1: -30, x2: 62, y2: 45 }] }],
    }];
    const obstacles = proj.artifacts.map(a => a.id);
    const pk = structuredClone(OP_DEFAULTS.pocket);
    const fn = structuredClone(OP_DEFAULTS.finish);
    delete pk.base; delete fn.base;
    proj.operations = [
      { id: uid('op'), name: t('Svuotatura'), kind: 'pocket', sketchId: skId, entityIds: null, visible: true, ...pk, obstacles: [...obstacles],
        tool: { number: 1, name: 'Fresa torica Ø10 R1', type: 'bull', diameter: 10, cornerRadius: 1, fluteLength: 25 },
        rel: { ...pk.rel, stepdown: { on: true, pct: 10, min: 0.05, max: 3 } }, maxDepth: 26, stock: 0.3, entry: 'helix' },
      { id: uid('op'), name: t('Finitura'), kind: 'finish', sketchId: skId, entityIds: null, visible: true, ...fn, obstacles: [...obstacles],
        tool: { ...TOOL_DEFAULTS.finish }, rel: { ...fn.rel, stepover: { on: true, pct: 13, min: 0.05, max: 2 } }, maxDepth: 26 },
    ];
    proj.counters = { [t('Piano')]: 1, [t('Sketch')]: 1, [t('Svuotatura')]: 1, [t('Finitura')]: 1 };
    setProject(proj);
    App.fileHandle = null;
    vp.setView('iso');
    vp.fit();
    select({ type: 'operation', id: proj.operations[0].id });
    toast(t('Progetto di esempio caricato: premere "Ricalcola tutto" per generare i percorsi'), 'info', 6000);
  };

  cmd.about = () => modal({
    title: 'CarveCAM',
    body: h('div', {},
      h('img', { src: 'favicon.svg', alt: '', width: 56, height: 56, style: { display: 'block', margin: '2px 0 10px' } }),
      h('p', {}, t('Software CAM web per mini CNC: svuotatura (pocketing) a terrazze e finitura in proiezione con fresa, su modelli 3D e artefatti primitivi.')),
      h('p', {}, t('Server e motore di calcolo in VB.NET (.NET 10, ASP.NET Core): importazione mesh, drop-cutter, offset con Clipper2, verifica collisioni, post-processor G-code/CL. Interfaccia in Three.js.')),
      h('p', { style: { color: 'var(--text-faint)' } }, t('Unità: millimetri. Utensili: fresa cilindrica, torica e sferica. Ingressi: affondo, rampa, elica.'))),
  });

  // ================================================================ menu contestuale del navigatore
  cmd.contextItems = sel => {
    const r = resolve(sel);
    const multi = App.selected.length > 1;
    const common = [{ label: t('Duplica'), kbd: 'Ctrl+D', action: () => cmd.duplicateSelected() }, { label: t('Elimina'), kbd: 'Canc', action: () => cmd.deleteSelected() }];
    const lockItem = () => {
      const locked = multi ? movableSelected().every(x => x.item.locked) : !!r?.item.locked;
      return { label: locked ? t('Sblocca') : t('Blocca'), kbd: 'Ctrl+L', action: () => cmd.toggleLock(multi ? null : sel) };
    };
    if (multi) {
      const items = [];
      if (movableSelected().length) items.push(lockItem(), { sep: true });
      if (operationSource()) items.push({ label: t('Nuova svuotatura'), action: () => cmd.newOperation('pocket') }, { label: t('Nuova finitura'), action: () => cmd.newOperation('finish') }, { sep: true });
      return [...items, ...common];
    }
    const locked = !!r?.item.locked;
    switch (sel.type) {
      case 'object':
      case 'artifact':
        return [lockItem(), { sep: true },
          { label: t('Appoggia su Z=0'), enabled: () => !locked, action: () => cmd.dropToFloor(sel) },
          { label: t('Centra in XY'), enabled: () => !locked, action: () => cmd.centerXY(sel) },
          { label: t('Mostra / nascondi'), action: () => cmd.toggleVisible(sel.type, sel.id) }, { sep: true }, ...common];
      case 'plane':
        return [{ label: t('Nuovo sketch'), action: () => cmd.newSketch(sel.id) }, { label: t('Vista normale al piano'), action: () => cmd.viewNormal(sel.id) },
          { label: t('Inverti normale'), enabled: () => !locked, action: () => cmd.flipNormal(sel.id) }, lockItem(), { sep: true }, ...common];
      case 'sketch':
        return [{ label: t('Modifica sketch'), action: () => cmd.editSketch(sel.id) },
          { label: t('Nuova svuotatura'), action: () => cmd.newOperation('pocket', sel.id) },
          { label: t('Nuova finitura'), action: () => cmd.newOperation('finish', sel.id) }, { sep: true }, ...common];
      case 'entity':
        return [{ label: t('Nuova svuotatura'), action: () => cmd.newOperation('pocket') },
          { label: t('Nuova finitura'), action: () => cmd.newOperation('finish') }, { sep: true }, ...common];
      case 'operation':
        return [{ label: t('Calcola'), kbd: 'F9', action: () => cmd.compute(sel.id) }, { label: t('Simula'), action: () => cmd.simulate(sel.id) },
          { label: t('Esporta G-code…'), action: () => cmd.exportGcode([sel.id]) }, { label: t('Salva come setup…'), action: () => cmd.saveAsSetup(sel.id) },
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
