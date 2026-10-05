// Lingua dell'interfaccia. I testi nel codice sono in italiano e fanno da chiave: t() li traduce
// nella lingua scelta nelle opzioni (cambiandola si ricarica la pagina).
import { settings } from './settings.js';
import { EN } from './i18n-en.js';

export const LANGS = [['it', 'Italiano'], ['en', 'English']];
export const LANG = settings.lang === 'en' ? 'en' : 'it';
export const LOCALE = LANG === 'en' ? 'en-GB' : 'it-IT';
const DICT = LANG === 'en' ? EN : null;

/** Traduce un testo; {nome} viene sostituito con vars.nome. */
export function t(s, vars) {
  let r = DICT ? (DICT[s] ?? s) : s;
  if (vars) r = r.replace(/\{(\w+)\}/g, (m, k) => (vars[k] ?? m));
  return r;
}

/** Numero formattato secondo la lingua. */
export function num(v, opts) {
  return Number(v).toLocaleString(LOCALE, opts);
}

const ATTRS = ['title', 'aria-label', 'placeholder', 'data-hint'];

/** Traduce i testi statici della pagina (index.html). */
export function translateDom(root = document.body) {
  document.documentElement.lang = LANG;
  if (!DICT) return;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);
  for (const n of nodes) {
    const s = n.nodeValue.trim();
    if (s && DICT[s]) n.nodeValue = n.nodeValue.replace(s, DICT[s]);
  }
  for (const el of root.querySelectorAll('*')) {
    for (const a of ATTRS) {
      const v = el.getAttribute(a);
      if (v && DICT[v]) el.setAttribute(a, DICT[v]);
    }
  }
}
