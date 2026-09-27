// Finestre modali, notifiche, barra di stato, indicatore di attività.

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
  const t = h('div', { class: `toast ${kind}` }, msg);
  document.getElementById('toast-root').append(t);
  setTimeout(() => t.remove(), ms);
}

export function status(msg, isErr = false) {
  const el = document.getElementById('st-msg');
  el.textContent = msg;
  el.classList.toggle('err', !!isErr);
}

/**
 * Finestra modale. buttons: [{ label, value, primary, danger }]. Ritorna una Promise con il value scelto
 * (null se chiusa con Esc o clic fuori).
 */
export function modal({ title, body, buttons = [{ label: 'OK', value: true, primary: true }], wide = false, onOpen }) {
  return new Promise(resolve => {
    const root = document.getElementById('modal-root');
    const content = typeof body === 'string' ? h('div', { html: body }) : body;
    const close = v => {
      document.removeEventListener('keydown', onKey, true);
      bd.remove();
      resolve(v);
    };
    const onKey = e => {
      if (e.key === 'Escape') { e.stopPropagation(); close(null); }
      if (e.key === 'Enter' && e.target.tagName !== 'TEXTAREA') {
        const p = buttons.find(b => b.primary);
        if (p) { e.preventDefault(); e.stopPropagation(); close(p.value); }
      }
    };
    const bd = h('div', { class: 'backdrop', onmousedown: e => { if (e.target === bd) close(null); } },
      h('div', { class: `modal${wide ? ' wide' : ''}`, role: 'dialog' },
        h('div', { class: 'modal-h' }, title),
        h('div', { class: 'modal-b' }, content),
        h('div', { class: 'modal-f' }, buttons.map(b =>
          h('button', { class: `btn${b.primary ? ' primary' : ''}${b.danger ? ' danger' : ''}`, onclick: () => close(b.value) }, b.label)))));
    root.append(bd);
    document.addEventListener('keydown', onKey, true);
    onOpen?.(bd);
    const first = bd.querySelector('input, select, textarea') || bd.querySelector('.btn.primary');
    first?.focus();
  });
}

export async function confirmBox(title, text, okLabel = 'OK') {
  return !!(await modal({
    title, body: h('div', {}, text),
    buttons: [{ label: 'Annulla', value: false }, { label: okLabel, value: true, primary: true }],
  }));
}

// ------------------------------------------------------------------ attività lunga con annullamento
let busyCtrl = null;
export function busy(text) {
  const el = document.getElementById('busy');
  document.getElementById('busy-text').textContent = text;
  el.hidden = false;
  busyCtrl = new AbortController();
  document.getElementById('busy-cancel').onclick = () => busyCtrl?.abort();
  return busyCtrl.signal;
}
export function busyText(text) {
  document.getElementById('busy-text').textContent = text;
}
export function idle() {
  document.getElementById('busy').hidden = true;
  busyCtrl = null;
}
