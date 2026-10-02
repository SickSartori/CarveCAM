// Opzioni dell'utente (per browser): tema, lingua, colori, dimensioni di frecce e cursori, griglia.
// Caricate in modo sincrono all'avvio: gli altri moduli le leggono già durante l'importazione.

const KEY = 'carvecam.settings.v1';

/** Colori della scena che dipendono dal tema (valore '' nelle opzioni = automatico). */
export const THEME_COLORS = {
  dark: { background: '#1c2025', gridMinor: '#2a3038', gridMajor: '#46505c' },
  light: { background: '#e9edf2', gridMinor: '#cfd6de', gridMajor: '#a7b1bd' },
};

export const DEFAULTS = {
  theme: 'dark',
  lang: 'it',
  colors: {
    background: '', gridMinor: '', gridMajor: '',
    object: '#9aa8b8', artifact: '#ffb547', locked: '#7a8aa3', selection: '#1d5a96',
    plane: '#3fa7ff', normal: '#4f9dff', sketch: '#ffe066', entitySel: '#ff8a3d',
    feed: '#2fd3ff', plunge: '#ffd23f', ramp: '#ff9f43', rapid: '#ff4d6d', pivot: '#39d353', stock: '#c9a46b',
  },
  sizes: {
    gizmo: 0.85,        // scala del manipolatore
    normalArrow: 1,     // scala delle frecce della normale dei piani
    cursor: 14,         // mezza larghezza del mirino dello sketch (px)
    pivotDot: 11,       // diametro dei pallini per il riferimento del manipolatore (px)
  },
  grid: {
    visible: true,
    size: 1000,         // lato della griglia (mm)
    minor: 10,          // passo della griglia fine (mm)
    major: 50,          // passo della griglia principale (mm)
    snapStep: 1,        // passo di aggancio predefinito dello sketch (mm)
  },
  startScreen: true,    // schermata iniziale all'avvio (progetto da riprendere, recenti, esempio, guida)
  // vista memorizzata dalle opzioni: usata all'avvio e come vista isometrica (saved: false = vista standard)
  view: {
    saved: false,
    dir: [1, -1, 0.85],   // direzione dal bersaglio verso la camera
    height: 0,            // zoom: altezza inquadrata al bersaglio (mm)
    target: [0, 0, 0],
    ortho: false,
  },
};

/** File delle opzioni esportato: { app, kind, version, settings }. */
export const SETTINGS_FILE_KIND = 'carvecam-settings';

/** Opzioni lette da un file esportato (o da un oggetto opzioni semplice), completate con i predefiniti. */
export function settingsFromFile(json) {
  const src = json && json.kind === SETTINGS_FILE_KIND ? json.settings : json;
  if (!src || typeof src !== 'object' || Array.isArray(src)) throw new Error('not a settings file');
  const known = Object.keys(DEFAULTS).filter(k => k in src);
  if (!known.length) throw new Error('not a settings file');
  return merge(DEFAULTS, src);
}

export function settingsFile() {
  return { app: 'CarveCAM', kind: SETTINGS_FILE_KIND, version: 1, saved: new Date().toISOString(), settings: structuredClone(settings) };
}

/** Unisce val ai predefiniti: chiavi sconosciute scartate, valori del tipo sbagliato sostituiti dal predefinito. */
function merge(def, val) {
  if (Array.isArray(def)) return Array.isArray(val) && val.length === def.length && val.every(x => typeof x === typeof def[0]) ? [...val] : [...def];
  if (typeof def !== 'object' || def === null) return val != null && typeof val === typeof def && (typeof val !== 'number' || Number.isFinite(val)) ? val : def;
  const src = val && typeof val === 'object' ? val : {};
  const r = {};
  for (const k of Object.keys(def)) r[k] = merge(def[k], src[k]);
  return r;
}

function load() {
  try {
    const s = localStorage.getItem(KEY);
    return merge(DEFAULTS, s ? JSON.parse(s) : null);
  } catch { return structuredClone(DEFAULTS); }
}

/** Opzioni correnti (oggetto mutabile condiviso). */
export const settings = load();

const listeners = new Set();
export function onSettings(fn) { listeners.add(fn); return () => listeners.delete(fn); }

/** Sostituisce le opzioni, le applica e (se persist) le salva. */
export function applySettings(next, persist = true) {
  const v = merge(DEFAULTS, next);
  for (const k of Object.keys(v)) settings[k] = v[k];
  if (persist) {
    try { localStorage.setItem(KEY, JSON.stringify(settings)); } catch { /* storage non disponibile */ }
  }
  applyTheme();
  for (const fn of [...listeners]) {
    try { fn(settings); } catch (e) { console.error('settings listener', e); }
  }
}

/** Colore effettivo (risolve i valori automatici del tema). */
export function color(name) {
  const c = settings.colors[name];
  if (c) return c;
  return (THEME_COLORS[settings.theme] || THEME_COLORS.dark)[name] || '#888888';
}

export function applyTheme() {
  const root = document.documentElement;
  root.dataset.theme = settings.theme === 'light' ? 'light' : 'dark';
  root.style.setProperty('--vp-bg', color('background'));
}
