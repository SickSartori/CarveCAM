// Pannello proprietà: moduli generati da uno schema per ogni tipo di elemento selezionato.
import { App, resolve, getPath, allSketches } from './state.js';
import { h } from './dialogs.js';
import { fmt, planeFrame } from './geom.js';

const KIND_LABEL = { box: 'Parallelepipedo', cylinder: 'Cilindro', cone: 'Tronco di cono', sphere: 'Sfera' };
const ENT_LABEL = { polyline: 'Polilinea', rect: 'Rettangolo', circle: 'Cerchio', polygon: 'Poligono regolare' };

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

export class Props {
  constructor(el, cmd) {
    this.el = el;
    this.cmd = cmd;
    this.sig = null;
    this.bindings = [];
    this.blocks = [];
  }

  _sigOf(r) {
    if (!r) return 'none';
    const it = r.item;
    return [r.type, it.id, it.kind, it.strategy, it.tool && it.tool.type, it.entry].join('|');
  }

  /** Aggiorna i valori se la struttura del modulo è invariata, altrimenti ricostruisce. */
  refresh() {
    const r = resolve();
    if (this._sigOf(r) !== this.sig) return this.render();
    for (const b of this.bindings) b.update(r.item);
    for (const b of this.blocks) b.update(r);
  }

  render() {
    const r = resolve();
    this.sig = this._sigOf(r);
    this.bindings = [];
    this.blocks = [];
    this.el.innerHTML = '';
    const title = document.getElementById('props-title');
    if (!r) {
      title.textContent = 'Proprietà';
      this.el.append(h('div', { class: 'props-empty', html:
        '<b>Nessuna selezione.</b><br>1. <b>File › Importa modello 3D</b> o <b>Inserisci</b> un artefatto.<br>' +
        '2. <b>Piani › Nuovo piano</b> per definire l\'asse utensile (normale).<br>' +
        '3. <b>Sketch › Nuovo sketch</b> e disegna l\'area di contenimento.<br>' +
        '4. <b>Lavorazioni › Nuova svuotatura / finitura</b>, poi <b>Calcola</b> (F9).<br><br>' +
        'Per una prova rapida: <b>Aiuto › Progetto di esempio</b>.' }));
      return;
    }
    title.textContent = {
      object: 'Proprietà oggetto', artifact: 'Proprietà artefatto', plane: 'Proprietà piano', sketch: 'Proprietà sketch',
      entity: 'Proprietà entità', operation: 'Proprietà lavorazione',
    }[r.type];
    const fields = this[`_schema_${r.type}`](r);
    for (const f of fields) this._field(f, r);
  }

  // ---------------------------------------------------------------- schemi
  _schema_object(r) {
    const o = r.item;
    return [
      { sec: 'Oggetto' },
      { key: 'name', label: 'Nome', type: 'text' },
      { label: 'Triangoli', type: 'info', value: it => (it.triangles || 0).toLocaleString('it-IT') },
      { label: 'Dimensioni', type: 'info', value: it => it.size ? it.size.map((v, i) => fmt(v * (it.scale[i] || 1), 2)).join(' × ') + ' mm' : '–' },
      { sec: 'Posizionamento' },
      { key: 'position', label: 'Posizione', type: 'vec3', unit: 'mm' },
      { key: 'rotation', label: 'Rotazione', type: 'vec3', unit: '°' },
      { key: 'scale', label: 'Scala', type: 'vec3' },
      { type: 'buttons', items: [
        { label: 'Appoggia su Z=0', action: () => this.cmd.dropToFloor({ type: 'object', id: o.id }) },
        { label: 'Centra in XY', action: () => this.cmd.centerXY({ type: 'object', id: o.id }) },
      ] },
      { sec: 'Visualizzazione e calcolo' },
      { key: 'color', label: 'Colore', type: 'color' },
      { key: 'visible', label: 'Visibile', type: 'check' },
      { key: 'include', label: 'Ostacolo nel calcolo', type: 'check' },
    ];
  }

  _schema_artifact(r) {
    const a = r.item;
    const dims = {
      box: [{ key: 'size', label: 'Dimensioni X/Y/Z', type: 'vec3', unit: 'mm', min: 0.001 }],
      cylinder: [{ key: 'radius', label: 'Raggio', type: 'num', unit: 'mm', min: 0.001 }, { key: 'height', label: 'Altezza', type: 'num', unit: 'mm', min: 0.001 }],
      cone: [
        { key: 'radius', label: 'Raggio inferiore', type: 'num', unit: 'mm', min: 0 },
        { key: 'radius2', label: 'Raggio superiore', type: 'num', unit: 'mm', min: 0 },
        { key: 'height', label: 'Altezza', type: 'num', unit: 'mm', min: 0.001 },
      ],
      sphere: [{ key: 'radius', label: 'Raggio', type: 'num', unit: 'mm', min: 0.001 }],
    }[a.kind] || [];
    return [
      { sec: KIND_LABEL[a.kind] || 'Artefatto' },
      { key: 'name', label: 'Nome', type: 'text' },
      { key: 'kind', label: 'Tipo', type: 'select', options: Object.entries(KIND_LABEL) },
      ...dims,
      { note: a.kind === 'box' || a.kind === 'sphere' ? 'Centrato nella propria posizione.' : 'Asse lungo Z locale, centrato nella propria posizione (raggio inferiore verso -Z).' },
      { sec: 'Posizionamento' },
      { key: 'position', label: 'Posizione', type: 'vec3', unit: 'mm' },
      { key: 'rotation', label: 'Rotazione', type: 'vec3', unit: '°' },
      { type: 'buttons', items: [
        { label: 'Appoggia su Z=0', action: () => this.cmd.dropToFloor({ type: 'artifact', id: a.id }) },
        { label: 'Duplica', action: () => this.cmd.duplicateSelected() },
      ] },
      { sec: 'Visualizzazione e calcolo' },
      { key: 'color', label: 'Colore', type: 'color' },
      { key: 'visible', label: 'Visibile', type: 'check' },
      { key: 'include', label: 'Ostacolo nel calcolo', type: 'check' },
    ];
  }

  _schema_plane(r) {
    const pl = r.item;
    return [
      { sec: 'Piano di lavoro' },
      { key: 'name', label: 'Nome', type: 'text' },
      { key: 'origin', label: 'Origine', type: 'vec3', unit: 'mm' },
      { key: 'normal', label: 'Normale (asse ut.)', type: 'vec3', normalize: true },
      { key: 'angle', label: 'Rotazione asse U', type: 'num', unit: '°' },
      { key: 'size', label: 'Dimensione vista', type: 'num', unit: 'mm', min: 1 },
      { label: 'Asse U / V', type: 'info', value: it => { const f = planeFrame(it); return `${vs(f.u)}  /  ${vs(f.v)}`; } },
      { key: 'visible', label: 'Visibile', type: 'check' },
      { type: 'buttons', items: [
        { label: 'Nuovo sketch', primary: true, action: () => this.cmd.newSketch(pl.id) },
        { label: 'Inverti normale', action: () => this.cmd.flipNormal(pl.id) },
        { label: 'Vista normale', action: () => this.cmd.viewNormal(pl.id) },
      ] },
      { note: 'La normale indica l\'orientamento dell\'utensile: la fresa lavora dal lato della freccia blu verso il piano e oltre.' },
    ];
  }

  _schema_sketch(r) {
    const s = r.item;
    return [
      { sec: 'Sketch' },
      { key: 'name', label: 'Nome', type: 'text' },
      { label: 'Piano', type: 'info', value: () => r.plane.name },
      { label: 'Entità', type: 'info', value: it => String(it.entities.length) },
      { key: 'visible', label: 'Visibile', type: 'check' },
      { type: 'buttons', items: [
        { label: App.sketch && App.sketch.sketchId === s.id ? 'Termina modifica' : 'Modifica sketch', primary: true,
          action: () => (App.sketch && App.sketch.sketchId === s.id ? this.cmd.finishSketch() : this.cmd.editSketch(s.id)) },
        { label: 'Nuova svuotatura', action: () => this.cmd.newOperation('pocket', s.id) },
        { label: 'Nuova finitura', action: () => this.cmd.newOperation('finish', s.id) },
      ] },
      { note: 'Le entità chiuse definiscono l\'area di contenimento della lavorazione. Un contorno contenuto in un altro diventa un\'isola esclusa.' },
    ];
  }

  _schema_entity(r) {
    const e = r.item;
    const f = [{ sec: ENT_LABEL[e.kind] || 'Entità' }, { key: 'name', label: 'Nome', type: 'text', placeholder: ENT_LABEL[e.kind] }];
    if (e.kind === 'rect') {
      f.push({ key: 'x1', label: 'Angolo 1 · X', type: 'num', unit: 'mm' }, { key: 'y1', label: 'Angolo 1 · Y', type: 'num', unit: 'mm' },
        { key: 'x2', label: 'Angolo 2 · X', type: 'num', unit: 'mm' }, { key: 'y2', label: 'Angolo 2 · Y', type: 'num', unit: 'mm' },
        { label: 'Dimensioni', type: 'info', value: it => `${fmt(Math.abs(it.x2 - it.x1))} × ${fmt(Math.abs(it.y2 - it.y1))} mm` });
    } else if (e.kind === 'circle') {
      f.push({ key: 'cx', label: 'Centro X', type: 'num', unit: 'mm' }, { key: 'cy', label: 'Centro Y', type: 'num', unit: 'mm' },
        { key: 'r', label: 'Raggio', type: 'num', unit: 'mm', min: 0.001 },
        { label: 'Diametro', type: 'info', value: it => `${fmt(it.r * 2)} mm` });
    } else if (e.kind === 'polygon') {
      f.push({ key: 'cx', label: 'Centro X', type: 'num', unit: 'mm' }, { key: 'cy', label: 'Centro Y', type: 'num', unit: 'mm' },
        { key: 'r', label: 'Raggio circoscritto', type: 'num', unit: 'mm', min: 0.001 },
        { key: 'sides', label: 'Lati', type: 'num', min: 3, max: 256, int: true },
        { key: 'rot', label: 'Rotazione', type: 'num', unit: '°' });
    } else if (e.kind === 'polyline') {
      f.push({ key: 'pts', label: 'Vertici (x y)', type: 'points' },
        { note: 'Un vertice per riga: "x y" oppure "x; y". Il contorno è sempre chiuso.' });
    }
    f.push({ note: 'Coordinate nel sistema del piano (U,V).' },
      { type: 'buttons', items: [{ label: 'Elimina entità', danger: true, action: () => this.cmd.deleteSelected() }] });
    return f;
  }

  _schema_operation(r) {
    const op = r.item;
    const pocket = op.kind !== 'finish';
    const sketches = allSketches().map(({ plane, sketch }) => [sketch.id, `${plane.name} › ${sketch.name}`]);
    const f = [
      { sec: pocket ? 'Svuotatura a terrazze' : 'Finitura in proiezione' },
      { key: 'name', label: 'Nome', type: 'text' },
      { key: 'sketchId', label: 'Contorno (sketch)', type: 'select', options: sketches.length ? sketches : [['', '— nessuno sketch —']] },
      { key: 'strategy', label: 'Strategia', type: 'select', options: [['concentric', 'Concentrica (offset)'], ['zigzag', 'Rettangolare (zigzag)']] },
    ];
    if (op.strategy === 'zigzag') f.push({ key: 'angle', label: 'Angolo passate', type: 'num', unit: '°' });
    f.push({ key: 'climb', label: 'Concorde (climb)', type: 'check' },
      { key: 'toolInside', label: 'Utensile dentro contorno', type: 'check' });
    if (pocket && op.strategy === 'zigzag') f.push({ key: 'contourPass', label: 'Passata di contorno', type: 'check' });
    f.push(
      { sec: 'Utensile' },
      { key: 'tool.type', label: 'Tipo fresa', type: 'select', options: [['flat', 'Cilindrica (piatta)'], ['bull', 'Torica (raccordata)'], ['ball', 'Sferica']] },
      { key: 'tool.diameter', label: 'Diametro', type: 'num', unit: 'mm', min: 0.01 },
    );
    if (op.tool && op.tool.type === 'bull') {
      f.push({ key: 'tool.cornerRadius', label: 'Raggio raccordo', type: 'num', unit: 'mm', min: 0.01, max: (op.tool.diameter || 6) / 2 });
    }
    f.push(
      { key: 'tool.number', label: 'Numero (T)', type: 'num', min: 1, max: 999, int: true },
      { sec: 'Parametri' },
      { key: 'stepover', label: 'Passo laterale', type: 'num', unit: 'mm', min: 0.001 },
      { label: 'Passo / diametro', type: 'info', value: it => `${fmt((it.stepover / (it.tool.diameter || 1)) * 100, 1)} %` },
    );
    if (pocket) f.push({ key: 'stepdown', label: 'Passo verticale', type: 'num', unit: 'mm', min: 0.001 });
    f.push(
      { key: 'maxDepth', label: 'Profondità max', type: 'num', unit: 'mm', min: 0.001 },
      { key: 'stock', label: 'Sovrametallo', type: 'num', unit: 'mm', min: 0 },
      { key: 'safeHeight', label: 'Quota sicurezza', type: 'num', unit: 'mm', min: 0.1 },
      { key: 'clearance', label: 'Avvicinamento', type: 'num', unit: 'mm', min: 0 },
      { key: 'resolution', label: pocket ? 'Risoluzione griglia' : 'Passo campionam.', type: 'num', unit: 'mm (0=auto)', min: 0 },
      { key: 'tolerance', label: 'Tolleranza', type: 'num', unit: 'mm', min: 0.0005 },
    );
    const entry = op.entry || 'plunge';
    if (pocket) {
      f.push(
        { sec: 'Ingresso nel materiale' },
        { key: 'entry', label: 'Tipo ingresso', type: 'select', options: [['plunge', 'Affondo verticale'], ['ramp', 'Rampa lungo il percorso'], ['helix', 'Elica']] },
      );
      if (entry !== 'plunge') f.push({ key: 'rampAngle', label: 'Angolo discesa', type: 'num', unit: '°', min: 0.5, max: 45 });
      if (entry === 'helix') f.push({ key: 'helixRadius', label: 'Raggio elica', type: 'num', unit: 'mm (0=auto)', min: 0 });
      if (entry !== 'plunge') {
        f.push({ key: 'rampFeed', label: 'Avanz. rampa', type: 'num', unit: 'mm/min (0=lavoro)', min: 0 },
          { note: entry === 'helix'
            ? 'Elica che parte e termina sul punto d\'ingresso, contenuta nella zona lavorabile; se non c\'è spazio si usa la rampa, poi l\'affondo.'
            : 'Discesa avanti e indietro lungo il primo tratto del percorso (o attorno al contorno se è corto); se non c\'è spazio si usa l\'affondo.' });
      }
    }
    f.push(
      { sec: 'Tecnologia' },
      { key: 'feed', label: 'Avanzamento', type: 'num', unit: 'mm/min', min: 1 },
      { key: 'plunge', label: 'Affondo', type: 'num', unit: 'mm/min', min: 1 },
      { key: 'spindle', label: 'Mandrino', type: 'num', unit: 'giri/min', min: 0, int: true },
      { key: 'visible', label: 'Mostra percorso', type: 'check' },
      { type: 'buttons', items: [
        { label: 'Calcola (F9)', primary: true, action: () => this.cmd.compute(op.id) },
        { label: 'Simula', action: () => this.cmd.simulate(op.id) },
        { label: 'G-code…', action: () => this.cmd.exportGcode([op.id]) },
      ] },
      { block: rr => this._statsBlock(rr.item) },
      { note: pocket
        ? 'Parte dal piano di lavoro e scende a terrazze (passo verticale) fino a ridosso di oggetti e artefatti, entro il contorno.'
        : 'Proietta il percorso lungo la normale del piano direttamente sulle superfici di oggetti e artefatti, senza passate intermedie.' },
    );
    return f;
  }

  _statsBlock(op) {
    const d = App.runtime.toolpaths.get(op.id);
    const box = h('div', {});
    if (!d) {
      box.append(h('div', { class: 'p-note' }, 'Percorso non ancora calcolato.'));
      return box;
    }
    const st = this.cmd.opStatus(op);
    const s = d.stats || {};
    box.append(h('div', { class: 'p-sec' }, st === 'stale' ? 'Risultato (parametri modificati: ricalcolare)' : 'Risultato'));
    const rows = [
      ['Punti', (s.pointCount || 0).toLocaleString('it-IT')],
      ['Lavoro', `${fmt((s.feedLength || 0) / 1000, 2)} m`],
      ['Rapidi', `${fmt((s.rapidLength || 0) / 1000, 2)} m`],
      ...(op.kind !== 'finish' ? [['Ingressi', `${s.helixEntries || 0} elica · ${s.rampEntries || 0} rampa · ${s.plungeEntries || 0} affondo`]] : []),
      ['Tempo stimato', fmtMin(s.estimatedMinutes)],
      [op.kind === 'finish' ? 'Passate' : 'Terrazze', String(s.levels ?? '–')],
      ['Triangoli ostacoli', (s.triangles || 0).toLocaleString('it-IT')],
      ['Quota sicurezza', `${fmt(s.safeW, 2)} mm`],
      ['Verifica collisioni', s.maxGouge > 0.001 ? `interferenza ${fmt(s.maxGouge, 3)} mm` : `ok (${(s.gougeSamples || 0).toLocaleString('it-IT')} campioni)`],
      ['Calcolo', `${s.computeMs ?? '–'} ms`],
    ];
    for (const [k, v] of rows) box.append(h('div', { class: 'p-row' }, h('label', {}, k), h('div', { class: 'p-info' }, v)));
    for (const w of d.warnings || []) box.append(h('div', { class: 'p-warn' }, w));
    return box;
  }

  // ---------------------------------------------------------------- costruzione campi
  _field(f, r) {
    const el = this.el;
    if (f.sec) { el.append(h('div', { class: 'p-sec' }, f.sec)); return; }
    if (f.note) { el.append(h('div', { class: 'p-note' }, f.note)); return; }
    if (f.block) {
      const holder = h('div', {});
      holder.append(f.block(r));
      el.append(holder);
      this.blocks.push({ update: rr => { holder.innerHTML = ''; holder.append(f.block(rr)); } });
      return;
    }
    if (f.type === 'buttons') {
      el.append(h('div', { class: 'p-buttons' }, f.items.map(b =>
        h('button', { class: `btn${b.primary ? ' primary' : ''}${b.danger ? ' danger' : ''}`, onclick: b.action }, b.label))));
      return;
    }
    const field = h('div', { class: 'p-field' });
    el.append(h('div', { class: 'p-row' }, h('label', { title: f.label }, f.label), field));
    const sel = { ...App.selection };
    const commit = v => this.cmd.setProp(sel, f.key, v);

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
        const inp = h('input', { 'data-key': f.key, inputmode: 'decimal' });
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
        field.append(inp);
        if (f.unit) field.append(h('span', { class: 'unit' }, f.unit));
        this._bind(inp, it => fmt(getPath(it, f.key), 4));
        break;
      }
      case 'vec3': {
        const wrap = h('div', { class: 'p-vec' });
        const inputs = ['X', 'Y', 'Z'].map((ax, i) => {
          const inp = h('input', { 'data-key': `${f.key}.${i}`, inputmode: 'decimal' });
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
          wrap.append(h('div', { class: 'ax', 'data-ax': ax }, inp));
          return inp;
        });
        field.append(wrap);
        if (f.unit) field.append(h('span', { class: 'unit' }, f.unit));
        inputs.forEach((inp, i) => this._bind(inp, it => fmt((getPath(it, f.key) || [])[i], f.normalize ? 6 : 4)));
        break;
      }
      case 'select': {
        const s = h('select', { 'data-key': f.key }, f.options.map(([v, l]) => h('option', { value: v }, l)));
        s.addEventListener('change', () => commit(s.value));
        field.append(s);
        this._bind(s, it => getPath(it, f.key) ?? '');
        break;
      }
      case 'check': {
        const c = h('input', { type: 'checkbox', 'data-key': f.key });
        c.addEventListener('change', () => commit(c.checked));
        field.append(c);
        this.bindings.push({ update: it => { c.checked = getPath(it, f.key) !== false; } });
        c.checked = getPath(r.item, f.key) !== false;
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
    }
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
  const t = Math.round(m * 60);
  const hh = Math.floor(t / 3600), mm = Math.floor((t % 3600) / 60), ss = t % 60;
  return hh ? `${hh}h ${mm}m ${ss}s` : `${mm}m ${ss}s`;
}
