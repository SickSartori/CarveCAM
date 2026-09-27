// Barra strumenti ordinata come il flusso di lavoro CAM, con spia di stato per ogni fase.
import { h } from './dialogs.js';
import { TB } from './icons.js';

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
    this.leds = [];
    this.tip = document.getElementById('tooltip');
    this.render();
  }

  render() {
    this.el.innerHTML = '';
    this.buttons = [];
    this.leds = [];
    for (const g of this.groups) {
      if (g.end) this.el.append(h('div', { class: 'tb-spacer' }));
      const row = h('div', { class: 'tb-row' });
      for (const it of g.items) {
        if (it === '|') { row.append(h('span', { class: 'tb-sep', 'aria-hidden': 'true' })); continue; }
        const spec = typeof it === 'string' ? { id: it } : it;
        const a = this.actions.get(spec.id);
        if (!a) continue;
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
    for (const x of this.leds) {
      const st = this.stageOf(x.stage);
      x.led.dataset.state = st.state;
      x.cap.title = `${x.caption}: ${st.tip}`;
    }
  }

  _showTip(b, a) {
    const t = this.tip;
    if (!t) return;
    t.innerHTML = '';
    t.append(h('div', { class: 'tt-row' }, h('b', {}, a.label), a.kbd ? h('kbd', {}, a.kbd) : null));
    if (a.hint) t.append(h('div', { class: 'tt-hint' }, a.hint));
    if (b.disabled) t.append(h('div', { class: 'tt-hint' }, 'Non disponibile ora'));
    t.hidden = false;
    const rc = b.getBoundingClientRect();
    const w = t.offsetWidth;
    t.style.left = `${Math.max(6, Math.min(window.innerWidth - w - 6, rc.left + rc.width / 2 - w / 2))}px`;
    t.style.top = `${rc.bottom + 8}px`;
  }

  _hideTip() {
    if (this.tip) this.tip.hidden = true;
  }
}
