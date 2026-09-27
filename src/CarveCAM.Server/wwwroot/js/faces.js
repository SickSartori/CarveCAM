// Facce selezionabili di una mesh: le facce B-rep dei modelli CAD (salvate all'importazione) oppure,
// per mesh senza topologia (STL, OBJ, artefatti), regioni di triangoli contigui con normali simili.
import * as THREE from 'three';
import { App } from './state.js';

const cache = new WeakMap();   // BufferGeometry -> { faceOf: Uint32Array, groups: Map(faceId -> Int32Array), brep }

/** Facce della mesh visualizzata (Object3D della scena). */
export function facesOf(mesh) {
  const geo = mesh.geometry;
  let info = cache.get(geo);
  if (info) return info;
  const o = mesh.userData.type === 'object' ? App.project.objects.find(x => x.id === mesh.userData.id) : null;
  const brep = o ? App.runtime.meshFaces.get(o.meshId) : null;
  const count = triangleCount(geo);
  const faceOf = brep && brep.length === count ? brep : segment(geo, 20);
  info = { faceOf, groups: groupByFace(faceOf), brep: faceOf === brep };
  cache.set(geo, info);
  return info;
}

export function triangleCount(geo) {
  return geo.index ? geo.index.count / 3 : geo.attributes.position.count / 3;
}

/** Indici dei tre vertici del triangolo t. */
export function triVertices(geo, t) {
  const idx = geo.index;
  return idx ? [idx.getX(3 * t), idx.getX(3 * t + 1), idx.getX(3 * t + 2)] : [3 * t, 3 * t + 1, 3 * t + 2];
}

function groupByFace(faceOf) {
  const counts = new Map();
  for (const f of faceOf) counts.set(f, (counts.get(f) || 0) + 1);
  const groups = new Map();
  for (const [f, n] of counts) groups.set(f, new Int32Array(n));
  const fill = new Map();
  for (let t = 0; t < faceOf.length; t++) {
    const f = faceOf[t];
    const k = fill.get(f) || 0;
    groups.get(f)[k] = t;
    fill.set(f, k + 1);
  }
  return groups;
}

/**
 * Regioni di triangoli adiacenti (vertici saldati a 1 µm) la cui normale varia meno di angleDeg tra un triangolo
 * e il vicino: separa le facce piane da spigoli vivi e tiene insieme le superfici curve tassellate.
 */
function segment(geo, angleDeg) {
  const pos = geo.attributes.position;
  const n = triangleCount(geo);
  // saldatura dei vertici
  const weld = new Map();
  const vid = new Int32Array(pos.count);
  for (let i = 0; i < pos.count; i++) {
    const key = `${Math.round(pos.getX(i) * 1000)},${Math.round(pos.getY(i) * 1000)},${Math.round(pos.getZ(i) * 1000)}`;
    let id = weld.get(key);
    if (id === undefined) { id = weld.size; weld.set(key, id); }
    vid[i] = id;
  }
  // normali dei triangoli e spigoli condivisi
  const normals = new Float32Array(n * 3);
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  const edges = new Map();
  const nv = weld.size;
  const tv = new Int32Array(n * 3);
  for (let t = 0; t < n; t++) {
    const [i0, i1, i2] = triVertices(geo, t);
    a.fromBufferAttribute(pos, i0); b.fromBufferAttribute(pos, i1); c.fromBufferAttribute(pos, i2);
    const nn = b.sub(a).cross(c.sub(a)).normalize();
    normals[3 * t] = nn.x; normals[3 * t + 1] = nn.y; normals[3 * t + 2] = nn.z;
    const v = [vid[i0], vid[i1], vid[i2]];
    tv.set(v, 3 * t);
    // spigolo -> primo triangolo, poi [t1, t2]; con tre o più triangoli (non manifold) null
    for (let k = 0; k < 3; k++) {
      const p = v[k], q = v[(k + 1) % 3];
      if (p === q) continue;
      const key = p < q ? p * nv + q : q * nv + p;
      const e = edges.get(key);
      if (e === undefined) edges.set(key, t);
      else if (typeof e === 'number') edges.set(key, [e, t]);
      else edges.set(key, null);
    }
  }
  const cosMax = Math.cos(THREE.MathUtils.degToRad(angleDeg));
  const faceOf = new Uint32Array(n).fill(0xffffffff);
  let next = 0;
  const stack = [];
  for (let s = 0; s < n; s++) {
    if (faceOf[s] !== 0xffffffff) continue;
    faceOf[s] = next;
    stack.push(s);
    while (stack.length) {
      const t = stack.pop();
      for (let k = 0; k < 3; k++) {
        const p = tv[3 * t + k], q = tv[3 * t + (k + 1) % 3];
        const e = edges.get(p < q ? p * nv + q : q * nv + p);
        if (!Array.isArray(e)) continue;   // bordo libero o spigolo non manifold
        const u = e[0] === t ? e[1] : e[0];
        if (faceOf[u] !== 0xffffffff) continue;
        const d = normals[3 * t] * normals[3 * u] + normals[3 * t + 1] * normals[3 * u + 1] + normals[3 * t + 2] * normals[3 * u + 2];
        if (d < cosMax) continue;
        faceOf[u] = next;
        stack.push(u);
      }
    }
    next++;
  }
  return faceOf;
}
