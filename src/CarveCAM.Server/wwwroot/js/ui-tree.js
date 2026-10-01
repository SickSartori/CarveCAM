// Navigatore: oggetti, artefatti, piani (con sketch ed entità), lavorazioni.
// Clic seleziona, Ctrl+clic aggiunge o toglie dalla selezione; il lucchetto blocca o sblocca l'elemento.
import { App, select, toggleSelect, isSelected } from './state.js';
import { h } from './dialogs.js';
import { ICONS } from './icons.js';
import { contextMenu } from './ui-menu.js';
import { t, num } from './i18n.js';

const KIND_LABEL = { box: 'Parallelepipedo', cylinder: 'Cilindro', cone: 'Tronco di cono', sphere: 'Sfera' };
const ENT_LABEL = { polyline: 'Polilinea', rect: 'Rettangolo', circle: 'Cerchio', polygon: 'Poligono' };

export class Tree {
  constructor(el, cmd) {
    this.el = el;
    this.cmd = cmd;
    this.collapsed = new Set();
    const col = document.getElementById('tree-collapse');
    const exp = document.getElementById('tree-expand');
    col.innerHTML = ICONS.collapseAll;
    exp.innerHTML = ICONS.expandAll;
    col.onclick = () => {
      for (const pl of App.project.planes) { this.collapsed.add(pl.id); for (const s of pl.sketches) this.collapsed.add(s.id); }
      this.render();
    };
    exp.onclick = () => { this.collapsed.clear(); this.render(); };
    el.addEventListener('keydown', e => this._key(e));
  }

  render() {
    const p = App.project;
    const scroll = this.el.scrollTop;
    this.el.innerHTML = '';

    this._section(t('Oggetti'), p.objects.length);
    if (!p.objects.length) this.el.append(h('div', { class: 'tree-empty' }, t('Nessun oggetto importato')));
    for (const o of p.objects) {
      this._row({ depth: 0, icon: ICONS.object, label: o.name, sub: o.triangles ? `${fmtCount(o.triangles)} ${t('tr.')}` : '',
        sel: { type: 'object', id: o.id }, visible: o.visible !== false, onEye: () => this.cmd.toggleVisible('object', o.id),
        locked: !!o.locked, onLock: () => this.cmd.toggleLock({ type: 'object', id: o.id }) });
    }

    this._section(t('Artefatti'), p.artifacts.length);
    if (!p.artifacts.length) this.el.append(h('div', { class: 'tree-empty' }, t('Nessun artefatto')));
    for (const a of p.artifacts) {
      this._row({ depth: 0, icon: ICONS[a.kind], label: a.name, sub: t(KIND_LABEL[a.kind]),
        sel: { type: 'artifact', id: a.id }, visible: a.visible !== false, onEye: () => this.cmd.toggleVisible('artifact', a.id),
        locked: !!a.locked, onLock: () => this.cmd.toggleLock({ type: 'artifact', id: a.id }) });
    }

    this._section(t('Piani di lavoro'), p.planes.length);
    if (!p.planes.length) this.el.append(h('div', { class: 'tree-empty' }, t('Nessun piano')));
    for (const pl of p.planes) {
      const open = !this.collapsed.has(pl.id);
      this._row({ depth: 0, icon: ICONS.plane, label: pl.name, sub: normalLabel(pl.normal),
        sel: { type: 'plane', id: pl.id }, visible: pl.visible !== false, onEye: () => this.cmd.toggleVisible('plane', pl.id),
        locked: !!pl.locked, onLock: () => this.cmd.toggleLock({ type: 'plane', id: pl.id }),
        twisty: pl.sketches.length ? (open ? '▾' : '▸') : '', onTwisty: () => this._toggle(pl.id) });
      if (!open) continue;
      for (const s of pl.sketches) {
        const sopen = !this.collapsed.has(s.id);
        const editing = App.sketch && App.sketch.sketchId === s.id;
        this._row({ depth: 1, icon: ICONS.sketch, label: s.name + (editing ? '  ✎' : ''), sub: `${s.entities.length} ${t('ent.')}`,
          sel: { type: 'sketch', id: s.id }, visible: s.visible !== false, onEye: () => this.cmd.toggleVisible('sketch', s.id),
          twisty: s.entities.length ? (sopen ? '▾' : '▸') : '', onTwisty: () => this._toggle(s.id),
          onDbl: () => this.cmd.editSketch(s.id) });
        if (!sopen) continue;
        for (const e of s.entities) {
          this._row({ depth: 2, icon: ICONS[e.kind], label: e.name || t(ENT_LABEL[e.kind]), sub: entitySub(e),
            sel: { type: 'entity', id: e.id, sketchId: s.id } });
        }
      }
    }

    this._section(t('Lavorazioni'), p.operations.length);
    if (!p.operations.length) this.el.append(h('div', { class: 'tree-empty' }, t('Nessuna lavorazione')));
    for (const op of p.operations) {
      const st = this.cmd.opStatus(op);
      const badge = h('span', { class: `badge ${st}` }, st === 'ok' ? t('ok') : st === 'stale' ? t('da ricalcolare') : t('da calcolare'));
      this._row({ depth: 0, icon: op.kind === 'finish' ? ICONS.finish : ICONS.pocket, label: op.name, sub: `T${op.tool?.number ?? ''}`,
        badge, sel: { type: 'operation', id: op.id }, visible: op.visible !== false,
        onEye: () => this.cmd.toggleVisible('operation', op.id), onDbl: () => this.cmd.compute(op.id) });
    }
    this.el.scrollTop = scroll;
  }

  _toggle(id) {
    if (this.collapsed.has(id)) this.collapsed.delete(id); else this.collapsed.add(id);
    this.render();
  }

  _section(label, count) {
    this.el.append(h('div', { class: 'tree-sec' }, label, h('span', { class: 'count' }, `(${count})`)));
  }

  _row({ depth, icon, label, sub, badge, sel, visible, onEye, twisty, onTwisty, onDbl, locked, onLock }) {
    const isSel = isSelected(sel.type, sel.id);
    const primary = App.selection && App.selection.type === sel.type && App.selection.id === sel.id;
    const row = h('div', {
      class: `tree-row${isSel ? ' sel' : ''}${primary && App.selected.length > 1 ? ' primary' : ''}${visible === false ? ' hidden-item' : ''}${locked ? ' locked' : ''}`,
      style: { paddingLeft: `${4 + depth * 14}px` },
    });
    const tw = h('span', { class: 'tw' }, twisty || '');
    if (onTwisty) tw.addEventListener('click', e => { e.stopPropagation(); onTwisty(); });
    row.append(tw, h('span', { class: 'ico', html: icon || '' }), h('span', { class: 'lbl', title: label }, label));
    if (sub) row.append(h('span', { class: 'sub' }, sub));
    if (badge) row.append(badge);
    if (onLock) {
      const lk = h('button', { class: `icon-btn lock${locked ? ' on' : ''}`, title: locked ? t('Bloccato: clic per sbloccare') : t('Sbloccato: clic per bloccare'),
        'aria-pressed': String(!!locked), html: locked ? ICONS.lock : ICONS.unlock });
      lk.addEventListener('click', e => { e.stopPropagation(); onLock(); });
      row.append(lk);
    } else {
      row.append(h('span', { class: 'btn-pad' }));
    }
    if (onEye) {
      const eye = h('button', { class: `icon-btn eye${visible === false ? ' off' : ''}`, title: t('Mostra / nascondi'), html: visible === false ? ICONS.eyeOff : ICONS.eye });
      eye.addEventListener('click', e => { e.stopPropagation(); onEye(); });
      row.append(eye);
    } else {
      row.append(h('span', { class: 'btn-pad' }));
    }
    row.addEventListener('click', e => {
      if (e.ctrlKey || e.metaKey || e.shiftKey) toggleSelect(sel);
      else select(sel);
      this.el.focus();
    });
    if (onDbl) row.addEventListener('dblclick', e => { e.preventDefault(); onDbl(); });
    row.addEventListener('contextmenu', e => {
      e.preventDefault();
      if (!isSelected(sel.type, sel.id)) select(sel);
      contextMenu(e, this.cmd.contextItems(sel));
    });
    this.el.append(row);
  }

  _key(e) {
    if (e.key === 'Delete' && App.selected.length) { e.preventDefault(); e.stopPropagation(); this.cmd.deleteSelected(); }
    if (e.key === 'F2' && App.selection) { e.preventDefault(); document.querySelector('#props [data-key="name"]')?.focus(); }
  }
}

function fmtCount(n) {
  return n >= 1e6 ? `${num(n / 1e6, { maximumFractionDigits: 1 })}M` : n >= 1e3 ? `${num(n / 1e3, { maximumFractionDigits: 1 })}k` : String(n);
}

function normalLabel(n) {
  if (!n) return '';
  const [x, y, z] = n;
  const l = Math.hypot(x, y, z) || 1;
  const a = [x / l, y / l, z / l];
  const names = [['+X', [1, 0, 0]], ['-X', [-1, 0, 0]], ['+Y', [0, 1, 0]], ['-Y', [0, -1, 0]], ['+Z', [0, 0, 1]], ['-Z', [0, 0, -1]]];
  for (const [nm, v] of names) if (Math.abs(a[0] - v[0]) + Math.abs(a[1] - v[1]) + Math.abs(a[2] - v[2]) < 1e-6) return `N ${nm}`;
  return t('N inclinata');
}

function entitySub(e) {
  const f = v => Number((+v).toFixed(2));
  switch (e.kind) {
    case 'rect': return `${f(Math.abs(e.x2 - e.x1))}×${f(Math.abs(e.y2 - e.y1))}`;
    case 'circle': return `Ø${f(e.r * 2)}`;
    case 'polygon': return t('{n} lati', { n: e.sides });
    case 'polyline': return `${(e.pts || []).length} pt`;
  }
  return '';
}
