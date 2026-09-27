// Sincronizzazione incrementale: progetto (stato) -> oggetti Three.js.
import * as THREE from 'three';
import { App } from './state.js';
import { planeFrame, frameQuaternion, entityLoop } from './geom.js';

const D2R = Math.PI / 180;
const COL = {
  selEmissive: 0x1d5a96,
  plane: 0x3fa7ff,
  sketch: 0xffe066,
  sketchDim: 0xb9a653,
  entitySel: 0xff8a3d,
  feed: new THREE.Color(0x2fd3ff),
  plunge: new THREE.Color(0xffd23f),
  ramp: new THREE.Color(0xff9f43),
  rapid: 0xff4d6d,
};

export class SceneSync {
  constructor(vp) {
    this.vp = vp;
    this.nodes = new Map(); // chiave -> { obj, sig }
  }

  key(type, id) { return `${type}:${id}`; }

  /** Oggetto Three.js che rappresenta un elemento (per manipolatore e selezione). */
  objectFor(type, id) {
    const n = this.nodes.get(this.key(type, id));
    return n ? n.obj : null;
  }

  pickables() {
    const res = [];
    for (const [k, n] of this.nodes) {
      if (!n.obj.visible) continue;
      if (k.startsWith('object:') || k.startsWith('artifact:')) res.push(n.obj);
      else if (k.startsWith('plane:') && n.quad) res.push(n.quad);
    }
    return res;
  }

  sync() {
    const p = App.project;
    const seen = new Set();
    for (const o of p.objects) this._syncObject(o, seen);
    for (const a of p.artifacts) this._syncArtifact(a, seen);
    for (const pl of p.planes) this._syncPlane(pl, seen);
    for (const op of p.operations) this._syncToolpath(op, seen);
    for (const [k, n] of this.nodes) {
      if (seen.has(k)) continue;
      if (this.vp.transform.object === n.obj) this.vp.transform.detach();
      n.obj.removeFromParent();
      disposeTree(n.obj, n.sharedGeometry);
      this.nodes.delete(k);
    }
    this.vp.gridGroup.visible = App.view.grid;
    this.applySelection();
  }

  _replace(k, group, obj, sig, extra = {}) {
    const old = this.nodes.get(k);
    if (old) {
      // il manipolatore viene riagganciato al nuovo oggetto da updateGizmo() (main.js) dopo la sincronizzazione
      if (this.vp.transform.object === old.obj) this.vp.transform.detach();
      old.obj.removeFromParent();
      disposeTree(old.obj, old.sharedGeometry);
    }
    group.add(obj);
    const node = { obj, sig, ...extra };
    this.nodes.set(k, node);
    return node;
  }

  // ---------------------------------------------------------------- mesh importate
  _syncObject(o, seen) {
    const geo = App.runtime.meshGeo.get(o.meshId);
    if (!geo) return;
    const k = this.key('object', o.id);
    seen.add(k);
    const sig = `${o.meshId}|${o.color}|${App.view.wireframe}`;
    let n = this.nodes.get(k);
    if (!n || n.sig !== sig) {
      const mat = new THREE.MeshStandardMaterial({
        color: o.color || '#9aa8b8', metalness: 0.15, roughness: 0.55,
        side: THREE.DoubleSide, wireframe: App.view.wireframe,
        polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.userData = { type: 'object', id: o.id };
      if (geo.userData.edges) {
        const e = new THREE.LineSegments(geo.userData.edges, new THREE.LineBasicMaterial({ color: 0x1c2127, transparent: true, opacity: 0.55 }));
        e.raycast = () => {};
        mesh.add(e);
      }
      n = this._replace(k, this.vp.groups.objects, mesh, sig, { sharedGeometry: true });
    }
    const m = n.obj;
    m.position.fromArray(o.position);
    m.rotation.set(o.rotation[0] * D2R, o.rotation[1] * D2R, o.rotation[2] * D2R, 'XYZ');
    m.scale.fromArray(o.scale);
    m.visible = o.visible !== false;
  }

  // ---------------------------------------------------------------- artefatti
  _syncArtifact(a, seen) {
    const k = this.key('artifact', a.id);
    seen.add(k);
    const sig = JSON.stringify([a.kind, a.size, a.radius, a.radius2, a.height, a.color, App.view.wireframe, a.include]);
    let n = this.nodes.get(k);
    if (!n || n.sig !== sig) {
      const geo = artifactGeometry(a);
      const mat = new THREE.MeshStandardMaterial({
        color: a.color || '#ffb547', metalness: 0.05, roughness: 0.5,
        transparent: true, opacity: a.include === false ? 0.3 : 0.78, wireframe: App.view.wireframe,
        polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.userData = { type: 'artifact', id: a.id };
      const e = new THREE.LineSegments(new THREE.EdgesGeometry(geo, 25), new THREE.LineBasicMaterial({ color: 0x5a3b0c, transparent: true, opacity: 0.8 }));
      e.raycast = () => {};
      mesh.add(e);
      n = this._replace(k, this.vp.groups.artifacts, mesh, sig);
    }
    const m = n.obj;
    m.position.fromArray(a.position);
    m.rotation.set(a.rotation[0] * D2R, a.rotation[1] * D2R, a.rotation[2] * D2R, 'XYZ');
    m.visible = a.visible !== false;
  }

  // ---------------------------------------------------------------- piani e sketch
  _syncPlane(pl, seen) {
    const k = this.key('plane', pl.id);
    seen.add(k);
    const sel = App.selection;
    const selEnt = sel && sel.type === 'entity' ? sel.id : '';
    const selPlane = sel && ((sel.type === 'plane' && sel.id === pl.id) ||
      ((sel.type === 'sketch' || sel.type === 'entity') && pl.sketches.some(s => s.id === (sel.sketchId || sel.id))));
    const active = App.sketch && App.sketch.planeId === pl.id ? App.sketch.sketchId : '';
    const sig = JSON.stringify([pl.size, pl.sketches, selEnt, !!selPlane, active]);
    let n = this.nodes.get(k);
    if (!n || n.sig !== sig) {
      const g = new THREE.Group();
      g.userData = { type: 'plane', id: pl.id };
      const size = pl.size || 100;
      const quad = new THREE.Mesh(new THREE.PlaneGeometry(size, size),
        new THREE.MeshBasicMaterial({ color: COL.plane, transparent: true, opacity: selPlane ? 0.13 : 0.06, side: THREE.DoubleSide, depthWrite: false }));
      quad.userData = { type: 'plane', id: pl.id };
      quad.renderOrder = 1;
      g.add(quad);
      const h = size / 2;
      g.add(lineLoop([[-h, -h], [h, -h], [h, h], [-h, h]], COL.plane, selPlane ? 1 : 0.55));
      // assi del piano: U rosso, V verde, normale (asse utensile) blu
      const ax = size * 0.18;
      g.add(segment([0, 0, 0], [ax, 0, 0], 0xff5f5f), segment([0, 0, 0], [0, ax, 0], 0x5fd35f));
      const arrow = new THREE.ArrowHelper(new THREE.Vector3(0, 0, 1), new THREE.Vector3(), size * 0.28, 0x4f9dff, size * 0.06, size * 0.035);
      arrow.traverse(o => { o.raycast = () => {}; });
      g.add(arrow);
      for (const s of pl.sketches) {
        if (s.visible === false) continue;
        const isActive = s.id === active;
        for (const e of s.entities) {
          const loop = entityLoop(e);
          if (loop.length < 2) continue;
          const col = e.id === selEnt ? COL.entitySel : (active && !isActive ? COL.sketchDim : COL.sketch);
          const l = lineLoop(loop, col, 1, 0.02);
          l.renderOrder = 3;
          l.material.depthTest = !isActive;
          g.add(l);
        }
      }
      n = this._replace(k, this.vp.groups.planes, g, sig, { quad });
    } else {
      n.quad = n.quad || n.obj.children[0];
    }
    const f = planeFrame(pl);
    n.obj.position.copy(f.o);
    n.obj.quaternion.copy(frameQuaternion(f));
    n.obj.visible = pl.visible !== false;
  }

  // ---------------------------------------------------------------- percorsi utensile
  _syncToolpath(op, seen) {
    const data = App.runtime.toolpaths.get(op.id);
    if (!data || !data.positions) return;
    const k = this.key('toolpath', op.id);
    seen.add(k);
    const sig = `${data.toolpathId}|${App.view.rapids}`;
    let n = this.nodes.get(k);
    if (!n || n.sig !== sig) {
      const built = buildToolpath(data, App.view.rapids);
      n = this._replace(k, this.vp.groups.toolpaths, built.group, sig, built);
    }
    n.obj.visible = App.view.toolpaths && op.visible !== false;
    const sel = App.selection;
    const dim = sel && sel.type === 'operation' && sel.id !== op.id;
    n.cut.material.opacity = dim ? 0.3 : 1;
    if (n.rapid) n.rapid.material.opacity = dim ? 0.15 : 0.55;
  }

  /** Mostra il percorso fino al punto i (simulazione); i = null ripristina tutto. */
  setToolpathProgress(opId, i) {
    const n = this.nodes.get(this.key('toolpath', opId));
    if (!n) return;
    if (i == null) {
      n.cut.geometry.setDrawRange(0, Infinity);
      if (n.rapid) n.rapid.geometry.setDrawRange(0, Infinity);
    } else {
      n.cut.geometry.setDrawRange(0, n.cutPrefix[i] * 2);
      if (n.rapid) n.rapid.geometry.setDrawRange(0, n.rapidPrefix[i] * 2);
    }
  }

  // ---------------------------------------------------------------- selezione
  applySelection() {
    const sel = App.selection;
    for (const [k, n] of this.nodes) {
      if (!(k.startsWith('object:') || k.startsWith('artifact:'))) continue;
      const on = sel && k === this.key(sel.type, sel.id);
      const mat = n.obj.material;
      if (mat && mat.emissive) mat.emissive.setHex(on ? COL.selEmissive : 0x000000);
    }
  }
}

// ------------------------------------------------------------------ costruttori geometrie
export function artifactGeometry(a) {
  let g;
  switch (a.kind) {
    case 'box': {
      const s = a.size || [20, 20, 20];
      g = new THREE.BoxGeometry(s[0], s[1], s[2]);
      break;
    }
    case 'cylinder':
      g = new THREE.CylinderGeometry(a.radius, a.radius, a.height, 96, 1);
      g.rotateX(Math.PI / 2);
      break;
    case 'cone':
      // CylinderGeometry(radiusTop, radiusBottom): dopo la rotazione il top è a +Z
      g = new THREE.CylinderGeometry(Math.max(0, a.radius2), Math.max(0, a.radius), a.height, 96, 1);
      g.rotateX(Math.PI / 2);
      break;
    case 'sphere':
      g = new THREE.SphereGeometry(a.radius, 64, 32);
      break;
    default:
      g = new THREE.BoxGeometry(10, 10, 10);
  }
  return g;
}

function lineLoop(pts, color, opacity = 1, z = 0) {
  const v = pts.map(p => new THREE.Vector3(p[0], p[1], z));
  const geo = new THREE.BufferGeometry().setFromPoints(v);
  const l = new THREE.LineLoop(geo, new THREE.LineBasicMaterial({ color, transparent: opacity < 1, opacity }));
  l.raycast = () => {};
  return l;
}

function segment(a, b, color) {
  const geo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(...a), new THREE.Vector3(...b)]);
  const l = new THREE.Line(geo, new THREE.LineBasicMaterial({ color }));
  l.raycast = () => {};
  return l;
}

function buildToolpath(data, showRapids) {
  const { positions, types } = data;
  const n = types.length;
  const cutPos = [], cutCol = [], rapPos = [];
  const cutPrefix = new Int32Array(n), rapidPrefix = new Int32Array(n);
  let nc = 0, nr = 0;
  for (let i = 1; i < n; i++) {
    const a = (i - 1) * 3, b = i * 3;
    if (types[i] === 0) {
      rapPos.push(positions[a], positions[a + 1], positions[a + 2], positions[b], positions[b + 1], positions[b + 2]);
      nr++;
    } else {
      cutPos.push(positions[a], positions[a + 1], positions[a + 2], positions[b], positions[b + 1], positions[b + 2]);
      const c = types[i] === 2 ? COL.plunge : types[i] === 3 ? COL.ramp : COL.feed;
      cutCol.push(c.r, c.g, c.b, c.r, c.g, c.b);
      nc++;
    }
    cutPrefix[i] = nc; rapidPrefix[i] = nr;
  }
  const group = new THREE.Group();
  const cg = new THREE.BufferGeometry();
  cg.setAttribute('position', new THREE.Float32BufferAttribute(cutPos, 3));
  cg.setAttribute('color', new THREE.Float32BufferAttribute(cutCol, 3));
  const cut = new THREE.LineSegments(cg, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 1 }));
  cut.raycast = () => {};
  group.add(cut);
  let rapid = null;
  if (showRapids && rapPos.length) {
    const rg = new THREE.BufferGeometry();
    rg.setAttribute('position', new THREE.Float32BufferAttribute(rapPos, 3));
    rapid = new THREE.LineSegments(rg, new THREE.LineDashedMaterial({ color: COL.rapid, dashSize: 2, gapSize: 1.5, transparent: true, opacity: 0.55 }));
    rapid.computeLineDistances();
    rapid.raycast = () => {};
    group.add(rapid);
  }
  return { group, cut, rapid, cutPrefix, rapidPrefix };
}

function disposeTree(obj, sharedGeometry) {
  obj.traverse(o => {
    if (o.geometry && !sharedGeometry) o.geometry.dispose();
    if (o.material) {
      for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
        if (m.map) m.map.dispose();
        m.dispose();
      }
    }
  });
}
