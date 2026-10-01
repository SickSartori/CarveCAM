// Lavorazioni: parametri predefiniti, parametri relativi all'utensile (% del diametro o dell'altezza del
// tagliente, con limiti in mm) e spiegazioni dei parametri.
import { t } from './i18n.js';

export const round4 = v => Math.round(v * 10000) / 10000;

/** Utensile predefinito di una lavorazione nuova senza magazzino. */
export const TOOL_DEFAULTS = {
  pocket: { number: 1, name: 'Fresa torica Ø6 R1', type: 'bull', diameter: 6, cornerRadius: 1, fluteLength: 15 },
  finish: { number: 2, name: 'Fresa sferica Ø6', type: 'ball', diameter: 6, cornerRadius: 3, fluteLength: 15 },
};

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
  const d = tool?.diameter || 6;
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
  'tool.diameter': ['Diametro', 'Diametro della fresa in mm. È la base dei parametri espressi in % del diametro (Ø).'],
  'tool.cornerRadius': ['Raggio raccordo', 'Raggio dello spigolo della fresa torica (non oltre metà del diametro).'],
  'tool.fluteLength': ['Altezza tagliente', 'Lunghezza utile dei taglienti (Lc) in mm. È la base dei parametri espressi in % dell\'altezza del tagliente, come il passo verticale.'],
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
