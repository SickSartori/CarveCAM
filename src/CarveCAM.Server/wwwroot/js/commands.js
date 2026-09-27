// Comandi dell'applicazione (menu, navigatore, pannello proprietà, scorciatoie).
import * as THREE from 'three';
import {
  App, emit, mutate, select, uid, nextName, resolve, getPlane, getSketch, getOperation, allSketches,
  setProject, newProject, undo as undoState, redo as redoState, setPath, markSaved,
} from './state.js';
import { api, download } from './api.js';
import { planeFrame, angleOfU, fmt } from './geom.js';
import { modal, confirmBox, toast, status, busy, busyText, idle, h } from './dialogs.js';
import { SERVER_FORMATS, CLIENT_FORMATS, extOf, parseInBrowser, buildDisplayGeometry } from './importers.js';

const POST_MODE_KEY = 'carvecam.post.mode';   // ultimo controllo scelto nell'esportazione G-code (per browser)

// direzioni delle viste standard (facce, spigoli e vertici del cubo di orientamento)
const VIEW_SNAP = [];
for (let x = -1; x <= 1; x++) for (let y = -1; y <= 1; y++) for (let z = -1; z <= 1; z++) {
  if (x || y || z) VIEW_SNAP.push(new THREE.Vector3(x, y, z).normalize());
}
const AXIS_NAMES = [['+X', 1, 0, 0], ['-X', -1, 0, 0], ['+Y', 0, 1, 0], ['-Y', 0, -1, 0], ['+Z', 0, 0, 1], ['-Z', 0, 0, -1]]
  .map(([name, ...d]) => ({ name, d: new THREE.Vector3(...d) }));

const ARTIFACT_DEFAULTS = {
  box: { base: 'Parallelepipedo', size: [20, 20, 20] },
  cylinder: { base: 'Cilindro', radius: 10, height: 20 },
  cone: { base: 'Tronco di cono', radius: 10, radius2: 4, height: 20 },
  sphere: { base: 'Sfera', radius: 10 },
};

const OP_DEFAULTS = {
  pocket: {
    base: 'Svuotatura', strategy: 'concentric', tool: { number: 1, type: 'flat', diameter: 6, cornerRadius: 1 },
    stepover: 3, stepdown: 1, maxDepth: 10, stock: 0, safeHeight: 10, clearance: 1, angle: 0,
    climb: true, toolInside: true, contourPass: true, resolution: 0, tolerance: 0.01, feed: 1200, plunge: 300, spindle: 12000,
    entry: 'helix', rampAngle: 3, helixRadius: 0, rampFeed: 600,
  },
  finish: {
    base: 'Finitura', strategy: 'zigzag', tool: { number: 2, type: 'ball', diameter: 6, cornerRadius: 1 },
    stepover: 0.5, stepdown: 1, maxDepth: 20, stock: 0, safeHeight: 10, clearance: 2, angle: 0,
    climb: true, toolInside: true, contourPass: false, resolution: 0, tolerance: 0.01, feed: 1500, plunge: 400, spindle: 14000,
    entry: 'plunge', rampAngle: 3, helixRadius: 0, rampFeed: 0,
  },
};

const round4 = v => Math.round(v * 10000) / 10000;

export function createCommands({ vp, sync, sketch, sim }) {
  const cmd = {};

  // ================================================================ utilità
  const sceneBox = () => {
    const box = new THREE.Box3();
    for (const g of [vp.groups.objects, vp.groups.artifacts]) {
      g.updateMatrixWorld(true);
      g.traverseVisible(o => { if (o.isMesh) box.expandByObject(o); });
    }
    return box;
  };

  function planeOfSelection() {
    const r = resolve();
    if (!r) return null;
    if (r.type === 'plane') return r.item;
    if (r.type === 'sketch' || r.type === 'entity') return r.plane;
    if (r.type === 'operation') return getSketch(r.item.sketchId)?.plane || null;
    return null;
  }

  function sketchOfSelection() {
    const r = resolve();
    if (!r) return null;
    if (r.type === 'sketch') return r.item;
    if (r.type === 'entity') return r.sketch;
    if (r.type === 'plane') return r.item.sketches[0] || null;
    if (r.type === 'operation') return getSketch(r.item.sketchId)?.sketch || null;
    return null;
  }

  // ================================================================ FILE
  cmd.newProject = async () => {
    const p = App.project;
    if ((p.objects.length || p.artifacts.length || p.planes.length) && !(await confirmBox('Nuovo progetto', 'Il progetto corrente verrà chiuso. Le modifiche non salvate andranno perse.', 'Nuovo progetto'))) return;
    sketch.exit(false);
    sim.stop();
    setProject(newProject());
    status('Nuovo progetto');
  };

  cmd.openProject = () => {
    const inp = document.getElementById('file-open');
    inp.value = '';
    inp.onchange = async () => {
      const f = inp.files[0];
      if (!f) return;
      busy('Apertura progetto…');
      try {
        const proj = await api.loadProject(f);
        sketch.exit(false);
        sim.stop();
        setProject(proj);
        await cmd.loadMeshes();
        vp.fit();
        status(`Progetto aperto: ${f.name}`);
      } catch (e) {
        toast(`Apertura non riuscita: ${e.message}`, 'err');
      } finally { idle(); }
    };
    inp.click();
  };

  cmd.saveProject = async () => {
    busy('Salvataggio progetto…');
    try {
      const blob = await api.saveProject(App.project);
      download(blob, `${safeName(App.project.name || 'progetto')}.ccam`);
      markSaved();
      status('Progetto salvato');
    } catch (e) {
      toast(`Salvataggio non riuscito: ${e.message}`, 'err');
    } finally { idle(); }
  };

  cmd.renameProject = async () => {
    const inp = h('input', { value: App.project.name || '', style: { width: '100%' } });
    const ok = await modal({
      title: 'Nome progetto', body: h('div', { class: 'form-row' }, h('label', {}, 'Nome'), inp),
      buttons: [{ label: 'Annulla', value: false }, { label: 'OK', value: true, primary: true }],
    });
    if (ok && inp.value.trim()) mutate(p => { p.name = inp.value.trim(); });
  };

  cmd.importModel = () => {
    const inp = document.getElementById('file-import');
    inp.value = '';
    inp.onchange = () => cmd.importFiles([...inp.files]);
    inp.click();
  };

  cmd.importFiles = async files => {
    if (!files.length) return;
    busy('Importazione…');
    let lastId = null;
    try {
      for (const f of files) {
        const ext = extOf(f.name);
        const name = f.name.replace(/\.[^.]+$/, '');
        busyText(`Importazione ${f.name}…`);
        let info, faces = null;
        try {
          if (SERVER_FORMATS.includes(ext)) {
            info = await api.importFile(f);
          } else if (CLIENT_FORMATS.includes(ext)) {
            if (['step', 'stp', 'iges', 'igs', 'brep', 'brp'].includes(ext)) busyText(`Tassellazione CAD di ${f.name} (OpenCascade)…`);
            const parsed = await parseInBrowser(f);
            busyText(`Invio al server di ${f.name}…`);
            info = await api.uploadMesh(name, parsed.positions);
            // facce B-rep: servono per selezionare le facce vere del modello (profili da 3D)
            if (parsed.faces && parsed.faces.length === info.triangles) {
              try { await api.uploadFaces(info.id, parsed.faces); faces = parsed.faces; } catch { /* restano le facce ricavate dalla mesh */ }
            }
          } else {
            toast(`Formato .${ext} non supportato`, 'err');
            continue;
          }
        } catch (e) {
          toast(`${f.name}: ${e.message}`, 'err');
          continue;
        }
        busyText(`Preparazione vista ${f.name}…`);
        const positions = await api.getMesh(info.id);
        App.runtime.meshGeo.set(info.id, await buildDisplayGeometry(positions));
        if (faces) App.runtime.meshFaces.set(info.id, faces);
        const id = uid('obj');
        mutate(p => {
          p.objects.push({
            id, name: info.name || name, meshId: info.id,
            position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1],
            color: '#9aa8b8', visible: true, include: true,
            triangles: info.triangles, size: info.max.map((v, i) => round4(v - info.min[i])),
            source: f.name,
          });
        });
        lastId = id;
        status(`Importato ${f.name}: ${info.triangles.toLocaleString('it-IT')} triangoli, ${info.max.map((v, i) => fmt(v - info.min[i], 2)).join(' × ')} mm`);
      }
    } finally { idle(); }
    if (lastId) { select({ type: 'object', id: lastId }); vp.fit(); }
  };

  /** Carica dal server le mesh degli oggetti non ancora in memoria (dopo apertura/ripristino progetto). */
  cmd.loadMeshes = async () => {
    const todo = App.project.objects.filter(o => o.meshId && !App.runtime.meshGeo.has(o.meshId) && !App.runtime.meshLoading.has(o.meshId));
    await Promise.all(todo.map(async o => {
      App.runtime.meshLoading.add(o.meshId);
      try {
        const [pos, faces] = await Promise.all([api.getMesh(o.meshId), api.getFaces(o.meshId).catch(() => null)]);
        App.runtime.meshGeo.set(o.meshId, await buildDisplayGeometry(pos));
        if (faces && faces.length === pos.length / 9) App.runtime.meshFaces.set(o.meshId, faces);
      } catch (e) {
        toast(`Mesh di "${o.name}" non disponibile sul server: reimportare il file.`, 'warn', 6000);
      } finally {
        App.runtime.meshLoading.delete(o.meshId);
      }
    }));
    if (todo.length) emit('project');
  };

  // ================================================================ MODIFICA
  cmd.undo = () => { undoState(); sketch.refreshFrame(); };
  cmd.redo = () => { redoState(); sketch.refreshFrame(); };

  cmd.setProp = (sel, key, value) => {
    mutate(() => {
      const r = resolve(sel);
      if (!r) return;
      setPath(r.item, key, value);
      if (r.type === 'artifact' && key === 'kind') {
        const d = ARTIFACT_DEFAULTS[value];
        for (const k of ['size', 'radius', 'radius2', 'height']) if (r.item[k] == null && d[k] != null) r.item[k] = structuredClone(d[k]);
      }
      if (r.type === 'operation' && key === 'tool.diameter' && r.item.stepover > value) r.item.stepover = round4(value * 0.5);
      if (r.type === 'operation' && (key === 'tool.diameter' || key === 'tool.type') && r.item.tool) {
        const t = r.item.tool;
        if (!(t.cornerRadius > 0)) t.cornerRadius = round4(Math.min(1, t.diameter / 4));
        if (t.cornerRadius > t.diameter / 2) t.cornerRadius = round4(t.diameter / 4);
      }
    });
    sketch.refreshFrame();
  };

  cmd.toggleVisible = (type, id) => {
    mutate(() => {
      const r = resolve({ type, id });
      if (r) r.item.visible = r.item.visible === false;
    });
  };

  cmd.deleteSelected = async () => {
    const r = resolve();
    if (!r) return;
    const s = App.selection;
    if (r.type === 'plane' && r.item.sketches.length &&
        !(await confirmBox('Elimina piano', `Il piano "${r.item.name}" contiene ${r.item.sketches.length} sketch che verranno eliminati.`, 'Elimina'))) return;
    let next = null;
    mutate(p => {
      switch (s.type) {
        case 'object': p.objects = p.objects.filter(o => o.id !== s.id); break;
        case 'artifact': p.artifacts = p.artifacts.filter(o => o.id !== s.id); break;
        case 'plane': p.planes = p.planes.filter(o => o.id !== s.id); break;
        case 'operation':
          p.operations = p.operations.filter(o => o.id !== s.id);
          App.runtime.toolpaths.delete(s.id);
          break;
        case 'sketch': {
          const rr = getSketch(s.id);
          rr.plane.sketches = rr.plane.sketches.filter(x => x.id !== s.id);
          next = { type: 'plane', id: rr.plane.id };
          break;
        }
        case 'entity': {
          const rr = getSketch(s.sketchId);
          rr.sketch.entities = rr.sketch.entities.filter(x => x.id !== s.id);
          next = { type: 'sketch', id: s.sketchId };
          break;
        }
      }
    });
    if (s.type === 'operation' && sim.opId === s.id) sim.stop();
    if ((s.type === 'sketch' || s.type === 'plane') && App.sketch && !getSketch(App.sketch.sketchId)) sketch.exit();
    select(next);
  };

  cmd.duplicateSelected = () => {
    const r = resolve();
    if (!r) return;
    const s = App.selection;
    const clone = structuredClone(r.item);
    let sel = null;
    mutate(p => {
      switch (s.type) {
        case 'object':
        case 'artifact': {
          clone.id = uid(s.type === 'object' ? 'obj' : 'art');
          clone.name = `${r.item.name} (copia)`;
          clone.position = [clone.position[0] + 10, clone.position[1] + 10, clone.position[2]];
          (s.type === 'object' ? p.objects : p.artifacts).push(clone);
          sel = { type: s.type, id: clone.id };
          break;
        }
        case 'plane': {
          clone.id = uid('pl');
          clone.name = `${r.item.name} (copia)`;
          for (const sk of clone.sketches) { sk.id = uid('sk'); for (const e of sk.entities) e.id = uid('e'); }
          p.planes.push(clone);
          sel = { type: 'plane', id: clone.id };
          break;
        }
        case 'sketch': {
          clone.id = uid('sk');
          clone.name = `${r.item.name} (copia)`;
          for (const e of clone.entities) e.id = uid('e');
          getSketch(s.id).plane.sketches.push(clone);
          sel = { type: 'sketch', id: clone.id };
          break;
        }
        case 'entity': {
          clone.id = uid('e');
          getSketch(s.sketchId).sketch.entities.push(clone);
          sel = { type: 'entity', id: clone.id, sketchId: s.sketchId };
          break;
        }
        case 'operation': {
          clone.id = uid('op');
          clone.name = `${r.item.name} (copia)`;
          p.operations.push(clone);
          sel = { type: 'operation', id: clone.id };
          break;
        }
      }
    });
    select(sel);
  };

  cmd.setGizmo = mode => {
    App.view.gizmo = mode;
    emit('gizmo');
  };

  cmd.dropToFloor = sel => {
    const obj = sync.objectFor(sel.type, sel.id);
    if (!obj) return;
    obj.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(obj);
    mutate(() => { const r = resolve(sel); r.item.position[2] = round4(r.item.position[2] - box.min.z); });
  };

  cmd.centerXY = sel => {
    const obj = sync.objectFor(sel.type, sel.id);
    if (!obj) return;
    obj.updateMatrixWorld(true);
    const c = new THREE.Box3().setFromObject(obj).getCenter(new THREE.Vector3());
    mutate(() => {
      const r = resolve(sel);
      r.item.position[0] = round4(r.item.position[0] - c.x);
      r.item.position[1] = round4(r.item.position[1] - c.y);
    });
  };

  // ================================================================ INSERISCI (artefatti)
  cmd.addArtifact = kind => {
    const d = ARTIFACT_DEFAULTS[kind];
    const t = vp.controls.target;
    const id = uid('art');
    mutate(p => {
      p.artifacts.push({
        id, name: nextName(d.base), kind,
        size: d.size ? [...d.size] : [20, 20, 20],
        radius: d.radius ?? 10, radius2: d.radius2 ?? 5, height: d.height ?? 20,
        position: [Math.round(t.x), Math.round(t.y), Math.round(t.z)], rotation: [0, 0, 0],
        color: '#ffb547', visible: true, include: true,
      });
    });
    select({ type: 'artifact', id });
    status(`${d.base} inserito: posizionalo con il manipolatore (G sposta, R ruota) o dalle proprietà`);
  };

  // ================================================================ PIANI
  cmd.addPlane = preset => {
    const box = sceneBox();
    const has = !box.isEmpty();
    const c = has ? box.getCenter(new THREE.Vector3()) : new THREE.Vector3();
    const sz = has ? box.getSize(new THREE.Vector3()) : new THREE.Vector3(80, 80, 80);
    let origin, normal, size;
    switch (preset) {
      case 'xz': origin = [c.x, has ? box.min.y : 0, c.z]; normal = [0, -1, 0]; size = Math.max(sz.x, sz.z); break;
      case 'yz': origin = [has ? box.max.x : 0, c.y, c.z]; normal = [1, 0, 0]; size = Math.max(sz.y, sz.z); break;
      default: origin = [c.x, c.y, has ? box.max.z : 0]; normal = [0, 0, 1]; size = Math.max(sz.x, sz.y);
    }
    cmd.createPlane(origin, normal, Math.max(60, Math.ceil(size * 1.3 / 10) * 10));
  };

  cmd.createPlane = (origin, normal, size = 100, angle = 0) => {
    const id = uid('pl');
    mutate(p => {
      p.planes.push({
        id, name: nextName('Piano'), origin: origin.map(round4), normal: normal.map(v => Math.round(v * 1e6) / 1e6),
        angle, size, visible: true, sketches: [],
      });
    });
    select({ type: 'plane', id });
    status('Piano creato: aggiungi uno sketch per disegnare l\'area di contenimento');
    return id;
  };

  /**
   * Piano dalla vista: normale verso chi guarda, appoggiato al punto del modello più vicino all'osservatore
   * (da lì parte la svuotatura), centrato sull'ingombro visto e con l'asse U allineato alla destra dello schermo,
   * così lo sketch si disegna come lo si vede.
   */
  cmd.planeFromView = () => {
    if (sketch.active) sketch.exit();
    const n = vp.camera.position.clone().sub(vp.controls.target).normalize();
    // vicino a una vista standard (facce, spigoli, vertici del cubo) si usa la direzione esatta:
    // dall'alto il piano risulta allineato a XY e il G-code resta a 3 assi
    const snap = VIEW_SNAP.find(d => d.angleTo(n) < THREE.MathUtils.degToRad(1));
    if (snap) n.copy(snap);
    vp.camera.updateMatrixWorld();
    const right = new THREE.Vector3().setFromMatrixColumn(vp.camera.matrixWorld, 0);
    right.addScaledVector(n, -right.dot(n));
    let angle = right.lengthSq() > 1e-8 ? angleOfU(n, right.normalize()) : 0;
    angle = Math.abs(angle - Math.round(angle)) < 0.05 ? Math.round(angle) : Math.round(angle * 1000) / 1000;
    if (angle <= -180) angle += 360;
    const f = planeFrame({ normal: n.toArray(), angle, origin: [0, 0, 0] });

    // ingombro del modello nel sistema del piano, dai vertici reali (non dal box allineato agli assi)
    let umin = Infinity, umax = -Infinity, vmin = Infinity, vmax = -Infinity, wmax = -Infinity;
    const p = new THREE.Vector3();
    for (const g of [vp.groups.objects, vp.groups.artifacts]) {
      g.updateMatrixWorld(true);
      g.traverseVisible(o => {
        const pos = o.isMesh ? o.geometry?.attributes.position : null;
        if (!pos) return;
        for (let i = 0; i < pos.count; i++) {
          p.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld);
          const u = p.dot(f.u), v = p.dot(f.v), w = p.dot(f.n);
          if (u < umin) umin = u;
          if (u > umax) umax = u;
          if (v < vmin) vmin = v;
          if (v > vmax) vmax = v;
          if (w > wmax) wmax = w;
        }
      });
    }
    let origin = vp.controls.target.clone(), size = 100;
    if (wmax > -Infinity) {
      origin = f.u.clone().multiplyScalar((umin + umax) / 2).addScaledVector(f.v, (vmin + vmax) / 2).addScaledVector(f.n, wmax);
      size = Math.max(60, Math.ceil(Math.max(umax - umin, vmax - vmin) * 1.3 / 10) * 10);
    }
    cmd.createPlane(origin.toArray(), n.toArray(), size, angle);
    const axis = AXIS_NAMES.find(a => a.d.angleTo(n) < 1e-9)?.name || `(${n.toArray().map(x => fmt(x, 3)).join(', ')})`;
    status(`Piano dalla vista: normale ${axis}, appoggiato al modello. Aggiungi uno sketch per l'area di contenimento`);
  };

  cmd.planeFromFace = () => {
    startPick({ kind: 'face' }, 'Clic su una superficie di un oggetto o artefatto: il piano avrà la normale della faccia · <b>Esc</b> annulla');
  };

  cmd.planeFrom3Points = () => {
    startPick({ kind: '3pt', pts: [] }, 'Clic su 3 punti degli oggetti per definire il piano (1/3) · <b>Esc</b> annulla');
  };

  function startPick(mode, hintHtml) {
    if (sketch.active) sketch.exit();
    App.pickMode = mode;
    vp.transform.detach();
    vp.el.classList.add('picking');
    const hint = document.getElementById('hint');
    hint.innerHTML = hintHtml;
    hint.hidden = false;
  }

  cmd.cancelPick = () => {
    App.pickMode = null;
    vp.el.classList.remove('picking');
    document.getElementById('hint').hidden = true;
    clearHelpers();
    emit('gizmo');
  };

  function clearHelpers() {
    for (const c of [...vp.groups.helpers.children]) {
      c.removeFromParent();
      c.geometry?.dispose(); c.material?.dispose();
    }
  }

  /** Gestisce un clic nel 3D quando è attiva una modalità di selezione punti. */
  cmd.handlePick = ev => {
    const pm = App.pickMode;
    if (!pm || ev.button !== 0) return;
    const targets = [];
    vp.groups.objects.traverseVisible(o => { if (o.isMesh) targets.push(o); });
    vp.groups.artifacts.traverseVisible(o => { if (o.isMesh) targets.push(o); });
    const hit = vp.raycast(ev, targets, false)[0];
    if (!hit) { toast('Nessuna superficie sotto il cursore', 'warn', 1800); return; }
    const p = hit.point.clone();
    const px = vp.pixelSize(p);
    if (pm.kind === 'face') {
      const n = hit.face.normal.clone().transformDirection(hit.object.matrixWorld).normalize();
      const toCam = vp.camera.position.clone().sub(p);
      if (n.dot(toCam) < 0) n.negate();
      cmd.cancelPick();
      cmd.createPlane(p.toArray(), n.toArray(), 80);
      return;
    }
    if (pm.kind === '3pt') {
      pm.pts.push(p);
      const m = new THREE.Mesh(new THREE.SphereGeometry(px * 5, 12, 8), new THREE.MeshBasicMaterial({ color: 0xff8a3d, depthTest: false }));
      m.position.copy(p);
      m.renderOrder = 30;
      vp.groups.helpers.add(m);
      document.getElementById('hint').innerHTML = `Clic su 3 punti degli oggetti per definire il piano (${pm.pts.length + 1}/3) · <b>Esc</b> annulla`;
      if (pm.pts.length === 3) {
        const [a, b, c] = pm.pts;
        const n = b.clone().sub(a).cross(c.clone().sub(a));
        if (n.lengthSq() < 1e-10) { toast('Punti allineati: riprovare', 'err'); pm.pts = []; clearHelpers(); return; }
        n.normalize();
        if (n.dot(vp.camera.position.clone().sub(a)) < 0) n.negate();
        const size = Math.max(a.distanceTo(b), b.distanceTo(c), c.distanceTo(a)) * 1.5;
        cmd.cancelPick();
        cmd.createPlane(a.toArray(), n.toArray(), Math.max(40, Math.ceil(size / 10) * 10));
      }
    }
  };

  cmd.flipNormal = planeId => {
    mutate(() => {
      const pl = getPlane(planeId);
      if (pl) pl.normal = pl.normal.map(v => (v === 0 ? 0 : -v));
    });
    sketch.refreshFrame();
  };

  cmd.viewNormal = planeId => {
    const pl = getPlane(planeId || planeOfSelection()?.id);
    if (!pl) { toast('Selezionare un piano', 'warn'); return; }
    const f = planeFrame(pl);
    vp.lookAlongFrame(f, false, (pl.size || 100) * 1.8);
  };

  // ================================================================ SKETCH
  cmd.newSketch = planeId => {
    let pl = planeId ? getPlane(planeId) : planeOfSelection();
    if (!pl) pl = App.project.planes[0];
    if (!pl) {
      cmd.addPlane('xy');
      pl = planeOfSelection();
    }
    const id = uid('sk');
    mutate(() => {
      getPlane(pl.id).sketches.push({ id, name: nextName('Sketch'), visible: true, entities: [] });
    });
    sketch.enter(id);
  };

  cmd.editSketch = id => {
    const sid = id || sketchOfSelection()?.id;
    if (!sid) { cmd.newSketch(); return; }
    sim.stop();
    if (App.pickMode) cmd.cancelPick();
    sketch.enter(sid);
  };

  cmd.finishSketch = () => sketch.exit();

  cmd.sketchTool = tool => {
    if (!sketch.active) {
      const sk = sketchOfSelection();
      if (sk) sketch.enter(sk.id); else cmd.newSketch();
    }
    sketch.setTool(tool);
  };

  // ================================================================ LAVORAZIONI
  cmd.newOperation = (kind, sketchId) => {
    let sid = sketchId || sketchOfSelection()?.id || allSketches()[0]?.sketch.id;
    if (!sid) {
      modal({
        title: 'Serve un contorno',
        body: h('div', {}, 'Per creare una lavorazione occorre un piano con uno sketch che definisca l\'area di contenimento. ',
          'Usa ', h('b', {}, 'Piani › Nuovo piano'), ' e poi ', h('b', {}, 'Sketch › Nuovo sketch'), '.'),
      });
      return;
    }
    const d = structuredClone(OP_DEFAULTS[kind]);
    const base = d.base;
    delete d.base;
    const id = uid('op');
    mutate(p => {
      p.operations.push({ id, name: nextName(base), kind, sketchId: sid, visible: true, ...d });
    });
    if (sketch.active) sketch.exit();
    select({ type: 'operation', id });
  };

  function buildRequest(op) {
    const sk = getSketch(op.sketchId);
    if (!sk) throw new Error(`"${op.name}": selezionare uno sketch di contorno`);
    const ents = sk.sketch.entities.filter(e => e.kind !== 'polyline' || (e.pts && e.pts.length >= 3));
    if (!ents.length) throw new Error(`Lo sketch "${sk.sketch.name}" non contiene contorni chiusi`);
    const f = planeFrame(sk.plane);
    const vec = v => [v.x, v.y, v.z];
    const o = op;
    return {
      operation: {
        id: o.id, name: o.name, kind: o.kind, strategy: o.strategy, tool: { ...o.tool },
        stepover: o.stepover, stepdown: o.stepdown, maxDepth: o.maxDepth, stock: o.stock, safeHeight: o.safeHeight,
        clearance: o.clearance, angle: o.angle, climb: o.climb !== false, toolInside: o.toolInside !== false,
        contourPass: o.contourPass !== false, resolution: o.resolution, tolerance: o.tolerance,
        feed: o.feed, plunge: o.plunge, spindle: o.spindle,
        entry: o.entry || 'plunge', rampAngle: o.rampAngle ?? 3, helixRadius: o.helixRadius ?? 0, rampFeed: o.rampFeed ?? 0,
      },
      plane: { origin: vec(f.o), u: vec(f.u), v: vec(f.v), n: vec(f.n) },
      boundary: ents.map(e => ({
        id: e.id, kind: e.kind, pts: e.pts, closed: true, x1: e.x1, y1: e.y1, x2: e.x2, y2: e.y2,
        cx: e.cx, cy: e.cy, r: e.r, sides: e.sides, rot: e.rot,
      })),
      objects: App.project.objects.filter(x => x.include !== false && x.meshId).map(x => ({
        meshId: x.meshId, name: x.name, position: x.position, rotation: x.rotation, scale: x.scale, include: true,
      })),
      artifacts: App.project.artifacts.filter(x => x.include !== false).map(x => ({
        id: x.id, name: x.name, kind: x.kind, size: x.size, radius: x.radius, radius2: x.radius2, height: x.height,
        position: x.position, rotation: x.rotation, include: true,
      })),
    };
  }

  function requestHash(req) {
    return JSON.stringify({
      ...req,
      operation: { ...req.operation, name: undefined },
      objects: req.objects.map(o => ({ ...o, name: undefined })),
      artifacts: req.artifacts.map(a => ({ ...a, name: undefined })),
    });
  }

  cmd.opStatus = op => {
    const d = App.runtime.toolpaths.get(op.id);
    if (!d) return 'none';
    try { return requestHash(buildRequest(op)) === d.hash ? 'ok' : 'stale'; } catch { return 'stale'; }
  };

  async function computeOne(op, signal) {
    const req = buildRequest(op);
    const res = await api.compute(req, signal);
    const tp = await api.getToolpath(res.toolpathId);
    App.runtime.toolpaths.set(op.id, {
      toolpathId: res.toolpathId, hash: requestHash(req), stats: res.stats, warnings: res.warnings || [],
      positions: tp.positions, types: tp.types,
    });
    return res;
  }

  cmd.compute = async opId => {
    const op = getOperation(opId);
    if (!op) return;
    if (sim.opId === opId) sim.stop();
    const signal = busy(`Calcolo "${op.name}"…`);
    try {
      const res = await computeOne(op, signal);
      emit('toolpath');
      const s = res.stats;
      status(`"${op.name}": ${s.pointCount.toLocaleString('it-IT')} punti, ${fmt(s.feedLength / 1000, 2)} m di lavoro, ${s.levels} ${op.kind === 'finish' ? 'passata' : 'terrazze'}, ${s.computeMs} ms`);
      for (const w of res.warnings || []) toast(w, 'warn', 6000);
      if (!res.warnings?.length) toast(`Percorso "${op.name}" calcolato`, 'ok', 2200);
      return true;
    } catch (e) {
      if (e.name === 'AbortError') toast('Calcolo annullato', 'warn');
      else { toast(e.message, 'err', 6000); status(e.message, true); }
      return false;
    } finally { idle(); }
  };

  cmd.computeSelected = () => {
    const r = resolve();
    if (r?.type === 'operation') return cmd.compute(r.item.id);
    if (App.project.operations.length) return cmd.computeAll();
    toast('Nessuna lavorazione da calcolare', 'warn');
  };

  /** Calcola le lavorazioni indicate (o tutte) che non sono aggiornate. */
  async function ensureComputed(ops, force = false) {
    const todo = ops.filter(op => force || cmd.opStatus(op) !== 'ok');
    if (!todo.length) return true;
    const signal = busy('Calcolo lavorazioni…');
    try {
      for (let i = 0; i < todo.length; i++) {
        busyText(`Calcolo ${i + 1}/${todo.length}: "${todo[i].name}"…`);
        const res = await computeOne(todo[i], signal);
        for (const w of res.warnings || []) toast(`${todo[i].name}: ${w}`, 'warn', 6000);
      }
      return true;
    } catch (e) {
      if (e.name === 'AbortError') toast('Calcolo annullato', 'warn');
      else toast(e.message, 'err', 6000);
      return false;
    } finally {
      idle();
      emit('toolpath');
    }
  }

  cmd.computeAll = async () => {
    const ops = App.project.operations;
    if (!ops.length) { toast('Nessuna lavorazione', 'warn'); return; }
    if (await ensureComputed(ops, true)) status(`${ops.length} lavorazioni calcolate`);
  };

  cmd.simulate = async opId => {
    const id = opId || (resolve()?.type === 'operation' ? App.selection.id : App.project.operations[0]?.id);
    const op = getOperation(id);
    if (!op) { toast('Selezionare una lavorazione', 'warn'); return; }
    if (!(await ensureComputed([op]))) return;
    if (sketch.active) sketch.exit();
    vp.transform.detach();
    sim.start(op.id);
  };

  // ---------------------------------------------------------------- esportazione
  cmd.exportGcode = async opIds => exportDialog('gcode', opIds);
  cmd.exportCl = async opIds => exportDialog('cl', opIds);

  async function exportDialog(kind, opIds) {
    const ops = App.project.operations;
    if (!ops.length) { toast('Nessuna lavorazione da esportare', 'warn'); return; }
    const preset = new Set(opIds && opIds.length ? opIds : ops.filter(o => o.visible !== false).map(o => o.id));
    const checks = ops.map(op => {
      const c = h('input', { type: 'checkbox' });
      c.checked = preset.has(op.id);
      return { op, c };
    });
    const mode = h('select', {},
      h('option', { value: 'grbl' }, 'GRBL 1.1 / grblHAL / FluidNC (mini CNC, 3 assi)'),
      h('option', { value: 'g682' }, 'Fanuc/ISO 3+2 assi: piano inclinato G68.2'),
      h('option', { value: 'world' }, 'Fanuc/ISO coordinate mondo XYZ (3 assi)'));
    try { const m = localStorage.getItem(POST_MODE_KEY); if (m && [...mode.options].some(o => o.value === m)) mode.value = m; } catch { /* storage non disponibile */ }
    const prog = h('input', { value: '1000', style: { width: '90px' } });
    const dwell = h('input', { value: '2', style: { width: '60px' } });
    const cool = h('input', { type: 'checkbox' });
    let coolTouched = false;
    cool.addEventListener('change', () => { coolTouched = true; });
    const hint = h('p', { style: { color: 'var(--text-faint)', margin: '2px 0 8px' } });
    const rowProg = h('div', { class: 'form-row' }, h('label', {}, 'Numero programma'), prog);
    const rowDwell = h('div', { class: 'form-row' }, h('label', {}, 'Attesa avvio mandrino (s)'), dwell);
    const syncMode = () => {
      const grbl = mode.value === 'grbl';
      rowProg.hidden = grbl;
      rowDwell.hidden = !grbl;
      if (!coolTouched) cool.checked = !grbl;   // le mini CNC di solito non hanno refrigerante
      hint.textContent = grbl
        ? 'Cambi utensile e piani inclinati diventano pause M0: le istruzioni per riposizionare il pezzo e azzerare sono nei commenti.'
        : mode.value === 'g682' ? 'I piani inclinati usano G68.2 con coordinate nel sistema del piano.' : 'Tutte le coordinate nel sistema del progetto: orientare l\'utensile secondo l\'asse indicato.';
    };
    mode.addEventListener('change', syncMode);
    syncMode();
    const body = h('div', {},
      kind === 'gcode' ? [
        h('div', { class: 'form-row' }, h('label', {}, 'Controllo'), mode),
        hint,
        rowProg, rowDwell,
        h('div', { class: 'form-row' }, h('label', {}, 'Refrigerante (M8/M9)'), h('div', {}, cool)),
      ] : h('p', {}, 'CL data in coordinate mondo con vettore asse utensile (GOTO/x,y,z,i,j,k).'),
      h('div', { class: 'p-sec', style: { padding: '6px 0' } }, 'Lavorazioni'),
      checks.map(({ op, c }) => h('label', { style: { display: 'flex', gap: '8px', alignItems: 'center', padding: '2px 0' } }, c, op.name,
        h('span', { style: { color: 'var(--text-faint)' } }, ` · T${op.tool.number} ${toolLabel(op.tool)} · ${op.kind === 'finish' ? 'finitura' : 'svuotatura'}`))));
    const ok = await modal({
      title: kind === 'gcode' ? 'Esporta G-code' : 'Esporta CL data', body,
      buttons: [{ label: 'Annulla', value: false }, { label: 'Genera', value: true, primary: true }],
    });
    if (!ok) return;
    const selOps = checks.filter(x => x.c.checked).map(x => x.op);
    if (!selOps.length) { toast('Nessuna lavorazione selezionata', 'warn'); return; }
    if (!(await ensureComputed(selOps))) return;
    const ids = selOps.map(o => App.runtime.toolpaths.get(o.id).toolpathId);
    if (kind === 'gcode') try { localStorage.setItem(POST_MODE_KEY, mode.value); } catch { /* storage non disponibile */ }
    const delay = parseFloat(String(dwell.value).replace(',', '.'));
    const options = {
      mode: mode.value, programNumber: parseInt(prog.value, 10) || 1000, decimals: 3,
      coolant: cool.checked, programName: App.project.name || 'CARVECAM',
      spindleDelay: Number.isFinite(delay) ? Math.max(0, Math.min(60, delay)) : 2,
    };
    let text;
    try {
      text = kind === 'gcode' ? await api.gcode(ids, options) : await api.cldata(ids, options);
    } catch (e) {
      // percorsi scaduti sul server (es. riavvio): ricalcola e riprova una volta
      if (!(await ensureComputed(selOps, true))) return;
      const ids2 = selOps.map(o => App.runtime.toolpaths.get(o.id).toolpathId);
      try {
        text = kind === 'gcode' ? await api.gcode(ids2, options) : await api.cldata(ids2, options);
      } catch (e2) { toast(e2.message, 'err'); return; }
    }
    const ext = kind === 'gcode' ? 'nc' : 'cls';
    const lines = text.split('\n');
    const pre = h('pre', {}, lines.length > 4000 ? lines.slice(0, 4000).join('\n') + `\n… (${lines.length - 4000} righe non mostrate)` : text);
    const copy = h('button', { class: 'btn', onclick: async () => { try { await navigator.clipboard.writeText(text); toast('Copiato negli appunti', 'ok'); } catch { toast('Copia non consentita dal browser', 'warn'); } } }, 'Copia');
    const res = await modal({
      title: `${kind === 'gcode' ? 'G-code' : 'CL data'} · ${lines.length.toLocaleString('it-IT')} righe`, wide: true,
      body: h('div', {}, pre, h('div', { style: { marginTop: '8px' } }, copy)),
      buttons: [{ label: 'Chiudi', value: false }, { label: `Scarica .${ext}`, value: true, primary: true }],
    });
    if (res) download(text, `${safeName(App.project.name || 'carvecam')}.${ext}`, 'text/plain');
  }

  // ================================================================ VISTA
  cmd.setView = name => vp.setView(name);
  cmd.fit = () => vp.fit();
  cmd.toggleProjection = () => {
    vp.setProjection(!vp.isOrtho);
    document.getElementById('btn-proj').setAttribute('aria-pressed', String(vp.isOrtho));
  };
  const toggleView = key => () => { App.view[key] = !App.view[key]; emit('view'); };
  cmd.toggleGrid = toggleView('grid');
  cmd.toggleToolpaths = toggleView('toolpaths');
  cmd.toggleRapids = toggleView('rapids');
  cmd.toggleWireframe = toggleView('wireframe');
  cmd.toggleGizmoSnap = () => { App.view.gizmoSnap = !App.view.gizmoSnap; emit('gizmo'); };
  cmd.toggleGizmoSpace = () => { App.view.gizmoLocal = !App.view.gizmoLocal; emit('gizmo'); };

  // ================================================================ AIUTO
  cmd.shortcuts = () => {
    const rows = [
      ['Ctrl+K', 'Cerca un comando'], ['Ctrl+S / Ctrl+O', 'Salva / apri progetto (.ccam)'], ['Ctrl+I', 'Importa modello 3D'],
      ['Ctrl+Z / Ctrl+Y', 'Annulla / ripeti'], ['Canc', 'Elimina selezione'], ['Ctrl+D', 'Duplica'],
      ['G / R', 'Manipolatore: sposta / ruota'], ['Esc', 'Annulla comando / deseleziona / esci dallo sketch'],
      ['F', 'Adatta alla vista'], ['7 / 1 / 3 / 0', 'Vista alto / fronte / destra / iso'], ['5', 'Prospettica ↔ ortogonale'],
      ['F9', 'Calcola lavorazione selezionata (o tutte)'], ['Spazio', 'Avvia/pausa simulazione'],
      ['Sketch: L R C P S', 'Polilinea, rettangolo, cerchio, poligono, seleziona'],
      ['Sketch: Invio / Backspace', 'Chiudi polilinea / annulla ultimo vertice'],
      ['Sketch: coordinate', 'x,y assolute · @dx,dy relative · numero = raggio'],
      ['Mouse', 'Sinistro ruota · centrale/destro trasla · rotella zoom'],
    ];
    modal({ title: 'Scorciatoie da tastiera', body: h('table', {}, rows.map(([k, v]) => h('tr', {}, h('td', {}, k), h('td', {}, v)))) });
  };

  /** Scena dimostrativa: artefatti, piano di lavoro con contorno, svuotatura e finitura pronte da calcolare. */
  cmd.demoProject = async () => {
    const p = App.project;
    if ((p.objects.length || p.artifacts.length || p.planes.length) && !(await confirmBox('Progetto di esempio', 'Il progetto corrente verrà sostituito.', 'Continua'))) return;
    sketch.exit(false);
    sim.stop();
    const art = (kind, name, extra) => ({ id: uid('art'), name, kind, size: [20, 20, 20], radius: 10, radius2: 5, height: 20,
      rotation: [0, 0, 0], color: '#ffb547', visible: true, include: true, ...extra });
    const skId = uid('sk');
    const proj = newProject();
    proj.name = 'Esempio';
    proj.artifacts = [
      art('box', 'Blocco', { size: [50, 30, 15], position: [0, 0, 7.5] }),
      art('cylinder', 'Perno', { radius: 8, height: 22, position: [-38, 0, 11] }),
      art('sphere', 'Calotta', { radius: 14, position: [38, 0, 2] }),
      art('cone', 'Torretta', { radius: 11, radius2: 4, height: 18, position: [0, 34, 9] }),
    ];
    proj.planes = [{
      id: uid('pl'), name: 'Piano grezzo', origin: [0, 5, 26], normal: [0, 0, 1], angle: 0, size: 150, visible: true,
      sketches: [{ id: skId, name: 'Contorno', visible: true, entities: [{ id: uid('e'), kind: 'rect', x1: -62, y1: -30, x2: 62, y2: 45 }] }],
    }];
    proj.operations = [
      { id: uid('op'), name: 'Svuotatura', kind: 'pocket', sketchId: skId, visible: true, ...structuredClone(OP_DEFAULTS.pocket),
        tool: { number: 1, type: 'bull', diameter: 10, cornerRadius: 1 }, stepover: 5, stepdown: 2.5, maxDepth: 26, stock: 0.3, entry: 'helix' },
      { id: uid('op'), name: 'Finitura', kind: 'finish', sketchId: skId, visible: true, ...structuredClone(OP_DEFAULTS.finish),
        stepover: 0.8, maxDepth: 26 },
    ];
    for (const o of proj.operations) delete o.base;
    proj.counters = { Piano: 1, Sketch: 1, Svuotatura: 1, Finitura: 1 };
    setProject(proj);
    vp.setView('iso');
    vp.fit();
    select({ type: 'operation', id: proj.operations[0].id });
    toast('Progetto di esempio caricato: premere F9 o "Calcola tutte" per generare i percorsi', 'info', 6000);
  };

  cmd.about = () => modal({
    title: 'CarveCAM',
    body: h('div', {},
      h('img', { src: 'favicon.svg', alt: '', width: 56, height: 56, style: { display: 'block', margin: '2px 0 10px' } }),
      h('p', {}, 'Software CAM web per mini CNC: svuotatura (pocketing) a terrazze e finitura in proiezione con fresa, su modelli 3D e artefatti primitivi.'),
      h('p', {}, 'Server e motore di calcolo in VB.NET (.NET 10, ASP.NET Core): importazione mesh, drop-cutter, offset con Clipper2, verifica collisioni, post-processor G-code/CL. Interfaccia in Three.js.'),
      h('p', { style: { color: 'var(--text-faint)' } }, 'Unità: millimetri. Utensili: fresa cilindrica, torica e sferica. Ingressi: affondo, rampa, elica.')),
  });

  // ================================================================ menu contestuale del navigatore
  cmd.contextItems = sel => {
    const common = [{ label: 'Duplica', kbd: 'Ctrl+D', action: () => cmd.duplicateSelected() }, { label: 'Elimina', kbd: 'Canc', action: () => cmd.deleteSelected() }];
    switch (sel.type) {
      case 'object':
      case 'artifact':
        return [{ label: 'Appoggia su Z=0', action: () => cmd.dropToFloor(sel) }, { label: 'Centra in XY', action: () => cmd.centerXY(sel) },
          { label: 'Mostra / nascondi', action: () => cmd.toggleVisible(sel.type, sel.id) }, { sep: true }, ...common];
      case 'plane':
        return [{ label: 'Nuovo sketch', action: () => cmd.newSketch(sel.id) }, { label: 'Vista normale al piano', action: () => cmd.viewNormal(sel.id) },
          { label: 'Inverti normale', action: () => cmd.flipNormal(sel.id) }, { sep: true }, ...common];
      case 'sketch':
        return [{ label: 'Modifica sketch', action: () => cmd.editSketch(sel.id) },
          { label: 'Nuova svuotatura', action: () => cmd.newOperation('pocket', sel.id) },
          { label: 'Nuova finitura', action: () => cmd.newOperation('finish', sel.id) }, { sep: true }, ...common];
      case 'entity':
        return common;
      case 'operation':
        return [{ label: 'Calcola', kbd: 'F9', action: () => cmd.compute(sel.id) }, { label: 'Simula', action: () => cmd.simulate(sel.id) },
          { label: 'Esporta G-code…', action: () => cmd.exportGcode([sel.id]) }, { sep: true }, ...common];
    }
    return common;
  };

  return cmd;
}

export function toolLabel(t) {
  if (t.type === 'ball') return `sferica Ø${t.diameter}`;
  if (t.type === 'bull') return `torica Ø${t.diameter} R${t.cornerRadius ?? 1}`;
  return `cilindrica Ø${t.diameter}`;
}

function safeName(s) {
  return String(s).replace(/[\\/:*?"<>|]+/g, '_').trim() || 'carvecam';
}
