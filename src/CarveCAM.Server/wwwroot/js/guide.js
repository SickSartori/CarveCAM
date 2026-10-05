// Guida di CarveCAM: capitoli a sinistra (con ricerca), contenuto con illustrazioni, schermate annotate e
// icone dei comandi. "Mostrami" chiude la guida, indica un elemento dell'interfaccia e la riapre al clic;
// i pulsanti d'azione eseguono un comando del programma (es. apri il progetto di esempio).
import { h, modal, toast } from './dialogs.js';
import { TB } from './icons.js';
import { t, LANG } from './i18n.js';
import { guidePages, L } from './guide-pages.js';
import { ART } from './guide-art.js';
import { shortcutRows } from './shortcuts.js';
import { log } from './log.js';

const PAGE_KEY = 'carvecam.guide.page';
export const GUIDE_SEEN_KEY = 'carvecam.guide.seen';
const SHOT_DIR = lang => `img/guide/${lang}`;

let runAction = () => {};
let shots = null;        // { nome: { w, h, marks: { n: [x, y, w, h] } } } delle schermate della lingua corrente
let shotLang = LANG;
let isOpen = false;

/** Collega la guida alle azioni del programma (registro di actions.js). */
export function initGuide({ run }) { runAction = run; }

export const guideOpen = () => isOpen;

/** Testo con [[icona]] e {{tasto}}: HTML (i testi sono quelli della guida, non dati dell'utente). */
function rich(s) {
  return String(s ?? '')
    .replace(/\[\[(\w+)\]\]/g, (m, k) => (TB[k] ? `<span class="g-ico" aria-hidden="true">${TB[k]}</span>` : ''))
    .replace(/\{\{([^}]+)\}\}/g, (m, k) => `<kbd>${k}</kbd>`);
}
const html = (tag, s, attrs = {}) => h(tag, { ...attrs, html: rich(s) });
const plain = s => String(s ?? '').replace(/<[^>]+>/g, ' ').replace(/\[\[\w+\]\]/g, ' ').replace(/\{\{([^}]+)\}\}/g, ' $1 ');

async function loadShots() {
  if (shots) return shots;
  for (const lang of [LANG, 'it']) {
    try {
      const r = await fetch(`${SHOT_DIR(lang)}/shots.json`);
      if (r.ok) { shots = await r.json(); shotLang = lang; return shots; }
    } catch { /* schermate non disponibili */ }
  }
  shots = {};
  return shots;
}

/** Testo semplice di un capitolo (per la ricerca). */
function pageText(pg) {
  const parts = [pg.title];
  for (const b of pg.blocks) {
    if (b.html) parts.push(b.html);
    if (b.text) parts.push(b.text);
    if (b.caption) parts.push(b.caption);
    for (const x of b.items || []) parts.push(typeof x === 'string' ? x : [x.title, x.html, x.label].filter(Boolean).join(' '));
    for (const c of b.callouts || []) parts.push(c.html);
    if (b.k === 'keys') for (const [k, v] of b.rows || shortcutRows()) parts.push(`${k} ${v}`);
  }
  return plain(parts.join(' ')).toLowerCase();
}

const FLOW = [
  ['model', 'import', () => L('Modello', 'Model')], ['planes', 'planeAdd', () => L('Piano', 'Plane')], ['sketch', 'sketchNew', () => L('Sketch', 'Sketch')],
  ['ops', 'pocket', () => L('Lavorazione', 'Operation')], ['compute', 'simulate', () => L('Calcolo', 'Compute')], ['gcode', 'gcode', () => L('G-code', 'G-code')],
];

/** Fasi del lavoro come sequenza di icone (anche nella schermata iniziale): onPick(idCapitolo). */
export function flowStrip(onPick) {
  const el = h('div', { class: 'g-flow', role: 'list' });
  FLOW.forEach(([page, icon, label], i) => {
    if (i) el.append(h('span', { class: 'g-flow-arr', 'aria-hidden': 'true' }, '›'));
    el.append(h('button', { class: 'g-flow-step', type: 'button', role: 'listitem', onclick: () => onPick(page), title: label() },
      h('span', { class: 'g-flow-ico', html: TB[icon] }), h('span', { class: 'g-flow-n' }, String(i + 1)), h('span', { class: 'g-flow-lbl' }, label())));
  });
  return el;
}

/**
 * Apre la guida al capitolo pageId (altrimenti all'ultimo letto). Ritorna quando la guida si chiude
 * (anche per "Mostrami" o per un'azione, che la riaprono o la lasciano chiusa).
 */
export async function openGuide(pageId, scrollTop = 0) {
  if (isOpen) return;
  isOpen = true;
  try { localStorage.setItem(GUIDE_SEEN_KEY, '1'); } catch { /* storage non disponibile */ }
  await loadShots();
  const pages = guidePages();
  let cur = pages.find(p => p.id === pageId) || pages.find(p => p.id === readPage()) || pages[0];
  let query = '';
  let closeFn = null;
  let after = null;   // cosa fare a guida chiusa: { show } | { action }

  const search = h('input', { class: 'g-search', type: 'search', placeholder: t('Cerca nella guida'), 'aria-label': t('Cerca nella guida') });
  const list = h('div', { class: 'g-list', role: 'tablist', 'aria-orientation': 'vertical' });
  const count = h('div', { class: 'g-count' });
  const article = h('article', { class: 'g-page', tabindex: '-1' });
  const texts = new Map(pages.map(p => [p.id, pageText(p)]));

  const terms = () => query.toLowerCase().split(/\s+/).filter(x => x.length >= 2);
  const matches = pg => { const tt = terms(); return !tt.length || tt.every(x => texts.get(pg.id).includes(x)); };

  const drawList = () => {
    list.replaceChildren();
    const found = pages.filter(matches);
    pages.forEach((pg, i) => {
      if (!found.includes(pg)) return;
      list.append(h('button', { class: `g-item${pg === cur ? ' on' : ''}`, type: 'button', role: 'tab', 'aria-selected': String(pg === cur), onclick: () => go(pg) },
        h('span', { class: 'g-item-n' }, String(i + 1)), h('span', { class: 'g-item-ico', html: TB[pg.icon] || '' }), h('span', { class: 'g-item-lbl' }, pg.nav || pg.title)));
    });
    count.textContent = terms().length ? (found.length ? t('{n} capitoli trovati', { n: found.length }) : t('Nessun capitolo trovato')) : '';
  };

  const go = (pg, top = 0) => {
    cur = pg;
    try { localStorage.setItem(PAGE_KEY, pg.id); } catch { /* storage non disponibile */ }
    drawList();
    article.replaceChildren(...renderPage(pg, pages, { go: id => go(pages.find(p => p.id === id) || pg), show: s => { after = { show: s }; closeFn?.(null); }, action: a => { after = { action: a }; closeFn?.(null); } }));
    if (terms().length) highlight(article, terms());
    article.scrollTop = top;
  };

  search.addEventListener('input', () => { query = search.value.trim(); drawList(); go(cur); });
  search.addEventListener('keydown', e => {
    if (e.key === 'Enter') { const f = pages.find(matches); if (f) go(f); e.preventDefault(); }
  });
  article.addEventListener('keydown', e => {
    const i = pages.indexOf(cur);
    if (e.key === 'PageDown' && e.altKey && i < pages.length - 1) go(pages[i + 1]);
    if (e.key === 'PageUp' && e.altKey && i > 0) go(pages[i - 1]);
  });

  const body = h('div', { class: 'g-wrap' }, h('nav', { class: 'g-nav' }, search, count, list), article);
  drawList();
  go(cur, scrollTop);
  log.info('Guida aperta', { page: cur.id });
  await modal({
    title: h('span', { class: 'g-title' }, h('span', { class: 'g-title-ico', html: TB.help }), t('Guida di CarveCAM')),
    body, size: 'xl', cls: 'guide', enter: false,
    buttons: [{ label: t('Chiudi'), value: null, primary: true }],
    onOpen: (bd, close) => { closeFn = close; setTimeout(() => article.focus({ preventScroll: true }), 0); },
  });
  isOpen = false;
  const top = article.scrollTop;
  if (after?.show) {
    await spotlight(after.show.sel, after.show.label);
    openGuide(cur.id, top);
  } else if (after?.action) {
    runAction(after.action);
  }
}

function readPage() {
  try { return localStorage.getItem(PAGE_KEY); } catch { return null; }
}

/** Evidenzia i termini cercati nel testo del capitolo. */
function highlight(root, terms) {
  const rx = new RegExp(`(${terms.map(x => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'gi');
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes = [];
  while (walker.nextNode()) if (!walker.currentNode.parentElement.closest('svg, kbd, button')) nodes.push(walker.currentNode);
  for (const n of nodes) {
    if (!rx.test(n.nodeValue)) continue;
    rx.lastIndex = 0;
    const frag = document.createDocumentFragment();
    let last = 0;
    n.nodeValue.replace(rx, (m, g, off) => {
      frag.append(n.nodeValue.slice(last, off), h('mark', {}, m));
      last = off + m.length;
      return m;
    });
    frag.append(n.nodeValue.slice(last));
    n.replaceWith(frag);
  }
}

// ------------------------------------------------------------------ capitolo
function renderPage(pg, pages, nav) {
  const i = pages.indexOf(pg);
  const out = [h('header', { class: 'g-head' },
    h('span', { class: 'g-head-ico', html: TB[pg.icon] || '' }),
    h('div', {}, h('div', { class: 'g-head-n' }, t('Capitolo {n} di {m}', { n: i + 1, m: pages.length })), h('h2', {}, pg.title)))];
  for (const b of pg.blocks) out.push(renderBlock(b, nav));
  const prev = pages[i - 1], next = pages[i + 1];
  out.push(h('footer', { class: 'g-pager' },
    prev ? h('button', { class: 'btn', type: 'button', onclick: () => nav.go(prev.id) }, `‹ ${prev.nav || prev.title}`) : h('span'),
    next ? h('button', { class: 'btn primary', type: 'button', onclick: () => nav.go(next.id) }, `${next.nav || next.title} ›`) : h('span')));
  return out;
}

function renderBlock(b, nav) {
  switch (b.k) {
    case 'p': return html('p', b.html);
    case 'h3': return html('h3', b.text);
    case 'ul': return h('ul', { class: 'g-ul' }, b.items.map(x => html('li', x)));
    case 'steps':
      return h('ol', { class: 'g-steps' }, b.items.map((x, n) => h('li', {},
        h('span', { class: 'g-step-n' }, String(n + 1)), h('span', { class: 'g-step-ico', html: TB[x.icon] || '' }), html('span', x.html, { class: 'g-step-t' }))));
    case 'grid':
      return h('div', { class: 'g-grid' }, b.items.map(x => h('div', { class: 'g-card' },
        h('span', { class: 'g-card-ico', html: TB[x.icon] || '' }), h('div', {}, html('div', x.title, { class: 'g-card-t' }), html('div', x.html, { class: 'g-card-d' })))));
    case 'art': return h('figure', { class: 'g-fig', html: ART[b.name] ? ART[b.name](L) : '' });
    case 'shot': return renderShot(b);
    case 'tip': return h('div', { class: 'g-tip' }, h('span', { class: 'g-tip-ico', html: TB.info }), html('div', b.html));
    case 'warn': return h('div', { class: 'g-tip warn' }, h('span', { class: 'g-tip-ico', html: TB.info }), html('div', b.html));
    case 'act':
      return h('div', { class: 'g-act' }, b.items.map(x => h('button', {
        class: `btn${x.action ? ' primary' : ''}`, type: 'button',
        onclick: () => (x.page ? nav.go(x.page) : x.show ? nav.show({ sel: x.show, label: x.label }) : nav.action(x.action)),
      }, x.icon && TB[x.icon] ? h('span', { class: 'g-btn-ico', html: TB[x.icon] }) : null, x.label)));
    case 'flow': return flowStrip(id => nav.go(id));
    case 'keys': {
      const rows = b.rows || shortcutRows();
      return h('table', { class: 'g-keys' }, rows.map(([k, v]) => h('tr', {}, h('td', {}, k.split(' / ').flatMap((x, j) => [j ? ' / ' : null, h('kbd', {}, x)]).filter(Boolean)), h('td', {}, v))));
    }
    default: return h('div');
  }
}

/** Schermata reale con i richiami numerati (riquadri da shots.json) e la legenda. */
function renderShot(b) {
  const info = shots?.[b.name];
  // immagini strette (es. il pannello delle proprietà): legenda accanto, non sotto
  const fig = h('figure', { class: `g-shot${info && info.w < 640 && b.callouts?.length ? ' side' : ''}` });
  if (!info) {
    fig.append(h('div', { class: 'g-shot-missing' }, t('Immagine non disponibile')));
  } else {
    const box = h('div', { class: 'g-shot-img', style: { aspectRatio: `${info.w} / ${info.h}`, maxWidth: `${info.w}px` } },
      h('img', { src: `${SHOT_DIR(shotLang)}/${b.name}.webp`, alt: plain(b.caption || ''), loading: 'lazy', width: info.w, height: info.h }));
    const marks = new Map();
    for (const c of b.callouts || []) {
      const r = info.marks?.[c.n];
      if (!r) continue;
      const [x, y, w, hh] = r;
      const pct = (v, d) => `${(v / d) * 100}%`;
      const frame = h('span', { class: 'g-box', style: { left: pct(x, info.w), top: pct(y, info.h), width: pct(w, info.w), height: pct(hh, info.h) } });
      const mark = h('span', { class: 'g-mark', style: { left: pct(x, info.w), top: pct(y, info.h) } }, String(c.n));
      box.append(frame, mark);
      marks.set(c.n, [frame, mark]);
    }
    box.addEventListener('click', () => box.classList.toggle('zoom'));
    box.title = t('Clic per ingrandire');
    fig.append(box);
    if (b.callouts?.length) {
      const legend = h('ol', { class: 'g-legend' });
      for (const c of b.callouts) {
        const li = h('li', {}, h('span', { class: 'g-legend-n' }, String(c.n)), html('span', c.html));
        const on = v => { for (const e of marks.get(c.n) || []) e.classList.toggle('hi', v); li.classList.toggle('hi', v); };
        li.addEventListener('mouseenter', () => on(true));
        li.addEventListener('mouseleave', () => on(false));
        for (const e of marks.get(c.n) || []) { e.addEventListener('mouseenter', () => on(true)); e.addEventListener('mouseleave', () => on(false)); }
        legend.append(li);
      }
      fig.append(legend);
    }
  }
  if (b.caption) fig.append(html('figcaption', b.caption));
  return fig;
}

// ------------------------------------------------------------------ "Mostrami"
/** Riflettore su un elemento dell'interfaccia con un'etichetta; si chiude con un clic o un tasto. */
export function spotlight(sel, label) {
  return new Promise(resolve => {
    // l'interfaccia deve essere visibile (la schermata iniziale si toglie)
    window.dispatchEvent(new Event('carvecam:workspace'));
    requestAnimationFrame(() => {
      const el = document.querySelector(sel);
      const r = el?.getBoundingClientRect();
      if (!r || (!r.width && !r.height)) { toast(t('Elemento non visibile in questo momento'), 'warn'); resolve(); return; }
      const pad = 6;
      const left = Math.max(2, r.left - pad), top = Math.max(2, r.top - pad);
      const w = Math.min(window.innerWidth - left - 2, r.width + pad * 2), hh = Math.min(window.innerHeight - top - 2, r.height + pad * 2);
      const ring = h('div', { class: 'g-spot', style: { left: `${left}px`, top: `${top}px`, width: `${w}px`, height: `${hh}px` } });
      const tipEl = h('div', { class: 'g-spot-tip' }, h('b', {}, label), h('span', {}, t('Clic o un tasto per tornare alla guida')));
      const layer = h('div', { class: 'g-spot-layer', role: 'dialog', 'aria-label': label }, ring, tipEl);
      document.body.append(layer);
      const below = top + hh + 12 + tipEl.offsetHeight < window.innerHeight;
      tipEl.style.top = `${below ? top + hh + 12 : Math.max(8, top - tipEl.offsetHeight - 12)}px`;
      tipEl.style.left = `${Math.max(8, Math.min(window.innerWidth - tipEl.offsetWidth - 8, left + w / 2 - tipEl.offsetWidth / 2))}px`;
      const done = () => {
        layer.remove();
        document.removeEventListener('keydown', onKey, true);
        resolve();
      };
      const onKey = e => { e.preventDefault(); e.stopPropagation(); done(); };
      setTimeout(() => {
        layer.addEventListener('pointerdown', e => { e.preventDefault(); done(); });
        document.addEventListener('keydown', onKey, true);
      }, 150);
    });
  });
}
