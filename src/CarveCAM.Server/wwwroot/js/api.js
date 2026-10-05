// Accesso alle API del server VB.NET (ogni chiamata viene registrata nel log di diagnostica).
import { log } from './log.js';

const SLOW_MS = 5000;

/** fetch con registrazione di esito e durata. */
async function req(url, opts = {}) {
  const t0 = performance.now();
  const method = opts.method || 'GET';
  try {
    const res = await fetch(url, opts);
    const ms = Math.round(performance.now() - t0);
    if (!res.ok) log.warn(`API ${method} ${url} -> ${res.status} in ${ms} ms`);
    else if (ms > SLOW_MS) log.warn(`API lenta: ${method} ${url} in ${ms} ms`);
    else log.debug(`API ${method} ${url} -> ${res.status} in ${ms} ms`);
    return res;
  } catch (e) {
    if (e.name === 'AbortError') log.info(`API ${method} ${url} annullata`);
    else log.error(`API ${method} ${url} non riuscita: ${e.message}`);
    throw e;
  }
}

async function check(res) {
  if (!res.ok) {
    let msg = `${res.status} ${res.statusText}`;
    let code = null;
    try {
      const j = await res.json();
      if (j && (j.error || j.title)) msg = j.error || j.title;
      code = j?.code || null;
    } catch { /* risposta non JSON */ }
    const err = new Error(msg);
    err.status = res.status;
    err.code = code;
    throw err;
  }
  return res;
}

async function postJson(url, body, signal) {
  return check(await req(url, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body), signal,
  }));
}

export const api = {
  async formats() {
    return (await check(await fetch('/api/mesh/formats'))).json();
  },

  /** Importazione con i lettori VB.NET del server (STL, OBJ, PLY, OFF). */
  async importFile(file) {
    const fd = new FormData();
    fd.append('file', file, file.name);
    return (await check(await req('/api/mesh/import', { method: 'POST', body: fd }))).json();
  },

  /** Upload di una triangle soup già convertita nel browser. */
  async uploadMesh(name, positions) {
    const res = await req(`/api/mesh/upload?name=${encodeURIComponent(name)}`, {
      method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: positions,
    });
    return (await check(res)).json();
  },

  async getMesh(id) {
    const buf = await (await check(await req(`/api/mesh/${encodeURIComponent(id)}`))).arrayBuffer();
    return new Float32Array(buf);
  },

  /** Faccia B-rep di ogni triangolo (modelli CAD). */
  async uploadFaces(id, faces) {
    await check(await req(`/api/mesh/${encodeURIComponent(id)}/faces`, {
      method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: faces,
    }));
  },

  /** Facce B-rep della mesh, oppure null se il modello non le ha (STL, OBJ…). */
  async getFaces(id) {
    const res = await req(`/api/mesh/${encodeURIComponent(id)}/faces`);
    if (res.status === 404) return null;
    return new Uint32Array(await (await check(res)).arrayBuffer());
  },

  /** Profilo per lo sketch dai triangoli proiettati: { shapes: [{ name, loops, area }], warnings }. */
  async profile(request, signal) {
    return (await postJson('/api/profile', request, signal)).json();
  },

  async compute(request, signal) {
    return (await postJson('/api/cam/compute', request, signal)).json();
  },

  /** Grezzo prima della lavorazione (per la simulazione dell'erosione): ArrayBuffer di StockMap.ToBinary. */
  async getStock(id) {
    return (await check(await req(`/api/cam/toolpath/${encodeURIComponent(id)}/stock`))).arrayBuffer();
  },

  async getToolpath(id) {
    const buf = await (await check(await req(`/api/cam/toolpath/${encodeURIComponent(id)}`))).arrayBuffer();
    const dv = new DataView(buf);
    const n = dv.getInt32(0, true);
    const positions = new Float32Array(buf.slice(4, 4 + n * 12));
    const types = new Uint8Array(buf.slice(4 + n * 12, 4 + n * 13));
    return { positions, types, count: n };
  },

  /** G-code e avvisi della macchina (corse, avanzamenti, giri): { text, warnings }. */
  async gcode(toolpathIds, options) {
    const res = await postJson('/api/cam/gcode', { toolpathIds, options });
    const w = res.headers.get('X-CarveCAM-Warnings');
    return { text: await res.text(), warnings: w ? decodeURIComponent(w).split('\n').filter(Boolean) : [] };
  },

  // ---------------------------------------------------------------- magazzino macchine
  async machinePresets() {
    return (await check(await req('/api/cam/machines/presets'))).json();
  },
  /** G-code di prova con la macchina: { text, warnings }. */
  async machinePreview(machine, coolantMode) {
    return (await postJson('/api/cam/machines/preview', { machine, coolantMode })).json();
  },

  async cldata(toolpathIds, options) {
    return (await postJson('/api/cam/cl', { toolpathIds, options })).text();
  },

  async saveProject(project) {
    const res = await req('/api/project/save', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(project),
    });
    return (await check(res)).blob();
  },

  async loadProject(file) {
    const fd = new FormData();
    fd.append('file', file, file.name);
    return (await check(await req('/api/project/load', { method: 'POST', body: fd }))).json();
  },

  // ---------------------------------------------------------------- archivi: magazzino utensili e setup
  /** Elenco dell'archivio (tools | setups | machines), oppure null se non è mai stato creato. */
  async library(kind) {
    return (await check(await req(`/api/library/${kind}`))).json();
  },
  async saveLibrary(kind, list) {
    await check(await req(`/api/library/${kind}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(list),
    }));
  },

  // ---------------------------------------------------------------- copie di sicurezza sul server
  async saveRecovery(project, reason) {
    await check(await req(`/api/recovery?reason=${encodeURIComponent(reason || '')}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(project),
    }));
  },
  async recoveryList() {
    return (await check(await req('/api/recovery'))).json();
  },
  async recoveryGet(file) {
    return (await check(await req(`/api/recovery/${encodeURIComponent(file)}`))).json();
  },

  // ---------------------------------------------------------------- file di log
  /** Blackbox di diagnostica: zip protetto da password generato dal server. */
  async blackbox(payload) {
    const res = await req('/api/blackbox', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
    });
    return (await check(res)).blob();
  },

  async logInfo() {
    return (await check(await req('/api/log'))).json();
  },
  async logTail(file, lines = 400) {
    return (await check(await req(`/api/log/${encodeURIComponent(file)}?tail=${lines}`))).text();
  },
};

/** Scarica un contenuto come file. */
export function download(data, filename, type = 'application/octet-stream') {
  const blob = data instanceof Blob ? data : new Blob([data], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
