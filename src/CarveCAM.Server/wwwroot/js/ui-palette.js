// Ricerca comandi (Ctrl+K): elenca tutte le azioni dei menu, filtrabili per nome.
import { h } from './dialogs.js';
import { TB } from './icons.js';

const norm = s => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

export class CommandPalette {
  constructor(actions, menus) {
    this.actions = actions;
    // ogni azione con il menu in cui compare (prima occorrenza)
    this.entries = [];
    const seen = new Set();
    for (const m of menus) {
      for (const it of m.items) {
        if (typeof it !== 'string' || it === '-' || seen.has(it)) continue;
        const a = actions.get(it);
        if (!a) continue;
        seen.add(it);
        this.entries.push({ a, menu: m.label, key: norm(`${a.label} ${m.label} ${a.hint || ''}`) });
      }
    }
    this.root = null;
  }

  get isOpen() { return !!this.root; }

  open() {
    if (this.root) return;
    this.input = h('input', { class: 'pal-input', placeholder: 'Cerca un comando: piano, sketch, calcola, esporta…', 'aria-label': 'Cerca un comando', spellcheck: 'false' });
    this.list = h('div', { class: 'pal-list', role: 'listbox' });
    const box = h('div', { class: 'pal-box', role: 'dialog', 'aria-label': 'Cerca un comando' },
      h('div', { class: 'pal-head' }, h('span', { class: 'pal-ico', html: TB.search }), this.input, h('kbd', {}, 'Esc')),
      this.list);
    this.root = h('div', { class: 'pal-backdrop', onmousedown: e => { if (e.target === this.root) this.close(); } }, box);
    document.body.append(this.root);
    this.input.addEventListener('input', () => this._filter());
    this.input.addEventListener('keydown', e => this._key(e));
    this._filter();
    this.input.focus();
  }

  close() {
    this.root?.remove();
    this.root = null;
  }

  _filter() {
    const words = norm(this.input.value).split(/\s+/).filter(Boolean);
    this.shown = this.entries.filter(x => words.every(w => x.key.includes(w)));
    this.list.innerHTML = '';
    if (!this.shown.length) {
      this.list.append(h('div', { class: 'pal-empty' }, 'Nessun comando trovato. Prova con un\'altra parola.'));
    }
    this.shown.forEach((x, i) => {
      const en = this.actions.isEnabled(x.a);
      const row = h('div', { class: `pal-row${en ? '' : ' disabled'}`, role: 'option' },
        h('span', { class: `pal-ico${x.a.tone ? ` tone-${x.a.tone}` : ''}`, html: TB[x.a.icon] || '' }),
        h('span', { class: 'pal-lbl' }, x.a.label),
        h('span', { class: 'pal-menu' }, x.menu),
        h('kbd', { class: x.a.kbd ? '' : 'empty' }, x.a.kbd || ''));
      row.addEventListener('mousemove', () => this._hi(i));
      row.addEventListener('click', () => this._run(i));
      this.list.append(row);
    });
    this._hi(this.shown.findIndex(x => this.actions.isEnabled(x.a)));
  }

  _hi(i) {
    this.hi = i;
    [...this.list.querySelectorAll('.pal-row')].forEach((r, k) => {
      r.classList.toggle('hi', k === i);
      r.setAttribute('aria-selected', String(k === i));
      if (k === i) r.scrollIntoView({ block: 'nearest' });
    });
  }

  _run(i) {
    const x = this.shown[i];
    if (!x || !this.actions.isEnabled(x.a)) return;
    this.close();
    setTimeout(() => this.actions.run(x.a), 0);
  }

  _key(e) {
    if (e.key === 'Escape') { e.preventDefault(); this.close(); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); this._hi(Math.min(this.shown.length - 1, this.hi + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); this._hi(Math.max(0, this.hi - 1)); }
    else if (e.key === 'Enter') { e.preventDefault(); this._run(this.hi); }
    e.stopPropagation();
  }
}
