// Finestra delle opzioni: colori, dimensioni di frecce e cursori, lingua, griglia, tema chiaro/scuro.
// Le modifiche si vedono subito nella vista; Annulla ripristina i valori precedenti.
import { settings, DEFAULTS, THEME_COLORS, applySettings } from './settings.js';
import { modal, h, confirmBox } from './dialogs.js';
import { t, LANGS, LANG } from './i18n.js';
import { log } from './log.js';

const COLOR_ROWS = [
  ['background', 'Sfondo della vista', true],
  ['gridMinor', 'Griglia fine', true],
  ['gridMajor', 'Griglia principale', true],
  ['object', 'Oggetti importati (nuovi)'],
  ['artifact', 'Artefatti (nuovi)'],
  ['locked', 'Elementi bloccati'],
  ['selection', 'Evidenziazione selezione'],
  ['plane', 'Piani di lavoro'],
  ['normal', 'Frecce della normale'],
  ['sketch', 'Entità degli sketch'],
  ['entitySel', 'Entità selezionata'],
  ['feed', 'Percorso: lavoro'],
  ['plunge', 'Percorso: affondo'],
  ['ramp', 'Percorso: rampa ed elica'],
  ['rapid', 'Percorso: rapidi'],
  ['pivot', 'Pallini del riferimento manipolatore'],
];

export async function openOptions() {
  const original = structuredClone(settings);
  const work = structuredClone(settings);
  const preview = () => applySettings(work, false);

  const tabs = [
    ['colors', 'Colori'], ['sizes', 'Frecce e cursori'], ['lang', 'Lingua'], ['grid', 'Griglia'], ['look', 'Aspetto'],
  ];
  const tabBar = h('div', { class: 'opt-tabs', role: 'tablist' });
  const pane = h('div', { class: 'opt-pane' });
  let current = 'colors';

  const row = (label, ...field) => h('div', { class: 'form-row' }, h('label', {}, t(label)), h('div', { class: 'form-field' }, ...field));
  const numIn = (obj, key, { min, max, step = 1, unit } = {}) => {
    const inp = h('input', { type: 'number', value: obj[key], min, max, step, class: 'num' });
    inp.addEventListener('input', () => {
      const v = Number(inp.value);
      if (!Number.isFinite(v) || (min != null && v < min) || (max != null && v > max)) { inp.classList.add('bad'); return; }
      inp.classList.remove('bad');
      obj[key] = v;
      preview();
    });
    return [inp, unit ? h('span', { class: 'unit' }, unit) : null];
  };
  const range = (obj, key, min, max, step, fmtV) => {
    const out = h('span', { class: 'opt-val' }, fmtV(obj[key]));
    const inp = h('input', { type: 'range', min, max, step, value: obj[key] });
    inp.addEventListener('input', () => { obj[key] = Number(inp.value); out.textContent = fmtV(obj[key]); preview(); });
    return [inp, out];
  };

  const panes = {
    colors() {
      const list = h('div', { class: 'opt-colors' });
      for (const [key, label, auto] of COLOR_ROWS) {
        const inp = h('input', { type: 'color', value: work.colors[key] || (THEME_COLORS[work.theme] || THEME_COLORS.dark)[key] || '#888888' });
        const autoBox = auto ? h('input', { type: 'checkbox', title: t('Automatico secondo il tema') }) : null;
        if (autoBox) {
          autoBox.checked = !work.colors[key];
          inp.disabled = autoBox.checked;
          autoBox.addEventListener('change', () => {
            work.colors[key] = autoBox.checked ? '' : inp.value;
            inp.disabled = autoBox.checked;
            if (autoBox.checked) inp.value = (THEME_COLORS[work.theme] || THEME_COLORS.dark)[key];
            preview();
          });
        }
        inp.addEventListener('input', () => { work.colors[key] = inp.value; preview(); });
        list.append(h('div', { class: 'form-row' }, h('label', {}, t(label)),
          h('div', { class: 'form-field' }, inp, autoBox ? h('label', { class: 'opt-auto' }, autoBox, t('auto')) : null)));
      }
      const reset = h('button', { class: 'btn', type: 'button', onclick: () => { work.colors = structuredClone(DEFAULTS.colors); preview(); show('colors'); } }, t('Ripristina colori predefiniti'));
      return h('div', {}, list, h('div', { class: 'p-buttons', style: { padding: '8px 0 0' } }, reset),
        h('p', { class: 'p-note', style: { margin: '6px 0 0' } }, t('I colori di oggetti e artefatti valgono per i nuovi elementi; quelli esistenti si cambiano dalle loro proprietà.')));
    },
    sizes() {
      return h('div', {},
        row('Manipolatore', ...range(work.sizes, 'gizmo', 0.4, 2, 0.05, v => `${Math.round(v * 100)} %`)),
        row('Frecce della normale', ...range(work.sizes, 'normalArrow', 0.3, 3, 0.05, v => `${Math.round(v * 100)} %`)),
        row('Mirino dello sketch', ...range(work.sizes, 'cursor', 4, 40, 1, v => `${v} px`)),
        row('Pallini del riferimento', ...range(work.sizes, 'pivotDot', 6, 24, 1, v => `${v} px`)),
        h('p', { class: 'p-note' }, t('Le dimensioni del manipolatore e dei pallini sono costanti sullo schermo; le frecce della normale sono proporzionali al piano.')));
    },
    lang() {
      const sel = h('select', {}, LANGS.map(([v, l]) => h('option', { value: v }, l)));
      sel.value = work.lang;
      sel.addEventListener('change', () => { work.lang = sel.value; });
      return h('div', {}, row('Lingua dell\'interfaccia', sel),
        h('p', { class: 'p-note' }, t('Il cambio di lingua ricarica l\'interfaccia (il progetto viene conservato).')));
    },
    grid() {
      const vis = h('input', { type: 'checkbox' });
      vis.checked = work.grid.visible !== false;
      vis.addEventListener('change', () => { work.grid.visible = vis.checked; preview(); });
      return h('div', {},
        row('Griglia visibile', vis),
        row('Dimensione', ...numIn(work.grid, 'size', { min: 10, max: 20000, step: 10, unit: 'mm' })),
        row('Passo griglia fine', ...numIn(work.grid, 'minor', { min: 0.1, max: 1000, step: 1, unit: 'mm' })),
        row('Passo griglia principale', ...numIn(work.grid, 'major', { min: 1, max: 5000, step: 5, unit: 'mm' })),
        row('Aggancio sketch predefinito', ...numIn(work.grid, 'snapStep', { min: 0.01, max: 100, step: 0.5, unit: 'mm' })),
        h('p', { class: 'p-note' }, t('La griglia è disegnata sul piano XY del progetto; il passo di aggancio si può cambiare anche nella barra dello sketch.')));
    },
    look() {
      const mk = (val, label) => {
        const r = h('input', { type: 'radio', name: 'opt-theme', value: val });
        r.checked = work.theme === val;
        r.addEventListener('change', () => { work.theme = val; preview(); });
        return h('label', { class: 'opt-radio' }, r, t(label));
      };
      return h('div', {}, row('Modalità', h('div', { class: 'opt-radios' }, mk('dark', 'Scura'), mk('light', 'Chiara'))),
        h('p', { class: 'p-note' }, t('Lo sfondo della vista e la griglia seguono il tema se nei colori sono impostati su "auto".')));
    },
  };

  const show = id => {
    current = id;
    for (const b of tabBar.children) b.setAttribute('aria-selected', String(b.dataset.tab === id));
    pane.replaceChildren(panes[id]());
  };
  for (const [id, label] of tabs) {
    const b = h('button', { class: 'opt-tab', type: 'button', role: 'tab', 'data-tab': id }, t(label));
    b.addEventListener('click', () => show(id));
    tabBar.append(b);
  }
  show(current);

  const res = await modal({
    title: t('Opzioni'), body: h('div', { class: 'opt' }, tabBar, pane), size: 'wide', enter: false,
    buttons: [
      { label: t('Ripristina tutto'), value: 'reset', left: true },
      { label: t('Annulla'), value: false },
      { label: t('OK'), value: true, primary: true },
    ],
  });
  if (res === 'reset') {
    if (await confirmBox(t('Opzioni'), t('Ripristinare tutte le opzioni ai valori predefiniti?'), t('Ripristina'))) {
      const keepLang = original.lang;
      applySettings({ ...structuredClone(DEFAULTS), lang: keepLang });
      log.info('Opzioni ripristinate ai valori predefiniti');
    } else applySettings(original, false);
    return;
  }
  if (!res) { applySettings(original, false); return; }
  applySettings(work);
  log.info('Opzioni salvate', { theme: work.theme, lang: work.lang });
  if (work.lang !== LANG) {
    if (await confirmBox(t('Lingua'), t('Ricaricare ora l\'interfaccia nella nuova lingua?'), t('Ricarica'))) location.reload();
  }
}
