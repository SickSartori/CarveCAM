// Archivi sul server: magazzino utensili e setup di lavorazione (parametri preferiti dell'utente).
// Finestre di gestione e di scelta usate quando si aggiunge una lavorazione.
import { api } from './api.js';
import { modal, h, toast, confirmBox } from './dialogs.js';
import { t } from './i18n.js';
import { OP_DEFAULTS, REL_PARAMS, BASE_LABEL, setupParamsOf, effParam, round4 } from './oplib.js';
import { uid } from './state.js';
import { fmt } from './geom.js';
import { log } from './log.js';

export const TOOL_TYPES = [['flat', 'Cilindrica (piatta)'], ['bull', 'Torica (raccordata)'], ['ball', 'Sferica']];
const TYPE_SHORT = { flat: 'Cilindrica', bull: 'Torica', ball: 'Sferica' };
const KIND_LABEL = { pocket: 'Svuotatura', finish: 'Finitura' };
const STRATEGIES = [['concentric', 'Concentrica (offset)'], ['zigzag', 'Rettangolare (zigzag)']];
const ENTRIES = [['plunge', 'Affondo verticale'], ['ramp', 'Rampa lungo il percorso'], ['helix', 'Elica']];

const tool = (number, name, type, diameter, cornerRadius, fluteLength, feed, plunge, spindle, extra = {}) => ({
  id: uid('tl'), number, name, type, diameter, cornerRadius, fluteLength, length: Math.max(40, fluteLength * 3),
  shank: Math.max(3, Math.min(diameter, 8)), flutes: 2, material: 'Metallo duro', feed, plunge, spindle, notes: '', ...extra,
});

function defaultTools() {
  return [
    tool(1, 'Fresa cilindrica Ø6', 'flat', 6, 0, 15, 1200, 300, 12000),
    tool(2, 'Fresa cilindrica Ø3', 'flat', 3, 0, 10, 800, 200, 16000),
    tool(3, 'Fresa torica Ø10 R1', 'bull', 10, 1, 22, 1500, 350, 10000, { flutes: 3 }),
    tool(4, 'Fresa torica Ø6 R1', 'bull', 6, 1, 15, 1200, 300, 12000),
    tool(5, 'Fresa sferica Ø6', 'ball', 6, 3, 15, 1500, 400, 14000),
    tool(6, 'Fresa sferica Ø3', 'ball', 3, 1.5, 10, 1000, 300, 18000),
  ];
}

function defaultSetups() {
  const p = k => { const d = setupParamsOf(OP_DEFAULTS[k]); return d; };
  const s = (name, kind, params, notes = '') => ({ id: uid('st'), name, kind, useToolFeeds: true, notes, params: { ...p(kind), ...params } });
  return [
    s('Sgrossatura concentrica con elica', 'pocket', {}, 'Passo laterale 50 % del diametro, passo verticale 10 % dell\'altezza del tagliente.'),
    s('Sgrossatura zigzag con rampa', 'pocket', { strategy: 'zigzag', entry: 'ramp', contourPass: true, stock: 0.3 }),
    s('Finitura zigzag fine', 'finish', { rel: { ...p('finish').rel, stepover: { on: true, pct: 6, min: 0.02, max: 1 } } }),
    s('Finitura concentrica', 'finish', { strategy: 'concentric', rel: { ...p('finish').rel, stepover: { on: true, pct: 10, min: 0.05, max: 2 } } }),
  ];
}

// ------------------------------------------------------------------ cache e persistenza
const cache = { tools: null, setups: null };

async function load(kind) {
  if (cache[kind]) return cache[kind];
  let list = null;
  try { list = await api.library(kind); } catch (e) { log.warn(`Archivio ${kind} non disponibile`, e); }
  if (!Array.isArray(list)) {
    list = kind === 'tools' ? defaultTools() : defaultSetups();
    try { await api.saveLibrary(kind, list); } catch { /* server non raggiungibile: si userà la copia in memoria */ }
  }
  cache[kind] = list;
  return list;
}

async function save(kind, list) {
  cache[kind] = list;
  await api.saveLibrary(kind, list);
  log.info(`Archivio ${kind} salvato`, { count: list.length });
}

export const getTools = () => load('tools');
export const getSetups = () => load('setups');

/** Utensile di una lavorazione (copia) da un utensile del magazzino. */
export function toolFromLibrary(lt) {
  return {
    libId: lt.id, number: lt.number, name: lt.name, type: lt.type, diameter: lt.diameter,
    cornerRadius: lt.type === 'ball' ? lt.diameter / 2 : (lt.cornerRadius || (lt.type === 'bull' ? Math.min(1, lt.diameter / 4) : 0)),
    fluteLength: lt.fluteLength > 0 ? lt.fluteLength : round4(lt.diameter * 2.5),
  };
}

export function toolDesc(tl) {
  if (!tl) return '';
  const tp = t(TYPE_SHORT[tl.type] || tl.type);
  const r = tl.type === 'bull' ? ` R${fmt(tl.cornerRadius, 2)}` : '';
  return `T${tl.number} · ${tp} Ø${fmt(tl.diameter, 2)}${r} · Lc ${fmt(tl.fluteLength, 1)}`;
}

// ------------------------------------------------------------------ campi dei moduli
function row(label, ...field) {
  return h('div', { class: 'form-row' }, h('label', {}, t(label)), h('div', { class: 'form-field' }, ...field));
}
function numInput(obj, key, onChange, opts = {}) {
  const inp = h('input', { inputmode: 'decimal', value: obj[key] != null ? fmt(obj[key], 4) : '', class: 'num' });
  inp.addEventListener('change', () => {
    const v = Number(String(inp.value).replace(',', '.'));
    if (!Number.isFinite(v) || (opts.min != null && v < opts.min)) { inp.classList.add('bad'); return; }
    inp.classList.remove('bad');
    obj[key] = opts.int ? Math.round(v) : v;
    onChange?.();
  });
  return inp;
}
function textInput(obj, key, onChange) {
  const inp = h('input', { value: obj[key] ?? '' });
  inp.addEventListener('input', () => { obj[key] = inp.value; onChange?.(); });
  return inp;
}
function selectInput(obj, key, options, onChange) {
  const s = h('select', {}, options.map(([v, l]) => h('option', { value: v }, t(l))));
  s.value = obj[key] ?? options[0][0];
  s.addEventListener('change', () => { obj[key] = s.value; onChange?.(); });
  return s;
}
function checkInput(obj, key, onChange) {
  const c = h('input', { type: 'checkbox' });
  c.checked = obj[key] !== false;
  c.addEventListener('change', () => { obj[key] = c.checked; onChange?.(); });
  return c;
}
const unit = u => h('span', { class: 'unit' }, u);
/** Nodi non nulli (i campi condizionali possono essere null). */
const nn = (...nodes) => nodes.filter(Boolean);

/** Parametro in mm oppure in % (del diametro o dell'altezza del tagliente) con limiti in mm. */
function relEditor(params, key, onChange) {
  const spec = REL_PARAMS[key];
  params.rel = params.rel || {};
  const r = params.rel[key] = params.rel[key] || { on: false, pct: 50, min: 0, max: 0 };
  const box = h('div', { class: 'rel-edit' });
  const draw = () => {
    box.innerHTML = '';
    const mode = h('select', { class: 'rel-mode' }, h('option', { value: 'mm' }, 'mm'), h('option', { value: 'pct' }, `% ${BASE_LABEL[spec.base]}`));
    mode.value = r.on ? 'pct' : 'mm';
    mode.addEventListener('change', () => { r.on = mode.value === 'pct'; draw(); onChange?.(); });
    if (r.on) {
      box.append(numInput(r, 'pct', onChange, { min: 0 }), mode,
        h('span', { class: 'rel-lim' }, t('min')), numInput(r, 'min', onChange, { min: 0 }),
        h('span', { class: 'rel-lim' }, t('max')), numInput(r, 'max', onChange, { min: 0 }), unit('mm'));
    } else {
      box.append(numInput(params, key, onChange, { min: 0 }), mode);
    }
  };
  draw();
  return box;
}

// ------------------------------------------------------------------ elenco con modulo (gestione archivi)
/**
 * Finestra di gestione di un archivio: elenco a sinistra, modulo dell'elemento a destra.
 * cols: [{ label, get(item) }], form(item, onChange) -> Node, make() -> nuovo elemento.
 */
async function manager({ title, kind, cols, form, make, filter }) {
  const list = structuredClone(await load(kind));
  let sel = list[0]?.id || null;
  const tbody = h('tbody');
  const formBox = h('div', { class: 'lib-form' });
  const search = h('input', { class: 'lib-search', placeholder: t('Filtra…'), type: 'search' });
  const redrawList = () => {
    tbody.innerHTML = '';
    const q = search.value.trim().toLowerCase();
    for (const it of list) {
      if (filter && !filter(it)) continue;
      if (q && !cols.some(c => String(c.get(it)).toLowerCase().includes(q))) continue;
      const tr = h('tr', { class: it.id === sel ? 'sel' : '' }, cols.map(c => h('td', { class: c.cls || '' }, c.get(it))));
      tr.addEventListener('click', () => { sel = it.id; redrawList(); redrawForm(); });
      tbody.append(tr);
    }
  };
  const redrawForm = () => {
    formBox.innerHTML = '';
    const it = list.find(x => x.id === sel);
    if (!it) { formBox.append(h('div', { class: 'p-note' }, t('Nessun elemento selezionato.'))); return; }
    formBox.append(form(it, () => redrawList()));
  };
  search.addEventListener('input', redrawList);
  const add = () => { const it = make(); list.push(it); sel = it.id; redrawList(); redrawForm(); };
  const dup = () => {
    const it = list.find(x => x.id === sel);
    if (!it) return;
    const c = structuredClone(it);
    c.id = uid(kind === 'tools' ? 'tl' : 'st');
    c.name = `${it.name} (${t('copia')})`;
    if (kind === 'tools') c.number = Math.max(0, ...list.map(x => x.number || 0)) + 1;
    list.push(c); sel = c.id; redrawList(); redrawForm();
  };
  const del = async () => {
    const i = list.findIndex(x => x.id === sel);
    if (i < 0) return;
    if (!(await confirmBox(t('Elimina'), t('Eliminare "{name}" dall\'archivio?', { name: list[i].name }), t('Elimina')))) return;
    list.splice(i, 1);
    sel = list[Math.min(i, list.length - 1)]?.id || null;
    redrawList(); redrawForm();
  };
  const body = h('div', { class: 'lib' },
    h('div', { class: 'lib-left' },
      h('div', { class: 'lib-tools' }, search,
        h('button', { class: 'btn', type: 'button', onclick: add }, t('Nuovo')),
        h('button', { class: 'btn', type: 'button', onclick: dup }, t('Duplica')),
        h('button', { class: 'btn danger', type: 'button', onclick: del }, t('Elimina'))),
      h('div', { class: 'lib-list' }, h('table', {}, h('thead', {}, h('tr', {}, cols.map(c => h('th', { class: c.cls || '' }, t(c.label))))), tbody))),
    formBox);
  redrawList();
  redrawForm();
  const ok = await modal({
    title, body, size: 'xl', enter: false,
    buttons: [{ label: t('Annulla'), value: false }, { label: t('Salva'), value: true, primary: true }],
  });
  if (!ok) return false;
  try {
    await save(kind, list);
    toast(t('Archivio salvato'), 'ok', 1800);
    return true;
  } catch (e) {
    toast(t('Salvataggio dell\'archivio non riuscito: {msg}', { msg: e.message }), 'err', 6000);
    return false;
  }
}

// ------------------------------------------------------------------ magazzino utensili
const TOOL_COLS = [
  { label: 'T', get: x => x.number, cls: 'num' },
  { label: 'Nome', get: x => x.name },
  { label: 'Tipo', get: x => t(TYPE_SHORT[x.type] || x.type) },
  { label: 'Ø', get: x => fmt(x.diameter, 2), cls: 'num' },
  { label: 'Lc', get: x => fmt(x.fluteLength, 1), cls: 'num' },
];

function toolForm(it, changed) {
  const box = h('div', {});
  const draw = () => {
    box.innerHTML = '';
    box.append(...nn(
      h('div', { class: 'p-sec' }, t('Utensile')),
      row('Nome', textInput(it, 'name', changed)),
      row('Numero (T)', numInput(it, 'number', changed, { min: 0, int: true })),
      row('Tipo fresa', selectInput(it, 'type', TOOL_TYPES, () => { if (it.type === 'ball') it.cornerRadius = it.diameter / 2; changed(); draw(); })),
      row('Diametro', numInput(it, 'diameter', changed, { min: 0.01 }), unit('mm')),
      it.type === 'bull' ? row('Raggio raccordo', numInput(it, 'cornerRadius', changed, { min: 0 }), unit('mm')) : null,
      row('Altezza tagliente (Lc)', numInput(it, 'fluteLength', changed, { min: 0.1 }), unit('mm')),
      row('Lunghezza utile', numInput(it, 'length', changed, { min: 0 }), unit('mm')),
      row('Diametro gambo', numInput(it, 'shank', changed, { min: 0 }), unit('mm')),
      row('Numero taglienti', numInput(it, 'flutes', changed, { min: 1, int: true })),
      row('Materiale', textInput(it, 'material', changed)),
      h('div', { class: 'p-sec' }, t('Tecnologia consigliata')),
      row('Avanzamento', numInput(it, 'feed', changed, { min: 0 }), unit('mm/min')),
      row('Affondo', numInput(it, 'plunge', changed, { min: 0 }), unit('mm/min')),
      row('Mandrino', numInput(it, 'spindle', changed, { min: 0, int: true }), unit(t('giri/min'))),
      row('Note', textInput(it, 'notes', changed))));
  };
  draw();
  return box;
}

export function openToolLibrary() {
  return manager({
    title: t('Magazzino utensili'), kind: 'tools', cols: TOOL_COLS, form: toolForm,
    make: () => tool((cache.tools || []).length + 1, t('Nuova fresa'), 'flat', 6, 0, 15, 1200, 300, 12000),
  });
}

// ------------------------------------------------------------------ setup di lavorazione
const SETUP_COLS = [
  { label: 'Nome', get: x => x.name },
  { label: 'Lavorazione', get: x => t(KIND_LABEL[x.kind] || x.kind) },
  { label: 'Strategia', get: x => (x.params?.strategy === 'zigzag' ? t('Zigzag') : t('Concentrica')) },
];

function setupForm(it, changed) {
  const box = h('div', {});
  const p = it.params = it.params || setupParamsOf(OP_DEFAULTS[it.kind] || OP_DEFAULTS.pocket);
  const draw = () => {
    box.innerHTML = '';
    const pocket = it.kind !== 'finish';
    box.append(...nn(
      h('div', { class: 'p-sec' }, t('Setup')),
      row('Nome', textInput(it, 'name', changed)),
      row('Lavorazione', selectInput(it, 'kind', [['pocket', 'Svuotatura'], ['finish', 'Finitura']], () => { changed(); draw(); })),
      row('Note', textInput(it, 'notes', changed)),
      h('div', { class: 'p-sec' }, t('Strategia')),
      row('Strategia', selectInput(p, 'strategy', STRATEGIES, () => { changed(); draw(); })),
      p.strategy === 'zigzag' ? row('Angolo passate', numInput(p, 'angle', changed), unit('°')) : null,
      row('Concorde (climb)', checkInput(p, 'climb', changed)),
      row('Utensile dentro contorno', checkInput(p, 'toolInside', changed)),
      pocket && p.strategy === 'zigzag' ? row('Passata di contorno', checkInput(p, 'contourPass', changed)) : null,
      h('div', { class: 'p-sec' }, t('Passi e quote')),
      row('Passo laterale', relEditor(p, 'stepover', changed)),
      pocket ? row('Passo verticale', relEditor(p, 'stepdown', changed)) : null,
      row('Profondità max', numInput(p, 'maxDepth', changed, { min: 0.001 }), unit('mm')),
      row('Sovrametallo', numInput(p, 'stock', changed, { min: 0 }), unit('mm')),
      row('Quota sicurezza', numInput(p, 'safeHeight', changed, { min: 0.1 }), unit('mm')),
      row('Avvicinamento', numInput(p, 'clearance', changed, { min: 0 }), unit('mm')),
      row(pocket ? 'Risoluzione griglia' : 'Passo campionam.', numInput(p, 'resolution', changed, { min: 0 }), unit(t('mm (0=auto)'))),
      row('Tolleranza', numInput(p, 'tolerance', changed, { min: 0.0005 }), unit('mm')),
      pocket ? h('div', { class: 'p-sec' }, t('Ingresso nel materiale')) : null,
      pocket ? row('Tipo ingresso', selectInput(p, 'entry', ENTRIES, () => { changed(); draw(); })) : null,
      pocket && p.entry !== 'plunge' ? row('Angolo discesa', numInput(p, 'rampAngle', changed, { min: 0.5 }), unit('°')) : null,
      pocket && p.entry === 'helix' ? row('Raggio elica', relEditor(p, 'helixRadius', changed)) : null,
      pocket && p.entry !== 'plunge' ? row('Avanz. rampa', numInput(p, 'rampFeed', changed, { min: 0 }), unit(t('mm/min (0=lavoro)'))) : null,
      h('div', { class: 'p-sec' }, t('Tecnologia')),
      row('Avanzamenti dall\'utensile', checkInput(it, 'useToolFeeds', () => { changed(); draw(); })),
      it.useToolFeeds !== false ? h('div', { class: 'p-note' }, t('Avanzamento, affondo e mandrino vengono presi dall\'utensile scelto.')) : null,
      it.useToolFeeds === false ? row('Avanzamento', numInput(p, 'feed', changed, { min: 1 }), unit('mm/min')) : null,
      it.useToolFeeds === false ? row('Affondo', numInput(p, 'plunge', changed, { min: 1 }), unit('mm/min')) : null,
      it.useToolFeeds === false ? row('Mandrino', numInput(p, 'spindle', changed, { min: 0, int: true }), unit(t('giri/min'))) : null));
  };
  draw();
  return box;
}

export function openSetupLibrary() {
  return manager({
    title: t('Setup di lavorazione'), kind: 'setups', cols: SETUP_COLS, form: setupForm,
    make: () => ({ id: uid('st'), name: t('Nuovo setup'), kind: 'pocket', useToolFeeds: true, notes: '', params: setupParamsOf(OP_DEFAULTS.pocket) }),
  });
}

/** Salva i parametri di una lavorazione come nuovo setup. */
export async function saveOperationAsSetup(op) {
  const name = h('input', { value: op.name, autofocus: true });
  const notes = h('input', { value: '' });
  const feeds = h('input', { type: 'checkbox' });
  feeds.checked = false;
  const ok = await modal({
    title: t('Salva come setup'),
    body: h('div', {},
      h('div', { class: 'form-row' }, h('label', {}, t('Nome del setup')), name),
      h('div', { class: 'form-row' }, h('label', {}, t('Note')), notes),
      h('div', { class: 'form-row' }, h('label', {}, t('Avanzamenti dall\'utensile')), h('div', {}, feeds)),
      h('p', { class: 'p-note' }, t('Il setup conserva strategia, passi (anche in %), quote, ingresso e tecnologia; l\'utensile si sceglie quando si crea la lavorazione.'))),
    buttons: [{ label: t('Annulla'), value: false }, { label: t('Salva'), value: true, primary: true }],
  });
  if (!ok || !name.value.trim()) return;
  const list = structuredClone(await getSetups());
  list.push({ id: uid('st'), name: name.value.trim(), kind: op.kind === 'finish' ? 'finish' : 'pocket', useToolFeeds: feeds.checked, notes: notes.value, params: setupParamsOf(op) });
  try {
    await save('setups', list);
    toast(t('Setup "{name}" salvato', { name: name.value.trim() }), 'ok');
  } catch (e) { toast(e.message, 'err'); }
}

// ------------------------------------------------------------------ scelta di utensile e setup (nuova lavorazione)
/** Elenco selezionabile: ritorna l'elemento scelto con doppio clic o il pulsante principale. */
function chooser({ title, intro, items, cols, preselect, buttons, onAction }) {
  let sel = preselect ?? items[0]?.id ?? null;
  const tbody = h('tbody');
  const draw = () => {
    tbody.innerHTML = '';
    for (const it of items) {
      const tr = h('tr', { class: it.id === sel ? 'sel' : '' }, cols.map(c => h('td', { class: c.cls || '' }, c.get(it))));
      tr.addEventListener('click', () => { sel = it.id; draw(); });
      tr.addEventListener('dblclick', () => { sel = it.id; closeFn?.('ok'); });
      tbody.append(tr);
    }
  };
  let closeFn = null;
  draw();
  const body = h('div', {},
    intro ? h('p', { class: 'p-note', style: { margin: '0 0 8px' } }, intro) : null,
    h('div', { class: 'lib-list chooser' }, h('table', {}, h('thead', {}, h('tr', {}, cols.map(c => h('th', { class: c.cls || '' }, t(c.label))))), tbody)));
  return modal({
    title, body, size: 'wide', buttons,
    onOpen: (bd, close) => {
      closeFn = close;
      bd.addEventListener('keydown', e => {
        if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
        e.preventDefault();
        const i = items.findIndex(x => x.id === sel);
        sel = items[Math.max(0, Math.min(items.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)))]?.id ?? sel;
        draw();
      });
      onAction?.(close);
    },
  }).then(v => ({ value: v, item: items.find(x => x.id === sel) || null }));
}

/** Scelta dell'utensile per una nuova lavorazione: utensile del magazzino o null se annullato. */
export async function pickTool(kind, current) {
  for (;;) {
    const tools = await getTools();
    if (!tools.length) {
      const go = await confirmBox(t('Magazzino utensili vuoto'), t('Il magazzino non contiene utensili. Aprirlo per aggiungerne uno?'), t('Apri magazzino'));
      if (!go) return null;
      await openToolLibrary();
      if (!(await getTools()).length) return null;
      continue;
    }
    const pref = current && tools.find(x => x.id === current)
      || tools.find(x => (kind === 'finish' ? x.type === 'ball' : x.type !== 'ball')) || tools[0];
    const res = await chooser({
      title: t('Nuova {kind} · 1/2 · Utensile', { kind: t(KIND_LABEL[kind]).toLowerCase() }),
      intro: t('Scegli l\'utensile dal magazzino (doppio clic o Avanti).'),
      items: tools, cols: [...TOOL_COLS, { label: 'Note', get: x => x.notes || '' }], preselect: pref.id,
      buttons: [
        { label: t('Gestisci magazzino…'), value: 'manage', left: true },
        { label: t('Annulla'), value: false },
        { label: t('Avanti ›'), value: 'ok', primary: true },
      ],
    });
    if (res.value === 'manage') { await openToolLibrary(); continue; }
    if (res.value !== 'ok' || !res.item) return null;
    return res.item;
  }
}

/**
 * Scelta del setup: { setup } (null = parametri predefiniti), 'back' per tornare all'utensile, null se annullato.
 */
export async function pickSetup(kind, tl) {
  for (;;) {
    const setups = (await getSetups()).filter(s => s.kind === kind);
    const def = { id: '__default', name: t('Parametri predefiniti CarveCAM'), kind, params: setupParamsOf(OP_DEFAULTS[kind]), useToolFeeds: true, notes: '' };
    const items = [def, ...setups];
    const fake = { tool: toolFromLibrary(tl) };
    const desc = s => {
      const p = s.params || {};
      const op = { ...fake, ...p };
      const parts = [p.strategy === 'zigzag' ? t('Zigzag') : t('Concentrica'), `${t('passo')} ${fmt(effParam(op, 'stepover'), 3)} mm`];
      if (kind !== 'finish') parts.push(`${t('passo vert.')} ${fmt(effParam(op, 'stepdown'), 3)} mm`);
      return parts.join(' · ');
    };
    const res = await chooser({
      title: t('Nuova {kind} · 2/2 · Setup', { kind: t(KIND_LABEL[kind]).toLowerCase() }),
      intro: t('Utensile: {tool}. Scegli i parametri di lavorazione salvati (i valori in % sono calcolati su questo utensile).', { tool: `${tl.name} (${toolDesc(toolFromLibrary(tl))})` }),
      items, cols: [{ label: 'Setup', get: x => x.name }, { label: 'Parametri', get: desc }, { label: 'Note', get: x => x.notes || '' }],
      buttons: [
        { label: t('Gestisci setup…'), value: 'manage', left: true },
        { label: t('‹ Indietro'), value: 'back' },
        { label: t('Annulla'), value: false },
        { label: t('Crea lavorazione'), value: 'ok', primary: true },
      ],
    });
    if (res.value === 'manage') { await openSetupLibrary(); continue; }
    if (res.value === 'back') return 'back';
    if (res.value !== 'ok' || !res.item) return null;
    return { setup: res.item.id === '__default' ? null : res.item };
  }
}
