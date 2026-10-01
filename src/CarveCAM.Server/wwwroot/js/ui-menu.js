// Menu a tendina (con icone, spunte e navigazione da tastiera) e menu contestuale.
import { h } from './dialogs.js';
import { TB } from './icons.js';
import { t, LOCALE } from './i18n.js';

export class MenuBar {
  /**
   * @param el contenitore dei pulsanti di menu
   * @param menus [{ label, items: [idAzione | '-' | { head }] }]
   * @param actions registro delle azioni (createActions)
   */
  constructor(el, menus, actions, recent = null) {
    this.el = el;
    this.menus = menus;
    this.actions = actions;
    this.recent = recent;          // { list: [], open(entry) } progetti recenti per il menu File
    this.openIdx = -1;
    this.drop = null;
    this.rows = [];
    this.hi = -1;
    this.layer = document.getElementById('menu-layer');
    this.render();
    document.addEventListener('mousedown', e => {
      if (this.drop && !this.drop.contains(e.target) && !this.el.contains(e.target)) this.close();
    });
    document.addEventListener('keydown', e => this._key(e), true);
    window.addEventListener('blur', () => this.close());
    window.addEventListener('resize', () => this.close());
  }

  get isOpen() { return !!this.drop; }

  render() {
    this.el.innerHTML = '';
    this.tops = this.menus.map((m, i) => {
      const b = h('button', { class: 'menu-top', role: 'menuitem', 'aria-haspopup': 'true', 'aria-expanded': 'false' }, m.label);
      b.addEventListener('mousedown', e => { e.preventDefault(); this.openIdx === i ? this.close() : this.open(i); });
      b.addEventListener('mouseenter', () => { if (this.openIdx >= 0 && this.openIdx !== i) this.open(i); });
      b.addEventListener('keydown', e => {
        if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown') { e.preventDefault(); this.open(i, true); }
      });
      this.el.append(b);
      return b;
    });
  }

  open(i, focusFirst = false) {
    this.close();
    this.openIdx = i;
    const top = this.tops[i];
    top.classList.add('open');
    top.setAttribute('aria-expanded', 'true');
    const drop = h('div', { class: 'menu-drop', role: 'menu' });
    this.rows = [];
    for (const it of this.menus[i].items) {
      if (it === '-') { drop.append(h('div', { class: 'menu-sep', role: 'separator' })); continue; }
      if (it.head) { drop.append(h('div', { class: 'menu-head' }, it.head)); continue; }
      if (it.recent) { drop.append(this._recentBox()); continue; }
      const a = this.actions.get(it);
      if (!a) continue;
      const row = menuRow(a, this.actions.isEnabled(a), this.actions.isChecked(a));
      if (row.dataset.enabled === '1') {
        const idx = this.rows.length;
        row.addEventListener('mouseup', () => this._activate(a));
        row.addEventListener('mousemove', () => this._highlight(idx));
        this.rows.push({ row, a });
      }
      drop.append(row);
    }
    const rc = top.getBoundingClientRect();
    drop.style.left = `${rc.left}px`;
    drop.style.top = `${rc.bottom + 4}px`;
    this.layer.append(drop);
    this.drop = drop;
    this.hi = -1;
    if (focusFirst) this._highlight(0);
  }

  /** Riquadro con gli ultimi progetti aperti o salvati (al massimo 5). */
  _recentBox() {
    const box = h('div', { class: 'menu-recent', role: 'group', 'aria-label': t('Progetti recenti') },
      h('div', { class: 'menu-head' }, t('Progetti recenti')));
    const list = this.recent?.list || [];
    if (!list.length) box.append(h('div', { class: 'menu-item disabled recent-empty' }, h('span', { class: 'mi-ico' }), h('span', { class: 'mi-lbl' }, t('Nessun progetto recente')), h('span')));
    list.slice(0, 5).forEach((e, i) => {
      const when = new Date(e.time).toLocaleDateString(LOCALE, { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
      const row = h('div', { class: 'menu-item recent', role: 'menuitem', title: e.fileName ? `${e.name} — ${e.fileName}` : e.name },
        h('span', { class: 'mi-ico recent-n' }, String(i + 1)),
        h('span', { class: 'mi-lbl' }, h('span', { class: 'recent-name' }, e.name || e.fileName), e.fileName ? h('span', { class: 'recent-file' }, e.fileName) : null),
        h('span', { class: 'kbd' }, when));
      const a = { id: `file.recent.${i + 1}`, run: () => this.recent.open(e) };
      const idx = this.rows.length;
      row.addEventListener('mouseup', () => { this.close(); setTimeout(() => a.run(), 0); });
      row.addEventListener('mousemove', () => this._highlight(idx));
      this.rows.push({ row, a, custom: true });
      box.append(row);
    });
    return box;
  }

  close() {
    if (this.drop) this.drop.remove();
    this.drop = null;
    this.rows = [];
    if (this.openIdx >= 0 && this.tops[this.openIdx]) {
      this.tops[this.openIdx].classList.remove('open');
      this.tops[this.openIdx].setAttribute('aria-expanded', 'false');
    }
    this.openIdx = -1;
  }

  _activate(a) {
    this.close();
    setTimeout(() => this.actions.run(a), 0);
  }

  _highlight(idx) {
    if (!this.rows.length) return;
    this.hi = (idx + this.rows.length) % this.rows.length;
    this.rows.forEach((r, k) => r.row.classList.toggle('hi', k === this.hi));
  }

  _key(e) {
    if (!this.drop) return;
    const k = e.key;
    if (k === 'Escape') { const t = this.tops[this.openIdx]; this.close(); t?.focus(); }
    else if (k === 'ArrowDown') this._highlight(this.hi + 1);
    else if (k === 'ArrowUp') this._highlight(this.hi < 0 ? -1 : this.hi - 1);
    else if (k === 'ArrowRight') this.open((this.openIdx + 1) % this.menus.length, true);
    else if (k === 'ArrowLeft') this.open((this.openIdx - 1 + this.menus.length) % this.menus.length, true);
    else if (k === 'Enter' && this.hi >= 0) {
      const r = this.rows[this.hi];
      if (r.custom) { this.close(); setTimeout(() => r.a.run(), 0); } else this._activate(r.a);
    }
    else return;
    e.preventDefault();
    e.stopPropagation();
  }
}

function menuRow(a, enabled, checked) {
  const ico = h('span', { class: `mi-ico${a.tone ? ` tone-${a.tone}` : ''}`, html: TB[a.icon] || '' });
  const row = h('div', { class: `menu-item${enabled ? '' : ' disabled'}${checked ? ' checked' : ''}`, role: checked ? 'menuitemcheckbox' : 'menuitem',
    'aria-checked': a.checked ? String(checked) : null, 'aria-disabled': enabled ? null : 'true' },
  ico, h('span', { class: 'mi-lbl' }, a.label), h('span', { class: 'kbd' }, a.kbd || ''));
  row.dataset.enabled = enabled ? '1' : '0';
  return row;
}

/** Menu contestuale posizionato al puntatore: items [{ label, kbd, action, enabled(), sep }]. */
export function contextMenu(ev, items) {
  const layer = document.getElementById('menu-layer');
  layer.querySelectorAll('.ctx-menu').forEach(e => e.remove());
  const drop = h('div', { class: 'menu-drop ctx-menu', role: 'menu' });
  for (const it of items) {
    if (it.sep) { drop.append(h('div', { class: 'menu-sep' })); continue; }
    const enabled = it.enabled ? it.enabled() : true;
    const row = h('div', { class: `menu-item${enabled ? '' : ' disabled'}`, role: 'menuitem' },
      h('span', { class: 'mi-ico', html: it.icon ? TB[it.icon] || '' : '' }), h('span', { class: 'mi-lbl' }, it.label), h('span', { class: 'kbd' }, it.kbd || ''));
    if (enabled) row.addEventListener('mouseup', () => { drop.remove(); setTimeout(() => it.action?.(), 0); });
    drop.append(row);
  }
  layer.append(drop);
  const w = drop.offsetWidth, hgt = drop.offsetHeight;
  drop.style.left = `${Math.min(ev.clientX, window.innerWidth - w - 6)}px`;
  drop.style.top = `${Math.min(ev.clientY, window.innerHeight - hgt - 6)}px`;
  const off = e => { if (!drop.contains(e.target)) { drop.remove(); document.removeEventListener('mousedown', off, true); } };
  setTimeout(() => document.addEventListener('mousedown', off, true), 0);
}
