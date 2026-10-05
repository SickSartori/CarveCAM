// Simulazione dei percorsi: utensile animato lungo i movimenti con tempi reali (avanzamenti) e percorso
// progressivo. Si simula la lavorazione selezionata da sola oppure seguita da tutte le successive, fino
// all'ultima; durante la simulazione un riquadro mostra le coordinate del TCP (X, Y, Z, A, C).
import * as THREE from 'three';
import { App, getOperation, getSketch } from './state.js';
import { api } from './api.js';
import { color } from './settings.js';
import { parseStockMap, liftTable, StockView } from './stocksim.js';
import { planeFrame, frameQuaternion, fmt } from './geom.js';
import { toast, h } from './dialogs.js';
import { t } from './i18n.js';
import { log } from './log.js';
import { buildToolMesh } from './tool3d.js';

const RAPID_RATE = 5000; // mm/min
const R2D = 180 / Math.PI;
const SCOPE_KEY = 'carvecam.sim.scope';

export class Simulator {
  constructor(vp, sync) {
    this.vp = vp;
    this.sync = sync;
    this.opId = null;          // lavorazione di partenza (quella selezionata)
    this.segs = [];
    this.stockVer = 0;         // caricamento del grezzo in corso (si annulla chiudendo la simulazione)
    this.playing = false;
    this.prepare = async () => true;   // calcola i percorsi mancanti (impostato dai comandi)
    try { this.scope = localStorage.getItem(SCOPE_KEY) === 'rest' ? 'rest' : 'one'; } catch { this.scope = 'one'; }
    this.bar = document.getElementById('sim-bar');
    this.slider = document.getElementById('sim-slider');
    this.speed = document.getElementById('sim-speed');
    this.timeEl = document.getElementById('sim-time');
    this.playBtn = document.getElementById('sim-play');
    this.opEl = document.getElementById('sim-op');
    this.scopeBtn = document.getElementById('sim-scope');
    this.playBtn.onclick = () => this.toggle();
    document.getElementById('sim-rew').onclick = () => { this.t = 0; this._apply(); };
    document.getElementById('sim-close').onclick = () => this.stop();
    for (const b of this.scopeBtn.querySelectorAll('[data-scope]')) b.onclick = () => { if (b.dataset.scope !== this.scope) this.setScope(b.dataset.scope); };
    this.slider.addEventListener('input', () => { this.t = (this.slider.value / 1000) * this.total; this._apply(); });
    this._buildTcp();
    this._syncScope();
    vp.frameHooks.add(dt => this._tick(dt));
  }

  get active() { return !!this.opId; }

  /** Lavorazioni da simulare a partire da opId secondo l'ambito scelto. */
  listFor(opId, scope = this.scope) {
    const ops = App.project.operations;
    const i = ops.findIndex(o => o.id === opId);
    if (i < 0) return [];
    return scope === 'rest' ? ops.slice(i).map(o => o.id) : [opId];
  }

  /** Avvia la simulazione dalla lavorazione opId (le successive se l'ambito è "fino all'ultima"). */
  start(opId, scope) {
    if (scope) this.scope = scope;
    this._syncScope();
    const ids = this.listFor(opId);
    const segs = [];
    let t0 = 0;
    for (const id of ids) {
      const op = getOperation(id);
      const data = App.runtime.toolpaths.get(id);
      const sk = op && getSketch(op.sketchId);
      if (!op || !data || !sk) continue;
      const { positions, types } = data;
      const n = types.length;
      const T = new Float64Array(n);
      for (let i = 1; i < n; i++) {
        const dx = positions[i * 3] - positions[i * 3 - 3], dy = positions[i * 3 + 1] - positions[i * 3 - 2], dz = positions[i * 3 + 2] - positions[i * 3 - 1];
        const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
        const rate = types[i] === 0 ? RAPID_RATE : types[i] === 2 ? op.plunge : types[i] === 3 ? (op.rampFeed || op.feed) : op.feed;
        T[i] = T[i - 1] + len / Math.max(1, rate);
      }
      const f = planeFrame(sk.plane);
      segs.push({ id, op, data, T, t0, total: T[n - 1] || 0, q: frameQuaternion(f), n: f.n.clone() });
      t0 += T[n - 1] || 0;
    }
    if (!segs.length) { toast(t('Calcolare prima il percorso'), 'warn'); return; }
    this.stop();
    this.opId = opId;
    this.segs = segs;
    this.total = t0;
    this.t = 0;
    this.cur = -1;
    for (const s of segs) this.sync.setToolpathProgress(s.id, -1, true);
    this.sync.sync();
    this.bar.hidden = false;
    this.tcp.hidden = false;
    this.playing = true;
    log.info('Simulazione avviata', { ops: segs.map(s => s.op.name), scope: this.scope, minutes: Math.round(this.total * 100) / 100 });
    this._apply();
    this._loadStock();
  }

  /** Grezzo di ogni lavorazione (dal server, nel sistema del suo piano): mentre la fresa passa se ne vede l'erosione. */
  async _loadStock() {
    const segs = this.segs;
    const ver = ++this.stockVer;
    for (const s of segs) {
      if (!s.data.hasStock) continue;
      try {
        const map = parseStockMap(await api.getStock(s.data.toolpathId));
        if (ver !== this.stockVer) return;   // simulazione chiusa o riavviata nel frattempo
        const view = new StockView(map, color('stock'));
        // percorso nel sistema del piano della mappa
        const { o, u, v, n } = map.frame;
        const P = s.data.positions, L = new Float32Array(P.length);
        for (let i = 0; i < P.length; i += 3) {
          const dx = P[i] - o.x, dy = P[i + 1] - o.y, dz = P[i + 2] - o.z;
          L[i] = dx * u.x + dy * u.y + dz * u.z;
          L[i + 1] = dx * v.x + dy * v.y + dz * v.z;
          L[i + 2] = dx * n.x + dy * n.y + dz * n.z;
        }
        Object.assign(s, { stock: view, local: L, lift: liftTable(s.op.tool), applied: 0, lastT: 0 });
        view.mesh.visible = false;
        this.vp.scene.add(view.mesh);
      } catch (e) {
        log.warn('Grezzo della simulazione non disponibile', e);
      }
    }
    if (ver !== this.stockVer || !segs.some(s => s.stock)) return;
    App.runtime.simStock = true;   // i solidi del grezzo si nascondono: si vede quello eroso
    this.sync.sync();
    this._apply();
  }

  /** Erosione fino al punto i del percorso (kk: frazione del tratto in corso), solo sul grezzo della lavorazione k. */
  _erode(k, seg, i, kk, lt) {
    this.segs.forEach((s, j) => { if (s.stock) s.stock.mesh.visible = j === k; });
    const st = seg.stock;
    if (!st) return;
    const L = seg.local, types = seg.data.types, lift = seg.lift;
    if (lt < seg.lastT - 1e-9) { st.reset(); seg.applied = 0; }   // all'indietro: si riparte dal grezzo iniziale
    for (let s = seg.applied + 1; s <= i - 1; s++) {
      if (types[s] !== 0) st.stampSegment(L[s * 3 - 3], L[s * 3 - 2], L[s * 3 - 1], L[s * 3], L[s * 3 + 1], L[s * 3 + 2], lift);
    }
    if (i - 1 > seg.applied) seg.applied = i - 1;
    if (types[i] !== 0 && kk > 0) {
      const a = (i - 1) * 3, b = i * 3;
      st.stampSegment(L[a], L[a + 1], L[a + 2], L[a] + (L[b] - L[a]) * kk, L[a + 1] + (L[b + 1] - L[a + 1]) * kk, L[a + 2] + (L[b + 2] - L[a + 2]) * kk, lift);
    }
    st.flush();
    seg.lastT = lt;
  }

  stop() {
    if (!this.opId) return;
    this.stockVer++;
    for (const s of this.segs) s.stock?.dispose();
    App.runtime.simStock = false;
    for (const s of this.segs) this.sync.setToolpathProgress(s.id, null, false);
    this._removeTool();
    this.opId = null;
    this.segs = [];
    this.playing = false;
    this.bar.hidden = true;
    this.tcp.hidden = true;
    this.sync.sync();
  }

  toggle() {
    if (!this.opId) return;
    if (this.t >= this.total) this.t = 0;
    this.playing = !this.playing;
    this._apply();
  }

  async setScope(scope) {
    this.scope = scope;
    try { localStorage.setItem(SCOPE_KEY, scope); } catch { /* storage non disponibile */ }
    this._syncScope();
    if (!this.opId) return;
    const id = this.opId;
    const playing = this.playing;
    if (!(await this.prepare(this.listFor(id, scope)))) return;
    this.start(id, scope);
    this.playing = playing;
    this._apply();
  }

  /** Selettore dell'ambito: solo la lavorazione selezionata, oppure dalla selezionata fino all'ultima. */
  _syncScope() {
    for (const b of this.scopeBtn.querySelectorAll('[data-scope]')) b.setAttribute('aria-checked', String(b.dataset.scope === this.scope));
  }

  _tick(dt) {
    if (!this.opId || !this.playing) return;
    this.t += (dt / 60) * Number(this.speed.value);
    if (this.t >= this.total) { this.t = this.total; this.playing = false; }
    this._apply();
  }

  _removeTool() {
    if (this.tool) {
      this.tool.removeFromParent();
      this.tool.traverse(o => { o.geometry?.dispose(); o.material?.dispose(); });
    }
    this.tool = null;
  }

  _apply() {
    if (!this.opId) return;
    // lavorazione in corso
    let k = this.segs.findIndex(s => this.t <= s.t0 + s.total);
    if (k < 0) k = this.segs.length - 1;
    const seg = this.segs[k];
    if (k !== this.cur) {
      this.cur = k;
      this._removeTool();
      this.tool = makeTool(seg.op.tool);
      this.tool.quaternion.copy(seg.q);
      this.vp.scene.add(this.tool);
      this.opEl.textContent = this.segs.length > 1 ? `${k + 1}/${this.segs.length} · ${seg.op.name}` : seg.op.name;
      this.segs.forEach((s, j) => { if (j !== k) this.sync.setToolpathProgress(s.id, j < k ? null : -1, true); });
    }
    const { positions } = seg.data;
    const T = seg.T;
    const lt = this.t - seg.t0;
    // ricerca binaria del segmento
    let lo = 0, hi = T.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (T[mid] < lt) lo = mid + 1; else hi = mid;
    }
    const i = Math.max(1, lo);
    const t0 = T[i - 1], t1 = T[i];
    const kk = t1 > t0 ? Math.min(1, Math.max(0, (lt - t0) / (t1 - t0))) : 1;
    const a = (i - 1) * 3, b = i * 3;
    this.tool.position.set(
      positions[a] + (positions[b] - positions[a]) * kk,
      positions[a + 1] + (positions[b + 1] - positions[a + 1]) * kk,
      positions[a + 2] + (positions[b + 2] - positions[a + 2]) * kk);
    this.sync.setToolpathProgress(seg.id, kk >= 1 ? i : i - 1, true);
    this._erode(k, seg, i, kk, lt);
    this.slider.value = this.total ? Math.round((this.t / this.total) * 1000) : 0;
    this.timeEl.textContent = `${mmss(this.t)} / ${mmss(this.total)}`;
    this.playBtn.innerHTML = this.playing ? '&#10074;&#10074;' : '&#9654;';
    this._updateTcp(this.tool.position, seg.n);
  }

  // ---------------------------------------------------------------- coordinate del TCP
  _buildTcp() {
    this.tcp = h('div', { id: 'tcp-box', class: 'overlay tcp-box', hidden: true, 'aria-live': 'off' },
      h('div', { class: 'tcp-title' }, t('Coordinate TCP')));
    this.tcpVals = {};
    for (const ax of ['X', 'Y', 'Z', 'A', 'C']) {
      const v = h('span', { class: 'tcp-v' }, '–');
      this.tcpVals[ax] = v;
      this.tcp.append(h('div', { class: 'tcp-row', 'data-ax': ax }, h('span', { class: 'tcp-ax' }, ax), v, h('span', { class: 'tcp-u' }, ax === 'A' || ax === 'C' ? '°' : 'mm')));
    }
    this.vp.el.append(this.tcp);
  }

  /** X, Y, Z: punta utensile nel sistema del progetto; A (attorno a X) e C (attorno a Z): orientamento dell'asse utensile. */
  _updateTcp(p, n) {
    const A = Math.acos(Math.max(-1, Math.min(1, n.z))) * R2D;
    let C = Math.abs(Math.sin(A / R2D)) > 1e-9 ? Math.atan2(n.x, -n.y) * R2D : 0;
    if (Math.abs(C) < 1e-9) C = 0;
    const v = this.tcpVals;
    v.X.textContent = fmt(p.x, 3);
    v.Y.textContent = fmt(p.y, 3);
    v.Z.textContent = fmt(p.z, 3);
    v.A.textContent = fmt(A, 3);
    v.C.textContent = fmt(C, 3);
  }
}

function mmss(min) {
  const s = Math.round(min * 60);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** Utensile della simulazione: generato dai suoi parametri (vedi tool3d.js). */
function makeTool(tool) {
  return buildToolMesh(tool);
}
