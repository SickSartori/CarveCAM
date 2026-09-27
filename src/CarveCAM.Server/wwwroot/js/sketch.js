// Modalità sketch: disegno 2D sul piano di lavoro (polilinea, rettangolo, cerchio, poligono) con aggancio e coordinate.
import * as THREE from 'three';
import { App, emit, mutate, getSketch, select, uid } from './state.js';
import { planeFrame, frameMatrix, toLocal, entityLoop, entitySnapPoints, distToLoop, fmt } from './geom.js';
import { status, toast } from './dialogs.js';
import { evalNum } from './ui-props.js';
import { Profile3D } from './profile3d.js';

const HINTS = {
  profile: 'Clic su facce del modello per selezionarle (di nuovo per toglierle), trascina per ruotare · <b>Invio</b> crea il profilo · <b>Backspace</b> toglie l\'ultima · <b>Esc</b> svuota',
  select: 'Clic su un\'entità per selezionarla · <b>Canc</b> elimina · <b>Esc</b> termina sketch',
  polyline: 'Clic per aggiungere vertici · clic sul primo punto, doppio clic o <b>Invio</b> per chiudere · <b>Backspace</b> annulla vertice',
  rect: 'Clic sul primo angolo, poi sull\'angolo opposto (o digita <b>@larghezza,altezza</b>)',
  circle: 'Clic sul centro, poi sul raggio (o digita il raggio)',
  polygon: 'Clic sul centro, poi su un vertice (o digita il raggio circoscritto)',
};

export class SketchMode {
  constructor(vp) {
    this.vp = vp;
    this.active = false;
    this.tool = 'select';
    this.pts = [];
    this.cursor = null;
    this.group = new THREE.Group();
    this.group.matrixAutoUpdate = false;
    this.group.renderOrder = 10;
    vp.scene.add(this.group);
    this.bar = document.getElementById('sketch-bar');
    this.hint = document.getElementById('hint');
    this.input = document.getElementById('sk-input');
    this.sides = document.getElementById('sk-sides');
    this.snapBox = document.getElementById('sk-snap');
    this.stepBox = document.getElementById('sk-step');
    for (const b of this.bar.querySelectorAll('[data-tool]')) b.addEventListener('click', () => this.setTool(b.dataset.tool));
    document.getElementById('sk-done').addEventListener('click', () => this.exit());
    this.input.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); this._typed(this.input.value); this.input.value = ''; }
      if (e.key === 'Escape') { this.input.blur(); }
      e.stopPropagation();
    });
    for (const inp of [this.sides, this.stepBox]) inp.addEventListener('keydown', e => e.stopPropagation());
    this.profile = new Profile3D(vp, this);
  }

  get sketchId() { return App.sketch?.sketchId; }

  enter(sketchId) {
    const r = getSketch(sketchId);
    if (!r) return;
    if (this.active) this.exit(false);
    App.sketch = { planeId: r.plane.id, sketchId };
    this.active = true;
    this.frame = planeFrame(r.plane);
    this.group.matrix.copy(frameMatrix(this.frame));
    this.group.matrixWorldNeedsUpdate = true;
    this.vp.transform.detach();
    this.vp.controls.enableRotate = false;
    this.vp.lookAlongFrame(this.frame, true, Math.max(120, (r.plane.size || 100) * 1.6));
    this.vp.el.classList.add('sketching');
    document.getElementById('sk-name').textContent = `${r.plane.name} › ${r.sketch.name}`;
    this.bar.hidden = false;
    this.setTool(r.sketch.entities.length ? 'select' : 'rect');
    select({ type: 'sketch', id: sketchId });
    emit('sketch');
    emit('project');
  }

  exit(notify = true) {
    if (!this.active) return;
    this.active = false;
    this.profile.deactivate();
    App.sketch = null;
    this.pts = [];
    this._clearGraphics();
    this.vp.controls.enableRotate = true;
    this.vp.resetUp();
    this.vp.el.classList.remove('sketching');
    this.bar.hidden = true;
    this.hint.hidden = true;
    if (notify) { emit('sketch'); emit('project'); }
  }

  /** Aggiorna il sistema di riferimento (es. piano modificato mentre si disegna). */
  refreshFrame() {
    if (!this.active) return;
    const r = getSketch(this.sketchId);
    if (!r) { this.exit(); return; }
    this.frame = planeFrame(r.plane);
    this.group.matrix.copy(frameMatrix(this.frame));
    this.group.matrixWorldNeedsUpdate = true;
  }

  setTool(t) {
    if (this.tool === 'profile' && t !== 'profile') this.profile.deactivate();
    this.tool = t;
    this.pts = [];
    if (t === 'profile') this.profile.activate();
    this.bar.querySelector('.sk-draw').hidden = t === 'profile';
    for (const b of this.bar.querySelectorAll('[data-tool]')) b.classList.toggle('active', b.dataset.tool === t);
    this.hint.innerHTML = HINTS[t];
    this.hint.hidden = false;
    this._redraw();
    emit('tool');
  }

  // ---------------------------------------------------------------- input
  _local(ev) {
    const p = this.vp.rayPlane(ev, this.frame);
    if (!p) return null;
    const l = toLocal(this.frame, p);
    const px = this.vp.pixelSize(p);
    return { x: l.x, y: l.y, px };
  }

  _snap(q) {
    if (!q) return null;
    const tol = q.px * 9;
    let best = null, bd = tol;
    const r = getSketch(this.sketchId);
    const cands = [[0, 0], ...this.pts];
    if (r) for (const e of r.sketch.entities) cands.push(...entitySnapPoints(e));
    for (const c of cands) {
      const d = Math.hypot(c[0] - q.x, c[1] - q.y);
      if (d < bd) { bd = d; best = { x: c[0], y: c[1], snapped: 'punto' }; }
    }
    if (best) return { ...best, px: q.px };
    if (this.snapBox.checked) {
      const st = Math.max(0.001, evalNum(this.stepBox.value) || 1);
      return { x: Math.round(q.x / st) * st, y: Math.round(q.y / st) * st, px: q.px, snapped: 'griglia' };
    }
    return q;
  }

  onMove(ev) {
    if (this.tool === 'profile') { this.profile.hover(ev); return; }
    const q = this._snap(this._local(ev));
    if (!q) return;
    this.cursor = q;
    document.getElementById('st-coords').textContent = `U ${fmt(q.x, 3)}  V ${fmt(q.y, 3)}${q.snapped ? `  [${q.snapped}]` : ''}`;
    this._redraw();
  }

  onLeave() {
    this.cursor = null;
    if (this.tool === 'profile') this.profile.leave();
    this._redraw();
  }

  onClick(ev) {
    if (ev.button !== 0) return;
    if (this.tool === 'profile') { this.profile.toggle(ev); return; }
    const q = this._snap(this._local(ev));
    if (!q) return;
    this._point([q.x, q.y], q.px);
  }

  onDblClick() {
    if (this.tool === 'polyline') this._finishPolyline();
  }

  onKey(e) {
    const k = e.key;
    if (this.tool === 'profile' && !e.ctrlKey && !e.metaKey) {
      if (k === 'Enter') { this.profile.commit(); return true; }
      if (k === 'Backspace') { this.profile.removeLast(); return true; }
      if (k === 'Escape' && this.profile.items.length) { this.profile.clear(); return true; }
    }
    if (k === 'Escape') {
      if (this.pts.length) { this.pts = []; this._redraw(); }
      else if (this.tool !== 'select') this.setTool('select');
      else this.exit();
      return true;
    }
    if (k === 'Enter') { if (this.tool === 'polyline') this._finishPolyline(); return true; }
    if (k === 'Backspace') { this.pts.pop(); this._redraw(); return true; }
    if (e.ctrlKey || e.metaKey || e.altKey) return false;
    const map = { s: 'select', l: 'polyline', r: 'rect', c: 'circle', p: 'polygon', d: 'profile' };
    if (map[k.toLowerCase()]) { this.setTool(map[k.toLowerCase()]); return true; }
    return false;
  }

  _point(p, px = 0.1) {
    const t = this.tool;
    if (t === 'select') { this._pick(p, px); return; }
    if (t === 'polyline') {
      if (this.pts.length >= 3 && Math.hypot(p[0] - this.pts[0][0], p[1] - this.pts[0][1]) < px * 9) { this._finishPolyline(); return; }
      const last = this.pts[this.pts.length - 1];
      if (last && Math.hypot(p[0] - last[0], p[1] - last[1]) < 1e-9) return;
      this.pts.push(p);
    } else if (t === 'rect') {
      if (!this.pts.length) this.pts.push(p);
      else {
        const [a] = this.pts;
        if (Math.abs(p[0] - a[0]) < 1e-9 || Math.abs(p[1] - a[1]) < 1e-9) { toast('Rettangolo degenere', 'warn'); return; }
        this._add({ kind: 'rect', x1: Math.min(a[0], p[0]), y1: Math.min(a[1], p[1]), x2: Math.max(a[0], p[0]), y2: Math.max(a[1], p[1]) });
      }
    } else if (t === 'circle' || t === 'polygon') {
      if (!this.pts.length) this.pts.push(p);
      else {
        const [c] = this.pts;
        const rr = Math.hypot(p[0] - c[0], p[1] - c[1]);
        if (rr < 1e-6) return;
        if (t === 'circle') this._add({ kind: 'circle', cx: c[0], cy: c[1], r: rr });
        else {
          const rot = THREE.MathUtils.radToDeg(Math.atan2(p[1] - c[1], p[0] - c[0]));
          this._add({ kind: 'polygon', cx: c[0], cy: c[1], r: rr, sides: Math.max(3, Math.round(evalNum(this.sides.value) || 6)), rot });
        }
      }
    }
    this._redraw();
  }

  _typed(text) {
    const s = text.trim();
    if (!s) return;
    const rel = s.startsWith('@');
    const body = rel ? s.slice(1).trim() : s;
    const last = this.pts[this.pts.length - 1];
    // cerchio/poligono con centro già definito: il valore è il raggio
    if ((this.tool === 'circle' || this.tool === 'polygon') && this.pts.length === 1 && !rel) {
      const v = evalNum(body);
      if (Number.isFinite(v) && v !== 0) { this._point([this.pts[0][0] + Math.abs(v), this.pts[0][1]]); return; }
    }
    const parts = body.includes(';') ? body.split(';') : /\s/.test(body) ? body.split(/\s+/) : body.split(',');
    if (parts.length === 1) {
      const v = evalNum(parts[0]);
      if (this.tool === 'rect' && this.pts.length === 1 && Number.isFinite(v) && v !== 0) {
        this._point([last[0] + v, last[1] + v]);
      } else {
        toast('Formato: x,y   x;y   oppure @dx,dy (relativo)', 'warn');
      }
      return;
    }
    let x = evalNum(parts[0]), y = evalNum(parts[1]);
    if (!Number.isFinite(x) || !Number.isFinite(y)) { toast('Coordinate non valide', 'err'); return; }
    if (rel) {
      const base = last || [0, 0];
      x += base[0]; y += base[1];
    }
    if (this.tool === 'select') this.setTool('polyline');
    this._point([x, y]);
  }
  _finishPolyline() {
    if (this.pts.length < 3) {
      if (this.pts.length) toast('Servono almeno 3 vertici', 'warn');
      return;
    }
    this._add({ kind: 'polyline', pts: this.pts.map(p => [p[0], p[1]]), closed: true });
  }

  _add(ent) {
    const id = uid('e');
    const sid = this.sketchId;
    mutate(() => {
      const r = getSketch(sid);
      r.sketch.entities.push({ id, ...ent });
    });
    this.pts = [];
    select({ type: 'entity', id, sketchId: sid });
    status(`Entità aggiunta allo sketch`);
    this._redraw();
  }

  _pick(p, px) {
    const r = getSketch(this.sketchId);
    if (!r) return;
    let best = null, bd = px * 8;
    for (const e of r.sketch.entities) {
      const d = distToLoop(p[0], p[1], entityLoop(e));
      if (d < bd) { bd = d; best = e; }
    }
    if (best) select({ type: 'entity', id: best.id, sketchId: this.sketchId });
    else select({ type: 'sketch', id: this.sketchId });
  }

  // ---------------------------------------------------------------- grafica di anteprima
  _clearGraphics() {
    for (const c of [...this.group.children]) {
      c.removeFromParent();
      c.geometry?.dispose();
      c.material?.dispose();
    }
  }

  _redraw() {
    this._clearGraphics();
    if (!this.active) return;
    if (this.tool === 'profile') { this.profile.drawPreview(this.group); return; }
    const c = this.cursor;
    const px = c ? c.px : 0.2;
    const lines = [];
    const t = this.tool;
    if (c && this.pts.length) {
      const a = this.pts[0];
      if (t === 'polyline') lines.push({ pts: [...this.pts, [c.x, c.y]], closed: false });
      if (t === 'rect') lines.push({ pts: entityLoop({ kind: 'rect', x1: a[0], y1: a[1], x2: c.x, y2: c.y }), closed: true });
      if (t === 'circle') lines.push({ pts: entityLoop({ kind: 'circle', cx: a[0], cy: a[1], r: Math.hypot(c.x - a[0], c.y - a[1]) }), closed: true });
      if (t === 'polygon') {
        const rot = THREE.MathUtils.radToDeg(Math.atan2(c.y - a[1], c.x - a[0]));
        lines.push({ pts: entityLoop({ kind: 'polygon', cx: a[0], cy: a[1], r: Math.hypot(c.x - a[0], c.y - a[1]), sides: evalNum(this.sides.value) || 6, rot }), closed: true });
      }
    } else if (this.pts.length && t === 'polyline') {
      lines.push({ pts: this.pts, closed: false });
    }
    for (const l of lines) {
      if (l.pts.length < 2) continue;
      const geo = new THREE.BufferGeometry().setFromPoints(l.pts.map(p => new THREE.Vector3(p[0], p[1], 0.05)));
      const mat = new THREE.LineBasicMaterial({ color: 0x7cf2ff, depthTest: false, transparent: true });
      const obj = l.closed ? new THREE.LineLoop(geo, mat) : new THREE.Line(geo, mat);
      obj.renderOrder = 20;
      this.group.add(obj);
    }
    // vertici già inseriti
    for (const p of this.pts) this.group.add(square(p, px * 3.5, 0x7cf2ff));
    // cursore a croce
    if (c) {
      const s = px * 14;
      const geo = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(c.x - s, c.y, 0.06), new THREE.Vector3(c.x + s, c.y, 0.06),
        new THREE.Vector3(c.x, c.y - s, 0.06), new THREE.Vector3(c.x, c.y + s, 0.06)]);
      const cross = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: c.snapped === 'punto' ? 0xff8a3d : 0xffffff, depthTest: false, transparent: true }));
      cross.renderOrder = 21;
      this.group.add(cross);
      if (c.snapped === 'punto') this.group.add(square([c.x, c.y], px * 5, 0xff8a3d));
    }
  }
}

function square(p, s, color) {
  const pts = [[-s, -s], [s, -s], [s, s], [-s, s]].map(d => new THREE.Vector3(p[0] + d[0], p[1] + d[1], 0.06));
  const l = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color, depthTest: false, transparent: true }));
  l.renderOrder = 21;
  return l;
}
