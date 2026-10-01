// File di progetto: apertura e salvataggio con la File System Access API quando il browser la supporta
// (Chrome, Edge: Ctrl+S riscrive lo stesso file), altrimenti input file e download. Elenco dei progetti recenti
// in IndexedDB, con il riferimento al file e una copia del progetto per riaprirlo anche senza il file.
import { log } from './log.js';

const DB_NAME = 'carvecam';
const STORE = 'recent';
const MAX_RECENT = 5;
const PICKER_TYPES = [{ description: 'Progetto CarveCAM', accept: { 'application/zip': ['.ccam'] } }];

export const fsAccess = typeof window.showOpenFilePicker === 'function' && typeof window.showSaveFilePicker === 'function';

// ------------------------------------------------------------------ IndexedDB
function openDb() {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open(DB_NAME, 1);
    r.onupgradeneeded = () => { if (!r.result.objectStoreNames.contains(STORE)) r.result.createObjectStore(STORE, { keyPath: 'key' }); };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

async function tx(mode, fn) {
  const db = await openDb();
  try {
    return await new Promise((resolve, reject) => {
      const t = db.transaction(STORE, mode);
      const st = t.objectStore(STORE);
      let out;
      Promise.resolve(fn(st)).then(v => { out = v; });
      t.oncomplete = () => resolve(out);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error);
    });
  } finally { db.close(); }
}

const req2p = r => new Promise((resolve, reject) => { r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });

/** Progetti recenti, dal più recente: [{ key, name, fileName, time, handle?, snapshot }]. */
export async function recentList() {
  try {
    const all = await tx('readonly', st => req2p(st.getAll()));
    return (all || []).sort((a, b) => b.time - a.time).slice(0, MAX_RECENT);
  } catch (e) {
    log.warn('Elenco progetti recenti non disponibile', e);
    return [];
  }
}

/** Registra un progetto aperto o salvato tra i recenti. */
export async function addRecent({ name, fileName, handle, project }) {
  try {
    const key = (fileName || name || 'progetto').toLowerCase();
    const entry = { key, name: name || fileName, fileName: fileName || '', time: Date.now(), snapshot: JSON.stringify(project) };
    if (handle) entry.handle = handle;
    const all = (await tx('readonly', st => req2p(st.getAll()))) || [];
    // stesso file (riferimento) o stesso nome di file: una sola voce
    const drop = new Set();
    for (const e of all) {
      let same = e.key === key;
      if (!same && handle && e.handle?.isSameEntry) { try { same = await e.handle.isSameEntry(handle); } catch { /* ignora */ } }
      if (same) drop.add(e.key);
    }
    const keep = all.filter(e => !drop.has(e.key)).sort((a, b) => b.time - a.time);
    const del = [...drop, ...keep.slice(MAX_RECENT - 1).map(e => e.key)];
    await tx('readwrite', st => { for (const k of del) st.delete(k); st.put(entry); });
  } catch (e) {
    log.warn('Progetto recente non registrato', e);
  }
}

export async function removeRecent(key) {
  try { await tx('readwrite', st => { st.delete(key); }); } catch { /* ignora */ }
}

// ------------------------------------------------------------------ apertura e salvataggio
async function ensurePermission(handle, mode) {
  if (!handle?.queryPermission) return true;
  const opts = { mode };
  if ((await handle.queryPermission(opts)) === 'granted') return true;
  return (await handle.requestPermission(opts)) === 'granted';
}

/** Chiede un file di progetto: { file, handle } oppure null se annullato. */
export async function pickProjectFile() {
  if (fsAccess) {
    try {
      const [handle] = await window.showOpenFilePicker({
        types: [{ description: 'Progetto CarveCAM', accept: { 'application/octet-stream': ['.ccam', '.pcam', '.m3dz'] } }],
        excludeAcceptAllOption: false, multiple: false,
      });
      return { file: await handle.getFile(), handle };
    } catch (e) {
      if (e.name === 'AbortError') return null;
      log.warn('showOpenFilePicker non riuscito, uso input file', e);
    }
  }
  return new Promise(resolve => {
    const inp = document.getElementById('file-open');
    inp.value = '';
    inp.onchange = () => resolve(inp.files[0] ? { file: inp.files[0], handle: null } : null);
    inp.click();
  });
}

/** File di un progetto recente (chiede il permesso di lettura). */
export async function fileOfRecent(entry) {
  if (!entry.handle) return null;
  if (!(await ensurePermission(entry.handle, 'read'))) return null;
  return entry.handle.getFile();
}

/**
 * Scrive il progetto: sul file già associato (handle), altrimenti chiede dove salvarlo (saveAs) oppure,
 * senza File System Access API, lo scarica. getBlob() produce il contenuto (chiamata dopo la scelta del file,
 * che richiede il gesto dell'utente). Ritorna { handle, fileName } o null se annullato.
 */
export async function writeProjectFile(getBlob, suggestedName, handle, saveAs = false) {
  if (fsAccess) {
    let h = saveAs ? null : handle;
    try {
      if (h && !(await ensurePermission(h, 'readwrite'))) h = null;
      if (!h) h = await window.showSaveFilePicker({ suggestedName, types: PICKER_TYPES });
    } catch (e) {
      if (e.name === 'AbortError') return null;
      log.warn('Scelta del file non riuscita, uso il download', e);
      h = null;
    }
    if (h) {
      const blob = await getBlob();
      const w = await h.createWritable();
      await w.write(blob);
      await w.close();
      return { handle: h, fileName: h.name };
    }
  }
  const blob = await getBlob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = suggestedName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  return { handle: null, fileName: suggestedName };
}
