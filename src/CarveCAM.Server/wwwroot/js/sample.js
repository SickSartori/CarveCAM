// Progetto di esempio: targa con cornice, fondo ribassato, logo e scritta "CarveCAM" in rilievo. La targa è
// una mesh generata qui (come un modello importato); le lavorazioni mostrano il flusso tipico: sgrossatura a
// terrazze, finitura con fresa sferica e ripresa dei dettagli della scritta con una fresa conica.
import { uid, newProject } from './state.js';
import { OP_DEFAULTS } from './oplib.js';
import { color } from './settings.js';
import { t } from './i18n.js';

/** Versione della geometria: cambiandola si rigenera la mesh memorizzata sul server. */
export const SAMPLE_VERSION = 1;

// misure della targa (mm): lato X, lato Y, spessore della cornice (= quota del grezzo), larghezza della cornice
// e raggio del raccordo concavo ai piedi della cornice
const W = 120, H = 64, TOP = 12, FRAME = 5, COVE = 2.5;

/** Ingombro della targa (per inquadrarla). */
export const SAMPLE_BOUNDS = { min: [-W / 2, -H / 2, 0], max: [W / 2, H / 2, TOP] };
const BG = 7;            // quota del fondo ribassato (5 mm sotto la cornice)
const PITCH = 0.2;       // passo della griglia della superficie
const TILE = 8;          // lato dei riquadri (in passi): i riquadri piani diventano due soli triangoli
const PX_MM = 10;        // risoluzione della maschera della scritta (pixel per mm)

// logo (dal disegno di favicon.svg, unità 32 × 32): due archi concentrici aperti a destra e il punto della fresa
const LOGO = { cx: -35, cy: 0, s: 1.45 };
const TEXT = { x0: -15, x1: 50, cap: 0.72 };   // scritta: da x0 a x1, altezza delle maiuscole in proporzione

/**
 * Profilo di un rilievo: parete ripida che si arrotonda fino alla sommità piana, larga r (d = distanza dentro
 * la sagoma). Una parete non verticale si rappresenta bene anche con la griglia della superficie.
 */
function roundTop(d, amp, r) {
  if (d <= 0) return -Infinity;
  if (d >= r) return amp;
  return amp * Math.sin(Math.PI / 2 * d / r);
}

/** Distanza (con segno: positiva dentro) da un arco di raggio R con estremi a ±45° dall'asse +X e tratto largo w. */
function arcInside(dx, dy, R, w) {
  const rho = Math.hypot(dx, dy);
  const c45 = Math.SQRT1_2;
  let d;
  if (rho > 1e-9 && dx / rho <= c45) d = Math.abs(rho - R);
  else d = Math.min(Math.hypot(dx - R * c45, dy - R * c45), Math.hypot(dx - R * c45, dy + R * c45));
  return w / 2 - d;
}

/** Maschera della scritta in pixel e distanza di ogni pixel interno dal bordo (mm). */
async function textField() {
  const cw = Math.round(W * PX_MM), ch = Math.round(H * PX_MM);
  const cv = document.createElement('canvas');
  cv.width = cw;
  cv.height = ch;
  const g = cv.getContext('2d', { willReadFrequently: true });
  const family = '"IBM Plex Sans", "Segoe UI", Arial, sans-serif';
  try { await Promise.race([document.fonts.load(`600 100px "IBM Plex Sans"`), new Promise(r => setTimeout(r, 1500))]); } catch { /* carattere di sistema */ }
  g.fillStyle = '#000';
  g.fillRect(0, 0, cw, ch);
  g.fillStyle = '#fff';
  g.textBaseline = 'alphabetic';
  // dimensione del carattere tale che il disegno delle lettere (non l'avanzamento) vada da x0 a x1
  const ink = m => (m.actualBoundingBoxLeft + m.actualBoundingBoxRight) || m.width;
  g.font = `600 100px ${family}`;
  const size = 100 * (TEXT.x1 - TEXT.x0) * PX_MM / ink(g.measureText('CarveCAM'));
  g.font = `600 ${size}px ${family}`;
  const m2 = g.measureText('CarveCAM');
  const capH = m2.actualBoundingBoxAscent || size * TEXT.cap;
  const x = (TEXT.x0 + W / 2) * PX_MM + (m2.actualBoundingBoxLeft || 0);
  const y = ch / 2 + capH / 2;
  g.fillText('CarveCAM', x, y);
  // contorno largo 0,6 mm: lettere più robuste, adatte alla fresa sferica della finitura
  g.strokeStyle = '#fff';
  g.lineJoin = 'round';
  g.lineWidth = 0.6 * PX_MM;
  g.strokeText('CarveCAM', x, y);
  const img = g.getImageData(0, 0, cw, ch).data;
  // distanza dal bordo per i pixel interni (smussatura 1 / √2 in due passate)
  const INF = 1e9, D = Math.SQRT2;
  const d = new Float32Array(cw * ch);
  for (let i = 0; i < d.length; i++) d[i] = img[i * 4] >= 128 ? INF : 0;
  for (let yy = 0; yy < ch; yy++) for (let xx = 0; xx < cw; xx++) {
    const i = yy * cw + xx;
    if (!d[i]) continue;
    let v = d[i];
    v = Math.min(v, xx > 0 ? d[i - 1] + 1 : 1, yy > 0 ? d[i - cw] + 1 : 1);
    if (yy > 0) v = Math.min(v, xx > 0 ? d[i - cw - 1] + D : D, xx < cw - 1 ? d[i - cw + 1] + D : D);
    d[i] = v;
  }
  for (let yy = ch - 1; yy >= 0; yy--) for (let xx = cw - 1; xx >= 0; xx--) {
    const i = yy * cw + xx;
    if (!d[i]) continue;
    let v = d[i];
    v = Math.min(v, xx < cw - 1 ? d[i + 1] + 1 : 1, yy < ch - 1 ? d[i + cw] + 1 : 1);
    if (yy < ch - 1) v = Math.min(v, xx < cw - 1 ? d[i + cw + 1] + D : D, xx > 0 ? d[i + cw - 1] + D : D);
    d[i] = v;
  }
  // distanza in mm nel punto (x, y) della targa, interpolata tra i pixel (-0,5 px: il bordo è a metà tra due pixel)
  return (px, py) => {
    const fx = (px + W / 2) * PX_MM - 0.5, fy = (H / 2 - py) * PX_MM - 0.5;
    const x0 = Math.floor(fx), y0 = Math.floor(fy);
    if (x0 < 0 || y0 < 0 || x0 >= cw - 1 || y0 >= ch - 1) return 0;
    const ax = fx - x0, ay = fy - y0, i = y0 * cw + x0;
    const v = (d[i] * (1 - ax) + d[i + 1] * ax) * (1 - ay) + (d[i + cw] * (1 - ax) + d[i + cw + 1] * ax) * ay;
    return v > 0 ? (v - 0.5) / PX_MM : 0;
  };
}

/** Quota della superficie superiore della targa nel punto (x, y). */
function heightAt(x, y, textDist) {
  // cornice: piana in alto, poi parete verticale e raccordo concavo verso il fondo
  const e = Math.min(W / 2 - Math.abs(x), H / 2 - Math.abs(y));
  if (e <= FRAME) return TOP;
  let z = BG;
  const s = e - FRAME;
  if (s < COVE) z = BG + COVE - Math.sqrt(Math.max(0, COVE * COVE - (COVE - s) * (COVE - s)));
  // logo: arco esterno, arco interno più basso, punto della fresa a cupola
  const { cx, cy, s: k } = LOGO;
  const dx = x - cx, dy = y - cy;
  z = Math.max(z, BG + roundTop(arcInside(dx, dy, 9 * k, 3.4 * k), 4, 1.9));
  z = Math.max(z, BG + roundTop(arcInside(dx, dy, 4.8 * k, 2.1 * k), 2.6, 1.3));
  const tr = 3.1 * k, tx = dx - 6.36 * k, ty = dy + 6.36 * k, rr = (tx * tx + ty * ty) / (tr * tr);
  if (rr < 1) z = Math.max(z, BG + 4.6 * Math.sqrt(1 - rr));
  // scritta
  const td = textDist(x, y);
  if (td > 0) z = Math.max(z, BG + roundTop(td, 2.5, 0.8));
  return z;
}

/**
 * Mesh della targa (triangoli, coordinate in mm). La superficie superiore è campionata su una griglia fine,
 * divisa in riquadri: quelli piani (cornice, fondo) diventano due triangoli, gli altri restano a griglia fine.
 * Un riquadro piano confina con gli altri lungo campioni alla sua stessa quota: la superficie resta chiusa.
 * Pareti laterali (la cornice è alla stessa quota su tutto il bordo) e fondo completano il solido.
 */
export async function sampleMesh() {
  const textDist = await textField();
  const nx = Math.round(W / PITCH), ny = Math.round(H / PITCH);
  const X = i => -W / 2 + i * W / nx, Y = j => -H / 2 + j * H / ny;
  const z = new Float32Array((nx + 1) * (ny + 1));
  for (let j = 0; j <= ny; j++) for (let i = 0; i <= nx; i++) z[j * (nx + 1) + i] = heightAt(X(i), Y(j), textDist);
  const Z = (i, j) => z[j * (nx + 1) + i];
  const out = [];
  const tri = (a, b, c) => { out.push(...a, ...b, ...c); };
  const P = (i, j) => [X(i), Y(j), Z(i, j)];
  /** Due triangoli sul quadrilatero (i0, j0)-(i1, j1), lungo la diagonale dove la quota cambia meno. */
  const quad = (i0, j0, i1, j1) => {
    const p00 = P(i0, j0), p10 = P(i1, j0), p01 = P(i0, j1), p11 = P(i1, j1);
    if (Math.abs(p00[2] - p11[2]) <= Math.abs(p10[2] - p01[2])) { tri(p00, p10, p11); tri(p00, p11, p01); }
    else { tri(p00, p10, p01); tri(p10, p11, p01); }
  };
  const tx = Math.ceil(nx / TILE), ty = Math.ceil(ny / TILE);
  const flat = new Uint8Array(tx * ty);
  for (let b = 0; b < ty; b++) for (let a = 0; a < tx; a++) {
    const i0 = a * TILE, j0 = b * TILE, i1 = Math.min(nx, i0 + TILE), j1 = Math.min(ny, j0 + TILE);
    const z0 = Z(i0, j0);
    let f = 1;
    for (let j = j0; j <= j1 && f; j++) for (let i = i0; i <= i1; i++) if (Z(i, j) !== z0) { f = 0; break; }
    flat[b * tx + a] = f;
  }
  const isFlat = (a, b) => a < 0 || b < 0 || a >= tx || b >= ty || flat[b * tx + a] === 1;
  for (let b = 0; b < ty; b++) for (let a = 0; a < tx; a++) {
    const i0 = a * TILE, j0 = b * TILE, i1 = Math.min(nx, i0 + TILE), j1 = Math.min(ny, j0 + TILE);
    if (!flat[b * tx + a]) {
      for (let j = j0; j < j1; j++) for (let i = i0; i < i1; i++) quad(i, j, i + 1, j + 1);
      continue;
    }
    // riquadro piano: ventaglio dal centro; sui lati verso un riquadro a griglia fine si usano tutti i suoi
    // campioni, così i lati in comune coincidono (niente fessure né spigoli spezzati)
    const poly = [];
    const side = (fine, pts) => { for (let k = 0; k < pts.length - 1; k++) if (fine || k === 0) poly.push(pts[k]); };
    const run = (n0, n1) => { const r = []; for (let k = n0; n1 >= n0 ? k <= n1 : k >= n1; k += n1 >= n0 ? 1 : -1) r.push(k); return r; };
    side(!isFlat(a, b - 1), run(i0, i1).map(i => [i, j0]));
    side(!isFlat(a + 1, b), run(j0, j1).map(j => [i1, j]));
    side(!isFlat(a, b + 1), run(i1, i0).map(i => [i, j1]));
    side(!isFlat(a - 1, b), run(j1, j0).map(j => [i0, j]));
    const c = [(X(i0) + X(i1)) / 2, (Y(j0) + Y(j1)) / 2, Z(i0, j0)];
    for (let k = 0; k < poly.length; k++) tri(c, P(...poly[k]), P(...poly[(k + 1) % poly.length]));
  }
  // pareti laterali (normali verso l'esterno) e fondo
  const x0 = -W / 2, x1 = W / 2, y0 = -H / 2, y1 = H / 2;
  tri([x0, y0, 0], [x1, y0, 0], [x1, y0, TOP]); tri([x0, y0, 0], [x1, y0, TOP], [x0, y0, TOP]);
  tri([x1, y1, 0], [x0, y1, 0], [x0, y1, TOP]); tri([x1, y1, 0], [x0, y1, TOP], [x1, y1, TOP]);
  tri([x1, y0, 0], [x1, y1, 0], [x1, y1, TOP]); tri([x1, y0, 0], [x1, y1, TOP], [x1, y0, TOP]);
  tri([x0, y1, 0], [x0, y0, 0], [x0, y0, TOP]); tri([x0, y1, 0], [x0, y0, TOP], [x0, y1, TOP]);
  tri([x0, y0, 0], [x1, y1, 0], [x1, y0, 0]); tri([x0, y0, 0], [x0, y1, 0], [x1, y1, 0]);
  return new Float32Array(out);
}

/** Utensili dell'esempio: stesse misure delle frese T4, T6 e T7 del magazzino predefinito. */
const TOOLS = {
  rough: { number: 4, name: 'Fresa torica Ø6 R1', type: 'bull', diameter: 6, cornerRadius: 1, fluteLength: 15, length: 45, shank: 6 },
  finish: { number: 6, name: 'Fresa sferica Ø3', type: 'ball', diameter: 3, cornerRadius: 1.5, fluteLength: 10, length: 40, shank: 3 },
  detail: { number: 7, name: 'Fresa conica sferica Ø1 3°', type: 'taper', diameter: 1, cornerRadius: 0, fluteLength: 15, taperAngle: 3, tipType: 'ball', length: 25, shank: 4 },
};

/** Progetto di esempio sulla mesh della targa già caricata sul server (mesh = { id, triangles }). */
export function sampleProject(mesh) {
  const proj = newProject();
  proj.name = t('Targa CarveCAM (esempio)');
  const objId = uid('obj'), plId = uid('pl'), skId = uid('sk'), orgId = uid('org');
  const outer = { id: uid('e'), kind: 'rect', x1: -W / 2, y1: -H / 2, x2: W / 2, y2: H / 2 };
  const text = { id: uid('e'), kind: 'rect', x1: TEXT.x0 - 3, y1: -8, x2: TEXT.x1 + 3, y2: 8 };
  proj.objects = [{
    id: objId, name: t('Targa con rilievo'), meshId: mesh.id, position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1],
    color: color('object'), visible: true, locked: true, triangles: mesh.triangles, size: [W, H, TOP], source: t('esempio generato da CarveCAM'),
  }];
  proj.planes = [{
    id: plId, name: t('Piano superiore'), origin: [0, 0, TOP], normal: [0, 0, 1], angle: 0, size: 150, visible: true, locked: false,
    sketches: [{ id: skId, name: t('Contorni'), visible: true, entities: [outer, text] }],
  }];
  // zero pezzo: spigolo anteriore sinistro della faccia superiore, come si azzera di solito sulla macchina
  proj.origins = [{ id: orgId, name: t('Spigolo anteriore sinistro'), position: [-W / 2, -H / 2, TOP], visible: true, locked: false }];
  proj.gcodeOrigin = orgId;
  const params = kind => { const p = structuredClone(OP_DEFAULTS[kind]); delete p.base; return p; };
  const pk = params('pocket'), fn = params('finish');
  const op = (name, kind, base, tool, extra) => ({
    id: uid('op'), name, kind, sketchId: skId, visible: true, ...base, obstacles: [objId], tool: { ...tool }, ...extra,
  });
  proj.operations = [
    op(t('Sgrossatura del fondo'), 'pocket', pk, TOOLS.rough, {
      entityIds: [outer.id], strategy: 'concentric', entry: 'helix', maxDepth: 5, stock: 0.3,
      feed: 1200, plunge: 300, spindle: 12000,
      rel: { ...pk.rel, stepover: { on: true, pct: 45, min: 0.05, max: 0 }, stepdown: { on: true, pct: 10, min: 0.05, max: 2 } },
    }),
    op(t('Finitura del rilievo'), 'finish', fn, TOOLS.finish, {
      entityIds: [outer.id], strategy: 'zigzag', angle: 0, maxDepth: 5.2, stock: 0,
      feed: 1000, plunge: 300, spindle: 18000,
      rel: { ...fn.rel, stepover: { on: true, pct: 10, min: 0.02, max: 2 } },
    }),
    op(t('Ripresa della scritta'), 'finish', fn, TOOLS.detail, {
      entityIds: [text.id], strategy: 'zigzag', angle: 90, maxDepth: 5.2, stock: 0,
      feed: 900, plunge: 250, spindle: 18000,
      rel: { ...fn.rel, stepover: { on: true, pct: 25, min: 0.02, max: 1 } },
    }),
  ];
  proj.counters = { [t('Piano')]: 1, [t('Sketch')]: 1, [t('Svuotatura')]: 1, [t('Finitura')]: 2, [t('Origine')]: 1 };
  return { project: proj, operationId: proj.operations[0].id };
}
