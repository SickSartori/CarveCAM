// Simulazione del percorso: utensile animato lungo i movimenti con tempi reali (avanzamenti) e percorso progressivo.
import * as THREE from 'three';
import { App, getOperation, getSketch } from './state.js';
import { planeFrame, frameQuaternion } from './geom.js';
import { toast } from './dialogs.js';

const RAPID_RATE = 5000; // mm/min

export class Simulator {
  constructor(vp, sync) {
    this.vp = vp;
    this.sync = sync;
    this.opId = null;
    this.playing = false;
    this.bar = document.getElementById('sim-bar');
    this.slider = document.getElementById('sim-slider');
    this.speed = document.getElementById('sim-speed');
    this.timeEl = document.getElementById('sim-time');
    this.playBtn = document.getElementById('sim-play');
    this.playBtn.onclick = () => this.toggle();
    document.getElementById('sim-rew').onclick = () => { this.t = 0; this._apply(); };
    document.getElementById('sim-close').onclick = () => this.stop();
    this.slider.addEventListener('input', () => { this.t = (this.slider.value / 1000) * this.total; this._apply(); });
    vp.frameHooks.add(dt => this._tick(dt));
  }

  get active() { return !!this.opId; }

  start(opId) {
    const op = getOperation(opId);
    const data = App.runtime.toolpaths.get(opId);
    if (!op || !data) { toast('Calcolare prima il percorso', 'warn'); return; }
    this.stop();
    const sk = getSketch(op.sketchId);
    if (!sk) return;
    const f = planeFrame(sk.plane);
    this.opId = opId;
    this.data = data;
    const { positions, types } = data;
    const n = types.length;
    // tempi cumulati (minuti)
    this.T = new Float64Array(n);
    for (let i = 1; i < n; i++) {
      const dx = positions[i * 3] - positions[i * 3 - 3], dy = positions[i * 3 + 1] - positions[i * 3 - 2], dz = positions[i * 3 + 2] - positions[i * 3 - 1];
      const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
      const rate = types[i] === 0 ? RAPID_RATE : types[i] === 2 ? op.plunge : types[i] === 3 ? (op.rampFeed || op.feed) : op.feed;
      this.T[i] = this.T[i - 1] + len / Math.max(1, rate);
    }
    this.total = this.T[n - 1] || 0;
    this.t = 0;
    this.tool = makeTool(op.tool);
    this.tool.quaternion.copy(frameQuaternion(f));
    this.vp.scene.add(this.tool);
    this.bar.hidden = false;
    this.playing = true;
    this._apply();
  }

  stop() {
    if (!this.opId) return;
    this.sync.setToolpathProgress(this.opId, null);
    if (this.tool) {
      this.tool.removeFromParent();
      this.tool.traverse(o => { o.geometry?.dispose(); o.material?.dispose(); });
    }
    this.tool = null;
    this.opId = null;
    this.playing = false;
    this.bar.hidden = true;
  }

  toggle() {
    if (!this.opId) return;
    if (this.t >= this.total) this.t = 0;
    this.playing = !this.playing;
    this._apply();
  }

  _tick(dt) {
    if (!this.opId || !this.playing) return;
    this.t += (dt / 60) * Number(this.speed.value);
    if (this.t >= this.total) { this.t = this.total; this.playing = false; }
    this._apply();
  }

  _apply() {
    if (!this.opId) return;
    const { positions } = this.data;
    const T = this.T;
    // ricerca binaria del segmento
    let lo = 0, hi = T.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (T[mid] < this.t) lo = mid + 1; else hi = mid;
    }
    const i = Math.max(1, lo);
    const t0 = T[i - 1], t1 = T[i];
    const k = t1 > t0 ? Math.min(1, Math.max(0, (this.t - t0) / (t1 - t0))) : 1;
    const a = (i - 1) * 3, b = i * 3;
    this.tool.position.set(
      positions[a] + (positions[b] - positions[a]) * k,
      positions[a + 1] + (positions[b + 1] - positions[a + 1]) * k,
      positions[a + 2] + (positions[b + 2] - positions[a + 2]) * k);
    this.sync.setToolpathProgress(this.opId, k >= 1 ? i : i - 1);
    this.slider.value = this.total ? Math.round((this.t / this.total) * 1000) : 0;
    this.timeEl.textContent = `${mmss(this.t)} / ${mmss(this.total)}`;
    this.playBtn.innerHTML = this.playing ? '&#10074;&#10074;' : '&#9654;';
  }
}

function mmss(min) {
  const s = Math.round(min * 60);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** Utensile orientato lungo +Z locale, punta nell'origine (profilo di rivoluzione: piatto, torico o sferico). */
function makeTool(tool) {
  const R = (tool.diameter || 6) / 2;
  const L = Math.max(4 * R, 20);
  const r = tool.type === 'ball' ? R : tool.type === 'bull' ? Math.min(R, Math.max(0, tool.cornerRadius ?? 1)) : 0;
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: 0xd4dbe3, metalness: 0.7, roughness: 0.25 });
  const flutes = new THREE.MeshStandardMaterial({ color: 0x9fb4c8, metalness: 0.6, roughness: 0.3, side: THREE.DoubleSide });
  // profilo (raggio, quota) dall'asse sul fondo fino alla sommità dei taglienti
  const prof = [new THREE.Vector2(0, 0)];
  if (r > 0) {
    const rf = R - r;
    if (rf > 1e-6) prof.push(new THREE.Vector2(rf, 0));
    for (let i = 1; i <= 16; i++) {
      const a = -Math.PI / 2 + (i / 16) * (Math.PI / 2);
      prof.push(new THREE.Vector2(rf + r * Math.cos(a), r + r * Math.sin(a)));
    }
  } else {
    prof.push(new THREE.Vector2(R, 0));
  }
  prof.push(new THREE.Vector2(R, L), new THREE.Vector2(0, L));
  const cutter = new THREE.Mesh(new THREE.LatheGeometry(prof, 40).rotateX(Math.PI / 2), flutes);
  g.add(cutter);
  const shank = new THREE.Mesh(new THREE.CylinderGeometry(R, R, L, 32).rotateX(Math.PI / 2), mat);
  shank.position.z = L * 1.5;
  const holder = new THREE.Mesh(new THREE.CylinderGeometry(R * 2.4, R * 2.4, L * 0.8, 32).rotateX(Math.PI / 2),
    new THREE.MeshStandardMaterial({ color: 0x5b6570, metalness: 0.5, roughness: 0.4, transparent: true, opacity: 0.85 }));
  holder.position.z = L * 2 + L * 0.4;
  g.add(shank, holder);
  g.traverse(o => { o.raycast = () => {}; });
  return g;
}
