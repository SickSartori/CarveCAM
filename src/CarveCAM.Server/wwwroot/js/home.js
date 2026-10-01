// Schermata iniziale: all'avvio, al posto dell'area di lavoro vuota, le azioni per cominciare (nuovo progetto,
// apri, importa, esempio), il progetto da riprendere con la sua anteprima, i progetti recenti e i collegamenti
// alla guida. Si riapre da File › Schermata iniziale o con un clic sul logo; nelle opzioni si sceglie se
// mostrarla all'avvio. Mentre è aperta la vista 3D non viene disegnata.
import { App } from './state.js';
import { settings, applySettings } from './settings.js';
import { h } from './dialogs.js';
import { TB } from './icons.js';
import { t, LOCALE, LANG } from './i18n.js';
import { log } from './log.js';
import { flowStrip, GUIDE_SEEN_KEY } from './guide.js';

const hasContent = p => !!p && (p.objects.length + p.artifacts.length + p.planes.length + p.operations.length) > 0;

export class HomeScreen {
  /**
   * @param cmd comandi (nuovo, apri, importa, esempio, recenti…)
   * @param vp vista 3D (anteprima del progetto aperto, pausa del disegno)
   * @param openGuide apre la guida a un capitolo
   */
  constructor({ cmd, vp, openGuide }) {
    this.cmd = cmd;
    this.vp = vp;
    this.openGuide = openGuide;
    this.el = null;
    this.version = '';
    fetch('/api/version').then(r => r.json()).then(j => { this.version = j.version || ''; this._ver(); }).catch(() => {});
    // un'attività lunga (calcolo, apertura, importazione) o un "Mostrami" della guida portano all'area di lavoro
    window.addEventListener('carvecam:workspace', () => this.hide());
    document.addEventListener('keydown', e => {
      if (!this.isOpen || document.querySelector('#modal-root .backdrop')) return;
      if (e.key === 'Escape') { e.preventDefault(); this.hide(); }
    });
  }

  get isOpen() { return !!this.el && !this.el.classList.contains('out'); }

  /** Mostra la schermata iniziale (startup: all'avvio, sotto la schermata di caricamento che sfuma). */
  async show({ startup = false } = {}) {
    if (this.isOpen) return;
    const recent = await this.cmd.recentProjects().catch(() => []);
    // anteprima del progetto aperto, prima di fermare il disegno della vista
    const p = App.project;
    const thumb = hasContent(p) ? this.vp.snapshot(480, 300, true) : null;
    this.el?.remove();
    this.el = this._build({ recent, thumb, startup });
    document.body.append(this.el);
    this.vp.paused = true;
    requestAnimationFrame(() => this.el?.classList.add('in'));
    setTimeout(() => this.el?.querySelector('.home-tile')?.focus({ preventScroll: true }), startup ? 500 : 60);
    log.info('Schermata iniziale', { startup, recent: recent.length });
  }

  hide() {
    if (!this.isOpen) return;
    const el = this.el;
    el.classList.add('out');
    el.classList.remove('in');
    this.vp.paused = false;
    setTimeout(() => { el.remove(); if (this.el === el) this.el = null; }, 320);
  }

  _ver() {
    const v = this.el?.querySelector('.home-ver');
    if (v) v.textContent = this.version ? `${t('Versione')} ${this.version}` : '';
  }

  /** Esegue un'azione che porta all'area di lavoro: se va a buon fine la schermata si chiude. */
  async _go(fn) {
    try {
      if (await fn()) this.hide();
    } catch (e) { log.error('Azione dalla schermata iniziale non riuscita', e); }
  }

  _build({ recent, thumb, startup }) {
    const p = App.project;
    const cmd = this.cmd;
    const tile = (icon, title, sub, onclick, cls = '') => h('button', { class: `home-tile ${cls}`, type: 'button', onclick },
      h('span', { class: 'home-tile-ico', html: TB[icon] || '' }),
      h('span', { class: 'home-tile-txt' }, h('span', { class: 'home-tile-t' }, title), h('span', { class: 'home-tile-s' }, sub)));
    const link = (icon, label, onclick) => h('button', { class: 'home-link', type: 'button', onclick },
      h('span', { class: 'home-link-ico', html: TB[icon] || '' }), label);

    let seen = false;
    try { seen = !!localStorage.getItem(GUIDE_SEEN_KEY); } catch { /* storage non disponibile */ }

    const start = h('section', { class: 'home-col home-start' },
      h('h2', {}, t('Inizia')),
      h('div', { class: 'home-tiles' },
        tile('new', t('Nuovo progetto'), t('Area di lavoro vuota'), () => this._go(() => cmd.newProject())),
        tile('open', t('Apri progetto…'), t('File .ccam salvato · Ctrl+O'), () => this._go(() => cmd.openProject())),
        tile('import', t('Importa modello 3D…'), t('STL, OBJ, STEP, IGES, 3MF…'), () => this._go(() => cmd.importModel())),
        tile('demo', t('Progetto di esempio'), t('Targa con rilievo, pronta da simulare'), () => this._go(() => cmd.demoProject()), 'accent')),
      h('h2', {}, t('Impara')),
      seen ? null : h('button', { class: 'home-first', type: 'button', onclick: () => this.openGuide('start') },
        h('span', { class: 'home-first-ico', html: TB.help }),
        h('span', {}, h('b', {}, t('Prima volta con CarveCAM?')), h('span', {}, t('La guida spiega in pochi minuti come si passa dal modello al G-code.')))),
      h('div', { class: 'home-links' },
        link('help', t('Guida di CarveCAM'), () => this.openGuide(seen ? undefined : 'start')),
        link('keyboard', t('Scorciatoie da tastiera'), () => cmd.shortcuts())),
      h('div', { class: 'home-flow-wrap' }, h('div', { class: 'home-flow-cap' }, t('Il flusso di lavoro')), flowStrip(id => this.openGuide(id))));

    const right = h('section', { class: 'home-col home-recent' });
    if (hasContent(p)) {
      const n = (k, one, many) => (p[k].length ? t(p[k].length === 1 ? one : many, { n: p[k].length }) : null);
      const counts = [n('objects', '1 modello', '{n} modelli'), n('artifacts', '1 artefatto', '{n} artefatti'), n('planes', '1 piano', '{n} piani'), n('operations', '1 lavorazione', '{n} lavorazioni')].filter(Boolean).join(' · ');
      right.append(h('h2', {}, startup ? t('Riprendi il lavoro') : t('Progetto aperto')),
        h('button', { class: 'home-resume', type: 'button', onclick: () => this.hide() },
          thumb ? h('img', { class: 'home-resume-img', src: thumb, alt: '' }) : h('span', { class: 'home-resume-img empty', html: TB.box }),
          h('span', { class: 'home-resume-txt' },
            h('span', { class: 'home-resume-name' }, p.name || t('Progetto')),
            h('span', { class: 'home-resume-sub' }, App.fileName || (startup ? t('Ultimo progetto aperto in questo browser') : t('Non ancora salvato'))),
            h('span', { class: 'home-resume-sub' }, counts),
            App.dirty ? h('span', { class: 'home-resume-dirty' }, t('Modifiche non salvate')) : null,
            h('span', { class: 'home-resume-go' }, `${t('Continua')} ›`))));
    } else {
      // nessun progetto aperto: l'esempio in evidenza, con l'immagine della sua simulazione
      right.append(h('h2', {}, t('Prova subito')),
        h('button', { class: 'home-hero', type: 'button', onclick: () => this._go(() => cmd.demoProject()) },
          h('img', { src: `img/guide/${LANG}/hero.webp`, alt: '', onerror: e => { e.target.remove(); } }),
          h('span', { class: 'home-hero-txt' },
            h('b', {}, t('Progetto di esempio')),
            h('span', {}, t('Una targa con logo e scritta in rilievo: sgrossatura, finitura e ripresa con fresa conica, calcolate e pronte da simulare.')),
            h('span', { class: 'home-resume-go' }, `${t('Apri l\'esempio')} ›`))));
    }
    right.append(h('h2', {}, t('Progetti recenti')));
    if (!recent.length) {
      right.append(h('div', { class: 'home-empty' }, t('Nessun progetto recente: i progetti aperti o salvati compariranno qui.')));
    } else {
      const listEl = h('div', { class: 'home-list' });
      for (const e of recent) {
        const when = new Date(e.time).toLocaleString(LOCALE, { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
        listEl.append(h('button', { class: 'home-rec', type: 'button', title: e.fileName || e.name, onclick: () => this._go(() => cmd.openRecent(e)) },
          e.thumb ? h('img', { class: 'home-rec-img', src: e.thumb, alt: '' }) : h('span', { class: 'home-rec-img empty', html: TB.open }),
          h('span', { class: 'home-rec-txt' }, h('span', { class: 'home-rec-name' }, e.name || e.fileName), h('span', { class: 'home-rec-sub' }, e.fileName || '')),
          h('span', { class: 'home-rec-when' }, when)));
      }
      right.append(listEl);
    }

    const show = h('input', { type: 'checkbox' });
    show.checked = settings.startScreen !== false;
    show.addEventListener('change', () => {
      applySettings({ ...settings, startScreen: show.checked });
      log.info('Schermata iniziale all\'avvio', { show: show.checked });
    });

    const srv = document.getElementById('srv-status');
    const el = h('div', { class: 'home', id: 'home', role: 'dialog', 'aria-modal': 'true', 'aria-label': t('Schermata iniziale di CarveCAM') },
      h('div', { class: 'home-bg', 'aria-hidden': 'true', html: BG }),
      h('div', { class: 'home-wrap' },
        h('header', { class: 'home-head' },
          h('img', { class: 'home-logo', src: 'favicon.svg', alt: '', width: 56, height: 56 }),
          h('div', { class: 'home-brand' }, h('div', { class: 'home-name' }, 'CarveCAM'), h('div', { class: 'home-tag' }, t('CAM per mini CNC: dal modello 3D al G-code'))),
          h('span', { class: 'grow' }),
          h('span', { class: 'home-ver' }),
          h('span', { class: 'home-srv', 'data-state': srv?.dataset.state || 'checking' }, h('span', { class: 'srv-dot' }), srv?.querySelector('.srv-lbl')?.textContent || '')),
        h('main', { class: 'home-main' }, start, right),
        h('footer', { class: 'home-foot' },
          h('label', { class: 'home-check' }, show, t('Mostra all\'avvio')),
          h('span', { class: 'grow' }),
          h('span', {}, t('Sviluppato da William Veronesi e Gabriel S. Sartori')),
          h('button', { class: 'home-link', type: 'button', onclick: () => cmd.about() }, t('Informazioni…')),
          h('button', { class: 'btn', type: 'button', onclick: () => this.hide() }, hasContent(p) ? t('Vai al progetto') : t('Vai all\'area di lavoro')))));
    setTimeout(() => this._ver(), 0);
    return el;
  }
}

// sfondo: passate concentriche di una svuotatura attorno a una forma, come nel logo
const BG = (() => {
  let paths = '';
  for (let i = 0; i < 14; i++) {
    const r = 120 + i * 46;
    paths += `<rect x="${980 - r}" y="${560 - r * 0.72}" width="${r * 2}" height="${r * 1.44}" rx="${Math.min(r * 0.6, 220)}" />`;
  }
  return `<svg viewBox="0 0 1600 1000" preserveAspectRatio="xMidYMid slice"><g fill="none" stroke="currentColor" stroke-width="1.2">${paths}</g></svg>`;
})();
