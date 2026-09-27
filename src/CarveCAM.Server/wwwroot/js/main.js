// Avvio dell'applicazione e collegamento dei moduli.
import * as THREE from 'three';
import {
  App, on, emit, select, resolve, snapshot, commitSnapshot, setProject, newProject, loadAutosave, mutate, allSketches,
  isProjectDoc, isProjectFile,
} from './state.js';
import { Viewport } from './viewport.js';
import { ViewCube } from './viewcube.js';
import { SceneSync } from './scene-sync.js';
import { SketchMode } from './sketch.js';
import { Simulator } from './simulation.js';
import { createCommands } from './commands.js';
import { MenuBar } from './ui-menu.js';
import { Toolbar } from './ui-toolbar.js';
import { CommandPalette } from './ui-palette.js';
import { createActions, MENUS, TOOLBAR } from './actions.js';
import { TB } from './icons.js';
import { Tree } from './ui-tree.js';
import { Props } from './ui-props.js';
import { api } from './api.js';
import { status, toast, h } from './dialogs.js';
import { angleOfU, fmt } from './geom.js';

const vp = new Viewport(document.getElementById('viewport'));
const viewCube = new ViewCube(vp, document.getElementById('view-cube'));
const sync = new SceneSync(vp);
const sketch = new SketchMode(vp);
const sim = new Simulator(vp, sync);
const cmd = createCommands({ vp, sync, sketch, sim });
window.carvecam = { App, vp, sync, cmd, viewCube }; // accesso da console per diagnostica
App.project = newProject(); // progetto vuoto finché non viene ripristinato/aperto (vedi start)

// ------------------------------------------------------------------ intestazione: menu, barra strumenti, ricerca comandi
const actions = createActions({ cmd, vp, sketch });
const menuBar = new MenuBar(document.getElementById('menubar'), MENUS, actions);
const palette = new CommandPalette(actions, MENUS);
cmd.openPalette = () => { menuBar.close(); palette.open(); };

/** Stato di ciascuna fase del flusso di lavoro (spie della barra strumenti). */
function stageOf(stage) {
  const p = App.project;
  switch (stage) {
    case 'model': {
      const n = p.objects.length + p.artifacts.length;
      return n ? { state: 'done', tip: `${p.objects.length} modelli e ${p.artifacts.length} artefatti nella scena` }
        : { state: 'todo', tip: 'importa un modello 3D o inserisci un artefatto' };
    }
    case 'planes':
      return p.planes.length ? { state: 'done', tip: `${p.planes.length} piani di lavoro` }
        : { state: 'todo', tip: 'crea un piano: la sua normale è l\'asse utensile' };
    case 'sketch': {
      const all = allSketches();
      const full = all.filter(x => x.sketch.entities.length).length;
      if (full) return { state: 'done', tip: `${full} sketch con area di contenimento` };
      return all.length ? { state: 'partial', tip: 'disegna un contorno chiuso nello sketch' }
        : { state: 'todo', tip: 'crea uno sketch su un piano e disegna l\'area da lavorare' };
    }
    case 'ops':
      return p.operations.length ? { state: 'done', tip: `${p.operations.length} lavorazioni` }
        : { state: 'todo', tip: 'aggiungi una svuotatura o una finitura' };
    case 'output': {
      const n = p.operations.length;
      if (!n) return { state: 'todo', tip: 'nessuna lavorazione da calcolare' };
      const ok = p.operations.filter(o => cmd.opStatus(o) === 'ok').length;
      if (ok === n) return { state: 'done', tip: `${n} percorsi calcolati e aggiornati: pronti per simulazione e G-code` };
      return ok ? { state: 'partial', tip: `${ok} di ${n} percorsi aggiornati: premi Calcola` }
        : { state: 'todo', tip: 'premi Calcola (F9) per generare i percorsi' };
    }
  }
  return { state: 'todo', tip: '' };
}
const toolbarEl = document.getElementById('toolbar');
const toolbar = new Toolbar(toolbarEl, TOOLBAR, actions, stageOf);
// su schermi stretti la barra scorre in orizzontale con la rotella
toolbarEl.addEventListener('wheel', e => {
  if (toolbarEl.scrollWidth > toolbarEl.clientWidth && Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
    toolbarEl.scrollLeft += e.deltaY;
    e.preventDefault();
  }
}, { passive: false });

// nome del progetto modificabile in linea e indicatore delle modifiche non salvate
const projName = document.getElementById('proj-name');
const projDirty = document.getElementById('proj-dirty');
projName.addEventListener('change', () => {
  const v = projName.value.trim();
  if (v && v !== App.project.name) mutate(p => { p.name = v; });
  else projName.value = App.project.name;
});
projName.addEventListener('keydown', e => {
  if (e.key === 'Enter') projName.blur();
  if (e.key === 'Escape') { projName.value = App.project.name; projName.blur(); }
});
function titleBar() {
  if (document.activeElement !== projName) projName.value = App.project.name || '';
  projDirty.hidden = !App.dirty;
  document.title = `${App.dirty ? '● ' : ''}${App.project.name || 'Progetto'} – CarveCAM`;
}

document.getElementById('cmd-search').addEventListener('click', () => cmd.openPalette());
document.querySelector('#cmd-search .cs-ico').innerHTML = TB.search;
const helpBtn = document.getElementById('btn-help');
helpBtn.innerHTML = `<span class="tb-ico">${TB.help}</span>`;
helpBtn.addEventListener('click', () => cmd.shortcuts());

// stato del server VB.NET (verificato periodicamente)
const srv = document.getElementById('srv-status');
async function checkServer(first = false) {
  try {
    const f = await api.formats();
    srv.dataset.state = 'ok';
    srv.title = `Server VB.NET connesso. Importazione nativa: ${f.server.map(x => x.toUpperCase()).join(', ')}; gli altri formati vengono convertiti nel browser.`;
    srv.querySelector('.srv-lbl').textContent = 'Server connesso';
    if (first) status('Pronto. Trascina un modello 3D nella vista oppure usa File › Importa');
  } catch {
    srv.dataset.state = 'err';
    srv.title = 'Server non raggiungibile: avviare CarveCAM.Server (dotnet run)';
    srv.querySelector('.srv-lbl').textContent = 'Server offline';
    if (first) status('Server non raggiungibile: avviare CarveCAM.Server (dotnet run)', true);
  }
}
setInterval(() => checkServer(), 20000);

const tree = new Tree(document.getElementById('tree'), cmd);
const props = new Props(document.getElementById('props'), cmd);

// ------------------------------------------------------------------ eventi di stato
function infoBar() {
  const p = App.project;
  document.getElementById('st-info').textContent =
    `${p.objects.length} modelli, ${p.artifacts.length} artefatti, ${p.planes.length} piani, ${p.operations.length} lavorazioni`;
}
let renderQueued = false;
function renderUi() {
  if (renderQueued) return;
  renderQueued = true;
  queueMicrotask(() => {
    renderQueued = false;
    sync.sync();
    tree.render();
    props.refresh();
    infoBar();
    titleBar();
    toolbar.update();
    updateGizmo();
  });
}
on('project', renderUi);
on('toolpath', renderUi);
on('view', renderUi);
on('sketch', renderUi);
on('selection', () => {
  sync.sync();
  tree.render();
  props.render();
  toolbar.update();
  updateGizmo();
});
on('transform', () => { props.refresh(); sketch.refreshFrame(); });
on('gizmo', () => { updateGizmo(); toolbar.update(); });
on('tool', () => toolbar.update());
on('dirty', titleBar);

// ------------------------------------------------------------------ manipolatore
function updateGizmo() {
  const t = vp.transform;
  const s = App.selection;
  if (sketch.active || sim.active || App.pickMode || !s || App.view.gizmo === 'none' || !['object', 'artifact', 'plane'].includes(s.type)) {
    if (t.object) t.detach();
    return;
  }
  const obj = sync.objectFor(s.type, s.id);
  if (!obj || !obj.visible) { if (t.object) t.detach(); return; }
  if (t.object !== obj) t.attach(obj);
  t.setMode(App.view.gizmo);
  t.setSpace(App.view.gizmoLocal ? 'local' : 'world');
  t.setTranslationSnap(App.view.gizmoSnap ? 1 : null);
  t.setRotationSnap(App.view.gizmoSnap ? THREE.MathUtils.degToRad(15) : null);
}

let dragSnap = null;
vp.transform.addEventListener('dragging-changed', e => {
  if (e.value) dragSnap = snapshot();
  else if (dragSnap) { const s = dragSnap; dragSnap = null; commitSnapshot(s); }
});
vp.transform.addEventListener('objectChange', () => {
  const s = App.selection;
  const obj = vp.transform.object;
  const r = resolve(s);
  if (!r || !obj) return;
  const rnd = v => Math.round(v * 10000) / 10000;
  const R2D = 180 / Math.PI;
  if (s.type === 'object' || s.type === 'artifact') {
    r.item.position = obj.position.toArray().map(rnd);
    r.item.rotation = [obj.rotation.x, obj.rotation.y, obj.rotation.z].map(v => rnd(v * R2D));
  } else if (s.type === 'plane') {
    const m = new THREE.Matrix4().makeRotationFromQuaternion(obj.quaternion);
    const u = new THREE.Vector3().setFromMatrixColumn(m, 0);
    const n = new THREE.Vector3().setFromMatrixColumn(m, 2);
    r.item.origin = obj.position.toArray().map(rnd);
    r.item.normal = n.toArray().map(v => Math.round(v * 1e6) / 1e6);
    r.item.angle = rnd(angleOfU(n, u));
  }
  emit('transform');
});

// ------------------------------------------------------------------ input nella vista 3D
const findItem = o => {
  for (let x = o; x; x = x.parent) if (x.userData && x.userData.type) return { type: x.userData.type, id: x.userData.id };
  return null;
};
const coordsEl = document.getElementById('st-coords');
vp.handlers.move = ev => {
  if (sketch.active) { sketch.onMove(ev); return; }
  const f = { o: new THREE.Vector3(), n: new THREE.Vector3(0, 0, 1) };
  const p = vp.rayPlane(ev, f);
  coordsEl.textContent = p ? `X ${fmt(p.x, 2)}  Y ${fmt(p.y, 2)}  (Z=0)` : '';
};
vp.handlers.leave = () => { if (sketch.active) sketch.onLeave(); };
vp.handlers.click = ev => {
  if (sketch.active) { sketch.onClick(ev); return; }
  if (App.pickMode) { cmd.handlePick(ev); return; }
  if (ev.button !== 0) return;
  const hits = vp.raycast(ev, sync.pickables(), false);
  const hit = hits.find(x => x.object.userData.type !== 'plane') || hits[0];
  select(hit ? findItem(hit.object) : null);
};
vp.handlers.dblclick = ev => {
  if (sketch.active) { sketch.onDblClick(ev); return; }
  const hits = vp.raycast(ev, sync.pickables(), false);
  const hit = hits.find(x => x.object.userData.type === 'plane');
  if (hit && !hits.some(x => x.object.userData.type !== 'plane' && x.distance < hit.distance)) {
    const pl = App.project.planes.find(p => p.id === hit.object.userData.id);
    if (pl && pl.sketches[0]) cmd.editSketch(pl.sketches[0].id);
  }
};

// comandi sotto il cubo di orientamento
const tip = document.getElementById('tooltip');
for (const b of document.querySelectorAll('#view-tools [data-view]')) {
  b.innerHTML = TB[b.dataset.ico] || '';
  b.addEventListener('click', () => {
    tip.hidden = true;
    const v = b.dataset.view;
    if (v === 'fit') cmd.fit();
    else if (v === 'proj') { cmd.toggleProjection(); toolbar.update(); }
    else if (v === 'plane') cmd.planeFromView();
    else cmd.setView(v);
  });
  const show = () => {
    tip.replaceChildren(...[
      h('div', { class: 'tt-row' }, h('b', {}, b.getAttribute('aria-label')), b.dataset.kbd ? h('kbd', {}, b.dataset.kbd) : null),
      b.dataset.hint ? h('div', { class: 'tt-hint' }, b.dataset.hint) : null,
    ].filter(Boolean));
    tip.hidden = false;
    const rc = b.getBoundingClientRect();
    tip.style.left = `${Math.max(6, Math.min(window.innerWidth - tip.offsetWidth - 6, rc.left + rc.width / 2 - tip.offsetWidth / 2))}px`;
    tip.style.top = `${rc.bottom + 8}px`;
  };
  b.addEventListener('mouseenter', show);
  b.addEventListener('focus', show);
  b.addEventListener('mouseleave', () => { tip.hidden = true; });
  b.addEventListener('blur', () => { tip.hidden = true; });
}

// trascinamento file sulla vista
const vpEl = document.getElementById('viewport');
vpEl.addEventListener('dragover', e => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; });
vpEl.addEventListener('drop', e => {
  e.preventDefault();
  const files = [...(e.dataTransfer?.files || [])];
  if (files.some(f => isProjectFile(f.name))) toast('Per aprire un progetto usa File › Apri progetto', 'warn');
  const models = files.filter(f => !isProjectFile(f.name));
  if (models.length) cmd.importFiles(models);
});

// ------------------------------------------------------------------ tastiera
document.addEventListener('keydown', e => {
  if (document.querySelector('#modal-root .backdrop') || palette.isOpen) return;
  const tag = e.target.tagName;
  const typing = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || e.target.isContentEditable;
  const ctrl = e.ctrlKey || e.metaKey;
  const k = e.key.toLowerCase();
  if (ctrl && k === 'k') { e.preventDefault(); cmd.openPalette(); return; }
  if (ctrl && k === 's') { e.preventDefault(); cmd.saveProject(); return; }
  if (ctrl && k === 'o') { e.preventDefault(); cmd.openProject(); return; }
  if (ctrl && k === 'i') { e.preventDefault(); cmd.importModel(); return; }
  if (e.key === 'F9') { e.preventDefault(); cmd.computeSelected(); return; }
  if (typing) return;
  if (ctrl && k === 'z' && !e.shiftKey) { e.preventDefault(); cmd.undo(); return; }
  if (ctrl && (k === 'y' || (k === 'z' && e.shiftKey))) { e.preventDefault(); cmd.redo(); return; }
  if (ctrl && k === 'd') { e.preventDefault(); cmd.duplicateSelected(); return; }
  if (ctrl || e.altKey) return;
  if (sketch.active && sketch.onKey(e)) { e.preventDefault(); return; }
  if (sim.active && e.key === ' ') { e.preventDefault(); sim.toggle(); return; }
  switch (e.key) {
    case 'Delete': cmd.deleteSelected(); break;
    case 'Escape':
      if (App.pickMode) cmd.cancelPick();
      else if (sim.active) sim.stop();
      else if (App.selection) select(null);
      break;
    case 'f': case 'F': cmd.fit(); break;
    case 'g': case 'G': case 't': case 'T': cmd.setGizmo('translate'); break;
    case 'r': case 'R': cmd.setGizmo('rotate'); break;
    case '7': cmd.setView('top'); break;
    case '1': cmd.setView('front'); break;
    case '3': cmd.setView('right'); break;
    case '0': cmd.setView('iso'); break;
    case '5': cmd.toggleProjection(); toolbar.update(); break;
    default: return;
  }
  e.preventDefault();
});

// ------------------------------------------------------------------ separatori ridimensionabili
function dragSplit(handle, onMove) {
  handle.addEventListener('pointerdown', e => {
    e.preventDefault();
    handle.setPointerCapture(e.pointerId);
    handle.classList.add('drag');
    const move = ev => onMove(ev);
    const up = () => {
      handle.classList.remove('drag');
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', up);
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', up);
  });
}
dragSplit(document.getElementById('sidebar-resizer'), ev => {
  const w = Math.max(220, Math.min(window.innerWidth * 0.6, ev.clientX));
  document.documentElement.style.setProperty('--sidebar-w', `${w}px`);
});
dragSplit(document.getElementById('sidebar-split'), ev => {
  const sb = document.getElementById('sidebar').getBoundingClientRect();
  const pct = Math.max(12, Math.min(85, ((ev.clientY - sb.top) / sb.height) * 100));
  document.getElementById('tree-panel').style.flex = `0 0 ${pct}%`;
});

// ------------------------------------------------------------------ avvio
(async function start() {
  const saved = loadAutosave();
  setProject(isProjectDoc(saved) ? saved : newProject());
  await checkServer(true);
  await cmd.loadMeshes();
  vp.fit();
  if (saved && (saved.objects?.length || saved.planes?.length)) toast('Ripristinato l\'ultimo progetto aperto in questo browser', 'info', 3000);
})();
