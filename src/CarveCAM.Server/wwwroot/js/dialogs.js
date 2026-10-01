// Finestre modali, notifiche, barra di stato, indicatore di attività.
import { t } from './i18n.js';
import { log } from './log.js';

export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'html') el.innerHTML = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

export function toast(msg, kind = 'info', ms = 3800) {
  if (kind === 'err') log.warn(`Messaggio di errore: ${msg}`);
  const el = h('div', { class: `toast ${kind}` }, msg);
  document.getElementById('toast-root').append(el);
  setTimeout(() => el.remove(), ms);
}

export function status(msg, isErr = false) {
  const el = document.getElementById('st-msg');
  el.textContent = msg;
  el.classList.toggle('err', !!isErr);
}

/**
 * Finestra modale. buttons: [{ label, value, primary, danger, left }]. Ritorna una Promise con il value scelto
 * (null se chiusa con Esc o clic fuori). size: '' | 'wide' | 'xl'; enter: Invio preme il pulsante principale.
 * close: funzione passata a onOpen per chiudere la finestra con un valore.
 */
export function modal({ title, body, buttons = [{ label: t('OK'), value: true, primary: true }], wide = false, size = '', enter = true, onOpen, cls = '' }) {
  return new Promise(resolve => {
    const root = document.getElementById('modal-root');
    const content = typeof body === 'string' ? h('div', { html: body }) : body;
    const close = v => {
      document.removeEventListener('keydown', onKey, true);
      bd.remove();
      resolve(v);
    };
    const onKey = e => {
      if (!root.lastElementChild || root.lastElementChild !== bd) return;   // solo la finestra più in alto
      if (e.key === 'Escape') { e.stopPropagation(); close(null); }
      if (enter && e.key === 'Enter' && e.target.tagName !== 'TEXTAREA' && e.target.tagName !== 'BUTTON') {
        const p = buttons.find(b => b.primary);
        if (p) { e.preventDefault(); e.stopPropagation(); close(p.value); }
      }
    };
    const sz = size || (wide ? 'wide' : '');
    const left = buttons.filter(b => b.left);
    const right = buttons.filter(b => !b.left);
    const btn = b => h('button', { class: `btn${b.primary ? ' primary' : ''}${b.danger ? ' danger' : ''}`, type: 'button', onclick: () => close(b.value) }, b.label);
    const bd = h('div', { class: 'backdrop', onmousedown: e => { if (e.target === bd) close(null); } },
      h('div', { class: `modal${sz ? ` ${sz}` : ''}${cls ? ` ${cls}` : ''}`, role: 'dialog', 'aria-label': typeof title === 'string' ? title : null },
        h('div', { class: 'modal-h' }, title),
        h('div', { class: 'modal-b' }, content),
        h('div', { class: 'modal-f' }, left.map(btn), left.length ? h('span', { class: 'grow' }) : null, right.map(btn))));
    root.append(bd);
    document.addEventListener('keydown', onKey, true);
    onOpen?.(bd, close);
    // fuoco dopo il tasto che ha aperto la finestra: un Invio in corso non deve premere il pulsante principale
    const opened = performance.now();
    bd.addEventListener('click', e => {
      if (performance.now() - opened < 250 && e.target.closest('.modal-f') && e.detail === 0) { e.stopPropagation(); e.preventDefault(); }
    }, true);
    setTimeout(() => {
      if (!bd.isConnected) return;
      const first = bd.querySelector('[autofocus]') || bd.querySelector('.modal-b input, .modal-b select, .modal-b textarea') || bd.querySelector('.btn.primary');
      first?.focus();
    }, 0);
  });
}

export async function confirmBox(title, text, okLabel = t('OK'), cancelLabel = t('Annulla')) {
  return !!(await modal({
    title, body: h('div', {}, text),
    buttons: [{ label: cancelLabel, value: false }, { label: okLabel, value: true, primary: true }],
  }));
}

// ------------------------------------------------------------------ attività lunga con annullamento
let busyCtrl = null;
let busyT0 = 0;
let busyTimer = null;

/** Tempo trascorso: "12 s", "1:05". */
function elapsed(s) {
  return s < 60 ? `${Math.floor(s)} s` : `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
}

/** Attività in corso: logo animato, testo e tempo trascorso (dopo 2 s); ritorna il segnale per annullarla. */
export function busy(text) {
  const el = document.getElementById('busy');
  document.getElementById('busy-text').textContent = text;
  const timeEl = document.getElementById('busy-time');
  timeEl.textContent = '';
  el.hidden = false;
  busyCtrl = new AbortController();
  busyT0 = performance.now();
  clearInterval(busyTimer);
  busyTimer = setInterval(() => {
    const s = (performance.now() - busyT0) / 1000;
    if (s >= 2) timeEl.textContent = elapsed(s);
  }, 500);
  log.debug(`Attività: ${text}`);
  document.getElementById('busy-cancel').onclick = () => { log.info('Attività annullata dall\'utente', { text }); busyCtrl?.abort(); };
  return busyCtrl.signal;
}
export function busyText(text) {
  document.getElementById('busy-text').textContent = text;
}
export function idle() {
  document.getElementById('busy').hidden = true;
  clearInterval(busyTimer);
  busyTimer = null;
  if (busyCtrl) log.debug(`Attività conclusa in ${Math.round(performance.now() - busyT0)} ms`);
  busyCtrl = null;
}
