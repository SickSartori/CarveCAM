// Pannello proprietà: moduli generati da uno schema per ogni tipo di elemento selezionato.
// I parametri sono raccolti in gruppi comprimibili; clic sul nome di un parametro: spiegazione.
import { App, resolve, resolveAll, getPath, allSketches, MOVABLE } from './state.js';
import { h, modal } from './dialogs.js';
import { fmt, planeFrame } from './geom.js';
import { paramHelp, REL_PARAMS, BASE_LABEL, effParam, baseValue } from './oplib.js';
import { getTools } from './library.js';
import { t, num } from './i18n.js';

const KIND_LABEL = { box: 'Parallelepipedo', cylinder: 'Cilindro', cone: 'Tronco di cono', sphere: 'Sfera' };
const ENT_LABEL = { polyline: 'Polilinea', rect: 'Rettangolo', circle: 'Cerchio', polygon: 'Poligono regolare' };
const COLLAPSE_KEY = 'carvecam.props.collapsed';
/** Comandi del modello fermi durante la creazione di un piano o il disegno di uno sketch. */
const modelBusy = () => !!App.sketch || !!App.planeMode;

/** Valuta un numero, ammettendo virgola decimale e semplici espressioni (es. 10/2+3). */
export function evalNum(str) {
  const s = String(str).trim().replace(/,/g, '.');
  if (s === '') return NaN;
  if (!/^[-+*/().\d\s eE]+$/.test(s)) return NaN;
  try {
    // eslint-disable-next-line no-new-func
    const v = Function(`"use strict"; return (${s});`)();
    return typeof v === 'number' && Number.isFinite(v) ? v : NaN;
  } catch { return NaN; }
}

function parsePoints(text) {
  const pts = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    let parts;
    if (line.includes(';')) parts = line.split(';');
    else if (/\s/.test(line)) parts = line.split(/\s+/);
    else parts = line.split(',');
    if (parts.length < 2) return null;
    const x = evalNum(parts[0]), y = evalNum(parts[1]);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    pts.push([x, y]);
  }
  return pts;
}

/**
 * Freccette su/giù accanto a un campo numerico: un clic cambia il valore di step (Maiusc ×10, Alt ×0,1),
 * tenendo premuto si ripete; con il campo attivo funziona anche la rotella del mouse.
 */
function withSpin(inp, step, apply) {
  const bump = (dir, e) => {
    if (inp.disabled) return;
    const k = e?.shiftKey ? 10 : e?.altKey ? 0.1 : 1;
    const cur = evalNum(inp.value) || 0;
    inp.value = fmt(Math.round((cur + dir * step * k) * 1e6) / 1e6, 4);
    apply();
  };
  const mk = (dir, label) => {
    const b = h('button', { type: 'button', class: 'spin-btn', tabindex: '-1', disabled: inp.disabled, 'aria-label': dir > 0 ? t('Aumenta') : t('Diminuisci') }, label);
    let timer = null;
    const stop = () => { clearTimeout(timer); timer = null; };
    b.addEventListener('pointerdown', e => {
      e.preventDefault();
      b.setPointerCapture(e.pointerId);
      const mods = { shiftKey: e.shiftKey, altKey: e.altKey };
      bump(dir, mods);
      const again = delay => { timer = setTimeout(() => { bump(dir, mods); again(70); }, delay); };
      again(420);
    });
    for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture']) b.addEventListener(ev, stop);
    return b;
  };
  inp.addEventListener('wheel', e => {
    if (document.activeElement !== inp) return;
    e.preventDefault();
    bump(e.deltaY < 0 ? 1 : -1, e);
  }, { passive: false });
  return h('span', { class: 'spin' }, inp, h('span', { class: 'spin-btns' }, mk(1, '▴'), mk(-1, '▾')));
}

export class Props {
  constructor(el, cmd) {
    this.el = el;
    this.cmd = cmd;
    this.sig = null;
    this.bindings = [];
    this.blocks = [];
    try { this.collapsed = new Set(JSON.parse(localStorage.getItem(COLLAPSE_KEY) || '[]')); } catch { this.collapsed = new Set(); }
  }

  _sigOf(r) {
    if (App.selected.length > 1) return `multi|${App.selected.map(s => `${s.type}:${s.id}`).join(',')}`;
    if (!r) return 'none';
    const it = r.item;
    const rel = it.rel ? Object.keys(REL_PARAMS).map(k => (it.rel[k]?.on ? 1 : 0)).join('') : '';
    return [r.type, it.id, it.kind, it.strategy, it.tool && it.tool.type, it.entry, !!it.locked, rel, it.entityIds?.length || 0, App.sketch?.sketchId || '', !!App.planeMode].join('|');
  }

  /** Aggiorna i valori se la struttura del modulo è invariata, altrimenti ricostruisce. */
  refresh() {
    const r = resolve();
    if (this._sigOf(r) !== this.sig) return this.render();
    if (App.selected.length > 1) { for (const b of this.blocks) b.update(r); return; }
    for (const b of this.bindings) b.update(r.item);
    for (const b of this.blocks) b.update(r);
  }

  render() {
    const r = resolve();
    this.cmd.hoverItem?.(null);   // l'elenco che evidenziava un elemento viene ricostruito
    this.sig = this._sigOf(r);
    this.bindings = [];
    this.blocks = [];
    this.el.innerHTML = '';
    this.body = this.el;
    const title = document.getElementById('props-title');
    if (App.selected.length > 1) { title.textContent = t('Selezione multipla'); this._multi(); return; }
    if (!r) {
      title.textContent = t('Proprietà');
      this.el.append(h('div', { class: 'props-empty', html: t(
        '<b>Nessuna selezione.</b><br>1. <b>File › Importa modello 3D</b> o <b>Inserisci</b> un artefatto.<br>' +
        '2. <b>Aggiungi piano</b> per definire l\'asse utensile (normale).<br>' +
        '3. Seleziona il piano, <b>Nuovo sketch</b> e disegna l\'area di contenimento.<br>' +
        '4. Seleziona lo sketch (o alcune entità), <b>Svuotatura / Finitura</b>: scegli utensile e setup, poi <b>Ricalcola tutto</b>.<br><br>' +
        'Ctrl+clic per selezionare più elementi. Clic sul nome di un parametro per la sua spiegazione.<br><br>' +
        'Per una prova rapida: <b>Aiuto › Progetto di esempio</b>.') }));
      return;
    }
    title.textContent = t({
      object: 'Proprietà oggetto', artifact: 'Proprietà artefatto', plane: 'Proprietà piano', sketch: 'Proprietà sketch',
      entity: 'Proprietà entità', operation: 'Proprietà lavorazione', origin: 'Proprietà origine',
    }[r.type]);
    const fields = this[`_schema_${r.type}`](r);
    for (const f of fields) this._field(f, r);
  }

  // ---------------------------------------------------------------- selezione multipla
  _multi() {
    const all = resolveAll();
    const byType = {};
    for (const x of all) byType[x.type] = (byType[x.type] || 0) + 1;
    const names = { object: 'oggetti', artifact: 'artefatti', plane: 'piani', sketch: 'sketch', entity: 'entità', operation: 'lavorazioni', origin: 'origini' };
    this._sec({ sec: t('Selezione multipla'), tone: 'model', id: 'multi' });
    this._infoRow(t('Elementi'), String(all.length));
    for (const [k, n] of Object.entries(byType)) this._infoRow(t(names[k]), String(n));
    const mov = all.filter(x => MOVABLE.includes(x.type));
    if (mov.length) {
      const nLocked = mov.filter(x => x.item.locked).length;
      this._infoRow(t('Bloccati'), `${nLocked} / ${mov.length}`);
      if (nLocked) this.body.append(h('div', { class: 'p-warn' }, t('La selezione contiene elementi bloccati: il manipolatore non sposta nessun elemento.')));
    }
    const btns = [];
    if (mov.length) btns.push({ label: mov.every(x => x.item.locked) ? t('Sblocca tutti') : t('Blocca tutti'), action: () => this.cmd.toggleLock() });
    if (all.every(x => x.type === 'entity') && new Set(all.map(x => x.sketch.id)).size === 1) {
      const off = !!App.sketch;
      btns.push({ label: t('Nuova svuotatura'), primary: true, disabled: off, action: () => this.cmd.newOperation('pocket') }, { label: t('Nuova finitura'), disabled: off, action: () => this.cmd.newOperation('finish') });
    }
    btns.push({ label: t('Duplica'), action: () => this.cmd.duplicateSelected() }, { label: t('Elimina'), danger: true, action: () => this.cmd.deleteSelected() });
    this._field({ type: 'buttons', items: btns });
    this.body.append(h('div', { class: 'p-note' }, t('Ctrl+clic nel navigatore o nella vista aggiunge o toglie elementi. Il manipolatore sposta insieme oggetti, artefatti e piani selezionati.')));
  }

  _infoRow(label, value) {
    this.body.append(h('div', { class: 'p-row' }, h('label', {}, label), h('div', { class: 'p-field' }, h('div', { class: 'p-info' }, value))));
  }

  // ---------------------------------------------------------------- schemi
  _lockFields(type, it) {
    const locked = !!it.locked;
    return [
      { key: 'locked', label: 'Bloccato', type: 'check' },
      locked ? { note: t('Elemento bloccato: posizione e orientamento non si possono modificare. Lo spostamento dell\'origine lo trasla comunque.'), cls: 'p-lock' } : null,
    ].filter(Boolean);
  }

  _schema_object(r) {
    const o = r.item;
    const locked = !!o.locked;
    return [
      { sec: 'Oggetto', tone: 'model' },
      { key: 'name', label: 'Nome', type: 'text' },
      { label: 'Triangoli', type: 'info', value: it => num(it.triangles || 0) },
      { label: 'Dimensioni', type: 'info', value: it => it.size ? it.size.map((v, i) => fmt(v * (it.scale[i] || 1), 2)).join(' × ') + ' mm' : '–' },
      ...this._lockFields('object', o),
      { sec: 'Posizionamento', tone: 'model' },
      { key: 'position', label: 'Posizione', type: 'vec3', unit: 'mm', disabled: locked },
      { key: 'rotation', label: 'Rotazione', type: 'vec3', unit: '°', disabled: locked },
      { key: 'scale', label: 'Scala', type: 'vec3', disabled: locked },
      { type: 'buttons', items: [
        { label: 'Riposiziona…', primary: true, disabled: locked || modelBusy(), title: 'Appoggia su Z=0, centra o allinea minimo e massimo per ogni asse', action: () => this.cmd.reposition({ type: 'object', id: o.id }) },
      ] },
      { sec: 'Visualizzazione', tone: 'model' },
      { key: 'color', label: 'Colore', type: 'color' },
      { key: 'visible', label: 'Visibile', type: 'check' },
      { block: () => this._usedBy(o.id) },
    ];
  }

  _schema_artifact(r) {
    const a = r.item;
    const locked = !!a.locked;
    const dims = {
      // misure con freccette su/giù (passo 1 mm, Maiusc ×10, Alt ×0,1)
      box: [{ key: 'size', label: 'Dimensioni X/Y/Z', type: 'vec3', unit: 'mm', min: 0.001, spin: 1 }],
      cylinder: [{ key: 'radius', label: 'Raggio', type: 'num', unit: 'mm', min: 0.001, spin: 1 }, { key: 'height', label: 'Altezza', type: 'num', unit: 'mm', min: 0.001, spin: 1 }],
      cone: [
        { key: 'radius', label: 'Raggio inferiore', type: 'num', unit: 'mm', min: 0, spin: 1 },
        { key: 'radius2', label: 'Raggio superiore', type: 'num', unit: 'mm', min: 0, spin: 1 },
        { key: 'height', label: 'Altezza', type: 'num', unit: 'mm', min: 0.001, spin: 1 },
      ],
      sphere: [{ key: 'radius', label: 'Raggio', type: 'num', unit: 'mm', min: 0.001, spin: 1 }],
    }[a.kind] || [];
    return [
      { sec: KIND_LABEL[a.kind] || 'Artefatto', tone: 'model' },
      { key: 'name', label: 'Nome', type: 'text' },
      { key: 'kind', label: 'Tipo', type: 'select', options: Object.entries(KIND_LABEL) },
      ...dims,
      { note: a.kind === 'box' || a.kind === 'sphere' ? 'Centrato nella propria posizione.' : 'Asse lungo Z locale, centrato nella propria posizione (raggio inferiore verso -Z).' },
      ...this._lockFields('artifact', a),
      { sec: 'Posizionamento', tone: 'model' },
      { key: 'position', label: 'Posizione', type: 'vec3', unit: 'mm', disabled: locked },
      { key: 'rotation', label: 'Rotazione', type: 'vec3', unit: '°', disabled: locked },
      { type: 'buttons', items: [
        { label: 'Riposiziona…', primary: true, disabled: locked || modelBusy(), title: 'Appoggia su Z=0, centra o allinea minimo e massimo per ogni asse', action: () => this.cmd.reposition({ type: 'artifact', id: a.id }) },
        { label: 'Duplica', action: () => this.cmd.duplicateSelected() },
      ] },
      { sec: 'Visualizzazione', tone: 'model' },
      { key: 'color', label: 'Colore', type: 'color' },
      { key: 'visible', label: 'Visibile', type: 'check' },
      { block: () => this._usedBy(a.id) },
    ];
  }

  /** Lavorazioni che considerano l'elemento come ostacolo. */
  _usedBy(id) {
    const ops = App.project.operations;
    if (!ops.length) return h('div');
    const used = ops.filter(op => (op.obstacles || []).includes(id));
    return h('div', { class: 'p-note' }, used.length
      ? t('Ostacolo per: {list}', { list: used.map(o => o.name).join(', ') })
      : t('Non è un ostacolo per nessuna lavorazione (abilitalo nelle proprietà della lavorazione, gruppo Ostacoli).'));
  }

  _schema_origin(r) {
    const o = r.item;
    const locked = !!o.locked;
    return [
      { sec: 'Punto di origine', tone: 'model' },
      { key: 'name', label: 'Nome', type: 'text' },
      { key: 'position', label: 'Posizione', type: 'vec3', unit: 'mm', disabled: locked },
      { key: 'visible', label: 'Visibile', type: 'check' },
      ...this._lockFields('origin', o),
      { type: 'buttons', items: [
        { label: 'Sposta il punto…', disabled: locked, title: 'Clic nella vista sul nuovo punto (si aggancia ai vertici)', action: () => this.cmd.relocateOrigin(o.id) },
        { label: 'Esporta G-code con questo zero…', primary: true, action: () => this.cmd.exportGcode(null, o.id) },
      ] },
      { note: 'Nell\'esportazione del G-code si sceglie quale punto usare come zero pezzo: le coordinate del programma sono relative a quel punto.' },
    ];
  }

  _schema_plane(r) {
    const pl = r.item;
    const locked = !!pl.locked;
    return [
      { sec: 'Piano di lavoro', tone: 'plane' },
      { key: 'name', label: 'Nome', type: 'text' },
      { key: 'origin', label: 'Origine', type: 'vec3', unit: 'mm', disabled: locked },
      { key: 'normal', label: 'Normale (asse ut.)', type: 'vec3', normalize: true, disabled: locked },
      { key: 'angle', label: 'Rotazione asse U', type: 'num', unit: '°', help: 'plane.angle', disabled: locked },
      { key: 'size', label: 'Dimensione vista', type: 'num', unit: 'mm', min: 1 },
      { label: 'Asse U / V', type: 'info', value: it => { const f = planeFrame(it); return `${vs(f.u)}  /  ${vs(f.v)}`; } },
      { key: 'visible', label: 'Visibile', type: 'check' },
      ...this._lockFields('plane', pl),
      { type: 'buttons', items: [
        { label: 'Nuovo sketch', primary: true, action: () => this.cmd.newSketch(pl.id) },
        { label: 'Inverti normale', disabled: locked, action: () => this.cmd.flipNormal(pl.id) },
        { label: 'Vista normale', action: () => this.cmd.viewNormal(pl.id) },
      ] },
      { note: 'La normale indica l\'orientamento dell\'utensile: la fresa lavora dal lato delle frecce blu verso il piano e oltre.' },
    ];
  }

  _schema_sketch(r) {
    const s = r.item;
    return [
      { sec: 'Sketch', tone: 'sketch' },
      { key: 'name', label: 'Nome', type: 'text' },
      { label: 'Piano', type: 'info', value: () => r.plane.name },
      { label: 'Entità', type: 'info', value: it => String(it.entities.length) },
      { key: 'visible', label: 'Visibile', type: 'check' },
      { type: 'buttons', items: [
        { label: App.sketch && App.sketch.sketchId === s.id ? 'Termina modifica' : 'Modifica sketch', primary: true,
          action: () => (App.sketch && App.sketch.sketchId === s.id ? this.cmd.finishSketch() : this.cmd.editSketch(s.id)) },
        { label: 'Nuova svuotatura', disabled: !!App.sketch, action: () => this.cmd.newOperation('pocket', s.id) },
        { label: 'Nuova finitura', disabled: !!App.sketch, action: () => this.cmd.newOperation('finish', s.id) },
      ] },
      { note: 'Le entità chiuse definiscono l\'area di contenimento della lavorazione. Un contorno contenuto in un altro diventa un\'isola esclusa. Per lavorare solo alcune entità selezionale con Ctrl+clic e crea la lavorazione.' },
    ];
  }

  _schema_entity(r) {
    const e = r.item;
    const f = [{ sec: ENT_LABEL[e.kind] || 'Entità', tone: 'sketch' }, { key: 'name', label: 'Nome', type: 'text', placeholder: t(ENT_LABEL[e.kind]) }];
    if (e.kind === 'rect') {
      // il primo punto (quello cliccato per primo) è il riferimento: spostandolo si sposta il rettangolo,
      // cambiando i lati resta fermo e il rettangolo cresce verso l'angolo opposto
      const move = (ax, v) => it => { const d = v - it[`${ax}1`]; it[`${ax}1`] = v; it[`${ax}2`] += d; };
      const side = ax => (it, v) => { it[`${ax}2`] = it[`${ax}1`] + (it[`${ax}2`] < it[`${ax}1`] ? -v : v); };
      f.push({ id: 'x1', label: 'Primo punto · X', type: 'num', unit: 'mm', get: it => it.x1, set: (it, v) => move('x', v)(it) },
        { id: 'y1', label: 'Primo punto · Y', type: 'num', unit: 'mm', get: it => it.y1, set: (it, v) => move('y', v)(it) },
        { id: 'sx', label: 'Lato X (U)', type: 'num', unit: 'mm', min: 0.001, spin: 1, get: it => Math.abs(it.x2 - it.x1), set: side('x') },
        { id: 'sy', label: 'Lato Y (V)', type: 'num', unit: 'mm', min: 0.001, spin: 1, get: it => Math.abs(it.y2 - it.y1), set: side('y') },
        { key: 'x2', label: 'Angolo opposto · X', type: 'num', unit: 'mm' }, { key: 'y2', label: 'Angolo opposto · Y', type: 'num', unit: 'mm' },
        { note: 'Il primo punto è il riferimento: spostandolo si sposta tutto il rettangolo, cambiando i lati resta fermo.' });
    } else if (e.kind === 'circle') {
      f.push({ key: 'cx', label: 'Centro X', type: 'num', unit: 'mm' }, { key: 'cy', label: 'Centro Y', type: 'num', unit: 'mm' },
        { key: 'r', label: 'Raggio', type: 'num', unit: 'mm', min: 0.001 },
        { label: 'Diametro', type: 'info', value: it => `${fmt(it.r * 2)} mm` });
    } else if (e.kind === 'polygon') {
      f.push({ key: 'cx', label: 'Centro X', type: 'num', unit: 'mm' }, { key: 'cy', label: 'Centro Y', type: 'num', unit: 'mm' },
        { key: 'r', label: 'Raggio circoscritto', type: 'num', unit: 'mm', min: 0.001 },
        { key: 'sides', label: 'Lati', type: 'num', min: 3, max: 256, int: true },
        // lato = 2 r sin(π/n): cambiandolo cambia il raggio, centro e rotazione restano
        { id: 'side', label: 'Lunghezza lato', type: 'num', unit: 'mm', min: 0.001, spin: 1,
          get: it => 2 * it.r * Math.sin(Math.PI / Math.max(3, it.sides | 0)),
          set: (it, v) => { it.r = v / (2 * Math.sin(Math.PI / Math.max(3, it.sides | 0))); } },
        { key: 'rot', label: 'Rotazione', type: 'num', unit: '°' });
    } else if (e.kind === 'polyline') {
      f.push({ key: 'pts', label: 'Vertici (x y)', type: 'points' },
        { note: 'Un vertice per riga: "x y" oppure "x; y". Il contorno è sempre chiuso.' });
    }
    f.push({ note: 'Coordinate nel sistema del piano (U,V).' },
      { type: 'buttons', items: [
        { label: 'Nuova svuotatura', disabled: !!App.sketch, action: () => this.cmd.newOperation('pocket') },
        { label: 'Elimina entità', danger: true, action: () => this.cmd.deleteSelected() },
      ] });
    return f;
  }

  _schema_operation(r) {
    const op = r.item;
    const pocket = op.kind !== 'finish';
    const sketches = allSketches().map(({ plane, sketch }) => [sketch.id, `${plane.name} › ${sketch.name}`]);
    const subset = Array.isArray(op.entityIds) && op.entityIds.length > 0;
    const f = [
      { sec: pocket ? 'Svuotatura a terrazze' : 'Finitura in proiezione', tone: 'op', id: 'op' },
      { key: 'name', label: 'Nome', type: 'text' },
      { key: 'sketchId', label: 'Contorno (sketch)', type: 'select', options: sketches.length ? sketches : [['', t('— nessuno sketch —')]], raw: true },
      { label: 'Entità', type: 'info', help: 'entityIds', value: it => (Array.isArray(it.entityIds) && it.entityIds.length ? t('{n} entità selezionate', { n: it.entityIds.length }) : t('tutto lo sketch')) },
      subset ? { type: 'buttons', items: [{ label: 'Usa tutto lo sketch', action: () => this.cmd.useWholeSketch(op.id) }] } : null,
      op.setupName ? { label: 'Setup di partenza', type: 'info', value: it => it.setupName || '–' } : null,
      { sec: 'Strategia', tone: 'op', id: 'strategy' },
      { key: 'strategy', label: 'Strategia', type: 'select', options: [['concentric', 'Concentrica (offset)'], ['zigzag', 'Rettangolare (zigzag)']] },
      op.strategy === 'zigzag' ? { key: 'angle', label: 'Angolo passate', type: 'num', unit: '°' } : null,
      { key: 'climb', label: 'Concorde (climb)', type: 'check' },
      { key: 'toolInside', label: 'Utensile dentro contorno', type: 'check' },
      pocket && op.strategy === 'zigzag' ? { key: 'contourPass', label: 'Passata di contorno', type: 'check' } : null,
      { sec: 'Utensile', tone: 'tool', id: 'tool' },
      { key: 'toolId', label: 'Dal magazzino', type: 'toolLib' },
      { key: 'tool.type', label: 'Tipo fresa', type: 'select', options: [['flat', 'Cilindrica (piatta)'], ['bull', 'Torica (raccordata)'], ['ball', 'Sferica'], ['taper', 'Conica']] },
      op.tool?.type === 'taper' ? { key: 'tool.diameter', label: 'Diametro in punta', type: 'num', unit: t('mm (0 = a V)'), min: 0 } : { key: 'tool.diameter', label: 'Diametro', type: 'num', unit: 'mm', min: 0.01 },
      op.tool && op.tool.type === 'bull' ? { key: 'tool.cornerRadius', label: 'Raggio raccordo', type: 'num', unit: 'mm', min: 0.01, max: (op.tool.diameter || 6) / 2 } : null,
      op.tool && op.tool.type === 'taper' ? { key: 'tool.tipType', label: 'Punta', type: 'select', options: [['ball', 'Sferica'], ['flat', 'Piatta (a V con Ø punta 0)']] } : null,
      op.tool && op.tool.type === 'taper' ? { key: 'tool.taperAngle', label: 'Angolo per lato', type: 'num', unit: '°', min: 0.1, max: 80 } : null,
      { key: 'tool.fluteLength', label: op.tool?.type === 'taper' ? 'Altezza del cono' : 'Altezza tagliente', help: 'tool.fluteLength', type: 'num', unit: 'mm', min: 0.1 },
      { key: 'tool.length', label: 'Sbalzo', type: 'num', unit: t('mm (0=Lc)'), min: 0 },
      { key: 'tool.neck', label: 'Diametro collo', type: 'num', unit: t('mm (0=come Ø)'), min: 0 },
      { key: 'tool.shank', label: 'Diametro gambo', type: 'num', unit: 'mm', min: 0 },
      { key: 'tool.number', label: 'Numero (T)', type: 'num', min: 1, max: 999, int: true },
      { sec: 'Passi e profondità', tone: 'op', id: 'steps' },
      { key: 'stepover', label: 'Passo laterale', type: 'rel' },
      pocket ? { key: 'stepdown', label: 'Passo verticale', type: 'rel' } : null,
      { key: 'maxDepth', label: 'Profondità max', type: 'num', unit: 'mm', min: 0.001 },
      { key: 'stock', label: 'Sovrametallo', type: 'num', unit: 'mm', min: 0 },
      { sec: 'Quote e precisione', tone: 'op', id: 'heights' },
      { key: 'safeHeight', label: 'Quota sicurezza', type: 'num', unit: 'mm', min: 0.1 },
      { key: 'clearance', label: 'Avvicinamento', type: 'num', unit: 'mm', min: 0 },
      { key: 'resolution', label: pocket ? 'Risoluzione griglia' : 'Passo campionam.', type: 'num', unit: t('mm (0=auto)'), min: 0 },
      { key: 'tolerance', label: 'Tolleranza', type: 'num', unit: 'mm', min: 0.0005 },
    ];
    const entry = op.entry || 'plunge';
    if (pocket) {
      f.push(
        { sec: 'Ingresso nel materiale', tone: 'op', id: 'entry' },
        { key: 'entry', label: 'Tipo ingresso', type: 'select', options: [['plunge', 'Affondo verticale'], ['ramp', 'Rampa lungo il percorso'], ['helix', 'Elica']] },
      );
      if (entry !== 'plunge') f.push({ key: 'rampAngle', label: 'Angolo discesa', type: 'num', unit: '°', min: 0.5, max: 45 });
      if (entry === 'helix') f.push({ key: 'helixRadius', label: 'Raggio elica', type: 'rel' });
      if (entry !== 'plunge') {
        f.push({ key: 'rampFeed', label: 'Avanz. rampa', type: 'num', unit: t('mm/min (0=lavoro)'), min: 0 },
          { note: entry === 'helix'
            ? 'Elica che parte e termina sul punto d\'ingresso, contenuta nella zona lavorabile; se non c\'è spazio si usa la rampa, poi l\'affondo.'
            : 'Discesa avanti e indietro lungo il primo tratto del percorso (o attorno al contorno se è corto); se non c\'è spazio si usa l\'affondo.' });
      }
    }
    f.push(
      { sec: 'Tecnologia', tone: 'op', id: 'tech' },
      { key: 'feed', label: 'Avanzamento', type: 'num', unit: 'mm/min', min: 1 },
      { key: 'plunge', label: 'Affondo', type: 'num', unit: 'mm/min', min: 1 },
      { key: 'spindle', label: 'Mandrino', type: 'num', unit: t('giri/min'), min: 0, int: true },
      { sec: 'Ostacoli', tone: 'model', id: 'obstacles' },
      { block: rr => this._obstaclesBlock(rr.item) },
      { sec: 'Calcolo e risultato', tone: 'calc', id: 'result' },
      { key: 'visible', label: 'Mostra percorso', type: 'check' },
      { type: 'buttons', items: [
        { label: 'Calcola (F9)', primary: true, disabled: !!App.sketch, action: () => this.cmd.compute(op.id) },
        { label: 'Simula', disabled: !!App.sketch, action: () => this.cmd.simulate(op.id) },
        { label: 'G-code…', action: () => this.cmd.exportGcode([op.id]) },
        { label: 'Salva come setup…', action: () => this.cmd.saveAsSetup(op.id) },
      ] },
      { block: rr => this._statsBlock(rr.item) },
      { note: pocket
        ? 'Parte dal piano di lavoro e scende a terrazze (passo verticale) fino a ridosso degli ostacoli, entro il contorno.'
        : 'Proietta il percorso lungo la normale del piano direttamente sulle superfici degli ostacoli, senza passate intermedie.' },
    );
    return f.filter(Boolean);
  }

  _obstaclesBlock(op) {
    const items = [...App.project.objects.map(o => ({ type: 'object', it: o })), ...App.project.artifacts.map(a => ({ type: 'artifact', it: a }))];
    const box = h('div', { class: 'p-obst' });
    if (!items.length) { box.append(h('div', { class: 'p-note' }, t('Nessun oggetto o artefatto nel progetto.'))); return box; }
    const set = new Set(op.obstacles || []);
    for (const { type, it } of items) {
      const c = h('input', { type: 'checkbox' });
      c.checked = set.has(it.id);
      c.addEventListener('change', () => this.cmd.setObstacle(op.id, it.id, c.checked));
      // passando con il mouse sul nome, l'ostacolo si evidenzia nella vista
      const row = h('label', { class: `p-obst-row${c.checked ? '' : ' off'}`, title: t('Evidenziato nella vista') }, c,
        h('span', { class: 'ico', html: '' }), h('span', { class: 'lbl' }, it.name),
        h('span', { class: 'sub' }, type === 'object' ? t('oggetto') : t(KIND_LABEL[it.kind] || 'artefatto')));
      row.addEventListener('mouseenter', () => this.cmd.hoverItem({ type, id: it.id }));
      row.addEventListener('mouseleave', () => this.cmd.hoverItem(null));
      box.append(row);
    }
    const n = items.filter(x => set.has(x.it.id)).length;
    box.append(h('div', { class: 'p-obst-foot' },
      h('span', { class: 'p-note', style: { margin: 0 } }, t('{n} di {m} considerati', { n, m: items.length })),
      h('span', { class: 'grow' }),
      h('button', { class: 'btn sm', type: 'button', onclick: () => this.cmd.setAllObstacles(op.id, true) }, t('Tutti')),
      h('button', { class: 'btn sm', type: 'button', onclick: () => this.cmd.setAllObstacles(op.id, false) }, t('Nessuno'))));
    return box;
  }

  _statsBlock(op) {
    const d = App.runtime.toolpaths.get(op.id);
    const box = h('div', {});
    if (!d) {
      box.append(h('div', { class: 'p-note' }, t('Percorso non ancora calcolato.')));
      return box;
    }
    const st = this.cmd.opStatus(op);
    const s = d.stats || {};
    if (st === 'stale') box.append(h('div', { class: 'p-warn' }, t('Parametri modificati: ricalcolare il percorso.')));
    const rows = [
      ['Punti', num(s.pointCount || 0)],
      ['Lavoro', `${fmt((s.feedLength || 0) / 1000, 2)} m`],
      ['Rapidi', `${fmt((s.rapidLength || 0) / 1000, 2)} m`],
      ...(op.kind !== 'finish' ? [['Ingressi', t('{h} elica · {r} rampa · {p} affondo', { h: s.helixEntries || 0, r: s.rampEntries || 0, p: s.plungeEntries || 0 })]] : []),
      ['Tempo stimato', fmtMin(s.estimatedMinutes)],
      [op.kind === 'finish' ? 'Passate' : 'Terrazze', String(s.levels ?? '–')],
      ['Triangoli ostacoli', num(s.triangles || 0)],
      ['Quota sicurezza', `${fmt(s.safeW, 2)} mm`],
      ['Verifica collisioni', s.maxGouge > 0.001 ? t('interferenza {v} mm', { v: fmt(s.maxGouge, 3) }) : t('ok ({n} campioni)', { n: num(s.gougeSamples || 0) })],
      ['Calcolo', `${s.computeMs ?? '–'} ms`],
    ];
    for (const [k, v] of rows) box.append(h('div', { class: 'p-row' }, h('label', {}, t(k)), h('div', { class: 'p-info' }, v)));
    for (const w of d.warnings || []) box.append(h('div', { class: 'p-warn' }, w));
    return box;
  }

  // ---------------------------------------------------------------- costruzione campi
  /** Intestazione di gruppo comprimibile: i campi successivi finiscono nel suo corpo. */
  _sec(f) {
    const r = resolve();
    const id = `${r?.type || 'multi'}:${f.id || f.sec}`;
    const closed = this.collapsed.has(id);
    const head = h('div', { class: `p-group-h tone-${f.tone || 'none'}${closed ? ' closed' : ''}`, role: 'button', tabindex: '0', 'aria-expanded': String(!closed) },
      h('span', { class: 'tw' }, closed ? '▸' : '▾'), h('span', {}, t(f.sec)));
    const body = h('div', { class: 'p-group-b', hidden: closed });
    const toggle = () => {
      const c = !this.collapsed.has(id);
      if (c) this.collapsed.add(id); else this.collapsed.delete(id);
      try { localStorage.setItem(COLLAPSE_KEY, JSON.stringify([...this.collapsed])); } catch { /* storage non disponibile */ }
      body.hidden = c;
      head.classList.toggle('closed', c);
      head.setAttribute('aria-expanded', String(!c));
      head.firstChild.textContent = c ? '▸' : '▾';
    };
    head.addEventListener('click', toggle);
    head.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } });
    this.el.append(h('div', { class: `p-group tone-${f.tone || 'none'}` }, head, body));
    this.body = body;
  }

  /** Etichetta del parametro: con spiegazione al clic se disponibile. */
  _label(f) {
    const text = t(f.label);
    const help = paramHelp(f.help || f.key);
    const lbl = h('label', { title: help ? t('{label} — clic per la spiegazione', { label: text }) : text, class: help ? 'has-help' : '' }, text);
    if (help) {
      lbl.addEventListener('click', e => {
        e.preventDefault();
        modal({ title: help.title, body: h('div', { class: 'help-text' }, help.text), buttons: [{ label: t('Chiudi'), value: true, primary: true }] });
      });
    }
    return lbl;
  }

  _field(f, r) {
    if (!f) return;
    if (f.sec) { this._sec(f); return; }
    const el = this.body;
    if (f.note) { el.append(h('div', { class: `p-note${f.cls ? ` ${f.cls}` : ''}` }, t(f.note))); return; }
    if (f.block) {
      const holder = h('div', {});
      holder.append(f.block(r));
      el.append(holder);
      this.blocks.push({ update: rr => { holder.innerHTML = ''; holder.append(f.block(rr)); } });
      return;
    }
    if (f.type === 'buttons') {
      el.append(h('div', { class: 'p-buttons' }, f.items.map(b =>
        h('button', { class: `btn${b.primary ? ' primary' : ''}${b.danger ? ' danger' : ''}`, type: 'button', disabled: !!b.disabled, title: b.title ? t(b.title) : null, onclick: b.action }, t(b.label)))));
      return;
    }
    if (f.type === 'rel') { this._relField(f, r); return; }
    const field = h('div', { class: 'p-field' });
    el.append(h('div', { class: `p-row${f.disabled ? ' disabled' : ''}` }, this._label(f), field));
    const sel = { ...App.selection };
    // campi calcolati (get/set): il valore si ricava dall'elemento e la modifica la applica set
    const commit = f.set ? v => this.cmd.editItem(sel, it => f.set(it, v)) : v => this.cmd.setProp(sel, f.key, v);
    const getV = f.get || (it => getPath(it, f.key));

    switch (f.type) {
      case 'info': {
        const d = h('div', { class: 'p-info' });
        field.append(d);
        const upd = it => { d.textContent = f.value(it); d.title = d.textContent; };
        upd(r.item);
        this.bindings.push({ update: upd });
        break;
      }
      case 'text': {
        const inp = h('input', { 'data-key': f.key, placeholder: f.placeholder || '' });
        inp.addEventListener('change', () => commit(inp.value.trim()));
        inp.addEventListener('keydown', e => { if (e.key === 'Enter') inp.blur(); });
        field.append(inp);
        this._bind(inp, it => getPath(it, f.key) ?? '');
        break;
      }
      case 'num': {
        const inp = h('input', { 'data-key': f.key || f.id, inputmode: 'decimal', disabled: !!f.disabled });
        const apply = () => {
          let v = evalNum(inp.value);
          if (!Number.isFinite(v)) { inp.classList.add('bad'); return; }
          inp.classList.remove('bad');
          if (f.int) v = Math.round(v);
          if (f.min != null) v = Math.max(f.min, v);
          if (f.max != null) v = Math.min(f.max, v);
          inp.value = fmt(v, 4);
          commit(v);
        };
        inp.addEventListener('change', apply);
        inp.addEventListener('keydown', e => {
          if (e.key === 'Enter') { apply(); inp.select(); }
          if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
            e.preventDefault();
            const cur = evalNum(inp.value) || 0;
            const step = e.shiftKey ? 10 : e.altKey ? 0.1 : 1;
            inp.value = fmt(cur + (e.key === 'ArrowUp' ? step : -step), 4);
            apply();
          }
        });
        field.append(f.spin ? withSpin(inp, f.spin, apply) : inp);
        if (f.unit) field.append(h('span', { class: 'unit' }, f.unit));
        this._bind(inp, it => fmt(getV(it), 4));
        break;
      }
      case 'vec3': {
        const wrap = h('div', { class: 'p-vec' });
        const inputs = ['X', 'Y', 'Z'].map((ax, i) => {
          const inp = h('input', { 'data-key': `${f.key}.${i}`, inputmode: 'decimal', disabled: !!f.disabled });
          inp.addEventListener('change', () => {
            const vals = inputs.map(x => evalNum(x.value));
            if (vals.some(v => !Number.isFinite(v))) { inp.classList.add('bad'); return; }
            inp.classList.remove('bad');
            let v = vals;
            if (f.min != null) v = v.map(x => Math.max(f.min, x));
            if (f.normalize) {
              const l = Math.hypot(...v);
              if (l < 1e-9) { inp.classList.add('bad'); return; }
              v = v.map(x => x / l);
            }
            commit(v);
          });
          inp.addEventListener('keydown', e => { if (e.key === 'Enter') inp.dispatchEvent(new Event('change')); });
          wrap.append(h('div', { class: 'ax', 'data-ax': ax }, f.spin ? withSpin(inp, f.spin, () => inp.dispatchEvent(new Event('change'))) : inp));
          return inp;
        });
        field.append(wrap);
        if (f.unit) field.append(h('span', { class: 'unit' }, f.unit));
        inputs.forEach((inp, i) => this._bind(inp, it => fmt((getPath(it, f.key) || [])[i], f.normalize ? 6 : 4)));
        break;
      }
      case 'select': {
        const s = h('select', { 'data-key': f.key, disabled: !!f.disabled }, f.options.map(([v, l]) => h('option', { value: v }, f.raw ? l : t(l))));
        s.addEventListener('change', () => commit(s.value));
        field.append(s);
        this._bind(s, it => getPath(it, f.key) ?? '');
        break;
      }
      case 'check': {
        const c = h('input', { type: 'checkbox', 'data-key': f.key, disabled: !!f.disabled });
        c.addEventListener('change', () => commit(c.checked));
        field.append(c);
        const isOn = it => (f.key === 'locked' ? !!getPath(it, f.key) : getPath(it, f.key) !== false);
        this.bindings.push({ update: it => { c.checked = isOn(it); } });
        c.checked = isOn(r.item);
        if (f.key === 'locked') field.append(h('span', { class: 'unit' }, t('blocca spostamenti e rotazioni')));
        break;
      }
      case 'color': {
        const c = h('input', { type: 'color', 'data-key': f.key });
        c.addEventListener('change', () => commit(c.value));
        field.append(c);
        this._bind(c, it => getPath(it, f.key) || '#999999');
        break;
      }
      case 'points': {
        const ta = h('textarea', { 'data-key': f.key, spellcheck: 'false' });
        ta.addEventListener('change', () => {
          const pts = parsePoints(ta.value);
          if (!pts || pts.length < 3) { ta.classList.add('bad'); return; }
          ta.classList.remove('bad');
          commit(pts);
        });
        field.append(ta);
        this._bind(ta, it => (getPath(it, f.key) || []).map(p => `${fmt(p[0], 4)} ${fmt(p[1], 4)}`).join('\n'));
        break;
      }
      case 'toolLib': {
        const op = r.item;
        const s = h('select', { 'data-key': 'toolId' }, h('option', { value: '' }, t('— personalizzato —')));
        s.disabled = true;
        getTools().then(tools => {
          for (const tl of tools) s.append(h('option', { value: tl.id }, `T${tl.number} · ${tl.name}`));
          s.disabled = false;
          s.value = tools.some(x => x.id === op.tool?.libId) ? op.tool.libId : '';
        }).catch(() => { /* magazzino non disponibile */ });
        s.addEventListener('change', () => { if (s.value) this.cmd.setToolFromLibrary(op.id, s.value); });
        field.append(s, h('button', { class: 'btn sm', type: 'button', title: t('Magazzino utensili…'), onclick: () => this.cmd.toolLibrary() }, '…'));
        this.bindings.push({ update: it => { if (!s.disabled && [...s.options].some(o => o.value === (it.tool?.libId || ''))) s.value = it.tool?.libId || ''; } });
        break;
      }
    }
  }

  /** Parametro in mm o in % (diametro / altezza tagliente) con limiti minimo e massimo in mm. */
  _relField(f, r) {
    const op = r.item;
    const key = f.key;
    const spec = REL_PARAMS[key];
    const rel = op.rel?.[key];
    const on = !!rel?.on;
    const el = this.body;
    const sel = { ...App.selection };
    const mode = h('select', { class: 'rel-mode', 'data-key': `${key}.mode`, title: t('Unità: mm oppure % del diametro (Ø) / dell\'altezza del tagliente (Lc)') },
      h('option', { value: 'mm' }, 'mm'), h('option', { value: 'pct' }, `% ${BASE_LABEL[spec.base]}`));
    mode.value = on ? 'pct' : 'mm';
    mode.addEventListener('change', () => this.cmd.setRel(op.id, key, { on: mode.value === 'pct' }));
    const numIn = (get, set, k) => {
      const inp = h('input', { inputmode: 'decimal', 'data-key': k });
      inp.addEventListener('change', () => {
        const v = evalNum(inp.value);
        if (!Number.isFinite(v) || v < 0) { inp.classList.add('bad'); return; }
        inp.classList.remove('bad');
        set(v);
      });
      inp.addEventListener('keydown', e => { if (e.key === 'Enter') inp.dispatchEvent(new Event('change')); });
      this._bind(inp, it => fmt(get(it), 4));
      return inp;
    };
    const main = on
      ? numIn(it => it.rel?.[key]?.pct, v => this.cmd.setRel(op.id, key, { pct: v }), `${key}.pct`)
      : numIn(it => it[key], v => this.cmd.setProp(sel, key, v), key);
    el.append(h('div', { class: 'p-row' }, this._label(f), h('div', { class: 'p-field' }, main, mode)));
    if (!on) return;
    const min = numIn(it => it.rel?.[key]?.min, v => this.cmd.setRel(op.id, key, { min: v }), `${key}.min`);
    const max = numIn(it => it.rel?.[key]?.max, v => this.cmd.setRel(op.id, key, { max: v }), `${key}.max`);
    el.append(h('div', { class: 'p-row sub-row' }, h('label', { title: t('Limiti in mm (0 = nessun limite)') }, t('limiti')),
      h('div', { class: 'p-field rel-lims' }, h('span', { class: 'unit' }, t('min')), min, h('span', { class: 'unit' }, t('max')), max, h('span', { class: 'unit' }, 'mm'))));
    const info = h('div', { class: 'p-info' });
    const upd = it => {
      const base = baseValue(it.tool, spec.base);
      info.textContent = `= ${fmt(effParam(it, key), 4)} mm  (${it.rel?.[key]?.pct ?? 0} % ${t('di')} ${BASE_LABEL[spec.base]} ${fmt(base, 3)} mm)`;
    };
    upd(op);
    this.bindings.push({ update: upd });
    el.append(h('div', { class: 'p-row sub-row' }, h('label', {}, t('effettivo')), h('div', { class: 'p-field' }, info)));
  }

  _bind(input, getter) {
    const upd = it => {
      if (document.activeElement === input) return;
      input.value = getter(it);
      input.classList.remove('bad');
    };
    upd(resolve().item);
    this.bindings.push({ update: upd });
  }
}

function vs(v) { return `(${fmt(v.x, 3)}, ${fmt(v.y, 3)}, ${fmt(v.z, 3)})`; }
function fmtMin(m) {
  if (!Number.isFinite(m)) return '–';
  const s0 = Math.round(m * 60);
  const hh = Math.floor(s0 / 3600), mm = Math.floor((s0 % 3600) / 60), ss = s0 % 60;
  return hh ? `${hh}h ${mm}m ${ss}s` : `${mm}m ${ss}s`;
}
