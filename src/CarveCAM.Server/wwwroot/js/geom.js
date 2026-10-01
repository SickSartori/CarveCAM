// Geometria condivisa tra vista e calcolo: sistema di riferimento dei piani e contorni degli sketch.
// Le convenzioni coincidono con quelle del motore VB.NET (PlaneFrame, SketchGeometry).
import * as THREE from 'three';

const X = new THREE.Vector3(1, 0, 0);
const Y = new THREE.Vector3(0, 1, 0);

/** Asse U di riferimento: X, oppure Y se la normale è quasi parallela a X. */
export function defaultU(n) {
  const ref = Math.abs(n.x) < 0.9 ? X : Y;
  return ref.clone().sub(n.clone().multiplyScalar(ref.dot(n))).normalize();
}

/** Sistema del piano: origine o, assi u,v nel piano, normale n (= asse utensile). */
export function planeFrame(pl) {
  const n = new THREE.Vector3().fromArray(pl.normal || [0, 0, 1]);
  if (n.lengthSq() < 1e-12) n.set(0, 0, 1);
  n.normalize();
  const u0 = defaultU(n);
  const a = THREE.MathUtils.degToRad(pl.angle || 0);
  const u = u0.clone().multiplyScalar(Math.cos(a)).add(n.clone().cross(u0).multiplyScalar(Math.sin(a))).normalize();
  const v = n.clone().cross(u);
  const o = new THREE.Vector3().fromArray(pl.origin || [0, 0, 0]);
  return { o, u, v, n };
}

export function frameMatrix(f) {
  const m = new THREE.Matrix4().makeBasis(f.u, f.v, f.n);
  m.setPosition(f.o);
  return m;
}

export function frameQuaternion(f) {
  return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(f.u, f.v, f.n));
}

export function toLocal(f, p) {
  const d = p.clone().sub(f.o);
  return new THREE.Vector3(d.dot(f.u), d.dot(f.v), d.dot(f.n));
}

export function toWorld(f, x, y, z = 0) {
  return f.o.clone().addScaledVector(f.u, x).addScaledVector(f.v, y).addScaledVector(f.n, z);
}

/** Angolo (gradi) tra l'asse U di riferimento e l'asse u dato, attorno alla normale. */
export function angleOfU(n, u) {
  const u0 = defaultU(n);
  const s = n.dot(u0.clone().cross(u));
  const c = u0.dot(u);
  return THREE.MathUtils.radToDeg(Math.atan2(s, c));
}

export function circleSegments(r, tol = 0.01) {
  if (r <= tol) return 24;
  return Math.max(24, Math.min(360, Math.ceil(Math.PI / Math.acos(1 - tol / r))));
}

/**
 * Ribalta un'entità rispetto all'asse U del piano (v → -v), modificandola: è la stessa figura descritta nel
 * piano con la normale opposta, che ha lo stesso asse U e l'asse V invertito. Le polilinee invertono anche
 * l'ordine dei vertici, così il verso di percorrenza resta quello di prima.
 */
export function mirrorEntityV(e) {
  const neg = v => (v ? -v : 0);
  switch (e.kind) {
    case 'rect': { const y1 = neg(e.y2), y2 = neg(e.y1); e.y1 = y1; e.y2 = y2; break; }
    case 'circle': e.cy = neg(e.cy); break;
    case 'polygon': e.cy = neg(e.cy); e.rot = neg(e.rot); break;
    case 'polyline': if (Array.isArray(e.pts)) e.pts = e.pts.map(p => [p[0], neg(p[1])]).reverse(); break;
  }
  return e;
}

/** Contorno chiuso di un'entità di sketch: array di [x,y] (senza ripetere il primo punto). */
export function entityLoop(e) {
  switch (e.kind) {
    case 'rect':
      return [[e.x1, e.y1], [e.x2, e.y1], [e.x2, e.y2], [e.x1, e.y2]];
    case 'circle': {
      if (!(e.r > 0)) return [];
      const n = circleSegments(e.r);
      const pts = [];
      for (let i = 0; i < n; i++) {
        const a = (2 * Math.PI * i) / n;
        pts.push([e.cx + e.r * Math.cos(a), e.cy + e.r * Math.sin(a)]);
      }
      return pts;
    }
    case 'polygon': {
      if (!(e.r > 0)) return [];
      const n = Math.max(3, e.sides | 0);
      const r0 = THREE.MathUtils.degToRad(e.rot || 0);
      const pts = [];
      for (let i = 0; i < n; i++) {
        const a = r0 + (2 * Math.PI * i) / n;
        pts.push([e.cx + e.r * Math.cos(a), e.cy + e.r * Math.sin(a)]);
      }
      return pts;
    }
    case 'polyline':
      return (e.pts || []).map(p => [p[0], p[1]]);
  }
  return [];
}

/** Punti notevoli di un'entità (per l'aggancio): vertici e centri. */
export function entitySnapPoints(e) {
  const pts = [];
  if (e.kind === 'circle') {
    pts.push([e.cx, e.cy]);
    for (let i = 0; i < 4; i++) pts.push([e.cx + e.r * Math.cos(i * Math.PI / 2), e.cy + e.r * Math.sin(i * Math.PI / 2)]);
  } else if (e.kind === 'polygon') {
    pts.push([e.cx, e.cy], ...entityLoop(e));
  } else {
    pts.push(...entityLoop(e));
  }
  return pts;
}

export function distPointSeg(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const l2 = dx * dx + dy * dy;
  let t = l2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / l2 : 0;
  t = Math.max(0, Math.min(1, t));
  const qx = ax + dx * t - px, qy = ay + dy * t - py;
  return Math.sqrt(qx * qx + qy * qy);
}

export function distToLoop(px, py, loop) {
  let best = Infinity;
  for (let i = 0; i < loop.length; i++) {
    const a = loop[i], b = loop[(i + 1) % loop.length];
    best = Math.min(best, distPointSeg(px, py, a[0], a[1], b[0], b[1]));
  }
  return best;
}

export function loopArea(loop) {
  let a = 0;
  for (let i = 0; i < loop.length; i++) {
    const p = loop[i], q = loop[(i + 1) % loop.length];
    a += p[0] * q[1] - q[0] * p[1];
  }
  return a / 2;
}

export const fmt = (v, d = 3) => {
  if (v == null || !Number.isFinite(v)) return '–';
  const r = Number(v.toFixed(d));
  return (Object.is(r, -0) ? 0 : r).toString();
};
