// Avvio dell'applicazione e collegamento dei moduli.
import { log } from './log.js';
import * as THREE from 'three';
import {
  App, on, select, toggleSelect, isSelected, resolve, setProject, newProject, loadAutosave, allSketches, isProjectDoc, isProjectFile,
} from './state.js';
import { contextMenu } from './ui-menu.js';
import { applyTheme, settings } from './settings.js';
import { t, translateDom, LOCALE } from './i18n.js';
import { Viewport } from './viewport.js';
import { ViewCube } from './viewcube.js';
import { SceneSync } from './scene-sync.js';
import { SketchMode } from './sketch.js';
import { Simulator } from './simulation.js';
import { GizmoController } from './gizmo.js';
import { createCommands } from './commands.js';
import { ModifyTool } from './modify.js';
import { MenuBar } from './ui-menu.js';
import { Toolbar } from './ui-toolbar.js';
import { CommandPalette } from './ui-palette.js';
import { createActions, MENUS, TOOLBAR } from './actions.js';
import { TB } from './icons.js';
import { Tree } from './ui-tree.js';
import { Props } from './ui-props.js';
import { api } from './api.js';
import { status, toast, h, modal } from './dialogs.js';
import { fmt } from './geom.js';
import { previousSessionCrashed, startSession } from './recovery.js';
import { initLoaders, splashText, splashDone } from './loader.js';
import { HomeScreen } from './home.js';
import { openGuide, initGuide, guideOpen } from './guide.js';

applyTheme();
translateDom();
initLoaders();
splashText(t('Preparazione dell\'interfaccia…'));

const vp = new Viewport(document.getElementById('viewport'));
const viewCube = new ViewCube(vp, document.getElementById('view-cube'));
const sync = new SceneSync(vp);
const sketch = new SketchMode(vp, sync);
const sim = new Simulator(vp, sync);
const gizmo = new GizmoController({ vp, sync, isBlocked: () => sketch.active || sim.active });
const cmd = createCommands({ vp, sync, sketch, sim, gizmo });
// comandi di modifica (Sposta, Ruota, Copia, Scala smart, serie): ricevono i clic nella vista mentre sono attivi
const modify = new ModifyTool({ vp, sync, sketch, sim, cmd });
cmd.modify = kind => modify.start(kind);
cmd.modifyWhy = kind => modify.why(kind);
cmd.modifyKind = () => modify.kind;
cmd.modifyCancel = () => modify.cancel();
cmd.modifyItems = () => modify.contextItems();
window.carvecam = { App, vp, sync, cmd, viewCube, gizmo, sim, modify, log }; // accesso da console per diagnostica
App.project = newProject(); // progetto vuoto finché non viene ripristinato/aperto (vedi start)

// ------------------------------------------------------------------ intestazione: menu, barra strumenti, ricerca comandi
const actions = createActions({ cmd, vp, sketch });
const recent = { list: [], open: e => cmd.openRecent(e) };
const menuBar = new MenuBar(document.getElementById('menubar'), MENUS, actions, recent);
const palette = new CommandPalette(actions, MENUS);
cmd.openPalette = () => { menuBar.close(); palette.open(); };
// guida e schermata iniziale
initGuide({ run: id => actions.run(id) });
cmd.guide = page => { menuBar.close(); return openGuide(page); };
const home = new HomeScreen({ cmd, vp, openGuide: page => openGuide(page) });
cmd.home = () => { menuBar.close(); return home.show(); };
document.getElementById('brand').addEventListener('click', () => cmd.home());
async function refreshRecent() { recent.list = await cmd.recentProjects(); }
on('recent', refreshRecent);

/** Stato di ciascuna fase del flusso di lavoro (spie della barra strumenti). */
function stageOf(stage) {
  const p = App.project;
  switch (stage) {
    case 'model': {
      const n = p.objects.length + p.artifacts.length;
      return n ? { state: 'done', tip: t('{a} modelli e {b} artefatti nella scena', { a: p.objects.length, b: p.artifacts.length }) }
        : { state: 'todo', tip: t('importa un modello 3D o inserisci un artefatto') };
    }
    case 'planes':
      return p.planes.length ? { state: 'done', tip: t('{n} piani di lavoro', { n: p.planes.length }) }
        : { state: 'todo', tip: t('premi Aggiungi piano: la normale del piano è l\'asse utensile') };
    case 'sketch': {
      const all = allSketches();
      const full = all.filter(x => x.sketch.entities.length).length;
      if (full) return { state: 'done', tip: t('{n} sketch con area di contenimento', { n: full }) };
      return all.length ? { state: 'partial', tip: t('disegna un contorno chiuso nello sketch') }
        : { state: 'todo', tip: t('seleziona un piano, crea uno sketch e disegna l\'area da lavorare') };
    }
    case 'ops':
      return p.operations.length ? { state: 'done', tip: t('{n} lavorazioni', { n: p.operations.length }) }
        : { state: 'todo', tip: t('seleziona uno sketch e aggiungi una svuotatura o una finitura') };
    case 'output': {
      const n = p.operations.length;
      if (!n) return { state: 'todo', tip: t('nessuna lavorazione da calcolare') };
      const ok = p.operations.filter(o => cmd.opStatus(o) === 'ok').length;
      if (ok === n) return { state: 'done', tip: t('{n} percorsi calcolati e aggiornati: pronti per simulazione e G-code', { n }) };
      return ok ? { state: 'partial', tip: t('{ok} di {n} percorsi aggiornati: premi Ricalcola tutto', { ok, n }) }
        : { state: 'todo', tip: t('premi Ricalcola tutto per generare i percorsi') };
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

// nome del progetto modificabile in linea: Invio o uscita dal campo chiedono il salvataggio
const projName = document.getElementById('proj-name');
const projDirty = document.getElementById('proj-dirty');
projName.addEventListener('change', () => {
  const v = projName.value.trim();
  if (v && v !== App.project.name) cmd.renameTo(v);
  else projName.value = App.project.name;
});
projName.addEventListener('keydown', e => {
  // preventDefault: l'Invio non deve arrivare alla finestra di conferma che si apre subito dopo
  if (e.key === 'Enter') { e.preventDefault(); projName.blur(); }
  if (e.key === 'Escape') { e.preventDefault(); projName.value = App.project.name; projName.blur(); }
});
function titleBar() {
  if (document.activeElement !== projName) projName.value = App.project.name || '';
  projDirty.hidden = !App.dirty;
  projName.title = App.fileName ? t('Nome del progetto (file: {f}). Clic per rinominare', { f: App.fileName }) : t('Nome del progetto (clic per rinominare)');
  document.title = `${App.dirty ? '● ' : ''}${App.project.name || t('Progetto')} – CarveCAM`;
}

document.getElementById('cmd-search').addEventListener('click', () => cmd.openPalette());
document.querySelector('#cmd-search .cs-ico').innerHTML = TB.search;
const helpBtn = document.getElementById('btn-help');
helpBtn.innerHTML = `<span class="tb-ico">${TB.help}</span>`;
helpBtn.addEventListener('click', () => cmd.guide());

// stato del server VB.NET (verificato periodicamente)
const srv = document.getElementById('srv-status');
let srvOk = null;
async function checkServer(first = false) {
  try {
    const f = await api.formats();
    srv.dataset.state = 'ok';
    srv.title = t('Server VB.NET connesso. Importazione nativa: {f}; gli altri formati vengono convertiti nel browser.', { f: f.server.map(x => x.toUpperCase()).join(', ') });
    srv.querySelector('.srv-lbl').textContent = t('Server connesso');
    if (first) status(t('Pronto. Trascina un modello 3D nella vista oppure usa File › Importa'));
    if (srvOk === false) log.info('Server di nuovo raggiungibile');
    srvOk = true;
  } catch {
    srv.dataset.state = 'err';
    srv.title = t('Server non raggiungibile: avviare CarveCAM.Server (dotnet run)');
    srv.querySelector('.srv-lbl').textContent = t('Server offline');
    if (first) status(t('Server non raggiungibile: avviare CarveCAM.Server (dotnet run)'), true);
    if (srvOk !== false) log.warn('Server non raggiungibile');
    srvOk = false;
  }
}
setInterval(() => checkServer(), 20000);

const tree = new Tree(document.getElementById('tree'), cmd);
const props = new Props(document.getElementById('props'), cmd);

// ------------------------------------------------------------------ eventi di stato
function infoBar() {
  const p = App.project;
  document.getElementById('st-info').textContent =
    t('{a} modelli, {b} artefatti, {c} piani, {d} lavorazioni', { a: p.objects.length, b: p.artifacts.length, c: p.planes.length, d: p.operations.length });
}
let renderQueued = false;
function renderUi() {
  if (renderQueued) return;
  renderQueued = true;
  queueMicrotask(() => {
    renderQueued = false;
    sync.sync();
    sketch.redraw();
    tree.render();
    props.refresh();
    infoBar();
    titleBar();
    toolbar.update();
    gizmo.refresh();
  });
}
on('project', renderUi);
on('toolpath', renderUi);
on('view', renderUi);
on('sketch', renderUi);
on('selection', () => {
  // la simulazione resta aperta finché la sua lavorazione rimane selezionata
  if (sim.active && !(App.selected.length === 1 && App.selection?.type === 'operation' && App.selection.id === sim.opId)) sim.stop();
  if (App.pickMode?.kind === 'pivot') gizmo.cancelPivotPick();
  sync.sync();
  sketch.redraw();
  tree.render();
  props.render();
  toolbar.update();
  gizmo.refresh();
});
on('transform', () => { props.refresh(); sketch.refreshFrame(); });
on('gizmo', () => { gizmo.refresh(); toolbar.update(); });
on('mode', () => toolbar.update());
on('tool', () => toolbar.update());
on('dirty', titleBar);

// ------------------------------------------------------------------ input nella vista 3D
const findItem = o => {
  for (let x = o; x; x = x.parent) if (x.userData && x.userData.type) return { type: x.userData.type, id: x.userData.id };
  return null;
};
/**
 * Primo elemento colpito: oggetti e artefatti prima dei piani, e tra i solidi quelli che non sono grezzo (il pezzo
 * dentro il grezzo trasparente si seleziona con un clic; il grezzo, cliccandolo dove non c'è altro).
 */
function hitItem(ev) {
  const hits = vp.raycast(ev, sync.pickables(), false).filter(x => x.object.userData.type !== 'plane' || sync.planeHitAccepted(x));
  const solid = x => x.object.userData.type !== 'plane';
  const stock = x => { const it = findItem(x.object); return !!(it && resolve(it)?.item.stock); };
  const hit = hits.find(x => solid(x) && !stock(x)) || hits.find(solid) || hits[0];
  return hit ? findItem(hit.object) : null;
}
const coordsEl = document.getElementById('st-coords');
vp.handlers.down = () => gizmo.onPointerDown();
// maniglie delle entità dello sketch: il trascinamento modifica la geometria invece di ruotare la vista
vp.handlers.grab = ev => (sketch.active && !App.pickMode ? sketch.grab(ev) : null);
// cursore "selezionabile" sopra i riquadri dei piani (al massimo un controllo per fotogramma)
let hoverEv = null;
function hoverPlanes() {
  const ev = hoverEv;
  hoverEv = null;
  const on = !!ev && !sketch.active && !App.pickMode && vp.raycast(ev, sync.planeQuads(), false).length > 0;
  vp.el.classList.toggle('hover-plane', on);
}
// modalità di scelta punti con aggancio ai vertici (piano da 3 punti, origini): al massimo un controllo per fotogramma
let snapEv = null;
function snapHover() {
  const ev = snapEv;
  snapEv = null;
  const r = ev && cmd.pickHover(ev);
  if (r) coordsEl.textContent = `X ${fmt(r.point.x, 3)}  Y ${fmt(r.point.y, 3)}  Z ${fmt(r.point.z, 3)}${r.snapped ? `  [${t('vertice')}]` : ''}`;
}
vp.handlers.move = ev => {
  if (modify.active) { modify.move(ev); return; }
  if (App.pickMode?.kind === 'pivot') { gizmo.pivotMove(ev); return; }
  if (sketch.active) { sketch.onMove(ev); return; }
  if (App.pickMode) {
    if (!snapEv) requestAnimationFrame(snapHover);
    snapEv = ev;
    return;
  }
  if (!hoverEv && ev.buttons === 0) requestAnimationFrame(hoverPlanes);
  if (ev.buttons === 0) hoverEv = ev;
  const f = { o: new THREE.Vector3(), n: new THREE.Vector3(0, 0, 1) };
  const p = vp.rayPlane(ev, f);
  coordsEl.textContent = p ? `X ${fmt(p.x, 2)}  Y ${fmt(p.y, 2)}  (Z=0)` : '';
};
vp.handlers.leave = () => {
  vp.el.classList.remove('hover-plane');
  if (modify.active) modify.leave();
  else if (sketch.active) sketch.onLeave();
};
vp.handlers.click = ev => {
  if (gizmo.consumeClick()) return;
  if (modify.active) { modify.click(ev); return; }
  if (App.pickMode?.kind === 'pivot') { gizmo.pivotClick(ev); return; }
  if (sketch.active) { sketch.onClick(ev); return; }
  if (App.pickMode) { cmd.handlePick(ev); return; }
  // tasto destro su un elemento: lo seleziona (se non lo è già) e apre il suo menu
  if (ev.button === 2) {
    const it = hitItem(ev);
    if (!it) return;
    if (!isSelected(it.type, it.id)) select(it);
    contextMenu(ev, cmd.contextItems(it));
    return;
  }
  if (ev.button !== 0) return;
  const it = hitItem(ev);
  if (ev.ctrlKey || ev.metaKey || ev.shiftKey) { if (it) toggleSelect(it); return; }
  select(it);
};
vp.handlers.dblclick = ev => {
  if (modify.active) return;
  if (sketch.active) { sketch.onDblClick(ev); return; }
  if (App.pickMode) return;
  const it = hitItem(ev);
  if (it?.type === 'plane') {
    const pl = App.project.planes.find(p => p.id === it.id);
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
    log.action(`view.${v}`);
    if (v === 'fit') cmd.fit();
    else if (v === 'proj') { cmd.toggleProjection(); toolbar.update(); }
    else if (v === 'normal') cmd.viewNormal();
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
  if (files.some(f => isProjectFile(f.name))) toast(t('Per aprire un progetto usa File › Apri progetto'), 'warn');
  const models = files.filter(f => !isProjectFile(f.name));
  if (models.length) cmd.importFiles(models);
});

// ------------------------------------------------------------------ tastiera
const MODIFY_KEYS = { m: 'xf.move', r: 'xf.rotate', c: 'xf.copy', l: 'xf.align', s: 'xf.scale', a: 'xf.arrayRect', p: 'xf.arrayPolar' };
document.addEventListener('keydown', e => {
  if (document.querySelector('#modal-root .backdrop') || palette.isOpen) return;
  const tag = e.target.tagName;
  const typing = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || e.target.isContentEditable;
  const ctrl = e.ctrlKey || e.metaKey;
  const k = e.key.toLowerCase();
  const key = (id, fn) => { e.preventDefault(); log.action(`key:${id}`); fn(); };
  if (e.key === 'F1') return key('guide', () => { if (!guideOpen()) cmd.guide(); });
  // schermata iniziale aperta: valgono solo apertura del progetto e guida (l'area di lavoro è coperta)
  if (home.isOpen) {
    if (ctrl && k === 'o') key('open', async () => { if (await cmd.openProject()) home.hide(); });
    return;
  }
  if (ctrl && k === 'k') return key('palette', () => cmd.openPalette());
  if (ctrl && e.shiftKey && k === 's') return key('saveAs', () => cmd.saveProjectAs());
  if (ctrl && k === 's') return key('save', () => cmd.saveProject());
  if (ctrl && k === 'o') return key('open', () => cmd.openProject());
  // le scorciatoie passano dalle azioni: valgono le stesse regole di abilitazione di menu e barra
  if (ctrl && k === 'i') return key('import', () => actions.run('file.import'));
  if (e.key === 'F9') return key('compute', () => actions.run('op.compute'));
  if (typing) return;
  if (ctrl && k === 'z' && !e.shiftKey) return key('undo', () => cmd.undo());
  if (ctrl && (k === 'y' || (k === 'z' && e.shiftKey))) return key('redo', () => cmd.redo());
  if (ctrl && k === 'd') return key('duplicate', () => cmd.duplicateSelected());
  if (ctrl && k === 'l') return key('lock', () => cmd.toggleLock());
  if (ctrl || e.altKey) return;
  // comando di modifica in corso: Esc annulla, Invio applica, Backspace torna al passo precedente
  if (modify.active) {
    if (e.key === 'Escape') return key('modify.cancel', () => modify.cancel());
    if (e.key === 'Enter') return key('modify.apply', () => modify.applyNow());
    if (e.key === 'Backspace') return key('modify.back', () => modify.back());
  }
  // Maiusc+lettera: comandi di modifica (anche dentro lo sketch, dove le lettere scelgono gli strumenti)
  const xf = e.shiftKey && MODIFY_KEYS[k];
  if (xf) return key(xf, () => actions.run(xf));
  // durante un comando di modifica restano valide le scorciatoie della vista, non gli strumenti dello sketch
  if (!modify.active && sketch.active && sketch.onKey(e)) { e.preventDefault(); return; }
  if (sim.active && e.key === ' ') { e.preventDefault(); sim.toggle(); return; }
  switch (e.key) {
    case 'Delete': if (!modify.active) cmd.deleteSelected(); break;
    case 'Escape':
      if (App.pickMode) cmd.cancelPick();
      else if (App.planeMode) cmd.endPlaneMode();
      else if (sim.active) sim.stop();
      else if (App.selected.length) select(null);
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
    // al massimo un ridimensionamento per fotogramma, anche con mouse ad alta frequenza
    let last = null, queued = false;
    const move = ev => {
      last = ev;
      if (queued) return;
      queued = true;
      requestAnimationFrame(() => { queued = false; onMove(last); });
    };
    const up = () => {
      handle.classList.remove('drag');
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', up);
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', up);
  });
}
// le larghezze si impostano sull'area principale: cambiarle sulla radice ricalcolerebbe gli stili di tutta la pagina
const mainEl = document.getElementById('main');
dragSplit(document.getElementById('sidebar-resizer'), ev => {
  const w = Math.max(200, Math.min(window.innerWidth * 0.45, ev.clientX));
  mainEl.style.setProperty('--sidebar-w', `${Math.round(w)}px`);
});
dragSplit(document.getElementById('props-resizer'), ev => {
  const w = Math.max(240, Math.min(window.innerWidth * 0.45, window.innerWidth - ev.clientX));
  mainEl.style.setProperty('--props-w', `${Math.round(w)}px`);
});

// chiusura con modifiche non salvate: il browser chiede conferma
window.addEventListener('beforeunload', e => {
  if (!App.dirty) return;
  e.preventDefault();
  e.returnValue = '';
});

// ------------------------------------------------------------------ avvio
(async function start() {
  try { await startUp(); } catch (e) { log.error('Avvio non riuscito', e); } finally { splashDone(); }
})();

async function startUp() {
  let recovered = false;
  const crashed = previousSessionCrashed();
  startSession();
  const saved = loadAutosave();
  const has = saved && isProjectDoc(saved.project);
  const content = has && (saved.project.objects?.length || saved.project.artifacts?.length || saved.project.planes?.length);
  if (has && crashed && saved.dirty && content) {
    // chiusura anomala con modifiche non salvate: si chiede se recuperarle (sopra l'interfaccia, non sotto l'avvio)
    splashDone();
    setProject(newProject());
    const when = saved.ts ? new Date(saved.ts).toLocaleString(LOCALE) : '';
    const ok = await modal({
      title: t('Recupero del progetto'),
      body: h('div', {},
        h('p', { style: { marginTop: 0 } }, t('CarveCAM non è stato chiuso correttamente.')),
        h('p', {}, t('È disponibile una copia di sicurezza del progetto "{name}" con modifiche non salvate ({when}). Recuperarla?', { name: saved.project.name, when })),
        h('p', { class: 'p-note', style: { margin: 0 } }, t('Altre copie automatiche restano disponibili in File › Copie di sicurezza.'))),
      buttons: [{ label: t('Non recuperare'), value: false }, { label: t('Recupera'), value: true, primary: true }],
    });
    log.warn(ok ? 'Progetto recuperato dopo chiusura anomala' : 'Recupero dopo chiusura anomala rifiutato', { name: saved.project.name });
    if (ok) { setProject(saved.project, true); recovered = true; }
  } else {
    setProject(has ? saved.project : newProject(), !!(has && saved.dirty));
  }
  splashText(t('Connessione al server…'));
  await checkServer(true);
  splashText(t('Caricamento dei modelli…'));
  await cmd.loadMeshes();
  splashText(t('Preparazione della vista…'));
  // vista iniziale: quella memorizzata nelle opzioni (orientamento, zoom, punto inquadrato), altrimenti adatta
  if (settings.view?.saved) {
    vp.applyView(settings.view, { animate: false });
    document.getElementById('btn-proj').setAttribute('aria-pressed', String(vp.isOrtho));
    toolbar.update();
  } else vp.fit();
  await refreshRecent();
  // schermata iniziale (sotto la schermata di caricamento, che sfuma); non dopo un recupero appena confermato
  const showHome = settings.startScreen !== false && !recovered;
  if (showHome) await home.show({ startup: true });
  splashDone();
  if (!showHome && has && !crashed && content) toast(t('Ripristinato l\'ultimo progetto aperto in questo browser'), 'info', 3000);
}
