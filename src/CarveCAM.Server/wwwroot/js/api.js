// Accesso alle API del server VB.NET.

async function check(res) {
  if (!res.ok) {
    let msg = `${res.status} ${res.statusText}`;
    try {
      const j = await res.json();
      if (j && (j.error || j.title)) msg = j.error || j.title;
    } catch { /* risposta non JSON */ }
    throw new Error(msg);
  }
  return res;
}

async function postJson(url, body, signal) {
  return check(await fetch(url, {
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
    return (await check(await fetch('/api/mesh/import', { method: 'POST', body: fd }))).json();
  },

  /** Upload di una triangle soup già convertita nel browser. */
  async uploadMesh(name, positions) {
    const res = await fetch(`/api/mesh/upload?name=${encodeURIComponent(name)}`, {
      method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: positions,
    });
    return (await check(res)).json();
  },

  async getMesh(id) {
    const buf = await (await check(await fetch(`/api/mesh/${encodeURIComponent(id)}`))).arrayBuffer();
    return new Float32Array(buf);
  },

  /** Faccia B-rep di ogni triangolo (modelli CAD). */
  async uploadFaces(id, faces) {
    await check(await fetch(`/api/mesh/${encodeURIComponent(id)}/faces`, {
      method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: faces,
    }));
  },

  /** Facce B-rep della mesh, oppure null se il modello non le ha (STL, OBJ…). */
  async getFaces(id) {
    const res = await fetch(`/api/mesh/${encodeURIComponent(id)}/faces`);
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

  async getToolpath(id) {
    const buf = await (await check(await fetch(`/api/cam/toolpath/${encodeURIComponent(id)}`))).arrayBuffer();
    const dv = new DataView(buf);
    const n = dv.getInt32(0, true);
    const positions = new Float32Array(buf.slice(4, 4 + n * 12));
    const types = new Uint8Array(buf.slice(4 + n * 12, 4 + n * 13));
    return { positions, types, count: n };
  },

  async gcode(toolpathIds, options) {
    return (await postJson('/api/cam/gcode', { toolpathIds, options })).text();
  },

  async cldata(toolpathIds, options) {
    return (await postJson('/api/cam/cl', { toolpathIds, options })).text();
  },

  async saveProject(project) {
    const res = await fetch('/api/project/save', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(project),
    });
    return (await check(res)).blob();
  },

  async loadProject(file) {
    const fd = new FormData();
    fd.append('file', file, file.name);
    return (await check(await fetch('/api/project/load', { method: 'POST', body: fd }))).json();
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
