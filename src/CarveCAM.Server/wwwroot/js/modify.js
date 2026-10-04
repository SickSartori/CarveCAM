// Comandi di modifica della selezione: Sposta, Ruota, Copia, Allinea a, Scala smart, Serie rettangolare e Serie
// polare. Valgono per le entità di uno sketch (nel sistema del piano, U e V) e per gli elementi 3D (oggetti,
// artefatti, piani con i loro sketch, punti di origine). Un pannello in basso nella vista indica il passo da fare e
// raccoglie i valori scritti; l'anteprima segue il puntatore, con l'aggancio ai punti come negli altri comandi.
import * as THREE from 'three';
import { App, emit, on, mutate, resolve, resolveAll, getSketch, getPlane, selectMany, uid, MOVABLE } from './state.js';
import { planeFrame, frameMatrix, toLocal, entityLoop, entitySnapPoints, distPointSeg, fmt } from './geom.js';
import { itemMatrix, applyItemMatrix } from './gizmo.js';
import { preciseBox } from './commands.js';
import { evalNum } from './ui-props.js';
import { settings } from './settings.js';
import { h, status, toast } from './dialogs.js';
import { TB } from './icons.js';
import { t } from './i18n.js';
import { log } from './log.js';

const R2D = 180 / Math.PI;
const D2R = Math.PI / 180;
const r6 = v => { const r = Math.round(v * 1e6) / 1e6; return Object.is(r, -0) ? 0 : r; };
const r4 = v => { const r = Math.round(v * 1e4) / 1e4; return Object.is(r, -0) ? 0 : r; };
const MAX_NEW = 2000;      // elementi creati al massimo da una copia o da una serie
const MAX_PREVIEW = 400;   // trasformazioni mostrate al massimo nell'anteprima
const EDGE_PX = 8;         // distanza (pixel) per prendere un segmento o un bordo come riferimento
const PREF_KEY = 'carvecam.modify.v1';
const COL = { preview: 0x7cf2ff, mark: 0xff8a3d, cursor: 0xffffff, fixed: 0xffe066, axis: 0x4f9dff };
const AXIS = { z: new THREE.Vector3(0, 0, 1), x: new THREE.Vector3(1, 0, 0), y: new THREE.Vector3(0, 1, 0) };
const DELTA = ['dx', 'dy', 'dz'];   // spostamento
const ABS = ['ax', 'ay', 'az'];     // punto di arrivo (coordinate assolute)
const CTR = ['cx', 'cy', 'cz'];     // centro della serie polare
/** Campi scritti che comandano al posto del mouse: campo → valore di op.typed. */
const TYPED = {
  dx: 'delta', dy: 'delta', dz: 'delta', ax: 'abs', ay: 'abs', az: 'abs', dist: 'dist', angle: 'angle', dir: 'dir',
  len: 'len', factor: 'factor', cx: 'center', cy: 'center', cz: 'center',
};

/** Comandi: chiave, nome, icona, tasto (con Maiusc), spiegazione. */
export const MODIFY_COMMANDS = [
  ['move', 'Sposta', 'xfMove', 'M', 'Sposta la selezione da un punto base a un punto di arrivo (con aggancio ai punti), oppure di uno spostamento o fino a coordinate scritte'],
  ['rotate', 'Ruota', 'xfRotate', 'R', 'Ruota la selezione attorno a un centro o a un asse per due punti: l\'angolo si indica con due direzioni o due bordi nella vista, oppure si scrive'],
  ['copy', 'Copia', 'xfCopy', 'C', 'Copia la selezione da un punto base ai punti indicati, una o più volte, anche più copie in fila'],
  ['align', 'Allinea a', 'xfAlign', 'L', 'Indica 2 punti (3 per il 3D) sul pezzo da spostare e altrettanti sul riferimento: il pezzo si sposta e ruota facendo combaciare il primo punto e allineando gli altri'],
  ['scale', 'Scala smart', 'xfScale', 'S', 'Indica un riferimento (due punti, un segmento o un bordo) e scrivi la misura che deve avere: il fattore di scala si calcola da solo'],
  ['arrayRect', 'Serie rettangolare', 'xfArrayRect', 'A', 'Copie della selezione disposte in colonne e righe (e livelli per gli elementi 3D)'],
  ['arrayPolar', 'Serie polare', 'xfArrayPolar', 'P', 'Copie della selezione disposte in cerchio attorno a un centro, indicato nella vista o scritto'],
];

const loadPref = () => { try { return JSON.parse(localStorage.getItem(PREF_KEY) || '{}') || {}; } catch { return {}; } };
const savePref = v => { try { localStorage.setItem(PREF_KEY, JSON.stringify(v)); } catch { /* storage non disponibile */ } };
/** Diametro (pixel) dei pallini: dall'opzione "Pallini del riferimento", per il punto agganciato più del doppio. */
const dotPx = f => Math.round(Math.max(6, Number(settings.sizes?.pivotDot) || 11) * f);

// ------------------------------------------------------------------ trasformazioni dei dati
/**
 * Applica a un'entità (modificandola) la trasformazione M nel sistema del piano: traslazione, rotazione attorno
 * alla normale, scala uniforme. Un rettangolo ruotato di un angolo che non è multiplo di 90° diventa una polilinea.
 */
export function xfEntity(e, M) {
  const el = M.elements;
  const k = Math.hypot(el[0], el[1]);
  const ang = Math.atan2(el[1], el[0]) * R2D;
  const v = new THREE.Vector3();
  const P = (x, y) => { v.set(x, y, 0).applyMatrix4(M); return [r6(v.x), r6(v.y)]; };
  switch (e.kind) {
    case 'rect': {
      const q = ang / 90;
      if (Math.abs(q - Math.round(q)) < 1e-9) {
        // il primo punto resta il primo: x1, y1 e l'angolo opposto x2, y2 restano angoli opposti
        [e.x1, e.y1] = P(e.x1, e.y1);
        [e.x2, e.y2] = P(e.x2, e.y2);
      } else {
        const pts = entityLoop(e).map(([x, y]) => P(x, y));
        for (const key of ['x1', 'y1', 'x2', 'y2']) delete e[key];
        Object.assign(e, { kind: 'polyline', pts, closed: true });
      }
      break;
    }
    case 'circle':
      [e.cx, e.cy] = P(e.cx, e.cy);
      e.r = r6(e.r * k);
      break;
    case 'polygon': {
      [e.cx, e.cy] = P(e.cx, e.cy);
      e.r = r6(e.r * k);
      const rot = (e.rot || 0) + ang;
      e.rot = r6(((rot % 360) + 540) % 360 - 180);
      break;
    }
    case 'polyline':
      e.pts = (e.pts || []).map(([x, y]) => P(x, y));
      break;
  }
  return e;
}

/** Applica a un elemento 3D (modificandolo) la trasformazione D nel mondo: rototraslazione ed eventuale scala uniforme. */
function xfItem(type, item, D) {
  const k = Math.cbrt(Math.abs(D.determinant()));
  applyItemMatrix(type, item, D.clone().multiply(itemMatrix(type, item)));
  if (Math.abs(k - 1) < 1e-12) return;
  if (type === 'object') item.scale = (item.scale || [1, 1, 1]).map(s => r6(s * k));
  else if (type === 'artifact') {
    if (Array.isArray(item.size)) item.size = item.size.map(s => r4(s * k));
    for (const key of ['radius', 'radius2', 'height']) if (Number.isFinite(item[key])) item[key] = r4(item[key] * k);
    if (Array.isArray(item.profile)) item.profile = item.profile.map(l => l.map(([x, y]) => [r4(x * k), r4(y * k)]));
  } else if (type === 'plane') {
    // il piano si ingrandisce con i suoi disegni, attorno alla sua origine (che la scala ha già spostato)
    item.size = r4((item.size || 100) * k);
    const S = new THREE.Matrix4().makeScale(k, k, 1);
    for (const s of item.sketches || []) for (const e of s.entities) xfEntity(e, S);
  }
}

/** Copia di un elemento 3D aggiunta al progetto p (nuovi id; un piano anche con i suoi sketch). */
function cloneItem(p, type, item, name) {
  const c = structuredClone(item);
  c.id = uid({ object: 'obj', artifact: 'art', origin: 'org', plane: 'pl' }[type]);
  c.name = name;
  c.locked = false;
  if (type === 'plane') for (const sk of c.sketches || []) { sk.id = uid('sk'); for (const e of sk.entities) e.id = uid('e'); }
  ({ object: p.objects, artifact: p.artifacts, origin: p.origins, plane: p.planes })[type].push(c);
  return c;
}

// ------------------------------------------------------------------ angoli
/** Componente di v perpendicolare all'asse. */
const flat = (v, axis) => v.clone().addScaledVector(axis, -v.dot(axis));

/** Angolo (gradi, con segno attorno all'asse) tra le direzioni u e w, proiettate sul piano perpendicolare all'asse. */
function angleAbout(axis, u0, w0) {
  const u = flat(u0, axis), w = flat(w0, axis);
  if (u.lengthSq() < 1e-12 || w.lengthSq() < 1e-12) return null;
  return Math.atan2(axis.dot(u.clone().cross(w)), u.dot(w)) * R2D;
}

/**
 * Direzione da cui si misurano gli angoli attorno all'asse: attorno a Z l'asse X, attorno a X l'asse Y, attorno a
 * Y l'asse Z (come la regola della mano destra); per un asse qualsiasi la proiezione di X (o di Y).
 */
function zeroDir(axis) {
  const [ax, ay, az] = [Math.abs(axis.x), Math.abs(axis.y), Math.abs(axis.z)];
  const ref = az > 0.99 ? AXIS.x : ax > 0.99 ? AXIS.y : ay > 0.99 ? AXIS.z : AXIS.x;
  const z = flat(ref, axis);
  return (z.lengthSq() > 1e-6 ? z : flat(AXIS.y, axis)).normalize();
}

/** Angolo assoluto di una direzione attorno all'asse (gradi). */
const absAngle = (axis, dir) => angleAbout(axis, zeroDir(axis), dir);

/** Angolo in (-180, 180]; per una linea (bordo, senza verso) in (-90, 90]. */
function wrapAngle(a, line = false) {
  const p = line ? 180 : 360;
  let r = ((a % p) + p) % p;
  if (r > p / 2) r -= p;
  return Math.abs(r) < 1e-12 ? 0 : r;
}

/** Spostamento lungo l'asse principale (Maiusc). */
function axisLock(d) {
  const a = [Math.abs(d.x), Math.abs(d.y), Math.abs(d.z)];
  const i = a.indexOf(Math.max(...a));
  return new THREE.Vector3(i === 0 ? d.x : 0, i === 1 ? d.y : 0, i === 2 ? d.z : 0);
}

// ------------------------------------------------------------------ Allinea a
/** Sistema ortonormale da tre punti: origine a, asse X verso b, piano XY per c (null se allineati). */
function frame3(a, b, c) {
  const x = b.clone().sub(a);
  if (x.lengthSq() < 1e-12) return null;
  x.normalize();
  const z = x.clone().cross(c.clone().sub(a));
  if (z.lengthSq() < 1e-10) return null;
  z.normalize();
  const y = z.clone().cross(x);
  return new THREE.Matrix4().makeBasis(x, y, z).setPosition(a);
}

/**
 * Trasformazione che porta i punti src sui punti dst: il primo combacia, il secondo dà la direzione, il terzo (3D)
 * la rotazione attorno a quella direzione. Con scale la distanza tra i primi due punti diventa quella del riferimento.
 * Con meno punti di destinazione (anteprima) solo traslazione, poi direzione. d2: nel piano (rotazione attorno a Z).
 */
function alignMatrix(src, dst, d2, scale) {
  const T = p => new THREE.Matrix4().makeTranslation(p.x, p.y, p.z);
  const [s1, s2, s3] = src, [t1, t2, t3] = dst;
  if (!t2) return T(t1.clone().sub(s1));
  const ds = s2.clone().sub(s1), dt = t2.clone().sub(t1);
  if (ds.lengthSq() < 1e-12 || dt.lengthSq() < 1e-12) return null;
  const k = scale ? dt.length() / ds.length() : 1;
  const S = new THREE.Matrix4().makeScale(k, k, k);
  if (d2) {
    const R = new THREE.Matrix4().makeRotationZ(Math.atan2(dt.y, dt.x) - Math.atan2(ds.y, ds.x));
    return T(t1).multiply(R).multiply(S).multiply(T(s1.clone().negate()));
  }
  const fs = s3 && frame3(s1, s2, s3), ft = t3 && frame3(t1, t2, t3);
  if (fs && ft) return ft.multiply(S).multiply(fs.invert());
  const q = new THREE.Quaternion().setFromUnitVectors(ds.normalize(), dt.normalize());
  return T(t1).multiply(new THREE.Matrix4().makeRotationFromQuaternion(q)).multiply(S).multiply(T(s1.clone().negate()));
}

/**
 * Cosa modificano i comandi, dalla selezione: le entità di uno sketch (quelle selezionate, o tutte con lo sketch
 * selezionato o in modifica) oppure gli elementi 3D. { mode: '2d', planeId, sketchId, ents } | { mode: '3d', items } | { err }
 */
function collectTargets() {
  const empty = t('Lo sketch è vuoto: disegna prima qualche entità');
  if (App.sketch) {
    const r = getSketch(App.sketch.sketchId);
    if (!r) return { err: t('Seleziona prima cosa modificare') };
    const sel = App.selected.filter(s => s.type === 'entity' && s.sketchId === r.sketch.id).map(s => s.id);
    const ents = sel.length ? sel : r.sketch.entities.map(e => e.id);
    return ents.length ? { mode: '2d', planeId: r.plane.id, sketchId: r.sketch.id, ents } : { err: empty };
  }
  const all = resolveAll();
  const flatSel = all.filter(x => x.type === 'entity' || x.type === 'sketch');
  const solid = all.filter(x => MOVABLE.includes(x.type));
  if (flatSel.length) {
    const ids = new Set(flatSel.map(x => (x.type === 'sketch' ? x.item.id : x.sketch.id)));
    if (ids.size > 1 || flatSel.length !== all.length) return { err: t('Seleziona solo entità di uno stesso sketch, oppure solo elementi 3D') };
    const sk = flatSel[0].type === 'sketch' ? flatSel[0].item : flatSel[0].sketch;
    const ents = flatSel.some(x => x.type === 'sketch') ? sk.entities.map(e => e.id) : flatSel.map(x => x.item.id);
    return ents.length ? { mode: '2d', planeId: flatSel[0].plane.id, sketchId: sk.id, ents } : { err: empty };
  }
  if (!solid.length || solid.length !== all.length) {
    return { err: t('Seleziona prima cosa modificare: entità di uno sketch, oppure oggetti, artefatti, piani e origini') };
  }
  return { mode: '3d', items: solid.map(x => ({ type: x.type, id: x.item.id })) };
}

let dotTexture = null;
function dotTex() {
  if (dotTexture) return dotTexture;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  g.beginPath();
  g.arc(32, 32, 26, 0, Math.PI * 2);
  g.fillStyle = '#ffffff';
  g.fill();
  g.lineWidth = 7;
  g.strokeStyle = 'rgba(0,0,0,0.6)';
  g.stroke();
  dotTexture = new THREE.CanvasTexture(c);
  return dotTexture;
}

// ------------------------------------------------------------------ comando in corso
export class ModifyTool {
  constructor({ vp, sync, sketch, sim, cmd }) {
    Object.assign(this, { vp, sync, sketch, sim, cmd });
    this.op = null;            // comando in corso
    this.pm = null;            // App.pickMode del comando (i clic nella vista arrivano qui)
    this.group = new THREE.Group();
    this.group.matrixAutoUpdate = false;
    vp.scene.add(this.group);
    const line = (color, opacity = 1) => new THREE.LineBasicMaterial({ color, depthTest: false, transparent: true, opacity });
    this.mat = {
      ghost: new THREE.MeshBasicMaterial({ color: COL.preview, transparent: true, opacity: 0.22, depthWrite: false }),
      ghostEdge: new THREE.LineBasicMaterial({ color: COL.preview, transparent: true, opacity: 0.85 }),
      preview: line(COL.preview),
      guide: line(COL.cursor, 0.7),
      ref: line(COL.mark),
      target: line(COL.fixed),
      axis: line(COL.axis, 0.9),
    };
    this.panel = h('div', { class: 'overlay xf-bar', role: 'group' });
    this.panel.hidden = true;
    vp.el.append(this.panel);
    this._raf = 0;
    on('project', () => this._onProject());
    // un altro comando ha preso la scelta dei punti: questo si chiude senza toccare il suo suggerimento
    on('gizmo', () => { if (this.op && App.pickMode !== this.pm) this._end(false); });
    on('sketch', () => this.cancel());
    on('tool', () => this.cancel());
    on('mode', () => { if (App.planeMode) this.cancel(); });
  }

  get active() { return !!this.op; }
  get kind() { return this.op?.kind || null; }

  /** Perché il comando non si può avviare (null se si può). */
  why(kind) {
    if (App.planeMode) return t('Concludi o annulla (Esc) prima la creazione del piano');
    if (App.pickMode && App.pickMode !== this.pm) return t('Concludi o annulla (Esc) prima la scelta del punto');
    const tg = collectTargets();
    if (tg.err) return tg.err;
    if (['move', 'rotate', 'scale', 'align'].includes(kind) && tg.mode === '3d' && tg.items.some(x => resolve(x)?.item.locked)) {
      return t('La selezione contiene elementi bloccati: sbloccali (Ctrl+L) per modificarli');
    }
    return null;
  }

  /** Avvia il comando kind sulla selezione (di nuovo lo stesso comando: lo chiude). */
  start(kind) {
    if (this.op?.kind === kind) { this.cancel(); return; }
    if (this.op) this._end();
    const why = this.why(kind);
    if (why) { toast(why, 'warn'); return; }
    if (this.sim.active) this.sim.stop();
    const pref = loadPref();
    const o = {
      kind, ...collectTargets(), pts: {}, src: [], dst: [], cursor: null, edge: null, tedge: null, ref: null, rdir: null, axisDir: null,
      typed: null, shift: false, created: [], info: {}, vals: {},
    };
    this.op = o;
    this._context();
    const v = o.vals, d3 = o.mode === '3d';
    if (kind === 'copy') v.n = 1;
    if (kind === 'rotate') v.axis = (AXIS[pref.axis] || (pref.axis === 'pts' && d3)) ? pref.axis : 'z';
    if (kind === 'arrayPolar') v.axis = AXIS[pref.polarAxis] ? pref.polarAxis : 'z';
    if (kind === 'scale') v.fixed = pref.fixed === 'center' ? 'center' : 'ref';
    if (kind === 'align') v.scale = !!pref.alignScale;
    if (kind === 'arrayRect') {
      // passo proposto: ingombro della selezione più un quarto, arrotondato al decimo
      const size = o.box.isEmpty() ? new THREE.Vector3() : o.box.getSize(new THREE.Vector3());
      const gap = s => (s > 1e-6 ? Math.ceil(s * 12.5) / 10 : 10);
      Object.assign(v, { nx: pref.nx || 3, ny: pref.ny || 1, nz: pref.nz || 1, sx: gap(size.x), sy: gap(size.y), sz: gap(size.z) });
    }
    if (kind === 'arrayPolar') Object.assign(v, { n: pref.n || 6, total: pref.total ?? 360, rot: pref.rot !== false });
    o.step = {
      move: 'base', copy: 'base', rotate: v.axis === 'pts' && d3 ? 'axis1' : 'center', align: 'src', scale: 'ref1',
      arrayRect: 'params', arrayPolar: 'center',
    }[kind];
    this.pm = { kind: 'modify' };
    App.pickMode = this.pm;
    this.vp.transform.detach();
    this.vp.el.classList.add('modifying');
    const hint = document.getElementById('hint');
    this._hint = { hidden: hint.hidden, html: hint.innerHTML };
    hint.hidden = true;
    if (this.sketch.active) this.sketch.onLeave();
    this._buildPanel();
    this.panel.hidden = false;
    emit('gizmo');
    this._render();
    if (kind === 'arrayRect') this.inputs.nx?.focus();
    log.info('Comando di modifica', { kind, mode: o.mode, count: o.mode === '2d' ? o.ents.length : o.items.length });
  }

  /** Esc o Annulla: chiude il comando (le copie già fatte restano). */
  cancel() {
    const o = this.op;
    if (!o) return;
    const made = o.created.length;
    this._end();
    status(made ? t('Copia terminata: {n} copie', { n: made }) : t('Comando annullato'));
  }

  _end(restoreHint = true) {
    if (this._raf) { cancelAnimationFrame(this._raf); this._raf = 0; }
    this.op = null;
    this._clear();
    this.panel.hidden = true;
    this.panel.replaceChildren();
    this.inputs = {};
    this.vp.el.classList.remove('modifying');
    if (App.pickMode === this.pm) App.pickMode = null;
    this.pm = null;
    if (restoreHint && this._hint) {
      const hint = document.getElementById('hint');
      hint.innerHTML = this._hint.html;
      hint.hidden = this._hint.hidden;
    }
    this._hint = null;
    emit('gizmo');
    if (this.sketch.active) this.sketch.redraw();
  }

  /** Riferimenti degli elementi su cui agisce il comando. */
  _refs() {
    const o = this.op;
    return o.mode === '2d' ? o.ents.map(id => ({ type: 'entity', id, sketchId: o.sketchId })) : o.items.map(x => ({ ...x }));
  }

  /** Sistema del piano, ingombro e punti di aggancio (all'avvio e a ogni modifica del progetto). */
  _context() {
    const o = this.op;
    const box = new THREE.Box3();
    if (o.mode === '2d') {
      const pl = getPlane(o.planeId);
      o.frame = planeFrame(pl);
      const sk = getSketch(o.sketchId).sketch;
      for (const e of sk.entities) if (o.ents.includes(e.id)) for (const [x, y] of entityLoop(e)) box.expandByPoint(new THREE.Vector3(x, y, 0));
      // aggancio: origine del piano e punti notevoli delle entità degli sketch del piano
      o.snaps = [[0, 0]];
      o.flat = [];
      for (const s of pl.sketches) {
        if (s.visible === false && s.id !== o.sketchId) continue;
        for (const e of s.entities) { o.snaps.push(...entitySnapPoints(e)); o.flat.push(e); }
      }
    } else {
      for (const x of o.items) {
        const r = resolve(x);
        if (!r) continue;
        if (x.type === 'origin') box.expandByPoint(new THREE.Vector3().fromArray(r.item.position));
        else if (x.type === 'plane') {
          const M = itemMatrix('plane', r.item);
          const s = (r.item.size || 100) / 2;
          for (const [a, b] of [[-s, -s], [s, -s], [s, s], [-s, s]]) box.expandByPoint(new THREE.Vector3(a, b, 0).applyMatrix4(M));
        } else box.union(preciseBox(this.sync.objectFor(x.type, x.id)));
      }
    }
    o.box = box;
    o.center = box.isEmpty() ? new THREE.Vector3() : box.getCenter(new THREE.Vector3());
  }

  _onProject() {
    const o = this.op;
    if (!o) return;
    if (o.mode === '2d') {
      const r = getSketch(o.sketchId);
      o.ents = r ? o.ents.filter(id => r.sketch.entities.some(e => e.id === id)) : [];
      if (!o.ents.length) { this._end(); status(t('Comando annullato: gli elementi da modificare non ci sono più')); return; }
    } else {
      o.items = o.items.filter(x => resolve(x));
      if (!o.items.length) { this._end(); status(t('Comando annullato: gli elementi da modificare non ci sono più')); return; }
    }
    // la scena si aggiorna dopo questo evento: ingombri e anteprima si ricalcolano sulla scena aggiornata
    queueMicrotask(() => {
      if (this.op !== o) return;
      this.sync.sync();
      this._context();
      this._render();
    });
  }

  // ---------------------------------------------------------------- pannello
  _fields() {
    const o = this.op, d2 = o.mode === '2d';
    const A = d2 ? ['U', 'V'] : ['X', 'Y', 'Z'];
    const num = (key, label, unit, extra = {}) => ({ key, label, unit, ...extra });
    const axes = [['z', 'Z'], ['x', 'X'], ['y', 'Y']];
    switch (o.kind) {
      case 'move':
      case 'copy':
        return [
          [num('dist', t('Distanza'), 'mm')],
          A.map((a, i) => num(DELTA[i], `Δ${a}`, 'mm')),
          [{ head: t('Arrivo') }, ...A.map((a, i) => num(ABS[i], a, 'mm'))],
          o.kind === 'copy' ? [num('n', t('Copie in fila'), '', { int: true, min: 1 })] : [],
        ];
      case 'rotate':
        return [
          [num('angle', t('Angolo'), '°')],
          [{ key: 'cur', text: true, label: t('Riferimento') }, num('dir', t('Direzione finale'), '°')],
          d2 ? [] : [{ key: 'axis', label: t('Asse'), seg: [...axes, ['pts', t('2 punti')]] }],
        ];
      case 'align':
        return [[{ key: 'scale', check: t('Scala: fai combaciare anche i secondi punti') }]];
      case 'scale':
        return [
          [{ key: 'ref', text: true, label: t('Riferimento') }, num('len', t('Nuova misura'), 'mm'), num('factor', t('Fattore'), '×')],
          [{ key: 'fixed', label: t('Punto fisso'), seg: [['ref', t('Inizio del riferimento')], ['center', t('Centro della selezione')]] }],
        ];
      case 'arrayRect':
        return [
          [num('nx', t('Colonne'), '', { int: true, min: 1 }), num('sx', t('passo {a}', { a: A[0] }), 'mm')],
          [num('ny', t('Righe'), '', { int: true, min: 1 }), num('sy', t('passo {a}', { a: A[1] }), 'mm')],
          d2 ? [] : [num('nz', t('Livelli'), '', { int: true, min: 1 }), num('sz', t('passo {a}', { a: 'Z' }), 'mm')],
        ];
      case 'arrayPolar':
        return [
          [num('n', t('Elementi'), '', { int: true, min: 2 }), num('total', t('Angolo totale'), '°')],
          [{ head: t('Centro') }, ...A.map((a, i) => num(CTR[i], a, 'mm'))],
          [{ key: 'rot', check: t('Ruota le copie') }],
          d2 ? [] : [{ key: 'axis', label: t('Asse'), seg: axes }],
        ];
    }
    return [];
  }

  _buildPanel() {
    const o = this.op;
    const [, label, icon] = MODIFY_COMMANDS.find(c => c[0] === o.kind);
    this.inputs = {};
    this.segs = {};
    this.stepEl = h('div', { class: 'xf-step', 'aria-live': 'polite' });
    const what = o.mode === '2d'
      ? t('{n} entità di "{sketch}"', { n: o.ents.length, sketch: getSketch(o.sketchId).sketch.name })
      : o.items.length === 1 ? `"${resolve(o.items[0]).item.name}"` : t('{n} elementi', { n: o.items.length });
    const groups = this._fields().filter(g => g.length).map(g => h('div', { class: 'xf-grp' }, g.map(f => this._field(f))));
    this.applyBtn = h('button', { type: 'button', class: 'primary', onclick: () => this.applyNow() }, o.kind === 'copy' ? t('Copia') : t('Applica'));
    const btns = h('div', { class: 'xf-btns' },
      o.kind === 'scale' ? h('button', { type: 'button', title: t('Indica un altro riferimento'), onclick: () => this.back(true) }, t('Altro riferimento')) : null,
      h('button', { type: 'button', onclick: () => this.cancel() }, o.kind === 'copy' ? t('Fine') : t('Annulla')),
      this.applyBtn);
    this.panel.setAttribute('aria-label', t(label));
    this.panel.replaceChildren(
      h('div', { class: 'xf-head' }, h('span', { class: 'xf-ico', html: TB[icon] || '' }), h('b', {}, t(label)), h('span', { class: 'xf-what' }, what)),
      this.stepEl,
      h('div', { class: 'xf-row' }, groups, btns));
  }

  _field(f) {
    const o = this.op;
    if (f.head) return h('span', { class: 'xf-gh' }, f.head);
    if (f.seg) {
      const el = h('span', { class: 'xf-seg', role: 'radiogroup', 'aria-label': f.label });
      const set = val => { for (const b of el.children) b.setAttribute('aria-checked', String(b.dataset.v === val)); };
      for (const [val, lab] of f.seg) {
        el.append(h('button', { type: 'button', role: 'radio', 'data-v': val, onclick: () => {
          if (o.vals[f.key] === val) return;
          o.vals[f.key] = val;
          set(val);
          this._seg(f.key, val);
          this._prefs();
          this._render();
        } }, lab));
      }
      set(o.vals[f.key]);
      return h('span', { class: 'xf-f' }, h('span', { class: 'xf-l' }, f.label), el);
    }
    if (f.check) {
      const box = h('input', { type: 'checkbox' });
      box.checked = !!o.vals[f.key];
      box.addEventListener('change', () => { o.vals[f.key] = box.checked; this._prefs(); this._render(); });
      return h('label', { class: 'xf-f xf-check' }, box, f.check);
    }
    if (f.text) {
      const out = h('span', { class: 'xf-out mono' }, '–');
      this.inputs[f.key] = out;
      return h('span', { class: 'xf-f' }, h('span', { class: 'xf-l' }, f.label), out);
    }
    const inp = h('input', { class: 'num', inputmode: 'decimal', autocomplete: 'off', spellcheck: 'false', 'aria-label': f.label, placeholder: f.int ? '' : '0' });
    if (o.vals[f.key] != null) inp.value = fmt(o.vals[f.key], 4);
    inp.addEventListener('input', () => this._typed(f, inp));
    inp.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); this.applyNow(); } else if (e.key === 'Escape') { e.preventDefault(); inp.blur(); this.cancel(); }
    });
    this.inputs[f.key] = inp;
    return h('label', { class: 'xf-f' }, h('span', { class: 'xf-l' }, f.label), inp, f.unit ? h('span', { class: 'xf-u' }, f.unit) : null);
  }

  /** Scelta in un gruppo di pulsanti: l'asse di Ruota ricomincia dai punti da indicare. */
  _seg(key, val) {
    const o = this.op;
    if (o.kind !== 'rotate' || key !== 'axis') return;
    delete o.pts.center;
    delete o.pts.axis2;
    o.axisDir = o.rdir = o.edge = o.tedge = null;
    if (o.typed === 'dir') o.typed = null;
    o.step = val === 'pts' ? 'axis1' : 'center';
  }

  /** Valore scritto in un campo: comanda lui (finché il campo non si svuota) al posto di quello indicato col mouse. */
  _typed(f, inp) {
    const o = this.op;
    const s = inp.value.trim();
    let v = s === '' ? null : evalNum(s);
    if (v != null && Number.isFinite(v) && f.int) v = Math.round(v);
    const bad = v != null && (!Number.isFinite(v) || (f.min != null && v < f.min));
    inp.classList.toggle('bad', bad);
    if (bad) return;
    o.vals[f.key] = v;
    const src = TYPED[f.key];
    if (src && v == null && o.typed === src && src !== 'center') o.typed = null;
    else if (src && v != null) {
      // si comincia a scrivere un vettore: le altre componenti partono da "nessuno spostamento" (o dal centro attuale)
      const group = { delta: DELTA, abs: ABS, center: CTR }[src];
      if (group && o.typed !== src) {
        const from = src === 'delta' ? new THREE.Vector3() : src === 'abs' ? o.pts.base || o.center : o.pts.center || new THREE.Vector3();
        group.forEach((q, i) => {
          if (q === f.key || !this.inputs[q]) return;
          o.vals[q] = r4(from.getComponent(i));
          this.inputs[q].value = fmt(o.vals[q], 4);
          this.inputs[q].classList.remove('bad');
        });
      }
      o.typed = src;
    }
    if (src === 'center') {
      // centro della serie polare scritto: vale come cliccato
      o.pts.center = new THREE.Vector3(o.vals.cx || 0, o.vals.cy || 0, o.mode === '2d' ? 0 : o.vals.cz || 0);
      o.step = 'params';
    }
    this._prefs();
    this._render();
  }

  /** Valore calcolato mostrato in un campo (non in quello in cui si sta scrivendo). */
  _show(key, value, digits = 3) {
    const el = this.inputs?.[key];
    if (!el) return;
    const text = typeof value === 'string' ? value : fmt(value, digits);
    if (el.tagName !== 'INPUT') { el.textContent = text; return; }
    if (document.activeElement === el || el.value === text) return;
    el.value = text;
    el.classList.remove('bad');
  }

  _prefs() {
    const { kind, vals: v } = this.op;
    const p = loadPref();
    if (kind === 'arrayRect') Object.assign(p, { nx: v.nx, ny: v.ny, nz: v.nz });
    if (kind === 'arrayPolar') Object.assign(p, { n: v.n, total: v.total, rot: v.rot, polarAxis: v.axis });
    if (kind === 'rotate') p.axis = v.axis;
    if (kind === 'scale') p.fixed = v.fixed;
    if (kind === 'align') p.alignScale = !!v.scale;
    savePref(p);
  }

  _stepText() {
    const o = this.op;
    const end = o.kind === 'copy' ? t('<b>Esc</b> termina') : t('<b>Esc</b> annulla');
    if (o.kind === 'align') {
      const n = o.mode === '2d' ? 2 : 3;
      const txt = o.src.length < n
        ? t('Clic sul <b>punto {i} di {n}</b> del <b>pezzo da spostare</b>', { i: o.src.length + 1, n })
        : t('Clic sul <b>punto {i} di {n}</b> del <b>riferimento</b>, corrispondente a quello del pezzo', { i: o.dst.length + 1, n });
      return `${txt} · ${t('<b>Backspace</b> toglie l\'ultimo')} · ${end}`;
    }
    const S = {
      move: {
        base: 'Clic sul <b>punto base</b>, oppure scrivi lo spostamento o il punto di arrivo e premi <b>Invio</b>',
        dest: 'Clic sul <b>punto di arrivo</b>, oppure scrivi la distanza (nella direzione del cursore) o le coordinate di arrivo · <b>Maiusc</b> lungo un asse',
      },
      copy: {
        base: 'Clic sul <b>punto base</b>, oppure scrivi lo spostamento o il punto di arrivo e premi <b>Invio</b>',
        dest: 'Clic dove mettere la <b>copia</b>, anche più volte, oppure scrivi la distanza o le coordinate di arrivo · <b>Maiusc</b> lungo un asse',
      },
      rotate: {
        center: 'Clic sul <b>centro di rotazione</b>, oppure scrivi l\'angolo e premi <b>Invio</b> (centro della selezione)',
        axis1: 'Clic sul <b>primo punto dell\'asse</b> di rotazione',
        axis2: 'Clic sul <b>secondo punto dell\'asse</b>: il verso va dal primo al secondo',
        ref: 'Clic sul punto che indica la <b>direzione di partenza</b> o su un <b>bordo</b> da allineare, oppure scrivi l\'angolo',
        target: 'Clic sulla <b>nuova direzione</b> o su un <b>bordo</b> a cui renderlo parallelo, oppure scrivi l\'angolo o la direzione finale · <b>Maiusc</b> a passi di 15°',
      },
      scale: {
        ref1: 'Clic su un <b>segmento</b> o un <b>bordo</b>, oppure sul <b>primo punto</b> del riferimento',
        ref2: 'Clic sul <b>secondo punto</b> del riferimento',
        value: 'Scrivi la <b>misura finale</b> del riferimento e premi <b>Invio</b>: il fattore di scala si calcola da solo',
      },
      arrayRect: { params: 'Imposta <b>numero</b> e <b>passo</b> delle copie, con l\'anteprima nella vista · <b>Invio</b> applica' },
      arrayPolar: {
        center: 'Clic sul <b>centro</b> della serie, oppure scrivine le coordinate',
        params: 'Imposta il <b>numero</b> di elementi e l\'<b>angolo totale</b> · <b>Invio</b> applica · clic per un altro centro',
      },
    };
    return `${t(S[o.kind][o.step])} · ${end}`;
  }

  /** Cosa manca per applicare il comando. */
  _needs() {
    const o = this.op;
    switch (o.kind) {
      case 'move': case 'copy': return t('Indica il punto base e il punto di arrivo, oppure scrivi lo spostamento o le coordinate di arrivo');
      case 'rotate':
        return o.mode === '3d' && o.vals.axis === 'pts' && !o.axisDir
          ? t('Indica i due punti dell\'asse di rotazione') : t('Indica le due direzioni nella vista, oppure scrivi l\'angolo');
      case 'align': return t('Indica {n} punti sul pezzo da spostare e {n} sul riferimento', { n: o.mode === '2d' ? 2 : 3 });
      case 'scale': return o.ref ? t('Scrivi la nuova misura del riferimento (o il fattore di scala)') : t('Indica il riferimento (due punti, un segmento o un bordo), oppure scrivi il fattore di scala');
      case 'arrayRect': return t('La serie deve avere almeno due elementi: aumenta colonne, righe o livelli');
      case 'arrayPolar': return o.pts.center ? t('Controlla il numero di elementi e l\'angolo totale') : t('Clic sul centro della serie, oppure scrivine le coordinate');
    }
    return '';
  }

  // ---------------------------------------------------------------- calcolo
  /** Asse di rotazione nel sistema di lavoro (null se va ancora indicato con due punti). */
  _axis() {
    const o = this.op;
    if (o.mode === '2d') return AXIS.z;
    if (o.kind === 'rotate' && o.vals.axis === 'pts') return o.axisDir;
    return AXIS[o.vals.axis] || AXIS.z;
  }

  /** Trasformazioni da applicare (nel sistema del piano per le entità, nel mondo per il 3D); aggiorna i campi calcolati. */
  _compute() {
    const o = this.op, v = o.vals, d2 = o.mode === '2d';
    const T = p => new THREE.Matrix4().makeTranslation(p.x, p.y, p.z);
    const about = (c, M) => T(c).multiply(M).multiply(T(c.clone().negate()));
    const vec = (keys, from) => new THREE.Vector3(...keys.map((q, i) => (d2 && i === 2 ? 0 : v[q] ?? from.getComponent(i))));
    o.info = {};
    switch (o.kind) {
      case 'move':
      case 'copy': {
        const base = o.pts.base || o.center;
        let d = null;
        if (o.typed === 'delta') d = vec(DELTA, new THREE.Vector3());
        else if (o.typed === 'abs') d = vec(ABS, base).sub(base);
        else if (o.pts.base && o.cursor) {
          d = o.cursor.p.clone().sub(o.pts.base);
          if (o.shift) d = axisLock(d);
          if (o.typed === 'dist' && v.dist != null) d = d.lengthSq() > 1e-12 ? d.setLength(v.dist) : null;
        }
        if (d) {
          if (o.typed !== 'delta') DELTA.forEach((q, i) => this._show(q, d.getComponent(i)));
          if (o.typed !== 'abs') ABS.forEach((q, i) => this._show(q, base.getComponent(i) + d.getComponent(i)));
          if (o.typed !== 'dist') this._show('dist', d.length());
        }
        if (!d || d.lengthSq() < 1e-12) return [];
        o.info.d = d;
        const n = o.kind === 'copy' ? Math.max(1, v.n || 1) : 1;
        return Array.from({ length: n }, (_, i) => T(d.clone().multiplyScalar(i + 1)));
      }
      case 'rotate': {
        const axis = this._axis();
        const c = o.pts.center || (axis && !(o.mode === '3d' && v.axis === 'pts') ? o.center : null);
        const line = !!(o.rdir?.line || o.tedge);
        const cur = axis && o.rdir ? absAngle(axis, o.rdir.dir) : null;
        this._show('cur', cur == null ? '–' : `${fmt(wrapAngle(cur, o.rdir.line), 2)}°`);
        if (this.inputs.dir) this.inputs.dir.disabled = cur == null;
        if (!axis || !c) return [];
        let a = null;
        if (o.typed === 'angle') a = v.angle;
        else if (o.typed === 'dir' && cur != null && v.dir != null) a = wrapAngle(v.dir - cur, o.rdir.line);
        else if (o.rdir && o.step === 'target' && (o.tedge || o.cursor)) {
          const to = o.tedge ? o.tedge.b.clone().sub(o.tedge.a) : o.cursor.p.clone().sub(c);
          a = angleAbout(axis, o.rdir.dir, to);
          if (a != null && line) a = wrapAngle(a, true);
          // Maiusc: la direzione finale a multipli di 15°
          if (a != null && o.shift && cur != null) a = wrapAngle(Math.round((cur + a) / 15) * 15 - cur, line);
        }
        if (a != null && o.typed !== 'angle') this._show('angle', a);
        if (a != null && cur != null && o.typed !== 'dir') this._show('dir', wrapAngle(cur + a, o.rdir.line));
        if (a == null || Math.abs(a) < 1e-9) return [];
        o.info.a = a;
        o.info.c = c;
        return [about(c, new THREE.Matrix4().makeRotationAxis(axis, a * D2R))];
      }
      case 'align': {
        const n = d2 ? 2 : 3;
        if (o.src.length < n) return [];
        const dst = [...o.dst];
        if (dst.length < n && o.cursor) dst.push(o.cursor.p);   // anteprima con il punto sotto il cursore
        if (!dst.length) return [];
        const M = alignMatrix(o.src, dst, d2, v.scale);
        if (!M) return [];
        o.info.k = v.scale && dst.length > 1 ? dst[1].distanceTo(dst[0]) / o.src[1].distanceTo(o.src[0]) : 1;
        return [M];
      }
      case 'scale': {
        const ref = o.ref?.len;
        this._show('ref', ref ? `${fmt(ref, 3)} mm${o.ref.circle ? ` (${t('diametro')})` : ''}` : '–');
        let k = null;
        if (o.typed === 'factor') {
          k = v.factor;
          if (ref && k > 0) this._show('len', ref * k);
        } else if (o.typed === 'len' && ref) {
          k = v.len / ref;
          if (k > 0) this._show('factor', k, 6);
        }
        if (!(k > 0) || Math.abs(k - 1) < 1e-12) return [];
        o.info.k = k;
        o.info.fixed = v.fixed === 'center' || !o.ref ? o.center : o.ref.a;
        return [about(o.info.fixed, new THREE.Matrix4().makeScale(k, k, k))];
      }
      case 'arrayRect': {
        const nx = v.nx || 1, ny = v.ny || 1, nz = d2 ? 1 : v.nz || 1;
        const out = [];
        for (let l = 0; l < nz; l++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
          if (i || j || l) out.push(T(new THREE.Vector3(i * (v.sx || 0), j * (v.sy || 0), l * (v.sz || 0))));
          if (out.length > MAX_NEW) return out;
        }
        return out;
      }
      case 'arrayPolar': {
        const c = o.pts.center;
        if (c && o.typed !== 'center') CTR.forEach((q, i) => this._show(q, c.getComponent(i)));
        const n = Math.max(2, v.n || 2), tot = v.total ?? 360;
        if (!c || Math.abs(tot) < 1e-9) return [];
        const axis = this._axis();
        // giro completo: l'ultimo elemento non si sovrappone al primo
        const step = Math.abs(Math.abs(tot) - 360) < 1e-9 ? tot / n : tot / (n - 1);
        const out = [];
        for (let i = 1; i < n && out.length <= MAX_NEW; i++) {
          const R = about(c, new THREE.Matrix4().makeRotationAxis(axis, step * i * D2R));
          // senza rotazione le copie si spostano soltanto: il centro della selezione segue il cerchio
          out.push(v.rot !== false ? R : T(o.center.clone().applyMatrix4(R).sub(o.center)));
        }
        return out;
      }
    }
    return [];
  }

  /** Applica il comando con i valori correnti (Invio, Applica, clic sull'ultimo punto). */
  applyNow() {
    const o = this.op;
    if (!o) return;
    if (o.kind === 'align' && o.dst.length < (o.mode === '2d' ? 2 : 3)) { toast(this._needs(), 'warn', 2800); return; }
    const Ms = this._compute();
    if (!Ms.length) { toast(this._needs(), 'warn', 2800); return; }
    const copies = ['copy', 'arrayRect', 'arrayPolar'].includes(o.kind);
    const count = (o.mode === '2d' ? o.ents.length : o.items.length) * Ms.length;
    if (copies && count > MAX_NEW) { toast(t('Troppe copie ({n}): al massimo {max} per volta', { n: count, max: MAX_NEW }), 'warn'); return; }
    const created = [];
    mutate(p => {
      if (o.mode === '2d') {
        const sk = getSketch(o.sketchId)?.sketch;
        if (!sk) return;
        for (const id of o.ents) {
          const e = sk.entities.find(x => x.id === id);
          if (!e) continue;
          if (!copies) { xfEntity(e, Ms[0]); continue; }
          for (const M of Ms) {
            const c = xfEntity(structuredClone(e), M);
            c.id = uid('e');
            sk.entities.push(c);
            created.push({ type: 'entity', id: c.id, sketchId: sk.id });
          }
        }
        return;
      }
      for (const x of o.items) {
        const r = resolve(x);
        if (!r) continue;
        if (!copies) { xfItem(x.type, r.item, Ms[0]); continue; }
        Ms.forEach((M, i) => {
          const name = o.kind === 'copy' ? `${r.item.name} (${t('copia')})` : `${r.item.name} (${i + 2})`;
          const c = cloneItem(p, x.type, r.item, name);
          xfItem(x.type, c, M);
          created.push({ type: x.type, id: c.id });
        });
      }
    });
    const info = o.info;
    log.info('Modifica applicata', { kind: o.kind, mode: o.mode, transforms: Ms.length, created: created.length });
    if (o.kind === 'copy') {
      // si continua a copiare dallo stesso punto base: le copie fatte restano selezionate
      o.created.push(...created);
      selectMany(o.created);
      o.typed = null;
      for (const q of ['dist', ...DELTA, ...ABS]) { delete o.vals[q]; if (this.inputs[q]) this.inputs[q].value = ''; }
      status(t('{n} copie create: clic per altre copie, Esc per finire (Ctrl+Z annulla)', { n: o.created.length }));
      this._render();
      return;
    }
    const msg = {
      move: () => t('Spostamento di {d} mm applicato (Ctrl+Z annulla)', { d: [info.d.x, info.d.y, ...(o.mode === '2d' ? [] : [info.d.z])].map(x => fmt(x, 3)).join('; ') }),
      rotate: () => t('Rotazione di {a}° applicata (Ctrl+Z annulla)', { a: fmt(info.a, 3) }),
      align: () => (Math.abs(info.k - 1) > 1e-9 ? t('Allineamento applicato, scala ×{k} (Ctrl+Z annulla)', { k: fmt(info.k, 6) }) : t('Allineamento applicato (Ctrl+Z annulla)')),
      scale: () => t('Scala ×{k} applicata (Ctrl+Z annulla)', { k: fmt(info.k, 6) }),
      arrayRect: () => t('Serie rettangolare: {n} copie create (Ctrl+Z annulla)', { n: created.length }),
      arrayPolar: () => t('Serie polare: {n} copie create (Ctrl+Z annulla)', { n: created.length }),
    }[o.kind]();
    const refs = this._refs();
    this._end();
    if (copies) selectMany([...refs, ...created]);
    status(msg);
  }

  /** Torna al passo precedente (Backspace); toRef: nuovo riferimento della scala. */
  back(toRef = false) {
    const o = this.op;
    if (!o) return;
    switch (o.kind) {
      case 'move':
      case 'copy':
        if (o.step === 'dest') { delete o.pts.base; o.step = 'base'; }
        break;
      case 'rotate':
        if (o.step === 'target') { o.rdir = o.tedge = null; o.step = 'ref'; } else if (o.step === 'ref') {
          if (o.mode === '3d' && o.vals.axis === 'pts') { delete o.pts.axis2; o.axisDir = null; o.step = 'axis2'; } else { delete o.pts.center; o.step = 'center'; }
        } else if (o.step === 'axis2') { delete o.pts.center; o.step = 'axis1'; }
        if (o.typed === 'dir' && !o.rdir) o.typed = null;
        break;
      case 'align':
        if (o.dst.length) o.dst.pop(); else o.src.pop();
        o.step = o.src.length < (o.mode === '2d' ? 2 : 3) ? 'src' : 'dst';
        break;
      case 'scale':
        if (toRef || o.step !== 'ref1') { o.ref = null; delete o.pts.r1; o.step = 'ref1'; }
        break;
      case 'arrayPolar':
        if (o.step === 'params') {
          delete o.pts.center;
          o.step = 'center';
          if (o.typed === 'center') { o.typed = null; for (const q of CTR) { delete o.vals[q]; if (this.inputs[q]) this.inputs[q].value = ''; } }
        }
        break;
    }
    this._render();
  }

  // ---------------------------------------------------------------- mouse
  move(ev) {
    if (!this.op) return;
    this._ev = ev;
    if (this._raf) return;
    // al massimo un aggiornamento per fotogramma
    this._raf = requestAnimationFrame(() => {
      this._raf = 0;
      const o = this.op;
      if (!o || !this._ev) return;
      const e = this._ev;
      o.shift = e.shiftKey;
      o.cursor = this._pick(e);
      this._hoverEdges(e);
      this._coords(o.cursor);
      this._render();
    });
  }

  /** Segmenti e bordi sotto il puntatore: riferimento della scala, direzione di partenza e di arrivo della rotazione. */
  _hoverEdges(ev) {
    const o = this.op;
    o.edge = o.kind === 'scale' && o.step === 'ref1' ? this._edgeAt(ev, o.cursor, true)
      : o.kind === 'rotate' && o.step === 'ref' ? this._edgeAt(ev, o.cursor, false) : null;
    o.tedge = o.kind === 'rotate' && o.step === 'target' ? this._edgeAt(ev, o.cursor, false) : null;
    // un bordo parallelo all'asse non dà una direzione nella rotazione
    const axis = o.kind === 'rotate' ? this._axis() : null;
    if (axis && o.tedge && flat(o.tedge.b.clone().sub(o.tedge.a), axis).lengthSq() < 1e-10) o.tedge = null;
  }

  leave() {
    if (!this.op) return;
    this.op.cursor = null;
    this.op.edge = this.op.tedge = null;
    this._render();
  }

  click(ev) {
    const o = this.op;
    if (!o || ev.button !== 0) return;
    o.shift = ev.shiftKey;
    const r = this._pick(ev);
    o.cursor = r;
    if (!r) { toast(t('Nessun punto sotto il cursore'), 'warn', 1800); return; }
    const p = r.p.clone();
    switch (o.kind) {
      case 'move':
      case 'copy':
        if (o.step === 'base') {
          o.pts.base = p;
          o.step = 'dest';
          if (o.typed === 'delta') o.typed = null;
        } else {
          o.typed = null;   // il punto cliccato è l'arrivo
          this.applyNow();
          return;
        }
        break;
      case 'rotate':
        if (!this._rotateClick(ev, r, p)) return;
        break;
      case 'align': {
        const n = o.mode === '2d' ? 2 : 3;
        const list = o.src.length < n ? o.src : o.dst;
        if (list.some(q => q.distanceTo(p) < 1e-6)) { toast(t('Il punto coincide con uno già indicato: scegline un altro'), 'warn'); return; }
        if (list.length === 2 && !frame3(list[0], list[1], p)) { toast(t('Il terzo punto è allineato con i primi due: scegline un altro'), 'warn'); return; }
        list.push(p);
        o.step = o.src.length < n ? 'src' : 'dst';
        if (o.dst.length === n) { this.applyNow(); return; }
        break;
      }
      case 'scale':
        if (o.step === 'ref1') {
          const edge = this._edgeAt(ev, r, true);
          if (edge) { o.ref = edge; this._toValue(); } else { o.pts.r1 = p; o.step = 'ref2'; }
        } else if (o.step === 'ref2') {
          const len = p.distanceTo(o.pts.r1);
          if (len < 1e-6) { toast(t('I due punti coincidono: scegline un altro'), 'warn'); return; }
          o.ref = { a: o.pts.r1.clone(), b: p, len };
          delete o.pts.r1;
          this._toValue();
        } else status(t('Scrivi la nuova misura e premi Invio, oppure "Altro riferimento"'));
        break;
      case 'arrayPolar':
        o.pts.center = p;
        o.step = 'params';
        if (o.typed === 'center') o.typed = null;
        break;
      case 'arrayRect':
        status(t('Imposta numero e passo delle copie nel pannello, poi Invio'));
        break;
    }
    this._render();
  }

  /** Clic durante Ruota: asse, centro, direzione di partenza (punto o bordo), nuova direzione. false se fermato. */
  _rotateClick(ev, r, p) {
    const o = this.op;
    if (o.step === 'axis1') { o.pts.center = p; o.step = 'axis2'; return true; }
    if (o.step === 'axis2') {
      const d = p.clone().sub(o.pts.center);
      if (d.length() < 1e-6) { toast(t('I due punti coincidono: scegline un altro'), 'warn'); return false; }
      o.pts.axis2 = p;
      o.axisDir = d.normalize();
      o.step = 'ref';
      return true;
    }
    if (o.step === 'center') { o.pts.center = p; o.step = 'ref'; return true; }
    const axis = this._axis(), c = o.pts.center;
    if (o.step === 'ref') {
      const edge = this._edgeAt(ev, r, false);
      const rd = edge ? { dir: edge.b.clone().sub(edge.a), line: true, a: edge.a, b: edge.b } : { dir: p.clone().sub(c), line: false, a: c.clone(), b: p };
      if (flat(rd.dir, axis).lengthSq() < 1e-10) {
        toast(edge ? t('Il bordo è parallelo all\'asse di rotazione: scegline un altro') : t('Il punto è sull\'asse di rotazione: scegline un altro'), 'warn');
        return false;
      }
      o.rdir = rd;
      o.step = 'target';
      return true;
    }
    // nuova direzione: punto o bordo cliccato
    if (o.typed === 'angle' || o.typed === 'dir') o.typed = null;
    this._hoverEdges(ev);
    this.applyNow();
    return false;
  }

  /** Riferimento della scala scelto: si scrive la nuova misura (il campo propone quella attuale). */
  _toValue() {
    const o = this.op;
    o.step = 'value';
    const inp = this.inputs.len;
    if (!inp) return;
    if (o.typed !== 'len') {
      inp.value = fmt(o.typed === 'factor' && o.vals.factor > 0 ? o.ref.len * o.vals.factor : o.ref.len, 4);
      inp.classList.remove('bad');
    }
    inp.focus();
    inp.select();
  }

  /** Punto sotto il puntatore, con aggancio: { p (sistema di lavoro), snapped, grid, px, hit, raw }. */
  _pick(ev) {
    const o = this.op;
    const picked = [...Object.values(o.pts), ...o.src, ...o.dst].filter(Boolean);
    if (o.mode === '2d') {
      const wp = this.vp.rayPlane(ev, o.frame);
      if (!wp) return null;
      const l = toLocal(o.frame, wp);
      const px = this.vp.pixelSize(wp);
      const raw = new THREE.Vector3(l.x, l.y, 0);
      let best = null, bd = px * 9;
      for (const c of [...o.snaps, ...picked.map(q => [q.x, q.y])]) {
        const d = Math.hypot(c[0] - l.x, c[1] - l.y);
        if (d < bd) { bd = d; best = c; }
      }
      if (best) return { p: new THREE.Vector3(best[0], best[1], 0), snapped: true, px, raw };
      if (this.sketch.snapBox?.checked) {
        const st = Math.max(0.001, evalNum(this.sketch.stepBox.value) || 1);
        return { p: new THREE.Vector3(Math.round(l.x / st) * st, Math.round(l.y / st) * st, 0), grid: true, px, raw };
      }
      return { p: raw.clone(), px, raw };
    }
    const r = this.cmd.snapPoint(ev);
    if (r) return { p: r.point.clone(), snapped: r.snapped, hit: r.hit, px: this.vp.pixelSize(r.point) };
    // fuori dai solidi: piano orizzontale alla quota dell'ultimo punto (per Ruota e Serie polare: perpendicolare all'asse)
    const axis = (o.kind === 'rotate' || o.kind === 'arrayPolar') && o.pts.center && o.step !== 'axis2' ? this._axis() : null;
    const anchor = picked[picked.length - 1] || new THREE.Vector3(o.center.x, o.center.y, o.box.isEmpty() ? 0 : o.box.min.z);
    let n = axis || AXIS.z;
    const dir = this.vp.camera.getWorldDirection(new THREE.Vector3());
    if (Math.abs(dir.dot(n)) < 0.15) n = dir.negate();
    const p = this.vp.rayPlane(ev, { o: o.pts.center && axis ? o.pts.center : anchor, n });
    return p ? { p, px: this.vp.pixelSize(p) } : null;
  }

  /**
   * Segmento o bordo sotto il puntatore: { a, b, len, circle }. a è l'estremo più vicino al clic; di un cerchio
   * dello sketch (solo con circles, per la scala) si prende il diametro, con il centro come a.
   */
  _edgeAt(ev, r, circles) {
    const o = this.op;
    if (!r || r.snapped) return null;
    if (o.mode === '2d') {
      const q = r.raw;
      let best = null, bd = r.px * EDGE_PX;
      for (const e of o.flat) {
        if (e.kind === 'circle') {
          if (!circles) continue;
          const d = Math.abs(Math.hypot(q.x - e.cx, q.y - e.cy) - e.r);
          if (d < bd) { bd = d; best = { a: new THREE.Vector3(e.cx, e.cy, 0), b: new THREE.Vector3(e.cx + e.r, e.cy, 0), len: 2 * e.r, circle: true }; }
          continue;
        }
        const loop = entityLoop(e);
        for (let i = 0; i < loop.length; i++) {
          const a = loop[i], b = loop[(i + 1) % loop.length];
          const d = distPointSeg(q.x, q.y, a[0], a[1], b[0], b[1]);
          if (d >= bd) continue;
          const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
          if (len < 1e-6) continue;
          bd = d;
          const [s, f] = Math.hypot(q.x - a[0], q.y - a[1]) <= Math.hypot(q.x - b[0], q.y - b[1]) ? [a, b] : [b, a];
          best = { a: new THREE.Vector3(s[0], s[1], 0), b: new THREE.Vector3(f[0], f[1], 0), len };
        }
      }
      return best;
    }
    // 3D: spigoli del solido sotto il puntatore, misurati sullo schermo
    const obj = r.hit?.object;
    const ls = obj?.children.find(c => c.isLineSegments);
    const pos = ls?.geometry.attributes.position;
    if (!pos) return null;
    obj.updateMatrixWorld(true);
    const cam = this.vp.camera, w = this.vp.el.clientWidth, hh = this.vp.el.clientHeight;
    const m = this.vp.pointer(ev);
    const a = new THREE.Vector3(), b = new THREE.Vector3(), sa = new THREE.Vector3(), sb = new THREE.Vector3();
    const screen = (p, out) => {
      out.copy(p).project(cam);
      if (out.z > 1 || out.z < -1) return false;
      out.set((out.x + 1) / 2 * w, (1 - out.y) / 2 * hh, 0);
      return true;
    };
    let best = null, bd = EDGE_PX;
    for (let i = 0; i + 1 < pos.count; i += 2) {
      a.fromBufferAttribute(pos, i).applyMatrix4(ls.matrixWorld);
      b.fromBufferAttribute(pos, i + 1).applyMatrix4(ls.matrixWorld);
      if (!screen(a, sa) || !screen(b, sb)) continue;
      const d = distPointSeg(m.x, m.y, sa.x, sa.y, sb.x, sb.y);
      if (d >= bd || a.distanceTo(b) < 1e-6) continue;
      bd = d;
      const near = Math.hypot(m.x - sa.x, m.y - sa.y) <= Math.hypot(m.x - sb.x, m.y - sb.y);
      best = { a: (near ? a : b).clone(), b: (near ? b : a).clone() };
    }
    if (best) best.len = best.a.distanceTo(best.b);
    return best;
  }

  _coords(r) {
    if (!r) return;
    const el = document.getElementById('st-coords');
    const s = r.snapped ? `  [${t('vertice')}]` : r.grid ? `  [${t('griglia')}]` : '';
    el.textContent = this.op.mode === '2d'
      ? `U ${fmt(r.p.x, 3)}  V ${fmt(r.p.y, 3)}${s}`
      : `X ${fmt(r.p.x, 3)}  Y ${fmt(r.p.y, 3)}  Z ${fmt(r.p.z, 3)}${s}`;
  }

  // ---------------------------------------------------------------- anteprima
  _clear() {
    for (const c of [...this.group.children]) {
      c.removeFromParent();
      // le anteprime dei solidi usano la geometria della scena: si liberano solo geometrie e materiali propri
      c.traverse(x => {
        if (x.userData.own) x.geometry?.dispose();
        if (x.userData.ownMat) x.material?.dispose();
      });
    }
  }

  _render() {
    this._clear();
    const o = this.op;
    if (!o) return;
    const d2 = o.mode === '2d';
    if (d2) this.group.matrix.copy(frameMatrix(o.frame));
    else this.group.matrix.identity();
    this.group.matrixWorldNeedsUpdate = true;
    const Ms = this._compute();
    const shown = Ms.slice(0, MAX_PREVIEW);
    if (d2) this._preview2(shown);
    else this._preview3(shown);
    this._marks();
    this.stepEl.innerHTML = this._stepText();
    this.applyBtn.disabled = !Ms.length || (o.kind === 'align' && o.dst.length < (d2 ? 2 : 3));
  }

  _line(points, mat, closed = false) {
    if (points.length < 2) return;
    const l = new (closed ? THREE.LineLoop : THREE.Line)(new THREE.BufferGeometry().setFromPoints(points), mat);
    l.userData.own = true;
    l.renderOrder = 31;
    l.raycast = () => {};
    this.group.add(l);
  }

  _points(points, color, size) {
    if (!points.length) return;
    const pts = new THREE.Points(new THREE.BufferGeometry().setFromPoints(points), new THREE.PointsMaterial({
      color, size, sizeAttenuation: false, map: dotTex(), transparent: true, alphaTest: 0.3, depthTest: false, depthWrite: false,
    }));
    pts.userData.own = true;
    pts.userData.ownMat = true;
    pts.renderOrder = 32;
    pts.raycast = () => {};
    this.group.add(pts);
  }

  /** Entità trasformate, nel sistema del piano. */
  _preview2(Ms) {
    const o = this.op;
    const sk = getSketch(o.sketchId)?.sketch;
    if (!sk) return;
    const ents = sk.entities.filter(e => o.ents.includes(e.id));
    for (const M of Ms) {
      for (const e of ents) {
        const loop = entityLoop(xfEntity(structuredClone(e), M));
        this._line(loop.map(([x, y]) => new THREE.Vector3(x, y, 0.05)), this.mat.preview, true);
      }
    }
  }

  /** Solidi trasformati (copie trasparenti della geometria della scena), piani e punti di origine. */
  _preview3(Ms) {
    const o = this.op;
    const dots = [];
    for (const x of o.items) {
      const r = resolve(x);
      if (!r) continue;
      if (x.type === 'origin') {
        const p = new THREE.Vector3().fromArray(r.item.position);
        for (const M of Ms) dots.push(p.clone().applyMatrix4(M));
        continue;
      }
      if (x.type === 'plane') {
        const P = itemMatrix('plane', r.item);
        const s = (r.item.size || 100) / 2;
        const quad = [[-s, -s], [s, -s], [s, s], [-s, s]].map(([a, b]) => new THREE.Vector3(a, b, 0).applyMatrix4(P));
        const loops = [];
        for (const sk of r.item.sketches || []) {
          if (sk.visible === false) continue;
          for (const e of sk.entities) loops.push(entityLoop(e).map(([a, b]) => new THREE.Vector3(a, b, 0).applyMatrix4(P)));
        }
        for (const M of Ms) {
          this._line(quad.map(q => q.clone().applyMatrix4(M)), this.mat.preview, true);
          for (const l of loops.slice(0, 200)) this._line(l.map(q => q.clone().applyMatrix4(M)), this.mat.preview, true);
        }
        continue;
      }
      const obj = this.sync.objectFor(x.type, x.id);
      if (!obj?.geometry) continue;
      obj.updateMatrixWorld(true);
      const edges = obj.children.find(c => c.isLineSegments);
      for (const M of Ms) {
        const g = new THREE.Mesh(obj.geometry, this.mat.ghost);
        g.matrixAutoUpdate = false;
        g.matrix.multiplyMatrices(M, obj.matrixWorld);
        g.renderOrder = 25;
        g.raycast = () => {};
        if (edges) {
          const e = new THREE.LineSegments(edges.geometry, this.mat.ghostEdge);
          e.raycast = () => {};
          g.add(e);
        }
        this.group.add(g);
      }
    }
    this._points(dots, COL.preview, dotPx(1));
  }

  /** Punti scelti, cursore, linee guida, assi e riferimenti. */
  _marks() {
    const o = this.op, c = o.cursor, info = o.info;
    const z = o.mode === '2d' ? 0.06 : 0;
    const L = p => new THREE.Vector3(p.x, p.y, p.z + z);
    const seg = (a, b, mat) => this._line([L(a), L(b)], mat);
    const marks = [], fixed = [];
    switch (o.kind) {
      case 'move':
      case 'copy':
        if (o.pts.base) {
          marks.push(o.pts.base);
          if (info.d && o.typed !== 'delta') seg(o.pts.base, o.pts.base.clone().add(info.d), this.mat.guide);
        }
        break;
      case 'rotate': {
        const axis = this._axis();
        const ctr = o.pts.center || (o.mode === '3d' && o.vals.axis === 'pts' ? null : o.center);
        if (ctr) (o.pts.center ? marks : fixed).push(ctr);
        if (o.pts.axis2) marks.push(o.pts.axis2);
        if (o.step === 'axis2' && c) seg(o.pts.center, c.p, this.mat.axis);
        // asse di rotazione (3D): linea che attraversa il centro
        if (o.mode === '3d' && axis && o.pts.center) {
          const half = Math.max(10, o.box.isEmpty() ? 20 : o.box.getSize(new THREE.Vector3()).length() * 0.6);
          seg(o.pts.center.clone().addScaledVector(axis, -half), o.pts.center.clone().addScaledVector(axis, half), this.mat.axis);
        }
        if (o.edge) seg(o.edge.a, o.edge.b, this.mat.ref);
        if (o.rdir) seg(o.rdir.a, o.rdir.b, this.mat.ref);
        if (o.tedge) seg(o.tedge.a, o.tedge.b, this.mat.target);
        else if (o.step === 'target' && c && ctr) seg(ctr, c.p, this.mat.guide);
        if (o.rdir && info.a && ctr && axis) {
          // arco della rotazione, dalla direzione di partenza
          const mid = o.rdir.line ? o.rdir.a.clone().add(o.rdir.b).multiplyScalar(0.5) : o.rdir.b;
          let rad = flat(mid.clone().sub(ctr), axis).length();
          if (rad < 1e-3) rad = Math.max(5, o.box.isEmpty() ? 10 : o.box.getSize(new THREE.Vector3()).length() / 3);
          const u = flat(o.rdir.dir, axis).setLength(rad);
          const steps = Math.max(8, Math.ceil(Math.abs(info.a) / 4));
          const arc = [];
          for (let i = 0; i <= steps; i++) arc.push(L(ctr.clone().add(u.clone().applyAxisAngle(axis, info.a * D2R * i / steps))));
          this._line(arc, this.mat.guide);
        }
        break;
      }
      case 'align': {
        marks.push(...o.src);
        fixed.push(...o.dst);
        if (o.src.length > 1) this._line(o.src.map(L), this.mat.ref);
        if (o.dst.length > 1) this._line(o.dst.map(L), this.mat.target);
        o.dst.forEach((q, i) => seg(o.src[i], q, this.mat.guide));
        if (c) {
          const n = o.mode === '2d' ? 2 : 3;
          if (o.src.length < n) { if (o.src.length) seg(o.src[o.src.length - 1], c.p, this.mat.ref); } else {
            if (o.dst.length) seg(o.dst[o.dst.length - 1], c.p, this.mat.target);
            seg(o.src[o.dst.length], c.p, this.mat.guide);
          }
        }
        break;
      }
      case 'scale':
        if (o.step === 'ref1' && o.edge) { seg(o.edge.a, o.edge.b, this.mat.ref); fixed.push(o.edge.a); }
        if (o.pts.r1) {
          marks.push(o.pts.r1);
          if (c) seg(o.pts.r1, c.p, this.mat.guide);
        }
        if (o.ref) {
          seg(o.ref.a, o.ref.b, this.mat.ref);
          marks.push(o.ref.b);
          fixed.push(info.fixed || (o.vals.fixed === 'center' ? o.center : o.ref.a));
        }
        break;
      case 'arrayPolar':
        if (o.pts.center) marks.push(o.pts.center);
        break;
    }
    this._points(fixed.map(L), COL.fixed, dotPx(1.5));
    this._points(marks.map(L), COL.mark, dotPx(1.5));
    // punto sotto il cursore: arancione e più grande quando si aggancia a un vertice
    if (c && o.kind !== 'arrayRect') this._points([L(c.p)], c.snapped ? COL.mark : COL.cursor, c.snapped ? dotPx(2.2) : dotPx(1.3));
  }

  /** Voci del menu del tasto destro. */
  contextItems() {
    return MODIFY_COMMANDS.map(([k, label, icon, key]) => ({
      label: `${t(label)}…`, icon, kbd: `Shift+${key}`, enabled: () => !this.why(k), action: () => this.start(k),
    }));
  }
}
