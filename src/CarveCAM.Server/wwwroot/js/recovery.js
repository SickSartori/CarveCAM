// Copie di sicurezza e recupero dopo una chiusura anomala.
// - Ogni scheda aperta tiene un "battito" in localStorage; alla chiusura regolare lo toglie. Se all'avvio resta
//   il battito di una sessione ferma da tempo, il programma non è stato chiuso correttamente (arresto del
//   browser o del sistema, scheda terminata…).
// - L'autosalvataggio locale (state.js) ricorda se c'erano modifiche non salvate.
// - Periodicamente, se ci sono modifiche, una copia del progetto viene salvata anche sul server
//   (App_Data/recovery), recuperabile da File › Copie di sicurezza.
import { App, flushAutosave } from './state.js';
import { api } from './api.js';
import { log } from './log.js';

const KEY = 'carvecam.sessions';
const BEAT_MS = 4000;
const STALE_MS = 15000;
const SERVER_COPY_MS = 60000;
const id = Math.random().toString(36).slice(2, 10);

function readSessions() {
  try { return JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch { return {}; }
}
function writeSessions(s) {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* storage non disponibile */ }
}

/**
 * Da chiamare all'avvio, prima di registrare la sessione corrente: vero se una sessione precedente
 * non è stata chiusa correttamente.
 */
export function previousSessionCrashed() {
  const s = readSessions();
  const now = Date.now();
  let crashed = false;
  for (const [k, v] of Object.entries(s)) {
    if (now - (v.beat || 0) > STALE_MS) { crashed = true; delete s[k]; }
  }
  writeSessions(s);
  if (crashed) log.warn('La sessione precedente non è stata chiusa correttamente');
  return crashed;
}

/** Registra la sessione corrente e avvia battito e copie periodiche sul server. */
export function startSession() {
  const beat = () => {
    const s = readSessions();
    s[id] = { beat: Date.now(), started: s[id]?.started || Date.now() };
    writeSessions(s);
  };
  beat();
  setInterval(beat, BEAT_MS);
  window.addEventListener('pagehide', () => {
    flushAutosave();
    const s = readSessions();
    delete s[id];
    writeSessions(s);
  });

  let lastSeq = -1;
  setInterval(async () => {
    if (!App.dirty || App.changeSeq === lastSeq || !App.project) return;
    const p = App.project;
    if (!p.objects.length && !p.artifacts.length && !p.planes.length) return;
    lastSeq = App.changeSeq;
    try { await api.saveRecovery(p, 'auto'); } catch (e) { log.warn('Copia di sicurezza sul server non riuscita', e); }
  }, SERVER_COPY_MS);
}
