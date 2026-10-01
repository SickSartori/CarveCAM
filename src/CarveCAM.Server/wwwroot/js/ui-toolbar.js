// Barra strumenti ordinata come il flusso di lavoro CAM, con spia di stato per ogni fase.
import { h } from './dialogs.js';
import { TB } from './icons.js';
import { t } from './i18n.js';

export class Toolbar {
  /**
   * @param el contenitore
   * @param groups definizione (TOOLBAR in actions.js)
   * @param actions registro delle azioni
   * @param stageOf funzione(stage) -> { state: 'todo'|'partial'|'done', tip }
   */
  constructor(el, groups, actions, stageOf) {
    this.el = el;
    this.groups = groups;
    this.actions = actions;
    this.stageOf = stageOf;
    this.buttons = [];
    this.selects = [];
    this.leds = [];
    this.tip = document.getElementById('tooltip');
    this.render();
    // la barra si compatta quando la finestra si restringe (e torna estesa quando si allarga)
    new ResizeObserver(() => this.fit()).observe(el);
    document.fonts?.ready.then(() => this.fit());
  }

  /**
   * Adatta la barra alla larghezza disponibile: livelli di compattazione crescenti (fit-1 spazi ridotti,
   * fit-2 senza testi sui pulsanti, fit-3 senza testo sul pulsante principale, fit-4 senza il gruppo Vista,
   * i cui comandi restano nei menu) finché tutti i gruppi entrano.
   */
  fit() {
    const el = this.el;
    const levels = ['fit-1', 'fit-2', 'fit-3', 'fit-4'];
    el.classList.remove(...levels);
    for (const c of levels) {
      if (el.scrollWidth <= el.clientWidth + 1) break;
      el.classList.add(c);
    }
  }

  render() {
    this.el.innerHTML = '';
    this.buttons = [];
    this.selects = [];
    this.leds = [];
    for (const g of this.groups) {
      if (g.end) this.el.append(h('div', { class: 'tb-spacer' }));
      const row = h('div', { class: 'tb-row' });
      for (const it of g.items) {
        if (it === '|') { row.append(h('span', { class: 'tb-sep', 'aria-hidden': 'true' })); continue; }
        const spec = typeof it === 'string' ? { id: it } : it;
        const a = this.actions.get(spec.id);
        if (!a) continue;
        if (a.options) { row.append(this._select(a)); continue; }
        const b = h('button', {
          class: `tb-btn${spec.label ? ' labeled' : ''}${spec.primary ? ' primary' : ''}${a.tone ? ` tone-${a.tone}` : ''}`,
          type: 'button', 'aria-label': a.label,
        }, h('span', { class: 'tb-ico', html: TB[a.icon] || '' }), spec.label ? h('span', { class: 'tb-lbl' }, a.short || a.label) : null);
        b.addEventListener('click', () => { this._hideTip(); this.actions.run(a); });
        b.addEventListener('mouseenter', () => this._showTip(b, a));
        b.addEventListener('mouseleave', () => this._hideTip());
        b.addEventListener('focus', () => this._showTip(b, a));
        b.addEventListener('blur', () => this._hideTip());
        row.append(b);
        this.buttons.push({ b, a });
      }
      const cap = h('div', { class: 'tb-cap' }, h('span', {}, g.caption));
      let led = null;
      if (g.stage) {
        led = h('span', { class: 'tb-led', 'aria-hidden': 'true' });
        cap.prepend(led);
        this.leds.push({ led, cap, stage: g.stage, caption: g.caption });
      }
      this.el.append(h('div', { class: `tb-group${g.stage ? ' stage' : ''}${g.end ? ' view-group' : ''}`, role: 'group', 'aria-label': g.caption }, row, cap));
    }
    this.update();
    this.fit();
  }

  /** Elenco a discesa: la prima voce è il titolo, scegliendo un'opzione si esegue l'azione. */
  _select(a) {
    const s = h('select', { class: `tb-select${a.tone ? ` tone-${a.tone}` : ''}`, 'aria-label': a.label },
      h('option', { value: '' }, `${a.label}…`),
      a.options.map(o => h('option', { value: o.value }, o.label)));
    s.addEventListener('change', () => {
      const v = s.value;
      s.value = '';
      if (v) { this._hideTip(); this.actions.pick(a, v); }
    });
    const wrap = h('span', { class: 'tb-select-wrap' }, h('span', { class: 'tb-ico', html: TB[a.icon] || '' }), s);
    wrap.addEventListener('mouseenter', () => this._showTip(wrap, a, s.disabled));
    wrap.addEventListener('mouseleave', () => this._hideTip());
    this.selects.push({ s, a, wrap });
    return wrap;
  }

  /** Aggiorna abilitazione, stati attivi e spie delle fasi. */
  update() {
    for (const { b, a } of this.buttons) {
      const en = this.actions.isEnabled(a);
      b.disabled = !en;
      const on = a.checked ? this.actions.isChecked(a) : null;
      if (on === null) b.removeAttribute('aria-pressed');
      else b.setAttribute('aria-pressed', String(on));
      b.classList.toggle('on', !!on);
    }
    for (const { s, a, wrap } of this.selects) {
      const en = this.actions.isEnabled(a);
      s.disabled = !en;
      wrap.classList.toggle('disabled', !en);
    }
    for (const x of this.leds) {
      const st = this.stageOf(x.stage);
      x.led.dataset.state = st.state;
      x.cap.title = `${x.caption}: ${st.tip}`;
    }
  }

  _showTip(b, a, disabled = b.disabled) {
    const tt = this.tip;
    if (!tt) return;
    tt.innerHTML = '';
    tt.append(h('div', { class: 'tt-row' }, h('b', {}, a.label), a.kbd ? h('kbd', {}, a.kbd) : null));
    if (a.hint) tt.append(h('div', { class: 'tt-hint' }, a.hint));
    if (disabled) tt.append(h('div', { class: 'tt-hint tt-off' }, a.id.startsWith('plane.') && a.id !== 'plane.add'
      ? t('Premi prima "Aggiungi piano"') : a.id.startsWith('tool.') ? t('Disponibile durante la modifica di uno sketch') : t('Non disponibile ora')));
    tt.hidden = false;
    const rc = b.getBoundingClientRect();
    const w = tt.offsetWidth;
    tt.style.left = `${Math.max(6, Math.min(window.innerWidth - w - 6, rc.left + rc.width / 2 - w / 2))}px`;
    tt.style.top = `${rc.bottom + 8}px`;
  }

  _hideTip() {
    if (this.tip) this.tip.hidden = true;
  }
}
