// Solidi costruiti nel programma: profilo estruso (artefatto "extrude": contorni di uno sketch estrusi lungo la
// normale del piano) e operazioni booleane tra oggetti e artefatti (three-bvh-csg, nel browser).
import * as THREE from 'three';

/** Direzione del profilo estruso rispetto alla normale del piano: valore, testo. */
export const EXTRUDE_SIDES = [['down', 'Nel materiale (opposta alla normale)'], ['up', 'Verso l\'utensile (lungo la normale)'], ['both', 'Simmetrica']];

/** Area con segno di un contorno [[x, y], …] (positiva in senso antiorario). */
function signedArea(loop) {
  let a = 0;
  for (let i = 0; i < loop.length; i++) {
    const [x1, y1] = loop[i], [x2, y2] = loop[(i + 1) % loop.length];
    a += x1 * y2 - x2 * y1;
  }
  return a / 2;
}

function inside(loop, [x, y]) {
  let c = false;
  for (let i = 0, j = loop.length - 1; i < loop.length; j = i++) {
    const [xi, yi] = loop[i], [xj, yj] = loop[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}

/**
 * Forme con fori dai contorni chiusi, con la regola pari/dispari degli sketch: un contorno dentro un numero
 * dispari di altri è un foro (di quello che lo contiene direttamente), altrimenti un pieno.
 */
export function profileShapes(loops) {
  const L = loops.filter(l => l && l.length >= 3).map(l => ({ pts: l, area: Math.abs(signedArea(l)) }));
  for (const a of L) {
    a.parents = L.filter(b => b !== a && b.area > a.area && inside(b.pts, a.pts[0]));
    a.depth = a.parents.length;
  }
  const shapes = new Map();
  const vec = (pts, ccw) => {
    const p = signedArea(pts) >= 0 === ccw ? pts : [...pts].reverse();
    return p.map(([x, y]) => new THREE.Vector2(x, y));
  };
  for (const a of L.filter(x => x.depth % 2 === 0)) shapes.set(a, new THREE.Shape(vec(a.pts, true)));
  for (const a of L.filter(x => x.depth % 2 === 1)) {
    const parent = a.parents.filter(p => p.depth === a.depth - 1).sort((p, q) => p.area - q.area)[0];
    if (parent && shapes.has(parent)) shapes.get(parent).holes.push(new THREE.Path(vec(a.pts, false)));
  }
  return [...shapes.values()];
}

/**
 * Geometria locale del profilo estruso: profilo nel piano XY locale (quello del piano dello sketch), altezza
 * lungo Z locale (la normale): side 'up' da 0 a h, 'down' da -h a 0, 'both' da -h/2 a h/2.
 */
export function extrudeGeometry(a) {
  const h = Math.max(0.001, Number(a.height) || 10);
  const shapes = profileShapes(a.profile || []);
  if (!shapes.length) return new THREE.BoxGeometry(1, 1, 1);
  const g = new THREE.ExtrudeGeometry(shapes, { depth: h, bevelEnabled: false, curveSegments: 1, steps: 1 });
  if (a.side === 'down') g.translate(0, 0, -h);
  else if (a.side === 'both') g.translate(0, 0, -h / 2);
  g.computeVertexNormals();
  return g;
}

/** Triangoli locali del profilo estruso per il server (9 numeri per triangolo, arrotondati a 1e-5 mm). */
export function extrudeMesh(a) {
  const g = extrudeGeometry(a);
  const flat = g.index ? g.toNonIndexed() : g;
  const p = flat.attributes.position.array;
  const out = new Array(p.length);
  for (let i = 0; i < p.length; i++) out[i] = Math.round(p[i] * 1e5) / 1e5;
  return out;
}

/** Punti del profilo estruso (in basso e in alto), per il manipolatore e l'aggancio. */
export function extrudeKeyPoints(a) {
  const h = Math.max(0.001, Number(a.height) || 10);
  const z0 = a.side === 'down' ? -h : a.side === 'both' ? -h / 2 : 0;
  const pts = [];
  for (const l of a.profile || []) for (const [x, y] of l) pts.push([x, y, z0], [x, y, z0 + h]);
  return pts;
}

// ------------------------------------------------------------------ operazioni booleane
/**
 * Unione, sottrazione (il primo meno gli altri) o intersezione di geometrie in coordinate mondo.
 * Ritorna le posizioni dei triangoli del risultato (Float32Array), vuote se il risultato è vuoto.
 */
export async function booleanMeshes(geometries, op) {
  const [{ Brush, Evaluator, ADDITION, SUBTRACTION, INTERSECTION }, { mergeVertices }] = await Promise.all([
    import('three-bvh-csg'), import('three/addons/utils/BufferGeometryUtils.js')]);
  const brush = g => {
    // solo le posizioni, vertici uniti: l'algoritmo ha bisogno della connessione tra i triangoli
    const src = new THREE.BufferGeometry();
    src.setAttribute('position', (g.index ? g.toNonIndexed() : g).attributes.position.clone());
    const b = new Brush(mergeVertices(src, 1e-5));
    b.updateMatrixWorld();
    return b;
  };
  const ev = new Evaluator();
  ev.attributes = ['position'];
  ev.useGroups = false;
  const kind = { union: ADDITION, subtract: SUBTRACTION, intersect: INTERSECTION }[op];
  let res = brush(geometries[0]);
  for (const g of geometries.slice(1)) res = ev.evaluate(res, brush(g), kind);
  const geo = res.geometry.index ? res.geometry.toNonIndexed() : res.geometry;
  return new Float32Array(geo.attributes.position.array);
}
