// Lavorazioni: parametri predefiniti, parametri relativi all'utensile (% del diametro o dell'altezza del
// tagliente, con limiti in mm) e spiegazioni dei parametri.
import { t } from './i18n.js';

export const round4 = v => Math.round(v * 10000) / 10000;

/** Utensile predefinito di una lavorazione nuova senza magazzino. */
export const TOOL_DEFAULTS = {
  pocket: { number: 1, name: 'Fresa torica Ø6 R1', type: 'bull', diameter: 6, cornerRadius: 1, fluteLength: 15 },
  finish: { number: 2, name: 'Fresa sferica Ø6', type: 'ball', diameter: 6, cornerRadius: 3, fluteLength: 15 },
};

// ------------------------------------------------------------------ geometria dell'utensile (generata dai parametri)
/**
 * Fresa conica (type 'taper'): diameter è il diametro in punta (0 = punta a V), taperAngle l'angolo di
 * conicità per lato (gradi, rispetto all'asse), tipType 'flat' (punta piatta o a V) o 'ball' (punta sferica
 * raccordata al cono), fluteLength l'altezza del cono. Geometria come nel motore di calcolo (ToolDef).
 */
export function taperGeom(tool = {}) {
  const rt = Math.max(0, Number(tool.diameter) || 0) / 2;
  const deg = Math.max(0.1, Math.min(80, Number(tool.taperAngle) || 5));
  const tn = Math.tan(deg * Math.PI / 180);
  const ball = tool.tipType === 'ball' && rt > 0;
  const Lc = tool.fluteLength > 0 ? tool.fluteLength : Math.max(10, 3 * rt * 2);
  const a = Math.atan(tn);
  const q0 = ball ? rt * Math.cos(a) : rt, h0 = ball ? rt * (1 - Math.sin(a)) : 0;
  const radiusAt = h => {
    const hh = Math.max(0, Math.min(h, Lc));
    if (ball && hh <= h0) return Math.sqrt(Math.max(0, rt * rt - (rt - hh) ** 2));
    return q0 + (hh - h0) * tn;
  };
  return { rt, deg, tn, ball, Lc, q0, h0, R: radiusAt(Lc), radiusAt };
}

/** Diametro di riferimento per i parametri in % del diametro: per la conica quello in punta (o in cima se a V). */
export function toolRefDiameter(tool = {}) {
  if (tool.type === 'taper') {
    const g = taperGeom(tool);
    return g.rt > 0 ? g.rt * 2 : g.R * 2;
  }
  return tool.diameter || 6;
}

/**
 * Dimensioni risolte di una fresa (mm), con valori ragionevoli per i dati mancanti:
 * R raggio, r raggio di raccordo (0 piatta, R sferica), Lc altezza del tagliente, reach sbalzo (dalla punta
 * all'inizio del gambo), neckR raggio del collo tra tagliente e gambo, shankR raggio del gambo,
 * shankLen tratto di gambo visibile fuori dal portautensile, holderR / holderLen portautensile.
 */
export function toolDims(tool = {}) {
  // fresa conica: D è il diametro massimo (in cima al cono), r il raggio della punta sferica
  const tg = tool.type === 'taper' ? taperGeom(tool) : null;
  const D = tg ? Math.max(0.02, tg.R * 2) : tool.diameter > 0 ? tool.diameter : 6;
  const R = D / 2;
  const r = tg ? (tg.ball ? tg.rt : 0) : tool.type === 'ball' ? R : tool.type === 'bull' ? Math.min(R, Math.max(0, tool.cornerRadius ?? 1)) : 0;
  const Lc = tg ? tg.Lc : Math.max(r, tool.fluteLength > 0 ? tool.fluteLength : Math.max(2 * D, 3));
  const reach = Math.max(Lc, tool.length > 0 ? tool.length : Lc);
  const neckR = tool.neck > 0 ? Math.min(tool.neck / 2, Math.max(R, (tool.shank || D) / 2)) : R;
  const shankR = tool.shank > 0 ? tool.shank / 2 : Math.max(R, 1.5);
  const shankLen = Math.max(6, shankR * 4);
  const holderR = Math.max(shankR * 2.6, 6);
  const holderLen = Math.max(18, holderR * 2.2);
  return { D, R, r, Lc, reach, neckR, shankR, shankLen, holderR, holderLen, taper: tg };
}

/**
 * Misure incongruenti di una fresa: [{ field, msg }], vuoto se la fresa è coerente. field è il parametro da
 * correggere (diameter, cornerRadius, fluteLength, length, neck); l'anteprima del magazzino lo evidenzia.
 */
export function toolIssues(tl = {}) {
  const out = [];
  const add = (field, msg, vars) => out.push({ field, msg: t(msg, vars) });
  const f = v => String(Math.round(v * 1000) / 1000);
  if (tl.type === 'taper') { taperIssues(tl, add, f); return out; }
  const D = Number(tl.diameter);
  if (!(D > 0)) { add('diameter', 'Il diametro deve essere maggiore di 0'); return out; }
  const R = D / 2;
  let r = 0;
  if (tl.type === 'ball') r = R;
  if (tl.type === 'bull') {
    r = Number(tl.cornerRadius) || 0;
    if (!(r > 0)) add('cornerRadius', 'Una fresa torica ha il raggio di raccordo maggiore di 0 (con R = 0 è cilindrica)');
    else if (r > R + 1e-9) add('cornerRadius', 'Raggio di raccordo R{r} maggiore di metà diametro (Ø/2 = {h}): il raccordo non sta nella fresa', { r: f(r), h: f(R) });
  }
  const Lc = Number(tl.fluteLength) || 0;
  const rr = Math.min(r, R);
  if (!(Lc > 0)) add('fluteLength', 'L\'altezza del tagliente (Lc) deve essere maggiore di 0');
  else if (rr > 0 && Lc < rr - 1e-9) add('fluteLength', 'Altezza del tagliente Lc {lc} minore del raggio della punta ({r}): la parte raccordata non ci sta', { lc: f(Lc), r: f(rr) });
  const L = Number(tl.length) || 0;
  if (L > 0 && Lc > 0 && L < Lc - 1e-9) add('length', 'Sbalzo {l} più corto dell\'altezza del tagliente (Lc {lc}): lo sbalzo comprende il tagliente', { l: f(L), lc: f(Lc) });
  const neck = Number(tl.neck) || 0, shank = Number(tl.shank) || 0;
  if (neck > D + 1e-9) add('neck', 'Diametro del collo Ø{n} maggiore del diametro di taglio Ø{d}: il collo deve essere più stretto', { n: f(neck), d: f(D) });
  else if (neck > 0 && shank > 0 && neck > shank + 1e-9) add('neck', 'Diametro del collo Ø{n} maggiore del gambo Ø{s}', { n: f(neck), s: f(shank) });
  if (neck > 0 && Lc > 0 && !(L > Lc + 1e-9)) add('length', 'Collo indicato ma sbalzo non maggiore di Lc: il collo non ha lunghezza (sbalzo = Lc + lunghezza del collo)');
  return out;
}

function taperIssues(tl, add, f) {
  const d = Number(tl.diameter);
  if (!(d >= 0)) add('diameter', 'Il diametro in punta non può essere negativo (0 = punta a V)');
  const a = Number(tl.taperAngle);
  if (!(a > 0) || a > 80) add('taperAngle', 'L\'angolo di conicità per lato deve essere tra 0 e 80 gradi');
  if (tl.tipType === 'ball' && !(d > 0)) add('diameter', 'Una punta sferica ha il diametro in punta maggiore di 0');
  const Lc = Number(tl.fluteLength) || 0;
  if (!(Lc > 0)) { add('fluteLength', 'L\'altezza del cono (Lc) deve essere maggiore di 0'); return; }
  const g = taperGeom(tl);
  if (g.ball && Lc < g.h0 - 1e-9) add('fluteLength', 'Altezza del cono Lc {lc} minore della parte sferica della punta ({h}): il cono non inizia', { lc: f(Lc), h: f(g.h0) });
  const L = Number(tl.length) || 0;
  if (L > 0 && L < Lc - 1e-9) add('length', 'Sbalzo {l} più corto dell\'altezza del cono (Lc {lc}): lo sbalzo comprende il tagliente', { l: f(L), lc: f(Lc) });
  const neck = Number(tl.neck) || 0, shank = Number(tl.shank) || 0;
  if (neck > g.R * 2 + 1e-9) add('neck', 'Diametro del collo Ø{n} maggiore del diametro in cima al cono (Ø{d})', { n: f(neck), d: f(g.R * 2) });
  else if (neck > 0 && shank > 0 && neck > shank + 1e-9) add('neck', 'Diametro del collo Ø{n} maggiore del gambo Ø{s}', { n: f(neck), s: f(shank) });
  if (neck > 0 && !(L > Lc + 1e-9)) add('length', 'Collo indicato ma sbalzo non maggiore di Lc: il collo non ha lunghezza (sbalzo = Lc + lunghezza del collo)');
}

/**
 * Sagoma della fresa (metà destra, dalla punta verso l'alto): punti [raggio, quota] fino al portautensile.
 * Usata dall'anteprima del magazzino; la simulazione costruisce la stessa forma in 3D.
 */
export function toolSilhouette(tool) {
  const d = toolDims(tool);
  const pts = [[0, 0]];
  if (d.taper) {
    // punta (sferica, piatta o a V) e cono fino all'altezza del tagliente
    const g = d.taper;
    if (g.ball) {
      const phiMax = Math.PI / 2 - Math.atan(g.tn);
      for (let i = 1; i <= 16; i++) {
        const phi = phiMax * i / 16;
        if (g.rt * (1 - Math.cos(phi)) > g.Lc) break;
        pts.push([g.rt * Math.sin(phi), g.rt * (1 - Math.cos(phi))]);
      }
    } else if (g.rt > 1e-6) {
      pts.push([g.rt, 0]);
    }
    pts.push([g.R, g.Lc]);
  } else if (d.r > 0) {
    const rf = d.R - d.r;
    if (rf > 1e-6) pts.push([rf, 0]);
    for (let i = 1; i <= 16; i++) {
      const a = -Math.PI / 2 + (i / 16) * (Math.PI / 2);
      pts.push([rf + d.r * Math.cos(a), d.r + d.r * Math.sin(a)]);
    }
  } else {
    pts.push([d.R, 0]);
  }
  if (!d.taper) pts.push([d.R, d.Lc]);
  if (d.reach > d.Lc + 1e-6) pts.push([d.neckR, d.Lc + Math.min(Math.abs(d.R - d.neckR), (d.reach - d.Lc) / 3)], [d.neckR, d.reach]);
  const cone = Math.abs(d.shankR - d.neckR) * 1.2;
  pts.push([d.shankR, d.reach + cone], [d.shankR, d.reach + cone + d.shankLen]);
  return { pts, dims: d, cone, top: d.reach + cone + d.shankLen };
}

/**
 * Parametri relativi: base 'D' = diametro utensile, 'Lc' = altezza del tagliente.
 * In un'operazione op.rel[chiave] = { on, pct, min, max } (min/max in mm, 0 = nessun limite).
 */
export const REL_PARAMS = {
  stepover: { base: 'D' },
  stepdown: { base: 'Lc' },
  helixRadius: { base: 'D' },
};

export const BASE_LABEL = { D: 'Ø', Lc: 'Lc' };

/** Parametri predefiniti di una lavorazione (senza utensile). */
export const OP_DEFAULTS = {
  pocket: {
    base: 'Svuotatura', strategy: 'concentric',
    stepover: 3, stepdown: 1, maxDepth: 10, stock: 0, safeHeight: 10, clearance: 1, angle: 0,
    climb: true, toolInside: true, contourPass: true, resolution: 0, tolerance: 0.01, feed: 1200, plunge: 300, spindle: 12000,
    entry: 'helix', rampAngle: 3, helixRadius: 0, rampFeed: 600,
    rel: {
      stepover: { on: true, pct: 50, min: 0.05, max: 0 },
      stepdown: { on: true, pct: 10, min: 0.05, max: 3 },
      helixRadius: { on: false, pct: 25, min: 0, max: 0 },
    },
  },
  finish: {
    base: 'Finitura', strategy: 'zigzag',
    stepover: 0.5, stepdown: 1, maxDepth: 20, stock: 0, safeHeight: 10, clearance: 2, angle: 0,
    climb: true, toolInside: true, contourPass: false, resolution: 0, tolerance: 0.01, feed: 1500, plunge: 400, spindle: 14000,
    entry: 'plunge', rampAngle: 3, helixRadius: 0, rampFeed: 0,
    rel: {
      stepover: { on: true, pct: 8, min: 0.02, max: 2 },
      stepdown: { on: false, pct: 10, min: 0.05, max: 0 },
      helixRadius: { on: false, pct: 25, min: 0, max: 0 },
    },
  },
};

/** Chiavi dei parametri di lavorazione salvati in un setup. */
export const SETUP_KEYS = ['strategy', 'stepover', 'stepdown', 'maxDepth', 'stock', 'safeHeight', 'clearance', 'angle',
  'climb', 'toolInside', 'contourPass', 'resolution', 'tolerance', 'entry', 'rampAngle', 'helixRadius', 'rampFeed', 'rel',
  'feed', 'plunge', 'spindle'];

/** Parametri di lavorazione (copia) presi da un'operazione, per salvarli come setup. */
export function setupParamsOf(op) {
  const p = {};
  for (const k of SETUP_KEYS) if (op[k] !== undefined) p[k] = structuredClone(op[k]);
  return p;
}

/** Valore di riferimento (mm) della base di un parametro relativo. */
export function baseValue(tool, base) {
  const d = toolRefDiameter(tool || {});
  return base === 'Lc' ? (tool?.fluteLength > 0 ? tool.fluteLength : d * 2.5) : d;
}

/** Valore effettivo in mm di un parametro (relativo o assoluto). */
export function effParam(op, key) {
  const spec = REL_PARAMS[key];
  const r = op.rel?.[key];
  if (!spec || !r || !r.on) return op[key];
  let v = (Number(r.pct) || 0) / 100 * baseValue(op.tool, spec.base);
  if (r.min > 0) v = Math.max(r.min, v);
  if (r.max > 0) v = Math.min(r.max, v);
  return round4(v);
}

/** Descrizione breve di un parametro relativo, es. "50 % Ø = 3 mm". */
export function relLabel(op, key) {
  const spec = REL_PARAMS[key];
  const r = op.rel?.[key];
  if (!spec || !r?.on) return '';
  return `${r.pct} % ${BASE_LABEL[spec.base]} = ${effParam(op, key)} mm`;
}

// ------------------------------------------------------------------ spiegazioni dei parametri
/** Testo di aiuto per chiave di parametro: [titolo, spiegazione]. */
const HELP = {
  name: ['Nome', 'Nome dell\'elemento, mostrato nel navigatore e nei commenti del G-code.'],
  sketchId: ['Contorno (sketch)', 'Sketch che definisce l\'area di contenimento della lavorazione. Le entità chiuse dello sketch delimitano la zona lavorata; un contorno contenuto in un altro diventa un\'isola esclusa.'],
  entityIds: ['Entità del contorno', 'Se la lavorazione è stata creata da alcune entità selezionate, solo quelle delimitano la zona lavorata. "Usa tutto lo sketch" considera tutte le entità.'],
  strategy: ['Strategia', 'Concentrica: passate parallele al contorno, dall\'interno verso l\'esterno. Rettangolare (zigzag): passate rettilinee parallele con l\'angolo indicato, collegate a zigzag.'],
  angle: ['Angolo passate', 'Direzione delle passate zigzag, in gradi, misurata dall\'asse U del piano.'],
  climb: ['Concorde (climb)', 'Fresatura concorde con mandrino orario (M3): migliore finitura e minore usura. Disattivato: fresatura discorde.'],
  toolInside: ['Utensile dentro contorno', 'Attivo: tutto l\'utensile resta dentro il contorno (il centro è ristretto del raggio). Disattivo: il centro dell\'utensile può percorrere il contorno.'],
  contourPass: ['Passata di contorno', 'Con la strategia zigzag aggiunge, a ogni terrazza, una passata lungo il bordo della zona lavorata per pulire le creste lasciate dalle passate.'],
  'tool.type': ['Tipo fresa', 'Cilindrica: fondo piatto. Torica: fondo piatto con spigolo raccordato (raggio r). Sferica: punta semisferica, adatta alla finitura di superfici curve.'],
  'tool.diameter': ['Diametro', 'Diametro della fresa in mm. È la base dei parametri espressi in % del diametro (Ø). Per la fresa conica è il diametro in punta (0 = punta a V): la base dei parametri in % è il diametro in punta, o quello in cima al cono se la punta è a V.'],
  'tool.taperAngle': ['Angolo per lato', 'Fresa conica: angolo di conicità di ciascun lato rispetto all\'asse, in gradi (una fresa a V da 90° ha 45° per lato). Il diametro cresce salendo dalla punta: Ø(h) = Ø punta + 2·h·tan(angolo).'],
  'tool.tipType': ['Punta', 'Fresa conica: punta piatta (a V se il diametro in punta è 0) oppure sferica, raccordata tangente al cono. Le coniche a punta sferica sono adatte alla finitura di dettagli in rilievo; quelle a V all\'incisione.'],
  'tool.cornerRadius': ['Raggio raccordo', 'Raggio dello spigolo della fresa torica (non oltre metà del diametro).'],
  'tool.fluteLength': ['Altezza tagliente', 'Lunghezza utile dei taglienti (Lc) in mm. È la base dei parametri espressi in % dell\'altezza del tagliente, come il passo verticale.'],
  'tool.length': ['Sbalzo', 'Lunghezza utile della fresa, dalla punta all\'inizio del gambo (comprende tagliente e collo). Indica fin dove l\'utensile può scendere: deve superare la profondità della lavorazione. 0 = uguale all\'altezza del tagliente. In simulazione la fresa viene generata con queste misure.'],
  'tool.neck': ['Diametro collo', 'Diametro del collo ribassato tra tagliente e gambo, tipico delle frese di precisione a collo lungo. 0 = uguale al diametro della fresa.'],
  'tool.shank': ['Diametro gambo', 'Diametro del gambo preso dalla pinza. Serve a generare la forma della fresa in simulazione; il calcolo dei percorsi verifica le collisioni della parte tagliente, non del gambo né del portautensile.'],
  'tool.number': ['Numero (T)', 'Posizione dell\'utensile nel magazzino della macchina: usato per il cambio utensile (T# M6) o nei messaggi di pausa GRBL.'],
  toolId: ['Utensile dal magazzino', 'Copia nella lavorazione i dati di un utensile del magazzino. Le modifiche successive alla lavorazione non cambiano il magazzino.'],
  stepover: ['Passo laterale', 'Distanza tra due passate affiancate. Si può esprimere in mm oppure in % del diametro utensile (Ø), con limiti minimo e massimo in mm. Valori tipici: 40–60 % in sgrossatura, 5–15 % in finitura con fresa sferica.'],
  stepdown: ['Passo verticale', 'Profondità di ogni terrazza della svuotatura. Si può esprimere in mm oppure in % dell\'altezza del tagliente (Lc), con limiti minimo e massimo in mm.'],
  maxDepth: ['Profondità max', 'Profondità massima raggiunta sotto il piano di lavoro, misurata lungo la normale.'],
  stock: ['Sovrametallo', 'Materiale lasciato sulle superfici di oggetti e artefatti, da togliere con una lavorazione successiva.'],
  safeHeight: ['Quota sicurezza', 'Quota sopra il piano alla quale l\'utensile si sposta in rapido tra un tratto e l\'altro.'],
  clearance: ['Avvicinamento', 'Distanza sopra il materiale alla quale termina il rapido e inizia il movimento in lavoro (affondo, rampa o elica).'],
  resolution: ['Risoluzione / campionamento', 'Svuotatura: passo della griglia di calcolo della zona lavorabile. Finitura: passo di campionamento del percorso proiettato. 0 = automatico in base all\'utensile e alla tolleranza.'],
  tolerance: ['Tolleranza', 'Errore cordale ammesso tra il percorso calcolato e la geometria ideale. Valori più piccoli danno percorsi più precisi ma più lunghi da calcolare.'],
  entry: ['Tipo ingresso', 'Come l\'utensile entra nel materiale a ogni terrazza: affondo verticale, rampa lungo il percorso oppure elica. Se manca spazio si ripiega automaticamente sul tipo più semplice.'],
  rampAngle: ['Angolo discesa', 'Inclinazione della rampa o dell\'elica rispetto al piano, in gradi. Angoli piccoli caricano meno l\'utensile.'],
  helixRadius: ['Raggio elica', 'Raggio del percorso del centro utensile durante l\'ingresso a elica. Si può esprimere in mm o in % del diametro; 0 = automatico (metà del raggio utensile).'],
  rampFeed: ['Avanzamento rampa', 'Avanzamento durante rampa ed elica in mm/min; 0 = uguale all\'avanzamento di lavoro.'],
  feed: ['Avanzamento', 'Velocità di avanzamento in lavoro, in mm/min.'],
  plunge: ['Affondo', 'Velocità degli affondi verticali, in mm/min.'],
  spindle: ['Mandrino', 'Velocità di rotazione del mandrino in giri/min.'],
  visible: ['Visibile', 'Mostra o nasconde l\'elemento nella vista 3D. Non cambia il calcolo.'],
  obstacles: ['Ostacoli', 'Oggetti e artefatti considerati da questa lavorazione: il percorso li evita (svuotatura) o li segue (finitura). Gli elementi aggiunti dopo la creazione della lavorazione non sono ostacoli finché non vengono spuntati qui.'],
  locked: ['Bloccato', 'Un elemento bloccato non si può spostare né ruotare: il manipolatore mostra un lucchetto e i campi di posizione sono disattivati. Se fa parte di una selezione multipla blocca il movimento di tutta la selezione. Lo spostamento dell\'origine del progetto sposta comunque anche gli elementi bloccati.'],
  position: ['Posizione', 'Coordinate X, Y, Z in mm dell\'origine dell\'elemento nel sistema del progetto.'],
  rotation: ['Rotazione', 'Rotazione in gradi attorno agli assi X, Y e Z (applicate in quest\'ordine).'],
  scale: ['Scala', 'Fattore di scala lungo X, Y e Z: utile se il modello non è in millimetri.'],
  color: ['Colore', 'Colore dell\'elemento nella vista 3D.'],
  origin: ['Origine', 'Punto del piano da cui partono le coordinate U,V dello sketch e la profondità delle lavorazioni.'],
  normal: ['Normale (asse utensile)', 'Direzione perpendicolare al piano: è l\'asse utensile. La fresa lavora dal lato della freccia verso il piano e oltre.'],
  'plane.angle': ['Rotazione asse U', 'Rotazione in gradi degli assi U,V del piano attorno alla normale.'],
  size: ['Dimensione vista', 'Lato del quadrato con cui il piano viene disegnato nella vista. Non limita le lavorazioni.'],
  kind: ['Tipo', 'Forma dell\'artefatto: parallelepipedo, cilindro, tronco di cono o sfera.'],
};

/** Spiegazione di un parametro: { title, text } oppure null. */
export function paramHelp(key) {
  const h = HELP[key];
  return h ? { title: t(h[0]), text: t(h[1]) } : null;
}
