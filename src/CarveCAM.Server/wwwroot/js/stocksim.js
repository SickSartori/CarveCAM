// Grezzo nella simulazione: per ogni lavorazione il server fornisce la mappa delle quote del grezzo prima della
// lavorazione, nel sistema del suo piano (colonne di materiale da Bottom a Top lungo la normale). Qui diventa una
// superficie che si abbassa dove passa la fresa, con il profilo del tagliente: si vede l'erosione del materiale.
import * as THREE from 'three';
import { taperGeom } from './oplib.js';

const THIN = 1e-4;
const LIFT_N = 512;

/** Mappa del grezzo dal formato binario del server (StockMap.ToBinary). */
export function parseStockMap(buf) {
  const dv = new DataView(buf);
  const nu = dv.getInt32(0, true), nv = dv.getInt32(4, true);
  const f = k => dv.getFloat64(8 + k * 8, true);
  const head = 8 + 15 * 8, cells = nu * nv;
  return {
    nu, nv, u0: f(0), v0: f(1), res: f(2),
    frame: {
      o: new THREE.Vector3(f(3), f(4), f(5)), u: new THREE.Vector3(f(6), f(7), f(8)),
      v: new THREE.Vector3(f(9), f(10), f(11)), n: new THREE.Vector3(f(12), f(13), f(14)),
    },
    top: new Float32Array(buf.slice(head, head + cells * 4)),
    bottom: new Float32Array(buf.slice(head + cells * 4, head + cells * 8)),
  };
}

/** Altezza del tagliente sopra la punta a distanza q dall'asse, in tabella da 0 al raggio massimo. */
export function liftTable(tool = {}) {
  let rMax, lift;
  if (tool.type === 'taper') {
    const g = taperGeom(tool);
    rMax = Math.max(0.001, g.R);
    lift = q => {
      if (g.ball && q <= g.q0) return g.rt - Math.sqrt(Math.max(0, g.rt * g.rt - q * q));
      if (!g.ball && q <= g.rt) return 0;
      return g.h0 + (q - g.q0) / g.tn;
    };
  } else {
    const R = Math.max(0.001, (tool.diameter || 6) / 2);
    const r = tool.type === 'ball' ? R : tool.type === 'bull' ? Math.min(R, Math.max(0, tool.cornerRadius ?? 1)) : 0;
    const rf = R - r;
    rMax = R;
    lift = q => (q <= rf ? 0 : r - Math.sqrt(Math.max(0, r * r - (q - rf) * (q - rf))));
  }
  const tab = new Float32Array(LIFT_N + 1);
  for (let k = 0; k <= LIFT_N; k++) tab[k] = lift(rMax * k / LIFT_N);
  return { rMax, tab };
}

/** Grezzo di una lavorazione mostrato come superficie (sommità e pareti sul bordo) che la fresa erode. */
export class StockView {
  constructor(map, color) {
    this.map = map;
    this.orig = map.top.slice();
    const { nu, nv, u0, v0, res, top, bottom } = map;
    const has = i => top[i] > bottom[i] + THIN;
    const cells = nu * nv;
    // vertici: uno per cella (sommità, si abbassa) e uno sul fondo per le celle sul bordo (pareti)
    const pos = [];
    for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
      const k = j * nu + i;
      pos.push(u0 + i * res, v0 + j * res, has(k) ? top[k] : 0);
    }
    const bottomIdx = new Int32Array(cells).fill(-1);
    const bot = k => {
      if (bottomIdx[k] < 0) {
        bottomIdx[k] = pos.length / 3;
        pos.push(pos[k * 3], pos[k * 3 + 1], bottom[k]);
      }
      return bottomIdx[k];
    };
    const quad = (i, j) => i >= 0 && j >= 0 && i < nu - 1 && j < nv - 1 &&
      has(j * nu + i) && has(j * nu + i + 1) && has((j + 1) * nu + i) && has((j + 1) * nu + i + 1);
    const idx = [];
    const wall = (a, b) => { const ba = bot(a), bb = bot(b); idx.push(a, ba, bb, a, bb, b); };
    for (let j = 0; j < nv - 1; j++) for (let i = 0; i < nu - 1; i++) {
      if (!quad(i, j)) continue;
      const k00 = j * nu + i, k10 = k00 + 1, k01 = k00 + nu, k11 = k01 + 1;
      idx.push(k00, k10, k11, k00, k11, k01);
      if (!quad(i, j - 1)) wall(k00, k10);
      if (!quad(i, j + 1)) wall(k11, k01);
      if (!quad(i - 1, j)) wall(k01, k00);
      if (!quad(i + 1, j)) wall(k10, k11);
    }
    const g = new THREE.BufferGeometry();
    this.pos = new THREE.Float32BufferAttribute(pos, 3);
    this.pos.setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('position', this.pos);
    g.setIndex(pos.length / 3 > 65535 ? new THREE.Uint32BufferAttribute(idx, 1) : new THREE.Uint16BufferAttribute(idx, 1));
    g.computeBoundingSphere();
    const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.85, metalness: 0, flatShading: true, side: THREE.DoubleSide,
      polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 });
    this.mesh = new THREE.Mesh(g, mat);
    this.mesh.raycast = () => {};
    const f = map.frame;
    this.mesh.matrixAutoUpdate = false;
    this.mesh.matrix.makeBasis(f.u, f.v, f.n).setPosition(f.o);
    this.mesh.matrixWorldNeedsUpdate = true;
    this.lo = Infinity;
    this.hi = -1;
  }

  /** Grezzo com'era all'inizio della lavorazione. */
  reset() {
    this.map.top.set(this.orig);
    this.lo = 0;
    this.hi = this.map.nu * this.map.nv - 1;
  }

  /** Fresa con la punta in (u, v, w) (sistema del piano): la sommità scende fino al profilo del tagliente. */
  stamp(u, v, w, lift) {
    const { nu, nv, u0, v0, res, top, bottom } = this.map;
    const { rMax, tab } = lift;
    const i0 = Math.max(0, Math.ceil((u - rMax - u0) / res)), i1 = Math.min(nu - 1, Math.floor((u + rMax - u0) / res));
    const j0 = Math.max(0, Math.ceil((v - rMax - v0) / res)), j1 = Math.min(nv - 1, Math.floor((v + rMax - v0) / res));
    const r2 = rMax * rMax, sc = LIFT_N / rMax;
    for (let j = j0; j <= j1; j++) {
      const dv = v0 + j * res - v;
      for (let i = i0; i <= i1; i++) {
        const k = j * nu + i;
        if (top[k] <= w || top[k] <= bottom[k] + THIN) continue;
        const du = u0 + i * res - u;
        const q2 = du * du + dv * dv;
        if (q2 > r2) continue;
        const x = Math.sqrt(q2) * sc, m = Math.min(LIFT_N - 1, x | 0);
        const tw = w + tab[m] + (tab[m + 1] - tab[m]) * (x - m);
        if (top[k] > tw) {
          top[k] = Math.max(tw, bottom[k]);
          if (k < this.lo) this.lo = k;
          if (k > this.hi) this.hi = k;
        }
      }
    }
  }

  /** Tratto da a a b (sistema del piano), campionato a mezza cella. */
  stampSegment(ax, ay, az, bx, by, bz, lift) {
    const len = Math.hypot(bx - ax, by - ay);
    const n = Math.max(1, Math.ceil(len / (this.map.res * 0.5)));
    for (let s = 0; s <= n; s++) {
      const t = s / n;
      this.stamp(ax + (bx - ax) * t, ay + (by - ay) * t, az + (bz - az) * t, lift);
    }
  }

  /** Porta sulla scheda video solo le celle cambiate. */
  flush() {
    if (this.hi < this.lo) return;
    const a = this.pos.array, top = this.map.top;
    for (let k = this.lo; k <= this.hi; k++) a[k * 3 + 2] = top[k];
    this.pos.clearUpdateRanges();
    this.pos.addUpdateRange(this.lo * 3, (this.hi - this.lo + 1) * 3);
    this.pos.needsUpdate = true;
    this.lo = Infinity;
    this.hi = -1;
  }

  dispose() {
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
  }
}
