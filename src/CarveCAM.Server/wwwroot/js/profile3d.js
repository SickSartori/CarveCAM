// Strumento sketch "Da 3D": si selezionano col mouse facce od oggetti del modello e se ne ricava il contorno
// proiettato sul piano dello sketch (la loro "ombra"), combinando più elementi con operazioni booleane
// (unione, sottrazione, intersezione) oppure lasciandoli come contorni separati.
import * as THREE from 'three';
import { App, mutate, getSketch, select, uid } from './state.js';
import { api } from './api.js';
import { status, toast } from './dialogs.js';
import { evalNum } from './ui-props.js';
import { facesOf, triangleCount, triVertices } from './faces.js';

const COLOR = { hover: 0x3fa7ff, picked: 0xffb547, outer: 0x7cf2ff, hole: 0xff8a3d };
const MODE_LABEL = { union: 'unione', subtract: 'sottrazione', intersect: 'intersezione', separate: 'contorni separati' };
const r4 = v => Math.round(v * 1e4) / 1e4;

export class Profile3D {
  constructor(vp, sketch) {
    this.vp = vp;
    this.sketch = sketch;
    this.active = false;
    this.pick = 'face';        // 'face' | 'object'
    this.items = [];           // { key, mesh, tris (Int32Array | null = oggetto intero), name }
    this.hovered = null;
    this.result = null;        // risposta del server: { shapes, warnings }
    this.busy = false;
    this.group = new THREE.Group();
    vp.scene.add(this.group);
    this.hoverObj = null;
    this._seq = 0;
    this._lastMove = 0;

    this.el = document.getElementById('sk-profile');
    this.modeSel = document.getElementById('sk-pmode');
    this.offsetInp = document.getElementById('sk-poffset');
    this.countEl = document.getElementById('sk-pcount');
    for (const b of this.el.querySelectorAll('[data-pick]')) {
      b.addEventListener('click', () => { this.pick = b.dataset.pick; this.clear(); this._syncUi(); });
    }
    this.modeSel.addEventListener('change', () => this._schedule());
    this.offsetInp.addEventListener('change', () => this._schedule());
    this.offsetInp.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Enter') this._schedule(); });
    document.getElementById('sk-pclear').addEventListener('click', () => this.clear());
    document.getElementById('sk-pmake').addEventListener('click', () => this.commit());
  }

  get mode() { return this.modeSel.value; }
  get offset() { const v = evalNum(this.offsetInp.value); return Number.isFinite(v) ? v : 0; }

  activate() {
    this.active = true;
    this.el.hidden = false;
    // si può ruotare la vista per raggiungere le facce; all'uscita dallo strumento si torna in pianta
    this.vp.controls.enableRotate = true;
    this.vp.renderer.domElement.style.cursor = 'default';
    this._syncUi();
  }

  deactivate() {
    if (!this.active) return;
    this.active = false;
    this.el.hidden = true;
    this.clear();
    this._setHover(null);
    this.vp.renderer.domElement.style.cursor = '';
    if (this.sketch.active) {
      this.vp.controls.enableRotate = false;
      this.vp.lookAlongFrame(this.sketch.frame, true, this.vp.camera.position.distanceTo(this.vp.controls.target));
    }
  }

  // ---------------------------------------------------------------- selezione
  _targets() {
    const list = [];
    for (const g of [this.vp.groups.objects, this.vp.groups.artifacts]) {
      g.traverseVisible(o => { if (o.isMesh && o.userData.type) list.push(o); });
    }
    return list;
  }

  _itemAt(ev) {
    const hit = this.vp.raycast(ev, this._targets(), false)[0];
    if (!hit || hit.faceIndex == null) return null;
    const mesh = hit.object;
    const { type, id } = mesh.userData;
    const src = type === 'object' ? App.project.objects.find(o => o.id === id) : App.project.artifacts.find(a => a.id === id);
    const name = src?.name || 'Oggetto';
    if (this.pick === 'object') return { key: `${type}:${id}`, mesh, tris: null, name };
    const f = facesOf(mesh);
    const fid = f.faceOf[hit.faceIndex];
    return { key: `${type}:${id}:${fid}`, mesh, tris: f.groups.get(fid), name: `${name}, faccia ${fid + 1}`, brep: f.brep };
  }

  hover(ev) {
    const now = performance.now();
    if (now - this._lastMove < 35) return;   // il raycast su mesh grandi costa: al massimo ~30 volte al secondo
    this._lastMove = now;
    const it = this._itemAt(ev);
    this._setHover(it);
    const el = document.getElementById('st-coords');
    if (el) el.textContent = it ? `${it.name}${it.tris ? ` (${it.brep ? 'faccia CAD' : 'faccia ricavata dalla mesh'})` : ''}` : '';
  }

  leave() { this._setHover(null); }

  _setHover(it) {
    if ((it?.key || null) === (this.hovered?.key || null)) return;
    this.hovered = it;
    if (this.hoverObj) { this._dispose(this.hoverObj); this.hoverObj = null; }
    if (it && !this.items.some(x => x.key === it.key)) {
      this.hoverObj = this._overlay(it, COLOR.hover, 0.35);
      this.group.add(this.hoverObj);
    }
    // durante lo sketch la tela nasconde il cursore (c'è il mirino): qui serve il puntatore normale
    this.vp.renderer.domElement.style.cursor = this.active ? (it ? 'pointer' : 'default') : '';
  }

  toggle(ev) {
    const it = this._itemAt(ev);
    if (!it) { toast('Nessuna faccia sotto il cursore', 'warn', 1500); return; }
    const i = this.items.findIndex(x => x.key === it.key);
    if (i >= 0) {
      this._dispose(this.items[i].overlay);
      this.items.splice(i, 1);
    } else {
      it.overlay = this._overlay(it, COLOR.picked, 0.5);
      this.group.add(it.overlay);
      this.items.push(it);
    }
    this.hovered = null;
    this._setHover(it);
    this._schedule();
  }

  removeLast() {
    const it = this.items.pop();
    if (it) { this._dispose(it.overlay); this._schedule(); }
  }

  clear() {
    for (const it of this.items) this._dispose(it.overlay);
    this.items = [];
    this.result = null;
    this._seq++;
    this.busy = false;
    this._syncUi();
    this.sketch._redraw();
  }

  // ---------------------------------------------------------------- evidenziazione nel 3D
  _overlay(it, color, opacity) {
    const mat = new THREE.MeshBasicMaterial({
      color, transparent: true, opacity, depthWrite: false, side: THREE.DoubleSide,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    });
    let geo;
    if (!it.tris) {
      geo = it.mesh.geometry;   // oggetto intero: si riusa la geometria (non va eliminata)
    } else {
      const src = it.mesh.geometry, pos = src.attributes.position;
      const arr = new Float32Array(it.tris.length * 9);
      let k = 0;
      for (const t of it.tris) {
        for (const v of triVertices(src, t)) { arr[k++] = pos.getX(v); arr[k++] = pos.getY(v); arr[k++] = pos.getZ(v); }
      }
      geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(arr, 3));
    }
    const m = new THREE.Mesh(geo, mat);
    m.userData.ownGeometry = !!it.tris;
    it.mesh.updateMatrixWorld();
    m.matrixAutoUpdate = false;
    m.matrix.copy(it.mesh.matrixWorld);
    m.renderOrder = 6;
    m.raycast = () => {};
    return m;
  }

  _dispose(o) {
    if (!o) return;
    o.removeFromParent();
    if (o.userData.ownGeometry) o.geometry.dispose();
    o.material.dispose();
  }

  // ---------------------------------------------------------------- calcolo del profilo
  /** Triangoli dell'elemento proiettati sul piano dello sketch: 6 valori (x,y) per triangolo. */
  _project(it) {
    const f = this.sketch.frame;
    const mesh = it.mesh;
    mesh.updateMatrixWorld();
    const geo = mesh.geometry, pos = geo.attributes.position, M = mesh.matrixWorld;
    const n = it.tris ? it.tris.length : triangleCount(geo);
    const out = new Float64Array(n * 6);
    const front = it.tris ? null : new Float64Array(n * 6);
    let k = 0, kf = 0;
    const p = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
    const e1 = new THREE.Vector3(), e2 = new THREE.Vector3();
    for (let i = 0; i < n; i++) {
      const t = it.tris ? it.tris[i] : i;
      const vs = triVertices(geo, t);
      for (let j = 0; j < 3; j++) p[j].fromBufferAttribute(pos, vs[j]).applyMatrix4(M).sub(f.o);
      const xy = [];
      for (let j = 0; j < 3; j++) xy.push(r4(p[j].dot(f.u)), r4(p[j].dot(f.v)));
      out.set(xy, k); k += 6;
      // oggetto intero: per un solido bastano i triangoli rivolti verso il piano (metà del lavoro)
      if (front && e1.subVectors(p[1], p[0]).cross(e2.subVectors(p[2], p[0])).dot(f.n) > 0) { front.set(xy, kf); kf += 6; }
    }
    return Array.from(front && kf ? front.subarray(0, kf) : out.subarray(0, k));
  }

  _schedule() {
    clearTimeout(this._timer);
    this._timer = setTimeout(() => this._compute(), 120);
    this._syncUi();
  }

  async _compute() {
    clearTimeout(this._timer);
    const seq = ++this._seq;
    if (!this.items.length) { this.result = null; this.busy = false; this._syncUi(); this.sketch._redraw(); return; }
    this.busy = true;
    this._syncUi();
    try {
      const req = {
        mode: this.mode, offset: this.offset, tolerance: 0.005,
        items: this.items.map(it => ({ name: it.name, triangles: this._project(it) })),
      };
      const res = await api.profile(req);
      if (seq !== this._seq) return;
      this.result = res;
    } catch (e) {
      if (seq !== this._seq) return;
      this.result = null;
      toast(`Profilo non calcolato: ${e.message}`, 'err');
    } finally {
      if (seq === this._seq) { this.busy = false; this._syncUi(); this.sketch._redraw(); }
    }
  }

  /** Aggiunge il profilo allo sketch come polilinee chiuse (fori compresi: vale la regola pari/dispari). */
  async commit() {
    if (!this.items.length) { toast('Seleziona prima una o più facce del modello', 'warn'); return; }
    await this._compute();
    const shapes = this.result?.shapes || [];
    if (!shapes.length) { toast(this.result?.warnings?.[0] || 'Il profilo è vuoto', 'warn', 5000); return; }
    const sid = this.sketch.sketchId;
    let loops = 0, area = 0, last = null;
    mutate(() => {
      const r = getSketch(sid);
      for (const s of shapes) {
        area += s.area;
        for (const loop of s.loops) {
          const pts = [];
          for (let i = 0; i + 1 < loop.length; i += 2) pts.push([r4(loop[i]), r4(loop[i + 1])]);
          if (pts.length < 3) continue;
          last = uid('e');
          r.sketch.entities.push({ id: last, kind: 'polyline', pts, closed: true, source: `Da 3D: ${s.name}` });
          loops++;
        }
      }
    });
    const mode = MODE_LABEL[this.mode] || this.mode;
    for (const w of this.result.warnings || []) toast(w, 'warn', 5000);
    this.clear();
    if (last) select({ type: 'entity', id: last, sketchId: sid });
    status(`Profilo da 3D (${mode}): ${loops} contorn${loops === 1 ? 'o' : 'i'}, area ${area.toLocaleString('it-IT', { maximumFractionDigits: 1 })} mm²`);
  }

  // ---------------------------------------------------------------- anteprima e interfaccia
  /** Anteprima nel sistema del piano (gruppo dello sketch): contorni esterni azzurri, fori arancio, area velata. */
  drawPreview(group) {
    const shapes = this.result?.shapes;
    if (!shapes?.length) return;
    for (const s of shapes) {
      const sp = new THREE.ShapePath();
      for (const loop of s.loops) {
        const pts = [];
        for (let i = 0; i + 1 < loop.length; i += 2) pts.push(new THREE.Vector2(loop[i], loop[i + 1]));
        if (pts.length < 3) continue;
        const outer = THREE.ShapeUtils.area(pts) > 0;
        const line = new THREE.LineLoop(
          new THREE.BufferGeometry().setFromPoints(pts.map(q => new THREE.Vector3(q.x, q.y, 0.05))),
          new THREE.LineBasicMaterial({ color: outer ? COLOR.outer : COLOR.hole, depthTest: false, transparent: true }));
        line.renderOrder = 20;
        group.add(line);
        sp.moveTo(pts[0].x, pts[0].y);
        for (let i = 1; i < pts.length; i++) sp.lineTo(pts[i].x, pts[i].y);
      }
      try {
        const fill = new THREE.Mesh(new THREE.ShapeGeometry(sp.toShapes(true)),
          new THREE.MeshBasicMaterial({ color: COLOR.outer, transparent: true, opacity: 0.14, depthTest: false, side: THREE.DoubleSide }));
        fill.position.z = 0.04;
        fill.renderOrder = 19;
        group.add(fill);
      } catch { /* solo contorni */ }
    }
  }

  _syncUi() {
    for (const b of this.el.querySelectorAll('[data-pick]')) {
      const on = b.dataset.pick === this.pick;
      b.classList.toggle('active', on);
      b.setAttribute('aria-pressed', String(on));
    }
    const n = this.items.length;
    const what = this.pick === 'face' ? (n === 1 ? 'faccia' : 'facce') : (n === 1 ? 'oggetto' : 'oggetti');
    let txt = n ? `${n} ${what}` : (this.pick === 'face' ? 'Clic sulle facce' : 'Clic sugli oggetti');
    if (n && this.busy) txt += ', calcolo…';
    else if (n && this.result) {
      const a = this.result.shapes.reduce((s, x) => s + x.area, 0);
      txt += this.result.shapes.length ? `, area ${a.toLocaleString('it-IT', { maximumFractionDigits: 1 })} mm²` : ', profilo vuoto';
    }
    this.countEl.textContent = txt;
    document.getElementById('sk-pmake').disabled = !n;
  }
}
