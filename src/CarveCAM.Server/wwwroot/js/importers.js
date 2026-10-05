// Importazione modelli 3D.
// - STL, OBJ, PLY, OFF: letti dal server VB.NET.
// - glTF/GLB, FBX, 3MF, DAE, 3DS, AMF, VRML: convertiti nel browser con i loader di Three.js.
// - STEP, IGES, BREP: tassellati nel browser con OpenCascade (occt-import-js, WebAssembly).
import * as THREE from 'three';
import { t } from './i18n.js';

export const SERVER_FORMATS = ['stl', 'obj', 'ply', 'off'];
export const CLIENT_FORMATS = ['gltf', 'glb', 'fbx', '3mf', 'dae', '3ds', 'amf', 'wrl', 'vrml', 'step', 'stp', 'iges', 'igs', 'brep', 'brp'];
// formati con asse verticale Y: vengono ruotati per avere Z in alto
const Y_UP = new Set(['gltf', 'glb', 'fbx', 'dae', 'wrl', 'vrml']);

const OCCT_VER = '0.0.23';
const OCCT_BASE = `https://cdn.jsdelivr.net/npm/occt-import-js@${OCCT_VER}/dist/`;
let occtPromise = null;

export function extOf(name) {
  const i = name.lastIndexOf('.');
  return i >= 0 ? name.slice(i + 1).toLowerCase() : '';
}

/**
 * Converte un file in triangle soup (Float32Array, coordinate mondo, Z in alto).
 * Restituisce { positions, faces }: faces (Uint32Array, una voce per triangolo) è la faccia B-rep dei
 * modelli CAD (STEP, IGES, BREP), null per gli altri formati.
 */
export async function parseInBrowser(file) {
  const ext = extOf(file.name);
  if (['step', 'stp', 'iges', 'igs', 'brep', 'brp'].includes(ext)) return sanitizeSoup(await parseCad(file, ext));
  return { positions: await parseMesh(file), faces: null };
}

/**
 * Toglie i triangoli degeneri o non finiti con lo stesso criterio del server (MeshData.Sanitize),
 * mantenendo allineate le facce: il server non scarterà altro e gli indici dei triangoli restano validi.
 */
function sanitizeSoup({ positions, faces }) {
  const n = positions.length / 9;
  const keep = new Uint8Array(n);
  let kept = 0;
  for (let t = 0; t < n; t++) {
    const o = t * 9;
    let ok = true;
    for (let k = 0; k < 9; k++) if (!Number.isFinite(positions[o + k])) { ok = false; break; }
    if (ok) {
      const ax = positions[o], ay = positions[o + 1], az = positions[o + 2];
      const ux = positions[o + 3] - ax, uy = positions[o + 4] - ay, uz = positions[o + 5] - az;
      const vx = positions[o + 6] - ax, vy = positions[o + 7] - ay, vz = positions[o + 8] - az;
      const cx = uy * vz - uz * vy, cy = uz * vx - ux * vz, cz = ux * vy - uy * vx;
      ok = Math.sqrt(cx * cx + cy * cy + cz * cz) >= 1e-14;
    }
    if (ok) { keep[t] = 1; kept++; }
  }
  if (kept === n) return { positions, faces };
  const p = new Float32Array(kept * 9), f = faces ? new Uint32Array(kept) : null;
  let j = 0;
  for (let t = 0; t < n; t++) {
    if (!keep[t]) continue;
    p.set(positions.subarray(t * 9, t * 9 + 9), j * 9);
    if (f) f[j] = faces[t];
    j++;
  }
  return { positions: p, faces: f };
}

async function parseMesh(file) {
  const ext = extOf(file.name);
  let root;
  switch (ext) {
    case 'gltf': case 'glb': {
      const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
      const data = await file.arrayBuffer();
      root = await new Promise((res, rej) => new GLTFLoader().parse(data, '', g => res(g.scene), rej));
      break;
    }
    case 'fbx': {
      const { FBXLoader } = await import('three/addons/loaders/FBXLoader.js');
      root = new FBXLoader().parse(await file.arrayBuffer(), '');
      break;
    }
    case '3mf': {
      const { ThreeMFLoader } = await import('three/addons/loaders/3MFLoader.js');
      root = new ThreeMFLoader().parse(await file.arrayBuffer());
      break;
    }
    case 'dae': {
      const { ColladaLoader } = await import('three/addons/loaders/ColladaLoader.js');
      root = new ColladaLoader().parse(await file.text(), '').scene;
      break;
    }
    case '3ds': {
      const { TDSLoader } = await import('three/addons/loaders/TDSLoader.js');
      root = new TDSLoader().parse(await file.arrayBuffer(), '');
      break;
    }
    case 'amf': {
      const { AMFLoader } = await import('three/addons/loaders/AMFLoader.js');
      root = new AMFLoader().parse(await file.arrayBuffer());
      break;
    }
    case 'wrl': case 'vrml': {
      const { VRMLLoader } = await import('three/addons/loaders/VRMLLoader.js');
      root = new VRMLLoader().parse(await file.text(), '');
      break;
    }
    default:
      throw new Error(`Formato .${ext} non supportato`);
  }
  const pos = collectTriangles(root);
  if (Y_UP.has(ext)) yUpToZUp(pos);
  return pos;
}

function collectTriangles(root) {
  root.updateMatrixWorld(true);
  const chunks = [];
  let total = 0;
  const v = new THREE.Vector3();
  root.traverse(o => {
    if (!o.isMesh || !o.geometry || !o.geometry.attributes.position) return;
    let g = o.geometry;
    if (g.index) g = g.toNonIndexed();
    const src = g.attributes.position;
    const arr = new Float32Array(src.count * 3);
    for (let i = 0; i < src.count; i++) {
      v.fromBufferAttribute(src, i).applyMatrix4(o.matrixWorld);
      arr[i * 3] = v.x; arr[i * 3 + 1] = v.y; arr[i * 3 + 2] = v.z;
    }
    const n = arr.length - (arr.length % 9);
    chunks.push(arr.subarray(0, n));
    total += n;
  });
  const out = new Float32Array(total);
  let off = 0;
  for (const c of chunks) { out.set(c, off); off += c.length; }
  if (!total) throw new Error(t('Il file non contiene mesh triangolari'));
  return out;
}

function yUpToZUp(pos) {
  // rotazione +90° attorno a X: (x, y, z) -> (x, -z, y)
  for (let i = 0; i < pos.length; i += 3) {
    const y = pos[i + 1], z = pos[i + 2];
    pos[i + 1] = -z;
    pos[i + 2] = y;
  }
}

function loadOcct() {
  if (occtPromise) return occtPromise;
  occtPromise = new Promise((resolve, reject) => {
    const sc = document.createElement('script');
    sc.src = `${OCCT_BASE}occt-import-js.js`;
    sc.onload = () => {
      // eslint-disable-next-line no-undef
      occtimportjs({ locateFile: f => OCCT_BASE + f }).then(resolve, reject);
    };
    sc.onerror = () => { occtPromise = null; reject(new Error(t('Impossibile caricare il modulo OpenCascade (serve la connessione a internet)'))); };
    document.head.append(sc);
  });
  return occtPromise;
}

async function parseCad(file, ext) {
  const occt = await loadOcct();
  const buf = new Uint8Array(await file.arrayBuffer());
  const params = { linearUnit: 'millimeter', linearDeflectionType: 'absolute_value', linearDeflection: 0.02, angularDeflection: 0.2 };
  let res;
  if (ext === 'step' || ext === 'stp') res = occt.ReadStepFile(buf, params);
  else if (ext === 'iges' || ext === 'igs') res = occt.ReadIgesFile(buf, params);
  else res = occt.ReadBrepFile(buf, params);
  if (!res || !res.success) throw new Error('OpenCascade non è riuscito a leggere il file');
  let total = 0;
  for (const m of res.meshes) total += (m.index ? m.index.array.length : m.attributes.position.array.length / 3) * 3;
  const out = new Float32Array(total);
  const faces = new Uint32Array(total / 9);
  let off = 0, tri = 0, faceBase = 0;
  for (const m of res.meshes) {
    const p = m.attributes.position.array;
    const t0 = tri;
    if (m.index) {
      for (const idx of m.index.array) {
        out[off++] = p[idx * 3]; out[off++] = p[idx * 3 + 1]; out[off++] = p[idx * 3 + 2];
      }
    } else {
      out.set(p, off); off += p.length;
    }
    const nt = (off / 9 | 0) - t0;
    // faccia B-rep di ogni triangolo: brep_faces elenca gli intervalli di triangoli [first, last] di ciascuna faccia
    const bf = m.brep_faces || [];
    const own = faceBase + bf.length;   // triangoli fuori da ogni intervallo: una faccia a sé per mesh
    faces.fill(own, t0, t0 + nt);
    bf.forEach((f, i) => { for (let t = Math.max(0, f.first); t <= Math.min(nt - 1, f.last); t++) faces[t0 + t] = faceBase + i; });
    faceBase = own + 1;
    tri = t0 + nt;
  }
  if (!off) throw new Error(t('Il file non contiene superfici'));
  const len = off - (off % 9);
  return { positions: out.subarray(0, len), faces: faces.subarray(0, len / 9) };
}

/** Geometria di visualizzazione da triangle soup: normali "spezzate" oltre 30° e spigoli per mesh non enormi. */
export async function buildDisplayGeometry(positions) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const tris = positions.length / 9;
  let geo = g;
  if (tris <= 1500000) {
    const { toCreasedNormals } = await import('three/addons/utils/BufferGeometryUtils.js');
    geo = toCreasedNormals(g, THREE.MathUtils.degToRad(30));
  } else {
    g.computeVertexNormals();
  }
  if (tris <= 400000) geo.userData.edges = new THREE.EdgesGeometry(geo, 30);
  geo.computeBoundingBox();
  geo.computeBoundingSphere();
  return geo;
}
