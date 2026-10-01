// Diagnostica: registro degli eventi del browser inviato al server (scritto nel file di log insieme a quello
// del server), errori non gestiti, blocchi dell'interfaccia e ultime azioni eseguite.

const ENDPOINT = '/api/log';
const FLUSH_MS = 2500;
const MAX_QUEUE = 500;
const BLOCK_MS = 1200;            // pausa del thread dell'interfaccia oltre la quale si registra un blocco
const SESSION = Math.random().toString(36).slice(2, 8);

const queue = [];
const recent = [];                // ultime azioni (contesto per errori e blocchi)
let timer = null;
let sending = false;

function safe(data) {
  if (data == null) return undefined;
  if (data instanceof Error) return { name: data.name, message: data.message, stack: String(data.stack || '').split('\n').slice(0, 8).join('\n') };
  try {
    const s = JSON.stringify(data, (k, v) => (typeof v === 'number' && !Number.isFinite(v) ? String(v) : v));
    return s && s.length > 4000 ? `${s.slice(0, 4000)}…` : JSON.parse(s ?? 'null');
  } catch { return String(data); }
}

function push(level, msg, data) {
  const e = { t: new Date().toISOString(), l: level, s: SESSION, m: String(msg), d: safe(data) };
  queue.push(e);
  if (queue.length > MAX_QUEUE) queue.splice(0, queue.length - MAX_QUEUE);
  if (level === 'error') flush();
  else if (!timer) timer = setTimeout(flush, FLUSH_MS);
}

async function flush() {
  clearTimeout(timer);
  timer = null;
  if (sending || !queue.length) return;
  const batch = queue.splice(0, queue.length);
  sending = true;
  try {
    await fetch(ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(batch), keepalive: true });
  } catch {
    // server non raggiungibile: si riprova più tardi (senza superare il limite della coda)
    queue.unshift(...batch.slice(-MAX_QUEUE / 2));
  } finally {
    sending = false;
    if (queue.length && !timer) timer = setTimeout(flush, FLUSH_MS * 4);
  }
}

export const log = {
  debug: (m, d) => push('debug', m, d),
  info: (m, d) => push('info', m, d),
  warn: (m, d) => push('warn', m, d),
  error(m, d) {
    const sd = safe(d);
    push('error', m, sd && typeof sd === 'object' && !Array.isArray(sd) ? { ...sd, recent: recent.slice(-10) } : { value: sd, recent: recent.slice(-10) });
  },
  /** Azione dell'utente (menu, barra strumenti, scorciatoie): tenuta anche come contesto. */
  action(id, d) {
    recent.push(`${new Date().toISOString().slice(11, 23)} ${id}`);
    if (recent.length > 30) recent.shift();
    push('info', `Azione: ${id}`, d);
  },
  flush,
  get recent() { return recent.slice(); },
};

// ------------------------------------------------------------------ errori non gestiti
window.addEventListener('error', e => {
  log.error(`Errore JavaScript: ${e.message}`, { file: e.filename, line: e.lineno, col: e.colno, stack: e.error?.stack });
});
window.addEventListener('unhandledrejection', e => {
  const r = e.reason;
  log.error(`Promise non gestita: ${r?.message || r}`, { stack: r?.stack });
});
for (const [lvl, fn] of [['error', console.error], ['warn', console.warn]]) {
  console[lvl] = (...args) => {
    fn.apply(console, args);
    try { push(lvl, `console.${lvl}: ${args.map(a => (a instanceof Error ? a.message : typeof a === 'string' ? a : JSON.stringify(a))).join(' ').slice(0, 800)}`); } catch { /* argomenti non serializzabili */ }
  };
}

// ------------------------------------------------------------------ blocchi dell'interfaccia
// un timer a cadenza fissa: se scatta molto in ritardo il thread dell'interfaccia era occupato
let expected = performance.now() + 250;
setInterval(() => {
  const now = performance.now();
  const lag = now - expected;
  expected = now + 250;
  if (lag > BLOCK_MS && document.visibilityState === 'visible') {
    log.warn(`Interfaccia bloccata per ${Math.round(lag)} ms`, { recent: recent.slice(-8) });
  }
}, 250);
try {
  new PerformanceObserver(list => {
    for (const e of list.getEntries()) {
      if (e.duration >= 400) log.debug(`Operazione lunga nel browser: ${Math.round(e.duration)} ms`, { last: recent[recent.length - 1] });
    }
  }).observe({ type: 'longtask', buffered: false });
} catch { /* longtask non supportato */ }

window.addEventListener('pagehide', () => {
  push('info', 'Pagina chiusa');
  if (queue.length && navigator.sendBeacon) {
    navigator.sendBeacon(ENDPOINT, new Blob([JSON.stringify(queue.splice(0, queue.length))], { type: 'application/json' }));
  }
});

push('info', 'Avvio interfaccia', { ua: navigator.userAgent, lang: navigator.language, screen: `${screen.width}x${screen.height}@${devicePixelRatio}` });
