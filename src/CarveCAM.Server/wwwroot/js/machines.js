// Magazzino macchine: le CNC dell'utente con tutte le impostazioni del post-processor (piani inclinati, sintassi,
// archi G2/G3 o solo G1 con le corde, movimento esatto/smooth, mandrino, refrigerante, aspirazione, cambio
// utensile, righe di inizio e fine). Ogni macchina ha l'anteprima del G-code su un percorso di prova.
import { api } from './api.js';
import { h, toast } from './dialogs.js';
import { load, manager } from './library.js';
import { uid } from './state.js';
import { fmt } from './geom.js';
import { t } from './i18n.js';
import { log } from './log.js';

export const TILTS = [
  ['pause', 'Pausa M0 e istruzioni per orientare il pezzo (3 assi)'],
  ['g682', 'G68.2: piano inclinato (3+2 assi)'],
  ['world', 'Coordinate mondo XYZ (orientare l\'utensile a mano)'],
];
export const COOLANTS = [['none', 'Nessuno'], ['flood', 'A pioggia'], ['mist', 'Nebulizzato'], ['air', 'Aria']];
const MOTIONS = [['none', 'Nessun comando'], ['exact', 'Movimento esatto'], ['smooth', 'Movimento smooth']];
const TABS = [
  ['general', 'Generale'], ['syntax', 'Sintassi'], ['arcs', 'Archi e corde'], ['motion', 'Movimenti'],
  ['spindle', 'Mandrino'], ['coolant', 'Refrigerazione'], ['tool', 'Cambio utensile'], ['program', 'Inizio e fine'],
];
const PLACEHOLDERS = 'Segnaposto: {S} giri, {T} utensile, {TOOL} descrizione, {D} diametro, {F} avanzamento, {SEC} e {MS} attesa, {TOL} tolleranza smooth, {NAME} programma, {PROG} numero di programma, {OP} lavorazione, {DATE} {TIME}. Una riga (testo) o ; testo è un commento, scritto nello stile della macchina.';

export const getMachines = () => load('machines');

/** Descrizione breve: archi, piani inclinati, cambio utensile. */
export function machineSummary(m) {
  if (!m) return '';
  const arcs = m.arcs ? t('archi G2/G3') : t('solo G1 (archi a corde)');
  const tilt = { pause: t('piani inclinati con pausa'), g682: t('piani inclinati con G68.2'), world: t('coordinate mondo') }[m.tilt] || '';
  const tool = { auto: t('cambio utensile automatico'), manual: t('cambio utensile con pausa'), none: t('senza cambio utensile') }[m.toolChange] || '';
  return [arcs, tilt, tool].filter(Boolean).join(' · ');
}

/** Il programma della macchina usa il numero di programma (segnaposto {PROG}). */
export const usesProgramNumber = m => [...(m?.header || []), ...(m?.footer || [])].some(l => /\{PROG\}/i.test(l));

// ------------------------------------------------------------------ campi del modulo
const row = (label, ...field) => h('div', { class: 'form-row' }, h('label', {}, t(label)), h('div', { class: 'form-field' }, ...field));
const note = text => h('p', { class: 'p-note mc-note' }, t(text));
const unit = u => h('span', { class: 'unit' }, u);

function num(obj, key, changed, { min = 0, int = false, width } = {}) {
  const inp = h('input', { class: 'num', inputmode: 'decimal', value: obj[key] != null ? fmt(obj[key], 4) : '' });
  if (width) inp.style.width = width;
  inp.addEventListener('input', () => {
    const v = Number(String(inp.value).replace(',', '.'));
    const bad = inp.value.trim() === '' || !Number.isFinite(v) || (min != null && v < min);
    inp.classList.toggle('bad', bad);
    if (bad) return;
    obj[key] = int ? Math.round(v) : v;
    changed();
  });
  return inp;
}
function text(obj, key, changed, { width, placeholder } = {}) {
  const inp = h('input', { value: obj[key] ?? '', placeholder: placeholder || '', spellcheck: 'false' });
  if (width) inp.style.width = width;
  inp.addEventListener('input', () => { obj[key] = inp.value; changed(); });
  return inp;
}
function select(obj, key, options, changed, redraw) {
  const s = h('select', {}, options.map(([v, l]) => h('option', { value: String(v) }, t(l))));
  s.value = String(obj[key] ?? options[0][0]);
  s.addEventListener('change', () => {
    const o = options.find(([v]) => String(v) === s.value);
    obj[key] = o ? o[0] : s.value;
    changed();
    redraw?.();
  });
  return s;
}
function check(obj, key, label, changed, redraw) {
  const c = h('input', { type: 'checkbox' });
  c.checked = !!obj[key];
  c.addEventListener('change', () => { obj[key] = c.checked; changed(); redraw?.(); });
  return h('label', { class: 'opt-radio mc-check' }, c, t(label));
}
/** Righe di comando (una per riga). */
function lines(obj, key, changed, rows = 3) {
  const ta = h('textarea', { class: 'mc-lines', rows, spellcheck: 'false', wrap: 'off' });
  ta.value = (obj[key] || []).join('\n');
  ta.addEventListener('input', () => {
    const v = ta.value.split('\n').map(l => l.replace(/\s+$/, ''));
    while (v.length && v[v.length - 1] === '') v.pop();
    obj[key] = v;
    changed();
  });
  return ta;
}

// ------------------------------------------------------------------ modulo della macchina
function machineForm(m, changedList, presets) {
  let tab = 'general';
  const pane = h('div', { class: 'mc-pane' });
  const tabBar = h('div', { class: 'opt-tabs mc-tabs', role: 'tablist' });
  const out = h('pre', { class: 'mc-code' });
  const warn = h('div', { class: 'mc-warn' });
  const count = h('span', { class: 'mc-count' });
  let timer = 0, seq = 0;
  const refresh = async () => {
    const my = ++seq;
    try {
      const r = await api.machinePreview(m, m.coolant);
      if (my !== seq) return;
      out.textContent = r.text;
      count.textContent = t('{n} righe', { n: r.text.split('\n').length - 1 });
      warn.replaceChildren(...(r.warnings || []).map(x => h('div', {}, x)));
      warn.hidden = !(r.warnings || []).length;
    } catch (e) {
      if (my !== seq) return;
      out.textContent = t('Anteprima non disponibile: {msg}', { msg: e.message });
    }
  };
  const changed = () => {
    changedList();
    clearTimeout(timer);
    timer = setTimeout(refresh, 300);
  };
  const draw = () => pane.replaceChildren(...panes[tab]().filter(Boolean));
  const panes = {
    general: () => [
      row('Nome', text(m, 'name', changed)),
      row('Note', (() => { const ta = h('textarea', { rows: 3, class: 'mc-notes' }); ta.value = m.notes || ''; ta.addEventListener('input', () => { m.notes = ta.value; changed(); }); return ta; })()),
      row('Valori di partenza', (() => {
        const s = h('select', {}, presets.map(p => h('option', { value: p.id }, t(p.name))));
        const b = h('button', { class: 'btn', type: 'button', onclick: () => {
          const p = presets.find(x => x.id === s.value);
          if (!p) return;
          const { id, name } = m;
          for (const k of Object.keys(m)) delete m[k];
          Object.assign(m, structuredClone(p), { id, name });
          changed();
          draw();
          toast(t('Impostazioni di "{name}" applicate', { name: t(p.name) }), 'ok', 2200);
        } }, t('Applica'));
        return [s, b];
      })()),
      note('Applica tutte le impostazioni di un modello di controllo, lasciando il nome della macchina.'),
      row('Piani inclinati', select(m, 'tilt', TILTS, changed)),
      row('Avvicinamento', select(m, 'approachZFirst', [[true, 'Prima la Z di sicurezza, poi mandrino e XY'], [false, 'Mandrino, XY, poi Z (con il correttore)']], changed)),
      row('Corse X / Y / Z', num(m, 'travelX', changed, { width: '70px' }), num(m, 'travelY', changed, { width: '70px' }), num(m, 'travelZ', changed, { width: '70px' }), unit('mm')),
      row('Avanzamento massimo', num(m, 'maxFeed', changed), unit('mm/min')),
      note('0 = non controllare. Un percorso più grande delle corse o un avanzamento oltre il massimo danno un avviso nell\'esportazione (gli avanzamenti si riducono al massimo).'),
      row('Estensione del file', text(m, 'fileExtension', changed, { width: '80px', placeholder: 'nc' })),
    ],
    syntax: () => [
      row('Movimenti', text(m, 'wordRapid', changed, { width: '60px' }), text(m, 'wordLinear', changed, { width: '60px' }),
        text(m, 'wordArcCw', changed, { width: '60px' }), text(m, 'wordArcCcw', changed, { width: '60px' })),
      note('Rapido, lineare, arco orario, arco antiorario.'),
      row('Assi', text(m, 'axisX', changed, { width: '44px' }), text(m, 'axisY', changed, { width: '44px' }), text(m, 'axisZ', changed, { width: '44px' })),
      row('Centro e raggio', text(m, 'axisI', changed, { width: '44px' }), text(m, 'axisJ', changed, { width: '44px' }), text(m, 'axisK', changed, { width: '44px' }), text(m, 'wordRadius', changed, { width: '44px' })),
      row('Avanzamento', text(m, 'wordFeed', changed, { width: '44px' })),
      row('Decimali', h('span', { class: 'mc-sub' }, t('coordinate')), num(m, 'decimals', changed, { int: true, width: '50px' }),
        h('span', { class: 'mc-sub' }, t('archi')), num(m, 'arcDecimals', changed, { int: true, width: '50px' }),
        h('span', { class: 'mc-sub' }, t('avanzamento')), num(m, 'feedDecimals', changed, { int: true, width: '50px' })),
      row('Numeri', select(m, 'numberStyle', [['auto', '10 e 10.5'], ['point', '10. e 10.5 (punto decimale sempre)'], ['zeros', '10.000 (zeri finali)']], changed)),
      row('Inverti assi', check(m, 'invertX', 'X', changed), check(m, 'invertY', 'Y', changed), check(m, 'invertZ', 'Z', changed)),
      row('Spazi', check(m, 'spaceWords', 'Tra le parole (G1 X10 Y5)', changed), check(m, 'spaceAfterLetter', 'Tra lettera e valore (X 10)', changed)),
      row('Sintassi modale', check(m, 'modalMotion', 'Comando di movimento solo quando cambia', changed), check(m, 'modalCoords', 'Solo le coordinate che cambiano', changed)),
      row('Numeri di riga', check(m, 'lineNumbers', 'Numera le righe', changed, draw)),
      m.lineNumbers ? row('Lettera, inizio, passo', text(m, 'lineLetter', changed, { width: '44px' }), num(m, 'lineStart', changed, { int: true, width: '70px' }), num(m, 'lineStep', changed, { int: true, min: 1, width: '60px' })) : null,
      row('Commenti', select(m, 'commentStyle', [['paren', '(commento)'], ['semicolon', '; commento'], ['none', 'Nessun commento']], changed, draw)),
      m.commentStyle !== 'none' ? row('', check(m, 'commentUppercase', 'In maiuscolo', changed), h('span', { class: 'mc-sub' }, t('lunghezza massima')), num(m, 'commentMaxLength', changed, { int: true, width: '60px' })) : null,
      row('Fine riga', select(m, 'lineEnd', [['crlf', 'CR LF (Windows)'], ['lf', 'LF']], changed)),
    ],
    arcs: () => [
      row('Archi', select(m, 'arcs', [[true, 'G2 / G3'], [false, 'Solo G1: archi rifatti a corde']], changed, draw)),
      row('Tolleranza di riconoscimento', num(m, 'arcTolerance', changed), unit('mm')),
      note('I percorsi sono fatti di segmenti: dove i punti stanno su un arco entro questa tolleranza, l\'arco si scrive come G2/G3 o si rifà a corde regolari.'),
      ...(m.arcs ? [
        row('Centro dell\'arco', select(m, 'arcFormat', [['ij', 'I J incrementali dal punto iniziale'], ['ijabs', 'I J assoluti'], ['r', 'Raggio R']], changed)),
        row('Raggio minimo / massimo', num(m, 'arcMinRadius', changed, { width: '70px' }), num(m, 'arcMaxRadius', changed, { width: '80px' }), unit('mm')),
        row('Angolo massimo', num(m, 'arcMaxAngle', changed, { min: 5 }), unit('°')),
        row('Piani e elica', check(m, 'arcAllPlanes', 'Archi anche in XZ e YZ (G18, G19)', changed), check(m, 'arcHelical', 'Archi elicoidali', changed)),
        note('Archi più ampi dell\'angolo massimo si dividono; con il raggio R al massimo 175°. Fuori dai limiti restano i segmenti.'),
      ] : [
        row('Errore di corda', num(m, 'chordTolerance', changed), unit('mm')),
        row('Corda minima / massima', num(m, 'chordMin', changed, { width: '70px' }), num(m, 'chordMax', changed, { width: '70px' }), unit('mm')),
        note('Gli archi riconosciuti si rifanno a corde con questo errore massimo, lunghe almeno la minima e al più la massima (anche i tratti dritti più lunghi della massima si dividono). 0 = senza limite; errore di corda 0 = punti del percorso invariati.'),
      ]),
    ],
    motion: () => [
      row('Svuotature', select(m, 'motionPocket', MOTIONS, changed)),
      row('Finiture', select(m, 'motionFinish', MOTIONS, changed)),
      row('Movimento esatto', text(m, 'motionExact', changed, { placeholder: 'G61' })),
      row('Movimento smooth', text(m, 'motionSmooth', changed, { placeholder: 'G64 P{TOL}' })),
      row('Tolleranza smooth', num(m, 'smoothTolerance', changed), unit('mm')),
      row('A fine programma', lines(m, 'motionEnd', changed, 2)),
      note('Il comando si scrive all\'inizio di ogni lavorazione quando la modalità cambia. Esempi: LinuxCNC G64 P{TOL} e G61, Fanuc G05.1 Q1 (AI contour) e G05.1 Q0, Mach3 G64 e G61. Con molti segmenti G1 il movimento smooth evita i rallentamenti.'),
    ],
    spindle: () => [
      row('Controllo', select(m, 'spindleControl', [['auto', 'Automatico (M3/M4 con i giri)'], ['manual', 'Manuale: pausa per accenderlo e regolarlo'], ['none', 'Nessuno']], changed, draw)),
      ...(m.spindleControl === 'auto' ? [
        row('Senso di rotazione', select(m, 'spindleDirection', [['cw', 'Orario (M3)'], ['ccw', 'Antiorario (M4)']], changed)),
        row('Avvio orario', lines(m, 'spindleOnCw', changed, 2)),
        row('Avvio antiorario', lines(m, 'spindleOnCcw', changed, 2)),
        row('Arresto', lines(m, 'spindleOff', changed, 2)),
        row('Attesa dopo l\'avvio', num(m, 'spindleDelay', changed), unit('s'), text(m, 'dwell', changed, { width: '120px', placeholder: 'G4 P{SEC}' })),
        note('L\'attesa si scrive solo quando il mandrino parte o cambia velocità. GRBL: G4 P{SEC} (secondi); Fanuc: G4 X{SEC}, oppure G4 P{MS} in millisecondi.'),
      ] : []),
      row('Giri minimi / massimi', num(m, 'spindleMin', changed, { width: '80px' }), num(m, 'spindleMax', changed, { width: '80px' }), unit(t('giri/min'))),
      row('', check(m, 'spindleStopEachOp', 'Ferma il mandrino alla fine di ogni lavorazione', changed)),
      note('Altrimenti il mandrino si ferma solo ai cambi utensile, alle pause e a fine programma. 0 giri = senza limite.'),
    ],
    coolant: () => [
      row('Refrigerante predefinito', select(m, 'coolant', COOLANTS, changed)),
      row('A pioggia', lines(m, 'coolantFlood', changed, 1)),
      row('Nebulizzato', lines(m, 'coolantMist', changed, 1)),
      row('Aria', lines(m, 'coolantAir', changed, 1)),
      row('Spegnimento', lines(m, 'coolantOff', changed, 1)),
      note('Il refrigerante si accende con il mandrino e si spegne prima di fermarlo; nell\'esportazione si può sceglierne un altro.'),
      row('Aspirazione / ventola', select(m, 'fan', [['none', 'Nessuna'], ['program', 'Per tutto il programma'], ['spindle', 'Con il mandrino']], changed)),
      row('Accensione', lines(m, 'fanOn', changed, 1)),
      row('Spegnimento', lines(m, 'fanOff', changed, 1)),
    ],
    tool: () => [
      row('Cambio utensile', select(m, 'toolChange', [['auto', 'Automatico'], ['manual', 'Manuale: pausa per cambiarlo'], ['none', 'Nessuno (solo un commento)']], changed)),
      row('Automatico', lines(m, 'toolChangeAuto', changed, 2)),
      row('Manuale', lines(m, 'toolChangeManual', changed, 4)),
      note('Prima del cambio il mandrino e il refrigerante si fermano. Il primo utensile si considera già montato quando il cambio è manuale.'),
      row('Correttore lunghezza', check(m, 'lengthComp', 'Sul primo movimento in Z', changed), text(m, 'lengthCompCmd', changed, { width: '120px', placeholder: 'G43 H{T}' })),
    ],
    program: () => [
      row('Inizio programma', lines(m, 'header', changed, 6)),
      row('Fine programma', lines(m, 'footer', changed, 3)),
      row('Inizio lavorazione', lines(m, 'operationStart', changed, 2)),
      row('Fine lavorazione', lines(m, 'operationEnd', changed, 2)),
      note(PLACEHOLDERS),
    ],
  };
  for (const [id, label] of TABS) {
    const b = h('button', { class: 'opt-tab', type: 'button', role: 'tab', 'data-tab': id }, t(label));
    b.addEventListener('click', () => {
      tab = id;
      for (const x of tabBar.children) x.setAttribute('aria-selected', String(x.dataset.tab === id));
      draw();
    });
    tabBar.append(b);
  }
  tabBar.firstChild.setAttribute('aria-selected', 'true');
  draw();
  refresh();
  return h('div', { class: 'mc-form' },
    h('div', { class: 'mc-left' }, tabBar, pane),
    h('div', { class: 'mc-right' },
      h('div', { class: 'mc-head' }, h('b', {}, t('Anteprima del G-code')), count),
      note('Percorso di prova: svuotatura con ingresso a elica, cerchio e raccordi (T1), finitura su una superficie curva (T2).'),
      warn, out));
}

const COLS = [
  { label: 'Nome', get: x => t(x.name) },
  { label: 'Archi', get: x => (x.arcs ? 'G2/G3' : t('Solo G1')) },
];

/** Finestra del magazzino macchine. */
export async function openMachineLibrary() {
  let presets = [];
  try { presets = await api.machinePresets(); } catch (e) { log.warn('Macchine predefinite non disponibili', e); }
  const ok = await manager({
    title: t('Magazzino macchine'), kind: 'machines', cols: COLS, cls: 'lib-machines',
    form: (it, changed) => machineForm(it, changed, presets),
    make: () => ({ ...structuredClone(presets[0] || {}), id: uid('mc'), name: t('Nuova macchina') }),
  });
  if (ok) log.info('Magazzino macchine salvato');
  return ok;
}
