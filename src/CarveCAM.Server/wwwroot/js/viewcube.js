// Cubo di orientamento della vista: clic su facce, spigoli e vertici per le 26 viste standard,
// trascinamento per ruotare. Disegnato nello stesso renderer della vista, sotto un elemento HTML che
// riceve il puntatore (così i controlli orbitali della scena non lo vedono).
import * as THREE from 'three';
import { h } from './dialogs.js';

const FACES = [
  { n: [0, 0, 1], r: [1, 0, 0], u: [0, 1, 0], label: 'ALTO' },
  { n: [0, 0, -1], r: [-1, 0, 0], u: [0, 1, 0], label: 'BASSO' },
  { n: [0, -1, 0], r: [1, 0, 0], u: [0, 0, 1], label: 'FRONTE' },
  { n: [0, 1, 0], r: [-1, 0, 0], u: [0, 0, 1], label: 'RETRO' },
  { n: [1, 0, 0], r: [0, 1, 0], u: [0, 0, 1], label: 'DESTRA' },
  { n: [-1, 0, 0], r: [0, -1, 0], u: [0, 0, 1], label: 'SINISTRA' },
];
const NAMES = { z: ['basso', 'alto'], y: ['fronte', 'retro'], x: ['sinistra', 'destra'] };
const BAND = 0.34;   // larghezza della fascia di spigoli e vertici (il cubo va da -1 a 1)
const COLOR = { face: 0x46505c, band: 0x39414b, hover: 0x3fa7ff, line: 0x6b7784, text: '#dfe5ec' };
const FONT = '"IBM Plex Sans", "Segoe UI", system-ui, sans-serif';
const DRAG_SPEED = 0.02;   // radianti per pixel

/** "Alto", "Alto e fronte", "Alto, fronte e destra". */
function regionName(d) {
  const parts = [];
  if (d.z) parts.push(NAMES.z[d.z > 0 ? 1 : 0]);
  if (d.y) parts.push(NAMES.y[d.y > 0 ? 1 : 0]);
  if (d.x) parts.push(NAMES.x[d.x > 0 ? 1 : 0]);
  const s = parts.length > 1 ? `${parts.slice(0, -1).join(', ')} e ${parts[parts.length - 1]}` : parts[0];
  return s[0].toUpperCase() + s.slice(1);
}

export class ViewCube {
  /**
   * @param vp Viewport
   * @param hit elemento HTML sopra il quale viene disegnato il cubo (riceve clic e trascinamenti)
   */
  constructor(vp, hit) {
    this.vp = vp;
    this.hit = hit;
    this.tip = document.getElementById('tooltip');
    this.scene = new THREE.Scene();
    this.cam = new THREE.OrthographicCamera(-1.85, 1.85, 1.85, -1.85, 0.1, 20);
    this.scene.add(new THREE.AmbientLight(0xffffff, 1.5));
    this.light = new THREE.DirectionalLight(0xffffff, 1.7);
    this.scene.add(this.light);
    this.raycaster = new THREE.Raycaster();
    this.pieces = [];
    this.hover = null;
    this._build();
    this._bind();
    vp.overlays.add(r => this.render(r));
  }

  _build() {
    // 26 pezzi di una griglia 3x3x3 (senza il centro): 6 facce, 12 spigoli, 8 vertici
    const mid = 2 - 2 * BAND;
    for (let x = -1; x <= 1; x++) for (let y = -1; y <= 1; y++) for (let z = -1; z <= 1; z++) {
      if (!x && !y && !z) continue;
      const isFace = Math.abs(x) + Math.abs(y) + Math.abs(z) === 1;
      const base = isFace ? COLOR.face : COLOR.band;
      const m = new THREE.Mesh(
        new THREE.BoxGeometry(...[x, y, z].map(c => (c ? BAND : mid))),
        new THREE.MeshLambertMaterial({ color: base }));
      m.position.set(...[x, y, z].map(c => c * (1 - BAND / 2)));
      m.userData = { dir: new THREE.Vector3(x, y, z), base };
      this.pieces.push(m);
      this.scene.add(m);
    }
    this.scene.add(new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(2, 2, 2)),
      new THREE.LineBasicMaterial({ color: COLOR.line })));

    this.labels = FACES.map(f => {
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 256;
      const tex = new THREE.CanvasTexture(canvas);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = 4;
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2),
        new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }));
      const n = new THREE.Vector3(...f.n);
      mesh.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(new THREE.Vector3(...f.r), new THREE.Vector3(...f.u), n));
      mesh.position.copy(n).multiplyScalar(1.004);
      mesh.raycast = () => {};
      mesh.userData = { canvas, tex, text: f.label };
      this.scene.add(mesh);
      return mesh;
    });
    this._drawLabels();
    document.fonts?.load(`600 48px ${FONT}`).then(() => this._drawLabels(), () => {});
  }

  _drawLabels() {
    for (const l of this.labels) {
      const { canvas, tex, text } = l.userData;
      const ctx = canvas.getContext('2d');
      ctx.clearRect(0, 0, 256, 256);
      let size = 50;
      ctx.font = `600 ${size}px ${FONT}`;
      const w = ctx.measureText(text).width;
      if (w > 184) { size = Math.floor(size * 184 / w); ctx.font = `600 ${size}px ${FONT}`; }
      ctx.fillStyle = COLOR.text;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(text, 128, 131);
      tex.needsUpdate = true;
    }
  }

  // ---------------------------------------------------------------- disegno
  render(r) {
    if (this.hit.offsetParent === null) return;   // nascosto (es. durante lo sketch)
    const cv = r.domElement.getBoundingClientRect();
    const rc = this.hit.getBoundingClientRect();
    if (!rc.width || !rc.height) return;
    const x = rc.left - cv.left, y = cv.bottom - rc.bottom;
    // stesso orientamento della camera principale
    this.cam.quaternion.copy(this.vp.camera.quaternion);
    this.cam.position.set(0, 0, 6).applyQuaternion(this.cam.quaternion);
    this.cam.updateMatrixWorld();
    this.light.position.copy(this.cam.position);
    r.autoClear = false;
    r.setScissorTest(true);
    r.setScissor(x, y, rc.width, rc.height);
    r.setViewport(x, y, rc.width, rc.height);
    r.clearDepth();
    r.render(this.scene, this.cam);
    r.setScissorTest(false);
    r.autoClear = true;
  }

  // ---------------------------------------------------------------- puntatore
  _pick(ev) {
    const rc = this.hit.getBoundingClientRect();
    const ndc = new THREE.Vector2(((ev.clientX - rc.left) / rc.width) * 2 - 1, -((ev.clientY - rc.top) / rc.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.cam);
    return this.raycaster.intersectObjects(this.pieces, false)[0]?.object || null;
  }

  _bind() {
    const el = this.hit;
    let down = null;
    el.addEventListener('pointerdown', ev => {
      if (ev.button !== 0) return;
      ev.preventDefault();
      el.setPointerCapture(ev.pointerId);
      down = { x: ev.clientX, y: ev.clientY, lx: ev.clientX, ly: ev.clientY, drag: false };
    });
    el.addEventListener('pointermove', ev => {
      if (!down) { this._setHover(this._pick(ev)); return; }
      if (!down.drag && Math.hypot(ev.clientX - down.x, ev.clientY - down.y) > 3) {
        down.drag = true;
        this._setHover(null);
        el.classList.add('dragging');
      }
      if (down.drag) {
        this.vp.orbitBy(-(ev.clientX - down.lx) * DRAG_SPEED, (ev.clientY - down.ly) * DRAG_SPEED);
        down.lx = ev.clientX;
        down.ly = ev.clientY;
      }
    });
    const end = ev => {
      if (!down) return;
      const wasDrag = down.drag;
      down = null;
      el.classList.remove('dragging');
      if (ev.type !== 'pointerup') return;
      const p = this._pick(ev);
      if (!wasDrag && p) this.vp.viewFrom(p.userData.dir);
      this._setHover(p);
    };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
    el.addEventListener('pointerleave', () => { if (!down) this._setHover(null); });
    el.addEventListener('contextmenu', ev => ev.preventDefault());
  }

  _setHover(p) {
    if (p === this.hover) return;
    if (this.hover) this.hover.material.color.setHex(this.hover.userData.base);
    this.hover = p;
    if (p) p.material.color.setHex(COLOR.hover);
    this.hit.style.cursor = p ? 'pointer' : '';
    this._tip(p ? regionName(p.userData.dir) : null);
  }

  _tip(name) {
    const t = this.tip;
    if (!t) return;
    if (!name) { t.hidden = true; return; }
    t.replaceChildren(h('div', { class: 'tt-row' }, h('b', {}, `Vista: ${name}`)), h('div', { class: 'tt-hint' }, 'Trascina il cubo per ruotare'));
    t.hidden = false;
    const rc = this.hit.getBoundingClientRect();
    t.style.left = `${Math.max(6, rc.left - t.offsetWidth - 8)}px`;
    t.style.top = `${rc.top + rc.height / 2 - t.offsetHeight / 2}px`;
  }
}
