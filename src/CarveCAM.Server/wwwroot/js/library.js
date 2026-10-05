// Archivi sul server: magazzino utensili, setup di lavorazione (parametri preferiti dell'utente) e magazzino
// macchine (vedi machines.js). Finestre di gestione e di scelta usate quando si aggiunge una lavorazione;
// esportazione e importazione degli archivi; utensili salvati nel progetto e confronto con il magazzino all'apertura.
import { api, download } from './api.js';
import { modal, h, toast, confirmBox } from './dialogs.js';
import { t } from './i18n.js';
import { OP_DEFAULTS, REL_PARAMS, BASE_LABEL, setupParamsOf, effParam, round4, toolSilhouette, toolIssues, taperGeom } from './oplib.js';
import { toolViewer } from './tool3d.js';
import { uid } from './state.js';
import { fmt } from './geom.js';
import { log } from './log.js';

export const TOOL_TYPES = [['flat', 'Cilindrica (piatta)'], ['bull', 'Torica (raccordata)'], ['ball', 'Sferica'], ['taper', 'Conica']];
export const TIP_TYPES = [['ball', 'Sferica'], ['flat', 'Piatta (a V con Ø punta 0)']];
const TYPE_SHORT = { flat: 'Cilindrica', bull: 'Torica', ball: 'Sferica', taper: 'Conica' };
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
    tool(7, 'Fresa conica sferica Ø1 3°', 'taper', 1, 0, 15, 900, 250, 18000, { taperAngle: 3, tipType: 'ball', shank: 4, length: 25 }),
    tool(8, 'Fresa a V 60°', 'taper', 0, 0, 8, 800, 200, 16000, { taperAngle: 30, tipType: 'flat', shank: 6, length: 15 }),
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
const cache = { tools: null, setups: null, machines: null };

/** Archivio iniziale: utensili e setup predefiniti, macchine predefinite del server. */
async function defaults(kind) {
  if (kind === 'tools') return defaultTools();
  if (kind === 'setups') return defaultSetups();
  return api.machinePresets();
}

export async function load(kind) {
  if (cache[kind]) return cache[kind];
  let list = null;
  try { list = await api.library(kind); } catch (e) { log.warn(`Archivio ${kind} non disponibile`, e); }
  if (!Array.isArray(list)) {
    list = await defaults(kind);
    try { await api.saveLibrary(kind, list); } catch { /* server non raggiungibile: si userà la copia in memoria */ }
  }
  cache[kind] = list;
  return list;
}

export async function save(kind, list) {
  cache[kind] = list;
  await api.saveLibrary(kind, list);
  log.info(`Archivio ${kind} salvato`, { count: list.length });
}

export const getTools = () => load('tools');
export const getSetups = () => load('setups');

/** Utensile di una lavorazione (copia) da un utensile del magazzino. */
export function toolFromLibrary(lt) {
  const taper = lt.type === 'taper';
  return {
    libId: lt.id, number: lt.number, name: lt.name, type: lt.type, diameter: lt.diameter,
    cornerRadius: lt.type === 'ball' ? lt.diameter / 2 : taper ? 0 : (lt.cornerRadius || (lt.type === 'bull' ? Math.min(1, lt.diameter / 4) : 0)),
    fluteLength: lt.fluteLength > 0 ? lt.fluteLength : round4(Math.max(lt.diameter * 2.5, taper ? 10 : 0)),
    // fresa conica: angolo per lato e tipo di punta
    ...(taper ? { taperAngle: lt.taperAngle > 0 ? lt.taperAngle : 5, tipType: lt.tipType === 'flat' ? 'flat' : 'ball' } : {}),
    // geometria oltre il tagliente: serve per generare la fresa in simulazione
    length: lt.length > 0 ? lt.length : 0, neck: lt.neck > 0 ? lt.neck : 0, shank: lt.shank > 0 ? lt.shank : 0,
  };
}

/**
 * Disegno 2D della fresa generata dai suoi parametri (SVG in scala): tagliente, collo, gambo e portautensile,
 * con le quote di altezza del tagliente (Lc) e sbalzo. issues (da toolIssues): le misure incongruenti sono
 * disegnate in rosso con il loro valore, accanto alla sagoma ricavata dai valori ammissibili.
 */
export function toolPreview(tool, issues = []) {
  const { pts, dims: d, top } = toolSilhouette(tool);
  const bad = new Set(issues.map(x => x.field));
  const raw = k => Math.max(0, Number(tool[k]) || 0);
  const H = Math.max(top, raw('length'), raw('fluteLength')) + d.holderLen * 0.45;
  const W = Math.max(d.holderR, d.shankR, d.R, raw('neck') / 2, bad.has('cornerRadius') ? raw('cornerRadius') : 0) * 2;
  const pad = Math.max(W, H) * 0.05;
  const fs = Math.max(W, H) * 0.05;
  const lab = fs * 7;
  const n = v => v.toFixed(3);
  const y = z => n(H - z);
  const outline = list => list.map(([r, z]) => `${n(r)},${y(z)}`).join(' ');
  const side = p => [...p, ...p.slice().reverse().map(([r, z]) => [-r, z])];
  const k = pts.findIndex(([, z]) => z >= d.Lc - 1e-9);
  const dim = (z, txt, err = false) => `<line x1="${n(-W / 2)}" y1="${y(z)}" x2="${n(W / 2 + lab * 0.15)}" y2="${y(z)}" class="${err ? 'tp-err' : 'tp-dim'}"/>` +
    `<text x="${n(W / 2 + lab * 0.2)}" y="${n(H - z + fs * 0.35)}" font-size="${n(fs)}"${err ? ' class="tp-err-txt"' : ''}>${txt}</text>`;
  let marks = '';
  if (bad.has('cornerRadius')) {
    // raccordo con il raggio inserito: esce dalla fresa
    const r = raw('cornerRadius');
    marks += `<circle cx="${n(d.R - r)}" cy="${y(r)}" r="${n(r)}" class="tp-err" fill="none"/>` +
      `<line x1="${n(d.R)}" y1="${y(0)}" x2="${n(d.R)}" y2="${y(Math.max(r, d.Lc))}" class="tp-err"/>` +
      `<text x="${n(d.R - r)}" y="${n(H - r * 2 - fs * 0.4)}" font-size="${n(fs)}" text-anchor="middle" class="tp-err-txt">R${fmt(r, 2)} &gt; Ø/2</text>`;
  }
  if (bad.has('fluteLength')) marks += dim(raw('fluteLength'), `Lc ${fmt(raw('fluteLength'), 2)} ✕`, true) + (d.r > 0 ? dim(d.r, `R ${fmt(d.r, 2)}`, true) : '');
  if (bad.has('length')) marks += dim(raw('length'), `${t('sbalzo')} ${fmt(raw('length'), 2)} ✕`, true);
  if (bad.has('neck')) {
    const nr = raw('neck') / 2, z1 = d.Lc, z2 = Math.max(d.reach, d.Lc + d.D);
    marks += `<line x1="${n(nr)}" y1="${y(z1)}" x2="${n(nr)}" y2="${y(z2)}" class="tp-err"/><line x1="${n(-nr)}" y1="${y(z1)}" x2="${n(-nr)}" y2="${y(z2)}" class="tp-err"/>` +
      `<text x="0" y="${n(H - z2 - fs * 0.5)}" font-size="${n(fs)}" text-anchor="middle" class="tp-err-txt">${t('collo')} Ø${fmt(raw('neck'), 2)} ✕</text>`;
  }
  const svg = `<svg viewBox="${n(-W / 2 - pad)} ${n(-pad)} ${n(W + 2 * pad + lab)} ${n(H + 2 * pad)}" role="img" aria-label="${t('Anteprima della fresa')}">` +
    `<rect x="${n(-d.holderR)}" y="0" width="${n(2 * d.holderR)}" height="${n(Math.max(0, H - top))}" class="tp-holder"/>` +
    `<polygon points="${outline(side(pts))}" class="tp-body${issues.length ? ' tp-faded' : ''}"/>` +
    `<polygon points="${outline(side(pts.slice(0, k + 1)))}" class="tp-cut${issues.length ? ' tp-faded' : ''}"/>` +
    (bad.has('fluteLength') ? '' : dim(d.Lc, `Lc ${fmt(d.Lc, 2)}`)) +
    (!bad.has('length') && d.reach > d.Lc + 1e-6 ? dim(d.reach, `${t('sbalzo')} ${fmt(d.reach, 2)}`) : '') + marks +
    `<text x="0" y="${n(H + pad * 0.9)}" font-size="${n(fs)}" text-anchor="middle"${bad.has('diameter') ? ' class="tp-err-txt"' : ''}>Ø${fmt(Number(tool.diameter) || 0, 2)}</text></svg>`;
  return h('div', { class: `tool-preview${issues.length ? ' has-err' : ''}`, html: svg });
}

export function toolDesc(tl) {
  if (!tl) return '';
  const tp = t(TYPE_SHORT[tl.type] || tl.type);
  if (tl.type === 'taper') {
    const g = taperGeom(tl);
    const tip = g.rt > 0 ? `${t('punta')} ${g.ball ? t('sferica') : t('piatta')} Ø${fmt(g.rt * 2, 2)}` : t('punta a V');
    return `T${tl.number} · ${tp} ${tip} · ${fmt(g.deg, 2)}° ${t('per lato')} · Lc ${fmt(g.Lc, 1)} · Ø max ${fmt(g.R * 2, 2)}`;
  }
  const r = tl.type === 'bull' ? ` R${fmt(tl.cornerRadius, 2)}` : '';
  return `T${tl.number} · ${tp} Ø${fmt(tl.diameter, 2)}${r} · Lc ${fmt(tl.fluteLength, 1)}`;
}

// ------------------------------------------------------------------ campi dei moduli
function row(label, ...field) {
  return h('div', { class: 'form-row' }, h('label', {}, t(label)), h('div', { class: 'form-field' }, ...field));
}
/** Riga legata a un parametro (data-field): evidenziata se il parametro è incongruente. */
function frow(fieldKey, label, ...field) {
  const r = row(label, ...field);
  r.dataset.field = fieldKey;
  return r;
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
/** Prefisso degli id, nome del file esportato e nome degli elementi per archivio. */
const KINDS = {
  tools: { prefix: 'tl', file: 'carvecam-utensili.json', what: 'utensili' },
  setups: { prefix: 'st', file: 'carvecam-setup.json', what: 'setup di lavorazione' },
  machines: { prefix: 'mc', file: 'carvecam-macchine.json', what: 'macchine' },
};

/**
 * Finestra di gestione di un archivio: elenco a sinistra, modulo dell'elemento a destra.
 * cols: [{ label, get(item) }], form(item, onChange) -> Node, make() -> nuovo elemento; cls: classe in più.
 */
export async function manager({ title, kind, cols, form, make, filter, cls = '' }) {
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
    c.id = uid(KINDS[kind].prefix);
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
  // esportazione dell'elenco mostrato (anche modifiche non ancora salvate) e importazione da file
  const exp = () => {
    downloadLibrary({ [kind]: list }, KINDS[kind].file);
  };
  const imp = async () => {
    const data = await readLibraryFile();
    const items = data?.[kind];
    if (!items) { if (data) toast(t('Il file non contiene {what}', { what: t(KINDS[kind].what) }), 'warn'); return; }
    const mode = await askImportMode(items.length, kind);
    if (!mode) return;
    const res = mergeItems(list, items, kind, mode === 'replace');
    sel = list[0]?.id || null;
    redrawList(); redrawForm();
    toast(t('{a} aggiunti, {u} aggiornati: premi Salva per conservarli', { a: res.added, u: res.updated }), 'ok', 4000);
  };
  const body = h('div', { class: `lib ${cls}`.trim() },
    h('div', { class: 'lib-left' },
      h('div', { class: 'lib-tools' }, search,
        h('button', { class: 'btn', type: 'button', onclick: add }, t('Nuovo')),
        h('button', { class: 'btn', type: 'button', onclick: dup }, t('Duplica')),
        h('button', { class: 'btn danger', type: 'button', onclick: del }, t('Elimina'))),
      h('div', { class: 'lib-list' }, h('table', {}, h('thead', {}, h('tr', {}, cols.map(c => h('th', { class: c.cls || '' }, t(c.label))))), tbody)),
      h('div', { class: 'lib-tools lib-io' },
        h('button', { class: 'btn', type: 'button', onclick: exp, title: t('Salva l\'elenco in un file (.json)') }, t('Esporta…')),
        h('button', { class: 'btn', type: 'button', onclick: imp, title: t('Aggiunge o sostituisce elementi da un file esportato') }, t('Importa…')))),
    formBox);
  redrawList();
  redrawForm();
  const ok = await modal({
    title, body, size: 'xl', enter: false,
    buttons: [{ label: t('Annulla'), value: false }, { label: t('Salva'), value: true, primary: true }],
  });
  if (!ok) return false;
  if (kind === 'tools') {
    const wrong = list.filter(x => toolIssues(x).length);
    if (wrong.length && !(await confirmBox(t('Misure incongruenti'),
      t('Questi utensili hanno misure incongruenti: {list}. Salvare comunque il magazzino?', { list: wrong.map(x => `T${x.number} ${x.name}`).join(', ') }), t('Salva comunque')))) return false;
  }
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

let previewMode = '3d';   // anteprima del magazzino: '3d' (rendering) o '2d' (quote)

function toolForm(it, changed0) {
  const box = h('div', { class: 'tool-form' });
  const fields = h('div', {});
  const preview = h('div', { class: 'tool-preview-box' });
  // l'anteprima si rigenera a ogni modifica: rendering 3D in scala oppure, con misure incongruenti, disegno 2D dell'errore
  const drawPreview = () => {
    const issues = toolIssues(it);
    for (const el of fields.querySelectorAll('[data-field]')) el.classList.toggle('field-err', issues.some(x => x.field === el.dataset.field));
    if (issues.length) {
      preview.replaceChildren(
        h('div', { class: 'tp-head err' }, t('Misure incongruenti')),
        toolPreview(it, issues),
        h('ul', { class: 'tool-errs' }, issues.map(x => h('li', {}, x.msg))));
      return;
    }
    const tab = (m, label) => h('button', { type: 'button', class: 'seg-btn', role: 'radio', 'aria-checked': String(previewMode === m),
      onclick: () => { previewMode = m; drawPreview(); } }, label);
    const head = h('div', { class: 'tp-head' }, h('span', {}, t('Anteprima in scala')), h('div', { class: 'seg' }, tab('3d', '3D'), tab('2d', t('Quote'))));
    if (previewMode === '3d') {
      const v = toolViewer();
      preview.replaceChildren(head, v.el, h('div', { class: 'p-note' }, t('Generata dai parametri · trascina per ruotare')));
      v.set(it);
    } else {
      preview.replaceChildren(head, toolPreview(it), h('div', { class: 'p-note' }, t('Generata dai parametri')));
    }
  };
  const changed = () => { changed0(); drawTaper(); drawPreview(); };
  // fresa conica: diametro massimo ricavato da punta, angolo e altezza del cono
  const taperMax = h('div', { class: 'p-info' });
  const drawTaper = () => { if (it.type === 'taper') taperMax.textContent = `Ø ${fmt(taperGeom(it).R * 2, 3)} mm`; };
  let taper = it.type === 'taper';
  const draw = () => {
    taper = it.type === 'taper';
    drawTaper();
    fields.innerHTML = '';
    fields.append(...nn(
      h('div', { class: 'p-sec' }, t('Utensile')),
      row('Nome', textInput(it, 'name', changed)),
      row('Numero (T)', numInput(it, 'number', changed, { min: 0, int: true })),
      row('Tipo fresa', selectInput(it, 'type', TOOL_TYPES, () => {
        if (it.type === 'ball') it.cornerRadius = it.diameter / 2;
        if (it.type === 'taper') { if (!(it.taperAngle > 0)) it.taperAngle = 5; if (!it.tipType) it.tipType = 'ball'; }
        changed(); draw();
      })),
      frow('diameter', taper ? 'Diametro in punta' : 'Diametro', numInput(it, 'diameter', changed, { min: 0 }), unit(taper ? t('mm (0 = a V)') : 'mm')),
      it.type === 'bull' ? frow('cornerRadius', 'Raggio raccordo', numInput(it, 'cornerRadius', changed, { min: 0 }), unit('mm')) : null,
      taper ? row('Punta', selectInput(it, 'tipType', TIP_TYPES, () => { changed(); draw(); })) : null,
      taper ? frow('taperAngle', 'Angolo per lato', numInput(it, 'taperAngle', changed, { min: 0 }), unit('°')) : null,
      frow('fluteLength', taper ? 'Altezza del cono (Lc)' : 'Altezza tagliente (Lc)', numInput(it, 'fluteLength', changed, { min: 0 }), unit('mm')),
      taper ? row('Diametro in cima al cono', taperMax) : null,
      frow('length', 'Sbalzo (lunghezza utile)', numInput(it, 'length', changed, { min: 0 }), unit('mm')),
      frow('neck', 'Diametro collo', numInput(it, 'neck', changed, { min: 0 }), unit(t('mm (0=come Ø)'))),
      frow('shank', 'Diametro gambo', numInput(it, 'shank', changed, { min: 0 }), unit('mm')),
      row('Numero taglienti', numInput(it, 'flutes', changed, { min: 1, int: true })),
      row('Materiale', textInput(it, 'material', changed)),
      h('div', { class: 'p-sec' }, t('Tecnologia consigliata')),
      row('Avanzamento', numInput(it, 'feed', changed, { min: 0 }), unit('mm/min')),
      row('Affondo', numInput(it, 'plunge', changed, { min: 0 }), unit('mm/min')),
      row('Mandrino', numInput(it, 'spindle', changed, { min: 0, int: true }), unit(t('giri/min'))),
      row('Note', textInput(it, 'notes', changed))));
  };
  draw();
  box.append(fields, preview);
  drawPreview();
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
      || tools.find(x => (kind === 'finish' ? x.type === 'ball' : x.type !== 'ball' && x.type !== 'taper')) || tools[0];
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

// ------------------------------------------------------------------ esportazione e importazione degli archivi
const LIB_FILE_KIND = 'carvecam-library';
const TOOL_TYPE_IDS = TOOL_TYPES.map(x => x[0]);

function downloadLibrary(data, fileName) {
  const file = { app: 'CarveCAM', kind: LIB_FILE_KIND, version: 1, saved: new Date().toISOString(), ...structuredClone(data) };
  download(JSON.stringify(file, null, 2), fileName, 'application/json');
  log.info('Archivi esportati', { tools: data.tools?.length ?? 0, setups: data.setups?.length ?? 0, machines: data.machines?.length ?? 0 });
}

const validTool = x => x && typeof x === 'object' && TOOL_TYPE_IDS.includes(x.type) && Number(x.diameter) > 0;
const validSetup = x => x && typeof x === 'object' && (x.kind === 'pocket' || x.kind === 'finish') && x.params && typeof x.params === 'object';
const validMachine = x => x && typeof x === 'object' && typeof x.name === 'string' && Array.isArray(x.header);

/** Legge un file di archivi scelto dall'utente: { tools?, setups?, machines? } (solo elementi validi) o null. */
function readLibraryFile() {
  return new Promise(resolve => {
    const inp = h('input', { type: 'file', accept: '.json,application/json' });
    inp.addEventListener('change', async () => {
      const f = inp.files[0];
      if (!f) { resolve(null); return; }
      try {
        const j = JSON.parse(await f.text());
        // file di CarveCAM, oppure un elenco semplice di utensili o di setup
        const src = Array.isArray(j) ? (j.some(validTool) ? { tools: j } : { setups: j }) : j;
        const out = {};
        if (Array.isArray(src.tools)) out.tools = src.tools.filter(validTool);
        if (Array.isArray(src.setups)) out.setups = src.setups.filter(validSetup);
        if (Array.isArray(src.machines)) out.machines = src.machines.filter(validMachine);
        if (!out.tools?.length && !out.setups?.length && !out.machines?.length) throw new Error('vuoto');
        log.info('File di archivi letto', { file: f.name, tools: out.tools?.length ?? 0, setups: out.setups?.length ?? 0, machines: out.machines?.length ?? 0 });
        resolve(out);
      } catch (e) {
        log.warn('File di archivi non valido', e);
        toast(t('"{name}" non contiene utensili, setup o macchine di CarveCAM', { name: f.name }), 'err');
        resolve(null);
      }
    });
    inp.click();
  });
}

async function askImportMode(n, what) {
  return modal({
    title: t('Importa'),
    body: h('div', {}, h('p', { style: { marginTop: 0 } }, t('Il file contiene {n} {what}.', { n, what: KINDS[what] ? t(KINDS[what].what) : t('elementi') })),
      h('p', { class: 'p-note', style: { margin: 0 } }, t('Aggiungi: gli elementi già presenti (stesso identificativo, o stesso numero e nome per gli utensili) vengono aggiornati, gli altri aggiunti. Sostituisci: l\'archivio attuale viene sostituito da quello del file.'))),
    buttons: [{ label: t('Annulla'), value: false }, { label: t('Sostituisci'), value: 'replace' }, { label: t('Aggiungi'), value: 'merge', primary: true }],
  });
}

/** Unisce items nell'elenco list (modificato): { added, updated }. */
function mergeItems(list, items, kind, replaceAll) {
  if (replaceAll) list.splice(0, list.length);
  let added = 0, updated = 0;
  for (const src of items) {
    const it = structuredClone(src);
    const i = list.findIndex(x => (it.id && x.id === it.id)
      || (kind === 'tools' ? x.number === it.number && x.name === it.name : kind === 'machines' ? x.name === it.name : x.name === it.name && x.kind === it.kind));
    if (i >= 0) { list[i] = { ...list[i], ...it, id: list[i].id }; updated++; } else {
      if (!it.id || list.some(x => x.id === it.id)) it.id = uid(KINDS[kind].prefix);
      list.push(it);
      added++;
    }
  }
  return { added, updated };
}

/** Esporta magazzino utensili, setup e magazzino macchine in un unico file. */
export async function exportLibrary() {
  downloadLibrary({ tools: await getTools(), setups: await getSetups(), machines: await load('machines') }, 'carvecam-magazzino-e-setup.json');
}

/** Importa utensili, setup e/o macchine da un file (esportato da CarveCAM) e salva gli archivi. */
export async function importLibrary() {
  const data = await readLibraryFile();
  if (!data) return;
  const kinds = ['tools', 'setups', 'machines'].filter(k => data[k]?.length);
  const n = kinds.reduce((s, k) => s + data[k].length, 0);
  const mode = await askImportMode(n, kinds.length === 1 ? kinds[0] : 'all');
  if (!mode) return;
  const msg = [];
  const label = { tools: 'Utensili', setups: 'Setup', machines: 'Macchine' };
  try {
    for (const kind of kinds) {
      const list = structuredClone(await load(kind));
      const r = mergeItems(list, data[kind], kind, mode === 'replace');
      await save(kind, list);
      msg.push(t('{what}: {a} aggiunti, {u} aggiornati', { what: t(label[kind]), a: r.added, u: r.updated }));
    }
    toast(msg.join(' · '), 'ok', 5000);
  } catch (e) { toast(t('Salvataggio dell\'archivio non riuscito: {msg}', { msg: e.message }), 'err', 6000); }
}

// ------------------------------------------------------------------ utensili del progetto
const GEOM_KEYS = ['type', 'diameter', 'cornerRadius', 'fluteLength', 'length', 'neck', 'shank', 'taperAngle', 'tipType'];
const DIFF_LABEL = {
  number: 'Numero (T)', name: 'Nome', type: 'Tipo fresa', diameter: 'Diametro', cornerRadius: 'Raggio raccordo', fluteLength: 'Altezza tagliente (Lc)',
  length: 'Sbalzo', neck: 'Diametro collo', shank: 'Diametro gambo', feed: 'Avanzamento', plunge: 'Affondo', spindle: 'Mandrino',
  taperAngle: 'Angolo per lato', tipType: 'Punta',
};

/** Geometria confrontabile di una fresa (raggio coerente con il tipo, 0 per i valori non indicati). */
function geomOf(tl) {
  const D = Number(tl.diameter) || 0;
  return {
    type: tl.type, diameter: D,
    cornerRadius: tl.type === 'ball' ? D / 2 : tl.type === 'bull' ? Number(tl.cornerRadius) || 0 : 0,
    fluteLength: Number(tl.fluteLength) || 0, length: Number(tl.length) || 0, neck: Number(tl.neck) || 0, shank: Number(tl.shank) || 0,
    // solo per la fresa conica (per le altre i campi mancano e risultano uguali nel confronto)
    ...(tl.type === 'taper' ? { taperAngle: Number(tl.taperAngle) || 0, tipType: tl.tipType === 'flat' ? 'flat' : 'ball' } : {}),
  };
}
const sameNum = (a, b) => Math.abs((Number(a) || 0) - (Number(b) || 0)) < 1e-6;
const TEXT_KEYS = ['type', 'tipType'];
const sameGeom = (a, b) => { const x = geomOf(a), y = geomOf(b); return GEOM_KEYS.every(k => (TEXT_KEYS.includes(k) ? x[k] === y[k] : sameNum(x[k], y[k]))); };

/** Utensili usati dalle lavorazioni di un progetto: record del magazzino (con l'elenco delle lavorazioni). */
function projectToolRecords(proj) {
  const stored = Array.isArray(proj.tools) ? proj.tools : [];
  const map = new Map();
  for (const op of proj.operations || []) {
    const tl = op.tool;
    if (!tl) continue;
    const key = tl.libId || `${tl.number}|${tl.name}|${JSON.stringify(geomOf(tl))}`;
    let rec = map.get(key);
    if (!rec) {
      const st = stored.find(x => (tl.libId && x.id === tl.libId) || (x.number === tl.number && sameGeom(x, tl)));
      rec = { ...(st ? structuredClone(st) : {}), ...geomOf(tl), number: tl.number, name: tl.name || st?.name || toolDesc(tl), id: tl.libId || st?.id || null, fromFile: !!st, opIds: [] };
      for (const k of ['feed', 'plunge', 'spindle']) if (!(rec[k] > 0) && op[k] > 0) rec[k] = op[k];
      map.set(key, rec);
    }
    rec.opIds.push(op.id);
  }
  return [...map.values()];
}

/** Utensili da salvare nel progetto: dati del magazzino con la geometria usata dalle lavorazioni. */
export async function usedTools(project) {
  let lib = [];
  try { lib = await getTools(); } catch { /* magazzino non disponibile: solo i dati delle lavorazioni */ }
  return projectToolRecords({ ...project, tools: [] }).map(({ opIds, fromFile, ...r }) => {
    const le = r.id && lib.find(x => x.id === r.id);
    return le ? { ...structuredClone(le), ...geomOf(r), number: r.number, name: r.name } : r;
  });
}

function toolDiffs(le, rec) {
  const out = [];
  const a = geomOf(le), b = geomOf(rec);
  for (const k of GEOM_KEYS) {
    if (k === 'cornerRadius' && a.type !== 'bull' && b.type !== 'bull') continue;
    if (TEXT_KEYS.includes(k) ? a[k] !== b[k] : !sameNum(a[k], b[k])) out.push({ k, from: a[k], to: b[k] });
  }
  if (le.number !== rec.number) out.push({ k: 'number', from: le.number, to: rec.number });
  if ((le.name || '') !== (rec.name || '')) out.push({ k: 'name', from: le.name, to: rec.name });
  // la tecnologia si confronta solo se il progetto contiene la scheda completa dell'utensile
  if (rec.fromFile) for (const k of ['feed', 'plunge', 'spindle']) if (rec[k] > 0 && !sameNum(le[k], rec[k])) out.push({ k, from: le[k], to: rec[k] });
  return out;
}

const diffVal = (k, v) => (k === 'type' ? t(TYPE_SHORT[v] || v || '–') : k === 'tipType' ? t(v === 'flat' ? 'piatta' : v ? 'sferica' : '–') : typeof v === 'number' ? fmt(v, 3) : (v ?? '–'));

/**
 * All'apertura di un progetto: confronta gli utensili usati con il magazzino. Se mancano o hanno parametri
 * diversi avvisa; l'utente può aprire aggiornando il magazzino (aggiunge o modifica gli utensili scelti),
 * aprire senza toccarlo o annullare. Ritorna false se l'apertura va annullata.
 */
export async function reconcileProjectTools(proj) {
  const recs = projectToolRecords(proj);
  if (!recs.length) return true;
  let lib;
  try { lib = structuredClone(await getTools()); } catch { return true; }
  const relink = (rec, id) => {
    for (const op of proj.operations || []) if (rec.opIds.includes(op.id) && op.tool) op.tool.libId = id;
  };
  const rows = [];
  for (const rec of recs) {
    const le = (rec.id && lib.find(x => x.id === rec.id)) || lib.find(x => x.number === rec.number && sameGeom(x, rec)) || lib.find(x => x.number === rec.number);
    const diffs = le ? toolDiffs(le, rec) : null;
    if (le && !diffs.length) { relink(rec, le.id); continue; }
    rows.push({ rec, le, diffs, on: true });
  }
  if (!rows.length) return true;
  log.warn('Utensili del progetto diversi dal magazzino', { missing: rows.filter(r => !r.le).length, different: rows.filter(r => r.le).length });
  const opsOf = rec => (proj.operations || []).filter(o => rec.opIds.includes(o.id)).map(o => o.name).join(', ');
  const tbody = h('tbody', {}, rows.map(r => {
    const c = h('input', { type: 'checkbox' });
    c.checked = true;
    c.addEventListener('change', () => { r.on = c.checked; });
    const state = r.le
      ? h('div', {}, h('b', {}, t('Diverso da T{n} del magazzino', { n: r.le.number })),
        h('ul', { class: 'tool-diff' }, r.diffs.map(d => h('li', {}, `${t(DIFF_LABEL[d.k] || d.k)}: ${diffVal(d.k, d.from)} → ${diffVal(d.k, d.to)}`))))
      : h('b', { class: 'warn-txt' }, t('Non presente nel magazzino'));
    return h('tr', {}, h('td', {}, c), h('td', { class: 'num' }, `T${r.rec.number}`),
      h('td', {}, r.rec.name, h('div', { class: 'p-note' }, toolDesc(r.rec))), h('td', {}, state), h('td', { class: 'p-note' }, opsOf(r.rec)));
  }));
  const res = await modal({
    title: t('Utensili del progetto'), size: 'wide',
    body: h('div', {},
      h('p', { style: { marginTop: 0 } }, t('Il progetto usa utensili che nel magazzino mancano o hanno parametri diversi (magazzino → progetto).')),
      h('div', { class: 'lib-list chooser' }, h('table', {},
        h('thead', {}, h('tr', {}, ['', 'T', t('Utensile del progetto'), t('Magazzino'), t('Lavorazioni')].map(x => h('th', {}, x)))), tbody)),
      h('p', { class: 'p-note' }, t('"Apri e aggiorna il magazzino" aggiunge gli utensili mancanti e modifica quelli diversi (solo le righe spuntate). Le lavorazioni del progetto usano comunque le misure salvate nel progetto.'))),
    buttons: [
      { label: t('Annulla'), value: false },
      { label: t('Apri senza aggiornare'), value: 'open' },
      { label: t('Apri e aggiorna il magazzino'), value: 'update', primary: true },
    ],
  });
  if (!res) return false;
  if (res !== 'update') return true;
  let added = 0, changed = 0;
  for (const r of rows) {
    if (!r.on) continue;
    const { opIds, fromFile, id, ...data } = r.rec;
    if (r.le) {
      Object.assign(r.le, data);
      relink(r.rec, r.le.id);
      changed++;
    } else {
      const nid = id && !lib.some(x => x.id === id) ? id : uid('tl');
      lib.push({ flutes: 2, material: '', notes: '', ...data, id: nid });
      relink(r.rec, nid);
      added++;
    }
  }
  try {
    await save('tools', lib);
    log.info('Magazzino aggiornato dal progetto', { added, changed });
    toast(t('Magazzino aggiornato: {a} utensili aggiunti, {c} modificati', { a: added, c: changed }), 'ok', 4000);
  } catch (e) { toast(t('Salvataggio dell\'archivio non riuscito: {msg}', { msg: e.message }), 'err', 6000); }
  return true;
}
