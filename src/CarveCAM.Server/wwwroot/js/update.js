// Aggiornamenti: tutto passa da qui, cioè solo quando l'app è aperta. All'apertura si cerca una versione nuova e
// si avvisa; scaricare e installare si fa a comando da Info › Aggiornamenti. Il server non contatta GitHub da solo.
// Il pacchetto scaricato si verifica con l'SHA256 e si installa solo con «Riavvia e installa ora».
import { api } from './api.js';
import { App } from './state.js';
import { modal, toast, confirmBox, h } from './dialogs.js';
import { settings } from './settings.js';
import { t } from './i18n.js';
import { log } from './log.js';

const sleep = ms => new Promise(r => setTimeout(r, ms));
const pct = s => (s.total > 0 ? Math.min(100, Math.floor((s.downloaded / s.total) * 100)) : 0);

/** Aspetta la fine dello scaricamento (pronto o errore); onTick riceve ogni stato intermedio. */
async function waitDownload(s, onTick) {
  const t0 = Date.now();
  while (s.state === 'downloading' && Date.now() - t0 < 15 * 60 * 1000) {
    await sleep(1000);
    s = await api.updateStatus();
    onTick?.(s);
  }
  return s;
}

/**
 * All'apertura dell'app, se non è spento nelle opzioni: cerca una versione nuova e, se c'è, avvisa. Non scarica né
 * installa nulla. Offline o senza risposta di GitHub non compare niente (solo il log): le officine spesso sono scollegate.
 */
export async function checkOnStartup() {
  if (settings.autoUpdate === false) return;
  try {
    const s = await api.updateCheck();
    if (s.supported && s.enabled && s.available) toast(t('È disponibile CarveCAM {v}: aprila da Info › Aggiornamenti', { v: s.latest }), 'info', 9000);
  } catch (e) {
    log.info('Controllo aggiornamenti non riuscito', { msg: e.message });
  }
}

/** Info › Aggiornamenti: stato, note della versione nuova e pulsanti per cercarla, scaricarla e installarla. */
export function openUpdates() {
  const body = h('div', { class: 'upd', style: { minWidth: '340px' } });
  let s = { supported: true, enabled: true, current: '', state: 'checking' };
  let closed = false;
  let working = false;   // un'operazione in corso: i pulsanti restano spenti

  const line = (text, opts = {}) => h('p', { class: opts.note ? 'p-note' : undefined, style: { margin: '0 0 8px', color: opts.err ? 'var(--danger)' : undefined } }, text);
  const btn = (label, fn, primary) => h('button', { class: `btn${primary ? ' primary' : ''}`, type: 'button', disabled: working, onclick: fn }, label);

  function render() {
    const kids = [line(t('Versione in uso: {v}', { v: s.current }))];
    const act = [];
    if (!s.supported) kids.push(line(t('Gli aggiornamenti automatici funzionano solo con il pacchetto per Windows. Le nuove versioni si scaricano da GitHub.'), { note: true }));
    else if (!s.enabled) kids.push(line(t('Gli aggiornamenti automatici sono spenti in appsettings.json (Update:Enabled).'), { note: true }));
    else {
      if (s.state === 'checking') kids.push(line(t('Controllo in corso…')));
      else if (s.state === 'downloading') kids.push(line(t('Scaricamento della versione {v}: {p} %', { v: s.latest, p: pct(s) })));
      else if (s.state === 'ready') {
        kids.push(line(t('La versione {v} è pronta e verificata. Riavvia CarveCAM per installarla.', { v: s.latest })));
        act.push(btn(t('Riavvia e installa ora'), restart, true));
      } else if (s.available) {
        kids.push(line(t('È disponibile la versione {v}.', { v: s.latest })));
        if (s.canInstall) {
          kids.push(line(t('Si scarica e si verifica adesso; l\'installazione parte solo quando premi «Riavvia e installa ora».'), { note: true }));
          act.push(btn(t('Scarica'), download, true));
        } else kids.push(line(t('Questa installazione non si aggiorna da sola (cartella non scrivibile o pacchetto non verificabile): scarica la nuova versione da GitHub.'), { note: true }));
      } else if (s.checkedAt) kids.push(line(t('CarveCAM è aggiornato.')));
      if (s.state === 'error' && s.lastError) kids.push(line(t('Errore: {msg}', { msg: s.lastError }), { err: true }));
      if (s.available && s.notes) {
        kids.push(h('div', { class: 'p-sec' }, t('Note della versione')),
          h('div', { style: { maxHeight: '200px', overflow: 'auto', whiteSpace: 'pre-wrap', fontSize: '12px', margin: '0 0 8px' } }, s.notes));
      }
      if (s.available && s.pageUrl) kids.push(h('p', { style: { margin: '0 0 8px' } }, h('a', { href: s.pageUrl, target: '_blank', rel: 'noopener' }, t('Apri la pagina della versione su GitHub'))));
      if (s.state !== 'downloading') act.push(btn(t('Cerca aggiornamenti'), () => check(true)));
    }
    kids.push(h('div', { class: 'p-buttons', style: { padding: '4px 0 0' } }, ...act));
    body.replaceChildren(...kids);
  }

  async function run(fn) {
    working = true; render();
    try { await fn(); }
    catch (e) { s = { ...s, state: 'error', lastError: t('Impossibile contattare GitHub: {msg}', { msg: e.message }) }; }
    finally { working = false; if (!closed) render(); }
  }

  const check = force => run(async () => { s = { ...s, state: 'checking' }; render(); s = await api.updateCheck(force); });
  const download = () => run(async () => {
    s = await api.updateDownload(); render();
    s = await waitDownload(s, st => { s = st; if (!closed) render(); });
  });

  async function restart() {
    const dirty = App.dirty ? ` ${t('Ci sono modifiche non salvate nel progetto: salvalo prima.')}` : '';
    if (!(await confirmBox(t('Riavvia e installa'), t('CarveCAM si chiude e si riapre con la versione {v}; il progetto aperto resta nel browser.', { v: s.latest }) + dirty, t('Riavvia')))) return;
    working = true;
    body.replaceChildren(line(t('Riavvio in corso…')));
    try {
      await api.updateRestart();
      for (let i = 0; i < 120; i++) {
        await sleep(1000);
        try {
          const v = (await (await fetch('/api/version', { cache: 'no-store' })).json()).version || '';
          if (v.split('+')[0] !== s.current) { location.reload(); return; }
        } catch { /* il server è fermo: sta ripartendo */ }
      }
      body.replaceChildren(line(t('Il riavvio non è riuscito: controlla la finestra nera e il file di log.'), { err: true }));
    } catch (e) {
      // es. il file scaricato non c'è più: si torna alla schermata con lo stato e il motivo
      working = false;
      try { s = await api.updateStatus(); } catch { s = { ...s, state: 'error', lastError: e.message }; }
      render();
    }
  }

  modal({ title: t('Aggiornamenti'), body, buttons: [{ label: t('Chiudi'), value: true, primary: true }] }).then(() => { closed = true; });
  render();
  (async () => {
    try {
      s = await api.updateStatus();
      render();
      if (s.state === 'downloading') { await download(); return; }
      if (s.supported && s.enabled && s.state === 'idle') await check(false);
    } catch (e) { s = { ...s, state: 'error', lastError: e.message }; if (!closed) render(); }
  })();
}
