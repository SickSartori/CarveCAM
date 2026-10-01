// Sincronizzazione incrementale: progetto (stato) -> oggetti Three.js.
import * as THREE from 'three';
import { App, activePlaneId } from './state.js';
import { planeFrame, frameQuaternion, entityLoop } from './geom.js';
import { settings, color, onSettings } from './settings.js';

const D2R = Math.PI / 180;

export class SceneSync {
  constructor(vp) {
    this.vp = vp;
    this.nodes = new Map(); // chiave -> { obj, sig }
    this.ver = 0;           // versione delle opzioni: cambiando colori o dimensioni si ricostruisce tutto
    onSettings(() => { this.ver++; this.sync(); });
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

  /**
   * Un clic che colpisce il riquadro di un piano lo seleziona in qualunque punto, anche se il piano non è
   * attivo (solo bordo tratteggiato); oggetti e artefatti davanti al piano hanno comunque la precedenza.
   */
  planeHitAccepted(hit) {
    return this.nodes.has(this.key('plane', hit.object.userData.id));
  }

  /** Piani sotto il puntatore (per il cursore di selezione): solo riquadri, senza i modelli. */
  planeQuads() {
    const out = [];
    for (const [k, n] of this.nodes) if (k.startsWith('plane:') && n.quad && n.obj.visible) out.push(n.quad);
    return out;
  }

  sync() {
    const p = App.project;
    const seen = new Set();
    const ctx = {
      active: activePlaneId(),
      sel: new Set(App.selected.map(s => this.key(s.type, s.id))),
    };
    for (const o of p.objects) this._syncObject(o, seen);
    for (const a of p.artifacts) this._syncArtifact(a, seen);
    for (const pl of p.planes) this._syncPlane(pl, seen, ctx);
    for (const op of p.operations) this._syncToolpath(op, seen);
    for (const [k, n] of this.nodes) {
      if (seen.has(k)) continue;
      n.obj.removeFromParent();
      disposeTree(n.obj, n.sharedGeometry);
      this.nodes.delete(k);
    }
    this.vp.gridGroup.visible = App.view.grid && settings.grid.visible !== false;
    this.applySelection(ctx.sel);
  }

  _replace(k, group, obj, sig, extra = {}) {
    const old = this.nodes.get(k);
    if (old) {
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
    const col = o.locked ? color('locked') : (o.color || color('object'));
    const sig = `${o.meshId}|${col}|${App.view.wireframe}|${this.ver}`;
    let n = this.nodes.get(k);
    if (!n || n.sig !== sig) {
      const mat = new THREE.MeshStandardMaterial({
        color: col, metalness: 0.15, roughness: 0.55,
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
    const col = a.locked ? color('locked') : (a.color || color('artifact'));
    const sig = JSON.stringify([a.kind, a.size, a.radius, a.radius2, a.height, col, App.view.wireframe, this.ver]);
    let n = this.nodes.get(k);
    if (!n || n.sig !== sig) {
      const geo = artifactGeometry(a);
      const mat = new THREE.MeshStandardMaterial({
        color: col, metalness: 0.05, roughness: 0.5,
        transparent: true, opacity: 0.8, wireframe: App.view.wireframe,
        polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.userData = { type: 'artifact', id: a.id };
      const edgeCol = new THREE.Color(col).multiplyScalar(0.35);
      const e = new THREE.LineSegments(new THREE.EdgesGeometry(geo, 25), new THREE.LineBasicMaterial({ color: edgeCol, transparent: true, opacity: 0.8 }));
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
  _syncPlane(pl, seen, ctx) {
    const k = this.key('plane', pl.id);
    seen.add(k);
    const selEnts = [...ctx.sel].filter(s => s.startsWith('entity:')).map(s => s.slice(7));
    const selPlane = ctx.sel.has(k);
    const active = ctx.active === pl.id;
    const editing = App.sketch && App.sketch.planeId === pl.id ? App.sketch.sketchId : '';
    const sig = JSON.stringify([pl.size, pl.sketches, selEnts, selPlane, active, editing, !!pl.locked, this.ver]);
    let n = this.nodes.get(k);
    if (!n || n.sig !== sig) {
      const g = new THREE.Group();
      g.userData = { type: 'plane', id: pl.id };
      const size = pl.size || 100;
      const h = size / 2;
      const col = pl.locked ? color('locked') : color('plane');
      // piano attivo: bordo continuo e riempimento; gli altri: solo bordo tratteggiato
      const quad = new THREE.Mesh(new THREE.PlaneGeometry(size, size),
        new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: selPlane ? 0.16 : 0.1, side: THREE.DoubleSide, depthWrite: false }));
      quad.material.visible = active;   // resta selezionabile anche se non disegnato
      quad.userData = { type: 'plane', id: pl.id };
      quad.renderOrder = 1;
      g.add(quad);
      const corners = [[-h, -h], [h, -h], [h, h], [-h, h]];
      if (active) g.add(lineLoop(corners, col, 1));
      else g.add(dashedLoop(corners, col, selPlane ? 1 : 0.7, size / 45, size / 70));
      // assi del piano: U rosso, V verde
      const ax = size * 0.12;
      g.add(segment([0, 0, 0], [ax, 0, 0], 0xff5f5f), segment([0, 0, 0], [0, ax, 0], 0x5fd35f));
      // normale (asse utensile): una piccola freccia per angolo
      const len = size * 0.09 * (settings.sizes.normalArrow || 1);
      const nCol = new THREE.Color(color('normal'));
      for (const [x, y] of corners) {
        const arrow = new THREE.ArrowHelper(new THREE.Vector3(0, 0, 1), new THREE.Vector3(x, y, 0), len, nCol, len * 0.32, len * 0.2);
        arrow.traverse(o => { o.raycast = () => {}; });
        if (!active) arrow.traverse(o => { if (o.material) { o.material.transparent = true; o.material.opacity = 0.6; } });
        g.add(arrow);
      }
      const cSketch = new THREE.Color(color('sketch'));
      const cDim = cSketch.clone().multiplyScalar(0.7);
      const cSel = new THREE.Color(color('entitySel'));
      for (const s of pl.sketches) {
        if (s.visible === false) continue;
        const isEditing = s.id === editing;
        for (const e of s.entities) {
          const loop = entityLoop(e);
          if (loop.length < 2) continue;
          const c = selEnts.includes(e.id) ? cSel : (editing && !isEditing ? cDim : cSketch);
          const l = lineLoop(loop, c, 1, 0.02);
          l.renderOrder = 3;
          l.material.depthTest = !isEditing;
          g.add(l);
        }
      }
      n = this._replace(k, this.vp.groups.planes, g, sig, { quad, half: h, active });
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
    const sig = `${data.toolpathId}|${App.view.rapids}|${this.ver}`;
    let n = this.nodes.get(k);
    if (!n || n.sig !== sig) {
      const built = buildToolpath(data, App.view.rapids);
      n = this._replace(k, this.vp.groups.toolpaths, built.group, sig, built);
    }
    n.obj.visible = (App.view.toolpaths && op.visible !== false) || !!n.simVisible;
    const sel = App.selection;
    const dim = sel && sel.type === 'operation' && sel.id !== op.id && !n.simVisible;
    n.cut.material.opacity = dim ? 0.3 : 1;
    if (n.rapid) n.rapid.material.opacity = dim ? 0.15 : 0.55;
  }

  /**
   * Simulazione: mostra il percorso fino al punto i (null = tutto, -1 = niente). force rende visibile il
   * percorso anche se nascosto (lavorazioni simulate in sequenza).
   */
  setToolpathProgress(opId, i, force = false) {
    const n = this.nodes.get(this.key('toolpath', opId));
    if (!n) return;
    n.simVisible = force;
    if (force) n.obj.visible = true;
    if (i == null) {
      n.cut.geometry.setDrawRange(0, Infinity);
      if (n.rapid) n.rapid.geometry.setDrawRange(0, Infinity);
    } else if (i < 0) {
      n.cut.geometry.setDrawRange(0, 0);
      if (n.rapid) n.rapid.geometry.setDrawRange(0, 0);
    } else {
      n.cut.geometry.setDrawRange(0, n.cutPrefix[i] * 2);
      if (n.rapid) n.rapid.geometry.setDrawRange(0, n.rapidPrefix[i] * 2);
    }
  }

  // ---------------------------------------------------------------- selezione
  applySelection(sel = new Set(App.selected.map(s => this.key(s.type, s.id)))) {
    const emissive = new THREE.Color(color('selection'));
    for (const [k, n] of this.nodes) {
      if (!(k.startsWith('object:') || k.startsWith('artifact:'))) continue;
      const mat = n.obj.material;
      if (mat && mat.emissive) mat.emissive.copy(sel.has(k) ? emissive : new THREE.Color(0));
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

/** Punti caratteristici di un artefatto, nel suo sistema locale (riferimento del manipolatore). */
export function artifactKeyPoints(a) {
  const pts = [[0, 0, 0]];
  if (a.kind === 'box') {
    const [x, y, z] = (a.size || [20, 20, 20]).map(v => v / 2);
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) pts.push([sx * x, sy * y, sz * z]);
    for (const sz of [-1, 1]) pts.push([0, 0, sz * z]);
  } else if (a.kind === 'cylinder' || a.kind === 'cone') {
    const hz = a.height / 2;
    for (const [r, z] of [[a.radius, -hz], [a.kind === 'cone' ? a.radius2 : a.radius, hz]]) {
      pts.push([0, 0, z]);
      if (r > 0) for (let i = 0; i < 4; i++) pts.push([r * Math.cos(i * Math.PI / 2), r * Math.sin(i * Math.PI / 2), z]);
    }
  } else if (a.kind === 'sphere') {
    const r = a.radius;
    pts.push([r, 0, 0], [-r, 0, 0], [0, r, 0], [0, -r, 0], [0, 0, r], [0, 0, -r]);
  }
  return pts;
}

function lineLoop(pts, color, opacity = 1, z = 0) {
  const v = pts.map(p => new THREE.Vector3(p[0], p[1], z));
  const geo = new THREE.BufferGeometry().setFromPoints(v);
  const l = new THREE.LineLoop(geo, new THREE.LineBasicMaterial({ color, transparent: opacity < 1, opacity }));
  l.raycast = () => {};
  return l;
}

function dashedLoop(pts, color, opacity, dash, gap) {
  const v = [...pts, pts[0]].map(p => new THREE.Vector3(p[0], p[1], 0));
  const l = new THREE.Line(new THREE.BufferGeometry().setFromPoints(v),
    new THREE.LineDashedMaterial({ color, dashSize: dash, gapSize: gap, transparent: true, opacity }));
  l.computeLineDistances();
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
  const cFeed = new THREE.Color(color('feed')), cPlunge = new THREE.Color(color('plunge')), cRamp = new THREE.Color(color('ramp'));
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
      const c = types[i] === 2 ? cPlunge : types[i] === 3 ? cRamp : cFeed;
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
    rapid = new THREE.LineSegments(rg, new THREE.LineDashedMaterial({ color: color('rapid'), dashSize: 2, gapSize: 1.5, transparent: true, opacity: 0.55 }));
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
