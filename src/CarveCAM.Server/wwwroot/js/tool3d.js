// Fresa in 3D generata dai suoi parametri: usata dalla simulazione e dall'anteprima del magazzino utensili.
import * as THREE from 'three';
import { toolSilhouette } from './oplib.js';
import { fmt } from './geom.js';
import { t } from './i18n.js';

/**
 * Utensile orientato lungo +Z locale con la punta nell'origine: tagliente (piatto, torico o sferico) alto Lc,
 * collo fino allo sbalzo, raccordo al gambo, gambo e portautensile. holder: frazione del portautensile disegnata.
 */
export function buildToolMesh(tool, { holder = 1 } = {}) {
  const { pts, dims: d, top } = toolSilhouette(tool);
  const g = new THREE.Group();
  const body = new THREE.MeshStandardMaterial({ color: 0xd4dbe3, metalness: 0.7, roughness: 0.25, side: THREE.DoubleSide });
  const flutes = new THREE.MeshStandardMaterial({ color: 0x9fb4c8, metalness: 0.6, roughness: 0.3, side: THREE.DoubleSide });
  const lathe = (profile, mat) => new THREE.Mesh(new THREE.LatheGeometry(profile.map(([r, z]) => new THREE.Vector2(r, z)), 48).rotateX(Math.PI / 2), mat);
  // tagliente: dalla punta alla sommità dei taglienti
  const k = pts.findIndex(([, z]) => z >= d.Lc - 1e-9);
  g.add(lathe([...pts.slice(0, k + 1), [0, d.Lc]], flutes));
  // collo, raccordo e gambo
  g.add(lathe([[0, d.Lc], ...pts.slice(k), [0, top]], body));
  if (holder > 0) {
    const len = d.holderLen * holder;
    const m = new THREE.Mesh(new THREE.CylinderGeometry(d.holderR, d.holderR * 0.8, len, 40).rotateX(Math.PI / 2),
      new THREE.MeshStandardMaterial({ color: 0x5b6570, metalness: 0.5, roughness: 0.4, transparent: true, opacity: 0.85 }));
    m.position.z = top + len / 2;
    g.add(m);
  }
  g.traverse(o => { o.raycast = () => {}; });
  return g;
}

function disposeTree(o) {
  o.traverse(x => { x.geometry?.dispose(); x.material?.dispose(); });
}

/**
 * Anteprima 3D di una fresa (un solo contesto WebGL per tutta l'applicazione): ruota lentamente, si può
 * girare trascinando. L'elemento el si inserisce nel modulo; il disegno si ferma quando non è nella pagina.
 */
class ToolViewer {
  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'tool-3d-canvas';
    this.label = document.createElement('div');
    this.label.className = 'tool-3d-label';
    this.el = document.createElement('div');
    this.el.className = 'tool-3d';
    this.el.title = t('Trascina per ruotare');
    this.el.append(this.canvas, this.label);
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setClearColor(0x000000, 0);
    this.scene = new THREE.Scene();
    this.scene.add(new THREE.HemisphereLight(0xeef3f8, 0x2a3038, 1.4));
    this.key = new THREE.DirectionalLight(0xffffff, 1.8);
    this.scene.add(this.key, this.key.target);
    this.camera = new THREE.PerspectiveCamera(28, 1, 0.1, 10000);
    this.camera.up.set(0, 0, 1);
    this.yaw = -0.9;
    this.pitch = 0.32;
    this.center = new THREE.Vector3();
    this.radius = 20;
    this.mesh = null;
    this.running = false;
    this._bindDrag();
    this._frame = this._frame.bind(this);
  }

  _bindDrag() {
    let last = null;
    this.canvas.addEventListener('pointerdown', e => {
      last = { x: e.clientX, y: e.clientY };
      this.canvas.setPointerCapture(e.pointerId);
      this.dragging = true;
    });
    this.canvas.addEventListener('pointermove', e => {
      if (!last) return;
      this.yaw -= (e.clientX - last.x) * 0.01;
      this.pitch = Math.max(-1.2, Math.min(1.2, this.pitch + (e.clientY - last.y) * 0.01));
      last = { x: e.clientX, y: e.clientY };
    });
    const up = () => { last = null; this.dragging = false; };
    this.canvas.addEventListener('pointerup', up);
    this.canvas.addEventListener('pointercancel', up);
  }

  /** Mostra la fresa con le misure date (il portautensile è accorciato per lasciare spazio al tagliente). */
  set(tool) {
    if (this.mesh) { this.mesh.removeFromParent(); disposeTree(this.mesh); }
    this.mesh = buildToolMesh(tool, { holder: 0.45 });
    this.scene.add(this.mesh);
    const box = new THREE.Box3().setFromObject(this.mesh);
    box.getCenter(this.center);
    this.radius = Math.max(1, box.getSize(new THREE.Vector3()).length() / 2);
    const { dims: d } = toolSilhouette(tool);
    const parts = tool.type === 'taper'
      ? [`${t('punta')} Ø${fmt(d.taper.rt * 2, 2)}`, `${fmt(d.taper.deg, 2)}°`, `Ø max ${fmt(d.D, 2)}`]
      : [`Ø${fmt(d.D, 2)}`];
    if (d.r > 0 && tool.type === 'bull') parts.push(`R${fmt(d.r, 2)}`);
    parts.push(`Lc ${fmt(d.Lc, 2)}`);
    if (d.reach > d.Lc + 1e-6) parts.push(`${t('sbalzo')} ${fmt(d.reach, 2)}`);
    this.label.textContent = parts.join(' · ');
    this._start();
  }

  _start() {
    if (this.running) return;
    this.running = true;
    this.prev = performance.now();
    requestAnimationFrame(this._frame);
  }

  _frame(now) {
    // fuori dalla pagina (finestra chiusa o altra fresa): il ciclo si ferma fino al prossimo set()
    if (!this.el.isConnected) { this.running = false; return; }
    requestAnimationFrame(this._frame);
    const dt = Math.min(0.1, (now - this.prev) / 1000);
    this.prev = now;
    if (!this.dragging) this.yaw += dt * 0.5;
    const w = this.el.clientWidth, h = this.el.clientHeight;
    if (w < 2 || h < 2) return;
    if (this.canvas.width !== Math.round(w * this.renderer.getPixelRatio()) || this.canvas.height !== Math.round(h * this.renderer.getPixelRatio())) {
      this.renderer.setSize(w, h, false);
    }
    this.camera.aspect = w / h;
    const fov = THREE.MathUtils.degToRad(this.camera.fov);
    const fit = Math.max(this.radius / Math.sin(fov / 2), this.radius / Math.sin(Math.atan(Math.tan(fov / 2) * this.camera.aspect)));
    const dir = new THREE.Vector3(Math.cos(this.pitch) * Math.cos(this.yaw), Math.cos(this.pitch) * Math.sin(this.yaw), Math.sin(this.pitch));
    this.camera.position.copy(this.center).addScaledVector(dir, fit * 1.02);
    this.camera.near = Math.max(0.01, fit - this.radius * 2);
    this.camera.far = fit + this.radius * 2;
    this.camera.updateProjectionMatrix();
    this.camera.lookAt(this.center);
    this.key.position.copy(this.camera.position).add(new THREE.Vector3(0, 0, this.radius));
    this.key.target.position.copy(this.center);
    this.renderer.render(this.scene, this.camera);
  }
}

let viewer = null;
/** Anteprima 3D condivisa (creata al primo uso). */
export function toolViewer() {
  if (!viewer) viewer = new ToolViewer();
  return viewer;
}
