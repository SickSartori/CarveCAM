// Vista 3D: renderer, camere (prospettica/ortogonale, Z in alto), navigazione, manipolatore, triade assi.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { settings, color, onSettings } from './settings.js';

THREE.Object3D.DEFAULT_UP.set(0, 0, 1);

const VIEW_DIRS = {
  top: [0, -0.0001, 1],
  bottom: [0, 0.0001, -1],
  front: [0, -1, 0],
  back: [0, 1, 0],
  right: [1, 0, 0],
  left: [-1, 0, 0],
  iso: [1, -1, 0.85],
};

export class Viewport {
  constructor(el) {
    this.el = el;
    this.handlers = {};           // move, down, click, dblclick, leave
    this.frameHooks = new Set();  // funzioni chiamate ad ogni frame (dt in secondi)
    this.overlays = new Set();    // disegni sovrapposti dopo la scena (renderer), es. cubo di orientamento

    const r = this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: false });
    r.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    r.setClearColor(0x000000, 0);
    el.prepend(r.domElement);
    r.domElement.tabIndex = 0;

    this.scene = new THREE.Scene();
    this.persp = new THREE.PerspectiveCamera(40, 1, 0.5, 500000);
    this.ortho = new THREE.OrthographicCamera(-100, 100, 100, -100, -500000, 500000);
    this.camera = this.persp;
    this.persp.position.set(220, -260, 190);

    const c = this.controls = new OrbitControls(this.camera, r.domElement);
    c.enableDamping = true;
    c.dampingFactor = 0.18;
    c.zoomToCursor = true;
    c.screenSpacePanning = true;
    c.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.PAN, RIGHT: THREE.MOUSE.PAN };
    c.target.set(0, 0, 0);
    c.addEventListener('start', () => this._stopViewAnim());   // l'utente riprende il controllo della vista

    // luci: emisfera + luce che segue la camera
    this.scene.add(new THREE.HemisphereLight(0xe8eef5, 0x30353c, 1.35));
    this.headLight = new THREE.DirectionalLight(0xffffff, 1.6);
    this.scene.add(this.headLight, this.headLight.target);

    // griglia sul piano XY e assi (parametri e colori dalle opzioni)
    this.gridGroup = new THREE.Group();
    this.scene.add(this.gridGroup);
    this.buildGrid();

    // gruppi di contenuto
    this.groups = {};
    for (const k of ['objects', 'artifacts', 'planes', 'toolpaths', 'helpers']) {
      this.groups[k] = new THREE.Group();
      this.groups[k].name = k;
      this.scene.add(this.groups[k]);
    }

    // manipolatore
    const t = this.transform = new TransformControls(this.camera, r.domElement);
    t.setSize(settings.sizes.gizmo);
    this.scene.add(t.getHelper());
    t.addEventListener('dragging-changed', e => { c.enabled = !e.value; });

    this.raycaster = new THREE.Raycaster();
    this.raycaster.params.Line.threshold = 1;

    this._buildTriad();
    this._bindInput();
    onSettings(() => { this.buildGrid(); t.setSize(settings.sizes.gizmo); });

    this.clock = new THREE.Clock();
    const ro = new ResizeObserver(() => this.resize());
    ro.observe(el);
    this.resize();
    this._loop = this._loop.bind(this);
    requestAnimationFrame(this._loop);
  }

  /** (Ri)costruisce la griglia del piano XY secondo le opzioni (lato, passo fine e principale, colori). */
  buildGrid() {
    for (const c of [...this.gridGroup.children]) {
      c.removeFromParent();
      c.traverse(o => { o.geometry?.dispose(); o.material?.dispose(); });
    }
    const g = settings.grid;
    const size = Math.max(10, Number(g.size) || 1000);
    const div = step => Math.max(1, Math.min(2000, Math.round(size / Math.max(0.1, Number(step) || 10))));
    const cMinor = new THREE.Color(color('gridMinor'));
    const cMajor = new THREE.Color(color('gridMajor'));
    const minor = new THREE.GridHelper(size, div(g.minor), cMinor, cMinor);
    const major = new THREE.GridHelper(size, div(g.major), cMajor, cMajor);
    for (const gr of [minor, major]) {
      gr.rotation.x = Math.PI / 2;
      gr.material.transparent = true;
      gr.material.opacity = gr === minor ? 0.6 : 0.85;
      gr.material.depthWrite = false;
      gr.renderOrder = -2;
      this.gridGroup.add(gr);
    }
    this.gridGroup.add(makeAxes(Math.min(60, size / 4)));
  }

  // ---------------------------------------------------------------- dimensioni e loop
  resize() {
    const w = Math.max(1, this.el.clientWidth), h = Math.max(1, this.el.clientHeight);
    this.renderer.setSize(w, h, false);
    this.persp.aspect = w / h;
    this.persp.updateProjectionMatrix();
    this._updateOrthoFrustum();
    // ridimensionare la tela la svuota: si ridisegna subito, altrimenti (es. trascinando i separatori dei
    // pannelli) il fotogramma resta vuoto fino al giro successivo e la vista lampeggia
    this._draw();
  }

  _updateOrthoFrustum(height) {
    const w = Math.max(1, this.el.clientWidth), h = Math.max(1, this.el.clientHeight);
    const hh = (height ?? (this.ortho.top - this.ortho.bottom)) / 2;
    this.ortho.top = hh; this.ortho.bottom = -hh;
    this.ortho.left = -hh * w / h; this.ortho.right = hh * w / h;
    this.ortho.updateProjectionMatrix();
  }

  _loop() {
    requestAnimationFrame(this._loop);
    const dt = Math.min(0.1, this.clock.getDelta());
    for (const f of this.frameHooks) f(dt);
    this.controls.update();
    this._draw();
  }

  /** Disegna scena, triade degli assi e sovrapposizioni (cubo di orientamento) con la camera corrente. */
  _draw() {
    this.headLight.position.copy(this.camera.position);
    this.headLight.target.position.copy(this.controls.target);

    const r = this.renderer;
    const w = this.el.clientWidth, h = this.el.clientHeight;
    r.setViewport(0, 0, w, h);
    r.setScissorTest(false);
    r.autoClear = true;
    r.render(this.scene, this.camera);

    // triade assi in basso a sinistra
    const s = 92;
    r.autoClear = false;
    r.setScissorTest(true);
    r.setScissor(6, 6, s, s);
    r.setViewport(6, 6, s, s);
    r.clearDepth();
    const dir = this.camera.position.clone().sub(this.controls.target).normalize();
    this.triadCam.position.copy(dir.multiplyScalar(10));
    this.triadCam.up.copy(this.camera.up);
    this.triadCam.lookAt(0, 0, 0);
    r.render(this.triadScene, this.triadCam);
    r.setScissorTest(false);
    r.autoClear = true;
    for (const f of this.overlays) f(r);
  }

  _buildTriad() {
    this.triadScene = new THREE.Scene();
    this.triadCam = new THREE.OrthographicCamera(-1.6, 1.6, 1.6, -1.6, 0.1, 50);
    const axes = [[1, 0, 0, 0xff5f5f, 'X'], [0, 1, 0, 0x5fd35f, 'Y'], [0, 0, 1, 0x4f9dff, 'Z']];
    for (const [x, y, z, col, label] of axes) {
      const d = new THREE.Vector3(x, y, z);
      this.triadScene.add(new THREE.ArrowHelper(d, new THREE.Vector3(), 1, col, 0.28, 0.14));
      const sp = makeLabel(label, col);
      sp.position.copy(d.multiplyScalar(1.32));
      sp.scale.set(0.42, 0.42, 1);
      this.triadScene.add(sp);
    }
  }

  // ---------------------------------------------------------------- input
  _bindInput() {
    const dom = this.renderer.domElement;
    let down = null;
    // presa di una maniglia (es. punti di un'entità dello sketch): handlers.grab(ev) restituisce { move, end }
    // e il trascinamento non arriva a navigazione e manipolatore (ascoltatore in fase di cattura, eseguito prima)
    dom.addEventListener('pointerdown', ev => {
      if (ev.button !== 0 || !this.handlers.grab) return;
      const g = this.handlers.grab(ev);
      if (!g) return;
      ev.stopImmediatePropagation();
      ev.preventDefault();
      dom.setPointerCapture(ev.pointerId);
      const move = e => g.move?.(e);
      const up = e => {
        dom.removeEventListener('pointermove', move);
        dom.removeEventListener('pointerup', up);
        dom.removeEventListener('pointercancel', up);
        try { dom.releasePointerCapture(e.pointerId); } catch { /* già rilasciato */ }
        g.end?.(e, e.type === 'pointercancel');
      };
      dom.addEventListener('pointermove', move);
      dom.addEventListener('pointerup', up);
      dom.addEventListener('pointercancel', up);
    }, true);
    dom.addEventListener('pointerdown', ev => {
      down = { x: ev.clientX, y: ev.clientY, b: ev.button };
      this.handlers.down?.(ev);
    });
    dom.addEventListener('pointermove', ev => this.handlers.move?.(ev));
    dom.addEventListener('pointerup', ev => {
      if (down && down.b === ev.button && Math.hypot(ev.clientX - down.x, ev.clientY - down.y) < 5) {
        if (!this.transform.dragging) this.handlers.click?.(ev);
      }
      down = null;
    });
    dom.addEventListener('dblclick', ev => this.handlers.dblclick?.(ev));
    dom.addEventListener('pointerleave', ev => this.handlers.leave?.(ev));
    dom.addEventListener('contextmenu', ev => ev.preventDefault());
  }

  ndc(ev) {
    const rc = this.renderer.domElement.getBoundingClientRect();
    return new THREE.Vector2(((ev.clientX - rc.left) / rc.width) * 2 - 1, -((ev.clientY - rc.top) / rc.height) * 2 + 1);
  }

  raycast(ev, objects, recursive = true) {
    this.raycaster.setFromCamera(this.ndc(ev), this.camera);
    return this.raycaster.intersectObjects(objects, recursive);
  }

  /** Intersezione del raggio del mouse con il piano del sistema f (coordinate mondo). */
  rayPlane(ev, f) {
    this.raycaster.setFromCamera(this.ndc(ev), this.camera);
    const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(f.n, f.o);
    const p = new THREE.Vector3();
    return this.raycaster.ray.intersectPlane(plane, p) ? p : null;
  }

  /** Posizione sullo schermo (px rispetto all'angolo della vista) di un punto del mondo; null se dietro la camera. */
  toScreen(p) {
    const v = p.clone().project(this.camera);
    if (v.z > 1 || v.z < -1) return null;
    const w = this.el.clientWidth, h = this.el.clientHeight;
    return { x: (v.x + 1) / 2 * w, y: (1 - v.y) / 2 * h };
  }

  /** Posizione del puntatore rispetto all'angolo della vista. */
  pointer(ev) {
    const rc = this.renderer.domElement.getBoundingClientRect();
    return { x: ev.clientX - rc.left, y: ev.clientY - rc.top };
  }

  /** Millimetri per pixel in corrispondenza del punto dato. */
  pixelSize(worldPoint) {
    const h = Math.max(1, this.el.clientHeight);
    if (this.camera.isOrthographicCamera) return (this.ortho.top - this.ortho.bottom) / this.ortho.zoom / h;
    const d = this.camera.position.distanceTo(worldPoint);
    return (2 * d * Math.tan(THREE.MathUtils.degToRad(this.persp.fov / 2))) / h;
  }

  // ---------------------------------------------------------------- camere
  get isOrtho() { return this.camera.isOrthographicCamera; }

  setProjection(ortho) {
    if (ortho === this.isOrtho) return;
    const from = this.camera;
    const to = ortho ? this.ortho : this.persp;
    const dist = from.position.distanceTo(this.controls.target);
    to.position.copy(from.position);
    to.quaternion.copy(from.quaternion);
    to.up.copy(from.up);
    if (ortho) {
      const hgt = 2 * dist * Math.tan(THREE.MathUtils.degToRad(this.persp.fov / 2)) / (from.zoom || 1);
      this.ortho.zoom = 1;
      this._updateOrthoFrustum(hgt);
    } else {
      // mantiene la scala: ricolloca la camera prospettica alla distanza equivalente
      const hgt = (this.ortho.top - this.ortho.bottom) / this.ortho.zoom;
      const d = hgt / (2 * Math.tan(THREE.MathUtils.degToRad(this.persp.fov / 2)));
      const dir = from.position.clone().sub(this.controls.target).normalize();
      to.position.copy(this.controls.target).addScaledVector(dir, d);
    }
    this.camera = to;
    this.controls.object = to;
    this.transform.camera = to;
    this.controls.update();
  }

  /** Box di tutto il contenuto visibile. */
  contentBox() {
    const box = new THREE.Box3();
    for (const k of ['objects', 'artifacts', 'planes', 'toolpaths']) {
      this.groups[k].traverseVisible(o => {
        if ((o.isMesh || o.isLine) && o.geometry) {
          o.geometry.computeBoundingBox();
          if (o.geometry.boundingBox && !o.geometry.boundingBox.isEmpty()) {
            box.union(o.geometry.boundingBox.clone().applyMatrix4(o.matrixWorld));
          }
        }
      });
    }
    return box;
  }

  fit(box) {
    box = box && !box.isEmpty() ? box : this.contentBox();
    if (box.isEmpty()) box = new THREE.Box3(new THREE.Vector3(-50, -50, -10), new THREE.Vector3(50, 50, 10));
    const center = box.getCenter(new THREE.Vector3());
    const radius = Math.max(5, box.getSize(new THREE.Vector3()).length() / 2);
    const dir = this.camera.position.clone().sub(this.controls.target);
    if (dir.lengthSq() < 1e-9) dir.set(1, -1, 1);
    dir.normalize();
    const fov = THREE.MathUtils.degToRad(this.persp.fov);
    const aspect = this.persp.aspect;
    const fitH = radius / Math.sin(fov / 2);
    const fitW = radius / Math.sin(Math.atan(Math.tan(fov / 2) * aspect));
    const dist = Math.max(fitH, fitW) * 1.05;
    this.controls.target.copy(center);
    this.camera.position.copy(center).addScaledVector(dir, dist);
    if (this.isOrtho) {
      this.ortho.zoom = 1;
      this._updateOrthoFrustum(radius * 2.2);
    }
    this.camera.lookAt(center);
    this.controls.update();
  }

  setView(name) {
    const d = VIEW_DIRS[name];
    if (d) this.viewFrom(new THREE.Vector3(...d));
  }

  /**
   * Guarda il bersaglio dalla direzione dir (Z in alto), con una breve rotazione animata salvo preferenza
   * per il movimento ridotto. Si anima solo la direzione: distanza e bersaglio restano quelli correnti, così
   * un "Adatta" durante la rotazione non viene annullato.
   */
  viewFrom(dir, animate = true) {
    const to = new THREE.Vector3().copy(dir).normalize();
    // dall'alto o dal basso: piccolo scarto per evitare la singolarità dei controlli orbitali con Z in alto
    if (Math.abs(to.z) > 0.99999) to.set(0, -0.0001 * Math.sign(to.z), Math.sign(to.z)).normalize();
    this._stopViewAnim();
    const target = this.controls.target;
    const place = d => {
      const dist = Math.max(50, this.camera.position.distanceTo(target));
      this.camera.up.set(0, 0, 1);
      this.camera.position.copy(target).addScaledVector(d, dist);
      this.camera.lookAt(target);
    };
    const from = this.camera.position.clone().sub(target).normalize();
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (!animate || reduce || from.angleTo(to) < 0.002) { place(to); this.controls.update(); return; }
    const q = new THREE.Quaternion().setFromUnitVectors(from, to);
    const q0 = new THREE.Quaternion(), qk = new THREE.Quaternion();
    let t = 0;
    const hook = dt => {
      t = Math.min(1, t + dt / 0.32);
      const k = t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2;   // accelera e rallenta
      place(t < 1 ? from.clone().applyQuaternion(qk.slerpQuaternions(q0, q, k)) : to);
      if (t >= 1) this._stopViewAnim();
    };
    this._viewAnim = hook;
    this.frameHooks.add(hook);
  }

  _stopViewAnim() {
    if (this._viewAnim) this.frameHooks.delete(this._viewAnim);
    this._viewAnim = null;
  }

  /** Rotazione orbitale attorno al bersaglio: azimut attorno a Z e elevazione, in radianti (Z resta in alto). */
  orbitBy(dAzimuth, dElevation) {
    this._stopViewAnim();
    const target = this.controls.target;
    const off = this.camera.position.clone().sub(target);
    const r = off.length();
    const az = Math.atan2(off.y, off.x) + dAzimuth;
    const lim = Math.PI / 2 - 0.0005;
    const el = Math.max(-lim, Math.min(lim, Math.asin(Math.max(-1, Math.min(1, off.z / r))) + dElevation));
    off.set(Math.cos(el) * Math.cos(az), Math.cos(el) * Math.sin(az), Math.sin(el)).multiplyScalar(r);
    this.camera.up.set(0, 0, 1);
    this.camera.position.copy(target).add(off);
    this.camera.lookAt(target);
    this.controls.update();
  }

  /** Allinea la vista guardando lungo -n (dal lato utensile) con "alto" = v. */
  lookAlongFrame(f, keepUp = false, distance) {
    this._stopViewAnim();
    const dist = distance ?? Math.max(80, this.camera.position.distanceTo(this.controls.target));
    this.controls.target.copy(f.o);
    if (keepUp) {
      this.camera.up.copy(f.v);
    } else {
      this.camera.up.set(0, 0, 1);
    }
    const dir = f.n.clone();
    if (!keepUp && Math.abs(dir.z) > 0.9999) dir.add(new THREE.Vector3(0, -0.0001 * Math.sign(dir.z), 0)).normalize();
    this.camera.position.copy(f.o).addScaledVector(dir, dist);
    this.camera.lookAt(f.o);
    this.controls.update();
  }

  resetUp() {
    this.camera.up.set(0, 0, 1);
    this.camera.lookAt(this.controls.target);
    this.controls.update();
  }
}

function makeAxes(len) {
  const g = new THREE.Group();
  const mk = (x, y, z, col) => {
    const geo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(x, y, z)]);
    const l = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: col, transparent: true, opacity: 0.9, depthWrite: false }));
    l.renderOrder = -1;
    return l;
  };
  g.add(mk(len, 0, 0, 0xff5f5f), mk(0, len, 0, 0x5fd35f), mk(0, 0, len, 0x4f9dff));
  return g;
}

export function makeLabel(text, color = 0xffffff, px = 64) {
  const cv = document.createElement('canvas');
  cv.width = cv.height = px;
  const ctx = cv.getContext('2d');
  ctx.font = `600 ${Math.round(px * 0.62)}px Segoe UI, Arial, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#' + new THREE.Color(color).getHexString();
  ctx.fillText(text, px / 2, px / 2 + 2);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
}
