// Manipolatore (sposta/ruota) agganciato a un "pivot" separato dagli elementi:
// - muove insieme tutti gli elementi selezionati (oggetti, artefatti, piani);
// - se un elemento della selezione è bloccato il manipolatore compare con un lucchetto e non muove nulla;
// - clic sul centro del manipolatore: si sceglie un nuovo punto di riferimento tra i pallini verdi
//   disegnati sui vertici della selezione.
import * as THREE from 'three';
import { App, MOVABLE, resolve, snapshot, commitSnapshot, emit } from './state.js';
import { planeFrame, frameMatrix, angleOfU } from './geom.js';
import { artifactKeyPoints } from './scene-sync.js';
import { settings, color, onSettings } from './settings.js';
import { status } from './dialogs.js';
import { t } from './i18n.js';
import { log } from './log.js';

const D2R = Math.PI / 180;
const R2D = 180 / Math.PI;
const rnd = v => Math.round(v * 10000) / 10000;
const MAX_MESH_POINTS = 600;

const LOCK_SVG = '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="9" width="12" height="8.5" rx="1.5" fill="currentColor" fill-opacity=".25"/><path d="M6.5 9V6.5a3.5 3.5 0 0 1 7 0V9"/><circle cx="10" cy="13.2" r="1.1" fill="currentColor" stroke="none"/></svg>';

let dotTexture = null;
function dotTex() {
  if (dotTexture) return dotTexture;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  g.beginPath(); g.arc(32, 32, 28, 0, Math.PI * 2);
  g.fillStyle = '#ffffff'; g.fill();
  g.lineWidth = 7; g.strokeStyle = 'rgba(0,0,0,0.55)'; g.stroke();
  dotTexture = new THREE.CanvasTexture(c);
  return dotTexture;
}

/** Matrice mondo di un elemento del progetto (dai dati, non dalla scena). */
function itemMatrix(type, item) {
  if (type === 'plane') return frameMatrix(planeFrame(item));
  if (type === 'origin') return new THREE.Matrix4().makeTranslation(new THREE.Vector3().fromArray(item.position));
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(item.rotation[0] * D2R, item.rotation[1] * D2R, item.rotation[2] * D2R, 'XYZ'));
  const s = type === 'object' && item.scale ? new THREE.Vector3().fromArray(item.scale) : new THREE.Vector3(1, 1, 1);
  return new THREE.Matrix4().compose(new THREE.Vector3().fromArray(item.position), q, s);
}

export class GizmoController {
  /** @param ctx { vp, sync, isBlocked(): bool } */
  constructor({ vp, sync, isBlocked }) {
    this.vp = vp;
    this.sync = sync;
    this.isBlocked = isBlocked;
    this.t = vp.transform;
    this.pivot = new THREE.Object3D();
    this.pivot.name = 'pivot';
    vp.scene.add(this.pivot);
    this.custom = null;          // { key, local: Matrix4 } riferimento scelto dall'utente
    this.press = null;           // asse del manipolatore premuto all'ultimo pointerdown
    this.drag = null;
    this.locked = false;
    this.pick = null;            // scelta del riferimento: { points: Vector3[], obj, hoverObj, hover }

    this.badge = document.createElement('div');
    this.badge.className = 'gizmo-lock';
    this.badge.hidden = true;
    this.badge.innerHTML = LOCK_SVG;
    this.badge.title = t('Elemento bloccato: non si può spostare');
    vp.el.append(this.badge);
    vp.frameHooks.add(() => this._placeBadge());

    this.t.addEventListener('dragging-changed', e => (e.value ? this._dragStart() : this._dragEnd()));
    this.t.addEventListener('objectChange', () => this._dragMove());
    onSettings(() => { if (this.pick) this._buildDots(); });
  }

  // ---------------------------------------------------------------- elementi interessati
  _items() {
    const res = [];
    for (const ref of App.selected) {
      if (!MOVABLE.includes(ref.type)) continue;
      const r = resolve(ref);
      if (!r || r.item.visible === false) continue;
      const obj = this.sync.objectFor(ref.type, ref.id);
      if (!obj) continue;
      res.push({ ref, type: ref.type, item: r.item, obj });
    }
    return res;
  }

  _key(items) { return items.map(x => `${x.type}:${x.item.id}`).join('|'); }

  /** La selezione contiene elementi bloccati? */
  get selectionLocked() { return this._items().some(x => x.item.locked); }

  // ---------------------------------------------------------------- aggiornamento
  refresh() {
    const items = this._items();
    if (!items.length || this.isBlocked() || App.pickMode) {
      if (this.t.object) this.t.detach();
      this.locked = false;
      this.badge.hidden = true;
      this._dim(false);
      return;
    }
    if (!this.t.dragging) this._placePivot(items);
    if (this.t.object !== this.pivot) this.t.attach(this.pivot);
    this.t.setMode(App.view.gizmo === 'rotate' ? 'rotate' : 'translate');
    this.t.setSpace(App.view.gizmoLocal ? 'local' : 'world');
    this.t.setTranslationSnap(App.view.gizmoSnap ? 1 : null);
    this.t.setRotationSnap(App.view.gizmoSnap ? THREE.MathUtils.degToRad(15) : null);
    this.locked = items.some(x => x.item.locked);
    this.t.enabled = !this.locked;
    if (this.locked) this.t.axis = null;
    this._dim(this.locked);
    this.badge.hidden = !this.locked;
    this.badge.title = items.length > 1
      ? t('La selezione contiene elementi bloccati: il movimento è bloccato')
      : t('Elemento bloccato: non si può spostare');
  }

  _placePivot(items) {
    const key = this._key(items);
    const m0 = itemMatrix(items[0].type, items[0].item);
    let m;
    if (this.custom && this.custom.key === key) {
      m = m0.clone().multiply(this.custom.local);
    } else {
      this.custom = null;
      if (items.length === 1) {
        m = m0;
      } else {
        const box = new THREE.Box3();
        for (const x of items) {
          x.obj.updateMatrixWorld(true);
          if (x.type === 'plane') box.expandByPoint(new THREE.Vector3().fromArray(x.item.origin));
          else if (x.type === 'origin') box.expandByPoint(new THREE.Vector3().fromArray(x.item.position));
          else box.expandByObject(x.obj);
        }
        m = new THREE.Matrix4().makeTranslation(box.getCenter(new THREE.Vector3()));
      }
    }
    const p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3();
    m.decompose(p, q, s);
    this.pivot.position.copy(p);
    this.pivot.quaternion.copy(q.normalize());
    this.pivot.scale.set(1, 1, 1);
    this.pivot.updateMatrixWorld(true);
  }

  /** Memorizza il riferimento corrente rispetto al primo elemento (segue gli spostamenti successivi). */
  _rememberPivot(items) {
    const m0 = itemMatrix(items[0].type, items[0].item);
    this.pivot.updateMatrixWorld(true);
    this.custom = { key: this._key(items), local: m0.invert().multiply(this.pivot.matrixWorld) };
  }

  /** Manipolatore attenuato quando la selezione è bloccata. */
  _dim(on) {
    const g = this.t._gizmo;
    if (!g?.gizmo || this._dimmed === on) return;
    this._dimmed = on;
    for (const grp of Object.values(g.gizmo)) {
      grp.traverse(o => {
        const m = o.material;
        if (!m) return;
        if (m.userData.baseOpacity === undefined) m.userData.baseOpacity = m._opacity ?? m.opacity;
        m._opacity = on ? m.userData.baseOpacity * 0.3 : m.userData.baseOpacity;
      });
    }
  }

  _placeBadge() {
    if (this.badge.hidden || !this.t.object) return;
    const s = this.vp.toScreen(this.pivot.getWorldPosition(new THREE.Vector3()));
    if (!s) return;
    this.badge.style.transform = `translate(${Math.round(s.x + 14)}px, ${Math.round(s.y - 38)}px)`;
  }

  // ---------------------------------------------------------------- trascinamento
  _dragStart() {
    const items = this._items();
    if (this.locked || !items.length) return;
    this.pivot.updateMatrixWorld(true);
    this.drag = {
      snap: snapshot(),
      inv: this.pivot.matrixWorld.clone().invert(),
      items: items.map(x => ({ ...x, m: itemMatrix(x.type, x.item) })),
    };
  }

  _dragMove() {
    const d = this.drag;
    if (!d) return;
    this.pivot.updateMatrixWorld(true);
    const delta = this.pivot.matrixWorld.clone().multiply(d.inv);
    const p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3();
    for (const x of d.items) {
      delta.clone().multiply(x.m).decompose(p, q, s);
      if (x.type === 'plane') {
        const m = new THREE.Matrix4().makeRotationFromQuaternion(q);
        const u = new THREE.Vector3().setFromMatrixColumn(m, 0);
        const n = new THREE.Vector3().setFromMatrixColumn(m, 2);
        x.item.origin = p.toArray().map(rnd);
        x.item.normal = n.toArray().map(v => Math.round(v * 1e6) / 1e6);
        x.item.angle = rnd(angleOfU(n, u));
      } else if (x.type === 'origin') {
        x.item.position = p.toArray().map(rnd);   // un punto: conta solo la posizione
      } else {
        const e = new THREE.Euler().setFromQuaternion(q, 'XYZ');
        x.item.position = p.toArray().map(rnd);
        x.item.rotation = [e.x, e.y, e.z].map(v => rnd(v * R2D));
      }
    }
    this.sync.sync();
    emit('transform');
  }

  _dragEnd() {
    const d = this.drag;
    this.drag = null;
    if (!d) return;
    const items = this._items();
    if (items.length) this._rememberPivot(items);
    commitSnapshot(d.snap);
    log.info('Spostamento con il manipolatore', { items: d.items.length, mode: this.t.mode });
  }

  // ---------------------------------------------------------------- clic sul centro: nuovo riferimento
  /** Da chiamare a ogni pointerdown nella vista (dopo il manipolatore). */
  onPointerDown() {
    this.press = this.t.dragging || this.t.axis ? { axis: this.t.axis, mode: this.t.mode } : null;
  }

  /** Clic nella vista: true se riguardava il manipolatore (e non va trattato come selezione). */
  consumeClick() {
    const p = this.press;
    this.press = null;
    if (!p) return false;
    if (p.axis === 'XYZ' && p.mode === 'translate') this.startPivotPick();
    return true;
  }

  startPivotPick() {
    const items = this._items();
    if (!items.length) return;
    this.pick = { items, points: this._candidatePoints(items), hover: -1 };
    App.pickMode = { kind: 'pivot' };
    this.t.detach();
    this.badge.hidden = true;
    this._buildDots();
    const hint = document.getElementById('hint');
    hint.innerHTML = t('Clic su un <b>pallino verde</b> per il nuovo riferimento del manipolatore · <b>Esc</b> annulla');
    hint.hidden = false;
    status(t('Scegli il nuovo punto di riferimento del manipolatore'));
    emit('gizmo');
  }

  cancelPivotPick() {
    if (!this.pick) return;
    this._clearDots();
    this.pick = null;
    App.pickMode = null;
    document.getElementById('hint').hidden = true;
    emit('gizmo');
  }

  /** Movimento del puntatore durante la scelta: evidenzia il pallino più vicino. */
  pivotMove(ev) {
    if (!this.pick) return;
    const i = this._nearest(ev);
    if (i === this.pick.hover) return;
    this.pick.hover = i;
    this._drawHover();
    this.vp.renderer.domElement.style.cursor = i >= 0 ? 'pointer' : '';
  }

  pivotClick(ev) {
    if (!this.pick || ev.button !== 0) return;
    const i = this._nearest(ev);
    if (i < 0) { status(t('Clic su uno dei pallini verdi (Esc per annullare)')); return; }
    const pt = this.pick.points[i];
    const items = this.pick.items;
    this.cancelPivotPick();
    this.vp.renderer.domElement.style.cursor = '';
    // il riferimento mantiene l'orientamento corrente del manipolatore
    this._placePivot(items);
    this.pivot.position.copy(pt);
    this._rememberPivot(items);
    this.refresh();
    status(t('Nuovo riferimento del manipolatore impostato'));
    log.info('Riferimento del manipolatore spostato', { point: pt.toArray().map(rnd) });
  }

  _nearest(ev) {
    const m = this.vp.pointer(ev);
    const tol = Math.max(10, settings.sizes.pivotDot);
    let best = -1, bd = tol;
    this.pick.points.forEach((p, i) => {
      const s = this.vp.toScreen(p);
      if (!s) return;
      const d = Math.hypot(s.x - m.x, s.y - m.y);
      if (d < bd) { bd = d; best = i; }
    });
    return best;
  }

  /** Vertici della selezione (punti caratteristici per artefatti, piani e mesh grandi). */
  _candidatePoints(items) {
    const out = [];
    const seen = new Set();
    const add = v => {
      const k = `${Math.round(v.x * 1000)},${Math.round(v.y * 1000)},${Math.round(v.z * 1000)}`;
      if (seen.has(k)) return;
      seen.add(k);
      out.push(v);
    };
    for (const x of items) {
      const M = itemMatrix(x.type, x.item);
      let local = [];
      if (x.type === 'artifact') local = artifactKeyPoints(x.item);
      else if (x.type === 'plane') {
        const h = (x.item.size || 100) / 2;
        local = [[0, 0, 0], [-h, -h, 0], [h, -h, 0], [h, h, 0], [-h, h, 0]];
      } else {
        local = meshKeyPoints(App.runtime.meshGeo.get(x.item.meshId));
      }
      for (const p of local) add(new THREE.Vector3(p[0], p[1], p[2]).applyMatrix4(M));
    }
    return out;
  }

  _buildDots() {
    this._clearDots();
    if (!this.pick) return;
    const geo = new THREE.BufferGeometry().setFromPoints(this.pick.points);
    const mat = new THREE.PointsMaterial({
      color: color('pivot'), size: settings.sizes.pivotDot, sizeAttenuation: false,
      map: dotTex(), transparent: true, alphaTest: 0.3, depthTest: false,
    });
    const pts = new THREE.Points(geo, mat);
    pts.renderOrder = 60;
    pts.raycast = () => {};
    this.vp.groups.helpers.add(pts);
    this.pick.obj = pts;
    this._drawHover();
  }

  _drawHover() {
    const pk = this.pick;
    if (pk.hoverObj) { pk.hoverObj.removeFromParent(); pk.hoverObj.geometry.dispose(); pk.hoverObj.material.dispose(); pk.hoverObj = null; }
    if (pk.hover < 0) return;
    const mat = new THREE.PointsMaterial({
      color: new THREE.Color(color('pivot')).lerp(new THREE.Color(0xffffff), 0.45), size: settings.sizes.pivotDot * 1.7,
      sizeAttenuation: false, map: dotTex(), transparent: true, alphaTest: 0.3, depthTest: false,
    });
    pk.hoverObj = new THREE.Points(new THREE.BufferGeometry().setFromPoints([pk.points[pk.hover]]), mat);
    pk.hoverObj.renderOrder = 61;
    pk.hoverObj.raycast = () => {};
    this.vp.groups.helpers.add(pk.hoverObj);
  }

  _clearDots() {
    const pk = this.pick;
    if (!pk) return;
    for (const o of [pk.obj, pk.hoverObj]) {
      if (!o) continue;
      o.removeFromParent();
      o.geometry.dispose();
      o.material.dispose();
    }
    pk.obj = pk.hoverObj = null;
  }
}

/**
 * Punti di riferimento di una mesh importata (coordinate locali): i vertici degli spigoli vivi se non sono
 * troppi, altrimenti spigoli e centro del suo ingombro.
 */
function meshKeyPoints(geo) {
  const pts = [[0, 0, 0]];
  if (!geo) return pts;
  const edges = geo.userData.edges?.attributes?.position;
  if (edges) {
    const seen = new Set();
    const list = [];
    for (let i = 0; i < edges.count && list.length <= MAX_MESH_POINTS; i++) {
      const x = edges.getX(i), y = edges.getY(i), z = edges.getZ(i);
      const k = `${Math.round(x * 1000)},${Math.round(y * 1000)},${Math.round(z * 1000)}`;
      if (!seen.has(k)) { seen.add(k); list.push([x, y, z]); }
    }
    if (list.length <= MAX_MESH_POINTS) return pts.concat(list);
  }
  geo.computeBoundingBox();
  const b = geo.boundingBox;
  for (const x of [b.min.x, b.max.x]) for (const y of [b.min.y, b.max.y]) for (const z of [b.min.z, b.max.z]) pts.push([x, y, z]);
  const c = b.getCenter(new THREE.Vector3());
  pts.push([c.x, c.y, c.z], [c.x, c.y, b.min.z], [c.x, c.y, b.max.z]);
  return pts;
}
