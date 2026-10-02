// Modalità sketch: disegno 2D sul piano di lavoro (polilinea, rettangolo, cerchio, poligono) con aggancio.
// Le entità selezionate mostrano i punti di riferimento (vertici, centro, quadranti, punti medi): trascinandoli
// si modifica la geometria. La vista si orienta come fuori dallo sketch (rotazione, cubo, pan, zoom).
import * as THREE from 'three';
import { App, emit, mutate, getSketch, select, toggleSelect, uid, snapshot, commitSnapshot } from './state.js';
import { planeFrame, frameMatrix, toLocal, toWorld, entityLoop, entitySnapPoints, distToLoop, fmt } from './geom.js';
import { status, toast } from './dialogs.js';
import { evalNum } from './ui-props.js';
import { Profile3D } from './profile3d.js';
import { settings } from './settings.js';
import { t } from './i18n.js';

const HINTS_IT = {
  profile: 'Clic su facce del modello per selezionarle (di nuovo per toglierle), trascina per ruotare · <b>Invio</b> crea il profilo · <b>Backspace</b> toglie l\'ultima · <b>Esc</b> svuota',
  select: 'Clic su un\'entità per selezionarla (<b>Ctrl</b>+clic per aggiungerla) · trascina i suoi punti per modificarla · <b>Canc</b> elimina · <b>Esc</b> termina sketch',
  polyline: 'Clic per aggiungere vertici · clic sul primo punto, doppio clic o <b>Invio</b> per chiudere · <b>Backspace</b> annulla vertice',
  rect: 'Clic sul primo angolo, poi sull\'angolo opposto',
  circle: 'Clic sul centro, poi sul raggio',
  polygon: 'Clic sul centro, poi su un vertice',
};
const HINTS = Object.fromEntries(Object.entries(HINTS_IT).map(([k, v]) => [k, t(v)]));

const GRIP_PX = 9;   // raggio di presa delle maniglie (pixel)

export class SketchMode {
  constructor(vp, sync) {
    this.vp = vp;
    this.sync = sync;
    this.hoverGrip = null;
    this.dragGrip = null;
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
    this.sides = document.getElementById('sk-sides');
    this.snapBox = document.getElementById('sk-snap');
    this.stepBox = document.getElementById('sk-step');
    for (const b of this.bar.querySelectorAll('[data-tool]')) b.addEventListener('click', () => this.setTool(b.dataset.tool));
    document.getElementById('sk-done').addEventListener('click', () => this.exit());
    for (const inp of [this.sides, this.stepBox]) inp.addEventListener('keydown', e => e.stopPropagation());
    this.stepBox.value = String(settings.grid.snapStep || 1);
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
    // vista normale al piano attuale, con la stessa convenzione (Z in alto) della navigazione normale
    this.vp.lookAlongFrame(this.frame, false, Math.max(120, (r.plane.size || 100) * 1.6));
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
    this.hoverGrip = null;
    this.dragGrip = null;
    this.vp.el.classList.remove('sketching', 'grip-hover');
    this.bar.hidden = true;
    this.hint.hidden = true;
    if (notify) { emit('sketch'); emit('project'); }
  }

  /** Aggiorna il sistema di riferimento (es. piano modificato mentre si disegna): se cambia la normale, riallinea la vista. */
  refreshFrame() {
    if (!this.active) return;
    const r = getSketch(this.sketchId);
    if (!r) { this.exit(); return; }
    const prev = this.frame;
    this.frame = planeFrame(r.plane);
    this.group.matrix.copy(frameMatrix(this.frame));
    this.group.matrixWorldNeedsUpdate = true;
    if (prev && prev.n.angleTo(this.frame.n) > 1e-6) this.vp.lookAlongFrame(this.frame, false);
    this.redraw();
  }

  /** Ridisegna anteprime e maniglie (selezione o geometria cambiate). */
  redraw() { if (this.active && !this.dragGrip) this._redraw(); }

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

  /** Aggancio a punti notevoli (escluse l'entità exclude) o alla griglia. */
  _snap(q, exclude = null) {
    if (!q) return null;
    const tol = q.px * 9;
    let best = null, bd = tol;
    const r = getSketch(this.sketchId);
    const cands = [[0, 0], ...this.pts];
    if (r) for (const e of r.sketch.entities) if (e.id !== exclude) cands.push(...entitySnapPoints(e));
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
    if (this.dragGrip) return;   // durante il trascinamento di una maniglia aggiorna grab()
    this.hoverGrip = this._gripAt(ev);
    this.vp.el.classList.toggle('grip-hover', !!this.hoverGrip);
    const q = this._snap(this._local(ev));
    if (!q) return;
    this.cursor = q;
    document.getElementById('st-coords').textContent = `U ${fmt(q.x, 3)}  V ${fmt(q.y, 3)}${q.snapped ? `  [${q.snapped}]` : ''}`;
    this._redraw();
  }

  onLeave() {
    this.cursor = null;
    if (!this.dragGrip) { this.hoverGrip = null; this.vp.el.classList.remove('grip-hover'); }
    if (this.tool === 'profile') this.profile.leave();
    this._redraw();
  }

  onClick(ev) {
    if (ev.button !== 0) return;
    if (this.tool === 'profile') { this.profile.toggle(ev); return; }
    if (this.tool === 'select') {
      const q = this._local(ev);
      if (q) this._pick([q.x, q.y], q.px, ev.ctrlKey || ev.metaKey || ev.shiftKey);
      return;
    }
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

  // ---------------------------------------------------------------- maniglie delle entità selezionate
  /** Maniglie delle entità selezionate di questo sketch (solo con lo strumento Seleziona). */
  _grips() {
    if (!this.active || this.tool !== 'select') return [];
    const r = getSketch(this.sketchId);
    if (!r) return [];
    const ids = new Set(App.selected.filter(s => s.type === 'entity' && s.sketchId === this.sketchId).map(s => s.id));
    const out = [];
    for (const e of r.sketch.entities) if (ids.has(e.id)) out.push(...entityGrips(e));
    return out;
  }

  /** Maniglia sotto il puntatore (la più vicina entro GRIP_PX pixel); i punti hanno la precedenza sui centri. */
  _gripAt(ev) {
    const grips = this._grips();
    if (!grips.length) return null;
    const m = this.vp.pointer(ev);
    let best = null, bd = GRIP_PX;
    for (const g of grips) {
      const s = this.vp.toScreen(toWorld(this.frame, g.x, g.y));
      if (!s) continue;
      const d = Math.hypot(s.x - m.x, s.y - m.y) + (g.role === 'center' || g.role === 'insert' ? 0.5 : 0);
      if (d < bd) { bd = d; best = g; }
    }
    return best;
  }

  /** Inizio del trascinamento di una maniglia (chiamato dalla vista prima della navigazione): { move, end } o null. */
  grab(ev) {
    if (!this.active || this.tool !== 'select' || ev.ctrlKey || ev.metaKey || ev.shiftKey || ev.altKey) return null;
    const g = this._gripAt(ev);
    if (!g) return null;
    const sid = this.sketchId;
    const e0 = getSketch(sid)?.sketch.entities.find(x => x.id === g.id);
    if (!e0) return null;
    const orig = structuredClone(e0);
    const snap = snapshot();
    const entity = () => getSketch(sid)?.sketch.entities.find(x => x.id === g.id);
    let moved = false;
    this.dragGrip = g;
    this.hoverGrip = g;
    const refresh = () => {
      this._redraw();
      this.sync?.sync();
      emit('transform');
    };
    return {
      move: ev2 => {
        const q = this._snap(this._local(ev2), g.id);
        const ent = entity();
        const next = q && ent && applyGrip(orig, g, [q.x, q.y]);
        if (!next) return;
        Object.assign(ent, next);
        moved = true;
        this.cursor = q;
        document.getElementById('st-coords').textContent = `U ${fmt(q.x, 3)}  V ${fmt(q.y, 3)}${q.snapped ? `  [${q.snapped}]` : ''}`;
        refresh();
      },
      end: (ev2, cancel) => {
        this.dragGrip = null;
        const ent = entity();
        if (cancel && moved && ent) {
          for (const k of Object.keys(ent)) delete ent[k];
          Object.assign(ent, orig);
        } else if (moved) {
          commitSnapshot(snap);
          status(t('Entità modificata: Ctrl+Z per annullare'));
        }
        this.hoverGrip = this._gripAt(ev2);
        this.vp.el.classList.toggle('grip-hover', !!this.hoverGrip);
        refresh();
      },
    };
  }

  _point(p, px = 0.1) {
    const tool = this.tool;
    if (tool === 'select') { this._pick(p, px); return; }
    if (tool === 'polyline') {
      if (this.pts.length >= 3 && Math.hypot(p[0] - this.pts[0][0], p[1] - this.pts[0][1]) < px * 9) { this._finishPolyline(); return; }
      const last = this.pts[this.pts.length - 1];
      if (last && Math.hypot(p[0] - last[0], p[1] - last[1]) < 1e-9) return;
      this.pts.push(p);
    } else if (tool === 'rect') {
      if (!this.pts.length) this.pts.push(p);
      else {
        const [a] = this.pts;
        if (Math.abs(p[0] - a[0]) < 1e-9 || Math.abs(p[1] - a[1]) < 1e-9) { toast(t('Rettangolo degenere'), 'warn'); return; }
        // x1, y1: il primo punto cliccato (riferimento del rettangolo); x2, y2: l'angolo opposto
        this._add({ kind: 'rect', x1: a[0], y1: a[1], x2: p[0], y2: p[1] });
      }
    } else if (tool === 'circle' || tool === 'polygon') {
      if (!this.pts.length) this.pts.push(p);
      else {
        const [c] = this.pts;
        const rr = Math.hypot(p[0] - c[0], p[1] - c[1]);
        if (rr < 1e-6) return;
        if (tool === 'circle') this._add({ kind: 'circle', cx: c[0], cy: c[1], r: rr });
        else {
          const rot = THREE.MathUtils.radToDeg(Math.atan2(p[1] - c[1], p[0] - c[0]));
          this._add({ kind: 'polygon', cx: c[0], cy: c[1], r: rr, sides: Math.max(3, Math.round(evalNum(this.sides.value) || 6)), rot });
        }
      }
    }
    this._redraw();
  }

  _finishPolyline() {
    if (this.pts.length < 3) {
      if (this.pts.length) toast(t('Servono almeno 3 vertici'), 'warn');
      return;
    }
    this._add({ kind: 'polyline', pts: this.pts.map(p => [p[0], p[1]]), closed: true });
  }

  /**
   * Aggiunge l'entità appena disegnata: resta selezionata e si torna allo strumento Seleziona, così si vedono
   * subito le sue maniglie (per disegnarne un'altra si riprende lo strumento).
   */
  _add(ent) {
    const id = uid('e');
    const sid = this.sketchId;
    mutate(() => {
      const r = getSketch(sid);
      r.sketch.entities.push({ id, ...ent });
    });
    this.pts = [];
    select({ type: 'entity', id, sketchId: sid });
    this.setTool('select');
    status(t('Entità aggiunta allo sketch: trascina i suoi punti per modificarla, o scegli uno strumento per disegnarne un\'altra'));
  }

  _pick(p, px, add = false) {
    const r = getSketch(this.sketchId);
    if (!r) return;
    let best = null, bd = px * 8;
    for (const e of r.sketch.entities) {
      const d = distToLoop(p[0], p[1], entityLoop(e));
      if (d < bd) { bd = d; best = e; }
    }
    const ref = best ? { type: 'entity', id: best.id, sketchId: this.sketchId } : null;
    // Ctrl+clic: aggiunge o toglie l'entità dalla selezione (entità dello stesso sketch)
    if (add && ref) {
      if (App.selected.some(s => s.type !== 'entity' || s.sketchId !== this.sketchId)) select(ref);
      else toggleSelect(ref);
      return;
    }
    if (ref) select(ref);
    else if (!add) select({ type: 'sketch', id: this.sketchId });
  }

  // ---------------------------------------------------------------- grafica di anteprima
  _clearGraphics() {
    for (const c of [...this.group.children]) {
      c.removeFromParent();
      // le texture delle maniglie sono condivise: material.dispose() non le libera
      c.traverse(o => { o.geometry?.dispose(); o.material?.dispose(); });
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
    // maniglie delle entità selezionate
    const grips = this._grips();
    if (grips.length) this.group.add(gripPoints(grips, this.dragGrip || this.hoverGrip));
    // cursore a croce
    if (c) {
      const s = px * (settings.sizes.cursor || 14);
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

// ------------------------------------------------------------------ maniglie
/** Punti di riferimento di un'entità: { id, role, i, x, y } in coordinate del piano. */
function entityGrips(e) {
  const g = (role, x, y, i = 0) => ({ id: e.id, role, i, x, y });
  switch (e.kind) {
    case 'rect': {
      const mx = (e.x1 + e.x2) / 2, my = (e.y1 + e.y2) / 2;
      return [
        g('corner', e.x1, e.y1, 0), g('corner', e.x2, e.y1, 1), g('corner', e.x2, e.y2, 2), g('corner', e.x1, e.y2, 3),
        g('edge', mx, e.y1, 0), g('edge', e.x2, my, 1), g('edge', mx, e.y2, 2), g('edge', e.x1, my, 3),
        g('center', mx, my),
      ];
    }
    case 'circle':
      return [g('center', e.cx, e.cy), g('radius', e.cx + e.r, e.cy, 0), g('radius', e.cx, e.cy + e.r, 1), g('radius', e.cx - e.r, e.cy, 2), g('radius', e.cx, e.cy - e.r, 3)];
    case 'polygon':
      return [g('center', e.cx, e.cy), ...entityLoop(e).map((p, i) => g('pvertex', p[0], p[1], i))];
    case 'polyline': {
      const pts = e.pts || [];
      if (!pts.length) return [];
      const out = pts.map((p, i) => g('vertex', p[0], p[1], i));
      // punti medi dei lati: trascinandoli si inserisce un vertice (solo per polilinee non troppo dense)
      if (pts.length <= 400) {
        for (let i = 0; i < pts.length; i++) {
          const a = pts[i], b = pts[(i + 1) % pts.length];
          out.push(g('insert', (a[0] + b[0]) / 2, (a[1] + b[1]) / 2, i));
        }
      }
      let cx = 0, cy = 0;
      for (const p of pts) { cx += p[0]; cy += p[1]; }
      out.push(g('center', cx / pts.length, cy / pts.length));
      return out;
    }
  }
  return [];
}

/** Nuova geometria dell'entità (dall'originale e0) con la maniglia g portata nel punto p; null se degenere. */
function applyGrip(e0, g, p) {
  const [x, y] = p;
  const dx = x - g.x, dy = y - g.y;
  const ok = v => Math.abs(v) > 1e-6;
  switch (e0.kind) {
    case 'rect': {
      if (g.role === 'center') return { x1: e0.x1 + dx, y1: e0.y1 + dy, x2: e0.x2 + dx, y2: e0.y2 + dy };
      // si sposta solo l'angolo (o il lato) trascinato: l'opposto resta fermo e il primo punto resta x1, y1
      let { x1, y1, x2, y2 } = e0;
      if (g.role === 'corner') {
        if (g.i === 0 || g.i === 3) x1 = x; else x2 = x;
        if (g.i === 0 || g.i === 1) y1 = y; else y2 = y;
      } else if (g.role === 'edge') {
        if (g.i === 0) y1 = y;
        if (g.i === 2) y2 = y;
        if (g.i === 1) x2 = x;
        if (g.i === 3) x1 = x;
      }
      return ok(x2 - x1) && ok(y2 - y1) ? { x1, y1, x2, y2 } : null;
    }
    case 'circle': {
      if (g.role === 'center') return { cx: x, cy: y };
      const r = Math.hypot(x - e0.cx, y - e0.cy);
      return ok(r) ? { r } : null;
    }
    case 'polygon': {
      if (g.role === 'center') return { cx: x, cy: y };
      const r = Math.hypot(x - e0.cx, y - e0.cy);
      if (!ok(r)) return null;
      const n = Math.max(3, e0.sides | 0);
      // il vertice trascinato segue il puntatore: cambiano raggio e rotazione
      let rot = THREE.MathUtils.radToDeg(Math.atan2(y - e0.cy, x - e0.cx)) - g.i * 360 / n;
      rot = ((rot % 360) + 540) % 360 - 180;
      return { r, rot: Math.round(rot * 1e6) / 1e6 };
    }
    case 'polyline': {
      const pts = (e0.pts || []).map(q => [q[0], q[1]]);
      if (g.role === 'center') return { pts: pts.map(q => [q[0] + dx, q[1] + dy]) };
      if (g.role === 'vertex') { pts[g.i] = [x, y]; return { pts }; }
      if (g.role === 'insert') { pts.splice(g.i + 1, 0, [x, y]); return { pts }; }
    }
  }
  return null;
}

function sameGrip(a, b) {
  return a === b || (!!a && !!b && a.id === b.id && a.role === b.role && a.i === b.i);
}

const GRIP_TEX = {};
/** Texture delle maniglie (create una volta): quadrato, cerchio, rombo bianchi con bordo scuro, tinti dal colore. */
function gripTexture(shape) {
  if (GRIP_TEX[shape]) return GRIP_TEX[shape];
  const n = 32, cv = document.createElement('canvas');
  cv.width = cv.height = n;
  const c = cv.getContext('2d');
  c.fillStyle = '#ffffff';
  c.strokeStyle = '#0b1220';
  c.lineWidth = 4;
  c.beginPath();
  if (shape === 'circle') c.arc(n / 2, n / 2, n / 2 - 3, 0, Math.PI * 2);
  else if (shape === 'diamond') { c.moveTo(n / 2, 2); c.lineTo(n - 2, n / 2); c.lineTo(n / 2, n - 2); c.lineTo(2, n / 2); c.closePath(); }
  else c.rect(3, 3, n - 6, n - 6);
  c.fill();
  c.stroke();
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return (GRIP_TEX[shape] = tex);
}

/** Maniglie come punti di dimensione costante sullo schermo; quella sotto il puntatore è evidenziata. */
function gripPoints(grips, hot) {
  const g = new THREE.Group();
  const kinds = [
    { shape: 'square', size: 9, roles: ['corner', 'vertex', 'pvertex'], color: 0x7cf2ff },
    { shape: 'diamond', size: 10, roles: ['edge', 'radius'], color: 0x7cf2ff },
    { shape: 'diamond', size: 7, roles: ['insert'], color: 0x9fb4c8, opacity: 0.75 },
    { shape: 'circle', size: 11, roles: ['center'], color: 0xffe066 },
  ];
  for (const k of kinds) {
    const list = grips.filter(x => k.roles.includes(x.role));
    if (!list.length) continue;
    const add = (items, col, size) => {
      const geo = new THREE.BufferGeometry().setFromPoints(items.map(x => new THREE.Vector3(x.x, x.y, 0.08)));
      const pts = new THREE.Points(geo, new THREE.PointsMaterial({
        size, sizeAttenuation: false, map: gripTexture(k.shape), color: col, transparent: true, opacity: k.opacity ?? 1,
        alphaTest: 0.3, depthTest: false, depthWrite: false,
      }));
      pts.renderOrder = 22;
      pts.raycast = () => {};
      g.add(pts);
    };
    const cold = list.filter(x => !sameGrip(x, hot));
    if (cold.length) add(cold, k.color, k.size);
    if (cold.length < list.length) add(list.filter(x => sameGrip(x, hot)), 0xff8a3d, k.size + 4);
  }
  return g;
}

function square(p, s, color) {
  const pts = [[-s, -s], [s, -s], [s, s], [-s, s]].map(d => new THREE.Vector3(p[0] + d[0], p[1] + d[1], 0.06));
  const l = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color, depthTest: false, transparent: true }));
  l.renderOrder = 21;
  return l;
}
